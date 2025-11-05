import numpy as np
import pandas as pd
from sklearn.linear_model import LinearRegression

def run_ols_prediction(input_data):
    """
    input_data: dict with keys 'X' (2D list or array) and 'y' (1D list or array)
    example: {"X": [[1,2],[2,3],[3,4]], "y": [2,3,4]}
    """
    try:
        X = np.array(input_data.get('X'))
        y = np.array(input_data.get('y'))

        # Fit OLS model
        model = LinearRegression()
        model.fit(X, y)

        # Optional: prediction for a new point if provided
        if 'predict' in input_data:
            new_X = np.array(input_data['predict']).reshape(1, -1)
            prediction = model.predict(new_X)
        else:
            prediction = None

        result = {
            "coefficients": model.coef_.tolist(),
            "intercept": model.intercept_.item(),
            "r_squared": model.score(X, y),
            "prediction": prediction.tolist() if prediction is not None else None
        }

        return result
    except Exception as e:
        return {"error": str(e)}
