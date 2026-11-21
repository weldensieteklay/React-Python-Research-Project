import React, { useState, useEffect } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import IconButton from "@mui/material/IconButton";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import CloseIcon from "@mui/icons-material/Close";

// Typography for the legal text: section headings, paragraphs, bullet lists and links
const LegalBody = ({ children }) => (
    <Box
        sx={{
            fontSize: "0.875rem", color: "gray.700", lineHeight: 1.625,
            "& > * + *": { mt: 2.5 },
            "& h3": { fontSize: "inherit", fontWeight: 600, color: "gray.800", mt: 0, mb: 0.5 },
            "& p": { m: 0 },
            "& p + ul": { mt: 1 },
            "& ul": { listStyle: "disc", pl: 2.5, my: 0 },
            "& li + li": { mt: 0.5 },
            "& b": { fontWeight: 500 },
            "& a": { color: "inherit", textDecoration: "underline" },
        }}
    >
        {children}
    </Box>
);

const TermsContent = () => (
    <LegalBody>
        <Box component="p" sx={{ fontSize: "0.75rem", color: "gray.400" }}>
            EconWebCast · Owned and operated by WKAM Group LLC, Texas · Version 1.0
        </Box>

        <section>
            <h3>1. Acceptance of Terms</h3>
            <p>
                By signing in and using EconWebCast (the "Application"), you agree to these
                Terms of Service and to our Privacy Policy. If you do not agree, please do not
                use the Application.
            </p>
        </section>

        <section>
            <h3>2. What EconWebCast Does</h3>
            <p>
                EconWebCast is a web-based tool that lets you upload your own tabular research
                data (CSV files) and run statistical and machine-learning models on it. It
                supports your analysis but does not replace your judgment as a researcher about
                which model is appropriate for your question.
            </p>
        </section>

        <section>
            <h3>
                3. Your Responsibility for Uploaded Data
            </h3>
            <p>
                EconWebCast is a public application. It does not screen, vet, or verify the
                content of any file you upload. By uploading a file, you confirm that:
            </p>
            <ul>
                <li>
                    You have the right to use and upload that data, and doing so does not
                    violate any agreement, law, or policy that applies to you (including
                    institutional data-sharing or IRB requirements).
                </li>
                <li>
                    You take full responsibility for any personal, confidential, or sensitive
                    information in the file. Where possible, use a coded or anonymized ID
                    instead of real names or other identifying information.
                </li>
                <li>
                    We recommend using public or non-sensitive test data where possible,
                    particularly while exploring the platform.
                </li>
            </ul>
        </section>

        <section>
            <h3>4. Data Storage</h3>
            <p>
                Uploaded files are stored only for the duration of your active session and are
                used to generate the analysis, statistics, and exports you request.
            </p>
        </section>

        <section>
            <h3>5. No Warranty</h3>
            <p>
                EconWebCast is provided "as is" and "as available," without warranties of any
                kind, express or implied. We do not guarantee that any method, model, or output
                is correct, complete, or suitable for your specific research purpose. You are
                responsible for reviewing, validating, and interpreting all results before
                relying on them.
            </p>
        </section>

        <section>
            <h3>6. Limitation of Liability</h3>
            <p>
                To the fullest extent permitted by law, WKAM Group LLC and EconWebCast shall not
                be liable for any indirect, incidental, or consequential damages, or for any
                loss of data, arising from your use of the Application.
            </p>
        </section>

        <section>
            <h3>7. Acceptable Use</h3>
            <p>
                You agree not to use EconWebCast to upload data you are not authorized to use,
                to attempt to disrupt or gain unauthorized access to the Application or its
                infrastructure, or to use the service for any unlawful purpose.
            </p>
        </section>

        <section>
            <h3>8. Changes to These Terms</h3>
            <p>
                EconWebCast is under active development. We may update these Terms from time to
                time; continued use of the Application after changes take effect constitutes
                acceptance of the revised Terms.
            </p>
        </section>

        <section>
            <h3>9. Contact</h3>
            <p>
                Questions about these Terms can be sent to{" "}
                <a href="mailto:kbretmanna@gmail.com">
                    kbretmanna@gmail.com
                </a>
                .
            </p>
        </section>
    </LegalBody>
);

const PrivacyContent = () => (
    <LegalBody>
        <Box component="p" sx={{ fontSize: "0.75rem", color: "gray.400" }}>
            EconWebCast · Owned and operated by WKAM Group LLC, Texas · Version 1.0
        </Box>

        <section>
            <h3>1. Information We Collect</h3>
            <ul>
                <li>
                    <b>Account information:</b> your name, email
                    address, and profile details provided by Google when you sign in.
                </li>
                <li>
                    <b>Uploaded data:</b> the CSV files and column
                    selections you provide during a session, used solely to run the analysis you
                    request.
                </li>
                <li>
                    <b>Consent record:</b> a record that you agreed
                    to these Terms and this Privacy Policy, including your account identifier and
                    the date/time of agreement.
                </li>
            </ul>
        </section>

        <section>
            <h3>2. How We Use Your Information</h3>
            <p>
                We use this information to authenticate you, run the statistical models and
                exports you request, and maintain a record that you agreed to our Terms. We do
                not sell your data or your uploaded files to third parties.
            </p>
        </section>

        <section>
            <h3>3. How Long We Keep Data</h3>
            <ul>
                <li>
                    <b>Uploaded CSV files:</b> retained only for
                    the duration of your active session, and not persisted afterward.
                </li>
                <li>
                    <b>Account and consent records:</b> retained
                    for as long as needed to operate the Application and maintain a record of
                    your agreement to these terms.
                </li>
            </ul>
        </section>

        <section>
            <h3>4. Where Data Is Stored</h3>
            <p>
                Account and consent records are stored using MongoDB Atlas, a managed database
                provider. The Application backend runs on Render. Data in transit is encrypted
                using standard HTTPS/TLS.
            </p>
        </section>

        <section>
            <h3>5. Third-Party Services</h3>
            <p>
                We use Google Sign-In for authentication. Your use of Google Sign-In is also
                subject to Google's own privacy policy. We use Render and MongoDB Atlas as
                infrastructure providers to run and store data for the Application.
            </p>
        </section>

        <section>
            <h3>6. Your Responsibility</h3>
            <p>
                EconWebCast does not screen uploaded files for sensitive or personal information.
                Please avoid uploading data you are not authorized to share, and use anonymized
                identifiers where possible. See our Terms of Service for more detail.
            </p>
        </section>

        <section>
            <h3>7. Changes to This Policy</h3>
            <p>
                We may update this Privacy Policy as the Application evolves. Continued use of
                EconWebCast after changes take effect constitutes acceptance of the revised
                policy.
            </p>
        </section>

        <section>
            <h3>8. Contact</h3>
            <p>
                Questions about this Privacy Policy can be sent to{" "}
                <a href="mailto:kbretmanna@gmail.com">
                    kbretmanna@gmail.com
                </a>
                .
            </p>
        </section>
    </LegalBody>
);

const LegalModal = ({ isOpen, onClose, initialTab = "terms" }) => {
    const [activeTab, setActiveTab] = useState(initialTab);

    useEffect(() => {
        if (isOpen) setActiveTab(initialTab);
    }, [isOpen, initialTab]);

    const tabSx = { minHeight: 0, minWidth: 0, p: 0, pb: 0.5, fontSize: "0.875rem", fontWeight: 500, color: "gray.400", "&:hover": { color: "gray.600" }, "&.Mui-selected": { color: "gray.800" } };

    return (
        <Dialog
            open={isOpen}
            onClose={onClose}
            fullWidth
            maxWidth="md"
            slotProps={{
                backdrop: { sx: { bgcolor: "rgba(0,0,0,0.4)" } },
                paper: { sx: { maxWidth: 672, maxHeight: "85vh", m: 2, borderRadius: 2 } },
            }}
        >
            {/* Header */}
            <DialogTitle sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: 1, borderColor: "gray.200", px: 3, py: 2 }}>
                <Tabs
                    value={activeTab}
                    onChange={(_, tab) => setActiveTab(tab)}
                    sx={{ minHeight: 0, "& .MuiTabs-flexContainer": { gap: 2 }, "& .MuiTabs-indicator": { bgcolor: "gray.800" } }}
                >
                    <Tab value="terms" label="Terms of Service" disableRipple sx={tabSx} />
                    <Tab value="privacy" label="Privacy Policy" disableRipple sx={tabSx} />
                </Tabs>
                <IconButton onClick={onClose} aria-label="Close" size="small" sx={{ color: "gray.400", "&:hover": { color: "gray.600" } }}>
                    <CloseIcon fontSize="small" />
                </IconButton>
            </DialogTitle>

            {/* Body */}
            <DialogContent sx={{ px: 3, py: 2.5 }}>
                {activeTab === "terms" ? <TermsContent /> : <PrivacyContent />}
            </DialogContent>

            {/* Footer */}
            <DialogActions sx={{ borderTop: 1, borderColor: "gray.200", px: 3, py: 1.5 }}>
                <Button
                    variant="contained"
                    onClick={onClose}
                    sx={{ fontSize: "0.875rem", bgcolor: "gray.800", px: 2, py: 1, borderRadius: 1, "&:hover": { bgcolor: "gray.700" } }}
                >
                    Close
                </Button>
            </DialogActions>
        </Dialog>
    );
};

export default LegalModal;
