from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from dotenv import load_dotenv
from routes.routes import router

from google.oauth2 import id_token
from google.auth.transport import requests as google_requests
from controller.common.rate_limiter import limiter
from slowapi.errors import RateLimitExceeded
import os

load_dotenv()

app = FastAPI()

app.state.limiter = limiter
GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID")

PUBLIC_PATHS = {
    "/",
    "/docs",
    "/redoc",
    "/openapi.json",
}

# ─────────────────────────────────────────
# CORS — must be added BEFORE auth middleware
# so preflight OPTIONS responses include the
# correct headers before auth run
# ─────────────────────────────────────────
origins = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "https://econ-web-cast.vercel.app",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.exception_handler(RateLimitExceeded)
async def rate_limit_handler(request: Request, exc: RateLimitExceeded):
    return JSONResponse(
        status_code=429,
        content={
            "success": False,
            "error": "Too many requests. Please try again in one minute."
        },
    )

@app.middleware("http")
async def verify_google_token(request: Request, call_next):
     # Allow CORS preflight requests
    if request.method == "OPTIONS":
        return await call_next(request)
    
    if request.url.path in PUBLIC_PATHS:
        return await call_next(request)
    
    auth_header = request.headers.get("Authorization")

    if not auth_header or not auth_header.startswith("Bearer "):
        return JSONResponse(
            status_code=401,
            content={"success": False, "error": "Missing or invalid Authorization header"},
        )

    token = auth_header[len("Bearer "):].strip()

    if not token:
        return JSONResponse(
            status_code=401,
            content={"success": False, "error": "Empty bearer token"},
        )

    try:
        decoded = id_token.verify_oauth2_token(token, google_requests.Request(), GOOGLE_CLIENT_ID)
        request.state.user = decoded
    except ValueError:
        return JSONResponse(
            status_code=401,
            content={"success": False, "error": "Invalid or expired token"},
        )
    except Exception as e:
        # Catch-all so an unexpected error never bypasses CORS headers
        print(f"[AUTH] Unexpected error: {e}")
        return JSONResponse(
            status_code=500,
            content={"success": False, "error": "Internal authentication error"},
        )

    return await call_next(request)
# ─────────────────────────────────────────
# ROUTES
# ─────────────────────────────────────────
app.include_router(router, prefix="/api")


@app.get("/")
def root():
    return {"message": "Backend is running"}
