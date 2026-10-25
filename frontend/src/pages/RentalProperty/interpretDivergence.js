// ===========================================================================
// Plain-language interpretation of the rent-divergence model
// (GET data/dfw-rent-divergence). Every sentence is built from the numbers in
// the response, so the text changes whenever the results change.
//
// Evidence levels use the same cut-offs as the results table:
//   p < 0.01 strong · p < 0.05 evidence · p < 0.10 weak · otherwise no clear effect
// A result is called a finding only at p < 0.05; weaker results are reported as hints.
//
// Output is a generic report object rendered by AnalysisModal:
//   { title, subtitle, verdict: {tone, text}, sections: [{ heading, items }] }
//   where an item is a string or { text, badge?: {label, tone}, detail? }
// ===========================================================================

import { parseTerm, traitLabel } from "./utils";

// ---------------------------------------------------------------------------
// Evidence levels (shared with the table, so the two never disagree)
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

const isFinding = (r) => Number.isFinite(r.p) && r.p < 0.05;
const BADGE_TONE = { strong: "positive", moderate: "positive", weak: "caution", none: "neutral" };

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------
const toPct = (b) => (Math.exp(b) - 1) * 100;
const signed = (v, d = 1) => (Number.isFinite(v) ? `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(d)}%` : "—");
const absPct = (v, d = 1) => `${Math.abs(v).toFixed(d)}%`;
const fmtP = (p) => (!Number.isFinite(p) ? "—" : p < 0.001 ? "<0.001" : p.toFixed(3));
const usd = (v) => `$${Math.round(v).toLocaleString("en-US")}`;
const usdAmount = (v) => usd(v < 10 ? Math.round(v) : Math.round(v / 5) * 5);
const round = (v, d = 0) => Number(v.toFixed(d)).toLocaleString("en-US");
const listJoin = (xs) => (xs.length <= 2 ? xs.join(" and ") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
const capFirst = (s) => s.charAt(0).toUpperCase() + s.slice(1);
// Lower-case the first letter for use mid-sentence, but never inside "ZIP"
const lowerFirst = (s) => (/^ZIP/.test(s) ? s : s.charAt(0).toLowerCase() + s.slice(1));
// Round to a sensible precision for the size of the number ($1,581 · $114,000)
const usdRounded = (v) => usd(v >= 10000 ? Math.round(v / 1000) * 1000 : v);
const roundBySize = (v) => round(v >= 1000 ? Math.round(v / 100) * 100 : v);
// A p-value just under 0.05 is a finding, but a fragile one
const borderline = (r) => (r.p >= 0.04 && r.p < 0.05 ? ` This only just clears the usual bar (p = ${r.p.toFixed(3)}).` : "");

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthName = (ym) => {
  const [y, m] = String(ym || "").split("-").map(Number);
  return y && m ? `${MONTHS[m - 1]} ${y}` : String(ym || "");
};
const nextMonth = (ym) => {
  const [y, m] = String(ym).split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
};

// ---------------------------------------------------------------------------
// What "one step" (1 SD) means for each trait, in real units from the response
// ---------------------------------------------------------------------------
const TRAITS = {
  boom: {
    subject: "ZIPs with bigger booms",
    step: (m, s) => `a ZIP whose rent rose ${round((m + s) * 100)}% during the boom instead of the typical ${round(m * 100)}%`,
  },
  ln_base_rent: {
    subject: "Pricier ZIPs (before the boom)",
    step: (m, s, ctx) => `a ZIP renting for ${usd(Math.exp(m + s))} in ${monthName(ctx.baseMonth)} instead of a typical ${usd(Math.exp(m))}`,
  },
  dist_downtown_mi: {
    subject: "ZIPs farther from downtown",
    step: (m, s) => `a ZIP ${round(m + s)} miles from downtown instead of ${round(m)}`,
  },
  ln_median_income: {
    subject: "Higher-income ZIPs",
    step: (m, s) => `a ZIP with a median household income of ${usdRounded(Math.exp(m + s))} instead of ${usdRounded(Math.exp(m))} (2019)`,
  },
  renter_share: {
    subject: "Renter-heavy ZIPs",
    step: (m, s) => `a ZIP where ${round((m + s) * 100)}% of households rent instead of ${round(m * 100)}% (2019)`,
  },
  ln_pop_density: {
    subject: "Denser ZIPs",
    step: (m, s) => `a ZIP with ${roundBySize(Math.exp(m + s))} people per square mile instead of ${roundBySize(Math.exp(m))}`,
  },
  renter_stock_growth: {
    subject: "ZIPs that added more rented homes",
    step: (m, s) => `a ZIP whose number of rented homes grew ${round((m + s) * 100)}% since 2019 instead of ${round(m * 100)}%`,
  },
  new_build_share: {
    subject: "ZIPs with more new construction",
    step: (m, s) => `a ZIP where ${round((m + s) * 100, 1)}% of homes were built in 2020 or later instead of ${round(m * 100, 1)}%`,
  },
};

const RATE_TERM = "mortgage_rate_x_ln_base_rent";

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
// One factor, in words
// ---------------------------------------------------------------------------
function stepPhrase(trait, ctx) {
  const t = TRAITS[trait];
  const s = ctx.summary[trait];
  if (t && s && Number.isFinite(s.mean) && Number.isFinite(s.std)) return t.step(s.mean, s.std, ctx);
  return `a ZIP one standard deviation higher on ${traitLabel(trait).toLowerCase()}`;
}

const subjectOf = (trait) => TRAITS[trait]?.subject ?? `ZIPs higher on ${traitLabel(trait).toLowerCase()}`;

function dollars(r, ctx) {
  if (!ctx.typicalRent) return "";
  return ` (about ${usdAmount((Math.abs(r.pct) * ctx.typicalRent) / 100)} a month on a typical ${usd(ctx.typicalRent)} rent)`;
}

function detailLine(r) {
  return `Estimate ${signed(r.pct, 2)} · 95% range ${signed(r.lo)} to ${signed(r.hi)} · p ${fmtP(r.p)}`;
}

function describeFactor(r, ctx) {
  const ev = evidence(r.p);
  const dir = r.pct > 0 ? "better" : "worse";
  let who;
  let versus;

  if (r.kind === "rate") {
    const higher = r.pct > 0 ? "higher" : "lower";
    const base = `In months when the 30-year mortgage rate was 1 point above average, pricier ZIPs (one step up on pre-boom rent) ran about ${absPct(r.pct, 2)} ${higher} relative to cheaper ZIPs.`;
    const text = ev.key === "strong" || ev.key === "moderate"
      ? base
      : ev.key === "weak"
        ? `${base} The evidence is weak: the 95% range includes zero.`
        : "No clear link between mortgage-rate swings and how pricier versus cheaper ZIPs moved.";
    return { label: traitLabel(r.trait), text: text + borderline(r), badge: { label: ev.label, tone: BADGE_TONE[ev.key] }, detail: detailLine(r) };
  }

  if (r.kind === "county") {
    who = `ZIPs in ${countyName(r.trait)}`;
    versus = `similar ZIPs in ${ctx.reference}`;
  } else {
    who = capFirst(stepPhrase(r.trait, ctx));
    versus = "an otherwise similar ZIP at the average";
  }

  let text;
  if (ev.key === "strong" || ev.key === "moderate") {
    text = `${who} did about ${absPct(r.pct)} ${dir} after the peak than ${versus}${dollars(r, ctx)}.${borderline(r)}`;
  } else if (ev.key === "weak") {
    text = `${who} may have done about ${absPct(r.pct)} ${dir} than ${versus}, but the evidence is weak: the 95% range (${signed(r.lo)} to ${signed(r.hi)}) includes zero.`;
  } else {
    text = `No clear difference: ${lowerFirst(who)} did about the same as ${versus}. The estimate (${signed(r.pct)}) is small next to its uncertainty (${signed(r.lo)} to ${signed(r.hi)}).`;
  }

  const n = r.kind === "county" ? ctx.countyCounts[r.trait] : null;
  if (n != null && n < 5) text += ` Based on only ${n} ZIP${n === 1 ? "" : "s"}, so treat it with caution.`;

  return {
    label: r.kind === "county" ? `${capFirst(countyName(r.trait))} vs ${ctx.reference}` : traitLabel(r.trait),
    text,
    badge: { label: ev.label, tone: BADGE_TONE[ev.key] },
    detail: detailLine(r),
  };
}

// ---------------------------------------------------------------------------
// Shared sections
// ---------------------------------------------------------------------------
function howToRead(ctx, { byYear = false } = {}) {
  const items = [
    `"Better" or "worse" compares a ZIP's rent after the peak (${monthName(ctx.postStart)} to ${monthName(ctx.windowEnd)}) with its own rent around the peak (${monthName(ctx.preStart)} to ${monthName(ctx.preEnd)}), after removing the DFW-wide movement in each month. A ZIP whose rent kept rising can still be "worse" if it rose less than similar ZIPs.`,
    "For neighborhood traits, each effect is for one step up on that trait (one standard deviation, the typical spread between ZIPs), with the other factors held equal.",
    `County effects compare with ${ctx.reference}.`,
  ];
  if (byYear) items.push("In the by-year view, each trait gets a separate effect for every calendar year after the peak, so you can see whether a gap grew, shrank or held steady.");
  return { heading: "How to read these numbers", items };
}

function cautions(data, rows, ctx, { byYear = false } = {}) {
  const items = [];
  const used = new Set(data?.traits_used ?? []);

  if (rows.some((r) => r.kind === "rate")) {
    items.push("The mortgage-rate term relies on rates changing over time, which happened at the same time as the post-peak period itself, so it is hard to separate from other things that changed then. Read it as descriptive, not causal.");
  }
  if (used.has("ln_base_rent") && used.has("ln_median_income")) {
    items.push("Pre-boom rent and median income are closely related (pricier areas tend to be higher-income), so read those two results together rather than one by one.");
  }
  const tested = rows.filter((r) => r.kind !== "rate").length;
  if (tested >= 8) {
    items.push(`With ${tested} effects tested, roughly ${(tested * 0.05).toFixed(1)} could pass p < 0.05 by chance alone. Lean on the strongest and most consistent results.`);
  }
  if (Number.isFinite(data?.r2_within)) {
    items.push(`These factors explain about ${Math.round(data.r2_within * 100)}% of the variation in rents left after removing each ZIP's own average level and the DFW-wide month-to-month movement. Local factors not in the model explain the rest.`);
  }
  const dropped = data?.panel?.zips_dropped_incomplete?.length ?? 0;
  if (dropped > 0) {
    items.push(`${dropped} ZIPs were left out because their rent history doesn't run from ${monthName(ctx.baseMonth)} to ${monthName(ctx.windowEnd)}. These are often newer, fast-growing areas, so the results describe established ZIPs best.`);
  }
  const missingCov = data?.zips_dropped_missing_covariates?.length ?? 0;
  if (missingCov > 0) items.push(`${missingCov} ZIP(s) were left out for missing Census data.`);
  if (data?.traits_unavailable?.length) {
    items.push(`Not tested because the data didn't load: ${data.traits_unavailable.map((t) => traitLabel(t).toLowerCase()).join(", ")}.`);
  }
  if (ctx.spec === "base" && !byYear) {
    items.push("Without the Census factors, a county difference may reflect who lives there and how much was built rather than anything about the county itself.");
  }
  if (byYear && ctx.postStart && ctx.windowEnd) {
    const firstY = ctx.postStart.slice(0, 4);
    const lastY = ctx.windowEnd.slice(0, 4);
    const firstM = Number(ctx.postStart.slice(5, 7));
    const lastM = Number(ctx.windowEnd.slice(5, 7));
    const partial = [];
    if (firstM > 1) partial.push(`${firstY} covers only ${MONTHS[firstM - 1]}–Dec`);
    if (lastM < 12 && lastY !== firstY) partial.push(`${lastY} only Jan–${MONTHS[lastM - 1]}`);
    if (partial.length) items.push(`${listJoin(partial)}, so those years are estimated from fewer months.`);
  }
  return { heading: "Keep in mind", items };
}

function sampleSection(data, ctx) {
  const counts = Object.entries(data?.zips_by_county_group ?? {}).map(([k, v]) => `${k} ${v}`).join(" · ");
  return {
    heading: "Data used",
    items: [
      `${data?.n_zips ?? "—"} ZIP codes, ${data?.panel?.months ?? "—"} months (${monthName(data?.panel?.window?.[0])} to ${monthName(ctx.windowEnd)}).`,
      counts ? `ZIPs by county group: ${counts}.` : null,
    ].filter(Boolean),
  };
}

// ---------------------------------------------------------------------------
// Compare the two pooled models (rent & county only vs with Census factors)
// ---------------------------------------------------------------------------
function compareSpecs(baseData, fullData) {
  if (!baseData || !fullData) return null;
  const base = Object.fromEntries(normalizeRows(baseData.coefficients).map((r) => [r.term, r]));
  const full = Object.fromEntries(normalizeRows(fullData.coefficients).map((r) => [r.term, r]));
  const items = [];

  for (const term of Object.keys(base)) {
    const a = base[term];
    const b = full[term];
    if (!b || a.kind === "rate") continue;
    const name = a.kind === "county" ? capFirst(countyName(a.trait)) : traitLabel(a.trait);
    const move = `${signed(a.pct)} → ${signed(b.pct)}`;
    const aSig = isFinding(a);
    const bSig = isFinding(b);
    const flipped = Math.sign(a.pct) !== Math.sign(b.pct) && (aSig || bSig);

    let note = null;
    if (flipped) {
      note = `${name}: ${move}. The direction reversed once the Census factors were held equal${bSig ? ", and the new direction is a finding" : ""}.`;
    } else if (aSig && !bSig) {
      note = `${name}: ${move}. No longer a clear finding once the Census factors are held equal, so most of this difference is explained by those factors.`;
    } else if (!aSig && bSig) {
      note = `${name}: ${move}. Became a clear finding once the Census factors are held equal; it was hidden by differences in those factors.`;
    } else if (aSig && bSig && Math.abs(b.pct) < Math.abs(a.pct) * 0.6) {
      note = `${name}: ${move}. Still a finding, but smaller: part of it is explained by the Census factors.`;
    } else if (aSig && bSig && Math.abs(b.pct) > Math.abs(a.pct) * 1.5) {
      note = `${name}: ${move}. Larger once the Census factors are held equal.`;
    }
    if (note) items.push(note);
  }

  if (!items.length) {
    items.push("The rent and county results barely change when the Census factors are added, so the Census factors don't explain them.");
  }
  const nb = baseData.n_zips;
  const nf = fullData.n_zips;
  if (Number.isFinite(nb) && Number.isFinite(nf) && nb !== nf) {
    items.push(`The two models use slightly different ZIPs (${nb} vs ${nf}, because of missing Census data), which can also move the estimates a little.`);
  }
  return { heading: "What changes when Census factors are added", items };
}

// ---------------------------------------------------------------------------
// Pooled table (one effect per factor)
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

  // ---- verdict
  let verdict;
  const countyList = (rs) => listJoin(rs.map((r) => `${countyName(r.trait)} (${signed(r.pct)})`));
  if (eventStudy && sigCounties.length) {
    verdict = {
      tone: "positive",
      text: `By location: after the peak, ${countyList(sigCounties)} differed clearly from ${ctx.reference}. Trait effects are shown year by year in the chart.`,
    };
  } else if (sigTraits.length) {
    const s0 = sigTraits[0];
    verdict = {
      tone: "positive",
      text: `Yes. The boom ended differently across DFW ZIPs. The largest clear effect: ${lowerFirst(subjectOf(s0.trait))} did ${s0.pct > 0 ? "better" : "worse"} after the peak (${signed(s0.pct)} per step).`,
    };
  } else if (sigCounties.length) {
    const better = sigCounties.filter((r) => r.pct > 0);
    const worse = sigCounties.filter((r) => r.pct < 0);
    const parts = [];
    if (better.length) parts.push(`ZIPs in ${countyList(better)} held up better`);
    if (worse.length) parts.push(`ZIPs in ${countyList(worse)} held up worse`);
    verdict = { tone: "positive", text: `Yes, by location: ${listJoin(parts)} than ${ctx.reference} after the peak.` };
  } else if (weakAny) {
    verdict = { tone: "mixed", text: "Only weak signs. No factor clears the usual bar for evidence (p < 0.05), though a few show hints." };
  } else {
    verdict = { tone: "neutral", text: "No. After the peak, none of these factors made a clear difference to how rents held up." };
  }

  // ---- key findings
  const findings = [];
  const boom = traits.find((r) => r.trait === "boom");
  if (boom) {
    const ev = evidence(boom.p);
    if (isFinding(boom) && boom.pct < 0) {
      findings.push(`The biggest risers gave back more: ${stepPhrase("boom", ctx)} did about ${absPct(boom.pct)} worse after the peak${dollars(boom, ctx)}.${borderline(boom)}`);
    } else if (isFinding(boom) && boom.pct > 0) {
      findings.push(`The biggest risers kept their momentum: ${stepPhrase("boom", ctx)} did about ${absPct(boom.pct)} better after the peak${dollars(boom, ctx)}.${borderline(boom)}`);
    } else if (ev.key === "weak") {
      findings.push(`Only a weak hint that boom size mattered (${signed(boom.pct)}, range ${signed(boom.lo)} to ${signed(boom.hi)}).`);
    } else {
      findings.push(`How much a ZIP's rent jumped during the boom did not predict how it did afterwards (${signed(boom.pct)}, range ${signed(boom.lo)} to ${signed(boom.hi)}).`);
    }
  }

  const nonBoom = sigTraits.filter((r) => r.trait !== "boom");
  const phrase = (r) => `${lowerFirst(subjectOf(r.trait))} did ${r.pct > 0 ? "better" : "worse"} (${signed(r.pct)} per step)`;
  const top = nonBoom.slice(0, 3);
  const rest = nonBoom.slice(3);
  if (top.length) {
    findings.push(`${boom ? "Beyond boom size, the" : "The"} largest clear ${top.length === 1 ? "effect" : "effects"}: ${listJoin(top.map(phrase))}.`);
  }
  if (rest.length) findings.push(`Smaller but also clear: ${listJoin(rest.map(phrase))}.`);

  if (sigCounties.length) {
    const parts = sigCounties.map((r) => `${countyName(r.trait)} ${signed(r.pct)}`);
    findings.push(`By location, compared with ${ctx.reference}: ${listJoin(parts)}${ctx.spec === "full" ? ", even with the Census factors held equal" : ""}.`);
  } else if (counties.length) {
    findings.push(`No county differed clearly from ${ctx.reference}${ctx.spec === "full" ? " once the Census factors are held equal" : ""}.`);
  }

  if (ctx.spec === "base" && !eventStudy) {
    findings.push("This version knows only rents and county, so it shows where rents held up, not why. Switch to \"With Census factors\" to test explanations such as renter share and new construction.");
  }

  // ---- factor by factor, strongest evidence first
  const ordered = [...traits, ...counties, ...(rate ? [rate] : [])].sort((a, b) => (a.p ?? 1) - (b.p ?? 1));
  const factorItems = ordered.map((r) => describeFactor(r, ctx));

  const sections = [
    { heading: "Key findings", items: findings },
    howToRead(ctx),
    { heading: "Factor by factor (strongest evidence first)", items: factorItems },
  ];

  if (!eventStudy) {
    const pair = ctx.spec === "full" ? compareSpecs(otherSpecData, data) : compareSpecs(data, otherSpecData);
    if (pair) sections.push(pair);
    else sections.push({
      heading: "What changes when Census factors are added",
      items: [`Open "${ctx.spec === "full" ? "Rent & county only" : "With Census factors"}" once, then reopen this summary to see how the results change between the two models.`],
    });
  }

  sections.push(cautions(data, rows, ctx), sampleSection(data, ctx));

  return {
    title: eventStudy ? "Effects that don't vary by year" : ctx.spec === "full" ? "With Census factors: what the results say" : "Rent & county only: what the results say",
    subtitle: "Did the 2021–22 rent boom end differently across DFW ZIPs?",
    verdict,
    sections,
  };
}

// ---------------------------------------------------------------------------
// By-year chart (event study)
// ---------------------------------------------------------------------------
const overlaps = (a, b) => !(a.hi < b.lo || b.hi < a.lo);

function describeSeries(trait, ys, ctx) {
  const first = ys[0];
  const last = ys[ys.length - 1];
  const sig = ys.filter(isFinding);
  const values = ys.map((y) => `${y.period} ${signed(y.pct)}`).join(", ");
  const subject = subjectOf(trait);
  const label = traitLabel(trait);

  if (!sig.length) {
    const lo = Math.min(...ys.map((y) => y.pct));
    const hi = Math.max(...ys.map((y) => y.pct));
    return {
      label, pattern: "none",
      badge: { label: "No clear effect", tone: "neutral" },
      text: `No clear effect in any year (estimates between ${signed(lo)} and ${signed(hi)}).`,
      detail: values,
    };
  }

  const signs = new Set(sig.map((y) => Math.sign(y.pct)));
  const dir = (v) => (v > 0 ? "better" : "worse");
  const sigYears = sig.map((y) => y.period);
  let pattern;
  let text;

  if (signs.size > 1) {
    pattern = "mixed";
    text = `${subject} did better in some years and worse in others (${sig.map((y) => `${y.period} ${signed(y.pct)}`).join(", ")}), so there's no single direction.`;
  } else {
    const d = dir(sig[0].pct);
    const firstSig = isFinding(first);
    const lastSig = isFinding(last);
    const change = overlaps(first, last) ? " The change between those years is within the margin of error." : "";
    if (firstSig && lastSig) {
      if (!overlaps(first, last) && Math.sign(first.pct) === Math.sign(last.pct)) {
        pattern = Math.abs(last.pct) > Math.abs(first.pct) ? "widening" : "narrowing";
        text = `${subject} did ${d} throughout, and the gap clearly ${pattern === "widening" ? "widened" : "narrowed"}: ${signed(first.pct)} in ${first.period}, ${signed(last.pct)} in ${last.period}.`;
      } else {
        pattern = "steady";
        const allYears = sig.length === ys.length;
        text = `${subject} did ${d} in ${first.period} (${signed(first.pct)}) and still in ${last.period} (${signed(last.pct)})${allYears ? ", with a clear gap in every year" : `, with a clear gap in ${listJoin(sigYears)}`}. The gap held roughly steady.${change}`;
      }
    } else if (!firstSig && lastSig) {
      pattern = "emerging";
      text = `${subject} pulled ${d === "better" ? "ahead" : "behind"} over time: no clear gap in ${first.period} (${signed(first.pct)}), a clear one by ${last.period} (${signed(last.pct)}).${change}`;
    } else if (firstSig && !lastSig) {
      pattern = "fading";
      text = `${subject} did ${d} at first (${signed(first.pct)} in ${first.period}), but the gap faded and is no longer clear by ${last.period} (${signed(last.pct)}).${change}`;
    } else {
      pattern = "on-off";
      text = `${subject} did ${d} only in ${listJoin(sigYears)}; not in ${first.period} or ${last.period}, so there's no steady pattern.`;
    }
  }

  const BADGES = {
    widening: ["Widening", "positive"], narrowing: ["Narrowing", "caution"], steady: ["Steady", "positive"],
    emerging: ["Emerging", "positive"], fading: ["Fading", "caution"], "on-off": ["On and off", "caution"],
    mixed: ["Mixed direction", "caution"],
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
        text: `${withEffect.length} of ${described.length} factors show a clear effect in at least one year after the peak; ${stillClear.length ? `${listJoin(stillClear.map((d) => d.label.toLowerCase()))} ${stillClear.length === 1 ? "is" : "are"} still clear in ${lastYear}` : `none is still clear in ${lastYear}`}.`,
      }
    : { tone: "neutral", text: "No factor shows a clear effect in any year after the peak." };

  const findings = [];
  const boom = described.find((d) => d.trait === "boom");
  if (boom) {
    findings.push(boom.pattern === "none"
      ? `Boom size never made a clear difference, in any year: the biggest risers neither fell back nor pulled ahead over time.`
      : `Boom size: ${boom.text}`);
  }
  for (const d of withEffect.filter((x) => x.trait !== "boom")) findings.push(`${d.label}: ${d.text}`);
  if (!findings.length) findings.push("Every year's estimate for every factor is within its margin of error.");

  const sections = [
    { heading: "Key findings", items: findings },
    howToRead(ctx, { byYear: true }),
    { heading: "Factor by factor", items: described.map(({ label, text, badge, detail }) => ({ label, text, badge, detail })) },
    cautions(data, rows.filter((r) => r.kind !== "trait" || r.period !== "all"), ctx, { byYear: true }),
    sampleSection(data, ctx),
  ];

  return {
    title: "By year: how the gaps evolved after the peak",
    subtitle: "Did the 2021–22 rent boom end differently across DFW ZIPs?",
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
 * otherSpecData: the response for the other specification (pooled only), if loaded,
 *                used to explain what changes when Census factors are added.
 */
export function interpretDivergence(data, { focus = "pooled", otherSpecData = null } = {}) {
  if (!data?.coefficients?.length) {
    return {
      title: "No results to interpret",
      verdict: { tone: "neutral", text: "The model returned no coefficients." },
      sections: [],
    };
  }
  if (focus === "byYear") return interpretByYear(data);
  return interpretPooled(data, { eventStudy: Boolean(data.event_study), otherSpecData });
}

/** Plain-text version of a report, for copying into notes or a paper. */
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
