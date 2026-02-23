import { useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useLoginModal } from '../contexts/LoginModalContext';

const useRequireAuth = () => {
  const { isAuthenticated } = useAuth();
  const { openLoginModal } = useLoginModal();

  return useCallback(
    (reason = '') => {
      if (isAuthenticated) return true;
      openLoginModal({ reason });
      return false;
    },
    [isAuthenticated, openLoginModal]
  );
};

export default useRequireAuth;


