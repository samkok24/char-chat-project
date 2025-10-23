import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { storydiveAPI } from '../lib/api';
import AppLayout from '../components/layout/AppLayout';
import { Button } from '../components/ui/button';
import { Textarea } from '../components/ui/textarea';
import { RadioGroup, RadioGroupItem } from '../components/ui/radio-group';
import { Label } from '../components/ui/label';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '../components/ui/sheet';
import { Loader2, Settings, ChevronLeft, Send, RotateCcw, Trash2, FastForward } from 'lucide-react';

const StoryDiveNovelPage = () => {
  const { novelId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [paragraphs, setParagraphs] = useState([]);
  const [hoveredParagraph, setHoveredParagraph] = useState(null);
  const [focusedParagraphs, setFocusedParagraphs] = useState(new Set([0, 1, 2, 3, 4]));
  const paragraphRefs = useRef([]);

  // 다이브 상태
  const [isDived, setIsDived] = useState(false);
  const [sessionId, setSessionId] = useState(null);
  const [entryPoint, setEntryPoint] = useState(null);
  const [displayedParagraphs, setDisplayedParagraphs] = useState([]); // 다이브 후 보여줄 원문
  
  // 플레이 상태
  const [mode, setMode] = useState('do');
  const [input, setInput] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const contentEndRef = useRef(null);
  const textareaRef = useRef(null);

  // 소설 데이터 조회
  const { data: novel, isLoading } = useQuery({
    queryKey: ['storydive-novel', novelId],
    queryFn: async () => {
      const response = await storydiveAPI.getNovel(novelId);
      return response.data;
    },
  });

  // 세션 데이터 조회 (다이브 후)
  const { data: session } = useQuery({
    queryKey: ['storydive-session', sessionId],
    queryFn: async () => {
      if (!sessionId) return null;
      const response = await storydiveAPI.getSession(sessionId);
      return response.data;
    },
    enabled: !!sessionId && isDived,
    refetchInterval: isGenerating ? 3000 : false,
  });

  // 소설 데이터 로드 시 문단 파싱
  useEffect(() => {
    if (novel?.full_text) {
      const lines = novel.full_text.split('\n').filter(line => line.trim());
      const parsed = lines.map((line, index) => ({
        index,
        text: line.trim()
      }));
      setParagraphs(parsed);
    }
  }, [novel]);

  // 다이브 세션 생성
  const createSessionMutation = useMutation({
    mutationFn: ({ novelId, entryPoint }) => storydiveAPI.createSession(novelId, entryPoint),
    onSuccess: (response) => {
      const newSessionId = response.data.id;
      setSessionId(newSessionId);
      
      // 다이브 지점부터 5문단만 표시
      const startIdx = entryPoint;
      const endIdx = Math.min(startIdx + 5, paragraphs.length);
      setDisplayedParagraphs(paragraphs.slice(startIdx, endIdx));
      setIsDived(true);
      
      window.dispatchEvent(new CustomEvent('toast', {
        detail: {
          type: 'success',
          message: '스토리 다이브 시작!'
        }
      }));
    },
    onError: (error) => {
      window.dispatchEvent(new CustomEvent('toast', {
        detail: {
          type: 'error',
          message: error.response?.data?.detail || '세션 생성에 실패했습니다'
        }
      }));
    },
  });

  // 턴 진행 mutation
  const turnMutation = useMutation({
    mutationFn: ({ mode, input, action }) => 
      storydiveAPI.processTurn(sessionId, mode, input, action),
    onSuccess: () => {
      setInput('');
      setIsGenerating(false);
      queryClient.invalidateQueries(['storydive-session', sessionId]);
      setTimeout(() => {
        contentEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 100);
    },
    onError: (error) => {
      setIsGenerating(false);
      window.dispatchEvent(new CustomEvent('toast', {
        detail: {
          type: 'error',
          message: error.response?.data?.detail || '응답 생성에 실패했습니다'
        }
      }));
    },
  });

  // Erase mutation
  const eraseMutation = useMutation({
    mutationFn: () => storydiveAPI.eraseTurn(sessionId),
    onSuccess: () => {
      queryClient.invalidateQueries(['storydive-session', sessionId]);
      window.dispatchEvent(new CustomEvent('toast', {
        detail: {
          type: 'success',
          message: '마지막 응답이 삭제되었습니다'
        }
      }));
    },
    onError: (error) => {
      window.dispatchEvent(new CustomEvent('toast', {
        detail: {
          type: 'error',
          message: error.response?.data?.detail || '삭제에 실패했습니다'
        }
      }));
    },
  });

  // IntersectionObserver로 포커싱 관리
  useEffect(() => {
    if (paragraphs.length === 0 || isDived) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const index = parseInt(entry.target.dataset.index, 10);
            setFocusedParagraphs((prev) => {
              const newSet = new Set(prev);
              for (let i = Math.max(0, index - 2); i <= Math.min(paragraphs.length - 1, index + 2); i++) {
                newSet.add(i);
              }
              return newSet;
            });
          }
        });
      },
      { threshold: 0.5 }
    );

    paragraphRefs.current.forEach((ref) => {
      if (ref) observer.observe(ref);
    });

    return () => {
      observer.disconnect();
    };
  }, [paragraphs, isDived]);

  // Textarea 자동 높이 조절
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
    }
  }, [input]);

  // 자동 스크롤
  useEffect(() => {
    if (isDived && session?.turns) {
      contentEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [session?.turns, isDived]);

  const handleDive = (point) => {
    setEntryPoint(point);
    createSessionMutation.mutate({ novelId, entryPoint: point });
  };

  const handleSend = () => {
    if (!input.trim() || isGenerating) return;
    setIsGenerating(true);
    turnMutation.mutate({ mode, input, action: 'turn' });
  };

  const handleContinue = () => {
    if (isGenerating) return;
    setIsGenerating(true);
    turnMutation.mutate({ mode: 'continue', input: '', action: 'continue' });
  };

  const handleRetry = () => {
    if (isGenerating) return;
    setIsGenerating(true);
    turnMutation.mutate({ mode, input: input || 'retry', action: 'retry' });
  };

  const handleErase = () => {
    if (isGenerating) return;
    eraseMutation.mutate();
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Active turns
  const activeTurns = session?.turns?.filter(turn => !turn.deleted) || [];

  if (isLoading) {
    return (
      <AppLayout>
        <div className="min-h-screen bg-gradient-to-b from-gray-900 to-black text-white flex items-center justify-center">
          <Loader2 className="w-12 h-12 animate-spin text-purple-500" />
        </div>
      </AppLayout>
    );
  }

  if (!novel) {
    return (
      <AppLayout>
        <div className="min-h-screen bg-gradient-to-b from-gray-900 to-black text-white flex items-center justify-center">
          <div className="text-center">
            <p className="text-xl text-gray-400 mb-4">소설을 찾을 수 없습니다</p>
            <Button onClick={() => navigate('/dashboard')}>
              돌아가기
            </Button>
          </div>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="min-h-screen bg-gradient-to-b from-gray-900 to-black text-white flex flex-col">
        {/* 상단 헤더 */}
        <div className="sticky top-0 z-20 bg-gray-900/95 backdrop-blur-sm border-b border-gray-800">
          <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
            <Button
              variant="ghost"
              onClick={() => navigate('/dashboard')}
              className="text-gray-300 hover:text-white"
            >
              <ChevronLeft className="w-4 h-4 mr-2" />
              나가기
            </Button>
            
            <h1 className="text-lg font-bold text-white truncate max-w-md">
              {novel.title}
            </h1>

            {isDived && (
              <Sheet open={showSettings} onOpenChange={setShowSettings}>
                <SheetTrigger asChild>
                  <Button variant="ghost" size="icon" className="text-gray-300 hover:text-white">
                    <Settings className="w-5 h-5" />
                  </Button>
                </SheetTrigger>
                <SheetContent className="bg-gray-900 border-gray-800 text-white overflow-y-auto">
                  <SheetHeader>
                    <SheetTitle className="text-white">Story Cards</SheetTitle>
                  </SheetHeader>
                  
                  {novel.story_cards && (
                    <div className="mt-6 space-y-6">
                      {/* Story Cards 내용 */}
                      <div>
                        <h3 className="text-sm font-bold text-purple-400 mb-2">Plot Essentials</h3>
                        <p className="text-sm text-gray-300 leading-relaxed">
                          {novel.story_cards.plot}
                        </p>
                      </div>

                      {novel.story_cards.characters?.length > 0 && (
                        <div>
                          <h3 className="text-sm font-bold text-purple-400 mb-2">Characters</h3>
                          <div className="space-y-3">
                            {novel.story_cards.characters.map((char, idx) => (
                              <div key={idx} className="bg-gray-800 rounded-lg p-3">
                                <p className="font-semibold text-white text-sm">{char.name}</p>
                                <p className="text-xs text-gray-400 mt-1">{char.description}</p>
                                <p className="text-xs text-gray-500 mt-1">{char.personality}</p>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {novel.story_cards.locations?.length > 0 && (
                        <div>
                          <h3 className="text-sm font-bold text-purple-400 mb-2">Locations</h3>
                          <div className="space-y-2">
                            {novel.story_cards.locations.map((loc, idx) => (
                              <div key={idx} className="bg-gray-800 rounded-lg p-3">
                                <p className="font-semibold text-white text-sm">{loc.name}</p>
                                <p className="text-xs text-gray-400 mt-1">{loc.description}</p>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {novel.story_cards.world && (
                        <div>
                          <h3 className="text-sm font-bold text-purple-400 mb-2">World Setting</h3>
                          <p className="text-sm text-gray-300 leading-relaxed">
                            {novel.story_cards.world}
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </SheetContent>
              </Sheet>
            )}
            
            {!isDived && <div className="w-10"></div>}
          </div>
        </div>

        {/* 메인 콘텐츠 */}
        <div className="flex-1 overflow-y-auto pb-64">
          <div className="max-w-4xl mx-auto px-4 py-12">
            {!isDived ? (
              /* 원문 표시 모드 (다이브 전) */
              <div className="space-y-6">
                {paragraphs.map((paragraph, idx) => {
                  const isFocused = focusedParagraphs.has(idx);
                  const isHovered = hoveredParagraph === idx;

                  return (
                    <div
                      key={idx}
                      ref={(el) => (paragraphRefs.current[idx] = el)}
                      data-index={idx}
                      className="relative group"
                      onMouseEnter={() => setHoveredParagraph(idx)}
                      onMouseLeave={() => setHoveredParagraph(null)}
                    >
                      <p
                        className={`text-lg leading-relaxed transition-all duration-300 ${
                          isFocused ? 'text-white opacity-100' : 'text-gray-600 opacity-40'
                        }`}
                        style={{
                          textShadow: isFocused ? '0 0 20px rgba(168, 85, 247, 0.3)' : 'none',
                        }}
                      >
                        {paragraph.text}
                      </p>

                      {isHovered && (
                        <Button
                          onClick={() => handleDive(idx)}
                          disabled={createSessionMutation.isLoading}
                          className="absolute right-0 top-1/2 -translate-y-1/2 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white shadow-lg"
                        >
                          {createSessionMutation.isLoading ? (
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          ) : (
                            <span className="mr-2">🏊</span>
                          )}
                          다이브
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              /* 플레이 모드 (다이브 후) */
              <div className="space-y-6">
                {/* 원문 5문단 표시 (회색→흰색 포커싱) */}
                <div className="space-y-6">
                  {displayedParagraphs.map((paragraph, idx) => {
                    // 첫 3개는 포커싱
                    const isFocused = idx < 3;
                    
                    return (
                      <p
                        key={paragraph.index}
                        className={`text-lg leading-relaxed transition-all duration-500 ${
                          isFocused ? 'text-white opacity-100' : 'text-gray-600 opacity-40'
                        }`}
                        style={{
                          textShadow: isFocused ? '0 0 20px rgba(168, 85, 247, 0.3)' : 'none',
                        }}
                      >
                        {paragraph.text}
                      </p>
                    );
                  })}
                </div>

                {/* AI 생성 턴들 */}
                {activeTurns.length > 0 && (
                  <div className="space-y-6 border-t border-gray-800 pt-6 mt-8">
                    {activeTurns.map((turn, idx) => (
                      <div key={idx} className="space-y-4">
                        {/* 유저 입력 */}
                        {turn.user && (
                          <div className="bg-gray-800/50 rounded-lg px-4 py-2 border-l-4 border-purple-500">
                            <div className="text-xs text-purple-400 mb-1 uppercase font-semibold">
                              {turn.mode}
                            </div>
                            <p className="text-gray-300 italic">
                              {turn.mode === 'say' && '"'}
                              {turn.user}
                              {turn.mode === 'say' && '"'}
                            </p>
                          </div>
                        )}

                        {/* AI 응답 */}
                        {turn.ai && (
                          <div>
                            <p className="text-white text-lg leading-relaxed whitespace-pre-wrap">
                              {turn.ai}
                            </p>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* 생성 중 로더 */}
                {isGenerating && (
                  <div className="flex justify-center py-8">
                    <Loader2 className="w-8 h-8 animate-spin text-purple-500" />
                  </div>
                )}

                <div ref={contentEndRef} />
              </div>
            )}
          </div>
        </div>

        {/* 하단 입력 툴바 (다이브 후에만 표시) - AI Dungeon 스타일 */}
        {isDived && (
          <div className="fixed bottom-0 left-0 right-0 z-30 bg-gradient-to-t from-gray-900 via-gray-900 to-gray-900/80 backdrop-blur-sm border-t border-gray-800">
            <div className="max-w-4xl mx-auto px-4 py-4">
              {/* 입력창 */}
              <div className="mb-3">
                <Textarea
                  ref={textareaRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={
                    mode === 'do' ? 'What do you do?' :
                    mode === 'say' ? 'What do you say?' :
                    mode === 'story' ? 'What happens next?' :
                    'What do you see?'
                  }
                  disabled={isGenerating}
                  className="w-full bg-gray-800/80 border-gray-700 text-white placeholder:text-gray-500 resize-none min-h-[80px] max-h-[200px] text-base"
                  rows={3}
                />
              </div>

              {/* 버튼 컨테이너 */}
              <div className="flex items-center justify-between">
                {/* 4개 모드 버튼 */}
                <div className="flex space-x-2">
                  <Button
                    onClick={() => setMode('do')}
                    disabled={isGenerating}
                    variant={mode === 'do' ? 'default' : 'outline'}
                    className={mode === 'do' 
                      ? 'bg-purple-600 hover:bg-purple-700 text-white border-none' 
                      : 'bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-700'
                    }
                  >
                    ✊ Do
                  </Button>
                  <Button
                    onClick={() => setMode('say')}
                    disabled={isGenerating}
                    variant={mode === 'say' ? 'default' : 'outline'}
                    className={mode === 'say' 
                      ? 'bg-purple-600 hover:bg-purple-700 text-white border-none' 
                      : 'bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-700'
                    }
                  >
                    💬 Say
                  </Button>
                  <Button
                    onClick={() => setMode('story')}
                    disabled={isGenerating}
                    variant={mode === 'story' ? 'default' : 'outline'}
                    className={mode === 'story' 
                      ? 'bg-purple-600 hover:bg-purple-700 text-white border-none' 
                      : 'bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-700'
                    }
                  >
                    📖 Story
                  </Button>
                  <Button
                    onClick={() => setMode('see')}
                    disabled={isGenerating}
                    variant={mode === 'see' ? 'default' : 'outline'}
                    className={mode === 'see' 
                      ? 'bg-purple-600 hover:bg-purple-700 text-white border-none' 
                      : 'bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-700'
                    }
                  >
                    👁️ See
                  </Button>
                </div>

                {/* TAKE A TURN + 액션 버튼들 */}
                <div className="flex space-x-2">
                  <Button
                    onClick={handleSend}
                    disabled={!input.trim() || isGenerating}
                    className="bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white px-6"
                  >
                    ✏️ TAKE A TURN
                  </Button>
                  
                  <Button
                    onClick={handleContinue}
                    disabled={isGenerating || activeTurns.length === 0}
                    variant="outline"
                    className="bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-700"
                    title="Continue"
                  >
                    ⚡ CONTINUE
                  </Button>
                  
                  <Button
                    onClick={handleRetry}
                    disabled={isGenerating || activeTurns.length === 0}
                    variant="outline"
                    className="bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-700"
                    title="Retry"
                  >
                    🔄 RETRY
                  </Button>
                  
                  <Button
                    onClick={handleErase}
                    disabled={isGenerating || activeTurns.length === 0}
                    variant="outline"
                    className="bg-gray-800 border-gray-700 text-red-400 hover:bg-gray-700"
                    title="Erase"
                  >
                    🗑️ ERASE
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  );
};

export default StoryDiveNovelPage;

