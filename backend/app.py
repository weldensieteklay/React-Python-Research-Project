from flask import Flask
from flask_cors import CORS
from routes.ml import ml_bp

app = Flask(__name__)
CORS(app)

# Register Blueprints
app.register_blueprint(ml_bp, url_prefix='/api')

if __name__ == '__main__':
    app.run(debug=True)
