import { factorLabel } from "../pages/RentalProperty/utils";

// ===========================================================================
// Plain-language explanation of one panel model run, for AnalysisModal.
//
//   interpretModel({ method, result, config, best })
//
// method: "fixed" | "random" | "lasso" | "ridge" | "forest" | "boosting" | "bagging"
// result: the backend response for that run
// config: the run's settings (idColumn, dependentVar, categoricalVar, ...), from PanelData
// best:   the best run so far from the store ({ method, mse, context }), or null
// context: the current run's problem signature, to tell whether `best` is comparable
//
// Everything is read from the response, so it adapts to the method and the data:
// linear models are explained by their effects, tree models by what they relied on.
// Fields a method doesn't return are simply skipped.
// ===========================================================================

const METHODS = {
  fixed: {
    name: "Fixed Effects",
    about: (w) => `Compares each ${w.entity} only with itself over time, so permanent differences between ${w.entities} (location, size, quality) are set aside. It answers: when a factor goes up, what happens to the same ${w.entity}'s ${w.target}?`,
  },
  random: {
    name: "Random Effects",
    about: (w) => `Like Fixed Effects, but it also learns from differences between ${w.entities}. That lets it measure things that never change for a ${w.entity} (such as its county), assuming those differences aren't tied to the other factors.`,
  },
  lasso: {
    name: "LASSO",
    about: () => "A regression that shrinks the weight of weak factors, setting some exactly to zero. A factor at zero didn't help the predictions, so the model left it out.",
  },
  ridge: {
    name: "Ridge",
    about: () => "A regression that pulls every weight a little toward zero, which keeps it steady when factors move together. It keeps all the factors.",
  },
  forest: {
    name: "Random Forest",
    about: () => "Averages many decision trees, each built on a random part of the data. It can pick up patterns that aren't straight lines. It shows which factors it relied on, not whether they push the result up or down.",
  },
  boosting: {
    name: "Gradient Boosting",
    about: () => "Builds small decision trees one after another, each correcting the mistakes of the ones before. It can pick up patterns that aren't straight lines. It shows which factors it relied on, not whether they push the result up or down.",
  },
  bagging: {
    name: "Bagging",
    about: () => "Averages many decision trees, each trained on a reshuffled copy of the data, which makes the predictions steadier. It shows which factors it relied on, not whether they push the result up or down.",
  },
};

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const isFiniteNum = (v) => typeof v === "number" && Number.isFinite(v);
const median = (xs) => {
  const v = xs.filter(isFiniteNum).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};
const listJoin = (xs) => (xs.length <= 2 ? xs.join(" and ") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
const pctText = (v, d = 1) => `${Math.abs(v).toFixed(Math.abs(v) < 0.1 ? 2 : d)}%`;
const lowerFirst = (s) => (/^[A-Z]{2,}/.test(s) ? s : s.charAt(0).toLowerCase() + s.slice(1));

/** "2026-07" / "2026-07-01" -> "Jul 2026"; 2027 -> "2027" */
function periodName(p) {
  const s = String(p ?? "");
  const m = /^(\d{4})-(\d{2})/.exec(s);
  return m ? `${MONTHS[Number(m[2]) - 1]} ${m[1]}` : s;
}
const isMonthly = (p) => /^\d{4}-\d{2}/.test(String(p ?? ""));

function words(config, result) {
  const id = config?.idColumn ?? "";
  const dep = config?.dependentVar ?? "";
  const zip = /zip/i.test(id);
  const idBase = String(id).replace(/[_\s-]?id$/i, "") || id;   // store_id -> store
  const entity = zip ? "ZIP code" : lowerFirst(factorLabel(idBase || "entity"));
  const target = dep === "zori_rent" ? "rent" : lowerFirst(factorLabel(dep || "the result"));
  const money = /rent|price|value|cost|income|salary|wage|revenue|sales|\$/i.test(dep);
  const samplePeriod = result?.out_of_sample?.test_periods?.[0] ?? result?.forecast_info?.periods?.[0] ?? result?.forecast?.[0]?.period;
  const monthly = isMonthly(samplePeriod);
  const yearly = /^\d{4}$/.test(String(samplePeriod ?? ""));
  return {
    entity,
    entities: zip ? "ZIP codes" : /s$/.test(entity) ? entity : `${entity}s`,
    target,
    money,
    period: monthly ? "month" : yearly ? "year" : "period",
    periods: monthly ? "months" : yearly ? "years" : "periods",
  };
}

function makeFmt(money) {
  return (v) => {
    if (!isFiniteNum(v)) return "—";
    if (money) {
      const a = Math.abs(v);
      const body = a >= 1 ? Math.round(a).toLocaleString("en-US") : a.toFixed(2);
      return `${v < 0 ? "−" : ""}$${body}`;
    }
    const a = Math.abs(v);
    return a >= 1000 ? Math.round(v).toLocaleString("en-US") : a >= 10 ? v.toFixed(1) : a >= 1 ? v.toFixed(2) : v.toPrecision(2);
  };
}

/** Typical level of the target, to turn % into dollars and judge error size. */
function typicalLevel(result) {
  const means = result?.entity_mean_dependent_variable;
  if (means && typeof means === "object") {
    const m = median(Object.values(means).map(Number));
    if (m) return m;
  }
  const fc = Array.isArray(result?.forecast) ? result.forecast : [];
  return median(fc.filter((f) => f.horizon === 1).map((f) => Number(f.predicted)));
}

// ---------------------------------------------------------------------------
// Factor names: "County_Dallas County" -> "County: Dallas County" when County is categorical
// ---------------------------------------------------------------------------
function describeFactor(name, config, w) {
  if (name === "entity_id" || name === "_entity") {
    return { label: `Which ${w.entity} it is`, unit: null, dummy: false };
  }
  for (const cat of config?.categoricalVar ?? []) {
    if (name.startsWith(`${cat}_`)) {
      const level = name.slice(cat.length + 1);
      return { label: `${factorLabel(cat)}: ${level}`, unit: `being in ${level} (compared with the first ${lowerFirst(factorLabel(cat))} group)`, dummy: true };
    }
  }
  const label = factorLabel(name);
  let unit;
  if (name === "months_since_start" || name === "time_index") unit = "each additional month";
  else if (name === "month_of_year") unit = "each later month of the year";
  else if (/rate|inflation|growth|percent|pct|share|change/i.test(name)) unit = `a 1-point rise in ${label}`;
  else unit = `a 1-unit rise in ${label}`;
  return { label, unit, dummy: false };
}

// ---------------------------------------------------------------------------
// Evidence labels (same words as the Boom Divergence explanations)
// ---------------------------------------------------------------------------
function evidenceBadge(p) {
  if (!isFiniteNum(p)) return null;
  if (p < 0.01) return { label: "Very clear", tone: "positive", key: "strong" };
  if (p < 0.05) return { label: "Clear", tone: "positive", key: "moderate" };
  if (p < 0.1) return { label: "Possible", tone: "caution", key: "weak" };
  return { label: "No real effect", tone: "neutral", key: "none" };
}

function accuracyBadge(pct) {
  if (!isFiniteNum(pct)) return null;
  if (pct < 3) return { label: "Very accurate", tone: "positive" };
  if (pct < 7) return { label: "Accurate", tone: "positive" };
  if (pct < 15) return { label: "Rough", tone: "caution" };
  return { label: "Not reliable", tone: "negative" };
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------
function accuracySection(result, w, fmt, level) {
  const items = [];
  const oos = result?.out_of_sample ?? {};
  const basis = result?.mse_basis ?? oos.basis ?? "in_sample";
  const rmse = isFiniteNum(oos.rmse) ? oos.rmse : isFiniteNum(result?.mse) ? Math.sqrt(result.mse) : null;
  const mae = isFiniteNum(oos.mae) ? oos.mae : isFiniteNum(result?.mae) ? result.mae : null;
  const pct = level && rmse != null ? (rmse / level) * 100 : null;
  const badge = accuracyBadge(pct);
  const test = oos.test_periods ?? [];

  let where;
  if (basis === "holdout" && test.length) {
    where = `the ${test.length === 1 ? "most recent" : `${test.length} most recent`} ${test.length === 1 ? w.period : w.periods} it never saw (${test.length === 1 ? periodName(test[0]) : `${periodName(test[0])} to ${periodName(test[test.length - 1])}`})`;
  } else if (basis === "walk_forward_cv") {
    where = `later ${w.periods} it hadn't seen, tested several times`;
  } else if (basis === "entity_cv") {
    where = `${w.entities} it hadn't seen`;
  } else {
    where = "the same data it learned from";
  }

  if (rmse != null) {
    items.push({
      label: "Typical miss",
      badge,
      text: `On ${where}, predictions were off by about ${fmt(mae ?? rmse)} on average, and most misses were within ±${fmt(rmse)}${pct != null ? `, about ${pctText(pct)} of a typical ${w.target} of ${fmt(level)}` : ""}.`,
      detail: `${basis === "in_sample" ? "Error" : "Error on new data"}: MSE ${Number(result.mse).toPrecision(5)}${isFiniteNum(oos.r2) ? ` · R² ${oos.r2.toFixed(3)}` : ""}`,
    });
  }

  const cv = result?.cross_validation;
  const cvRmse = cv?.rmse?.mean;
  if (isFiniteNum(cvRmse) && cv.folds_used) {
    const harder = rmse != null && cvRmse > rmse * 1.5;
    items.push(`Tested again on ${cv.folds_used} earlier stretches of time, the typical miss was ±${fmt(cvRmse)}.${harder ? ` That's larger than on the most recent ${w.periods}, so accuracy depends on the period; plan for misses closer to ±${fmt(cvRmse)}.` : " That's in line with the main test, so the accuracy holds up across time."}`);
  }

  const inMse = result?.in_sample_mse;
  if (basis !== "in_sample" && isFiniteNum(inMse) && isFiniteNum(result?.mse) && inMse > 0) {
    const ratio = Math.sqrt(result.mse / inMse);
    if (ratio > 2) {
      items.push(`It does much better on data it learned from (±${fmt(Math.sqrt(inMse))}) than on new ${w.periods} (±${fmt(Math.sqrt(result.mse))}), so it may be memorizing the past. Expect real-world misses closer to the larger number.`);
    }
  }
  if (basis === "in_sample") {
    items.push("Accuracy was measured on the same data the model learned from, so real-world misses will be larger.");
  }

  if (isFiniteNum(result?.within_r2)) {
    items.push(`Most of the accuracy comes from knowing each ${w.entity}'s own level and trend. The factors you chose explain about ${Math.round(result.within_r2 * 100)}% of the ups and downs around that.`);
  }
  return { heading: "How accurate is it?", items, rmse, pct, badge };
}

function linearDrivers(method, result, config, w, fmt, level) {
  const coefs = result?.coefficients ?? {};
  const robust = result?.cluster_robust_p_values && !result.cluster_robust_p_values.error && Object.keys(result.cluster_robust_p_values).length
    ? result.cluster_robust_p_values : null;
  const pvals = robust ?? result?.p_values ?? {};
  const describe = String(result?.model_spec?.coefficients_describe ?? "");
  const logScale = /log/i.test(describe);
  const aroundTrend = /trend/i.test(describe);
  const isLasso = method === "lasso";

  const rows = Object.entries(coefs)
    .filter(([k, v]) => k !== "const" && k !== "Intercept" && isFiniteNum(v))
    .map(([k, b]) => {
      const f = describeFactor(k, config, w);
      const p = isFiniteNum(pvals?.[k]) ? pvals[k] : null;
      const pct = logScale ? (Math.exp(b) - 1) * 100 : null;
      const dollars = logScale && w.money && level ? (Math.abs(pct) / 100) * level : null;
      return { k, b, p, pct, dollars, ...f };
    });

  const hasP = rows.some((r) => r.p != null);
  const items = rows
    .sort((a, b) => (hasP ? (a.p ?? 1) - (b.p ?? 1) : 0) || Math.abs(b.pct ?? b.b) - Math.abs(a.pct ?? a.b))
    .map((r) => {
      const dir = r.b > 0 ? "higher" : "lower";
      const size = logScale
        ? `${pctText(r.pct)} ${dir}${r.dollars != null ? ` (about ${fmt(r.dollars)})` : ""}`
        : `${fmt(Math.abs(r.b))} ${dir}`;
      const trendNote = aroundTrend ? ` than that ${w.entity}'s own trend` : "";
      const badge = hasP ? evidenceBadge(r.p) : isLasso ? (Math.abs(r.b) < 1e-12 ? { label: "Left out", tone: "neutral" } : { label: "Used", tone: "positive" }) : null;

      let text;
      if (isLasso && Math.abs(r.b) < 1e-12) {
        text = "LASSO set this factor's weight to zero: it didn't help the predictions, so the model doesn't use it.";
      } else if (hasP && badge?.key === "none") {
        text = `No real effect: any link between ${r.label} and ${w.target} is small enough to be chance.`;
      } else {
        const cap = r.unit.charAt(0).toUpperCase() + r.unit.slice(1);
        text = `${r.dummy ? `${cap}: ` : `With ${r.unit}, `}${w.target} tends to be ${size}${trendNote}, with the other factors unchanged.${hasP && badge?.key === "weak" ? " This could still be chance." : ""}`;
      }
      const phrase = `${r.unit} goes with ${w.target} about ${size}${aroundTrend ? ` than each ${w.entity}'s own trend` : ""}`;
      return {
        label: r.label,
        badge,
        text,
        _phrase: phrase,
        detail: `Coefficient ${Number(r.b).toPrecision(3)}${r.p != null ? ` · p ${r.p < 0.001 ? "<0.001" : r.p.toFixed(3)}${robust ? " (robust)" : ""}` : ""}`,
        _row: r,
      };
    });

  const clear = items.filter((it) => ["strong", "moderate"].includes(it.badge?.key));
  const notes = [];
  if (aroundTrend) notes.push(`Each ${w.entity} has its own trend, so these effects are on top of that trend: they explain why ${w.target} ran above or below it.`);
  if (!hasP && !isLasso && items.length) notes.push(`This method doesn't report how certain each effect is, so read the sizes as rough guides.`);
  if (!logScale && rows.length > 1) notes.push("Factors are measured in different units, so compare each effect on its own rather than against each other.");

  return {
    heading: `What moves ${w.target}`,
    items: [...items.map(({ _row, _phrase, ...it }) => it), ...notes],
    headline: clear[0]
      ? `${clear.length > 1 ? `${clear.length === items.length ? `All ${clear.length}` : `${clear.length} of ${items.length}`} factors have a clear effect. The clearest: ` : "The clearest effect: "}${clear[0]._phrase}.`
      : hasP && items.length
        ? "None of the factors had a clear effect."
        : isLasso && rows.length
          ? `LASSO kept ${rows.filter((r) => Math.abs(r.b) >= 1e-12).length} of ${rows.length} factors.`
          : null,
    clearCount: clear.length,
    total: items.length,
  };
}

function treeDrivers(result, config, w) {
  let ranked = Array.isArray(result?.feature_importances_ranked) ? result.feature_importances_ranked : [];
  if (!ranked.length && result?.feature_importance && typeof result.feature_importance === "object") {
    ranked = Object.entries(result.feature_importance).map(([variable, importance]) => ({ variable, importance })).sort((a, b) => b.importance - a.importance);
  }
  // A categorical factor arrives as one column per group (County_Dallas County, ...): add them up
  const cats = config?.categoricalVar ?? [];
  const merged = {};
  for (const r of ranked) {
    const cat = cats.find((c) => String(r.variable).startsWith(`${c}_`));
    const key = cat ? `__cat__${cat}` : r.variable;
    merged[key] = (merged[key] ?? 0) + Math.abs(Number(r.importance) || 0);
  }
  ranked = Object.entries(merged).map(([variable, importance]) => ({ variable, importance })).sort((a, b) => b.importance - a.importance);
  const total = ranked.reduce((s, r) => s + Math.abs(Number(r.importance) || 0), 0);
  const items = ranked.map((r) => {
    const f = r.variable.startsWith("__cat__")
      ? { label: factorLabel(r.variable.slice(7)) }
      : describeFactor(r.variable, config, w);
    const share = total ? (Math.abs(r.importance) / total) * 100 : 0;
    const text = share < 0.5
      ? "The model barely used this factor."
      : r.variable === "entity_id"
        ? `About ${Math.round(share)}% of what the model relied on: knowing which ${w.entity} it is (each one's usual level).`
        : `The model relied on this for about ${Math.round(share)}% of its decisions.`;
    return {
      label: f.label,
      badge: share >= 25 ? { label: "Main driver", tone: "positive" } : share >= 5 ? { label: "Some use", tone: "neutral" } : { label: "Little use", tone: "neutral" },
      text,
      detail: `Importance ${Number(r.importance).toFixed(3)}`,
      share,
    };
  });
  const notes = [`This shows how much the model relied on each factor, not whether it pushes ${w.target} up or down.`];
  if (/trend/i.test(String(result?.model_spec?.importance_target ?? ""))) {
    notes.push(`Each ${w.entity}'s own trend is handled separately, so these factors explain the ups and downs around it.`);
  }
  const b = result?.boosting;
  if (b?.early_stopping_triggered && b.n_estimators_used) {
    notes.push(`It stopped after ${b.n_estimators_used} of ${b.n_estimators_requested} rounds because more rounds stopped improving accuracy.`);
  }
  const top = items.find((it) => it.label !== `Which ${w.entity} it is`) ?? items[0];
  return {
    heading: `What the model relied on`,
    items: [...items.map(({ share, ...it }) => it), ...notes],
    headline: top ? `It relied most on ${top.label} (about ${Math.round(top.share)}%).` : null,
  };
}

function forecastSection(result, w, fmt) {
  const items = [];
  const fc = Array.isArray(result?.forecast) ? result.forecast : [];
  const info = result?.forecast_info ?? {};
  if (result?.forecast_error) {
    items.push({ label: "Forecast failed", badge: { label: "Problem", tone: "negative" }, text: String(result.forecast_error) });
    return { heading: "The forecast", items };
  }
  if (!fc.length) return null;

  const byPeriod = {};
  for (const f of fc) (byPeriod[String(f.period)] ||= []).push(Number(f.predicted));
  const periods = Object.keys(byPeriod).sort();
  const first = periods[0];
  const last = periods[periods.length - 1];
  const n = info.n_entities_forecast ?? new Set(fc.map((f) => f.id)).size;
  const mFirst = median(byPeriod[first]);
  const mLast = median(byPeriod[last]);
  items.push(periods.length > 1
    ? `Forecast for ${n.toLocaleString("en-US")} ${n === 1 ? w.entity : w.entities}, ${periodName(first)} to ${periodName(last)}. The typical ${w.entity}'s ${w.target} goes from ${fmt(mFirst)} to ${fmt(mLast)}.`
    : `Forecast for ${n.toLocaleString("en-US")} ${n === 1 ? w.entity : w.entities} for ${periodName(first)}: typical ${w.target} ${fmt(mFirst)}.`);

  if (info.mode === "carry_forward") items.push(`The economic factors are held at their latest values for every future ${w.period}, so this shows where ${w.target} heads if conditions stay as they are today.`);
  if (info.mode === "future_data") items.push("The forecast uses the future values you supplied for the factors.");
  if (info.trend === "log") items.push(`Each ${w.entity} keeps growing at its own recent rate.`);
  else if (info.trend === "linear") items.push(`Each ${w.entity} keeps its own recent trend (the same amount per ${w.period}).`);
  else if (info.trend === "none") items.push(`No trend is used, so with the factors held steady every future ${w.period} gets about the same value.`);

  const skipped = info.skipped_entities?.length ?? 0;
  if (skipped) items.push(`${skipped} ${skipped === 1 ? w.entity : w.entities} couldn't be forecast (not enough history).`);
  for (const warn of info.warnings ?? []) {
    if (/held at their latest/i.test(warn) && info.mode === "carry_forward") continue;
    items.push(String(warn));
  }
  return { heading: "The forecast", items };
}

function cautionsSection(method, result, config, w) {
  const items = [];
  const dq = result?.data_quality;
  if (dq?.rows_dropped_missing > 0) {
    const cols = Object.entries(dq.missing_by_column ?? {}).sort((a, b) => b[1] - a[1]).map(([c]) => factorLabel(c));
    items.push(`${dq.rows_dropped_missing.toLocaleString("en-US")} row${dq.rows_dropped_missing === 1 ? " was" : "s were"} skipped because of missing values${cols.length ? ` (in ${listJoin(cols.slice(0, 3))})` : ""}.`);
  }
  if (dq?.periods_lost?.length) items.push(`The latest data (${listJoin(dq.periods_lost.map(periodName))}) couldn't be used because some factors were missing there.`);
  if (dq?.warning) items.push(String(dq.warning));

  const dropped = result?.dropped_time_invariant_variables;
  if (Array.isArray(dropped) && dropped.length) {
    const cats = new Set();
    const others = [];
    for (const d of dropped) {
      const cat = (config?.categoricalVar ?? []).find((c) => d.startsWith(`${c}_`));
      if (cat) cats.add(factorLabel(cat)); else others.push(factorLabel(d));
    }
    const names = [...cats, ...others];
    items.push(`${listJoin(names)} never change${names.length === 1 ? "s" : ""} within a ${w.entity}, so ${METHODS[method]?.name ?? "this method"} can't measure ${names.length === 1 ? "it" : "them"}. Try Random Effects or a tree method (Forest, Boosting) to see ${names.length === 1 ? "its" : "their"} role.`);
  }

  const vif = result?.diagnostics?.multicollinearity?.vif;
  if (vif && typeof vif === "object") {
    const severe = Object.entries(vif).filter(([, v]) => /severe/i.test(v?.conclusion ?? "")).map(([k]) => factorLabel(k));
    if (severe.length) items.push(`${listJoin(severe)} move${severe.length === 1 ? "s" : ""} closely with other factors, so ${severe.length === 1 ? "its" : "their"} separate effect${severe.length === 1 ? " is" : "s are"} hard to pin down. The overall prediction is still fine.`);
  }

  const test = result?.out_of_sample?.test_periods ?? [];
  if (result?.mse_basis === "holdout" && test.length && test.length <= 3) {
    items.push(`Accuracy is measured on only ${test.length} ${test.length === 1 ? w.period : w.periods}, so treat it as a rough guide.`);
  }
  if (result?.out_of_sample?.note) items.push(String(result.out_of_sample.note));
  return items.length ? { heading: "Keep in mind", items } : null;
}

function compareSection(method, result, best, context, w, fmt) {
  if (!best || !isFiniteNum(Number(best.mse)) || !isFiniteNum(result?.mse)) return null;
  if (best.context && context && best.context !== context) {
    return { heading: "Compared with your other runs", items: ["You changed the setup (data, factors, filters or forecast length), so earlier runs aren't compared with this one."] };
  }
  const mine = Math.sqrt(result.mse);
  const theirs = Math.sqrt(Number(best.mse));
  const bestName = METHODS[best.method]?.name ?? best.method;
  const isBest = best.method === method && Math.abs(theirs - mine) < 1e-9 * Math.max(1, mine);
  const text = isBest || mine <= theirs
    ? `This is the most accurate method you've tried so far on this setup. Its forecast is the one shown on the dashboard.`
    : `${bestName} is more accurate so far (±${fmt(theirs)} vs ±${fmt(mine)} for ${METHODS[method]?.name ?? method}). The dashboard shows the ${bestName} forecast.`;
  return { heading: "Compared with your other runs", items: [text], isBest: isBest || mine <= theirs, bestName };
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------
export function interpretModel({ method, result, config = {}, best = null, context = null }) {
  const info = METHODS[method] ?? { name: result?.model ?? method ?? "This model", about: () => null };
  if (!result || result.success === false) {
    return { title: "No results to explain", verdict: { tone: "neutral", text: "The model didn't return results." }, sections: [] };
  }
  const w = words(config, result);
  const fmt = makeFmt(w.money);
  const level = typicalLevel(result);

  const accuracy = accuracySection(result, w, fmt, level);
  const isTree = Array.isArray(result.feature_importances_ranked) && result.feature_importances_ranked.length > 0
    || ["forest", "boosting", "bagging"].includes(method);
  const drivers = isTree ? treeDrivers(result, config, w) : linearDrivers(method, result, config, w, fmt, level);
  const forecast = forecastSection(result, w, fmt);
  const cautions = cautionsSection(method, result, config, w);
  const compare = compareSection(method, result, best, context, w, fmt);

  // ---- takeaway
  const parts = [];
  if (accuracy.rmse != null) {
    parts.push(`${info.name} predicts ${w.target} to within about ±${fmt(accuracy.rmse)}${accuracy.pct != null ? ` (${pctText(accuracy.pct)})` : ""} on ${result.mse_basis === "in_sample" ? "the data it learned from" : `${w.periods} it never saw`}.`);
  }
  if (drivers.headline) parts.push(drivers.headline);
  if (compare?.isBest) parts.push("It's the most accurate method you've tried so far.");
  else if (compare?.bestName) parts.push(`${compare.bestName} is more accurate so far.`);
  const tone = accuracy.badge?.tone === "negative" ? "caution" : accuracy.badge?.tone === "caution" ? "mixed" : "positive";

  const about = info.about?.(w);
  const sections = [
    { heading: accuracy.heading, items: accuracy.items },
    { heading: drivers.heading, items: drivers.items },
    forecast,
    compare && { heading: compare.heading, items: compare.items },
    cautions,
    about && {
      heading: `About ${info.name}`,
      items: [about, `Based on ${(result.n_observations ?? 0).toLocaleString("en-US")} rows: ${result.n_entities ?? "—"} ${w.entities} over ${result.time_periods ?? "—"} ${w.periods}.`],
    },
  ].filter((s) => s && s.items?.length);

  return {
    title: `What the ${info.name} results say`,
    subtitle: `Predicting ${w.target} for each ${w.entity}`,
    verdict: { tone, text: parts.join(" ") || "Results are ready below." },
    sections,
  };
}
