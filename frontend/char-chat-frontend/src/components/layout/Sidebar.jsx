import React, { useState, useEffect } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { chatAPI } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar';
import { Button } from '../ui/button';
import { MessageSquare, Plus, Home, Star, User, History, UserCog, LogOut, Settings, Gem } from 'lucide-react';
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

const Sidebar = () => {
  const [chatRooms, setChatRooms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showPersonaModal, setShowPersonaModal] = useState(false);
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/');
  };

  useEffect(() => {
    const fetchChatRooms = async () => {
      try {
        setLoading(true);
        const response = await chatAPI.getChatRooms();
        setChatRooms(response.data);
      } catch (error) {
        console.error('채팅방 목록을 불러오는데 실패했습니다.', error);
      } finally {
        setLoading(false);
      }
    };
    fetchChatRooms();
  }, []);

  const NavItem = ({ to, icon: Icon, children }) => (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `flex items-center px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
          isActive
            ? 'bg-purple-600 text-white'
            : 'text-gray-300 hover:bg-gray-700 hover:text-white'
        }`
      }
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
      <div className="px-4 pb-4 pt-2">
        <Link
          to="/characters/create"
          className="flex items-center justify-center w-full px-4 py-2.5 bg-purple-600 hover:bg-purple-700 text-white rounded-lg transition-colors font-medium text-sm shadow-lg"
        >
          <Plus className="w-5 h-5 mr-2" />
          캐릭터 생성
        </Link>
      </div>

      {/* 메인 네비게이션 */}
      <nav className="flex-1 space-y-1">
        <NavItem to="/" icon={Home}>탐색</NavItem>
        <NavItem to="/my-characters" icon={Star}>내 캐릭터</NavItem>
        <button
          onClick={() => setShowPersonaModal(true)}
          className="flex items-center w-full px-4 py-2 text-sm font-medium rounded-lg transition-colors text-gray-300 hover:bg-gray-700 hover:text-white"
        >
          <UserCog className="w-5 h-5 mr-3" />
          <span>유저 페르소나</span>
        </button>
        <NavItem to="/history" icon={History}>대화내역</NavItem>
        
        <div className="px-3 pt-4">
          <p className="px-1 text-xs text-gray-500 mb-2">A While Ago</p>
          <div className="space-y-1">
            {loading ? (
              Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="flex items-center space-x-3 px-4 py-2">
                  <Skeleton className="h-8 w-8 rounded-full" />
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
                  <Avatar className="w-8 h-8 mr-3">
                    <AvatarImage src={room.character.avatar_url} />
                    <AvatarFallback className="bg-purple-600 text-white text-xs">
                      {room.character.name.charAt(0)}
                    </AvatarFallback>
                  </Avatar>
                  <span className="truncate">{room.character.name}</span>
                </NavLink>
              ))
            ) : (
              <p className="px-4 text-sm text-gray-500">대화 내역이 없습니다</p>
            )}
          </div>
        </div>
      </nav>

      {/* 유저 프로필 */}
      <div className="p-3 border-t border-gray-700">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <div className="flex items-center space-x-3 px-1 cursor-pointer hover:bg-gray-700 rounded-lg py-2 transition-colors">
              <Avatar className="w-8 h-8">
                <AvatarImage src={user?.avatar_url} alt={user?.username} />
                <AvatarFallback className="bg-purple-600 text-white text-sm">
                  {user?.username?.charAt(0)?.toUpperCase() || 'G'}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-white truncate">{user?.username || 'Guest'}</p>
              </div>
            </div>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-56" align="start" side="top">
            <DropdownMenuLabel className="font-normal">
              <div className="flex flex-col space-y-1">
                <p className="text-sm font-medium leading-none">{user?.username || 'Guest'}</p>
                <p className="text-xs leading-none text-muted-foreground">
                  {user?.email || 'guest@example.com'}
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