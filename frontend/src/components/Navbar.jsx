import React from 'react';
import { HomeIcon } from "@heroicons/react/24/solid";
import { Link } from 'react-router-dom';
import { useUser } from '../hooks/useUser';

/** EconWebCast mark: rising bars with a trend line, drawn white-on-blue for the blue navbar. */
const LogoIcon = () => (
    <svg viewBox="0 0 32 32" className="w-8 h-8 shrink-0" aria-hidden="true">
        <rect width="32" height="32" rx="8" fill="#FFFFFF" />
        <rect x="7" y="17" width="4" height="8" rx="1" fill="#0071CE" fillOpacity="0.55" />
        <rect x="14" y="13" width="4" height="12" rx="1" fill="#0071CE" fillOpacity="0.75" />
        <rect x="21" y="9" width="4" height="16" rx="1" fill="#0071CE" />
        <path d="M6 14 L13 10 L19 11.5 L26 6" fill="none" stroke="#00A3E0" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
);

const Navbar = () => {
    const { user } = useUser();

    return (
        <nav className="w-full bg-[#0071CE] border-b border-sky-700 px-4 py-3 text-white flex items-center justify-between">
            {/* Logo and name, left-aligned; leads to the dashboard when signed in, else the sign-in page */}
            <Link
                to={user ? "/dashboard" : "/"}
                className="flex items-center gap-2.5 rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
                <LogoIcon />
                <span className="text-xl font-bold tracking-tight">EconWebCast</span>
            </Link>

            {!!user && (
                <Link
                    to="/dashboard"
                    className="text-white hover:text-sky-100 rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
                    aria-label="Home"
                >
                    <HomeIcon className="h-6 w-6" />
                </Link>
            )}
        </nav>
    );
};

export default Navbar;
