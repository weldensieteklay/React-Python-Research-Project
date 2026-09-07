import React, { useState } from "react";
import axios from "axios";

const RentalDataDownload = () => {
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState(null);
    const [success, setSuccess] = useState(false);

    const handleDownload = async () => {
        setIsLoading(true);
        setError(null);
        setSuccess(false);

        try {
            const token = localStorage.getItem("credential");

            const response = await axios.get(
                `${import.meta.env.VITE_API_URL}/api/data/rent-panel-with-acs`,
                {
                    headers: {
                        Authorization: `Bearer ${token}`,
                    },
                    responseType: "blob",
                }
            );

            const url = window.URL.createObjectURL(new Blob([response.data]));
            const link = document.createElement("a");
            link.href = url;
            link.setAttribute("download", "dfw_rent_panel_with_acs.csv");
            document.body.appendChild(link);
            link.click();
            link.remove();
            window.URL.revokeObjectURL(url);

            setSuccess(true);
        } catch (err) {
            console.error("Failed to download rental data:", err);
            setError(
                err.response?.status === 401
                    ? "Your session has expired. Please sign in again."
                    : "Something went wrong while preparing the data. Please try again."
            );
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <main className="flex flex-col items-center mt-16 px-6 text-center space-y-6">
            <h1 className="text-3xl font-bold text-gray-800">Rental Data Download</h1>
            <p className="text-gray-600 max-w-xl">
                Download the Dallas-Fort Worth zip-code-level rental price panel, merged
                with income, population, and housing demographic data from the U.S.
                Census Bureau (American Community Survey).
            </p>

            <button
                onClick={handleDownload}
                disabled={isLoading}
                className={`px-6 py-3 rounded-lg font-medium text-white transition-colors ${
                    isLoading
                        ? "bg-gray-400 cursor-not-allowed"
                        : "bg-gray-800 hover:bg-gray-700"
                }`}
            >
                {isLoading ? (
                    <span className="flex items-center gap-2">
                        <svg
                            className="animate-spin h-4 w-4 text-white"
                            xmlns="http://www.w3.org/2000/svg"
                            fill="none"
                            viewBox="0 0 24 24"
                        >
                            <circle
                                className="opacity-25"
                                cx="12"
                                cy="12"
                                r="10"
                                stroke="currentColor"
                                strokeWidth="4"
                            />
                            <path
                                className="opacity-75"
                                fill="currentColor"
                                d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
                            />
                        </svg>
                        Preparing data…
                    </span>
                ) : (
                    "Download CSV"
                )}
            </button>

            {error && <p className="text-sm text-red-500">{error}</p>}
            {success && (
                <p className="text-sm text-green-600">
                    Download complete — check your browser's downloads folder.
                </p>
            )}

            <p className="text-xs text-gray-400 max-w-md">
                This may take a few seconds while data is pulled live from the Census
                Bureau and merged on the server.
            </p>
        </main>
    );
};

export default RentalDataDownload;
