/**
 * 메인 App 컴포넌트
 * CAVEDUCK 스타일: 성능 최적화 (코드 스플리팅 + API 캐싱)
 */

import React, { Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { SocketProvider } from './contexts/SocketContext';
import { Loader2 } from 'lucide-react';
import './App.css';

// 🚀 API 캐싱 설정 (성능 최적화)
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000, // 5분간 캐시 유지
      cacheTime: 10 * 60 * 1000, // 10분간 메모리에 보관
      retry: 1, // 실패 시 1번만 재시도
      refetchOnWindowFocus: false, // 윈도우 포커스 시 재요청 방지
    },
  },
});

// 🚀 성능 최적화: 코드 스플리팅 (페이지별 동적 로딩)
const LoginPage = React.lazy(() => import('./pages/LoginPage'));
const HomePage = React.lazy(() => import('./pages/HomePage'));
const ChatPage = React.lazy(() => import('./pages/ChatPage'));
const CharacterDetailPage = React.lazy(() => import('./pages/CharacterDetailPage'));
const ChatRedirectPage = React.lazy(() => import('./pages/ChatRedirectPage')); // 새로 추가

// ⏳ 나중에 필요한 페이지들 (지연 로딩)
const ProfilePage = React.lazy(() => import('./pages/ProfilePage'));
const RubyChargePage = React.lazy(() => import('./pages/RubyChargePage'));
const CreateCharacterPage = React.lazy(() => import('./pages/CreateCharacterPage'));
const MyCharactersPage = React.lazy(() => import('./pages/MyCharactersPage'));
const StoryImporterPage = React.lazy(() => import('./pages/StoryImporterPage'));
const ChatHistoryPage = React.lazy(() => import('./pages/ChatHistoryPage'));

// 로딩 컴포넌트 (CAVEDUCK 스타일 - 심플)
const PageLoader = () => (
  <div className="min-h-screen bg-gray-50 flex items-center justify-center">
    <div className="text-center">
      <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4 text-purple-600" />
      <p className="text-gray-600">페이지를 불러오는 중...</p>
    </div>
  </div>
);

// 인증이 필요한 라우트를 보호하는 컴포넌트
const ProtectedRoute = ({ children }) => {
  const { isAuthenticated, loading } = useAuth();

  if (loading) {
    return <PageLoader />;
  }

  return isAuthenticated ? children : <Navigate to="/login" replace />;
};

// 인증된 사용자는 접근할 수 없는 라우트 (로그인)
const PublicRoute = ({ children }) => {
  const { isAuthenticated, loading } = useAuth();

  if (loading) {
    return <PageLoader />;
  }

  return isAuthenticated ? <Navigate to="/" replace /> : children;
};

// 메인 앱 라우터
const AppRouter = () => {
  return (
    <Router>
      <Suspense fallback={<PageLoader />}>
        <Routes>
          {/* 🔥 CAVEDUCK 핵심 페이지 (우선 로딩) */}
          <Route
            path="/"
            element={
              <SocketProvider>
                <HomePage />
              </SocketProvider>
            }
          />

          <Route
            path="/login"
            element={
              <PublicRoute>
                <LoginPage />
              </PublicRoute>
            }
          />

          <Route
            path="/characters/:characterId"
            element={<CharacterDetailPage />}
          />

          {/* 사용자가 '대화하기'를 눌렀을 때도 상세 페이지를 먼저 보여줌 */}
          <Route
            path="/chat/:characterId"
            element={<ChatRedirectPage />}
          />
          
          {/* 실제 웹소켓 채팅이 이루어지는 페이지 */}
          <Route
            path="/ws/chat/:characterId"
            element={
              <ProtectedRoute>
                <SocketProvider>
                  <ChatPage />
                </SocketProvider>
              </ProtectedRoute>
            }
          />

          {/* ⏳ 나중에 필요한 페이지들 (지연 로딩) */}
          <Route
            path="/profile"
            element={
              <ProtectedRoute>
                <ProfilePage />
              </ProtectedRoute>
            }
          />

          <Route
            path="/ruby/charge"
            element={
              <ProtectedRoute>
                <RubyChargePage />
              </ProtectedRoute>
            }
          />

          <Route
            path="/characters/create"
            element={
              <ProtectedRoute>
                <CreateCharacterPage />
              </ProtectedRoute>
            }
          />

          <Route
            path="/history"
            element={
              <ProtectedRoute>
                <ChatHistoryPage />
              </ProtectedRoute>
            }
          />

          <Route
            path="/characters/:characterId/edit"
            element={
              <ProtectedRoute>
                <CreateCharacterPage />
              </ProtectedRoute>
            }
          />

          <Route
            path="/my-characters"
            element={
              <ProtectedRoute>
                <MyCharactersPage />
              </ProtectedRoute>
            }
          />

          <Route
            path="/users/:userId"
            element={<ProfilePage />}
          />

          <Route
            path="/story-importer"
            element={
              <ProtectedRoute>
                <StoryImporterPage />
              </ProtectedRoute>
            }
          />

          {/* 기본 리다이렉트 */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </Router>
  );
};

// 메인 App 컴포넌트
function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <div className="App">
          <AppRouter />
        </div>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;

