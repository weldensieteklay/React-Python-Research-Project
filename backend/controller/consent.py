from datetime import datetime, timezone
from db import consent_collection

TERMS_VERSION = "1.0"

async def record_consent(request):
    user = request.state.user  # already verified by middleware
    entry = {
        "email": user.get("email"),
        "sub": user.get("sub"),
        "name": user.get("name"),
        "agreed_to_terms": True,
        "terms_version": TERMS_VERSION,
        "ip": request.client.host,
        "timestamp": datetime.now(timezone.utc),
    }

    result = await consent_collection.insert_one(entry)
    return {"success": True, "id": str(result.inserted_id)}