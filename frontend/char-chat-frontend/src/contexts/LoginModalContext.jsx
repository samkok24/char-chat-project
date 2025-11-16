import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import LoginModal from '../components/LoginModal';

const LoginModalContext = createContext(null);

export const LoginModalProvider = ({ children }) => {
  const [modalState, setModalState] = useState({
    isOpen: false,
    initialTab: 'login',
    reason: '',
  });

  const openLoginModal = useCallback((options = {}) => {
    setModalState({
      isOpen: true,
      initialTab: options.initialTab || 'login',
      reason: options.reason || '',
    });
  }, []);

  const closeLoginModal = useCallback(() => {
    setModalState((prev) => ({ ...prev, isOpen: false }));
  }, []);

  useEffect(() => {
    const handler = (event) => {
      const detail = event?.detail || {};
      openLoginModal(detail);
    };
    try {
      window.addEventListener('auth:required', handler);
      return () => window.removeEventListener('auth:required', handler);
    } catch (_) {
      return undefined;
    }
  }, [openLoginModal]);

  const contextValue = useMemo(
    () => ({
      openLoginModal,
      closeLoginModal,
    }),
    [openLoginModal, closeLoginModal]
  );

  return (
    <LoginModalContext.Provider value={contextValue}>
      {children}
      <LoginModal
        isOpen={modalState.isOpen}
        onClose={closeLoginModal}
        initialTab={modalState.initialTab}
      />
    </LoginModalContext.Provider>
  );
};

export const useLoginModal = () => {
  const context = useContext(LoginModalContext);
  if (!context) {
    throw new Error('useLoginModal must be used within a LoginModalProvider');
  }
  return context;
};


