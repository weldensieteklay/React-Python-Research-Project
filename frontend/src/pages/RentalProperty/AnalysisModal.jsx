import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

// ===========================================================================
// Reusable modal for analysis write-ups.
//
//   <AnalysisModal open={open} onClose={close} report={report} />
//
// report = {
//   title, subtitle?,
//   verdict?: { tone: "positive" | "mixed" | "caution" | "neutral", text },
//   sections: [{ heading, items: [ "plain text" | { label?, text, badge?: {label, tone}, detail? } ] }]
// }
// Optional: copyText (string) enables a "Copy summary" button; children render below the sections.
// Closes on Escape, backdrop click and the close button; returns focus to whatever opened it.
// ===========================================================================

const VERDICT_STYLES = {
  positive: "bg-emerald-50 border-emerald-200 text-emerald-950",
  mixed: "bg-amber-50 border-amber-200 text-amber-950",
  caution: "bg-amber-50 border-amber-200 text-amber-950",
  neutral: "bg-gray-50 border-gray-200 text-gray-900",
};

const BADGE_STYLES = {
  positive: "bg-emerald-100 text-emerald-800",
  caution: "bg-amber-100 text-amber-800",
  negative: "bg-red-100 text-red-800",
  neutral: "bg-gray-100 text-gray-600",
};

function Item({ item }) {
  if (typeof item === "string") return <li className="text-sm text-gray-700 leading-relaxed">{item}</li>;
  return (
    <li className="text-sm text-gray-700 leading-relaxed">
      {(item.label || item.badge) && (
        <div className="flex flex-wrap items-center gap-2 mb-0.5">
          {item.label && <span className="font-semibold text-gray-900">{item.label}</span>}
          {item.badge && (
            <span className={`px-2 py-0.5 rounded text-xs font-medium ${BADGE_STYLES[item.badge.tone] || BADGE_STYLES.neutral}`}>
              {item.badge.label}
            </span>
          )}
        </div>
      )}
      <div>{item.text}</div>
      {item.detail && <div className="text-xs text-gray-400 tabular-nums mt-0.5">{item.detail}</div>}
    </li>
  );
}

export default function AnalysisModal({ open, onClose, report, copyText, children }) {
  const dialogRef = useRef(null);
  const closeRef = useRef(null);
  const openerRef = useRef(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) return undefined;
    openerRef.current = typeof document !== "undefined" ? document.activeElement : null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();

    const onKey = (e) => {
      if (e.key === "Escape") { e.stopPropagation(); onClose?.(); return; }
      if (e.key !== "Tab" || !dialogRef.current) return;
      // keep keyboard focus inside the dialog
      const nodes = dialogRef.current.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
      if (!nodes.length) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      openerRef.current?.focus?.();
    };
  }, [open, onClose]);

  useEffect(() => { if (!open) setCopied(false); }, [open]);

  if (!open || !report || typeof document === "undefined") return null;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(copyText);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-gray-900/40" onClick={onClose} aria-hidden="true" />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="analysis-modal-title"
        className="relative bg-white rounded-xl shadow-xl w-full max-w-3xl max-h-[90vh] flex flex-col"
      >
        <div className="flex items-start justify-between gap-4 px-6 pt-5 pb-3 border-b border-gray-100">
          <div>
            <h2 id="analysis-modal-title" className="text-lg font-bold text-gray-900">{report.title}</h2>
            {report.subtitle && <p className="text-sm text-gray-500 mt-0.5">{report.subtitle}</p>}
          </div>
          <button ref={closeRef} onClick={onClose} aria-label="Close"
                  className="text-gray-400 hover:text-gray-700 text-2xl leading-none px-1 -mt-1">
            ×
          </button>
        </div>

        <div className="overflow-y-auto px-6 py-4 space-y-5">
          {report.verdict?.text && (
            <div className={`border rounded-lg px-4 py-3 ${VERDICT_STYLES[report.verdict.tone] || VERDICT_STYLES.neutral}`}>
              <div className="text-xs font-semibold uppercase tracking-wider opacity-70 mb-0.5">Takeaway</div>
              <div className="text-sm font-medium leading-relaxed">{report.verdict.text}</div>
            </div>
          )}

          {(report.sections ?? []).filter((s) => s.items?.length).map((s) => (
            <section key={s.heading}>
              <h3 className="text-sm font-bold text-gray-800 mb-2">{s.heading}</h3>
              <ul className="space-y-2.5 list-disc pl-5 marker:text-gray-300">
                {s.items.map((it, i) => <Item key={i} item={it} />)}
              </ul>
            </section>
          ))}

          {children}
        </div>

        <div className="flex items-center justify-end gap-2 px-6 py-3 border-t border-gray-100">
          {copyText && (
            <button onClick={handleCopy}
                    className="px-3 py-1.5 text-sm font-semibold rounded-md border border-gray-300 bg-white text-gray-700 hover:bg-gray-50">
              {copied ? "Copied ✓" : "📋 Copy summary"}
            </button>
          )}
          <button onClick={onClose} className="px-4 py-1.5 text-sm font-semibold rounded-md bg-gray-800 text-white hover:bg-gray-700">
            Close
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
