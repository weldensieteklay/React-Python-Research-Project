import { useCallback, useEffect, useRef } from "react";
import axios from "axios";
import { useLocation, useNavigate } from "react-router-dom";
import { useUser } from "../hooks/useUser";
import { isSessionValid, msUntilExpiry, SESSION_EXPIRED_EVENT } from "../auth/session";

// ===========================================================================
// Sends the user back to the login page, from any page, when their session ends:
//   - the token's expiry time arrives (a timer, re-checked when the tab regains focus,
//     since timers pause while a laptop sleeps);
//   - any axios request gets a 401 response ("token expired or invalid");
//   - other code calls notifySessionExpired() (for requests made with fetch).
//
// Renders nothing. Place it once inside <BrowserRouter>.
// ===========================================================================

export default function AuthWatcher() {
    const { user, clearUser } = useUser();
    const navigate = useNavigate();
    const location = useLocation();

    // Refs so the axios interceptor (installed once) always sees the latest values
    const userRef = useRef(user);
    const pathRef = useRef(location.pathname);
    userRef.current = user;
    pathRef.current = location.pathname;

    const endSession = useCallback(() => {
        if (!userRef.current) return; // not signed in (e.g. a 401 on the login page itself)
        userRef.current = null;       // ignore further 401s from requests already in flight
        const from = pathRef.current;
        clearUser();
        navigate("/", { replace: true, state: { sessionExpired: true, from } });
    }, [clearUser, navigate]);

    // 1. Any axios request that comes back 401 ends the session
    useEffect(() => {
        const id = axios.interceptors.response.use(
            (response) => response,
            (error) => {
                if (error?.response?.status === 401) endSession();
                return Promise.reject(error);
            }
        );
        return () => axios.interceptors.response.eject(id);
    }, [endSession]);

    // 2. End the session when the token expires, even if the user does nothing
    useEffect(() => {
        if (!user) return undefined;
        if (!isSessionValid(user)) {
            endSession();
            return undefined;
        }
        const wait = msUntilExpiry(user);
        // setTimeout can't wait longer than about 24 days
        const timer = wait === null ? null : setTimeout(endSession, Math.min(wait, 2 ** 31 - 1));

        const recheck = () => {
            if (document.visibilityState === "visible" && !isSessionValid(userRef.current)) endSession();
        };
        document.addEventListener("visibilitychange", recheck);
        window.addEventListener("focus", recheck);
        return () => {
            if (timer) clearTimeout(timer);
            document.removeEventListener("visibilitychange", recheck);
            window.removeEventListener("focus", recheck);
        };
    }, [user, endSession]);

    // 3. Code that doesn't use axios can end the session with notifySessionExpired()
    useEffect(() => {
        window.addEventListener(SESSION_EXPIRED_EVENT, endSession);
        return () => window.removeEventListener(SESSION_EXPIRED_EVENT, endSession);
    }, [endSession]);

    return null;
}
