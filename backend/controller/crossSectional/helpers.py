from fastapi.responses import JSONResponse
from sklearn.model_selection import train_test_split
from sklearn.metrics import r2_score, mean_squared_error, mean_absolute_error
from sklearn.preprocessing import OneHotEncoder
import statsmodels.api as sm
import pandas as pd
import numpy as np
import math

def convert_numpy(obj):
    """Convert numpy types recursively to native Python types."""
    if isinstance(obj, dict):
        return {k: convert_numpy(v) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [convert_numpy(v) for v in obj]
    elif isinstance(obj, (np.integer, np.int64)):
        return int(obj)
    elif isinstance(obj, (np.floating, np.float64)):
        return float(obj)
    elif isinstance(obj, (np.bool_, bool)):
        return bool(obj)
    else:
        return obj


def prepare_dataset(
    raw_data,
    dependent_col,
    independent_cols,
    categorical_cols=None,
    id_col=None,
    remove_outliers=False,
):
    df = pd.DataFrame(raw_data)

    if id_col and id_col in df.columns:
        df = df.drop(columns=[id_col])

    # Only require non-missing values in columns actually used by the model
    # (dependent + raw independent columns, pre-encoding), instead of
    # dropping rows for missingness in unrelated columns the user uploaded
    # but never selected.
    relevant_cols = [c for c in [dependent_col, *independent_cols] if c in df.columns]
    df = df.dropna(subset=relevant_cols)

    encoders = {}
    dummy_column_map = {}

    if categorical_cols:
        valid_cat_cols = [col for col in categorical_cols if col in df.columns]

        if valid_cat_cols:
            ohe = OneHotEncoder(
                drop="first", sparse_output=False, handle_unknown="ignore"
            )
            ohe_array = ohe.fit_transform(df[valid_cat_cols].astype(str))

            ohe_col_names = [
                f"{col}_{cat}".replace(" ", "_")
                for col, cats in zip(valid_cat_cols, ohe.categories_)
                for cat in cats[1:]
            ]

            ohe_df = pd.DataFrame(ohe_array, columns=ohe_col_names, index=df.index)

            for col, cats in zip(valid_cat_cols, ohe.categories_):
                dummy_column_map[col] = [
                    f"{col}_{cat}".replace(" ", "_") for cat in cats[1:]
                ]

            df = pd.concat([df.drop(columns=valid_cat_cols), ohe_df], axis=1)

            encoders["ohe"] = ohe
            encoders["ohe_cols"] = valid_cat_cols
            encoders["ohe_col_names"] = ohe_col_names

    expanded_independent_cols = []
    for col in independent_cols:
        if col in dummy_column_map:
            expanded_independent_cols.extend(dummy_column_map[col])
        else:
            expanded_independent_cols.append(col)

    if remove_outliers:
        # IMPORTANT: exclude one-hot encoded dummy columns from IQR-based
        # outlier detection. For a 0/1 column, if a category's prevalence is
        # below 25% or above 75%, Q1/Q3 collapse to the same value (IQR = 0),
        # which makes the bounds [0, 0] or [1, 1] and silently deletes every
        # row belonging to (or excluded from) that category. IQR filtering
        # is only meaningful for genuinely continuous columns.
        ohe_col_names = encoders.get("ohe_col_names", [])
        numeric_cols = [
            c for c in df.select_dtypes(include=np.number).columns
            if c not in ohe_col_names
        ]

        # Build all column masks against the same (pre-filter) DataFrame and
        # apply them together, rather than filtering column-by-column. Doing
        # it sequentially makes the result depend on column order, since
        # later columns' quantiles get computed on data already trimmed by
        # earlier ones. A combined mask is order-independent and easier to
        # reason about / replicate in a comparison script.
        mask = pd.Series(True, index=df.index)
        for col in numeric_cols:
            q1, q3 = df[col].quantile(0.25), df[col].quantile(0.75)
            iqr = q3 - q1
            mask &= (df[col] >= q1 - 1.5 * iqr) & (df[col] <= q3 + 1.5 * iqr)
        df = df[mask]

    return {
        "df": df,
        "X": df[expanded_independent_cols],
        "y": df[dependent_col],
        "encoders": encoders,
        "dummy_column_map": dummy_column_map,
        "expanded_independent_cols": expanded_independent_cols,
    }