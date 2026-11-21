import React from "react";
import { Link } from "react-router-dom";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";

// ===========================================================================
// Building blocks shared by the data-analysis screens (cross-sectional, time
// series, panel data, data cleanup): page header, the controls card, labelled
// fields, the CSV file input, action buttons and the raw data preview table.
// ===========================================================================

/** Full-width block with the page gutter and vertical rhythm used on every screen. */
export const Section = ({ children, sx }) => (
    <Box sx={[{ width: "100%", px: 2, my: 3 }, ...(Array.isArray(sx) ? sx : [sx])]}>{children}</Box>
);

/** Light blue title bar with an optional back link on the left and actions on the right. */
export function PageHeader({ title, backTo, onBack, actions }) {
    const backSx = { position: "absolute", left: 8, color: "gray.700", "&:hover": { color: "gray.900" } };
    return (
        <Paper elevation={1} sx={{ position: "relative", bgcolor: "blue.100", py: 1.5, borderRadius: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
            {onBack ? (
                <IconButton onClick={onBack} aria-label="Back" title="Back" sx={backSx}>
                    <ArrowBackIcon />
                </IconButton>
            ) : backTo && (
                <IconButton component={Link} to={backTo} aria-label="Back" sx={backSx}>
                    <ArrowBackIcon />
                </IconButton>
            )}
            <Typography variant="h2" sx={{ fontSize: "1.5rem", fontWeight: 600, color: "gray.800", textAlign: "center" }}>
                {title}
            </Typography>
            {actions && (
                <Box sx={{ position: "absolute", right: 16, display: "flex", alignItems: "center", gap: 1 }}>{actions}</Box>
            )}
        </Paper>
    );
}

/** Small white button used for "Guide Me" in page headers. */
export const HeaderButton = ({ children, ...props }) => (
    <Button
        size="small"
        sx={{ bgcolor: "common.white", color: "common.black", borderRadius: 2, boxShadow: 1, px: 1.5, "&:hover": { bgcolor: "gray.100" } }}
        {...props}
    >
        {children}
    </Button>
);

/** Bordered white card holding a screen's inputs and buttons, laid out in a centred wrapping row. */
export const ControlsCard = ({ children, sx }) => (
    <Paper
        elevation={1}
        sx={[
            { display: "flex", flexWrap: "wrap", justifyContent: "center", gap: 3, p: 3, border: 2, borderColor: "gray.300", borderRadius: 2, width: "100%", bgcolor: "common.white" },
            ...(Array.isArray(sx) ? sx : [sx]),
        ]}
    >
        {children}
    </Paper>
);

/** A label above a control, at a fixed width (192px unless given). */
export const Field = ({ label, width = 192, children }) => (
    <Box sx={{ display: "flex", flexDirection: "column", width }}>
        <Typography component="label" variant="body2" sx={{ color: "gray.700", mb: 0.5 }}>{label}</Typography>
        {children}
    </Box>
);

/** Native file picker styled to match the other inputs. */
export const FileInput = React.forwardRef(function FileInput({ sx, ...props }, ref) {
    return (
        <Box
            component="input"
            type="file"
            ref={ref}
            sx={[
                {
                    px: 1, py: "5px", border: 1, borderColor: "gray.300", borderRadius: 1, bgcolor: "common.white",
                    fontSize: "0.875rem", color: "gray.700", fontFamily: "inherit", boxShadow: 1, minWidth: 0,
                    "&:hover": { borderColor: "gray.400" },
                    "&:focus": { outline: "none", borderColor: "blue.400", boxShadow: (t) => `0 0 0 2px ${t.palette.blue[400]}` },
                },
                ...(Array.isArray(sx) ? sx : [sx]),
            ]}
            {...props}
        />
    );
});

/** Row of action buttons under the inputs. */
export const ButtonRow = ({ children, sx }) => (
    <Box sx={[{ width: "100%", display: "flex", flexWrap: "wrap", justifyContent: "center", gap: 2, mt: 3 }, ...(Array.isArray(sx) ? sx : [sx])]}>
        {children}
    </Box>
);

const actionTones = {
    primary: { bgcolor: "blue.500", color: "common.white", "&:hover": { bgcolor: "blue.600" } },
    secondary: { bgcolor: "gray.300", color: "gray.700", "&:hover": { bgcolor: "gray.400" } },
};

/** 160px-wide action button; greys out when disabled. */
export const ActionButton = ({ tone = "primary", sx, children, ...props }) => (
    <Button
        sx={[
            { width: 160, px: 2, py: 1, borderRadius: 1, fontWeight: 400, fontSize: "1rem", ...actionTones[tone], "&.Mui-disabled": { bgcolor: "gray.300", color: "gray.500" } },
            ...(Array.isArray(sx) ? sx : [sx]),
        ]}
        {...props}
    >
        {children}
    </Button>
);

/** Red note shown when a request fails. */
export const ErrorNote = ({ children, sx }) => (
    <Box sx={[{ width: "100%", textAlign: "center", color: "red.600", bgcolor: "red.50", p: 1, borderRadius: 1, mt: 2 }, ...(Array.isArray(sx) ? sx : [sx])]}>
        {children}
    </Box>
);

const noticeTones = {
    info: { bgcolor: "blue.50", borderColor: "blue.200", color: "blue.900" },
    success: { bgcolor: "green.50", borderColor: "green.200", color: "green.800" },
    saved: { bgcolor: "emerald.50", borderColor: "emerald.200", color: "emerald.900" },
    warning: { bgcolor: "amber.50", borderColor: "amber.200", color: "amber.900" },
    error: { bgcolor: "red.50", borderColor: "red.200", color: "red.800" },
};

/** Full-width coloured message box (info, success, saved, warning or error). */
export const Notice = ({ tone = "info", sx, children }) => (
    <Box sx={[{ width: "100%", fontSize: "0.875rem", border: 1, borderRadius: 1, px: 1.5, py: 1, ...noticeTones[tone] }, ...(Array.isArray(sx) ? sx : [sx])]}>
        {children}
    </Box>
);

/** Compact outlined button for use inside a Notice; `tone` picks the border and hover colour scale. */
export const NoticeButton = ({ tone = "red", sx, children, ...props }) => (
    <Button
        size="small"
        sx={[
            { px: 1, py: 0.5, minWidth: 0, fontSize: "0.75rem", fontWeight: 600, borderRadius: 1, border: 1, borderColor: `${tone}.300`, bgcolor: "common.white", color: "inherit", "&:hover": { bgcolor: `${tone}.100` } },
            ...(Array.isArray(sx) ? sx : [sx]),
        ]}
        {...props}
    >
        {children}
    </Button>
);

/** Right-aligned row, e.g. for a download button above a results table. */
export const EndRow = ({ children, sx }) => (
    <Box sx={[{ width: "100%", display: "flex", justifyContent: "flex-end" }, ...(Array.isArray(sx) ? sx : [sx])]}>{children}</Box>
);

/** First rows of an uploaded file as a plain bordered table. */
export function PreviewTable({ rows, limit = 20, sx }) {
    if (!rows?.length) return null;
    const cols = Object.keys(rows[0]);
    const cell = { px: 1.5, py: 1, border: 1, borderColor: "gray.300", textAlign: "left" };
    return (
        <Box sx={[{ overflowX: "auto", maxHeight: 500, mt: 3, px: 2 }, ...(Array.isArray(sx) ? sx : [sx])]}>
            <Box component="table" sx={{ minWidth: "100%", borderCollapse: "collapse", border: 1, borderColor: "gray.300", fontSize: "0.875rem" }}>
                <Box component="thead" sx={{ bgcolor: "gray.100" }}>
                    <tr>
                        {cols.map((col) => (
                            <Box component="th" key={col} sx={{ ...cell, fontWeight: 700 }}>{col}</Box>
                        ))}
                    </tr>
                </Box>
                <tbody>
                    {rows.slice(0, limit).map((row, i) => (
                        <Box component="tr" key={i} sx={{ "&:hover": { bgcolor: "gray.50" } }}>
                            {Object.keys(row).map((col) => (
                                <Box component="td" key={col} sx={cell}>{row[col]}</Box>
                            ))}
                        </Box>
                    ))}
                </tbody>
            </Box>
        </Box>
    );
}
