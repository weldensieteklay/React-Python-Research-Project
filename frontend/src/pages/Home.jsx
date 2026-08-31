import React, { useState } from "react";
import axios from "axios";
import { GoogleLogin } from "@react-oauth/google";
import { jwtDecode } from "jwt-decode";
import { useNavigate } from "react-router-dom";
import { useUser } from "../hooks/useUser";
import LegalModal from "../components/LegalModal";

const Home = () => {
    const navigate = useNavigate();
    const { setUser } = useUser();
    const [agreed, setAgreed] = useState(false);
    const [modalOpen, setModalOpen] = useState(false);
    const [modalTab, setModalTab] = useState("terms");

    const openModal = (tab) => {
        setModalTab(tab);
        setModalOpen(true);
    };

    const handleLoginSuccess = async (credentialResponse) => {
        try {
            const decoded = jwtDecode(credentialResponse.credential);
            const token = credentialResponse.credential;

            localStorage.setItem("user", JSON.stringify(decoded));
            localStorage.setItem("credential", token);

            await axios.post(
                `${import.meta.env.VITE_API_URL}/api/consent`,
                {},
                {
                    headers: {
                        Authorization: `Bearer ${token}`,
                    },
                }
            );

            setUser(decoded);
            navigate("/dashboard");
        } catch (err) {
            console.error("Failed to decode credential or record consent:", err);
        }
    };

    const handleLoginError = () => {
        console.log("Google Login Failed");
    };

    return (
        <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-6 text-center">
            <h2 className="text-3xl font-bold text-gray-800">Welcome</h2>
            <p className="text-base text-gray-600">Sign in with your Google Account</p>

            <label className="flex items-start gap-2 max-w-md text-sm text-gray-600 text-left">
                <input
                    type="checkbox"
                    checked={agreed}
                    onChange={(e) => setAgreed(e.target.checked)}
                    className="mt-1"
                />
                <span>
                    I confirm the data I upload does not contain sensitive or
                    confidential information I'm not authorized to share, and I
                    agree to the{" "}
                    <button
                        type="button"
                        onClick={() => openModal("terms")}
                        className="underline text-gray-700 hover:text-gray-900"
                    >
                        Terms of Service
                    </button>{" "}
                    and{" "}
                    <button
                        type="button"
                        onClick={() => openModal("privacy")}
                        className="underline text-gray-700 hover:text-gray-900"
                    >
                        Privacy Policy
                    </button>
                    .
                </span>
            </label>

            {agreed ? (
                <GoogleLogin onSuccess={handleLoginSuccess} onError={handleLoginError} />
            ) : (
                <div className="opacity-50 text-sm text-gray-400 border rounded px-4 py-2">
                    Please agree to the terms above to continue
                </div>
            )}

            <LegalModal
                isOpen={modalOpen}
                onClose={() => setModalOpen(false)}
                initialTab={modalTab}
            />
        </div>
    );
};

export default Home;