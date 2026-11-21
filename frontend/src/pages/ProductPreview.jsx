import React, { useEffect } from "react";
import { useFetchData } from "../hooks/useFetchData";
import { RentPreviewZipMap, RentPreviewCountyChart } from "./RentPreviewVisuals";
import { DFW_METRO } from "./RentalProperty/useRentMetro";
import Box from "@mui/material/Box";
import CircularProgress from "@mui/material/CircularProgress";
import Typography from "@mui/material/Typography";
import { BRAND, srOnly } from "../theme";

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
        <Box component="figure" sx={{ m: 0 }}>
            <Box sx={{ bgcolor: "gray.50", border: 1, borderColor: "gray.200", borderRadius: 2, p: 1.5, display: "flex", alignItems: "center", justifyContent: "center", minHeight: "12rem" }}>
                {children}
            </Box>
            <Typography component="figcaption" variant="body2" sx={{ mt: 1, color: "gray.600", textAlign: "center" }}>{caption}</Typography>
        </Box>
    );
}

/** Spinner and label filling a panel while its data loads (decorative; the status line below is read out) */
function Loading({ label }) {
    return (
        <Box sx={{ width: "100%", aspectRatio: "5 / 3", borderRadius: 1.5, bgcolor: "gray.100", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 1.5 }} aria-hidden="true">
            <CircularProgress size={32} sx={{ color: BRAND }} />
            <Typography component="span" variant="body2" sx={{ fontWeight: 500, color: "gray.600" }}>{label}</Typography>
        </Box>
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
        <Box sx={{ display: "grid", gap: 2.5, gridTemplateColumns: { md: "repeat(2, minmax(0, 1fr))" } }} aria-busy={!metro}>
            {/* One announcement for screen readers while loading */}
            <Box component="p" role="status" sx={srOnly}>{metro ? "" : "Loading the rent map and chart…"}</Box>
            <Panel caption="Rent by ZIP code">
                {metro ? <RentPreviewZipMap metro={metro} /> : <Loading label="Loading rent map…" />}
            </Panel>
            <Panel caption="Rent over time by county">
                {metro ? <RentPreviewCountyChart metro={metro} /> : <Loading label="Loading rent chart…" />}
            </Panel>
        </Box>
    );
}