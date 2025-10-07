/**
 * 인증 컨텍스트
 */

import React, { createContext, useContext, useState, useEffect } from 'react';
import { authAPI } from '../lib/api';

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
      // 네트워크/서버 일시 오류(타임아웃, CORS 미적용, ERR_EMPTY_RESPONSE 등)에서는 토큰을 보존
      if (status === 401 || status === 403) {
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
      
      // 회원가입 완료 → 인증 안내 페이지로 이동하도록 신호 반환
      return { success: true };
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
    }
  };

  const refreshProfileVersion = () => {
    setProfileVersion(Date.now());
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
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

