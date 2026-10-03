import React, { useEffect, useMemo, useState } from "react";
import { useFetchData } from "../../hooks/useFetchData";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";

const PHASE_BANDS = [
  { label: "Recession", min: 0, max: 20, color: "#dc2626" },
  { label: "Early Recovery", min: 20, max: 40, color: "#ea580c" },
  { label: "Mid-Cycle Expansion", min: 40, max: 60, color: "#ca8a04" },
  { label: "Late-Cycle Expansion", min: 60, max: 80, color: "#16a34a" },
  { label: "Overheating", min: 80, max: 100, color: "#2563eb" },
];

function phaseColor(phase) {
  return PHASE_BANDS.find((b) => b.label === phase)?.color || "#6b7280";
}

function CycleScoreGauge({ score }) {
  if (score == null) return null;
  return (
    <div className="relative h-4 rounded-full overflow-hidden flex">
      {PHASE_BANDS.map((b) => (
        <div key={b.label} style={{ width: `${b.max - b.min}%`, backgroundColor: b.color }} />
      ))}
      <div
        className="absolute top-[-4px] w-1 h-6 bg-black rounded"
        style={{ left: `calc(${Math.min(Math.max(score, 0), 100)}% - 2px)` }}
        title={`Cycle Score: ${score}`}
      />
    </div>
  );
}

function CycleScorePanel({ cycleScore }) {
  const [expanded, setExpanded] = useState(false);
  if (!cycleScore) return null;

  const {
    cycle_score, phase, indicators_used, indicators_in_methodology,
    coverage_note, missing_indicators = [], indicator_breakdown = [],
  } = cycleScore;

  return (
    <div className="mb-6 border border-gray-200 rounded-lg p-4 bg-white">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="text-xs uppercase tracking-wide text-gray-500">Cycle Score</div>
          <div className="flex items-baseline gap-2">
            <span className="text-4xl font-bold" style={{ color: phaseColor(phase) }}>
              {cycle_score ?? "—"}
            </span>
            <span className="text-sm text-gray-500">/ 100</span>
          </div>
          <div
            className="inline-block mt-1 px-2 py-0.5 rounded text-xs font-medium text-white"
            style={{ backgroundColor: phaseColor(phase) }}
          >
            {phase || "Unknown"}
          </div>
        </div>

        <div className="text-right text-sm text-gray-600">
          <div>
            Based on <span className="font-medium">{indicators_used}</span> of{" "}
            <span className="font-medium">{indicators_in_methodology}</span> methodology indicators
          </div>
          <button
            onClick={() => setExpanded((e) => !e)}
            className="text-blue-600 underline text-xs mt-1"
          >
            {expanded ? "Hide breakdown" : "Show breakdown"}
          </button>
        </div>
      </div>

      <div className="mt-4">
        <CycleScoreGauge score={cycle_score} />
        <div className="flex justify-between text-[10px] text-gray-500 mt-1">
          {PHASE_BANDS.map((b) => (
            <span key={b.label}>{b.label}</span>
          ))}
        </div>
      </div>

      {coverage_note && (
        <p className="text-xs text-gray-500 mt-3">{coverage_note}</p>
      )}

      {expanded && (
        <div className="mt-4 space-y-4">
          <div>
            <h4 className="text-sm font-semibold mb-2">Indicator Breakdown</h4>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-gray-50 text-left">
                    <th className="px-3 py-1.5 border-b">Indicator</th>
                    <th className="px-3 py-1.5 border-b text-right">Raw Value</th>
                    <th className="px-3 py-1.5 border-b text-center">Score (0–5)</th>
                    <th className="px-3 py-1.5 border-b">Note</th>
                  </tr>
                </thead>
                <tbody>
                  {indicator_breakdown.map((ind) => (
                    <tr key={ind.key} className="border-b last:border-b-0">
                      <td className="px-3 py-1.5">{ind.label}</td>
                      <td className="px-3 py-1.5 text-right font-mono">
                        {typeof ind.raw_value === "object"
                          ? JSON.stringify(ind.raw_value)
                          : ind.raw_value != null
                          ? Number(ind.raw_value).toFixed(2)
                          : "—"}
                      </td>
                      <td className="px-3 py-1.5 text-center">
                        <span
                          className="inline-block w-6 h-6 leading-6 rounded-full text-white text-xs font-medium"
                          style={{
                            backgroundColor:
                              ind.score >= 4 ? "#16a34a" : ind.score >= 2 ? "#ca8a04" : "#dc2626",
                          }}
                        >
                          {ind.score ?? "—"}
                        </span>
                      </td>
                      <td className="px-3 py-1.5 text-xs text-amber-700">{ind.note || ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {missing_indicators.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold mb-2">
                Excluded from Score ({missing_indicators.length})
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {missing_indicators.map((m) => (
                  <div key={m.key} className="border border-dashed border-gray-300 rounded p-2 text-xs">
                    <div className="font-medium">{m.label}</div>
                    <div className="text-gray-500 mt-0.5">{m.reason}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function MacroIndicatorsDashboard() {
  const { data, loading, error, handleFetch } = useFetchData();
  const [selectedKey, setSelectedKey] = useState(null);

  useEffect(() => {
    handleFetch("data/macro-indicators");
  }, []);

  const automated = data?.automated || {};
  const manualRequired = data?.manual_required || {};
  const failures = data?.failures || {};
  const cycleScore = data?.cycle_score || null;
  const automatedKeys = Object.keys(automated).filter((k) => k !== "credit_conditions_sloos");

  useEffect(() => {
    if (!selectedKey && automatedKeys.length > 0) setSelectedKey(automatedKeys[0]);
  }, [automatedKeys, selectedKey]);

  const chartData = useMemo(() => {
    if (!selectedKey || !automated[selectedKey]?.rows) return [];
    return automated[selectedKey].rows.map((r) => ({
      date: r.date,
      value: r[selectedKey] ?? r.value ?? r.zori ?? r.POP ?? r.UNITSA,
    }));
  }, [selectedKey, automated]);

  if (loading) return <div className="p-4 text-gray-500">Loading macro indicators…</div>;
  if (error) {
    return (
      <div className="p-4 text-red-600">
        {error}
        <button onClick={() => handleFetch("data/macro-indicators")} className="ml-3 underline">
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="p-4">
      <h2 className="text-lg font-semibold mb-1">Harvest Time Capital — Macro Indicators</h2>
      <p className="text-sm text-gray-500 mb-4">
        {automatedKeys.length} automated indicators · {Object.keys(manualRequired).length} require manual import
      </p>

      <CycleScorePanel cycleScore={cycleScore} />

      {Object.keys(failures).length > 0 && (
        <div className="mb-4 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
          Some sources failed to load: {Object.entries(failures).map(([k, msg]) => `${k} (${msg})`).join(", ")}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        <div className="lg:col-span-1 border border-gray-200 rounded overflow-hidden">
          {automatedKeys.map((key) => (
            <button
              key={key}
              onClick={() => setSelectedKey(key)}
              className={`w-full text-left px-3 py-2 text-sm border-b last:border-b-0 ${
                selectedKey === key ? "bg-blue-50 font-medium" : "hover:bg-gray-50"
              }`}
            >
              {automated[key].label}
              <div className="text-xs text-gray-400">{automated[key].source}</div>
            </button>
          ))}
        </div>

        <div className="lg:col-span-3 border border-gray-200 rounded p-4">
          {selectedKey && chartData.length > 0 ? (
            <>
              <h3 className="text-sm font-medium text-gray-700 mb-3">
                {automated[selectedKey].label}
              </h3>
              <ResponsiveContainer width="100%" height={320}>
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                  <YAxis />
                  <Tooltip />
                  <Line type="monotone" dataKey="value" stroke="#2563eb" dot={false} strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            </>
          ) : (
            <div className="text-sm text-gray-500">Select an indicator.</div>
          )}
        </div>
      </div>

      {automated.credit_conditions_sloos && (
        <div className="mt-4 border border-gray-200 rounded p-4">
          <h3 className="text-sm font-medium text-gray-700 mb-2">
            {automated.credit_conditions_sloos.label}
          </h3>
          <p className="text-sm text-gray-600 mb-2">
            Keyword mentions — tightened: {automated.credit_conditions_sloos.keyword_counts.tightened_mentions},
            {" "}eased: {automated.credit_conditions_sloos.keyword_counts.eased_mentions}
          </p>
          <p className="text-xs text-gray-400">{automated.credit_conditions_sloos.note}</p>
        </div>
      )}

      <div className="mt-6">
        <h3 className="text-sm font-semibold mb-2">Requires manual import (no free API)</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {Object.entries(manualRequired).map(([key, info]) => (
            <div key={key} className="border border-dashed border-gray-300 rounded p-3">
              <div className="font-medium text-sm">{info.label}</div>
              <div className="text-xs text-gray-500 mt-1">{info.reason}</div>
              <div className="text-xs text-blue-600 mt-1">
                Free proxy already tracked: {info.free_substitute_keys.join(", ")}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}