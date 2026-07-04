from sklearn.ensemble import RandomForestRegressor
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

        # ── Random Forest hyperparameters ──
        n_estimators      = int(payload.get("n_estimators", 100))
        max_depth         = payload.get("max_depth", None)
        min_samples_split = int(payload.get("min_samples_split", 2))
        min_samples_leaf  = int(payload.get("min_samples_leaf", 1))
        max_features      = payload.get("max_features", "sqrt")
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

        # ── Within transformation (demean by entity) ──
        # Random Forest is a non-linear model and does not require demeaning
        # to be consistent. However, applying within-transformation removes
        # unobserved entity-level heterogeneity, mirroring fixed-effects logic
        # and making results comparable to Ridge/Lasso panel models.
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

        # ── Fit Random Forest ──
        model = RandomForestRegressor(
            n_estimators=n_estimators,
            max_depth=max_depth,
            min_samples_split=min_samples_split,
            min_samples_leaf=min_samples_leaf,
            max_features=max_features,
            random_state=random_state,
            n_jobs=-1,
        )
        model.fit(X_train, y_train)
        predictions = model.predict(X_test)

        # ── Metrics ──
        within_r2 = safe_round(r2_score(y_test, predictions))
        mse       = safe_round(mean_squared_error(y_test, predictions))
        mae       = safe_round(mean_absolute_error(y_test, predictions))

        # ── Out-of-bag R² (only available when oob_score=True; we expose via
        #    a second fit if the training set is large enough) ──
        oob_r2 = None
        if len(X_train) >= 10:
            try:
                oob_model = RandomForestRegressor(
                    n_estimators=n_estimators,
                    max_depth=max_depth,
                    min_samples_split=min_samples_split,
                    min_samples_leaf=min_samples_leaf,
                    max_features=max_features,
                    random_state=random_state,
                    oob_score=True,
                    n_jobs=-1,
                )
                oob_model.fit(X_train, y_train)
                oob_r2 = safe_round(oob_model.oob_score_)
            except Exception:
                oob_r2 = None

        # ── Feature importances (mean decrease in impurity) ──
        importances     = model.feature_importances_
        importance_dict = {
            str(name): safe_round(imp, 6)
            for name, imp in zip(coef_names, importances)
        }

        # Ranked feature importances (descending)
        ranked_importances = sorted(
            importance_dict.items(), key=lambda x: (x[1] or 0), reverse=True
        )
        ranked_importances = [{"variable": k, "importance": v} for k, v in ranked_importances]

        # ── Permutation-style importance approximation via std across trees ──
        # std of per-tree importances gives a sense of stability
        tree_importances = np.array([tree.feature_importances_ for tree in model.estimators_])
        importance_std   = {
            str(name): safe_round(std, 6)
            for name, std in zip(coef_names, tree_importances.std(axis=0))
        }

        # ── Entity fixed effects (entity-level mean of dependent variable) ──
        entity_fe = {
            str(ent): safe_round(df.loc[df[id_col] == ent, dependent_col].mean())
            for ent in df[id_col].unique()
        }

        return JSONResponse(content=sanitize({
            "success":        True,
            "model":          "RANDOM FOREST PANEL",
            "n_entities":     n_entities,
            "n_observations": n_obs,
            "time_periods":   df[time_col].nunique() if time_col else None,
            "within_r2":      within_r2,
            "oob_r2":         oob_r2,
            "mse":            mse,
            "mae":            mae,
            "random_forest": {
                "n_estimators":             n_estimators,
                "max_depth":                max_depth,
                "min_samples_split":        min_samples_split,
                "min_samples_leaf":         min_samples_leaf,
                "max_features":             max_features,
                "n_features":               len(coef_names),
                "dropped_time_invariant":   zero_var_cols if zero_var_cols else None,
            },
            # Feature importances replace coefficients for tree-based models.
            # Values sum to 1.0 and represent mean decrease in impurity (MDI).
            "feature_importances":          importance_dict,
            "feature_importances_std":      importance_std,
            "feature_importances_ranked":   ranked_importances,
            # Tree models have no analytic coefficients, SEs, or p-values.
            "coefficients":                 {k: None for k in coef_names},
            "standard_errors":              {k: None for k in coef_names},
            "p_values":                     {k: None for k in coef_names},
            "cluster_robust_se":            {},
            "cluster_robust_p_values":      {},
            "entity_fixed_effects":         entity_fe,
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