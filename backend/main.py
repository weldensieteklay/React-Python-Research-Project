import os
from typing import Annotated
from fastapi import FastAPI, Request, Depends, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.security import OAuth2PasswordBearer
from dotenv import load_dotenv

from google.oauth2 import id_token
from google.auth.transport import requests as google_requests
from controller.common.rate_limiter import limiter
from slowapi.errors import RateLimitExceeded
from routes.routes import router

# Load environment configuration variables
load_dotenv()
GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID")

app = FastAPI(
    title="Econ Web Cast API",
    description="Secure enterprise backend with Google OIDC authentication.",
    version="1.0.0"
)

# Initialize global rate limiting engine
app.state.limiter = limiter

# ───────────────────────────────────────────────
# 🛡️ CORS MIDDLEWARE CONFIGURATION
# ───────────────────────────────────────────────
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

# ───────────────────────────────────────────────
# AUTHENTICATION SECURITY DEPENDENCY
# ───────────────────────────────────────────────
# Automatically handles extracting the 'Bearer <token>' substring from request headers
# auto_error=False ensures native CORS processing parameters operate unimpeded
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="token", auto_error=False)

async def verify_google_token(
    request: Request, 
    token: Annotated[str, Depends(oauth2_scheme)]
) -> dict:
    """
    Dependency validator that verifies the incoming Google OIDC ID token.
    Attaches the verified user information payload directly to the request state context.
    """
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing or structurally invalid Authorization bearer token header."
        )

    try:
        # Cryptographically verifies the signature locally using cached Google certs
        decoded_user = id_token.verify_oauth2_token(
            token, 
            google_requests.Request(), 
            GOOGLE_CLIENT_ID
        )
        
        # Mount the payload to request.state so existing controllers can access it unchanged
        request.state.user = decoded_user
        return decoded_user

    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="The provided authentication token has expired or is invalid."
        )
    except Exception as e:
        print(f"[AUTH ERROR] Unexpected token resolution failure: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal authentication framework processing failure."
        )

# ───────────────────────────────────────────────
# SYSTEM GLOBAL EXCEPTION HANDLERS
# ───────────────────────────────────────────────
@app.exception_handler(RateLimitExceeded)
async def rate_limit_handler(request: Request, exc: RateLimitExceeded):
    return JSONResponse(
        status_code=status.HTTP_429_TOO_MANY_REQUESTS,
        content={
            "success": False,
            "error": "Too many requests. Please try again in one minute."
        },
    )

# ───────────────────────────────────────────────
# 🔌 APPLICATION ROUTES
# ───────────────────────────────────────────────
# Protects ALL routes under /api automatically by injecting the dependency gateway.
# Public endpoints like /, /docs, /redoc, and /openapi.json naturally stay accessible.
app.include_router(
    router, 
    prefix="/api", 
    dependencies=[Depends(verify_google_token)]
)

@app.get("/", tags=["System Monitoring"])
def root():
    return {"message": "Backend is running smoothly"}
