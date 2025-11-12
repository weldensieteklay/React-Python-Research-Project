import React from "react";
import { GoogleLogin } from "@react-oauth/google";
import { jwtDecode } from "jwt-decode";
import { useNavigate } from "react-router-dom";
import { useUser } from "../context/UserContext";

const Home = () => {
    const navigate = useNavigate();
    const { setUser } = useUser();

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
        <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-6 text-center">
            <h2 className="text-3xl font-bold text-gray-800">Welcome</h2>
            <p className="text-base text-gray-600">Sign in with your Google Account</p>
            <div>
                <GoogleLogin
                    onSuccess={handleLoginSuccess}
                    onError={handleLoginError}
                />
            </div>
        </div>

    );
};

export default Home;
