import Button from "@mui/material/Button";
import FileDownloadOutlinedIcon from "@mui/icons-material/FileDownloadOutlined";

// Downloads the full platform user guide (PDF) served from /public.
// Placed alongside the "Guide Me" button on each screen.
const UserGuideButton = ({ sx }) => (
    <Button
        href="/user-guide.pdf"
        download="AI-Powered-Data-Analysis-User-Guide.pdf"
        title="Download the full user guide (PDF)"
        size="small"
        startIcon={<FileDownloadOutlinedIcon fontSize="small" />}
        sx={[
            { bgcolor: "common.white", color: "common.black", borderRadius: 2, boxShadow: 1, px: 1.5, "&:hover": { bgcolor: "gray.100" } },
            ...(Array.isArray(sx) ? sx : [sx]),
        ]}
    >
        User Guide
    </Button>
);

export default UserGuideButton;
