import React, { useEffect, useMemo } from "react";
import { useFetchData } from "../../hooks/useFetchData";
import { interpretDivergence } from "./interpretDivergence";

// ===========================================================================
// Short, plain-language version of the Boom Divergence report for the dashboard.
// Shows the takeaway and the top findings, with a link to the full report.
//
//   <BoomDivergenceSummary onOpenReport={() => setPage("research")} />
//
// Uses the same request as the full report's default view (with Census factors,
// not by year), so the backend's cached result is reused.
// ===========================================================================

const PATH = "data/dfw-rent-divergence?spec=full&event_study=false";
const MAX_FINDINGS = 2;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const shortMonth = (ym) => {
  const [y, m] = String(ym ?? "").split("-").map(Number);
  return y && m ? `${MONTHS[m - 1]} ${y}` : "";
};

function MoreLink({ onClick, children = "Want more details? See the full report →" }) {
  return (
    <button onClick={onClick} className="text-base font-semibold text-blue-700 hover:text-blue-900 hover:underline">
      {children}
    </button>
  );
}

export default function BoomDivergenceSummary({ onOpenReport }) {
  const { data, loading, error, handleFetch } = useFetchData();
  useEffect(() => { handleFetch(PATH); }, []);

  const report = useMemo(() => (data?.coefficients?.length ? interpretDivergence(data, { focus: "pooled" }) : null), [data]);
  const findings = useMemo(
    () => (report?.sections?.find((s) => s.heading === "What we found")?.items ?? []).filter((x) => typeof x === "string").slice(0, MAX_FINDINGS),
    [report]
  );

  return (
    <section className="mb-6 bg-white border border-gray-200 rounded-lg px-6 py-5" aria-labelledby="boom-summary-title">
      <h2 id="boom-summary-title" className="text-xl font-bold text-gray-900 mt-1">
        Did the 2021–22 rent boom end the same way everywhere in DFW?
      </h2>

      {loading && (
        <div className="mt-3 space-y-2 animate-pulse" aria-label="Loading the summary">
          <div className="h-4 bg-gray-100 rounded w-3/4" />
          <div className="h-3 bg-gray-100 rounded w-full" />
          <div className="h-3 bg-gray-100 rounded w-5/6" />
        </div>
      )}

      {!loading && (error || (data && !report)) && (
        <div className="mt-2 text-base text-gray-500">
          The summary isn't available right now.{" "}
          <button onClick={() => handleFetch(PATH)} className="font-semibold underline text-gray-700">Try again</button>
          <span className="mx-2 text-gray-300">|</span>
          <MoreLink onClick={onOpenReport}>Open the full report →</MoreLink>
        </div>
      )}

      {!loading && !error && report && (
        <>
          <p className="mt-3 text-lg leading-relaxed text-gray-900 font-medium">{report.verdict?.text}</p>
          {findings.length > 0 && (
            <ul className="mt-3 space-y-2 list-disc pl-5 marker:text-gray-300">
              {findings.map((f) => <li key={f} className="text-base text-gray-700 leading-relaxed">{f}</li>)}
            </ul>
          )}
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
            <MoreLink onClick={onOpenReport} />
            {data?.n_zips && (
              <span className="text-sm text-gray-500">
                Based on monthly Zillow rents for {data.n_zips} ZIP codes{data.panel?.window?.[1] ? ` through ${shortMonth(data.panel.window[1])}` : ""} and U.S. Census data.
              </span>
            )}
          </div>
        </>
      )}
    </section>
  );
}
