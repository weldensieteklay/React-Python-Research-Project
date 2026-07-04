from sklearn.ensemble import BaggingRegressor
from sklearn.tree import DecisionTreeRegressor
from sklearn.metrics import r2_score, mean_squared_error, mean_absolute_error
from fastapi.responses import JSONResponse
from sklearn.model_selection import train_test_split
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

        # ── Bagging hyperparameters ──
        n_estimators        = int(payload.get("n_estimators", 10))
        max_samples         = payload.get("max_samples", 1.0)
        max_features        = payload.get("max_features", 1.0)
        bootstrap           = bool(payload.get("bootstrap", True))
        bootstrap_features  = bool(payload.get("bootstrap_features", False))
        oob_score           = bool(payload.get("oob_score", True))
        random_state        = int(payload.get("random_state", 42))

        # Base estimator (Decision Tree) hyperparameters
        max_depth           = payload.get("max_depth", None)
        min_samples_split   = int(payload.get("min_samples_split", 2))
        min_samples_leaf    = int(payload.get("min_samples_leaf", 1))

        if max_depth is not None:
            max_depth = int(max_depth)

        # max_samples / max_features can be int (count) or float (fraction)
        try:
            max_samples = float(max_samples)
            if max_samples.is_integer() and max_samples > 1:
                max_samples = int(max_samples)
        except (ValueError, TypeError):
            max_samples = 1.0

        try:
            max_features = float(max_features)
            if max_features.is_integer() and max_features > 1:
                max_features = int(max_features)
        except (ValueError, TypeError):
            max_features = 1.0

        # OOB score requires bootstrap=True
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

        # ── Within transformation (demean by entity) ──
        # Removes unobserved entity-level fixed effects before fitting,
        # consistent with Ridge, Lasso, RF, and Boosting panel implementations.
        all_cols  = [dependent_col] + X_cols
        grp_means = df.groupby(id_col)[all_cols].transform("mean")
        y_within  = df[dependent_col] - grp_means[dependent_col]
        X_within  = df[X_cols]        - grp_means[X_cols]

        # Drop time-invariant columns (zero variance after demeaning)
        zero_var_cols = [c for c in X_within.columns if X_within[c].abs().max() < 1e-10]
        if zero_var_cols:
            X_within = X_within.drop(columns=zero_var_cols)

        if X_within.shape[1] == 0:
            raise ValueError(
                "All independent variables are time-invariant within entities. "
                f"Dropped: {zero_var_cols}"
            )

        coef_names = X_within.columns.tolist()

        # ── Train / test split ──
        X_train, X_test, y_train, y_test = train_test_split(
            X_within, y_within, test_size=0.2, random_state=random_state
        )

        # ── Base estimator: Decision Tree ──
        # Bagging wraps any base estimator; Decision Tree is the standard choice.
        # Unlike Random Forest (which also randomizes feature splits), plain
        # Bagging only randomizes the bootstrap sample — giving a purer view
        # of variance reduction through aggregation.
        base_estimator = DecisionTreeRegressor(
            max_depth=max_depth,
            min_samples_split=min_samples_split,
            min_samples_leaf=min_samples_leaf,
            random_state=random_state,
        )

        # ── Fit Bagging ──
        model = BaggingRegressor(
            estimator=base_estimator,
            n_estimators=n_estimators,
            max_samples=max_samples,
            max_features=max_features,
            bootstrap=bootstrap,
            bootstrap_features=bootstrap_features,
            oob_score=oob_score,
            random_state=random_state,
            n_jobs=-1,
        )
        model.fit(X_train, y_train)
        predictions = model.predict(X_test)

        # ── Metrics ──
        within_r2 = safe_round(r2_score(y_test, predictions))
        train_r2  = safe_round(r2_score(y_train, model.predict(X_train)))
        mse       = safe_round(mean_squared_error(y_test, predictions))
        mae       = safe_round(mean_absolute_error(y_test, predictions))

        # ── OOB R² (free internal validation when bootstrap=True) ──
        oob_r2 = safe_round(model.oob_score_) if oob_score else None

        # ── Per-estimator OOB predictions → std of predictions (stability) ──
        # Variance of individual tree predictions on the test set indicates
        # how much disagreement exists across bootstrap samples.
        try:
            individual_preds = np.array([est.predict(X_test) for est in model.estimators_])
            pred_std  = safe_round(float(individual_preds.std(axis=0).mean()))
            pred_bias = safe_round(float((individual_preds.mean(axis=0) - y_test.values).mean()))
        except Exception:
            pred_std  = None
            pred_bias = None

        # ── Feature importances ──
        # BaggingRegressor has no native .feature_importances_, so we
        # aggregate across individual DecisionTree estimators.
        try:
            tree_importances = np.array([
                est.feature_importances_ for est in model.estimators_
            ])
            mean_importances = tree_importances.mean(axis=0)
            std_importances  = tree_importances.std(axis=0)

            importance_dict = {
                str(name): safe_round(imp, 6)
                for name, imp in zip(coef_names, mean_importances)
            }
            importance_std_dict = {
                str(name): safe_round(std, 6)
                for name, std in zip(coef_names, std_importances)
            }
            ranked_importances = sorted(
                importance_dict.items(), key=lambda x: (x[1] or 0), reverse=True
            )
            ranked_importances = [{"variable": k, "importance": v} for k, v in ranked_importances]
        except Exception:
            importance_dict     = {k: None for k in coef_names}
            importance_std_dict = {k: None for k in coef_names}
            ranked_importances  = []

        # ── Bootstrap sample sizes actually used ──
        try:
            bootstrap_sample_sizes = list({len(s) for s in model.estimators_samples_})
        except Exception:
            bootstrap_sample_sizes = []

        # ── Entity fixed effects (entity-level mean of dependent variable) ──
        entity_fe = {
            str(ent): safe_round(df.loc[df[id_col] == ent, dependent_col].mean())
            for ent in df[id_col].unique()
        }

        return JSONResponse(content=sanitize({
            "success":        True,
            "model":          "BAGGIN PANEL",
            "n_entities":     n_entities,
            "n_observations": n_obs,
            "time_periods":   df[time_col].nunique() if time_col else None,
            "within_r2":      within_r2,
            "train_r2":       train_r2,
            "oob_r2":         oob_r2,
            "mse":            mse,
            "mae":            mae,
            "bagging": {
                "n_estimators":           n_estimators,
                "max_samples":            max_samples,
                "max_features":           max_features,
                "bootstrap":              bootstrap,
                "bootstrap_features":     bootstrap_features,
                "oob_score":              oob_score,
                # Base estimator settings
                "base_estimator":         "DecisionTreeRegressor",
                "max_depth":              max_depth,
                "min_samples_split":      min_samples_split,
                "min_samples_leaf":       min_samples_leaf,
                "n_features":             len(coef_names),
                "bootstrap_sample_sizes": bootstrap_sample_sizes,
                "dropped_time_invariant": zero_var_cols if zero_var_cols else None,
            },
            # Variance-bias diagnostics across bootstrap estimators
            "ensemble_diagnostics": {
                # Mean std of individual tree predictions on test set
                # (higher = more disagreement across bootstrap samples)
                "prediction_std":  pred_std,
                # Mean signed error of ensemble mean vs true values
                "prediction_bias": pred_bias,
            },
            # Averaged feature importances across all base estimators
            "feature_importances":        importance_dict,
            "feature_importances_std":    importance_std_dict,
            "feature_importances_ranked": ranked_importances,
            # Tree models have no analytic coefficients, SEs, or p-values
            "coefficients":               {k: None for k in coef_names},
            "standard_errors":            {k: None for k in coef_names},
            "p_values":                   {k: None for k in coef_names},
            "cluster_robust_se":          {},
            "cluster_robust_p_values":    {},
            "entity_fixed_effects":       entity_fe,
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