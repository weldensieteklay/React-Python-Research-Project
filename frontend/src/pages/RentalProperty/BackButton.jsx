import React from "react";
import IconButton from "@mui/material/IconButton";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";

/** Top-left back button used on every full-screen page. */
export default function BackButton({ onClick, label = "Back" }) {
  return (
    <IconButton
      onClick={onClick}
      aria-label={label}
      title={label}
      sx={{ flexShrink: 0, ml: -1, color: "gray.700", "&:hover": { bgcolor: "gray.200", color: "gray.900" } }}
    >
      <ArrowBackIcon />
    </IconButton>
  );
}
