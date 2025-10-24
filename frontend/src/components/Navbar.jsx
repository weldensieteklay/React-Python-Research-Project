import React from 'react';
import { Link } from 'react-router-dom';

const Navbar = () => {
    return (
        <nav className="w-full bg-gray-800 p-4 text-white flex justify-between items-center">
            <h1 className="text-xl font-bold">My App</h1>
        </nav>
    );
};

export default Navbar;