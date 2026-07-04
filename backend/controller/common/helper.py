import numpy as np
import pandas as pd
from sklearn.metrics import mean_squared_error, mean_absolute_error, r2_score
import statsmodels.api as sm
from sklearn.inspection import permutation_importance
from sklearn.preprocessing import LabelEncoder

def is_valid_date(date_str):
    try:
        pd.to_datetime(date_str)
        return True
    except ValueError:
        return False

def to_serializable(obj):
    """Recursively convert numpy data types to native Python types."""
    if isinstance(obj, dict):
        return {k: to_serializable(v) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [to_serializable(v) for v in obj]
    elif isinstance(obj, np.generic):
        return obj.item()
    else:
        return obj


def compute_metrics(results, test_data, target_var, exog_test=None):
    """Compute MSE, AIC, and BIC safely with aligned indices."""
    forecast = results.forecast(steps=len(test_data), exog=exog_test)
    
    # Ensure both forecast and test have matching index positions
    forecast = pd.Series(forecast).reset_index(drop=True)
    actual = test_data[target_var].reset_index(drop=True)
    
    mse = float(np.mean((actual - forecast) ** 2))
    rmse = float(np.sqrt(mse)) 
        
    return {
        'mse': round(mse, 3),
        'rmse': round(rmse, 3),
        'aic': round(results.aic, 3),
        'bic': round(results.bic, 3)
    }


def clean_input_data(raw_data):
    """Remove empty strings, NaN, or None values."""
    df = pd.DataFrame(raw_data)
    df.replace('', np.nan, inplace=True)
    df.dropna(inplace=True)
    return df

def detect_columns(first_object):
    """Automatically detect date and target columns."""
    date_column, target_column = None, None
    for key, value in first_object.items():
        if is_valid_date(value):
            date_column = key
        else:
            target_column = key
    return date_column, target_column

def prepare_dataframe(actual_data, date_column, target_column):
    df = pd.DataFrame(actual_data)
    df[date_column] = pd.to_datetime(df[date_column])
    df[target_column] = pd.to_numeric(df[target_column], errors='coerce')
    df.sort_values(by=date_column, inplace=True)
    
    # Create lagged variables
    for lag in range(1, 4):
        df[f"{target_column}_{lag}"] = df[target_column].shift(lag)
    df.dropna(inplace=True)
    
    return df.set_index(date_column)


def preprocess_exog(df, exog_cols):
    """
    Preprocess continuous exogenous variables that may be stored as strings.
    """

    exog_df = df[exog_cols].copy()

    # Convert all to numeric
    for col in exog_cols:
        exog_df[col] = pd.to_numeric(exog_df[col], errors="coerce")

    # Handle missing values (time-series safe)
    exog_df = (
        exog_df
        .fillna(method="ffill")
        .fillna(method="bfill")
    )

    return exog_df

def compute_lasso_metrics(model, X_test, y_test, feature_names):
    preds = model.predict(X_test)

    mse = mean_squared_error(y_test, preds)
    mae = mean_absolute_error(y_test, preds)

    rmse = np.sqrt(mse)
    r2 = r2_score(y_test, preds)

    coef_summary = [
        {
            "field_name": name,
            "mean": round(float(coef), 4),
            "standard_error": "",
            "p_value": ""
        }
        for name, coef in zip(feature_names, model.coef_)
    ]

    return {
        "mae": round(mae, 3),
        "rmse": round(rmse, 3),
        "r2": round(r2, 3),
        "alpha": round(model.alpha_, 4),
        "data": coef_summary
    }



def create_lag_features(df, target_col, num_lags=3):
    """Create lag features for time series modeling."""
    for lag in range(1, num_lags + 1):
        df[f'{target_col}_lag_{lag}'] = df[target_col].shift(lag)
    df.dropna(inplace=True)
    return df



def compute_ridge_metrics(model, X_test, y_test, feature_names):
    """
    Compute evaluation metrics and feature coefficients for a trained Ridge model,
    formatted like OLS (empty standard_error and p_value).
    """

    # Predictions
    y_pred = model.predict(X_test)

    # Evaluation metrics
    rmse = np.sqrt(mean_squared_error(y_test, y_pred))
    mae = mean_absolute_error(y_test, y_pred)
    r2 = r2_score(y_test, y_pred)

    # Coefficient summary formatted like OLS
    coef_summary = [
        {
            "field_name": feature,
            "mean": round(float(coef), 4),
            "standard_error": "",
            "p_value": ""
        }
        for feature, coef in zip(feature_names, model.coef_)
    ]

    return {
        "model": "ridge",
        "alpha": float(model.alpha_) if hasattr(model, "alpha_") else None,
        "rmse": round(rmse, 3),
        "mae": round(mae, 3),
        "r2": round(r2, 3),
        "data": coef_summary
    }

def compute_rf_metrics(model, X_test, y_test, feature_names):
    """
    Compute evaluation metrics and feature importances for a trained Random Forest model.
    Ensures all numeric values are formatted to 3 decimal places.
    """

    y_pred = model.predict(X_test)

    rmse = np.sqrt(mean_squared_error(y_test, y_pred))
    mae = mean_absolute_error(y_test, y_pred)
    r2 = r2_score(y_test, y_pred)

    # Format helper for consistent 3-decimal output
    def fmt(value):
        return float(f"{value:.3f}")

    # Feature importance summary with 3-decimal values
    importance_summary = [
        {
            "field_name": name,
            "importance": fmt(imp),
            "mean": fmt(imp),          # keeping your OLS-style naming
            "standard_error": "",
            "p_value": ""
        }
        for name, imp in zip(feature_names, model.feature_importances_)
    ]

    return {
        "model": "RANDOM FOREST",
        "n_estimators": model.n_estimators,
        "rmse": fmt(rmse),
        "mae": fmt(mae),
        "r2": fmt(r2),
        "data": importance_summary
    }


def compute_bagging_metrics(model, X_test, y_test, feature_names):
    """
    Compute evaluation metrics and permutation-based feature importances
    for a trained Bagging Regressor.
    All numbers are returned with 3-decimal formatting.
    """

    y_pred = model.predict(X_test)

    # Helper for clean formatting
    fmt = lambda x: float(f"{x:.3f}")

    # Metrics
    rmse = fmt(np.sqrt(mean_squared_error(y_test, y_pred)))
    mae = fmt(mean_absolute_error(y_test, y_pred))
    r2 = fmt(r2_score(y_test, y_pred))

    # Permutation importance (Bagging has no native importances)
    perm = permutation_importance(
        model,
        X_test,
        y_test,
        n_repeats=10,
        random_state=42
    )

    importance_summary = []
    for name, imp in zip(feature_names, perm.importances_mean):
        importance_summary.append({
            "field_name": name,
            "importance": fmt(imp),
            "mean": fmt(imp),
            "standard_error": "",
            "p_value": ""
        })

    return {
        "model": "BAGGING",
        "n_estimators": model.n_estimators,
        "rmse": rmse,
        "mae": mae,
        "r2": r2,
        "data": importance_summary
    }




def compute_boosting_metrics(model, X_test, y_test, feature_names):
    """
    Compute evaluation metrics and feature importances for a Gradient Boosting model.
    Ensures all numeric values have 3-decimal formatting.
    """

    y_pred = model.predict(X_test)

    fmt = lambda val: float(f"{val:.3f}")

    rmse = fmt(np.sqrt(mean_squared_error(y_test, y_pred)))
    mae = fmt(mean_absolute_error(y_test, y_pred))
    r2 = fmt(r2_score(y_test, y_pred))

    # Feature importances (Gradient Boosting provides native importance)
    importance_summary = [
        {
            "field_name": name,
            "importance": fmt(imp),
            "mean": fmt(imp),
            "standard_error": "",
            "p_value": ""
        }
        for name, imp in zip(feature_names, model.feature_importances_)
    ]

    return {
        "model": "BOOSTING",
        "n_estimators": model.n_estimators,
        "learning_rate": fmt(model.learning_rate),
        "rmse": rmse,
        "mae": mae,
        "r2": r2,
        "data": importance_summary
    }

def prepare_dataset(
    raw_data,
    dependent_col,
    independent_cols,
    categorical_cols=None,
    id_col=None,
    remove_outliers=False
):
    df = pd.DataFrame(raw_data)

    # remove id column
    if id_col and id_col in df.columns:
        df = df.drop(columns=[id_col])

    # drop missing rows for now
    df = df.dropna()

    # encode categorical variables
    encoders = {}

    if categorical_cols:
        for col in categorical_cols:
            if col in df.columns:
                le = LabelEncoder()
                df[col] = le.fit_transform(df[col].astype(str))
                encoders[col] = le

    # optional outlier removal
    if remove_outliers:

        numeric_cols = df.select_dtypes(
            include=np.number
        ).columns

        for col in numeric_cols:

            q1 = df[col].quantile(0.25)
            q3 = df[col].quantile(0.75)

            iqr = q3 - q1

            lower = q1 - 1.5 * iqr
            upper = q3 + 1.5 * iqr

            df = df[
                (df[col] >= lower) &
                (df[col] <= upper)
            ]

    X = df[independent_cols]
    y = df[dependent_col]

    return {
        "df": df,
        "X": X,
        "y": y,
        "encoders": encoders
    }