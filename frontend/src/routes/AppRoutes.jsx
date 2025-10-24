import React, {useState} from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Layout from '../components/Layout';
import Home from '../pages/Home';
import Dashboard from '../pages/Dashboard';


const AppRoutes = () => {
     const [user, setUser] = useState(null);
     const handleLogout = () => {
        setUser(null);
    };

    return (
        <BrowserRouter>
            <Routes>
                <Route path="/" element={<Layout />}>
                    <Route path="/" element={<Home setUser={setUser}/>} />
                    <Route path="/dashboard" element={<Dashboard  user={user} handleLogout={handleLogout}/>} />
                </Route>
            </Routes>
        </BrowserRouter>
    );
}


export default AppRoutes;