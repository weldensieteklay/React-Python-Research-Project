import { createTheme } from "@mui/material/styles";

// Brand blue used by the navbar, footer and primary actions
export const BRAND = "#0071CE";
export const BRAND_DARK = "#005fae";

// Colour scales the app was designed with. Each one is registered on the palette below, so
// `sx` can refer to a shade by name, e.g. `color: "gray.600"` or `bgcolor: "emerald.50"`.
export const scales = {
    gray: { 50: "#f9fafb", 100: "#f3f4f6", 200: "#e5e7eb", 300: "#d1d5db", 400: "#9ca3af", 500: "#6b7280", 600: "#4b5563", 700: "#374151", 800: "#1f2937", 900: "#111827", 950: "#030712" },
    blue: { 50: "#eff6ff", 100: "#dbeafe", 200: "#bfdbfe", 300: "#93c5fd", 400: "#60a5fa", 500: "#3b82f6", 600: "#2563eb", 700: "#1d4ed8", 800: "#1e40af", 900: "#1e3a8a", 950: "#172554" },
    red: { 50: "#fef2f2", 100: "#fee2e2", 200: "#fecaca", 300: "#fca5a5", 400: "#f87171", 500: "#ef4444", 600: "#dc2626", 700: "#b91c1c", 800: "#991b1b", 900: "#7f1d1d", 950: "#450a0a" },
    green: { 50: "#f0fdf4", 100: "#dcfce7", 200: "#bbf7d0", 300: "#86efac", 400: "#4ade80", 500: "#22c55e", 600: "#16a34a", 700: "#15803d", 800: "#166534", 900: "#14532d", 950: "#052e16" },
    emerald: { 50: "#ecfdf5", 100: "#d1fae5", 200: "#a7f3d0", 300: "#6ee7b7", 400: "#34d399", 500: "#10b981", 600: "#059669", 700: "#047857", 800: "#065f46", 900: "#064e3b", 950: "#022c22" },
    amber: { 50: "#fffbeb", 100: "#fef3c7", 200: "#fde68a", 300: "#fcd34d", 400: "#fbbf24", 500: "#f59e0b", 600: "#d97706", 700: "#b45309", 800: "#92400e", 900: "#78350f", 950: "#451a03" },
    yellow: { 50: "#fefce8", 100: "#fef9c3", 200: "#fef08a", 300: "#fde047", 400: "#facc15", 500: "#eab308", 600: "#ca8a04", 700: "#a16207", 800: "#854d0e", 900: "#713f12", 950: "#422006" },
    orange: { 50: "#fff7ed", 100: "#ffedd5", 200: "#fed7aa", 300: "#fdba74", 400: "#fb923c", 500: "#f97316", 600: "#ea580c", 700: "#c2410c", 800: "#9a3412", 900: "#7c2d12", 950: "#431407" },
    sky: { 50: "#f0f9ff", 100: "#e0f2fe", 200: "#bae6fd", 300: "#7dd3fc", 400: "#38bdf8", 500: "#0ea5e9", 600: "#0284c7", 700: "#0369a1", 800: "#075985", 900: "#0c4a6e", 950: "#082f49" },
    violet: { 50: "#f5f3ff", 100: "#ede9fe", 200: "#ddd6fe", 300: "#c4b5fd", 400: "#a78bfa", 500: "#8b5cf6", 600: "#7c3aed", 700: "#6d28d9", 800: "#5b21b6", 900: "#4c1d95", 950: "#2e1065" },
};

const theme = createTheme({
    palette: {
        primary: { main: BRAND, dark: BRAND_DARK },
        success: { main: scales.emerald[600], dark: scales.emerald[700] },
        error: { main: scales.red[600] },
        warning: { main: scales.amber[500] },
        text: { primary: scales.gray[900], secondary: scales.gray[600] },
        divider: scales.gray[200],
        background: { default: "#ffffff" },
        ...scales,
    },
    // Same widths the layout was built against (sm 640, md 768, lg 1024, xl 1280)
    breakpoints: { values: { xs: 0, sm: 640, md: 768, lg: 1024, xl: 1280 } },
    typography: {
        fontFamily: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
        button: { textTransform: "none", fontWeight: 500 },
    },
    shape: { borderRadius: 6 },
    components: {
        MuiButton: { defaultProps: { disableElevation: true } },
        MuiTypography: { defaultProps: { variant: "body1" } },
        MuiTableCell: { styleOverrides: { root: { borderColor: scales.gray[200] } } },
    },
});

export default theme;

// Hides content visually while keeping it available to screen readers
export const srOnly = {
    position: "absolute", width: "1px", height: "1px", p: 0, m: "-1px", overflow: "hidden",
    clip: "rect(0, 0, 0, 0)", whiteSpace: "nowrap", border: 0,
};

// Slow fade in and out for "Loading…" text
export const pulse = {
    animation: "pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite",
    "@keyframes pulse": { "50%": { opacity: 0.5 } },
};
