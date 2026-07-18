import React, { useState, useEffect } from "react";
import { XMarkIcon, ChevronLeftIcon, ChevronRightIcon } from "@heroicons/react/24/solid";

/**
 * Generic "Guide Me" modal. Pass in page-specific `content` and it renders
 * a step-by-step walkthrough with Back/Next navigation, as a modal overlay.
 *
 * content shape:
 * {
 *   title: "Welcome to the Dashboard",
 *   steps: [
 *     { heading: "Step heading", description: "Step body text..." },
 *     ...
 *   ]
 * }
 *
 * Usage:
 *   const [showGuide, setShowGuide] = useState(false);
 *   <button onClick={() => setShowGuide(true)}>Guide Me</button>
 *   <GuidePanel open={showGuide} onClose={() => setShowGuide(false)} content={guideContent.dashboard} />
 */
const GuidePanel = ({ open, onClose, content }) => {
    const [stepIndex, setStepIndex] = useState(0);

    useEffect(() => {
        if (open) setStepIndex(0);
    }, [open]);

    if (!open || !content) return null;

    const { title, steps } = content;
    const step = steps[stepIndex];
    const isFirst = stepIndex === 0;
    const isLast = stepIndex === steps.length - 1;

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
            onClick={onClose}
        >
            <div
                className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[85vh] flex flex-col overflow-hidden"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header (fixed) */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 shrink-0">
                    <h3 className="text-lg font-semibold text-gray-800">{title}</h3>
                    <button
                        onClick={onClose}
                        className="text-gray-400 hover:text-gray-600"
                        aria-label="Close guide"
                    >
                        <XMarkIcon className="h-5 w-5" />
                    </button>
                </div>

                {/* Body (scrollable) */}
                <div className="px-6 py-6 overflow-y-auto grow min-h-[160px]">
                    <p className="text-sm font-semibold text-blue-600 mb-2">
                        {step.heading}
                    </p>
                    <p className="text-sm text-gray-600 leading-relaxed whitespace-pre-line">
                        {step.description}
                    </p>
                </div>

                {/* Footer (fixed) */}
                <div className="flex items-center justify-between px-6 py-4 border-t border-gray-100 bg-gray-50 shrink-0">
                    {/* Progress dots */}
                    <div className="flex gap-1.5">
                        {steps.map((_, i) => (
                            <span
                                key={i}
                                className={`h-1.5 rounded-full transition-all ${i === stepIndex ? "w-6 bg-blue-600" : "w-1.5 bg-gray-300"
                                    }`}
                            />
                        ))}
                    </div>

                    <div className="flex gap-2">
                        <button
                            onClick={() => setStepIndex((i) => Math.max(0, i - 1))}
                            disabled={isFirst}
                            className={`flex items-center gap-1 px-3 py-1.5 text-sm rounded-md ${isFirst
                                    ? "text-gray-300 cursor-not-allowed"
                                    : "text-gray-600 hover:bg-gray-200"
                                }`}
                        >
                            <ChevronLeftIcon className="h-4 w-4" />
                            Back
                        </button>

                        {isLast ? (
                            <button
                                onClick={onClose}
                                className="px-4 py-1.5 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700"
                            >
                                Got it
                            </button>
                        ) : (
                            <button
                                onClick={() => setStepIndex((i) => Math.min(steps.length - 1, i + 1))}
                                className="flex items-center gap-1 px-4 py-1.5 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700"
                            >
                                Next
                                <ChevronRightIcon className="h-4 w-4" />
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default GuidePanel;
