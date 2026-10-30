// ===========================================================================
// Data for the rent map (pure functions, no React / Leaflet).
//
// rows:       ZIP x month rows from data/dfw-zori (zip_code, City, county, month_year,
//             zori_rent, is_forecast). May include forecast rows.
// covariates: rows from data/dfw-zip-covariates. Only zip_code, lat and lon are used.
// ===========================================================================

// Light -> dark single-hue ramp (validated: monotone lightness, visible steps,
// lightest step clears the map surface). Darker = higher rent.
export const PRICE_COLORS = ["#86b6ef", "#5598e7", "#2a78d6", "#1c5cab", "#0d366b"];

/** Number or NaN. Missing values (null, "") must not become 0, which Number() would do. */
export const toNum = (v) => (v == null || v === "" ? NaN : Number(v));

export const usd = (v) => (v == null || !Number.isFinite(v) ? "—" : `$${Math.round(v).toLocaleString("en-US")}`);
export const shortCounty = (name) => String(name ?? "").replace(/ County$/, "");

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export const monthName = (ym) => {
  const [y, m] = String(ym ?? "").split("-").map(Number);
  return y && m ? `${MONTHS[m - 1]} ${y}` : String(ym ?? "");
};
export const shiftMonth = (ym, delta) => {
  const [y, m] = String(ym).split("-").map(Number);
  const t = y * 12 + (m - 1) + delta;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
};

/** Sorted months in the data, the forecast ones, and the latest month with actual rents. */
export function monthInfo(rows) {
  const all = new Set();
  const forecast = new Set();
  const actual = new Set();
  for (const r of rows ?? []) {
    if (!r.month_year || !Number.isFinite(toNum(r.zori_rent))) continue;
    const m = String(r.month_year).slice(0, 7);
    all.add(m);
    (r.is_forecast ? forecast : actual).add(m);
  }
  const months = [...all].sort();
  const latestActual = [...actual].sort().at(-1) ?? months.at(-1) ?? "";
  // A month counts as forecast only if it has no actual rents at all
  const forecastMonths = new Set([...forecast].filter((m) => !actual.has(m)));
  return { months, forecastMonths, latestActual };
}

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/**
 * Everything the map draws for one month.
 * Returns {
 *   zips:     [{ zip, city, county, lat, lon, rent, yoy, forecast }],
 *   counties: [{ county, lat, lon, rent, yoy, zips, forecast }],
 *   unplaced: [{ zip, city, county, rent }]   // rent known but no coordinates
 * }
 * A county's rent is the plain average of its ZIPs (same as the county chart).
 * yoy is the % change from the same month a year earlier, using only ZIPs that have both.
 */
export function buildMapData(rows, covariates, month) {
  // Missing coordinates arrive as null; as 0 they would put the ZIP off the coast of Africa
  const num = toNum;
  const coords = {};
  for (const c of covariates ?? []) {
    const lat = num(c.lat);
    const lon = num(c.lon);
    const inRange = Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && !(lat === 0 && lon === 0);
    if (Number.isFinite(lat) && Number.isFinite(lon) && inRange) coords[String(c.zip_code).padStart(5, "0")] = { lat, lon };
  }

  const yearAgo = shiftMonth(month, -12);
  const now = {};
  const before = {};
  for (const r of rows ?? []) {
    const m = String(r.month_year ?? "").slice(0, 7);
    const v = toNum(r.zori_rent);
    if (!Number.isFinite(v)) continue;
    const zip = String(r.zip_code).padStart(5, "0");
    if (m === month) now[zip] = r;
    else if (m === yearAgo && !r.is_forecast) before[zip] = v;
  }

  const zips = [];
  const unplaced = [];
  for (const [zip, r] of Object.entries(now)) {
    const rent = toNum(r.zori_rent);
    const prev = before[zip];
    const item = {
      zip,
      city: r.City ?? "",
      county: r.county ?? "Unknown county",
      rent,
      prev: prev ?? null,
      yoy: prev ? (rent / prev - 1) * 100 : null,
      forecast: Boolean(r.is_forecast),
    };
    if (coords[zip]) zips.push({ ...item, ...coords[zip] });
    else unplaced.push(item);
  }

  const byCounty = {};
  for (const z of [...zips, ...unplaced]) (byCounty[z.county] ||= []).push(z);
  const counties = Object.entries(byCounty).map(([county, list]) => {
    const placed = list.filter((z) => Number.isFinite(z.lat));
    const paired = list.filter((z) => z.prev);
    const yoy = paired.length ? (mean(paired.map((z) => z.rent)) / mean(paired.map((z) => z.prev)) - 1) * 100 : null;
    return {
      county,
      rent: mean(list.map((z) => z.rent)),
      yoy,
      zips: list.length,
      forecast: list.some((z) => z.forecast),
      lat: placed.length ? mean(placed.map((z) => z.lat)) : null,
      lon: placed.length ? mean(placed.map((z) => z.lon)) : null,
    };
  });

  const byRent = (a, b) => b.rent - a.rent;
  return { zips: zips.sort(byRent), counties: counties.sort(byRent), unplaced: unplaced.sort(byRent) };
}

const quantile = (sorted, q) => {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
};

/**
 * Up to 5 price bands with round dollar edges, so each band holds a similar number of places.
 * Returns [{ min, max, color, label }] lowest first. min of the first / max of the last are null.
 */
export function priceBands(values, maxBands = 5) {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!v.length) return [];
  const n = Math.max(1, Math.min(maxBands, v.length));
  const step = v.at(-1) - v[0] > 1000 ? 50 : 25;
  const breaks = [];
  for (let i = 1; i < n; i++) {
    const b = Math.round(quantile(v, i / n) / step) * step;
    if (b > v[0] && b <= v.at(-1) && !breaks.includes(b)) breaks.push(b);
  }
  breaks.sort((a, b) => a - b);

  const count = breaks.length + 1;
  // Spread the colors over the whole ramp even when there are fewer than 5 bands
  const colorAt = (i) => PRICE_COLORS[count === 1 ? 2 : Math.round((i * (PRICE_COLORS.length - 1)) / (count - 1))];
  return Array.from({ length: count }, (_, i) => {
    const min = i === 0 ? null : breaks[i - 1];
    const max = i === count - 1 ? null : breaks[i];
    const label = count === 1
      ? `About ${usd(v[0])}`
      : min == null ? `Under ${usd(max)}`
      : max == null ? `${usd(min)} and up`
      : `${usd(min)} – ${usd(max)}`;
    return { min, max, color: colorAt(i), label };
  });
}

export function bandFor(value, bands) {
  if (!bands.length || !Number.isFinite(value)) return null;
  return bands.find((b) => b.max == null || value < b.max) ?? bands.at(-1);
}

/** Circle radius in pixels: the cheapest place in view gets rMin, the priciest rMax. */
export function radiusFor(value, lo, hi, rMin, rMax) {
  if (!Number.isFinite(value)) return rMin;
  if (!(hi > lo)) return (rMin + rMax) / 2;
  const t = Math.min(1, Math.max(0, (value - lo) / (hi - lo)));
  return rMin + t * (rMax - rMin);
}

/** "up 2.1% from a year ago" / "down 0.4% ..." / "about the same as a year ago" */
export function yoyText(yoy, month) {
  if (!Number.isFinite(yoy)) return null;
  const when = `${monthName(shiftMonth(month, -12))}`;
  if (Math.abs(yoy) < 0.25) return `About the same as ${when}`;
  return `${yoy > 0 ? "Up" : "Down"} ${Math.abs(yoy).toFixed(1)}% from ${when}`;
}
