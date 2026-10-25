from fastapi import APIRouter, Depends, Request, HTTPException
from fastapi.responses import JSONResponse
from controller.common.rate_limiter import limiter

# cross sectional
from controller.crossSectional.ols import run_ols_prediction
from controller.crossSectional.gls import run_gls_prediction
from controller.crossSectional.logit import run_logit_prediction
from controller.crossSectional.lasso import run_lasso_cross_sectional_prediction
from controller.crossSectional.ridge import run_ridge_cross_sectional_prediction
from controller.crossSectional.forest import run_random_forest_cross_sectional_prediction
from controller.crossSectional.bagging import run_bagging_cross_sectional_prediction
from controller.crossSectional.boosting import run_gradient_boosting_cross_sectional_prediction

# panel data
from controller.panel.fixedEffect import run_fixed_effects_prediction
from controller.panel.randomEffect import run_random_effects_prediction
from controller.panel.lasso import run_lasso_panel
from controller.panel.ridge import run_ridge_panel
from controller.panel.forest import run_random_forest_panel
from controller.panel.boosting import run_boosting_panel
from controller.panel.bagging import run_bagging_panel

# time series
from controller.arima.ARIMA import predict_price
from controller.lasso.LASSO import predict_price_lasso
from controller.ridge.RIDGE import predict_price_ridge
from controller.forest.FOREST import predict_price_random_forest
from controller.bagging.BAGGING import predict_price_bagging
from controller.boosting.BOOSTING import predict_price_boosting

# sign-in and access control
from controller.consent import record_consent, access_status_endpoint, require_active_access

# data routes (rent panel, covariates, divergence model, macro)
from routes.acs_service import router as data_router


# -----------------------------
# Routers
# -----------------------------
# main.py mounts `router` at /api and checks the Google token on every route in it.
#   router     -> any signed-in user (needed so pending users can see their status)
#   protected  -> approved users only (subscribed: true and pilot not ended)
router = APIRouter()
protected = APIRouter(dependencies=[Depends(require_active_access)])

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
# Sign-in and access status (open to every signed-in user)
# -----------------------------
@router.post("/consent")
async def consent_endpoint(request: Request):
    return await record_consent(request)


@router.get("/access-status")
async def access_status(request: Request):
    return await access_status_endpoint(request)


# -----------------------------
# Cross sectional (approved users only)
# Function names must be unique: the rate limiter keys each limit by function name.
# -----------------------------
@protected.post("/cross-sectional/ols")
@limit_prediction
async def cs_ols(request: Request):
    return await run_ols_prediction(request)


@protected.post("/cross-sectional/logit")
@limit_prediction
async def cs_logit(request: Request):
    return await run_logit_prediction(request)


@protected.post("/cross-sectional/gls")
@limit_prediction
async def cs_gls(request: Request):
    return await run_gls_prediction(request)


@protected.post("/cross-sectional/lasso")
@limit_prediction
async def cs_lasso(request: Request):
    return await run_lasso_cross_sectional_prediction(request)


@protected.post("/cross-sectional/ridge")
@limit_prediction
async def cs_ridge(request: Request):
    return await run_ridge_cross_sectional_prediction(request)


@protected.post("/cross-sectional/forest")
@limit_prediction
async def cs_forest(request: Request):
    return await run_random_forest_cross_sectional_prediction(request)


@protected.post("/cross-sectional/boosting")
@limit_prediction
async def cs_boosting(request: Request):
    return await run_gradient_boosting_cross_sectional_prediction(request)


@protected.post("/cross-sectional/bagging")
@limit_prediction
async def cs_bagging(request: Request):
    return await run_bagging_cross_sectional_prediction(request)


# -----------------------------
# Panel data (approved users only)
# -----------------------------
@protected.post("/panel/fixed")
async def panel_fixed(request: Request):
    return await run_fixed_effects_prediction(request)


@protected.post("/panel/random")
async def panel_random(request: Request):
    return await run_random_effects_prediction(request)


@protected.post("/panel/lasso")
async def panel_lasso(request: Request):
    return await run_lasso_panel(request)


@protected.post("/panel/ridge")
async def panel_ridge(request: Request):
    return await run_ridge_panel(request)


@protected.post("/panel/forest")
async def panel_forest(request: Request):
    return await run_random_forest_panel(request)


@protected.post("/panel/boosting")
async def panel_boosting(request: Request):
    return await run_boosting_panel(request)      # was run_bagging_panel


@protected.post("/panel/bagging")
async def panel_bagging(request: Request):
    return await run_bagging_panel(request)


# -----------------------------
# Time series (approved users only)
# -----------------------------
@protected.post("/arima")
async def ts_arima(request: Request):
    return await predict_price(request)


@protected.post("/lasso")
async def ts_lasso(request: Request):
    return await predict_price_lasso(request)


@protected.post("/ridge")
async def ts_ridge(request: Request):
    return await predict_price_ridge(request)


@protected.post("/forest")
async def ts_forest(request: Request):
    return await predict_price_random_forest(request)


@protected.post("/bagging")
async def ts_bagging(request: Request):
    return await predict_price_bagging(request)


@protected.post("/boosting")
async def ts_boosting(request: Request):
    return await predict_price_boosting(request)


# -----------------------------
# Data (approved users only)
# -----------------------------
protected.include_router(data_router, prefix="/data")

# Must come after every protected route above is defined
router.include_router(protected)
