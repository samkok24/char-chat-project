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

const AgentSidebar = ({ onCreateSession, activeSessionId, onSessionSelect, onDeleteSession, isGuest, isNewChatButtonDisabled }) => {
  const { user, isAuthenticated, logout } = useAuth();
  const navigate = useNavigate();
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [sessionCount, setSessionCount] = useState(0);
  const [sessionList, setSessionList] = useState([]);

  React.useEffect(() => {
    const read = () => {
      try {
        const userId = user?.id || 'guest';
        // localStorage 우선, 없으면 sessionStorage 체크 (게스트)
        let arr = JSON.parse(localStorage.getItem(`agent:sessions:${userId}`) || '[]') || [];
        if (!arr || arr.length === 0) {
          try { arr = JSON.parse(sessionStorage.getItem(`agent:sessions:${userId}`) || '[]') || []; } catch {}
        }
        const list = Array.isArray(arr) ? arr.sort((a,b) => (new Date(b.updatedAt||0)) - (new Date(a.updatedAt||0))) : [];
        setSessionCount(list.length);
        const mapped = list.slice(0, 8).map((s) => {
          try {
            // localStorage 우선, 없으면 sessionStorage 체크
            let msgsRaw = localStorage.getItem(`agent:messages:${userId}:${s.id}`);
            if (!msgsRaw) {
              try { msgsRaw = sessionStorage.getItem(`agent:messages:${userId}:${s.id}`); } catch {}
            }
            const msgs = JSON.parse(msgsRaw || '[]') || [];
            if (!Array.isArray(msgs)) return { ...s, autoTitle: '새 대화', imageDesc: '' };
            
            // 첫 번째 AI 답변 추출
            // dual_response는 선택 대기 중, 일반 답변은 내용 표시
            const firstAI = msgs.find(m => m && m.role === 'assistant' && (m.content || m.type === 'dual_response'));
            let autoTitle = s.title || '새 대화';
            let fullTitle = autoTitle;
            
            if (firstAI) {
              if (firstAI.type === 'dual_response') {
                // 선택 대기 중
                autoTitle = '응답 생성 중...';
                fullTitle = '일상/장르 선택 대기 중';
              } else if (firstAI.content) {
                // 선택 완료 또는 일반 생성
                const text = String(firstAI.content).trim();
                // 첫 문장 추출 (마침표/물음표/느낌표 기준)
                const match = text.match(/^[^.!?]+[.!?]/);
                const firstSentence = match ? match[0].trim() : text.split('\n')[0] || text;
                fullTitle = firstSentence;
                autoTitle = firstSentence.length > 30 ? firstSentence.slice(0, 30) + '...' : firstSentence;
              }
            }
            
            // 첫 번째 유저 입력 분석 (이미지 > 텍스트 > 이모지 우선순위)
            const firstUserMsgs = msgs.filter(m => m && m.role === 'user');
            let imageDesc = '';
            let fullImageDesc = '';
            
            if (firstUserMsgs.length > 0) {
              // 첫 번째 이미지 메시지 확인
              const imgMsg = firstUserMsgs.find(m => m.type === 'image');
              // 첫 번째 텍스트 메시지 확인
              const textMsg = firstUserMsgs.find(m => !m.type && m.content && m.content.trim());
              
              if (imgMsg) {
                // 이미지 우선 (이미지+텍스트, 이미지+이모지, 이미지만)
                const summary = imgMsg.imageSummary || '';
                if (summary) {
                  fullImageDesc = `이미지(${summary})`;
                  imageDesc = summary.length > 20 ? `이미지(${summary.slice(0, 20)}...)` : fullImageDesc;
                } else {
                  imageDesc = '이미지';
                  fullImageDesc = '이미지';
                }
              } else if (textMsg) {
                // 텍스트 (텍스트+이모지 또는 텍스트만)
                const text = String(textMsg.content || '').trim();
                // 이모지만 있는지 체크 (유니코드 이모지)
                const isOnlyEmoji = /^[\p{Emoji}\s]+$/u.test(text);
                if (isOnlyEmoji) {
                  fullImageDesc = `이모지(${text})`;
                  imageDesc = text.length > 20 ? `이모지(${text.slice(0, 20)}...)` : fullImageDesc;
                } else {
                  fullImageDesc = `텍스트(${text})`;
                  imageDesc = text.length > 20 ? `텍스트(${text.slice(0, 20)}...)` : fullImageDesc;
                }
              }
            }
            
            return { ...s, autoTitle, fullTitle, imageDesc, fullImageDesc };
          } catch { return { ...s, autoTitle: '새 대화', fullTitle: '새 대화', imageDesc: '', fullImageDesc: '' }; }
        });
        setSessionList(mapped);
      } catch { setSessionCount(0); }
    };
    read();
    const handler = () => read();
    try { window.addEventListener('agent:sessionsChanged', handler); } catch {}
    return () => { try { window.removeEventListener('agent:sessionsChanged', handler); } catch {} };
  }, [user?.id]);

  const handleLogout = () => {
    logout();
    navigate('/');
  };

  const handleDeleteSession = (id) => {
    if (onDeleteSession) {
      onDeleteSession(id);
      return;
    }
    try {
      const userId = user?.id || 'guest';
      const raw = localStorage.getItem(`agent:sessions:${userId}`) || '[]';
      const arr = JSON.parse(raw) || [];
      const next = Array.isArray(arr) ? arr.filter(s => s.id !== id) : [];
      localStorage.setItem(`agent:sessions:${userId}`, JSON.stringify(next));
      try { localStorage.removeItem(`agent:messages:${userId}:${id}`); } catch {}
      try { window.dispatchEvent(new Event('agent:sessionsChanged')); } catch {}
    } catch {}
  };

  return (
    <aside className="w-64 bg-gray-800 border-r border-gray-700 flex flex-col">
      <div className="p-4 border-b border-gray-700">
        <button onClick={onCreateSession} className="flex items-center space-x-2">
          <Brain className="w-8 h-8 text-yellow-400" />
          <h1 className="text-xl font-bold text-white">Agent</h1>
        </button>
      </div>

      <nav className="flex-1 p-3 space-y-1">
        {/* 새 대화 버튼을 히스토리 영역 위로 이동 */}
        <div className="mb-2">
          <Button 
            className="w-full border border-blue-600/60 bg-transparent text-blue-400 hover:bg-blue-700/20 disabled:opacity-50 disabled:cursor-not-allowed" 
            onClick={onCreateSession}
            disabled={isNewChatButtonDisabled}
            title={isNewChatButtonDisabled ? (isGuest ? "로그인 후 새 대화를 시작할 수 있습니다." : "현재 세션에서 첫 메시지를 보낸 후 새 대화를 시작할 수 있습니다.") : ""}
          >
            + 새 대화
          </Button>
        </div>
        
        {!isGuest ? (
          <>
            {/* 내 서랍 버튼 */}
            <Button
              onClick={() => navigate('/agent/drawer')}
              className="w-full mb-3 bg-purple-600 hover:bg-purple-700 text-white transition-colors"
            >
              내 서랍
            </Button>

            {/* 내 피드 버튼 */}
            <Button
              onClick={() => navigate('/agent/feed')}
              className="w-full mb-3 bg-pink-600 hover:bg-pink-700 text-white transition-colors"
            >
              내 피드
            </Button>

            {sessionList.length > 0 && (
              <div className="mt-2 space-y-1">
                {sessionList.map(s => (
                  <div key={s.id} className="flex items-center gap-2">
                    <button
                      onClick={() => onSessionSelect(s.id)}
                      className={`group relative flex-1 text-left px-3 py-2 rounded-lg border transition-colors min-w-0 ${activeSessionId === s.id ? 'bg-gray-700/80 border-purple-500/50' : 'bg-gray-900 border-gray-800 hover:bg-gray-800'}`}
                    >
                      <div className="text-sm text-gray-200 truncate font-medium">{s.autoTitle || '새 대화'}</div>
                      <div className="text-xs text-gray-500 truncate mt-0.5">{s.imageDesc || new Date(s.updatedAt||s.createdAt).toLocaleString()}</div>
                      {/* hover 툴팁 */}
                      <div className="hidden group-hover:block absolute left-full top-0 ml-2 z-20 w-64 p-3 rounded-lg bg-gray-900 border border-gray-700 shadow-xl">
                        <div className="text-xs text-gray-400 mb-2">{new Date(s.updatedAt||s.createdAt).toLocaleString()}</div>
                        <div className="text-sm text-gray-200 mb-2 leading-relaxed">{s.fullTitle || s.autoTitle || '새 대화'}</div>
                        {s.fullImageDesc && (
                          <div className="text-xs text-gray-400 mt-1 break-all">{s.fullImageDesc}</div>
                        )}
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
                    {(JSON.parse(localStorage.getItem(`agent:images:${user?.id || 'guest'}`)||'[]')||[]).slice(0,6).map(img => (
                      <img key={img.id} src={img.url} alt="img" className="w-full h-12 object-cover rounded cursor-pointer" onClick={() => { try { const uid = user?.id || 'guest'; const sid = (JSON.parse(localStorage.getItem(`agent:sessions:${uid}`)||'[]')||[])[0]?.id; if (sid) { window.location.href=`/agent#session=${sid}`; } else { window.location.href='/agent'; } } catch { window.location.href='/agent'; } }} />
                    ))}
                  </div>
                </div>
              </div>
              <div className="group relative flex items-center justify-center h-10 rounded-lg bg-gray-900 border border-gray-700 text-gray-300">
                <NotebookText className="w-4 h-4" />
                <div className="hidden group-hover:block absolute left-full top-0 ml-2 z-20 w-64 p-3 rounded-lg bg-gray-900 border border-gray-700 shadow-xl">
                  <div className="text-sm text-white mb-2">생성된 스토리</div>
                  <div className="space-y-2 max-h-56 overflow-auto pr-1">
                    {(JSON.parse(localStorage.getItem(`agent:stories:${user?.id || 'guest'}`)||'[]')||[]).slice(0,8).map(s => (
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
                    {(JSON.parse(localStorage.getItem(`agent:characters:${user?.id || 'guest'}`)||'[]')||[]).slice(0,8).map(c => (
                      <button key={c.id} className="block w-full text-left text-xs text-gray-300 truncate hover:text-white" onClick={() => { try { window.location.href=`/characters/${c.id}`; } catch { window.location.href='/agent'; } }}>{c.name||'캐릭터'}</button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="mt-4 p-3 rounded-lg bg-gray-900 border border-gray-700 text-center">
            <p className="text-sm text-gray-300 mb-3">로그인하여 히스토리를 저장하고 더 많은 기능을 이용해보세요.</p>
            <Button className="w-full bg-gradient-to-r from-purple-600 via-fuchsia-600 to-pink-600 hover:brightness-105 text-white shadow-md" onClick={() => setShowLoginModal(true)}>
              <LogIn className="w-4 h-4 mr-2" /> 로그인/가입
            </Button>
          </div>
        )}
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


