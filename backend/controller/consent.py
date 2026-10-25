"""
Consent + access control (pilot phase).

Every Google sign-in calls POST /api/consent. It records consent (as before) and now also
reports whether the user may use the app:

    access = "granted"  subscribed is true and the free pilot hasn't ended
             "pending"  signed up, waiting for manual approval (the default for new users)
             "expired"  approved, but the pilot period is over
             "paused"   was approved before, then subscribed was set back to false

Approving a user = set  subscribed: true  on their document in MongoDB. Nothing else.
The pilot clock starts the first time an approved user signs in: access_granted_at is set
then, and trial_ends_at = access_granted_at + TRIAL_DAYS. To extend someone, set
trial_ends_at to a later date. Sign-in never changes `subscribed`, so a user can't approve
themselves.

Use require_active_access as a dependency on the data/model routes, AFTER the dependency
that verifies the Google token and sets request.state.user. The UI check alone can be
bypassed by calling the API directly.
"""
import math
import os
import time
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import HTTPException, Request, status
from pydantic import BaseModel, EmailStr
from pymongo import ReturnDocument

from db import consent_collection

TERMS_VERSION = "1.0"
TRIAL_DAYS = int(os.environ.get("TRIAL_DAYS", "60"))            # two-month pilot
ACCESS_CACHE_SECONDS = int(os.environ.get("ACCESS_CACHE_SECONDS", "60"))

MESSAGES = {
    "granted": "Access granted.",
    "pending": (
        "Thanks for signing up! Your access request is waiting for approval. "
        "We review new requests at the end of each day, so please check back tomorrow."
    ),
    "expired": "Your free pilot period has ended. Please contact us to continue using the app.",
    "paused": "Your access is currently paused. Please contact us if you think this is a mistake.",
}


class GoogleUserSchema(BaseModel):
    email: EmailStr
    sub: str
    name: Optional[str] = "Anonymous User"


# ─────────────────────────────────────────
# Access rules (one place, used by sign-in and by the route guard)
# ─────────────────────────────────────────

def _utc(dt):
    """MongoDB returns naive datetimes (in UTC) unless the client is tz_aware."""
    if dt is None:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def access_status(doc: Optional[dict], now: Optional[datetime] = None) -> dict:
    now = now or datetime.now(timezone.utc)
    doc = doc or {}
    subscribed = doc.get("subscribed") is True
    granted_at = _utc(doc.get("access_granted_at"))
    ends_at = _utc(doc.get("trial_ends_at"))

    if not subscribed:
        state = "paused" if granted_at else "pending"
    elif ends_at and now >= ends_at:
        state = "expired"
    else:
        state = "granted"

    days_left = None
    if state == "granted" and ends_at:
        # whole days remaining, rounded up: the first day of a 60-day pilot shows 60
        days_left = max(0, math.ceil((ends_at - now).total_seconds() / 86400))

    return {
        "access": state,
        "subscribed": subscribed,
        "access_granted_at": granted_at.isoformat() if granted_at else None,
        "trial_ends_at": ends_at.isoformat() if ends_at else None,
        "days_left": days_left,
        "message": MESSAGES[state],
    }


def _user_from_request(request: Request) -> GoogleUserSchema:
    user_state = getattr(request.state, "user", None)
    if not user_state:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Please sign in again.",
        )
    try:
        return GoogleUserSchema(**user_state)
    except Exception as e:
        print(f"[CONSENT ERROR] State validation failed against schema: {e}")
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Your sign-in details could not be read. Please sign in again.",
        )


async def _start_pilot_if_approved(doc: dict, now: datetime) -> dict:
    """First sign-in after approval: start the pilot clock. Only touches documents that are
    approved and have no end date yet, so it runs once per user."""
    if doc.get("subscribed") is not True or doc.get("trial_ends_at") is not None:
        return doc
    updated = await consent_collection.find_one_and_update(
        {"sub": doc["sub"], "subscribed": True, "trial_ends_at": None},
        {"$set": {
            "access_granted_at": _utc(doc.get("access_granted_at")) or now,
            "trial_ends_at": (_utc(doc.get("access_granted_at")) or now) + timedelta(days=TRIAL_DAYS),
        }},
        return_document=ReturnDocument.AFTER,
    )
    return updated or await consent_collection.find_one({"sub": doc["sub"]}) or doc


# ─────────────────────────────────────────
# POST /api/consent  (called on every sign-in)
# ─────────────────────────────────────────

async def record_consent(request: Request):
    """Record consent and the sign-in, and return the user's access status.
    Always 200 for a valid user, so the UI can show 'pending' or 'expired' screens."""
    user = _user_from_request(request)
    now = datetime.now(timezone.utc)

    update_payload = {
        "$set": {
            "email": user.email,
            "name": user.name,
            "agreed_to_terms": True,
            "terms_version": TERMS_VERSION,
            "ip": request.client.host if request.client else "unknown",
            "last_login_at": now,
        },
        "$inc": {"login_count": 1},
        # New users start without access. Never $set `subscribed` here: approval is manual.
        "$setOnInsert": {
            "created_at": now,
            "access_requested_at": now,
            "subscribed": False,
        },
    }

    try:
        doc = await consent_collection.find_one_and_update(
            {"sub": user.sub},
            update_payload,
            upsert=True,
            return_document=ReturnDocument.AFTER,
        )
        # Users created before access control existed have no `subscribed` field. Add it as
        # false (only when missing, so an approval you've made is never overwritten).
        if "subscribed" not in doc:
            doc = await consent_collection.find_one_and_update(
                {"sub": user.sub, "subscribed": {"$exists": False}},
                {"$set": {"subscribed": False, "access_requested_at": doc.get("created_at") or now}},
                return_document=ReturnDocument.AFTER,
            ) or await consent_collection.find_one({"sub": user.sub})
        doc = await _start_pilot_if_approved(doc, now)
    except Exception as e:
        print(f"[DATABASE ERROR] Failed to execute mongo consent write: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="We couldn't complete sign-in right now. Please try again in a minute.",
        )

    _cache.pop(user.sub, None)   # a fresh sign-in always re-reads the status
    status_info = access_status(doc, now)
    if status_info["access"] != "granted":
        print(f"[ACCESS] {user.email} signed in with access={status_info['access']}")

    return {
        "success": True,
        "id": str(doc.get("_id")),
        "email": user.email,
        **status_info,
    }


# ─────────────────────────────────────────
# Route guard for the data / model APIs
# ─────────────────────────────────────────

_cache: dict = {}   # sub -> (expires_at_monotonic, status_info); keeps Mongo reads to ~1/min/user


async def get_access(sub: str) -> dict:
    hit = _cache.get(sub)
    if hit and hit[0] > time.monotonic():
        return hit[1]
    doc = await consent_collection.find_one({"sub": sub})
    info = access_status(doc)
    _cache[sub] = (time.monotonic() + ACCESS_CACHE_SECONDS, info)
    return info


async def require_active_access(request: Request):
    """FastAPI dependency: 403 unless the signed-in user has access.
    Approving or revoking in MongoDB takes effect within ACCESS_CACHE_SECONDS."""
    user = _user_from_request(request)
    info = await get_access(user.sub)
    if info["access"] != "granted":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"code": f"access_{info['access']}", "message": info["message"]},
        )
    return info


# GET /api/access-status  (the "Check again" button; doesn't count as a sign-in)
async def access_status_endpoint(request: Request):
    user = _user_from_request(request)
    _cache.pop(user.sub, None)
    return {"email": user.email, **(await get_access(user.sub))}
