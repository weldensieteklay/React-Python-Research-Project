from slowapi import Limiter

def get_google_user(request):
    user = getattr(request.state, "user", None)

    if user:
        # Google unique user ID
        return user["sub"]

    # Fallback (shouldn't happen because auth runs first)
    return request.client.host

limiter = Limiter(key_func=get_google_user)