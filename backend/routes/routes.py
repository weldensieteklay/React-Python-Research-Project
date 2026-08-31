from fastapi import APIRouter, Request, HTTPException
from fastapi.responses import JSONResponse
from controller.common.rate_limiter import limiter

#cross sectional routes
from controller.crossSectional.ols import run_ols_prediction
from controller.crossSectional.gls import run_gls_prediction
from controller.crossSectional.logit import run_logit_prediction
from controller.crossSectional.lasso import run_lasso_cross_sectional_prediction
from controller.crossSectional.ridge import run_ridge_cross_sectional_prediction
from controller.crossSectional.forest import run_random_forest_cross_sectional_prediction
from controller.crossSectional.bagging import run_bagging_cross_sectional_prediction
from controller.crossSectional.boosting import run_gradient_boosting_cross_sectional_prediction

#panel data
from controller.panel.fixedEffect import run_fixed_effects_prediction
from controller.panel.randomEffect import run_random_effects_prediction
from controller.panel.lasso import run_lasso_panel
from controller.panel.ridge import run_ridge_panel
from controller.panel.forest import run_random_forest_panel
from controller.panel.boosting import run_boosting_panel
from controller.panel.bagging import run_bagging_panel

#time series routes
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

#time series routes
from controller.consent import record_consent

# -----------------------------
# Initialize router
# -----------------------------
router = APIRouter()

limit_prediction = limiter.limit("20/minute")
# -----------------------------
# Helper to handle JSON request and errors
# -----------------------------
async def handle_request(func, request: Request = None):
    try:
        data = None
        if request:
            data = await request.json()
        result = func(data) if data else func()
        if isinstance(result, dict) and "error" in result:
            raise HTTPException(status_code=400, detail=result["error"])
        return JSONResponse(content=result)
    except HTTPException as e:
        raise e
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# -----------------------------
# Endpoints
# -----------------------------

# cross sectional routes
@router.post("/cross-sectional/ols")
@limit_prediction
async def ols_prediction(request: Request):
    return await run_ols_prediction(request)

# cross sectional routes
@router.post("/cross-sectional/logit")
@limit_prediction
async def logit_prediction(request: Request):
    return await run_logit_prediction(request)

@router.post("/cross-sectional/gls")
@limit_prediction
async def ols_prediction(request: Request):
    return await run_gls_prediction(request)

@router.post("/cross-sectional/lasso")
@limit_prediction
async def lasso_prediction(request: Request):
    return await run_lasso_cross_sectional_prediction(request)

@router.post("/cross-sectional/ridge")
@limit_prediction
async def ridge_prediction(request: Request):
    return await run_ridge_cross_sectional_prediction(request)

@router.post("/cross-sectional/forest")
@limit_prediction
async def ridge_prediction(request: Request):
    return await run_random_forest_cross_sectional_prediction(request)

@router.post("/cross-sectional/boosting")
@limit_prediction
async def ridge_prediction(request: Request):
    return await run_gradient_boosting_cross_sectional_prediction(request)

@router.post("/cross-sectional/bagging")
@limit_prediction
async def ridge_prediction(request: Request):
    return await run_bagging_cross_sectional_prediction(request)

# panel data
@router.post("/panel/fixed")
async def fixed_effects_prediction(request: Request):
    return await run_fixed_effects_prediction(request)

@router.post("/panel/random")
async def random_effects_prediction(request: Request):
    return await run_random_effects_prediction(request)

@router.post("/panel/lasso")
async def lasso_prediction(request: Request):
    return await run_lasso_panel(request)

@router.post("/panel/ridge")
async def ridge_prediction(request: Request):
    return await run_ridge_panel(request)

@router.post("/panel/forest")
async def forest_panel_prediction(request: Request):
    return await run_random_forest_panel(request)

@router.post("/panel/boosting")
async def boosting_panel_prediction(request: Request):
    return await run_boosting_panel(request)

@router.post("/panel/bagging")
async def bagging_panel_prediction(request: Request):
    return await run_bagging_panel(request)

# Time series routes
@router.post("/arima")
async def arima_endpoint(request: Request):
    # pass request to your function
    return await predict_price(request)

@router.post("/lasso")
async def lasso_prediction(request: Request):
    return await predict_price_lasso(request)

@router.post("/ridge")
async def ridge_prediction(request: Request):
    return await predict_price_ridge(request)

@router.post("/forest")
async def forest_prediction(request: Request):
    return await predict_price_random_forest(request)

@router.post("/bagging")
async def bagging_prediction(request: Request):
    return await predict_price_bagging(request)

@router.post("/boosting")
async def boosting_prediction(request: Request):
    return await predict_price_boosting(request)

@router.post("/hybrid-forest")
async def hybrid_forest_prediction(request: Request):
    return await predict_price_hybrid_forest(request)

@router.post("/hybrid-lasso")
async def hybrid_lasso_prediction(request: Request):
    return await predict_price_hybrid_lasso(request)

@router.post("/hybrid-ridge")
async def hybrid_ridge_prediction(request: Request):
    return await predict_price_hybrid_ridge(request)

@router.post("/hybrid-boosting")
async def hybrid_boosting_prediction(request: Request):
    return await predict_price_hybrid_boosting(request)

@router.post("/hybrid-bagging")
async def hybrid_bagging_prediction(request: Request):
    return await predict_price_hybrid_bagging(request)

@router.post("/hybrid-forest-arima")
async def hybrid_forest_arima_prediction(request: Request):
    return await handle_request(request)

@router.post("/consents")
async def consent_endpoint(request: Request):
    return await record_consent(request)