from flask import Blueprint, request, jsonify
from controller.ols.ols import run_ols_prediction
from controller.arima.ARIMA import predict_price
from controller.lasso.LASSO import predict_price_lasso
from controller.ridge.RIDGE import predict_price_ridge
from controller.forest.FOREST import predict_price_random_forest
from controller.bagging.BAGGING import predict_price_bagging
from controller.boosting.BOOSTING import predict_price_boosting
from controller.hybridForest.FOREST import predict_price_hybrid_forest
from controller.arima.HYBRIDLASSO import predict_price_hybrid_lasso
from controller.arima.HYBRIDRIDGE import predict_price_hybrid_ridge
from controller.arima.HYBRIDFOREST import predict_price_hybrid_forest
from controller.arima.HYBRIDBOOSTING import predict_price_hybrid_boosting
from controller.arima.HYBRIDBAGGING import predict_price_hybrid_bagging 

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


# -----------------------------
# Bagging
# -----------------------------
@routes.route("/bagging", methods=["POST"])
def bagging_prediction():
    """
    Endpoint for BAGGING prediction logic.
    Delegates to the existing `predict_price_bagging()` function.
    """
    try:
        return predict_price_bagging()
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# -----------------------------
# Boosting
# -----------------------------
@routes.route("/boosting", methods=["POST"])
def boosting_prediction():
    """
    Endpoint for BOOSTING prediction logic.
    Delegates to the existing `predict_price_boosting()` function.
    """
    try:
        return predict_price_boosting()
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# Hybrid
# -----------------------------
@routes.route("/hybrid-forest", methods=["POST"])
def hybridForest_prediction():
    """
    Endpoint for hybrid forest prediction logic.
    Delegates to the existing `predict_price_hybrid_forest()` function.
    """
    try:
        return predict_price_hybrid_forest()
    except Exception as e:
        return jsonify({"error": str(e)}), 500

        # -----------------------------
# ARIMA-LASSO (classic) endpoint
# -----------------------------
@routes.route("/hybrid-lasso", methods=["POST"])
def hybridLasso_prediction():
    try:
        return predict_price_hybrid_lasso()
    except Exception as e:
        return jsonify({"error": str(e)}), 500


        # -----------------------------
# ARIMA-RIGHE (classic) endpoint
# -----------------------------
@routes.route("/hybrid-ridge", methods=["POST"])
def hybridRidge_prediction():
    try:
        return predict_price_hybrid_ridge()
    except Exception as e:
        return jsonify({"error": str(e)}), 500


        # -----------------------------
# ARIMA-BOOSTING (classic) endpoint
# -----------------------------
@routes.route("/hybrid-boosting", methods=["POST"])
def hybridBoosting_prediction():
    try:
        return predict_price_hybrid_boosting()
    except Exception as e:
        return jsonify({"error": str(e)}), 500


        # -----------------------------
# ARIMA-BAGGING (classic) endpoint
# -----------------------------
@routes.route("/hybrid-bagging", methods=["POST"])
def hybridBagging_prediction():
    try:
        return predict_price_hybrid_bagging()
    except Exception as e:
        return jsonify({"error": str(e)}), 500

