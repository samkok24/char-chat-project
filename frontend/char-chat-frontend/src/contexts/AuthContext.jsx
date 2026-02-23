/**
 * 인증 컨텍스트
 */

import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { authAPI, usersAPI } from '../lib/api';

const AuthContext = createContext();

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [profileVersion, setProfileVersion] = useState(Date.now());
  // ✅ 멀티탭 동기화용 ref (stale closure 방지)
  const userRef = useRef(null);
  const isAuthenticatedRef = useRef(false);
  const syncInFlightRef = useRef(false);
  const lastSyncAtRef = useRef(0);

  useEffect(() => { userRef.current = user; }, [user]);
  useEffect(() => { isAuthenticatedRef.current = isAuthenticated; }, [isAuthenticated]);

  // 초기 로드 시 토큰 확인
  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    try {
      const token = localStorage.getItem('access_token');
      if (!token) {
        setLoading(false);
        return;
      }

      const response = await authAPI.getMe();
      setUser(response.data);
      setIsAuthenticated(true);
    } catch (error) {
      console.error('인증 확인 실패:', error);
      const status = error?.response?.status;
      const detail = error?.response?.data?.detail;
      const isNotAuthenticated = (status === 403) && /not\s+authenticated/i.test(String(detail || ''));
      // 네트워크/서버 일시 오류(타임아웃, CORS 미적용, ERR_EMPTY_RESPONSE 등)에서는 토큰을 보존
      if (status === 401 || isNotAuthenticated) {
        localStorage.removeItem('access_token');
        localStorage.removeItem('refresh_token');
        setUser(null);
        setIsAuthenticated(false);
      }
    } finally {
      setLoading(false);
    }
  };

  /**
   * ✅ 멀티 탭 로그인 동기화(중요)
   *
   * 문제:
   * - 한 탭에서 로그아웃/토큰 갱신이 일어나도, 다른 탭은 React state가 그대로라
   *   "겉보기 로그인"인데 실제 요청/소켓만 깨지는 애매한 상태가 될 수 있다.
   *
   * 해결(최소 수정/방어적):
   * - localStorage(access_token/refresh_token) 변경을 다른 탭에서 감지하여 즉시 state를 동기화한다.
   * - access_token이 바뀌면, 기존 SocketContext 로직을 그대로 재사용하기 위해 auth:tokenRefreshed 이벤트를 발생시킨다.
   * - 토큰이 제거되면 auth:loggedOut 이벤트를 발생시켜 소켓을 정리한다.
   */
  useEffect(() => {
    const isNotAuthenticatedDetail = (detailLike) => {
      try { return /not\s+authenticated/i.test(String(detailLike || '')); } catch (_) { return false; }
    };

    const clearLocalTokens = () => {
      try { localStorage.removeItem('access_token'); } catch (_) {}
      try { localStorage.removeItem('refresh_token'); } catch (_) {}
    };

    const handleLoggedOutByOtherTab = () => {
      setUser(null);
      setIsAuthenticated(false);
      try { window.dispatchEvent(new Event('auth:loggedOut')); } catch (_) {}
    };

    const onStorage = (e) => {
      try {
        if (!e) return;
        const k = String(e.key || '');
        if (k !== 'access_token' && k !== 'refresh_token') return;

        const at = localStorage.getItem('access_token');
        const rt = localStorage.getItem('refresh_token');

        // ✅ 토큰이 사라졌으면(다른 탭 로그아웃/리프레시 실패) 즉시 로그아웃 상태로 동기화
        if (!at || !rt) {
          handleLoggedOutByOtherTab();
          return;
        }

        // ✅ access_token이 갱신/로그인으로 변경되면 소켓 인증도 같이 갱신(기존 이벤트 재사용)
        if (k === 'access_token' && e.newValue) {
          try {
            window.dispatchEvent(new CustomEvent('auth:tokenRefreshed', { detail: { access_token: e.newValue, refresh_token: rt } }));
          } catch (_) {}
        }

        // ✅ 다른 탭에서 로그인된 경우: 이 탭 UI도 유저 정보를 즉시 로드하여 로그인 상태로 동기화
        const needsUserSync = !isAuthenticatedRef.current || !userRef.current;
        if (!needsUserSync) return;

        // 과도한 동기화 호출 방지(토큰 2개가 연속으로 set 되는 케이스)
        const now = Date.now();
        if (syncInFlightRef.current) return;
        if (now - (lastSyncAtRef.current || 0) < 800) return;
        lastSyncAtRef.current = now;
        syncInFlightRef.current = true;

        Promise.resolve(authAPI.getMe())
          .then((res) => {
            setUser(res.data);
            setIsAuthenticated(true);
          })
          .catch((error) => {
            console.error('[AuthContext] 멀티탭 인증 동기화 실패:', error);
            const status = error?.response?.status;
            const detail = error?.response?.data?.detail;
            const isNotAuth = (status === 403) && isNotAuthenticatedDetail(detail);
            if (status === 401 || isNotAuth) {
              // ✅ 토큰이 실제로 무효면 정리(애매한 상태 방지)
              clearLocalTokens();
              handleLoggedOutByOtherTab();
            }
          })
          .finally(() => {
            syncInFlightRef.current = false;
          });
      } catch (err) {
        console.error('[AuthContext] storage sync handler failed:', err);
      }
    };

    try {
      window.addEventListener('storage', onStorage);
      return () => window.removeEventListener('storage', onStorage);
    } catch (_) {
      return undefined;
    }
  }, []);

  const login = async (email, password) => {
    try {
      const response = await authAPI.login(email, password);
      const { access_token, refresh_token } = response.data;

      localStorage.setItem('access_token', access_token);
      localStorage.setItem('refresh_token', refresh_token);

      // 사용자 정보 가져오기
      const userResponse = await authAPI.getMe();
      setUser(userResponse.data);
      setIsAuthenticated(true);

      return { success: true };
    } catch (error) {
      console.error('로그인 실패:', error);
      return {
        success: false,
        error: error.response?.data?.detail || '로그인에 실패했습니다.',
      };
    }
  };

  const register = async (email, username, password, gender) => {
    try {
      const response = await authAPI.register(email, username, password, gender);
      
      // 회원가입 성공 후 자동 로그인 시도
      const loginResult = await login(email, password);
      if (loginResult.success) {
        return { success: true };
      } else {
        // 로그인 실패 시에도 회원가입은 성공했으므로 성공으로 처리
        return { success: true };
      }
    } catch (error) {
      console.error('회원가입 실패:', error);
      return {
        success: false,
        error: error.response?.data?.detail || '회원가입에 실패했습니다.',
      };
    }
  };

  const logout = async () => {
    try {
      await authAPI.logout();
    } catch (error) {
      console.error('로그아웃 API 호출 실패:', error);
    } finally {
      localStorage.removeItem('access_token');
      localStorage.removeItem('refresh_token');
      setUser(null);
      setIsAuthenticated(false);
      
      // 로그아웃 후 강제 리다이렉트
      window.location.href = '/';
    }
  };

  const refreshProfileVersion = () => {
    setProfileVersion(Date.now());
  };

  /**
   * 사용자 프로필 업데이트 (닉네임, 아바타, bio)
   * 낙관적 업데이트로 즉시 UI 반영
   */
  const updateUserProfile = async (updates) => {
    if (!user || !user.id) {
      return {
        success: false,
        error: '로그인이 필요합니다.',
      };
    }

    // 이전 상태 백업 (롤백용)
    const previousUser = { ...user };

    try {
      // 낙관적 업데이트: UI 즉시 반영
      setUser(prev => ({ ...prev, ...updates }));
      
      // 프로필 버전 갱신 (다른 컴포넌트에 변경 알림)
      refreshProfileVersion();

      // 서버에 업데이트 요청
      await usersAPI.updateUserProfile(user.id, updates);

      return { success: true };
    } catch (error) {
      console.error('프로필 업데이트 실패:', error);
      
      // 에러 시 이전 상태로 롤백
      setUser(previousUser);
      
      return {
        success: false,
        error: error.response?.data?.detail || '프로필 업데이트에 실패했습니다.',
      };
    }
  };

  const value = {
    user,
    loading,
    isAuthenticated,
    profileVersion,
    refreshProfileVersion,
    login,
    register,
    logout,
    checkAuth,
    updateUserProfile,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

