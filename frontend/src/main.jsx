import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { Provider } from 'react-redux';
import { store } from './store/store';
import { GoogleOAuthProvider } from "@react-oauth/google";
import "./index.css";
const clientId = "898643726658-4rur3k3o1ef39qspg9svkqcjkdi24a0j.apps.googleusercontent.com";

ReactDOM.createRoot(document.getElementById("root")).render(
  <GoogleOAuthProvider clientId={clientId}>
    <Provider store={store}>
      <App />
    </Provider>
  </GoogleOAuthProvider>

);
