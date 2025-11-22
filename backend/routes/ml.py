from flask import Blueprint, request, jsonify
from controller.ols.ols import run_ols_prediction
from controller.arima.ARIMA import predict_price
from controller.lasso.LASSO import predict_price_lasso
from controller.ridge.RIDGE import predict_price_ridge
from controller.forest.FOREST import predict_price_random_forest

# -----------------------------
# Initialize blueprints
# -----------------------------
routes = Blueprint("routes", __name__)


# -----------------------------
# OLS / ARIMA (SARIMAX-based) endpoint
# -----------------------------
@routes.route("/ols", methods=["POST"])
def ols_prediction():
    """
    Endpoint for OLS or ARIMA/SARIMAX predictions.
    Expects JSON input matching the model requirements.
    """
    try:
        data = request.get_json(force=True)
        if not data:
            return jsonify({"error": "No JSON payload provided"}), 400

        result = run_arima_model(data)
        if "error" in result:
            return jsonify(result), 400

        return jsonify(result), 200

    except Exception as e:
        return jsonify({"error": str(e)}), 500


# -----------------------------
# ARIMA (classic) endpoint
# -----------------------------
@routes.route("/arima", methods=["POST"])
def arima_prediction():
    """
    Endpoint for ARIMA prediction logic.
    Delegates to the existing `predict_price()` function.
    """
    try:
        return predict_price()
    except Exception as e:
        return jsonify({"error": str(e)}), 500

        # -----------------------------
# LASSO (classic) endpoint
# -----------------------------
@routes.route("/lasso", methods=["POST"])
def lass_prediction():
    """
    Endpoint for LASSO prediction logic.
    Delegates to the existing `predict_price_lasso()` function.
    """
    try:
        return predict_price_lasso()
    except Exception as e:
        return jsonify({"error": str(e)}), 500

# -----------------------------
# RIDGE
# -----------------------------
@routes.route("/ridge", methods=["POST"])
def ridge_prediction():
    """
    Endpoint for RIDGE prediction logic.
    Delegates to the existing `predict_price_ridge()` function.
    """
    try:
        return predict_price_ridge()
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# -----------------------------
# Forest
# -----------------------------
@routes.route("/forest", methods=["POST"])
def forest_prediction():
    """
    Endpoint for FOREST prediction logic.
    Delegates to the existing `predict_price_random_forest()` function.
    """
    try:
        return predict_price_random_forest()
    except Exception as e:
        return jsonify({"error": str(e)}), 500