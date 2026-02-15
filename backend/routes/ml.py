from fastapi import APIRouter, Request, HTTPException
from fastapi.responses import JSONResponse

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
# Initialize router
# -----------------------------
router = APIRouter()

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

@router.post("/ols")
async def ols_prediction(request: Request):
    return await handle_request(run_ols_prediction, request)

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
