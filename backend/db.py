import os
import motor.motor_asyncio

MONGODB_URI = os.getenv("MONGODB_URI")

client = motor.motor_asyncio.AsyncIOMotorClient(MONGODB_URI)
db = client["econwebcast"]
consent_collection = db["consent"]