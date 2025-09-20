/**
 * 채팅 페이지
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import ErrorBoundary from '../components/ErrorBoundary';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useSocket } from '../contexts/SocketContext';
import { charactersAPI, chatAPI, usersAPI, origChatAPI } from '../lib/api'; // usersAPI 추가
import { resolveImageUrl, getCharacterPrimaryImage, buildPortraitSrcSet } from '../lib/images';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '../components/ui/avatar';
import { Alert, AlertDescription } from '../components/ui/alert';
import { 
  ArrowLeft, 
  Send, 
  Loader2,
  MessageCircle,
  User,
  Bot,
  AlertCircle,
  Trash2,
  MoreVertical,
  Settings,
  Book,
  UserCog,
  Copy,
  ThumbsUp,
  ThumbsDown,
  RefreshCcw,
  Pencil,
  FastForward,
  Asterisk,
  ChevronLeft,
  ChevronRight
} from 'lucide-react';
import { Textarea } from '../components/ui/textarea'; // Textarea 추가
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '../components/ui/alert-dialog';
import { Tooltip, TooltipTrigger, TooltipContent } from '../components/ui/tooltip';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu';
import ModelSelectionModal from '../components/ModelSelectionModal';

const ChatPage = () => {
  const { characterId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { 
    socket,
    connected, 
    messages, 
    aiTyping,
    joinRoom, 
    leaveRoom, 
    sendMessage: sendSocketMessage, 
    getMessageHistory,
    setMessages,
    historyLoading,
    hasMoreMessages,
    currentPage,
    currentRoom,
  } = useSocket();
  
  const [character, setCharacter] = useState(null);
  const [chatRoomId, setChatRoomId] = useState(null);
  const [newMessage, setNewMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModelModal, setShowModelModal] = useState(false);
  const [modalInitialTab, setModalInitialTab] = useState('model');
  const [currentModel, setCurrentModel] = useState('gemini');
  const [currentSubModel, setCurrentSubModel] = useState('gemini-2.5-pro');
  const [editingMessageId, setEditingMessageId] = useState(null);
  const [editText, setEditText] = useState('');
  const [regenOpen, setRegenOpen] = useState(false);
  const [regenInstruction, setRegenInstruction] = useState('');
  const [regenTargetId, setRegenTargetId] = useState(null);
  // 이미지 캐러셀 상태
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const [characterImages, setCharacterImages] = useState([]);
  // 전역 UI 설정(로컬)
  const [uiFontSize, setUiFontSize] = useState('base'); // sm|base|lg|xl
  const [uiLetterSpacing, setUiLetterSpacing] = useState('normal'); // tighter|tight|normal|wide|wider
  const [uiOverlay, setUiOverlay] = useState(60); // 0~100
  const [uiFontFamily, setUiFontFamily] = useState('sans'); // sans|serif
  const [uiColors, setUiColors] = useState({
    charSpeech: '#ffffff',
    charNarration: '#cfcfcf',
    userSpeech: '#111111',
    userNarration: '#333333'
  });
  const [uiTheme, setUiTheme] = useState('system');
  const [typingSpeed, setTypingSpeed] = useState(40);
  // 해상된 테마 상태 (light/dark)
  const [resolvedTheme, setResolvedTheme] = useState('dark');
  // 원작챗 상태
  const [isOrigChat, setIsOrigChat] = useState(false);
  const [origAnchor, setOrigAnchor] = useState(null);
  const [origStoryId, setOrigStoryId] = useState(null);
  const [origTotalChapters, setOrigTotalChapters] = useState(null);
  const [origRangeFrom, setOrigRangeFrom] = useState(null);
  const [origRangeTo, setOrigRangeTo] = useState(null);
  const [origTurnLoading, setOrigTurnLoading] = useState(false);
  const [lastOrigTurnPayload, setLastOrigTurnPayload] = useState(null);
  const [relTrust, setRelTrust] = useState(50);
  const [relAffinity, setRelAffinity] = useState(50);
  const [relTension, setRelTension] = useState(50);
  const [pendingChoices, setPendingChoices] = useState([]);
  const [rangeWarning, setRangeWarning] = useState('');
  
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const chatContainerRef = useRef(null); // For scroll handling
  const prevScrollHeightRef = useRef(0); // For scroll position restoration

  // AI 메타 주석(예: "(성향 점수 35...)") 제거
  const sanitizeAiText = useCallback((text) => {
    if (!text) return text;
    const lines = String(text).split('\n');
    const isStageDirection = (s) => {
      const trimmed = s.trim();
      // 괄호/대괄호로 둘러싸인 한 줄 메타 주석 + 키워드 포함 시 제거
      const bracketed = /^(\(|\[)[^()\[\]\n]{1,120}(\)|\])$/.test(trimmed);
      const hasMetaKeyword = /(성향|점수|반영|반응|스타일|톤|지시|시스템|요약|메타|분석|설정|컨텍스트)/.test(trimmed);
      return bracketed && hasMetaKeyword;
    };
    while (lines.length && isStageDirection(lines[0])) {
      lines.shift();
    }
    return lines.join('\n').replace(/^\s+/, '');
  }, []);

  useEffect(() => {
    const initializeChat = async () => {
      setLoading(true);
      setError('');
      try {
        // 1. 캐릭터 정보 로드
        const charResponse = await charactersAPI.getCharacter(characterId);
        // 상반신 노출을 위해 thumbnail_url이 없으면 avatar_url을 대체 소스로 사용
        const data = charResponse.data;
        setCharacter({
          ...data,
          thumbnail_url: data.thumbnail_url || data.avatar_url,
        });

        // 캐릭터 이미지 배열 수집: avatar + image_descriptions + (없으면) thumbnail, 중복 제거
        try {
          const main = data?.avatar_url ? [data.avatar_url] : [];
          const gallery = Array.isArray(data?.image_descriptions)
            ? data.image_descriptions.map((d) => d?.url).filter(Boolean)
            : [];
          const fallback = !main.length && !gallery.length && data?.thumbnail_url ? [data.thumbnail_url] : [];
          const unique = Array.from(new Set([...main, ...gallery, ...fallback]));
          setCharacterImages(unique);
          setCurrentImageIndex(0);
        } catch (_) {
          // ignore image collection failure
        }

        // 2. 🔥 채팅방 정보 가져오기 또는 생성
        const params = new URLSearchParams(location.search || '');
        const explicitRoom = params.get('room');
        const forceNew = params.get('new') === '1';
        const source = params.get('source');
        const anchorParam = params.get('anchor');
        const storyIdParam = params.get('storyId');
        const rangeFromParam = params.get('rangeFrom');
        const rangeToParam = params.get('rangeTo');
        let roomId = explicitRoom || null;

        if (!roomId) {
          if (forceNew) {
            const roomResponse = await chatAPI.startChat(characterId);
            roomId = roomResponse.data.id;
          } else {
            // 최근 대화 방 시도: 서버 세션 목록에서 검색
            try {
              const sessionsRes = await chatAPI.getChatSessions();
              const latest = (Array.isArray(sessionsRes.data) ? sessionsRes.data : []).find(s => String(s.character_id) === String(characterId));
              if (latest) roomId = latest.id;
            } catch (_) {}
            if (!roomId) {
              const roomResponse = await chatAPI.startChat(characterId);
              roomId = roomResponse.data.id;
            }
          }
        }
        
        setChatRoomId(roomId);

        // 원작챗 컨텍스트 프리페치
        if (source === 'origchat' && storyIdParam) {
          try {
            setIsOrigChat(true);
            const a = Number(anchorParam) || 1;
            setOrigAnchor(a);
            setOrigStoryId(storyIdParam);
            const rf = rangeFromParam ? Number(rangeFromParam) : null;
            const rt = rangeToParam ? Number(rangeToParam) : null;
            if (rf) setOrigRangeFrom(rf);
            if (rt) setOrigRangeTo(rt);
            const ctxRes = await origChatAPI.getContextPack(storyIdParam, { anchor: a, characterId });
            const actor = ctxRes.data?.actor_context || {};
            const director = ctxRes.data?.director_context || {};
            if (typeof actor.trust === 'number') setRelTrust(actor.trust);
            if (typeof actor.affinity === 'number') setRelAffinity(actor.affinity);
            if (typeof actor.tension === 'number') setRelTension(actor.tension);
            if (typeof director.total_chapters === 'number') setOrigTotalChapters(director.total_chapters);
          } catch (_) {
            // 실패해도 일반 챗은 진행 가능
          }
        }

      } catch (err) {
        console.error('채팅 초기화 실패:', err);
        setError('채팅방을 불러올 수 없습니다. 페이지를 새로고침 해주세요.');
      } finally {
        setLoading(false);
      }
    };
    initializeChat();

    // 전역 UI 설정 로드
    try {
      const raw = localStorage.getItem('cc:ui:v1');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed.fontSize) setUiFontSize(parsed.fontSize);
        if (parsed.letterSpacing) setUiLetterSpacing(parsed.letterSpacing);
        if (typeof parsed.overlay === 'number') setUiOverlay(parsed.overlay);
        if (parsed.fontFamily) setUiFontFamily(parsed.fontFamily);
        if (parsed.colors) setUiColors({
          charSpeech: parsed.colors.charSpeech || '#ffffff',
          charNarration: parsed.colors.charNarration || '#cfcfcf',
          userSpeech: parsed.colors.userSpeech || '#111111',
          userNarration: parsed.colors.userNarration || '#333333'
        });
        if (parsed.theme) setUiTheme(parsed.theme);
        if (typeof parsed.typingSpeed === 'number') setTypingSpeed(parsed.typingSpeed);
      }
    } catch (_) {}

    // 설정 변경 브로드캐스트 수신
    const onUiChanged = (e) => {
      try {
        const d = e?.detail || {};
        if (d.fontSize) setUiFontSize(d.fontSize);
        if (d.letterSpacing) setUiLetterSpacing(d.letterSpacing);
        if (typeof d.overlay === 'number') setUiOverlay(d.overlay);
        if (d.fontFamily) setUiFontFamily(d.fontFamily);
        if (d.colors) setUiColors({
          charSpeech: d.colors.charSpeech || '#ffffff',
          charNarration: d.colors.charNarration || '#cfcfcf',
          userSpeech: d.colors.userSpeech || '#111111',
          userNarration: d.colors.userNarration || '#333333'
        });
        if (d.theme) setUiTheme(d.theme);
        if (typeof d.typingSpeed === 'number') setTypingSpeed(d.typingSpeed);
      } catch (_) {}
    };
    window.addEventListener('ui:settingsChanged', onUiChanged);

    // 컴포넌트 언마운트 시 채팅방 나가기
    return () => {
      if (chatRoomId) {
        leaveRoom(chatRoomId);
      }
      // 페이지 이동 시 메시지를 보존하기 위해 초기화하지 않음
      window.removeEventListener('ui:settingsChanged', onUiChanged);
    };
  }, [characterId, leaveRoom, location.search]); // chatRoomId 제거

  // 테마 적용: documentElement에 data-theme 설정
  useEffect(() => {
    const resolveTheme = () => {
      if (uiTheme === 'system') {
        try { return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'; } catch (_) { return 'dark'; }
      }
      return uiTheme;
    };
    const t = resolveTheme();
    try { document.documentElement.setAttribute('data-theme', t); } catch (_) {}
  }, [uiTheme]);

  // resolvedTheme 동기화 + 시스템 변경 감지
  useEffect(() => {
    const media = (typeof window !== 'undefined' && window.matchMedia) ? window.matchMedia('(prefers-color-scheme: dark)') : null;
    const compute = () => {
      try {
        const t = (uiTheme === 'system') ? (media && media.matches ? 'dark' : 'light') : uiTheme;
        setResolvedTheme(t);
      } catch (_) { setResolvedTheme('dark'); }
    };
    compute();
    if (uiTheme === 'system' && media) {
      try { media.addEventListener('change', compute); } catch { try { media.addListener(compute); } catch {} }
      return () => { try { media.removeEventListener('change', compute); } catch { try { media.removeListener(compute); } catch {} } };
    }
  }, [uiTheme]);

  useEffect(() => {
    // 소켓 연결 및 채팅방 정보 로드 완료 후 채팅방 입장
    if (connected && chatRoomId && currentRoom?.id !== chatRoomId) {
        joinRoom(chatRoomId);
        getMessageHistory(chatRoomId, 1);
    }
  }, [connected, chatRoomId, currentRoom]); // currentRoom 추가하여 중복 입장 방지

  // 서버에서 인사말을 저장하므로, 클라이언트에서 별도 주입하지 않습니다.


  useEffect(() => {
    // 신규 메시지 수신 시 맨 아래로 스크롤
    if (messages.length > 0) {
      const lastMessage = messages[messages.length - 1];
      // 내가 보낸 메시지거나, 스트리밍이 아닌 AI 메시지일 때만 자동 스크롤
      if (lastMessage.senderType === 'user' || !lastMessage.isStreaming) {
         scrollToBottom();
      }
    }
  }, [messages]);
  
  useEffect(() => {
    // 과거 메시지 로드 후 스크롤 위치 복원
    if (chatContainerRef.current && prevScrollHeightRef.current) {
        chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight - prevScrollHeightRef.current;
        prevScrollHeightRef.current = 0; // Reset after use
    }
  }, [messages]);


  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    // Textarea 높이 자동 조절
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
      inputRef.current.style.height = `${inputRef.current.scrollHeight}px`;
    }
  }, [newMessage]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView(); // behavior: 'smooth' 제거하여 즉시 스크롤
  };
  
  const handleScroll = useCallback(() => {
    if (chatContainerRef.current) {
      const { scrollTop } = chatContainerRef.current;
      if (scrollTop === 0 && hasMoreMessages && !historyLoading) {
        prevScrollHeightRef.current = chatContainerRef.current.scrollHeight;
        getMessageHistory(chatRoomId, currentPage + 1);
      }
    }
  }, [hasMoreMessages, historyLoading, getMessageHistory, chatRoomId, currentPage]);


  const handleSendMessage = async (e) => {
    e.preventDefault();
    if (!newMessage.trim() || !chatRoomId || !connected) return;

    const messageContentRaw = newMessage.trim();
    const isNarration = messageContentRaw.startsWith('*');
    const messageContent = isNarration ? messageContentRaw.replace(/^\*\s*/, '') : messageContentRaw;
    const messageType = isNarration ? 'narration' : 'text';
    
    // Optimistic UI Update for user message
    const tempUserMessage = {
      id: `temp-user-${Date.now()}`,
      roomId: chatRoomId,
      senderType: 'user',
      senderId: user.id,
      content: messageContent,
      isNarration: isNarration,
      created_at: new Date().toISOString()
    };
    setMessages(prev => [...prev, tempUserMessage]);
    
    // 원작챗이면 HTTP 턴 호출, 아니면 소켓 전송
    if (isOrigChat && origStoryId) {
      try {
        setOrigTurnLoading(true);
        const payload = { room_id: chatRoomId, user_text: messageContent };
        setLastOrigTurnPayload(payload);
        const resp = await origChatAPI.turn(payload);
        const assistantText = resp.data?.ai_message?.content || resp.data?.assistant || '';
        const meta = resp.data?.meta || {};
        const aiMessage = {
          id: `temp-ai-${Date.now()}`,
          roomId: chatRoomId,
          senderType: 'assistant',
          content: assistantText,
          created_at: new Date().toISOString()
        };
        setMessages(prev => [...prev, aiMessage]);
        // 관계 미터 업데이트(클램핑)
        const clamp = (v) => Math.max(0, Math.min(100, v));
        const d = meta.deltas || {};
        if (typeof d.trust === 'number') setRelTrust(prev => clamp((prev ?? 50) + d.trust));
        if (typeof d.affinity === 'number') setRelAffinity(prev => clamp((prev ?? 50) + d.affinity));
        if (typeof d.tension === 'number') setRelTension(prev => clamp((prev ?? 50) + d.tension));
        setPendingChoices(Array.isArray(meta.choices) ? meta.choices : []);
        // 경고 문구 처리
        const warn = meta.warning;
        setRangeWarning(typeof warn === 'string' ? warn : '');
      } catch (err) {
        console.error('원작챗 턴 실패', err);
        try {
          const retry = window.confirm('응답 생성에 실패했습니다. 다시 시도할까요?');
          if (retry && lastOrigTurnPayload) {
            const resp = await origChatAPI.turn(lastOrigTurnPayload);
            const assistantText = resp.data?.assistant || '';
            const meta = resp.data?.meta || {};
            const aiMessage = {
              id: `temp-ai-${Date.now()}`,
              roomId: chatRoomId,
              senderType: 'assistant',
              content: assistantText,
              created_at: new Date().toISOString()
            };
            setMessages(prev => [...prev, aiMessage]);
            const clamp = (v) => Math.max(0, Math.min(100, v));
            const d = meta.deltas || {};
            if (typeof d.trust === 'number') setRelTrust(prev => clamp((prev ?? 50) + d.trust));
            if (typeof d.affinity === 'number') setRelAffinity(prev => clamp((prev ?? 50) + d.affinity));
            if (typeof d.tension === 'number') setRelTension(prev => clamp((prev ?? 50) + d.tension));
            setPendingChoices(Array.isArray(meta.choices) ? meta.choices : []);
            const warn = meta.warning;
            setRangeWarning(typeof warn === 'string' ? warn : '');
          }
        } catch(_) {}
      } finally {
        setOrigTurnLoading(false);
      }
      setNewMessage('');
      if (inputRef.current) { inputRef.current.style.height = 'auto'; }
      return;
    } else {
      // Send message via socket
      sendSocketMessage(chatRoomId, messageContent, messageType);
      setNewMessage('');
      if (inputRef.current) {
        inputRef.current.style.height = 'auto';
      }
    }
  };

  const handleSelectChoice = async (choice) => {
    if (!chatRoomId) return;
    // 사용자 선택을 즉시 UI에 표시
    const tempUser = {
      id: `temp-user-choice-${Date.now()}`,
      roomId: chatRoomId,
      senderType: 'user',
      content: choice.label,
      isNarration: false,
      created_at: new Date().toISOString()
    };
    setMessages(prev => [...prev, tempUser]);
    setPendingChoices([]);
    try {
      setOrigTurnLoading(true);
      const payload = { room_id: chatRoomId, choice_id: choice.id, user_text: choice.label };
      setLastOrigTurnPayload(payload);
      const resp = await origChatAPI.turn(payload);
      const assistantText = resp.data?.ai_message?.content || resp.data?.assistant || '';
      const meta = resp.data?.meta || {};
      // 요구사항: 선택 문장에 이어서 말풍선으로 나오기 → 선택 문장 + AI 답변 결합
      const combined = `${choice.label}\n\n${assistantText}`;
      const aiMessage = {
        id: `temp-ai-${Date.now()}`,
        roomId: chatRoomId,
        senderType: 'assistant',
        content: combined,
        created_at: new Date().toISOString()
      };
      setMessages(prev => [...prev, aiMessage]);
      const clamp = (v) => Math.max(0, Math.min(100, v));
      const d = meta.deltas || {};
      if (typeof d.trust === 'number') setRelTrust(prev => clamp((prev ?? 50) + d.trust));
      if (typeof d.affinity === 'number') setRelAffinity(prev => clamp((prev ?? 50) + d.affinity));
      if (typeof d.tension === 'number') setRelTension(prev => clamp((prev ?? 50) + d.tension));
      setPendingChoices(Array.isArray(meta.choices) ? meta.choices : []);
      const warn = meta.warning;
      setRangeWarning(typeof warn === 'string' ? warn : '');
    } catch (e) {
      console.error('선택 처리 실패', e);
      try {
        const retry = window.confirm('응답 생성에 실패했습니다. 다시 시도할까요?');
        if (retry && lastOrigTurnPayload) {
          const resp = await origChatAPI.turn(lastOrigTurnPayload);
          const assistantText = resp.data?.assistant || '';
          const meta = resp.data?.meta || {};
          const combined = `${choice.label}\n\n${assistantText}`;
          const aiMessage = {
            id: `temp-ai-${Date.now()}`,
            roomId: chatRoomId,
            senderType: 'assistant',
            content: combined,
            created_at: new Date().toISOString()
          };
          setMessages(prev => [...prev, aiMessage]);
          const clamp = (v) => Math.max(0, Math.min(100, v));
          const d = meta.deltas || {};
          if (typeof d.trust === 'number') setRelTrust(prev => clamp((prev ?? 50) + d.trust));
          if (typeof d.affinity === 'number') setRelAffinity(prev => clamp((prev ?? 50) + d.affinity));
          if (typeof d.tension === 'number') setRelTension(prev => clamp((prev ?? 50) + d.tension));
          setPendingChoices(Array.isArray(meta.choices) ? meta.choices : []);
          const warn = meta.warning;
          setRangeWarning(typeof warn === 'string' ? warn : '');
        }
      } catch(_) {}
    } finally {
      setOrigTurnLoading(false);
    }
  };
  
  // 대화 초기화
  const handleClearChat = async () => {
    if (!chatRoomId) return;
    
    try {
      await chatAPI.clearChatMessages(chatRoomId);
      setMessages([]);
      // 페이지 새로고침하거나 소켓 재연결
      window.location.reload();
    } catch (error) {
      console.error('대화 초기화 실패:', error);
      setError('대화 초기화에 실패했습니다.');
    }
  };

  // 모델 변경 핸들러
  const handleModelChange = (modelId, subModelId) => {
    setCurrentModel(modelId);
    setCurrentSubModel(subModelId);
    console.log(`모델 변경: ${modelId} - ${subModelId}`);
  };

  // 사용자 모델 설정 로드
  useEffect(() => {
    const loadUserModelSettings = async () => {
      try {
        const response = await usersAPI.getModelSettings();
        setCurrentModel(response.data.preferred_model || 'gemini');
        setCurrentSubModel(response.data.preferred_sub_model || 'gemini-2.5-pro');
      } catch (error) {
        console.error('모델 설정 로드 실패:', error);
      }
    };

    if (user) {
      loadUserModelSettings();
    }
  }, [user]);

  const handleKeyDown = (e) => {
    // 한글 조합 중일 때는 무시
    if (e.isComposing || e.keyCode === 229) {
      return;
    }
    
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage(e);
    }
  };

  // 캐러셀 네비게이션 및 비활성화 상태
  const handlePrevImage = () => {
    setCurrentImageIndex((prev) => Math.max(0, prev - 1));
  };

  const handleNextImage = () => {
    setCurrentImageIndex((prev) => Math.min(Math.max(0, characterImages.length - 1), prev + 1));
  };

  const isPrevDisabled = currentImageIndex === 0;
  const isNextDisabled = characterImages.length === 0 || currentImageIndex === characterImages.length - 1;

  // 선택 썸네일이 항상 보이도록 자동 스크롤
  useEffect(() => {
    try {
      const gallery = document.getElementById('thumbnail-gallery');
      const el = gallery?.children?.[currentImageIndex];
      if (el && typeof el.scrollIntoView === 'function') {
        el.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
      }
    } catch (_) {}
  }, [currentImageIndex]);

  const canSend = Boolean(newMessage.trim()) && connected;
  const textSizeClass = uiFontSize==='sm' ? 'text-sm' : uiFontSize==='lg' ? 'text-lg' : uiFontSize==='xl' ? 'text-xl' : 'text-base';
  
  const handleCopy = async (text) => { try { await navigator.clipboard.writeText(text); } catch(_) {} };
  const handleFeedback = async (msg, type) => {
    try {
      const res = await chatAPI.feedbackMessage(msg.id, type === 'up' ? 'upvote' : 'downvote');
      const updated = res.data;
      setMessages(prev => prev.map(m => m.id === updated.id ? { ...m, upvotes: updated.upvotes, downvotes: updated.downvotes } : m));
      // 토스트
      try { window.dispatchEvent(new CustomEvent('toast', { detail: { type: 'success', message: type==='up'?'추천됨':'비추천됨' } })); } catch(_) {}
    } catch (e) {
      console.error('피드백 실패:', e);
      try { window.dispatchEvent(new CustomEvent('toast', { detail: { type: 'error', message: '처리에 실패했습니다' } })); } catch(_) {}
    }
  };
  const openRegenerate = (msg) => { setRegenTargetId(msg.id); setRegenInstruction(''); setRegenOpen(true); };
  const startEdit = (msg) => {
    setEditingMessageId(msg.id);
    const base = msg.content || '';
    const edited = (msg.senderType === 'user' || msg.sender_type === 'user') ? base : sanitizeAiText(base);
    setEditText(edited);
  };
  const saveEdit = async () => {
    if (!editingMessageId) return;
    try {
      const res = await chatAPI.updateMessage(editingMessageId, editText);
      const updated = res.data;
      setMessages(prev => prev.map(m => m.id === updated.id ? { ...m, content: updated.content } : m));
    } catch (e) { console.error('메시지 수정 실패:', e); }
    setEditingMessageId(null); setEditText('');
  };
  const cancelEdit = () => { setEditingMessageId(null); setEditText(''); };
  const confirmRegenerate = async () => {
    if (!regenTargetId) return;
    try {
      const res = await chatAPI.regenerateMessage(regenTargetId, regenInstruction);
      const { ai_message } = res.data || {};
      if (ai_message) { setMessages(prev => [...prev, { ...ai_message, senderType: ai_message.sender_type }]); scrollToBottom(); }
    } catch (e) { console.error('재생성 실패:', e); }
    setRegenOpen(false); setRegenInstruction(''); setRegenTargetId(null);
  };
  
  const MessageBubble = ({ message, isLast }) => {
    const isUser = message.senderType === 'user' || message.sender_type === 'user';
    const bubbleRef = isLast ? messagesEndRef : null;

    return (
      <div ref={bubbleRef} className={`mt-4 mb-1 ${isUser ? 'flex flex-col items-end' : 'flex flex-col'}`}>
        <div className={`flex items-center gap-2 ${isUser ? 'justify-end' : ''} mt-0 mb-1`}>
          {!isUser && (
            <>
              <Avatar className="size-10 rounded-full">
                <AvatarImage className="object-cover object-top" src={getCharacterPrimaryImage(character)} alt={character?.name} />
              <AvatarFallback className="bg-gradient-to-r from-purple-500 to-blue-500 text-white">
                {character?.name?.charAt(0) || <Bot className="w-4 h-4" />}
              </AvatarFallback>
              </Avatar>
              <span className="text-sm text-gray-300">{character?.name}</span>
            </>
          )}
        </div>

        <div
          className={`max-w-full sm:max-w-[85%] px-3 py-2 rounded-2xl shadow-md ${isUser ? 'rounded-tr-none' : 'rounded-tl-none'}
            ${isUser
              ? (resolvedTheme === 'light' ? 'bg-white border border-gray-300' : 'bg-white text-black')
              : (resolvedTheme === 'light' ? 'bg-white border border-gray-300' : 'bg-white/10 lg:bg-white/10')}
          `}
          style={{ color: isUser
            ? (resolvedTheme === 'light' ? (message.isNarration ? '#111827' : '#111827') : (message.isNarration ? uiColors.userNarration : uiColors.userSpeech))
            : (resolvedTheme === 'light' ? '#0b0b0b' : (message.isNarration ? uiColors.charNarration : uiColors.charSpeech))
          }}
        >
          {(!isUser && editingMessageId === message.id) ? (
            <div className="space-y-2">
              <Textarea value={editText} onChange={(e)=>setEditText(e.target.value)} rows={4} />
              <div className="flex gap-2 justify-end">
                <Button size="sm" variant="outline" onClick={cancelEdit}>취소</Button>
                <Button size="sm" onClick={saveEdit}>저장</Button>
              </div>
            </div>
          ) : (
            <>
              <p className={`whitespace-pre-wrap select-text ${isUser && (message.isNarration || message.messageType==='narration' || message.content?.startsWith('*')) ? 'italic' : ''}`}>
                {isUser ? (message.isNarration ? `* ${message.content}` : message.content) : sanitizeAiText(message.content)}
            {message.isStreaming && <span className="streaming-cursor"></span>}
          </p>
              <p className={`text-xs mt-1 text-right ${isUser ? 'text-gray-500' : 'text-gray-400'}`}>
            {new Date(message.created_at || message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </p>
              {/* 툴바는 말풍선 바깥으로 이동 (아래에서 렌더) */}
            </>
          )}
        </div>
        {/* 말풍선 바깥 하단 툴바 (AI 메시지 전용) */}
        {!isUser && (
          <div className="mt-1 max-w-full sm:max-w-[85%]">
            <div className="flex items-center gap-2 text-[var(--app-fg)]">
              <Tooltip><TooltipTrigger asChild>
                <button onClick={()=>handleCopy(message.content)} className="p-1.5 rounded hover:bg-[var(--hover-bg)] text-[var(--app-fg)]"><Copy className="w-4 h-4"/></button>
              </TooltipTrigger><TooltipContent>복사</TooltipContent></Tooltip>
              <Tooltip><TooltipTrigger asChild>
                <button onClick={()=>handleFeedback(message,'up')} className="p-1.5 rounded hover:bg-[var(--hover-bg)] text-[var(--app-fg)]"><ThumbsUp className="w-4 h-4"/></button>
              </TooltipTrigger><TooltipContent>추천</TooltipContent></Tooltip>
              <Tooltip><TooltipTrigger asChild>
                <button onClick={()=>handleFeedback(message,'down')} className="p-1.5 rounded hover:bg-[var(--hover-bg)] text-[var(--app-fg)]"><ThumbsDown className="w-4 h-4"/></button>
              </TooltipTrigger><TooltipContent>비추천</TooltipContent></Tooltip>
              <Tooltip><TooltipTrigger asChild>
                <button onClick={()=>startEdit(message)} className="p-1.5 rounded hover:bg-[var(--hover-bg)] text-[var(--app-fg)]"><Pencil className="w-4 h-4"/></button>
              </TooltipTrigger><TooltipContent>수정</TooltipContent></Tooltip>
              {isLast && (
                <>
                  <Tooltip><TooltipTrigger asChild>
                    <button onClick={()=>openRegenerate(message)} className="p-1.5 rounded hover:bg-[var(--hover-bg)] text-[var(--app-fg)]"><RefreshCcw className="w-4 h-4"/></button>
                  </TooltipTrigger><TooltipContent>재생성</TooltipContent></Tooltip>
                  <Tooltip><TooltipTrigger asChild>
                    <button onClick={()=>sendSocketMessage(chatRoomId,'','continue')} className="p-1.5 rounded hover:bg-[var(--hover-bg)] text-[var(--app-fg)]"><FastForward className="w-4 h-4"/></button>
                  </TooltipTrigger><TooltipContent>계속</TooltipContent></Tooltip>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    );
  };

  if (loading && !character) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-50 via-blue-50 to-indigo-50 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4" />
          <p className="text-gray-600">캐릭터 정보를 불러오는 중...</p>
        </div>
      </div>
    );
  }

  if (error && !character) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-50 via-blue-50 to-indigo-50 flex items-center justify-center">
        <div className="text-center">
          <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">오류가 발생했습니다</h3>
          <p className="text-gray-600 mb-4">{error}</p>
          <Button onClick={() => navigate('/')} variant="outline">
            홈으로 돌아가기
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen bg-[var(--app-bg)] text-[var(--app-fg)] flex flex-col">
      {/* 헤더 */}
      <header className="bg-[var(--header-bg)] text-[var(--app-fg)] shadow-sm border-b border-gray-800 z-10">
        <div className="w-full">
          <div className="flex items-center justify-between h-16 px-4 sm:px-6 lg:px-8 lg:max-w-[1200px] lg:mx-auto">
            <div className="flex items-center space-x-2">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => navigate('/')}
                className="rounded-full text-[var(--app-fg)] hover:bg-[var(--hover-bg)]"
              >
                <ArrowLeft className="w-5 h-5" />
              </Button>
              <div className="flex items-center space-x-3">
                <Avatar className="w-10 h-10 border-2 border-white shadow-sm">
                  <AvatarImage className="object-cover object-top" src={getCharacterPrimaryImage(character)} alt={character?.name} />
                  <AvatarFallback className="bg-gradient-to-r from-purple-500 to-blue-500 text-white">
                    {character?.name?.charAt(0) || <Bot className="w-5 h-5" />}
                  </AvatarFallback>
                </Avatar>
                <div className="leading-tight">
                  <div className="flex items-baseline gap-2">
                    <h1 className="text-md font-bold text-[var(--app-fg)]">{character?.name}</h1>
                    <span className="text-xs text-gray-400">{aiTyping ? '입력 중...' : '온라인'}</span>
                  </div>
                  {isOrigChat && (
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-orange-400 text-black">원작챗</span>
                      {origAnchor && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-700 text-gray-200">앵커 {origAnchor}화</span>
                      )}
                      {(origRangeFrom && origRangeTo) && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-700 text-gray-200">범위 {origRangeFrom}~{origRangeTo}화</span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              {isOrigChat && (
                <div className="hidden md:flex items-center gap-2 text-xs">
                  <div className="flex items-center gap-1"><span className="text-gray-400">신뢰</span><div className="w-16 h-2 bg-gray-700 rounded"><div className="h-2 bg-green-500 rounded" style={{ width: `${relTrust}%` }} /></div></div>
                  <div className="flex items-center gap-1"><span className="text-gray-400">호감</span><div className="w-16 h-2 bg-gray-700 rounded"><div className="h-2 bg-pink-500 rounded" style={{ width: `${relAffinity}%` }} /></div></div>
                  <div className="flex items-center gap-1"><span className="text-gray-400">긴장</span><div className="w-16 h-2 bg-gray-700 rounded"><div className="h-2 bg-yellow-400 rounded" style={{ width: `${relTension}%` }} /></div></div>
                </div>
              )}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="rounded-full text-[var(--app-fg)] hover:bg-[var(--hover-bg)]">
                    <MoreVertical className="w-5 h-5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => {
                    setModalInitialTab('model');
                    setShowModelModal(true);
                  }}>
                    <Settings className="w-4 h-4 mr-2" />
                    모델 설정
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => {
                    setModalInitialTab('profile');
                    setShowModelModal(true);
                  }}>
                    <UserCog className="w-4 h-4 mr-2" />
                    유저 페르소나
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => {
                    setModalInitialTab('notes');
                    setShowModelModal(true);
                  }}>
                    <Book className="w-4 h-4 mr-2" />
                    기억노트
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => {
                    setModalInitialTab('settings');
                    setShowModelModal(true);
                  }}>
                    <Settings className="w-4 h-4 mr-2" />
                    추가 설정
                  </DropdownMenuItem>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <DropdownMenuItem onSelect={(e) => e.preventDefault()}>
                        <Trash2 className="w-4 h-4 mr-2" />
                        대화 내용 초기화
                      </DropdownMenuItem>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>대화 내용을 초기화하시겠습니까?</AlertDialogTitle>
                        <AlertDialogDescription>
                          이 작업은 되돌릴 수 없습니다. 모든 대화 내용이 삭제됩니다.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>취소</AlertDialogCancel>
                        <AlertDialogAction onClick={handleClearChat}>
                          초기화
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </div>
      </header>

      {/* 본문: 데스크톱 좌측 이미지 패널, 모바일은 배경 이미지 */}
      <div className="flex-1 overflow-hidden bg-[var(--app-bg)] text-[var(--app-fg)]">
        <div className="grid grid-cols-1 lg:grid-cols-[480px_auto] lg:justify-center h-[calc(100vh-4rem)]">
          <aside className="hidden lg:block border-r bg-black/10 relative">
            <div className="sticky top-16 h-[calc(100vh-4rem)] relative">
              {/* 캐러셀: 상반신 기준 포트레이트 */}
              {(() => {
                const primary = getCharacterPrimaryImage(character);
                const currentImage = (characterImages && characterImages.length > 0)
                  ? characterImages[currentImageIndex]
                  : primary;
                const { src, srcSet, sizes, width, height } = buildPortraitSrcSet(currentImage);
                return (
                  <img
                    className="w-full h-full object-cover object-top"
                    src={src}
                    srcSet={srcSet}
                    sizes={sizes}
                    width={width}
                    height={height}
                    alt={character?.name}
                    loading="eager"
                  />
                );
              })()}
              {/* 배경 오버레이 */}
              <div className="absolute inset-0 pointer-events-none" style={{ backgroundColor: `rgba(0,0,0,${Math.max(0, Math.min(100, uiOverlay))/100})` }} />
              
            </div>
          </aside>
          <main
            ref={chatContainerRef}
            onScroll={handleScroll}
            className="relative overflow-y-auto p-4 md:p-6 lg:px-8 pt-24 lg:pt-28 bg-[var(--app-bg)] scrollbar-dark"
            style={{}}
          >
            <div className={`relative z-10 w-full lg:max-w-[560px] mx-auto space-y-6 mt-2 ${textSizeClass} ${
              uiLetterSpacing==='tighter'?'tracking-tighter':uiLetterSpacing==='tight'?'tracking-tight':uiLetterSpacing==='wide'?'tracking-wide':uiLetterSpacing==='wider'?'tracking-wider':'tracking-normal'
            } ${uiFontFamily==='serif'?'font-serif':'font-sans'}`}>
          {historyLoading && (
            <div className="flex justify-center py-4">
              <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
            </div>
          )}
          {error && (
            <Alert variant="destructive" className="mb-4">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {messages.length === 0 && !aiTyping ? (
            <div className="text-center py-8">
              <MessageCircle className="w-12 h-12 text-gray-300 mx-auto mb-4" />
              <p className="text-gray-500">
                {character?.name}에게 첫 메시지를 보내보세요.
              </p>
              <p className="text-sm text-gray-400 mt-1">
                {character?.description}
              </p>
            </div>
          ) : (
            <ErrorBoundary>
              {messages.map((message, index) => (
                <MessageBubble 
                  key={message.id || `msg-${index}`} 
                  message={message}
                  isLast={index === messages.length - 1 && !aiTyping} 
                />
              ))}
              {/* 범위 가드 경고 문구 */}
              {isOrigChat && rangeWarning && (
                <div className="mt-2 ml-12 max-w-full sm:max-w-[85%]">
                  <div className="text-xs text-red-400">{rangeWarning}</div>
                </div>
              )}
              {/* 선택지: 채팅창 안에 표시 */}
              {isOrigChat && pendingChoices && pendingChoices.length > 0 && (
                <div className="mt-3 ml-12 max-w-full sm:max-w-[85%]">
                  <div className="space-y-2">
                    {pendingChoices.map((c) => (
                      <button
                        key={c.id}
                        onClick={() => handleSelectChoice(c)}
                        className="w-full text-left px-4 py-2 rounded-xl bg-white/10 text-white border border-gray-700 hover:bg-white/15"
                      >
                        {c.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {aiTyping && (
                <div className="flex items-start space-x-3">
                  <Avatar className="w-8 h-8 flex-shrink-0">
                    <AvatarImage className="object-cover object-top" src={getCharacterPrimaryImage(character)} alt={character?.name} />
                    <AvatarFallback className="bg-gradient-to-r from-purple-500 to-blue-500 text-white">
                      {character?.name?.charAt(0) || <Bot className="w-4 h-4" />}
                    </AvatarFallback>
                  </Avatar>
                  <div className="max-w-xs lg:max-w-md px-4 py-2 rounded-lg shadow-md bg-white/10 text-white">
                    <div className="flex space-x-1">
                      <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
                      <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                      <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
                    </div>
                  </div>
                </div>
              )}
            </ErrorBoundary>
          )}
          <div ref={messagesEndRef} />
        </div>
      </main>
        </div>
      </div>

      {/* 입력 폼 */}
      <footer className="bg-[var(--footer-bg)] text-[var(--app-fg)] border-t border-gray-800 md:p-1">
        <ErrorBoundary>
        <div className="hidden lg:flex lg:w-[1040px] lg:mx-auto lg:items-center">
          {/* 왼쪽: 미니 갤러리 (이미지 아래) */}
          <div className="w-[480px] pr-4 items-center">
            {characterImages && characterImages.length > 1 && (
              <div className="bg-black/70 backdrop-blur-sm rounded-lg p-2">
                <div className="flex items-center justify-center gap-2">
                  {/* Prev */}
                  <Button
                    onClick={handlePrevImage}
                    disabled={isPrevDisabled}
                    className={`rounded-full w-8 h-8 p-0 flex-shrink-0 transition-colors ${
                      isPrevDisabled ? 'bg-white/5 text-white/30 cursor-not-allowed' : 'bg-white/10 hover:bg-white/20 text-white'
                    }`}
                    size="icon"
                  >
                    <ChevronLeft className="w-5 h-5" />
                  </Button>

                  {/* Thumbnails */}
                  <div id="thumbnail-gallery-footer" className="flex gap-1 overflow-x-auto max-w-[320px]">
                    {characterImages.map((img, idx) => (
                      <button
                        key={idx}
                        onClick={() => setCurrentImageIndex(idx)}
                        className={`relative flex-shrink-0 transition-all ${
                          idx === currentImageIndex ? 'ring-2 ring-purple-500 ring-offset-1 ring-offset-black/50' : 'opacity-70 hover:opacity-100'
                        }`}
                        aria-label={`이미지 ${idx + 1}`}
                      >
                        <img
                          src={resolveImageUrl(img)}
                          alt={`썸네일 ${idx + 1}`}
                          className={`w-12 h-12 object-cover object-top rounded ${
                            idx === currentImageIndex ? 'brightness-100' : 'brightness-90'
                          }`}
                        />
                        {idx === currentImageIndex && (
                          <div className="absolute inset-0 border-2 border-purple-500 rounded pointer-events-none" />
                        )}
                      </button>
                    ))}
                  </div>

                  {/* Next */}
                  <Button
                    onClick={handleNextImage}
                    disabled={isNextDisabled}
                    className={`rounded-full w-8 h-8 p-0 flex-shrink-0 transition-colors ${
                      isNextDisabled ? 'bg-white/5 text-white/30 cursor-not-allowed' : 'bg-white/10 hover:bg-white/20 text-white'
                    }`}
                    size="icon"
                  >
                    <ChevronRight className="w-5 h-5" />
                  </Button>
                </div>
              </div>
            )}
          </div>
          
          {/* 오른쪽: 채팅 입력 컨테이너 (채팅 메시지 영역 아래) */}
          <div className="w-[560px]">
          <ErrorBoundary>
          <form onSubmit={handleSendMessage} className="flex w-full items-center gap-2">
            {/* 모델 선택 버튼 */}
            <Button
              type="button"
              className="h-10 w-12 rounded-xl bg-gray-700 hover:bg-gray-600 text-white px-2 leading-tight"
              onClick={() => { setModalInitialTab('model'); setShowModelModal(true); }}
            >
              <span className="block text-[11px] leading-4 text-center">모델<br/>선택</span>
            </Button>

            {/* 입력 컨테이너 */}
            <div className="relative flex min-h-[44px] w-full lg:w-[70%] items-center rounded-2xl py-1 shadow-md"
                 style={{ backgroundColor: 'var(--input-bg)', border: '1px solid var(--input-border)' }}>
            <Textarea
              ref={inputRef}
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              onKeyDown={handleKeyDown}
                placeholder="대사를 입력하세요. 예) 반가워!"
                className="w-full bg-transparent border-0 focus:border-0 focus:ring-0 outline-none text-sm p-0 pl-3 placeholder:text-gray-500 resize-none"
                style={{ minHeight: 36 }}
              rows={1}
            />
            </div>

            {/* 애스터리스크 버튼: 입력 컨테이너 밖 (우측) */}
            <Button
              type="button"
              onClick={() => setNewMessage(prev => (prev.startsWith('*') ? prev : (`* ${prev || ''}`).trimEnd()))}
              className="rounded-full w-10 h-10 p-0 flex-shrink-0 btn-asterisk"
              size="icon"
              variant="ghost"
              title="지문/나레이션 시작"
            >
              <Asterisk className="w-5 h-5" />
            </Button>

            {/* 전송 버튼 */}
            <Button
              type="submit"
              disabled={!canSend}
              className={`rounded-full w-10 h-10 p-0 flex-shrink-0 ${canSend ? 'btn-brand' : 'bg-gray-700 text-gray-400'}`}
              size="icon"
            >
              <Send className="w-5 h-5" />
            </Button>
          </form>
          </ErrorBoundary>
          </div>
        </div>
        </ErrorBoundary>
        
        {/* 모바일용 입력 컨테이너 */}
        <div className="lg:hidden w-full">
          <ErrorBoundary>
          <form onSubmit={handleSendMessage} className="flex w-full items-center gap-2">
            {/* 모델 선택 버튼 */}
            <Button
              type="button"
              className="h-10 w-12 rounded-xl bg-gray-700 hover:bg-gray-600 text-white px-2 leading-tight"
              onClick={() => { setModalInitialTab('model'); setShowModelModal(true); }}
            >
              <span className="block text-[11px] leading-4 text-center">모델<br/>선택</span>
            </Button>

            {/* 입력 컨테이너 */}
            <div className="relative flex min-h-[44px] w-full items-center rounded-2xl py-1 shadow-md"
                 style={{ backgroundColor: 'var(--input-bg)', border: '1px solid var(--input-border)' }}>
              <Textarea
                ref={inputRef}
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="대사를 입력하세요. 예) 반가워!"
                className="w-full bg-transparent border-0 focus:border-0 focus:ring-0 outline-none text-sm p-0 pl-3 placeholder:text-gray-500 resize-none"
                style={{ minHeight: 36 }}
                rows={1}
              />
            </div>

            {/* 애스터리스크 버튼 */}
            <Button
              type="button"
              onClick={() => setNewMessage(prev => (prev.startsWith('*') ? prev : (`* ${prev || ''}`).trimEnd()))}
              className="rounded-full w-10 h-10 p-0 flex-shrink-0 btn-asterisk"
              size="icon"
              variant="ghost"
              title="지문/나레이션 시작"
            >
              <Asterisk className="w-5 h-5" />
            </Button>

            {/* 전송 버튼 */}
            <Button
              type="submit"
              disabled={!canSend}
              className={`rounded-full w-10 h-10 p-0 flex-shrink-0 ${canSend ? 'btn-brand' : 'bg-gray-700 text-gray-400'}`}
              size="icon"
            >
              <Send className="w-5 h-5" />
            </Button>
          </form>
          </ErrorBoundary>
        </div>
      </footer>

      {/* 모델 선택 모달 */}
      <ErrorBoundary>
      <ModelSelectionModal
        isOpen={showModelModal}
        onClose={() => setShowModelModal(false)}
        currentModel={currentModel}
        currentSubModel={currentSubModel}
        onModelChange={handleModelChange}
        initialTab={modalInitialTab}
        characterName={character?.name}
        characterId={character?.id}
      />
      </ErrorBoundary>

      {/* 재생성 모달 */}
      <ErrorBoundary>
      <AlertDialog open={regenOpen} onOpenChange={setRegenOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>재생성 지시사항</AlertDialogTitle>
            <AlertDialogDescription>지시사항을 입력해주세요. (예: “말투를 더 부드럽게”)</AlertDialogDescription>
          </AlertDialogHeader>
          <Textarea rows={4} maxLength={200} value={regenInstruction} onChange={(e)=>setRegenInstruction(e.target.value)} />
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction onClick={confirmRegenerate}>확인</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      </ErrorBoundary>
    </div>
  );
};

export default ChatPage;

