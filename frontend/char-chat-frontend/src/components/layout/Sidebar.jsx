import React, { useState, useEffect } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { chatAPI } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar';
import { Button } from '../ui/button';
import { MessageSquare, Plus, Home, Star, User } from 'lucide-react';
import { Skeleton } from '../ui/skeleton';

const Sidebar = () => {
  const [chatRooms, setChatRooms] = useState([]);
  const [loading, setLoading] = useState(true);
  const { user, logout } = useAuth();

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
        `flex items-center px-4 py-2 text-sm font-medium rounded-md transition-colors ${
          isActive
            ? 'bg-purple-100 text-purple-700'
            : 'text-gray-600 hover:bg-gray-100'
        }`
      }
    >
      <Icon className="w-5 h-5 mr-3" />
      <span>{children}</span>
    </NavLink>
  );

  return (
    <aside className="w-64 bg-white border-r flex flex-col">
      <div className="p-4 border-b">
        <Link to="/" className="flex items-center space-x-2">
          <MessageSquare className="w-8 h-8 text-purple-600" />
          <h1 className="text-xl font-bold">AI Chat</h1>
        </Link>
      </div>

      <nav className="flex-1 p-4 space-y-2">
        <NavItem to="/" icon={Home}>홈</NavItem>
        <NavItem to="/my-characters" icon={Star}>내 캐릭터</NavItem>
        
        <div className="pt-4">
          <h2 className="px-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">최근 대화</h2>
          <div className="mt-2 space-y-1">
            {loading ? (
              Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="flex items-center space-x-3 px-4 py-2">
                  <Skeleton className="h-8 w-8 rounded-full" />
                  <Skeleton className="h-4 w-32" />
                </div>
              ))
            ) : (
              chatRooms.map(room => (
                <NavLink
                  key={room.id}
                  to={`/chat/${room.character.id}`}
                  className={({ isActive }) =>
                    `flex items-center px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                      isActive
                        ? 'bg-purple-100 text-purple-700'
                        : 'text-gray-600 hover:bg-gray-100'
                    }`
                  }
                >
                  <Avatar className="w-8 h-8 mr-3">
                    <AvatarImage src={room.character.avatar_url} />
                    <AvatarFallback>{room.character.name.charAt(0)}</AvatarFallback>
                  </Avatar>
                  <span className="truncate">{room.character.name}</span>
                </NavLink>
              ))
            )}
          </div>
        </div>
      </nav>

      <div className="p-4 border-t">
         <div className="flex items-center space-x-3">
            <Avatar>
                <AvatarFallback>{user?.username?.charAt(0)}</AvatarFallback>
            </Avatar>
            <div className="flex-1 truncate">
                <p className="font-semibold text-sm">{user?.username}</p>
                <button onClick={logout} className="text-xs text-gray-500 hover:text-purple-600">로그아웃</button>
            </div>
         </div>
      </div>
    </aside>
  );
};

export default Sidebar; 