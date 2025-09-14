import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { NotebookText, Image as ImageIcon, Brain, MessageSquarePlus, User, Gem, Settings, LogOut, LogIn, UserPlus, Trash2 } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';
import LoginModal from '../LoginModal';
import { resolveImageUrl } from '../../lib/images';

const AgentSidebar = ({ onCreateSession, activeSessionId, onSessionSelect }) => {
  const { user, isAuthenticated, logout } = useAuth();
  const navigate = useNavigate();
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [sessionCount, setSessionCount] = useState(0);
  const [sessionList, setSessionList] = useState([]);

  React.useEffect(() => {
    const read = () => {
      try {
        const arr = JSON.parse(localStorage.getItem('agent:sessions') || '[]') || [];
        const list = Array.isArray(arr) ? arr.sort((a,b) => (new Date(b.updatedAt||0)) - (new Date(a.updatedAt||0))) : [];
        setSessionCount(list.length);
        const mapped = list.slice(0, 8).map((s) => {
          try {
            const msgs = JSON.parse(localStorage.getItem(`agent:messages:${s.id}`) || '[]') || [];
            const last = Array.isArray(msgs) ? msgs.filter(m => (m && (m.content || m.type === 'image'))).slice(-1)[0] : null;
            const snippet = last ? (last.type === 'image' ? '[이미지]' : String(last.content || '').replace(/\s+/g, ' ').slice(0, 40)) : '';
            return { ...s, snippet };
          } catch { return { ...s, snippet: '' }; }
        });
        setSessionList(mapped);
      } catch { setSessionCount(0); }
    };
    read();
    const handler = () => read();
    try { window.addEventListener('agent:sessionsChanged', handler); } catch {}
    return () => { try { window.removeEventListener('agent:sessionsChanged', handler); } catch {} };
  }, []);

  const handleLogout = () => {
    logout();
    navigate('/');
  };

  const handleDeleteSession = (id) => {
    try {
      const raw = localStorage.getItem('agent:sessions') || '[]';
      const arr = JSON.parse(raw) || [];
      const next = Array.isArray(arr) ? arr.filter(s => s.id !== id) : [];
      localStorage.setItem('agent:sessions', JSON.stringify(next));
      try { localStorage.removeItem(`agent:messages:${id}`); } catch {}
      try { window.dispatchEvent(new Event('agent:sessionsChanged')); } catch {}
    } catch {}
  };

  return (
    <aside className="w-64 bg-gray-800 border-r border-gray-700 flex flex-col">
      <div className="p-4 border-b border-gray-700">
        <Link to="/agent" className="flex items-center space-x-2">
          <Brain className="w-8 h-8 text-yellow-400" />
          <h1 className="text-xl font-bold text-white">Agent</h1>
        </Link>
      </div>

      <nav className="flex-1 p-3 space-y-1">
        {/* 새 대화 버튼을 히스토리 영역 위로 이동 */}
        <div className="mb-2">
          <Button 
            className="w-full border border-blue-600/60 bg-transparent text-blue-400 hover:bg-blue-700/20" 
            onClick={onCreateSession}
          >
            + 새 대화
          </Button>
        </div>
        <div className="text-xs text-gray-400 px-2 mb-2">히스토리</div>
        <div className="flex items-center justify-between px-3 py-2 rounded-lg text-gray-300 bg-gray-900 border border-gray-700">
          <div className="inline-flex items-center">
            <MessageSquarePlus className="w-4 h-4 mr-2" /> 최근 세션
          </div>
          <span className="text-xs text-gray-400">{sessionCount}개</span>
        </div>

        {sessionList.length > 0 && (
          <div className="mt-2 space-y-1">
            {sessionList.map(s => (
              <div key={s.id} className="flex items-center gap-2">
                <button
                  onClick={() => onSessionSelect(s.id)}
                  className={`group relative flex-1 text-left px-3 py-2 rounded-lg border transition-colors min-w-0 ${activeSessionId === s.id ? 'bg-gray-700/80 border-purple-500/50' : 'bg-gray-900 border-gray-800 hover:bg-gray-800'}`}
                  title={s.title || '새 대화'}
                >
                  <div className="text-sm text-gray-200 truncate">{s.title || '새 대화'}</div>
                  <div className="text-xs text-gray-500 truncate">{s.snippet || new Date(s.updatedAt||s.createdAt).toLocaleString()}</div>
                  {/* hover 팝오버 */}
                  <div className="hidden group-hover:block absolute left-full top-0 ml-2 z-20 w-64 p-3 rounded-lg bg-gray-900 border border-gray-700 shadow-xl">
                    <div className="text-xs text-gray-400 mb-1">{new Date(s.updatedAt||s.createdAt).toLocaleString()}</div>
                    <div className="text-sm text-gray-200 whitespace-pre-wrap">{s.snippet || '메시지 없음'}</div>
                  </div>
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); handleDeleteSession(s.id); }}
                  className="p-2 rounded-lg bg-gray-900 border border-gray-800 hover:bg-red-700/20 text-gray-400 hover:text-red-400 flex-shrink-0"
                  title="세션 삭제"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* 아이콘 랙: 이미지/스토리/캐릭터 - hover 시 팝업 */}
        <div className="mt-4 grid grid-cols-3 gap-2">
          <div className="group relative flex items-center justify-center h-10 rounded-lg bg-gray-900 border border-gray-700 text-gray-300">
            <ImageIcon className="w-4 h-4" />
            <div className="hidden group-hover:block absolute left-full top-0 ml-2 z-20 w-64 p-3 rounded-lg bg-gray-900 border border-gray-700 shadow-xl">
              <div className="text-sm text-white mb-2">이미지 보관함</div>
              <div className="grid grid-cols-3 gap-2">
                {(JSON.parse(localStorage.getItem('agent:images')||'[]')||[]).slice(0,6).map(img => (
                  <img key={img.id} src={img.url} alt="img" className="w-full h-12 object-cover rounded cursor-pointer" onClick={() => { try { const sid = (JSON.parse(localStorage.getItem('agent:sessions')||'[]')||[])[0]?.id; if (sid) { window.location.href=`/agent#session=${sid}`; } else { window.location.href='/agent'; } } catch { window.location.href='/agent'; } }} />
                ))}
              </div>
            </div>
          </div>
          <div className="group relative flex items-center justify-center h-10 rounded-lg bg-gray-900 border border-gray-700 text-gray-300">
            <NotebookText className="w-4 h-4" />
            <div className="hidden group-hover:block absolute left-full top-0 ml-2 z-20 w-64 p-3 rounded-lg bg-gray-900 border border-gray-700 shadow-xl">
              <div className="text-sm text-white mb-2">생성된 스토리</div>
              <div className="space-y-2 max-h-56 overflow-auto pr-1">
                {(JSON.parse(localStorage.getItem('agent:stories')||'[]')||[]).slice(0,8).map(s => (
                  <button key={s.id} className="block w-full text-left text-xs text-gray-300 truncate hover:text-white" onClick={() => { try { if (s.sessionId) { window.location.href=`/agent#session=${s.sessionId}`; } else { window.location.href='/agent'; } } catch { window.location.href='/agent'; } }}>{s.title}</button>
                ))}
              </div>
            </div>
          </div>
          <div className="group relative flex items-center justify-center h-10 rounded-lg bg-gray-900 border border-gray-700 text-gray-300">
            <User className="w-4 h-4" />
            <div className="hidden group-hover:block absolute left-full top-0 ml-2 z-20 w-64 p-3 rounded-lg bg-gray-900 border border-gray-700 shadow-xl">
              <div className="text-sm text-white mb-2">생성된 캐릭터</div>
              <div className="space-y-2 max-h-56 overflow-auto pr-1">
                {(JSON.parse(localStorage.getItem('agent:characters')||'[]')||[]).slice(0,8).map(c => (
                  <button key={c.id} className="block w-full text-left text-xs text-gray-300 truncate hover:text-white" onClick={() => { try { window.location.href=`/characters/${c.id}`; } catch { window.location.href='/agent'; } }}>{c.name||'캐릭터'}</button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </nav>

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
              <Button className="bg-gradient-to-r from-purple-600 via-fuchsia-600 to-pink-600 hover:brightness-105 text-white shadow-md" onClick={() => setShowLoginModal(true)}>
                <LogIn className="w-4 h-4 mr-2" /> 로그인
              </Button>
              <Button variant="outline" onClick={() => { setShowLoginModal(true); }}>
                <UserPlus className="w-4 h-4 mr-2" /> 회원가입
              </Button>
            </div>
          </div>
        )}
      </div>

      <LoginModal isOpen={showLoginModal} onClose={() => setShowLoginModal(false)} />
    </aside>
  );
};

export default AgentSidebar;


