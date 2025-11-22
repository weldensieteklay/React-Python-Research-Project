import numpy as np
import pandas as pd
from sklearn.metrics import mean_squared_error, mean_absolute_error, r2_score
import statsmodels.api as sm


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
        
    return {
        'mse': round(mse, 3),
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
    Handles numeric and categorical exogenous variables.
    - Binary categorical (1/0) → kept as numeric
    - Multi-class categorical → one-hot encoded
    - Continuous → numeric
    """
    exog_df = df[exog_cols].copy()

    for col in exog_cols:
        # Binary categorical (1 or 0)
        if exog_df[col].nunique() <= 2:
            exog_df[col] = pd.to_numeric(exog_df[col], errors='coerce')
        # Multi-class categorical (e.g. 1–5 or strings)
        elif exog_df[col].dtype == object or exog_df[col].nunique() > 2:
            exog_df = pd.get_dummies(exog_df, columns=[col], drop_first=True)
        # Continuous variable
        else:
            exog_df[col] = pd.to_numeric(exog_df[col], errors='coerce')

    exog_df.fillna(0, inplace=True)
    return exog_df

def compute_lasso_metrics(model, X_test, y_test, feature_names):
    """Compute regression metrics and coefficient summary formatted like OLS."""
    
    # Predictions
    preds = model.predict(X_test)
    mse = mean_squared_error(y_test, preds)
    r2 = r2_score(y_test, preds)

    # Coefficient summary formatted like OLS response
    coef_summary = [
        {
            "field_name": name,
            "mean": round(coef, 4),
            "standard_error": "",
            "p_value": ""
        }
        for name, coef in zip(feature_names, model.coef_)
    ]

    return {
        "mse": round(mse, 3),
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
        "model": "random_forest",
        "n_estimators": model.n_estimators,
        "rmse": fmt(rmse),
        "mae": fmt(mae),
        "r2": fmt(r2),
        "data": importance_summary
    }