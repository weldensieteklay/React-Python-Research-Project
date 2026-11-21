import React, { useState } from "react";
import axios from "axios";
import { GoogleLogin } from "@react-oauth/google";
import { jwtDecode } from "jwt-decode";
import { useLocation, useNavigate } from "react-router-dom";
import { useUser } from "../hooks/useUser";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import Link from "@mui/material/Link";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { pulse } from "../theme";
import LegalModal from "../components/LegalModal";

const API = import.meta.env.VITE_API_URL;
// Optional: shown on the pending / expired screens, e.g. VITE_SUPPORT_EMAIL=support@yourdomain.com
const SUPPORT_EMAIL = import.meta.env.VITE_SUPPORT_EMAIL || "";

const fmtDate = (iso) =>
    iso ? new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" }) : "";

// What each access state looks like. Text comes from the API when it sends one.
const SCREENS = {
    pending: {
        icon: "⏳",
        title: "Your access is pending approval",
        tone: { bgcolor: "amber.50", borderColor: "amber.200", color: "amber.900" },
    },
    expired: {
        icon: "⌛",
        title: "Your free pilot has ended",
        tone: { bgcolor: "gray.50", borderColor: "gray.200", color: "gray.900" },
    },
    paused: {
        icon: "⏸",
        title: "Your access is paused",
        tone: { bgcolor: "gray.50", borderColor: "gray.200", color: "gray.900" },
    },
};

const Home = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const { setUser } = useUser();
    // Set by AuthWatcher / ProtectedRoute when a session ended: { sessionExpired, from }
    const sessionExpired = Boolean(location.state?.sessionExpired);
    const returnTo = location.state?.from?.startsWith("/dashboard") ? location.state.from : "/dashboard";
    const [agreed, setAgreed] = useState(false);
    const [modalOpen, setModalOpen] = useState(false);
    const [modalTab, setModalTab] = useState("terms");

    const [signingIn, setSigningIn] = useState(false);
    const [checking, setChecking] = useState(false);
    const [error, setError] = useState("");
    // Set when the user signed in but doesn't have access yet: { access, message, email, token, ... }
    const [blocked, setBlocked] = useState(null);
    const [checkedNote, setCheckedNote] = useState("");

    const openModal = (tab) => {
        setModalTab(tab);
        setModalOpen(true);
    };

    const enterApp = (token, status) => {
        setUser({
            ...jwtDecode(token),
            accessToken: token,
            // available to the dashboard, e.g. to show "12 days left in your pilot"
            access: {
                status: status.access,
                trialEndsAt: status.trial_ends_at,
                daysLeft: status.days_left,
            },
        });
        // Back to the page they were on when the session ended, otherwise the dashboard
        navigate(returnTo, { replace: true });
    };

    const describeError = (err) => {
        const code = err?.response?.status;
        if (code === 401) return "Your Google sign-in has expired. Please sign in again.";
        if (!err?.response) return "We couldn't reach the server. Check your connection and try again.";
        const detail = err.response.data?.detail;
        return typeof detail === "string" ? detail : "Something went wrong while signing in. Please try again.";
    };

    const handleLoginSuccess = async (credentialResponse) => {
        setError("");
        setCheckedNote("");
        setSigningIn(true);
        const token = credentialResponse.credential;
        try {
            // Records consent and returns the access status: granted | pending | expired | paused
            const { data } = await axios.post(
                `${API}/api/consent`,
                {},
                { headers: { Authorization: `Bearer ${token}` } }
            );
            if (data.access === "granted") {
                enterApp(token, data);
                return;
            }
            setBlocked({ ...data, token });
        } catch (err) {
            console.error("Sign-in failed:", err);
            setError(describeError(err));
        } finally {
            setSigningIn(false);
        }
    };

    // Re-check without signing in again. The Google token lasts about an hour.
    const checkAgain = async () => {
        if (!blocked?.token) return;
        setChecking(true);
        setCheckedNote("");
        setError("");
        try {
            const { data } = await axios.get(`${API}/api/access-status`, {
                headers: { Authorization: `Bearer ${blocked.token}` },
            });
            if (data.access === "granted") {
                enterApp(blocked.token, data);
                return;
            }
            setBlocked((b) => ({ ...b, ...data }));
            setCheckedNote(`Checked just now: still ${data.access === "pending" ? "pending" : data.access}.`);
        } catch (err) {
            if (err?.response?.status === 401) {
                setBlocked(null);
                setError("Your sign-in session has expired. Please sign in again to check your status.");
            } else {
                setError(describeError(err));
            }
        } finally {
            setChecking(false);
        }
    };

    const handleLoginError = () => {
        setError("Google sign-in didn't complete. Please try again.");
    };

    // ------------------------------------------------------------------
    // Signed in, but no access yet
    // ------------------------------------------------------------------
    if (blocked) {
        const screen = SCREENS[blocked.access] || SCREENS.pending;
        const mailLink = <Link href={`mailto:${SUPPORT_EMAIL}`} color="inherit" underline="always" sx={{ fontWeight: 500 }}>{SUPPORT_EMAIL}</Link>;
        return (
            <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "60vh", px: 2 }}>
                <Paper variant="outlined" role="status" sx={{ width: "100%", maxWidth: 512, borderRadius: 3, p: 3, textAlign: "left", ...screen.tone }}>
                    <Box sx={{ fontSize: "1.875rem", mb: 1 }} aria-hidden="true">{screen.icon}</Box>
                    <Typography variant="h2" sx={{ fontSize: "1.25rem", fontWeight: 700 }}>{screen.title}</Typography>
                    <Typography variant="body2" sx={{ mt: 1, lineHeight: 1.625 }}>{blocked.message}</Typography>

                    {blocked.access === "pending" && (
                        <Box component="ul" sx={{ mt: 2, mb: 0, fontSize: "0.875rem", pl: 2.5, listStyle: "disc", "& > li + li": { mt: 0.75 } }}>
                            <li>You're signed up as <b>{blocked.email}</b>. There's nothing else you need to do.</li>
                            <li>Approved accounts get a free one-month pilot, starting the first time you sign in after approval.</li>
                            <li>Come back and sign in with the same Google account once you're approved.</li>
                        </Box>
                    )}
                    {blocked.access === "expired" && blocked.trial_ends_at && (
                        <Typography variant="body2" sx={{ mt: 1 }}>Your pilot ended on <b>{fmtDate(blocked.trial_ends_at)}</b>.</Typography>
                    )}
                    {SUPPORT_EMAIL && blocked.access !== "pending" && (
                        <Typography variant="body2" sx={{ mt: 1 }}>Contact {mailLink}.</Typography>
                    )}
                    {SUPPORT_EMAIL && blocked.access === "pending" && (
                        <Typography variant="body2" sx={{ mt: 1.5 }}>Questions? Email {mailLink}.</Typography>
                    )}

                    <Stack direction="row" useFlexGap sx={{ mt: 2.5, flexWrap: "wrap", gap: 1 }}>
                        <Button
                            onClick={checkAgain}
                            disabled={checking}
                            variant="contained"
                            sx={{ fontWeight: 600, bgcolor: "gray.800", "&:hover": { bgcolor: "gray.700" }, "&.Mui-disabled": { bgcolor: "gray.800", color: "common.white", opacity: 0.6 } }}
                        >
                            {checking ? "Checking…" : "Check again"}
                        </Button>
                        <Button
                            onClick={() => { setBlocked(null); setCheckedNote(""); setError(""); }}
                            variant="outlined"
                            sx={{ fontWeight: 600, borderColor: "gray.300", bgcolor: "common.white", color: "gray.700", "&:hover": { bgcolor: "gray.50", borderColor: "gray.300" } }}
                        >
                            Use a different account
                        </Button>
                    </Stack>
                    {checkedNote && <Typography variant="caption" component="p" sx={{ mt: 1.5, opacity: 0.8 }}>{checkedNote}</Typography>}
                    {error && <Typography variant="body2" sx={{ mt: 1.5, color: "red.700" }}>{error}</Typography>}
                </Paper>
            </Box>
        );
    }

    // ------------------------------------------------------------------
    // Sign-in
    // ------------------------------------------------------------------
    const legalLinkSx = { verticalAlign: "baseline", color: "gray.700", "&:hover": { color: "gray.900" } };
    return (
        <Stack spacing={3} sx={{ alignItems: "center", justifyContent: "center", minHeight: "60vh", textAlign: "center" }}>
            {sessionExpired && !error && (
                <Alert role="status" severity="warning" icon={false} sx={{ maxWidth: 448, bgcolor: "amber.50", border: 1, borderColor: "amber.200", color: "amber.900", borderRadius: 2 }}>
                    Your session has expired. Please sign in again to continue.
                </Alert>
            )}
            <Typography variant="h2" sx={{ fontSize: "1.875rem", fontWeight: 700, color: "gray.800" }}>Welcome</Typography>
            <Typography sx={{ color: "gray.600" }}>Sign in with your Google Account</Typography>
            <Typography variant="body2" sx={{ color: "gray.500", maxWidth: 448 }}>
                We're in a free pilot.
            </Typography>

            <Box component="label" sx={{ display: "flex", alignItems: "flex-start", gap: 1, maxWidth: 448, fontSize: "0.875rem", color: "gray.600", textAlign: "left" }}>
                <Checkbox
                    checked={agreed}
                    onChange={(e) => setAgreed(e.target.checked)}
                    size="small"
                    sx={{ p: 0, mt: 0.25 }}
                />
                <span>
                    I confirm the data I upload does not contain sensitive or
                    confidential information I'm not authorized to share, and I
                    agree to the{" "}
                    <Link component="button" type="button" onClick={() => openModal("terms")} underline="always" sx={legalLinkSx}>
                        Terms of Service
                    </Link>{" "}
                    and{" "}
                    <Link component="button" type="button" onClick={() => openModal("privacy")} underline="always" sx={legalLinkSx}>
                        Privacy Policy
                    </Link>
                    .
                </span>
            </Box>

            {signingIn ? (
                <Typography variant="body2" sx={{ color: "gray.500", ...pulse }}>Signing you in…</Typography>
            ) : agreed ? (
                <GoogleLogin onSuccess={handleLoginSuccess} onError={handleLoginError} />
            ) : (
                <Box sx={{ opacity: 0.5, fontSize: "0.875rem", color: "gray.400", border: 1, borderColor: "gray.200", borderRadius: 1, px: 2, py: 1 }}>
                    Please agree to the terms above to continue
                </Box>
            )}

            {error && <Typography variant="body2" sx={{ color: "red.600", maxWidth: 448 }}>{error}</Typography>}

            <LegalModal
                isOpen={modalOpen}
                onClose={() => setModalOpen(false)}
                initialTab={modalTab}
            />
        </Stack>
    );
};

export default Home;
