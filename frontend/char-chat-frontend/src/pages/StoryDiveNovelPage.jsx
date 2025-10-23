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
import { Loader2, Settings, ChevronLeft, Send, RotateCcw, Trash2, FastForward, RefreshCw, ChevronRight } from 'lucide-react';
import { toast } from 'sonner';

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
  const [contextParagraphs, setContextParagraphs] = useState([]); // 마지막 5문장 (하이라이트)
  const [nextHistory, setNextHistory] = useState([]); // NEXT 버튼 히스토리
  
  // 플레이 상태
  const [mode, setMode] = useState('do');
  const [input, setInput] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showInputArea, setShowInputArea] = useState(false); // TAKE A TURN 클릭 시 입력창 표시
  const [currentCardIndex, setCurrentCardIndex] = useState(0); // Story Cards 페이지 인덱스
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
      
      // 다이브 지점 이전 5문장을 컨텍스트로 설정 (마지막 5문장)
      const endIdx = entryPoint + 1;
      const startIdx = Math.max(0, endIdx - 5);
      setContextParagraphs(paragraphs.slice(startIdx, endIdx).map(p => p.index));
      
      setIsDived(true);
      
      toast.success('스토리 다이브 시작!');
    },
    onError: (error) => {
      toast.error(error.response?.data?.detail || '세션 생성에 실패했습니다');
    },
  });

  // 턴 진행 mutation
  const turnMutation = useMutation({
    mutationFn: ({ mode, input, action }) => 
      storydiveAPI.processTurn(sessionId, mode, input, action),
    onSuccess: (response) => {
      setInput('');
      setIsGenerating(false);
      queryClient.invalidateQueries(['storydive-session', sessionId]);
      
      // 턴이 추가되면 마지막 5개 AI 응답을 컨텍스트로 업데이트
      // (실제로는 AI 응답이 생성되면 그 텍스트를 기준으로 해야 함)
      // 여기서는 간단히 처리
      
      setTimeout(() => {
        contentEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 100);
    },
    onError: (error) => {
      setIsGenerating(false);
      toast.error(error.response?.data?.detail || '응답 생성에 실패했습니다');
    },
  });

  // Erase mutation - 마지막 5문장 삭제
  const eraseMutation = useMutation({
    mutationFn: () => storydiveAPI.eraseTurn(sessionId),
    onSuccess: () => {
      queryClient.invalidateQueries(['storydive-session', sessionId]);
      
      // 마지막 턴을 삭제했으므로 컨텍스트를 이전 5문장으로 되돌림
      // (세션 데이터 갱신 후 자동으로 업데이트됨)
      
      toast.success('마지막 응답이 삭제되었습니다');
    },
    onError: (error) => {
      toast.error(error.response?.data?.detail || '삭제에 실패했습니다');
    },
  });

  // IntersectionObserver로 포커싱 관리 (5문장 단위)
  useEffect(() => {
    if (paragraphs.length === 0 || isDived) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const index = parseInt(entry.target.dataset.index, 10);
            setFocusedParagraphs((prev) => {
              const newSet = new Set(prev);
              // 5문장 단위로 포커싱
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
    setNextHistory([]); // AI 턴 생성 시 NEXT 히스토리 초기화
    turnMutation.mutate({ mode, input, action: 'turn' });
    setShowInputArea(false); // 전송 후 입력창 닫기
  };

  const handleOpenInputArea = () => {
    setShowInputArea(true);
    setInput('');
    setTimeout(() => textareaRef.current?.focus(), 100);
  };

  const handleCloseInputArea = () => {
    setShowInputArea(false);
    setInput('');
  };

  // 초기화 핸들러
  const handleReset = () => {
    if (window.confirm('정말 처음부터 다시 시작하시겠습니까? 모든 진행 상황이 초기화됩니다.')) {
      // 상태 초기화
      setIsDived(false);
      setSessionId(null);
      setEntryPoint(null);
      setContextParagraphs([]);
      setNextHistory([]); // NEXT 히스토리 초기화
      setInput('');
      setMode('do');
      setShowInputArea(false);
      setIsGenerating(false);
      
      // 쿼리 무효화
      queryClient.invalidateQueries(['storydive-session']);
      
      // 포커스 초기화
      setFocusedParagraphs(new Set([0, 1, 2, 3, 4]));
      
      // 맨 위로 스크롤
      window.scrollTo({ top: 0, behavior: 'smooth' });
      
      toast.success('초기화되었습니다');
    }
  };

  const handleContinue = () => {
    if (isGenerating) return;
    setIsGenerating(true);
    setNextHistory([]); // AI 턴 생성 시 NEXT 히스토리 초기화
    turnMutation.mutate({ mode: 'continue', input: '', action: 'continue' });
  };

  const handleRetry = () => {
    if (isGenerating) return;
    setIsGenerating(true);
    setNextHistory([]); // AI 턴 생성 시 NEXT 히스토리 초기화
    turnMutation.mutate({ mode, input: input || 'retry', action: 'retry' });
  };

  const handleErase = () => {
    if (isGenerating) return;
    
    // NEXT 히스토리가 있으면 먼저 되돌리기
    if (nextHistory.length > 0) {
      const lastState = nextHistory[nextHistory.length - 1];
      setEntryPoint(lastState.entryPoint);
      setContextParagraphs(lastState.contextParagraphs);
      setNextHistory(prev => prev.slice(0, -1));
      toast.success('원작 텍스트가 되돌려졌습니다');
      return;
    }
    
    // AI 턴이 있으면 삭제
    if (activeTurns.length > 0) {
      eraseMutation.mutate();
    } else {
      toast.info('삭제할 내용이 없습니다');
    }
  };

  // Next 핸들러 - 원작 텍스트 5문단 추가
  const handleNext = () => {
    if (!novel || entryPoint === null || !paragraphs || paragraphs.length === 0) {
      console.log('❌ handleNext 조건 실패:', { novel: !!novel, entryPoint, paragraphsLength: paragraphs?.length });
      return;
    }
    
    // 현재 표시된 마지막 문단 인덱스
    const lastShownIndex = entryPoint;
    const totalParagraphs = paragraphs.length;
    
    console.log('📊 Next 버튼 클릭:', { lastShownIndex, totalParagraphs, remaining: totalParagraphs - lastShownIndex - 1 });
    
    // 이미 마지막까지 도달했는지 체크
    if (lastShownIndex >= totalParagraphs - 1) {
      console.log('⚠️ 이미 마지막 문단입니다');
      toast.info('더 이상 보여줄 원작 텍스트가 없습니다');
      return;
    }
    
    // 다음 5개 문단 추가 (원작 범위 내에서만)
    const nextIndex = Math.min(lastShownIndex + 5, totalParagraphs - 1);
    const addedCount = nextIndex - lastShownIndex;
    
    console.log('✅ 문단 추가:', { from: lastShownIndex, to: nextIndex, addedCount });
    
    // 히스토리에 현재 상태 저장 (되돌리기 위해)
    setNextHistory(prev => [...prev, { entryPoint: lastShownIndex, contextParagraphs }]);
    
    setEntryPoint(nextIndex);
    
    // 컨텍스트도 업데이트 (마지막 5문단)
    const newContextStart = Math.max(0, nextIndex - 4);
    const newContext = paragraphs.slice(newContextStart, nextIndex + 1).map(p => p.index);
    setContextParagraphs(newContext);
    
    toast.success(`원작 텍스트 ${addedCount}문단을 더 보여줍니다`);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Active turns
  const activeTurns = session?.turns?.filter(turn => !turn.deleted) || [];

  // 턴이 추가되면 원문 하이라이트 제거 (AI 텍스트에만 하이라이트)
  useEffect(() => {
    if (!isDived || !session?.turns) return;

    const turns = session.turns.filter(t => !t.deleted);
    if (turns.length > 0) {
      // 턴이 있으면 원문 하이라이트 제거 (AI 텍스트의 하이라이트가 대신 표시됨)
      setContextParagraphs([]);
    }
  }, [session?.turns, isDived]);

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
              onClick={() => navigate(-1)}
              className="text-gray-300 hover:text-white hover:bg-gray-800/50"
            >
              <ChevronLeft className="w-4 h-4 mr-2" />
              뒤로가기
            </Button>
            
            <h1 className="text-lg font-bold text-white truncate max-w-md">
              {novel.title}
            </h1>

            {isDived ? (
              <div className="flex items-center space-x-2">
                {/* 초기화 버튼 */}
                <Button 
                  variant="ghost" 
                  size="icon" 
                  onClick={handleReset}
                  className="text-gray-300 hover:text-white hover:bg-gray-800/50"
                  title="처음부터 다시 시작"
                >
                  <RefreshCw className="w-5 h-5" />
                </Button>
                
                {/* 설정 버튼 */}
                <Sheet open={showSettings} onOpenChange={setShowSettings}>
                  <SheetTrigger asChild>
                    <Button variant="ghost" size="icon" className="text-gray-300 hover:text-white hover:bg-gray-800/50">
                      <Settings className="w-5 h-5" />
                    </Button>
                  </SheetTrigger>
                <SheetContent className="bg-gray-900 border-gray-800 text-white overflow-y-auto w-[400px]">
                  <div className="space-y-4">
                    {/* 헤더: 타이틀과 페이지네이션을 한 줄로 */}
                    <div className="flex items-center space-x-3 pt-6">
                      <SheetTitle className="text-xl font-bold text-white">Story Cards</SheetTitle>
                      {novel.story_cards && Array.isArray(novel.story_cards) && novel.story_cards.length > 1 && (
                        <div className="flex items-center space-x-2 bg-gray-800 rounded-full px-3 py-1.5">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setCurrentCardIndex(Math.max(0, currentCardIndex - 1))}
                            disabled={currentCardIndex === 0}
                            className="h-6 w-6 p-0 hover:bg-gray-700 rounded-full disabled:opacity-30"
                          >
                            <ChevronLeft className="w-3 h-3" />
                          </Button>
                          <span className="text-xs font-semibold text-purple-400 min-w-[35px] text-center">
                            {currentCardIndex + 1} / {novel.story_cards.length}
                          </span>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setCurrentCardIndex(Math.min(novel.story_cards.length - 1, currentCardIndex + 1))}
                            disabled={currentCardIndex === novel.story_cards.length - 1}
                            className="h-6 w-6 p-0 hover:bg-gray-700 rounded-full disabled:opacity-30"
                          >
                            <ChevronRight className="w-3 h-3" />
                          </Button>
                        </div>
                      )}
                    </div>
                  
                  {novel.story_cards && (() => {
                    const currentCard = Array.isArray(novel.story_cards) 
                      ? novel.story_cards[currentCardIndex] 
                      : novel.story_cards;
                    
                    return (
                      <div className="space-y-6 pb-6">
                        {/* Plot Essentials */}
                        <div className="bg-gradient-to-br from-purple-900/30 to-pink-900/30 rounded-xl p-4 border border-purple-500/20">
                          <div className="flex items-center space-x-2 mb-3">
                            <div className="w-1 h-4 bg-purple-500 rounded-full"></div>
                            <h3 className="text-sm font-bold text-purple-400 uppercase tracking-wide">Plot Essentials</h3>
                          </div>
                          <p className="text-sm text-gray-200 leading-relaxed">
                            {currentCard.plot}
                          </p>
                        </div>

                        {/* Characters */}
                        {currentCard.characters?.length > 0 && (
                          <div>
                            <div className="flex items-center space-x-2 mb-3">
                              <div className="w-1 h-4 bg-purple-500 rounded-full"></div>
                              <h3 className="text-sm font-bold text-purple-400 uppercase tracking-wide">Characters</h3>
                            </div>
                            <div className="space-y-2">
                              {currentCard.characters.map((char, idx) => (
                                <div key={idx} className="bg-gray-800/50 rounded-lg p-3 border border-gray-700/50 hover:border-purple-500/30 transition-colors">
                                  <p className="font-semibold text-white text-sm mb-1">{char.name}</p>
                                  <p className="text-xs text-gray-400 leading-relaxed">{char.description}</p>
                                  {char.personality && (
                                    <p className="text-xs text-purple-400/70 mt-1 italic">"{char.personality}"</p>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Locations */}
                        {currentCard.locations?.length > 0 && (
                          <div>
                            <div className="flex items-center space-x-2 mb-3">
                              <div className="w-1 h-4 bg-purple-500 rounded-full"></div>
                              <h3 className="text-sm font-bold text-purple-400 uppercase tracking-wide">Locations</h3>
                            </div>
                            <div className="space-y-2">
                              {currentCard.locations.map((loc, idx) => (
                                <div key={idx} className="bg-gray-800/50 rounded-lg p-3 border border-gray-700/50 hover:border-purple-500/30 transition-colors">
                                  <p className="font-semibold text-white text-sm mb-1">{loc.name}</p>
                                  <p className="text-xs text-gray-400 leading-relaxed">{loc.description}</p>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* World Setting */}
                        {currentCard.world && (
                          <div className="bg-gradient-to-br from-blue-900/30 to-purple-900/30 rounded-xl p-4 border border-blue-500/20">
                            <div className="flex items-center space-x-2 mb-3">
                              <div className="w-1 h-4 bg-blue-500 rounded-full"></div>
                              <h3 className="text-sm font-bold text-blue-400 uppercase tracking-wide">World Setting</h3>
                            </div>
                            <p className="text-sm text-gray-200 leading-relaxed">
                              {currentCard.world}
                            </p>
                          </div>
                        )}
                      </div>
                    );
                  })()}
                  </div>
                </SheetContent>
              </Sheet>
              </div>
            ) : (
              <div className="w-10"></div>
            )}
          </div>
        </div>

        {/* 메인 콘텐츠 - AI Dungeon 스타일 (버튼들이 문장 흐름 안에) */}
        <div className="flex-1 overflow-y-auto">
          <div className="w-full px-8 py-12 max-w-5xl mx-auto min-h-screen">
            {/* 원문 + AI 생성 텍스트를 하나의 flow로 */}
            <div className="space-y-6">
              {/* 원문 표시 (다이브 후에는 다이브 지점까지만) */}
              {paragraphs
                .filter((paragraph, idx) => !isDived || idx <= entryPoint)
                .map((paragraph, idx) => {
                const isFocused = focusedParagraphs.has(idx);
                const isHovered = hoveredParagraph === idx && !isDived;
                const isContext = isDived && contextParagraphs.includes(idx); // 마지막 5문장 하이라이트

                return (
                  <div
                    key={idx}
                    ref={(el) => (paragraphRefs.current[idx] = el)}
                    data-index={idx}
                    className={`relative group transition-all duration-500 ${
                      isDived && idx === entryPoint ? 'animate-in fade-in slide-in-from-top-2 duration-700' : ''
                    }`}
                    onMouseEnter={() => !isDived && setHoveredParagraph(idx)}
                    onMouseLeave={() => !isDived && setHoveredParagraph(null)}
                  >
                    <p
                      className={`text-lg leading-relaxed transition-all duration-300 ${
                        isContext 
                          ? 'text-white opacity-100' 
                          : isFocused 
                            ? 'text-white opacity-100' 
                            : 'text-gray-600 opacity-40'
                      }`}
                      style={{
                        textShadow: isFocused || isContext ? '0 0 20px rgba(168, 85, 247, 0.3)' : 'none',
                        textDecoration: isContext ? 'underline' : 'none',
                        textDecorationColor: isContext ? '#eab308' : 'transparent',
                        textDecorationThickness: isContext ? '2px' : '0',
                        textUnderlineOffset: isContext ? '4px' : '0',
                      }}
                    >
                      {paragraph.text}
                    </p>

                    {isHovered && (
                      <Button
                        onClick={() => handleDive(idx)}
                        disabled={createSessionMutation.isLoading}
                        className="absolute -right-28 top-1/2 -translate-y-1/2 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white shadow-lg whitespace-nowrap"
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

              {/* AI 생성 턴들 (다이브 후에만) - 원문과 동일한 간격으로 */}
              {isDived && activeTurns.length > 0 && activeTurns.map((turn, idx) => {
                  const isLastTurn = idx === activeTurns.length - 1;
                  
                  return (
                    <div 
                      key={idx} 
                      className={`space-y-4 ${
                        isLastTurn ? 'animate-in fade-in slide-in-from-bottom-4 duration-700' : ''
                      }`}
                    >
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

                      {/* AI 응답 - 개행 보존을 위해 원본 텍스트 그대로 사용 */}
                      {turn.ai && (
                        <div 
                          className="text-white text-lg leading-relaxed whitespace-pre-wrap"
                          style={isLastTurn ? {
                            textDecoration: 'underline',
                            textDecorationColor: '#eab308',
                            textDecorationThickness: '2px',
                            textUnderlineOffset: '4px',
                          } : {}}
                        >
                          {turn.ai}
                        </div>
                      )}
                    </div>
                  );
                })}
            </div>

            {/* 생성 중 로더 */}
            {isGenerating && (
              <div className="flex flex-col items-center justify-center py-10 space-y-4 animate-in fade-in duration-300">
                {/* 심플한 원형 스피너 */}
                <div className="relative w-20 h-20">
                  <svg className="w-full h-full transform -rotate-90" viewBox="0 0 100 100">
                    {/* 진행 중인 호 */}
                    <circle
                      cx="50"
                      cy="50"
                      r="42"
                      stroke="url(#gradient)"
                      strokeWidth="6"
                      fill="none"
                      strokeLinecap="round"
                      strokeDasharray="264"
                      className="animate-spin origin-center"
                      style={{
                        strokeDashoffset: '66',
                        animationDuration: '1.5s'
                      }}
                    />
                    <defs>
                      <linearGradient id="gradient" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" stopColor="#a855f7" />
                        <stop offset="100%" stopColor="#ec4899" />
                      </linearGradient>
                    </defs>
                  </svg>
                </div>
                
                {/* 텍스트 */}
                <div className="flex flex-col items-center">
                  <p className="text-base font-semibold text-white mb-1">생성 중...</p>
                  <p className="text-sm text-gray-400">AI가 이야기를 만들고 있습니다</p>
                </div>
              </div>
            )}

            {/* 다이브 후 버튼들 - 문장 흐름 안에 자연스럽게 */}
            {isDived && (
              <div className="mt-12 mb-24 animate-in fade-in slide-in-from-bottom-4 duration-700">
                {!showInputArea ? (
                  /* 기본 상태: 5개 버튼 */
                  <div className="flex items-center justify-start space-x-3 animate-in fade-in slide-in-from-bottom-2 duration-500 delay-200">
                    <Button
                      onClick={handleOpenInputArea}
                      disabled={isGenerating}
                      className="bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white px-6 py-3"
                    >
                      ✏️ TAKE A TURN
                    </Button>
                    
                    <Button
                      onClick={handleContinue}
                      disabled={isGenerating}
                      variant="outline"
                      className="bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-700 hover:to-cyan-700 border-none text-white px-6 py-3"
                    >
                      ⚡ CONTINUE
                    </Button>
                    
                    <Button
                      onClick={handleRetry}
                      disabled={isGenerating}
                      variant="outline"
                      className="bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-700 px-6 py-3"
                    >
                      🔄 RETRY
                    </Button>
                    
                    <Button
                      onClick={handleNext}
                      disabled={isGenerating}
                      variant="outline"
                      className="bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-700 px-6 py-3"
                    >
                      ➡️ NEXT
                    </Button>
                    
                    <Button
                      onClick={handleErase}
                      disabled={isGenerating}
                      variant="outline"
                      className="bg-gray-800 border-gray-700 text-red-400 hover:bg-gray-700 px-6 py-3"
                    >
                      🗑️ ERASE
                    </Button>
                  </div>
                ) : (
                  /* TAKE A TURN 클릭 시: 입력창 + 모드 버튼 */
                  <div className="space-y-3">
                    {/* 상단: X 버튼 + 모드 선택 */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-2">
                        <Button
                          onClick={handleCloseInputArea}
                          variant="ghost"
                          size="sm"
                          className="text-gray-400 hover:text-white"
                        >
                          ✕
                        </Button>
                        
                        {/* 4개 모드 버튼 */}
                        <div className="flex space-x-2">
                          <Button
                            onClick={() => setMode('do')}
                            variant={mode === 'do' ? 'default' : 'outline'}
                            size="sm"
                            className={mode === 'do' 
                              ? 'bg-purple-600 hover:bg-purple-700 text-white border-none' 
                              : 'bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-700'
                            }
                          >
                            Do
                          </Button>
                          <Button
                            onClick={() => setMode('say')}
                            variant={mode === 'say' ? 'default' : 'outline'}
                            size="sm"
                            className={mode === 'say' 
                              ? 'bg-purple-600 hover:bg-purple-700 text-white border-none' 
                              : 'bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-700'
                            }
                          >
                            Say
                          </Button>
                          <Button
                            onClick={() => setMode('story')}
                            variant={mode === 'story' ? 'default' : 'outline'}
                            size="sm"
                            className={mode === 'story' 
                              ? 'bg-purple-600 hover:bg-purple-700 text-white border-none' 
                              : 'bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-700'
                            }
                          >
                            Story
                          </Button>
                          <Button
                            onClick={() => setMode('see')}
                            variant={mode === 'see' ? 'default' : 'outline'}
                            size="sm"
                            className={mode === 'see' 
                              ? 'bg-purple-600 hover:bg-purple-700 text-white border-none' 
                              : 'bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-700'
                            }
                          >
                            See
                          </Button>
                        </div>
                      </div>
                      
                      <Button
                        onClick={handleSend}
                        disabled={!input.trim() || isGenerating}
                        className="bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white px-6"
                      >
                        Send
                      </Button>
                    </div>

                    {/* 입력창 */}
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
                      className="w-full bg-gray-800/90 border-gray-700 text-white placeholder:text-gray-500 resize-none min-h-[100px] max-h-[200px] text-base"
                      rows={4}
                    />
                  </div>
                )}
              </div>
            )}

            <div ref={contentEndRef} />
          </div>
        </div>
      </div>
    </AppLayout>
  );
};

export default StoryDiveNovelPage;

