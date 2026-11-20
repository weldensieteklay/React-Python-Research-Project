// Helpers for checking whether the signed-in user's Google token is still usable.
//
// The user object is built in Home.jsx from jwtDecode(token), so it carries the token's
// `exp` claim (seconds since 1970) alongside `accessToken`.

// Treat the token as expired a little early, so a request isn't sent with a token
// that runs out while it's in flight.
const EARLY_MS = 30 * 1000;

// Name of the browser event any code can fire to end the session (see notifySessionExpired).
export const SESSION_EXPIRED_EVENT = "auth:session-expired";

/** When the token expires, in milliseconds, or null if the user has no expiry. */
export function tokenExpiresAt(user) {
    return typeof user?.exp === "number" ? user.exp * 1000 : null;
}

/** True when there is a signed-in user whose token hasn't expired. */
export function isSessionValid(user) {
    if (!user?.accessToken) return false;
    const expiresAt = tokenExpiresAt(user);
    return expiresAt === null || Date.now() < expiresAt - EARLY_MS;
}

/** Milliseconds until the session should end (0 if it already has). */
export function msUntilExpiry(user) {
    const expiresAt = tokenExpiresAt(user);
    if (expiresAt === null) return null;
    return Math.max(0, expiresAt - EARLY_MS - Date.now());
}

/**
 * Ends the session from anywhere: AuthWatcher signs the user out and opens the login page.
 * Axios 401 responses are handled automatically; call this yourself from code that uses
 * fetch(), for example in useFetchData when a response has status 401.
 */
export function notifySessionExpired() {
    window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
}
