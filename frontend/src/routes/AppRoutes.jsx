import React, { useState } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Layout from '../components/Layout';
import Home from '../pages/Home';
import Dashboard from '../pages/Dashboard';
import CrossSectionalData from '../components/CrossSectionalData';
import TimeSeriesData from '../components/TimeSeriesData';
import DataCleanup from '../components/DataCleanup';
import { useUser } from '../hooks/useUser'


const AppRoutes = () => {
    const { user, setUser, clearUser } = useUser();
    return (

        <BrowserRouter>
            <Routes>
                <Route path="/" element={<Layout user={user} setUser={setUser} clearUser={clearUser} />}>
                    <Route path="/" element={<Home />} />
                    <Route path="/dashboard" element={<Dashboard />} />
                    <Route path="/dashboard/cross-sectional" element={<CrossSectionalData />} />
                    <Route path="/dashboard/time-series" element={<TimeSeriesData />} />
                    <Route path="/dashboard/data-cleaning" element={<DataCleanup />} />
                </Route>
            </Routes>
        </BrowserRouter>

    );
}


export default AppRoutes;