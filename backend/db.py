import os
import certifi
import motor.motor_asyncio

MONGODB_URI = os.getenv("MONGODB_URI")

client = motor.motor_asyncio.AsyncIOMotorClient(
    MONGODB_URI,
    tls=True,
    tlsCAFile=certifi.where(),
)
db = client["econwebcast"]
consent_collection = db["consent"]