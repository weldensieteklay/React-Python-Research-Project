import React from "react";

/** Top-left "←" back button used on every full-screen page. */
export default function BackButton({ onClick, label = "Back" }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      className="shrink-0 inline-flex items-center justify-center w-10 h-10 -ml-2 rounded-full text-2xl leading-none text-gray-700 hover:bg-gray-200 hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
    >
      ←
    </button>
  );
}
