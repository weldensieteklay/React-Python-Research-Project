def extract_model_summary(results, target_var):
    summary = []
    for name, coef in results.params.items():
        se = results.bse[name]    
        pval = results.pvalues[name]
        summary.append({
            "field_name": name,
            "mean": round(float(coef), 4),
            "standard_error": round(float(se), 4),
            "p_value": f"{pval:.2e}"  # scientific notation
        })
    return summary
