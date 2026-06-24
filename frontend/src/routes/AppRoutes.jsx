import React from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { lazy, Suspense } from "react";

//Internal components
import Layout from '../components/Layout';
import Home from '../pages/Home';
import DataCleanup from '../components/DataCleanup';
import { useUser } from '../hooks/useUser';

const CrossSectionalData = lazy(() => import("../components/CrossSectionalData"));
const TimeSeriesData = lazy(() => import("../components/TimeSeriesData"));
const PanelData = lazy(() => import("../components/PanelData"));
const Dashboard = lazy(() => import("../pages/Dashboard"));

const AppRoutes = () => {
    const { user, setUser, clearUser } = useUser();
    return (

        <BrowserRouter>
            <Suspense fallback={<div>Loading page...</div>}>
                <Routes>
                    <Route path="/" element={<Layout user={user} setUser={setUser} clearUser={clearUser} />}>
                        <Route path="/" element={<Home />} />
                        <Route path="/dashboard" element={<Dashboard />} />
                        <Route path="/dashboard/cross-sectional" element={<CrossSectionalData />} />
                        <Route path="/dashboard/time-series" element={<TimeSeriesData />} />
                        <Route path="/dashboard/panel-data" element={<PanelData />} />
                        <Route path="/dashboard/data-cleaning" element={<DataCleanup />} />
                    </Route>
                </Routes>
            </Suspense>
        </BrowserRouter>

    );
}


export default AppRoutes;