import React, { useState } from "react";
import axios from "axios";
import { DFW_METRO, readSavedMetro } from "./useRentMetro";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";

// "attachment; filename="austin_tx_rent_panel_with_acs.csv"" -> the file name
const fileNameFrom = (header, fallback) => /filename="?([^";]+)"?/i.exec(header ?? "")?.[1] ?? fallback;

const RentalDataDownload = () => {
    // Same metro as the rental dashboard (from the viewer's location or their pick), else DFW
    const metro = readSavedMetro() || DFW_METRO;
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState(null);
    const [success, setSuccess] = useState(false);
    const [warning, setWarning] = useState(null);

    const handleDownload = async () => {
        setIsLoading(true);
        setError(null);
        setSuccess(false);
        setWarning(null);

        try {
            const token = localStorage.getItem("credential");

            const response = await axios.get(
                `${import.meta.env.VITE_API_URL}/api/data/rent-panel-with-acs`,
                {
                    headers: {
                        Authorization: `Bearer ${token}`,
                    },
                    params: { metro },
                    responseType: "blob",
                }
            );

            const url = window.URL.createObjectURL(new Blob([response.data]));
            const link = document.createElement("a");
            link.href = url;
            link.setAttribute("download", fileNameFrom(response.headers["content-disposition"], "rent_panel_with_acs.csv"));
            document.body.appendChild(link);
            link.click();
            link.remove();
            window.URL.revokeObjectURL(url);

            // Server lists sources that failed (e.g. "acs_2024, gazetteer"); those columns are blank
            const failed = response.headers["x-data-failures"];
            if (failed) {
                setWarning(`Some sources didn't load, so their columns are blank: ${failed}. Try again in a few minutes.`);
            }
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
        <Stack component="main" spacing={3} sx={{ alignItems: "center", mt: 8, px: 3, textAlign: "center" }}>
            <Typography variant="h1" sx={{ fontSize: "1.875rem", fontWeight: 700, color: "gray.800" }}>Rental Data Download</Typography>
            <Typography sx={{ color: "gray.600", maxWidth: 576 }}>
                Download the {metro} ZIP-code-level monthly rent panel (Zillow ZORI)
                with monthly macro indicators, merged with distance to downtown, income,
                renter share, density and new-construction data from the U.S. Census Bureau
                (American Community Survey).
            </Typography>

            <Button
                variant="contained"
                onClick={handleDownload}
                disabled={isLoading}
                startIcon={isLoading ? <CircularProgress size={16} color="inherit" /> : null}
                sx={{ px: 3, py: 1.5, borderRadius: 2, fontWeight: 500, bgcolor: "gray.800", "&:hover": { bgcolor: "gray.700" }, "&.Mui-disabled": { bgcolor: "gray.400", color: "common.white" } }}
            >
                {isLoading ? "Preparing data…" : "Download CSV"}
            </Button>

            {error && <Typography variant="body2" sx={{ color: "red.500" }}>{error}</Typography>}
            {warning && <Typography variant="body2" sx={{ color: "amber.600", maxWidth: 448 }}>{warning}</Typography>}
            {success && (
                <Typography variant="body2" sx={{ color: "green.600" }}>
                    Download complete — check your browser's downloads folder.
                </Typography>
            )}

            <Typography variant="caption" component="p" sx={{ color: "gray.400", maxWidth: 448 }}>
                This may take a few seconds while data is pulled live from the Census
                Bureau and merged on the server.
            </Typography>
        </Stack>
    );
};

export default RentalDataDownload;
