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
import { storiesAPI, charactersAPI, chatAPI } from '../lib/api';
import { Switch } from '../components/ui/switch';
import { DEFAULT_SQUARE_URI } from '../lib/placeholder';
import { Loader2, Plus, Send, Sparkles, Image as ImageIcon, Trash2, ChevronLeft, ChevronRight, X, CornerDownLeft, Copy as CopyIcon, RotateCcw } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useQueryClient } from '@tanstack/react-query';

const LS_SESSIONS = 'agent:sessions';
const LS_MESSAGES_PREFIX = 'agent:messages:'; // + sessionId
const LS_STORIES = 'agent:stories';
const LS_IMAGES = 'agent:images';
const LS_CHARACTERS = 'agent:characters';

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

function useAgentSessions(persist = true) {
const [sessions, setSessions] = useState(() => persist ? loadJson(LS_SESSIONS, []) : []);

useEffect(() => { 
if (!persist) return;
saveJson(LS_SESSIONS, sessions);
try { window.dispatchEvent(new Event('agent:sessionsChanged')); } catch {}
}, [sessions, persist]);

const createSession = (partial = {}) => {
const id = crypto.randomUUID();
const session = {
id,
title: partial.title || '새 대화',
model: partial.model || 'claude-sonnet-4.0',
createdAt: nowIso(),
updatedAt: nowIso(),
type: partial.type || 'chat',
};
const next = [session, ...sessions];
setSessions(next);
if (persist) {
  saveJson(LS_MESSAGES_PREFIX + id, []);
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
  try { localStorage.removeItem(LS_MESSAGES_PREFIX + id); } catch {}
}
try { window.dispatchEvent(new Event('agent:sessionsChanged')); } catch {}
};

return { sessions, setSessions, createSession, updateSession, removeSession };
}

function useSessionMessages(sessionId, persist = true) {
const [messages, setMessages] = useState(() => persist ? loadJson(LS_MESSAGES_PREFIX + sessionId, []) : []);

useEffect(() => {
if (!sessionId) return;
if (persist) setMessages(loadJson(LS_MESSAGES_PREFIX + sessionId, []));
else setMessages([]);
}, [sessionId, persist]);
useEffect(() => { if (persist && sessionId) saveJson(LS_MESSAGES_PREFIX + sessionId, messages); }, [sessionId, messages, persist]);

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
{ value: 'claude-sonnet-4.0', label: 'Claude Sonnet 4.0' },
{ value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
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
const { sessions, createSession, updateSession, removeSession } = useAgentSessions(!isGuest === true);
const [activeSessionId, setActiveSessionId] = useState((!isGuest ? (sessions[0]?.id || null) : null));
const { messages, setMessages } = useSessionMessages(activeSessionId || '', !isGuest === true);
const queryClient = useQueryClient();
const messagesContainerRef = useRef(null);
const stableMessages = useMemo(() => messages, [messages]);
// 가상 스크롤러(최상단에서 훅 호출)
const rowVirtualizer = useVirtualizer({
  count: stableMessages.length,
  getScrollElement: () => messagesContainerRef.current,
  estimateSize: () => 64,
  overscan: 8,
});

// 새 메시지 도착 시 자동 스크롤(하단)
useEffect(() => {
  try {
    const el = messagesContainerRef.current;
    if (el) {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    }
  } catch {}
}, [stableMessages]);

const [prompt, setPrompt] = useState('');
const inputRef = useRef(null);
const [mode, setMode] = useState('story'); // 'story' | 'image' | 'char' | 'sim'
const [storyModel, setStoryModel] = useState(STORY_MODELS[0].value);
const [imageModel, setImageModel] = useState(IMAGE_MODELS[0].value);
const [isPublic, setIsPublic] = useState(false);
const [w5, setW5] = useState(DEFAULT_W5);
const [generating, setGenerating] = useState(false);
const [images, setImages] = useState(() => loadJson(LS_IMAGES, []));
const [imageResults, setImageResults] = useState([]);
const [showChatPanel, setShowChatPanel] = useState(false);
const [showImagesSheet, setShowImagesSheet] = useState(false);
const [showStoriesSheet, setShowStoriesSheet] = useState(false);
const [insertTargetImage, setInsertTargetImage] = useState(null);
const [insertKind, setInsertKind] = useState('gallery'); // 'cover' | 'gallery'
const [selectedStoryId, setSelectedStoryId] = useState(null);
const [storiesList, setStoriesList] = useState(() => loadJson(LS_STORIES, []));
const [showStoriesViewerSheet, setShowStoriesViewerSheet] = useState(false);
const [showCharactersViewerSheet, setShowCharactersViewerSheet] = useState(false);
const [charactersList, setCharactersList] = useState(() => loadJson(LS_CHARACTERS, []));
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
// Story preview (fake streaming while generating full 5 episodes)
const [storyPreview, setStoryPreview] = useState('');
const [storyPreviewProgress, setStoryPreviewProgress] = useState(0);
const [storyGenerating, setStoryGenerating] = useState(false);
const [storyFullBuffer, setStoryFullBuffer] = useState('');
const previewTimerRef = useRef(null);
const [genError, setGenError] = useState('');
const [imgError, setImgError] = useState('');
// SSE job 관리
const [storyJobId, setStoryJobId] = useState(null);
const [storyQueuePos, setStoryQueuePos] = useState(null);
const [storyCancelling, setStoryCancelling] = useState(false);
// 스토리 뷰어(캔버스)용 Sheet 상태
const [showStoryViewerSheet, setShowStoryViewerSheet] = useState(false);
const [storyForViewer, setStoryForViewer] = useState({ title: '', content: '' });
// 스토리 스트리밍 말풍선 업데이트용
const storyAssistantIdRef = useRef(null);
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

useEffect(() => { if (!isGuest) saveJson(LS_IMAGES, images); }, [images, isGuest]);
useEffect(() => { if (!isGuest) saveJson(LS_STORIES, storiesList); }, [storiesList, isGuest]);
useEffect(() => { if (!isGuest) saveJson(LS_CHARACTERS, charactersList); }, [charactersList, isGuest]);

// UI 상태 로컬 복원/저장
useEffect(() => {
try {
const ui = loadJson('agent:ui', null);
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
} catch {}
}, []);
useEffect(() => {
saveJson('agent:ui', { mode, storyModel, imageModel, isPublic, w5, imageSize, imageAspect, imageCount, publishPublic, includeNewImages, includeLibraryImages });
}, [mode, storyModel, imageModel, isPublic, w5, imageSize, imageAspect, imageCount, publishPublic, includeNewImages, includeLibraryImages]);

useEffect(() => {
if (!activeSessionId && sessions.length > 0) setActiveSessionId(sessions[0].id);
}, [sessions, activeSessionId]);

// Hash-based activation from AgentSidebar
useEffect(() => {
const tryActivateFromHash = () => {
try {
  const h = window.location.hash || '';
  const m = h.match(/session=([^&]+)/);
  const id = m?.[1];
  if (id && sessions.some(s => s.id === id)) {
    setActiveSessionId(id);
    setShowChatPanel(true);
  }
} catch {}
};
tryActivateFromHash();
window.addEventListener('hashchange', tryActivateFromHash);
return () => window.removeEventListener('hashchange', tryActivateFromHash);
}, [sessions]);

// Auto open panel when a session is active (GPT-like resume)
useEffect(() => {
if (activeSessionId && messages.length > 0) setShowChatPanel(true);
}, [activeSessionId, messages]);

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
const turnLimitReached = userTurns >= 20;
const activeSession = useMemo(() => (sessions || []).find(s => s.id === activeSessionId) || null, [sessions, activeSessionId]);

const handleCreateSession = () => {
    const s = createSession({ title: '새 대화', type: mode === 'story' ? 'story' : 'chat' });
    setActiveSessionId(s.id);
    setMessages([]);
    setShowChatPanel(false);
    setPrompt('');
    setW5(DEFAULT_W5);
    setQuickIdx(-1);
    navigate('/agent');
    // Optional: focus first input after state updates
    setTimeout(() => {
        const firstInput = document.querySelector('[data-w5-input="background"]');
        if (firstInput) firstInput.focus();
    }, 100);
};

const handleSessionSelect = (id) => {
    setActiveSessionId(id);
    navigate(`/agent#session=${id}`, { replace: true });
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
if (turnLimitReached) return;
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
  const history = (stableMessages || []).slice(-12).map(m => ({ role: m.role, content: m.content, type: m.type }));
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

const handleGenerate = async (overridePrompt = null) => {
setGenerating(true);
try {
if (mode === 'story') {
  // Ensure a story session is active so canvas/preview is visible like GPT
  let sessionRefId = activeSessionId;
  let isNewSession = false;
  if (!activeSessionId) {
    const s = createSession({ title: '새 대화', type: 'story' });
    sessionRefId = s.id;
    setActiveSessionId(s.id);
    setShowChatPanel(true);
    isNewSession = true;
  }
  const effectivePrompt = overridePrompt != null ? overridePrompt : prompt;
  
  const assistantThinkingId = crypto.randomUUID();
  setMessages(curr => [...curr, { id: assistantThinkingId, role: 'assistant', content: '소설 쓰는 중...', createdAt: nowIso(), thinking: true }]);
  storyAssistantIdRef.current = assistantThinkingId;
  
  setStoryGenerating(true);
  // 초기화: 이전 상태 정리
  setGenError('');
  setStoryJobId(null);
  setStoryQueuePos(null);
  setStoryFullBuffer('');
  setStoryPreview('');
  setStoryPreviewProgress(0);
  // Start optimistic preview: build 500-char intro and animate progress 10→90%
  const seed = buildStorySeed(w5, effectivePrompt, 1400);
  setStoryPreview(seed.slice(0, 500));
  setStoryPreviewProgress(10);
  if (previewTimerRef.current) clearInterval(previewTimerRef.current);
  let idx = 0;
  const chars = seed.slice(500).split('');
  previewTimerRef.current = setInterval(() => {
    idx += Math.max(3, Math.floor(chars.length / 60));
    const typed = chars.slice(0, Math.min(idx, chars.length)).join('');
    setStoryPreview(seed.slice(0, 500) + typed);
    setStoryPreviewProgress((p) => Math.min(90, p + 1));
    if (idx >= chars.length) { clearInterval(previewTimerRef.current); previewTimerRef.current = null; }
  }, 25);
  // 백엔드 존재 시 호출, 실패 시 로컬 스텁 저장
  let ok = false;
  let created = null;
  // 키워드 구성 (프롬프트 토큰 + 육하원칙)
  const kw = Array.from(new Set([
    ...(effectivePrompt || '').split(/[\,\s]+/).filter(Boolean),
    w5.background,
    w5.place,
    w5.role,
    (w5.speaker || '').replace(/가$/, ''),
    w5.mutation,
    w5.goal,
  ].filter(Boolean))).slice(0, 10);
  try {
    // Try streaming first
    const stream = await storiesAPI.generateStoryStream({
      prompt: effectivePrompt,
      keywords: kw,
      background: w5.background,
      place: w5.place,
      role: w5.role,
      mutation: w5.mutation,
      goal: w5.goal,
      model: storyModel,
      is_public: isPublic,
      episode_limit: 5,
    }, {
      onStart: () => {
        storyAssistantIdRef.current = assistantThinkingId;
        setMessages(curr => curr.map(m => m.id === assistantThinkingId ? { ...m, thinking: false, streaming: true, content: '' } : m));
      },
      onMeta: (payload) => {
        try {
          if (payload?.job_id) setStoryJobId(payload.job_id);
          if (typeof payload?.queue_position === 'number') setStoryQueuePos(payload.queue_position);
        } catch {}
      },
      onPreview: (buf) => {
        setStoryPreview(buf.slice(0, 500));
        setStoryFullBuffer(buf);
        const id = storyAssistantIdRef.current;
        if (id) setMessages(curr => curr.map(m => m.id === id ? { ...m, content: (buf || '').slice(0, 500) } : m));
      },
      onProgress: (p) => {
        if (typeof p === 'number') setStoryPreviewProgress(Math.max(0, Math.min(100, p)));
      },
      onEpisode: (ev) => {
        // 미니 타자 효과: 에피소드 델타를 프리뷰 뒤에 타이핑하듯 붙임
        try {
          const delta = ev?.delta || '';
          if (!delta) return;
          // 버퍼에 추가하고, 캔버스 확장 안된 경우 프리뷰 마지막 500자로 유지
          setStoryFullBuffer(prev => {
            const next = (prev || '') + (prev && !prev.endsWith('\n') ? ' ' : '') + delta;
            const snippet = next.slice(0, 500);
            setStoryPreview(snippet);
            const id = storyAssistantIdRef.current;
            if (id) {
                setMessages(curr => curr.map(m => m.id === id ? { 
                    ...m, 
                    content: snippet, 
                    fullContent: next, 
                    type: 'story_preview' 
                } : m));
            }
            return next;
          });
        } catch {}
      },
    });
    if (stream?.ok) {
      created = stream.data;
      ok = true;
      const id = storyAssistantIdRef.current;
      if (id) setMessages(curr => curr.map(m => m.id === id ? { ...m, streaming: false } : m));
    } else {
      // Fallback to non-stream endpoint
      const res = await storiesAPI.generateStory({
        prompt: effectivePrompt,
        keywords: kw,
        background: w5.background,
        place: w5.place,
        role: w5.role,
        mutation: w5.mutation,
        goal: w5.goal,
        model: storyModel,
        is_public: isPublic,
        episode_limit: 5,
      });
      created = res?.data || null;
      ok = true;
      const aiText = (created?.preview || created?.content || '').slice(0, 500) || '...';
      const fullContent = created?.content || created?.preview || '';
      setMessages(curr => curr.map(m => m.id === assistantThinkingId ? { 
          id: assistantThinkingId, 
          role: 'assistant', 
          content: aiText, 
          fullContent: fullContent,
          type: 'story_preview',
          createdAt: nowIso() 
      } : m));
    }
  } catch (e) { 
    // 스트리밍 실패 시 동기 API로 폴백
    try {
      const res = await storiesAPI.generateStory({
        prompt: effectivePrompt,
        keywords: kw,
        background: w5.background,
        place: w5.place,
        role: w5.role,
        mutation: w5.mutation,
        goal: w5.goal,
        model: storyModel,
        is_public: isPublic,
        episode_limit: 5,
      });
      created = res?.data || null;
      ok = true;
      const aiText = (created?.preview || created?.content || '').slice(0, 500) || '...';
      const fullContent = created?.content || created?.preview || '';
      setMessages(curr => curr.map(m => m.id === assistantThinkingId ? { 
          id: assistantThinkingId, 
          role: 'assistant', 
          content: aiText,
          fullContent: fullContent,
          type: 'story_preview', 
          createdAt: nowIso() 
      } : m));
    } catch (_) {
        setMessages(curr => curr.map(m => m.id === assistantThinkingId ? { ...m, content: '스토리 생성 실패', error: true, thinking: false } : m));
        setGenError('스토리를 생성하지 못했습니다. 다시 시도해 주세요.'); 
    }
  }

  const entry = {
    id: created?.id || crypto.randomUUID(),
    title: created?.title || (effectivePrompt?.slice(0, 36)) || '새 스토리',
    model: created?.model || storyModel,
    is_public: !!(created?.is_public ?? isPublic),
    createdAt: created?.created_at || nowIso(),
    coverUrl: created?.cover_url || undefined,
    gallery: Array.isArray(created?.gallery) ? created.gallery : undefined,
    source: ok ? 'server' : 'local',
    sessionId: sessionRefId || activeSessionId || null,
  };
  const curr = loadJson(LS_STORIES, []);
  saveJson(LS_STORIES, [entry, ...curr]);
  setStoryPreviewProgress(100);
  // If server returned text, replace preview with a real snippet
  try {
    const realFull = (created?.content || created?.preview || '');
    if (realFull) {
      setStoryFullBuffer(realFull);
      const realPreview = realFull.slice(0, 500);
      if (realPreview) setStoryPreview(realPreview);
    }
  } catch (_) {}
  // 사용자에게 간단 피드백
  const message = ok
    ? (entry.is_public ? '스토리 생성 완료 (공개로 노출됩니다)' : '스토리 생성 완료 (비공개)')
    : '스토리(로컬) 생성 완료';
  window.dispatchEvent(new CustomEvent('toast', { detail: { type: ok ? 'success' : 'info', message } }));
  try { window.dispatchEvent(new CustomEvent('analytics', { detail: { name: 'agent_generate_story', props: { ok, model: storyModel, is_public: entry.is_public } } })); } catch {}
  // 피드 즉시 반영: 공개 + 서버 성공 시 캐시 무효화
  if (ok && entry.is_public) {
    try {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['explore-stories'] }),
        queryClient.invalidateQueries({ queryKey: ['top-stories-views'] }),
        queryClient.invalidateQueries({ queryKey: ['top-origchat-views'] }),
      ]);
    } catch (_) {}
  }
  setStoryGenerating(false);
} else {
  // 이미지 생성 스텁: 플레이스홀더 N장
  const count = Math.max(1, Math.min(8, Number(imageCount) || 4));
  const items = Array.from({ length: count }).map((_, i) => ({
    id: crypto.randomUUID(),
    url: DEFAULT_SQUARE_URI,
    model: imageModel,
    prompt: overridePrompt != null ? overridePrompt : prompt,
    size: imageSize,
    aspect: imageAspect,
    createdAt: nowIso(),
  }));
  setImageResults(items);
  setImgError(items.length ? '' : '이미지 생성에 실패했습니다. 다시 시도해 주세요.');
  try { window.dispatchEvent(new CustomEvent('analytics', { detail: { name: 'agent_generate_image', props: { model: imageModel, size: imageSize, aspect: imageAspect, count } } })); } catch {}
}
} finally {
setGenerating(false);
}
};

function buildStorySeed(w5, prompt, minLen = 1200) {
const base = `[${w5.background}/${w5.place}/${w5.role}] ${prompt || ''}`.trim();
const paragraph = `그날, 모든 것이 시작되었다. 바람은 낮게 울었고, 먼 곳의 종이 오후를 가르고 있었다. 나는 아직 알지 못했다. 이 작은 선택이 얼마나 큰 파문을 만들지. 하지만 한 가지는 분명했다. 앞으로의 길을 되돌릴 수 없다는 것만은.\n`;
let s = `${base}\n\n`;
while (s.length < minLen) s += paragraph;
return s.slice(0, Math.max(minLen, 1000));
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

const handleExpandCanvas = (fullContent) => {
  const latestStory = (loadJson(LS_STORIES, []) || [])[0];
  setStoryForViewer({
    title: latestStory?.title || '생성된 스토리',
    content: fullContent || storyFullBuffer
  });
  setShowStoryViewerSheet(true);
};

useEffect(() => () => { if (previewTimerRef.current) clearInterval(previewTimerRef.current); }, []);

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
    const curr = loadJson(LS_MESSAGES_PREFIX + s.id, []);
    const next = [...curr, m];
    saveJson(LS_MESSAGES_PREFIX + s.id, next);
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
const list = isGuest ? [] : loadJson(LS_STORIES, []);
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
// 항상 GPT처럼: 사용자 입력(또는 육하원칙)을 말풍선으로 먼저 남기고 생성/전송
try {
  const content = prompt?.trim() || formatW5AsUserMessage(w5, prompt);
  if (content) setMessages(curr => [...curr, { id: crypto.randomUUID(), role: 'user', content, createdAt: nowIso() }]);
} catch {}
if (mode === 'image') {
await handleGenerate();
  return;
}
// story/chat 공통: 항상 챗 패널로
setShowChatPanel(true);
await handleSend(content);
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
const all = loadJson(LS_STORIES, []);
saveJson(LS_STORIES, all.map(s => s.id === storyId ? { ...s, is_public: nextPublic } : s));
window.dispatchEvent(new CustomEvent('toast', { detail: { type: 'success', message: nextPublic ? '공개로 변경되었습니다' : '비공개로 변경되었습니다' } }));
try { window.dispatchEvent(new CustomEvent('analytics', { detail: { name: 'agent_toggle_visibility', props: { storyId, is_public: nextPublic } } })); } catch {}
} catch (e) {
window.dispatchEvent(new CustomEvent('toast', { detail: { type: 'error', message: '가시성 변경 실패' } }));
}
};

const handleEnterFromCta = useCallback(async () => {
  try {
    let content = (quickIdx >= 0 ? (quickText || '') : formatW5AsUserMessage(w5, '')).trim();
    if (content) {
        content += " 웹소설 써줘.";
    }
    if (!content) return;
    
    let ensuredSessionId = activeSessionId;
    if (!ensuredSessionId) {
        const s = createSession({ title: '새 대화', type: 'story' });
        ensuredSessionId = s.id;
        setActiveSessionId(s.id);
    }

    setShowChatPanel(true);
    setMessages(curr => [...curr, { id: crypto.randomUUID(), role: 'user', content, createdAt: nowIso() }]);
    await handleGenerate(content);

  } catch {}
}, [quickIdx, quickText, w5, showChatPanel, activeSessionId]);

return (
<AppLayout 
  SidebarComponent={AgentSidebar}
  sidebarProps={{ onCreateSession: handleCreateSession, activeSessionId, onSessionSelect: handleSessionSelect }}
>
 <div className="h-full flex flex-col bg-gray-900 text-gray-200">
      <div className="flex-shrink-0">
     {/* 좌/우 스와이프 유도 화살표 오버레이 */}
     <div>
       <button
        type="button"
        aria-label="대시보드로"
        onClick={() => navigate('/dashboard')}
        className="hidden md:flex fixed left-72 top-1/2 -translate-y-1/2 z-20 items-center justify-center w-8 h-8 rounded-full bg-transparent text-gray-200 opacity-80 hover:opacity-100 hover:bg-gray-800/40"
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
        onClick={() => { try { inputRef.current?.focus(); if (messagesContainerRef.current) { messagesContainerRef.current.scrollTo({ top: messagesContainerRef.current.scrollHeight, behavior: 'smooth' }); } } catch {} }}
        className="hidden md:flex fixed right-6 top-1/2 -translate-y-1/2 z-20 items-center justify-center w-8 h-8 rounded-full bg-transparent text-gray-200 opacity-80 hover:opacity-100 hover:bg-gray-800/40"
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
      <div className="h-full overflow-y-auto" ref={messagesContainerRef}>
        {!showChatPanel ? (
            <section className="px-6 md:px-8">
              <div className="flex flex-col items-center justify-center select-none gap-6">
                <h1 className="text-4xl md:text-6xl font-semibold tracking-tight bg-gradient-to-r from-purple-400 via-fuchsia-400 to-pink-400 text-transparent bg-clip-text drop-shadow-[0_0_10px_rgba(168,85,247,0.35)] mb-2 md:mb-3">
                  안녕하세요, {user ? `${user.username}` : '여행자님'}
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
                  <div className="mt-4 md:mt-6 space-y-4">
                    {/* 요구된 육하원칙 문구: 입력 가능한 드롭다운 + 기본값 플레이스홀더 */}
                    {quickIdx === -1 ? (
                    <div className="space-y-2 mb-4 md:mb-6 text-[15px] md:text-base leading-7 text-gray-200">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="flex items-center gap-2">
                          <EditableSelect data-w5-input="background" className="w-20 sm:w-24" inputClassName="truncate" value={w5.background} onChange={(v) => setW5(p => ({ ...p, background: v }))} options={W5_BACKGROUND_OPTS} placeholder="현대" onEnter={handleEnterFromCta} />
                          <span>배경,</span>
                  </div>
                        <div className="flex items-center gap-2">
                          <EditableSelect className="w-20 sm:w-24" inputClassName="truncate" value={w5.place} onChange={(v) => setW5(p => ({ ...p, place: v }))} options={W5_PLACE_OPTS} placeholder="회사" onEnter={handleEnterFromCta} />
                          <span>에서,</span>
                    </div>
                        <div className="flex items-center gap-2">
                          <EditableSelect className="w-24 sm:w-28" inputClassName="truncate" value={w5.role} onChange={(v) => setW5(p => ({ ...p, role: v }))} options={W5_ROLE_OPTS} placeholder="말단" onEnter={handleEnterFromCta} />
                          <span>인,</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <EditableSelect className="w-16 sm:w-20" inputClassName="truncate" value={w5.speaker} onChange={(v) => setW5(p => ({ ...p, speaker: v }))} options={W5_SPEAKER_OPTS} placeholder="내가" onEnter={handleEnterFromCta} />
                          <span>,</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <EditableSelect className="w-20 sm:w-24" inputClassName="truncate" value={w5.mutation} onChange={(v) => setW5(p => ({ ...p, mutation: v }))} options={W5_MUTATION_OPTS} placeholder="각성" onEnter={handleEnterFromCta} />
                          <span>해,</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <EditableSelect className="w-28 sm:w-32" inputClassName="truncate" value={w5.goal} onChange={(v) => setW5(p => ({ ...p, goal: v }))} options={W5_GOAL_OPTS} placeholder="먼치킨" onEnter={handleEnterFromCta} />
                          <span>로,</span>
                          <EditableSelect className="w-28 sm:w-32" inputClassName="truncate" value={w5.become || '되는'} onChange={(v) => setW5(p => ({ ...p, become: v }))} options={W5_BECOME_OPTS} placeholder="되는(연애하는)" onEnter={handleEnterFromCta} />
                          <button type="button" className="ml-1 p-0.5 text-gray-400 hover:text-white cursor-pointer relative z-10" title="템플릿 순환" onMouseDown={(e)=>e.preventDefault()} onClick={handleCycleQuick}>
                             <RotateCcw className="w-3.5 h-3.5" />
                           </button>
                        </div>
                      </div>
                      <div className="flex items-center justify-end gap-2">
                        <span className="text-purple-300/90 drop-shadow-[0_0_6px_rgba(168,85,247,0.25)]">이야기 바로 써 드릴까요?</span>
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-transparent text-gray-400 hover:text-white hover:border-gray-600 bg-transparent transition-colors"
                          title="실행"
                          onClick={handleEnterFromCta}
                        >
                          <CornerDownLeft className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                    ) : (
                      <div className="space-y-2 mb-4 md:mb-6 w-full">
                        <div className="mb-4 md:mb-6 w-full">
                          <div className="rounded-lg border border-gray-700 bg-gray-900/60 px-4 py-3 text-purple-200 whitespace-pre-wrap flex items-center justify-between gap-3">
                            <span className="flex-1">{quickText}</span>
                            <button type="button" className="p-0.5 text-gray-400 hover:text-white cursor-pointer relative z-10" title="템플릿 순환" onMouseDown={(e)=>e.preventDefault()} onClick={handleCycleQuick}>
                               <RotateCcw className="w-4 h-4" />
                             </button>
                          </div>
                        </div>
                        <div className="flex items-center justify-end gap-2">
                          <span className="text-purple-300/90 drop-shadow-[0_0_6px_rgba(168,85,247,0.25)]">이야기 바로 써 드릴까요?</span>
                          <button
                            type="button"
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-transparent text-gray-400 hover:text-white hover:border-gray-600 bg-transparent transition-colors"
                            title="실행"
                            onClick={handleEnterFromCta}
                          >
                            <CornerDownLeft className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    )}
                      </div>
                    </div>
            </div>
            </section>
          ) : (
          <div className="w-full max-w-4xl mx-auto h-full flex flex-col px-3">
              {(mode === 'char' || mode === 'sim') && (
                <div className="flex-shrink-0 p-3 border-b border-gray-700/60 mb-4">
                  <div className="flex items-center justify-between">
                    <h2 className="text-white text-base font-semibold">{activeSession?.title || '새 대화'}</h2>
                      <div className="flex items-center gap-2">
                        <Badge className="bg-gray-700 text-white">{userTurns}/20 턴</Badge>
                        <Button size="sm" variant="ghost" className="text-gray-300 hover:bg-gray-700/60 hover:text-white" onClick={() => { const current = sessions.find(s => s.id === activeSessionId); const next = window.prompt('세션 이름 변경', current?.title || '새 대화'); if (next && next.trim()) updateSession(activeSessionId, { title: next.trim() }); }}>이름 변경</Button>
                        <Button size="sm" variant="ghost" className="text-gray-300 hover:bg-gray-700/60 hover:text-white" onClick={() => { setMessages([]); try { saveJson(LS_MESSAGES_PREFIX + activeSessionId, []); } catch {} }}>대화 지우기</Button>
                        <Button size="sm" variant="ghost" className="text-red-400 hover:bg-red-500/10 hover:text-red-300" onClick={() => { removeSession(activeSessionId); const remain = (sessions || []).filter(s => s.id !== activeSessionId); const next = remain[0]?.id || null; setActiveSessionId(next); if (!next) setShowChatPanel(false); }}>세션 삭제</Button>
                        <Button size="sm" className="bg-green-600 hover:bg-green-700 text-white" onClick={() => setShowPublishSheet(true)} disabled={(stableMessages||[]).filter(m=>m.role==='assistant'&&m.content).length===0}>
                          공개 · 캐릭터 만들기
                        </Button>
                      </div>
                  </div>
                </div>
              )}
              <div className="pb-8">
                {(stableMessages || []).length === 0 ? (
                  <div className="text-gray-400 text-sm p-3 hidden">메시지를 입력해보세요.</div>
                ) : (
                <div>
                  {stableMessages.map((m) => {
                      const text = (m.content || '').toString();
                      const isStreaming = !!(m.streaming || m.thinking);
                      const truncated = text.length > 500 ? text.slice(0, 500) + '…' : text;
                      return (
                        <div key={m.id}>
                          <div className={`flex w-full items-start gap-3 my-4 ${m.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
                              <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 font-semibold ${m.role === 'user' ? 'bg-gray-600 text-gray-200' : 'bg-gradient-to-br from-purple-600 to-fuchsia-700 text-white/90'}`}>
                                  {m.role === 'user' ? (user ? user.username.charAt(0).toUpperCase() : 'G') : <Sparkles className="w-5 h-5" />}
                              </div>
                              {m.type === 'image' ? (
                              <img src={m.url} alt="img" className={`max-w-[65%] rounded-2xl shadow-lg`} />
                              ) : m.type === 'story_preview' ? (
                                <div className="w-full max-w-3xl bg-[#0d1117]/60 border border-gray-700 rounded-lg">
                                    <div className="px-4 py-2 border-b border-gray-700 text-xs text-gray-300 flex items-center justify-between">
                                        <span>스토리 미리보기</span>
                                    </div>
                                    <div className="p-4 text-sm text-gray-200 whitespace-pre-wrap leading-relaxed">
                                        {m.content}
                                    </div>
                                    <div className="px-4 py-2 border-t border-gray-700 flex justify-end">
                                        <Button size="sm" variant="ghost" className="text-blue-400 hover:text-blue-300" onClick={() => handleExpandCanvas(m.fullContent)}>더보기</Button>
                                    </div>
                                </div>
                              ) : (
                                <div className={`group relative max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 shadow-lg ${m.role === 'user' ? 'bg-gradient-to-br from-purple-600 to-fuchsia-700 text-white' : 'bg-gray-700/60 text-gray-100'}`}>
                                  {isStreaming ? (
                                    <div className="inline-flex items-center gap-1">
                                      <span className="inline-block w-1.5 h-1.5 rounded-full bg-current animate-bounce" style={{ animationDelay: '0ms' }} />
                                      <span className="inline-block w-1.5 h-1.5 rounded-full bg-current animate-bounce" style={{ animationDelay: '150ms' }} />
                                      <span className="inline-block w-1.5 h-1.5 rounded-full bg-current animate-bounce" style={{ animationDelay: '300ms' }} />
                                    </div>
                                  ) : (
                                    <>
                                      {truncated}
                                      {m.role === 'assistant' && !m.error && text.length >= 500 ? (
                                        <div className="mt-2">
                                          <button
                                            type="button"
                                            className="text-xs text-blue-400 hover:text-blue-300 underline"
                                            onClick={() => handleExpandCanvas()}
                                          >더보기</button>
                                        </div>
                                      ) : null}
                                      {m.role === 'assistant' && !m.error && (
                                        <div className="absolute -top-2 right-2 hidden group-hover:flex gap-1">
                                          <button
                                            type="button"
                                            className="p-1 rounded bg-gray-900/60 border border-gray-700 text-gray-300 hover:text-white"
                                            title="복사"
                                            onClick={() => { try { navigator.clipboard.writeText(text); window.dispatchEvent(new CustomEvent('toast', { detail: { type: 'success', message: '복사됨' } })); } catch {} }}
                                          >
                                            <CopyIcon className="w-3.5 h-3.5" />
                                          </button>
                                          <button
                                            type="button"
                                            className="p-1 rounded bg-gray-900/60 border border-gray-700 text-gray-300 hover:text-white"
                                            title="다시 생성"
                                            onClick={() => { try { handleGenerate(); } catch {} }}
                                          >
                                            <RotateCcw className="w-3.5 h-3.5" />
                                          </button>
                                </div>
                                      )}
                                    </>
                                  )}
                                </div>
                              )}
                          </div>
                        </div>
                      );
                    })}
                </div>
                )}
              </div>
          </div>
        )}
      </div>
    </div>
       {/* 화면 하단 고정 입력창 */}
       <div className="fixed bottom-0 left-64 right-0 bg-gradient-to-t from-gray-900 to-transparent">
           <div className="w-full max-w-4xl mx-auto p-3">
           <form onSubmit={(e) => { e.preventDefault(); (mode === 'char' || mode === 'sim') ? handleSend() : handleGenerate(); }}>
               <div className="rounded-2xl border border-gray-700 bg-[#0e1014] focus-within:border-purple-500 transition-colors p-3 shadow-2xl">
                     <Textarea
                         ref={inputRef}
                         value={prompt}
                         onChange={(e) => setPrompt(e.target.value)}
                         onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); (mode === 'char' || mode === 'sim') ? handleSend() : handleGenerate(); } }}
                         placeholder={turnLimitReached ? '20턴 제한에 도달했습니다' : '메시지를 입력하세요...'}
                         disabled={turnLimitReached}
                         className="bg-transparent border-0 focus-visible:ring-0 text-white w-full pr-12 resize-none pt-2 pb-1 pl-1"
                         rows={1}
                     />
                   <div className="mt-2 flex items-center justify-between">
                       <div className="flex items-center gap-2">
                           <button type="button" className={`px-3 py-1 rounded-full text-sm border bg-transparent transition-colors ${mode==='story' ? 'border-blue-500/70 text-blue-300 hover:bg-blue-700/20' : 'border-gray-600/60 text-gray-300 hover:bg-gray-700/40'}`} onClick={() => setMode('story')}>스토리</button>
                           <button type="button" className={`px-3 py-1 rounded-full text-sm border bg-transparent transition-colors ${mode==='char' ? 'border-emerald-500/70 text-emerald-300 hover:bg-emerald-700/20' : 'border-gray-600/60 text-gray-300 hover:bg-gray-700/40'}`} onClick={() => setMode('char')}>캐릭터챗</button>
                           <button type="button" className={`px-3 py-1 rounded-full text-sm border bg-transparent transition-colors ${mode==='sim' ? 'border-pink-500/70 text-pink-300 hover:bg-pink-700/20' : 'border-gray-600/60 text-gray-300 hover:bg-gray-700/40'}`} onClick={() => setMode('sim')}>시뮬레이터</button>
                           <button type="button" className={`px-3 py-1 rounded-full text-sm border bg-transparent transition-colors ${mode==='image' ? 'border-purple-500/70 text-purple-300 hover:bg-purple-700/20' : 'border-gray-600/60 text-gray-300 hover:bg-gray-700/40'}`} onClick={() => setMode('image')}>이미지</button>
                       </div>
                       <div className="flex items-center gap-2">
                           {mode === 'image' ? (
                           <Select value={imageModel} onValueChange={(v) => setImageModel(v)}>
                               <SelectTrigger className="h-8 px-2 w-44 bg-gray-900 border-gray-700 text-gray-200"><SelectValue placeholder="이미지 모델" /></SelectTrigger>
                               <SelectContent className="bg-gray-900 text-white border-gray-700">
                               {IMAGE_MODELS.map(m => (<SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>))}
                               </SelectContent>
                           </Select>
                           ) : (
                           <Select value={storyModel} onValueChange={(v) => setStoryModel(v)}>
                               <SelectTrigger className="h-8 px-2 w-44 bg-gray-900 border-gray-700 text-gray-200"><SelectValue placeholder="모델" /></SelectTrigger>
                               <SelectContent className="bg-gray-900 text-white border-gray-700">
                               {STORY_MODELS.map(m => (<SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>))}
                               </SelectContent>
                           </Select>
                           )}
                           <Button 
                               type="submit" 
                               disabled={!prompt || turnLimitReached} 
                               className="p-2 h-8 w-8 rounded-full bg-purple-600 text-white hover:bg-purple-700 disabled:bg-gray-600 disabled:opacity-50"
                           >
                               <Send className="h-4 w-4" />
                           </Button>
                       </div>
                   </div>
               </div>
           </form>
           </div>
       </div>
  
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
                   <div key={s.id} className={`p-2 rounded-md border cursor-pointer ${selectedStoryId === s.id ? 'bg-gray-700 border-gray-600' : 'bg-gray-900 border-gray-800'}`} onClick={() => setSelectedStoryId(s.id)}>
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
             <div className="flex justify-end gap-2">
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
             <SheetTitle className="text-white">생성된 스토리</SheetTitle>
           </SheetHeader>
           <div className="mt-4 space-y-3 pr-1 max-h-[70vh] overflow-auto">
             {loadJson(LS_STORIES, []).length === 0 ? (
               <div className="text-gray-400 text-sm">아직 생성된 스토리가 없습니다.</div>
             ) : loadJson(LS_STORIES, []).map(s => (
               <div key={s.id} className="p-2 rounded-md border bg-gray-800 border-gray-700">
                 <div className="flex items-center gap-3">
                   <div className="w-16 h-16 rounded bg-gray-900 border border-gray-700 overflow-hidden">
                     {s.coverUrl ? (<img src={s.coverUrl} alt="cover" className="w-full h-full object-cover" />) : null}
                   </div>
                   <div className="min-w-0">
                     <div className="text-white text-sm truncate">{s.title}</div>
                     <div className="text-xs text-gray-400">{relativeTime(s.createdAt)}</div>
                   </div>
                   <span className={`ml-auto text-[10px] px-2 py-0.5 rounded-full border ${s.is_public ? 'bg-blue-600 text-white border-blue-500' : 'bg-gray-900 text-gray-300 border-gray-700'}`}>{s.is_public ? '공개' : '비공개'}</span>
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
             {loadJson(LS_CHARACTERS, []).length === 0 ? (
               <div className="text-gray-400 text-sm">아직 생성된 캐릭터가 없습니다.</div>
             ) : loadJson(LS_CHARACTERS, []).map(c => (
               <div key={c.id} className="p-2 rounded-md border bg-gray-800 border-gray-700">
                 <div className="flex items-center gap-3">
                   <div className="w-16 h-16 rounded bg-gray-900 border border-gray-700 overflow-hidden">
                     {c.avatar_url ? (<img src={c.avatar_url} alt="avatar" className="w-full h-full object-cover" />) : null}
                   </div>
                   <div className="min-w-0">
                     <div className="text-white text-sm truncate">{c.name || '캐릭터'}</div>
                     <div className="text-xs text-gray-400">{relativeTime(c.createdAt)}</div>
                   </div>
                   <span className={`ml-auto text-[10px] px-2 py-0.5 rounded-full border ${c.is_public ? 'bg-blue-600 text-white border-blue-500' : 'bg-gray-900 text-gray-300 border-gray-700'}`}>{c.is_public ? '공개' : '비공개'}</span>
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
           </SheetHeader>
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
               <div className="grid grid-cols-3 gap-2 max-h-[30vh] overflow-auto pr-1">
                 {[...imageResults, ...images].map((img, idx) => (
                   <button key={img.id || `lib-${idx}`} className={`border rounded overflow-hidden ${publishAvatarUrl===img.url ? 'border-purple-500' : 'border-gray-700'}`} onClick={() => setPublishAvatarUrl(img.url)}>
                     <img src={img.url} alt="opt" className="w-full h-24 object-cover" />
                   </button>
                 ))}
               </div>
             </div>
             <div className="flex justify-end gap-2">
               <Button className="bg-gray-700 hover:bg-gray-600" onClick={() => setShowPublishSheet(false)}>취소</Button>
               <Button className="bg-green-600 hover:bg-green-700" disabled={publishing || !publishName?.trim()} onClick={handlePublishAsCharacter}>{publishing ? '게시 중…' : '게시'}</Button>
             </div>
             <div className="text-xs text-gray-500">채팅 로그를 바탕으로 기본 설명/도입부/예시 대화가 자동 구성됩니다. 저장 후 캐릭터 상세에서 수정할 सकते हैं.</div>
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
               {storyForViewer.content}
             </div>
           </div>
         </SheetContent>
       </Sheet>
     </div>
 </AppLayout>
 );
};

export default AgentPage;


