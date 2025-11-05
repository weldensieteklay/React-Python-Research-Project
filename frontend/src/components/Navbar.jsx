import React from 'react';
import { HomeIcon } from "@heroicons/react/24/solid";
import { Link } from 'react-router-dom';

const Navbar = () => {
    return (
        <nav className="w-full bg-gray-800 p-4 text-white flex justify-between items-center">
            <h1 className="text-xl font-bold">My App</h1>
            <Link to="/dashboard" className="text-white hover:text-gray-300">
            <HomeIcon className="h-6 w-6 text-white" />
            </Link>
        </nav>
    );
};

export default Navbar;