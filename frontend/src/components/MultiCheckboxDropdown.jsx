import React, { useState, useRef, useEffect } from 'react';

const MultiCheckboxDropdown = ({ label, options, selected, onToggle, onSelectAll, placeholder, emptyMessage }) => {
    const [open, setOpen] = useState(false);
    const containerRef = useRef(null);
    const allSelected = options.length > 0 && selected.length === options.length;
    const someSelected = selected.length > 0 && !allSelected;

    useEffect(() => {
        const handleClickOutside = (e) => {
            if (containerRef.current && !containerRef.current.contains(e.target)) {
                setOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const summary =
        selected.length === 0
            ? placeholder
            : selected.length === 1
                ? selected[0]
                : `${selected.length} selected`;

    return (
        <div className="flex flex-col w-48 relative" ref={containerRef}>
            <label className="text-sm text-gray-700 mb-1">{label}</label>

            <button
                type="button"
                onClick={() => setOpen((o) => !o)}
                className="w-full flex items-center justify-between px-3 py-2 border border-gray-300 rounded text-sm bg-white text-left"
            >
                <span className={`truncate ${selected.length === 0 ? "text-gray-400" : "text-gray-800"}`} title={summary}>
                    {summary}
                </span>
                <svg
                    className={`h-4 w-4 shrink-0 ml-2 text-gray-500 transition-transform ${open ? "rotate-180" : ""}`}
                    viewBox="0 0 20 20"
                    fill="currentColor"
                >
                    <path
                        fillRule="evenodd"
                        d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
                        clipRule="evenodd"
                    />
                </svg>
            </button>

            {open && (
                <div className="absolute z-10 top-full left-0 mt-1 w-full bg-white border border-gray-300 rounded shadow-lg max-h-48 overflow-y-auto p-2">
                    {options.length === 0 ? (
                        <p className="text-xs text-gray-400 px-1 py-1">{emptyMessage}</p>
                    ) : (
                        <>
                            <label className="flex items-center gap-2 py-1 px-1 rounded hover:bg-gray-50 cursor-pointer border-b border-gray-200 mb-1 pb-2 font-medium text-gray-700">
                                <input
                                    type="checkbox"
                                    checked={allSelected}
                                    ref={(el) => {
                                        if (el) el.indeterminate = someSelected;
                                    }}
                                    onChange={() => onSelectAll(allSelected)}
                                    className="h-4 w-4 accent-blue-500 shrink-0"
                                />
                                <span>Select All</span>
                            </label>
                            {options.map((col) => (
                            <label
                                key={col}
                                className="flex items-center gap-2 py-1 px-1 rounded hover:bg-gray-50 cursor-pointer"
                            >
                                <input
                                    type="checkbox"
                                    checked={selected.includes(col)}
                                    onChange={() => onToggle(col)}
                                    className="h-4 w-4 accent-blue-500 shrink-0"
                                />
                                    <span className="truncate" title={col}>{col}</span>
                                </label>
                            ))}
                        </>
                    )}
                </div>
            )}
        </div>
    );
};

export default MultiCheckboxDropdown;