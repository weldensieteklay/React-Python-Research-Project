import React, { useEffect, useMemo, useState } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import Box from "@mui/material/Box";
import NativeSelect from "@mui/material/NativeSelect";
import OutlinedInput from "@mui/material/OutlinedInput";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";

const cardSx = { borderColor: "gray.200", borderRadius: 2, p: 3 };

// ===========================================================================
// One ZIP code's rent over time (actual + forecast), with a ZIP picker grouped by county.
//
//   <RentByZipChart rows={gridRows} />
// ===========================================================================

const ACTUAL = "#059669";
const FORECAST = "#d97706";
const toNum = (v) => (v == null || v === "" ? NaN : Number(v));   // missing rent must not become $0
const usd = (v) => (v == null || !Number.isFinite(v) ? "—" : `$${Math.round(v).toLocaleString()}`);

export default function RentByZipChart({ rows, height = 400 }) {
  // ZIPs grouped by county for the dropdown: { county: [{ zip, city }] }
  const zipsByCounty = useMemo(() => {
    const seen = {};
    for (const r of rows ?? []) if (r.zip_code && !seen[r.zip_code]) seen[r.zip_code] = { zip: r.zip_code, city: r.City, county: r.county || "Other" };
    const groups = {};
    for (const z of Object.values(seen)) (groups[z.county] ||= []).push(z);
    for (const list of Object.values(groups)) list.sort((a, b) => a.zip.localeCompare(b.zip));
    return Object.fromEntries(Object.entries(groups).sort(([a], [b]) => a.localeCompare(b)));
  }, [rows]);
  const allZips = useMemo(() => Object.values(zipsByCounty).flat(), [zipsByCounty]);

  const [zip, setZip] = useState("");
  useEffect(() => { if (!zip || !allZips.some((z) => z.zip === zip)) setZip(allZips[0]?.zip ?? ""); }, [allZips, zip]);
  const info = allZips.find((z) => z.zip === zip);

  const points = useMemo(() => {
    const list = (rows ?? [])
      .filter((r) => r.zip_code === zip && Number.isFinite(toNum(r.zori_rent)))
      .sort((a, b) => a.month_year.localeCompare(b.month_year))
      .map((r) => ({
        month: r.month_year,
        actual_rent: r.is_forecast ? null : Math.round(r.zori_rent),
        forecast_rent: r.is_forecast ? Math.round(r.zori_rent) : null,
      }));
    // Start the dashed forecast line at the last actual month so the two lines join
    const last = list.map((p) => p.actual_rent != null).lastIndexOf(true);
    if (last >= 0 && list.slice(last + 1).some((p) => p.forecast_rent != null)) {
      list[last] = { ...list[last], forecast_rent: list[last].actual_rent };
    }
    return list;
  }, [rows, zip]);

  const hasForecast = points.some((p, i) => p.forecast_rent != null && points[i].actual_rent == null);
  const latest = [...points].reverse().find((p) => p.actual_rent != null);

  if (!allZips.length) return <Paper variant="outlined" sx={{ ...cardSx, fontSize: "0.875rem", color: "gray.400" }}>No ZIP data to chart.</Paper>;

  return (
    <Paper variant="outlined" sx={cardSx}>
      <Box sx={{ display: "flex", flexDirection: { xs: "column", md: "row" }, alignItems: { md: "flex-start" }, justifyContent: "space-between", gap: 1.5, mb: 2 }}>
        <div>
          <Typography variant="h3" sx={{ fontSize: "1.125rem", fontWeight: 700, color: "gray.800" }}>
            Rent over time: ZIP {zip}{info?.city ? ` (${info.city})` : ""}
          </Typography>
          <Typography variant="caption" component="p" sx={{ color: "gray.400", mt: 0.25 }}>
            Typical monthly rent from Zillow{latest ? `; ${usd(latest.actual_rent)} in ${latest.month}` : ""}.
            {hasForecast ? " The dashed line is the forecast." : ""}
          </Typography>
        </div>
        <Box component="label" sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
          <Box component="span" sx={{ fontSize: "0.75rem", fontWeight: 600, color: "gray.500", textTransform: "uppercase", letterSpacing: "0.05em" }}>ZIP code:</Box>
          <NativeSelect value={zip} onChange={(e) => setZip(e.target.value)}
                        input={<OutlinedInput size="small" />}
                        sx={{ bgcolor: "common.white", fontSize: "0.875rem", fontWeight: 500, "& .MuiNativeSelect-select": { py: 0.75, pl: 1.5 } }}>
            {Object.entries(zipsByCounty).map(([county, list]) => (
              <optgroup key={county} label={county}>
                {list.map((z) => <option key={z.zip} value={z.zip}>{z.zip}{z.city ? ` – ${z.city}` : ""}</option>)}
              </optgroup>
            ))}
          </NativeSelect>
        </Box>
      </Box>

      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={points} margin={{ top: 10, right: 30, bottom: 10, left: 10 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis dataKey="month" stroke="#6b7280" tick={{ fontSize: 13 }} minTickGap={24} />
          <YAxis tickFormatter={(v) => `$${v.toLocaleString()}`} stroke="#6b7280" tick={{ fontSize: 13 }} domain={["auto", "auto"]} />
          <Tooltip formatter={(v, name) => [usd(v), name]} />
          <Legend />
          <Line type="monotone" dataKey="actual_rent" name="Rent (Zillow)" stroke={ACTUAL} strokeWidth={3} dot={false} connectNulls />
          {hasForecast && (
            <Line type="monotone" dataKey="forecast_rent" name="Forecast" stroke={FORECAST} strokeWidth={3} strokeDasharray="5 5" dot={{ r: 3, fill: FORECAST }} connectNulls />
          )}
        </LineChart>
      </ResponsiveContainer>
    </Paper>
  );
}
