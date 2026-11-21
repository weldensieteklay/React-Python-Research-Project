import React, { useMemo } from "react";
import Select from "react-select";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import Typography from "@mui/material/Typography";

// ===========================================================================
// Row filtering shared by the forecast screen (PanelData) and the Data Explorer.
//   filters = { conditions: [{ column, values: [] }], start: "", end: "" }
// A condition keeps rows whose column value is one of `values`. start/end bound
// the date column (inclusive). Empty conditions and empty bounds are ignored.
// ===========================================================================

export const EMPTY_FILTERS = { conditions: [], start: "", end: "" };

const toComparable = (v) => {
  const s = String(v ?? "").trim();
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : s;   // dates compare by time, anything else as text
};

export function applyFilters(rows, filters, dateColumn) {
  if (!Array.isArray(rows)) return [];
  const conds = (filters?.conditions ?? [])
    .filter((c) => c.column && c.values?.length)
    .map((c) => [c.column, new Set(c.values.map(String))]);
  const start = dateColumn && filters?.start ? toComparable(filters.start) : null;
  const end = dateColumn && filters?.end ? toComparable(filters.end) : null;
  if (!conds.length && start == null && end == null) return rows;

  return rows.filter((r) => {
    for (const [col, set] of conds) if (!set.has(String(r[col]))) return false;
    if (start != null || end != null) {
      const d = toComparable(r[dateColumn]);
      if (start != null && d < start) return false;
      if (end != null && d > end) return false;
    }
    return true;
  });
}

/** Stable text form of the active filters, e.g. for deciding whether two model runs are comparable. */
export function filtersSignature(filters) {
  const conds = (filters?.conditions ?? [])
    .filter((c) => c.column && c.values?.length)
    .map((c) => `${c.column}=${[...c.values].map(String).sort().join("+")}`)
    .sort();
  return [...conds, `from=${filters?.start || ""}`, `to=${filters?.end || ""}`].join(";");
}

export const activeFilterCount = (filters) =>
  (filters?.conditions ?? []).filter((c) => c.column && c.values?.length).length +
  (filters?.start ? 1 : 0) + (filters?.end ? 1 : 0);

/** Columns worth filtering on: categories, IDs, dates and whole numbers (years, months)
 *  with few enough distinct values to pick from. Decimal measures (rates, rents) are left
 *  out; picking exact values of those isn't a useful filter. */
export function filterableColumns(rows, columns, maxDistinct = 400) {
  return columns.filter((col) => {
    const seen = new Set();
    for (const r of rows) {
      const v = r[col];
      if (v === null || v === undefined || v === "") continue;
      if (typeof v === "number" && !Number.isInteger(v)) return false;
      seen.add(v);
      if (seen.size > maxDistinct) return false;
    }
    return seen.size > 1;
  });
}

const uniqueSorted = (rows, col) => {
  const vals = new Set();
  for (const r of rows) {
    const v = r[col];
    if (v !== null && v !== undefined && v !== "") vals.add(String(v));
  }
  return [...vals].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
};

// Menus sit above MUI dialogs (zIndex 1300)
const menuPortal = (base) => ({ ...base, zIndex: 1500 });
const sized = (container) => ({ menuPortal, container: (base) => ({ ...base, fontSize: "0.875rem", ...container }) });
const columnSelectStyles = sized({ width: 192 });
const valuesSelectStyles = sized({ flex: 1, minWidth: 220 });
const dateSelectStyles = sized({ width: 144 });

const linkButtonSx = { p: 0, minWidth: 0, fontWeight: 600, color: "blue.700", "&:hover": { bgcolor: "transparent", textDecoration: "underline" } };

export default function DataFilters({
  rows,
  filters,
  onChange,
  columns,               // columns offered as filters
  dateColumn = "",       // enables the date range
  labels = {},           // optional { column: "Nice name" }
  matchCount = null,     // rows left after filtering, shown next to the total
}) {
  const label = (c) => labels[c] || c;
  const conditions = filters?.conditions ?? [];

  const valueOptions = useMemo(() => {
    const out = {};
    for (const c of conditions) {
      if (c.column && !out[c.column]) out[c.column] = uniqueSorted(rows, c.column).map((v) => ({ value: v, label: v }));
    }
    return out;
  }, [rows, conditions]);

  const dateOptions = useMemo(
    () => (dateColumn ? uniqueSorted(rows, dateColumn).map((v) => ({ value: v, label: v })) : []),
    [rows, dateColumn]
  );

  const usedColumns = new Set(conditions.map((c) => c.column));
  const columnOptions = columns.filter((c) => c !== dateColumn).map((c) => ({ value: c, label: label(c) }));

  const setConditions = (next) => onChange({ ...filters, conditions: next });
  const updateCondition = (i, patch) => setConditions(conditions.map((c, j) => (j === i ? { ...c, ...patch } : c)));

  return (
    <Box sx={{ width: "100%", border: 1, borderColor: "gray.200", borderRadius: 2, bgcolor: "gray.50", px: 2, py: 1.5 }}>
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 1 }}>
        <Typography variant="body2" sx={{ fontWeight: 600, color: "gray.800" }}>
          Filter data
          {matchCount != null && (
            <Box component="span" sx={{ ml: 1, fontWeight: 400, color: "gray.500" }}>
              {matchCount.toLocaleString()} of {rows.length.toLocaleString()} rows
            </Box>
          )}
        </Typography>
        {activeFilterCount(filters) > 0 && (
          <Button size="small" disableRipple sx={{ ...linkButtonSx, fontSize: "0.75rem" }} onClick={() => onChange(EMPTY_FILTERS)}>
            Clear filters
          </Button>
        )}
      </Box>

      <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
        {conditions.map((c, i) => (
          <Box key={i} sx={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 1 }}>
            <Select
              placeholder="Column"
              options={columnOptions.filter((o) => o.value === c.column || !usedColumns.has(o.value))}
              value={c.column ? { value: c.column, label: label(c.column) } : null}
              onChange={(o) => updateCondition(i, { column: o.value, values: [] })}
              menuPortalTarget={typeof document !== "undefined" ? document.body : null}
              styles={columnSelectStyles}
            />
            <Typography variant="caption" sx={{ color: "gray.500" }}>is one of</Typography>
            <Select
              isMulti
              placeholder={c.column ? "Choose values" : "Pick a column first"}
              isDisabled={!c.column}
              options={valueOptions[c.column] ?? []}
              value={(c.values ?? []).map((v) => ({ value: v, label: v }))}
              onChange={(opts) => updateCondition(i, { values: (opts ?? []).map((o) => o.value) })}
              closeMenuOnSelect={false}
              menuPortalTarget={typeof document !== "undefined" ? document.body : null}
              styles={valuesSelectStyles}
            />
            <IconButton
              size="small"
              title="Remove filter"
              aria-label="Remove filter"
              sx={{ color: "gray.400", fontSize: "1.125rem", lineHeight: 1, px: 0.5, "&:hover": { color: "red.600" } }}
              onClick={() => setConditions(conditions.filter((_, j) => j !== i))}
            >
              ×
            </IconButton>
          </Box>
        ))}

        <Box sx={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 1.5 }}>
          <Button
            disableRipple
            sx={{ ...linkButtonSx, fontSize: "0.875rem", fontWeight: 500, "&.Mui-disabled": { color: "gray.400" } }}
            disabled={usedColumns.size >= columnOptions.length}
            onClick={() => setConditions([...conditions, { column: "", values: [] }])}
          >
            + Add filter
          </Button>

          {dateColumn && dateOptions.length > 0 && (
            <Box sx={{ display: "flex", alignItems: "center", gap: 1, fontSize: "0.875rem" }}>
              <Box component="span" sx={{ color: "gray.500" }}>{label(dateColumn)} from</Box>
              <Select
                isClearable
                placeholder="Start"
                options={dateOptions}
                value={filters?.start ? { value: filters.start, label: filters.start } : null}
                onChange={(o) => onChange({ ...filters, start: o?.value || "" })}
                menuPortalTarget={typeof document !== "undefined" ? document.body : null}
                styles={dateSelectStyles}
              />
              <Box component="span" sx={{ color: "gray.500" }}>to</Box>
              <Select
                isClearable
                placeholder="End"
                options={dateOptions}
                value={filters?.end ? { value: filters.end, label: filters.end } : null}
                onChange={(o) => onChange({ ...filters, end: o?.value || "" })}
                menuPortalTarget={typeof document !== "undefined" ? document.body : null}
                styles={dateSelectStyles}
              />
            </Box>
          )}
        </Box>
      </Box>
    </Box>
  );
}
