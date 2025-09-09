import React, { useState, useEffect } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { chatAPI, charactersAPI } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar';
import { resolveImageUrl, getCharacterPrimaryImage } from '../../lib/images';
import { Button } from '../ui/button';
import { MessageSquare, Plus, Home, Star, User, History, UserCog, LogOut, Settings, Gem, BookOpen, LogIn, UserPlus } from 'lucide-react';
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
import LoginRequiredModal from '../LoginRequiredModal';
import LoginModal from '../LoginModal';

const Sidebar = () => {
  const [chatRooms, setChatRooms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [characterImageById, setCharacterImageById] = useState({});
  const [showPersonaModal, setShowPersonaModal] = useState(false);
  const { user, logout, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const [showLoginRequired, setShowLoginRequired] = useState(false);
  const [showLoginModal, setShowLoginModal] = useState(false);

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

  const loadRooms = async () => {
    try {
      setLoading(true);
      const response = await chatAPI.getChatRooms();
      const rooms = response.data || [];
      setChatRooms(rooms);

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
        setCharacterImageById(Object.fromEntries(entries));
      }
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
      setChatRooms([]);
      setLoading(false);
    }
  }, [isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated) return;
    const handler = () => loadRooms();
    try { window.addEventListener('chat:roomsChanged', handler); } catch (_) {}
    return () => {
      try { window.removeEventListener('chat:roomsChanged', handler); } catch (_) {}
    };
  }, [isAuthenticated]);

  const NavItem = ({ to, icon: Icon, children, requireAuth = false }) => (
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
        if (requireAuth && !isAuthenticated) {
          e.preventDefault();
          setShowLoginModal(true);
        }
      }}
    >
      <Icon className="w-5 h-5 mr-3" />
      <span>{children}</span>
    </NavLink>
  );

  return (
    <aside className="w-64 bg-gray-800 border-r border-gray-700 flex flex-col">
      {/* 로고 영역 */}
      <div className="p-4 border-b border-gray-700">
        <Link to="/" className="flex items-center space-x-2">
          <MessageSquare className="w-8 h-8 text-purple-500" />
          <h1 className="text-xl font-bold text-white">AI Chat</h1>
        </Link>
      </div>

      {/* Create 버튼 */}
      <div className="px-4 pb-2 pt-2">
        <Link
          to="/characters/create"
          onClick={(e) => {
            if (!isAuthenticated) {
              e.preventDefault();
              setShowLoginModal(true);
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
          to="/story-importer"
          onClick={(e) => {
            if (!isAuthenticated) {
              e.preventDefault();
              setShowLoginModal(true);
            }
          }}
          className="flex items-center justify-center w-full px-4 py-2.5 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors font-medium text-sm"
        >
          <BookOpen className="w-5 h-5 mr-2" />
          소설로 생성
        </Link>
      </div>

      {/* 메인 네비게이션 */}
      <nav className="flex-1 space-y-1">
        <NavItem to="/" icon={Home}>탐색</NavItem>
        <NavItem to="/my-characters" icon={Star} requireAuth>내 캐릭터</NavItem>
        <button
          onClick={() => {
            if (!isAuthenticated) { setShowLoginModal(true); return; }
            setShowPersonaModal(true);
          }}
          className="flex items-center w-full px-4 py-2 text-sm font-medium rounded-lg transition-colors text-gray-300 hover:bg-gray-700 hover:text-white"
        >
          <UserCog className="w-5 h-5 mr-3" />
          <span>유저 페르소나</span>
        </button>
        <NavItem to="/history" icon={History} requireAuth>대화내역</NavItem>
        
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
            ) : chatRooms.length > 0 ? (
              chatRooms.map(room => (
                <NavLink
                  key={room.id}
                  to={`/ws/chat/${room.character.id}`}
                  className={({ isActive }) =>
                    `flex items-center px-4 py-2 text-sm transition-colors rounded-lg ${
                      isActive
                        ? 'bg-purple-600 text-white'
                        : 'text-gray-300 hover:bg-gray-700 hover:text-white'
                    }`
                  }
                >
                  <Avatar className="w-8 h-8 mr-3 rounded-md">
                    <AvatarImage className="object-cover object-top" src={characterImageById[room.character.id] || getCharacterPrimaryImage(room.character)} />
                    <AvatarFallback className="bg-purple-600 text-white text-xs rounded-md">
                      {room.character.name.charAt(0)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0 flex items-center justify-between gap-2">
                    <span className="truncate">{room.character.name}</span>
                    {(room.last_message_time || room.updated_at || room.created_at) && (
                      <span className="text-xs text-gray-400 flex-shrink-0">
                        {formatRelativeTime(room.last_message_time || room.updated_at || room.created_at)}
                      </span>
                    )}
                  </div>
                </NavLink>
              ))
            ) : (
              <p className="px-4 text-sm text-gray-500">대화 내역이 없습니다</p>
            )}
          </div>
        </div>
      </nav>

      {/* 유저 프로필 / 게스트 CTA */}
      <div className="p-3 border-t border-gray-700">
        {isAuthenticated ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <div className="flex items-center space-x-3 px-1 cursor-pointer hover:bg-gray-700 rounded-lg py-2 transition-colors">
                <Avatar className="w-8 h-8">
                  <AvatarImage src={resolveImageUrl(user?.avatar_url)} alt={user?.username} />
                  <AvatarFallback className="bg-purple-600 text-white text-sm">
                    {user?.username?.charAt(0)?.toUpperCase() || 'U'}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-white truncate">{user?.username}</p>
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
              <DropdownMenuItem onClick={() => navigate('/profile')}>
                <User className="mr-2 h-4 w-4" />
                <span>마이페이지</span>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => navigate('/ruby/charge')}>
                <Gem className="mr-2 h-4 w-4 text-pink-500" />
                <span>루비 충전</span>
                <Badge className="ml-auto bg-pink-100 text-pink-800" variant="secondary">
                  0
                </Badge>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => navigate('/settings')}>
                <Settings className="mr-2 h-4 w-4" />
                <span>설정</span>
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
                <AvatarFallback className="bg-purple-600 text-white text-sm">G</AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-white truncate">Guest</p>
                <p className="text-xs text-gray-400">로그인이 필요합니다</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button className="bg-purple-600 hover:bg-purple-700 text-white" onClick={() => setShowLoginModal(true)}>
                <LogIn className="w-4 h-4 mr-2" /> 로그인
              </Button>
              <Button variant="outline" onClick={() => { setShowLoginModal(true); }}>
                <UserPlus className="w-4 h-4 mr-2" /> 회원가입
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* 유저 페르소나 관리 모달 */}
      <UserPersonaModal
        isOpen={showPersonaModal}
        onClose={() => setShowPersonaModal(false)}
      />

      {/* 로그인 유도 모달 */}
      <LoginRequiredModal
        isOpen={showLoginRequired}
        onClose={() => setShowLoginRequired(false)}
        onLogin={() => { setShowLoginRequired(false); navigate('/login?tab=login'); }}
        onRegister={() => { setShowLoginRequired(false); navigate('/login?tab=register'); }}
      />

      {/* 통합 로그인/회원가입 모달 */}
      <LoginModal isOpen={showLoginModal} onClose={() => setShowLoginModal(false)} />
    </aside>
  );
};

export default Sidebar; 