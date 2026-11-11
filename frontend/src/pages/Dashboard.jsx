import React, { useEffect, useRef, useState } from "react";
import { dashboardRoute } from "../constants/constants";
import { useNavigate } from "react-router-dom";
import { useUser } from "../hooks/useUser";
import GuidePanel from "../guideMe/GuidePanel";
import { guideContent } from "../guideMe/Guidecontent";
import ProductPreview from "./ProductPreview";

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

function UserMenu({ user, onLogout }) {
    const [open, setOpen] = useState(false);
    const ref = useRef(null);

    // Close when clicking outside the menu or pressing Escape
    useEffect(() => {
        if (!open) return undefined;
        const onClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
        const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
        document.addEventListener("mousedown", onClick);
        document.addEventListener("keydown", onKey);
        return () => {
            document.removeEventListener("mousedown", onClick);
            document.removeEventListener("keydown", onKey);
        };
    }, [open]);

    const name = user?.given_name || user?.name || "there";
    const initial = name.charAt(0).toUpperCase();

    return (
        <div ref={ref} className="relative">
            <button
                type="button"
                onClick={() => setOpen((o) => !o)}
                aria-haspopup="menu"
                aria-expanded={open}
                className="flex items-center gap-3 bg-white rounded-lg shadow-md pl-2 pr-3 py-2 hover:shadow-lg transition-shadow focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0071CE]"
            >
                <span className="w-9 h-9 rounded-full bg-gray-200 text-gray-700 flex items-center justify-center font-semibold" aria-hidden="true">
                    {initial}
                </span>
                <span className="text-left leading-tight">
                    <span className="block text-sm font-semibold text-gray-800 max-w-[10rem] truncate">{name}</span>
                </span>
                <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"
                     className={`w-5 h-5 text-gray-500 transition-transform ${open ? "rotate-180" : ""}`}>
                    <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.06l3.71-3.83a.75.75 0 1 1 1.08 1.04l-4.25 4.39a.75.75 0 0 1-1.08 0L5.21 8.27a.75.75 0 0 1 .02-1.06z" clipRule="evenodd" />
                </svg>
            </button>

            {open && (
                <div role="menu" className="absolute right-0 mt-2 w-56 bg-white rounded-lg shadow-lg border border-gray-100 py-2">
                    <p className="px-4 pb-2 text-xs text-gray-500 truncate border-b border-gray-100">{user?.email}</p>
                    <button
                        type="button"
                        role="menuitem"
                        onClick={onLogout}
                        className="w-full text-left px-4 py-2 mt-1 text-sm font-medium text-red-600 hover:bg-red-50"
                    >
                        Log out
                    </button>
                </div>
            )}
        </div>
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

    return (
        <div className="min-h-screen bg-[#E8EEF5]">
            {/* Top right: user menu */}
            <div className="absolute top-13 right-6 flex flex-col items-end gap-3 z-10">
                <UserMenu user={user} onLogout={onLogoutClick} />
                {/* Guide panel — renders inline below the controls, no overlay */}
                <GuidePanel
                    open={showGuide}
                    onClose={() => setShowGuide(false)}
                    content={guideContent.dashboard}
                />
            </div>

            <main className="flex flex-col items-center pt-[88px] pb-28 px-4">
                {/* Welcome */}
                <div className="text-center mb-10">
                    <h1 className="text-3xl sm:text-4xl font-bold text-gray-900">Welcome to your dashboard</h1>
                    <p className="mt-3 text-lg text-gray-600">
                        Analyze the latest rental market insights.
                    </p>
                </div>

                <div className="w-full max-w-5xl space-y-6">
                    {/* Featured card: Rental Dashboard, with the map and chart preview inside */}
                    {featured && (
                        <section className="bg-white rounded-xl shadow-md border border-gray-100 p-6 sm:p-8" aria-labelledby="featured-title">
                            <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
                                <div>
                                    <h2 id="featured-title" className="text-2xl font-bold text-gray-900">{featured.title}</h2>
                                    <p className="mt-1 text-base text-gray-600">{DESCRIPTIONS[featured.key]}</p>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => navigate(featured.route)}
                                    className="px-5 py-2.5 rounded-lg bg-[#0071CE] text-white text-base font-semibold hover:bg-[#005fae] focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[#0071CE]"
                                >
                                    Open dashboard
                                </button>
                            </div>
                            <ProductPreview />
                        </section>
                    )}

                    {/* Other dashboards */}
                    {others.length > 0 && (
                        <div className={`grid gap-6 ${others.length > 1 ? "md:grid-cols-2" : ""}`}>
                            {others.map(({ key, title, route }) => (
                                <section key={key} className="bg-white rounded-xl shadow-md border border-gray-100 p-6 flex flex-wrap items-center justify-between gap-4">
                                    <div>
                                        <h2 className="text-xl font-bold text-gray-900">{title}</h2>
                                        {DESCRIPTIONS[key] && <p className="mt-1 text-base text-gray-600">{DESCRIPTIONS[key]}</p>}
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => navigate(route)}
                                        className="px-5 py-2.5 rounded-lg border-2 border-[#0071CE] text-[#0071CE] text-base font-semibold hover:bg-blue-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0071CE]"
                                    >
                                        Open dashboard
                                    </button>
                                </section>
                            ))}
                        </div>
                    )}
                </div>
            </main>
        </div>
    );
};

export default Dashboard;
