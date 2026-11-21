import React, { useEffect, useId, useMemo, useState } from "react";
import { useFetchData } from "../../hooks/useFetchData";
import { DFW_METRO } from "./useRentMetro";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import Link from "@mui/material/Link";
import NativeSelect from "@mui/material/NativeSelect";
import OutlinedInput from "@mui/material/OutlinedInput";
import Paper from "@mui/material/Paper";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import InfoIcon from "@mui/icons-material/Info";
import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import { pulse } from "../../theme";

const blueLinkSx = { fontWeight: 600, color: "blue.700", "&:hover": { color: "blue.900" } };
const focusRing = { outline: "none", "&:focus-visible, &.Mui-focusVisible": { boxShadow: (t) => `0 0 0 2px ${t.palette.blue[500]}` } };
const chipSx = { px: 1, py: 0.25, borderRadius: 1, fontSize: "0.75rem", fontWeight: 500 };
const smallHeadSx = { fontSize: "0.875rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.025em", color: "gray.600" };
const bulletListSx = { mt: 0.75, listStyle: "disc", pl: 2.5, fontSize: "0.875rem", color: "gray.700", "& > li + li": { mt: 0.5 } };
const cardSx = { border: 1, borderColor: "gray.200", borderRadius: 2, bgcolor: "gray.50" };
const smallPrintSx = { color: "gray.500", lineHeight: 1.625 };
const driverTitleSx = { fontSize: "1rem", fontWeight: 600, color: "gray.900" };
const driverFigureSx = { mt: 0.5, color: "gray.700", fontVariantNumeric: "tabular-nums" };
const driverResearchSx = { mt: 1, color: "gray.600", lineHeight: 1.625 };
/** Chevron that turns when the <details> around its <summary> opens */
const summaryChevronSx = { fontSize: 16, transition: "transform 150ms", "details[open] > summary > &": { transform: "rotate(90deg)" } };

// ===========================================================================
// "What drives rents here?" for the rental dashboard.
//
//   <RentDriversSection metro={metro} areaName="DFW" rows={actualRows} asPage />
//
// asPage: the section fills its own page (RentalDashboard's "drivers" page supplies the title and
// the back arrow), so it is always open and has no header of its own. Without asPage it is a
// collapsible card with a Show button. Neighborhood data is loaded the first time it is open.
//
// For a county the viewer picks, each driver shows the county's value next to the metro's
// typical (median) value, what published research says about that driver, and a
// link to the source. Values come from data/dfw-zip-covariates (U.S. Census) and the rent
// rows (Zillow, plus the national mortgage rate). A county's value is the median of its ZIPs.
// These are associations from research, not a forecast or proof of cause for one area.
//
// Below the drivers, "Local market report" is marked Pending (paid version) and offers every
// viewer sample reports for Collin, Dallas and Denton counties (SAMPLE_REPORTS). While
// REPORTS_LIVE is false, no AI or extra endpoint is used.
// ===========================================================================

// Shares may arrive as fractions (0.42) or percents (42); treat values up to 1.5 as fractions
const asPct = (v) => (Math.abs(v) <= 1.5 ? v * 100 : v);
const median = (xs) => {
    const v = xs.filter((x) => typeof x === "number" && Number.isFinite(x)).sort((a, b) => a - b);
    if (!v.length) return null;
    const m = Math.floor(v.length / 2);
    return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};
const num = (v) => (v == null || v === "" ? NaN : Number(v));
const usd = (v) => `$${Math.round(v).toLocaleString("en-US")}`;

// Each driver: where its value comes from, how to show it, and what the research says
const DRIVERS = [
    {
        key: "median_household_income",
        name: "Household income",
        format: usd,
        higher: "Higher than the metro", lower: "Lower than the metro",
        research: "Strong demand from higher-income renter households has kept rents high. Higher-income areas usually support higher rents.",
        source: { label: "Harvard JCHS, State of the Nation's Housing 2024 (summary by HUD USER)", url: "https://jchs.harvard.edu/state-nations-housing-2024" },
    },
    {
        key: "new_build_share",
        name: "Share of homes built since 2020",
        format: (v) => `${asPct(v).toFixed(1)}%`,
        higher: "More new housing than the metro", lower: "Less new housing than the metro",
        research: "New apartment buildings lowered rents in nearby units by about 6% compared with units slightly farther away. More new supply usually slows local rent growth.",
        source: { label: "Asquith, Mast & Reed (2023), Review of Economics and Statistics", url: "https://ideas.repec.org/a/tpr/restat/v105y2023i2p359-375.html" },
    },
    {
        key: "renter_stock_growth",
        name: "Growth in rented homes since 2019",
        format: (v) => `${asPct(v) >= 0 ? "+" : ""}${asPct(v).toFixed(1)}%`,
        higher: "Faster growth than the metro", lower: "Slower growth than the metro",
        research: "Rental markets cooled as a decades-high volume of new supply came online and outpaced demand. Where the rental stock grows faster, rent growth tends to slow.",
        source: { label: "Harvard JCHS, America's Rental Housing 2024", url: "https://jchs.harvard.edu/blog/six-takeaways-americas-rental-housing-2024" },
    },
    {
        key: "dist_downtown_mi",
        name: "Distance to downtown",
        format: (v) => `${v.toFixed(1)} mi`,
        higher: "Farther out than the typical ZIP", lower: "Closer in than the typical ZIP",
        research: "Rents usually fall with distance from downtown. In the pandemic, rents fell in city centers and rose farther out, erasing about 80% of the urban rent premium by the end of 2020.",
        source: { label: "Gupta, Mittal, Peeters & Van Nieuwerburgh (2022), NBER / Journal of Financial Economics", url: "https://doi.org/10.3386/w28675" },
    },
    {
        key: "pop_density_sqmi",
        name: "Population density",
        format: (v) => `${Math.round(v).toLocaleString("en-US")} per sq mi`,
        higher: "Denser than the metro", lower: "Less dense than the metro",
        research: "Dense areas usually command higher rents, but the pandemic turned density into a drawback for many renters, and rents in denser, more central areas fell relative to suburbs.",
        source: { label: "NBER research summary: how urban rent gradients flattened during the pandemic", url: "https://www.nber.org/research/videos/2021-stijn-van-nieuwerburgh-how-urban-rent-gradients-have-flattened-during-pandemic" },
    },
];

const MORTGAGE = {
    name: "30-year mortgage rate (national)",
    research: "High interest rates have dampened rental market activity: they make new rental projects harder to finance and slowed multifamily construction, which affects future supply.",
    source: { label: "Harvard JCHS, America's Rental Housing 2024", url: "https://jchs.harvard.edu/blog/six-takeaways-americas-rental-housing-2024" },
};

function compare(area, metro) {
    if (!Number.isFinite(area) || !Number.isFinite(metro) || metro === 0) return "same";
    const ratio = area / metro;
    return ratio > 1.05 ? "higher" : ratio < 0.95 ? "lower" : "same";
}

function SourceLink({ source }) {
    return (
        <Link href={source.url} target="_blank" rel="noopener noreferrer" title={source.label}
            aria-label={`See more details: ${source.label} (opens in a new tab)`}
            underline="hover"
            sx={{ display: "inline-block", mt: 1, fontSize: "0.875rem", ...blueLinkSx }}>
            See more details ↗
        </Link>
    );
}

// Shown by the (i) icon next to the title. Update it when how the section is refreshed changes.
const UPDATE_NOTE = "Neighborhood values update with each new Census and Zillow release. Automated local market reports for every county are currently in development.";


/** An (i) icon that shows `text` on hover or keyboard focus, and on tap (phones). */
function InfoTip({ text }) {
    return (
        <Tooltip title={text} arrow describeChild enterTouchDelay={0} leaveTouchDelay={5000}
                 slotProps={{ tooltip: { sx: { maxWidth: 256, bgcolor: "gray.900", px: 1.5, py: 1, fontSize: "0.875rem", fontWeight: 400, boxShadow: 6 } }, arrow: { sx: { color: "gray.900" } } }}>
            <IconButton aria-label="About these drivers" size="small"
                        sx={{ p: 0, color: "blue.700", "&:hover": { color: "blue.900", bgcolor: "transparent" }, ...focusRing }}>
                <InfoIcon sx={{ fontSize: 20 }} />
            </IconButton>
        </Tooltip>
    );
}

/** A short "how we use AI" note under a section heading: sparkle icon, soft violet callout. */
function AiNote({ children }) {
    return (
        <Box component="p" sx={{ mt: 1, display: "flex", alignItems: "flex-start", gap: 1, borderRadius: 1.5, borderLeft: 4, borderColor: "violet.400", bgcolor: "violet.50", px: 1.5, py: 1, fontSize: "0.875rem", color: "violet.900", lineHeight: 1.625 }}>
            <AutoAwesomeIcon aria-hidden="true" sx={{ mt: 0.25, fontSize: 16, flexShrink: 0, color: "violet.600" }} />
            <span>{children}</span>
        </Box>
    );
}

// Direction chips used by the local market report
const DIRECTION = {
    up: { text: "Pushing rents up", tone: { bgcolor: "red.50", color: "red.800" } },
    down: { text: "Pushing rents down", tone: { bgcolor: "green.50", color: "green.800" } },
    mixed: { text: "Mixed effect", tone: { bgcolor: "gray.200", color: "gray.700" } },
};
const shortDate = (d) => {
    if (!d) return "";
    const t = new Date(`${d.slice(0, 10)}T00:00:00`);
    return Number.isNaN(t.getTime()) ? "" : t.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
};

// ---------------------------------------------------------------------------
// "Local market report": what local news and published reports say is driving rents in a
// county, with numbered references. Pending for now: full reports for every county come with
// the paid version. Every viewer, in any metro, can open the sample reports below (Collin,
// Dallas and Denton counties), each collapsed until clicked.
// To refresh a sample, edit it below. The paid version's /rent-report endpoint returns the same format.
// ---------------------------------------------------------------------------
const COLLIN_SAMPLE = {
    id: "collin",
    county: "Collin County",
    metro: DFW_METRO,
    place: "Collin County, Dallas-Fort Worth, Texas",
    as_of: "2026-11-12",
    overall:
        "Strong demand from population growth, new jobs, highly rated schools and the high cost of buying a home is being " +
        "outweighed by a large wave of new apartments, so rents are flat to falling. Market reports expect apartment vacancy " +
        "to peak in 2026 and construction to slow sharply through 2027, which could let rents firm up later.",
    drivers: [
        {
            id: "new_supply", name: "New apartment construction", direction: "down", strength: "Strongest driver",
            points: [
                { text: "In the Allen/McKinney submarket, 8.4% of stabilized apartments are vacant and effective rent (after concessions) is about $1,446, down 7.1% from a year earlier.", refs: [1] },
                { text: "About 8,071 apartments are under construction in Frisco (93.0% of existing units occupied) and about 4,937 in Allen/McKinney (92.9% occupied).", refs: [2] },
                { text: "Frisco/Prosper and Allen/McKinney are the DFW submarkets under the most pressure from new supply. Across DFW, vacancy is about 12.2% and rents are down 2.1% from a year earlier.", refs: [3] },
                { text: "The wave is ending: vacancy is expected to peak in 2026, and the Texas A&M Real Estate Research Center forecasts a sharp pullback in apartment construction through summer 2027.", refs: [3, 6] },
            ],
        },
        {
            id: "concessions", name: "Move-in concessions", direction: "down",
            points: [
                { text: "The Federal Reserve Bank of Dallas expects landlords to keep offering concessions, such as free weeks of rent, through mid-2026, holding back rent growth.", refs: [4] },
                { text: "Landlords in fast-growing far-north areas such as Celina, Melissa and Princeton have been adding concessions to fill new buildings (2024 reporting).", refs: [5] },
            ],
        },
        {
            id: "policy", name: "State zoning law (SB 840)", direction: "down", strength: "Longer-term effect",
            points: [
                { text: "Since September 1, 2025, Texas cities must allow apartments in zones that allow offices, at up to 36 units per acre.", refs: [7] },
                { text: "McKinney, Plano and Frisco have rewritten their development codes in response. Over time, the law could add apartment supply.", refs: [8, 9] },
            ],
        },
        {
            id: "jobs_population", name: "Population and job growth", direction: "up",
            points: [
                { text: "Collin County added the second-most residents of any U.S. county last year, and Princeton was named the nation's fastest-growing city.", refs: [10] },
                { text: "Census estimates show the county grew by 46,694 people between July 2023 and July 2024, to about 1.25 million.", refs: [10] },
                { text: "Globe Life is moving its headquarters and about 3,000 jobs to McKinney; AT&T, Samsung and Toyota add to office demand in Plano, Frisco and McKinney.", refs: [11, 12] },
            ],
        },
        {
            id: "schools", name: "Highly rated schools", direction: "up",
            points: [
                { text: "2024-25 Texas Education Agency ratings: Allen ISD A (91), Prosper ISD A (91), Frisco ISD A (90), McKinney ISD B (88), Celina ISD B (87), Plano ISD B (82) and Anna ISD C (78).", refs: [13, 14] },
                { text: "Strong school districts draw families, which supports demand for larger apartments and single-family rentals.", refs: [] },
            ],
        },
        {
            id: "health", name: "Growing hospital and health care capacity", direction: "up", strength: "Shown for context",
            points: [
                { text: "Texas Health is building a 60-bed hospital in north McKinney, expected to open in 2028; the city approved its zoning in December 2025.", refs: [15, 16] },
                { text: "Other projects include Medical City McKinney's $142 million expansion, 30 new patient rooms at Texas Health Frisco, a $343 million expansion at Texas Health Plano, and Methodist's hospital in Celina.", refs: [17, 18, 19, 20] },
                { text: "Hospitals are major employers and a daily-life amenity; research on their direct effect on rents is limited.", refs: [] },
            ],
        },
        {
            id: "transit", name: "New rail transit", direction: "up",
            points: [
                { text: "DART's Silver Line opened on October 25, 2025, linking Plano (12th Street and Shiloh Road stations) with DFW Airport. Homes near rail stations usually command higher rents.", refs: [21, 22] },
            ],
        },
        {
            id: "home_buying", name: "Cost of buying a home", direction: "mixed",
            points: [
                { text: "With 30-year mortgage rates around 6.8% to 6.9%, owning a median-priced home costs about $3,641 a month against average rent of about $1,678, which keeps many households renting.", refs: [25] },
                { text: "Home prices are falling, by 6% to 8.5% from a year earlier depending on the source, which will gradually make buying more affordable.", refs: [23, 24] },
            ],
        },
    ],
    rents: [
        { text: "Plano average apartment rent: $1,687, down 1.95% from a year earlier.", refs: [26] },
        { text: "Collin County rents overall: down 0.6% from a year earlier.", refs: [25] },
    ],
    references: [
        { id: 1, publisher: "Cushman & Wakefield", title: "Dallas-Fort Worth multifamily market report, Q2 2026", type: "Market report", published: "2026 Q2", covers: "Allen/McKinney submarket", url: "https://content.cushmanwakefield.com/api/public/content/f855a2e39d7a494eab95080118e16b1e", note: "Uses stabilized vacancy, which isn't directly comparable with other firms' occupancy figures." },
        { id: 2, publisher: "Transwestern", title: "Dallas-Fort Worth multifamily market factsheet, Q1 2026", type: "Market report", published: "2026 Q1", covers: "Frisco, Allen/McKinney and Plano submarkets", url: "https://transwestern.com/Upload/MarketResearchFactsheet_PDF/639135968864478658.pdf" },
        { id: 3, publisher: "Matthews", title: "Q1 2026 Dallas-Fort Worth Multifamily Market Report (CoStar data)", type: "Market report", published: "2026-04", covers: "DFW metro and submarkets", url: "https://cms.matthews.com/wp-content/uploads/2026/04/Q126-Dallas-Fort-Worth-Multifamily-Market-Report.pdf" },
        { id: 4, publisher: "Yahoo Finance", title: "Texas multifamily loans manageable despite building spree: Dallas Fed", type: "News", covers: "Texas", url: "https://finance.yahoo.com/economy/policy/articles/texas-multifamily-loans-manageable-despite-123100734.html" },
        { id: 5, publisher: "CoStar News", title: "Dallas-Fort Worth's suburban counties keep apartment construction pipeline flowing", type: "News", published: "2024", covers: "Celina, Melissa and Princeton", url: "https://www.costar.com/article/626324968/dallas-fort-worths-suburban-counties-keep-apartment-construction-pipeline-flowing", note: "Older source, included for the far-north suburbs." },
        { id: 6, publisher: "CRE Daily", title: "Texas real estate forecast points to slower growth in 2027 (Texas A&M Real Estate Research Center)", type: "News", covers: "Texas", url: "https://www.credaily.com/?p=222653" },
        { id: 7, publisher: "Texas Legislature", title: "Local Government Code, Chapter 218 (Senate Bill 840)", type: "Law", published: "Effective 2025-09-01", covers: "Texas", url: "https://statutes.capitol.texas.gov/Docs/LG/pdf/LG.218.pdf" },
        { id: 8, publisher: "Community Impact", title: "McKinney P&Z signs off on changes to residential development standards", type: "News", published: "2025-09-11", covers: "McKinney", url: "https://communityimpact.com/dallas-fort-worth/mckinney/government/2025/09/11/mckinney-pz-signs-off-on-changes-to-residential-development-standards" },
        { id: 9, publisher: "High Plains Public Radio", title: "Texas suburbs resist new state law allowing more apartments", type: "News", published: "2025-09-08", covers: "Plano and Frisco", url: "https://www.hppr.org/hppr-news/2025-09-08/texas-suburbs-resist-new-state-law-allowing-more-apartments" },
        { id: 10, publisher: "KERA News", title: "Collin County population boom continues, adding 2nd most residents in the country last year", type: "News", published: "2026-03-31", covers: "Collin County", url: "https://www.keranews.org/news/2026-03-31/princeton-collin-county-population-growth", note: "Population figures are U.S. Census Bureau estimates." },
        { id: 11, publisher: "CRE Daily", title: "Collin County growth powers North Texas economic surge", type: "News", covers: "Collin County", url: "https://credaily.com/briefs/collin-county-growth-powers-north-texas-economic-surge/" },
        { id: 12, publisher: "CRE Daily", title: "Collin County office market heats up on corporate moves", type: "News", covers: "Collin County", url: "https://www.credaily.com/?p=224622" },
        { id: 13, publisher: "LocalProfile", title: "Prosper, Frisco 2024-25 school ratings", type: "News", covers: "Collin County school districts", url: "https://www.localprofile.com/news/prosper-frisco-texas-2024-25-school-ratings-11090184", note: "Official ratings are published by the Texas Education Agency." },
        { id: 14, publisher: "NBC DFW", title: "TEA releases 2024-25 school ratings: best and worst districts and charters", type: "News", covers: "North Texas school districts", url: "https://www.nbcdfw.com/news/local/tea-releases-2024-25-school-ratings-best-worst-districts-and-charters/3905164/" },
        { id: 15, publisher: "Texas Health Resources", title: "Texas Health announces new hospital coming to north McKinney", type: "Health system release", published: "2026-02-24", covers: "McKinney", url: "https://www.texashealth.org/newsroom/News-Releases/2026/Texas-Health-Announces-New-Hospital-Coming-to-North-McKinney" },
        { id: 16, publisher: "Community Impact", title: "McKinney council approves zoning for new Texas Health hospital near Trinity Falls", type: "News", published: "2025-12-04", covers: "McKinney", url: "https://communityimpact.com/dallas-fort-worth/mckinney/health-care/2025/12/04/mckinney-council-approves-zoning-for-new-texas-health-hospital-near-trinity-falls" },
        { id: 17, publisher: "Community Impact", title: "Medical City McKinney to see $142M facility expansion project", type: "News", covers: "McKinney", url: "https://communityimpact.com/mckinney/healthcare/medical-city-mckinney-to-see-142m-facility-expansion-project/" },
        { id: 18, publisher: "LocalProfile", title: "Texas Health Frisco expansion", type: "News", covers: "Frisco", url: "https://www.localprofile.com/community/texas-health-frisco-expansion-10839683" },
        { id: 19, publisher: "The Dallas Morning News", title: "As Collin County grows, Texas hospital system plans $343M expansion", type: "News", published: "2024-11-08", covers: "Plano", url: "https://dallasnews.com/business/real-estate/2024/11/08/as-collin-county-grows-texas-hospital-system-plans-343m-expansion" },
        { id: 20, publisher: "Community Impact", title: "New Celina hospital to address emergency care desert", type: "News", covers: "Celina", url: "https://communityimpact.com/prosper-celina/healthcare/new-celina-hospital-to-address-emergency-care-desert/" },
        { id: 21, publisher: "Community Impact", title: "Roundup: Silver Line opening, service cuts and other recent DART updates", type: "News", covers: "DART service area", url: "https://communityimpact.com/richardson/transportation/roundup-silver-line-opening-service-cuts-and-other-recent-dart-updates/" },
        { id: 22, publisher: "Railway News", title: "DART opens $2.1B Silver Line regional rail in Texas", type: "News", covers: "Plano to DFW Airport corridor", url: "https://railwaynews.net/?p=286133" },
        { id: 23, publisher: "Dallas Express", title: "Frisco, Plano, Prosper homes: 6.1% value decline hits Collin County market", type: "News", covers: "Collin County", url: "https://dallasexpress.com/realestate/frisco-plano-prosper-homes-6-1-value-decline-hits-collin-county-market/" },
        { id: 24, publisher: "Zillow", title: "Collin County home values", type: "Data", covers: "Collin County", url: "https://www.zillow.com/collin-county-tx/home-values/" },
        { id: 25, publisher: "ClosingIQ", title: "Collin County housing market report", type: "Data", covers: "Collin County", url: "https://closingiq.io/markets/tx/collin-county", note: "Owning-cost estimate assumes a median-priced home with 10% down." },
        { id: 26, publisher: "RentCafe", title: "Plano, TX rental market trends", type: "Data", covers: "Plano", url: "https://www.rentcafe.com/average-rent-market-trends/us/tx/plano" },
    ],
};

const DALLAS_SAMPLE = {
    id: "dallas",
    county: "Dallas County",
    metro: DFW_METRO,
    place: "Dallas County, Dallas-Fort Worth, Texas",
    as_of: "2026-11-14",
    overall:
        "Dallas County has the metro's most expensive urban apartments, but slightly more residents are moving out than in, and big " +
        "employers are both arriving (Goldman Sachs) and leaving (AT&T to Plano). Apartment construction across DFW has slowed sharply " +
        "while demand stayed strong, so vacancy is easing; concessions still hold rents back, and reports expect rent growth to return " +
        "slowly from late 2026.",
    drivers: [
        {
            id: "new_supply", name: "Apartment construction (now slowing)", direction: "down", strength: "Pressure easing",
            points: [
                { text: "The DFW apartment construction pipeline has shrunk to near a 10-year low.", refs: [1] },
                { text: "About 30,200 units were under construction across DFW in Q1 2026; vacancy is expected to peak in 2026 before gradually tightening.", refs: [2] },
                { text: "DFW absorbed about 28,600 units in the year to Q2 2026, up 10% from a year earlier, while completions fell 26%, and overall vacancy dropped about 0.4 points.", refs: [3] },
            ],
        },
        {
            id: "concessions", name: "Move-in concessions", direction: "down",
            points: [
                { text: "Among Texas's major metros, Dallas is second only to Austin in rent concessions, and Dallas is among the metros with the sharpest rent drops.", refs: [4] },
            ],
        },
        {
            id: "population", name: "Slow population growth, more move-outs than move-ins", direction: "down",
            points: [
                { text: "Census estimates put Dallas County at 2,661,397 people on July 1, 2025, only 1.9% more than in April 2020.", refs: [5] },
                { text: "Between 2024 and 2025, about 2,616 more people moved out of Dallas County than moved in, while nearby suburban counties led national growth.", refs: [6] },
            ],
        },
        {
            id: "jobs", name: "Corporate moves, in and out", direction: "mixed",
            points: [
                { text: "Goldman Sachs is building a downtown Dallas campus expected to hold more than 5,000 workers, due to open around late 2027 to early 2028.", refs: [7] },
                { text: "In early 2026 AT&T shifted its global headquarters operations from downtown Dallas to Plano (Collin County). DFW still led the nation in headquarters relocations, with 11 of 164 last year.", refs: [8] },
            ],
        },
        {
            id: "urban_core", name: "Downtown and Uptown investment", direction: "up",
            points: [
                { text: "Asking rents are highest in the urban core: about $2,667 a month in Uptown/Park Cities and $2,207 in Downtown Dallas (Q1 2026).", refs: [2] },
                { text: "Downtown has nearly 16,000 residents and about $8 billion of development underway, including a $3.7 billion convention center expansion targeted for 2029.", refs: [9, 10] },
                { text: "Rent performance is diverging between urban areas such as Uptown and the suburbs, so county-wide averages hide large local differences.", refs: [11] },
            ],
        },
        {
            id: "schools", name: "School ratings (mixed)", direction: "mixed",
            points: [
                { text: "2024-25 Texas Education Agency ratings: Dallas ISD B (83, up from C), Garland ISD B (84) and Richardson ISD C (79).", refs: [12, 13, 14] },
                { text: "Mixed school ratings mean family demand varies more by neighborhood here than in Collin County's mostly A-rated districts.", refs: [] },
            ],
        },
        {
            id: "transit", name: "Rail transit", direction: "up",
            points: [
                { text: "DART's Silver Line opened on October 25, 2025, running through northern Dallas County (including Addison and Richardson) to DFW Airport, adding to DART's existing rail network.", refs: [15] },
            ],
        },
        {
            id: "home_buying", name: "Cost of buying a home", direction: "mixed",
            points: [
                { text: "The median sale price across the Dallas area was about $399,900, down about 1.7% from a year earlier.", refs: [16] },
                { text: "Zillow's typical home value in the city of Dallas is down about 1.7% from a year earlier. Lower prices than in the northern suburbs make buying somewhat more reachable here.", refs: [17] },
            ],
        },
        {
            id: "policy", name: "State zoning law (SB 840)", direction: "down", strength: "Longer-term effect",
            points: [
                { text: "Since September 1, 2025, Texas cities must allow apartments in zones that allow offices, at up to 36 units per acre, which could add supply over time.", refs: [18] },
            ],
        },
    ],
    rents: [
        { text: "DFW effective rents rose 0.5% in Q2 2026, only the third quarterly gain in 12 quarters.", refs: [19] },
        { text: "Dallas-area rents were down about 2.6% from a year earlier in Apartment List's estimate.", refs: [20] },
    ],
    references: [
        { id: 1, publisher: "Northmarq", title: "Multifamily construction pipeline in Dallas shrinks to near 10-year low", type: "Market report", published: "2026", covers: "DFW metro", url: "https://www.northmarq.com/insights/insights/multifamily-construction-pipeline-dallas-shrinks-near-10-year-low" },
        { id: 2, publisher: "Matthews", title: "Q1 2026 Dallas-Fort Worth Multifamily Market Report (CoStar data)", type: "Market report", published: "2026-04", covers: "DFW metro and submarkets", url: "https://cms.matthews.com/wp-content/uploads/2026/04/Q126-Dallas-Fort-Worth-Multifamily-Market-Report.pdf" },
        { id: 3, publisher: "CoStar News", title: "Multifamily demand in Dallas-Fort Worth endures as vacancy turns a corner", type: "News", published: "2026", covers: "DFW metro", url: "https://www.costar.com/article/1946352486/multifamily-demand-in-dallas-fort-worth-endures-as-vacancy-turns-a-corner", note: "Full article may require a CoStar subscription." },
        { id: 4, publisher: "Federal Reserve Bank of Dallas", title: "Southwest Economy (2026): Texas apartment markets", type: "Research", published: "2026", covers: "Texas metros", url: "https://www.dallasfed.org/research/swe/2026/swe2605" },
        { id: 5, publisher: "U.S. Census Bureau", title: "QuickFacts: Dallas County, Texas", type: "Data", published: "July 2025 estimates", covers: "Dallas County", url: "https://www.census.gov/quickfacts/dallascountytexas" },
        { id: 6, publisher: "KBTX (Texas Tribune)", title: "Texas suburbs lead U.S. for population growth as international migration slows, census finds", type: "News", published: "2026-03-27", covers: "Texas counties", url: "https://www.kbtx.com/2026/03/27/texas-suburbs-lead-us-population-growth-international-migration-slows-census-finds/" },
        { id: 7, publisher: "Dallas Innovates", title: "Goldman Sachs kicks off construction on sustainable, all-electric Dallas campus", type: "News", covers: "Downtown Dallas", url: "https://dallasinnovates.com/goldman-sachs-kicks-off-construction-on-sustainable-all-electric-dallas-campus/", note: "Reported opening dates and costs vary by source." },
        { id: 8, publisher: "Bisnow", title: "DFW still leads U.S. in corporate relocations, but momentum slows", type: "News", published: "2026-04", covers: "DFW metro", url: "https://www.bisnow.com/news/dallas-ft-worth/commercial-real-estate/dfw-corporate-relocations-134175" },
        { id: 9, publisher: "Bisnow", title: "Downtown Dallas set for major change, if slow retail, old buildings and tariffs don't get in the way", type: "News", covers: "Downtown Dallas", url: "https://www.bisnow.com/news/dallas-ft-worth/construction-development/dallas-convention-center-remodel-therme-wellness-resort-to-lead-wave-of-phenomenal-growth-in-downtown-128951" },
        { id: 10, publisher: "Downtown Dallas Inc.", title: "Downtown Dallas Big Moves", type: "Organization report", published: "2026", covers: "Downtown Dallas", url: "https://downtowndallas.com/members/state-of-downtown/downtown-dallas-big-moves/" },
        { id: 11, publisher: "CoStar News", title: "Apartment rent growth divergence sharpens in Dallas-Fort Worth between urban and suburban submarkets", type: "News", published: "2026", covers: "DFW submarkets", url: "https://www.costar.com/article/36082025/apartment-rent-growth-divergence-sharpens-in-dallas-fort-worth-between-urban-and-suburban-submarkets", note: "Full article may require a CoStar subscription." },
        { id: 12, publisher: "Dallas Regional Chamber", title: "North Texas school districts show improvement in newly released school accountability ratings", type: "Organization report", published: "2025", covers: "North Texas school districts", url: "https://www.dallaschamber.org/blog/north-texas-school-districts-show-improvement-in-newly-released-school-accountability-ratings/", note: "Official ratings are published by the Texas Education Agency; 2025-26 ratings have since been released." },
        { id: 13, publisher: "NBC DFW", title: "TEA releases 2024-25 school ratings: best and worst districts and charters", type: "News", covers: "North Texas school districts", url: "https://www.nbcdfw.com/news/local/tea-releases-2024-25-school-ratings-best-worst-districts-and-charters/3905164/" },
        { id: 14, publisher: "Community Impact", title: "Richardson ISD earns C for 2023-24, 2024-25 school year from TEA", type: "News", covers: "Richardson ISD", url: "https://communityimpact.com/richardson/education/richardson-isd-earns-c-for-2023-24-2024-25-school-year-from-tea/" },
        { id: 15, publisher: "Community Impact", title: "Roundup: Silver Line opening, service cuts and other recent DART updates", type: "News", covers: "DART service area", url: "https://communityimpact.com/richardson/transportation/roundup-silver-line-opening-service-cuts-and-other-recent-dart-updates/" },
        { id: 16, publisher: "The Real Deal", title: "Home prices across Dallas area fell in 2026", type: "Data", published: "2026", covers: "Dallas region", url: "https://therealdeal.com/data/texas/2026/home-prices-across-dallas-area-fell-in-2026/" },
        { id: 17, publisher: "Zillow", title: "Dallas, TX home values", type: "Data", covers: "City of Dallas", url: "https://www.zillow.com/Dallas-TX/home-values/" },
        { id: 18, publisher: "Texas Legislature", title: "Local Government Code, Chapter 218 (Senate Bill 840)", type: "Law", published: "Effective 2025-09-01", covers: "Texas", url: "https://statutes.capitol.texas.gov/Docs/LG/pdf/LG.218.pdf" },
        { id: 19, publisher: "RealPage", title: "Dallas apartment supply peaked as job growth slowed, prolonging a performance trough", type: "Market report", published: "2026 Q2", covers: "DFW metro", url: "https://www.realpage.com/analytics/dallas-jobs-2nd-quarter-2026/" },
        { id: 20, publisher: "Apartment List", title: "Dallas rent report", type: "Data", covers: "Dallas metro", url: "https://www.apartmentlist.com/rent-report/tx/dallas", note: "Rent measures differ by provider (asking vs. effective rents)." },
    ],
};

const DENTON_SAMPLE = {
    id: "denton",
    county: "Denton County",
    metro: DFW_METRO,
    place: "Denton County, Dallas-Fort Worth, Texas",
    as_of: "2026-11-14",
    overall:
        "Denton County is growing fast (about 18% more people than in 2020), which keeps rental demand strong. But heavy apartment " +
        "construction in Denton and the Frisco/Little Elm area, plus widespread move-in deals, have pushed rents in the city of Denton " +
        "down about 5% from a year earlier. Home prices are also slipping, and reports expect rents to firm gradually from late 2026 " +
        "as construction slows.",
    drivers: [
        {
            id: "new_supply", name: "New apartment construction", direction: "down", strength: "Strongest driver",
            points: [
                { text: "In Q1 2026 about 2,819 apartments were under construction in the Denton submarket (asking rent about $1,426) and about 3,503 in Frisco/Little Elm (about $1,738).", refs: [1] },
                { text: "Denton, Frisco and Allen/McKinney are among the DFW areas with the heaviest apartment construction.", refs: [2] },
            ],
        },
        {
            id: "concessions", name: "Move-in concessions", direction: "down",
            points: [
                { text: "Texas apartment vacancy has improved since peaking in mid-2024, but rents are still falling in most metros and concessions remain widespread.", refs: [3] },
            ],
        },
        {
            id: "population", name: "Fast population growth", direction: "up",
            points: [
                { text: "Census estimates put Denton County at 1,069,346 people on July 1, 2025, up from 1,045,120 a year earlier (about 24,000 more people) and 18.0% above April 2020.", refs: [4] },
            ],
        },
        {
            id: "schools", name: "Strong suburban school districts", direction: "up",
            points: [
                { text: "2024-25 Texas Education Agency ratings: Argyle ISD A (92), Lewisville ISD B and Denton ISD B (80).", refs: [5, 6, 7] },
                { text: "In the newer 2025-26 ratings, Denton ISD received a C (76).", refs: [8] },
            ],
        },
        {
            id: "health", name: "Growing hospital and health care capacity", direction: "up", strength: "Shown for context",
            points: [
                { text: "Medical City Denton added an ICU expansion (about $4.1 million, due February 2026) and a new inpatient rehabilitation unit.", refs: [9, 10] },
                { text: "Baylor Scott & White's Heart Hospital Denton is opening clinics in Argyle and Highland Village, and TotalCare planned a new Denton emergency room for mid-2026.", refs: [11, 12] },
            ],
        },
        {
            id: "transit", name: "Limited rail transit", direction: "mixed", strength: "Shown for context",
            points: [
                { text: "The DCTA A-train links Denton with Carrollton. A connection to DART's Silver Line at Downtown Carrollton is planned but wasn't available when the Silver Line opened.", refs: [13] },
            ],
        },
        {
            id: "home_buying", name: "Cost of buying a home", direction: "mixed",
            points: [
                { text: "Denton County's median home price has been falling, to roughly $420,000–$445,000 depending on the source and period, with more homes for sale.", refs: [14, 15] },
                { text: "Falling prices make buying gradually more reachable, which can pull some renters into ownership.", refs: [] },
            ],
        },
        {
            id: "policy", name: "State zoning law (SB 840)", direction: "down", strength: "Longer-term effect",
            points: [
                { text: "Since September 1, 2025, Texas cities must allow apartments in zones that allow offices, at up to 36 units per acre, which could add supply over time.", refs: [16] },
            ],
        },
    ],
    rents: [
        { text: "City of Denton average apartment rent: about $1,519 in May 2026, down 5.1% from a year earlier.", refs: [17] },
        { text: "Another estimate puts it at $1,529, down 4.57% from a year earlier.", refs: [18] },
    ],
    references: [
        { id: 1, publisher: "Matthews", title: "Q1 2026 Dallas-Fort Worth Multifamily Market Report (CoStar data)", type: "Market report", published: "2026-04", covers: "DFW submarkets (Frisco/Little Elm is partly in Collin County)", url: "https://cms.matthews.com/wp-content/uploads/2026/04/Q126-Dallas-Fort-Worth-Multifamily-Market-Report.pdf" },
        { id: 2, publisher: "Transwestern", title: "Dallas-Fort Worth multifamily market factsheet", type: "Market report", published: "2026", covers: "DFW submarkets", url: "https://transwestern.com/Upload/MarketResearchFactsheet_PDF/639208669297027801.pdf" },
        { id: 3, publisher: "Federal Reserve Bank of Dallas", title: "Southwest Economy (2026): Texas apartment markets", type: "Research", published: "2026", covers: "Texas metros", url: "https://www.dallasfed.org/research/swe/2026/swe2605" },
        { id: 4, publisher: "U.S. Census Bureau", title: "QuickFacts: Denton County, Texas", type: "Data", published: "July 2025 estimates", covers: "Denton County", url: "https://www.census.gov/quickfacts/dentoncountytexas" },
        { id: 5, publisher: "Community Impact", title: "Argyle ISD receives A accountability rating from state", type: "News", published: "2025-08-15", covers: "Argyle ISD", url: "https://communityimpact.com/dallas-fort-worth/flower-mound-highland-village-argyle/education/2025/08/15/argyle-isd-receives-a-accountability-rating-from-state" },
        { id: 6, publisher: "Community Impact", title: "Lewisville ISD receives B accountability rating from state", type: "News", published: "2025-08-15", covers: "Lewisville ISD", url: "https://beta2.communityimpact.com/dallas-fort-worth/flower-mound-highland-village-argyle/education/2025/08/15/lewisville-isd-receives-b-accountability-rating-from-state" },
        { id: 7, publisher: "KERA News", title: "School accountability grades from the Texas Education Agency (2025)", type: "News", published: "2025-08-15", covers: "North Texas school districts", url: "https://www.keranews.org/education/2025-08-15/school-accountability-grades-texas-education-agency-2025", note: "Official ratings are published by the Texas Education Agency." },
        { id: 8, publisher: "Community Impact", title: "Denton ISD earns C accountability rating from TEA for 2025-26", type: "News", covers: "Denton ISD", url: "https://communityimpact.com/denton/education/denton-isd-earns-c-accountability-rating-from-tea-for-2025-26/" },
        { id: 9, publisher: "Texas Department of Licensing and Regulation", title: "Project filing: ICU expansion at Medical City Denton", type: "Government record", covers: "Denton", url: "https://www.tdlr.texas.gov/TABS/Search/Print/TABS2026005817", note: "Planned completion date from the filing; confirm current status with the hospital." },
        { id: 10, publisher: "Healthcare Design Magazine", title: "Medical City Denton Hospital opens $15M rehabilitation unit in Denton, Texas", type: "News", covers: "Denton", url: "https://healthcaredesignmagazine.com/news/medical-city-denton-hospital-opens-15m-rehabilitation-unit-in-denton-texas/165306/" },
        { id: 11, publisher: "Community Impact", title: "Baylor Scott & White to open new heart clinic in Argyle", type: "News", published: "2025-09-22", covers: "Argyle", url: "https://communityimpact.com/dallas-fort-worth/flower-mound-highland-village-argyle/business/2025/09/22/baylor-scott-white-to-open-new-heart-clinic-in-argyle" },
        { id: 12, publisher: "Community Impact", title: "TotalCare to open emergency room in Denton", type: "News", published: "2025-12-12", covers: "Denton", url: "https://communityimpact.com/dallas-fort-worth/denton/health-care/2025/12/12/totalcare-to-open-emergency-room-in-denton" },
        { id: 13, publisher: "DART", title: "Silver Line project page", type: "Transit agency", covers: "Silver Line corridor and Downtown Carrollton", url: "https://www.dart.org/about/project-and-initiatives/expansion/silver-line" },
        { id: 14, publisher: "Cross Timbers Gazette", title: "Denton County housing market report", type: "News", published: "2026", covers: "Denton County", url: "https://www.crosstimbersgazette.com/?p=87839", note: "Figures differ by source, month and method (median sale price vs. typical value)." },
        { id: 15, publisher: "The Real Deal", title: "Home prices across Dallas area fell in 2026", type: "Data", published: "2026", covers: "Dallas-area counties", url: "https://therealdeal.com/data/texas/2026/home-prices-across-dallas-area-fell-in-2026/" },
        { id: 16, publisher: "Texas Legislature", title: "Local Government Code, Chapter 218 (Senate Bill 840)", type: "Law", published: "Effective 2025-09-01", covers: "Texas", url: "https://statutes.capitol.texas.gov/Docs/LG/pdf/LG.218.pdf" },
        { id: 17, publisher: "Point2 (Yardi Matrix data)", title: "Denton, Texas rental market trends", type: "Data", published: "2026-05", covers: "City of Denton", url: "https://www.point2homes.com/US/Average-Rent/TX/Denton.html" },
        { id: 18, publisher: "RentCafe (Yardi Matrix data)", title: "Denton, TX rental market trends", type: "Data", covers: "City of Denton", url: "https://www.rentcafe.com/average-rent-market-trends/us/tx/denton/" },
    ],
};

// Sample reports every viewer can open, in any metro
const SAMPLE_REPORTS = [COLLIN_SAMPLE, DALLAS_SAMPLE, DENTON_SAMPLE];

// ---------------------------------------------------------------------------
// Live reports (paid version). OFF for now: while false, the page never calls the backend for
// reports and shows the samples above. Turn on together with RENT_REPORTS_ENABLED on the server.
// ---------------------------------------------------------------------------
const REPORTS_LIVE = false;
const POLL_MS = 20000;   // while a report is being written

const DIRECTION_GROUPS = [
    ["down", "Pushing rents down"],
    ["up", "Pushing rents up"],
    ["mixed", "Mixed effect"],
];

/** Superscript links to the numbered references, e.g. [1][2] */
function Cites({ refs, prefix }) {
    if (!refs?.length) return null;
    return (
        <Box component="span" sx={{ whiteSpace: "nowrap" }}>
            {refs.map((n) => (
                <Link key={n} href={`#${prefix}-ref-${n}`} aria-label={`Reference ${n}`} underline="hover"
                    sx={{ ml: 0.25, verticalAlign: "super", fontSize: "0.7rem", ...blueLinkSx }}>
                    [{n}]
                </Link>
            ))}
        </Box>
    );
}

function SampleReport({ report, heading }) {
    const prefix = useId().replace(/[^a-zA-Z0-9_-]/g, "");
    return (
        <Paper component="article" variant="outlined" sx={{ mt: 1.5, borderRadius: 2, borderColor: "gray.200", p: { xs: 2, md: 2.5 } }}>
            <Box sx={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", justifyContent: "space-between", gap: 1 }}>
                <Typography variant="h4" sx={{ fontSize: "1rem", fontWeight: 700, color: "gray.900" }}>{heading ?? `Sample report: ${report.place}`}</Typography>
                <Typography variant="caption" sx={{ color: "gray.500" }}>Researched {shortDate(report.as_of)} · {report.references.length} sources</Typography>
            </Box>
            <Typography variant="body2" sx={{ mt: 1, color: "gray.800", lineHeight: 1.625 }}><b>Summary.</b> {report.overall}</Typography>

            {DIRECTION_GROUPS.map(([dir, heading]) => {
                const items = report.drivers.filter((d) => d.direction === dir);
                if (!items.length) return null;
                return (
                    <Box key={dir} sx={{ mt: 2 }}>
                        <Typography variant="h5" sx={smallHeadSx}>{heading}</Typography>
                        <Box component="ul" sx={{ mt: 1, display: "grid", gap: 1.5, gridTemplateColumns: { md: "repeat(2, minmax(0, 1fr))" } }}>
                            {items.map((d) => (
                                <Box component="li" key={d.id} sx={{ ...cardSx, p: 1.5 }}>
                                    <Box sx={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", justifyContent: "space-between", gap: 1 }}>
                                        <Box component="span" sx={{ fontSize: "0.875rem", fontWeight: 600, color: "gray.900" }}>{d.name}</Box>
                                        <Box component="span" sx={{ ...chipSx, ...DIRECTION[d.direction].tone }}>
                                            {DIRECTION[d.direction].text}
                                        </Box>
                                    </Box>
                                    {d.strength && <Box sx={{ fontSize: "0.75rem", fontWeight: 500, color: "gray.500" }}>{d.strength}</Box>}
                                    <Box component="ul" sx={{ ...bulletListSx, lineHeight: 1.625 }}>
                                        {d.points.map((p, i) => <li key={i}>{p.text}<Cites refs={p.refs} prefix={prefix} /></li>)}
                                    </Box>
                                </Box>
                            ))}
                        </Box>
                    </Box>
                );
            })}

            {report.rents?.length > 0 && (
                <Box sx={{ mt: 2 }}>
                    <Typography variant="h5" sx={smallHeadSx}>Current rents for reference</Typography>
                    <Box component="ul" sx={bulletListSx}>
                        {report.rents.map((p, i) => <li key={i}>{p.text}<Cites refs={p.refs} prefix={prefix} /></li>)}
                    </Box>
                </Box>
            )}

            <Box sx={{ mt: 2.5, borderTop: 1, borderColor: "gray.100", pt: 1.5 }}>
                <Typography variant="h5" sx={smallHeadSx}>References</Typography>
                <Box component="ol" sx={{ mt: 1, display: "flex", flexDirection: "column", gap: 1, fontSize: "0.875rem" }}>
                    {report.references.map((r) => (
                        <Box component="li" key={r.id} id={`${prefix}-ref-${r.id}`} sx={{ display: "flex", gap: 1, scrollMarginTop: "96px" }}>
                            <Box component="span" sx={{ width: 28, flexShrink: 0, textAlign: "right", fontWeight: 600, color: "gray.500" }}>{r.id}.</Box>
                            <Box sx={{ minWidth: 0 }}>
                                <Link href={r.url} target="_blank" rel="noopener noreferrer" underline="hover"
                                    sx={{ ...blueLinkSx, overflowWrap: "break-word" }}>
                                    {r.title} ↗
                                </Link>
                                <Box sx={{ fontSize: "0.75rem", color: "gray.500" }}>
                                    {[r.publisher, r.type, r.published, r.covers && `Covers: ${r.covers}`].filter(Boolean).join(" · ")}
                                </Box>
                                {r.note && <Box sx={{ fontSize: "0.75rem", color: "gray.500", fontStyle: "italic" }}>{r.note}</Box>}
                            </Box>
                        </Box>
                    ))}
                </Box>
            </Box>
        </Paper>
  );
}

const SAMPLE_NOTE =
    "Sample reports show what a full report looks like. Each summarizes what published sources say as of its research " +
    "date; it is not a forecast or investment advice. Some figures describe a city, an apartment submarket or the whole " +
    "metro rather than the county, and each reference says which. Sources use different methods and dates, so open a " +
    "source before relying on a specific number.";

/** One collapsible sample report (closed until the viewer opens it) */
function SampleDetails({ report, isCurrent }) {
    return (
        <details>
            <Box component="summary"
                 sx={{ display: "inline-flex", cursor: "pointer", listStyle: "none", alignItems: "center", gap: 0.5, borderRadius: 1.5, fontSize: "0.875rem", ...blueLinkSx, ...focusRing, "&::-webkit-details-marker": { display: "none" } }}>
                <ChevronRightIcon aria-hidden="true" sx={summaryChevronSx} />
                More details: see a sample report for {report.place}
                {isCurrent && <Box component="span" sx={{ ml: 0.5, px: 0.75, py: 0.25, borderRadius: 1, bgcolor: "blue.50", fontSize: "0.75rem", fontWeight: 500, color: "blue.800" }}>this county</Box>}
            </Box>
            <SampleReport report={report} />
        </details>
  );
}

/** The pending notice plus every sample, the viewer's own county first when it has one */
function PendingWithSamples({ metro, county }) {
    const isCurrent = (r) => r.county === county && r.metro === metro;
    const samples = [...SAMPLE_REPORTS].sort((a, b) => Number(isCurrent(b)) - Number(isCurrent(a)));
    return (
        <>
            <Typography variant="body2" sx={{ mt: 0.5, color: "gray.700", lineHeight: 1.625 }}>
                <b>Live reports are currently in development.</b> Each report reads recent local news, apartment market reports and
                public announcements, and explains what is pushing rents up or down in a county: new construction, vacancies and
                move-in deals, jobs and population growth, schools, hospitals, transit, home buying costs and local policy. Every
                point links to its source.
            </Typography>
            <Typography variant="body2" sx={{ mt: 0.5, color: "gray.600" }}>
                Full coverage for every county across all metros is rolling out soon—explore the sample reports below in the meantime.
            </Typography>

            <Box sx={{ mt: 1.5, display: "flex", flexDirection: "column", gap: 1 }}>
                {samples.map((r) => <SampleDetails key={r.id} report={r} isCurrent={isCurrent(r)} />)}
            </Box>
            <Typography variant="caption" component="p" sx={{ mt: 1.5, ...smallPrintSx }}>{SAMPLE_NOTE}</Typography>
        </>
    );
}

/** Paid version: the county's report from the backend (only used when REPORTS_LIVE is true) */
function LiveMarketReport({ metro, county }) {
    const req = useFetchData();
    const [tick, setTick] = useState(0);
    useEffect(() => {
        req.handleFetch("data/rent-report", { metro, county });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [metro, county, tick]);
    const data = req.data && req.data.county === county && req.data.metro === metro ? req.data : null;
    const status = data?.status;
    useEffect(() => {
        if (status !== "running") return undefined;
        const t = setTimeout(() => setTick((n) => n + 1), POLL_MS);
        return () => clearTimeout(t);
    }, [status, data]);

    // Server switched off, not signed in, over budget, or failed: fall back to the samples
    if (!data || ["disabled", "unavailable", "failed", "needs_review"].includes(status)) {
        return (
            <>
                {req.loading && !data && <Typography variant="body2" sx={{ mt: 1, color: "blue.700", ...pulse }} role="status">Loading…</Typography>}
                {data?.message && <Typography variant="body2" sx={{ mt: 1, color: "gray.600" }}>{data.message}</Typography>}
                <PendingWithSamples metro={metro} county={county} />
            </>
        );
    }
    if (status === "running") {
        return <Typography variant="body2" sx={{ mt: 1, color: "blue.700" }} role="status">Researching {county}. This can take a minute or two; this page checks again on its own.</Typography>;
    }
    return (
        <>
            <Typography variant="caption" component="p" sx={{ mt: 1, color: "gray.500" }}>
                {data.reviewed ? "Researched with AI and reviewed by a person." : "Researched with AI, not yet reviewed by a person."} Researched {shortDate(data.report.as_of)}.
            </Typography>
            <SampleReport report={data.report} heading={`Local market report: ${data.report.place}`} />
            <Typography variant="caption" component="p" sx={{ mt: 1.5, ...smallPrintSx }}>
                This report summarizes what published sources say; it is not a forecast or investment advice. Open a source before relying on a specific number.
            </Typography>
        </>
    );
}

function LocalMarketReport({ metro, county }) {
    return (
        <Box component="section" sx={{ mt: 3, borderTop: 1, borderColor: "gray.100", pt: 2.5 }} aria-labelledby="market-report-title">
            <Box sx={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 1 }}>
                <Typography variant="h3" id="market-report-title" sx={{ fontSize: "1.125rem", fontWeight: 700, color: "gray.900" }}>Local market report for {county}</Typography>
                {!REPORTS_LIVE && (
                    <Box component="span" sx={{ ...chipSx, borderRadius: 999, fontWeight: 600, bgcolor: "blue.50", color: "blue.800" }}>
                        Preview · Coming soon
                    </Box>
                )}
            </Box>
            <AiNote>
                <b>Researched with AI.</b> We use AI (Claude, by Anthropic) to search the web for local news, apartment market
                reports and public announcements and find what is driving rents in each county. Every point links to its source.
            </AiNote>
            {REPORTS_LIVE
                ? <LiveMarketReport metro={metro} county={county} />
                : <PendingWithSamples metro={metro} county={county} />}
        </Box>
    );
}


export default function RentDriversSection({ metro = DFW_METRO, areaName = "DFW", rows, asPage = false }) {
    const [expanded, setOpen] = useState(false);
    const open = asPage || expanded;
    const bodyId = useId();
    // "Neighborhood factors" (the first section): closed by default; its Census data loads when first opened
    const [factorsOpen, setFactorsOpen] = useState(false);
    const factorsId = useId();
    const cov = useFetchData();
    useEffect(() => {
        if (open && factorsOpen) cov.handleFetch("data/dfw-zip-covariates", { metro });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [metro, open, factorsOpen]);
    const covRows = cov.data && (cov.data.metro ?? DFW_METRO) === metro && Array.isArray(cov.data.rows) ? cov.data.rows : null;

    const [choice, setChoice] = useState("");

    // ZIP -> county and city, from the rent rows
    const zipInfo = useMemo(() => {
        const out = {};
        for (const r of rows ?? []) if (r.zip_code && !out[r.zip_code]) out[r.zip_code] = { county: r.county || "Other", city: r.City || "" };
        return out;
    }, [rows]);
    const counties = useMemo(() => [...new Set(Object.values(zipInfo).map((z) => z.county))].sort(), [zipInfo]);
    const options = counties;
    // The area shown: the viewer's pick, or the first option until they pick one
    const current = options.includes(choice) ? choice : options[0] ?? "";

    const inArea = (zip) => zipInfo[zip]?.county === current;

    // Each driver: the area's value (median of its ZIPs) and the metro's median
    const drivers = useMemo(() => {
        if (!covRows || !current) return [];
        return DRIVERS.map((d) => {
            const all = covRows.map((c) => num(c[d.key]));
            const area = covRows.filter((c) => inArea(String(c.zip_code).padStart(5, "0"))).map((c) => num(c[d.key]));
            return { ...d, area: median(area), metro: median(all) };
        }).filter((d) => d.area != null && d.metro != null);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [covRows, current, zipInfo]);

    // Rent context for the area, and the national mortgage rate, from the rent rows
    const context = useMemo(() => {
        const months = [...new Set((rows ?? []).filter((r) => Number.isFinite(num(r.zori_rent))).map((r) => r.month_year))].sort();
        const latest = months.at(-1);
        if (!latest) return null;
        const [y, m] = latest.split("-").map(Number);
        const yearAgo = `${y - 1}-${String(m).padStart(2, "0")}`;
        const now = {}, before = {};
        let rate = null, rateBefore = null;
        for (const r of rows ?? []) {
            const v = num(r.zori_rent);
            if (r.month_year === latest) { if (Number.isFinite(v) && inArea(r.zip_code)) now[r.zip_code] = v; if (Number.isFinite(num(r.mortgage_rate_30y))) rate = num(r.mortgage_rate_30y); }
            if (r.month_year === yearAgo) { if (Number.isFinite(v) && inArea(r.zip_code)) before[r.zip_code] = v; if (Number.isFinite(num(r.mortgage_rate_30y))) rateBefore = num(r.mortgage_rate_30y); }
        }
        const nowVals = Object.values(now);
        const paired = Object.keys(now).filter((z) => before[z]);
        const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
        return {
            latest,
            rent: nowVals.length ? mean(nowVals) : null,
            yoy: paired.length ? (mean(paired.map((z) => now[z])) / mean(paired.map((z) => before[z])) - 1) * 100 : null,
            rate, rateBefore,
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [rows, current, zipInfo]);

    if (!rows?.length) return null;
    const areaLabel = current;

    return (
        <Paper component="section" variant="outlined" sx={{ mb: 3, borderColor: "gray.200", borderRadius: 2 }} aria-labelledby={asPage ? undefined : "drivers-title"}
            aria-label={asPage ? `What drives rents in ${areaName}` : undefined}>
            {/* Header (card mode only): the title or the button opens and closes the details */}
            {!asPage && (
                <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1.5, flexWrap: "wrap", px: 3, py: 2, ...(open && { borderBottom: 1, borderColor: "gray.100" }) }}>
                    <Box sx={{ minWidth: 0, flex: 1 }}>
                        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                            <Box component="button" type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-controls={bodyId}
                                sx={{ textAlign: "left", borderRadius: 1.5, border: 0, p: 0, bgcolor: "transparent", cursor: "pointer", ...focusRing }}>
                                <Box component="span" id="drivers-title" sx={{ display: "block", fontSize: "1.25rem", fontWeight: 700, color: "gray.900" }}>What drives rents {open && 'in ' + areaLabel}?</Box>
                            </Box>
                            <InfoTip text={UPDATE_NOTE} />
                        </Box>
                        <Typography variant="body2" sx={{ mt: 0.25, color: "gray.600" }}>
                            {open
                                ? "Compare a county with the metro on factors that published research links to rents."
                                : `${DRIVERS.length + 1} drivers from published research, compared by county.`}
                        </Typography>
                    </Box>
                    <Button variant="outlined" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-controls={bodyId}
                        endIcon={<KeyboardArrowDownIcon sx={{ transition: "transform 150ms", transform: open ? "rotate(180deg)" : "none" }} />}
                        sx={{ flexShrink: 0, px: 2, py: 1, borderRadius: 2, border: 2, borderColor: "blue.600", bgcolor: "blue.50", color: "blue.800", fontSize: "1rem", fontWeight: 600, "&:hover": { border: 2, borderColor: "blue.600", bgcolor: "blue.100" } }}>
                        {open ? "Hide drivers" : "Show drivers"}
                    </Button>
                </Box>
            )}

            {open && (
                <Box id={bodyId} sx={{ px: 3, py: 2.5 }}>
                    <Box sx={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 1, justifyContent: asPage ? "space-between" : "flex-end" }}>
                        {asPage && (
                            <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
                                <Typography variant="body2" sx={{ color: "gray.600" }}>Compare a county with the metro on factors that published research links to rents.</Typography>
                                <InfoTip text={UPDATE_NOTE} />
                            </Box>
                        )}
                        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                            <Typography component="label" htmlFor="drivers-county" variant="body2" sx={{ fontWeight: 600, color: "gray.600" }}>County</Typography>
                            <NativeSelect id="drivers-county" value={current} onChange={(e) => setChoice(e.target.value)}
                                input={<OutlinedInput size="small" />}
                                sx={{ bgcolor: "common.white", fontSize: "0.875rem", fontWeight: 500, maxWidth: 256, "& .MuiNativeSelect-select": { py: 0.75, pl: 1.5 } }}>
                                {options.map((o) => (
                                    <option key={o} value={o}>{o}</option>
                                ))}
                            </NativeSelect>
                        </Box>
                    </Box>


                    {/* First section: neighborhood factors vs. the metro. Same layout as the Local market report:
                        heading, summary, then a "More details" link that opens the cards (closed by default). */}
                    <Box component="section" sx={{ mt: 2.5 }} aria-labelledby="factors-title">
                        <Typography variant="h3" id="factors-title" sx={{ fontSize: "1.125rem", fontWeight: 700, color: "gray.900" }}>Neighborhood factors compared with the metro</Typography>
                        <AiNote>
                            <b>Researched with AI.</b> We used AI (Claude, by Anthropic) to search the web for what drives rental
                            prices and the published research behind each factor.
                        </AiNote>
                        <Typography variant="body2" sx={{ mt: 0.5, color: "gray.700", lineHeight: 1.625 }}>
                            {context?.rent != null && (
                                <>
                                    Typical rent in {areaLabel}: <b>{usd(context.rent)}</b> a month
                                    {context.yoy != null ? <>, {context.yoy >= 0 ? "up" : "down"} <b>{Math.abs(context.yoy).toFixed(1)}%</b> from a year earlier</> : ""}.{" "}
                                </>
                            )}
                            How {areaLabel} compares with the rest of the metro on {DRIVERS.length + 1} factors that published research links to
                            rents: income, new housing, rental growth, distance to downtown, density and mortgage rates.
                        </Typography>
                        <Box component="button" type="button" onClick={() => setFactorsOpen((o) => !o)} aria-expanded={factorsOpen} aria-controls={factorsId}
                            sx={{ mt: 1.5, display: "inline-flex", alignItems: "center", gap: 0.5, borderRadius: 1.5, border: 0, p: 0, bgcolor: "transparent", cursor: "pointer", fontSize: "0.875rem", ...blueLinkSx, ...focusRing }}>
                            <ChevronRightIcon aria-hidden="true" sx={{ fontSize: 16, transition: "transform 150ms", transform: factorsOpen ? "rotate(90deg)" : "none" }} />
                            More details: see the {DRIVERS.length + 1} factors for {areaLabel}
                        </Box>
                        {factorsOpen && (
                            <Box id={factorsId} sx={{ mt: 1.5 }}>

                                {cov.loading && !covRows && <Typography variant="body2" sx={{ mt: 1, color: "blue.700", ...pulse }} role="status">Loading neighborhood data…</Typography>}
                                {cov.error && !covRows && (
                                    <Typography variant="body2" sx={{ mt: 2, color: "gray.500" }}>
                                        Neighborhood data isn't available right now.{" "}
                                        <Link component="button" underline="always" onClick={() => cov.handleFetch("data/dfw-zip-covariates", { metro })} sx={{ fontSize: "inherit", fontWeight: 600, color: "gray.700", verticalAlign: "baseline" }}>Try again</Link>
                                    </Typography>
                                )}

                                <Box component="ul" sx={{ mt: 1, display: "grid", gap: 2, gridTemplateColumns: { md: "repeat(2, minmax(0, 1fr))" } }}>
                                    {drivers.map((d) => {
                                        const c = compare(d.area, d.metro);
                                        const chip = c === "higher" ? d.higher : c === "lower" ? d.lower : "About the same as the metro";
                                        return (
                                            <Box component="li" key={d.key} sx={{ ...cardSx, p: 2 }}>
                                                <Box sx={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", justifyContent: "space-between", gap: 1 }}>
                                                    <Typography variant="h4" sx={driverTitleSx}>{d.name}</Typography>
                                                    <Box component="span" sx={{ ...chipSx, ...(c === "same" ? { bgcolor: "gray.200", color: "gray.700" } : { bgcolor: "blue.100", color: "blue.800" }) }}>{chip}</Box>
                                                </Box>
                                                <Typography variant="body2" sx={driverFigureSx}>
                                                    This county: <b>{d.format(d.area)}</b>
                                                    <Box component="span" sx={{ color: "gray.400" }}> · </Box>Metro typical: {d.format(d.metro)}
                                                </Typography>
                                                <Typography variant="body2" sx={driverResearchSx}>{d.research}</Typography>
                                                <SourceLink source={d.source} />
                                            </Box>
                                        );
                                    })}
                                    {context?.rate != null && (
                                        <Box component="li" sx={{ ...cardSx, p: 2 }}>
                                            <Box sx={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", justifyContent: "space-between", gap: 1 }}>
                                                <Typography variant="h4" sx={driverTitleSx}>{MORTGAGE.name}</Typography>
                                                {context.rateBefore != null && (
                                                    <Box component="span" sx={{ ...chipSx, bgcolor: "gray.200", color: "gray.700" }}>
                                                        {context.rate > context.rateBefore + 0.1 ? "Up from a year ago" : context.rate < context.rateBefore - 0.1 ? "Down from a year ago" : "Similar to a year ago"}
                                                    </Box>
                                                )}
                                            </Box>
                                            <Typography variant="body2" sx={driverFigureSx}>
                                                Latest: <b>{context.rate.toFixed(2)}%</b>
                                                {context.rateBefore != null && <><Box component="span" sx={{ color: "gray.400" }}> · </Box>A year earlier: {context.rateBefore.toFixed(2)}%</>}
                                            </Typography>
                                            <Typography variant="body2" sx={driverResearchSx}>{MORTGAGE.research}</Typography>
                                            <SourceLink source={MORTGAGE.source} />
                                        </Box>
                                    )}
                                </Box>

                                <Typography variant="caption" component="p" sx={{ mt: 2, ...smallPrintSx }}>
                                    Neighborhood values are from the U.S. Census American Community Survey; rents are from Zillow. "Metro typical" is the median
                                    across the metro's ZIP codes, and a county's value is the median of its ZIP codes. Research findings describe patterns across
                                    many places; they explain what tends to matter, not the exact cause of rent changes in one area.
                                </Typography>
                            </Box>
                        )}
                    </Box>

                    {current && <LocalMarketReport metro={metro} county={current} />}
                </Box>
            )}
        </Paper>
    );
}
