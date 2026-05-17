import React from 'react';
import { HomeIcon } from "@heroicons/react/24/solid";
import { Link } from 'react-router-dom';
import { useUser } from '../hooks/useUser';

const Navbar = () => {
    const { user } = useUser();

    return (
        <nav className="w-full bg-gray-800 p-4 text-white relative">
            <h1 className="text-xl font-bold text-center">
                EconWebCast
            </h1>

            {!!user && (
                <Link
                    to="/dashboard"
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-white hover:text-gray-300"
                >
                    <HomeIcon className="h-6 w-6" />
                </Link>
            )}
        </nav>
    );
};

export default Navbar;