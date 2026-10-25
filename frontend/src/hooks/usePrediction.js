import { useState } from "react";
import axios from "axios";
import { useUser } from "./useUser"; 

export const usePrediction = () => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  
  // 2. Extract the user object containing the in-memory token
  const { user } = useUser(); 

  const handlePredict = async (payload, method) => {
    if (!payload || !method) {
      console.error("Missing payload or method");
      return;
    }

    // 3. Fail early if the user is unauthenticated or the in-memory token is gone
    if (!user || !user.accessToken) {
      setError("Your session has expired. Please sign in again.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // 4. Extract token entirely from volatile RAM state
      const token = user.accessToken; 
      
      const response = await axios.post(
        `${import.meta.env.VITE_API_URL}/api/${method}`,
        payload,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );
      setData(response.data);
    } catch (err) {
      console.error("[PREDICTION ERROR] Logs:", err);

      if (err.response) {
        // Server responded with a status code outside the 2xx range
        const serverMessage = err.response.data?.detail || err.response.data?.error || err.message;
        setError(serverMessage || "Request processing failed.");
      } else if (err.request) {
        // Request was sent but no response came back (Network/CORS faults)
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
  };

  return { data, setData, loading, error, handlePredict };
};
