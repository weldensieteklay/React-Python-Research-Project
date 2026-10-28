
import { parseTerm, traitLabel } from "./utils";

// ---------------------------------------------------------------------------
// How sure we are. `evidence` (technical labels) is shared with the results table;
// the modal uses the plain labels.
// ---------------------------------------------------------------------------
const LEVELS = [
  [0.01, "strong", "Strong evidence"],
  [0.05, "moderate", "Evidence"],
  [0.1, "weak", "Weak evidence"],
];

export function evidence(p) {
  if (!Number.isFinite(p)) return { key: "none", label: "No clear effect" };
  for (const [cut, key, label] of LEVELS) if (p < cut) return { key, label };
  return { key: "none", label: "No clear effect" };
}

const PLAIN_LABEL = { strong: "Very clear", moderate: "Clear", weak: "Possible", none: "No real difference" };
const BADGE_TONE = { strong: "positive", moderate: "positive", weak: "caution", none: "neutral" };
const badgeFor = (p) => {
  const ev = evidence(p);
  return { label: PLAIN_LABEL[ev.key], tone: BADGE_TONE[ev.key] };
};

const isFinding = (r) => Number.isFinite(r.p) && r.p < 0.05;
const isClose = (r) => Number.isFinite(r.p) && r.p >= 0.04 && r.p < 0.05;

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------
const toPct = (b) => (Math.exp(b) - 1) * 100;
const signed = (v, d = 1) => (Number.isFinite(v) ? `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(d)}%` : "—");
const absPct = (v, d = 1) => `${Math.abs(v).toFixed(d)}%`;
const usd = (v) => `$${Math.round(v).toLocaleString("en-US")}`;
const usdAmount = (v) => usd(v < 10 ? Math.round(v) : Math.round(v / 5) * 5);
const round = (v, d = 0) => Number(v.toFixed(d)).toLocaleString("en-US");
const listJoin = (xs) => (xs.length <= 2 ? xs.join(" and ") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
const capFirst = (s) => s.charAt(0).toUpperCase() + s.slice(1);
// Lower-case the first letter for use mid-sentence, but never inside "ZIP"
const lowerFirst = (s) => (/^ZIP/.test(s) ? s : s.charAt(0).toLowerCase() + s.slice(1));
const usdRounded = (v) => usd(v >= 10000 ? Math.round(v / 1000) * 1000 : v);
const roundBySize = (v) => round(v >= 1000 ? Math.round(v / 100) * 100 : v);

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const monthName = (ym) => {
  const [y, m] = String(ym || "").split("-").map(Number);
  return y && m ? `${MONTHS_LONG[m - 1]} ${y}` : String(ym || "");
};
const nextMonth = (ym) => {
  const [y, m] = String(ym).split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
};

// ---------------------------------------------------------------------------
// Each neighborhood trait in everyday words. `step` describes the comparison the
// model makes (a typical ZIP vs one noticeably higher on the trait), in real units
// taken from the response.
// ---------------------------------------------------------------------------
const TRAITS = {
  boom: {
    label: "How much rent jumped during the boom",
    subject: "ZIPs whose rents jumped the most during the boom",
    step: (m, s) => `A ZIP whose rent jumped ${round((m + s) * 100)}% during the boom (instead of the typical ${round(m * 100)}%)`,
  },
  ln_base_rent: {
    label: "How pricey the area was before the boom",
    subject: "Pricier areas",
    step: (m, s, ctx) => `A ZIP where rent was ${usd(Math.exp(m + s))} in ${monthName(ctx.baseMonth)} (instead of the typical ${usd(Math.exp(m))})`,
  },
  dist_downtown_mi: {
    label: "Distance from downtown",
    subject: "ZIPs farther from downtown",
    step: (m, s) => `A ZIP ${round(m + s)} miles from downtown Dallas or Fort Worth (instead of the typical ${round(m)})`,
  },
  ln_median_income: {
    label: "Household income",
    subject: "Higher-income areas",
    step: (m, s) => `A ZIP where the typical household earned ${usdRounded(Math.exp(m + s))} a year (instead of ${usdRounded(Math.exp(m))})`,
  },
  renter_share: {
    label: "Share of households that rent",
    subject: "Areas where more people rent",
    step: (m, s) => `A ZIP where ${round((m + s) * 100)}% of households rent (instead of the typical ${round(m * 100)}%)`,
  },
  ln_pop_density: {
    label: "How crowded the area is",
    subject: "More crowded areas",
    step: (m, s) => `A ZIP with ${roundBySize(Math.exp(m + s))} people per square mile (instead of the typical ${roundBySize(Math.exp(m))})`,
  },
  renter_stock_growth: {
    label: "Growth in rental homes since 2019",
    subject: "Areas that added more rental homes",
    step: (m, s) => `A ZIP where the number of rented homes grew ${round((m + s) * 100)}% since 2019 (instead of the typical ${round(m * 100)}%)`,
  },
  new_build_share: {
    label: "Amount of new construction",
    subject: "Areas with more new construction",
    step: (m, s) => `A ZIP where ${round((m + s) * 100, 1)}% of homes were built in 2020 or later (instead of the typical ${round(m * 100, 1)}%)`,
  },
};

const plainLabel = (trait) => TRAITS[trait]?.label ?? traitLabel(trait);
const subjectOf = (trait) => TRAITS[trait]?.subject ?? `ZIPs higher on ${traitLabel(trait).toLowerCase()}`;

function countyName(trait) {
  if (trait === "outer_counties") return "the outer counties";
  return trait.split("_").map(capFirst).join(" ");
}

// ---------------------------------------------------------------------------
// Normalize the response
// ---------------------------------------------------------------------------
function normalizeRows(coefficients) {
  return (coefficients ?? []).map((c) => {
    const { period, trait } = parseTerm(c.term);
    const kind = period === null ? "rate" : /_count(y|ies)$/.test(trait) ? "county" : "trait";
    return {
      term: c.term,
      period,
      trait,
      kind,
      pct: Number.isFinite(c.pct_effect) ? c.pct_effect : toPct(c.coef),
      lo: toPct(c.ci_low),
      hi: toPct(c.ci_high),
      p: c.p_value,
    };
  });
}

function context(data) {
  const summary = {};
  for (const s of data?.trait_summary_raw_units ?? []) summary[s.trait] = s;
  const lb = summary.ln_base_rent;
  const boom = summary.boom;
  // Typical rent at the peak: typical pre-boom rent grown by the typical boom
  const typicalRent = lb && boom && Number.isFinite(lb.mean) && Number.isFinite(boom.mean)
    ? Math.round((Math.exp(lb.mean) * (1 + boom.mean)) / 10) * 10
    : null;
  const panel = data?.panel ?? {};
  const countyCounts = {};
  for (const [label, n] of Object.entries(data?.zips_by_county_group ?? {})) {
    countyCounts[label.toLowerCase().replace(/ /g, "_")] = n;
  }
  return {
    summary,
    typicalRent,
    baseMonth: panel.base_month || "2020-01",
    preStart: panel.pre_period?.[0],
    preEnd: panel.pre_period?.[1] ?? panel.post_after,
    postStart: panel.post_after ? nextMonth(panel.post_after) : null,
    windowEnd: panel.window?.[1],
    reference: data?.reference_county || "Dallas County",
    countyCounts,
    spec: data?.spec,
  };
}

// ---------------------------------------------------------------------------
// Dollars and plain "how sure" lines
// ---------------------------------------------------------------------------
const dollarsFor = (pct, ctx) => (ctx.typicalRent ? usdAmount((Math.abs(pct) * ctx.typicalRent) / 100) : null);

/** "about $50 a month" (or "about 2.9%" when no typical rent is known) */
function amount(r, ctx) {
  const d = dollarsFor(r.pct, ctx);
  return d ? `about ${d} a month` : `about ${absPct(r.pct)}`;
}

function stepPhrase(trait, ctx) {
  const t = TRAITS[trait];
  const s = ctx.summary[trait];
  if (t && s && Number.isFinite(s.mean) && Number.isFinite(s.std)) return t.step(s.mean, s.std, ctx);
  return `A ZIP noticeably higher on ${plainLabel(trait).toLowerCase()}`;
}

/** The small grey line under each factor: the best guess and a likely range, in plain words. */
function detailLine(r, ctx) {
  const d = dollarsFor(r.pct, ctx);
  const best = `Best guess: ${signed(r.pct)}${d && r.kind !== "rate" ? ` (${r.pct < 0 ? "−" : "+"}${d} a month)` : ""}`;
  return `${best} · Likely somewhere between ${signed(r.lo)} and ${signed(r.hi)}`;
}

const closeNote = (r) => (isClose(r) ? " This one is close to the line, so treat it as likely rather than certain." : "");

function describeFactor(r, ctx) {
  const ev = evidence(r.p);
  const better = r.pct > 0;

  if (r.kind === "rate") {
    const text = ev.key === "strong" || ev.key === "moderate"
      ? `When mortgage rates were higher, rents in pricier areas ran ${better ? "a little higher" : "a little lower"} compared with cheaper areas. Rates rose at the same time as many other things changed, so treat this as a pattern, not a cause.${closeNote(r)}`
      : ev.key === "weak"
        ? `There's a hint that mortgage rates affected pricier and cheaper areas differently, but it could easily be chance.`
        : "Mortgage-rate changes didn't make a real difference between pricier and cheaper areas.";
    return { label: "Mortgage rates and pricier areas", text, badge: badgeFor(r.p), detail: detailLine(r, ctx) };
  }

  let who;
  let versus;
  if (r.kind === "county") {
    who = `ZIPs in ${countyName(r.trait)}`;
    versus = `similar ZIPs in ${ctx.reference}`;
  } else {
    who = stepPhrase(r.trait, ctx);
    versus = "a typical ZIP that's similar in other ways";
  }

  let text;
  if (ev.key === "strong" || ev.key === "moderate") {
    text = `${who} held up ${better ? "better" : "worse"} after the peak, ending ${amount(r, ctx)} ${better ? "higher" : "lower"} than ${versus}, compared with where each stood at the peak.${closeNote(r)}`;
  } else if (ev.key === "weak") {
    text = `There's a hint that ${lowerFirst(who)} held up ${better ? "better" : "worse"} after the peak (${amount(r, ctx)}), but it could easily be chance.`;
  } else {
    text = `No real difference: ${lowerFirst(who)} did about the same as ${versus}.`;
  }

  const n = r.kind === "county" ? ctx.countyCounts[r.trait] : null;
  if (n != null && n < 5) text += ` This is based on only ${n} ZIP${n === 1 ? "" : "s"}, so take it with a grain of salt.`;

  return {
    label: r.kind === "county" ? `${capFirst(countyName(r.trait))} compared with ${ctx.reference}` : plainLabel(r.trait),
    text,
    badge: badgeFor(r.p),
    detail: detailLine(r, ctx),
  };
}

// ---------------------------------------------------------------------------
// Shared sections
// ---------------------------------------------------------------------------
function howToRead(ctx, { byYear = false } = {}) {
  const items = [
    `"Held up better" means a ZIP's rent after the peak (${monthName(ctx.postStart)} to ${monthName(ctx.windowEnd)}) stayed closer to its own level at the peak (${monthName(ctx.preStart)} to ${monthName(ctx.preEnd)}) than other ZIPs did. The ups and downs that hit all of DFW each month are set aside, so a ZIP can still be "worse" even if its rent kept rising, as long as it rose less than similar ZIPs.`,
    "Each neighborhood trait is tested by comparing a typical ZIP with one that's noticeably higher on that trait (for example, more renters), with everything else kept the same.",
    `County results compare each county with ${ctx.reference}.`,
    `"Very clear" and "Clear" results are unlikely to be luck. "Possible" means there's a hint worth watching. "No real difference" means any gap is small enough to be chance.`,
  ];
  if (byYear) items.push("The by-year view checks each trait separately for every year after the peak, so you can see whether a gap grew, shrank or stayed the same.");
  return { heading: "How to read this", items };
}

function cautions(data, rows, ctx, { byYear = false } = {}) {
  const items = [];
  const used = new Set(data?.traits_used ?? []);

  if (used.has("ln_base_rent") && used.has("ln_median_income")) {
    items.push("Pricier areas also tend to be higher-income areas, so read those two results together rather than on their own.");
  }
  const tested = rows.filter((r) => r.kind !== "rate").length;
  if (tested >= 8) {
    items.push(`We checked ${tested} things at once, so one of them could look meaningful by luck. Trust the strongest results most.`);
  }
  if (Number.isFinite(data?.r2_within)) {
    items.push(`These factors explain only part of the story: about ${Math.round(data.r2_within * 100)}% of why rents in different ZIPs moved differently. Local things the model can't see, like a new employer moving in or a big new apartment complex, explain the rest.`);
  }
  const dropped = data?.panel?.zips_dropped_incomplete?.length ?? 0;
  if (dropped > 0) {
    items.push(`${dropped} ZIPs weren't included because Zillow doesn't have their rents for every month since ${monthName(ctx.baseMonth)}. These are often newer, fast-growing areas, so the results describe established neighborhoods best.`);
  }
  const missingCov = data?.zips_dropped_missing_covariates?.length ?? 0;
  if (missingCov > 0) items.push(`${missingCov} ZIP${missingCov === 1 ? " was" : "s were"} left out because Census information wasn't available for ${missingCov === 1 ? "it" : "them"}.`);
  if (data?.traits_unavailable?.length) {
    items.push(`Not checked this time because the information didn't load: ${data.traits_unavailable.map((t) => plainLabel(t).toLowerCase()).join(", ")}.`);
  }
  if (ctx.spec === "base" && !byYear) {
    items.push("This version only knows each ZIP's county, so a county difference may really be about who lives there or how much was built, not the county itself.");
  }
  if (byYear && ctx.postStart && ctx.windowEnd) {
    const firstY = ctx.postStart.slice(0, 4);
    const lastY = ctx.windowEnd.slice(0, 4);
    const firstM = Number(ctx.postStart.slice(5, 7));
    const lastM = Number(ctx.windowEnd.slice(5, 7));
    const partial = [];
    if (firstM > 1) partial.push(`${firstY} only includes ${MONTHS[firstM - 1]}–Dec`);
    if (lastM < 12 && lastY !== firstY) partial.push(`${lastY} only Jan–${MONTHS[lastM - 1]}`);
    if (partial.length) items.push(`${capFirst(listJoin(partial))}, so those years are less certain.`);
  }
  return { heading: "Keep in mind", items };
}

function sampleSection(data, ctx) {
  const counts = Object.entries(data?.zips_by_county_group ?? {}).map(([k, v]) => `${k} ${v}`).join(" · ");
  return {
    heading: "What this is based on",
    items: [
      `Monthly rents for ${data?.n_zips ?? "—"} DFW ZIP codes from ${monthName(data?.panel?.window?.[0])} to ${monthName(ctx.windowEnd)}, from Zillow, plus neighborhood information from the U.S. Census.`,
      counts ? `ZIPs by county: ${counts}.` : null,
    ].filter(Boolean),
  };
}

// ---------------------------------------------------------------------------
// Compare the two versions (county only vs with neighborhood details)
// ---------------------------------------------------------------------------
function compareSpecs(baseData, fullData) {
  if (!baseData || !fullData) return null;
  const base = Object.fromEntries(normalizeRows(baseData.coefficients).map((r) => [r.term, r]));
  const full = Object.fromEntries(normalizeRows(fullData.coefficients).map((r) => [r.term, r]));
  const ctx = context(fullData);
  const items = [];
  const money = (r) => {
    const d = dollarsFor(r.pct, ctx);
    return d ? `${r.pct < 0 ? "−" : "+"}${d} a month` : signed(r.pct);
  };

  for (const term of Object.keys(base)) {
    const a = base[term];
    const b = full[term];
    if (!b || a.kind === "rate") continue;
    const name = a.kind === "county" ? capFirst(countyName(a.trait)) : plainLabel(a.trait);
    const move = `went from ${money(a)} to ${money(b)}`;
    const aSig = isFinding(a);
    const bSig = isFinding(b);
    const flipped = Math.sign(a.pct) !== Math.sign(b.pct) && (aSig || bSig);

    let note = null;
    if (flipped) {
      note = `${name}: ${move}. It flipped direction once we accounted for the neighborhood details${bSig ? ", and the new direction is clear" : ""}.`;
    } else if (aSig && !bSig) {
      note = `${name}: ${move}. Most of this difference is explained by the neighborhood details (who lives there and how much was built), not by ${a.kind === "county" ? "the county itself" : "this factor"}.`;
    } else if (!aSig && bSig) {
      note = `${name}: ${move}. This only shows up clearly once the neighborhood details are taken into account; before, other differences were hiding it.`;
    } else if (aSig && bSig && Math.abs(b.pct) < Math.abs(a.pct) * 0.6) {
      note = `${name}: ${move}. Still clear, but smaller: the neighborhood details explain part of it.`;
    } else if (aSig && bSig && Math.abs(b.pct) > Math.abs(a.pct) * 1.5) {
      note = `${name}: ${move}. Bigger once the neighborhood details are taken into account.`;
    }
    if (note) items.push(note);
  }

  if (!items.length) {
    items.push("Adding the neighborhood details barely changes the county results, so those details don't explain them.");
  }
  const nb = baseData.n_zips;
  const nf = fullData.n_zips;
  if (Number.isFinite(nb) && Number.isFinite(nf) && nb !== nf) {
    items.push(`The two versions use a slightly different set of ZIPs (${nb} vs ${nf}), which can also move the numbers a little.`);
  }
  return { heading: "What changes when neighborhood details are added", items };
}

// ---------------------------------------------------------------------------
// Results table (one result per factor)
// ---------------------------------------------------------------------------
function interpretPooled(data, { eventStudy, otherSpecData }) {
  const ctx = context(data);
  const rows = normalizeRows(data.coefficients).filter((r) => r.period === "all" || r.period === null);
  const traits = rows.filter((r) => r.kind === "trait");
  const counties = rows.filter((r) => r.kind === "county");
  const rate = rows.find((r) => r.kind === "rate");

  const sigTraits = traits.filter(isFinding).sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct));
  const sigCounties = counties.filter(isFinding).sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct));
  const weakAny = [...traits, ...counties].some((r) => evidence(r.p).key === "weak");

  const countyWithMoney = (r) => `${countyName(r.trait)} (${amount(r, ctx)} ${r.pct > 0 ? "more" : "less"})`;

  // ---- takeaway
  let verdict;
  if (eventStudy && sigCounties.length) {
    verdict = {
      tone: "positive",
      text: `After the peak, rents in ${listJoin(sigCounties.map(countyWithMoney))} held up differently from ${ctx.reference}. The neighborhood traits are shown year by year in the chart below.`,
    };
  } else if (sigTraits.length) {
    const s0 = sigTraits[0];
    verdict = {
      tone: "positive",
      text: `Yes, the boom ended differently in different parts of DFW. The biggest difference: ${lowerFirst(subjectOf(s0.trait))} held their rents ${s0.pct > 0 ? "better" : "worse"} after the peak, ${amount(s0, ctx)} ${s0.pct > 0 ? "more" : "less"} than a typical ZIP.`,
    };
  } else if (sigCounties.length) {
    const better = sigCounties.filter((r) => r.pct > 0);
    const worse = sigCounties.filter((r) => r.pct < 0);
    const parts = [];
    if (better.length) parts.push(`ZIPs in ${listJoin(better.map(countyWithMoney))} held their rents better`);
    if (worse.length) parts.push(`ZIPs in ${listJoin(worse.map(countyWithMoney))} held their rents worse`);
    verdict = { tone: "positive", text: `Yes, depending on location: ${listJoin(parts)} than ${ctx.reference} after the peak.` };
  } else if (weakAny) {
    verdict = { tone: "mixed", text: "Only hints. None of these factors made a clear difference, though a few are worth watching." };
  } else {
    verdict = { tone: "neutral", text: "No. After the peak, none of these factors made a real difference to how rents held up." };
  }

  // ---- what we found
  const findings = [];
  const boom = traits.find((r) => r.trait === "boom");
  if (boom) {
    const ev = evidence(boom.p);
    if (isFinding(boom) && boom.pct < 0) {
      findings.push(`The areas that jumped the most gave a little back: ${lowerFirst(stepPhrase("boom", ctx))} ended up ${amount(boom, ctx)} lower after the peak than a typical ZIP.${closeNote(boom)}`);
    } else if (isFinding(boom) && boom.pct > 0) {
      findings.push(`The areas that jumped the most kept going: ${lowerFirst(stepPhrase("boom", ctx))} ended up ${amount(boom, ctx)} higher after the peak than a typical ZIP.${closeNote(boom)}`);
    } else if (ev.key === "weak") {
      findings.push(`There's only a hint that how much rent jumped during the boom affected what happened next; it could easily be chance.`);
    } else {
      findings.push(`How much a ZIP's rent jumped during the boom didn't predict what happened next. The biggest risers didn't fall back any harder.`);
    }
  }

  const nonBoom = sigTraits.filter((r) => r.trait !== "boom");
  const phrase = (r) => `${lowerFirst(subjectOf(r.trait))} did ${r.pct > 0 ? "better" : "worse"} (${amount(r, ctx)})`;
  const top = nonBoom.slice(0, 3);
  const rest = nonBoom.slice(3);
  if (top.length) {
    findings.push(`${boom ? "Other clear patterns" : "Clear patterns"}: ${listJoin(top.map(phrase))}.`);
  }
  if (rest.length) findings.push(`Smaller, but also clear: ${listJoin(rest.map(phrase))}.`);

  if (sigCounties.length) {
    const parts = sigCounties.map((r) => `${countyName(r.trait)} ${r.pct > 0 ? "held up better" : "held up worse"} (${amount(r, ctx)})`);
    findings.push(`By county, compared with ${ctx.reference}: ${listJoin(parts)}${ctx.spec === "full" ? ", even after accounting for the neighborhood details" : ""}.`);
  } else if (counties.length) {
    findings.push(`No county was clearly different from ${ctx.reference}${ctx.spec === "full" ? " once the neighborhood details are taken into account" : ""}.`);
  }

  if (ctx.spec === "base" && !eventStudy) {
    findings.push("This version only looks at rents and county, so it shows where rents held up but not why. Switch to \"With Census factors\" to see the role of things like the share of renters and new construction.");
  }

  // ---- each factor, most certain first
  const ordered = [...traits, ...counties, ...(rate ? [rate] : [])].sort((a, b) => (a.p ?? 1) - (b.p ?? 1));
  const factorItems = ordered.map((r) => describeFactor(r, ctx));

  const sections = [
    { heading: "What we found", items: findings },
    howToRead(ctx),
    { heading: "Each factor, most certain first", items: factorItems },
  ];

  if (!eventStudy) {
    const pair = ctx.spec === "full" ? compareSpecs(otherSpecData, data) : compareSpecs(data, otherSpecData);
    if (pair) sections.push(pair);
    else sections.push({
      heading: "What changes when neighborhood details are added",
      items: [`Open "${ctx.spec === "full" ? "Rent & county only" : "With Census factors"}" once, then come back to this summary to see how the two versions compare.`],
    });
  }

  sections.push(cautions(data, rows, ctx), sampleSection(data, ctx));

  return {
    title: eventStudy ? "Results that don't change by year" : ctx.spec === "full" ? "What the results say: with neighborhood details" : "What the results say: rent and county only",
    subtitle: "Did rents in different DFW neighborhoods hold up differently after the 2021–22 boom?",
    verdict,
    sections,
  };
}

// ---------------------------------------------------------------------------
// By-year chart
// ---------------------------------------------------------------------------
const overlaps = (a, b) => !(a.hi < b.lo || b.hi < a.lo);

function describeSeries(trait, ys, ctx) {
  const first = ys[0];
  const last = ys[ys.length - 1];
  const sig = ys.filter(isFinding);
  const values = ys.map((y) => `${y.period}: ${signed(y.pct)}`).join(" · ");
  const subject = subjectOf(trait);
  const label = plainLabel(trait);
  const money = (r) => amount(r, ctx);

  if (!sig.length) {
    return {
      label, pattern: "none",
      badge: { label: "No real difference", tone: "neutral" },
      text: "No real difference in any year after the peak.",
      detail: values,
    };
  }

  const signs = new Set(sig.map((y) => Math.sign(y.pct)));
  const dir = (v) => (v > 0 ? "better" : "worse");
  const sigYears = sig.map((y) => y.period);
  const maybeChance = overlaps(first, last) ? " The change from year to year is small enough that it could be chance." : "";
  let pattern;
  let text;

  if (signs.size > 1) {
    pattern = "mixed";
    text = `${subject} did better in some years and worse in others, so there's no single direction.`;
  } else {
    const d = dir(sig[0].pct);
    const firstSig = isFinding(first);
    const lastSig = isFinding(last);
    if (firstSig && lastSig) {
      if (!overlaps(first, last) && Math.sign(first.pct) === Math.sign(last.pct)) {
        pattern = Math.abs(last.pct) > Math.abs(first.pct) ? "widening" : "narrowing";
        text = `${subject} did ${d} every year, and the gap ${pattern === "widening" ? "grew" : "shrank"}: ${money(first)} in ${first.period}, ${money(last)} by ${last.period}.`;
      } else {
        pattern = "steady";
        text = `${subject} did ${d} from ${first.period} through ${last.period}, by roughly the same amount (${money(first)} in ${first.period}, ${money(last)} in ${last.period}).${maybeChance}`;
      }
    } else if (!firstSig && lastSig) {
      pattern = "emerging";
      text = `${subject} slowly ${d === "better" ? "pulled ahead" : "fell behind"}: no real gap in ${first.period}, but ${money(last)} by ${last.period}.${maybeChance}`;
    } else if (firstSig && !lastSig) {
      pattern = "fading";
      text = `${subject} did ${d} at first (${money(first)} in ${first.period}), but the gap faded and is gone by ${last.period}.${maybeChance}`;
    } else {
      pattern = "on-off";
      text = `${subject} did ${d} only in ${listJoin(sigYears)}, not at the start or the end, so there's no steady pattern.`;
    }
  }

  const BADGES = {
    widening: ["Gap growing", "positive"], narrowing: ["Gap shrinking", "caution"], steady: ["Gap steady", "positive"],
    emerging: ["Gap appeared later", "positive"], fading: ["Gap faded", "caution"], "on-off": ["On and off", "caution"],
    mixed: ["Changed direction", "caution"],
  };
  const [bl, bt] = BADGES[pattern];
  return { label, pattern, badge: { label: bl, tone: bt }, text, detail: values };
}

function interpretByYear(data) {
  const ctx = context(data);
  const rows = normalizeRows(data.coefficients);
  const yearRows = rows.filter((r) => r.period && r.period !== "all" && r.kind === "trait");

  const series = {};
  for (const r of yearRows) (series[r.trait] ||= []).push(r);
  for (const t of Object.keys(series)) series[t].sort((a, b) => a.period.localeCompare(b.period));

  const order = (data.traits_used ?? Object.keys(series)).filter((t) => series[t]);
  const described = order.map((t) => ({ trait: t, ...describeSeries(t, series[t], ctx) }));
  const withEffect = described.filter((d) => d.pattern !== "none");
  const lastYear = yearRows.reduce((m, r) => (r.period > m ? r.period : m), "");
  const stillClear = described.filter((d) => series[d.trait].some((y) => y.period === lastYear && isFinding(y)));

  const verdict = withEffect.length
    ? {
        tone: "positive",
        text: `${withEffect.length} of the ${described.length} things we checked made a clear difference in at least one year after the peak. ${stillClear.length ? `Still making a difference in ${lastYear}: ${listJoin(stillClear.map((d) => d.label.toLowerCase()))}.` : `None of them still made a clear difference in ${lastYear}.`}`,
      }
    : { tone: "neutral", text: "None of these things made a real difference in any year after the peak." };

  const findings = [];
  const boom = described.find((d) => d.trait === "boom");
  if (boom) {
    findings.push(boom.pattern === "none"
      ? "How much a ZIP's rent jumped during the boom never made a real difference afterwards: the biggest risers didn't fall back or pull ahead over time."
      : `How much rent jumped during the boom: ${boom.text}`);
  }
  for (const d of withEffect.filter((x) => x.trait !== "boom")) findings.push(`${d.label}: ${d.text}`);
  if (!findings.length) findings.push("In every year, the differences are small enough to be chance.");

  const sections = [
    { heading: "What we found", items: findings },
    howToRead(ctx, { byYear: true }),
    { heading: "Each factor, year by year", items: described.map(({ label, text, badge, detail }) => ({ label, text, badge, detail })) },
    cautions(data, rows.filter((r) => r.kind !== "trait" || r.period !== "all"), ctx, { byYear: true }),
    sampleSection(data, ctx),
  ];

  return {
    title: "Year by year: did the gaps grow or shrink?",
    subtitle: "Did rents in different DFW neighborhoods hold up differently after the 2021–22 boom?",
    verdict,
    sections,
  };
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------
/**
 * data: the /dfw-rent-divergence response.
 * focus: "pooled" (the results table) or "byYear" (the by-year chart).
 * otherSpecData: the response for the other version (results table only), if loaded,
 *                used to explain what changes when neighborhood details are added.
 */
export function interpretDivergence(data, { focus = "pooled", otherSpecData = null } = {}) {
  if (!data?.coefficients?.length) {
    return {
      title: "No results to explain",
      verdict: { tone: "neutral", text: "The analysis didn't return any results." },
      sections: [],
    };
  }
  if (focus === "byYear") return interpretByYear(data);
  return interpretPooled(data, { eventStudy: Boolean(data.event_study), otherSpecData });
}

/** Plain-text version of a report, for copying into notes or an email. */
export function reportToText(report) {
  const lines = [report.title];
  if (report.subtitle) lines.push(report.subtitle);
  if (report.verdict?.text) lines.push("", `Takeaway: ${report.verdict.text}`);
  for (const s of report.sections ?? []) {
    lines.push("", s.heading.toUpperCase());
    for (const it of s.items) {
      if (typeof it === "string") lines.push(`- ${it}`);
      else {
        lines.push(`- ${it.label ? `${it.label}${it.badge ? ` [${it.badge.label}]` : ""}: ` : ""}${it.text}`);
        if (it.detail) lines.push(`  (${it.detail})`);
      }
    }
  }
  return lines.join("\n");
}
