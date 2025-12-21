import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import AppLayout from '../components/layout/AppLayout';
import AgentSidebar from '../components/layout/AgentSidebar';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Textarea } from '../components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
// import { Separator } from '../components/ui/separator';
import { Skeleton } from '../components/ui/skeleton';
import {
Select,
SelectContent,
SelectItem,
SelectTrigger,
SelectValue,
} from '../components/ui/select';
import { EditableSelect } from '../components/ui/editable-select';
import {
Sheet,
SheetContent,
SheetHeader,
SheetTitle,
SheetTrigger,
} from '../components/ui/sheet';
import { RadioGroup, RadioGroupItem } from '../components/ui/radio-group';
import { useNavigate, Link, useLocation } from 'react-router-dom';
import { useVirtualizer } from '@tanstack/react-virtual';
import { storiesAPI, charactersAPI, chatAPI, rankingAPI } from '../lib/api';
// import { generationAPI } from '../lib/generationAPI'; // removed: use existing backend flow
import { Switch } from '../components/ui/switch';
import { DEFAULT_SQUARE_URI } from '../lib/placeholder';
// ChevronDown import 추가 필요 (33번 줄 근처)
import { Loader2, Plus, Send, Sparkles, Image as ImageIcon, Trash2, ChevronLeft, ChevronRight, ChevronDown, X, CornerDownLeft, Copy as CopyIcon, RotateCcw, Settings, Pencil, Check, RefreshCcw, Wand2 } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import StoryExploreCard from '../components/StoryExploreCard';
import { CharacterCard } from '../components/CharacterCard';
import StoryHighlights from '../components/agent/StoryHighlights';
import { useQueryClient } from '@tanstack/react-query';
import ImageGenerateInsertModal from '../components/ImageGenerateInsertModal';
import Composer from '../components/agent/Composer';
import DualResponseBubble from '../components/agent/DualResponseBubble';
import CharacterChatInline from '../components/CharacterChatInline';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuLabel } from '../components/ui/dropdown-menu';

const LS_SESSIONS = (userId) => `agent:sessions:${userId}`;
const LS_MESSAGES_PREFIX = (userId) => `agent:messages:${userId}:`;
const LS_STORIES = (userId) => `agent:stories:${userId}`;
const LS_IMAGES = (userId) => `agent:images:${userId}`;
const LS_CHARACTERS = (userId) => `agent:characters:${userId}`;
const LS_RECOVERY_PREFIX = (userId) => `agent:recovery:${userId}:`;
const LS_UI = (userId) => `agent:ui:${userId}`;
const LS_INLINE_PREFIX = (userId) => `agent:inline:${userId}:`;
// --- Generation States as per Spec ---
const GEN_STATE = {
  IDLE: 'IDLE',
  PREVIEW_STREAMING: 'PREVIEW_STREAMING',
  AWAITING_CANVAS: 'AWAITING_CANVAS',
  CANVAS_STREAMING: 'CANVAS_STREAMING',
  COMPLETED: 'COMPLETED',
  STOPPED: 'STOPPED',
  FAILED: 'FAILED',
};

const nowIso = () => new Date().toISOString();

function loadJson(key, fallback) {
try {
const raw = localStorage.getItem(key);
if (!raw) return fallback;
const parsed = JSON.parse(raw);
return parsed ?? fallback;
} catch {
return fallback;
}
}

function saveJson(key, value) {
try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}

function useAgentSessions(userId, persist = true, useSessionStorage = false) {
const [sessions, setSessions] = useState(() => {
  if (persist) return loadJson(LS_SESSIONS(userId), []);
  if (useSessionStorage) {
    try {
      const raw = sessionStorage.getItem(LS_SESSIONS(userId));
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  }
  return [];
});

useEffect(() => { 
if (persist) {
saveJson(LS_SESSIONS(userId), sessions);
} else if (useSessionStorage) {
  try { sessionStorage.setItem(LS_SESSIONS(userId), JSON.stringify(sessions)); } catch {}
}
try { window.dispatchEvent(new Event('agent:sessionsChanged')); } catch {}
}, [sessions, persist, useSessionStorage]);

const createSession = (partial = {}) => {
const id = crypto.randomUUID();
const session = {
id,
title: partial.title || '새 대화',
model: partial.model || 'gemini-2.5-pro',
createdAt: nowIso(),
updatedAt: nowIso(),
type: partial.type || 'chat',
};
const next = [session, ...sessions];
setSessions(next);
if (persist) {
  saveJson(LS_MESSAGES_PREFIX(userId) + id, []);
} else if (useSessionStorage) {
  try { sessionStorage.setItem(LS_MESSAGES_PREFIX(userId) + id, JSON.stringify([])); } catch {}
}
try { window.dispatchEvent(new CustomEvent('analytics', { detail: { name: 'agent_create_session', props: { id } } })); } catch {}
return session;
};

const updateSession = (id, patch) => {
setSessions(prev => prev.map(s => s.id === id ? { ...s, ...patch, updatedAt: nowIso() } : s));
};

const removeSession = (id) => {
setSessions(prev => prev.filter(s => s.id !== id));
if (persist) {
  try { localStorage.removeItem(LS_MESSAGES_PREFIX(userId) + id); } catch {}
} else if (useSessionStorage) {
  try { sessionStorage.removeItem(LS_MESSAGES_PREFIX(userId) + id); } catch {}
}
try { window.dispatchEvent(new Event('agent:sessionsChanged')); } catch {}
};

return { sessions, setSessions, createSession, updateSession, removeSession };
}

function useSessionMessages(sessionId, userId, persist = true, useSessionStorage = false) {
const [messages, setMessages] = useState(() => {
  if (persist) return loadJson(LS_MESSAGES_PREFIX(userId) + sessionId, []);
  if (useSessionStorage) {
    try {
      const raw = sessionStorage.getItem(LS_MESSAGES_PREFIX(userId) + sessionId);
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  }
  return [];
});
const prevSessionIdRef = useRef(sessionId);
const isSessionChangingRef = useRef(false);

useEffect(() => {
if (!sessionId) return;
if (persist) {
    // When session ID changes, load new messages
    if (sessionId !== prevSessionIdRef.current) {
        isSessionChangingRef.current = true;
        setMessages(loadJson(LS_MESSAGES_PREFIX(userId) + sessionId, []));
        prevSessionIdRef.current = sessionId;
        setTimeout(() => {
            isSessionChangingRef.current = false;
        }, 100);
    }
} else if (useSessionStorage) {
    if (sessionId !== prevSessionIdRef.current) {
        isSessionChangingRef.current = true;
        try {
          const raw = sessionStorage.getItem(LS_MESSAGES_PREFIX(userId) + sessionId);
          setMessages(raw ? JSON.parse(raw) : []);
        } catch { setMessages([]); }
        prevSessionIdRef.current = sessionId;
        setTimeout(() => {
            isSessionChangingRef.current = false;
        }, 100);
    }
} else {
    setMessages([]);
}
}, [sessionId, userId,persist, useSessionStorage]);

useEffect(() => { 
  // Only save if we're not in the middle of a session change
  if (isSessionChangingRef.current) {
      return; // Don't save during session transition
  }
  if (persist && sessionId) {
      saveJson(LS_MESSAGES_PREFIX(userId) + sessionId, messages); 
  } else if (useSessionStorage && sessionId) {
      try { sessionStorage.setItem(LS_MESSAGES_PREFIX(userId) + sessionId, JSON.stringify(messages)); } catch {}
  }
}, [sessionId, userId, messages, persist, useSessionStorage]);

return { messages, setMessages };
}

const DEFAULT_W5 = {
background: '현대',
place: '회사',
role: '말단',
mutation: '각성',
goal: '먼치킨',
speaker: '내가',
};

const STORY_MODELS = [
{ value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
{ value: 'claude-sonnet-4-0', label: 'Claude Sonnet 4.0' },
{ value: 'gpt-4o', label: 'GPT-4o' },
{ value: 'gpt-4.1', label: 'GPT-4.1' },
];

const IMAGE_MODELS = [
{ value: 'imagen-3', label: 'Imagen 3' },
{ value: 'sdxl', label: 'SDXL' },
{ value: 'dalle-3', label: 'DALL·E 3' },
];

const IMAGE_SIZES = [
{ value: '512', label: '512px' },
{ value: '768', label: '768px' },
{ value: '1024', label: '1024px' },
];

const IMAGE_ASPECTS = [
{ value: '1:1', label: '1:1' },
{ value: '16:9', label: '16:9' },
{ value: '9:16', label: '9:16' },
];

// 육하원칙 드롭다운 옵션 (요청 사양)
const W5_BACKGROUND_OPTS = ['고려','조선','삼국지','중세','현대','근대','근미래'];
const W5_PLACE_OPTS = ['회사','집','헬스장','편의점','경기장','던전','탑','이세계'];
const W5_ROLE_OPTS = ['말단','F급','백수','편돌이','회사원','축구선수','농구선수','야구선수','의사','변호사','한의사','아이돌','배우','매니저','스트리머','교수'];
const W5_MUTATION_OPTS = ['회귀','빙의','환생','각성','TS'];
const W5_GOAL_OPTS = ['먼치킨','국가권력급 헌터','초월급 마법사','월드클래스 선수','천문학적인 돈 버는','재벌 되는','최고의 아이돌','명품배우','조직의 수장','방랑자'];
const W5_SPEAKER_OPTS = ['내가','인물이'];
const W5_BECOME_OPTS = ['되는','연애하는'];

function relativeTime(iso) {
try {
const diff = Date.now() - new Date(iso).getTime();
const m = Math.floor(diff / 60000);
if (m < 1) return '방금 전';
if (m < 60) return `${m}분 전`;
const h = Math.floor(m / 60);
if (h < 24) return `${h}시간 전`;
const d = Math.floor(h / 24);
return `${d}일 전`;
} catch {
return '';
}
}

const AgentPage = () => {
const navigate = useNavigate();
const location = useLocation();
const onAgentTab = location.pathname.startsWith('/agent');
const onDashboardTab = location.pathname.startsWith('/dashboard');
const todayLabel = React.useMemo(() => {
  try {
    const d = new Date();
    return `${d.getMonth() + 1}월 ${d.getDate()}일`;
  } catch { return ''; }
}, []);
const { user } = useAuth();
const isGuest = !user;
const { sessions, createSession, updateSession, removeSession } = useAgentSessions(user?.id || 'guest', !isGuest === true, isGuest === true);
const [activeSessionId, setActiveSessionId] = useState((!isGuest ? (sessions[0]?.id || null) : null));
const { messages, setMessages } = useSessionMessages(activeSessionId || '', user?.id || 'guest', !isGuest === true, isGuest === true);
const queryClient = useQueryClient();
const [scrollElement, setScrollElement] = useState(null);
// P0: activeSessionIdRef/sessionLocalMessagesRef for live updates
const activeSessionIdRef = useRef(activeSessionId);
const sessionTypingTimersRef = useRef(new Map()); // sessionId -> [timer]
useEffect(() => { activeSessionIdRef.current = activeSessionId; }, [activeSessionId]);
const sessionLocalMessagesRef = useRef(new Map());
// 🆕 전역 스크롤 억제 ref 노출
React.useEffect(() => {
  window.agentPageSuppressAutoScroll = suppressAutoScrollRef;
  return () => {
    delete window.agentPageSuppressAutoScroll;
  };
}, []);
const messagesContainerRef = useCallback(node => {
    if (node !== null) {
        setScrollElement(node);
    }
}, []);
// --- Scroll management (P1): conditional follow + scroll-down button ---
const isAtBottomRef = useRef(true);
const isFollowingRef = useRef(true);
const suppressAutoScrollRef = useRef(false);
const suppressTimerRef = useRef(null);

// 인라인 캐릭터 채팅 상태
const [sessionChatStates, setSessionChatStates] = useState({});
// sessionChatStates 구조: { [sessionId]: { character, roomId, focused, loading } }

// 현재 세션의 인라인챗 상태 계산 (derived state)
const currentChatState = sessionChatStates[activeSessionId] || {};

const [selectedCharacter, setSelectedCharacter] = useState(null);
const [chatRoomId, setChatRoomId] = useState(null);
const [chatFocused, setChatFocused] = useState(false);
const [chatLoading, setChatLoading] = useState(false); // 채팅창 로딩 상태
const chatContainerRef = useRef(null);

React.useEffect(() => {
  if (!activeSessionId) return;

  // 새 세션 진입 시 저장값 복원
  try {
    const raw = user?.id ? localStorage.getItem(LS_INLINE_PREFIX(user.id) + activeSessionId) : null;
    if (!raw) {
      // 저장값 없으면 초기화
      setSelectedCharacter(null);
      setChatRoomId(null);
      setChatFocused(false);
      setChatLoading(false);
      return;
    }
    const saved = JSON.parse(raw);
    if (saved?.roomId && saved?.character) {
      setSelectedCharacter(saved.character);
      setChatRoomId(saved.roomId);
      setChatFocused(true);
      setChatLoading(false);
    }
  } catch {
    // 오류 시 초기화
    setSelectedCharacter(null);
    setChatRoomId(null);
    setChatFocused(false);
    setChatLoading(false);
  }
}, [activeSessionId]);


const sessionChatStatesRef = useRef({});
const [showScrollDown, setShowScrollDown] = useState(false);
const BOTTOM_THRESHOLD = 16;
const scrollRafIdRef = useRef(0);


// // 이 useEffect는 **삭제** (세션 변경 시 인라인챗 초기화하는 거)
// React.useEffect(() => {
//   setSelectedCharacter(null);
//   setChatRoomId(null);
//   setChatFocused(false);
//   setChatLoading(false);
// }, [activeSessionId]);

const scrollToBottom = useCallback(() => {
  try {
    if (scrollElement) {
      scrollElement.scrollTo({ top: scrollElement.scrollHeight, behavior: 'smooth' });
    }
  } catch {}
}, [scrollElement]);

const scrollToBottomRaf = useCallback(() => {
  try {
    if (scrollRafIdRef.current) return;
    scrollRafIdRef.current = requestAnimationFrame(() => {
      scrollRafIdRef.current = 0;
      if (isFollowingRef.current) scrollToBottom();
    });
  } catch {}
}, [scrollToBottom]);

const suppressNextAutoScroll = useCallback((ms = 300) => {
  try { if (suppressTimerRef.current) clearTimeout(suppressTimerRef.current); } catch {}
  suppressAutoScrollRef.current = true;
  suppressTimerRef.current = setTimeout(() => {
    suppressAutoScrollRef.current = false;
    suppressTimerRef.current = null;
  }, ms);
}, []);
const stableMessages = useMemo(() => messages, [messages]);
// 가상 스크롤러(최상단에서 훅 호출)
const rowVirtualizer = useVirtualizer({
  count: stableMessages.length,
  getScrollElement: () => scrollElement,
  estimateSize: () => 64,
  overscan: 8,
});


// 새 메시지 도착 시: 하단에 있을 때만 자동 따라가기
useEffect(() => {
  try {
    if (!scrollElement) return;
    if (suppressAutoScrollRef.current) return;
    // 🆕 recommendation 메시지는 스크롤 따라가기 안 함
    const lastMsg = stableMessages[stableMessages.length - 1];
    if (lastMsg && lastMsg.type === 'recommendation') return;
    if (isFollowingRef.current) scrollToBottomRaf();
  } catch {}
}, [stableMessages, scrollElement, scrollToBottomRaf]);

// 스크롤 위치 감지 및 버튼 표시/숨김
useEffect(() => {
  if (!scrollElement) return;
  const el = scrollElement;
  const handleScroll = () => {
    try {
      const atBottom = (el.scrollHeight - el.clientHeight) <= (el.scrollTop + BOTTOM_THRESHOLD);
      isAtBottomRef.current = atBottom;
      if (atBottom) {
        setShowScrollDown(false);
        isFollowingRef.current = true; // 하단에 도달하면 다시 따라가기 허용
      } else {
        setShowScrollDown(true);
        isFollowingRef.current = false; // 위로 올리면 따라가기 해제
      }
    } catch {}
  };
  handleScroll();
  el.addEventListener('scroll', handleScroll, { passive: true });
  return () => { try { el.removeEventListener('scroll', handleScroll); } catch {} };
}, [scrollElement]);

// rAF cleanup on unmount
useEffect(() => {
  return () => { try { if (scrollRafIdRef.current) cancelAnimationFrame(scrollRafIdRef.current); } catch {} };
}, []);

const [prompt, setPrompt] = useState('');
const inputRef = useRef(null);
const [mode, setMode] = useState('story'); // 'story' | 'image' | 'char' | 'sim'
const [storyModel, setStoryModel] = useState(STORY_MODELS[0].value);
const [imageModel, setImageModel] = useState(IMAGE_MODELS[0].value);
const [isPublic, setIsPublic] = useState(false);
const [w5, setW5] = useState(DEFAULT_W5);
// +++ New State Management +++
// 세션별 스트리밍 상태/컨트롤러/메시지ID 맵
const genBySessionRef = useRef(new Map()); // sid -> { status, jobId, controller, assistantId }
const jobToSessionRef = useRef(new Map()); // jobId -> sid
const sessionVersionRef = useRef(new Map()); // sid -> version (int)

// 현재 세션 UI에 표시할 상태만 별도 보유(衝突 방지)
const [generationStatus, setGenerationStatus] = useState(GEN_STATE.IDLE);
// job 관리(취소/복구용) - 현재 세션의 jobId만 저장
const [storyJobId, setStoryJobId] = useState(null);
// Canvas stage label (dynamic wording for streaming phases)
const [canvasStageLabel, setCanvasStageLabel] = useState('본문 작성 중입니다');

const formatCanvasStageLabel = useCallback((payload) => {
  try {
    const raw = payload?.label || payload?.name || payload?.stage || payload?.phase || payload?.id || '';
    if (!raw) {
      if (typeof payload?.index === 'number') {
        const idx = Number(payload.index);
        const steps = [
          '스토리 컨셉 구상 중입니다',
          '세계관 설정 짜는 중입니다',
          '캐릭터 기획 중입니다',
          '본문 작성 중입니다',
          '교정교열 중입니다',
        ];
        return steps[idx] || '본문 작성 중입니다';
      }
      return '본문 작성 중입니다';
    }
    const text = String(raw).toLowerCase();
    const map = {
      concept: '스토리 컨셉 구상 중입니다',
      idea: '스토리 컨셉 구상 중입니다',
      outline: '스토리 컨셉 구상 중입니다',
      preview: '스토리 컨셉 구상 중입니다',
      world: '세계관 설정 짜는 중입니다',
      worldbuild: '세계관 설정 짜는 중입니다',
      worldbuilding: '세계관 설정 짜는 중입니다',
      setting: '세계관 설정 짜는 중입니다',
      character: '캐릭터 기획 중입니다',
      characters: '캐릭터 기획 중입니다',
      persona: '캐릭터 기획 중입니다',
      draft: '본문 작성 중입니다',
      write: '본문 작성 중입니다',
      writing: '본문 작성 중입니다',
      compose: '본문 작성 중입니다',
      body: '본문 작성 중입니다',
      canvas: '본문 작성 중입니다',
      expand: '본문 작성 중입니다',
      refine: '교정교열 중입니다',
      polish: '교정교열 중입니다',
      proofread: '교정교열 중입니다',
      finalize: '교정교열 중입니다',
      finalizing: '교정교열 중입니다',
    };
    return map[text] || '본문 작성 중입니다';
  } catch { return '본문 작성 중입니다'; }
}, []);

const getGenState = useCallback((sid) => {
  return genBySessionRef.current.get(sid) || { status: GEN_STATE.IDLE, jobId: null, controller: null, assistantId: null };
}, []);

const setGenState = useCallback((sid, partial) => {
  const prev = getGenState(sid);
  const next = { ...prev, ...partial };
  genBySessionRef.current.set(sid, next);
  if (sid === activeSessionId) {
    setGenerationStatus(next.status || GEN_STATE.IDLE);
    setStoryJobId(next.jobId || null);
  }
  return next;
}, [activeSessionId, getGenState]);

const getSessionVersion = useCallback((sid) => {
  return sessionVersionRef.current.get(sid) || 0;
}, []);

const bumpSessionVersion = useCallback((sid) => {
  const next = (sessionVersionRef.current.get(sid) || 0) + 1;
  sessionVersionRef.current.set(sid, next);
  return next;
}, []);

const applyIfCurrent = useCallback((sid, expectedVersion, fn) => {
  const cur = getSessionVersion(sid);
  if (cur !== expectedVersion) return false;
  try { fn(); } catch {}
  return true;
}, [getSessionVersion]);

// 세션 변경 시 해당 세션의 생성 상태로 UI 업데이트
useEffect(() => {
  const currentGenState = getGenState(activeSessionId);
  setGenerationStatus(currentGenState?.status || GEN_STATE.IDLE);
}, [activeSessionId, getGenState]);

// (moved) headlessWatchersRef/startHeadlessWatcher 아래로 이동: updateMessageForSession 선언 이후에 초기화되도록 함

const [images, setImages] = useState(() => user?.id ? loadJson(LS_IMAGES(user.id), []) : []);
const [imageResults, setImageResults] = useState([]);
const [showChatPanel, setShowChatPanel] = useState(false);
const [showImagesSheet, setShowImagesSheet] = useState(false);
const [showStoriesSheet, setShowStoriesSheet] = useState(false);
// First Frame 선택 상태
const [firstFrameOpen, setFirstFrameOpen] = useState(false);
const [firstFrameUrl, setFirstFrameUrl] = useState('');
const openFirstFramePicker = useCallback(() => setFirstFrameOpen(true), []);
const clearFirstFrame = useCallback(() => setFirstFrameUrl(''), []);
const [insertTargetImage, setInsertTargetImage] = useState(null);
const [insertKind, setInsertKind] = useState('gallery'); // 'cover' | 'gallery'
const [selectedStoryId, setSelectedStoryId] = useState(null);
const [storiesList, setStoriesList] = useState(() => user?.id ? loadJson(LS_STORIES(user.id), []) : []);
const [showStoriesViewerSheet, setShowStoriesViewerSheet] = useState(false);
const [showCharactersViewerSheet, setShowCharactersViewerSheet] = useState(false);
const [charactersList, setCharactersList] = useState(() => user?.id ? loadJson(LS_CHARACTERS(user.id), []) : []);
const [touchStartX, setTouchStartX] = useState(null);
const [imageSize, setImageSize] = useState('768');
const [imageAspect, setImageAspect] = useState('1:1');
const [imageCount, setImageCount] = useState(4);
const [showPublishSheet, setShowPublishSheet] = useState(false);
const [publishName, setPublishName] = useState('');
const [publishPublic, setPublishPublic] = useState(true);
const [publishAvatarUrl, setPublishAvatarUrl] = useState('');
const [publishing, setPublishing] = useState(false);
const [includeNewImages, setIncludeNewImages] = useState(true);
const [includeLibraryImages, setIncludeLibraryImages] = useState(false);
// Story preview
const [storyPreview, setStoryPreview] = useState('');
const [storyPreviewProgress, setStoryPreviewProgress] = useState(0);
// 스토리 뷰어(캔버스)용 Sheet 상태
const [showStoryViewerSheet, setShowStoryViewerSheet] = useState(false);
const [storyForViewer, setStoryForViewer] = useState({ title: '', content: '' });
// 새 세션 생성 대기 플래그: 첫 생성 요청 시 세션 생성
const [isNewSessionPending, setIsNewSessionPending] = useState(false);
// 스토리 스트리밍 말풍선 업데이트용 메시지 ID
// 인라인 편집 상태
const [editingMessageId, setEditingMessageId] = useState(null);
const [editedContent, setEditedContent] = useState('');
// 부분 재생성 상태
const [selectedText, setSelectedText] = useState('');
const [selectionRange, setSelectionRange] = useState(null); // { start, end, messageId }
const [showEditModal, setShowEditModal] = useState(false);
const [modalPosition, setModalPosition] = useState({ top: 0, left: 0 });
const [editPrompt, setEditPrompt] = useState('');
const [regenerating, setRegenerating] = useState(false);
const [isDraggingModal, setIsDraggingModal] = useState(false);
const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
const savedSelectionRef = useRef(null); // 선택 영역 저장
const [regeneratedRange, setRegeneratedRange] = useState(null); // { messageId, start, end } - 재생성된 영역 표시용
const [aiRecommendedTags, setAiRecommendedTags] = useState({}); // { messageId: [tags] } ← 이 줄 추가

// Remix 선택 상태: messageId -> string[]
const [remixSelected, setRemixSelected] = useState({});
// 생성 중 경과 시간 표시용
const [elapsedSeconds, setElapsedSeconds] = useState(0);
// 태그 뷰 토글: 'auto'일 땐 현재 스토리 모드에 맞춰 시작, 아이콘으로 일시 토글
const [tagViewMode, setTagViewMode] = useState('auto'); // 'auto' | 'snap' | 'genre'
// 스냅 태그: 상단 4, 하단 3만 노출(순서 중요)
const SNAP_REMIX_TAGS = ['위트있게','빵터지게','밈스럽게','따뜻하게','힐링이되게','잔잔하게','여운있게','진지하게','차갑게','글더길게','글더짧게','3인칭시점'];
// const GENRE_REMIX_TAGS = ['남성향판타지','로맨스','로코','성장물','미스터리','추리','스릴러','호러','느와르','글더길게','글더짧게','1인칭시점','3인칭시점'];
// 추가
// 장르 태그: AI 추천 (1줄, 5개)
const AI_GENRE_TAGS = [
  '상사에게복수',
  '소개팅남이재벌',
  '동기가재벌2세',
  '옆에좀비발생',
  '갑자기능력자각성'
];


const POPULAR_GENRE_TAGS = [
  '후회안하게회귀',
  '인생뺏으러빙의',
  '이번생글렀으니환생'
];

const toggleRemixTag = useCallback((msgId, tag) => {
  setRemixSelected(prev => {
    const curr = prev[msgId] || [];
    const exists = curr.includes(tag);
    const next = exists ? curr.filter(t => t !== tag) : [...curr, tag];
    return { ...prev, [msgId]: next };
  });
}, []);

// 🆕 Dual response 선택 핸들러
const handleSelectMode = useCallback((messageId, selectedMode) => {
  const currentSessionId = activeSessionId;
  
  // 메시지 찾기
  const msg = messages.find(m => m.id === messageId);
  if (!msg || msg.type !== 'dual_response') return;
  
  // 선택된 응답 데이터
  const selectedResponse = msg.responses[selectedMode];
  if (!selectedResponse) return;
  
  // dual_response → 일반 메시지로 변환
  const convertedMessage = {
    id: messageId,
    role: 'assistant',
    content: selectedResponse.fullContent,
    fullContent: selectedResponse.fullContent,
    storyMode: selectedMode,
    streaming: false,
    createdAt: msg.createdAt
  };
  
  // UI 업데이트
  setMessages(prev => prev.map(m => 
    m.id === messageId ? convertedMessage : m
  ));
  
  // 저장소 업데이트
  const saved = loadJson(LS_MESSAGES_PREFIX(user?.id) + currentSessionId, []);
  const updated = saved.map(m => 
    m.id === messageId ? convertedMessage : m
  );
  saveJson(LS_MESSAGES_PREFIX(user?.id) + currentSessionId, updated);
  
  // 게스트일 경우 sessionStorage에도 저장
  if (isGuest) {
    try {
      sessionLocalMessagesRef.current.set(currentSessionId, updated);
      sessionStorage.setItem(LS_MESSAGES_PREFIX(user?.id) + currentSessionId, JSON.stringify(updated));
    } catch {}
  }
  
  // 🆕 선택 후 하이라이트/추천 생성
  const msgIndex = updated.findIndex(m => m.id === messageId);
  let imageUrl = null;
  for (let i = msgIndex - 1; i >= 0; i--) {
    if (updated[i].type === 'image') {
      imageUrl = updated[i].url;
      break;
    }
  }
  
  if (imageUrl) {
    // 하이라이트 로딩 + 추천 메시지 추가
    const placeholderId = crypto.randomUUID();
    const withExtras = [
      ...updated,
      { id: placeholderId, type: 'story_highlights_loading', createdAt: nowIso() },
      { id: crypto.randomUUID(), role: 'assistant', type: 'recommendation', storyMode: selectedMode, createdAt: nowIso() }
    ];
    
    saveJson(LS_MESSAGES_PREFIX(user?.id) + currentSessionId, withExtras);
    
    if (activeSessionIdRef.current === currentSessionId) {
      setMessages(withExtras);
    }
    
    // vision_tags 읽기
    let visionTags = null;
    try {
      const stored = localStorage.getItem(`agent:vision:${currentSessionId}`);  // 또는 activeSessionId
      if (stored) {
        const parsed = JSON.parse(stored);
        visionTags = parsed.tags;
      }
    } catch {}


    // 하이라이트 생성
    (async () => {
      try {
        const hiRes = await chatAPI.agentGenerateHighlights({
          text: selectedResponse.fullContent,
          image_url: imageUrl,
          story_mode: selectedMode,
          vision_tags: visionTags
        });
        const scenes = hiRes.data?.story_highlights || [];
        
        const currentMsgs = loadJson(LS_MESSAGES_PREFIX(user?.id) + currentSessionId, []);
        const placeholder = currentMsgs.find(m => m.type === 'story_highlights_loading');
        if (!placeholder) return;
        
        const savedHL = loadJson(LS_MESSAGES_PREFIX(user?.id) + currentSessionId, []);
        const updatedHL = savedHL.map(m =>
          m.id === placeholder.id
            ? { id: crypto.randomUUID(), type: 'story_highlights', scenes, createdAt: nowIso() }
            : m
        );
        
        saveJson(LS_MESSAGES_PREFIX(user?.id) + currentSessionId, updatedHL);
        
        if (activeSessionIdRef.current === currentSessionId) {
          setMessages(updatedHL);
        }
        
        // ✅ 자동 저장 (내 서랍) - 하이라이트 생성 후
        if (!isGuest) {
          try {
            const userMsgs = updatedHL.filter(m => m.role === 'user' && !m.type);
            const lastUserText = userMsgs.length > 0 ? userMsgs[userMsgs.length - 1].content : null;
            
            await chatAPI.saveAgentContent({
              session_id: currentSessionId,
              message_id: messageId,
              story_mode: selectedMode,
              user_text: lastUserText,
              user_image_url: imageUrl,
              generated_text: selectedResponse.fullContent,
              generated_image_urls: scenes.map(s => s.imageUrl)
            });
          } catch (err) {
            console.error('Failed to save to drawer:', err);
          }
        }
      } catch (e) {
        console.error('Failed to generate highlights after selection:', e);
        // 실패 시 로딩 제거
        const savedErr = loadJson(LS_MESSAGES_PREFIX(user?.id) + currentSessionId, []);
        const filtered = savedErr.filter(m => m.type !== 'story_highlights_loading');
        saveJson(LS_MESSAGES_PREFIX(user?.id) + currentSessionId, filtered);
        
        if (activeSessionIdRef.current === currentSessionId) {
          setMessages(filtered);
        }
      }
    })();
  }
}, [messages, activeSessionId, isGuest, activeSessionIdRef]);

const handleRemixGenerate = useCallback(async (msg, assistantText) => {
  try {
    // 직전 이미지 URL 찾기
    const msgIndex = (messages || []).findIndex(x => x.id === msg.id);
    let imageUrl = null;
    for (let i = msgIndex - 1; i >= 0; i--) {
      if (messages[i].type === 'image') { imageUrl = messages[i].url; break; }
    }
    const selected = remixSelected[msg.id] || [];
    const tags = selected.join(', ');
    const styleDict = {
      '위트있게': '일상 언어로 쓰되 재치/반전 1개 포함. 밈체 금지, 자연스러운 문장. 마지막 한 줄에 여운 있는 펀치라인',
      '빵터지게': '상황 자체를 웃기게: 황당한 실수/어이없는 반전/예상 밖 행동. 밈체·과장 표현 금지. 사건의 타이밍과 전개로 웃김을 만들어라. 마지막은 "이게 뭐람" 같은 자조로 마무리',
      '밈스럽게': '말투를 밈체로: "~함, ~임, ~아님?" 종결, 괄호체(소량), 신조어 과감히. 넷플릭스·코스프레·퐁당 같은 밈 단어 허용. 비속어 금지. 마지막은 짤 캡션으로 바로 쓸 수 있게',
      '따뜻하게': '부드러운 어휘, 온기/위로, 여운 남기는 마무리',
      '힐링이되게': '편안한 리듬, 자연/호흡/쉼의 이미지, 긴장감 최소화',
      '잔잔하게': '차분한 묘사, 작은 사건, 낮은 대비, 은은한 감정',
      '여운있게': '마지막 문장에 비유/반복 구조로余韻, 직접 결론 금지',
      '진지하게': '담백·단정한 어휘, 농담 금지, 의미 중심',
      '차갑게': '건조한 관찰체, 감정 최소, 단문 위주',
      '남성향판타지': '과감한 파워·스킬 묘사, 전개 속도 빠르게, 결단형 주인공',
      '로맨스': '감정선/미묘한 제스처 강조, 설렘 포인트, 서정적 어휘',
      '로코': '경쾌한 티키타카, 오해/해프닝, 위트 있는 비유',
      '성장물': '결심·노력·변화 단계, 자기 성찰 내적 독백 포함',
      '미스터리': '단서/복선 암시, 의문형 문장, 분위기 긴장',
      '추리': '논리적 연결, 단서 재배치, 결론 암시',
      '스릴러': '촉박한 시간감, 위기 고조, 동사 위주 단문',
      '호러': '감각적 공포, 보이지 않는 위협, 불길한 전조',
      '느와르': '거친 사실주의, 냉소적 톤, 어두운 이미지'
    };
    const tagDesc = selected.map(t => styleDict[t] || `${t} 느낌을 강하게`).join('; ');
    
    // 특수 태그 강화 노트 (밈스럽게, 위트있게, 빵터지게)
    let specialNotes = '';
    if (selected.includes('밈스럽게')) {
      specialNotes += `\n- (밈체 필수) 10~30대 커뮤니티 밈 문법 적극 사용: "~함, ~임, ~아님?" 종결, 괄호체, 신조어/밈 단어(넷플릭스 로딩, 코스프레, 퐁당 등). 비속어 금지. 말투를 완전히 밈체로 전환.`;
    }
    if (selected.includes('위트있게')) {
      specialNotes += `\n- (위트 필수) 의외성/반전을 최소 1개 포함. 자연스러운 일상 언어 유지하되, 마지막 문장은 반드시 여운 있는 펀치라인으로. 과장 금지, 재치로 승부.`;
    }
    if (selected.includes('빵터지게')) {
      specialNotes += `\n- (코미디 필수) 상황 자체를 황당하게: 실수/반전/예상 밖 행동을 중심 사건으로. 밈체 금지, 사건의 타이밍과 전개로만 웃김 유도. 마지막은 자조적 한 줄로.`;
    }
    
    const rules = selected.length > 0 ? `\n[리믹스 규칙 - 반드시 준수]\n- 선택 태그를 매우 강하게 반영: ${tags}\n- 태그 해석: ${tagDesc}${specialNotes}\n- 초안과 톤/어휘/리듬/문장 구조가 눈에 띄게 달라야 한다 (문장 유사 반복 최소화).\n- 사실/숫자/이미지 내 텍스트는 절대 변경하지 말 것.\n- 메타발언/설명 금지(예: "태그 반영" 같은 문구 금지).` : '';
    const remixPrompt = `${rules}\n\n아래 초안을 같은 사실로 리믹스해줘. 스타일만 태그에 맞게 강하게 전환할 것:\n\n${assistantText}`.trim();

    const assistantId = crypto.randomUUID();
    const thinkingMsg = { id: assistantId, role: 'assistant', content: '', thinking: true, createdAt: nowIso(), storyMode: msg.storyMode || 'auto' };
    setMessages(curr => [...curr, thinkingMsg]);
    setGenState(activeSessionId, { status: GEN_STATE.PREVIEW_STREAMING });

    const staged = [];
    if (imageUrl) staged.push({ type: 'image', url: imageUrl });
    staged.push({ type: 'text', body: remixPrompt });

    const effectiveModeForRemix = (tagViewMode === 'auto' ? (msg.storyMode || 'auto') : tagViewMode);
    const response = await chatAPI.agentSimulate({ staged, mode: 'micro', storyMode: effectiveModeForRemix, model: storyModel, sub_model: storyModel });
    const text = response.data?.assistant || '';
    const decidedMode = response.data?.story_mode || (msg.storyMode || 'auto');
    // 타이핑 출력
    const currentSessionId = activeSessionId; // ✅ 시작 시점 세션 캡처
    setMessages(curr => curr.map(m => m.id === assistantId ? { ...m, content: '', thinking: false, streaming: true, storyMode: decidedMode } : m));

    let idx = 0; 
    const total = text.length; 
    const steps = 80; 
    const step = Math.max(2, Math.ceil(total / steps)); 
    const intervalMs = 15;
    const timer = setInterval(() => {
      idx = Math.min(total, idx + step);
      const slice = text.slice(0, idx);
      
      // ✅ 저장소 항상 업데이트 (타이핑 중에도)
      const saved = loadJson(LS_MESSAGES_PREFIX(user?.id) + currentSessionId, []);
      const updated = saved.map(m => m.id === assistantId ? { 
        ...m, 
        content: slice,
        fullContent: text, // 전체 텍스트는 항상 저장
        streaming: idx < total,
        thinking: false,
        storyMode: decidedMode
      } : m);
      saveJson(LS_MESSAGES_PREFIX(user?.id) + currentSessionId, updated);
      
      // ✅ 현재 보고 있는 세션일 때만 UI 업데이트
      if (activeSessionIdRef.current === currentSessionId) {
        setMessages(updated);
      }
      
      if (idx >= total) {
        clearInterval(timer);
        const timers = sessionTypingTimersRef.current.get(currentSessionId) || [];
        sessionTypingTimersRef.current.set(currentSessionId, timers.filter(t => t !== timer));
        
        // ✅ 하이라이트/추천 추가
        if (imageUrl) {
          const finalSaved = loadJson(LS_MESSAGES_PREFIX(user?.id) + currentSessionId, []);
          const placeholderId = crypto.randomUUID();
          const withExtras = [...finalSaved, 
            { id: placeholderId, type: 'story_highlights_loading', createdAt: nowIso() }, 
            { id: crypto.randomUUID(), role: 'assistant', type: 'recommendation', createdAt: nowIso() }
          ];
          saveJson(LS_MESSAGES_PREFIX(user?.id) + currentSessionId, withExtras);
          
          if (activeSessionIdRef.current === currentSessionId) {
            setMessages(withExtras);
          }
          // vision_tags 읽기
          let visionTags = null;
          try {
            const stored = localStorage.getItem(`agent:vision:${currentSessionId}`);  // 또는 activeSessionId
            if (stored) {
              const parsed = JSON.parse(stored);
              visionTags = parsed.tags;
            }
          } catch {}


          // ✅ 하이라이트 생성 (백그라운드, 세션 무관)
          (async () => {
            try {
              const hiRes = await chatAPI.agentGenerateHighlights({ text, image_url: imageUrl, story_mode: decidedMode || 'auto',vision_tags: visionTags });
              const scenes = hiRes.data?.story_highlights || [];
              
              const currentMsgs = loadJson(LS_MESSAGES_PREFIX(user?.id) + currentSessionId, []);
              const placeholder = currentMsgs.find(m => m.type === 'story_highlights_loading');
              if (!placeholder) return;
              
              const savedAfterHL = loadJson(LS_MESSAGES_PREFIX(user?.id) + currentSessionId, []);
              const updatedHL = savedAfterHL.map(mm => mm.id === placeholder.id ? { 
                id: crypto.randomUUID(), 
                type: 'story_highlights', 
                scenes, 
                createdAt: nowIso() 
              } : mm);
              
              saveJson(LS_MESSAGES_PREFIX(user?.id) + currentSessionId, updatedHL);
              
              if (activeSessionIdRef.current === currentSessionId) {
                setMessages(updatedHL);
              }
            } catch (_) {
              const savedErr = loadJson(LS_MESSAGES_PREFIX(user?.id) + currentSessionId, []);
              const filtered = savedErr.filter(mm => mm.type !== 'story_highlights_loading');
              saveJson(LS_MESSAGES_PREFIX(user?.id) + currentSessionId, filtered);
              
              if (activeSessionIdRef.current === currentSessionId) {
                setMessages(filtered);
              }
            }
          })();
        }
      }
    }, intervalMs);
    // ✅ 타이머 등록
    const timers = sessionTypingTimersRef.current.get(currentSessionId) || [];
    sessionTypingTimersRef.current.set(currentSessionId, [...timers, timer]);
  } catch (e) {
    setMessages(curr => curr.map(m => m.thinking ? { ...m, content: '응답 생성에 실패했습니다. 다시 시도해주세요.', thinking: false, error: true } : m));
    setGenState(activeSessionId, { status: GEN_STATE.IDLE });
  }
}, [activeSessionId, messages, remixSelected, storyModel]);
const assistantMessageIdRef = useRef(null);

// 빠른 문장 템플릿 순환(넷플릭스/영화/드라마 → W5 복귀)
const QUICK_TEMPLATES = [
  '넷플릭스 영화, <K-POP 데몬 헌터스>에서 내가 그룹 HUNTRIX의 4번째 멤버가 된다면?',
  '배우 박정민 주연의 영화 <얼굴>에서 내가 다큐멘터리 기자 역할을 대신 한다면?',
  '인기 드라마 <오늘도 출근합니다>의 주인공처럼 내가 로또에 당첨된 회사원이라면?',
];
const [quickIdx, setQuickIdx] = useState(-1); // -1: W5 표시, 0..2: 템플릿 표시
const [quickText, setQuickText] = useState('');
const handleCycleQuick = useCallback(() => {
  const next = quickIdx === -1 ? 0 : (quickIdx + 1) % 4;
  if (next === 3) {
    setQuickIdx(-1);
    setQuickText('');
  } else {
    setQuickIdx(next);
    setQuickText(QUICK_TEMPLATES[next]);
  }
}, [quickIdx]);

useEffect(() => {
    if (inputRef.current) {
        inputRef.current.style.height = 'auto';
        const scrollHeight = inputRef.current.scrollHeight;
        const maxHeight = 192; // max-h-48
        if (scrollHeight > maxHeight) {
            inputRef.current.style.height = `${maxHeight}px`;
            inputRef.current.style.overflowY = 'auto';
        } else {
            inputRef.current.style.height = `${scrollHeight}px`;
            inputRef.current.style.overflowY = 'hidden';
        }
    }
}, [prompt]);

useEffect(() => { if (user?.id) saveJson(LS_IMAGES(user.id), images); }, [user?.id, images]);
useEffect(() => { if (user?.id) saveJson(LS_STORIES(user.id), storiesList); }, [user?.id, storiesList]);
useEffect(() => { if (user?.id) saveJson(LS_CHARACTERS(user.id), charactersList); }, [user?.id, charactersList]);

// 생성 중 경과 시간 타이머
useEffect(() => {
  const thinkingMsg = stableMessages.find(m => m.thinking);
  if (!thinkingMsg) {
    setElapsedSeconds(0);
    return;
  }
  setElapsedSeconds(0);
  const startTime = new Date(thinkingMsg.createdAt).getTime();
  const timer = setInterval(() => {
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    setElapsedSeconds(elapsed);
  }, 1000);
  return () => clearInterval(timer);
}, [stableMessages]);

// UI 상태 로컬 복원/저장
useEffect(() => {
try {
const ui = user?.id ? loadJson(LS_UI(user.id), null) : null;
if (ui) {
  if (ui.mode) setMode(ui.mode);
  if (ui.storyModel) setStoryModel(ui.storyModel);
  if (ui.imageModel) setImageModel(ui.imageModel);
  if (typeof ui.isPublic === 'boolean') setIsPublic(ui.isPublic);
  if (ui.w5) setW5(ui.w5);
  if (ui.imageSize) setImageSize(ui.imageSize);
  if (ui.imageAspect) setImageAspect(ui.imageAspect);
  if (ui.imageCount) setImageCount(ui.imageCount);
  if (ui.publishPublic !== undefined) setPublishPublic(!!ui.publishPublic);
  if (ui.includeNewImages !== undefined) setIncludeNewImages(!!ui.includeNewImages);
  if (ui.includeLibraryImages !== undefined) setIncludeLibraryImages(!!ui.includeLibraryImages);
}
// PIP 또는 파비콘을 통한 새 시작 처리 (?start=new)
try {
  const params = new URLSearchParams(window.location.search || '');
  if (params.get('start') === 'new') {
    const s = createSession({ title: '새 대화', type: 'story' });
    setActiveSessionId(s.id);
    setShowChatPanel(false);
    setPrompt('');
    setW5(DEFAULT_W5);
    setQuickIdx(-1);
    setIsNewSessionPending(false);
    // URL 정리
    const url = new URL(window.location.href);
    url.searchParams.delete('start');
    window.history.replaceState({}, '', url.toString());
}
} catch {}
} catch {}
}, []);
useEffect(() => {
  if (user?.id) {
    saveJson(LS_UI(user.id), { mode, storyModel, imageModel, isPublic, w5, imageSize, imageAspect, imageCount, publishPublic, includeNewImages, includeLibraryImages });
  }
}, [user?.id,mode, storyModel, imageModel, isPublic, w5, imageSize, imageAspect, imageCount, publishPublic, includeNewImages, includeLibraryImages]);

// "최고 결정권자" useEffect: 세션 상태 변화를 감시하고 UI를 동기화
useEffect(() => {
    const activeSessionExists = sessions.some(s => s.id === activeSessionId);

    if (sessions.length > 0 && !activeSessionExists) {
        // 활성 세션이 삭제된 경우, 첫 번째 세션을 활성화
        setActiveSessionId(sessions[0].id);
    } else if (sessions.length === 0 && !isGuest) {
        // 세션이 하나도 없는 경우(로그인 사용자), 새 세션을 만들고 활성화
        const newSession = createSession({ title: '새 대화' });
        setActiveSessionId(newSession.id);
        setShowChatPanel(false); // 육하원칙 화면 표시
    }
}, [sessions, activeSessionId, isGuest, createSession]);

// Hash-based activation from AgentSidebar + scroll to message
useEffect(() => {
const tryActivateFromHash = () => {
try {
  const h = window.location.hash || '';
  const m = h.match(/session=([^&]+)/);
  const id = m?.[1];
  if (id && sessions.some(s => s.id === id)) {
    setActiveSessionId(id);
    setShowChatPanel(true);
    
    // scrollTo 파라미터 확인
    const scrollMatch = h.match(/scrollTo=([^&]+)/);
    const scrollToId = scrollMatch?.[1];
    if (scrollToId) {
      // 메시지 로드 대기 후 스크롤
      setTimeout(() => {
        const element = document.querySelector(`[data-message-id="${scrollToId}"]`);
        if (element) {
          element.scrollIntoView({ behavior: 'smooth', block: 'center' });
          // 하이라이트 효과
          element.classList.add('highlight-flash');
          setTimeout(() => {
            element.classList.remove('highlight-flash');
          }, 2000);
        }
      }, 500);
    }
  }
} catch {}
};
tryActivateFromHash();
window.addEventListener('hashchange', tryActivateFromHash);
return () => window.removeEventListener('hashchange', tryActivateFromHash);
}, [sessions, messages]);

// 세션 전환 시 메시지 유무로 패널 표시 결정 (빈 채팅방 금지)
useEffect(() => {
  setShowChatPanel((messages || []).length > 0);
}, [activeSessionId, messages]);

// 게스트: 세션 전환 시 메모리 저장소에서 복원
useEffect(() => {
  if (isGuest && activeSessionId) {
    try {
      const arr = sessionLocalMessagesRef.current.get(activeSessionId) || [];
      setMessages(Array.isArray(arr) ? arr : []);
    } catch {}
  }
}, [isGuest, activeSessionId, setMessages]);

// Onboarding toast (once per device)
useEffect(() => {
  try {
    const key = 'agent:onboarding:v1';
    const shown = localStorage.getItem(key);
    if (!shown) {
      window.dispatchEvent(new CustomEvent('toast', { detail: { type: 'info', message: '에이전트 탭에 오신 걸 환영합니다!' } }));
      if (isGuest) window.dispatchEvent(new CustomEvent('toast', { detail: { type: 'info', message: '게스트 모드: 히스토리가 저장되지 않습니다.' } }));
      localStorage.setItem(key, '1');
    }
  } catch {}
}, [isGuest]);

// First session toast
useEffect(() => {
try {
const key = 'agent:onboarding:first-session:v1';
const flag = localStorage.getItem(key);
if (!flag && sessions.length === 1) {
  window.dispatchEvent(new CustomEvent('toast', { detail: { type: 'success', message: '첫 세션이 생성되었습니다. 메시지를 입력해 대화를 시작해보세요!' } }));
  localStorage.setItem(key, '1');
}
} catch {}
}, [sessions]);

const userTurns = useMemo(() => (stableMessages || []).filter(m => m.role === 'user').length, [stableMessages]);
const generationLimit = isGuest ? 3 : 20;
const turnLimitReached = userTurns >= generationLimit;
const activeSession = useMemo(() => (sessions || []).find(s => s.id === activeSessionId) || null, [sessions, activeSessionId]);
const isNewChatButtonDisabled = useMemo(() => {
    // 게스트만 비활성화, 나머지는 언제나 새 대화 가능
    return !!isGuest;
}, [isGuest]);

const handleCreateSession = () => {
    // 현재 세션 스트림만 종료 (서버 작업은 유지)
    try {
      const cur = getGenState(activeSessionId);
      cur?.controller?.abort?.();
    } catch {}
    // 새 세션 생성 및 활성화
    const newSession = createSession({ title: '새 대화', type: 'story' });
    setActiveSessionId(newSession.id);
    if (isGuest) {
      try { sessionLocalMessagesRef.current.set(newSession.id, []); } catch {}
    }
    try { sessionVersionRef.current.set(newSession.id, 0); } catch {}
    // 육하원칙 화면 강제 노출 (빈 채팅방 금지)
    setShowChatPanel(false);
    setPrompt('');
    setW5(DEFAULT_W5);
    setQuickIdx(-1);
    setMode('story');
    setGenState(newSession.id, { status: GEN_STATE.IDLE, jobId: null, controller: null, assistantId: null });
    navigate('/agent', { replace: true });
    setTimeout(() => {
        const firstInput = document.querySelector('[data-w5-input="background"]');
        if (firstInput) firstInput.focus();
    }, 100);
};

const handleSessionSelect = (id) => {
    // 현재 세션 스트림만 종료 (서버 작업은 계속)
    try {
        const cur = getGenState(activeSessionId);
        cur?.controller?.abort?.();
    } catch {}
    setActiveSessionId(id);
    try {
        const list = isGuest ? [] : (loadJson(LS_MESSAGES_PREFIX(user?.id) + id, []) || []);
        setShowChatPanel((list || []).length > 0);
    } catch {}
    navigate(`/agent#session=${id}`, { replace: true });
    // 백그라운드 완료 감시 시작 (A처럼 headless로 끝날 수 있음)
    try {
      const cand = getGenState(id);
      if (cand?.jobId) startHeadlessWatcher(id);
    } catch {}
};

const handleDeleteSession = (id) => {
  // 단순히 세션 제거만 요청. 다음 상태 결정은 "최고 결정권자" useEffect에 위임.
  removeSession(id);
  delete sessionChatStatesRef.current[id];
};

const buildCharacterFromChat = () => {
const name = publishName?.trim() || '새 캐릭터';
// 대화 페어 구성 (user -> assistant)
const pairs = [];
const msgs = (stableMessages || []).filter(m => !m.type); // 텍스트만
for (let i = 0; i < msgs.length; i += 1) {
const m = msgs[i];
if (m.role === 'user') {
  const next = msgs.slice(i + 1).find(x => x.role === 'assistant' && x.content);
  if (next) pairs.push({ user: m.content || '', assistant: next.content || '' });
}
}
const firstAssistant = msgs.find(x => x.role === 'assistant' && x.content)?.content || '';
const description = `${w5.background}/${w5.place}/${w5.role} 세계관 기반. 에이전트 세션에서 파생된 캐릭터.`;
const greeting = firstAssistant.slice(0, 280);
const dialogues = pairs.slice(0, 6).map((p, idx) => ({ user_message: p.user, character_response: p.assistant, order_index: idx }));

// 갤러리 이미지 구성
const galleryFromNew = includeNewImages ? (imageResults || []).map(x => x.url) : [];
const galleryFromLib = includeLibraryImages ? (images || []).slice(0, 6).map(x => x.url) : [];
const galleryUrls = [...galleryFromNew, ...galleryFromLib].slice(0, 12);

const characterData = {
basic_info: {
  name,
  description,
  personality: '',
  speech_style: '',
  greeting,
  world_setting: `${w5.background} · ${w5.place} · ${w5.role} · 목표:${w5.goal}`,
  user_display_description: description,
  use_custom_description: false,
  introduction_scenes: [
    { title: '도입부', content: greeting, secret: '' }
  ],
  character_type: 'roleplay',
  base_language: 'ko',
},
media_settings: {
  avatar_url: publishAvatarUrl || '',
  image_descriptions: [
    ...(publishAvatarUrl ? [{ url: publishAvatarUrl, description: '' }] : []),
    ...galleryUrls.map(url => ({ url, description: '' })),
  ],
  newly_added_files: [],
  voice_settings: { voice_id: null, voice_style: null, enabled: false },
},
example_dialogues: { dialogues: dialogues.length ? dialogues : [{ user_message: '안녕!', character_response: '만나서 반가워요.', order_index: 0 }] },
affinity_system: { has_affinity_system: false, affinity_rules: '', affinity_stages: [
  { min_value: 0, max_value: 100, description: '차가운 반응을 보입니다.' },
  { min_value: 101, max_value: 200, description: '친근하게 대화합니다.' },
  { min_value: 201, max_value: null, description: '매우 친밀하게 대화합니다.' },
] },
publish_settings: { is_public: !!publishPublic, custom_module_id: null, use_translation: true },
};
return characterData;
};

const handlePublishAsCharacter = async () => {
if (!publishName?.trim()) { window.dispatchEvent(new CustomEvent('toast', { detail: { type: 'error', message: '캐릭터 이름을 입력하세요' } })); return; }
setPublishing(true);
try {
const payload = buildCharacterFromChat();
const res = await charactersAPI.createAdvancedCharacter(payload);
const newId = res?.data?.id;
window.dispatchEvent(new CustomEvent('toast', { detail: { type: 'success', message: publishPublic ? '공개 캐릭터로 게시되었습니다' : '비공개 캐릭터가 생성되었습니다' } }));
setShowPublishSheet(false);
if (newId) {
  try { window.dispatchEvent(new CustomEvent('analytics', { detail: { name: 'agent_publish_character', props: { is_public: publishPublic } } })); } catch {}
  // 상세 페이지로 이동
  setTimeout(() => { try { window.location.href = `/characters/${newId}`; } catch {} }, 0);
}
} catch (e) {
console.error('캐릭터 게시 실패', e);
window.dispatchEvent(new CustomEvent('toast', { detail: { type: 'error', message: '캐릭터 게시 실패' } }));
} finally {
setPublishing(false);
}
};

const handleSend = async (preAddedContent = null) => {
    if (turnLimitReached) {
        window.dispatchEvent(new CustomEvent('toast', { detail: { type: 'error', message: isGuest ? '게스트는 3회까지만 생성할 수 있습니다.' : '로그인 후 이용해주세요.' } }));
        return;
    }
    let ensuredSessionId = activeSessionId;
    if (!ensuredSessionId) {
      const s = createSession({ title: '새 대화', type: 'chat' });
      ensuredSessionId = s.id;
      setActiveSessionId(s.id);
      setShowChatPanel(true);
    }
    const contentToSend = (preAddedContent != null ? preAddedContent : prompt);
    if (!contentToSend) return;

    let localUserAdded = false;
    if (preAddedContent == null) {
      const userMsg = { id: crypto.randomUUID(), role: 'user', content: contentToSend, createdAt: nowIso() };
      setMessages(curr => [...curr, userMsg]);
      localUserAdded = true;
    }
    setPrompt('');
    try { window.dispatchEvent(new CustomEvent('analytics', { detail: { name: 'agent_send', props: { sessionId: ensuredSessionId } } })); } catch {}

    const assistantThinking = { id: crypto.randomUUID(), role: 'assistant', content: '생각 중...', createdAt: nowIso(), thinking: true };
    setMessages(curr => [...curr, assistantThinking]);

    try {
      const history = (stableMessages || []).slice(-12).map(m => ({ role: m.role, content: (m.type === 'image' ? m.url : m.content), type: m.type }));
      const res = await chatAPI.agentSimulate({
        content: contentToSend,
        history,
        model: storyModel,
        sub_model: storyModel,
      });
      const aiText = res?.data?.assistant || '...';
      setMessages(curr => curr.map(m => m.id === assistantThinking.id ? { ...m, content: aiText, thinking: false } : m));
    } catch (e) {
      setMessages(curr => curr.map(m => m.id === assistantThinking.id ? { ...m, content: '응답 실패. 다시 시도해 주세요.', thinking: false, error: true } : m));
    }
};

// LS/상태 동기화를 위한 전역 헬퍼: 특정 세션의 특정 메시지를 업데이트
const updateMessageForSession = useCallback((targetSessionId, targetMessageId, updater) => {
    try {
        const currentList = isGuest
          ? (sessionLocalMessagesRef.current.get(targetSessionId) || [])
          : loadJson(LS_MESSAGES_PREFIX(user?.id) + targetSessionId, []);
        let found = false;
        const updatedList = (currentList || []).map(m => {
            if (m.id === targetMessageId) { found = true; return updater(m); }
            return m;
        });
        if (!found) {
            // 안전장치: 대상 메시지가 없다면 중복 생성 방지를 위해 아무 것도 추가하지 않음
            // 필요한 경우 초기 생성 시점에서만 thinking 메시지를 만들고, 이후에는 업데이트만 허용
        }
        if (isGuest) {
          sessionLocalMessagesRef.current.set(targetSessionId, updatedList);
        } else {
          saveJson(LS_MESSAGES_PREFIX(user?.id) + targetSessionId, updatedList);
        }
        if (activeSessionIdRef.current === targetSessionId) setMessages(updatedList);
        return updatedList;
    } catch { return; }
}, [isGuest, setMessages]);

// 특정 어시스턴트 메시지 리런: 태그/하이라이트/추천 제거 → 스피너 → 재생성
const handleRerun = useCallback(async (msg) => {
  try {
    const sid = activeSessionIdRef.current;
    if (!sid || !msg || msg.role !== 'assistant') return;
    // 1) 태그 초기화
    setRemixSelected(prev => ({ ...prev, [msg.id]: [] }));
    // 2) 아래에 붙은 하이라이트/로딩/추천 제거
    const list = isGuest ? (sessionLocalMessagesRef.current.get(sid) || []) : loadJson(LS_MESSAGES_PREFIX(user?.id) + sid, []);
    const idx = list.findIndex(m => m.id === msg.id);
    if (idx === -1) return;
    const headList = list.slice(0, idx + 1);
    const tail = list.slice(idx + 1).filter(m => !(m.type === 'story_highlights' || m.type === 'story_highlights_loading' || m.type === 'recommendation'));
    const cleaned = [...headList, ...tail];
    if (isGuest) sessionLocalMessagesRef.current.set(sid, cleaned); else saveJson(LS_MESSAGES_PREFIX(user?.id) + sid, cleaned);
    if (activeSessionId === sid) setMessages(cleaned);
    // 3) 메시지를 스피너로 전환
    updateMessageForSession(sid, msg.id, (m) => ({ ...m, thinking: true, streaming: false, content: '', fullContent: '' }));
    setGenState(sid, { status: GEN_STATE.PREVIEW_STREAMING, controller: null, assistantId: msg.id });
    // 4) 직전 사용자 입력(텍스트/이미지) 묶음 복원
    let userText = '';
    let imageUrl = null;
    for (let i = idx - 1; i >= 0; i--) {
      const it = cleaned[i];
      if (it.role === 'user' && !it.type && !userText) userText = (it.content || '').toString();
      if (it.role === 'user' && it.type === 'image' && !imageUrl) imageUrl = it.url;
      if (userText && imageUrl) break;
    }
    const staged = [];
    if (imageUrl) staged.push({ type: 'image', url: imageUrl });
    if (userText) staged.push({ type: 'text', body: userText });
    // 5) 백엔드 호출(텍스트 생성)
    const res = await chatAPI.agentSimulate({ staged, storyMode: msg.storyMode || 'auto', model: storyModel, sub_model: storyModel });
    const assistantText = res?.data?.assistant || '';
    const decidedMode = res?.data?.story_mode || (msg.storyMode || 'auto');
    updateMessageForSession(sid, msg.id, (m) => ({ ...m, thinking: false, streaming: false, content: assistantText.slice(0,500), fullContent: assistantText }));
    // 6) 하이라이트 로딩 추가 → 생성 후 교체
    const loadingId = crypto.randomUUID();
    const afterText = isGuest ? (sessionLocalMessagesRef.current.get(sid) || []) : loadJson(LS_MESSAGES_PREFIX(user?.id || 'guest') + sid, []);
    const withLoading = [...afterText.slice(0, idx + 1), { id: loadingId, type: 'story_highlights_loading', createdAt: nowIso() }, ...afterText.slice(idx + 1)];
    if (isGuest) {
      sessionLocalMessagesRef.current.set(sid, withLoading);
      try { sessionStorage.setItem(LS_MESSAGES_PREFIX(user?.id || 'guest') + sid, JSON.stringify(withLoading)); } catch {}
    } else {
      saveJson(LS_MESSAGES_PREFIX(user?.id || 'guest') + sid, withLoading);
    }
    if (activeSessionId === sid) setMessages(withLoading);
    
    const originalSessionId = sid; // 세션 캡처

    // vision_tags 읽기
    let visionTags = null;
    try {
      const stored = localStorage.getItem(`agent:vision:${currentSessionId}`);  // 또는 activeSessionId
      if (stored) {
        const parsed = JSON.parse(stored);
        visionTags = parsed.tags;
      }
    } catch {}

    try {
      const hiRes = await chatAPI.agentGenerateHighlights({ text: assistantText, image_url: imageUrl || '', story_mode: decidedMode || 'auto',vision_tags: visionTags });
      const scenes = (hiRes?.data?.story_highlights || []).map((s, i) => ({ ...s, id: crypto.randomUUID() }));
      const list2 = isGuest ? (sessionLocalMessagesRef.current.get(originalSessionId) || []) : loadJson(LS_MESSAGES_PREFIX(user?.id || 'guest') + originalSessionId, []);
      const idx2 = list2.findIndex(m => m.id === loadingId);
      const replaced = [...list2.slice(0, idx2), { id: crypto.randomUUID(), type: 'story_highlights', scenes, createdAt: nowIso() }, ...list2.slice(idx2 + 1)];
      if (isGuest) {
        sessionLocalMessagesRef.current.set(originalSessionId, replaced);
        try { sessionStorage.setItem(LS_MESSAGES_PREFIX(user?.id || 'guest') + originalSessionId, JSON.stringify(replaced)); } catch {}
      } else {
        saveJson(LS_MESSAGES_PREFIX(user?.id || 'guest') + originalSessionId, replaced);
      }
      if (activeSessionIdRef.current === originalSessionId) setMessages(replaced);
    } catch (_) {
      // 하이라이트 실패 시 로딩 제거만
      const list3 = isGuest ? (sessionLocalMessagesRef.current.get(originalSessionId) || []) : loadJson(LS_MESSAGES_PREFIX(user?.id || 'guest') + originalSessionId, []);
      const idx3 = list3.findIndex(m => m.id === loadingId);
      const reduced = idx3 >= 0 ? [...list3.slice(0, idx3), ...list3.slice(idx3 + 1)] : list3;
      if (isGuest) {
        sessionLocalMessagesRef.current.set(originalSessionId, reduced);
        try { sessionStorage.setItem(LS_MESSAGES_PREFIX(user?.id || 'guest') + originalSessionId, JSON.stringify(reduced)); } catch {}
      } else {
        saveJson(LS_MESSAGES_PREFIX(user?.id || 'guest') + originalSessionId, reduced);
      }
      if (activeSessionIdRef.current === originalSessionId) setMessages(reduced);
    }
    // 7) 추천 카드 재삽입(하이라이트 뒤)
    const finalList = isGuest ? (sessionLocalMessagesRef.current.get(originalSessionId) || []) : loadJson(LS_MESSAGES_PREFIX(user?.id || 'guest') + originalSessionId, []);
    const insertAt = finalList.findIndex(m => m.type === 'story_highlights' && finalList.indexOf(m) > idx);
    const recMsg = { id: crypto.randomUUID(), role: 'assistant', type: 'recommendation', createdAt: nowIso() };
    let injected;
    if (insertAt !== -1) injected = [...finalList.slice(0, insertAt + 1), recMsg, ...finalList.slice(insertAt + 1)];
    else injected = [...finalList, recMsg];
    if (isGuest) {
      sessionLocalMessagesRef.current.set(originalSessionId, injected);
      try { sessionStorage.setItem(LS_MESSAGES_PREFIX(user?.id || 'guest') + originalSessionId, JSON.stringify(injected)); } catch {}
    } else {
      saveJson(LS_MESSAGES_PREFIX(user?.id || 'guest') + originalSessionId, injected);
    }
    if (activeSessionIdRef.current === originalSessionId) setMessages(injected);
  } catch {}
}, [activeSessionId, isGuest, setMessages, storyModel, updateMessageForSession, setGenState]);

// 백그라운드 완료 감시자 (세션별 1개)
const headlessWatchersRef = useRef(new Map()); // sid -> true(동작중)
const startHeadlessWatcher = useCallback(async (sid) => {
  if (!sid) return;
  if (headlessWatchersRef.current.get(sid)) return; // 이미 동작 중
  headlessWatchersRef.current.set(sid, true);
  try {
    // jobId가 아직 없는 경우 잠시 대기(최대 3초)
    let attempts = 0;
    let jobId = getGenState(sid).jobId;
    while (!jobId && attempts < 30) {
      await new Promise(r => setTimeout(r, 100));
      jobId = getGenState(sid).jobId;
      attempts += 1;
    }
    const assistantId = getGenState(sid).assistantId;
    if (!jobId || !assistantId) return; // 감시 불가

    const startTs = Date.now();
    const maxMs = 1000 * 60 * 90; // 90분 안전 한도
    while (true) {
      try {
        const res = await storiesAPI.getGenerateJobStatus(jobId);
        const job = res?.data || null;
        if (!job) { await new Promise(r => setTimeout(r, 1500)); continue; }
        const status = job.status;
        if (status === 'done' && job.final_result && (job.final_result.content || job.final_result.text || job.final_result.delta)) {
          const content = job.final_result.content || job.final_result.text || '';
          updateMessageForSession(sid, assistantId, (m) => ({ ...m, thinking: false, streaming: false, content: (content||'').slice(0,500), fullContent: content }));
          setGenState(sid, { status: GEN_STATE.COMPLETED, controller: null });
          break;
        }
        if (status === 'error') {
          const msg = job.error_message || '생성 중 오류가 발생했습니다.';
          updateMessageForSession(sid, assistantId, (m) => ({ ...m, thinking: false, error: true, content: `오류: ${msg}` }));
          setGenState(sid, { status: GEN_STATE.FAILED, controller: null });
          break;
        }
        if (status === 'cancelled') {
          updateMessageForSession(sid, assistantId, (m) => ({ ...m, thinking: false, content: (m.content||'').toString() }));
          setGenState(sid, { status: GEN_STATE.STOPPED, controller: null });
          break;
        }
        if (Date.now() - startTs > maxMs) {
          break; // 타임아웃
        }
        await new Promise(r => setTimeout(r, 1500));
      } catch (_) {
        await new Promise(r => setTimeout(r, 2000));
      }
    }
  } finally {
    headlessWatchersRef.current.delete(sid);
  }
}, [getGenState, updateMessageForSession, setGenState]);

const handleGenerate = useCallback(async (overridePrompt = null, attachedImageUrl = null) => {
    if (turnLimitReached) {
        window.dispatchEvent(new CustomEvent('toast', { detail: { type: 'error', message: isGuest ? '게스트는 3회까지만 생성할 수 있습니다. 로그인 후 이용해주세요.' : '최대 생성 횟수에 도달했습니다.' } }));
        return;
    }
    
    const effectivePrompt = overridePrompt || prompt;
    if (!effectivePrompt) return;

    // 시작 시점의 세션ID를 캡처(세션 덮어쓰기 방지)
    let sessionIdForJob = activeSessionId;

    if (!sessionIdForJob) {
        const newSession = createSession({ title: '새 대화' });
        sessionIdForJob = newSession.id;
        setActiveSessionId(sessionIdForJob);
        setMessages([]); // 새 세션이므로 메시지 목록 초기화
    }

    // UI 준비
    setShowChatPanel(true);
    setPrompt('');

    // 사용자 메시지 추가
    const userMessage = { id: crypto.randomUUID(), role: 'user', content: effectivePrompt, createdAt: nowIso() };
    const lsBefore = isGuest ? (sessionLocalMessagesRef.current.get(sessionIdForJob) || []) : loadJson(LS_MESSAGES_PREFIX(user?.id || 'guest') + sessionIdForJob, []);
    const withUser = [...(lsBefore || []), userMessage];
    if (isGuest) {
        sessionLocalMessagesRef.current.set(sessionIdForJob, withUser);
    if (activeSessionId === sessionIdForJob) setMessages(withUser);
    } else {
        saveJson(LS_MESSAGES_PREFIX(user?.id || 'guest') + sessionIdForJob, withUser);
        if (activeSessionId === sessionIdForJob) setMessages(withUser);
    }
    
    // 어시스턴트 자리 확보
    const assistantThinkingId = crypto.randomUUID();
    assistantMessageIdRef.current = assistantThinkingId;
    setGenState(sessionIdForJob, { assistantId: assistantThinkingId });
    // 생성 버전 증가 및 캡처
    const sessionVersion = (sessionVersionRef.current.get(sessionIdForJob) || 0) + 1;
    sessionVersionRef.current.set(sessionIdForJob, sessionVersion);
    const thinkingMessage = { id: assistantThinkingId, role: 'assistant', content: '', createdAt: nowIso(), thinking: true };
    const withThinking = [...withUser, thinkingMessage];
    if (isGuest) {
        sessionLocalMessagesRef.current.set(sessionIdForJob, withThinking);
    if (activeSessionId === sessionIdForJob) setMessages(withThinking);
    } else {
        saveJson(LS_MESSAGES_PREFIX(user?.id || 'guest') + sessionIdForJob, withThinking);
        if (activeSessionId === sessionIdForJob) setMessages(withThinking);
    }

    try {
        const kw = Array.from(new Set([
            ...(effectivePrompt || '').split(/[\,\s]+/).filter(Boolean),
            w5.background, w5.place, w5.role, (w5.speaker || '').replace(/가$/, ''), w5.mutation, w5.goal,
        ].filter(Boolean))).slice(0, 10);

        // 세션/메시지 업데이트 헬퍼(현재 작업용)
        const updateAssistant = (updater) => updateMessageForSession(sessionIdForJob, assistantThinkingId, updater);
        
        // 이미지가 붙은 경우: 비스트리밍 경로로 전환
        if (attachedImageUrl) {
            try {
                setGenState(sessionIdForJob, { status: GEN_STATE.PREVIEW_STREAMING });
                const historyBase = (stableMessages || []).slice(-10).map(m => ({ role: m.role, content: (m.type === 'image' ? m.url : m.content), type: m.type }));
                const history = [
                  ...historyBase,
                  { role: 'user', content: effectivePrompt, type: undefined },
                  { role: 'user', content: attachedImageUrl, type: 'image' },
                ];
                const res = await chatAPI.agentSimulate({
                    content: effectivePrompt,
                    history,
                    model: storyModel,
                    sub_model: storyModel,
                });
                const aiText = res?.data?.assistant || '...';
                updateAssistant(m => ({ ...m, content: aiText, thinking: false, streaming: false }));
                
                // 추천 카드 메시지 추가 (이미지 대신)
                const recommendMsg = { 
                  id: crypto.randomUUID(), 
                  role: 'assistant', 
                  type: 'recommendation',
                  createdAt: nowIso() 
                };
                if (isGuest) {
                    const arr = sessionLocalMessagesRef.current.get(sessionIdForJob) || [];
                    const next = [...arr, recommendMsg];
                    sessionLocalMessagesRef.current.set(sessionIdForJob, next);
                    if (activeSessionId === sessionIdForJob) setMessages(next);
                } else {
                    const arr = loadJson(LS_MESSAGES_PREFIX(user?.id || 'guest') + sessionIdForJob, []);
                    const next = [...arr, recommendMsg];
                    saveJson(LS_MESSAGES_PREFIX(user?.id || 'guest') + sessionIdForJob, next);
                    if (activeSessionId === sessionIdForJob) setMessages(next);
                }
                setGenState(sessionIdForJob, { status: GEN_STATE.COMPLETED, controller: null });
                return; // 이미지 경로 완료
            } catch (e) {
                updateAssistant(m => ({ ...m, content: '응답 실패. 다시 시도해 주세요.', thinking: false, error: true }));
                setGenState(sessionIdForJob, { status: GEN_STATE.FAILED, controller: null });
                return;
            }
        }

        const stream = await storiesAPI.generateStoryStream({
            prompt: effectivePrompt,
            keywords: kw,
            model: storyModel,
            is_public: isPublic,
            target_chars: 30000,
            chapters: 5,
        }, {
            onStart: ({ controller }) => {
                if ((sessionVersionRef.current.get(sessionIdForJob) || 0) !== sessionVersion) return;
                setGenState(sessionIdForJob, { controller, status: GEN_STATE.PREVIEW_STREAMING });
                // P2: 스트리밍 시작 시 하단 여부에 따라 따라가기 결정
                try {
                  const el = scrollElement;
                  if (el) {
                    const atBottom = (el.scrollHeight - el.clientHeight) <= (el.scrollTop + BOTTOM_THRESHOLD);
                    isAtBottomRef.current = atBottom;
                    isFollowingRef.current = atBottom;
                    setShowScrollDown(!atBottom);
                  }
                } catch {}
            },
            onMeta: (payload) => {
                if ((sessionVersionRef.current.get(sessionIdForJob) || 0) !== sessionVersion) return;
                const jobId = payload?.job_id || null;
                jobId && jobToSessionRef.current.set(jobId, sessionIdForJob);
                setGenState(sessionIdForJob, { jobId, status: GEN_STATE.PREVIEW_STREAMING });
            },
            onStageStart: (payload) => {
                // 단계 시작: 라벨 갱신
                setCanvasStageLabel(formatCanvasStageLabel(payload));
            },
            onStageEnd: () => {
                // 단계 종료: 다음 단계 진입시 갱신되므로 여기선 유지
            },
            onPreview: (buf) => {
                // 미리보기 수신 → PREVIEW_STREAMING 표시, 더보기 활성화를 위해 곧바로 AWAITING_CANVAS로 전환
                if ((sessionVersionRef.current.get(sessionIdForJob) || 0) !== sessionVersion) return;
                updateAssistant(m => ({ ...m, thinking: false, content: (buf || '').slice(0, 500), fullContent: buf, type: 'story_preview' }));
                setGenState(sessionIdForJob, { status: GEN_STATE.AWAITING_CANVAS });
                if (showStoryViewerSheet) setStoryForViewer(prev => ({ ...prev, content: buf }));
                window.dispatchEvent(new Event('agent:sessionsChanged'));
                // P2: 미리보기 도착 시 조건부 스크롤
                if (isFollowingRef.current) scrollToBottomRaf(); else setShowScrollDown(true);
            },
            onEpisode: (ev) => {
                const delta = ev?.delta || '';
                if (!delta) return;
                if ((sessionVersionRef.current.get(sessionIdForJob) || 0) !== sessionVersion) return;
                setGenState(sessionIdForJob, { status: GEN_STATE.CANVAS_STREAMING });
                updateAssistant(m => {
                    const nextContent = (m.fullContent || m.content || '') + delta;
                    if (showStoryViewerSheet) setStoryForViewer(prev => ({ ...prev, content: nextContent }));
                    return { ...m, content: nextContent.slice(0, 500), fullContent: nextContent };
                });
                // P2: 델타 도착 시 조건부 스크롤
                if (isFollowingRef.current) scrollToBottomRaf(); else setShowScrollDown(true);
            },
            onFinal: () => {
                if ((sessionVersionRef.current.get(sessionIdForJob) || 0) !== sessionVersion) return;
                updateAssistant(m => ({ ...m, thinking: false, streaming: false }));
                setGenState(sessionIdForJob, { status: GEN_STATE.COMPLETED, controller: null });
                setCanvasStageLabel('완료되었습니다');
                // 최종 완료 시에만 보관함에 반영
                if (!isGuest) {
                    try {
                        const finalMessages = loadJson(LS_MESSAGES_PREFIX(user?.id || 'guest') + sessionIdForJob, []);
                        const finalAssistantMessage = finalMessages.find(m => m.id === assistantThinkingId);
                        // AI 응답에서 스토리 제목 자동 생성
                        const fullText = finalAssistantMessage?.fullContent || finalAssistantMessage?.content || '';
                        let title = '무제 이야기';
                        
                        // 스토리 내용에서 핵심 키워드 추출
                        const lines = fullText.split('\n').filter(line => 
                          line.trim() && 
                          !line.includes('물론입니다') && 
                          !line.includes('작성하겠습니다') &&
                          !line.includes('만들어보겠습니다')
                        );
                        
                        if (lines.length > 0) {
                          const firstLine = lines[0];
                          // 주인공이나 핵심 상황 찾기
                          if (firstLine.includes('그녀') || firstLine.includes('여자')) {
                            title = '그녀의 이야기';
                          } else if (firstLine.includes('그') || firstLine.includes('남자')) {
                            title = '그의 이야기';
                          } else if (firstLine.includes('카페') || firstLine.includes('커피')) {
                            title = '카페에서 시작된 이야기';
                          } else if (firstLine.includes('비') || firstLine.includes('비가')) {
                            title = '비 오는 날의 이야기';
                          } else if (firstLine.includes('사랑') || firstLine.includes('연인')) {
                            title = '사랑하는 이야기';
                          } else if (firstLine.includes('이별') || firstLine.includes('헤어')) {
                            title = '이별하는 이야기';
                          } else if (firstLine.includes('꿈')) {
                            title = '꿈을 꾸는 이야기';
                          } else if (firstLine.includes('밤') || firstLine.includes('새벽')) {
                            title = '밤에 일어난 이야기';
                          } else if (firstLine.includes('아침') || firstLine.includes('햇살')) {
                            title = '아침의 이야기';
                          } else {
                            // 기본: 첫 단어나 구를 활용
                            const words = firstLine.split(/[\s,\.\!\?]+/).filter(w => w.length > 1);
                            if (words.length > 0) {
                              title = `${words[0]}의 이야기`;
                            }
                          }
                        }
                        
                        const newStory = { id: crypto.randomUUID(), title, sessionId: sessionIdForJob, model: storyModel, is_public: false, createdAt: nowIso(), source: 'local' };
                        setStoriesList(prev => [newStory, ...prev]);
                    } catch {}
                    updateSession(sessionIdForJob, { jobId: null, assistantMessageId: null });
                }
                window.dispatchEvent(new Event('agent:sessionsChanged'));
                // 필요 시 AI 이미지 말풍선 추가
                try {
                  if (attachedImageUrl) {
                    const imgMsg = { id: crypto.randomUUID(), role: 'assistant', type: 'image', url: attachedImageUrl, createdAt: nowIso() };
                    if (isGuest) {
                      const arr = sessionLocalMessagesRef.current.get(sessionIdForJob) || [];
                      const next = [...arr, imgMsg];
                      sessionLocalMessagesRef.current.set(sessionIdForJob, next);
                      if (activeSessionId === sessionIdForJob) setMessages(next);
                    } else {
                      const arr = loadJson(LS_MESSAGES_PREFIX(user?.id || 'guest') + sessionIdForJob, []);
                      const next = [...arr, imgMsg];
                      saveJson(LS_MESSAGES_PREFIX(user?.id || 'guest') + sessionIdForJob, next);
                      if (activeSessionId === sessionIdForJob) setMessages(next);
                    }
                  }
                } catch {}
            },
            onError: (payload) => {
                if ((sessionVersionRef.current.get(sessionIdForJob) || 0) !== sessionVersion) return;
                updateAssistant(m => ({ ...m, content: `오류: ${payload.message}`, error: true, thinking: false }));
                setGenState(sessionIdForJob, { status: GEN_STATE.FAILED, controller: null });
                setCanvasStageLabel('오류가 발생했습니다.');
                updateSession(sessionIdForJob, { jobId: null, assistantMessageId: null });
            }
        });

        if (!stream.ok) {
            // 사용자가 세션 전환/중단으로 abort한 경우: 실패로 처리하지 않음
            if (stream.aborted) {
                if ((sessionVersionRef.current.get(sessionIdForJob) || 0) === sessionVersion) {
                  setGenState(sessionIdForJob, { status: GEN_STATE.STOPPED, controller: null });
                }
                // 사용자 중지 시에는 백그라운드 감시를 시작하지 않음
        return;
    }
            throw new Error(stream.error?.message || '스트리밍 중 오류 발생');
        }

        } catch (e) {
        console.error('Story generation failed:', e);
        if (sessionIdForJob) setGenState(sessionIdForJob, { status: GEN_STATE.FAILED, controller: null });
        updateSession(sessionIdForJob, { jobId: null, assistantMessageId: null });
    }
}, [activeSessionId, createSession, setMessages, w5, prompt, storyModel, isPublic, isGuest, messages, updateSession, showStoryViewerSheet, updateMessageForSession, turnLimitReached]);

// 프리뷰 확장: 단순 뷰어 오픈 (서버 재요청 없음)
const handleExpandCanvas = (fullContent, relatedImageUrl = null) => {
  // 스토리 내용에서 제목 자동 생성
  let title = '무제 이야기';
  
  const lines = (fullContent || '').split('\n').filter(line => 
    line.trim() && 
    !line.includes('물론입니다') && 
    !line.includes('작성하겠습니다') &&
    !line.includes('만들어보겠습니다')
  );
  
  if (lines.length > 0) {
    const firstLine = lines[0];
    // 주인공이나 핵심 상황 찾기
    if (firstLine.includes('그녀') || firstLine.includes('여자')) {
      title = '그녀의 이야기';
    } else if (firstLine.includes('그') || firstLine.includes('남자')) {
      title = '그의 이야기';
    } else if (firstLine.includes('카페') || firstLine.includes('커피')) {
      title = '카페에서 시작된 이야기';
    } else if (firstLine.includes('비') || firstLine.includes('비가')) {
      title = '비 오는 날의 이야기';
    } else if (firstLine.includes('사랑') || firstLine.includes('연인')) {
      title = '사랑하는 이야기';
    } else if (firstLine.includes('이별') || firstLine.includes('헤어')) {
      title = '이별하는 이야기';
    } else if (firstLine.includes('꿈')) {
      title = '꿈을 꾸는 이야기';
    } else if (firstLine.includes('밤') || firstLine.includes('새벽')) {
      title = '밤에 일어난 이야기';
    } else if (firstLine.includes('아침') || firstLine.includes('햇살')) {
      title = '아침의 이야기';
    } else {
      // 기본: 첫 단어나 구를 활용
      const words = firstLine.split(/[\s,\.\!\?]+/).filter(w => w.length > 1);
      if (words.length > 0) {
        title = `${words[0]}의 이야기`;
      }
    }
  }
  
  setStoryForViewer({
    title,
    content: fullContent || '',
    imageUrl: relatedImageUrl // 관련 이미지 URL 추가
  });
  setShowStoryViewerSheet(true);
};

// 계속보기(인라인 이어쓰기) - 태그/하이라이트/추천 제거 → 스피너 → 동일 말풍선 타이핑
const handleContinueInline = useCallback(async (msg) => {
  try {
    const sid = activeSessionId;
    if (!sid) return;

    // 1) 아래 붙은 하이라이트/로딩/추천 제거
    const list = isGuest ? (sessionLocalMessagesRef.current.get(sid) || []) : loadJson(LS_MESSAGES_PREFIX(user?.id || 'guest') + sid, []);
    const idx = list.findIndex(m => m.id === msg.id);
    if (idx === -1) return;
    const head = list.slice(0, idx + 1);
    const tail = list.slice(idx + 1).filter(m => !(m.type === 'story_highlights' || m.type === 'story_highlights_loading' || m.type === 'recommendation'));
    const cleaned = [...head, ...tail];
    if (isGuest) sessionLocalMessagesRef.current.set(sid, cleaned); else saveJson(LS_MESSAGES_PREFIX(user?.id || 'guest') + sid, cleaned);
    if (activeSessionId === sid) setMessages(cleaned);

    // 2) 버튼 스피너 표시: 메시지 텍스트는 유지, continued 플래그만 세팅
    updateMessageForSession(sid, msg.id, (m) => ({ ...m, continued: true }));

    // 3) 이전 유저 이미지/텍스트 맥락 복원
    let imageUrl = null;
    for (let i = idx - 1; i >= 0; i--) {
      const it = cleaned[i];
      if (it.role === 'user' && it.type === 'image' && it.url) { imageUrl = it.url; break; }
    }
    const baseText = (msg.fullContent || msg.content || '').toString();
    const recent = baseText.slice(Math.max(0, baseText.length - 800)); // 최근 800자만 맥락으로
    const mode = msg.storyMode || 'auto';
    const continueHint = (
      mode === 'genre'
        ? "아래 본문을 즉시 이어서 300자 내외로 써줘. 같은 시점/톤/속도 유지, 메타 금지, 중복 줄이기. 다음 장면을 궁금하게 만드는 작은 훅을 포함해.\n[이어서] "
        : "아래 본문을 즉시 이어서 200~300자 분량으로 써줘. 같은 시점/톤/호흡 유지, 메타 금지, 중복 줄이기.\n[이어서] "
    ) + recent;

    // 4) 백엔드 호출(같은 파이프라인)
    const staged = [];
    if (imageUrl) staged.push({ type: 'image', url: imageUrl });
    staged.push({ type: 'text', body: continueHint });
    const res = await chatAPI.agentSimulate({ staged, mode: 'micro', storyMode: mode, model: storyModel, sub_model: storyModel });
    const appended = (res?.data?.assistant || '').toString();
    // 헤드와 구분 개행: 기존 본문이 개행으로 끝나지 않고, 추가 텍스트가 개행으로 시작하지 않으면 공백 줄 추가
    const headText = (msg.fullContent || msg.content || '').toString();
    const needSep = !(/\n\s*$/.test(headText)) && !(/^\s*\n/.test(appended));
    const sep = needSep ? "\n\n" : "";

    // 5) 스피너(버튼) → 스트리밍 전환 후, 동일 말풍선에 이어 타이핑
    const startText = headText + sep;
    updateMessageForSession(sid, msg.id, (m) => ({ ...m, streaming: true, continued: true }));
    let i = 0;
    const total = appended.length;
    const steps = 80;
    const step = Math.max(2, Math.ceil(total / steps));
    const currentSessionId = sid; // ✅ 시작 시점 세션 캡처
// ... existing code ...

    const timer = setInterval(() => {
      i = Math.min(total, i + step);
      const slice = startText + appended.slice(0, i);
      const fullText = startText + appended;

      // ✅ 저장소 항상 업데이트
      const saved = loadJson(LS_MESSAGES_PREFIX(user?.id || 'guest') + currentSessionId, []);
      const updated = saved.map(m => m.id === msg.id ? { 
        ...m, 
        content: slice, 
        fullContent: fullText,
        streaming: i < total,
        continued: i < total,
        expanded: i >= total
      } : m);
      saveJson(LS_MESSAGES_PREFIX(user?.id || 'guest') + currentSessionId, updated);

      // ✅ 현재 세션일 때만 UI 업데이트
      if (activeSessionIdRef.current === currentSessionId) {
        setMessages(updated);
      }

      if (i >= total) {
        clearInterval(timer);
        const timers = sessionTypingTimersRef.current.get(currentSessionId) || [];
        sessionTypingTimersRef.current.set(currentSessionId, timers.filter(t => t !== timer));

        // ✅ 하이라이트 재생성
        const combinedText = startText + appended;
        const placeholderId = crypto.randomUUID();
        
        const afterContinue = loadJson(LS_MESSAGES_PREFIX(user?.id || 'guest') + currentSessionId, []);
        const pos = afterContinue.findIndex(mm => mm.id === msg.id);
        const withLoading = pos > -1 ? [
          ...afterContinue.slice(0, pos + 1),
          { id: placeholderId, type: 'story_highlights_loading', createdAt: nowIso() },
          ...afterContinue.slice(pos + 1)
        ] : afterContinue;
        
        saveJson(LS_MESSAGES_PREFIX(user?.id || 'guest') + currentSessionId, withLoading);
        
        if (activeSessionIdRef.current === currentSessionId) {
          setMessages(withLoading);
        }

        // vision_tags 읽기
        let visionTags = null;
        try {
          const stored = localStorage.getItem(`agent:vision:${currentSessionId}`);  // 또는 activeSessionId
          if (stored) {
            const parsed = JSON.parse(stored);
            visionTags = parsed.tags;
          }
        } catch {}


        // ✅ 하이라이트 생성
        (async () => {
          const originalSessionId = currentSessionId;
          try {
            const hiRes = await chatAPI.agentGenerateHighlights({ text: combinedText, image_url: imageUrl || '', story_mode: mode || 'auto', vision_tags: visionTags });
            const scenes = (hiRes?.data?.story_highlights || []).map((s, i) => ({ ...s, id: crypto.randomUUID() }));
            
            const saved = loadJson(LS_MESSAGES_PREFIX(user?.id || 'guest') + originalSessionId, []);
            const pIdx = saved.findIndex(x => x.id === placeholderId);
            let replaced = saved;
            if (pIdx > -1) {
              replaced = [
                ...saved.slice(0, pIdx),
                { id: crypto.randomUUID(), type: 'story_highlights', scenes, createdAt: nowIso() },
                ...saved.slice(pIdx + 1)
              ];
            }
            
            const final = [
              ...replaced,
              { id: crypto.randomUUID(), role: 'assistant', type: 'recommendation', createdAt: nowIso() }
            ];
            
            saveJson(LS_MESSAGES_PREFIX(user?.id || 'guest') + originalSessionId, final);
            
            if (activeSessionIdRef.current === originalSessionId) {
              setMessages(final);
            }
          } catch (e) {
            const saved = loadJson(LS_MESSAGES_PREFIX(user?.id || 'guest') + originalSessionId, []);
            const pIdx = saved.findIndex(x => x.id === placeholderId);
            const reduced = pIdx >= 0 ? [...saved.slice(0, pIdx), ...saved.slice(pIdx + 1)] : saved;
            
            saveJson(LS_MESSAGES_PREFIX(user?.id || 'guest') + originalSessionId, reduced);
            
            if (activeSessionIdRef.current === originalSessionId) {
              setMessages(reduced);
            }
          }
        })();
      }
    }, 15);

    // ✅ 타이머 등록
    const timers = sessionTypingTimersRef.current.get(currentSessionId) || [];
    sessionTypingTimersRef.current.set(currentSessionId, [...timers, timer]);
  } catch (e) {
    // 실패 시 스피너 해제
    try { updateMessageForSession(activeSessionId, msg.id, (m) => ({ ...m, streaming: false, continued: false })); } catch {}
  }
}, [activeSessionId, isGuest, setMessages, updateMessageForSession, storyModel]);

// 🆕 텍스트 드래그 감지 핸들러
const handleTextSelection = useCallback((e, messageId, messageContent) => {
  // 편집 모드일 때만 작동
  if (editingMessageId !== messageId) return;
  
  // 이미 모달이 열려있으면 무시
  if (showEditModal) return;
  
  try {
    const selection = window.getSelection();
    const selectedText = selection.toString().trim();
    
    // 선택된 텍스트가 없으면 무시
    if (!selectedText || selectedText.length === 0) {
      return;
    }
    
    // 선택 범위 계산
    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    
    // 선택 영역 저장 (나중에 복원용)
    savedSelectionRef.current = range.cloneRange();
    
    // 전체 텍스트에서 선택된 부분의 인덱스 계산 (줄바꿈 normalize)
    const fullText = messageContent || '';
    const normalizedFull = fullText.replace(/\s+/g, ' ').trim();
    const normalizedSelected = selectedText.replace(/\s+/g, ' ').trim();
    const normalizedOffset = normalizedFull.indexOf(normalizedSelected);
    
    // 실제 원본 텍스트에서의 위치 추정
    let actualStart = 0;
    if (normalizedOffset !== -1) {
      let normalizedCount = 0;
      for (let i = 0; i < fullText.length && normalizedCount < normalizedOffset; i++) {
        if (!/\s/.test(fullText[i]) || (i > 0 && !/\s/.test(fullText[i-1]))) {
          normalizedCount++;
        }
        actualStart = i + 1;
      }
    }
    
    // 상태 설정
    setSelectedText(selectedText);
    setSelectionRange({
      start: actualStart,
      end: actualStart + selectedText.length,
      messageId: messageId
    });
    setModalPosition({
      top: rect.bottom + window.scrollY + 5,
      left: rect.left + window.scrollX
    });
    setShowEditModal(true);
    
  } catch (err) {
    console.error('Text selection error:', err);
  }
}, [editingMessageId, showEditModal]);

// 🆕 선택 영역 복원 핸들러
const handleRestoreSelection = useCallback(() => {
  if (savedSelectionRef.current) {
    try {
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(savedSelectionRef.current);
    } catch (err) {
      console.error('Failed to restore selection:', err);
    }
  }
}, []);

// 🆕 모달 드래그 핸들러
const handleModalMouseDown = useCallback((e) => {
  // Input 영역은 드래그 제외
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'BUTTON') {
    return;
  }
  
  setIsDraggingModal(true);
  setDragOffset({
    x: e.clientX - modalPosition.left,
    y: e.clientY - modalPosition.top
  });
}, [modalPosition]);

// 전역 마우스 이동 감지
React.useEffect(() => {
  if (!isDraggingModal) return;
  
  const handleMouseMove = (e) => {
    const newLeft = e.clientX - dragOffset.x;
    const newTop = e.clientY - dragOffset.y;
    
    // 텍스트 박스 영역 내로 제한 (대략적인 범위)
    const minLeft = 100;
    const maxLeft = window.innerWidth - 400;
    const minTop = 100;
    const maxTop = window.innerHeight - 200;
    
    setModalPosition({
      left: Math.max(minLeft, Math.min(maxLeft, newLeft)),
      top: Math.max(minTop, Math.min(maxTop, newTop))
    });
  };
  
  const handleMouseUp = () => {
    setIsDraggingModal(false);
  };
  
  document.addEventListener('mousemove', handleMouseMove);
  document.addEventListener('mouseup', handleMouseUp);
  
  return () => {
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', handleMouseUp);
  };
}, [isDraggingModal, dragOffset]);

// 🆕 부분 재생성 핸들러
const handlePartialRegenerate = useCallback(async () => {
  if (!selectionRange || !editPrompt.trim()) return;
  
  const { messageId, start, end } = selectionRange;
  const targetMessage = messages.find(m => m.id === messageId);
  if (!targetMessage) return;
  
  try {
    // 1. 모달 닫기
    setShowEditModal(false);
    setEditPrompt('');
    
    // 2. 재생성 시작 (스켈레톤 UI용)
    setRegenerating(true);
    
    const fullText = targetMessage.fullContent || targetMessage.content || '';
    const beforeText = fullText.slice(0, start);
    const selectedText = fullText.slice(start, end);
    const afterText = fullText.slice(end);
    
    // 3. 백엔드 API 호출
    const response = await chatAPI.agentPartialRegenerate({
      full_text: fullText,
      selected_text: selectedText,
      user_prompt: editPrompt,
      before_context: beforeText,
      after_context: afterText
    });
    
    const regeneratedText = response.data?.regenerated_text || selectedText;
    
    // 4. 텍스트 교체
    const newFullText = beforeText + regeneratedText + afterText;
    
    // 메시지 업데이트
    setMessages(curr => curr.map(msg => 
      msg.id === messageId 
        ? { ...msg, content: newFullText, fullContent: newFullText } 
        : msg
    ));
    
    // localStorage 저장
    const saved = loadJson(LS_MESSAGES_PREFIX(user?.id || 'guest') + activeSessionId, []);
    const updated = saved.map(msg => 
      msg.id === messageId 
        ? { ...msg, content: newFullText, fullContent: newFullText } 
        : msg
    );
    saveJson(LS_MESSAGES_PREFIX(user?.id || 'guest') + activeSessionId, updated);
    
    // 5. 재생성 완료 - 보라색 글로우 표시
    setRegenerating(false);
    setRegeneratedRange({
      messageId,
      start: beforeText.length,
      end: beforeText.length + regeneratedText.length
    });
    
    // 6. 3초 후 글로우 제거
    setTimeout(() => {
      setRegeneratedRange(null);
    }, 3000);
    
    // 7. 선택 상태 초기화
    setSelectedText('');
    setSelectionRange(null);
    
  } catch (err) {
    console.error('Partial regeneration error:', err);
    setRegenerating(false);
    setShowEditModal(false);
  }
}, [selectionRange, editPrompt, messages, activeSessionId, setMessages]);

const handleStopGeneration = async () => {
  try {
    // 현재 세션의 job/controller만 취소
    const cur = getGenState(activeSessionId);
    if (cur?.controller) {
      try { cur.controller.abort(); } catch {}
    }
    if (cur?.jobId) {
      try { await storiesAPI.cancelGenerateJob(cur.jobId); } catch {}
    }
    setGenState(activeSessionId, { status: GEN_STATE.STOPPED, controller: null });
  } catch (e) {
    console.error('Failed to stop generation:', e);
    setGenState(activeSessionId, { status: GEN_STATE.FAILED, controller: null });
  }
};

const handleDownload = async (img) => {
try {
const a = document.createElement('a');
a.href = img.url;
a.download = `agent-image-${img.id}.png`;
document.body.appendChild(a);
a.click();
a.remove();
try { window.dispatchEvent(new CustomEvent('analytics', { detail: { name: 'agent_download_image' } })); } catch {}
} catch {}
};

const handleSaveToLibrary = (img) => {
setImages(prev => [{ ...img }, ...prev]);
};

const handleInsertImageToChat = (img) => {
if (!activeSessionId) {
const s = createSession({ title: '새 대화' });
setActiveSessionId(s.id);
setShowChatPanel(true);
setTimeout(() => {
  const m = { id: crypto.randomUUID(), role: 'user', type: 'image', url: img.url, createdAt: nowIso() };
  if (!isGuest) {
    const curr = loadJson(LS_MESSAGES_PREFIX(user?.id || 'guest') + s.id, []);
    const next = [...curr, m];
    saveJson(LS_MESSAGES_PREFIX(user?.id || 'guest') + s.id, next);
  }
  setMessages(prev => [...prev, m]);
}, 0);
try { window.dispatchEvent(new CustomEvent('analytics', { detail: { name: 'agent_insert_image_chat' } })); } catch {}
return;
}
const m = { id: crypto.randomUUID(), role: 'user', type: 'image', url: img.url, createdAt: nowIso() };
setMessages(curr => [...curr, m]);
setShowChatPanel(true);
try { window.dispatchEvent(new CustomEvent('analytics', { detail: { name: 'agent_insert_image_chat' } })); } catch {}
};

const handleInsertImageToStoryOpen = (img) => {
setInsertTargetImage(img);
const list = (isGuest || !user?.id) ? [] : loadJson(LS_STORIES(user.id), []);
setStoriesList(list);
setSelectedStoryId(list[0]?.id || null);
setInsertKind('gallery');
setShowStoriesSheet(!isGuest);
};

const handleInsertImageToStoryConfirm = () => {
if (!insertTargetImage || !selectedStoryId) return;
setStoriesList(prev => prev.map(s => {
if (s.id !== selectedStoryId) return s;
if (insertKind === 'cover') {
  return { ...s, coverUrl: insertTargetImage.url };
}
const gallery = Array.isArray(s.gallery) ? s.gallery : [];
return { ...s, gallery: [insertTargetImage.url, ...gallery] };
}));
setShowStoriesSheet(false);
setInsertTargetImage(null);
try { window.dispatchEvent(new CustomEvent('analytics', { detail: { name: 'agent_insert_image_story', props: { kind: insertKind } } })); } catch {}
};

const onSubmit = async (e) => {
e.preventDefault();
try {
  const content = prompt?.trim() || formatW5AsUserMessage(w5, prompt);
    if (!content) return;
    // 사용자 말풍선 먼저
    setMessages(curr => [...curr, { id: crypto.randomUUID(), role: 'user', content, createdAt: nowIso() }]);
setShowChatPanel(true);
    // 생성 스트리밍 호출 (story 모드 기준 고정)
    await handleGenerate(content);
    setPrompt('');
  } catch (err) {
    console.error('submit failed', err);
  }
};

const handleSwipeStart = (e) => {
try { setTouchStartX(e.touches[0]?.clientX ?? null); } catch {}
};
const handleSwipeEnd = (e) => {
try {
const x = e.changedTouches[0]?.clientX ?? null;
if (touchStartX != null && x != null) {
  const dx = x - touchStartX;
  if (dx > 60) navigate('/');
}
} catch {}
setTouchStartX(null);
};

const toggleStoryVisibility = async (storyId, nextPublic) => {
try {
await storiesAPI.updateStory(storyId, { is_public: nextPublic });
setStoriesList(prev => prev.map(s => s.id === storyId ? { ...s, is_public: nextPublic } : s));
const all = user?.id ? loadJson(LS_STORIES(user.id), []) : [];
if (user?.id) {
  saveJson(LS_STORIES(user.id), all.map(s => s.id === storyId ? { ...s, is_public: nextPublic } : s));
}
window.dispatchEvent(new CustomEvent('toast', { detail: { type: 'success', message: nextPublic ? '공개로 변경되었습니다' : '비공개로 변경되었습니다' } }));
try { window.dispatchEvent(new CustomEvent('analytics', { detail: { name: 'agent_toggle_visibility', props: { storyId, is_public: nextPublic } } })); } catch {}
} catch (e) {
window.dispatchEvent(new CustomEvent('toast', { detail: { type: 'error', message: '가시성 변경 실패' } }));
}
};

const handleEnterFromCta = useCallback(async () => {
    if (turnLimitReached) {
        window.dispatchEvent(new CustomEvent('toast', { detail: { type: 'error', message: '게스트는 3회까지만 생성할 수 있습니다. 로그인 후 이용해주세요.' } }));
        return;
    }
    try {
      let content = (quickIdx >= 0 ? (quickText || '') : formatW5AsUserMessage(w5, '')).trim();
      if (content) {
          content += " 웹소설 써줘.";
          // 모든 복잡한 처리를 handleGenerate에 위임
          handleGenerate(content);
      }
    } catch (e) {
      console.error("Error from CTA:", e);
    }
}, [quickIdx, quickText, w5, handleGenerate]);

// 프롬프트에 토큰 삽입(액션/이모지)
const insertToPrompt = useCallback((token) => {
  try {
    const t = String(token || '').trim();
    if (!t) return;
    setPrompt(prev => (prev ? `${prev} ${t}` : t));
    try { inputRef.current?.focus(); } catch {}
  } catch {}
}, []);

// 캐릭터 선택 핸들러 (일상 → 캐릭터 채팅 심리스 연결)
const handleCharacterSelect = useCallback(async (character, generatedText, imageUrl, sessionId, existingRoomId) => {
  try {
    window.__agent = { sessionId, generatedText, imageUrl };
    console.log('[agent:select]', { sessionId, generatedText, imageUrl });
  } catch {}
  
  
  try {
    setChatLoading(true);
    setSelectedCharacter(character);
    
    let roomId = existingRoomId;
    
    if (!roomId) {
      // ✅ localStorage에서 vision 정보 읽기
      let visionTags = null;
      let visionCtx = null;
      try {
        const stored = localStorage.getItem(`agent:vision:${sessionId}`);
        if (stored) {
          const parsed = JSON.parse(stored);
          visionTags = parsed.tags;
          visionCtx = parsed.ctx;
        }
      } catch {}
      
      const roomRes = await chatAPI.startChatWithContext({
        character_id: character.id,
        agent_text: generatedText,
        image_url: imageUrl,
        session_id: sessionId,
        vision_tags: visionTags,   // ✅ 추가
        vision_ctx: visionCtx       // ✅ 추가
      });
      roomId = roomRes.data.id;
    }
    
    setChatRoomId(roomId);
    try {
      localStorage.setItem(
        LS_INLINE_PREFIX(user?.id || 'temp') + activeSessionId,
        JSON.stringify({
          roomId,
          character: {
            id: character.id,
            name: character.name,
            avatar_url: character.avatar_url || character.thumbnail_url || null
          }
        })
      );
    } catch {}
    setChatFocused(true);
    setChatLoading(false); // 로딩 완료
    
    // 채팅창으로 스크롤
    setTimeout(() => {
      chatContainerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 100);
  } catch (err) {
    console.error('Failed to start character chat:', err);
    setChatLoading(false); // 에러 시에도 로딩 해제
    window.dispatchEvent(new CustomEvent('toast', { 
      detail: { type: 'error', message: '채팅을 시작할 수 없습니다.' } 
    }));
  }
}, []);

// 채팅 닫기 핸들러
const handleCloseChat = useCallback(() => {
  setSelectedCharacter(null);
  setChatRoomId(null);
  setChatFocused(false);
  setChatLoading(false);
  try {
    if (user?.id) {
      localStorage.removeItem(LS_INLINE_PREFIX(user.id) + activeSessionId);
    }
  } catch {}
}, [user?.id, activeSessionId]);

// 외부 클릭 감지 (Composer 다시 보이기)
useEffect(() => {
  const handleClickOutside = (e) => {
    if (chatContainerRef.current && !chatContainerRef.current.contains(e.target)) {
      setChatFocused(false);
    }
  };

  if (selectedCharacter) {
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }
}, [selectedCharacter]);

return (
<AppLayout 
  SidebarComponent={AgentSidebar}
  sidebarProps={{ 
    onCreateSession: handleCreateSession, 
    activeSessionId, 
    onSessionSelect: handleSessionSelect, 
    onDeleteSession: handleDeleteSession,
    isGuest,
    isNewChatButtonDisabled,
  }}
>
 <div className="h-full flex flex-col bg-gray-900 text-gray-200">
      <div className="flex-shrink-0">
     {/* 좌/우 스와이프 유도 화살표 오버레이 */}
     <div>
       <button
        type="button"
        aria-label="대시보드로"
        onClick={(e) => e.preventDefault()}
        className="hidden"
       >
        <span className="rotate-180 block">
          <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-6 h-6">
            <path d="M8 5l8 7-8 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </span>
        </button>
       <button
        type="button"
        aria-label="입력으로 이동"
        onClick={(e) => e.preventDefault()}
        className="hidden"
       >
        <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-6 h-6">
          <path d="M8 5l8 7-8 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        </button>
      </div>
      <div className="grid grid-cols-3 items-center px-6 md:px-8 py-6">
         <div />
         <div className="flex items-center gap-2 justify-center">
           <Link
            to="/dashboard"
            className={`${onDashboardTab ? 'bg-gradient-to-r from-purple-600 to-fuchsia-600 text-white shadow-md' : 'bg-transparent text-purple-300'} px-3 py-1 rounded-full border ${onDashboardTab ? 'border-transparent' : 'border-purple-500/60'} hover:bg-purple-700/20 transition-colors`}
           >메인</Link>
           <span
            className={`${onAgentTab ? 'bg-gradient-to-r from-purple-600 to-fuchsia-600 text-white shadow-md' : 'bg-transparent text-purple-300'} px-3 py-1 rounded-full border ${onAgentTab ? 'border-transparent' : 'border-purple-500/60'} hover:bg-purple-700/20 transition-colors select-none`}
           >스토리 에이전트</span>
    </div>
         <div className="justify-self-end flex items-center gap-2">
           <button onClick={() => navigate('/dashboard')} className="p-2 rounded-full border border-gray-600/60 bg-transparent text-gray-300 hover:bg-gray-700/40" title="닫기">
             <X className="h-4 w-4" />
           </button>
        </div>
            </div>
              </div>
    <div className="flex-1 min-h-0">
      <div className="overflow-y-auto pb-40 relative" ref={messagesContainerRef} style={{ maxHeight: 'calc(100vh - 160px)' }}>
        {!showChatPanel ? (
            <div className="px-6 md:px-8">
              <div className="flex flex-col items-center justify-center select-none gap-6">
                <h1 className="text-4xl md:text-6xl font-semibold tracking-tight bg-gradient-to-r from-purple-400 via-fuchsia-400 to-pink-400 text-transparent bg-clip-text drop-shadow-[0_0_10px_rgba(168,85,247,0.35)] mb-2 md:mb-3">
                  {user ? `${user.username}님의 일상에, 판타지를 보여줄게요` : '당신의 일상에, 판타지를 보여줄게요'}
                </h1>
                <div className="mb-4 md:mb-6 flex flex-col md:flex-row items-start md:items-center gap-3">
                  <span className="text-lg md:text-xl text-purple-300/90 drop-shadow-[0_0_6px_rgba(168,85,247,0.25)]">
                    {todayLabel} 오늘, 3245개의 스토리가 업로드되었습니다. 빠져보실래요?
                  </span>
                  <button
                    type="button"
                    onClick={() => navigate('/dashboard')}
                    className="inline-flex items-center px-4 py-1.5 rounded-full bg-gradient-to-r from-purple-600 to-fuchsia-600 text-white shadow-md hover:brightness-110"
                    title="메인으로"
                  >보러가기 &gt;</button>
              </div>
                <div className="w-full max-w-5xl">
                  <div className="mt-4 md:mt-6 space-y-4" />
            </div>
                      </div>
                    </div>
          ) : (
          <div className="w-full max-w-4xl mx-auto h-full flex flex-col px-3">
              {(mode === 'char' || mode === 'sim') && (
                <div className="flex-shrink-0 p-3 border-b border-gray-700/60 mb-4">
              <div className="flex items-center justify-between">
                    <h2 className="text-white text-base font-semibold">{activeSession?.title || '새 대화'}</h2>
                <div className="flex items-center gap-2">
                  <Badge className="bg-gray-700 text:white">{userTurns}/{generationLimit} 턴</Badge>
                        <Button size="sm" variant="ghost" className="text-gray-300 hover:bg-gray-700/60 hover:text-white" onClick={() => { const current = sessions.find(s => s.id === activeSessionId); const next = window.prompt('세션 이름 변경', current?.title || '새 대화'); if (next && next.trim()) updateSession(activeSessionId, { title: next.trim() }); }}>이름 변경</Button>
                        <Button size="sm" variant="ghost" className="text-gray-300 hover:bg-gray-700/60 hover:text:white" onClick={() => { setMessages([]); try { saveJson(LS_MESSAGES_PREFIX(user?.id || 'guest') + activeSessionId, []); } catch {} }}>대화 지우기</Button>
                        <Button size="sm" variant="ghost" className="text-red-400 hover:bg-red-500/10 hover:text-red-300" onClick={() => handleDeleteSession(activeSessionId)}>세션 삭제</Button>
                        <Button size="sm" className="bg-green-600 hover:bg-green-700 text:white" onClick={() => setShowPublishSheet(true)} disabled={(stableMessages||[]).filter(m=>m.role==='assistant'&&m.content).length===0}>
                    공개 · 캐릭터 만들기
                  </Button>
                </div>
              </div>
                            </div>
              )}
              <div className="pb-8 relative">
                {/* 설정(톱니) 버튼: 우상단 고정, 상단 탭 중앙선과 정렬 */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      className="hidden md:flex absolute -top-10 right-0 items-center justify-center w-8 h-8 rounded-full border border-gray-600/60 bg-gray-900 text-gray-300 hover:bg-gray-800"
                      title="설정"
                      aria-label="설정"
                    >
                      <Settings className="w-4 h-4" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent className="bg-gray-900 text-gray-100 border border-gray-700">
                    <DropdownMenuLabel>모델 설정</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuRadioGroup value={storyModel} onValueChange={(v)=> setStoryModel(v)}>
                      {STORY_MODELS.map(m => (
                        <DropdownMenuRadioItem key={m.value} value={m.value}>{m.label}</DropdownMenuRadioItem>
                      ))}
                    </DropdownMenuRadioGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
                {(stableMessages || []).length === 0 ? (
                  <div className="text-gray-400 text-sm p-3 hidden">메시지를 입력해보세요.</div>
                ) : (
                <div className="relative pb-36">
                  {/* 하단 페이드아웃 그라데이션 - 타원 컨테이너로 향하는 블러 효과 */}
                  <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-gray-900/95 via-gray-900/75 to-transparent pointer-events-none z-10" />
                  {stableMessages.map((m) => {
                      const text = (m.content || '').toString();
                      const isStreaming = !!(m.streaming || m.thinking);
                      const truncated = text.length > 500 ? text.slice(0, 500) + '…' : text;
                      return (
                        <div key={m.id} data-message-id={m.id}>
                          <div className={`flex w-full items-start gap-3 my-4 ${m.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
                              {/* 텍스트 메시지일 때만 아바타 배지 표시 */}
                              {(!m.type || m.type === 'text') && (
                              <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 font-semibold ${m.role === 'user' ? 'bg-gray-700 text-gray-200 ring-2 ring-purple-500/60' : 'bg-gradient-to-br from-purple-600 to-fuchsia-700 text-white/90'}`}>
                                  {m.role === 'user' ? (user ? user.username.charAt(0).toUpperCase() : 'G') : <Sparkles className="w-5 h-5" />}
                            </div>
                              )}
                              {m.type === 'image' ? (
                              <img src={m.url} alt="img" className={`block h-auto w-auto max-w-full md:max-w-[420px] rounded-2xl shadow-lg ${m.role === 'user' ? 'ml-auto' : 'mr-auto'}`} />
                              ) : m.type === 'dual_response' ? (
                                <DualResponseBubble message={m} onSelect={(mode) => handleSelectMode(m.id, mode)} />
                              ) : m.type === 'story_highlights' ? (
                                <StoryHighlights highlights={m.scenes || []} username={user?.username || '게스트'} />
                              ) : m.type === 'story_highlights_loading' ? (
                                <StoryHighlights loading username={user?.username || '게스트'} />
                              ) : m.type === 'recommendation' ? (
                                <div data-section="recommendations">
                                  {m.storyMode === 'snap' ? (
                                    <>
                                      <CharacterRecommendations 
                                        generatedText={(() => {
                                          // 이전 assistant 메시지 찾기
                                          const idx = stableMessages.findIndex(msg => msg.id === m.id);
                                          for (let i = idx - 1; i >= 0; i--) {
                                            const msg = stableMessages[i];
                                            if (msg.role === 'assistant' && !msg.type) {
                                              return msg.fullContent || msg.content;
                                            }
                                          }
                                          return '';
                                        })()}
                                        imageUrl={(() => {
                                          // 이전 이미지 메시지 찾기
                                          const idx = stableMessages.findIndex(msg => msg.id === m.id);
                                          for (let i = idx - 1; i >= 0; i--) {
                                            const msg = stableMessages[i];
                                            if (msg.type === 'image') {
                                              return msg.url;
                                            }
                                          }
                                          return null;
                                        })()}
                                        sessionId={activeSessionId}
                                        selectedCharacterId={selectedCharacter?.id}
                                        onCharacterSelect={handleCharacterSelect}
                                      />
                                      
                                      {/* 인라인 캐릭터 채팅 (선택된 경우) - 추천 목록 바로 아래 */}
                                      {selectedCharacter && (
                                        <div ref={chatContainerRef}>
                                          {chatLoading ? (
                                            <div 
                                              className="mt-6 border-2 border-purple-500/60 rounded-lg bg-gray-900/50 shadow-[0_0_16px_rgba(168,85,247,0.4)] flex flex-col items-center justify-center"
                                              style={{ width: '900px', minHeight: '400px', height: '400px' }}
                                            >
                                              <Loader2 className="w-8 h-8 animate-spin text-purple-500 mb-3" />
                                              <span className="text-sm text-gray-300">{selectedCharacter.name}와 대화 준비 중...</span>
                                            </div>
                                          ) : chatRoomId ? (
                                            <CharacterChatInline
                                              key={`${activeSessionId}-${chatRoomId}`}  // ← 이거 추가
                                              characterId={selectedCharacter.id}
                                              characterName={selectedCharacter.name}
                                              characterAvatar={selectedCharacter.avatar_url || selectedCharacter.thumbnail_url}
                                              roomId={chatRoomId}
                                              onClose={handleCloseChat}
                                            />
                                          ) : null}
                                        </div>
                                      )}
                                    </>
                                  ) : (
                                    <ExploreRecommendations />
                                  )}
                                </div>
                              ) : m.type === 'story_preview' ? (
                                <div className="w-full max-w-3xl bg-[#0d1117]/60 border border-gray-700 rounded-lg">
                                    <div className="px-4 py-2 border-b border-gray-700 text-xs text-gray-300 flex items-center justify-between">
                                        <span>스토리 미리보기</span>
                                        {generationStatus === GEN_STATE.PREVIEW_STREAMING && <span className="text-purple-400">프리뷰 생성 중...</span>}
                                        {generationStatus === GEN_STATE.AWAITING_CANVAS && <span className="text-green-400">프리뷰 완료</span>}
                                        {generationStatus === GEN_STATE.CANVAS_STREAMING && <span className="text-purple-400">{canvasStageLabel}</span>}
                                        {generationStatus === GEN_STATE.COMPLETED && <span className="text-green-400">완료되었습니다</span>}
                                        {generationStatus === GEN_STATE.FAILED && <span className="text-red-400">오류가 발생했습니다.</span>}
                                        {generationStatus === GEN_STATE.STOPPED && <span className="text-yellow-400">중단되었습니다.</span>}
                          </div>
                                    <div className="p-4 text-sm text-gray-200 whitespace-pre-wrap leading-relaxed">
                                        {m.content}
                          </div>
                                    <div className="px-4 py-2 border-t border-gray-700 flex justify-end">
                                        <Button 
                                          size="sm" 
                                          variant="ghost" 
                                          className="rounded-full bg-purple-600/10 hover:bg-purple-600/20 text-purple-300 border border-purple-500/30 px-3 py-1 inline-flex items-center gap-1"
                                          onClick={() => handleContinueInline(m)} 
                                          disabled={!m.fullContent}
                                        >
                                          이 이야기 계속보기
                                        </Button>
                            </div>
                            </div>
                              ) : (
                                <div className={`group relative whitespace-pre-wrap rounded-2xl shadow-lg ${m.role === 'user' 
                                  ? 'max-w-[85%] bg-purple-950/50 border border-purple-500/40 text-white px-3 py-2 shadow-[0_0_14px_rgba(168,85,247,0.45)]'
                                  : (editingMessageId === m.id 
                                      ? 'w-full max-w-3xl bg-gray-900/30 border-2 border-gray-700/80 px-4 py-3 ring-2 ring-purple-500/70 shadow-[0_0_24px_rgba(168,85,247,0.55)] bg-gradient-to-br from-purple-900/15 to-fuchsia-700/10'
                                      : 'w-full max-w-3xl bg-gray-900/30 border-2 border-gray-700/80 px-4 py-3')}`}>
                                  { m.thinking ? (
                                    <div className="inline-flex items-center gap-2 text-gray-400">
                                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                      <span className="text-xs">생성 중…</span>
                                      {elapsedSeconds > 0 && (
                                        <span className="text-xs text-purple-400">{elapsedSeconds}s</span>
                                      )}
                          </div>
                                  ) : (
                                    <>
                                      {m.role === 'assistant' && !m.error ? (
                                        <>
                                          {(m.fullContent || text.length > 500) ? (
                                            <>
                                              {/* 텍스트 영역 (인라인 편집 지원) */}
                                              <div
                                                className="relative outline-none message-content [&::selection]:bg-black [&::selection]:text-white [&_*::selection]:bg-black [&_*::selection]:text-white"
                                                contentEditable={editingMessageId === m.id}
                                                suppressContentEditableWarning
                                                onInput={(e) => { 
                                                  if (editingMessageId === m.id) {
                                                    // innerText를 사용하여 개행 보존
                                                    setEditedContent(e.currentTarget.innerText || '');
                                                  }
                                                }}
                                                onMouseUp={(e) => handleTextSelection(e, m.id, m.fullContent || m.content)}
                                              >
                                                {(() => {
                                                  // 어시스턴트 문장은 생성 완료 후에도 절대 미리보기로 잘라내지 않음
                                                  const renderText = (m.role === 'assistant' || isStreaming || m.continued || m.expanded) ? (m.content || '') : truncated;
                                                  
                                                  // 재생성 중이거나 재생성 완료된 부분 하이라이트
                                                  if (regenerating && selectionRange?.messageId === m.id) {
                                                    // 재생성 중: 선택 영역을 스켈레톤 UI로 표시
                                                    const { start, end } = selectionRange;
                                                    const before = renderText.slice(0, start);
                                                    const selected = renderText.slice(start, end);
                                                    const after = renderText.slice(end);
                                                    
                                                    return (
                                                      <>
                                                        {before}
                                                        <span className="inline-flex items-center gap-1 bg-gray-800/50 px-2 py-0.5 rounded animate-pulse">
                                                          <Loader2 className="w-3 h-3 animate-spin text-purple-400" />
                                                          <span className="text-xs text-gray-400">재생성 중...</span>
                                                        </span>
                                                        {after}
                                                      </>
                                                    );
                                                  } else if (regeneratedRange?.messageId === m.id) {
                                                    // 재생성 완료: 보라색 글로우로 표시
                                                    const { start, end } = regeneratedRange;
                                                    const before = renderText.slice(0, start);
                                                    const regenerated = renderText.slice(start, end);
                                                    const after = renderText.slice(end);
                                                    
                                                    return (
                                                      <>
                                                        {before}
                                                        <span className="bg-purple-500/20 px-1 rounded shadow-[0_0_12px_rgba(168,85,247,0.6)] animate-pulse">
                                                          {regenerated}
                                                        </span>
                                                        {after}
                                                      </>
                                                    );
                                                  }
                                                  
                                                  // 일반 렌더링
                                                  const lines = renderText.split('\n');
                                                  return lines.map((line, idx) => (
                                                    <div key={idx}>
                                                      {line || '\u00A0'}
                    </div>
                                                  ));
                                                })()}
                                              </div>
                                            </>
                                          ) : (
                                            <div
                                              className="outline-none message-content [&::selection]:bg-black [&::selection]:text-white [&_*::selection]:bg-black [&_*::selection]:text-white"
                                              contentEditable={editingMessageId === m.id}
                                              suppressContentEditableWarning
                                              onInput={(e) => { 
                                                if (editingMessageId === m.id) {
                                                  // innerText를 사용하여 개행 보존
                                                  setEditedContent(e.currentTarget.innerText || '');
                                                }
                                              }}
                                              onMouseUp={(e) => handleTextSelection(e, m.id, m.fullContent || m.content)}
                                            >
                                              {(() => {
                                                const renderText = (m.role === 'assistant' || isStreaming || m.continued || m.expanded) ? (m.content || '') : truncated;
                                                
                                                // 재생성 중이거나 재생성 완료된 부분 하이라이트
                                                if (regenerating && selectionRange?.messageId === m.id) {
                                                  const { start, end } = selectionRange;
                                                  const before = renderText.slice(0, start);
                                                  const after = renderText.slice(end);
                                                  return (
                                                    <>
                                                      {before}
                                                      <span className="inline-flex items-center gap-1 bg-gray-800/50 px-2 py-0.5 rounded animate-pulse">
                                                        <Loader2 className="w-3 h-3 animate-spin text-purple-400" />
                                                        <span className="text-xs text-gray-400">재생성 중...</span>
                                                      </span>
                                                      {after}
                                                    </>
                                                  );
                                                } else if (regeneratedRange?.messageId === m.id) {
                                                  const { start, end } = regeneratedRange;
                                                  const before = renderText.slice(0, start);
                                                  const regenerated = renderText.slice(start, end);
                                                  const after = renderText.slice(end);
                                                  return (
                                                    <>
                                                      {before}
                                                      <span className="bg-purple-500/20 px-1 rounded shadow-[0_0_12px_rgba(168,85,247,0.6)] animate-pulse">
                                                        {regenerated}
                                                      </span>
                                                      {after}
                                                    </>
                                                  );
                                                }
                                                
                                                return renderText;
                                              })()}
                                            </div>
                                          )}
                                          {/* 계속보기 버튼은 텍스트 박스 바깥으로 이동 */}
                                        </>
                                      ) : (
                                        <>{truncated}</>
                                      )}
                                      {m.role === 'assistant' && !m.error && (
                                        <div className="absolute right-0 -bottom-px translate-y-full flex items-center gap-1 z-20">
                                          <div className="flex items-center gap-1 px-2 py-1 bg-gray-900/85 border border-gray-700 shadow-lg">
                                             {editingMessageId === m.id ? (
                                               <>
                                          <button
                                            type="button"
                                                   className="p-1 hover:bg-gray-800 text-gray-300 hover:text-white"
                                                   title="편집 완료"
                                                   onClick={(e) => {
                                                     // DOM에서 직접 현재 텍스트 가져오기 (재생성된 내용 포함)
                                                     const contentDiv = e.currentTarget.closest('.group').querySelector('.message-content');
                                                     const newText = contentDiv ? (contentDiv.innerText || contentDiv.textContent) : (editedContent || text);
                                                     setMessages(curr => curr.map(msg => msg.id === m.id ? { ...msg, content: newText, fullContent: newText } : msg));
                                                     try { saveJson(LS_MESSAGES_PREFIX(user?.id || 'guest') + activeSessionId, (messages||[]).map(msg => msg.id === m.id ? { ...msg, content: newText, fullContent: newText } : msg)); } catch {}
                                                     setEditingMessageId(null);
                                                     setEditedContent('');
                                                   }}
                                                 >
                                                   <Check className="w-4 h-4" />
                                                 </button>
                                                 <button
                                                   type="button"
                                                   className="p-1 hover:bg-gray-800 text-gray-300 hover:text-white"
                                                   title="편집 취소"
                                                   onClick={() => { setEditingMessageId(null); setEditedContent(''); }}
                                                 >
                                                   <X className="w-4 h-4" />
                                                 </button>
                                               </>
                                             ) : (
                                              <div className="relative group/edit">
                                                <button
                                                  type="button"
                                                  className="p-1 hover:bg-purple-900/30 text-purple-400 hover:text-purple-300 shadow-[0_0_8px_rgba(168,85,247,0.4)] hover:shadow-[0_0_12px_rgba(168,85,247,0.6)] transition-all"
                                                  title={'편집'}
                                                  onClick={() => { setEditingMessageId(m.id); setEditedContent(m.fullContent || text); }}
                                                >
                                                  <Pencil className="w-4 h-4" />
                                                </button>
                                                {/* 툴팁 */}
                                                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-2 bg-gray-900 border border-purple-500/50 rounded-lg shadow-xl opacity-0 group-hover/edit:opacity-100 pointer-events-none transition-opacity whitespace-nowrap z-50">
                                                  <div className="text-xs text-gray-200 font-medium">
                                                    원하는 부분을 드래그하면 재생성할 수 있어요.
                      </div>
                                                  {/* 화살표 */}
                                                  <div className="absolute top-full left-1/2 -translate-x-1/2 -mt-px">
                                                    <div className="border-4 border-transparent border-t-purple-500/50"></div>
                                                  </div>
                                                </div>
                                              </div>
                                             )}
                                          <button
                                            type="button"
                                               className="p-1 hover:bg-gray-800 text-gray-300 hover:text-white"
                                            title="복사"
                                               onClick={() => { try { navigator.clipboard.writeText(m.fullContent || text); window.dispatchEvent(new CustomEvent('toast', { detail: { type: 'success', message: '복사됨' } })); } catch {} }}
                                          >
                                               <CopyIcon className="w-4 h-4" />
                                          </button>
                                          <button
                                            type="button"
                                               className="p-1 hover:bg-gray-800 text-gray-300 hover:text-white"
                                            title="다시 생성"
                                               onClick={() => { try { handleRerun(m); } catch {} }}
                                          >
                                               <RotateCcw className="w-4 h-4" />
                                          </button>
                                           </div>
                </div>
              )}
                                    </>
                                  )}
                                  </div>
                                )}
                              </div>
                              {/* 본문 아래, 바깥쪽 중앙: 리믹스 태그 + 버튼 */}
                              {(() => {
                                const msgIndex = stableMessages.findIndex(msg => msg.id === m.id);
                                const isAssistantText = (!m.type || m.type === 'text') && m.role === 'assistant' && !m.error;
                                const hasLaterAssistantText = stableMessages.slice(msgIndex + 1).some(mm => ((!mm.type || mm.type === 'text') && mm.role === 'assistant'));
                                const isLastAssistantText = isAssistantText && !hasLaterAssistantText;
                                const isFullShown = !isStreaming && (!m.fullContent || ((m.content || '').toString().length >= (m.fullContent || '').toString().length));
                                // 기본: 전체 텍스트가 보이면 노출. 계속보기 진행 중일 때는 스트리밍 중에만 노출하고 완료되면 숨김
                                // 계속보기 클릭 직후(streaming 전)에도 버튼이 남도록 continued=true면 항상 보이게
                                const showBlock = isLastAssistantText && ((isFullShown && !m.continued) || m.continued);
                                if (!showBlock) return null;
                                return (
                                <div className="mt-4 mb-2 flex flex-col items-center gap-3">
                                  {/* 안내 문구 (가운데 정렬, 조금 크게) */}
                                  {!(isStreaming || m.continued) && (
                                    <div className="text-base text-gray-100 flex items-center gap-2">
                                      <span>이런 느낌으로 다시 보여드릴까요?</span>
                                      <button
                                        type="button"
                                        className="p-1 rounded hover:bg-gray-800/60 text-gray-200"
                                        title="태그 그룹 바꾸기"
                                        onClick={() => {
                                          // 현재 메시지의 선택 태그 초기화
                                          setRemixSelected(prev => ({ ...prev, [m.id]: [] }));
                                          // 토글: auto→상대 모드, snap↔genre
                                          setTagViewMode(prev => {
                                            const base = prev === 'auto' ? ((m.storyMode || 'auto') === 'genre' ? 'genre' : 'snap') : prev;
                                            return base === 'snap' ? 'genre' : 'snap';
                                          });
                                        }}
                                      >
                                        <RefreshCcw className="w-4 h-4" />
                                      </button>
                                    </div>
                                  )}
                                  {/* 태그 그룹: 장르=AI추천+인기, 스냅=기존 */}
                                  {(() => {
                                    const effectiveMode = tagViewMode === 'auto' ? ((m.storyMode || 'auto') === 'genre' ? 'genre' : 'snap') : tagViewMode;
                                    
                                    // 계속보기 인라인 진행 중 또는 완료된 후에는 태그 숨김
                                    if (isStreaming || m.continued) return null;
                                    
                                    const Chip = (tag, isAI = false, isPopular = false) => {
                                      const selected = (remixSelected[m.id] || []).includes(tag);
                                      return (
                                        <button 
                                          key={tag} 
                                          type="button" 
                                          onClick={() => toggleRemixTag(m.id, tag)}
                                          className={`px-3.5 py-1.5 rounded-full text-sm transition-all backdrop-blur-sm ${
                                            selected 
                                              ? 'bg-purple-600/15 text-purple-200 ring-2 ring-purple-400/70 shadow-[0_0_12px_rgba(168,85,247,0.55)]' 
                                              : isAI
                                                ? 'bg-purple-900/30 text-purple-300 ring-1 ring-purple-500/40 shadow-[0_0_10px_rgba(168,85,247,0.3)] hover:bg-purple-800/40'
                                                : isPopular
                                                  ? 'bg-orange-900/30 text-orange-300 ring-1 ring-orange-500/40 shadow-[0_0_10px_rgba(251,146,60,0.3)] hover:bg-orange-800/40'
                                                  : 'bg-gray-900/40 text-gray-200 ring-1 ring-purple-500/35 shadow-[0_0_10px_rgba(168,85,247,0.25)] hover:bg-gray-800/60'
                                          }`}
                                        >
                                          #{tag}
                                        </button>
                                      );
                                    };
                                    
                                    if (effectiveMode === 'genre') {
                                      // 장르 모드: AI 추천 5개 + 인기 3개
                                      return (
                                        <div className="flex flex-col items-center gap-3">
                                          {/* 1줄: AI 추천 */}
                                          <div className="flex flex-col items-center gap-1.5">
                                            <div className="text-xs text-purple-300 font-medium">💡 추천</div>
                                            <div className="flex flex-wrap items-center justify-center gap-2">
                                              {AI_GENRE_TAGS.map(tag => Chip(tag, true, false))}
                                            </div>
                                          </div>
                                          
                                          {/* 2줄: 인기 */}
                                          <div className="flex flex-col items-center gap-1.5">
                                            <div className="text-xs text-orange-300 font-medium">🔥 인기</div>
                                            <div className="flex flex-wrap items-center justify-center gap-2">
                                              {POPULAR_GENRE_TAGS.map(tag => Chip(tag, false, true))}
                                            </div>
                                          </div>
                                        </div>
                                      );
                                    } else {
                                      // 스냅 모드: 기존 로직 유지
                                      let ordered = SNAP_REMIX_TAGS;
                                      const idxWarm = ordered.indexOf('따뜻하게');
                                      const idxMeme = ordered.indexOf('밈스럽게');
                                      if (idxWarm > -1 && idxMeme > -1 && idxMeme > idxWarm) {
                                        const arr = [...ordered];
                                        const [tag] = arr.splice(idxMeme, 1);
                                        arr.splice(idxWarm, 0, tag);
                                        ordered = arr;
                                      }
                                      
                                      const top = ordered.slice(0, 4);
                                      const bottom = ordered.slice(4, 7);
                                      
                                      return (
                                        <div className="flex flex-col items-center gap-2">
                                          <div className="flex flex-wrap items-center justify-center gap-2">
                                            {top.map(tag => Chip(tag))}
                                          </div>
                                          <div className="flex flex-wrap items-center justify-center gap-2">
                                            {bottom.map(tag => Chip(tag))}
                                          </div>
                                        </div>
                                      );
                                    }
                                  })()}     
                                  {/* 액션 버튼: 태그 선택 여부에 따라 라벨 변경 */}
                                  <div className="mt-1 flex justify-center">
                                    {((remixSelected[m.id] || []).length > 0) && !(isStreaming || m.continued) ? (
                                      <button
                                        type="button"
                                        className="inline-flex items-center gap-2 px-7 py-3 rounded-full bg-gradient-to-r from-purple-600 to-fuchsia-700 text-white font-medium text-base shadow-lg shadow-purple-500/25 hover:shadow-xl hover:shadow-purple-500/40 transform hover:scale-105 transition-all duration-200"
                                        onClick={() => handleRemixGenerate(m, (m.fullContent || (m.content || '')).toString())}
                                      >
                                        <span>이 이야기 바꿔보기</span>
                                      </button>
                                    ) : (
                                      <button
                                        type="button"
                                        className="inline-flex items-center gap-2 px-7 py-3 rounded-full bg-gradient-to-r from-purple-600 to-blue-600 text-white font-medium text-base shadow-lg shadow-purple-500/25 hover:shadow-xl hover:shadow-purple-500/40 transform hover:scale-105 transition-all duration-200"
                                        onClick={() => handleContinueInline(m)}
                                      >
                                        {(isStreaming || m.continued) ? <>
                                          <svg className="animate-spin h-4 w-4 mr-2 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"></path></svg>
                                          <span>계속 생성 중...</span>
                                        </> : <span>이 이야기 계속보기</span>}
                                      </button>
                                    )}
                                  </div>
                                </div>
                                );
                              })()}
                            </div>
                          );
                        })}
                      </div>
                )}
              </div>
                </div>
        )}
        {/* Scroll to Bottom Button (P1) */}
          <button
            type="button"
          onClick={() => navigate('/dashboard')}
            className="absolute bottom-4 right-6 z-10 w-10 h-10 rounded-full bg-blue-600 text-white shadow-lg hover:bg-blue-700"
          title="메인으로"
          >
            ↓
          </button>
              </div>
    </div>
      {/* 하단 입력 섹션 - 일반 배치 */}
       {!chatFocused && (
      <div className="bg-gradient-to-t from-gray-900 to-transparent mt-10">
          <div className="w-full max-w-4xl mx-auto p-4">
            {/* 새로운 Composer UI */}
            <Composer 
                key={activeSessionId || 'no-session'} // 세션별로 독립적인 Composer
                hasMessages={(stableMessages || []).length > 0} // 메시지 존재 여부 전달
                onSend={async (payload) => {
                  try {
                    // ✅ 세션이 없으면 먼저 생성
                    let ensuredSessionId = activeSessionId;
                    if (!ensuredSessionId) {
                      const newSession = createSession({ title: '새 대화', type: 'story' });
                      ensuredSessionId = newSession.id;
                      setActiveSessionId(newSession.id);
                      setShowChatPanel(true);
                    }
                    
                    // 1. 먼저 사용자 메시지 표시
                    let userText = '';
                    let imageUrl = null;
                   
                   payload.staged.forEach(item => {
                     if (item.type === 'image') {
                       imageUrl = item.url;
                       if (item.caption) userText += (userText ? ' ' : '') + item.caption;
                     } else if (item.type === 'text') {
                       userText += (userText ? ' ' : '') + item.body;
                     } else if (item.type === 'emoji') {
                       userText += (userText ? ' ' : '') + item.items.join(' ');
                     }
                   });
                   
                   // 의도 분석: 텍스트만 있고 이미지 없으며, 직전 AI 응답이 있을 때
                   const lastAssistant = stableMessages.findLast(m => m.role === 'assistant' && !m.error && !m.thinking && m.content);
                   if (userText && !imageUrl && lastAssistant) {
                     try {
                       const intentRes = await chatAPI.classifyIntent({
                         text: userText,
                         has_last_message: true
                       });
                       
                       if (intentRes.data?.intent === 'continue') {
                         return handleContinueInline(lastAssistant);
                       }
                       if (intentRes.data?.intent === 'remix') {
                         setRemixSelected(prev => ({ ...prev, [lastAssistant.id]: [] }));
                         return handleRemixGenerate(lastAssistant, lastAssistant.fullContent || lastAssistant.content);
                       }
                       // modify, new, chat는 아래 일반 플로우로
                     } catch (e) {
                       console.error('Intent analysis failed:', e);
                       // 폴백: 일반 플로우로
                     }
                   }
                   
                   // 사용자 메시지 추가 (텍스트와 이미지를 바로 연속으로)
                   const userMessages = [];
                   const userMsgId = crypto.randomUUID();
                   
                   // 텍스트가 없어도 이미지만 있으면 기본 텍스트 추가
                   if (imageUrl && !userText) {
                     userText = '이 이미지로 스토리를 보고 싶어요';
                   }
                  //  // ✅ 복구 정보 저장
                  // // const recoveryInfo = {
                  // //   sessionId: activeSessionId,
                  // //   assistantMessageId: assistantId,
                  // //   staged: payload.staged,
                  // //   storyMode: payload.storyMode || 'auto',
                  // //   model: storyModel,
                  // //   timestamp: nowIso(),
                  // //   type: 'generate'
                  // // };
                  // try {
                  //   localStorage.setItem(LS_RECOVERY_PREFIX + activeSessionId, JSON.stringify(recoveryInfo));
                  // } catch {}

                   if (userText) {
                     userMessages.push({ 
                       id: userMsgId, 
                       role: 'user', 
                       content: userText, 
                       createdAt: nowIso() 
                     });
                   }
                   
                   if (imageUrl) {
                     userMessages.push({ 
                       id: crypto.randomUUID(), 
                       role: 'user', 
                       type: 'image', 
                       url: imageUrl, 
                       createdAt: nowIso() 
                     });
                   }
                   
                   // 2. AI thinking 메시지 추가 (스피너 표시)
                   const assistantId = crypto.randomUUID();
                   const thinkingMsg = {
                     id: assistantId,
                     role: 'assistant',
                     content: '',
                     thinking: true,
                     createdAt: nowIso()
                   };
                   
                   setMessages(curr => [...curr, ...userMessages, thinkingMsg]);
                  // ✅ 여기로 이동 (assistantId 선언 후)
                  const recoveryInfo = {
                    sessionId: ensuredSessionId,  // ✅ 세션 확보됨
                    assistantMessageId: assistantId,  // ✅ 이미 선언됨
                    staged: payload.staged,
                    storyMode: payload.storyMode || 'auto',
                    model: storyModel,
                    timestamp: nowIso(),
                    type: 'generate'
                  };
                  try {
                    localStorage.setItem(LS_RECOVERY_PREFIX(user?.id || 'guest') + ensuredSessionId, JSON.stringify(recoveryInfo));
                  } catch {}
                   
                   // 3. 생성 상태 업데이트
                   setGenState(activeSessionId, { status: GEN_STATE.PREVIEW_STREAMING });
                   
                   // 4. 세션 캡처 (타이핑 중 세션 전환 대응)
                   const currentSessionId = activeSessionId;
                   
                   // 5. 백엔드 호출 - auto 모드 분기
                   if (payload.storyMode === 'auto') {
                     // === AUTO 모드: snap + genre 병렬 생성 ===
                     
                     // 병렬 API 호출
                     const [snapResponse, genreResponse] = await Promise.all([
                       chatAPI.agentSimulate({
                         staged: payload.staged,
                         mode: payload.mode || 'micro',
                         storyMode: 'snap',
                         model: storyModel,
                         sub_model: storyModel
                       }),
                       chatAPI.agentSimulate({
                         staged: payload.staged,
                         mode: payload.mode || 'micro',
                         storyMode: 'genre',
                         model: storyModel,
                         sub_model: storyModel
                       })
                     ]);
                     const visionTags = snapResponse.data?.vision_tags;
                     const visionCtx = snapResponse.data?.vision_ctx;
                     if (visionTags && visionCtx && ensuredSessionId) {
                      try {
                        localStorage.setItem(`agent:vision:${ensuredSessionId}`, JSON.stringify({
                          tags: visionTags,
                          ctx: visionCtx
                        }));
                      } catch {}
                    }
                     const snapText = snapResponse.data?.assistant || '';
                     const genreText = genreResponse.data?.assistant || '';
                     
                     // thinking → dual_response로 교체
                     const dualMessage = {
                       id: assistantId,
                       role: 'assistant',
                       type: 'dual_response',
                       responses: {
                         snap: { content: '', fullContent: snapText, streaming: true },
                         genre: { content: '', fullContent: genreText, streaming: true }
                       },
                       thinking: false,
                       createdAt: nowIso()
                     };
                     
                     setMessages(curr => curr.map(msg => 
                       msg.id === assistantId ? dualMessage : msg
                     ));
                     
                     // 저장소에도 저장
                     const savedBeforeTyping = loadJson(LS_MESSAGES_PREFIX(user?.id || 'guest') + currentSessionId, []);
                     const updatedBeforeTyping = savedBeforeTyping.map(msg => 
                       msg.id === assistantId ? dualMessage : msg
                     );
                     saveJson(LS_MESSAGES_PREFIX(user?.id || 'guest') + currentSessionId, updatedBeforeTyping);
                     
                     // 두 개의 타이핑 타이머 동시 실행
                     const createTypingTimer = (mode, fullText) => {
                       let idx = 0;
                       const total = fullText.length;
                       const steps = 80;
                       const step = Math.max(2, Math.ceil(total / steps));
                       const intervalMs = 15;
                       
                       const timer = setInterval(() => {
                         idx = Math.min(total, idx + step);
                         const slice = fullText.slice(0, idx);
                         
                         // 저장소 업데이트
                         const saved = loadJson(LS_MESSAGES_PREFIX(user?.id || 'guest') + currentSessionId, []);
                         const updated = saved.map(msg => {
                           if (msg.id === assistantId && msg.type === 'dual_response') {
                             return {
                               ...msg,
                               responses: {
                                 ...msg.responses,
                                 [mode]: {
                                   content: slice,
                                   fullContent: fullText,
                                   streaming: idx < total
                                 }
                               }
                             };
                           }
                           return msg;
                         });
                         saveJson(LS_MESSAGES_PREFIX(user?.id || 'guest') + currentSessionId, updated);
                         
                         // 현재 세션일 때만 UI 업데이트
                         if (activeSessionIdRef.current === currentSessionId) {
                           setMessages(updated);
                         }
                         
                         // 타이핑 완료
                         if (idx >= total) {
                           clearInterval(timer);
                           const timers = sessionTypingTimersRef.current.get(currentSessionId) || [];
                           sessionTypingTimersRef.current.set(currentSessionId, timers.filter(t => t !== timer));
                         }
                       }, intervalMs);
                       
                       return timer;
                     };
                     
                     // snap, genre 타이머 동시 시작
                     const snapTimer = createTypingTimer('snap', snapText);
                     const genreTimer = createTypingTimer('genre', genreText);
                     
                     // 타이머 등록
                     const timers = sessionTypingTimersRef.current.get(currentSessionId) || [];
                     sessionTypingTimersRef.current.set(currentSessionId, [...timers, snapTimer, genreTimer]);
                     
                     // 생성 완료 상태
                     setGenState(activeSessionId, { status: GEN_STATE.IDLE });
                     
                   } else {
                     // === 기존 로직 (snap/genre 직접 선택 시) ===
                     
                     const response = await chatAPI.agentSimulate({
                       staged: payload.staged,
                       mode: payload.mode || 'micro',
                       storyMode: payload.storyMode || 'auto',
                       model: storyModel,
                       sub_model: storyModel
                     });
                     console.log('[DEBUG] agentSimulate response:', response.data);  // ✅ 추가
                     const decidedMode = response.data?.story_mode || (payload.storyMode || 'auto');
                     const imageSummary = response.data?.image_summary || null;
                     // ✅ 이미지 분석 결과 저장 (3줄 추가)
                     const visionTags = response.data?.vision_tags;
                     const visionCtx = response.data?.vision_ctx;
                     console.log('[DEBUG] visionTags:', visionTags, 'visionCtx:', visionCtx, 'sessionId:', ensuredSessionId);
                     if (visionTags && visionCtx && ensuredSessionId) {
                      try {
                        localStorage.setItem(`agent:vision:${ensuredSessionId}`, JSON.stringify({
                          tags: visionTags,
                          ctx: visionCtx
                        }));
                        console.log('[DEBUG] Vision saved to localStorage');  // ✅ 추가
                      } catch (e){
                        console.error('[DEBUG] Vision save failed:', e);  // ✅ 추가
                      }
                    }


                   // image_summary를 이미지 메시지에 반영 (있는 경우)
                   if (imageSummary && imageUrl) {
                    try {
                      // ✅ UI 업데이트
                      setMessages(curr => curr.map(m => 
                        (m.type === 'image' && m.url === imageUrl) 
                          ? { ...m, imageSummary } 
                          : m
                      ));
                      
                      // ✅ 저장소에도 직접 저장
                      const saved = loadJson(LS_MESSAGES_PREFIX(user?.id || 'guest') + activeSessionId, []);
                      const updated = saved.map(m => 
                        (m.type === 'image' && m.url === imageUrl) 
                          ? { ...m, imageSummary } 
                          : m
                      );
                      saveJson(LS_MESSAGES_PREFIX(user?.id || 'guest') + activeSessionId, updated);
                      
                      // ✅ 게스트일 경우 sessionStorage에도 저장
                      if (isGuest) {
                        try {
                          sessionLocalMessagesRef.current.set(activeSessionId, updated);
                          sessionStorage.setItem(LS_MESSAGES_PREFIX('guest') + activeSessionId, JSON.stringify(updated));
                        } catch {}
                      }
                    } catch {}
                  }
                   
                   // 5. thinking 메시지를 실제 응답으로 교체 (타이핑 효과로 점진 출력)
                   if (response.data?.assistant) {
                     const assistantText = response.data.assistant;
                     // 타이핑 시작: 우선 빈 내용으로 스트리밍 플래그 설정
                     setMessages(curr => curr.map(msg => msg.id === assistantId ? { ...msg, content: '', fullContent: undefined, thinking: false, streaming: true, storyMode: decidedMode } : msg));

                     // 타이핑 루프
                     let idx = 0;
                     const total = assistantText.length;
                     const steps = 80;
                     const step = Math.max(2, Math.ceil(total / steps));
                     const intervalMs = 15;
                     const currentSessionId = activeSessionId; // ✅ 시작 시점 세션 캡처


                    const timer = setInterval(() => {
                      idx = Math.min(total, idx + step);
                      const slice = assistantText.slice(0, idx);
                      
                      // ✅ 저장소 항상 업데이트
                      const saved = loadJson(LS_MESSAGES_PREFIX(user?.id || 'guest') + currentSessionId, []);
                      const updated = saved.map(msg => msg.id === assistantId ? { 
                        ...msg, 
                        content: slice,
                        fullContent: assistantText, // 전체 텍스트는 항상 저장
                        streaming: idx < total,
                        thinking: false,
                        storyMode: decidedMode
                      } : msg);
                      saveJson(LS_MESSAGES_PREFIX(user?.id || 'guest') + currentSessionId, updated);
                      
                      // ✅ 현재 보고 있는 세션일 때만 UI 업데이트
                      if (activeSessionIdRef.current === currentSessionId) {
                        setMessages(updated);
                      }
                      
                      if (idx >= total) {
                        clearInterval(timer);
                        const timers = sessionTypingTimersRef.current.get(currentSessionId) || [];
                        sessionTypingTimersRef.current.set(currentSessionId, timers.filter(t => t !== timer));
                        
                        // ✅ 자동 저장 (내 서랍)
                        if (!isGuest) {
                          (async () => {
                            try {
                              const userMsgs = updated.filter(m => m.role === 'user' && !m.type);
                              const lastUserText = userMsgs.length > 0 ? userMsgs[userMsgs.length - 1].content : null;
                              
                              await chatAPI.saveAgentContent({
                                session_id: currentSessionId,
                                message_id: assistantId,
                                story_mode: decidedMode,
                                user_text: lastUserText,
                                user_image_url: imageUrl,
                                generated_text: assistantText,
                                generated_image_urls: []
                              });
                            } catch (err) {
                              console.error('Failed to save to drawer:', err);
                            }
                          })();
                        }
                        
                        // ✅ 하이라이트/추천 추가
                        if (imageUrl) {
                          const finalSaved = loadJson(LS_MESSAGES_PREFIX(user?.id || 'guest') + currentSessionId, []);
                          const placeholderId = crypto.randomUUID();
                          const withExtras = [...finalSaved, 
                            { id: placeholderId, type: 'story_highlights_loading', createdAt: nowIso() }, 
                            { id: crypto.randomUUID(), role: 'assistant', type: 'recommendation', createdAt: nowIso() }
                          ];
                          saveJson(LS_MESSAGES_PREFIX(user?.id || 'guest') + currentSessionId, withExtras);
                          
                          if (activeSessionIdRef.current === currentSessionId) {
                            setMessages(withExtras);
                          }
                          
                          // vision_tags 읽기
                          let visionTags = null;
                          try {
                            const stored = localStorage.getItem(`agent:vision:${currentSessionId}`);  // 또는 activeSessionId
                            if (stored) {
                              const parsed = JSON.parse(stored);
                              visionTags = parsed.tags;
                            }
                          } catch {}


                          // ✅ 하이라이트 생성
                          (async () => {
                            try {
                              const hiRes = await chatAPI.agentGenerateHighlights({ text: assistantText, image_url: imageUrl, story_mode: decidedMode || 'auto',vision_tags: visionTags });
                              const scenes = hiRes.data?.story_highlights || [];
                              
                              const currentMsgs = loadJson(LS_MESSAGES_PREFIX(user?.id || 'guest') + currentSessionId, []);
                              const placeholder = currentMsgs.find(m => m.type === 'story_highlights_loading');
                              if (!placeholder) return;
                              
                              const savedHL = loadJson(LS_MESSAGES_PREFIX(user?.id || 'guest') + currentSessionId, []);
                              const updatedHL = savedHL.map(msg => msg.id === placeholder.id ? { 
                                id: crypto.randomUUID(), 
                                type: 'story_highlights', 
                                scenes, 
                                createdAt: nowIso() 
                              } : msg);
                              
                              saveJson(LS_MESSAGES_PREFIX(user?.id || 'guest') + currentSessionId, updatedHL);
                              
                              if (activeSessionIdRef.current === currentSessionId) {
                                setMessages(updatedHL);
                              }
                            } catch (e) {
                              const savedErr = loadJson(LS_MESSAGES_PREFIX(user?.id || 'guest') + currentSessionId, []);
                              const filtered = savedErr.filter(msg => msg.type !== 'story_highlights_loading');
                              
                              saveJson(LS_MESSAGES_PREFIX(user?.id || 'guest') + currentSessionId, filtered);
                              
                              if (activeSessionIdRef.current === currentSessionId) {
                                setMessages(filtered);
                              }
                            }
                          })();
                        }
                      }
                    }, intervalMs);
                     
                     // ✅ 타이머 등록
                     const timers = sessionTypingTimersRef.current.get(currentSessionId) || [];
                     sessionTypingTimersRef.current.set(currentSessionId, [...timers, timer]);
                   }
                   
                   // 6. 생성 완료 상태
                   setGenState(activeSessionId, { status: GEN_STATE.IDLE });
                   
                   } // else 블록 닫기 (snap/genre 직접 선택 시)
                   
                 } catch (error) {
                   console.error('Failed to generate:', error);
                   // toast.error('생성 중 오류가 발생했습니다.'); // toast 제거
                   
                   // 에러 시 thinking 메시지를 에러 메시지로 변경
                   setMessages(curr => curr.map(msg => 
                     msg.thinking 
                       ? { ...msg, content: '응답 생성에 실패했습니다. 다시 시도해주세요.', thinking: false, error: true }
                       : msg
                   ));
                   setGenState(activeSessionId, { status: GEN_STATE.IDLE });
                 }
               }}
               disabled={turnLimitReached || (activeSessionId && [GEN_STATE.PREVIEW_STREAMING, GEN_STATE.AWAITING_CANVAS, GEN_STATE.CANVAS_STREAMING].includes(getGenState(activeSessionId)?.status))}
             />
             
           {/* 기존 복잡한 입력 UI 완전 제거 - Git에서 복원 가능 */}
                       </div>
                </div>
       )}

    {/* 시트: 이미지 보관함 전체 */}
    <Sheet open={showImagesSheet} onOpenChange={setShowImagesSheet}>
      <SheetContent side="right" className="bg-gray-900 border-gray-800">
        <SheetHeader>
          <SheetTitle className="text-white">이미지 보관함</SheetTitle>
        </SheetHeader>
        <div className="mt-4 grid grid-cols-2 gap-3">
          {images.length === 0 ? (
            <div className="text-gray-400 text-sm col-span-2">보관된 이미지가 없습니다.</div>
          ) : images.map(img => (
            <div key={img.id} className="space-y-2">
              <img src={img.url} alt="img" className="w-full aspect-square object-cover rounded" />
              <div className="flex gap-2">
                <Button size="sm" className="bg-purple-600 hover:bg-purple-700" onClick={() => handleInsertImageToChat(img)}>챗 삽입</Button>
              </div>
            </div>
          ))}
        </div>
      </SheetContent>
    </Sheet>

    {/* First Frame 선택 모달 (업로드/생성 겸용) */}
    <ImageGenerateInsertModal open={firstFrameOpen} onClose={(res)=>{ setFirstFrameOpen(false); try { if (res && res.focusUrl) setFirstFrameUrl(res.focusUrl); } catch {} }} />

    {/* 시트: 스토리 선택 + 커버/갤러리 */}
    <Sheet open={showStoriesSheet} onOpenChange={setShowStoriesSheet}>
      <SheetContent side="right" className="bg-gray-900 border-gray-800">
        <SheetHeader>
          <SheetTitle className="text-white">스토리 선택</SheetTitle>
        </SheetHeader>
        <div className="mt-4 space-y-4">
          <div>
            <div className="text-gray-300 text-sm mb-2">삽입 대상 스토리</div>
            <div className="max-h-[30vh] overflow-auto space-y-2 pr-1">
              {storiesList.length === 0 ? (
                <div className="text-gray-400 text-sm">생성된 스토리가 없습니다. 먼저 읽기를 통해 스토리를 생성하세요.</div>
              ) : storiesList.map(s => (
                <div key={s.id} className={`${selectedStoryId === s.id ? 'bg-gray-700 border-gray-600' : 'bg-gray-900 border-gray-800'} p-2 rounded-md border cursor-pointer`} onClick={() => setSelectedStoryId(s.id)}>
                  <div className="text-white text-sm truncate">{s.title}</div>
                  <div className="text-xs text-gray-400 mt-1">{relativeTime(s.createdAt)}</div>
                </div>
              ))}
            </div>
          </div>
          <div>
            <div className="text-gray-300 text-sm mb-2">삽입 유형</div>
            <RadioGroup value={insertKind} onValueChange={setInsertKind} className="flex gap-4">
              <label className="inline-flex items-center gap-2 text-gray-200"><RadioGroupItem value="gallery" /> 갤러리</label>
              <label className="inline-flex items-center gap-2 text-gray-200"><RadioGroupItem value="cover" /> 표지</label>
            </RadioGroup>
          </div>
          <div className="flex justify:end gap-2">
            <Button className="bg-gray-700 hover:bg-gray-600" onClick={() => setShowStoriesSheet(false)}>취소</Button>
            <Button className="bg-blue-600 hover:bg-blue-700" disabled={!selectedStoryId || !insertTargetImage} onClick={handleInsertImageToStoryConfirm}>삽입</Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>

    {/* 시트: 생성된 스토리 뷰어 */}
    {!isGuest && (
    <Sheet open={showStoriesViewerSheet} onOpenChange={setShowStoriesViewerSheet}>
      <SheetContent side="left" className="bg-gray-900 border-gray-800">
        <SheetHeader>
          <SheetTitle className="text:white">생성된 스토리</SheetTitle>
        </SheetHeader>
        <div className="mt-4 space-y-3 pr-1 max-h-[70vh] overflow:auto">
          {(user?.id ? loadJson(LS_STORIES(user.id), []) : []).length === 0 ? (
            <div className="text-gray-400 text-sm">아직 생성된 스토리가 없습니다.</div>
          ) : (user?.id ? loadJson(LS_STORIES(user.id), []) : []).map(s => (
            <div key={s.id} className="p-2 rounded-md border bg-gray-800 border-gray-700">
              <div className="flex items-center gap-3">
                <div className="w-16 h-16 rounded bg-gray-900 border border-gray-700 overflow-hidden">
                  {s.coverUrl ? (<img src={s.coverUrl} alt="cover" className="w-full h-full object-cover" />) : null}
                </div>
                <div className="min-w-0">
                  <div className="text:white text-sm truncate">{s.title}</div>
                  <div className="text-xs text-gray-400">{relativeTime(s.createdAt)}</div>
                </div>
                <span className={`${s.is_public ? 'bg-blue-600 text-white border-blue-500' : 'bg-gray-900 text-gray-300 border-gray-700'} ml-auto text-[10px] px-2 py-0.5 rounded-full border`}>{s.is_public ? '공개' : '비공개'}</span>
                {s.source === 'server' ? (
                  <button
                    className="ml-2 text-xs px-2 py-0.5 rounded border border-gray-600 text-gray-300 hover:bg-gray-700"
                    onClick={() => toggleStoryVisibility(s.id, !s.is_public)}
                    title="가시성 전환"
                  >전환</button>
                ) : (
                  <span className="ml-2 text-[10px] text-gray-500" title="로컬 초안">로컬</span>
                )}
              </div>
              {Array.isArray(s.gallery) && s.gallery.length > 0 && (
                <div className="mt-2 grid grid-cols-3 gap-2">
                  {s.gallery.slice(0,6).map((g,i) => (
                    <img key={`${s.id}-g-${i}`} src={g} alt="g" className="w-full h-16 object-cover rounded" />
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </SheetContent>
    </Sheet>
    )}

    {/* 시트: 생성된 캐릭터 뷰어 */}
    <Sheet open={showCharactersViewerSheet} onOpenChange={setShowCharactersViewerSheet}>
      <SheetContent side="left" className="bg-gray-900 border-gray-800">
        <SheetHeader>
          <SheetTitle className="text-white">생성된 캐릭터</SheetTitle>
        </SheetHeader>
        <div className="mt-4 space-y-3 pr-1 max-h-[70vh] overflow-auto">
          {(user?.id ? loadJson(LS_CHARACTERS(user.id), []) : []).length === 0 ? (
            <div className="text-gray-400 text-sm">아직 생성된 캐릭터가 없습니다.</div>
          ) : (user?.id ? loadJson(LS_CHARACTERS(user.id), []) : []).map(c => (
            <div key={c.id} className="p-2 rounded-md border bg-gray-800 border-gray-700">
              <div className="flex items:center gap-3">
                <div className="w-16 h-16 rounded bg-gray-900 border border-gray-700 overflow-hidden">
                  {c.avatar_url ? (<img src={c.avatar_url} alt="avatar" className="w-full h-full object-cover" />) : null}
                </div>
                <div className="min-w-0">
                  <div className="text:white text-sm truncate">{c.name || '캐릭터'}</div>
                  <div className="text-xs text-gray-400">{relativeTime(c.createdAt)}</div>
                </div>
                <span className={`${c.is_public ? 'bg-blue-600 text-white border-blue-500' : 'bg-gray-900 text-gray-300 border-gray-700'} ml-auto text-[10px] px-2 py-0.5 rounded-full border`}>{c.is_public ? '공개' : '비공개'}</span>
                <Button size="sm" className="ml-2 bg-gray-700 hover:bg-gray-600" onClick={() => { try { window.location.href = `/characters/${c.id}`; } catch {} }}>열기</Button>
              </div>
            </div>
          ))}
        </div>
      </SheetContent>
    </Sheet>

    {/* 시트: 세션 공개 · 캐릭터 만들기 */}
    <Sheet open={showPublishSheet} onOpenChange={setShowPublishSheet}>
      <SheetContent side="right" className="bg-gray-900 border-gray-800">
        <SheetHeader>
          <SheetTitle className="text-white">세션 공개 · 캐릭터 만들기</SheetTitle>
        </SheetHeader>ㅣㅂ력 
        <div className="mt-4 space-y-4">
          <div>
            <div className="text-gray-300 text-sm mb-2">캐릭터 이름</div>
            <Input value={publishName} onChange={(e) => setPublishName(e.target.value)} placeholder="캐릭터 이름" className="bg-gray-800 border-gray-700 text-white" />
          </div>
          <div className="flex items-center gap-2">
            <Switch id="publishPublic" checked={publishPublic} onCheckedChange={setPublishPublic} />
            <label htmlFor="publishPublic" className="text-sm text-gray-300">공개로 게시</label>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <Switch id="includeNewImages" checked={includeNewImages} onCheckedChange={setIncludeNewImages} />
              <label htmlFor="includeNewImages" className="text-sm text-gray-300">생성 이미지 갤러리에 포함</label>
            </div>
            <div className="flex items-center gap-2">
              <Switch id="includeLibraryImages" checked={includeLibraryImages} onCheckedChange={setIncludeLibraryImages} />
              <label htmlFor="includeLibraryImages" className="text-sm text-gray-300">보관함 이미지 포함</label>
            </div>
          </div>
          <div>
            <div className="text-gray-300 text-sm mb-2">아바타 선택(선택)</div>
            <div className="grid grid-cols-3 gap-2 max-h:[30vh] overflow:auto pr-1">
              {[...imageResults, ...images].map((img, idx) => (
                <button key={img.id || `lib-${idx}`} className={`${publishAvatarUrl===img.url ? 'border-purple-500' : 'border-gray-700'} border rounded overflow:hidden`} onClick={() => setPublishAvatarUrl(img.url)}>
                  <img src={img.url} alt="opt" className="w-full h-24 object-cover" />
                </button>
              ))}
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button className="bg-gray-700 hover:bg-gray-600" onClick={() => setShowPublishSheet(false)}>취소</Button>
            <Button className="bg-green-600 hover:bg-green-700" disabled={publishing || !publishName?.trim()} onClick={handlePublishAsCharacter}>{publishing ? '게시 중…' : '게시'}</Button>
          </div>
             <div className="text-xs text-gray-500">채팅 로그를 바탕으로 기본 설명/도입부/예시 대화가 자동 구성됩니다. 저장 후 캐릭터 상세에서 수정할 수 있습니다.</div>
        </div>
      </SheetContent>
    </Sheet>
   
       {/* 시트: 스토리 뷰어(캔버스) */}
       <Sheet open={showStoryViewerSheet} onOpenChange={setShowStoryViewerSheet}>
         <SheetContent side="right" className="bg-gray-900 border-gray-800 w-full sm:w-[640px] sm:max-w-none">
           <SheetHeader>
             <SheetTitle className="text-white">{storyForViewer.title}</SheetTitle>
           </SheetHeader>
           <div className="mt-4 pr-4">
             <div className="h-[85vh] overflow-auto text-gray-200 whitespace-pre-wrap leading-7">
               {/* 이미지가 있으면 최상단에 표시 */}
               {storyForViewer.imageUrl && (
                 <div className="mb-6">
                   <img 
                     src={storyForViewer.imageUrl} 
                     alt="스토리 이미지" 
                     className="w-full h-auto rounded-lg shadow-lg"
                   />
                 </div>
               )}
               {/* 스토리 텍스트 */}
               {storyForViewer.content}
             </div>
           </div>
         </SheetContent>
       </Sheet>

       {/* 🆕 부분 재생성 플로팅 모달 */}
       {showEditModal && (
         <>
           {/* 투명 오버레이 - 클릭하면 모달 닫기 */}
           <div 
             className="fixed inset-0 z-40"
             style={{ userSelect: 'none' }}
             onMouseDown={(e) => {
               // 마우스 다운 시점에 선택 해제 방지
               e.preventDefault();
             }}
             onClick={() => {
               setShowEditModal(false);
               setEditPrompt('');
               setSelectedText('');
               setSelectionRange(null);
               window.getSelection()?.removeAllRanges();
             }}
           />
           
           {/* 실제 모달 */}
           <div 
             className="fixed z-50 bg-gray-900/95 backdrop-blur-sm border-2 border-purple-500/70 rounded-lg shadow-2xl p-3 min-w-[320px] max-w-[480px]"
             style={{ 
               top: `${modalPosition.top}px`, 
               left: `${modalPosition.left}px`,
               userSelect: 'none',
               cursor: isDraggingModal ? 'grabbing' : 'grab'
             }}
             onMouseDown={(e) => {
               e.stopPropagation();
               handleModalMouseDown(e);
             }}
             onClick={(e) => e.stopPropagation()}
           >
             {regenerating ? (
               // 재생성 중 - 스켈레톤 UI
               <div className="flex items-center gap-3">
                 <Loader2 className="w-5 h-5 animate-spin text-purple-400" />
                 <span className="text-sm text-gray-300">
                   수정중... {Math.floor((Date.now() - (selectionRange?.startTime || Date.now())) / 1000)}s
                 </span>
               </div>
             ) : (
               // 입력 UI
               <div className="space-y-2">
                 <div 
                   className="text-xs text-gray-400 mb-1 cursor-pointer hover:text-purple-400 transition-colors"
                   onClick={handleRestoreSelection}
                   title="클릭하면 선택 영역이 다시 표시됩니다"
                 >
                   선택된 텍스트: "{selectedText.slice(0, 50)}{selectedText.length > 50 ? '...' : ''}"
                 </div>
                 <div className="flex items-center gap-2">
                   <Input
                     type="text"
                     placeholder="이런 느낌으로 바꿔줘"
                     value={editPrompt}
                     onChange={(e) => setEditPrompt(e.target.value)}
                     onKeyDown={(e) => {
                       if (e.key === 'Enter' && editPrompt.trim()) {
                         handlePartialRegenerate();
                       }
                     }}
                     className="flex-1 bg-gray-800 border-gray-700 text-white text-sm"
                     autoFocus
                   />
                   <Button
                     size="sm"
                     onClick={handlePartialRegenerate}
                     disabled={!editPrompt.trim()}
                     className="bg-purple-600 hover:bg-purple-700 text-white px-3"
                     title="재생성"
                   >
                     <Wand2 className="w-4 h-4" />
                   </Button>
                 </div>
               </div>
             )}
           </div>
         </>
      )}
</div>
</AppLayout>
);
};

export default AgentPage;

// 추천 컴포넌트: 인기 캐릭터 1위 + 웹소설 TOP 1,2위
function ExploreRecommendations() {
  const [stories, setStories] = React.useState([]);
  const [characters, setCharacters] = React.useState([]);
  // const [selectedStoryId, setSelectedStoryId] = React.useState(null);
  
  // 작품별 상태 저장: { storyId: { visibleEpisodes: [...], expandedEpisodes: Set([...]) } }
    // localStorage에서 복원
  const [selectedStoryId, setSelectedStoryId] = React.useState(() => {
    try {
      return localStorage.getItem('agent:explore:selectedStoryId') || null;
    } catch {
      return null;
    }
  });
  
  // 작품별 상태 저장: { storyId: { visibleEpisodes: [...], expandedEpisodes: Set([...]) } }
  const [storyStates, setStoryStates] = React.useState(() => {
    try {
      const saved = localStorage.getItem('agent:explore:storyStates');
      if (saved) {
        const parsed = JSON.parse(saved);
        // Set을 복원
        Object.keys(parsed).forEach(key => {
          if (parsed[key].expandedEpisodes && Array.isArray(parsed[key].expandedEpisodes)) {
            parsed[key].expandedEpisodes = new Set(parsed[key].expandedEpisodes);
          }
        });
        return parsed;
      }
    } catch {}
    return {};
  });
  
  // selectedStoryId 변경 시 저장
  React.useEffect(() => {
    try {
      if (selectedStoryId) {
        localStorage.setItem('agent:explore:selectedStoryId', selectedStoryId);
      } else {
        localStorage.removeItem('agent:explore:selectedStoryId');
      }
    } catch {}
  }, [selectedStoryId]);
  
  // storyStates 변경 시 저장
  React.useEffect(() => {
    try {
      const toSave = {};
      Object.keys(storyStates).forEach(key => {
        toSave[key] = {
          visibleEpisodes: storyStates[key].visibleEpisodes || [],
          expandedEpisodes: Array.from(storyStates[key].expandedEpisodes || [])
        };
      });
      localStorage.setItem('agent:explore:storyStates', JSON.stringify(toSave));
    } catch {}
  }, [storyStates]);

  
  React.useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [sRes, cRes] = await Promise.all([
          rankingAPI.getDaily({ kind: 'story' }),
          charactersAPI.getCharacters({ sort: 'views', limit: 24 })
        ]);
        
        const storyItems = Array.isArray(sRes.data?.items) ? sRes.data.items : [];
        const topStories = storyItems.slice(0, 2);
        
        const cList = cRes.data || [];
        const topChars = cList.slice(0, 1);
        
        if (!alive) return;
        setStories(topStories);
        setCharacters(topChars);
      } catch (err) {
        console.error('Failed to fetch recommendations:', err);
      }
    })();
    return () => { alive = false; };
  }, []);

  if (!stories.length && !characters.length) return null;

  const selectedStory = stories.find(s => s.id === selectedStoryId);
  const currentState = storyStates[selectedStoryId] || { visibleEpisodes: [], expandedEpisodes: new Set() };

  return (
    <div className="w-full max-w-2xl">
      <div className="mb-3 text-sm text-gray-400">신비한 천사님, 더 완성도 높은 콘텐츠가 있어요.</div>
      
      {/* 카드 그리드 - 항상 표시 */}
      <div className="grid grid-cols-3 gap-2 mb-6">
        {stories.map((story, idx) => (
          <div 
            key={`rec-s-${story.id || idx}`}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setSelectedStoryId(story.id);
            }}
            className="cursor-pointer"
          >
            <div className={`transition-all ${
              selectedStoryId === story.id 
                ? 'ring-2 ring-purple-500 rounded-lg shadow-[0_0_16px_rgba(168,85,247,0.5)]' 
                : ''
            }`}>
              <StoryExploreCard story={story} compact onClick={(e) => e.preventDefault()} />
            </div>
          </div>
        ))}
        {characters[0] && (
          <div key={`rec-c-${characters[0].id}`} className="transform scale-[0.9] origin-top-left">
            <CharacterCard character={characters[0]} />
          </div>
        )}
      </div>
      
      {/* 선택된 작품의 회차 표시 */}
      {/* 선택된 작품의 회차 표시 */}
      {selectedStory && (
        <EpisodeViewerInline 
          key={selectedStory.id}
          storyId={selectedStory.id} 
          storyTitle={selectedStory.title}
          visibleEpisodes={currentState.visibleEpisodes || []}
          expandedEpisodes={currentState.expandedEpisodes || new Set()}
          onVisibleChange={(newVisible) => {
            setStoryStates(prev => ({
              ...prev,
              [selectedStory.id]: {
                visibleEpisodes: newVisible,
                expandedEpisodes: prev[selectedStory.id]?.expandedEpisodes || new Set()
              }
            }));
          }}
          onExpandedChange={(newExpanded) => {
            setStoryStates(prev => ({
              ...prev,
              [selectedStory.id]: {
                visibleEpisodes: prev[selectedStory.id]?.visibleEpisodes || [],
                expandedEpisodes: newExpanded
              }
            }));
          }}
        />
      )}
    </div>
  );
}

// 사용자 말풍선용: 육하원칙 + 프롬프트를 한 줄로 정리
function formatW5AsUserMessage(w5, prompt) {
  try {
    const parts = [
      `${w5.background} 배경,`,
      `${w5.place} 에서,`,
      `${w5.role} 인,`,
      `${w5.speaker},`,
      `${w5.mutation} 해,`,
      `${w5.goal} 로,`,
      `${w5.become || '되는'} 이야기`,
    ].filter(Boolean);
    const line = parts.join(' ');
    return prompt ? `${line}\n\n${prompt}` : line;
  } catch {
    return prompt || '';
  }
}

// AgentPage.jsx 끝에 추가할 컴포넌트

// 에피소드 뷰어 (인라인, 상태 외부 관리)
// 에피소드 뷰어 (인라인, 상태 외부 관리)
function EpisodeViewerInline({ storyId, storyTitle, visibleEpisodes, expandedEpisodes, onVisibleChange, onExpandedChange }) {
  const [allEpisodes, setAllEpisodes] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [scrolledToBottom, setScrolledToBottom] = React.useState({}); // episodeId -> boolean

  React.useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const response = await storiesAPI.getEpisodes(storyId);
        if (!alive) return;
        
        const eps = response.data || [];
        setAllEpisodes(eps);
        
        // 1화만 먼저 표시 (최초 선택 시)
        if (eps[0] && visibleEpisodes.length === 0) {
          onVisibleChange([eps[0]]);
        }
        
        setLoading(false);
      } catch (err) {
        console.error('Failed to fetch episodes:', err);
        setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [storyId]);

  const handleExpand = (episodeId) => {
    const newSet = new Set(expandedEpisodes);
    newSet.add(episodeId);
    onExpandedChange(newSet);
  };

  const handleLoadNext = () => {
    const currentLastEp = visibleEpisodes[visibleEpisodes.length - 1];
    const currentIndex = allEpisodes.findIndex(ep => ep.id === currentLastEp.id);
    
    if (currentIndex !== -1 && currentIndex < allEpisodes.length - 1) {
      const nextEp = allEpisodes[currentIndex + 1];
      onVisibleChange([...visibleEpisodes, nextEp]);
    }
  };

  const handleScrollToRecommendations = () => {
    const recommendSection = document.querySelector('[data-section="recommendations"]');
    if (recommendSection) {
      recommendSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const handleContentScroll = (episodeId, e) => {
    const el = e.target;
    const atBottom = (el.scrollHeight - el.scrollTop - el.clientHeight) < 10;
    setScrolledToBottom(prev => ({
      ...prev,
      [episodeId]: atBottom
    }));
  };

  if (loading) {
    return (
      <div className="w-full max-w-2xl">
        <div className="p-6 bg-gray-900/30 border border-gray-800/50 rounded-lg animate-pulse">
          <div className="h-4 bg-gray-800 rounded w-1/4 mb-3"></div>
          <div className="space-y-2">
            <div className="h-3 bg-gray-800 rounded"></div>
            <div className="h-3 bg-gray-800 rounded w-5/6"></div>
          </div>
        </div>
      </div>
    );
  }

  if (!allEpisodes.length) {
    return (
      <div className="w-full max-w-2xl p-6 bg-gray-900/30 border border-gray-800/50 rounded-lg text-center text-gray-400">
        에피소드가 없습니다.
      </div>
    );
  }

  const hasMoreEpisodes = visibleEpisodes.length < allEpisodes.length;

  return (
    <div className="w-full max-w-2xl mt-4">
      {/* 회차 목록 */}
      <div className="space-y-6">
        {visibleEpisodes.map((ep, idx) => {
          const isExpanded = expandedEpisodes.has(ep.id);
          const preview = ep.content.slice(0, 300);
          const needsExpand = ep.content.length > 300;
          const isLastVisible = idx === visibleEpisodes.length - 1;
          const hasScrolledToBottom = scrolledToBottom[ep.id] || false;
          
          return (
            <div key={ep.id} className="relative">
              {/* 회차 헤더 */}
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-purple-400">
                    {storyTitle} {ep.no}화
                  </span>
                  {ep.title && (
                    <span className="text-sm text-gray-300">· {ep.title}</span>
                  )}
                </div>
              </div>
              
              {/* 본문 - 보라색 글로우 */}
              <div className="px-4 py-4 bg-gray-900/30 border-2 border-purple-500/60 shadow-[0_0_16px_rgba(168,85,247,0.4)] rounded-lg">
                <div 
                  onScroll={(e) => handleContentScroll(ep.id, e)}
                  className={`text-gray-200 whitespace-pre-wrap leading-relaxed text-[15px] ${
                    !isExpanded && needsExpand 
                      ? 'max-h-[400px] overflow-y-auto' 
                      : ''
                  }`}
                  style={!isExpanded && needsExpand ? {
                    scrollbarWidth: 'thin',
                    scrollbarColor: 'rgba(168, 85, 247, 0.4) transparent',
                    paddingRight: '8px'
                  } : {}}
                >
                  {isExpanded ? ep.content : ep.content}
                </div>
                
                {/* 더보기 버튼 (확장 안 됐고, 스크롤 끝 안 갔을 때만) */}
                {!isExpanded && needsExpand && !hasScrolledToBottom && (
                  <div className="mt-4 pt-4 border-t border-gray-800/50">
                    <button
                      onClick={() => handleExpand(ep.id)}
                      className="w-full py-2 text-purple-400 hover:text-purple-300 text-sm font-medium transition-colors flex items-center justify-center gap-1"
                    >
                      <span>더보기</span>
                      <ChevronDown className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>
              
              {/* 액션 버튼 - 확장됐거나 스크롤 끝 도착 */}
              {(isExpanded || hasScrolledToBottom) && isLastVisible && (
                <div className="mt-4 flex justify-center gap-3">
                  <button
                    onClick={handleScrollToRecommendations}
                    className="px-6 py-2 bg-gray-800 hover:bg-gray-700 text-gray-200 rounded-full text-sm font-medium transition-colors"
                  >
                    추천 목록으로
                  </button>
                  {hasMoreEpisodes && (
                    <button
                      onClick={handleLoadNext}
                      className="px-6 py-2 bg-gradient-to-r from-purple-600 to-fuchsia-600 hover:brightness-110 text-white rounded-full text-sm font-medium transition-all flex items-center gap-2"
                    >
                      <span>다음화 보기</span>
                      <ChevronDown className="w-4 h-4" />
                    </button>
                  )}
                </div>
              )}
              
              {/* 구분선 */}
              {!isLastVisible && (
                <div className="mt-6 border-t border-gray-800/30" />
              )}
            </div>
          );
        })}
      </div>
      
      {/* 마지막 화 */}
      {!hasMoreEpisodes && visibleEpisodes.length > 0 && (expandedEpisodes.has(visibleEpisodes[visibleEpisodes.length - 1]?.id) || scrolledToBottom[visibleEpisodes[visibleEpisodes.length - 1]?.id]) && (
        <div className="mt-8 text-center">
          <div className="text-sm text-gray-500 mb-4">— 마지막 화입니다 —</div>
          <button
            onClick={handleScrollToRecommendations}
            className="px-6 py-2 bg-gray-800 hover:bg-gray-700 text-gray-200 rounded-full text-sm font-medium transition-colors"
          >
            추천 목록으로
          </button>
        </div>
      )}
    </div>
  );
}


// 첫 문장까지만 자르기
function truncateToFirstSentence(text) {
  if (!text) return '';
  const match = text.match(/[^.?!]*[.?!]/);
  return match ? match[0].trim() : text.slice(0, 30) + '...';
}

// 타이핑 효과 컴포넌트
function TypewriterText({ text, speed = 30 }) {
  const [displayText, setDisplayText] = React.useState('');
  const [currentIndex, setCurrentIndex] = React.useState(0);

  React.useEffect(() => {
    if (currentIndex < text.length) {
      const timer = setTimeout(() => {
        setDisplayText(prev => prev + text[currentIndex]);
        setCurrentIndex(prev => prev + 1);
      }, speed);
      return () => clearTimeout(timer);
    }
  }, [currentIndex, text, speed]);

  return <span className="text-xs text-gray-200 text-center leading-relaxed break-words">{displayText}</span>;
}

// 일상(snap) 전용 캐릭터 추천 (DB에서 '일상' 태그 필터링)
function CharacterRecommendations({ generatedText, imageUrl, sessionId, onCharacterSelect, selectedCharacterId }) {
  const [characters, setCharacters] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [previewRooms, setPreviewRooms] = React.useState({}); // { charId: roomId }
  const [previewMessages, setPreviewMessages] = React.useState({}); // { charId: firstMessage }
  const pollingIntervalsRef = React.useRef({});

  // 캐릭터 목록 로드


  // 캐릭터 목록이 로드되면 각 캐릭터의 미리보기 채팅방 생성
  // 캐릭터 목록이 로드되면 각 캐릭터의 미리보기 채팅방 생성
  React.useEffect(() => {
    let alive = true;
    const effectSessionId = sessionId; // ✅ 세션 스냅샷

    (async () => {
      try {
        const res = await charactersAPI.getCharacters({ 
          tags: '일상',
          sort: 'views',
          limit: 5 
        });

        if (!alive || effectSessionId !== sessionId) return; // ✅ 세션 가드(1)

        const chars = res.data || [];
        setCharacters(chars.slice(0, 5));
        setLoading(false);

        // 캐릭터 로드 직후 프리뷰 생성 (sessionId별 캐싱 추가)
        if (chars.length > 0 && generatedText && sessionId) {
          // localStorage에서 기존 previewRooms 캐싱 확인
          const cacheKey = `agent:previewRooms:${sessionId}`;
          let cachedRooms = {};
          try {
            const stored = localStorage.getItem(cacheKey);
            if (stored) cachedRooms = JSON.parse(stored);
          } catch {}

          setPreviewRooms(cachedRooms);
          setPreviewMessages({});

          // vision 읽기
          let visionTags = null;
          let visionCtx = null;
          try {
            const stored = localStorage.getItem(`agent:vision:${sessionId}`);
            if (stored) {
              const parsed = JSON.parse(stored);
              visionTags = parsed.tags;
              visionCtx = parsed.ctx;
            }
          } catch {}

          // 방 생성
          const rooms = { ...cachedRooms };
          for (const char of chars.slice(0, 5)) {
            if (!rooms[char.id]) {  // ✅ 추가: 기존 캐싱 없으면 생성
              try {
                const roomRes = await chatAPI.startChatWithContext({
                  character_id: char.id,
                  agent_text: generatedText,
                  image_url: imageUrl,
                  session_id: sessionId,
                  vision_tags: visionTags,
                  vision_ctx: visionCtx
                });
                rooms[char.id] = roomRes.data.id;
              } catch (err) {
                console.error(`Failed to create preview for ${char.name}:`, err);
              }
            }
          }

          if (!alive || effectSessionId !== sessionId) return; // ✅ 세션 가드(2)
          setPreviewRooms(rooms);

          // 캐싱 저장
          try {
            localStorage.setItem(cacheKey, JSON.stringify(rooms));
          } catch {}
        }
      } catch (err) {
        console.error('Failed to fetch characters:', err);
        setLoading(false);
      }
    })();

    return () => { alive = false; };
  }, [sessionId, generatedText, imageUrl]); // 의존성 배열: generatedText/imageUrl 추가로 변경 시 재실행

  // 각 채팅방의 첫 메시지 폴링
  React.useEffect(() => {
    if (Object.keys(previewRooms).length === 0) return;

    Object.entries(previewRooms).forEach(([charId, roomId]) => {
      // 이미 메시지가 있으면 폴링 안 함
      if (previewMessages[charId]) return;

      // 로컬 스토리지에서 캐시된 메시지 확인 (세션별로)
      try {
        const cacheKey = `agent:preview:${sessionId}:${charId}`;
        const cached = localStorage.getItem(cacheKey);
        if (cached) {
          setPreviewMessages(prev => ({ ...prev, [charId]: cached }));
          return; // 캐시 있으면 폴링 안 함
        }
      } catch {}

      const pollMessages = async () => {
        try {
          const res = await chatAPI.getMessages(roomId);
          const messages = res.data || [];
          
          // 첫 AI 메시지 찾기
          const firstAI = messages.find(m => m.sender_type === 'assistant');
          if (firstAI) {
            setPreviewMessages(prev => ({ ...prev, [charId]: firstAI.content }));
            
            // 로컬 스토리지에 캐싱 (세션별로)
            try {
              const cacheKey = `agent:preview:${sessionId}:${charId}`;
              localStorage.setItem(cacheKey, firstAI.content);
            } catch {}
            
            // 메시지 받았으면 폴링 중지
            if (pollingIntervalsRef.current[charId]) {
              clearInterval(pollingIntervalsRef.current[charId]);
              delete pollingIntervalsRef.current[charId];
            }
          }
        } catch (err) {
          console.error(`Failed to poll messages for char ${charId}:`, err);
        }
      };

      // 즉시 1회 실행
      pollMessages();

      // 2초마다 폴링
      pollingIntervalsRef.current[charId] = setInterval(pollMessages, 2000);
    });

    return () => {
      Object.values(pollingIntervalsRef.current).forEach(interval => {
        clearInterval(interval);
      });
      pollingIntervalsRef.current = {};
    };
  }, [previewRooms, previewMessages]);

  const handleCharacterClick = async (char) => {
    if (onCharacterSelect) {
      // 이미 생성된 채팅방 ID 전달
      onCharacterSelect(char, generatedText, imageUrl, sessionId, previewRooms[char.id]);
    }
  };

  if (loading) {
    return (
      <div className="w-full max-w-4xl">
        <div className="mb-4 text-sm text-gray-400">💬 이 이야기를 같이 나눌 친구</div>
        <div className="flex gap-6">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="flex flex-col items-center gap-2">
              <div className="w-20 h-20 rounded-full bg-gray-800 animate-pulse" />
              <div className="h-4 w-16 bg-gray-800 rounded animate-pulse" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (characters.length === 0) {
    return (
      <div className="w-full max-w-4xl">
        <div className="mb-4 text-sm text-gray-400">💬 이 이야기를 같이 나눌 친구</div>
        <div className="text-gray-500 py-4">
          '일상' 태그 캐릭터가 없습니다
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-4xl">
      <div className="mb-4 text-sm text-gray-400">💬 이 이야기를 같이 나눌 친구</div>
      <div className="flex gap-6">
        {characters.map(char => {
          const isSelected = selectedCharacterId === char.id;
          return (
          <div 
            key={char.id}
            className="flex flex-col items-center gap-2 cursor-pointer group"
          >
            <div 
              onClick={() => handleCharacterClick(char)}
              className={`w-20 h-20 rounded-full overflow-hidden ring-2 transition-all bg-gray-800 flex items-center justify-center ${
                isSelected 
                  ? 'ring-purple-500 shadow-[0_0_20px_rgba(168,85,247,0.8)]' 
                  : 'ring-gray-700 group-hover:ring-purple-500 group-hover:shadow-[0_0_16px_rgba(168,85,247,0.5)]'
              }`}
            >
              <img 
                src={char.avatar_url || char.thumbnail_url} 
                alt={char.name}
                className="w-full h-full object-cover"
                onError={(e) => {
                  e.target.style.display = 'none';
                  e.target.nextSibling.style.display = 'flex';
                }}
              />
              <span className="text-4xl hidden">
                {char.name?.charAt(0) || '👤'}
              </span>
            </div>
            <span className={`text-sm transition-colors font-medium text-center ${
              isSelected ? 'text-purple-300' : 'text-gray-300 group-hover:text-purple-300'
            }`}>
              {char.name}
            </span>
            
            {/* 미리보기 말풍선 (선택되지 않았을 때만) */}
            {!isSelected && (
              <div className="mt-1 px-3 py-2 bg-white/10 rounded-lg max-w-[160px] min-h-[50px] flex items-center justify-center">
                {previewMessages[char.id] ? (
                  <TypewriterText text={truncateToFirstSentence(previewMessages[char.id])} speed={30} />
                ) : (
                  <div className="flex space-x-1">
                    <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
                    <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                    <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
                  </div>
                )}
              </div>
            )}
          </div>
          );
        })}
      </div>
    </div>
  );
}

