import React, { useState } from "react";
import axios from "axios";
import { GoogleLogin } from "@react-oauth/google";
import { jwtDecode } from "jwt-decode";
import { useNavigate } from "react-router-dom";
import { useUser } from "../hooks/useUser";
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
        tone: "bg-amber-50 border-amber-200 text-amber-900",
    },
    expired: {
        icon: "⌛",
        title: "Your free pilot has ended",
        tone: "bg-gray-50 border-gray-200 text-gray-900",
    },
    paused: {
        icon: "⏸",
        title: "Your access is paused",
        tone: "bg-gray-50 border-gray-200 text-gray-900",
    },
};

const Home = () => {
    const navigate = useNavigate();
    const { setUser } = useUser();
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
        navigate("/dashboard");
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
        return (
            <div className="flex flex-col items-center justify-center min-h-[60vh] px-4">
                <div className={`w-full max-w-lg border rounded-xl px-6 py-6 text-left ${screen.tone}`} role="status">
                    <div className="text-3xl mb-2" aria-hidden="true">{screen.icon}</div>
                    <h2 className="text-xl font-bold">{screen.title}</h2>
                    <p className="mt-2 text-sm leading-relaxed">{blocked.message}</p>

                    {blocked.access === "pending" && (
                        <ul className="mt-4 text-sm space-y-1.5 list-disc pl-5">
                            <li>You're signed up as <b>{blocked.email}</b>. There's nothing else you need to do.</li>
                            <li>Approved accounts get a free two-month pilot, starting the first time you sign in after approval.</li>
                            <li>Come back and sign in with the same Google account once you're approved.</li>
                        </ul>
                    )}
                    {blocked.access === "expired" && blocked.trial_ends_at && (
                        <p className="mt-2 text-sm">Your pilot ended on <b>{fmtDate(blocked.trial_ends_at)}</b>.</p>
                    )}
                    {SUPPORT_EMAIL && blocked.access !== "pending" && (
                        <p className="mt-2 text-sm">
                            Contact <a className="underline font-medium" href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.
                        </p>
                    )}
                    {SUPPORT_EMAIL && blocked.access === "pending" && (
                        <p className="mt-3 text-sm">
                            Questions? Email <a className="underline font-medium" href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.
                        </p>
                    )}

                    <div className="mt-5 flex flex-wrap gap-2">
                        <button
                            onClick={checkAgain}
                            disabled={checking}
                            className="px-4 py-2 text-sm font-semibold rounded-md bg-gray-800 text-white hover:bg-gray-700 disabled:opacity-60"
                        >
                            {checking ? "Checking…" : "Check again"}
                        </button>
                        <button
                            onClick={() => { setBlocked(null); setCheckedNote(""); setError(""); }}
                            className="px-4 py-2 text-sm font-semibold rounded-md border border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
                        >
                            Use a different account
                        </button>
                    </div>
                    {checkedNote && <p className="mt-3 text-xs opacity-80">{checkedNote}</p>}
                    {error && <p className="mt-3 text-sm text-red-700">{error}</p>}
                </div>
            </div>
        );
    }

    // ------------------------------------------------------------------
    // Sign-in
    // ------------------------------------------------------------------
    return (
        <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-6 text-center">
            <h2 className="text-3xl font-bold text-gray-800">Welcome</h2>
            <p className="text-base text-gray-600">Sign in with your Google Account</p>
            <p className="text-sm text-gray-500 max-w-md">
                We're in a free pilot. New accounts are approved by hand, usually by the end of the day.
            </p>

            <label className="flex items-start gap-2 max-w-md text-sm text-gray-600 text-left">
                <input
                    type="checkbox"
                    checked={agreed}
                    onChange={(e) => setAgreed(e.target.checked)}
                    className="mt-1"
                />
                <span>
                    I confirm the data I upload does not contain sensitive or
                    confidential information I'm not authorized to share, and I
                    agree to the{" "}
                    <button
                        type="button"
                        onClick={() => openModal("terms")}
                        className="underline text-gray-700 hover:text-gray-900"
                    >
                        Terms of Service
                    </button>{" "}
                    and{" "}
                    <button
                        type="button"
                        onClick={() => openModal("privacy")}
                        className="underline text-gray-700 hover:text-gray-900"
                    >
                        Privacy Policy
                    </button>
                    .
                </span>
            </label>

            {signingIn ? (
                <div className="text-sm text-gray-500 animate-pulse">Signing you in…</div>
            ) : agreed ? (
                <GoogleLogin onSuccess={handleLoginSuccess} onError={handleLoginError} />
            ) : (
                <div className="opacity-50 text-sm text-gray-400 border rounded px-4 py-2">
                    Please agree to the terms above to continue
                </div>
            )}

            {error && <p className="text-sm text-red-600 max-w-md">{error}</p>}

            <LegalModal
                isOpen={modalOpen}
                onClose={() => setModalOpen(false)}
                initialTab={modalTab}
            />
        </div>
    );
};

export default Home;
