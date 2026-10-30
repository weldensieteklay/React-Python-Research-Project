import React, { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  buildMapData, priceBands, bandFor, radiusFor, monthInfo, monthName, usd, shortCounty, yoyText,
} from "./rentMapData";

// ===========================================================================
// Rent map for non-technical readers.
//
//   <RentMap rows={gridRows} covariates={covRows} />
//
// Three views, chosen by zooming or clicking:
//   counties  – the starting view: one circle per county, with its name and rent.
//   ZIP codes – zoom in (+) ZIP_ZOOM_STEPS times from the all-counties view; zoom out (−) to return.
//               The switch point is measured from the zoom that fits all counties, so it adapts
//               to the map's size on screen.
//   one county – click a county: its ZIP codes, with the neighbouring counties still shown.
//               Zooming back out to the all-counties view (or "All counties") returns to counties.
// Bigger and darker circle = higher rent. Hover any circle for details. Labels are placed only
// where they don't overlap, so they stay readable at any zoom. The list beside the map has
// every value, so nothing depends on reading colours.
//
// rows:       data/dfw-zori rows (actual and, if a model was trained, forecast)
// covariates: data/dfw-zip-covariates rows (zip_code, lat, lon)
// county / onCountyChange: optional, lets the page control the open county (e.g. for its ← button)
// ===========================================================================

// How many zoom-in steps past the all-counties view before ZIP codes appear
const ZIP_ZOOM_STEPS = 2;
// From this many steps in, ZIP labels also show the ZIP number
const ZIP_NUMBER_STEPS = 4;
// Neighbouring counties kept in view when a county is opened
const NEIGHBOURS_IN_VIEW = 3;

// Base map. OpenStreetMap's tiles are fine for light use with attribution (required by its licence);
// for a paid, higher-traffic app set VITE_MAP_TILE_URL / VITE_MAP_ATTRIBUTION to a provider you have a key for.
const TILE_URL = import.meta.env?.VITE_MAP_TILE_URL || "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const TILE_ATTRIBUTION = import.meta.env?.VITE_MAP_ATTRIBUTION
  || '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
const DFW_CENTER = [32.85, -97.0];

const SIZES = { county: [16, 32], zip: [6, 16], neighbour: [12, 20] };
const LABEL_FONT = { county: "700 13px system-ui, sans-serif", zip: "600 12px system-ui, sans-serif" };

const MAP_CSS = `
  .rent-map .leaflet-tile-pane { filter: grayscale(1) brightness(1.06) contrast(0.88); }
  .rent-map .leaflet-container { background: #f3f4f6; font: inherit; }
  .rent-map .leaflet-control-attribution { font-size: 10px; background: rgba(255,255,255,.75); color: #6b7280; }
  .rent-map .leaflet-control-attribution a { color: #6b7280; }
  .rent-map .leaflet-control-zoom a { width: 36px; height: 36px; line-height: 36px; font-size: 20px; }
  .rent-map-tip { font-size: 13px; line-height: 1.45; padding: 8px 10px; border-radius: 8px;
    border: 1px solid #e5e7eb; box-shadow: 0 4px 12px rgba(0,0,0,.12); color: #374151; }
  .rent-map-tip b { color: #111827; }
  .rent-map-tip .muted { color: #6b7280; }
  .rent-map-tip .hint { color: #1c5cab; font-weight: 600; margin-top: 2px; }
  .rent-map-label { background: none; border: none; }
  .rent-map-label span { display: inline-block; transform: translate(-50%, 0); white-space: nowrap;
    color: #111827; padding: 1px 5px; border-radius: 4px; background: rgba(255,255,255,.88);
    box-shadow: 0 0 0 1px rgba(17,24,39,.06); }
  .rent-map-label .county { font: ${LABEL_FONT.county}; }
  .rent-map-label .zip { font: ${LABEL_FONT.zip}; }
`;

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// Text width for label placement (canvas measure, cached per font+text)
const measureCache = new Map();
let measureCtx = null;
function textWidth(text, font) {
  const key = `${font}|${text}`;
  if (measureCache.has(key)) return measureCache.get(key);
  if (!measureCtx && typeof document !== "undefined") measureCtx = document.createElement("canvas").getContext("2d");
  let w = text.length * 7.5;
  if (measureCtx) { measureCtx.font = font; w = measureCtx.measureText(text).width; }
  measureCache.set(key, w);
  return w;
}

function countyTip(c, month) {
  const change = yoyText(c.yoy, month);
  return `<div><b>${esc(c.county)}</b></div>
    <div>Typical rent: <b>${usd(c.rent)}</b>/month${c.forecast ? " <span class='muted'>(forecast)</span>" : ""}</div>
    ${change ? `<div>${change}</div>` : ""}
    <div class="muted">Average of ${c.zips} ZIP code${c.zips === 1 ? "" : "s"}</div>
    <div class="hint">Click to see its ZIP codes</div>`;
}

function zipTip(z, month, countyRent) {
  const diff = Number.isFinite(countyRent) ? z.rent - countyRent : null;
  const vsCounty = diff == null ? ""
    : Math.abs(diff) < 10 ? `About the same as the ${esc(shortCounty(z.county))} County average`
    : `${usd(Math.abs(diff))} ${diff > 0 ? "above" : "below"} the ${esc(shortCounty(z.county))} County average`;
  const change = yoyText(z.yoy, month);
  return `<div><b>${esc(z.zip)}</b>${z.city ? ` · ${esc(z.city)}` : ""} <span class="muted">(${esc(z.county)})</span></div>
    <div>Typical rent: <b>${usd(z.rent)}</b>/month${z.forecast ? " <span class='muted'>(forecast)</span>" : ""}</div>
    ${vsCounty ? `<div>${vsCounty}</div>` : ""}
    ${change ? `<div class="muted">${change}</div>` : ""}`;
}

function Legend({ bands, mode }) {
  if (!bands.length) return null;
  return (
    <div>
      <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Typical rent per month</div>
      <ul className="space-y-1.5">
        {[...bands].reverse().map((b, i, arr) => {
          const r = radiusFor(arr.length - 1 - i, 0, arr.length - 1, 4, 10);
          return (
            <li key={b.label} className="flex items-center gap-2 text-sm text-gray-700">
              <span className="inline-flex justify-center w-6 shrink-0">
                <span className="rounded-full border-2 border-white shadow-sm" style={{ width: r * 2, height: r * 2, background: b.color }} />
              </span>
              <span className="tabular-nums">{b.label}</span>
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-gray-500 mt-2">
        Bigger, darker circle = higher rent.
        {mode === "focus" ? " Circles with a county name are county averages." : ""}
      </p>
    </div>
  );
}

const hintText = (mode, county) => ({
  county: `Counties · click one, or press + ${ZIP_ZOOM_STEPS} times, to see ZIP codes`,
  zip: "ZIP codes · press − to go back to counties",
  focus: `${shortCounty(county)} County ZIP codes · press − for all counties`,
}[mode]);

export default function RentMap({
  rows, covariates, loading = false, error = null, onRetry, height = 540,
  county: countyProp, onCountyChange,
}) {
  const { months, forecastMonths, latestActual } = useMemo(() => monthInfo(rows), [rows]);
  const [month, setMonth] = useState("");
  useEffect(() => { if (!month || !months.includes(month)) setMonth(latestActual); }, [months, latestActual, month]);

  // Open county: controlled by the page when it passes `county`, otherwise kept here
  const [countyState, setCountyState] = useState(null);
  const controlled = countyProp !== undefined;
  const county = controlled ? countyProp : countyState;
  const setCountyRef = useRef(null);
  setCountyRef.current = (c) => { if (!controlled) setCountyState(c); onCountyChange?.(c); };
  const setCounty = (c) => setCountyRef.current(c);

  const data = useMemo(() => (month ? buildMapData(rows, covariates, month) : { zips: [], counties: [], unplaced: [] }), [rows, covariates, month]);
  useEffect(() => { if (county && !data.counties.some((c) => c.county === county)) setCounty(null); }, [data, county]);
  const countyRent = useMemo(() => Object.fromEntries(data.counties.map((c) => [c.county, c.rent])), [data]);
  const placed = (x) => Number.isFinite(x.lat) && Number.isFinite(x.lon);
  const placedCounties = useMemo(() => data.counties.filter(placed), [data]);

  // ---- Leaflet map, zoom tracking
  const mapEl = useRef(null);
  const mapRef = useRef(null);
  const circleLayerRef = useRef(null);
  const labelLayerRef = useRef(null);
  const markersRef = useRef({});
  const hintRef = useRef(null);
  const [zoom, setZoom] = useState(null);
  const [viewTick, setViewTick] = useState(0);   // bumps after every pan/zoom/resize
  const [sizeTick, setSizeTick] = useState(0);

  useEffect(() => {
    if (!mapEl.current || mapRef.current) return undefined;
    const map = L.map(mapEl.current, { center: DFW_CENTER, zoom: 8, scrollWheelZoom: false, zoomSnap: 0.25, zoomDelta: 1 });
    map.attributionControl.setPrefix(false);   // no "Leaflet" link; the OpenStreetMap credit stays (licence requirement)
    L.tileLayer(TILE_URL, { attribution: TILE_ATTRIBUTION, maxZoom: 18 }).addTo(map);
    circleLayerRef.current = L.layerGroup().addTo(map);
    labelLayerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    const onView = () => { setZoom(map.getZoom()); setViewTick((t) => t + 1); };
    map.on("zoomend moveend", onView);
    let ro = null;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(() => { map.invalidateSize(); setSizeTick((t) => t + 1); });
      ro.observe(mapEl.current);
    }
    const t = setTimeout(() => { map.invalidateSize(); setSizeTick((x) => x + 1); }, 0);
    return () => {
      clearTimeout(t);
      ro?.disconnect();
      // Leaving mid-zoom: Leaflet finishes a zoom animation from a timer, which would then run on
      // the removed map and throw. Marking the animation as done makes that timer do nothing.
      map.stop();
      map._animatingZoom = false;
      map.off();
      map.remove();
      mapRef.current = null;
      circleLayerRef.current = null;
      labelLayerRef.current = null;
    };
  }, []);

  // Zoom that fits all counties = the "counties" level; depends on the map's size on screen
  const countyBounds = useMemo(
    () => (placedCounties.length ? L.latLngBounds(placedCounties.map((c) => [c.lat, c.lon])).pad(0.25) : null),
    [placedCounties]
  );
  const [baseZoom, setBaseZoom] = useState(null);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !countyBounds) return;
    setBaseZoom(Math.min(10, map.getBoundsZoom(countyBounds)));
  }, [countyBounds, sizeTick]);

  // First time there's data: show all counties
  const fittedRef = useRef(false);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || fittedRef.current || baseZoom == null || !countyBounds) return;
    fittedRef.current = true;
    map.setView(countyBounds.getCenter(), baseZoom, { animate: false });
    setZoom(map.getZoom());
  }, [baseZoom, countyBounds]);

  const stepsIn = zoom != null && baseZoom != null ? zoom - baseZoom : 0;
  const mode = county ? "focus" : stepsIn >= ZIP_ZOOM_STEPS - 0.01 ? "zip" : "county";

  // Opening a county zooms to it (with room around it for the neighbours); closing it
  // with "All counties" or ← returns to the all-counties view. Closing it by zooming out
  // leaves the map where the user put it.
  const closedByZoomRef = useRef(false);
  const prevCountyRef = useRef(county);
  useEffect(() => {
    const map = mapRef.current;
    const prev = prevCountyRef.current;
    prevCountyRef.current = county;
    if (!map || baseZoom == null || prev === county) return;
    if (county) {
      const zips = data.zips.filter((z) => z.county === county);
      if (!zips.length) return;
      // Frame the county together with its nearest neighbours, so their prices stay in view
      const own = L.latLngBounds(zips.map((z) => [z.lat, z.lon]));
      const c = own.getCenter();
      const near = placedCounties
        .filter((n) => n.county !== county)
        .sort((a, b) => c.distanceTo([a.lat, a.lon]) - c.distanceTo([b.lat, b.lon]))
        .slice(0, NEIGHBOURS_IN_VIEW);
      const b = L.latLngBounds([...zips.map((z) => [z.lat, z.lon]), ...near.map((n) => [n.lat, n.lon])]).pad(0.12);
      const z = Math.max(baseZoom + 1, Math.min(map.getBoundsZoom(b), 13));
      map.flyTo(b.getCenter(), z, { duration: 0.6 });
    } else if (!closedByZoomRef.current && countyBounds) {
      map.flyTo(countyBounds.getCenter(), baseZoom, { duration: 0.6 });
    }
    closedByZoomRef.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [county, baseZoom]);

  // Zooming out to the all-counties level closes an open county
  useEffect(() => {
    if (county && zoom != null && baseZoom != null && zoom <= baseZoom + 0.5) {
      closedByZoomRef.current = true;
      setCounty(null);
    }
  }, [zoom]);

  // ---- What's drawn in each mode
  const drawItems = useMemo(() => {
    if (mode === "county") return placedCounties.map((c) => ({ ...c, kind: "county" }));
    if (mode === "zip") return data.zips.map((z) => ({ ...z, kind: "zip" }));
    return [
      ...data.zips.filter((z) => z.county === county).map((z) => ({ ...z, kind: "zip" })),
      ...placedCounties.filter((c) => c.county !== county).map((c) => ({ ...c, kind: "neighbour" })),
    ];
  }, [mode, data, placedCounties, county]);

  const bands = useMemo(() => priceBands(drawItems.map((x) => x.rent)), [drawItems]);
  const range = useMemo(() => {
    const r = {};
    for (const x of drawItems) {
      const k = x.kind;
      r[k] ||= [Infinity, -Infinity];
      r[k] = [Math.min(r[k][0], x.rent), Math.max(r[k][1], x.rent)];
    }
    return r;
  }, [drawItems]);
  const radiusOf = (x) => radiusFor(x.rent, range[x.kind][0], range[x.kind][1], ...SIZES[x.kind]);

  // ---- Circles (redrawn when the content changes, not on every pan)
  useEffect(() => {
    const layer = circleLayerRef.current;
    if (!layer) return;
    layer.clearLayers();
    markersRef.current = {};
    const drawn = drawItems.map((x) => ({ x, r: radiusOf(x) })).sort((a, b) => b.r - a.r);   // small ones on top
    for (const { x, r } of drawn) {
      const isZip = x.kind === "zip";
      const color = bandFor(x.rent, bands)?.color ?? "#9ca3af";
      const base = {
        radius: r, color: "#ffffff", weight: isZip ? 1.5 : 2.5, fillColor: color,
        fillOpacity: x.forecast ? 0.6 : x.kind === "neighbour" ? 0.75 : 0.9, dashArray: x.forecast ? "3 3" : null,
      };
      const marker = L.circleMarker([x.lat, x.lon], base)
        .bindTooltip(isZip ? zipTip(x, month, countyRent[x.county]) : countyTip(x, month), {
          direction: "top", offset: [0, -r], className: "rent-map-tip", opacity: 1,
        })
        .on("mouseover", () => marker.setStyle({ color: "#111827", weight: 3 }))
        .on("mouseout", () => marker.setStyle({ color: "#ffffff", weight: base.weight }));
      if (!isZip) marker.on("click", () => setCounty(x.county));
      marker.addTo(layer);
      markersRef.current[isZip ? x.zip : `county:${x.county}`] = marker;
    }
  }, [drawItems, bands, month, countyRent]);

  // ---- Labels: placed in priority order, skipped where they'd overlap or fall off the map
  useEffect(() => {
    const map = mapRef.current;
    const layer = labelLayerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();
    if (!drawItems.length) return;
    const size = map.getSize();
    const center = L.point(size.x / 2, size.y / 2);
    const showZipNumber = stepsIn >= ZIP_NUMBER_STEPS - 0.01;

    const candidates = drawItems.map((x) => {
      const pt = map.latLngToContainerPoint([x.lat, x.lon]);
      const isZip = x.kind === "zip";
      const text = isZip ? `${showZipNumber ? `${x.zip} ` : ""}${usd(x.rent)}` : `${shortCounty(x.county)} ${usd(x.rent)}`;
      const font = isZip ? LABEL_FONT.zip : LABEL_FONT.county;
      const w = textWidth(text, font) + 10;
      const h = isZip ? 18 : 20;
      const r = radiusOf(x);
      const top = pt.y + r + 2;
      return { x, pt, text, isZip, r, box: [pt.x - w / 2, top, pt.x + w / 2, top + h], dist: pt.distanceTo(center) };
    });
    // Counties first (the user wants to keep seeing them); then ZIP codes nearest the centre of the view
    const rank = (c) => (c.isZip ? 1 : 0);
    candidates.sort((a, b) => rank(a) - rank(b) || (a.isZip ? a.dist - b.dist : b.x.rent - a.x.rent));

    // Keep labels out from under the hint bubble and the +/− buttons
    const placedBoxes = [];
    const host = mapEl.current?.getBoundingClientRect();
    const blockers = [hintRef.current, mapEl.current?.querySelector(".leaflet-control-zoom")].filter(Boolean);
    if (host) for (const el of blockers) {
      const r = el.getBoundingClientRect();
      if (r.width) placedBoxes.push([r.left - host.left - 4, r.top - host.top - 4, r.right - host.left + 4, r.bottom - host.top + 4]);
    }
    const overlaps = (a, b) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
    for (const c of candidates) {
      const [x0, y0, x1, y1] = c.box;
      if (x0 < 2 || y0 < 2 || x1 > size.x - 2 || y1 > size.y - 18) continue;   // keep clear of the edges and credit line
      if (placedBoxes.some((b) => overlaps(b, c.box))) continue;
      placedBoxes.push(c.box);
      L.marker([c.x.lat, c.x.lon], {
        interactive: false,
        keyboard: false,
        icon: L.divIcon({
          className: "rent-map-label",
          html: `<span class="${c.isZip ? "zip" : "county"}" style="margin-top:${Math.round(c.r) + 2}px">${esc(c.text)}</span>`,
          iconSize: [0, 0],
        }),
      }).addTo(layer);
    }
  }, [drawItems, viewTick, sizeTick, bands, mode]);

  // ---- Side panel content for the current view
  const listItems = useMemo(() => {
    if (mode === "county") return data.counties;
    if (mode === "focus") return [...data.zips, ...data.unplaced].filter((z) => z.county === county).sort((a, b) => b.rent - a.rent);
    const map = mapRef.current;
    const b = map?.getBounds();
    return b ? data.zips.filter((z) => b.contains([z.lat, z.lon])) : data.zips;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, data, county, viewTick]);
  const listIsCounties = mode === "county";
  const selected = county ? data.counties.find((c) => c.county === county) : null;
  const noCoords = !loading && (data.counties.length > 0) && placedCounties.length === 0;

  /** List click: open a county, or show a ZIP's details on the map. */
  const focusItem = (item) => {
    if (listIsCounties) { setCounty(item.county); return; }
    const m = markersRef.current[item.zip];
    if (m && mapRef.current) {
      mapRef.current.panTo(m.getLatLng());
      m.openTooltip();
    }
  };

  const monthIsForecast = forecastMonths.has(month);
  const top = listItems[0];
  const bottom = listItems.at(-1);
  const name = (x) => (listIsCounties ? shortCounty(x.county) : `${x.zip}${x.city ? ` (${x.city})` : ""}`);

  if (!rows?.length) {
    return <div className="border border-gray-200 bg-white rounded-lg p-6 text-sm text-gray-400">No rent data to map.</div>;
  }

  const title = mode === "focus" ? `Rent by ZIP code in ${county}` : mode === "zip" ? "Rent by ZIP code" : "Where is rent highest in Dallas-Fort Worth?";

  return (
    <div className="rent-map border border-gray-200 bg-white rounded-lg p-6">
      <style>{MAP_CSS}</style>

      {/* Title, breadcrumb and month */}
      <div className="flex flex-col md:flex-row md:items-start justify-between gap-3 mb-4">
        <div>
          <nav className="text-sm mb-1" aria-label="Map level">
            {mode === "county" ? (
              <span className="font-semibold text-gray-700">All counties</span>
            ) : (
              <>
                <button onClick={() => { if (county) setCounty(null); else if (countyBounds && baseZoom != null) mapRef.current?.flyTo(countyBounds.getCenter(), baseZoom, { duration: 0.6 }); }}
                        className="font-semibold text-blue-700 hover:underline">All counties</button>
                <span className="text-gray-400 mx-1.5">/</span>
                <span className="font-semibold text-gray-700">{county ?? "ZIP codes"}</span>
              </>
            )}
          </nav>
          <h3 className="text-lg font-bold text-gray-900">{title}</h3>
          <p className="text-sm text-gray-500 mt-0.5">
            Typical monthly rent in {monthName(month)}{monthIsForecast ? " (forecast)" : ""}, from Zillow. Hover a circle for details.
          </p>
        </div>
        <label className="flex items-center gap-1.5 shrink-0">
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Month:</span>
          <select value={month} onChange={(e) => setMonth(e.target.value)}
                  className="border border-gray-300 bg-white rounded-md px-3 py-1.5 text-sm font-medium focus:outline-none">
            {[...months].reverse().map((m) => (
              <option key={m} value={m}>{monthName(m)}{forecastMonths.has(m) ? " (forecast)" : ""}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-5">
        {/* Map */}
        {/* isolate: Leaflet's own layers (z-index 400-1000) stay inside the map instead of
            covering the fixed header/footer */}
        <div className="relative isolate rounded-lg overflow-hidden border border-gray-200" style={{ height }}>
          <div ref={mapEl} className="absolute inset-0"
               role="img"
               aria-label={top ? `Map of typical rent by ${listIsCounties ? "county" : "ZIP code"}. Highest: ${name(top)} at ${usd(top.rent)}. Lowest: ${name(bottom)} at ${usd(bottom.rent)}. The list beside the map has every value.` : "Rent map"} />
          {/* What you're looking at, and how to change it */}
          {!loading && !error && !noCoords && (
            <div ref={hintRef} className="absolute top-3 left-1/2 -translate-x-1/2 z-[450] pointer-events-none max-w-[80%]">
              <div className="px-3 py-1.5 rounded-full bg-white/95 shadow text-sm font-medium text-gray-800 text-center" aria-live="polite">
                {hintText(mode, county)}
              </div>
            </div>
          )}
          {(loading || error || noCoords) && (
            <div className="absolute inset-0 z-[500] flex items-center justify-center bg-white/80 p-6 text-center">
              {loading ? (
                <span className="text-sm text-gray-500 animate-pulse">Loading map locations…</span>
              ) : (
                <div className="text-sm text-gray-600 max-w-sm">
                  <p>We couldn't load the map locations right now, so the map can't be drawn. The list on the right still has every rent.</p>
                  {onRetry && <button onClick={onRetry} className="mt-2 font-semibold text-blue-700 underline">Try again</button>}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Side panel: legend, quick facts and the list (the non-visual version of the map) */}
        <aside className="space-y-5">
          <Legend bands={bands} mode={mode} />

          {top && bottom && top !== bottom && (
            <div className="bg-gray-50 rounded-lg px-4 py-3 text-sm text-gray-700 space-y-1">
              {mode === "focus" && selected && (
                <div>Across its {selected.zips} ZIP codes, {shortCounty(county)} County averages <b>{usd(selected.rent)}</b>.</div>
              )}
              {mode === "zip" && <div>{listItems.length} ZIP codes in view.</div>}
              <div>Highest: <b>{name(top)}</b>, {usd(top.rent)}</div>
              <div>Lowest: <b>{name(bottom)}</b>, {usd(bottom.rent)}</div>
              <div className="text-gray-500">A difference of {usd(top.rent - bottom.rent)} a month.</div>
            </div>
          )}

          <div>
            <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
              {mode === "county" ? "All counties, highest rent first" : mode === "zip" ? "ZIP codes in view, highest rent first" : "ZIP codes, highest rent first"}
            </div>
            <ul className="max-h-72 overflow-y-auto divide-y divide-gray-100 border border-gray-100 rounded-md">
              {listItems.map((x) => (
                <li key={listIsCounties ? x.county : x.zip}>
                  <button onClick={() => focusItem(x)}
                          title={listIsCounties ? `See ZIP codes in ${x.county}` : placed(x) ? "Show on map" : "No map location for this ZIP"}
                          className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left hover:bg-blue-50 focus:bg-blue-50 focus:outline-none">
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: bandFor(x.rent, bands)?.color }} />
                    <span className="flex-1 truncate text-gray-800">{name(x)}</span>
                    <span className="tabular-nums font-semibold text-gray-900">{usd(x.rent)}</span>
                    {listIsCounties && <span className="text-gray-400" aria-hidden="true">›</span>}
                  </button>
                </li>
              ))}
              {!listItems.length && <li className="px-3 py-2 text-sm text-gray-400">No ZIP codes in view. Zoom out (−) or drag the map.</li>}
            </ul>
            {mode === "focus" && listItems.some((x) => !placed(x)) && (
              <p className="text-xs text-gray-400 mt-1">Some ZIP codes have no map location and appear only in this list.</p>
            )}
          </div>
        </aside>
      </div>

      <p className="text-xs text-gray-400 mt-4">
        "Typical rent" is Zillow's Observed Rent Index (ZORI) for that ZIP code. A county's rent is the average of its ZIP codes.
        Colours and sizes compare the places on screen; the legend always shows the dollar ranges.
        {monthIsForecast ? " Forecast months show faded, dashed circles." : ""}
      </p>
    </div>
  );
}
