import { useState } from 'react';
import axios from 'axios';

export const usePrediction = () => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handlePredict = async (payload, method) => {
    if (!payload || !method) {
      console.error("Missing payload or method");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await axios.post(`http://localhost:5000/api/${method}`, payload);
      setData(response.data);
    } catch (err) {
      setError(err.response?.data || err.message);
    } finally {
      setLoading(false);
    }
  };

  return { data, loading, error, handlePredict };
};
