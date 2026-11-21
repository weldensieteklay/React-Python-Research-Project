import React from "react";
import Backdrop from "@mui/material/Backdrop";
import CircularProgress from "@mui/material/CircularProgress";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";

const LoadingOverlay = ({
    show = true,
    title = "Loading...",
    subtitle = "Please wait"
}) => {
    if (!show) return null;

    return (
        <Backdrop open sx={{ zIndex: (theme) => theme.zIndex.modal, bgcolor: "rgba(0,0,0,0.4)" }}>
            <Paper elevation={8} sx={{ p: 4, borderRadius: 2, display: "flex", flexDirection: "column", alignItems: "center", gap: 2, minWidth: 250 }}>
                <CircularProgress size={56} thickness={4} sx={{ color: "blue.500" }} />
                <Typography sx={{ fontSize: "1.25rem", fontWeight: 600, color: "gray.800", textAlign: "center" }}>
                    {title}
                </Typography>
                <Typography variant="body2" sx={{ color: "gray.500", textAlign: "center" }}>
                    {subtitle}
                </Typography>
            </Paper>
        </Backdrop>
    );
};

export default LoadingOverlay;
