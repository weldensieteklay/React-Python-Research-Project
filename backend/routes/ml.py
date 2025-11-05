from flask import Blueprint, request, jsonify
from controller.ml import run_ols_prediction

ml_bp = Blueprint('ml_bp', __name__)

@ml_bp.route('/ols', methods=['POST'])
def ols_prediction():
    try:
        data = request.get_json()
        result = run_ols_prediction(data)
        return jsonify(result)
    except Exception as e:
        return jsonify({"error": str(e)}), 400
