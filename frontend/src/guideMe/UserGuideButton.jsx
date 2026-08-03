import { ArrowDownTrayIcon } from "@heroicons/react/24/outline";

// Downloads the full platform user guide (PDF) served from /public.
// Placed alongside the "Guide Me" button on each screen.
const UserGuideButton = ({ className = "" }) => (
    <a
        href="/user-guide.pdf"
        download="AI-Powered-Data-Analysis-User-Guide.pdf"
        title="Download the full user guide (PDF)"
        className={className}
    >
        <ArrowDownTrayIcon className="h-4 w-4" />
        <span className="font-medium">User Guide</span>
    </a>
);

export default UserGuideButton;
