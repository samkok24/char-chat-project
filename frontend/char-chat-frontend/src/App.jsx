/**
 * 메인 App 컴포넌트
 */

import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { SocketProvider } from './contexts/SocketContext';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import HomePage from './pages/HomePage';
import ChatPage from './pages/ChatPage';
import ProfilePage from './pages/ProfilePage';
import RubyChargePage from './pages/RubyChargePage';
import CreateCharacterPage from './pages/CreateCharacterPage';
import MyCharactersPage from './pages/MyCharactersPage';
import CharacterDetailPage from './pages/CharacterDetailPage';
import { Loader2 } from 'lucide-react';
import './App.css';

// 인증이 필요한 라우트를 보호하는 컴포넌트
const ProtectedRoute = ({ children }) => {
  const { isAuthenticated, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4" />
          <p className="text-gray-600">로딩 중...</p>
        </div>
      </div>
    );
  }

  return isAuthenticated ? children : <Navigate to="/login" replace />;
};

// 인증된 사용자는 접근할 수 없는 라우트 (로그인, 회원가입)
const PublicRoute = ({ children }) => {
  const { isAuthenticated, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4" />
          <p className="text-gray-600">로딩 중...</p>
        </div>
      </div>
    );
  }

  return isAuthenticated ? <Navigate to="/" replace /> : children;
};

// 메인 앱 라우터
const AppRouter = () => {
  return (
    <Router>
      <Routes>
        {/* 메인 홈페이지 - 누구나 접근 가능 */}
        <Route
          path="/"
          element={
            <SocketProvider>
              <HomePage />
            </SocketProvider>
          }
        />

        {/* 인증 관련 라우트 */}
        <Route
          path="/login"
          element={
            <PublicRoute>
              <LoginPage />
            </PublicRoute>
          }
        />
        <Route
          path="/register"
          element={
            <PublicRoute>
              <RegisterPage />
            </PublicRoute>
          }
        />

        {/* 보호된 라우트 - 프로필 */}
        <Route
          path="/profile"
          element={
            <ProtectedRoute>
              <ProfilePage />
            </ProtectedRoute>
          }
        />

        {/* 보호된 라우트 - 루비 충전 */}
        <Route
          path="/ruby/charge"
          element={
            <ProtectedRoute>
              <RubyChargePage />
            </ProtectedRoute>
          }
        />

        {/* 보호된 라우트 - 캐릭터 생성 */}
        <Route
          path="/characters/create"
          element={
            <ProtectedRoute>
              <CreateCharacterPage />
            </ProtectedRoute>
          }
        />

        {/* 보호된 라우트 - 내 캐릭터 */}
        <Route
          path="/my-characters"
          element={
            <ProtectedRoute>
              <MyCharactersPage />
            </ProtectedRoute>
          }
        />

        {/* 캐릭터 상세 페이지 - 누구나 접근 가능 */}
        <Route
          path="/characters/:characterId"
          element={<CharacterDetailPage />}
        />

        {/* 보호된 라우트 - 채팅 */}
        <Route
          path="/chat/:characterId"
          element={
            <ProtectedRoute>
              <SocketProvider>
                <ChatPage />
              </SocketProvider>
            </ProtectedRoute>
          }
        />

        {/* 기본 리다이렉트 */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Router>
  );
};

// 메인 App 컴포넌트
function App() {
  return (
    <AuthProvider>
      <div className="App">
        <AppRouter />
      </div>
    </AuthProvider>
  );
}

export default App;

