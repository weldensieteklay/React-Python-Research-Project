from flask import Flask
from routes.ml import ml_bp

app = Flask(__name__)

# Register Blueprints
app.register_blueprint(ml_bp, url_prefix='/api/ml')

if __name__ == '__main__':
    app.run(debug=True)
