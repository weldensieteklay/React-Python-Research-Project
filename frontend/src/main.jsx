import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { Provider } from 'react-redux';
import { store } from './store/store';
import { GoogleOAuthProvider } from "@react-oauth/google";
import { ThemeProvider } from "@mui/material/styles";
import CssBaseline from "@mui/material/CssBaseline";
import GlobalStyles from "@mui/material/GlobalStyles";
import theme from "./theme";

// Plain-element defaults the pages are laid out against: no default margins on text blocks,
// unstyled lists, headings that take their size from the surrounding text, collapsed tables
const baseStyles = {
  // Base font size: browser default 16px + 2px. Every rem-based size (MUI typography and the
  // fontSize values in sx) scales from this.
  html: { fontSize: "18px" },
  "h1, h2, h3, h4, h5, h6, p, figure, blockquote, dl, dd": { margin: 0 },
  "h1, h2, h3, h4, h5, h6": { fontSize: "inherit", fontWeight: "inherit" },
  "ul, ol": { margin: 0, padding: 0, listStyle: "none" },
  "img, svg, video, canvas": { display: "block", verticalAlign: "middle" },
  "img, video": { maxWidth: "100%", height: "auto" },
  a: { color: "inherit", textDecoration: "inherit" },
  table: { borderCollapse: "collapse", textIndent: 0, borderColor: "inherit" },
  "button, input, optgroup, select, textarea": { fontFamily: "inherit", fontSize: "100%", color: "inherit", margin: 0 },
};
const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;


ReactDOM.createRoot(document.getElementById("root")).render(
  <GoogleOAuthProvider clientId={clientId}>
    <Provider store={store}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <GlobalStyles styles={baseStyles} />
        <App />
      </ThemeProvider>
    </Provider>
  </GoogleOAuthProvider>

);
