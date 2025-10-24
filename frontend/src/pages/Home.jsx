import React from "react";
import { GoogleLogin } from "@react-oauth/google";
import { jwtDecode } from "jwt-decode";
import { useNavigate } from "react-router-dom";
// import Dashboard from "./Dashboard";



const Home = ({ setUser }) => {
    const navigate = useNavigate();

    const handleLoginSuccess = (credentialResponse) => {
        const decoded = jwtDecode(credentialResponse.credential);
        console.log("Google User:", decoded);
        setUser(decoded);
        navigate("/dashboard");

    };

    const handleLoginError = () => {
        console.log("Google Login Failed");
    };

    return (
        <>
            <h2 className="text-2xl font-semibold text-gray-800">Welcome</h2>
            <p className="text-sm text-gray-500">Sign in with your Google Account</p>
            <div className="flex justify-center">
                <GoogleLogin
                    onSuccess={handleLoginSuccess}
                    onError={handleLoginError}
                />
            </div>
        </>
    );
};

export default Home;
