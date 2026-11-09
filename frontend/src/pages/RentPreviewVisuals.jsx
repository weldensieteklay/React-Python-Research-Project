import React, { useMemo } from "react";
import { buildMapData, monthInfo, priceBands, bandFor, radiusFor, toNum } from "./RentalProperty/rentMapData";

// ===========================================================================
// A text-free picture of the rental dashboard: a map and a chart, nothing to read.
//
//   <RentPreviewMap rows={rows} covariates={covRows} />
//   <RentPreviewChart rows={rows} />
//
// Map: every ZIP code as a dot at its location, darker and bigger = higher rent, plus one
//      larger circle per charted county, in that county's line colour. No base map, so no
//      tiles to load and no attribution text.
// Chart: average rent of the same four counties each month since START_MONTH.
// rows / covariates: the same data/dfw-zori and data/dfw-zip-covariates rows the rental
// dashboard uses. Screen readers get a one-line description of each picture.
// ===========================================================================

// Same colours, in the same order, as the rental dashboard's county chart
const LINE_COLORS = ["#2a78d6", "#eda100", "#e34948", "#1baf7a"];
const START_MONTH = "2020-01";

/** The counties to show: the four with the most ZIP codes in the latest month (the same
 *  ones the county chart starts with), each with its colour. */
function useFeatured(rows) {
    return useMemo(() => {
        const { latestActual } = monthInfo(rows);
        const zipsBy = {};
        for (const r of rows ?? []) {
            if (r.is_forecast || String(r.month_year).slice(0, 7) !== latestActual) continue;
            if (!Number.isFinite(toNum(r.zori_rent)) || !r.county) continue;
            (zipsBy[r.county] ||= new Set()).add(r.zip_code);
        }
        return Object.entries(zipsBy)
            .sort(([a, x], [b, y]) => y.size - x.size || a.localeCompare(b))
            .slice(0, LINE_COLORS.length)
            .map(([county], i) => ({ county, color: LINE_COLORS[i] }));
    }, [rows]);
}

export function RentPreviewMap({ rows, covariates }) {
    const featured = useFeatured(rows);
    const shape = useMemo(() => {
        const { latestActual } = monthInfo(rows);
        const { zips, counties } = buildMapData(rows, covariates, latestActual);
        if (!zips.length) return null;

        // Flat projection: shrink longitude by cos(latitude) so the metro keeps its shape
        const lats = zips.map((z) => z.lat);
        const lons = zips.map((z) => z.lon);
        const latMin = Math.min(...lats), latMax = Math.max(...lats);
        const lonMin = Math.min(...lons), lonMax = Math.max(...lons);
        const k = Math.cos((((latMin + latMax) / 2) * Math.PI) / 180);
        const W = 400, H = 320, PAD = 22;
        const spanX = Math.max((lonMax - lonMin) * k, 1e-6);
        const spanY = Math.max(latMax - latMin, 1e-6);
        const scale = Math.min((W - 2 * PAD) / spanX, (H - 2 * PAD) / spanY);
        const offX = (W - spanX * scale) / 2, offY = (H - spanY * scale) / 2;
        const xy = (lat, lon) => [offX + (lon - lonMin) * k * scale, offY + (latMax - lat) * scale];

        const bands = priceBands(zips.map((z) => z.rent));
        const lo = Math.min(...zips.map((z) => z.rent)), hi = Math.max(...zips.map((z) => z.rent));
        const dots = zips
            .map((z) => {
                const [x, y] = xy(z.lat, z.lon);
                return { key: z.zip, x, y, r: radiusFor(z.rent, lo, hi, 3, 7), fill: bandFor(z.rent, bands)?.color };
            })
            .sort((a, b) => a.r - b.r);   // bigger (pricier) dots on top

        const byCounty = Object.fromEntries(counties.map((c) => [c.county, c]));
        const marks = featured
            .map(({ county, color }) => {
                const c = byCounty[county];
                if (!c || !Number.isFinite(c.lat)) return null;
                const [x, y] = xy(c.lat, c.lon);
                return { key: county, x, y, color };
            })
            .filter(Boolean);
        return { W, H, dots, marks };
    }, [rows, covariates, featured]);

    if (!shape) return null;
    return (
        <svg viewBox={`0 0 ${shape.W} ${shape.H}`} className="w-full h-auto" role="img"
             aria-label="Map of typical rent by ZIP code: darker, bigger dots have higher rent">
            <rect width={shape.W} height={shape.H} rx="10" fill="#F3F6FA" />
            {shape.dots.map((d) => (
                <circle key={d.key} cx={d.x} cy={d.y} r={d.r} fill={d.fill} fillOpacity="0.9" />
            ))}
            {shape.marks.map((m) => (
                <circle key={m.key} cx={m.x} cy={m.y} r="12" fill={m.color} stroke="#fff" strokeWidth="3" />
            ))}
        </svg>
    );
}

export function RentPreviewChart({ rows }) {
    const featured = useFeatured(rows);
    const shape = useMemo(() => {
        // Average rent of each featured county's ZIP codes, per month
        const want = new Set(featured.map((f) => f.county));
        const sums = {};
        const months = new Set();
        for (const r of rows ?? []) {
            const m = String(r.month_year).slice(0, 7);
            const v = toNum(r.zori_rent);
            if (r.is_forecast || m < START_MONTH || !want.has(r.county) || !Number.isFinite(v)) continue;
            const cell = ((sums[r.county] ||= {})[m] ||= { total: 0, n: 0 });
            cell.total += v;
            cell.n += 1;
            months.add(m);
        }
        const ms = [...months].sort();
        if (ms.length < 2) return null;

        const series = featured.map(({ county, color }) => ({
            county, color,
            points: ms.map((m, i) => (sums[county]?.[m] ? [i, sums[county][m].total / sums[county][m].n] : null)).filter(Boolean),
        })).filter((s) => s.points.length > 1);
        const values = series.flatMap((s) => s.points.map((p) => p[1]));
        const lo = Math.min(...values), hi = Math.max(...values);
        const pad = (hi - lo) * 0.08 || 50;

        const W = 400, H = 260, L = 34, R = 16, T = 12, B = 34;
        const x = (i) => L + (i / (ms.length - 1)) * (W - L - R);
        const y = (v) => T + (1 - (v - (lo - pad)) / (hi - lo + 2 * pad)) * (H - T - B);
        return {
            W, H,
            grid: [0.25, 0.5, 0.75].map((f) => T + f * (H - T - B)),
            top: T, bottom: H - B,
            lines: series.map((s) => ({
                key: s.county, color: s.color,
                d: s.points.map(([i, v], j) => `${j ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" "),
                end: [x(s.points.at(-1)[0]), y(s.points.at(-1)[1])],
            })),
            left: L, right: W - R,
        };
    }, [rows, featured]);

    if (!shape) return null;
    return (
        <svg viewBox={`0 0 ${shape.W} ${shape.H}`} className="w-full h-auto" role="img"
             aria-label="Line chart of average rent in four counties since 2020: all rose sharply in 2021 and 2022, then leveled off">
            {shape.grid.map((gy) => (
                <line key={gy} x1={shape.left} x2={shape.right} y1={gy} y2={gy} stroke="#E5E7EB" />
            ))}
            {/* Axes and their titles */}
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
