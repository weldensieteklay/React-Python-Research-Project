from sklearn.ensemble import RandomForestRegressor
from sklearn.metrics import r2_score, mean_squared_error, mean_absolute_error
from sklearn.model_selection import TimeSeriesSplit, GroupKFold
from fastapi.responses import JSONResponse
import pandas as pd
import numpy as np
import math

from controller.crossSectional.helpers import prepare_dataset


def sanitize(obj):
    if isinstance(obj, dict):
        return {k: sanitize(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [sanitize(v) for v in obj]
    if isinstance(obj, float):
        if math.isnan(obj) or math.isinf(obj):
            return None
        return obj
    if isinstance(obj, (np.floating, np.float32, np.float64)):
        f = float(obj)
        return None if (math.isnan(f) or math.isinf(f)) else round(f, 6)
    if isinstance(obj, (np.integer, np.int32, np.int64)):
        return int(obj)
    if isinstance(obj, np.bool_):
        return bool(obj)
    if isinstance(obj, np.ndarray):
        return sanitize(obj.tolist())
    return obj


def safe_round(v, digits=4):
    try:
        f = float(v)
        return None if (math.isnan(f) or math.isinf(f)) else round(f, digits)
    except Exception:
        return None


# ─────────────────────────────────────────
# FEATURE BUILDING
# ─────────────────────────────────────────

def _build_rf_features(df, X_cols, id_col, time_col, entity_categories=None):
    """
    Random Forest gets entity ID as one-hot features instead of having
    the target/regressors demeaned by entity. A tree ensemble can
    split directly on entity identity to learn entity-specific
    baselines, so demeaning only destroys level information it could
    otherwise use -- unlike a linear model, RF has no bias problem
    that demeaning is needed to fix.

    entity_categories, when provided (fold fitting), fixes the set of
    one-hot columns to those seen during training -- rows for
    entities outside that set simply get all-zero entity dummies,
    which is a reasonable, low-bias way for a tree model to handle an
    unseen entity (falls back to whatever the level features suggest).
    """
    X = df[X_cols].copy()

    entity_dummies = pd.get_dummies(df[id_col], prefix="entity")
    if entity_categories is not None:
        entity_dummies = entity_dummies.reindex(columns=entity_categories, fill_value=0)

    X = pd.concat([X, entity_dummies], axis=1)

    if time_col:
        # Ordinal time index (0, 1, 2, ...) rather than a raw
        # timestamp, so the model gets a usable numeric trend feature.
        time_rank = pd.factorize(df[time_col], sort=True)[0]
        X["time_index"] = time_rank

    return X, list(entity_dummies.columns)


# ─────────────────────────────────────────
# CROSS-VALIDATION
# ─────────────────────────────────────────

def _fit_predict_rf_fold(train_df, test_df, dependent_col, X_cols, id_col, time_col, rf_params):
    if train_df.empty or test_df.empty:
        return None

    X_train, entity_cols = _build_rf_features(train_df, X_cols, id_col, time_col)
    X_test, _ = _build_rf_features(test_df, X_cols, id_col, time_col, entity_categories=entity_cols)
    # keep test columns aligned with train (time_index always present if time_col set)
    X_test = X_test.reindex(columns=X_train.columns, fill_value=0)

    y_train = train_df[dependent_col]
    y_test = test_df[dependent_col]

    model = RandomForestRegressor(**rf_params)
    model.fit(X_train, y_train)
    y_pred = model.predict(X_test)

    mse = float(mean_squared_error(y_test, y_pred))
    return {
        "rmse": safe_round(np.sqrt(mse)),
        "mae": safe_round(mean_absolute_error(y_test, y_pred)),
        "r2": safe_round(r2_score(y_test, y_pred)),
        "n_test_rows": int(len(y_test)),
    }


def _aggregate_cv_metrics(fold_metrics):
    if not fold_metrics:
        return None
    agg = {}
    for key in ("rmse", "mae", "r2"):
        vals = [m[key] for m in fold_metrics if m.get(key) is not None]
        if vals:
            agg[key] = {
                "mean": safe_round(np.mean(vals)),
                "std": safe_round(np.std(vals)),
            }
    return agg


def run_rf_cross_validation(df, dependent_col, X_cols, id_col, time_col, rf_params, cv_folds=3):
    """
    Time-based walk-forward CV when a usable date_column exists (train
    on earlier periods, predict later ones); entity-based GroupKFold
    otherwise. Unlike the linear panel models, RF can genuinely predict
    for entities unseen during training (via level features + whatever
    the trees generalize from similar entities), so neither method is
    a weaker fallback here -- both are legitimate, time-based is just
    preferred when time ordering is meaningful for the data.
    """
    fold_metrics = []
    method = None

    if time_col and df[time_col].nunique() >= cv_folds + 1:
        method = "time_based_walk_forward"
        unique_times = np.array(sorted(df[time_col].unique()))
        splitter = TimeSeriesSplit(n_splits=cv_folds)
        for train_t_idx, test_t_idx in splitter.split(unique_times):
            train_times = set(unique_times[train_t_idx])
            test_times = set(unique_times[test_t_idx])
            train_df = df[df[time_col].isin(train_times)]
            test_df = df[df[time_col].isin(test_times)]
            result = _fit_predict_rf_fold(
                train_df, test_df, dependent_col, X_cols, id_col, time_col, rf_params
            )
            if result:
                fold_metrics.append(result)
    else:
        n_entities = df[id_col].nunique()
        n_splits = min(cv_folds, n_entities) if n_entities >= 2 else 0
        if n_splits >= 2:
            method = "entity_based_group_kfold"
            gkf = GroupKFold(n_splits=n_splits)
            for train_idx, test_idx in gkf.split(df, groups=df[id_col]):
                train_df = df.iloc[train_idx]
                test_df = df.iloc[test_idx]
                result = _fit_predict_rf_fold(
                    train_df, test_df, dependent_col, X_cols, id_col, time_col, rf_params
                )
                if result:
                    fold_metrics.append(result)
        else:
            method = "skipped_insufficient_entities"

    return {
        "method": method,
        "folds_requested": cv_folds,
        "folds_used": len(fold_metrics),
        **(_aggregate_cv_metrics(fold_metrics) or {}),
    }


# ─────────────────────────────────────────
# MAIN HANDLER
# ─────────────────────────────────────────

async def run_random_forest_panel(request):
    try:
        payload = await request.json()

        raw_data         = payload.get("data", [])
        categorical_cols = payload.get("categorical_variable", [])
        dependent_col    = payload.get("dependent_variable")
        independent_cols = payload.get("independent_variable", [])
        id_col           = payload.get("id_column")
        time_col         = payload.get("date_column", None)
        remove_outliers  = payload.get("outliers", False)
        cv_folds         = int(payload.get("cv_folds", 3))

        # ── Random Forest hyperparameters ──
        n_estimators      = int(payload.get("n_estimators", 200))
        max_depth         = payload.get("max_depth", 8)
        min_samples_split = int(payload.get("min_samples_split", 10))
        min_samples_leaf  = int(payload.get("min_samples_leaf", 5))
        max_features       = payload.get("max_features", "sqrt")
        random_state      = int(payload.get("random_state", 42))

        if max_depth is not None:
            max_depth = int(max_depth)

        # ── Validation ──
        if not raw_data:
            raise ValueError("No data provided")
        if not dependent_col:
            raise ValueError("Dependent variable is required")
        if not independent_cols:
            raise ValueError("Independent variables are required")
        if not id_col:
            raise ValueError("Entity ID column is required for panel Random Forest")
        if cv_folds < 2:
            raise ValueError("cv_folds must be at least 2")

        if isinstance(remove_outliers, str):
            remove_outliers = remove_outliers.strip().lower() in ("yes", "true", "1")

        independent_cols = [c for c in independent_cols if c != id_col]
        if time_col:
            independent_cols = [c for c in independent_cols if c != time_col]
        if not independent_cols:
            raise ValueError(
                f"No independent variables remain after excluding id_column ('{id_col}') "
                f"and date_column ('{time_col}'). "
                f"If you are using 'Year' as a regressor, set date_column to 'Date' not 'Year'."
            )

        # ── Prepare dataset ──
        prepared = prepare_dataset(
            raw_data=raw_data,
            dependent_col=dependent_col,
            independent_cols=independent_cols,
            categorical_cols=categorical_cols,
            id_col=id_col,
            remove_outliers=remove_outliers,
        )

        X_raw = prepared["X"].copy().apply(pd.to_numeric, errors="coerce")
        y_raw = pd.to_numeric(prepared["y"].copy(), errors="coerce")

        # ── Rebuild panel df aligned by surviving index ──
        df = X_raw.copy()
        df[dependent_col] = y_raw.values

        raw_df         = pd.DataFrame(raw_data)
        raw_df_aligned = raw_df.loc[df.index] if len(raw_df) != len(df) else raw_df

        if id_col not in raw_df_aligned.columns:
            raise ValueError(f"id_column '{id_col}' not found in input data")

        df[id_col] = raw_df_aligned[id_col].values
        if time_col and time_col in raw_df_aligned.columns:
            df[time_col] = raw_df_aligned[time_col].values
        else:
            time_col = None

        df = df.dropna()

        if len(df) < 5:
            raise ValueError("Dataset too small for panel Random Forest")

        n_entities = df[id_col].nunique()
        if n_entities < 2:
            raise ValueError(
                f"Panel Random Forest requires at least 2 entities. "
                f"Found only 1 unique value in '{id_col}'. "
                f"Make sure id_column is the entity identifier, not a row ID."
            )

        entity_counts = df.groupby(id_col).size()
        if (entity_counts < 2).all():
            raise ValueError(
                "Each entity has only one observation. "
                "Panel Random Forest needs multiple time periods per entity."
            )

        n_obs  = len(df)
        X_cols = list(X_raw.columns)

        rf_params = {
            "n_estimators": n_estimators,
            "max_depth": max_depth,
            "min_samples_split": min_samples_split,
            "min_samples_leaf": min_samples_leaf,
            "max_features": max_features,
            "random_state": random_state,
            "n_jobs": -1,
        }

        # ── Cross-validation. No per-fold hyperparameter search --
        # fixed rf_params reused across folds, keeping total cost to
        # cv_folds + 1 fits rather than multiplying it. ──
        cross_validation = run_rf_cross_validation(
            df, dependent_col, X_cols, id_col, time_col, rf_params, cv_folds=cv_folds
        )

        # ── Full-sample fit (level data + entity/time features, NOT demeaned) ──
        X_full, entity_cols = _build_rf_features(df, X_cols, id_col, time_col)
        y_full = df[dependent_col]

        model = RandomForestRegressor(oob_score=True, **rf_params)
        model.fit(X_full, y_full)
        fitted = model.predict(X_full)

        # In-sample fit stats (the model saw all this data -- CV above
        # is the honest out-of-sample estimate)
        in_sample_r2  = safe_round(r2_score(y_full, fitted))
        mse           = safe_round(mean_squared_error(y_full, fitted))
        mae           = safe_round(mean_absolute_error(y_full, fitted))
        oob_r2        = safe_round(model.oob_score_) if hasattr(model, "oob_score_") else None

        # ── Feature importances ──
        all_feature_names = list(X_full.columns)
        importances = model.feature_importances_
        importance_dict = {
            str(name): safe_round(imp, 6)
            for name, imp in zip(all_feature_names, importances)
        }

        # Collapse the per-entity one-hot dummies into a single
        # "entity_id" importance figure -- individual dummy columns
        # aren't meaningful on their own, but their combined
        # contribution tells you how much entity identity matters.
        entity_importance_total = safe_round(
            sum(importance_dict.get(c, 0) or 0 for c in entity_cols), 6
        )
        base_feature_importances = {
            k: v for k, v in importance_dict.items() if k not in entity_cols
        }
        if "entity_id" not in base_feature_importances:
            base_feature_importances["entity_id"] = entity_importance_total

        ranked_importances = sorted(
            base_feature_importances.items(), key=lambda x: (x[1] or 0), reverse=True
        )
        ranked_importances = [{"variable": k, "importance": v} for k, v in ranked_importances]

        # std of per-tree importances, same collapsing applied
        tree_importances = np.array([tree.feature_importances_ for tree in model.estimators_])
        importance_std_raw = {
            str(name): float(std)
            for name, std in zip(all_feature_names, tree_importances.std(axis=0))
        }
        importance_std = {k: safe_round(v, 6) for k, v in importance_std_raw.items() if k not in entity_cols}
        importance_std["entity_id"] = safe_round(
            float(np.mean([importance_std_raw[c] for c in entity_cols])) if entity_cols else 0.0, 6
        )

        # ── Raw entity means of the dependent variable ──
        # This is a descriptive statistic (observed group means), NOT
        # a model-estimated fixed effect -- Random Forest doesn't
        # produce linear coefficients the way FE/RE do, so unlike
        # those endpoints this number isn't derived from the fitted
        # model at all.
        entity_mean_dependent = {
            str(ent): safe_round(df.loc[df[id_col] == ent, dependent_col].mean())
            for ent in df[id_col].unique()
        }

        return JSONResponse(content=sanitize({
            "success":        True,
            "model":          "RANDOM FOREST PANEL",
            "n_entities":     n_entities,
            "n_observations": n_obs,
            "time_periods":   df[time_col].nunique() if time_col else None,
            "in_sample_r2":   in_sample_r2,
            "oob_r2":         oob_r2,
            "mse":            mse,
            "mae":            mae,
            "cross_validation": cross_validation,
            "random_forest": {
                "n_estimators":       n_estimators,
                "max_depth":          max_depth,
                "min_samples_split":  min_samples_split,
                "min_samples_leaf":   min_samples_leaf,
                "max_features":       max_features,
                "n_base_features":    len(X_cols),
                "n_entity_dummies":   len(entity_cols),
                "uses_time_index":    time_col is not None,
            },
            "feature_importance":        base_feature_importances,
            "feature_importances_std":    importance_std,
            "feature_importances_ranked": ranked_importances,
            "coefficients":            {k: None for k in X_cols},
            "standard_errors":         {k: None for k in X_cols},
            "p_values":                {k: None for k in X_cols},
            "cluster_robust_se":       {},
            "cluster_robust_p_values": {},
            "entity_mean_dependent_variable": entity_mean_dependent,
        }))

    except Exception as e:
        return JSONResponse(
            content={
                "success": False,
                "error":   "Panel Random Forest model execution failed",
                "details": str(e),
            },
            status_code=500,
        )