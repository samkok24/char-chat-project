import React, { useState, useEffect } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { chatAPI, charactersAPI, storiesAPI } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar';
import { resolveImageUrl, getCharacterPrimaryImage } from '../../lib/images';
import { getReadingProgress, getReadingProgressAt } from '../../lib/reading';
import { Button } from '../ui/button';
import { MessageSquare, Plus, Home, Star, User, History, UserCog, LogOut, BookOpen, LogIn, HelpCircle, Bell, Settings } from 'lucide-react';
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

const Sidebar = () => {
  const [chatRooms, setChatRooms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [characterImageById, setCharacterImageById] = useState({});
  const [recentStories, setRecentStories] = useState([]);
  const [showPersonaModal, setShowPersonaModal] = useState(false);
  const { user, logout, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const [avatarVersion, setAvatarVersion] = useState(Date.now());
  const requireAuth = useRequireAuth();
  const { openLoginModal } = useLoginModal();

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

  const [roomMetaById, setRoomMetaById] = React.useState({});

  // 캐시 설정
  const CACHE_KEY = 'sidebar:chatRooms:cache';
  const CACHE_DURATION = 5 * 60 * 1000; // 5분 

  const loadRooms = async (forceRefresh = false) => {
    try {
      // 캐시 확인 (강제 새로고침이 아닐 때만)
      if (!forceRefresh) {
        try {
          const cached = localStorage.getItem(CACHE_KEY);
          if (cached) {
            const { data, timestamp } = JSON.parse(cached);
            const age = Date.now() - timestamp;
            
            // 5분 이내 캐시는 그대로 사용
            if (age < CACHE_DURATION && data.rooms && data.roomMetaById) {
              setChatRooms(data.rooms);
              setRoomMetaById(data.roomMetaById);
              setCharacterImageById(data.characterImageById || {});
              if (Array.isArray(data.recentStories)) setRecentStories(data.recentStories);
              setLoading(false);
              return; // API 호출 스킵
            }
          }
        } catch (_) {}
      }
      setLoading(true);
      // 백엔드에서 최근 50개만 가져오기
      const response = await chatAPI.getChatRooms({ limit: 50 });
      const rooms = response.data || [];
      setChatRooms(rooms);
      
      // 룸 메타 동시 조회(모드 파악용) - 모든 rooms에 대해 조회 (이미 50개로 제한됨)
      let metaById = {};
      try {
        const entries = await Promise.all(
          rooms.map(async (r) => {
            try {
              const res = await chatAPI.getRoomMeta(r.id);
              return [String(r.id), res?.data || {}];
            } catch (_) { return [String(r.id), {}]; }
          })
        );
        metaById = Object.fromEntries(entries);
        setRoomMetaById(metaById);
      } catch (_) {}

      let charImageById = {};
      const ids = Array.from(new Set(rooms.map(r => r?.character?.id).filter(Boolean)));
      if (ids.length) {
        const entries = await Promise.all(ids.map(async (id) => {
          try {
            const res = await charactersAPI.getCharacter(id);
            const url = getCharacterPrimaryImage(res.data);
            return [id, url];
          } catch (_) {
            return [id, ''];
          }
        }));
        charImageById = Object.fromEntries(entries);
        setCharacterImageById(charImageById);
      }
      
      const recentList = await loadRecentStories();
      
      // 캐시 저장
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify({
          data: {
            rooms,
            roomMetaById: metaById,
            characterImageById: charImageById,
            recentStories: recentList,
          },
          timestamp: Date.now()
        }));
      } catch (_) {}
      
    } catch (error) {
      console.error('채팅방 목록을 불러오는데 실패했습니다.', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isAuthenticated) {
      loadRooms();
    } else {
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
  }, [isAuthenticated]);

  // 프로필 업데이트 신호 수신 시 즉시 리렌더/리로드 (디바운스 적용)
  useEffect(() => {
    let debounceTimer = null;
    const onProfileUpdated = () => {
      setAvatarVersion(Date.now());
      try { setCharacterImageById(prev => ({ ...prev })); } catch (_) {}
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
    const handler = () => {
      if (suppressOnce) { suppressOnce = false; return; }
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
      try { window.removeEventListener('chat:roomsChanged', handler); } catch (_) {}
      try { window.removeEventListener('chat:roomsChanged:suppressOnce', handlerSuppress); } catch (_) {}
    };
  }, [isAuthenticated]);

  const NavItem = ({ to, icon: Icon, children, requireAuth: mustAuth = false, authReason }) => (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `flex items-center px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
          isActive
            ? 'bg-purple-600 text-white'
            : 'text-gray-300 hover:bg-gray-700 hover:text-white'
        }`
      }
      onClick={(e) => {
        if (mustAuth && !requireAuth(authReason || String(children))) {
          e.preventDefault();
        }
      }}
    >
      <Icon className="w-5 h-5 mr-3" />
      <span>{children}</span>
    </NavLink>
  );

  return (
    <aside className="w-64 bg-gray-800 border-r border-gray-700 flex flex-col h-full min-h-0">
      {/* 로고 영역 */}
      <div className="p-4 flex items-center justify-center">
        <Link to="/" className="flex items-center justify-center w-full">
          {/* public/brand-logo.png */}
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
        </Link>
      </div>

      {/* Create 버튼 */}
      <div className="px-4 pb-2 pt-2">
        <Link
          to="/characters/create"
          onClick={(e) => {
            if (!requireAuth('캐릭터 생성')) {
              e.preventDefault();
            }
          }}
          className="flex items-center justify-center w-full px-4 py-2.5 bg-purple-600 hover:bg-purple-700 text-white rounded-lg transition-colors font-medium text-sm shadow-lg"
        >
          <Plus className="w-5 h-5 mr-2" />
          캐릭터 생성
        </Link>
      </div>
      <div className="px-4 pb-4">
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
          원작 쓰기
        </Link>
      </div>

      {/* 메인 네비게이션 */}
      <nav className="flex-1 min-h-0 space-y-1 overflow-y-auto overscroll-contain">
        <NavItem to="/dashboard" icon={Home}>홈</NavItem>
        
        {/* 로그인 시에만 표시되는 메뉴들 */}
        {isAuthenticated && (
          <>
            <NavItem to="/my-characters" icon={Star}>내 캐릭터</NavItem>
        <button
              onClick={() => setShowPersonaModal(true)}
          className="flex items-center w-full px-4 py-2 text-sm font-medium rounded-lg transition-colors text-gray-300 hover:bg-gray-700 hover:text-white"
        >
          <UserCog className="w-5 h-5 mr-3" />
          <span>유저 페르소나</span>
        </button>
            <NavItem to="/history" icon={History}>대화내역</NavItem>
          </>
        )}
        
        {/* A While Ago - 로그인 시에만 표시 */}
        {isAuthenticated && (
        <div className="px-3 pt-4">
          <p className="px-1 text-xs text-gray-500 mb-2">A While Ago</p>
          <div className="space-y-1">
            {loading ? (
              Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="flex items-center space-x-3 px-4 py-2">
                  <Skeleton className="h-8 w-8 rounded-md" />
                  <Skeleton className="h-4 w-32" />
                </div>
              ))
            ) : (
              (() => {
                // 캐릭터별로 가장 최근 채팅방만 선택
                const roomsByCharacter = new Map();
                (chatRooms || []).forEach((room) => {
                  const charId = room?.character?.id;
                  if (!charId) return;
                  
                  const existing = roomsByCharacter.get(charId);
                  const roomTime = new Date(room.last_message_time || room.updated_at || room.created_at || 0).getTime();
                  const existingTime = existing ? new Date(existing.last_message_time || existing.updated_at || existing.created_at || 0).getTime() : 0;
                  
                  if (!existing || roomTime > existingTime) {
                    roomsByCharacter.set(charId, room);
                  }
                });

                const chatItems = Array.from(roomsByCharacter.values()).map((room) => {
                  const meta = roomMetaById[String(room.id)] || {};
                  const isOrig = !!(room?.character?.origin_story_id);
                  const rawMode = String(meta.mode || '').toLowerCase();
                  const mode = rawMode || (isOrig ? 'plain' : '');
                  const suffix = mode === 'parallel' ? ' (평행세계)'
                    : mode === 'canon' ? ' (원작대로)'
                    : mode === 'plain' ? ' (일대일)'
                    : '';
                  return ({
                    kind: 'chat',
                    id: room.id,
                    title: `${room.character?.name || '캐릭터'}${suffix}`,
                    thumb: characterImageById[room.character?.id] || getCharacterPrimaryImage(room.character || {}),
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
                  <NavLink
                    key={`${item.kind}-${item.id}`}
                    to={item.href}
                    className={({ isActive }) =>
                      `flex items-center px-4 py-2 text-sm transition-colors rounded-lg ${
                        isActive ? 'bg-purple-600 text-white' : 'text-gray-300 hover:bg-gray-700 hover:text-white'
                      }`
                    }
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
                  </NavLink>
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
              <div className="flex items-center space-x-3 px-1 cursor-pointer hover:bg-gray-700 rounded-lg py-2 transition-colors">
                <Avatar className="w-8 h-8">
                  <AvatarImage src={resolveImageUrl(user?.avatar_url ? `${user.avatar_url}${user.avatar_url.includes('?') ? '&' : '?'}v=${avatarVersion}` : '')} alt={user?.username} />
                  <AvatarFallback className="bg-purple-600 text-white text-sm">
                    {user?.username?.charAt(0)?.toUpperCase() || 'U'}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0 flex items-center gap-2">
                  <p className="text-sm font-medium text-white truncate">{user?.username}</p>
                  {user?.is_admin && (
                    <Badge className="text-xs px-1.5 py-0 bg-yellow-600 hover:bg-yellow-600 text-white font-semibold">
                      관리자
                    </Badge>
                  )}
                </div>
              </div>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-56" align="start" side="top">
              <DropdownMenuLabel className="font-normal">
                <div className="flex flex-col space-y-1">
                  <p className="text-sm font-medium leading-none">{user?.username}</p>
                  <p className="text-xs leading-none text-muted-foreground">
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
              <DropdownMenuItem onClick={handleLogout} className="text-red-600">
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

    </aside>
  );
};

export default Sidebar; 