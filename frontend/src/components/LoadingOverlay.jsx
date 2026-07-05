import React from "react";

const LoadingOverlay = ({
    show = true,
    title = "Loading...",
    subtitle = "Please wait"
}) => {
    if (!show) return null;

    return (
        <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50">
            <div className="bg-white p-8 rounded-lg shadow-lg flex flex-col items-center gap-4 min-w-[250px]">

                {/* Spinner */}
                <div className="w-14 h-14 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>

                {/* Title */}
                <div className="text-xl font-semibold text-gray-800 text-center">
                    {title}
                </div>

                {/* Subtitle */}
                <div className="text-sm text-gray-500 text-center">
                    {subtitle}
                </div>

            </div>
        </div>
    );
};

export default LoadingOverlay;