import { useSelector, useDispatch } from 'react-redux';
import { setUser, clearUser } from '../features/user/userSlice';

export const useUser = () => {
  const user = useSelector(state => state.user.user);
  const dispatch = useDispatch();

  return {
    user,
    setUser: (data) => dispatch(setUser(data)),
    clearUser: () => dispatch(clearUser()),
  };
};