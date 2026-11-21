import React, { useEffect, useState } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import IconButton from "@mui/material/IconButton";
import Typography from "@mui/material/Typography";
import CloseIcon from "@mui/icons-material/Close";

const VERDICT_STYLES = {
  positive: { bgcolor: "emerald.50", borderColor: "emerald.200", color: "emerald.950" },
  mixed: { bgcolor: "amber.50", borderColor: "amber.200", color: "amber.950" },
  caution: { bgcolor: "amber.50", borderColor: "amber.200", color: "amber.950" },
  neutral: { bgcolor: "gray.50", borderColor: "gray.200", color: "gray.900" },
};

const BADGE_STYLES = {
  positive: { bgcolor: "emerald.100", color: "emerald.800" },
  caution: { bgcolor: "amber.100", color: "amber.800" },
  negative: { bgcolor: "red.100", color: "red.800" },
  neutral: { bgcolor: "gray.100", color: "gray.600" },
};

const itemSx = { fontSize: "0.875rem", color: "gray.700", lineHeight: 1.625 };

function Item({ item }) {
  if (typeof item === "string") return <Box component="li" sx={itemSx}>{item}</Box>;
  return (
    <Box component="li" sx={itemSx}>
      {(item.label || item.badge) && (
        <Box sx={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 1, mb: 0.25 }}>
          {item.label && <Box component="span" sx={{ fontWeight: 600, color: "gray.900" }}>{item.label}</Box>}
          {item.badge && (
            <Box component="span" sx={{ px: 1, py: 0.25, borderRadius: 1, fontSize: "0.75rem", fontWeight: 500, ...(BADGE_STYLES[item.badge.tone] || BADGE_STYLES.neutral) }}>
              {item.badge.label}
            </Box>
          )}
        </Box>
      )}
      <div>{item.text}</div>
      {item.detail && <Box sx={{ fontSize: "0.75rem", color: "gray.400", fontVariantNumeric: "tabular-nums", mt: 0.25 }}>{item.detail}</Box>}
    </Box>
  );
}

export default function AnalysisModal({ open, onClose, report, copyText, children }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => { if (!open) setCopied(false); }, [open]);

  if (!open || !report) return null;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(copyText);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  // Dialog handles the backdrop, Escape, focus trapping, scroll lock and returning focus
  return (
    <Dialog
      open
      onClose={onClose}
      fullWidth
      maxWidth="md"
      aria-labelledby="analysis-modal-title"
      slotProps={{
        backdrop: { sx: { bgcolor: "rgba(17,24,39,0.4)" } },
        paper: { sx: { maxWidth: 768, maxHeight: "90vh", m: 2, borderRadius: 3 } },
      }}
    >
      <Box sx={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 2, px: 3, pt: 2.5, pb: 1.5, borderBottom: 1, borderColor: "gray.100" }}>
        <div>
          <Typography variant="h2" id="analysis-modal-title" sx={{ fontSize: "1.125rem", fontWeight: 700, color: "gray.900" }}>{report.title}</Typography>
          {report.subtitle && <Typography variant="body2" sx={{ color: "gray.500", mt: 0.25 }}>{report.subtitle}</Typography>}
        </div>
        <IconButton autoFocus onClick={onClose} aria-label="Close" size="small" sx={{ color: "gray.400", mt: -0.5, "&:hover": { color: "gray.700" } }}>
          <CloseIcon />
        </IconButton>
      </Box>

      <DialogContent sx={{ px: 3, py: 2, display: "flex", flexDirection: "column", gap: 2.5 }}>
        {report.verdict?.text && (
          <Box sx={{ border: 1, borderRadius: 2, px: 2, py: 1.5, ...(VERDICT_STYLES[report.verdict.tone] || VERDICT_STYLES.neutral) }}>
            <Box sx={{ fontSize: "0.75rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", opacity: 0.7, mb: 0.25 }}>Takeaway</Box>
            <Box sx={{ fontSize: "0.875rem", fontWeight: 500, lineHeight: 1.625 }}>{report.verdict.text}</Box>
          </Box>
        )}

        {(report.sections ?? []).filter((s) => s.items?.length).map((s) => (
          <section key={s.heading}>
            <Typography variant="h3" sx={{ fontSize: "0.875rem", fontWeight: 700, color: "gray.800", mb: 1 }}>{s.heading}</Typography>
            <Box component="ul" sx={{ m: 0, listStyle: "disc", pl: 2.5, "& > li + li": { mt: 1.25 }, "& li::marker": { color: "gray.300" } }}>
              {s.items.map((it, i) => <Item key={i} item={it} />)}
            </Box>
          </section>
        ))}

        {children}
      </DialogContent>

      <DialogActions sx={{ gap: 1, px: 3, py: 1.5, borderTop: 1, borderColor: "gray.100" }}>
        {copyText && (
          <Button
            variant="outlined"
            onClick={handleCopy}
            sx={{ px: 1.5, py: 0.75, fontSize: "0.875rem", fontWeight: 600, borderColor: "gray.300", bgcolor: "common.white", color: "gray.700", "&:hover": { borderColor: "gray.300", bgcolor: "gray.50" } }}
          >
            {copied ? "Copied ✓" : "📋 Copy summary"}
          </Button>
        )}
        <Button
          variant="contained"
          onClick={onClose}
          sx={{ px: 2, py: 0.75, fontSize: "0.875rem", fontWeight: 600, bgcolor: "gray.800", "&:hover": { bgcolor: "gray.700" } }}
        >
          Close
        </Button>
      </DialogActions>
    </Dialog>
  );
}
