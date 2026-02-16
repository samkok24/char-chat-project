/**
 * 메인 App 컴포넌트
 * CAVEDUCK 스타일: 성능 최적화 (코드 스플리팅 + API 캐싱)
 */

import React, { Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { persistQueryClient } from '@tanstack/react-query-persist-client';
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { LoginModalProvider } from './contexts/LoginModalContext';
import { SocketProvider } from './contexts/SocketContext';
import { Loader2 } from 'lucide-react';
import './App.css';
import MediaEventsBridge from './components/MediaEventsBridge';
import ToastEventsBridge from './components/ToastEventsBridge';
import PresenceHeartbeatBridge from './components/PresenceHeartbeatBridge';
import PostLoginRedirectBridge from './components/PostLoginRedirectBridge';
import TrafficEventsBridge from './components/TrafficEventsBridge';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1 * 60 * 1000, // 5분 → 1분 (너무 길면 변경사항 안 보임)
      gcTime: 10 * 60 * 1000, // 메모리 캐시는 유지
      retry: 1,
      refetchOnWindowFocus: true, // false → true (포커스 시 갱신)
      refetchOnReconnect: true, // false → true (재연결 시 갱신)
      refetchOnMount: 'always', // false → true (마운트 시 갱신, staleTime 체크함)
    },
  },
});

// React Query 캐시 영속화(localStorage)
try {
  // ✅ 인앱(WebView) 방어: localStorage 접근이 SecurityError로 터지는 환경이 있다.
  // - 영속화는 "있으면 좋고, 없어도 앱이 살아야" 한다.
  const safeStorage = {
    getItem: (key) => {
      try { return window?.localStorage?.getItem(key); } catch (_) { return null; }
    },
    setItem: (key, value) => {
      try { window?.localStorage?.setItem(key, value); } catch (_) {}
    },
    removeItem: (key) => {
      try { window?.localStorage?.removeItem(key); } catch (_) {}
    },
  };
  const persister = createSyncStoragePersister({
    storage: safeStorage,
  });
  persistQueryClient({
    queryClient,
    persister,
    maxAge: 24 * 60 * 60 * 1000,
  });
} catch (_) {}

// 🚀 성능 최적화: 코드 스플리팅 (페이지별 동적 로딩)
const LoginPage = React.lazy(() => import('./pages/LoginPage'));
const HomePage = React.lazy(() => import('./pages/HomePage'));
const AgentPage = React.lazy(() => import('./pages/AgentPage'));
const AgentDrawerPage = React.lazy(() => import('./pages/AgentDrawerPage'));
const AgentFeedPage = React.lazy(() => import('./pages/AgentFeedPage'));
const ChatPage = React.lazy(() => import('./pages/ChatPage'));
const CharacterDetailPage = React.lazy(() => import('./pages/CharacterDetailPage'));
const ChatRedirectPage = React.lazy(() => import('./pages/ChatRedirectPage')); // 새로 추가
const VerifyPage = React.lazy(() => import('./pages/VerifyPage'));
const ResetPasswordPage = React.lazy(() => import('./pages/ResetPasswordPage'));
const ForgotPasswordPage = React.lazy(() => import('./pages/ForgotPasswordPage'));
const MaintenancePage = React.lazy(() => import('./pages/MaintenancePage'));
const ContactPage = React.lazy(() => import('./pages/ContactPage'));
const FAQPage = React.lazy(() => import('./pages/FAQPage'));
const NoticePage = React.lazy(() => import('./pages/NoticePage'));
const CMSPage = React.lazy(() => import('./pages/CMSPage'));

// ⏳ 나중에 필요한 페이지들 (지연 로딩)
const ProfilePage = React.lazy(() => import('./pages/ProfilePage'));
const RubyChargePage = React.lazy(() => import('./pages/RubyChargePage'));
const CreateCharacterPage = React.lazy(() => import('./pages/CreateCharacterPage'));
const MyCharactersPage = React.lazy(() => import('./pages/MyCharactersPage'));
const StoryImporterPage = React.lazy(() => import('./pages/StoryImporterPage'));
const ChatHistoryPage = React.lazy(() => import('./pages/ChatHistoryPage'));
const FavoritesPage = React.lazy(() => import('./pages/FavoritesPage'));
const FavoriteStoriesPage = React.lazy(() => import('./pages/FavoriteStoriesPage'));
// 레거시 works 상세 페이지는 사용하지 않음 (stories로 이동)
// const WorkDetailPage = React.lazy(() => import('./pages/WorkDetailPage'));
const WorkCreatePage = React.lazy(() => import('./pages/WorkCreatePage'));
const StoryDetailPage = React.lazy(() => import('./pages/StoryDetailPage'));
const StoryEditPage = React.lazy(() => import('./pages/StoryEditPage'));
const ChapterReaderPage = React.lazy(() => import('./pages/ChapterReaderPage'));
const CreatorInfoPage = React.lazy(() => import('./pages/CreatorInfoPage'));
const MetricsSummaryPage = React.lazy(() => import('./pages/MetricsSummaryPage'));
const StoryDiveNovelPage = React.lazy(() => import('./pages/StoryDiveNovelPage'));

// 로딩 컴포넌트 (CAVEDUCK 스타일 - 심플)
const PageLoader = () => (
  // ✅ 다크 테마 앱에서 라우트 전환 시 "하얀 화면" 플래시 방지
  <div className="min-h-screen bg-gray-900 text-gray-200 flex items-center justify-center">
    <div className="text-center">
      <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4 text-purple-400" />
      <p className="text-gray-400">페이지를 불러오는 중...</p>
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

  // 이미 로그인된 유저가 로그인 페이지에 접근하면 메인 탭(홈)으로 보낸다.
  return isAuthenticated ? <Navigate to="/dashboard" replace /> : children;
};

// 메인 앱 라우터
  const AppRouter = () => {
    return (
      <Router>
        <PostLoginRedirectBridge />
        <TrafficEventsBridge />
        <Suspense fallback={<PageLoader />}>
          <Routes>
          {/* 🔥 CAVEDUCK 핵심 페이지 (우선 로딩) */}
          {/* 초기 진입은 메인 탭(홈)으로 */}
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/agent" element={<AgentPage />} />
          <Route path="/agent/drawer" element={<AgentDrawerPage />} />
          <Route path="/agent/feed" element={<AgentFeedPage />} />
          {/* 대시보드 별도 경로 */}
          <Route path="/dashboard" element={<HomePage />} />

          <Route
            path="/login"
            element={
              <PublicRoute>
                <LoginPage />
              </PublicRoute>
            }
          />

          <Route path="/verify" element={<VerifyPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          <Route path="/maintenance" element={<MaintenancePage />} />
          <Route path="/contact" element={<ContactPage />} />
          <Route path="/faq" element={<FAQPage />} />
          <Route path="/notices" element={<NoticePage />} />
          <Route path="/notices/:noticeId" element={<NoticePage />} />
          <Route path="/cms" element={<ProtectedRoute><CMSPage /></ProtectedRoute>} />

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
          {/* 게스트도 진입은 가능(전송 시 로그인 요구는 ChatPage에서 처리) */}
          <Route path="/ws/chat/:characterId" element={<ChatPage />} />

          {/* 🏊 스토리 다이브 라우트 */}
          <Route path="/storydive/novels/:novelId" element={<ProtectedRoute><StoryDiveNovelPage /></ProtectedRoute>} />

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
            path="/favorites"
            element={
              <ProtectedRoute>
                <FavoritesPage />
              </ProtectedRoute>
            }
          />

          <Route
            path="/favorites/stories"
            element={
              <ProtectedRoute>
                <FavoriteStoriesPage />
              </ProtectedRoute>
            }
          />

          {/* 📚 레거시 works 라우트 → 스토리 상세로 리다이렉트 */}
          <Route path="/works/:workId" element={<Navigate to="/stories/:workId" replace />} />
          <Route path="/works/:workId/chapters/:chapterNumber" element={<Navigate to="/stories/:workId/chapters/:chapterNumber" replace />} />
          <Route
            path="/works/create"
            element={
              <ProtectedRoute>
                <WorkCreatePage />
              </ProtectedRoute>
            }
          />
          <Route path="/stories/:storyId" element={<StoryDetailPage />} />
          <Route path="/stories/:storyId/chapters/:chapterNumber" element={<ChapterReaderPage />} />
          {/* 개발용 메트릭 요약(네비에서 숨김) */}
          <Route path="/metrics/summary" element={<ProtectedRoute><MetricsSummaryPage /></ProtectedRoute>} />
          <Route
            path="/stories/:storyId/edit"
            element={
              <ProtectedRoute>
                <StoryEditPage />
              </ProtectedRoute>
            }
          />

          <Route
            path="/users/:userId"
            element={<ProfilePage />}
          />
          <Route
            path="/users/:userId/creator"
            element={<CreatorInfoPage />}
          />

          <Route
            path="/story-importer"
            element={
              <ProtectedRoute>
                <StoryImporterPage />
              </ProtectedRoute>
            }
          />

          {/* 기본 리다이렉트: 메인 탭(홈) */}
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
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
        <LoginModalProvider>
          <SocketProvider>
            <div className="App">
              <MediaEventsBridge />
              <ToastEventsBridge />
              <PresenceHeartbeatBridge />
              <AppRouter />
            </div>
          </SocketProvider>
        </LoginModalProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;

