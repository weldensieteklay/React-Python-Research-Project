import React from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { lazy, Suspense } from "react";

//Internal components
import Layout from '../components/Layout';
import Home from '../pages/Home';
import DataCleanup from '../components/DataCleanup';
import { useUser } from '../hooks/useUser';
import ProtectedRoute from '../pages/ProtectedRoute';

const CrossSectionalData = lazy(() => import("../components/CrossSectionalData"));
const TimeSeriesData = lazy(() => import("../components/TimeSeriesData"));
const PanelData = lazy(() => import("../components/PanelData"));
const Dashboard = lazy(() => import("../pages/Dashboard"));
const RentalDataDownload = lazy(() => import("../pages/RentalProperty/RentalDataDownload"));

// Emails allowed to access the Rental Data Download page.
// Move this to an env var or backend-driven allowlist if the list grows.
const RENTAL_DATA_ALLOWED_EMAILS = ["weldensieteklay@gmail.com"];

const EmailRestrictedRoute = ({ children }) => {
    const { user } = useUser();
    const isAllowed = RENTAL_DATA_ALLOWED_EMAILS.includes(user?.email);

    if (!isAllowed) {
        return <Navigate to="/dashboard" replace />;
    }
    return children;
};

const AppRoutes = () => {
    const { user, setUser, clearUser } = useUser();
    return (

        <BrowserRouter>
            <Suspense fallback={<div>Loading page...</div>}>
                <Routes>
                    <Route path="/" element={<Layout user={user} setUser={setUser} clearUser={clearUser} />}>
                        <Route path="/" element={<Home />} />
                       // Wrap every dashboard route:
                        <Route path="/dashboard" element={
                            <ProtectedRoute><Dashboard /></ProtectedRoute>
                        } />
                        <Route path="/dashboard/rental-data" element={
                            <ProtectedRoute>
                                <EmailRestrictedRoute>
                                    <RentalDataDownload />
                                </EmailRestrictedRoute>
                            </ProtectedRoute>
                        } />
                        <Route path="/dashboard/cross-sectional" element={
                            <ProtectedRoute><CrossSectionalData /></ProtectedRoute>
                        } />
                        <Route path="/dashboard/time-series" element={
                            <ProtectedRoute><TimeSeriesData /></ProtectedRoute>
                        } />
                        <Route path="/dashboard/panel-data" element={
                            <ProtectedRoute><PanelData /></ProtectedRoute>
                        } />
                        <Route path="/dashboard/data-cleaning" element={
                            <ProtectedRoute><DataCleanup /></ProtectedRoute>
                        } />
                    </Route>
                </Routes>
            </Suspense>
        </BrowserRouter>

    );
}


export default AppRoutes;
