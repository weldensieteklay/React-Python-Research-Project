import numpy as np
import pandas as pd

import numpy as np

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
