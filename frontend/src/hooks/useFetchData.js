import { useState } from "react";
import axios from "axios";

export const useFetchData = () => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleFetch = async (endpoint, params = {}) => {
    if (!endpoint) {
      console.error("Missing endpoint");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const token = localStorage.getItem("credential");
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
      console.log(err, "Error logs");

      if (err.response) {
        // Server responded with a status code outside 2xx (401, 500, etc.)
        const serverMessage = err.response.data?.message || err.response.data?.error;

        if (err.response.status === 401) {
          setError(serverMessage || "Your session has expired. Please sign in again.");
        } else {
          setError(serverMessage || `Request failed with status ${err.response.status}.`);
        }
      } else if (err.request) {
        // Request was sent but no response came back at all.
        // This is what a CORS-blocked response or a dead server looks like
        // (axios reports it as a generic "Network Error").
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

  return { data, setData, loading, error, handleFetch };
};