from sklearn.ensemble import BaggingRegressor
from sklearn.tree import DecisionTreeRegressor
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

def _build_bagging_features(df, X_cols, id_col, time_col, entity_categories=None):
    """
    Bagging gets entity ID as one-hot features instead of having the
    target/regressors demeaned by entity. Same reasoning as the RF and
    Boosting panel endpoints: a tree-based ensemble can split directly
    on entity identity to learn entity-specific baselines, so
    demeaning only discards level information for no benefit -- it
    doesn't fix a bias problem the way it does for a linear FE model.

    entity_categories, when provided (fold fitting), fixes the set of
    one-hot columns to those seen during training -- rows for
    entities outside that set get all-zero entity dummies.
    """
    X = df[X_cols].copy()

    entity_dummies = pd.get_dummies(df[id_col], prefix="entity")
    if entity_categories is not None:
        entity_dummies = entity_dummies.reindex(columns=entity_categories, fill_value=0)

    X = pd.concat([X, entity_dummies], axis=1)

    if time_col:
        time_rank = pd.factorize(df[time_col], sort=True)[0]
        X["time_index"] = time_rank

    return X, list(entity_dummies.columns)


def _make_bagging_model(bagging_params, tree_params):
    base_estimator = DecisionTreeRegressor(**tree_params)
    return BaggingRegressor(estimator=base_estimator, **bagging_params)


# ─────────────────────────────────────────
# CROSS-VALIDATION
# ─────────────────────────────────────────

def _fit_predict_bagging_fold(train_df, test_df, dependent_col, X_cols, id_col, time_col,
                               bagging_params, tree_params):
    if train_df.empty or test_df.empty:
        return None

    X_train, entity_cols = _build_bagging_features(train_df, X_cols, id_col, time_col)
    X_test, _ = _build_bagging_features(
        test_df, X_cols, id_col, time_col, entity_categories=entity_cols
    )
    X_test = X_test.reindex(columns=X_train.columns, fill_value=0)

    y_train = train_df[dependent_col]
    y_test = test_df[dependent_col]

    model = _make_bagging_model(bagging_params, tree_params)
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


def run_bagging_cross_validation(df, dependent_col, X_cols, id_col, time_col,
                                  bagging_params, tree_params, cv_folds=3):
    """
    Time-based walk-forward CV when a usable date_column exists;
    entity-based GroupKFold otherwise. As with RF/Boosting, both are
    legitimate CV strategies here, not one preferred and one a
    fallback -- Bagging can make a reasonable prediction for an
    unseen entity via level features, unlike a linear FE-style model.
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
            result = _fit_predict_bagging_fold(
                train_df, test_df, dependent_col, X_cols, id_col, time_col,
                bagging_params, tree_params
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
                result = _fit_predict_bagging_fold(
                    train_df, test_df, dependent_col, X_cols, id_col, time_col,
                    bagging_params, tree_params
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

async def run_bagging_panel(request):
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

        # ── Bagging hyperparameters ──
        # n_estimators default raised from 10 -> 200: with only 10
        # bootstrap trees the ensemble average barely reduces variance
        # over a single tree, which defeats the point of bagging.
        n_estimators        = int(payload.get("n_estimators", 200))
        max_samples          = payload.get("max_samples", 0.8)
        max_features         = payload.get("max_features", 0.8)
        bootstrap            = bool(payload.get("bootstrap", True))
        bootstrap_features    = bool(payload.get("bootstrap_features", False))
        oob_score            = bool(payload.get("oob_score", True))
        random_state          = int(payload.get("random_state", 42))

        # Base estimator (Decision Tree) hyperparameters -- regularized
        # from the original's max_depth=None / min_samples_leaf=1,
        # which let every tree grow until each leaf was a single point.
        max_depth            = payload.get("max_depth", 6)
        min_samples_split     = int(payload.get("min_samples_split", 10))
        min_samples_leaf      = int(payload.get("min_samples_leaf", 5))

        if max_depth is not None:
            max_depth = int(max_depth)

        try:
            max_samples = float(max_samples)
            if max_samples.is_integer() and max_samples > 1:
                max_samples = int(max_samples)
        except (ValueError, TypeError):
            max_samples = 0.8

        try:
            max_features = float(max_features)
            if max_features.is_integer() and max_features > 1:
                max_features = int(max_features)
        except (ValueError, TypeError):
            max_features = 0.8

        if not bootstrap:
            oob_score = False

        # ── Validation ──
        if not raw_data:
            raise ValueError("No data provided")
        if not dependent_col:
            raise ValueError("Dependent variable is required")
        if not independent_cols:
            raise ValueError("Independent variables are required")
        if not id_col:
            raise ValueError("Entity ID column is required for panel Bagging")
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
            raise ValueError("Dataset too small for panel Bagging")

        n_entities = df[id_col].nunique()
        if n_entities < 2:
            raise ValueError(
                f"Panel Bagging requires at least 2 entities. "
                f"Found only 1 unique value in '{id_col}'. "
                f"Make sure id_column is the entity identifier, not a row ID."
            )

        entity_counts = df.groupby(id_col).size()
        if (entity_counts < 2).all():
            raise ValueError(
                "Each entity has only one observation. "
                "Panel Bagging needs multiple time periods per entity."
            )

        n_obs  = len(df)
        X_cols = list(X_raw.columns)

        bagging_params = {
            "n_estimators": n_estimators,
            "max_samples": max_samples,
            "max_features": max_features,
            "bootstrap": bootstrap,
            "bootstrap_features": bootstrap_features,
            "oob_score": oob_score,
            "random_state": random_state,
            "n_jobs": -1,
        }
        tree_params = {
            "max_depth": max_depth,
            "min_samples_split": min_samples_split,
            "min_samples_leaf": min_samples_leaf,
            "random_state": random_state,
        }

        # ── Cross-validation. No per-fold hyperparameter search --
        # fixed params reused across folds. oob_score is disabled
        # inside CV folds (irrelevant for out-of-sample fold scoring
        # and adds overhead). ──
        cv_bagging_params = {**bagging_params, "oob_score": False}
        cross_validation = run_bagging_cross_validation(
            df, dependent_col, X_cols, id_col, time_col,
            cv_bagging_params, tree_params, cv_folds=cv_folds
        )

        # ── Full-sample fit (level data + entity/time features, NOT demeaned) ──
        X_full, entity_cols = _build_bagging_features(df, X_cols, id_col, time_col)
        y_full = df[dependent_col]

        model = _make_bagging_model(bagging_params, tree_params)
        model.fit(X_full, y_full)
        fitted = model.predict(X_full)

        in_sample_r2 = safe_round(r2_score(y_full, fitted))
        mse          = safe_round(mean_squared_error(y_full, fitted))
        mae          = safe_round(mean_absolute_error(y_full, fitted))
        oob_r2       = safe_round(model.oob_score_) if oob_score else None

        # ── Per-estimator prediction spread (stability diagnostic) ──
        # When bootstrap_features=True, each base tree was trained on
        # only a subset of columns (model.estimators_features_) --
        # predicting with the full feature set on every tree would be
        # wrong (or error) in that case, so each estimator gets just
        # the columns it was actually fit on.
        try:
            X_full_values = X_full.values
            individual_preds = np.array([
                est.predict(X_full_values[:, feat_idx])
                for est, feat_idx in zip(model.estimators_, model.estimators_features_)
            ])
            pred_std  = safe_round(float(individual_preds.std(axis=0).mean()))
            pred_bias = safe_round(float((individual_preds.mean(axis=0) - y_full.values).mean()))
        except Exception:
            pred_std  = None
            pred_bias = None

        # ── Feature importances (averaged across base estimators) ──
        all_feature_names = list(X_full.columns)
        try:
            tree_importances = np.array([est.feature_importances_ for est in model.estimators_])
            mean_importances = tree_importances.mean(axis=0)
            std_importances  = tree_importances.std(axis=0)

            importance_dict = {
                str(name): float(imp) for name, imp in zip(all_feature_names, mean_importances)
            }
            importance_std_dict = {
                str(name): float(std) for name, std in zip(all_feature_names, std_importances)
            }
        except Exception:
            importance_dict = {k: None for k in all_feature_names}
            importance_std_dict = {k: None for k in all_feature_names}

        # Collapse per-entity one-hot dummies into a single "entity_id"
        # importance figure.
        entity_importance_total = sum(importance_dict.get(c, 0) or 0 for c in entity_cols)
        entity_std_mean = (
            float(np.mean([importance_std_dict[c] for c in entity_cols])) if entity_cols else 0.0
        )
        base_feature_importances = {
            k: safe_round(v, 6) for k, v in importance_dict.items() if k not in entity_cols
        }
        base_feature_importances["entity_id"] = safe_round(entity_importance_total, 6)
        importance_std = {
            k: safe_round(v, 6) for k, v in importance_std_dict.items() if k not in entity_cols
        }
        importance_std["entity_id"] = safe_round(entity_std_mean, 6)

        ranked_importances = sorted(
            base_feature_importances.items(), key=lambda x: (x[1] or 0), reverse=True
        )
        ranked_importances = [{"variable": k, "importance": v} for k, v in ranked_importances]

        # ── Bootstrap sample sizes actually used ──
        try:
            bootstrap_sample_sizes = list({len(s) for s in model.estimators_samples_})
        except Exception:
            bootstrap_sample_sizes = []

        # ── Raw entity means of the dependent variable ──
        # Descriptive statistic (observed group means), NOT a
        # model-estimated fixed effect.
        entity_mean_dependent = {
            str(ent): safe_round(df.loc[df[id_col] == ent, dependent_col].mean())
            for ent in df[id_col].unique()
        }

        return JSONResponse(content=sanitize({
            "success":        True,
            "model":          "BAGGING PANEL",
            "n_entities":     n_entities,
            "n_observations": n_obs,
            "time_periods":   df[time_col].nunique() if time_col else None,
            "in_sample_r2":   in_sample_r2,
            "oob_r2":         oob_r2,
            "mse":            mse,
            "mae":            mae,
            "cross_validation": cross_validation,
            "bagging": {
                "n_estimators":           n_estimators,
                "max_samples":            max_samples,
                "max_features":           max_features,
                "bootstrap":              bootstrap,
                "bootstrap_features":     bootstrap_features,
                "oob_score":              oob_score,
                "base_estimator":         "DecisionTreeRegressor",
                "max_depth":              max_depth,
                "min_samples_split":      min_samples_split,
                "min_samples_leaf":       min_samples_leaf,
                "n_base_features":        len(X_cols),
                "n_entity_dummies":       len(entity_cols),
                "uses_time_index":        time_col is not None,
                "bootstrap_sample_sizes": bootstrap_sample_sizes,
            },
            "ensemble_diagnostics": {
                "prediction_std":  pred_std,
                "prediction_bias": pred_bias,
            },
            "feature_importances":        base_feature_importances,
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
                "error":   "Panel Bagging model execution failed",
                "details": str(e),
            },
            status_code=500,
        )