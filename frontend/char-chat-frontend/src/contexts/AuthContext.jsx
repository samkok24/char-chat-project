/**
 * 인증 컨텍스트
 */

import React, { createContext, useContext, useState, useEffect } from 'react';
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

