from flask import Flask
from flask_cors import CORS
from routes.ml import routes

app = Flask(__name__)

# Allow all origins, methods, and headers (for testing)
CORS(app, resources={r"/api/*": {"origins": "*"}})

# Or restrict to your frontend origin
# CORS(app, resources={r"/api/*": {"origins": "http://localhost:3000"}})

# Register Blueprint
app.register_blueprint(routes, url_prefix='/api')

if __name__ == '__main__':
    app.run(debug=True)
