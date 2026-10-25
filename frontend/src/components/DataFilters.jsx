import React, { useMemo } from "react";
import Select from "react-select";

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

const selectStyles = { menuPortal: (base) => ({ ...base, zIndex: 50 }) };

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
    <div className="w-full border border-gray-200 rounded-lg bg-gray-50 px-4 py-3">
      <div className="flex items-center justify-between mb-2">
        <div className="text-sm font-semibold text-gray-800">
          Filter data
          {matchCount != null && (
            <span className="ml-2 font-normal text-gray-500">
              {matchCount.toLocaleString()} of {rows.length.toLocaleString()} rows
            </span>
          )}
        </div>
        {activeFilterCount(filters) > 0 && (
          <button className="text-xs font-semibold text-blue-700 hover:underline" onClick={() => onChange(EMPTY_FILTERS)}>
            Clear filters
          </button>
        )}
      </div>

      <div className="space-y-2">
        {conditions.map((c, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <Select
              className="w-48 text-sm"
              placeholder="Column"
              options={columnOptions.filter((o) => o.value === c.column || !usedColumns.has(o.value))}
              value={c.column ? { value: c.column, label: label(c.column) } : null}
              onChange={(o) => updateCondition(i, { column: o.value, values: [] })}
              menuPortalTarget={typeof document !== "undefined" ? document.body : null}
              styles={selectStyles}
            />
            <span className="text-xs text-gray-500">is one of</span>
            <Select
              isMulti
              className="flex-1 min-w-[220px] text-sm"
              placeholder={c.column ? "Choose values" : "Pick a column first"}
              isDisabled={!c.column}
              options={valueOptions[c.column] ?? []}
              value={(c.values ?? []).map((v) => ({ value: v, label: v }))}
              onChange={(opts) => updateCondition(i, { values: (opts ?? []).map((o) => o.value) })}
              closeMenuOnSelect={false}
              menuPortalTarget={typeof document !== "undefined" ? document.body : null}
              styles={selectStyles}
            />
            <button
              className="text-gray-400 hover:text-red-600 text-lg leading-none px-1"
              title="Remove filter"
              onClick={() => setConditions(conditions.filter((_, j) => j !== i))}
            >
              ×
            </button>
          </div>
        ))}

        <div className="flex flex-wrap items-center gap-3">
          <button
            className="text-sm font-medium text-blue-700 hover:underline disabled:text-gray-400 disabled:no-underline"
            disabled={usedColumns.size >= columnOptions.length}
            onClick={() => setConditions([...conditions, { column: "", values: [] }])}
          >
            + Add filter
          </button>

          {dateColumn && dateOptions.length > 0 && (
            <div className="flex items-center gap-2 text-sm">
              <span className="text-gray-500">{label(dateColumn)} from</span>
              <Select
                className="w-36"
                isClearable
                placeholder="Start"
                options={dateOptions}
                value={filters?.start ? { value: filters.start, label: filters.start } : null}
                onChange={(o) => onChange({ ...filters, start: o?.value || "" })}
                menuPortalTarget={typeof document !== "undefined" ? document.body : null}
                styles={selectStyles}
              />
              <span className="text-gray-500">to</span>
              <Select
                className="w-36"
                isClearable
                placeholder="End"
                options={dateOptions}
                value={filters?.end ? { value: filters.end, label: filters.end } : null}
                onChange={(o) => onChange({ ...filters, end: o?.value || "" })}
                menuPortalTarget={typeof document !== "undefined" ? document.body : null}
                styles={selectStyles}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
