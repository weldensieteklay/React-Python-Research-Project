import React, { useEffect, useMemo } from "react";
import { useFetchData } from "../../hooks/useFetchData";
import { interpretDivergence } from "./interpretDivergence";
import { DFW_METRO } from "./useRentMetro";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Link from "@mui/material/Link";
import Paper from "@mui/material/Paper";
import Skeleton from "@mui/material/Skeleton";
import Typography from "@mui/material/Typography";

// ===========================================================================
// Short, plain-language version of the Boom Divergence report for the dashboard.
// Shows the takeaway and the top findings, with a link to the full report.
//
//   <BoomDivergenceSummary metro={metro} areaName="DFW" onOpenReport={() => setPage("research")} />
//
// Works for any metro. Uses the same request as the full report's default view (with Census
// factors, not by year), so the backend's cached result is reused. A metro with too few
// ZIP codes for the model gets a plain explanation instead of results.
// ===========================================================================

const pathFor = (metro) => `data/dfw-rent-divergence?spec=full&event_study=false&metro=${encodeURIComponent(metro)}`;
const MAX_FINDINGS = 2;

function MoreLink({ onClick, children = "Want more details? See the full report →" }) {
  return (
    <Link component="button" onClick={onClick} underline="hover" sx={{ fontSize: "1rem", fontWeight: 600, color: "blue.700", "&:hover": { color: "blue.900" } }}>
      {children}
    </Link>
  );
}

export default function BoomDivergenceSummary({ metro = DFW_METRO, areaName = "DFW", onOpenReport }) {
  const { data: response, loading, error, handleFetch } = useFetchData();
  const path = pathFor(metro);
  useEffect(() => { handleFetch(path); }, [path]);

  // Only a response for the metro shown now (a slow one for the previous metro is ignored)
  const data = response && (response.metro ?? DFW_METRO) === metro ? response : null;
  const unavailable = data?.available === false;
  const hasResults = Boolean(data?.coefficients?.length || data?.descriptive?.overall);
  const report = useMemo(() => (hasResults ? interpretDivergence(data, { focus: "pooled" }) : null), [data, hasResults]);
  // Smaller metros get a lighter analysis; say so up front
  const tierLabel = { simplified: "Simplified analysis", descriptive: "Direct comparison, no model" }[data?.tier];
  const findings = useMemo(
    () => (report?.sections?.find((s) => s.heading === "What we found")?.items ?? []).filter((x) => typeof x === "string").slice(0, MAX_FINDINGS),
    [report]
  );

  return (
    <Paper component="section" variant="outlined" sx={{ mb: 3, borderColor: "gray.200", borderRadius: 2, px: 3, py: 2.5 }} aria-labelledby="boom-summary-title">
      <Typography variant="h2" id="boom-summary-title" sx={{ fontSize: "1.25rem", fontWeight: 700, color: "gray.900", mt: 0.5 }}>
        Did the 2021–22 rent boom end the same way everywhere in {areaName}?
      </Typography>

      {(loading || (!data && !error)) && (
        <Box sx={{ mt: 1.5 }} role="status" aria-live="polite">
          <Box sx={{ display: "flex", alignItems: "center", gap: 1, fontSize: "0.875rem", fontWeight: 500, color: "blue.700" }}>
            <CircularProgress size={16} color="inherit" aria-hidden="true" />
            Loading the summary…
          </Box>
          <Box sx={{ mt: 1.5, display: "flex", flexDirection: "column", gap: 1 }} aria-hidden="true">
            <Skeleton variant="rounded" height={16} width="75%" />
            <Skeleton variant="rounded" height={12} width="100%" />
            <Skeleton variant="rounded" height={12} width="83%" />
          </Box>
        </Box>
      )}

      {!loading && unavailable && (
        <Typography sx={{ mt: 1, color: "gray.600" }}>
          {data.reason} The map, charts and data grid below still cover every ZIP code in this metro.
        </Typography>
      )}

      {!loading && !unavailable && (error || (data && !report)) && (
        <Box sx={{ mt: 1, color: "gray.500" }}>
          The summary isn't available right now.{" "}
          <Button variant="text" disableRipple onClick={() => handleFetch(path)} sx={{ p: 0, minWidth: 0, fontSize: "inherit", fontWeight: 600, textDecoration: "underline", color: "gray.700", verticalAlign: "baseline", "&:hover": { bgcolor: "transparent", textDecoration: "underline" } }}>Try again</Button>
          <Box component="span" sx={{ mx: 1, color: "gray.300" }}>|</Box>
          <MoreLink onClick={onOpenReport}>Open the full report →</MoreLink>
        </Box>
      )}

      {!loading && !error && report && (
        <>
          {tierLabel && (
            <Box component="p" sx={{ mt: 1, mb: 0 }}>
              <Box component="span" sx={{ display: "inline-block", px: 1, py: 0.25, borderRadius: 1, bgcolor: "amber.50", color: "amber.800", fontSize: "0.875rem", fontWeight: 500 }}>
                {tierLabel} · {data.n_zips} ZIP codes
              </Box>
            </Box>
          )}
          <Typography sx={{ mt: 1.5, fontSize: "1.125rem", lineHeight: 1.625, color: "gray.900", fontWeight: 500 }}>{report.verdict?.text}</Typography>
          {findings.length > 0 && (
            <Box component="ul" sx={{ mt: 1.5, mb: 0, listStyle: "disc", pl: 2.5, "& > li + li": { mt: 1 }, "& li::marker": { color: "gray.300" } }}>
              {findings.map((f) => <Box component="li" key={f} sx={{ color: "gray.700", lineHeight: 1.625 }}>{f}</Box>)}
            </Box>
          )}
          <Box sx={{ mt: 2, display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 1 }}>
            <MoreLink onClick={onOpenReport} />
          </Box>
        </>
      )}
    </Paper>
  );
}
