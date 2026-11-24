import React, { useState } from "react";
import { dashboardRoute } from "../constants/constants";
import { useNavigate } from "react-router-dom";
import { useUser } from "../hooks/useUser";
import GuidePanel from "../guideMe/GuidePanel";
import { guideContent } from "../guideMe/Guidecontent";
import ProductPreview from "./ProductPreview";
import Avatar from "@mui/material/Avatar";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import { BRAND, BRAND_DARK } from "../theme";

// Emails allowed to see the Real Estate Dashboard card.
// Keep this in sync with the allowlist in AppRoutes.jsx.
const RENTAL_DATA_ALLOWED_EMAILS = ["weldensieteklay@gmail.com", 'zereyesus@gmail.com'];

// The route shown as the large card, with the map and chart preview inside it
const FEATURED_KEY = "downloadRentalData";

// One short line under each card title, keyed like dashboardRoute
const DESCRIPTIONS = {
    downloadRentalData: "ZIP-level rents, maps, forecasts and research for every U.S. metro.",
    realEstateData: "Macroeconomic indicators and the real estate cycle score.",
};

// Fixed width shared by the button and the dropdown so they line up
const MENU_WIDTH = 224;

function UserMenu({ user, onLogout }) {
    const [anchorEl, setAnchorEl] = useState(null);
    const open = Boolean(anchorEl);

    const name = user?.given_name || user?.name || "there";
    const initial = name.charAt(0).toUpperCase();

    return (
        <Box sx={{ position: "relative", width: MENU_WIDTH }}>
            <Button
                onClick={(e) => setAnchorEl(open ? null : e.currentTarget)}
                aria-haspopup="menu"
                aria-expanded={open}
                fullWidth
                sx={{ justifyContent: "flex-start", gap: 1.5, bgcolor: "common.white", color: "inherit", borderRadius: 2, boxShadow: 3, pl: 1, pr: 1.5, py: 1, transition: "box-shadow 150ms", "&:hover": { bgcolor: "common.white", boxShadow: 6 } }}
            >
                <Avatar sx={{ width: 36, height: 36, bgcolor: "gray.200", color: "gray.700", fontWeight: 600, fontSize: "1rem" }} aria-hidden="true">
                    {initial}
                </Avatar>
                <Typography noWrap sx={{ flex: 1, minWidth: 0, textAlign: "left", fontSize: "0.875rem", fontWeight: 600, color: "gray.800" }}>{name}</Typography>
                <KeyboardArrowDownIcon sx={{ flexShrink: 0, color: "gray.500", transition: "transform 150ms", transform: open ? "rotate(180deg)" : "none" }} />
            </Button>

            <Menu
                anchorEl={anchorEl}
                open={open}
                onClose={() => setAnchorEl(null)}
                anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
                transformOrigin={{ vertical: "top", horizontal: "left" }}
                slotProps={{ paper: { sx: { width: MENU_WIDTH, mt: 1, borderRadius: 2, border: 1, borderColor: "gray.100" } } }}
            >
                <Typography noWrap variant="caption" component="p" title={user?.email} sx={{ px: 2, pb: 1, color: "gray.500", borderBottom: 1, borderColor: "gray.100" }}>
                    {user?.email}
                </Typography>
                <MenuItem onClick={onLogout} sx={{ mt: 0.5, fontSize: "0.875rem", fontWeight: 500, color: "red.600", "&:hover": { bgcolor: "red.50" } }}>
                    Log out
                </MenuItem>
            </Menu>
        </Box>
    );
}

const Dashboard = () => {
    const navigate = useNavigate();
    const { user, clearUser } = useUser();
    const [showGuide, setShowGuide] = useState(false);

    const onLogoutClick = () => {
        clearUser();
        navigate("/");
    };

    const visibleRoutes = dashboardRoute
        .map((item) => {
            const key = Object.keys(item)[0];
            return { key, ...item[key] };
        })
        .filter(({ key }) => key !== "realEstateData" || RENTAL_DATA_ALLOWED_EMAILS.includes(user?.email));
    const featured = visibleRoutes.find((r) => r.key === FEATURED_KEY);
    const others = visibleRoutes.filter((r) => r.key !== FEATURED_KEY);

    const cardSx = { bgcolor: "common.white", borderRadius: 3, boxShadow: 3, border: 1, borderColor: "gray.100" };

    return (
        <Box sx={{ minHeight: "100vh", bgcolor: "#E8EEF5" }}>
            {/* Top right: user menu */}
            <Box sx={{ position: "absolute", right: 24, display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 1.5, zIndex: 10 }}>
                <UserMenu user={user} onLogout={onLogoutClick} />
                {/* Guide panel — renders inline below the controls, no overlay */}
                <GuidePanel
                    open={showGuide}
                    onClose={() => setShowGuide(false)}
                    content={guideContent.dashboard}
                />
            </Box>

            <Box component="main" sx={{ display: "flex", flexDirection: "column", alignItems: "center", pt: "88px", pb: 14, px: 2 }}>
                {/* Welcome */}
                <Box sx={{ textAlign: "center", mb: 2 }}>
                    <Typography variant="h1" sx={{ fontSize: { xs: "1.875rem", sm: "2.25rem" }, fontWeight: 700, color: "gray.900" }}>
                        Welcome to your dashboard
                    </Typography>
                    <Typography sx={{ mt: 1.5, fontSize: "1.125rem", color: "gray.600" }}>
                        Analyze the latest rental market insights.
                    </Typography>
                </Box>

                <Box sx={{ width: "100%", maxWidth: 1280, display: "flex", flexDirection: "column", gap: 3 }}>
                    {featured && (
                        <Paper
                            component="section"
                            elevation={0}
                            sx={{ ...cardSx, p: { xs: 3, sm: 4 } }}
                            aria-labelledby="featured-title"
                        >
                            <Box sx={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 2, mb: 3 }}>
                                <div>
                                    <Typography variant="h2" id="featured-title" sx={{ fontSize: "1.5rem", fontWeight: 700, color: "gray.900" }}>
                                        {featured.title}
                                    </Typography>
                                    <Typography sx={{ mt: 0.5, color: "gray.600" }}>
                                        {DESCRIPTIONS[featured.key]}
                                    </Typography>
                                </div>
                                <Button
                                    variant="contained"
                                    onClick={() => navigate(featured.route)}
                                    sx={{ px: 2.5, py: 1.25, borderRadius: 2, bgcolor: BRAND, fontSize: "1rem", fontWeight: 600, "&:hover": { bgcolor: BRAND_DARK } }}
                                >
                                    Open dashboard
                                </Button>
                            </Box>
                            <ProductPreview />
                        </Paper>
                    )}

                    {others.length > 0 && (
                        <Box sx={{ display: "grid", gap: 3, gridTemplateColumns: others.length > 1 ? { md: "repeat(2, minmax(0, 1fr))" } : undefined }}>
                            {others.map(({ key, title, route }) => (
                                <Paper
                                    key={key}
                                    component="section"
                                    elevation={0}
                                    sx={{ ...cardSx, p: 3, display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 2 }}
                                >
                                    <div>
                                        <Typography variant="h2" sx={{ fontSize: "1.25rem", fontWeight: 700, color: "gray.900" }}>{title}</Typography>
                                        {DESCRIPTIONS[key] && (
                                            <Typography sx={{ mt: 0.5, color: "gray.600" }}>
                                                {DESCRIPTIONS[key]}
                                            </Typography>
                                        )}
                                    </div>
                                    <Button
                                        variant="outlined"
                                        onClick={() => navigate(route)}
                                        sx={{ px: 2.5, py: 1.25, borderRadius: 2, borderWidth: 2, borderColor: BRAND, color: BRAND, fontSize: "1rem", fontWeight: 600, "&:hover": { borderWidth: 2, bgcolor: "blue.50" } }}
                                    >
                                        Open dashboard
                                    </Button>
                                </Paper>
                            ))}
                        </Box>
                    )}
                </Box>
            </Box>

        </Box>
    );
};

export default Dashboard;
