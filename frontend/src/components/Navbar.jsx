import React from 'react';
import { Link } from 'react-router-dom';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Typography from '@mui/material/Typography';
import HomeIcon from '@mui/icons-material/Home';
import { useUser } from '../hooks/useUser';
import { BRAND } from '../theme';

/** EconWebCast mark: rising bars with a trend line, drawn white-on-blue for the blue navbar. */
const LogoIcon = () => (
    <svg viewBox="0 0 32 32" width="32" height="32" style={{ flexShrink: 0 }} aria-hidden="true">
        <rect width="32" height="32" rx="8" fill="#FFFFFF" />
        <rect x="7" y="17" width="4" height="8" rx="1" fill="#0071CE" fillOpacity="0.55" />
        <rect x="14" y="13" width="4" height="12" rx="1" fill="#0071CE" fillOpacity="0.75" />
        <rect x="21" y="9" width="4" height="16" rx="1" fill="#0071CE" />
        <path d="M6 14 L13 10 L19 11.5 L26 6" fill="none" stroke="#00A3E0" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
);

const focusRing = { outline: "none", "&:focus-visible": { boxShadow: "0 0 0 2px #fff" } };

const Navbar = () => {
    const { user } = useUser();

    return (
        <Box
            component="nav"
            sx={{ width: "100%", bgcolor: BRAND, borderBottom: 1, borderColor: "sky.700", px: 2, py: 1.5, color: "common.white", display: "flex", alignItems: "center", justifyContent: "space-between" }}
        >
            {/* Logo and name, left-aligned; leads to the dashboard when signed in, else the sign-in page */}
            <Box
                component={Link}
                to={user ? "/dashboard" : "/"}
                sx={{ display: "flex", alignItems: "center", gap: 1.25, borderRadius: 1, color: "inherit", textDecoration: "none", ...focusRing }}
            >
                <LogoIcon />
                <Typography component="span" sx={{ fontSize: "1.25rem", fontWeight: 700, letterSpacing: "-0.025em" }}>EconWebCast</Typography>
            </Box>

            {!!user && (
                <IconButton
                    component={Link}
                    to="/dashboard"
                    aria-label="Home"
                    sx={{ color: "common.white", p: 0.5, "&:hover": { color: "sky.100" }, ...focusRing }}
                >
                    <HomeIcon />
                </IconButton>
            )}
        </Box>
    );
};

export default Navbar;
