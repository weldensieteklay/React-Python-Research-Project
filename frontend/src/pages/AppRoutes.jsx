import React from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { lazy, Suspense } from "react";

//Internal components
import Layout from '../components/Layout';
import Home from './Home';
import DataCleanup from '../components/DataCleanup';
import { useUser } from '../hooks/useUser';
import ProtectedRoute from '../pages/ProtectedRoute';
import AuthWatcher from '../components/AuthWatcher';
import RentalDashboard from './RentalProperty/RentalDashboard';

const CrossSectionalData = lazy(() => import("../components/CrossSectionalData"));
const TimeSeriesData = lazy(() => import("../components/TimeSeriesData"));
const PanelData = lazy(() => import("../components/PanelData"));
const Dashboard = lazy(() => import("./Dashboard"));
const RentalDataDownload = lazy(() => import("./RentalProperty/RentalDashboard"));
const RealEstateDashboard = lazy(() => import("./RentalProperty/RealEstateDashboard"));



const AppRoutes = () => {
    const { user, setUser, clearUser } = useUser();
    return (

        <BrowserRouter>
            {/* Sends the user to the login page from anywhere when the session ends */}
            <AuthWatcher />
            <Suspense fallback={<div>Loading page...</div>}>
                <Routes>
                    <Route path="/" element={<Layout user={user} setUser={setUser} clearUser={clearUser} />}>
                        <Route path="/" element={<Home />} />
                        {/* Every dashboard route is wrapped in ProtectedRoute */}
                        <Route path="/dashboard" element={
                            <ProtectedRoute><Dashboard /></ProtectedRoute>
                        } />
                        <Route path="/dashboard/rental-data" element={
                            <ProtectedRoute>
                                    <RentalDataDownload />
                            </ProtectedRoute>
                        } />
                         <Route path="/dashboard/real-estate-data" element={
                            <ProtectedRoute>
                                    <RentalDashboard />
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
