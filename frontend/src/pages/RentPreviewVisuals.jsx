import React, { useMemo } from "react";
import { priceBands, bandFor, radiusFor } from "./RentalProperty/rentMapData";

// ===========================================================================
// The dashboard preview for one metro, drawn from live data.
//
//   <RentPreviewZipMap metro={preview.metros[0]} />
//   <RentPreviewCountyChart metro={preview.metros[0]} />
//
// metro: one entry of data/rent-preview-metros: { points: [[lat, lon, rent]],
//        counties: [{ county, label, lat, lon, series: [[month, rent]] }] }
// Map:   every ZIP code as a dot at its location, darker and bigger = higher rent, plus a
//        larger circle at each charted county's centre, in that county's line colour.
// Chart: each of those counties' average rent per month since 2020.
// ===========================================================================

export const COUNTY_COLORS = ["#2a78d6", "#eda100", "#e34948", "#1baf7a"];

// Flat projection of a lon/lat box into a w x h area (aspect kept, centred); longitude is
// shrunk by cos(latitude) so shapes aren't stretched
function fitProjection(box, x0, y0, w, h) {
    const k = Math.cos((((box.latMin + box.latMax) / 2) * Math.PI) / 180);
    const spanX = Math.max((box.lonMax - box.lonMin) * k, 1e-6);
    const spanY = Math.max(box.latMax - box.latMin, 1e-6);
    const scale = Math.min(w / spanX, h / spanY);
    const offX = x0 + (w - spanX * scale) / 2, offY = y0 + (h - spanY * scale) / 2;
    return (lat, lon) => [offX + (lon - box.lonMin) * k * scale, offY + (box.latMax - lat) * scale];
}

// The box holding the ZIPs, ignoring the outermost 2% on each side so one far-flung ZIP
// doesn't shrink the rest
function zipBox(points) {
    const q = (xs, p) => xs[Math.min(xs.length - 1, Math.max(0, Math.floor(xs.length * p)))];
    const lats = points.map((p) => p[0]).sort((a, b) => a - b);
    const lons = points.map((p) => p[1]).sort((a, b) => a - b);
    const box = { latMin: q(lats, 0.02), latMax: q(lats, 0.98), lonMin: q(lons, 0.02), lonMax: q(lons, 0.98) };
    const padLat = (box.latMax - box.latMin) * 0.06 || 0.05, padLon = (box.lonMax - box.lonMin) * 0.06 || 0.05;
    return { latMin: box.latMin - padLat, latMax: box.latMax + padLat, lonMin: box.lonMin - padLon, lonMax: box.lonMax + padLon };
}

const MAP_W = 400, MAP_H = 260;

export function RentPreviewZipMap({ metro }) {
    const shape = useMemo(() => {
        const points = (metro?.points ?? []).filter(([a, b, r]) => Number.isFinite(a) && Number.isFinite(b) && Number.isFinite(r));
        if (!points.length) return null;
        const project = fitProjection(zipBox(points), 8, 8, MAP_W - 16, MAP_H - 16);
        const rents = points.map((p) => p[2]);
        const bands = priceBands(rents);
        const sorted = [...rents].sort((a, b) => a - b);
        const lo = sorted[Math.floor(sorted.length * 0.05)], hi = sorted[Math.floor(sorted.length * 0.95)];
        const dots = points
            .map(([lat, lon, rent]) => {
                const [x, y] = project(lat, lon);
                return { x, y, rent, r: radiusFor(rent, lo, hi, 2.4, 5), fill: bandFor(rent, bands)?.color };
            })
            .sort((a, b) => a.rent - b.rent);   // pricier dots on top
        const marks = (metro?.counties ?? []).slice(0, COUNTY_COLORS.length)
            .map((c, i) => {
                if (!Number.isFinite(c.lat) || !Number.isFinite(c.lon)) return null;
                const [x, y] = project(c.lat, c.lon);
                return { key: c.county, x, y, color: COUNTY_COLORS[i] };
            })
            .filter(Boolean);
        return { dots, marks };
    }, [metro]);

    if (!shape) return null;
    return (
        <svg viewBox={`0 0 ${MAP_W} ${MAP_H}`} className="w-full h-auto" role="img"
             aria-label="Map of typical rent by ZIP code: darker, bigger dots have higher rent">
            {shape.dots.map((d, i) => (
                <circle key={i} cx={d.x.toFixed(1)} cy={d.y.toFixed(1)} r={d.r.toFixed(2)} fill={d.fill} fillOpacity="0.85" />
            ))}
            {shape.marks.map((m) => (
                <circle key={m.key} cx={m.x} cy={m.y} r="9" fill={m.color} stroke="#fff" strokeWidth="2.5" />
            ))}
        </svg>
    );
}

export function RentPreviewCountyChart({ metro }) {
    const shape = useMemo(() => {
        const counties = (metro?.counties ?? []).filter((c) => c.series?.length > 1).slice(0, COUNTY_COLORS.length);
        if (!counties.length) return null;
        const months = [...new Set(counties.flatMap((c) => c.series.map((p) => p[0])))].sort();
        if (months.length < 2) return null;
        const index = Object.fromEntries(months.map((m, i) => [m, i]));
        const values = counties.flatMap((c) => c.series.map((p) => p[1]));
        const lo = Math.min(...values), hi = Math.max(...values);
        const pad = (hi - lo) * 0.08 || 50;

        const W = 400, H = 260, L = 34, R = 16, T = 12, B = 34;
        const x = (i) => L + (i / (months.length - 1)) * (W - L - R);
        const y = (v) => T + (1 - (v - (lo - pad)) / (hi - lo + 2 * pad)) * (H - T - B);
        return {
            W, H, left: L, right: W - R, top: T, bottom: H - B,
            grid: [0.25, 0.5, 0.75].map((f) => T + f * (H - T - B)),
            lines: counties.map((c, i) => {
                const pts = c.series.map(([month, v]) => [x(index[month]), y(v)]);
                return {
                    key: c.county, color: COUNTY_COLORS[i],
                    d: pts.map(([px, py], j) => `${j ? "L" : "M"}${px.toFixed(1)},${py.toFixed(1)}`).join(" "),
                    end: pts.at(-1),
                };
            }),
        };
    }, [metro]);

    if (!shape) return null;
    return (
        <svg viewBox={`0 0 ${shape.W} ${shape.H}`} className="w-full h-auto" role="img"
             aria-label="Line chart of average monthly rent since 2020 in four counties">
            {shape.grid.map((gy) => (
                <line key={gy} x1={shape.left} x2={shape.right} y1={gy} y2={gy} stroke="#E5E7EB" />
            ))}
            <line x1={shape.left} x2={shape.left} y1={shape.top} y2={shape.bottom} stroke="#9CA3AF" />
            <line x1={shape.left} x2={shape.right} y1={shape.bottom} y2={shape.bottom} stroke="#9CA3AF" />
            <text x={(shape.left + shape.right) / 2} y={shape.H - 8} textAnchor="middle" fontSize="13" fill="#4B5563">
                Month (2020 to today)
            </text>
            <text transform={`translate(14 ${(shape.top + shape.bottom) / 2}) rotate(-90)`} textAnchor="middle" fontSize="13" fill="#4B5563">
                Typical monthly rent ($)
            </text>
            {shape.lines.map((l) => (
                <g key={l.key}>
                    <path d={l.d} fill="none" stroke={l.color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
                    <circle cx={l.end[0]} cy={l.end[1]} r="4.5" fill={l.color} stroke="#fff" strokeWidth="2" />
                </g>
            ))}
        </svg>
    );
}
