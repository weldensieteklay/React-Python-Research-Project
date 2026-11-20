import { useEffect } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useUser } from '../hooks/useUser';
import { isSessionValid } from '../auth/session';

// Shows the page only to a signed-in user whose token hasn't expired.
// Anyone else goes to the login page, which returns them here after they sign in.
const ProtectedRoute = ({ children }) => {
    const { user, clearUser } = useUser();
    const location = useLocation();
    const valid = isSessionValid(user);

    // A stored user whose token has expired: sign them out
    useEffect(() => {
        if (user && !valid) clearUser();
    }, [user, valid, clearUser]);

    if (!valid) {
        return (
            <Navigate
                to="/"
                replace
                state={{ sessionExpired: Boolean(user), from: location.pathname }}
            />
        );
    }
    return children;
};

export default ProtectedRoute;
