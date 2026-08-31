import React, { useState, useEffect } from "react";

const TermsContent = () => (
    <div className="space-y-5 text-sm text-gray-700 leading-relaxed">
        <p className="text-xs text-gray-400">
            EconWebCast · Owned and operated by WKAM Group LLC, Texas · Version 1.0
        </p>

        <section>
            <h3 className="font-semibold text-gray-800 mb-1">1. Acceptance of Terms</h3>
            <p>
                By signing in and using EconWebCast (the "Application"), you agree to these
                Terms of Service and to our Privacy Policy. If you do not agree, please do not
                use the Application.
            </p>
        </section>

        <section>
            <h3 className="font-semibold text-gray-800 mb-1">2. What EconWebCast Does</h3>
            <p>
                EconWebCast is a web-based tool that lets you upload your own tabular research
                data (CSV files) and run statistical and machine-learning models on it. It
                supports your analysis but does not replace your judgment as a researcher about
                which model is appropriate for your question.
            </p>
        </section>

        <section>
            <h3 className="font-semibold text-gray-800 mb-1">
                3. Your Responsibility for Uploaded Data
            </h3>
            <p className="mb-2">
                EconWebCast is a public application. It does not screen, vet, or verify the
                content of any file you upload. By uploading a file, you confirm that:
            </p>
            <ul className="list-disc pl-5 space-y-1">
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
            <h3 className="font-semibold text-gray-800 mb-1">4. Data Storage</h3>
            <p>
                Uploaded files are stored only for the duration of your active session and are
                used to generate the analysis, statistics, and exports you request.
            </p>
        </section>

        <section>
            <h3 className="font-semibold text-gray-800 mb-1">5. No Warranty</h3>
            <p>
                EconWebCast is provided "as is" and "as available," without warranties of any
                kind, express or implied. We do not guarantee that any method, model, or output
                is correct, complete, or suitable for your specific research purpose. You are
                responsible for reviewing, validating, and interpreting all results before
                relying on them.
            </p>
        </section>

        <section>
            <h3 className="font-semibold text-gray-800 mb-1">6. Limitation of Liability</h3>
            <p>
                To the fullest extent permitted by law, WKAM Group LLC and EconWebCast shall not
                be liable for any indirect, incidental, or consequential damages, or for any
                loss of data, arising from your use of the Application.
            </p>
        </section>

        <section>
            <h3 className="font-semibold text-gray-800 mb-1">7. Acceptable Use</h3>
            <p>
                You agree not to use EconWebCast to upload data you are not authorized to use,
                to attempt to disrupt or gain unauthorized access to the Application or its
                infrastructure, or to use the service for any unlawful purpose.
            </p>
        </section>

        <section>
            <h3 className="font-semibold text-gray-800 mb-1">8. Changes to These Terms</h3>
            <p>
                EconWebCast is under active development. We may update these Terms from time to
                time; continued use of the Application after changes take effect constitutes
                acceptance of the revised Terms.
            </p>
        </section>

        <section>
            <h3 className="font-semibold text-gray-800 mb-1">9. Contact</h3>
            <p>
                Questions about these Terms can be sent to{" "}
                <a href="mailto:kbretmanna@gmail.com" className="underline">
                    kbretmanna@gmail.com
                </a>
                .
            </p>
        </section>
    </div>
);

const PrivacyContent = () => (
    <div className="space-y-5 text-sm text-gray-700 leading-relaxed">
        <p className="text-xs text-gray-400">
            EconWebCast · Owned and operated by WKAM Group LLC, Texas · Version 1.0
        </p>

        <section>
            <h3 className="font-semibold text-gray-800 mb-1">1. Information We Collect</h3>
            <ul className="list-disc pl-5 space-y-1">
                <li>
                    <span className="font-medium">Account information:</span> your name, email
                    address, and profile details provided by Google when you sign in.
                </li>
                <li>
                    <span className="font-medium">Uploaded data:</span> the CSV files and column
                    selections you provide during a session, used solely to run the analysis you
                    request.
                </li>
                <li>
                    <span className="font-medium">Consent record:</span> a record that you agreed
                    to these Terms and this Privacy Policy, including your account identifier and
                    the date/time of agreement.
                </li>
            </ul>
        </section>

        <section>
            <h3 className="font-semibold text-gray-800 mb-1">2. How We Use Your Information</h3>
            <p>
                We use this information to authenticate you, run the statistical models and
                exports you request, and maintain a record that you agreed to our Terms. We do
                not sell your data or your uploaded files to third parties.
            </p>
        </section>

        <section>
            <h3 className="font-semibold text-gray-800 mb-1">3. How Long We Keep Data</h3>
            <ul className="list-disc pl-5 space-y-1">
                <li>
                    <span className="font-medium">Uploaded CSV files:</span> retained only for
                    the duration of your active session, and not persisted afterward.
                </li>
                <li>
                    <span className="font-medium">Account and consent records:</span> retained
                    for as long as needed to operate the Application and maintain a record of
                    your agreement to these terms.
                </li>
            </ul>
        </section>

        <section>
            <h3 className="font-semibold text-gray-800 mb-1">4. Where Data Is Stored</h3>
            <p>
                Account and consent records are stored using MongoDB Atlas, a managed database
                provider. The Application backend runs on Render. Data in transit is encrypted
                using standard HTTPS/TLS.
            </p>
        </section>

        <section>
            <h3 className="font-semibold text-gray-800 mb-1">5. Third-Party Services</h3>
            <p>
                We use Google Sign-In for authentication. Your use of Google Sign-In is also
                subject to Google's own privacy policy. We use Render and MongoDB Atlas as
                infrastructure providers to run and store data for the Application.
            </p>
        </section>

        <section>
            <h3 className="font-semibold text-gray-800 mb-1">6. Your Responsibility</h3>
            <p>
                EconWebCast does not screen uploaded files for sensitive or personal information.
                Please avoid uploading data you are not authorized to share, and use anonymized
                identifiers where possible. See our Terms of Service for more detail.
            </p>
        </section>

        <section>
            <h3 className="font-semibold text-gray-800 mb-1">7. Changes to This Policy</h3>
            <p>
                We may update this Privacy Policy as the Application evolves. Continued use of
                EconWebCast after changes take effect constitutes acceptance of the revised
                policy.
            </p>
        </section>

        <section>
            <h3 className="font-semibold text-gray-800 mb-1">8. Contact</h3>
            <p>
                Questions about this Privacy Policy can be sent to{" "}
                <a href="mailto:kbretmanna@gmail.com" className="underline">
                    kbretmanna@gmail.com
                </a>
                .
            </p>
        </section>
    </div>
);

const LegalModal = ({ isOpen, onClose, initialTab = "terms" }) => {
    const [activeTab, setActiveTab] = useState(initialTab);

    useEffect(() => {
        if (isOpen) setActiveTab(initialTab);
    }, [isOpen, initialTab]);

    if (!isOpen) return null;

    return (
        <div
            className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
            onClick={onClose}
        >
            <div
                className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[85vh] flex flex-col"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-center justify-between border-b px-6 py-4">
                    <div className="flex gap-4">
                        <button
                            onClick={() => setActiveTab("terms")}
                            className={`text-sm font-medium pb-1 border-b-2 transition-colors ${
                                activeTab === "terms"
                                    ? "border-gray-800 text-gray-800"
                                    : "border-transparent text-gray-400 hover:text-gray-600"
                            }`}
                        >
                            Terms of Service
                        </button>
                        <button
                            onClick={() => setActiveTab("privacy")}
                            className={`text-sm font-medium pb-1 border-b-2 transition-colors ${
                                activeTab === "privacy"
                                    ? "border-gray-800 text-gray-800"
                                    : "border-transparent text-gray-400 hover:text-gray-600"
                            }`}
                        >
                            Privacy Policy
                        </button>
                    </div>
                    <button
                        onClick={onClose}
                        aria-label="Close"
                        className="text-gray-400 hover:text-gray-600 text-xl leading-none"
                    >
                        ×
                    </button>
                </div>

                {/* Body */}
                <div className="overflow-y-auto px-6 py-5">
                    {activeTab === "terms" ? <TermsContent /> : <PrivacyContent />}
                </div>

                {/* Footer */}
                <div className="border-t px-6 py-3 flex justify-end">
                    <button
                        onClick={onClose}
                        className="text-sm bg-gray-800 text-white px-4 py-2 rounded hover:bg-gray-700"
                    >
                        Close
                    </button>
                </div>
            </div>
        </div>
    );
};

export default LegalModal;
