import React from 'react'
import { Outlet } from 'react-router-dom';
import Box from '@mui/material/Box';
import Navbar from './Navbar';
import Footer from './Footer';

function Layout() {

    return (
        <Box sx={{ display: "flex", flexDirection: "column", minHeight: "100vh" }}>
            <Navbar />
            <Box component="main" sx={{ flexGrow: 1 }}>
                <Outlet />
            </Box>
            <Footer />
        </Box>
    );
}

export default Layout;
