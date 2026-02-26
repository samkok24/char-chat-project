import React, { useState, useEffect } from 'react';
import { Link, NavLink, useNavigate, useLocation } from 'react-router-dom';
import { usersAPI, storiesAPI, pointAPI } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar';
import { resolveImageUrl, getCharacterPrimaryImage } from '../../lib/images';
import { getReadingProgress, getReadingProgressAt } from '../../lib/reading';
import { Button } from '../ui/button';
import { MessageSquare, Home, Star, Heart, User, History, Sparkles, UserCog, LogOut, BookOpen, LogIn, HelpCircle, Bell, Settings, Loader2, ChevronLeft, ChevronRight, Gem, Timer } from 'lucide-react';
import { Skeleton } from '../ui/skeleton';
import { Badge } from '../ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';
import UserPersonaModal from '../UserPersonaModal';
import useRequireAuth from '../../hooks/useRequireAuth';
import { useLoginModal } from '../../contexts/LoginModalContext';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';
import { clearCreateCharacterDraft, hasCreateCharacterDraft } from '../../lib/createCharacterDraft';
import { getRoomsChangedActivity, shouldRefetchForRoomsChanged } from '../../lib/chatRoomsChangedEvent';

const Sidebar = ({ collapsed = false, onToggleCollapsed }) => {
  const [chatRooms, setChatRooms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [recentStories, setRecentStories] = useState([]);
  const [showPersonaModal, setShowPersonaModal] = useState(false);
  const { user, logout, isAuthenticated } = useAuth();
  const activeUserId = React.useMemo(() => String(user?.id || '').trim(), [user?.id]);
  const prevUserIdRef = React.useRef('');
  const navigate = useNavigate();
  const location = useLocation();
  const [avatarVersion, setAvatarVersion] = useState(Date.now());
  const requireAuth = useRequireAuth();
  const { openLoginModal } = useLoginModal();
  const [draftPromptOpen, setDraftPromptOpen] = useState(false);
  const [rubyBalance, setRubyBalance] = useState(null);
  const [timerCurrent, setTimerCurrent] = useState(0);
  const [timerMax, setTimerMax] = useState(15);

  // 루비 잔액 + 타이머 조회
  const loadRubyRef = React.useRef(null);
  useEffect(() => {
    if (!isAuthenticated) {
      setRubyBalance(null);
      setTimerCurrent(0);
      setTimerMax(15);
      return;
    }
    let mounted = true;
    const load = async () => {
      try {
        const [balRes, timerRes] = await Promise.allSettled([
          pointAPI.getBalance(),
          pointAPI.getTimerStatus(),
        ]);
        if (!mounted) return;
        if (balRes.status === 'fulfilled') {
          setRubyBalance(Number(balRes.value?.data?.balance ?? 0));
        } else {
          // balance 실패 시 기존 값 유지, 초기값만 안전하게 0으로 채움
          setRubyBalance((prev) => (prev === null ? 0 : prev));
        }
        if (timerRes.status === 'fulfilled') {
          setTimerCurrent(Number(timerRes.value?.data?.current ?? 0));
          setTimerMax(Number(timerRes.value?.data?.max ?? 15));
        }
      } catch { /* best-effort */ }
    };
    loadRubyRef.current = load;
    load();
    const intervalId = setInterval(load, 60 * 1000);
    return () => {
      mounted = false;
      clearInterval(intervalId);
    };
  }, [isAuthenticated]);

  // 출석체크 등으로 잔액 변경 시 즉시 동기화
  useEffect(() => {
    const handler = () => { try { loadRubyRef.current?.(); } catch {} };
    window.addEventListener('ruby:balanceChanged', handler);
    return () => window.removeEventListener('ruby:balanceChanged', handler);
  }, []);

  const handleDraftStartFresh = React.useCallback(() => {
    /**
     * ✅ 사이드바: 임시저장 초안이 있을 때 "새로 만들기"
     *
     * 의도/원리:
     * - 초안을 삭제하고 캐릭터 생성 페이지로 이동한다.
     */
    try { clearCreateCharacterDraft(); } catch (_) {}
    try { setDraftPromptOpen(false); } catch (_) {}
    try { navigate('/characters/create'); } catch (_) {}
  }, [navigate]);

  const handleDraftLoad = React.useCallback(() => {
    /**
     * ✅ 사이드바: 임시저장 초안이 있을 때 "불러오기"
     *
     * 의도/원리:
     * - 초안을 유지한 채 캐릭터 생성 페이지로 이동한다.
     * - 실제 복원은 CreateCharacterPage의 복원 로직이 담당한다(SSOT).
     */
    try { setDraftPromptOpen(false); } catch (_) {}
    try { navigate('/characters/create'); } catch (_) {}
  }, [navigate]);

  const formatRelativeTime = (iso) => {
    try {
      const then = new Date(iso);
      const now = new Date();
      const diffMs = now - then;
      if (isNaN(diffMs)) return '';
      const sec = Math.floor(diffMs / 1000);
      if (sec < 60) return '방금전';
      const min = Math.floor(sec / 60);
      if (min < 60) return `${min}분 전`;
      const hr = Math.floor(min / 60);
      if (hr < 24) return `${hr}시간 전`;
      const day = Math.floor(hr / 24);
      return `${day}일 전`;
    } catch (_) { return ''; }
  };

  const patchChatRoomsForActivity = React.useCallback((rooms, activity) => {
    const list = Array.isArray(rooms) ? rooms : [];
    const roomId = String(activity?.roomId || '').trim();
    if (!roomId) return { next: list, changed: false };
    const updatedAt = String(activity?.updatedAt || '').trim() || new Date().toISOString();
    const snippet = String(activity?.snippet || '').trim();
    let changed = false;
    const next = list.map((room) => {
      if (String(room?.id || '').trim() !== roomId) return room;
      changed = true;
      return {
        ...(room || {}),
        updated_at: updatedAt,
        last_message_time: updatedAt,
        ...(snippet ? { last_message_snippet: snippet } : {}),
      };
    });
    if (!changed) return { next: list, changed: false };
    next.sort((a, b) => {
      const at = new Date(a?.last_message_time || a?.updated_at || a?.created_at || 0).getTime() || 0;
      const bt = new Date(b?.last_message_time || b?.updated_at || b?.created_at || 0).getTime() || 0;
      return bt - at;
    });
    return { next, changed: true };
  }, []);

  const handleLogout = () => {
    logout();
    navigate('/');
  };

  const loadRecentStories = async () => {
    // 최근 본 웹소설: localStorage 키 스캔 후 존재하는 스토리만 로드
    try {
      const keys = Object.keys(localStorage || {}).filter(k => k.startsWith('reader_progress:'));
      const pairs = keys.map(k => {
        const id = k.replace('reader_progress:', '');
        return { id, lastNo: getReadingProgress(id), at: getReadingProgressAt(id) };
      });
      // 최근 시각 순으로 정렬 후 최대 8개
      const ids = pairs.sort((a,b) => (b.at||0) - (a.at||0)).slice(0, 8).map(p => p.id);
      const stories = await Promise.all(ids.map(async (id) => {
        try {
          const res = await storiesAPI.getStory(id);
          return res.data;
        } catch(_) { return null; }
      }));
      const list = stories.filter(Boolean).map(s => ({
        id: s.id,
        title: s.title,
        cover_url: s.cover_url,
        last_no: getReadingProgress(s.id),
        at: getReadingProgressAt(s.id)
      }));
      setRecentStories(list);
      return list;
    } catch(_) {
      setRecentStories([]);
      return [];
    }
  };

  // 캐시 설정
  // ✅ 계정별 캐시 분리: 계정 전환 시 다른 유저 히스토리가 섞여 보이는 문제 방지
  const CACHE_KEY = React.useMemo(
    () => `sidebar:chatRooms:cache:${activeUserId || 'guest'}`,
    [activeUserId]
  );
  const CACHE_DURATION = 5 * 60 * 1000; // 5분 

  const loadRooms = async (forceRefresh = false) => {
    try {
      /**
       * ✅ 사이드바 히스토리 로딩 정책(안전/UX):
       * - 최초 로딩(표시할 데이터가 아직 0개)일 때만 Skeleton을 보여준다.
       * - 이후 갱신(이벤트로 재조회)은 기존 리스트를 유지하고, 상단에 작은 로딩 표시만 노출한다.
       */
      const hasAnyData = (Array.isArray(chatRooms) && chatRooms.length > 0) || (Array.isArray(recentStories) && recentStories.length > 0);
      const isInitial = !hasAnyData;

      // 캐시 확인 (강제 새로고침이 아닐 때만)
      if (!forceRefresh) {
        try {
          const cached = localStorage.getItem(CACHE_KEY);
          if (cached) {
            const { data, timestamp } = JSON.parse(cached);
            const age = Date.now() - timestamp;
            
            // 5분 이내 캐시는 그대로 사용
            if (age < CACHE_DURATION && data.rooms) {
              setChatRooms(data.rooms);
              if (Array.isArray(data.recentStories)) setRecentStories(data.recentStories);
              setLoading(false);
              setRefreshing(false);
              return; // API 호출 스킵
            }
          }
        } catch (_) {}
      }
      if (isInitial) setLoading(true);
      else setRefreshing(true);

      // ✅ 대화내역(HistoryPage)과 동일한 SSOT 사용: /me/characters/recent
      // - 기존 chat/rooms + meta + character 상세 N+1 호출을 제거해 사이드바 체감 속도를 개선한다.
      const response = await usersAPI.getRecentCharacters({ limit: 15, page: 1 });
      const recent = Array.isArray(response?.data) ? response.data : [];
      const rooms = recent
        .map((item) => {
          const roomId = String(item?.chat_room_id || '').trim();
          const charId = String(item?.id || '').trim();
          if (!roomId || !charId) return null;
          const ts = String(item?.last_chat_time || item?.created_at || '').trim();
          return {
            id: roomId,
            character: {
              id: charId,
              name: item?.name || '캐릭터',
              avatar_url: item?.avatar_url || null,
              origin_story_id: item?.origin_story_id || null,
              creator_id: item?.creator_id || null,
              is_public: (item?.is_public !== false),
              image_descriptions: Array.isArray(item?.image_descriptions) ? item.image_descriptions : [],
            },
            last_message_time: ts || null,
            updated_at: ts || null,
            created_at: ts || null,
          };
        })
        .filter(Boolean);
      setChatRooms(rooms);
      
      const recentList = await loadRecentStories();
      
      // 캐시 저장
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify({
          data: {
            rooms,
            recentStories: recentList,
          },
          timestamp: Date.now()
        }));
      } catch (_) {}
      
    } catch (error) {
      console.error('채팅방 목록을 불러오는데 실패했습니다.', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    if (isAuthenticated) {
      // 인증 직후 user가 아직 hydrate되지 않은 틈에 이전 계정 목록이 보이는 현상 방지
      if (!activeUserId) {
        setLoading(true);
        setChatRooms([]);
        return;
      }
      const userChanged = !!prevUserIdRef.current && prevUserIdRef.current !== activeUserId;
      prevUserIdRef.current = activeUserId;
      if (userChanged) {
        setChatRooms([]);
      }
      loadRooms(userChanged);
    } else {
      prevUserIdRef.current = '';
      // 비로그인 상태에서도 최근 본 웹소설은 노출
      (async () => {
        try {
          setLoading(true);
          setChatRooms([]);
          await loadRecentStories();
        } finally {
          setLoading(false);
        }
      })();
    }
  }, [isAuthenticated, activeUserId]);

  // 프로필 업데이트 신호 수신 시 즉시 리렌더/리로드 (디바운스 적용)
  useEffect(() => {
    let debounceTimer = null;
    const onProfileUpdated = () => {
      setAvatarVersion(Date.now());
      // 디바운스: 1초 내 여러 번 호출되어도 마지막 호출만 실행
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
      try { loadRooms(); } catch (_) {}
      }, 1000);
    };
    try { window.addEventListener('profile:updated', onProfileUpdated); } catch (_) {}
    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      try { window.removeEventListener('profile:updated', onProfileUpdated); } catch (_) {}
    };
  }, [isAuthenticated]);

  // 로컬스토리지 변경 시(다른 탭 등) 최근 웹소설 갱신 (디바운스 적용)
  useEffect(() => {
    let debounceTimer = null;
    const onStorage = (e) => {
      if (!e) return;
      if (typeof e.key === 'string' && (e.key.startsWith('reader_progress:') || e.key.startsWith('reader_progress_at:'))) {
        // 디바운스: 1초 내 여러 번 호출되어도 마지막 호출만 실행
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
        loadRecentStories();
        }, 1000);
      }
    };
    try { window.addEventListener('storage', onStorage); } catch(_) {}
    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      try { window.removeEventListener('storage', onStorage); } catch(_) {}
    };
  }, []);

  useEffect(() => {
    if (!isAuthenticated) return;
    let suppressOnce = false;
    let debounceTimer = null;
    let missRefetchTimer = null;
    let missRefetchInFlight = false;
    const scheduleMissRefetch = () => {
      if (missRefetchInFlight) return;
      if (missRefetchTimer) clearTimeout(missRefetchTimer);
      missRefetchTimer = setTimeout(async () => {
        if (missRefetchInFlight) return;
        missRefetchInFlight = true;
        try { await loadRooms(true); } catch (_) {}
        missRefetchInFlight = false;
      }, 500);
    };
    const handler = (evt) => {
      if (suppressOnce) { suppressOnce = false; return; }
      const activity = getRoomsChangedActivity(evt);
      if (activity) {
        let changed = false;
        setChatRooms((prev) => {
          const result = patchChatRoomsForActivity(prev, activity);
          changed = Boolean(result?.changed);
          return result?.next || prev;
        });
        if (!changed) scheduleMissRefetch();
        return;
      }
      if (!shouldRefetchForRoomsChanged(evt)) return;
      // 디바운스: 2초 내 여러 번 호출되어도 마지막 호출만 실행
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
      loadRooms(true); // 강제 새로고침 (캐시 무시)
      }, 2000);
    };
    const handlerSuppress = () => { suppressOnce = true; };
    try { window.addEventListener('chat:roomsChanged', handler); } catch (_) {}
    try { window.addEventListener('chat:roomsChanged:suppressOnce', handlerSuppress); } catch (_) {}
    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      if (missRefetchTimer) clearTimeout(missRefetchTimer);
      try { window.removeEventListener('chat:roomsChanged', handler); } catch (_) {}
      try { window.removeEventListener('chat:roomsChanged:suppressOnce', handlerSuppress); } catch (_) {}
    };
  }, [isAuthenticated, patchChatRoomsForActivity]);

  const NavItem = ({ to, icon: Icon, children, requireAuth: mustAuth = false, authReason }) => (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `flex items-center ${collapsed ? 'justify-center px-2' : 'px-4'} py-2 text-sm font-medium rounded-lg transition-colors ${
          isActive
            ? 'bg-purple-600 text-white'
            : 'text-gray-300 hover:bg-gray-700 hover:text-white'
        }`
      }
      aria-label={String(children)}
      title={String(children)}
      onClick={(e) => {
        if (mustAuth && !requireAuth(authReason || String(children))) {
          e.preventDefault();
        }
      }}
    >
      <Icon className={`w-5 h-5 ${collapsed ? '' : 'mr-3'}`} />
      {!collapsed ? <span>{children}</span> : null}
    </NavLink>
  );

  return (
    <aside className={`${collapsed ? 'w-16' : 'w-64'} bg-gray-800 border-r border-gray-700 flex flex-col h-full min-h-0 transition-[width] duration-200 ease-linear`}>
      {/* ✅ (요구사항) 반응형 전용: 토글 버튼은 노출하지 않는다 */}
      {/* 로고 영역 */}
      <div className={`${collapsed ? 'pt-3 pb-3' : 'p-4'} flex items-center justify-center`}>
        <Link to="/" className="flex items-center justify-center w-full">
          {/* public/brand-logo.png */}
          {!collapsed ? (
            <>
              <img
                src="/brand-logo.png"
                alt="브랜드 로고"
                // ✅ 크롭 없이(=전체 로고 노출) 가운데 정렬 + 사이드바에서 충분히 크게 보이도록 높이를 키운다.
                // 현재 로고 파일이 정사각형이라 width를 크게 줘도 비율상 height 기준으로 스케일된다.
                className="h-34 w-auto max-w-[180px] object-contain object-center"
                onError={(e) => {
                  // 방어적 처리: 로고가 없거나 경로가 틀려도 UI가 깨지지 않게 한다.
                  e.currentTarget.style.display = 'none';
                  const fallback = e.currentTarget.nextElementSibling;
                  if (fallback) fallback.style.display = 'block';
                }}
              />
              {/* 로고 로드 실패 시에만 표시되는 fallback 아이콘(기본 hidden) */}
              <MessageSquare className="w-10 h-10 text-purple-500 hidden" aria-hidden="true" />
            </>
          ) : (
            <MessageSquare className="w-9 h-9 text-purple-400" aria-hidden="true" />
          )}
        </Link>
      </div>

      {/* Create 버튼 */}
      {!collapsed ? (
        <>
          <div className="px-4 pb-4 pt-2">
            <Link
              to="/works/create"
              onClick={(e) => {
                if (!requireAuth('원작 쓰기')) {
                  e.preventDefault();
                }
              }}
              className="flex items-center justify-center w-full px-4 py-2.5 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors font-medium text-sm"
            >
              <BookOpen className="w-5 h-5 mr-2" />
              웹소설 원작 쓰기
            </Link>
          </div>
        </>
      ) : (
        <div className="px-2 pb-4 pt-1">
          <Link
            to="/works/create"
            onClick={(e) => {
              if (!requireAuth('원작 쓰기')) {
                e.preventDefault();
              }
            }}
            className="h-10 w-10 mx-auto flex items-center justify-center rounded-lg bg-gray-700 hover:bg-gray-600 text-white transition-colors"
            aria-label="웹소설 원작 쓰기"
            title="웹소설 원작 쓰기"
          >
            <BookOpen className="w-5 h-5" />
          </Link>
        </div>
      )}

      {/* 메인 네비게이션 */}
      <nav className="flex-1 min-h-0 space-y-1 overflow-y-auto overscroll-contain scrollbar-dark">
        <NavItem to="/dashboard" icon={Home}>홈</NavItem>
        <NavItem to="/favorites/stories" icon={Heart} requireAuth authReason="선호작">선호작</NavItem>
        <NavItem to="/agent" icon={Sparkles} requireAuth authReason="스토리 에이전트">스토리 에이전트</NavItem>

        {/* 로그인 시에만 표시되는 메뉴들 */}
        {isAuthenticated && (
          <>
            <NavItem to="/my-characters" icon={Star}>내 캐릭터</NavItem>
        <button
              onClick={() => setShowPersonaModal(true)}
          className={`flex items-center w-full ${collapsed ? 'justify-center px-2' : 'px-4'} py-2 text-sm font-medium rounded-lg transition-colors text-gray-300 hover:bg-gray-700 hover:text-white`}
          aria-label="유저 페르소나"
          title="유저 페르소나"
        >
          <UserCog className={`w-5 h-5 ${collapsed ? '' : 'mr-3'}`} />
          {!collapsed ? <span>유저 페르소나</span> : null}
        </button>
            <NavItem to="/history" icon={History}>대화내역</NavItem>

            {/* 구독/루비 카드 */}
            <NavLink
              to="/ruby/charge"
              className={({ isActive }) =>
                `block ${collapsed ? 'px-1' : 'px-3'} mt-2`
              }
              aria-label="루비 충전"
              title="루비 충전"
            >
              {collapsed ? (
                <div className="flex flex-col items-center gap-0.5 py-2 rounded-lg bg-gray-700/50 hover:bg-gray-700 transition-colors">
                  <Gem className="w-5 h-5 text-pink-400" />
                  <span className="text-[10px] text-pink-400 font-bold">{rubyBalance !== null ? rubyBalance.toLocaleString() : '...'}</span>
                </div>
              ) : (
                <div className="rounded-xl bg-gradient-to-r from-purple-900/40 to-pink-900/30 border border-purple-500/30 p-3 hover:border-purple-500/50 transition-colors">
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-1.5">
                      <Gem className="w-4 h-4 text-pink-400" />
                      <span className="text-sm font-semibold text-white">루비</span>
                    </div>
                    <span className="text-sm font-bold text-pink-400">{rubyBalance !== null ? rubyBalance.toLocaleString() : '...'}</span>
                  </div>
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-1 text-[11px] text-gray-400">
                      <Timer className="w-3 h-3 text-purple-400" />
                      <span>{timerCurrent}/{timerMax} (+1개/2시간)</span>
                    </div>
                    <span className="text-[11px] text-purple-400 font-medium">충전하기</span>
                  </div>
                  <div className="w-full h-1.5 bg-gray-700 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-purple-500 to-blue-500 rounded-full transition-all"
                      style={{ width: `${timerMax > 0 ? (timerCurrent / timerMax) * 100 : 0}%` }}
                    />
                  </div>
                </div>
              )}
            </NavLink>
          </>
        )}
        
        {/* A While Ago - 로그인 시에만 표시 */}
        {isAuthenticated && !collapsed && (
        <div className="px-3 pt-4">
          <div className="flex items-center justify-between px-1 mb-2">
            <p className="text-xs text-gray-500">히스토리</p>
            {refreshing ? (
              <div className="flex items-center gap-1 text-[11px] text-gray-500">
                <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" />
                <span>갱신중</span>
              </div>
            ) : null}
          </div>
          <div className="space-y-1">
            {(loading && (!Array.isArray(chatRooms) || chatRooms.length === 0)) ? (
              Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="flex items-center space-x-3 px-4 py-2">
                  <Skeleton className="h-8 w-8 rounded-md" />
                  <Skeleton className="h-4 w-32" />
                </div>
              ))
            ) : (
              (() => {
                /**
                 * ✅ 히스토리는 "캐릭터 단위"가 아니라 "채팅방(룸) 단위"로 보여야 한다.
                 *
                 * 요구사항:
                 * - 같은 캐릭터와 밥 대화/술 대화처럼 '새로대화'로 생성된 방이 여러 개면
                 *   히스토리/최근대화/대화내역에서 모두 병존해야 한다.
                 *
                 * 기존 문제:
                 * - 캐릭터별로 최신 룸 1개로 dedupe 하면서, 새로대화 룸이 사라져 보였다.
                 */
                const chatItems = (chatRooms || [])
                  .filter((room) => Boolean(room?.id) && Boolean(room?.character?.id))
                  .map((room) => {
                  const isOrig = !!(room?.character?.origin_story_id);
                  const suffix = '';
                  // ✅ 비공개 캐릭터 접근 차단(요구사항)
                  // - 히스토리에 남아있더라도, 크리에이터가 비공개로 바꾸면 클릭 진입을 막고 토스트만 보여준다.
                  let blocked = false;
                  try {
                    const isPublic = (room?.character?.is_public !== false);
                    const creatorId = String(room?.character?.creator_id || '').trim();
                    const isAdmin = !!user?.is_admin;
                    const isCreator = !!creatorId && String(user?.id || '') === creatorId;
                    blocked = (!isPublic && !isAdmin && !isCreator);
                  } catch (_) {
                    blocked = false;
                  }
                  return ({
                    kind: 'chat',
                    id: room.id,
                    title: `${room.character?.name || '캐릭터'}${suffix}`,
                    thumb: getCharacterPrimaryImage(room.character || {}),
                    at: new Date(room.last_message_time || room.updated_at || room.created_at || 0).getTime() || 0,
                    href: (() => {
                      // ✅ 원작챗 캐릭터는 origchat plain 모드로 진입하도록 쿼리를 보강한다.
                      // - room을 유지하면 "정확히 그 방"으로 이어하기가 가능하다.
                      const usp = new URLSearchParams();
                      usp.set('room', String(room.id));
                      const sid = String(room?.character?.origin_story_id || '').trim();
                      if (sid) {
                        usp.set('source', 'origchat');
                        usp.set('storyId', sid);
                        usp.set('mode', 'plain');
                      }
                      return `/ws/chat/${room.character?.id}?${usp.toString()}`;
                    })(),
                    is_origchat: isOrig,
                    blocked,
                  });
                });
                const storyItems = (recentStories || []).map((s) => ({
                  kind: 'story',
                  id: s.id,
                  title: s.title,
                  thumb: resolveImageUrl(s.cover_url),
                  at: s.at || 0,
                  href: `/stories/${s.id}/chapters/${Math.max(1, Number(s.last_no) || 1)}`,
                  badge: `${Math.max(1, Number(s.last_no) || 1)}화`,
                }));
                const mixed = [...chatItems, ...storyItems].sort((a,b) => (b.at||0) - (a.at||0));
                if (mixed.length === 0) {
                  return <p className="px-4 text-sm text-gray-500">최근 항목이 없습니다</p>;
                }
                // 최대 5개만 노출하여 사이드바 오버플로우로 인한 레이아웃 깨짐 방지
                return mixed.slice(0, 5).map((item) => (
                  <Link
                    key={`${item.kind}-${item.id}`}
                    to={item.href}
                    onClick={(e) => {
                      try {
                        if (item.kind === 'chat' && item.blocked) {
                          e.preventDefault();
                          window.dispatchEvent(new CustomEvent('toast', { detail: { type: 'error', message: '크리에이터가 비공개한 캐릭터입니다.' } }));
                        }
                      } catch (_) {}
                    }}
                    className={(() => {
                      /**
                       * ✅ 히스토리(룸) Active 판별 버그 수정
                       *
                       * 문제:
                       * - NavLink의 isActive는 기본적으로 pathname 기준이라, 같은 캐릭터(/ws/chat/:id)로 만든
                       *   서로 다른 room(쿼리)들이 동시에 active로 찍힐 수 있다.
                       *
                       * 해결:
                       * - 룸 단위는 "pathname + search(room=...)"까지 포함해 정확히 1개만 active 처리한다.
                       */
                      const blocked = (item.kind === 'chat' && item.blocked);
                      const current = `${location.pathname}${location.search || ''}`;
                      const isActiveExact = Boolean(item.href && current === String(item.href));
                      return `flex items-center px-4 py-2 text-sm transition-colors rounded-lg ${
                        blocked
                          ? 'text-gray-500 cursor-not-allowed opacity-60'
                          : (isActiveExact ? 'bg-purple-600 text-white' : 'text-gray-300 hover:bg-gray-700 hover:text-white')
                      }`;
                    })()}
                  >
                    <Avatar className="w-8 h-8 mr-3 rounded-md">
                      <AvatarImage className="object-cover object-top" src={item.thumb} />
                      <AvatarFallback className={`${item.kind==='story' ? 'bg-blue-600' : (item.is_origchat ? 'bg-orange-500' : 'bg-purple-600')} text-white text-xs rounded-md`}>
                        {item.kind==='story' ? '웹' : (item.is_origchat ? '원' : (item.title?.charAt(0) || 'C'))}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0 flex items-center justify-between gap-2">
                      <span className="truncate">{item.title}</span>
                      <span className="text-xs text-gray-400 flex-shrink-0">{item.kind==='story' ? item.badge : formatRelativeTime(item.at)}</span>
                    </div>
                  </Link>
                ));
              })()
            )}
          </div>
        </div>
        )}
      </nav>

      {/* 유저 프로필 / 게스트 CTA */}
      <div className="p-3 border-t border-gray-700">
        {isAuthenticated ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <div className={`flex items-center ${collapsed ? 'justify-center' : 'space-x-3'} px-1 cursor-pointer hover:bg-gray-700 rounded-lg py-2 transition-colors`}>
                <Avatar className="w-8 h-8">
                  <AvatarImage src={resolveImageUrl(user?.avatar_url ? `${user.avatar_url}${user.avatar_url.includes('?') ? '&' : '?'}v=${avatarVersion}` : '')} alt={user?.username} />
                  <AvatarFallback className="bg-purple-600 text-white text-sm">
                    {user?.username?.charAt(0)?.toUpperCase() || 'U'}
                  </AvatarFallback>
                </Avatar>
                {!collapsed ? (
                  <div className="flex-1 min-w-0 flex items-center gap-2">
                    <p className="text-sm font-medium text-white truncate">{user?.username}</p>
                    {user?.is_admin && (
                      <Badge className="text-xs px-1.5 py-0 bg-yellow-600 hover:bg-yellow-600 text-white font-semibold">
                        관리자
                      </Badge>
                    )}
                  </div>
                ) : null}
              </div>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-56 bg-gray-900 text-gray-100 border border-gray-700" align="start" side="top">
              <DropdownMenuLabel className="font-normal">
                <div className="flex flex-col space-y-1">
                  <p className="text-sm font-medium leading-none text-gray-100">{user?.username}</p>
                  <p className="text-xs leading-none text-gray-400">
                    {user?.email}
                  </p>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => navigate('/notices')}>
                <Bell className="mr-2 h-4 w-4" />
                <span>공지사항</span>
              </DropdownMenuItem>
              {user?.is_admin && (
                <DropdownMenuItem
                  onClick={() => {
                    try { window.open('/cms', '_blank', 'noopener,noreferrer'); }
                    catch (_) { navigate('/cms'); }
                  }}
                >
                  <Settings className="mr-2 h-4 w-4" />
                  <span>관리자페이지</span>
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={() => navigate('/profile')}>
                <User className="mr-2 h-4 w-4" />
                <span>마이페이지</span>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => navigate('/faq')}>
                <HelpCircle className="mr-2 h-4 w-4" />
                <span>FAQ</span>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => navigate('/contact')}>
                <MessageSquare className="mr-2 h-4 w-4" />
                <span>1:1 문의</span>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleLogout} className="text-red-400">
                <LogOut className="mr-2 h-4 w-4" />
                <span>로그아웃</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <div className="px-1 py-2">
            <div className="flex items-center space-x-3 mb-3">
              <Avatar className="w-8 h-8">
                <AvatarFallback className="bg-gray-600 text-white text-sm">G</AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-white truncate">Guest</p>
                <p className="text-xs text-gray-400">로그인이 필요합니다</p>
              </div>
            </div>
            <Button className="w-full bg-purple-600 hover:bg-purple-700 text-white" onClick={() => openLoginModal({ initialTab: 'login' })}>
                <LogIn className="w-4 h-4 mr-2" /> 로그인
              </Button>
          </div>
        )}
      </div>

      {/* 유저 페르소나 관리 모달 */}
      <UserPersonaModal
        isOpen={showPersonaModal}
        onClose={() => setShowPersonaModal(false)}
      />

      {/* ✅ 경쟁사 UX: 임시저장 불러오기 모달 (사이드바에서 표시) */}
      <Dialog open={draftPromptOpen} onOpenChange={setDraftPromptOpen}>
        <DialogContent className="bg-[#111111] border border-purple-500/70 text-white max-w-[340px] rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-center text-white text-base font-semibold">
              임시저장된 설정이 있는데
              <br />
              불러올까요?
            </DialogTitle>
          </DialogHeader>
          <div className="mt-2 space-y-3">
            <button
              type="button"
              onClick={handleDraftStartFresh}
              className="w-full h-11 rounded-md bg-gray-800 text-white font-semibold hover:bg-gray-700 transition-colors border border-gray-700/80"
            >
              새로 만들기
            </button>
            <button
              type="button"
              onClick={handleDraftLoad}
              className="w-full h-11 rounded-md bg-purple-600 text-white font-semibold hover:bg-purple-700 transition-colors"
            >
              불러오기
            </button>
            <button
              type="button"
              onClick={() => setDraftPromptOpen(false)}
              className="w-full h-11 rounded-md bg-gray-900/60 text-white font-semibold hover:bg-gray-900/80 transition-colors border border-gray-800/80"
            >
              취소
            </button>
          </div>
        </DialogContent>
      </Dialog>

    </aside>
  );
};

export default Sidebar; 
