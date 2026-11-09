import React, { useEffect } from "react";
import { useFetchData } from "../hooks/useFetchData";
import { RentPreviewMap, RentPreviewChart } from "./RentPreviewVisuals";
import { DFW_METRO } from "./RentalProperty/useRentMetro";

// ===========================================================================
// Preview of the rental dashboard for the main dashboard: a text-free map and chart drawn
// from live data for one sample metro. Same API calls as the rental dashboard, so the
// backend's cached results are reused.
//
//   <ProductPreview />
// ===========================================================================

const SAMPLE_METRO = DFW_METRO;
// White card with a title, well under the category cards' size
const PANEL = "w-full max-w-[22rem] bg-white border border-gray-200 rounded-lg p-4 flex flex-col";

function Panel({ title, children }) {
    return (
        <div className={PANEL}>
            <h2 className="text-base font-semibold text-gray-800 text-center mb-3">{title}</h2>
            <div className="flex-1 flex items-center">{children}</div>
        </div>
    );
}

export default function ProductPreview() {
    const rent = useFetchData();
    const cov = useFetchData();

    useEffect(() => {
        rent.handleFetch("data/dfw-zori", { metro: SAMPLE_METRO });
        cov.handleFetch("data/dfw-zip-covariates", { metro: SAMPLE_METRO });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const rows = Array.isArray(rent.data?.rows) ? rent.data.rows : null;
    const covRows = Array.isArray(cov.data?.rows) ? cov.data.rows : null;

    // The preview is a bonus: if the rent data can't load, leave it out rather than show an error
    if (rent.error || (rows && rows.length === 0)) return null;
    // Without map locations, show the chart alone
    const showMap = !cov.error;

    const placeholder = <div className="w-full aspect-[5/4] rounded-lg bg-gray-100 animate-pulse" aria-hidden="true" />;

    return (
        <section className="w-full max-w-6xl mt-8 px-4" aria-labelledby="preview-heading">
            <p id="preview-heading" className="text-center text-base text-gray-600 max-w-2xl mx-auto mb-5">
                Explore rental prices across U.S. metro areas with interactive maps and charts.
            </p>
            <div className="flex flex-wrap justify-center items-stretch gap-6" aria-busy={!rows || (showMap && !covRows)}>
                {showMap && (
                    <Panel title="Map">
                        {rows && covRows ? <RentPreviewMap rows={rows} covariates={covRows} /> : placeholder}
                    </Panel>
                )}
                <Panel title="Charts">
                    {rows ? <RentPreviewChart rows={rows} /> : placeholder}
                </Panel>
            </div>
        </section>
    );
}
