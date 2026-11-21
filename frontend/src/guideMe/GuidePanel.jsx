import React, { useState, useEffect } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import IconButton from "@mui/material/IconButton";
import Typography from "@mui/material/Typography";
import CloseIcon from "@mui/icons-material/Close";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
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

    const primarySx = { px: 2, py: 0.75, fontSize: "0.875rem", bgcolor: "blue.600", "&:hover": { bgcolor: "blue.700" } };

    return (
        <Dialog
            open
            onClose={onClose}
            fullWidth
            maxWidth={false}
            slotProps={{
                backdrop: { sx: { bgcolor: "rgba(0,0,0,0.4)" } },
                paper: { sx: { maxWidth: 512, maxHeight: "85vh", m: 2, borderRadius: 3, boxShadow: 12 } },
            }}
        >
            {/* Header (fixed) */}
            <DialogTitle sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", px: 3, py: 2, borderBottom: 1, borderColor: "gray.100" }}>
                <Typography component="span" sx={{ fontSize: "1.125rem", fontWeight: 600, color: "gray.800" }}>{title}</Typography>
                <IconButton onClick={onClose} aria-label="Close guide" size="small" sx={{ color: "gray.400", "&:hover": { color: "gray.600" } }}>
                    <CloseIcon fontSize="small" />
                </IconButton>
            </DialogTitle>

            {/* Body (scrollable) */}
            <DialogContent sx={{ px: 3, py: 3, minHeight: 160 }}>
                <Typography variant="body2" sx={{ fontWeight: 600, color: "blue.600", mb: 1 }}>
                    {step.heading}
                </Typography>
                <Typography variant="body2" sx={{ color: "gray.600", lineHeight: 1.625, whiteSpace: "pre-line" }}>
                    {step.description}
                </Typography>
            </DialogContent>

            {/* Footer (fixed) */}
            <DialogActions sx={{ justifyContent: "space-between", px: 3, py: 2, borderTop: 1, borderColor: "gray.100", bgcolor: "gray.50" }}>
                {/* Progress dots */}
                <Box sx={{ display: "flex", gap: 0.75 }}>
                    {steps.map((_, i) => (
                        <Box
                            component="span"
                            key={i}
                            sx={{ height: 6, borderRadius: 999, transition: "all 150ms", width: i === stepIndex ? 24 : 6, bgcolor: i === stepIndex ? "blue.600" : "gray.300" }}
                        />
                    ))}
                </Box>

                <Box sx={{ display: "flex", gap: 1 }}>
                    <Button
                        onClick={() => setStepIndex((i) => Math.max(0, i - 1))}
                        disabled={isFirst}
                        startIcon={<ChevronLeftIcon fontSize="small" />}
                        sx={{ px: 1.5, py: 0.75, fontSize: "0.875rem", fontWeight: 400, color: "gray.600", "&:hover": { bgcolor: "gray.200" }, "&.Mui-disabled": { color: "gray.300" } }}
                    >
                        Back
                    </Button>

                    {isLast ? (
                        <Button variant="contained" onClick={onClose} sx={primarySx}>
                            Got it
                        </Button>
                    ) : (
                        <Button
                            variant="contained"
                            onClick={() => setStepIndex((i) => Math.min(steps.length - 1, i + 1))}
                            endIcon={<ChevronRightIcon fontSize="small" />}
                            sx={primarySx}
                        >
                            Next
                        </Button>
                    )}
                </Box>
            </DialogActions>
        </Dialog>
    );
};

export default GuidePanel;
