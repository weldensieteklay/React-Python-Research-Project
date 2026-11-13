import React, { useEffect } from "react";
import { useFetchData } from "../hooks/useFetchData";
import { RentPreviewZipMap, RentPreviewCountyChart } from "./RentPreviewVisuals";
import { DFW_METRO } from "./RentalProperty/useRentMetro";

// ===========================================================================
// The map and chart shown inside the Rental Dashboard card on the main dashboard, drawn from
// live data for one sample metro (data/rent-preview-metros): a ZIP-level rent map, and the
// average rent over time in its four largest counties.
//
//   <ProductPreview />
//
// While the data loads, each panel shows a spinner with a label, at the size the map and chart
// will take, so the card doesn't jump. Renders nothing if the data can't load, so the card
// still works without it.
// ===========================================================================

const SAMPLE_METRO = DFW_METRO;

function Panel({ caption, children }) {
    return (
        <figure className="m-0">
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 flex items-center justify-center min-h-[12rem]">
                {children}
            </div>
            <figcaption className="mt-2 text-sm text-gray-600 text-center">{caption}</figcaption>
        </figure>
    );
}

/** Spinner and label filling a panel while its data loads (decorative; the status line below is read out) */
function Loading({ label }) {
    return (
        <div className="w-full aspect-[5/3] rounded-md bg-gray-100 flex flex-col items-center justify-center gap-3" aria-hidden="true">
            <svg className="animate-spin h-8 w-8 text-[#0071CE]" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 0 1 8-8v4a4 4 0 0 0-4 4H4z" />
            </svg>
            <span className="text-sm font-medium text-gray-600">{label}</span>
        </div>
    );
}

export default function ProductPreview() {
    const preview = useFetchData();

    useEffect(() => {
        preview.handleFetch("data/rent-preview-metros", { metro: SAMPLE_METRO });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const metro = Array.isArray(preview.data?.metros) ? preview.data.metros[0] ?? null : undefined;

    // The preview is a bonus: if the data can't load, leave it out rather than show an error
    if (preview.error || metro === null) return null;

    return (
        <div className="grid gap-5 md:grid-cols-2" aria-busy={!metro}>
            {/* One announcement for screen readers while loading */}
            <p role="status" className="sr-only">{metro ? "" : "Loading the rent map and chart…"}</p>
            <Panel caption="Rent by ZIP code">
                {metro ? <RentPreviewZipMap metro={metro} /> : <Loading label="Loading rent map…" />}
            </Panel>
            <Panel caption="Rent over time by county">
                {metro ? <RentPreviewCountyChart metro={metro} /> : <Loading label="Loading rent chart…" />}
            </Panel>
        </div>
    );
}
