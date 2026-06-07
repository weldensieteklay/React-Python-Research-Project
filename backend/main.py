from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from routes.routes import router  # your time series router

# main.py (top of file, before anything else)
from dotenv import load_dotenv

app = FastAPI()

# CORS settings
origins = [
    "http://localhost:5173",  # your frontend
    "http://127.0.0.1:5173"
]
load_dotenv()

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,  # allow only frontend
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routes with /api prefix
app.include_router(router, prefix="/api")

@app.get("/")
def root():
    return {"message": "Backend is running"}

