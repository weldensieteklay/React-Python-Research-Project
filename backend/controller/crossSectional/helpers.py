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

    df = df.dropna()

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
        numeric_cols = df.select_dtypes(include=np.number).columns
        for col in numeric_cols:
            q1, q3 = df[col].quantile(0.25), df[col].quantile(0.75)
            iqr = q3 - q1
            df = df[(df[col] >= q1 - 1.5 * iqr) & (df[col] <= q3 + 1.5 * iqr)]

    return {
        "df": df,
        "X": df[expanded_independent_cols],
        "y": df[dependent_col],
        "encoders": encoders,
        "dummy_column_map": dummy_column_map,
        "expanded_independent_cols": expanded_independent_cols,
    }