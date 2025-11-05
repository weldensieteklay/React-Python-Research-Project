import React, { useState } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Layout from '../components/Layout';
import Home from '../pages/Home';
import Dashboard from '../pages/Dashboard';
import CrossSectionalData from '../components/CrossSectionalData';
import TimeSeriesData from '../components/TimeSeriesData';
import { UserContext } from '../context/UserContext';


const AppRoutes = () => {
    const [user, setUser] = useState(null);
    const handleLogout = () => {
        setUser(null);
    };

    return (
        <UserContext.Provider value={{ user, setUser, handleLogout }}>
            <BrowserRouter>
                <Routes>
                    <Route path="/" element={<Layout />}>
                        <Route path="/" element={<Home />} />
                        <Route path="/dashboard" element={<Dashboard />} />
                        <Route path="/dashboard/cross-sectional" element={<CrossSectionalData />} />
                        <Route path="/dashboard/time-series" element={<TimeSeriesData />} />
                    </Route>
                </Routes>
            </BrowserRouter>
        </UserContext.Provider>
    );
}


export default AppRoutes;