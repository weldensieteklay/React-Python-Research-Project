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
// Renders nothing if the data can't load, so the card still works without it.
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

export default function ProductPreview() {
    const preview = useFetchData();

    useEffect(() => {
        preview.handleFetch("data/rent-preview-metros", { metro: SAMPLE_METRO });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const metro = Array.isArray(preview.data?.metros) ? preview.data.metros[0] ?? null : undefined;

    // The preview is a bonus: if the data can't load, leave it out rather than show an error
    if (preview.error || metro === null) return null;
    const placeholder = <div className="w-full aspect-[5/3] rounded-md bg-gray-200/70 animate-pulse" aria-hidden="true" />;

    return (
        <div className="grid gap-5 md:grid-cols-2" aria-busy={!metro}>
            <Panel caption="Rent by ZIP code">
                {metro ? <RentPreviewZipMap metro={metro} /> : placeholder}
            </Panel>
            <Panel caption="Rent over time by county">
                {metro ? <RentPreviewCountyChart metro={metro} /> : placeholder}
            </Panel>
        </div>
    );
}
