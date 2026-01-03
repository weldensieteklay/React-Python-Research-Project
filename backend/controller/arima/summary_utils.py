def extract_model_summary(results, target_var):
    params = results.params
    summary = []

    for name, coef in params.items():
        summary.append({
            "field_name": name,
            "mean": round(float(coef), 4),
            "standard_error": "",
            "p_value": ""
        })

    return summary
