/**
 * 채팅 페이지
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import ErrorBoundary from '../components/ErrorBoundary';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useSocket } from '../contexts/SocketContext';
import { charactersAPI, chatAPI, usersAPI, origChatAPI, mediaAPI, storiesAPI } from '../lib/api'; // usersAPI 추가
import { showToastOnce } from '../lib/toastOnce';
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
  ChevronRight,
  Pin,
  PinOff,
  ListTree
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
  const [aiThinking, setAiThinking] = useState(false);
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
  const [newMessage, setNewMessage] = useState('');
  // 이미지 캐러셀 상태
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const [characterImages, setCharacterImages] = useState([]);
  const [mediaAssets, setMediaAssets] = useState([]);
  const [isPinned, setIsPinned] = useState(false);
  const [pinnedUrl, setPinnedUrl] = useState('');
  // 전역 UI 설정(로컬)
  const [uiFontSize, setUiFontSize] = useState('sm'); // sm|base|lg|xl
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
  // 원작챗 추가 설정(로직만): postprocess/next_event_len/response_length/prewarm
  const defaultChatSettings = { postprocess_mode: 'first2', next_event_len: 1, response_length_pref: 'medium', prewarm_on_start: true };
  const [chatSettings, setChatSettings] = useState(defaultChatSettings);
  const settingsSyncedRef = useRef(false);
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
  const [choiceLocked, setChoiceLocked] = useState(false);
  // 새로운 선택지가 도착하면 다시 활성화
  useEffect(() => { setChoiceLocked(false); }, [pendingChoices]);
  const [rangeWarning, setRangeWarning] = useState('');
  // 원작챗 메타(진행도/완료/모드)
  const [origMeta, setOrigMeta] = useState({ turnCount: null, maxTurns: null, completed: false, mode: null, init_stage: null, intro_ready: null });
  // 캐시 상태(warmed/warming) 폴링
  const [ctxWarmed, setCtxWarmed] = useState(null); // true|false|null
  const [ctxPollCount, setCtxPollCount] = useState(0);
  const [ctxPollingDone, setCtxPollingDone] = useState(false);
  // 원작챗 비스트리밍 스테이지 표시
  const [turnStage, setTurnStage] = useState(null); // 'generating' | 'polishing' | null
  // 상황 입력 토글/값
  const [showSituation, setShowSituation] = useState(false);
  const [situationText, setSituationText] = useState('');
  
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const chatContainerRef = useRef(null); // For scroll handling
  const prevScrollHeightRef = useRef(0); // For scroll position restoration
  const isPinnedRef = useRef(false);
  const pinnedUrlRef = useRef('');
  const genIdemKey = useCallback(() => {
    try { return `${chatRoomId || 'room'}:${Date.now()}:${Math.random().toString(36).slice(2,8)}`; } catch (_) { return `${Date.now()}`; }
  }, [chatRoomId]);
  // 완결 토스트/내레이터 중복 가드
  const completedNotifiedRef = useRef(false);
  const finalNarrationInsertedRef = useRef(false);

  const notifyCompletion = (meta) => {
    if (!chatRoomId) return;
    try {
      const key = `cc:orig:completed:${chatRoomId}`;
      const already = completedNotifiedRef.current || (localStorage.getItem(key) === '1');
      if (!already) {
        // 내레이터 말풍선 1회만 삽입
        if (!finalNarrationInsertedRef.current) {
          const narrator = {
            id: `final-narr-${Date.now()}`,
            roomId: chatRoomId,
            senderType: 'assistant',
            content: meta?.final_narration || '이 평행세계 이야기는 여기서 막을 내립니다. 계속하고 싶다면 자유 모드로 이어집니다.',
            created_at: new Date().toISOString()
          };
          setMessages(prev => [...prev, narrator]);
          finalNarrationInsertedRef.current = true;
        }
        // 토스트 1회만 표시
        const el = document.createElement('div');
        el.className = 'fixed top-3 left-1/2 -translate-x-1/2 bg-black/80 text-white px-4 py-2 rounded z-[80]';
        el.textContent = '완결되었습니다. 자유 모드로 전환합니다.';
        document.body.appendChild(el);
        setTimeout(() => { try { document.body.removeChild(el); } catch(_) {} }, 3000);
        localStorage.setItem(key, '1');
        completedNotifiedRef.current = true;
      }
    } catch (_) {}
  };

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

  // 설정 변경 적용 유틸(허용 키만 병합 + 저장 + 다음 턴 동기화 플래그)
  const updateChatSettings = useCallback((patch) => {
    try {
      const allowed = ['postprocess_mode','next_event_len','response_length_pref','prewarm_on_start'];
      const clean = Object.fromEntries(Object.entries(patch || {}).filter(([k]) => allowed.includes(k)));
      const merged = { ...defaultChatSettings, ...chatSettings, ...clean };
      // 간단 유효성
      if (!['always','first2','off'].includes(String(merged.postprocess_mode))) merged.postprocess_mode = 'first2';
      merged.next_event_len = (merged.next_event_len === 2 ? 2 : 1);
      if (!['short','medium','long'].includes(String(merged.response_length_pref))) merged.response_length_pref = 'medium';
      merged.prewarm_on_start = merged.prewarm_on_start !== false;
      setChatSettings(merged);
      localStorage.setItem('cc:chat:settings:v1', JSON.stringify(merged));
      settingsSyncedRef.current = false; // 다음 턴에 settings_patch 포함
      try { window.dispatchEvent(new CustomEvent('chat:settingsUpdated', { detail: merged })); } catch (_) {}
    } catch (_) {}
  }, [chatSettings]);

  useEffect(() => {
    // 세션 핀 상태 복원
    try {
      const raw = sessionStorage.getItem(`cc:chat:pin:v1:${characterId}`);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.url) { setIsPinned(true); setPinnedUrl(parsed.url); }
      } else { setIsPinned(false); setPinnedUrl(''); }
    } catch (_) { setIsPinned(false); setPinnedUrl(''); }

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

        // 캐릭터 기본 이미지 수집
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
          showToastOnce({ key: `ctx-warm-fail:${storyIdParam}`, type: 'warning', message: '컨텍스트 준비가 지연되고 있습니다.' });
        }

        // mediaAPI 자산 우선 적용
        try {
          const mediaRes = await mediaAPI.listAssets({ entityType: 'character', entityId: characterId, presign: false, expiresIn: 300 });
          const assets = Array.isArray(mediaRes.data?.items) ? mediaRes.data.items : (Array.isArray(mediaRes.data) ? mediaRes.data : []);
          setMediaAssets(assets);
          const urls = Array.from(new Set(assets.map(a => a.url).filter(Boolean)));
          if (urls.length) {
            setCharacterImages(urls);
            if (isPinnedRef.current && pinnedUrlRef.current) {
              const idx = urls.findIndex(u => u === pinnedUrlRef.current);
              setCurrentImageIndex(idx >= 0 ? idx : 0);
            } else {
              setCurrentImageIndex(0);
            }
          }
        } catch (_) {}

        // 2. 🔥 채팅방 정보 가져오기 또는 생성
        const params = new URLSearchParams(location.search || '');
        const explicitRoom = params.get('room');
        const forceNew = params.get('new') === '1';
        const source = params.get('source');
        const anchorParam = params.get('anchor');
        const storyIdParam = params.get('storyId');
        const modeParam = params.get('mode');
        const rangeFromParam = params.get('rangeFrom');
        const rangeToParam = params.get('rangeTo');
        const buildLastRoomKey = (uid, cid, sid) => `cc:lastRoom:${uid || 'anon'}:${cid || 'none'}:${sid || 'none'}:origchat`;
        let roomId = explicitRoom || null;
        // room 파라미터 유효성 검사
        // 수정: 파라미터를 신뢰(네트워크 일시 오류여도 유지)
        if (roomId) {
          try {
            const r = await chatAPI.getChatRoom(roomId);
            if (!(r && r.data && r.data.id)) {
              console.warn('room param looks invalid, will still try to join:', roomId);
            }
          } catch (e) {
            console.warn('room validation failed, keep roomId anyway:', roomId, e);
          }
        }

        if (!roomId) {
          if (source === 'origchat' && storyIdParam) {
            // 1) 로컬 최근 원작챗 방 시도
            try {
              const k = buildLastRoomKey(user?.id, characterId, storyIdParam);
              const saved = localStorage.getItem(k);
              if (saved) {
                const parsed = JSON.parse(saved);
                if (parsed?.roomId) {
                  try {
                    const r = await chatAPI.getChatRoom(parsed.roomId);
                    if (r?.data?.id) roomId = r.data.id;
                  } catch (_) {}
                }
              }
            } catch (_) {}
            // 2) 없으면 전용 start
            if (!roomId) {
              const a = Number(anchorParam) || 1;
              const rf = rangeFromParam ? Number(rangeFromParam) : null;
              const rt = rangeToParam ? Number(rangeToParam) : null;
              const startRes = await origChatAPI.start({ 
                story_id: storyIdParam, 
                character_id: characterId, 
                mode: (modeParam || 'canon'), 
                start: { chapter: a }, 
                range_from: rf, 
                range_to: rt, 
                pov: (modeParam === 'parallel' ? 'persona' : 'possess')
              });
              roomId = startRes.data?.id || startRes.data?.room_id || startRes.data?.room?.id || null;
              // 새 방을 만든 직후에는 최근 세션 리스트가 중복갱신되지 않도록 이벤트 브로드캐스트 지연/스킵
              try { window.dispatchEvent(new CustomEvent('chat:roomsChanged:suppressOnce')); } catch (_) {}
              if (!roomId) {
                // 최후 폴백: 일반 시작
                const roomResponse = await chatAPI.startChat(characterId);
                roomId = roomResponse.data.id;
              }
            }
          } else {
            if (forceNew) {
              const roomResponse = await chatAPI.startChat(characterId);
              roomId = roomResponse.data.id;
            } else {
              // URL에 room 파라미터가 있으면 그대로 사용, 없으면 최신 방 찾기
              if (!explicitRoom) {
                try {
                  const sessionsRes = await chatAPI.getChatSessions();
                  const sessions = Array.isArray(sessionsRes.data) ? sessionsRes.data : [];
                  const characterSessions = sessions.filter(s => String(s.character_id) === String(characterId));
                  const latest = characterSessions.sort((a, b) => {
                    const aTime = new Date(a.last_message_time || a.last_chat_time || a.updated_at || a.created_at || 0).getTime();
                    const bTime = new Date(b.last_message_time || b.last_chat_time || b.updated_at || b.created_at || 0).getTime();
                    return bTime - aTime;
                  })[0];
                  if (latest) roomId = latest.id;
                } catch (_) {}
              }
              if (!roomId) {
                const roomResponse = await chatAPI.startChat(characterId);
                roomId = roomResponse.data.id;
              }
            }
          }
        }
        
        setChatRoomId(roomId);

        // URL에 확정된 room 반영(새로고침/뒤로가기 시 심리스 복구)
        try {
          if (roomId) {
            const usp = new URLSearchParams(location.search || '');
            if (usp.get('room') !== String(roomId)) {
              usp.set('room', String(roomId));
              navigate(`${location.pathname}?${usp.toString()}`, { replace: true });
            }
          }
        } catch (_) {}
        // 원작챗이면 로컬 최근 방 저장
        try {
          if (source === 'origchat' && storyIdParam && roomId) {
            const k = buildLastRoomKey(user?.id, characterId, storyIdParam);
            localStorage.setItem(k, JSON.stringify({ roomId, updatedAt: Date.now() }));
          }
        } catch (_) {}
        // 최근 대화 리스트에서 원작챗 표시 정합성을 위해 세션 메타 힌트 브로드캐스트
        try { window.dispatchEvent(new CustomEvent('chat:opened', { detail: { characterId, source } })); } catch(_) {}

    // 원작챗 컨텍스트/메타 프리페치
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
        // 사용자 설정 로드 → 세션 시작 시 1회만 서버에 동기화
        try {
          const rawSettings = localStorage.getItem('cc:chat:settings:v1');
          if (rawSettings) {
            const parsed = JSON.parse(rawSettings);
            const s = {
              postprocess_mode: parsed.postprocess_mode || 'first2',
              next_event_len: (parsed.next_event_len === 2 ? 2 : 1),
              response_length_pref: parsed.response_length_pref || 'medium',
              prewarm_on_start: parsed.prewarm_on_start !== false,
            };
            setChatSettings(s);
            settingsSyncedRef.current = false;
          } else {
            setChatSettings(defaultChatSettings);
            settingsSyncedRef.current = false;
          }
        } catch (_) { setChatSettings(defaultChatSettings); settingsSyncedRef.current = false; }
            // 룸 메타 우선 조회(진행도/완료/모드, 앵커/범위 보정)
            try {
              if (roomId) {
                const metaRes = await chatAPI.getRoomMeta(roomId);
                const meta = metaRes?.data || {};
                const tc = Number(meta.turn_count || meta.turnCount || 0) || 0;
                const mt = Number(meta.max_turns || meta.maxTurns || 500) || 500;
                setOrigMeta({ turnCount: tc, maxTurns: mt, completed: Boolean(meta.completed), mode: meta.mode || null, narrator_mode: Boolean(meta.narrator_mode), seed_label: meta.seed_label || null, init_stage: meta.init_stage || null, intro_ready: typeof meta.intro_ready === 'boolean' ? meta.intro_ready : null });
                // 시작점/범위가 URL과 다르면 상태 보정(UI는 후순위)
                const start = meta.start || {};
                if (!anchorParam && typeof start.chapter === 'number') setOrigAnchor(Number(start.chapter) || a);
                if (!rangeFromParam && typeof meta.range_from === 'number') setOrigRangeFrom(Number(meta.range_from));
                if (!rangeToParam && typeof meta.range_to === 'number') setOrigRangeTo(Number(meta.range_to));
                // 로컬 최근 방 touch
                try {
                  const k = buildLastRoomKey(user?.id, characterId, storyIdParam);
                  localStorage.setItem(k, JSON.stringify({ roomId, updatedAt: Date.now() }));
                } catch (_) {}
              }
            } catch (_) {}
            const ctxRes = await origChatAPI.getContextPack(storyIdParam, { anchor: a, characterId, mode: (modeParam || 'canon'), rangeFrom: rf, rangeTo: rt });
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

    // 원작챗 컨텍스트 워밍 상태 폴링 (최대 5회 / 2초 간격)
    try {
      const params2 = new URLSearchParams(location.search || '');
      const source2 = params2.get('source');
      const storyId2 = params2.get('storyId');
      if (source2 === 'origchat' && storyId2) {
        let mounted = true;
        let attempts = 0;
        const poll = async () => {
          try {
            const res = await storiesAPI.getContextStatus(storyId2);
            const warmed = Boolean(res?.data?.warmed);
            if (!mounted) return;
            setCtxWarmed(warmed);
            attempts += 1;
            setCtxPollCount(attempts);
            if (!warmed && attempts < 5) {
              setTimeout(poll, 2000);
            } else {
              setCtxPollingDone(true);
            }
          } catch (_) {
            if (!mounted) return;
            setCtxWarmed(false);
          }
        };
        setCtxPollingDone(false);
        poll();
        return () => { mounted = false; };
      } else {
        setCtxWarmed(null);
        setCtxPollCount(0);
        setCtxPollingDone(false);
      }
    } catch (_) {}

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

  // 최신 핀 상태를 ref에 반영
  useEffect(() => { isPinnedRef.current = isPinned; pinnedUrlRef.current = pinnedUrl; }, [isPinned, pinnedUrl]);

  // 상세에서 미디어 변경 시 채팅방 이미지 갱신(세션 핀 유지)
  useEffect(() => {
    const onMediaUpdated = (e) => {
      try {
        const d = e?.detail || {};
        if (d.entityType === 'character' && String(d.entityId) === String(characterId)) {
          mediaAPI.listAssets({ entityType: 'character', entityId: characterId, presign: false, expiresIn: 300 }).then((res) => {
            const assets = Array.isArray(res.data?.items) ? res.data.items : (Array.isArray(res.data) ? res.data : []);
            setMediaAssets(assets);
            const urls = Array.from(new Set(assets.map(a => a.url).filter(Boolean)));
            setCharacterImages(urls);
            if (isPinnedRef.current && pinnedUrlRef.current) {
              const idx = urls.findIndex(u => u === pinnedUrlRef.current);
              setCurrentImageIndex(idx >= 0 ? idx : 0);
            } else {
              setCurrentImageIndex(0);
            }
          }).catch(()=>{});
        }
      } catch(_) {}
    };
    window.addEventListener('media:updated', onMediaUpdated);
    return () => window.removeEventListener('media:updated', onMediaUpdated);
  }, [characterId]);

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

  // ✅ 원작챗: HTTP로 메시지 로드 및 선택지 복원
  useEffect(() => {
    if (!chatRoomId) return;
    
    const loadOrigChatMessages = async () => {
      try {
              // 1. 룸 메타 먼저 로드하여 원작챗 여부 확인
        const metaRes = await chatAPI.getRoomMeta(chatRoomId);
        const meta = metaRes?.data || {};

        // ✅ 원작챗 여부 확인 및 설정
        const isOrigChatRoom = meta.mode === 'canon' || meta.mode === 'parallel';
        
        if (!isOrigChatRoom) {
          // ✅ 일반 챗이면 아무것도 안 함 (소켓이 처리)
          return;
      }
      // --- 여기서부터는 원작챗만 실행 ---
      
      // ✅ 2. 원작챗 상태 복원
      setIsOrigChat(true);
      
      setOrigMeta({
        turnCount: Number(meta.turn_count || meta.turnCount || 0) || 0,
        maxTurns: Number(meta.max_turns || meta.maxTurns || 500) || 500,
        completed: Boolean(meta.completed),
        mode: meta.mode || null,
        narrator_mode: Boolean(meta.narrator_mode),
        seed_label: meta.seed_label || null,
        init_stage: meta.init_stage || null,
        intro_ready: typeof meta.intro_ready === 'boolean' ? meta.intro_ready : null
      });
      
      // ✅ 3. 메시지 히스토리 로드 (원작챗만)
      const response = await chatAPI.getMessages(chatRoomId);
      if (response?.data && Array.isArray(response.data)) {
        setMessages(response.data);
        
        // ✅ 4. 선택지 복원 강화
        console.log('[선택지 복원] pending_choices_active:', meta.pending_choices_active);
        
        if (meta.pending_choices_active) {
          // ✅ 백엔드에 선택지 재요청 (최신 AI 메시지 기반)
          try {
            console.log('[선택지 복원] 백엔드에 요청 중...');
            const choiceResp = await origChatAPI.turn({ 
              room_id: chatRoomId, 
              trigger: 'choices', 
              idempotency_key: `restore-${Date.now()}` 
            });
            const choiceMeta = choiceResp.data?.meta || {};
            if (Array.isArray(choiceMeta.choices) && choiceMeta.choices.length > 0) {
              console.log('[선택지 복원] 성공:', choiceMeta.choices);
              setPendingChoices(choiceMeta.choices);
            } else {
              console.warn('[선택지 복원] 선택지 없음');
            }
          } catch (err) {
            console.error('[선택지 복원] 실패:', err);
          }
        } else if (Array.isArray(meta.initial_choices) && meta.initial_choices.length > 0 && response.data.length <= 1) {
          // 초기 선택지 복원 (첫 메시지만 있을 때)
          console.log('[선택지 복원] 초기 선택지 사용:', meta.initial_choices);
          setPendingChoices(meta.initial_choices);
        } else {
          console.log('[선택지 복원] 조건 불충족 - pending_active:', meta.pending_choices_active, ', initial_choices:', meta.initial_choices, ', messages:', response.data.length);
        }
      }
      
    } catch (error) {
      console.error('원작챗 상태 로드 실패:', error);
    }
  };
  
  loadOrigChatMessages();
}, [chatRoomId]); // ✅ isOrigChat 의존성 제거
  // 서버에서 인사말을 저장하므로, 클라이언트에서 별도 주입하지 않습니다.

  useEffect(() => {
    if (messages.length > 0) {
      const lastMessage = messages[messages.length - 1];
      
      // AI 메시지 완료 시
      if (lastMessage.senderType === 'assistant' && !lastMessage.isStreaming) {
        // 조건 체크
        const messageLength = (lastMessage.content || '').length;
        const hasQuestion = (lastMessage.content || '').includes('?');
        const isShort = messageLength < 50;
        
        // 연속 응답 가능성이 높은 경우만 표시
        let shouldShow = false;
        
        // 1. 짧은 응답 (더 말할 게 있을 가능성)
        if (isShort && !hasQuestion) {
          shouldShow = Math.random() < 0.3; // 30% 확률
        }
        // 2. 감정적 응답 (연속 반응 가능성)
        else if (/[!…]/.test(lastMessage.content)) {
          shouldShow = Math.random() < 0.2; // 20% 확률
        }
        // 3. 질문으로 끝나면 표시 안 함 (사용자 답변 대기)
        else if (hasQuestion) {
          shouldShow = false;
        }
        // 4. 일반적인 경우
        else {
          shouldShow = Math.random() < 0.1; // 10% 확률
        }
        
        if (shouldShow) {
          setAiThinking(true);
          setTimeout(() => {
            setAiThinking(false);
          }, 2000);
        }
      }
    }
  }, [messages, character?.name]);

  useEffect(() => {
    // 신규 메시지 수신 시 맨 아래로 스크롤
    if (messages.length > 0) {
      const lastMessage = messages[messages.length - 1];
      // 내가 보낸 메시지거나, 스트리밍이 아닌 AI 메시지일 때만 자동 스크롤
      if (!prevScrollHeightRef.current && (lastMessage.senderType === 'user' || !lastMessage.isStreaming)) {
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
    const el = chatContainerRef.current;
    if (!el) return;
    const atBottom = el.scrollTop >= el.scrollHeight - el.clientHeight - 2;
    // 맨 위 도달 시 과거 로드
    if (el.scrollTop <= 0 && hasMoreMessages && !historyLoading) {
      prevScrollHeightRef.current = el.scrollHeight;
      getMessageHistory(chatRoomId, currentPage + 1);
    }
    // 사용자가 위로 스크롤 중이면 자동 스크롤 중지(점프 방지)
    if (!atBottom) {
      if (prevScrollHeightRef.current === 0) prevScrollHeightRef.current = 1;
    } else {
      if (prevScrollHeightRef.current === 1) prevScrollHeightRef.current = 0;
    }
  }, [hasMoreMessages, historyLoading, getMessageHistory, chatRoomId, currentPage]);


  const handleSendMessage = async (e) => {
    e.preventDefault();
    // 원작챗은 소켓 연결 여부와 무관하게 HTTP로 턴을 보냄
    if (!newMessage.trim() || !chatRoomId || (!isOrigChat && !connected)) return;
    // 선택지 노출 중에는 next_event(자동진행)만 제한하고, 일반 입력은 허용(요구사항 반영 시 UI로 전환)

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
        const payload = { room_id: chatRoomId, user_text: messageContent, idempotency_key: genIdemKey(), settings_patch: (settingsSyncedRef.current ? null : chatSettings) };
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
        // 진행도 갱신 + 설정 싱크 플래그 고정
        try {
          if (chatRoomId) {
            const metaRes = await chatAPI.getRoomMeta(chatRoomId);
            const m = metaRes?.data || {};
        setOrigMeta({
              turnCount: Number(m.turn_count || m.turnCount || 0) || 0,
              maxTurns: Number(m.max_turns || m.maxTurns || 500) || 500,
              completed: Boolean(m.completed),
              mode: m.mode || null,
          narrator_mode: Boolean(m.narrator_mode),
          seed_label: m.seed_label || null,
            });
            settingsSyncedRef.current = true;
          }
        } catch (_) {}
        // 완결 토스트/내레이터 (중복 가드)
        if (meta && meta.completed && meta.turn_count && meta.max_turns && meta.turn_count >= meta.max_turns) {
          notifyCompletion(meta);
        }
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
        showToastOnce({ key: `turn-fail:${chatRoomId}`, type: 'error', message: '응답 생성에 실패했습니다.' });
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
    if (choiceLocked || origTurnLoading) return;
    setChoiceLocked(true);
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
      if (isOrigChat) setTurnStage('generating');

      const payload = { room_id: chatRoomId, choice_id: choice.id, user_text: choice.label, idempotency_key: genIdemKey(), settings_patch: null };
      setLastOrigTurnPayload(payload);
      const resp = await origChatAPI.turn(payload);
      const assistantText = resp.data?.ai_message?.content || resp.data?.assistant || '';
      if (isOrigChat && assistantText) {
        if ((chatSettings?.postprocess_mode||'first2') !== 'off') {
          setTurnStage('polishing');
          setTimeout(()=> setTurnStage(null), 300);
        } else {
          setTurnStage(null);
        }
      }
      if (isOrigChat && assistantText) {
        // 보정 모드가 켜졌다면 아주 짧게 '보정 중'을 표시(체감용)
        if ((chatSettings?.postprocess_mode||'first2') !== 'off') {
          setTurnStage('polishing');
          setTimeout(()=> setTurnStage(null), 300);
        } else {
          setTurnStage(null);
        }
      }
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
      // 진행도 갱신 + 설정 싱크 플래그 고정(선택지도 첫 턴이면 반영)
      try {
        if (chatRoomId) {
          const metaRes = await chatAPI.getRoomMeta(chatRoomId);
          const m = metaRes?.data || {};
          setOrigMeta({
            turnCount: Number(m.turn_count || m.turnCount || 0) || 0,
            maxTurns: Number(m.max_turns || m.maxTurns || 500) || 500,
            completed: Boolean(m.completed),
            mode: m.mode || null,
            narrator_mode: Boolean(m.narrator_mode),
            seed_label: m.seed_label || null,
          });
          settingsSyncedRef.current = true;
        }
      } catch (_) {}
      if (meta && meta.completed && meta.turn_count && meta.max_turns && meta.turn_count >= meta.max_turns) {
        notifyCompletion(meta);
      }
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
      setTurnStage(null);
    }
  };

  // 온디맨드: 선택지 요청(쿨다운/중복 방지는 서버/프론트 동시 가드)
  const requestChoices = useCallback(async () => {
    // ✅ isOrigChat 체크 제거 - 메타에서 확인
    if (!chatRoomId || origTurnLoading) return;
    
    try {
      setOrigTurnLoading(true);
      const resp = await origChatAPI.turn({ 
        room_id: chatRoomId, 
        trigger: 'choices', 
        idempotency_key: genIdemKey() 
      });
      const meta = resp.data?.meta || {};
      if (Array.isArray(meta.choices)) setPendingChoices(meta.choices);
      const warn = meta.warning; setRangeWarning(typeof warn === 'string' ? warn : '');
      
      // 진행도 갱신
      try {
        const metaRes = await chatAPI.getRoomMeta(chatRoomId);
        const m = metaRes?.data || {};
        setOrigMeta({
          turnCount: Number(m.turn_count || m.turnCount || 0) || 0,
          maxTurns: Number(m.max_turns || m.maxTurns || 500) || 500,
          completed: Boolean(m.completed),
          mode: m.mode || null,
          narrator_mode: Boolean(m.narrator_mode),
        });
      } catch (_) {}
    } catch (e) {
      console.error('선택지 요청 실패', e);
      showToastOnce({ key: `choices-fail:${chatRoomId}`, type: 'error', message: '선택지 요청에 실패했습니다.' });
    } finally {
      setOrigTurnLoading(false);
    }
  }, [chatRoomId, origTurnLoading, genIdemKey]); // ✅ isOrigChat 의존성 제거

  // 온디맨드: 자동 진행(next_event) — 선택지 표시 중엔 서버/프론트 모두 가드
  const requestNextEvent = useCallback(async () => {
    if (!isOrigChat || !chatRoomId || origTurnLoading) return;
    if (pendingChoices && pendingChoices.length > 0) { setRangeWarning('선택지가 표시 중입니다. 선택 처리 후 진행하세요.'); return; }
    try {
      setOrigTurnLoading(true);
      const resp = await origChatAPI.turn({ room_id: chatRoomId, trigger: 'next_event', idempotency_key: genIdemKey() });
      const assistantText = resp.data?.ai_message?.content || resp.data?.assistant || '';
      if (assistantText) {
        setMessages(prev => [...prev, {
          id: `temp-ai-${Date.now()}`,
          roomId: chatRoomId,
          senderType: 'assistant',
          content: assistantText,
          created_at: new Date().toISOString()
        }]);
      }
      const meta = resp.data?.meta || {};
      if (Array.isArray(meta.choices)) setPendingChoices(meta.choices);
      const warn = meta.warning; setRangeWarning(typeof warn === 'string' ? warn : '');
      // 진행도 갱신
      try {
        const metaRes = await chatAPI.getRoomMeta(chatRoomId);
        const m = metaRes?.data || {};
        setOrigMeta({
          turnCount: Number(m.turn_count || m.turnCount || 0) || 0,
          maxTurns: Number(m.max_turns || m.maxTurns || 500) || 500,
          completed: Boolean(m.completed),
          mode: m.mode || null,
        });
      } catch (_) {}
    } catch (e) {
      console.error('자동 진행 실패', e);
      showToastOnce({ key: `next-fail:${chatRoomId}`, type: 'error', message: '자동 진행에 실패했습니다.' });
    } finally {
      setOrigTurnLoading(false);
      setTurnStage(null);
    }
  }, [isOrigChat, chatRoomId, origTurnLoading, pendingChoices, genIdemKey]);
  
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

  const togglePin = () => {
    try {
      const key = `cc:chat:pin:v1:${characterId}`;
      if (!isPinned) {
        const url = characterImages[currentImageIndex] || '';
        setIsPinned(true);
        setPinnedUrl(url);
        sessionStorage.setItem(key, JSON.stringify({ url }));
      } else {
        setIsPinned(false);
        setPinnedUrl('');
        sessionStorage.removeItem(key);
      }
    } catch(_) {}
  };

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

  // 원작챗은 소켓 연결 없이도 전송 가능
  const canSend = Boolean(newMessage.trim()) && (isOrigChat ? true : connected);
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
                onClick={() => {
                  if (isOrigChat && origStoryId) {
                    navigate(`/stories/${origStoryId}`);
                  } else {
                    navigate(`/characters/${characterId}`);
                  }
                }}
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
                      {origMeta?.narrator_mode && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-white text-black">관전가</span>
                      )}
                      {origMeta?.mode==='parallel' && origMeta?.seed_label && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-white text-black">씨앗: {String(origMeta.seed_label).slice(0,20)}</span>
                      )}
                  {/* 진행도 배지: turn/max */}
                  {origMeta && (typeof origMeta.turnCount === 'number') && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-white text-black">{String(origMeta.turnCount)}/{String(origMeta.maxTurns || 500)}</span>
                  )}
                  {/* 캐시 상태 배지 */}
                  {ctxWarmed !== null && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-white text-black">{ctxWarmed ? 'warmed' : (ctxPollingDone ? 'warming(대기)' : 'warming')}</span>
                  )}
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
      {/* 스테이지 토스트 (우상단, 다크테마) */}
      {isOrigChat && (turnStage || (origMeta?.init_stage && origMeta.init_stage !== 'ready')) && (
        <div className="fixed top-4 right-4 z-50">
          <div className="flex items-center gap-2 bg-black/80 text-white border border-gray-700 rounded-md px-3 py-2 shadow-lg">
            <Loader2 className="w-3.5 h-3.5 animate-spin text-white" />
            <span className="text-xs">{origMeta?.init_stage && origMeta.init_stage !== 'ready' ? '초기 준비 중…' : (turnStage==='generating' ? '생성 중…' : '보정 중…')}</span>
          </div>
        </div>
      )}

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
                    aria-live="polite"
                    aria-label={`${Math.min(characterImages.length, Math.max(1, currentImageIndex + 1))} / ${characterImages.length}`}
                  />
                );
              })()}
              {/* 배경 오버레이 */}
              <div className="absolute inset-0 pointer-events-none" style={{ backgroundColor: `rgba(0,0,0,${Math.max(0, Math.min(100, uiOverlay))/100})` }} />
              {/* 이미지 핀 토글 */}
              {characterImages.length > 1 && (
                <div className="absolute top-2 right-2 z-10">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        onClick={togglePin}
                        aria-pressed={isPinned}
                        aria-label={isPinned ? '이미지 고정 해제' : '이미지 고정'}
                        className={`rounded-md p-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500 focus-visible:ring-offset-2 focus-visible:ring-offset-black/30 transition ${isPinned ? 'bg-purple-600 text-white' : 'bg-black/60 text-white hover:bg-black/70'}`}
                      >
                        {isPinned ? <Pin className="w-4 h-4" /> : <PinOff className="w-4 h-4" />}
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>{isPinned ? '고정 해제' : '이미지 고정'}</TooltipContent>
                  </Tooltip>
                </div>
              )}
              
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
              {messages.map((m, index) => {
                const isIntro = (m.message_metadata && (m.message_metadata.kind === 'intro')) || false;
                if (isIntro) {
                  return (
                    <div key={`intro-${m.id || index}`} className="mt-2 ml-12 max-w-full sm:max-w-[85%] text-left">
                      <div className="px-4 py-3 rounded-lg border bg-white/5 border-white/10 text-sm text-white whitespace-pre-wrap text-left">
                        {m.content}
                      </div>
                    </div>
                  );
                }
                return (
                  <MessageBubble
                    key={m.id || `msg-${index}`}
                    message={m}
                    isLast={index === messages.length - 1 && !aiTyping}
                  />
                );
              })}
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
                        disabled={choiceLocked}
                        className={`group w-full text-left px-4 py-2 rounded-2xl border transition
                          ${choiceLocked ? 'opacity-60 cursor-not-allowed' : 'hover:translate-y-[1px]'}
                          ${resolvedTheme==='light' ? 'bg-white border-gray-300 text-gray-900' : 'bg-white/10 border-gray-700 text-white'}`}
                      >
                        <div className="flex items-start gap-3">
                          <div className={`min-w-8 h-8 mt-0.5 flex items-center justify-center rounded-full text-xs font-semibold
                            ${resolvedTheme==='light' ? 'bg-gray-100 text-gray-800 border border-gray-300' : 'bg-white/15 text-white/90 border border-white/20'}`}>
                            •
                          </div>
                          <div className="flex-1">
                            <div className="text-sm leading-5">{c.label}</div>
                            <div className={`text-[11px] mt-0.5 ${resolvedTheme==='light' ? 'text-gray-500' : 'text-gray-400'}`}>선택하면 되돌릴 수 없습니다</div>
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {/* 완결 안내 토스트 + 내레이터 말풍선 */}
              {isOrigChat && lastOrigTurnPayload && messages.length > 0 && (() => {
                const last = messages[messages.length - 1];
                return null;
              })()}
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
              className="h-10 w-12 rounded-xl bg-white text-black px-2 leading-tight"
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
                placeholder={isOrigChat && (origMeta?.narrator_mode || origMeta?.mode==='parallel' && false) ? '서술/묘사로 입력하세요. 예) *창밖에는 비가 내리고 있었다.' : '대사를 입력하세요. 예) 반가워!'}
                className="w-full bg-transparent border-0 focus:border-0 focus:ring-0 outline-none text-sm p-0 pl-3 placeholder:text-gray-500 resize-none"
                style={{ minHeight: 36 }}
              rows={1}
            />
            </div>
            {/* AI 연속 응답 힌트 */}
            {aiThinking && (
              <div className="absolute -bottom-6 left-0 text-xs text-gray-400 flex items-center gap-1">
                <span className="inline-block w-1 h-1 bg-gray-400 rounded-full animate-pulse"></span>
                <span className="inline-block w-1 h-1 bg-gray-400 rounded-full animate-pulse" style={{ animationDelay: '0.2s' }}></span>
                <span className="inline-block w-1 h-1 bg-gray-400 rounded-full animate-pulse" style={{ animationDelay: '0.4s' }}></span>
                <span className="ml-1">{character?.name}이(가) 더 말하고 싶어하는 것 같아요</span>
              </div>
            )}
            {/* 상황 입력 필드 (토글 열림형, 원버튼 제출) */}
            {isOrigChat && showSituation && (
              <div className="absolute -top-12 left-0 right-0 flex items-center gap-2">
                <input
                  value={situationText}
                  onChange={(e)=>setSituationText(e.target.value)}
                  placeholder="상황 한 줄 (선택)"
                  className="flex-1 bg-[var(--input-bg)] text-[var(--app-fg)] border border-gray-700 rounded-lg px-3 py-2 text-sm"
                />
                <Button
                  type="button"
                  disabled={origTurnLoading || !chatRoomId}
                  onClick={async ()=>{
                    const text = (situationText||'').trim();
                    if (!text) return;
                    // 낙관적: 사용자 내레이션 말풍선
                    setMessages(prev=>[...prev, { id:`temp-user-sit-${Date.now()}`, roomId: chatRoomId, senderType:'user', content:`* ${text}`, isNarration:true, created_at:new Date().toISOString() }]);
                    try {
                      setOrigTurnLoading(true);
                      await origChatAPI.turn({ room_id: chatRoomId, situation_text: text, idempotency_key: genIdemKey() });
                      setSituationText(''); setShowSituation(false);
                    } catch (e) { console.error('상황 전송 실패', e); }
                    finally { setOrigTurnLoading(false); }
                  }}
                  className="rounded-full h-10 px-4 bg-white text-black"
                >적용</Button>
              </div>
            )}

            {/* 상황 입력 토글 버튼 */}
            {isOrigChat && (
              <Button
                type="button"
                onClick={() => setShowSituation((v)=>!v)}
                className="rounded-full w-10 h-10 p-0 flex-shrink-0 bg-white text-black"
                size="icon"
                title="상황 입력"
              >
                <Asterisk className="w-5 h-5" />
              </Button>
            )}

            {/* 애스터리스크 버튼: 입력 컨테이너 밖 (우측) */}
            <Button
              type="button"
              onClick={() => setNewMessage(prev => (prev.startsWith('*') ? prev : (`* ${prev || ''}`).trimEnd()))}
              className="rounded-full w-10 h-10 p-0 flex-shrink-0 bg-white text-black"
              size="icon"
              variant="ghost"
              title="지문/나레이션 시작"
            >
              <Asterisk className="w-5 h-5" />
            </Button>

            {/* 전송 버튼 */}
            <div className="flex items-center gap-2">
              {/* 선택지 온디맨드 */}
              {isOrigChat && (
                <Button
                  type="button"
                  disabled={origTurnLoading || (pendingChoices && pendingChoices.length > 0)}
                  onClick={requestChoices}
                  className={`rounded-full w-10 h-10 p-0 flex-shrink-0 bg-white text-black ${origTurnLoading ? 'opacity-60 cursor-not-allowed' : ''}`}
                  size="icon"
                  title="선택지 요청"
                >
                  {origTurnLoading ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    <ListTree className="w-5 h-5" />
                  )}
                </Button>
              )}

              {/* 자동 진행 >> */}
              {isOrigChat && (
                <Button
                  type="button"
                  disabled={origTurnLoading || (pendingChoices && pendingChoices.length > 0)}
                  onClick={requestNextEvent}
                  className={`rounded-full w-10 h-10 p-0 flex-shrink-0 bg-white text-black ${origTurnLoading ? 'opacity-60 cursor-not-allowed' : ''}`}
                  size="icon"
                  title=">> 자동 진행"
                >
                  <FastForward className="w-5 h-5" />
                </Button>
              )}

              {/* 전송 */}
              <Button
                type="submit"
                disabled={!canSend}
                className={`rounded-full w-10 h-10 p-0 flex-shrink-0 ${canSend ? 'bg-white text-black' : 'bg-gray-700 text-gray-400'}`}
                size="icon"
              >
                <Send className="w-5 h-5" />
              </Button>
            </div>
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
                placeholder={isOrigChat && (origMeta?.narrator_mode || origMeta?.mode==='parallel' && false) ? '서술/묘사로 입력하세요. 예) *창밖에는 비가 내리고 있었다.' : '대사를 입력하세요. 예) 반가워!'}
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
        onUpdateChatSettings={updateChatSettings}
      />
      </ErrorBoundary>

      {/* 재생성 모달 */}
      <ErrorBoundary>
      <AlertDialog open={regenOpen} onOpenChange={setRegenOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>재생성 지시사항</AlertDialogTitle>
            <AlertDialogDescription>지시사항을 입력해주세요. (예: "말투를 더 부드럽게")</AlertDialogDescription>
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
