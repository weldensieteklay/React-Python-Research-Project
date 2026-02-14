# from flask import Flask
# from flask_cors import CORS
# from routes.ml import routes

# app = Flask(__name__)

# # Allow all origins, methods, and headers (for testing)
# CORS(app, resources={r"/api/*": {"origins": "*"}})

# # Register Blueprint
# app.register_blueprint(routes, url_prefix='/api')

# if __name__ == '__main__':
#     app.run(debug=True)
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from routes.ml import router  # your ML router

app = FastAPI()

# CORS settings
origins = [
    "http://localhost:5173",  # your frontend
    "http://127.0.0.1:5173"
]

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

