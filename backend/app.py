from flask import Flask
from flask_cors import CORS
from routes.ml import routes

app = Flask(__name__)

# Allow all origins, methods, and headers (for testing)
CORS(app, resources={r"/api/*": {"origins": "*"}})

# Register Blueprint
app.register_blueprint(routes, url_prefix='/api')

if __name__ == '__main__':
    app.run(debug=True)
