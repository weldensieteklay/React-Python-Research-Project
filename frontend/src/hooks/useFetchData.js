import { useState, useCallback } from "react";
import axios from "axios";
import { useUser } from "./useUser"; // Import your Redux-backed useUser hook

export const useFetchData = () => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // 1. Pull the live user slice from the Redux global store
  const { user } = useUser();

  // 2. Wrap handleFetch in useCallback to prevent unnecessary re-renders in components
  const handleFetch = useCallback(async (endpoint, params = {}) => {
    if (!endpoint) {
      console.error("[FETCH ERROR] Missing endpoint specification.");
      return;
    }

    // 3. Fail fast if the user is unauthenticated or the in-memory token is absent
    if (!user || !user.accessToken) {
      setError("Your session has expired. Please sign in again.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // 4. Extract token securely from volatile Redux memory
      const token = user.accessToken;

      const response = await axios.get(
        `${import.meta.env.VITE_API_URL}/api/${endpoint}`,
        {
          params,
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );
      setData(response.data);
    } catch (err) {
      console.error(`[FETCH ERROR] Logs for /api/${endpoint}:`, err);

      if (err.response) {
        // Handle explicit backend errors (FastAPI dependencies return detail or error keys)
        const resData = err.response.data;
        const serverMessage = resData?.detail || resData?.error || resData?.message;

        if (err.response.status === 401) {
          setError(serverMessage || "Your session has expired. Please sign in again.");
        } else {
          setError(serverMessage || `Request failed with status code ${err.response.status}.`);
        }
      } else if (err.request) {
        // Network failure, dead server, or middleware CORS exception
        setError(
          "Could not reach the server. This is usually a network issue or a CORS " +
          "configuration problem on the backend — please try again or contact support."
        );
      } else {
        setError(err.message || "Something went wrong while making the request.");
      }
    } finally {
      setLoading(false);
    }
  }, [user]); // Re-evaluate only when user state updates

  return { data, setData, loading, error, handleFetch };
};
