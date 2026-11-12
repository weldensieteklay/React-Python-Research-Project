import React, { useEffect, useId, useMemo, useState } from "react";
import { useFetchData } from "../../hooks/useFetchData";
import { DFW_METRO } from "./useRentMetro";

// ===========================================================================
// "What drives rents here?" for the rental dashboard.
//
//   <RentDriversSection metro={metro} areaName="DFW" rows={actualRows} />
//
// Collapsed by default: one header line with a Show button. Neighborhood data is loaded the
// first time the section is opened.
//
// For a county the viewer picks, each driver shows the county's value next to the metro's
// typical (median) value, what published research says about that driver, and a
// link to the source. Values come from data/dfw-zip-covariates (U.S. Census) and the rent
// rows (Zillow, plus the national mortgage rate). A county's value is the median of its ZIPs.
// These are associations from research, not a forecast or proof of cause for one area.
// ===========================================================================

// Shares may arrive as fractions (0.42) or percents (42); treat values up to 1.5 as fractions
const asPct = (v) => (Math.abs(v) <= 1.5 ? v * 100 : v);
const median = (xs) => {
    const v = xs.filter((x) => typeof x === "number" && Number.isFinite(x)).sort((a, b) => a - b);
    if (!v.length) return null;
    const m = Math.floor(v.length / 2);
    return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};
const num = (v) => (v == null || v === "" ? NaN : Number(v));
const usd = (v) => `$${Math.round(v).toLocaleString("en-US")}`;

// Each driver: where its value comes from, how to show it, and what the research says
const DRIVERS = [
    {
        key: "median_household_income",
        name: "Household income",
        format: usd,
        higher: "Higher than the metro", lower: "Lower than the metro",
        research: "Strong demand from higher-income renter households has kept rents high. Higher-income areas usually support higher rents.",
        source: { label: "Harvard JCHS, State of the Nation's Housing 2024 (summary by HUD USER)", url: "https://jchs.harvard.edu/state-nations-housing-2024" },
    },
    {
        key: "new_build_share",
        name: "Share of homes built since 2020",
        format: (v) => `${asPct(v).toFixed(1)}%`,
        higher: "More new housing than the metro", lower: "Less new housing than the metro",
        research: "New apartment buildings lowered rents in nearby units by about 6% compared with units slightly farther away. More new supply usually slows local rent growth.",
        source: { label: "Asquith, Mast & Reed (2023), Review of Economics and Statistics", url: "https://ideas.repec.org/a/tpr/restat/v105y2023i2p359-375.html" },
    },
    {
        key: "renter_stock_growth",
        name: "Growth in rented homes since 2019",
        format: (v) => `${asPct(v) >= 0 ? "+" : ""}${asPct(v).toFixed(1)}%`,
        higher: "Faster growth than the metro", lower: "Slower growth than the metro",
        research: "Rental markets cooled as a decades-high volume of new supply came online and outpaced demand. Where the rental stock grows faster, rent growth tends to slow.",
        source: { label: "Harvard JCHS, America's Rental Housing 2024", url: "https://jchs.harvard.edu/blog/six-takeaways-americas-rental-housing-2024" },
    },
    {
        key: "dist_downtown_mi",
        name: "Distance to downtown",
        format: (v) => `${v.toFixed(1)} mi`,
        higher: "Farther out than the typical ZIP", lower: "Closer in than the typical ZIP",
        research: "Rents usually fall with distance from downtown. In the pandemic, rents fell in city centers and rose farther out, erasing about 80% of the urban rent premium by the end of 2020.",
        source: { label: "Gupta, Mittal, Peeters & Van Nieuwerburgh (2022), NBER / Journal of Financial Economics", url: "https://doi.org/10.3386/w28675" },
    },
    {
        key: "pop_density_sqmi",
        name: "Population density",
        format: (v) => `${Math.round(v).toLocaleString("en-US")} per sq mi`,
        higher: "Denser than the metro", lower: "Less dense than the metro",
        research: "Dense areas usually command higher rents, but the pandemic turned density into a drawback for many renters, and rents in denser, more central areas fell relative to suburbs.",
        source: { label: "NBER research summary: how urban rent gradients flattened during the pandemic", url: "https://www.nber.org/research/videos/2021-stijn-van-nieuwerburgh-how-urban-rent-gradients-have-flattened-during-pandemic" },
    },
];

const MORTGAGE = {
    name: "30-year mortgage rate (national)",
    research: "High interest rates have dampened rental market activity: they make new rental projects harder to finance and slowed multifamily construction, which affects future supply.",
    source: { label: "Harvard JCHS, America's Rental Housing 2024", url: "https://jchs.harvard.edu/blog/six-takeaways-americas-rental-housing-2024" },
};

function compare(area, metro) {
    if (!Number.isFinite(area) || !Number.isFinite(metro) || metro === 0) return "same";
    const ratio = area / metro;
    return ratio > 1.05 ? "higher" : ratio < 0.95 ? "lower" : "same";
}

function SourceLink({ source }) {
    return (
        <a href={source.url} target="_blank" rel="noopener noreferrer" title={source.label}
            aria-label={`See more details: ${source.label} (opens in a new tab)`}
            className="inline-block mt-2 text-sm font-semibold text-blue-700 hover:text-blue-900 hover:underline">
            See more details ↗
        </a>
    );
}

// How often each part of the section changes. Update this if the research list becomes automatic.
const UPDATE_NOTE = "Rent drivers are reviewed and updated every week.";

/** An (i) icon that shows `text` on hover or keyboard focus, and toggles it on tap (phones). */
function InfoTip({ text, className = "text-blue-700 hover:text-blue-900" }) {
    const [shown, setShown] = useState(false);
    const tipId = useId();
    return (
        <span className="relative inline-flex group">
            <button
                type="button"
                aria-label="About these drivers"
                aria-describedby={tipId}
                onClick={() => setShown((v) => !v)}
                onBlur={() => setShown(false)}
                onKeyDown={(e) => { if (e.key === "Escape") setShown(false); }}
                className={`${className} rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500`}
            >
                <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" className="w-5 h-5">
                    <path fillRule="evenodd" d="M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Zm-7-4a1 1 0 1 1-2 0 1 1 0 0 1 2 0ZM9 9a.75.75 0 0 0 0 1.5h.25v3.25a.75.75 0 0 0 1.5 0V9.75A.75.75 0 0 0 10 9H9Z" clipRule="evenodd" />
                </svg>
            </button>
            <span
                id={tipId}
                role="tooltip"
                className={`absolute left-1/2 -translate-x-1/2 top-full mt-2 z-20 w-max max-w-[16rem] rounded-md bg-gray-900 px-3 py-2 text-sm font-normal text-white shadow-lg
                    ${shown ? "block" : "hidden"} group-hover:block group-focus-within:block`}
            >
                {text}
            </span>
        </span>
    );
}

export default function RentDriversSection({ metro = DFW_METRO, areaName = "DFW", rows }) {
    const [open, setOpen] = useState(false);
    const bodyId = useId();
    const cov = useFetchData();
    useEffect(() => {
        if (open) cov.handleFetch("data/dfw-zip-covariates", { metro });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [metro, open]);
    const covRows = cov.data && (cov.data.metro ?? DFW_METRO) === metro && Array.isArray(cov.data.rows) ? cov.data.rows : null;

    const [choice, setChoice] = useState("");

    // ZIP -> county and city, from the rent rows
    const zipInfo = useMemo(() => {
        const out = {};
        for (const r of rows ?? []) if (r.zip_code && !out[r.zip_code]) out[r.zip_code] = { county: r.county || "Other", city: r.City || "" };
        return out;
    }, [rows]);
    const counties = useMemo(() => [...new Set(Object.values(zipInfo).map((z) => z.county))].sort(), [zipInfo]);
    const options = counties;
    // The area shown: the viewer's pick, or the first option until they pick one
    const current = options.includes(choice) ? choice : options[0] ?? "";

    const inArea = (zip) => zipInfo[zip]?.county === current;

    // Each driver: the area's value (median of its ZIPs) and the metro's median
    const drivers = useMemo(() => {
        if (!covRows || !current) return [];
        return DRIVERS.map((d) => {
            const all = covRows.map((c) => num(c[d.key]));
            const area = covRows.filter((c) => inArea(String(c.zip_code).padStart(5, "0"))).map((c) => num(c[d.key]));
            return { ...d, area: median(area), metro: median(all) };
        }).filter((d) => d.area != null && d.metro != null);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [covRows, current, zipInfo]);

    // Rent context for the area, and the national mortgage rate, from the rent rows
    const context = useMemo(() => {
        const months = [...new Set((rows ?? []).filter((r) => Number.isFinite(num(r.zori_rent))).map((r) => r.month_year))].sort();
        const latest = months.at(-1);
        if (!latest) return null;
        const [y, m] = latest.split("-").map(Number);
        const yearAgo = `${y - 1}-${String(m).padStart(2, "0")}`;
        const now = {}, before = {};
        let rate = null, rateBefore = null;
        for (const r of rows ?? []) {
            const v = num(r.zori_rent);
            if (r.month_year === latest) { if (Number.isFinite(v) && inArea(r.zip_code)) now[r.zip_code] = v; if (Number.isFinite(num(r.mortgage_rate_30y))) rate = num(r.mortgage_rate_30y); }
            if (r.month_year === yearAgo) { if (Number.isFinite(v) && inArea(r.zip_code)) before[r.zip_code] = v; if (Number.isFinite(num(r.mortgage_rate_30y))) rateBefore = num(r.mortgage_rate_30y); }
        }
        const nowVals = Object.values(now);
        const paired = Object.keys(now).filter((z) => before[z]);
        const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
        return {
            latest,
            rent: nowVals.length ? mean(nowVals) : null,
            yoy: paired.length ? (mean(paired.map((z) => now[z])) / mean(paired.map((z) => before[z])) - 1) * 100 : null,
            rate, rateBefore,
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [rows, current, zipInfo]);

    if (!rows?.length) return null;
    const areaLabel = current;

    return (
        <section className="mb-6 bg-white border border-gray-200 rounded-lg" aria-labelledby="drivers-title">
            {/* Header: always visible. The title or the button opens and closes the details. */}
            <div className={`flex items-center justify-between gap-3 flex-wrap px-6 py-4 ${open ? "border-b border-gray-100" : ""}`}>
                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-controls={bodyId}
                            className="text-left rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
                            <span id="drivers-title" className="block text-xl font-bold text-gray-900">What drives rents { open && 'in ' + areaLabel}?</span>
                        </button>
                        <InfoTip text={UPDATE_NOTE} className="text-blue-700 hover:text-blue-900" />
                    </div>
                    <p className="mt-0.5 text-sm text-gray-600">
                        {open
                            ? "Compare a county with the metro on factors that published research links to rents."
                            : `${DRIVERS.length + 1} drivers from published research, compared by county.`}
                    </p>
                </div>
                <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-controls={bodyId}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border-2 border-blue-600 bg-blue-50 text-blue-800 text-base font-semibold hover:bg-blue-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 shrink-0">
                    {open ? "Hide drivers" : "Show drivers"}
                    <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"
                        className={`w-5 h-5 transition-transform ${open ? "rotate-180" : ""}`}>
                        <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.06l3.71-3.83a.75.75 0 1 1 1.08 1.04l-4.25 4.39a.75.75 0 0 1-1.08 0L5.21 8.27a.75.75 0 0 1 .02-1.06z" clipRule="evenodd" />
                    </svg>
                </button>
            </div>

            {open && (
                <div id={bodyId} className="px-6 py-5">
                    <div className="flex flex-wrap items-center justify-end gap-2">
                        <label htmlFor="drivers-county" className="text-sm font-semibold text-gray-600">County</label>
                        <select id="drivers-county" value={current} onChange={(e) => setChoice(e.target.value)}
                            className="border border-gray-300 bg-white rounded-md px-3 py-1.5 text-sm font-medium max-w-[16rem]">
                            {options.map((o) => (
                                <option key={o} value={o}>{o}</option>
                            ))}
                        </select>
                    </div>


                    {context?.rent != null && (
                        <p className="mt-4 text-base text-gray-800">
                            Typical rent in <b>{areaLabel}</b>: <b>{usd(context.rent)}</b> a month
                            {context.yoy != null ? <>, {context.yoy >= 0 ? "up" : "down"} <b>{Math.abs(context.yoy).toFixed(1)}%</b> from a year earlier</> : ""}.
                        </p>
                    )}

                    {cov.loading && !covRows && <p className="mt-4 text-sm text-blue-700 animate-pulse" role="status">Loading neighborhood data…</p>}
                    {cov.error && !covRows && (
                        <p className="mt-4 text-sm text-gray-500">
                            Neighborhood data isn't available right now.{" "}
                            <button onClick={() => cov.handleFetch("data/dfw-zip-covariates", { metro })} className="font-semibold underline text-gray-700">Try again</button>
                        </p>
                    )}

                    <ul className="mt-4 grid gap-4 md:grid-cols-2">
                        {drivers.map((d) => {
                            const c = compare(d.area, d.metro);
                            const chip = c === "higher" ? d.higher : c === "lower" ? d.lower : "About the same as the metro";
                            return (
                                <li key={d.key} className="border border-gray-200 rounded-lg p-4 bg-gray-50">
                                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                                        <h3 className="text-base font-semibold text-gray-900">{d.name}</h3>
                                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${c === "same" ? "bg-gray-200 text-gray-700" : "bg-blue-100 text-blue-800"}`}>{chip}</span>
                                    </div>
                                    <p className="mt-1 text-sm text-gray-700 tabular-nums">
                                        This county: <b>{d.format(d.area)}</b>
                                        <span className="text-gray-400"> · </span>Metro typical: {d.format(d.metro)}
                                    </p>
                                    <p className="mt-2 text-sm text-gray-600 leading-relaxed">{d.research}</p>
                                    <SourceLink source={d.source} />
                                </li>
                            );
                        })}
                        {context?.rate != null && (
                            <li className="border border-gray-200 rounded-lg p-4 bg-gray-50">
                                <div className="flex flex-wrap items-baseline justify-between gap-2">
                                    <h3 className="text-base font-semibold text-gray-900">{MORTGAGE.name}</h3>
                                    {context.rateBefore != null && (
                                        <span className="px-2 py-0.5 rounded text-xs font-medium bg-gray-200 text-gray-700">
                                            {context.rate > context.rateBefore + 0.1 ? "Up from a year ago" : context.rate < context.rateBefore - 0.1 ? "Down from a year ago" : "Similar to a year ago"}
                                        </span>
                                    )}
                                </div>
                                <p className="mt-1 text-sm text-gray-700 tabular-nums">
                                    Latest: <b>{context.rate.toFixed(2)}%</b>
                                    {context.rateBefore != null && <><span className="text-gray-400"> · </span>A year earlier: {context.rateBefore.toFixed(2)}%</>}
                                </p>
                                <p className="mt-2 text-sm text-gray-600 leading-relaxed">{MORTGAGE.research}</p>
                                <SourceLink source={MORTGAGE.source} />
                            </li>
                        )}
                    </ul>

                    <p className="mt-4 text-xs text-gray-500 leading-relaxed">
                        Neighborhood values are from the U.S. Census American Community Survey; rents are from Zillow. "Metro typical" is the median
                        across the metro's ZIP codes, and a county's value is the median of its ZIP codes. Research findings describe patterns across
                        many places; they explain what tends to matter, not the exact cause of rent changes in one area.
                    </p>
                </div>
            )}
        </section>
    );
}
