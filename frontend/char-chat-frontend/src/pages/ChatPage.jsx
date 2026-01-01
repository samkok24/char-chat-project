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
import { getReadingProgress } from '../lib/reading';
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
  Asterisk,
  ZoomIn,
  FastForward,
  ChevronLeft,
  ChevronRight,
  Pin,
  PinOff,
  FileText
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
import { Dialog, DialogContent } from '../components/ui/dialog';
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
  
  // 채팅방 입장 시 읽음 처리
  useEffect(() => {
    if (chatRoomId) {
      chatAPI.markRoomAsRead(chatRoomId).catch(err => {
        console.error('[ChatPage] Failed to mark room as read:', err);
      });
    }
  }, [chatRoomId]);
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
  const [imageKeywords, setImageKeywords] = useState([]); // [{url, keywords:[]}] 키워드 트리거용
  const [aiMessageImages, setAiMessageImages] = useState({}); // messageId -> imageUrl (말풍선 아래 이미지)
  const [mediaAssets, setMediaAssets] = useState([]);
  const [isPinned, setIsPinned] = useState(false);
  const [pinnedUrl, setPinnedUrl] = useState('');
  // 이미지 확대 모달
  const [imageModalOpen, setImageModalOpen] = useState(false);
  const [imageModalSrc, setImageModalSrc] = useState('');
  const [imageModalIndex, setImageModalIndex] = useState(0);
  // 전역 UI 설정(로컬)
  const [uiFontSize, setUiFontSize] = useState('sm'); // sm|base|lg|xl
  const [uiLetterSpacing, setUiLetterSpacing] = useState('normal'); // tighter|tight|normal|wide|wider
  const [uiOverlay, setUiOverlay] = useState(0); // 0~100 (기본값 0: 오버레이 없음)
  const [uiFontFamily, setUiFontFamily] = useState('sans'); // sans|serif
  const [uiColors, setUiColors] = useState({
    charSpeech: '#ffffff',
    charNarration: '#cfcfcf',
    userSpeech: '#111111',
    userNarration: '#333333'
  });
  // ✅ 현재는 다크테마를 기본/고정으로 사용한다(시스템/라이트는 추후 디자인 작업 후 오픈).
  const [uiTheme, setUiTheme] = useState('dark');
  const [typingSpeed, setTypingSpeed] = useState(40);
  // 해상된 테마 상태 (light/dark)
  const [resolvedTheme, setResolvedTheme] = useState('dark');
  // 원작챗 추가 설정(로직만): postprocess/next_event_len/response_length/prewarm + temperature
  // temperature 기본값은 백엔드 ai_service의 기본값(0.7)과 정합
  const defaultChatSettings = { postprocess_mode: 'first2', next_event_len: 1, response_length_pref: 'medium', prewarm_on_start: true, temperature: 0.7 };
  const [chatSettings, setChatSettings] = useState(defaultChatSettings);
  // ✅ 설정 동기화 플래그(최소 수정/안전):
  // - true: 현재 룸 메타(서버)에 이미 반영됐다고 가정 → 이후 메시지에는 settings_patch를 굳이 보내지 않음
  // - false: 사용자가 응답 길이/temperature 등을 바꿈 → "다음 1턴"에만 settings_patch 전송
  const settingsSyncedRef = useRef(true);
  // room 기반 복원 진입 시 storyId 백필(중복 호출 방지용)
  const origStoryIdBackfillTriedRef = useRef(false);
  // 원작챗 상태
  const [isOrigChat, setIsOrigChat] = useState(false);
  const [origAnchor, setOrigAnchor] = useState(null);
  const [origStoryId, setOrigStoryId] = useState(null);
  const [origTotalChapters, setOrigTotalChapters] = useState(null);
  const [origRangeFrom, setOrigRangeFrom] = useState(null);
  const [origRangeTo, setOrigRangeTo] = useState(null);
  const [origTurnLoading, setOrigTurnLoading] = useState(false);
  const [lastOrigTurnPayload, setLastOrigTurnPayload] = useState(null);
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
  // ✅ 유저용 상태 팝업(중앙): 3초 이상 지연 시 안내 문구를 추가로 보여준다.
  const [showSlowHint, setShowSlowHint] = useState(false);
  // ✅ 초기 준비가 너무 길어지면(무한 대기 방지) 재시도/새로고침 액션 노출
  const [showInitActions, setShowInitActions] = useState(false);
  // ✅ 일반(소켓) 챗: 전송 ACK 지연(네트워크 지연) 감지 후 상태 팝업 노출
  const [socketSendDelayActive, setSocketSendDelayActive] = useState(false);
  const socketHadConnectedRef = useRef(false);
  // 상황 입력 토글/값
  const [showSituation, setShowSituation] = useState(false);
  const [situationText, setSituationText] = useState('');
  const getCarouselButtonClass = useCallback((disabled) => {
    if (resolvedTheme === 'light') {
      return disabled
        ? 'bg-gray-200 text-gray-400 border border-gray-200 cursor-not-allowed'
        : 'bg-gray-100 text-gray-900 border border-gray-200 hover:bg-gray-200';
    }
    return disabled
      ? 'bg-white/5 text-white/30 cursor-not-allowed'
      : 'bg-white/10 hover:bg-white/20 text-white';
  }, [resolvedTheme]);
  
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const chatContainerRef = useRef(null); // For scroll handling
  const prevScrollHeightRef = useRef(0); // For scroll position restoration
  const isPinnedRef = useRef(false);
  const pinnedUrlRef = useRef('');
  const autoScrollRef = useRef(true); // 사용자가 맨 아래에 있는지 추적
  const genIdemKey = useCallback(() => {
    try { return `${chatRoomId || 'room'}:${Date.now()}:${Math.random().toString(36).slice(2,8)}`; } catch (_) { return `${Date.now()}`; }
  }, [chatRoomId]);
  
  // 🎯 키워드 매칭으로 이미지 자동 전환
  const findMatchingImageByKeywords = useCallback((text) => {
    if (!text || !imageKeywords.length || isPinned) return -1;
    const lowerText = text.toLowerCase();
    for (const img of imageKeywords) {
      if (!img.keywords?.length) continue;
      for (const kw of img.keywords) {
        if (kw && lowerText.includes(kw.toLowerCase())) {
          return img.index;
        }
      }
    }
    return -1;
  }, [imageKeywords, isPinned]);

  // 🎯 AI 메시지 판별(Single Source of Truth)
  const isAssistantMessage = useCallback((msg) => {
    const type = String(msg?.sender_type || msg?.senderType || '').toLowerCase();
    // 백엔드 저장/소켓 스트리밍에서 타입이 섞일 수 있어(assistant/character/ai) 모두 AI로 취급
    return type === 'assistant' || type === 'ai' || type === 'character';
  }, []);

  // 완결 토스트/내레이터 중복 가드
  const completedNotifiedRef = useRef(false);
  const finalNarrationInsertedRef = useRef(false);

  // ✅ 소켓 연결 이력(한 번이라도 연결되었는지) 기록: "연결 중" vs "재연결 중" 문구 분기용
  useEffect(() => {
    if (connected) socketHadConnectedRef.current = true;
  }, [connected]);

  // ✅ 일반(소켓) 챗 전송 지연 감지: pending 메시지가 3초 이상 유지되면 팝업 노출
  useEffect(() => {
    // 원작챗은 소켓 전송 지연 개념이 의미 없으므로 제외
    if (isOrigChat) {
      setSocketSendDelayActive(false);
      return;
    }
    // 연결이 끊겨있으면 "재연결" 팝업이 우선이므로 전송 지연 팝업은 숨긴다.
    if (!connected) {
      setSocketSendDelayActive(false);
      return;
    }
    const hasPending = (() => {
      try {
        return Array.isArray(messages) && messages.some((m) => {
          const isUser = (m?.senderType === 'user' || m?.sender_type === 'user');
          return isUser && Boolean(m?.pending);
        });
      } catch (_) {
        return false;
      }
    })();
    if (!hasPending) {
      setSocketSendDelayActive(false);
      return;
    }
    // 3초 이상 pending이면 네트워크 지연으로 간주(유저 불안 완화)
    let cancelled = false;
    const t = setTimeout(() => {
      if (!cancelled) setSocketSendDelayActive(true);
    }, 3000);
    return () => {
      cancelled = true;
      try { clearTimeout(t); } catch (_) {}
    };
  }, [isOrigChat, connected, messages]);

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
      const allowed = ['postprocess_mode','next_event_len','response_length_pref','prewarm_on_start','temperature'];
      const clean = Object.fromEntries(Object.entries(patch || {}).filter(([k]) => allowed.includes(k)));
      const merged = { ...defaultChatSettings, ...chatSettings, ...clean };
      // 간단 유효성
      if (!['always','first2','off'].includes(String(merged.postprocess_mode))) merged.postprocess_mode = 'first2';
      merged.next_event_len = (merged.next_event_len === 2 ? 2 : 1);
      if (!['short','medium','long'].includes(String(merged.response_length_pref))) merged.response_length_pref = 'medium';
      merged.prewarm_on_start = merged.prewarm_on_start !== false;
      // temperature: 0~1, 0.1 step (방어적으로 클램핑)
      {
        const t = Number(merged.temperature);
        const clipped = Number.isFinite(t) ? Math.max(0, Math.min(1, t)) : defaultChatSettings.temperature;
        merged.temperature = Math.round(clipped * 10) / 10;
      }
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
        let baseImages = [];
        try {
          const main = data?.avatar_url ? [data.avatar_url] : [];
          const gallery = Array.isArray(data?.image_descriptions)
            ? data.image_descriptions.map((d) => d?.url).filter(Boolean)
            : [];
          const fallback = !main.length && !gallery.length && data?.thumbnail_url ? [data.thumbnail_url] : [];
          baseImages = [...main, ...gallery, ...fallback];
          
          // 🎯 키워드 트리거용 이미지 데이터 저장
          if (Array.isArray(data?.image_descriptions)) {
            setImageKeywords(data.image_descriptions.map((d, idx) => ({
              url: d?.url || '',
              keywords: Array.isArray(d?.keywords) ? d.keywords : [],
              index: main.length ? idx + 1 : idx  // avatar_url이 있으면 +1
            })));
          }
        } catch (_) {
          showToastOnce({ key: `ctx-warm-fail:${storyIdParam}`, type: 'warning', message: '컨텍스트 준비가 지연되고 있습니다.' });
        }

        // mediaAPI 자산과 병합
        try {
          const mediaRes = await mediaAPI.listAssets({ entityType: 'character', entityId: characterId, presign: false, expiresIn: 300 });
          const assets = Array.isArray(mediaRes.data?.items) ? mediaRes.data.items : (Array.isArray(mediaRes.data) ? mediaRes.data : []);
          setMediaAssets(assets);
          const mediaUrls = assets.map(a => a.url).filter(Boolean);
          // mediaAPI와 기본 이미지 병합 (중복 제거)
          const allImages = Array.from(new Set([...baseImages, ...mediaUrls]));
          if (allImages.length) {
            setCharacterImages(allImages);
            if (isPinnedRef.current && pinnedUrlRef.current) {
              const idx = allImages.findIndex(u => u === pinnedUrlRef.current);
              setCurrentImageIndex(idx >= 0 ? idx : 0);
            } else {
              setCurrentImageIndex(0);
            }
          }
        } catch (_) {
          // mediaAPI 실패 시 baseImages만 사용
          if (baseImages.length) {
            setCharacterImages(baseImages);
            setCurrentImageIndex(0);
          }
        }

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
        const modeNorm = String(modeParam || 'canon').toLowerCase();
        
        /**
         * ✅ plain 모드 앵커/게이트(표시/워밍 기준) 결정
         *
         * 의도/동작(최소 수정·최대 안전):
         * - URL에 anchor가 있으면 그 값을 우선 사용한다.
         * - plain 모드에서 anchor가 없으면, 로컬 읽기 진도(lastReadNo) = reader_progress:{storyId}를 앵커로 사용한다.
         * - 진도가 없으면(0) 1화로 폴백한다.
         *
         * 주의:
         * - 서버 메타(start.chapter)가 과거 값(예: 1)이어도, plain 모드에서는 "현재 진도"가 우선이다.
         */
        const effectiveAnchor = (() => {
          try {
            const q = Number(anchorParam);
            if (Number.isFinite(q) && q >= 1) return Math.floor(q);
          } catch (_) {}
          try {
            if (modeNorm === 'plain' && storyIdParam) {
              const p = Number(getReadingProgress(storyIdParam) || 0);
              if (Number.isFinite(p) && p >= 1) return Math.floor(p);
            }
          } catch (e) {
            console.warn('[ChatPage] plain anchor resolve failed (reading progress)', e);
          }
          return 1;
        })();
        const buildLastRoomKey = (uid, cid, sid) => `cc:lastRoom:${uid || 'anon'}:${cid || 'none'}:${sid || 'none'}:origchat`;
        const buildNewGuardKey = (cid, sid) => `cc:newGuard:${cid || 'none'}:${sid || 'none'}`;
        // 새 방 생성 with retry 유틸
        const startChatWithRetry = async (fn, label = 'chat') => {
          let attempts = 0;
          let lastErr = null;
          while (attempts < 2) {
            try {
              return await fn();
            } catch (err) {
              lastErr = err;
              attempts += 1;
            }
          }
          console.error(`${label} start failed after retries`, lastErr);
          throw lastErr || new Error('start_failed');
        };

        let roomId = explicitRoom || null;
        // room 파라미터 유효성 검사 -> 실패 시 무효화하고 새 방 생성으로 폴백
        if (roomId) {
          try {
            const r = await chatAPI.getChatRoom(roomId);
            if (!(r && r.data && r.data.id)) {
              console.warn('room param looks invalid, will fallback to new room:', roomId);
              roomId = null;
            }
          } catch (e) {
            console.warn('room validation failed, will fallback to new room:', roomId, e);
            roomId = null;
          }
        }

        /**
         * ✅ 원작챗 진입 안전장치
         *
         * 문제:
         * - URL에 source=origchat&storyId가 붙었는데, room 파라미터가 "일반챗 방"이면
         *   ChatPage가 origchat 컨텍스트 프리페치를 시도하면서 상태가 꼬일 수 있다.
         *
         * 해결:
         * - origchat 컨텍스트로 들어온 경우, room은 반드시 origchat room(meta.mode 존재)이어야 한다.
         * - 그렇지 않으면 room을 무효화하고, 아래 origchat start 로직으로 폴백한다.
         */
        if (roomId && source === 'origchat' && storyIdParam) {
          try {
            const metaRes = await chatAPI.getRoomMeta(roomId);
            const meta = metaRes?.data || {};
            const raw = String(meta.mode || '').toLowerCase();
            const isOrigChatRoom = raw === 'canon' || raw === 'parallel' || raw === 'plain';
            if (!isOrigChatRoom) {
              console.warn('[ChatPage] origchat source지만 room meta가 origchat이 아님 → room 무효화:', { roomId, meta });
              roomId = null;
            }
          } catch (e) {
            console.warn('[ChatPage] origchat source지만 room meta 조회 실패 → room 무효화:', { roomId, error: e });
            roomId = null;
          }
        }

        if (!roomId) {
          if (source === 'origchat' && storyIdParam) {
            // 1) 로컬 최근 원작챗 방 시도
            // - "새 대화(new=1)" 의도라면 절대 재사용하지 않고 새 방을 만든다.
            if (!forceNew) {
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
            }
            // 2) 없으면 전용 start
            if (!roomId) {
              const a = effectiveAnchor;
              const rf = rangeFromParam ? Number(rangeFromParam) : null;
              const rt = rangeToParam ? Number(rangeToParam) : null;
              const startFn = async () => {
              const startRes = await origChatAPI.start({ 
                story_id: storyIdParam, 
                character_id: characterId, 
                mode: (modeParam || 'canon'), 
                // ✅ new=1(새로 대화)일 때는 백엔드가 기존 plain 방을 재사용하지 않도록 강제한다.
                force_new: !!forceNew,
                start: { chapter: a }, 
                range_from: rf, 
                range_to: rt, 
                pov: (modeParam === 'parallel' ? 'persona' : 'possess')
              });
                return startRes.data?.id || startRes.data?.room_id || startRes.data?.room?.id || null;
              };
              roomId = await startChatWithRetry(startFn, 'origchat');
              // 새 방을 만든 직후에는 최근 세션 리스트가 중복갱신되지 않도록 이벤트 브로드캐스트 지연/스킵
              try { window.dispatchEvent(new CustomEvent('chat:roomsChanged:suppressOnce')); } catch (_) {}
              if (!roomId) {
                // 최후 폴백: 일반 시작
                const roomResponse = await startChatWithRetry(() => chatAPI.startChat(characterId), 'chat');
                roomId = roomResponse.data.id;
              }
            }
          } else {
            if (forceNew) {
              // 중복 방 방지: 같은 세션(new=1)에서 이미 만든 방이 있으면 재사용
              const guardKey = buildNewGuardKey(characterId, null);
              let reused = false;
              try {
                const saved = sessionStorage.getItem(guardKey);
                if (saved) {
                  const parsed = JSON.parse(saved);
                  if (parsed?.roomId) {
                    try {
                      const r = await chatAPI.getChatRoom(parsed.roomId);
                      if (r?.data?.id) {
                        roomId = parsed.roomId;
                        reused = true;
                      }
                    } catch (_) { /* ignore */ }
                  }
                }
              } catch (_) {}

              if (!reused) {
                // ✅ 새 대화는 반드시 새 방 생성 (/chat/start-new)
                const roomResponse = await startChatWithRetry(() => chatAPI.startNewChat(characterId), 'chat-new');
                roomId = roomResponse.data.id;
                try { sessionStorage.setItem(guardKey, JSON.stringify({ roomId, ts: Date.now() })); } catch (_) {}
              }
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
                const roomResponse = await startChatWithRetry(() => chatAPI.startChat(characterId), 'chat');
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
            const a = effectiveAnchor;
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
              // temperature: 0~1, 0.1 step
              temperature: (() => {
                const t = Number(parsed.temperature);
                const clipped = Number.isFinite(t) ? Math.max(0, Math.min(1, t)) : 0.7;
                return Math.round(clipped * 10) / 10;
              })(),
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
                // ✅ plain 모드는 "현재 진도(lastReadNo)"가 우선이므로, 서버 start.chapter로 덮어쓰지 않는다.
                if (!anchorParam && modeNorm !== 'plain' && typeof start.chapter === 'number') setOrigAnchor(Number(start.chapter) || a);
                if (!rangeFromParam && typeof meta.range_from === 'number') setOrigRangeFrom(Number(meta.range_from));
                if (!rangeToParam && typeof meta.range_to === 'number') setOrigRangeTo(Number(meta.range_to));
                // 로컬 최근 방 touch
                try {
                  const k = buildLastRoomKey(user?.id, characterId, storyIdParam);
                  localStorage.setItem(k, JSON.stringify({ roomId, updatedAt: Date.now() }));
                } catch (_) {}
              }
            } catch (_) {}
            /**
             * ✅ 토큰/워밍 낭비 방지:
             * - continue(이어하기) 진입에서는 컨텍스트 팩 호출을 스킵한다.
             *   (backend /stories/:id/context-pack 이 백그라운드로 LLM 요약/스타일 준비까지 트리거할 수 있음)
             * - new=1(새로 대화)일 때만 컨텍스트 팩을 호출해서 워밍을 시작한다.
             */
            if (forceNew) {
              const ctxRes = await origChatAPI.getContextPack(storyIdParam, { anchor: a, characterId, mode: (modeParam || 'canon'), rangeFrom: rf, rangeTo: rt });
              const director = ctxRes.data?.director_context || {};
              if (typeof director.total_chapters === 'number') setOrigTotalChapters(director.total_chapters);
            }
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
      const isNewEntry = params2.get('new') === '1';
      // ✅ continue 진입에서는 워밍 상태 폴링 자체를 하지 않는다(UX/토큰 낭비 방지)
      if (source2 === 'origchat' && storyId2 && isNewEntry) {
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
        // ✅ 테마는 현재 다크로 고정(레거시 저장값: system/light → dark로 클램핑)
        if (parsed.theme) {
          const t = String(parsed.theme || '').trim().toLowerCase();
          setUiTheme(t === 'dark' ? 'dark' : 'dark');
        }
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
        // ✅ 테마는 현재 다크로 고정(시스템/라이트 비활성화)
        if (d.theme) setUiTheme('dark');
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

  // 🎯 AI 메시지 도착 시 키워드 매칭으로 이미지 자동 전환 + 말풍선 아래 이미지 저장
  useEffect(() => {
    if (!messages.length || !characterImages.length) return;
    const lastMsg = messages[messages.length - 1];
    // AI 메시지인 경우만 매칭
    if (!isAssistantMessage(lastMsg)) return;

    const msgId = lastMsg.id || lastMsg._id || `temp-${messages.length}`;
    
    // 이미 처리된 메시지면 스킵
    if (aiMessageImages[msgId]) return;

    const content = lastMsg?.content || '';
    
    // 1) suggested_image_index 우선 (백엔드에서 내려준 값)
    let idx = lastMsg?.meta?.suggested_image_index ?? lastMsg?.suggested_image_index ?? -1;
    
    // 2) 백엔드 값이 없으면 프론트 키워드 매칭
    if (idx < 0 && !isPinned) {
      idx = findMatchingImageByKeywords(content);
    }
    
    // 3) 첫 AI 메시지(인사말)는 무조건 0번 이미지
    const aiMsgCount = messages.filter((m) => isAssistantMessage(m)).length;
    if (idx < 0 && aiMsgCount === 1) {
      idx = 0;
    }

    // 유효한 인덱스면 처리
    if (idx >= 0 && idx < characterImages.length) {
      const imageUrl = characterImages[idx];
      const resolvedUrl = resolveImageUrl(imageUrl);
      
      // 말풍선 아래 이미지 저장
      setAiMessageImages(prev => ({ ...prev, [msgId]: resolvedUrl }));
      
      // 미니갤러리 포커싱 (핀 안 된 경우만)
      if (!isPinned) {
        setCurrentImageIndex(idx);
      }
    }
  }, [messages, characterImages, isPinned, findMatchingImageByKeywords, aiMessageImages, isAssistantMessage]);

  // 상세에서 미디어 변경 시 채팅방 이미지 갱신(세션 핀 유지)
  useEffect(() => {
    const onMediaUpdated = (e) => {
      try {
        const d = e?.detail || {};
        if (d.entityType === 'character' && String(d.entityId) === String(characterId)) {
          // 캐릭터 기본 정보 다시 로드
          Promise.all([
            charactersAPI.getCharacter(characterId),
            mediaAPI.listAssets({ entityType: 'character', entityId: characterId, presign: false, expiresIn: 300 })
          ]).then(([charRes, mediaRes]) => {
            const charData = charRes.data;
            // 기본 이미지
            const main = charData?.avatar_url ? [charData.avatar_url] : [];
            const gallery = Array.isArray(charData?.image_descriptions)
              ? charData.image_descriptions.map((d) => d?.url).filter(Boolean)
              : [];
            const baseImages = [...main, ...gallery];
            
            // mediaAPI 이미지
            const assets = Array.isArray(mediaRes.data?.items) ? mediaRes.data.items : (Array.isArray(mediaRes.data) ? mediaRes.data : []);
            setMediaAssets(assets);
            const mediaUrls = assets.map(a => a.url).filter(Boolean);
            
            // 병합
            const allImages = Array.from(new Set([...baseImages, ...mediaUrls]));
            if (allImages.length) {
              setCharacterImages(allImages);
            if (isPinnedRef.current && pinnedUrlRef.current) {
                const idx = allImages.findIndex(u => u === pinnedUrlRef.current);
              setCurrentImageIndex(idx >= 0 ? idx : 0);
            } else {
              setCurrentImageIndex(0);
              }
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

        // ✅ 원작챗 여부 확인 및 설정 (plain 모드도 포함)
        const isOrigChatRoom = meta.mode === 'canon' || meta.mode === 'parallel' || meta.mode === 'plain';
        
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
      let response = await chatAPI.getMessages(chatRoomId);
      let messages = Array.isArray(response?.data) ? response.data : [];
      
      // ✅ plain 모드일 때 인사말이 백그라운드에서 생성되므로 폴링
      if (meta.mode === 'plain' && messages.length === 0) {
        // 인사말이 생성될 때까지 최대 10초 대기
        for (let i = 0; i < 20; i++) {
          await new Promise(resolve => setTimeout(resolve, 500));
          response = await chatAPI.getMessages(chatRoomId);
          messages = Array.isArray(response?.data) ? response.data : [];
          if (messages.length > 0) break;
        }
      }
      
      if (messages.length > 0) {
        setMessages(messages);
        
        // ✅ plain 모드는 선택지 메타를 내려주지 않으므로(의도), 복원 로직도 스킵한다.
        if (meta.mode !== 'plain') {
          if (meta.pending_choices_active) {
            // 백엔드에 선택지 재요청 (최신 AI 메시지 기반)
            try {
              const choiceResp = await origChatAPI.turn({
                room_id: chatRoomId,
                trigger: 'choices',
                idempotency_key: `restore-${Date.now()}`
              });
              const choiceMeta = choiceResp.data?.meta || {};
              if (Array.isArray(choiceMeta.choices) && choiceMeta.choices.length > 0) {
                setPendingChoices(choiceMeta.choices);
              }
            } catch (_) {}
          } else if (Array.isArray(meta.initial_choices) && meta.initial_choices.length > 0 && messages.length <= 1) {
            // 초기 선택지 복원 (첫 메시지만 있을 때)
            setPendingChoices(meta.initial_choices);
          }
        }

        // ✅ 인사말이 존재(assistant 메시지)하면, 준비 상태가 늦게 갱신되더라도 UI는 즉시 ready로 본다.
        // (plain 모드에서 init_stage/intro_ready가 누락/지연될 때 '무한 준비중'을 방지)
        try {
          const hasAssistant = messages.some((m) => String(m?.senderType || '').toLowerCase() === 'assistant');
          if (hasAssistant) {
            setOrigMeta((prev) => ({ ...(prev || {}), init_stage: 'ready', intro_ready: true }));
          }
        } catch (_) {}
      }
      
    } catch (error) {
      console.error('원작챗 상태 로드 실패:', error);
    }
  };
  
  loadOrigChatMessages();
}, [chatRoomId]); // ✅ isOrigChat 의존성 제거
  // 서버에서 인사말을 저장하므로, 클라이언트에서 별도 주입하지 않습니다.

  // ✅ 원작챗을 room 기반으로 복원 진입한 경우(= URL에 storyId/source가 없을 수 있음) storyId를 가능한 범위에서 보강한다.
  useEffect(() => {
    if (!isOrigChat || origStoryId) return;

    // 1) 캐릭터 정보에 origin_story_id가 있으면 즉시 백필
    const fromChar = character?.origin_story_id || null;
    if (fromChar) {
      setOrigStoryId(fromChar);
      return;
    }

    // 2) 캐릭터 정보에 없으면 room 상세에서 역추출(원작챗 턴 자체는 room_id로 동작하지만, 원작 보기 링크 등에 필요)
    if (!chatRoomId || origStoryIdBackfillTriedRef.current) return;
    origStoryIdBackfillTriedRef.current = true;

    let mounted = true;
    (async () => {
      try {
        const roomRes = await chatAPI.getChatRoom(chatRoomId);
        const sid = roomRes?.data?.character?.origin_story_id || null;
        if (!mounted) return;
        if (sid) setOrigStoryId(sid);
      } catch (e) {
        console.warn('[ChatPage] origStoryId backfill failed:', e);
      }
    })();

    return () => { mounted = false; };
  }, [isOrigChat, origStoryId, character?.origin_story_id, chatRoomId]);

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
      if (autoScrollRef.current) {
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
    autoScrollRef.current = atBottom;
    // 맨 위 도달 시 과거 로드
    if (el.scrollTop <= 0 && hasMoreMessages && !historyLoading) {
      prevScrollHeightRef.current = el.scrollHeight;
      getMessageHistory(chatRoomId, currentPage + 1);
    }


  }, [hasMoreMessages, historyLoading, getMessageHistory, chatRoomId, currentPage]);


  const handleSendMessage = async (e) => {
    e.preventDefault();
    // 원작챗은 소켓 연결 여부와 무관하게 HTTP로 턴을 보냄
    if (!newMessage.trim() || !chatRoomId || (!isOrigChat && !connected)) return;
    // 방어적: 원작챗은 한 턴씩 순차 처리(중복 전송/경합 방지)
    if (isOrigChat && origTurnLoading) {
      showToastOnce({ key: `orig-busy:${chatRoomId}`, type: 'info', message: '응답 생성 중입니다. 잠시만 기다려 주세요.' });
      return;
    }
    // 선택지 노출 중에는 next_event(자동진행)만 제한하고, 일반 입력은 허용(요구사항 반영 시 UI로 전환)

    const messageContentRaw = newMessage.trim();
    // ✅ 나레이션은 "* " (별표+공백/개행)으로만 판별: "**" 또는 "*abc*" 같은 인라인 강조로 말풍선 전체가 이탤릭 되는 오작동 방지
    const isNarration = /^\*\s/.test(messageContentRaw);
    const messageContent = isNarration ? messageContentRaw.replace(/^\*\s*/, '') : messageContentRaw;
    const messageType = isNarration ? 'narration' : 'text';
    
    // 원작챗이면 HTTP 턴 호출, 아니면 소켓 전송
    if (isOrigChat) {
      // Optimistic UI Update for user message (원작챗)
    const tempUserMessage = {
      id: `temp-user-${Date.now()}`,
      roomId: chatRoomId,
      senderType: 'user',
      senderId: user.id,
      // ✅ 원작챗은 나레이션/대사 구분을 모델이 직접 볼 수 있도록 원문을 보낸다(크롭/가공 최소화)
      content: messageContentRaw,
      isNarration: isNarration,
      created_at: new Date().toISOString()
    };
    setMessages(prev => [...prev, tempUserMessage]);
      try {
        setOrigTurnLoading(true);
        const payload = { room_id: chatRoomId, user_text: messageContentRaw, idempotency_key: genIdemKey(), settings_patch: (settingsSyncedRef.current ? null : chatSettings) };
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
      // Send message via socket (낙관적 추가 + ack 기반 롤백)
      const tempId = `temp-user-${Date.now()}`;
      const tempUserMessage = {
        id: tempId,
        roomId: chatRoomId,
        senderType: 'user',
        senderId: user.id,
        content: messageContent,
        isNarration: isNarration,
        created_at: new Date().toISOString(),
        pending: true,
      };
      setMessages(prev => [...prev, tempUserMessage]);
      setNewMessage('');
      if (inputRef.current) {
        inputRef.current.style.height = 'auto';
      }
      try {
        // ✅ 일반 챗도 settings_patch를 "변경 직후 1회"만 전송 → 이후 메시지는 룸 메타를 사용
        // (응답 길이/temperature를 한번 바꾸면 계속 적용되도록)
        await sendSocketMessage(
          chatRoomId,
          messageContent,
          messageType,
          { settingsPatch: (settingsSyncedRef.current ? null : chatSettings) }
        );
        settingsSyncedRef.current = true;
        setMessages(prev => prev.map(m => m.id === tempId ? { ...m, pending: false } : m));
      } catch (err) {
        console.error('소켓 전송 실패', err);
        setMessages(prev => prev.filter(m => m.id !== tempId));
        showToastOnce({ key: `socket-send-fail:${chatRoomId}`, type: 'error', message: '전송에 실패했습니다. 다시 시도해주세요.' });
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
      // ✅ "계속" 버튼에서도 응답 길이/온도 변경을 즉시 반영:
      // - 변경 직후 1회만 settings_patch를 보내 룸 메타(Redis)에 저장하고,
      // - 이후 next_event는 메타 값을 계속 사용한다.
      const resp = await origChatAPI.turn({
        room_id: chatRoomId,
        trigger: 'next_event',
        idempotency_key: genIdemKey(),
        settings_patch: (settingsSyncedRef.current ? null : chatSettings),
      });
      settingsSyncedRef.current = true;
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
  }, [isOrigChat, chatRoomId, origTurnLoading, pendingChoices, genIdemKey, chatSettings]);
  
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
  // ✅ 원작챗 생성 중에는 입력/전송을 UI에서도 잠가, "눌렀는데 왜 안 보내져?" 혼란을 방지한다.
  const isOrigBusy = Boolean(isOrigChat && origTurnLoading);
  // ✅ 원작챗은 HTTP 호출이므로, 소켓의 aiTyping 대신 origTurnLoading을 타이핑 상태로 취급한다.
  const aiTypingEffective = Boolean(aiTyping || (isOrigChat && origTurnLoading));
  const textSizeClass = uiFontSize==='sm' ? 'text-sm' : uiFontSize==='lg' ? 'text-lg' : uiFontSize==='xl' ? 'text-xl' : 'text-base';

  /**
   * 모바일/모달에서 사용할 "오너 등록 이미지" 리스트를 정규화한다.
   *
   * 의도/동작:
   * - PC(lg+)는 좌측 패널에서 이미지를 보여주지만, 모바일에서는 몰입형 배경으로 승격한다.
   * - 이미지가 0개일 때도 1장의 대표 이미지(primary)가 있으면 fallback으로 사용한다.
   * - pin 상태일 때는 pinnedUrl을 우선 적용한다.
   */
  const primaryPortrait = getCharacterPrimaryImage(character);
  const portraitImages = (Array.isArray(characterImages) && characterImages.length > 0)
    ? characterImages
    : (primaryPortrait ? [primaryPortrait] : []);
  const pinnedIndex = (isPinned && pinnedUrl)
    ? portraitImages.findIndex((u) => u === pinnedUrl)
    : -1;
  const effectiveActiveIndex = pinnedIndex >= 0 ? pinnedIndex : currentImageIndex;
  const currentPortraitUrl = (isPinned && pinnedUrl)
    ? pinnedUrl
    : (portraitImages[currentImageIndex] || portraitImages[0] || primaryPortrait || '');
  // 모바일은 기본적으로 최소한의 딤을 강제해(경쟁사처럼 이미지 위에서도 글자가 읽히게), 사용자가 uiOverlay를 올리면 그 값이 우선한다.
  const mobileStageOverlayAlpha = Math.max(0.35, Math.min(0.85, (Number(uiOverlay) || 0) / 100));
  
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
  
  const MessageBubble = ({ message, isLast, triggerImageUrl }) => {
    const isUser = message.senderType === 'user' || message.sender_type === 'user';
    const rawContent = typeof message.content === 'string' ? message.content : '';
    const isNarrationMessage = (() => {
      try {
        if (Boolean(message.isNarration) || message.messageType === 'narration') return true;
        const trimmedStart = rawContent.replace(/^\s+/, '');
        // ✅ "* " 또는 "*\n" 처럼 별표 다음에 공백/개행이 올 때만 '나레이션 메시지'로 취급
        return /^\*\s/.test(trimmedStart);
      } catch (_) {
        return false;
      }
    })();
    const displayText = isUser
      ? (message.isNarration ? (rawContent.startsWith('*') ? rawContent : `* ${rawContent}`) : rawContent)
      : sanitizeAiText(rawContent);
    const bubbleRef = isLast ? messagesEndRef : null;

    /**
     * 인라인 이탤릭 렌더러
     *
     * 의도/동작:
     * - 하나의 말풍선 안에서 `*...*`로 감싼 "일부 구간"만 이탤릭 처리한다.
     * - 말풍선 전체 이탤릭은 `isNarrationMessage`(나레이션 메시지)일 때만 적용한다.
     *
     * 규칙(방어적):
     * - 단일 별표(*)만 토큰으로 취급한다. (`**`는 토큰으로 보지 않음 → 전체 이탤릭 오작동 방지)
     * - 닫히지 않은 `*`는 문자 그대로 출력한다.
     */
    const renderInlineItalics = (text) => {
      const s = String(text ?? '');
      if (!s.includes('*')) return s;
      const out = [];
      let cursor = 0;
      let key = 0;
      const isSingleStarAt = (idx) => {
        if (s[idx] !== '*') return false;
        const prev = idx > 0 ? s[idx - 1] : '';
        const next = idx + 1 < s.length ? s[idx + 1] : '';
        // '**'는 토큰으로 취급하지 않음
        if (prev === '*' || next === '*') return false;
        return true;
      };
      for (let i = 0; i < s.length; i += 1) {
        if (!isSingleStarAt(i)) continue;
        // closing '*' 탐색
        let j = i + 1;
        for (; j < s.length; j += 1) {
          if (isSingleStarAt(j)) break;
        }
        if (j >= s.length) continue; // 닫힘이 없으면 문자 그대로
        if (i > cursor) out.push(s.slice(cursor, i));
        const inner = s.slice(i + 1, j);
        // 빈 구간(* *)은 그대로 통과(별표 제거로 인한 이상 표시 방지)
        if (inner.length === 0) {
          out.push('*');
          cursor = i + 1;
          continue;
        }
        out.push(<span key={`it-${key++}-${i}`} className="italic">{inner}</span>);
        cursor = j + 1;
        i = j;
      }
      if (cursor < s.length) out.push(s.slice(cursor));
      return out.length ? out : s;
    };
    
    /**
     * 인라인 이탤릭 토큰 페어 존재 여부
     *
     * 의도/동작:
     * - 메시지에 `*...*`(단일 별표 페어)가 존재하면 "부분 이탤릭"으로 충분하므로,
     *   말풍선 전체 이탤릭(나레이션 메시지 스타일)을 적용하지 않게 하기 위한 가드다.
     * - `**`는 토큰으로 보지 않는다(오작동 방지).
     */
    const hasInlineItalicPair = (text) => {
      const s = String(text ?? '');
      if (!s.includes('*')) return false;
      const isSingleStarAt = (idx) => {
        if (s[idx] !== '*') return false;
        const prev = idx > 0 ? s[idx - 1] : '';
        const next = idx + 1 < s.length ? s[idx + 1] : '';
        if (prev === '*' || next === '*') return false;
        return true;
      };
      for (let i = 0; i < s.length; i += 1) {
        if (!isSingleStarAt(i)) continue;
        for (let j = i + 1; j < s.length; j += 1) {
          if (isSingleStarAt(j)) return true;
        }
      }
      return false;
    };
    const shouldApplyNarrationBubbleStyle = Boolean(isNarrationMessage && !hasInlineItalicPair(displayText));

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
          className={`relative max-w-full sm:max-w-[85%] px-3 py-2 rounded-2xl shadow-md overflow-hidden ${isUser ? 'rounded-tr-none' : 'rounded-tl-none'}
            ${isUser
              ? (resolvedTheme === 'light' ? 'bg-white border border-gray-300' : 'bg-white text-black')
              : (resolvedTheme === 'light' ? 'bg-white border border-gray-300' : 'bg-white/10 lg:bg-white/10')}
          `}
          style={{ color: isUser
            ? (resolvedTheme === 'light' ? '#111827' : (message.isNarration ? uiColors.userNarration : uiColors.userSpeech))
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
              <p
                className="whitespace-pre-wrap break-words select-text"
                style={{
                  wordBreak: 'break-word',
                  overflowWrap: 'break-word',
                  hyphens: 'auto',
                  ...(shouldApplyNarrationBubbleStyle
                    ? { color: resolvedTheme === 'light' ? '#6b7280' : '#d1d5db', fontStyle: 'italic' }
                    : {})
                }}
              >
                {renderInlineItalics(displayText)}
            {message.isStreaming && <span className="streaming-cursor"></span>}
          </p>
              <p className={`text-xs mt-1 text-right ${isUser ? 'text-gray-500' : 'text-gray-400'}`}>
            {new Date(message.created_at || message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </p>
              {/* 툴바는 말풍선 바깥으로 이동 (아래에서 렌더) */}
            </>
          )}
        </div>

        {/* 🎯 AI 말풍선 아래 트리거 이미지 */}
        {!isUser && triggerImageUrl && (
          <div className="mt-2 max-w-full sm:max-w-[85%] rounded-xl overflow-hidden">
            <img 
              src={triggerImageUrl} 
              alt="" 
              className="w-full max-h-80 object-cover rounded-xl cursor-zoom-in"
              onClick={() => {
                setImageViewerSrc(triggerImageUrl);
                setImageViewerOpen(true);
              }}
            />
          </div>
        )}

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
                    <button
                      onClick={() => {
                        // ✅ 원작챗은 소켓 continue가 아니라 HTTP next_event가 맞다.
                        if (isOrigChat) requestNextEvent();
                        else sendSocketMessage(chatRoomId, '', 'continue', { settingsPatch: (settingsSyncedRef.current ? null : chatSettings) });
                      }}
                      className="p-1.5 rounded hover:bg-[var(--hover-bg)] text-[var(--app-fg)]"
                    >
                      <FastForward className="w-4 h-4"/>
                    </button>
                  </TooltipTrigger><TooltipContent>계속</TooltipContent></Tooltip>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    );
  };

  // ✅ 상태 표시(유저용): 한 눈에 보이게 중앙 팝업으로 통일 (원작챗/일반챗 공통)
  // 원작챗 준비 오버레이는 "첫 메시지(인사말) 도착 전"에만 전체 입력을 막는다.
  // - plain 모드는 백그라운드에서 인사말이 생성되며, meta(intro_ready/init_stage)가 늦게 갱신되거나 누락될 수 있다.
  // - 따라서 메시지가 1개라도 있으면(특히 assistant 인사말) 오버레이를 강제로 해제해 '무한 준비중' UX를 방지한다.
  const hasAnyMessages = Boolean(Array.isArray(messages) && messages.length > 0);
  const isInitOverlayActive = Boolean(
    loading ||
    (
      isOrigChat &&
      !hasAnyMessages &&
      (
        (origMeta?.init_stage && origMeta.init_stage !== 'ready') ||
        (origMeta?.intro_ready === false)
      )
    )
  );
  const isOrigTurnPopupActive = Boolean(isOrigChat && (turnStage === 'generating' || turnStage === 'polishing'));
  const isSocketDisconnectedPopupActive = Boolean(!isOrigChat && chatRoomId && !connected);
  const isSocketSendDelayPopupActive = Boolean(!isOrigChat && chatRoomId && connected && socketSendDelayActive);
  const isStatusPopupActive = Boolean(
    isInitOverlayActive ||
    isOrigTurnPopupActive ||
    isSocketDisconnectedPopupActive ||
    isSocketSendDelayPopupActive
  );

  useEffect(() => {
    if (!isStatusPopupActive) {
      setShowSlowHint(false);
      return;
    }
    setShowSlowHint(false);
    const t = setTimeout(() => setShowSlowHint(true), 3000);
    return () => { try { clearTimeout(t); } catch (_) {} };
  }, [isStatusPopupActive]);

  useEffect(() => {
    if (!isInitOverlayActive) {
      setShowInitActions(false);
      return;
    }
    setShowInitActions(false);
    // 12초 이상이면 유저가 직접 액션을 취할 수 있게 한다.
    const t = setTimeout(() => setShowInitActions(true), 12000);
    return () => { try { clearTimeout(t); } catch (_) {} };
  }, [isInitOverlayActive]);

  // ⚠️ React Hooks 규칙:
  // - 아래의 로딩/에러 화면은 "조건부 return"이지만, Hook 호출 이후에만 return 해야 한다.
  // - 그렇지 않으면 렌더마다 Hook 개수가 달라져(=Rendered more hooks...) 화면이 하얗게 깨진다.
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

  const statusPopup = (() => {
    // 우선순위: 초기 준비(입력 차단) > (일반챗) 네트워크 > (원작챗) 생성/보정 > (일반챗) 전송 지연
    if (isInitOverlayActive) {
      const title = '채팅을 준비하고 있어요';
      const body = '첫 대사를 준비하는 중입니다. 잠시만 기다려 주세요.';
      const slow = '네트워크/서버 상황에 따라 최대 10초 정도 걸릴 수 있어요.';
      return { kind: 'init', title, body, slow };
    }
    if (isSocketDisconnectedPopupActive) {
      const wasConnected = Boolean(socketHadConnectedRef.current);
      const title = wasConnected ? '연결이 끊겼어요' : '서버에 연결하는 중…';
      const body = wasConnected
        ? '재연결 중입니다. 잠시만 기다려 주세요.'
        : '잠시만 기다려 주세요.';
      const slow = '지속되면 Wi‑Fi/데이터를 확인하거나 페이지를 새로고침 해주세요.';
      return { kind: 'net', title, body, slow };
    }
    if (isOrigTurnPopupActive) {
      const title = (turnStage === 'polishing') ? '문장을 다듬고 있어요' : '응답을 생성하고 있어요';
      const body = (turnStage === 'polishing') ? '조금 더 자연스럽게 정리 중입니다.' : '잠시만 기다려 주세요.';
      const slow = '조금만 더 기다려 주세요. 곧 완료돼요.';
      return { kind: 'turn', title, body, slow };
    }
    if (isSocketSendDelayPopupActive) {
      const title = '전송이 지연되고 있어요';
      const body = '네트워크가 불안정할 수 있어요. 잠시 후에도 안 되면 다시 보내주세요.';
      const slow = '지속되면 Wi‑Fi/데이터를 확인하거나 페이지를 새로고침 해주세요.';
      return { kind: 'net', title, body, slow };
    }
    return null;
  })();

  const handleInitRetry = async () => {
    try {
      if (!chatRoomId) return;
      // 1) 메타 재조회
      try {
        const metaRes = await chatAPI.getRoomMeta(chatRoomId);
        const meta = metaRes?.data || {};
        setOrigMeta((prev) => ({
          ...(prev || {}),
          turnCount: Number(meta.turn_count || meta.turnCount || prev?.turnCount || 0) || 0,
          maxTurns: Number(meta.max_turns || meta.maxTurns || prev?.maxTurns || 500) || 500,
          completed: Boolean(meta.completed),
          mode: meta.mode || prev?.mode || null,
          narrator_mode: Boolean(meta.narrator_mode),
          seed_label: meta.seed_label || prev?.seed_label || null,
          init_stage: meta.init_stage || prev?.init_stage || null,
          intro_ready: typeof meta.intro_ready === 'boolean' ? meta.intro_ready : (prev?.intro_ready ?? null),
        }));
      } catch (_) {}
      // 2) 메시지 재조회(plain 인사말 생성 완료 여부 확인)
      try {
        const res = await chatAPI.getMessages(chatRoomId);
        const items = Array.isArray(res?.data) ? res.data : [];
        if (items.length > 0) {
          setMessages(items);
          // assistant 메시지가 하나라도 있으면 "준비 완료"로 간주(무한 오버레이 방지)
          const hasAssistant = items.some((m) => String(m?.senderType || '').toLowerCase() === 'assistant');
          if (hasAssistant) {
            setOrigMeta((prev) => ({ ...(prev || {}), init_stage: 'ready', intro_ready: true }));
          }
        }
      } catch (_) {}
    } catch (_) {}
  };

  return (
    <div className="h-screen h-[100dvh] bg-[var(--app-bg)] text-[var(--app-fg)] flex flex-col">
      {/* ✅ 유저용 상태 팝업: 초기 준비는 전체 오버레이로 명확하게 표시(입력 차단) */}
      {statusPopup && statusPopup.kind === 'init' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-gray-900/90 text-white border border-gray-700 rounded-2xl px-6 py-5 shadow-2xl max-w-sm w-[320px] text-center space-y-3">
            <div className="flex items-center justify-center gap-2">
              <Loader2 className="w-5 h-5 animate-spin text-purple-300" />
              <span className="text-sm font-semibold">{statusPopup.title}</span>
            </div>
            <p className="text-xs text-gray-300 leading-relaxed">
              {statusPopup.body}
            </p>
            {showSlowHint && (
              <p className="text-[11px] text-gray-400 leading-relaxed">
                {statusPopup.slow}
              </p>
            )}
            <div className="w-full h-1.5 bg-gray-800 rounded-full overflow-hidden">
              <div className="h-full w-2/3 bg-gradient-to-r from-purple-500 via-blue-400 to-cyan-300 animate-pulse" />
            </div>
            {showInitActions && (
              <div className="pt-1 flex items-center justify-center gap-2">
                <Button
                  variant="outline"
                  className="h-8 px-3 bg-gray-900 border-gray-700 text-gray-100 hover:bg-gray-800"
                  onClick={handleInitRetry}
                >
                  다시 확인
                </Button>
                <Button
                  variant="outline"
                  className="h-8 px-3 bg-gray-900 border-gray-700 text-gray-100 hover:bg-gray-800"
                  onClick={() => { try { window.location.reload(); } catch (_) {} }}
                >
                  새로고침
                </Button>
              </div>
            )}
          </div>
        </div>
      )}
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
                    <span className="text-xs text-gray-400">{aiTypingEffective ? '입력 중...' : '온라인'}</span>
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
      {/* ✅ 유저용 상태 팝업: 생성/보정은 중앙에 작게 표시(비차단, 스크롤/읽기 가능) */}
      {statusPopup && (statusPopup.kind === 'turn' || statusPopup.kind === 'net') && (
        <div className="fixed inset-0 z-40 flex items-center justify-center pointer-events-none">
          <div className="pointer-events-none bg-black/70 text-white border border-gray-700 rounded-2xl px-5 py-4 shadow-2xl w-[320px] text-center space-y-2">
            <div className="flex items-center justify-center gap-2">
              <Loader2 className="w-4.5 h-4.5 animate-spin text-purple-200" />
              <span className="text-sm font-semibold">{statusPopup.title}</span>
            </div>
            <p className="text-xs text-gray-300 leading-relaxed">
              {statusPopup.body}
            </p>
            {showSlowHint && (
              <p className="text-[11px] text-gray-400 leading-relaxed">
                {statusPopup.slow}
              </p>
            )}
            <div className="w-full h-1.5 bg-gray-800 rounded-full overflow-hidden">
              <div className="h-full w-2/3 bg-gradient-to-r from-purple-500 via-blue-400 to-cyan-300 animate-pulse" />
            </div>
          </div>
        </div>
      )}

      {/* 본문: 데스크톱 좌측 이미지 패널, 모바일은 배경 이미지 */}
      <div className="flex-1 overflow-hidden bg-[var(--app-bg)] text-[var(--app-fg)] relative min-h-0">
        {/* ✅ 모바일 몰입형 스테이지: 이미지(오너 등록)를 배경으로 깔고, 회색 딤으로 가독성을 확보한다. */}
        <div className={`lg:hidden absolute inset-0 overflow-hidden ${resolvedTheme === 'light' ? 'bg-white' : 'bg-black'}`}>
          {currentPortraitUrl ? (
            (() => {
              // ✅ 크롭 금지: 원본 비율 그대로 표시(object-contain)
              const raw = resolveImageUrl(currentPortraitUrl);
              return (
                <>
                  {/* ✅ 레터박스: 크롭 없이 최대한 크게(가능하면 가로를 꽉 채움). */}
                  <img
                    className="absolute inset-0 w-full h-full object-contain object-center"
                    src={raw}
                    alt={character?.name}
                    loading="eager"
                    draggable="false"
                    aria-hidden="true"
                    style={{ imageRendering: 'high-quality' }}
                  />
                </>
              );
            })()
          ) : (
            <div className="w-full h-full bg-[var(--app-bg)]" />
          )}
          <div
            className="absolute inset-0 pointer-events-none"
            style={{ backgroundColor: `rgba(31,41,55,${mobileStageOverlayAlpha})` }}
          />
          <div className="absolute inset-0 pointer-events-none bg-gradient-to-b from-black/10 via-transparent to-black/40" />
        </div>

        {/* ✅ 높이 고정(calc) 제거: footer(입력바) 높이만큼 좌측 미니갤러리가 잘리는 문제 방지 */}
        <div className="relative z-10 grid grid-cols-1 lg:grid-cols-[480px_560px] lg:justify-center h-full min-h-0">
          <aside className="hidden lg:flex flex-col border-r w-[480px] flex-shrink-0">
            {/* 대표 이미지 영역 */}
            <div className="flex-1 relative min-h-0">
              {/* 캐러셀: 상반신 기준 포트레이트 */}
              {(() => {
                const primary = getCharacterPrimaryImage(character);
                const currentImage = (characterImages && characterImages.length > 0)
                  ? characterImages[currentImageIndex]
                  : primary;
                const fullSrc = resolveImageUrl(currentImage);
                if (!fullSrc) {
                  return <div className="absolute inset-0 bg-black/10" />;
                }
                return (
                  <>
                    {/* 레터박스 배경(블러 제거): 이미지가 작거나 비율이 달라도 깔끔하게 */}
                    <div
                      className={`absolute inset-0 ${resolvedTheme === 'light' ? 'bg-white' : 'bg-black'}`}
                      aria-hidden="true"
                    />
                    {/* ✅ 레터박스: 원본 사이즈 우선(작은 이미지는 확대하지 않음) */}
                    <div
                      className="absolute inset-0 flex items-center justify-center cursor-zoom-in"
                      role="button"
                      tabIndex={0}
                      aria-label={`${Math.min(characterImages.length, Math.max(1, currentImageIndex + 1))} / ${characterImages.length}`}
                      onClick={() => {
                        setImageModalSrc(fullSrc);
                        setImageModalIndex(Math.max(0, effectiveActiveIndex || 0));
                        setImageModalOpen(true);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          setImageModalSrc(fullSrc);
                          setImageModalIndex(Math.max(0, effectiveActiveIndex || 0));
                          setImageModalOpen(true);
                        }
                      }}
                    >
                      <img
                        className="w-full h-full object-contain object-center"
                        src={fullSrc}
                        alt={character?.name}
                        loading="eager"
                        draggable="false"
                        aria-live="polite"
                        style={{ imageRendering: 'high-quality' }}
                      />
                    </div>
                  </>
                );
              })()}
              {/* 배경 오버레이 (uiOverlay > 0일 때만 표시) */}
              {uiOverlay > 0 && (
                <div className="absolute inset-0 pointer-events-none" style={{ backgroundColor: `rgba(0,0,0,${uiOverlay/100})` }} />
              )}
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
            
            {/* 미니 갤러리: 대표이미지 아래 별도 영역 */}
            {characterImages && characterImages.length > 1 && (
              <div className="flex-shrink-0 bg-black/90 px-3 py-2.5">
                {/* ✅ 중앙 정렬: 이미지(좌측 패널) 기준으로 미니갤러리가 가운데에 오도록 */}
                <div className="flex items-center justify-center gap-2">
                  {/* Prev */}
                  <Button
                    onClick={handlePrevImage}
                    disabled={isPrevDisabled}
                    className={`rounded-full w-7 h-7 p-0 flex-shrink-0 transition-all ${getCarouselButtonClass(isPrevDisabled)}`}
                    size="icon"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </Button>

                  {/* Thumbnails */}
                  <div className="flex-1 max-w-[360px] overflow-x-auto scrollbar-hide">
                    <div id="thumbnail-gallery-footer" className="flex w-max min-w-full justify-center gap-1.5">
                      {characterImages.map((img, idx) => (
                        <button
                          key={idx}
                          onClick={() => setCurrentImageIndex(idx)}
                          className={`relative flex-shrink-0 transition-all ${
                            idx === currentImageIndex 
                              ? 'ring-2 ring-purple-500 ring-offset-1 ring-offset-black' 
                              : 'opacity-70 hover:opacity-100'
                          }`}
                          aria-label={`이미지 ${idx + 1}`}
                        >
                          <img
                            src={resolveImageUrl(img)}
                            alt={`썸네일 ${idx + 1}`}
                            className={`w-12 h-12 object-cover object-top rounded ${
                              idx === currentImageIndex ? 'brightness-100' : 'brightness-80'
                            }`}
                          />
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Next */}
                  <Button
                    onClick={handleNextImage}
                    disabled={isNextDisabled}
                    className={`rounded-full w-7 h-7 p-0 flex-shrink-0 transition-all ${getCarouselButtonClass(isNextDisabled)}`}
                    size="icon"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            )}
          </aside>
          <main
            ref={chatContainerRef}
            onScroll={handleScroll}
            className="relative overflow-y-auto p-4 md:p-6 lg:px-8 pt-4 sm:pt-6 lg:pt-6 bg-transparent lg:bg-[var(--app-bg)] scrollbar-dark w-full"
            style={{ scrollbarGutter: 'stable' }}
          >
            <div className={`relative z-10 w-full space-y-6 mt-0 ${textSizeClass} ${
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

          {messages.length === 0 && !aiTypingEffective ? (
            <div className="text-center py-8">
              <MessageCircle className="w-12 h-12 text-gray-300 mx-auto mb-4" />
              <p className={resolvedTheme === 'light' ? 'text-gray-600' : 'text-gray-200'}>
                {character?.name}에게 첫 메시지를 보내보세요.
              </p>
              <p className={resolvedTheme === 'light' ? 'text-sm text-gray-500 mt-1' : 'text-sm text-gray-300 mt-1'}>
                {character?.description}
              </p>
            </div>
          ) : (
            <ErrorBoundary>
              {messages.map((m, index) => {
                const isIntro = (m.message_metadata && (m.message_metadata.kind === 'intro')) || false;
                if (isIntro) {
                  return (
                    <div key={`intro-${m.id || index}`} className="flex items-start space-x-3">
                      <Avatar className="w-8 h-8 flex-shrink-0">
                        <AvatarImage className="object-cover object-top" src={getCharacterPrimaryImage(character)} alt={character?.name} />
                        <AvatarFallback className="bg-gradient-to-r from-purple-500 to-blue-500 text-white">
                          {character?.name?.charAt(0) || <Bot className="w-4 h-4" />}
                        </AvatarFallback>
                      </Avatar>
                      <div
                        className={`max-w-xs lg:max-w-md px-4 py-3 rounded-lg shadow-md border text-sm whitespace-pre-wrap ${
                          resolvedTheme === 'light'
                            ? 'bg-gray-100 text-gray-900 border-gray-200'
                            : 'bg-white/10 text-white border-white/10'
                        }`}
                      >
                        {m.content}
                      </div>
                    </div>
                  );
                }

                return (
                  <MessageBubble
                    key={m.id || `msg-${index}`}
                    message={m}
                    isLast={index === messages.length - 1 && !aiTypingEffective}
                    triggerImageUrl={aiMessageImages[m.id || m._id || `temp-${index}`]}
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
              {aiTypingEffective && (
                <div className="flex items-start space-x-3">
                  <Avatar className="w-8 h-8 flex-shrink-0">
                    <AvatarImage className="object-cover object-top" src={getCharacterPrimaryImage(character)} alt={character?.name} />
                    <AvatarFallback className="bg-gradient-to-r from-purple-500 to-blue-500 text-white">
                      {character?.name?.charAt(0) || <Bot className="w-4 h-4" />}
                    </AvatarFallback>
                  </Avatar>
                  <div
                    className={`max-w-xs lg:max-w-md px-4 py-2 rounded-lg shadow-md border ${
                      resolvedTheme === 'light'
                        ? 'bg-gray-100 text-gray-900 border-gray-200'
                        : 'bg-white/10 text-white border-white/10'
                    }`}
                  >
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
      <footer className="bg-[var(--footer-bg)] text-[var(--app-fg)] border-t border-gray-800 md:p-1 pb-[env(safe-area-inset-bottom)]">
        <ErrorBoundary>
        <div className="hidden lg:grid lg:grid-cols-[480px_560px] lg:justify-center lg:mx-auto lg:items-center">
          {/* 왼쪽: 빈 공간 (미니 갤러리는 이미지 아래로 이동) */}
          <div className="w-[480px]"></div>
          
          {/* 오른쪽: 채팅 입력 컨테이너 (채팅 메시지 영역 아래) */}
          <div className="w-full">
          <ErrorBoundary>
          <form onSubmit={handleSendMessage} className="flex w-full items-center gap-2">
            {/* 모델 선택 버튼 */}
            <Button
              type="button"
              disabled={isOrigBusy}
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
              disabled={isOrigBusy}
                placeholder={isOrigChat && (origMeta?.narrator_mode || origMeta?.mode==='parallel' && false) ? '서술/묘사로 입력하세요. 예) * 창밖에는 비가 내리고 있었다.' : '대사입력 예) 반가워!'}
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
                  disabled={origTurnLoading || !chatRoomId}
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
                disabled={isOrigBusy}
                className="rounded-full w-10 h-10 p-0 flex-shrink-0 bg-white text-black"
                size="icon"
                title="상황 입력"
              >
                <FileText className="w-5 h-5" />
              </Button>
            )}

            {/* 애스터리스크 버튼: 입력 컨테이너 밖 (우측) */}
            <Button
              type="button"
              onClick={() => setNewMessage(prev => (prev.startsWith('*') ? prev : (`* ${prev || ''}`).trimEnd()))}
              disabled={isOrigBusy}
              className="rounded-full w-10 h-10 p-0 flex-shrink-0 bg-white text-black"
              size="icon"
              variant="ghost"
              title="지문/나레이션 시작"
            >
              <Asterisk className="w-5 h-5" />
            </Button>

            {/* 전송 버튼 */}
            <div className="flex items-center gap-2">
              {/* 자동 진행 >> */}

              {/* 전송 */}
              <Button
                type="submit"
                disabled={!canSend || isOrigBusy}
                className={`rounded-full w-10 h-10 p-0 flex-shrink-0 ${
                  (!canSend || isOrigBusy) ? 'bg-gray-700 text-gray-400' : 'bg-white text-black'
                }`}
                size="icon"
              >
                {isOrigBusy ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
              </Button>
            </div>
          </form>
          </ErrorBoundary>
          </div>
        </div>
        </ErrorBoundary>
        
        {/* 모바일용 입력 컨테이너 */}
        <div className="lg:hidden w-full">
          {/* ✅ 이미지 스트립(상시 노출): 입력바 위에 얇게 표시(눈에 밟히지 않게) */}
          {Array.isArray(portraitImages) && portraitImages.length > 0 && (
            <div className="w-full border-b border-gray-800 bg-black/75">
              {/* ✅ 중앙 정렬: 화면(이미지) 중심 기준으로 스트립을 가운데에 고정 */}
              <div className="px-3 py-2 flex items-center justify-center">
                <div className="w-full max-w-[420px] flex items-center gap-2 rounded-full bg-black/60 border border-white/10 px-2 py-1">
                  {/* Prev (핀 상태에서는 고정이므로 비활성) */}
                  {portraitImages.length > 1 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={handlePrevImage}
                      disabled={isPinned || effectiveActiveIndex <= 0}
                      className={`rounded-full w-8 h-8 p-0 flex-shrink-0 ${
                        (isPinned || effectiveActiveIndex <= 0) ? 'opacity-40 cursor-not-allowed' : 'text-white/80 hover:text-white hover:bg-white/10'
                      }`}
                      title="이전 이미지"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </Button>
                  )}

                  {/* Thumbnails */}
                  <div
                    id="thumbnail-gallery"
                    className="flex-1 flex gap-1.5 overflow-x-auto scrollbar-hide justify-center"
                  >
                    {portraitImages.map((img, idx) => {
                      const selected = idx === effectiveActiveIndex;
                      return (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => setCurrentImageIndex(idx)}
                          aria-label={`이미지 ${idx + 1}`}
                          aria-current={selected ? 'true' : undefined}
                          className={`relative flex-shrink-0 rounded-md overflow-hidden transition ${
                            selected ? 'ring-2 ring-white/70' : 'opacity-70 hover:opacity-100'
                          }`}
                        >
                          <img
                            src={resolveImageUrl(img)}
                            alt={`썸네일 ${idx + 1}`}
                            className="w-9 h-9 object-cover object-top"
                            draggable="false"
                          />
                        </button>
                      );
                    })}
                  </div>

                  {/* Next (핀 상태에서는 고정이므로 비활성) */}
                  {portraitImages.length > 1 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={handleNextImage}
                      disabled={isPinned || effectiveActiveIndex >= portraitImages.length - 1}
                      className={`rounded-full w-8 h-8 p-0 flex-shrink-0 ${
                        (isPinned || effectiveActiveIndex >= portraitImages.length - 1) ? 'opacity-40 cursor-not-allowed' : 'text-white/80 hover:text-white hover:bg-white/10'
                      }`}
                      title="다음 이미지"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </Button>
                  )}

                  {/* 핀(고정) */}
                  {portraitImages.length > 1 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={togglePin}
                      aria-pressed={isPinned}
                      title={isPinned ? '이미지 고정 해제' : '이미지 고정'}
                      className={`rounded-full w-8 h-8 p-0 flex-shrink-0 ${
                        isPinned ? 'bg-white/15 text-white' : 'bg-white/5 text-white/80 hover:bg-white/10 hover:text-white'
                      }`}
                    >
                      {isPinned ? <Pin className="w-4 h-4" /> : <PinOff className="w-4 h-4" />}
                    </Button>
                  )}

                  {/* 돋보기(이미지 감상) */}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => {
                      if (!currentPortraitUrl) return;
                      setImageModalIndex(Math.max(0, effectiveActiveIndex || 0));
                      setImageModalSrc(resolveImageUrl(currentPortraitUrl));
                      setImageModalOpen(true);
                    }}
                    title="이미지 감상"
                    className="rounded-full w-8 h-8 p-0 flex-shrink-0 bg-white/5 text-white/80 hover:bg-white/10 hover:text-white"
                  >
                    <ZoomIn className="w-5 h-5" />
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* ✅ 원작챗: 상황 입력(모바일에서도 누락 없이) */}
          {isOrigChat && showSituation && (
            <div className="w-full px-3 py-2 bg-black/75 border-b border-gray-800">
              <div className="flex items-center gap-2">
                <Input
                  value={situationText}
                  onChange={(e) => setSituationText(e.target.value)}
                  disabled={origTurnLoading || !chatRoomId}
                  placeholder="상황 한 줄 (선택)"
                  className="flex-1 bg-[var(--input-bg)] text-[var(--app-fg)] border border-gray-700"
                />
                <Button
                  type="button"
                  disabled={origTurnLoading || !chatRoomId}
                  onClick={async () => {
                    const text = (situationText || '').trim();
                    if (!text) return;
                    // 낙관적: 사용자 내레이션 말풍선
                    setMessages(prev => [
                      ...prev,
                      {
                        id: `temp-user-sit-${Date.now()}`,
                        roomId: chatRoomId,
                        senderType: 'user',
                        content: `* ${text}`,
                        isNarration: true,
                        created_at: new Date().toISOString()
                      }
                    ]);
                    try {
                      setOrigTurnLoading(true);
                      await origChatAPI.turn({ room_id: chatRoomId, situation_text: text, idempotency_key: genIdemKey() });
                      setSituationText('');
                      setShowSituation(false);
                    } catch (e) {
                      console.error('상황 전송 실패', e);
                    } finally {
                      setOrigTurnLoading(false);
                    }
                  }}
                  className="rounded-full h-10 px-4 bg-white text-black"
                >
                  적용
                </Button>
              </div>
            </div>
          )}

          <ErrorBoundary>
          <form onSubmit={handleSendMessage} className="flex w-full items-center gap-2">
            {/* 모델 선택 버튼 */}
            <Button
              type="button"
              disabled={isOrigBusy}
              className="h-10 w-12 rounded-xl bg-white text-black px-2 leading-tight"
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
                disabled={isOrigBusy}
                placeholder={isOrigChat && (origMeta?.narrator_mode || origMeta?.mode==='parallel' && false) ? '서술/묘사로 입력하세요. 예) * 창밖에는 비가 내리고 있었다.' : '대사입력 예) 반가워!'}
                className="w-full bg-transparent border-0 focus:border-0 focus:ring-0 outline-none text-sm p-0 pl-3 placeholder:text-gray-500 resize-none"
                style={{ minHeight: 36 }}
                rows={1}
              />
            </div>

            {/* 상황 입력 토글 버튼 (원작챗) */}
            {isOrigChat && (
              <Button
                type="button"
                onClick={() => setShowSituation((v)=>!v)}
                disabled={isOrigBusy}
                className="rounded-full w-10 h-10 p-0 flex-shrink-0 bg-white text-black"
                size="icon"
                variant="ghost"
                title="상황 입력"
              >
                <FileText className="w-5 h-5" />
              </Button>
            )}

            {/* 애스터리스크 버튼 */}
            <Button
              type="button"
              onClick={() => setNewMessage(prev => (prev.startsWith('*') ? prev : (`* ${prev || ''}`).trimEnd()))}
              disabled={isOrigBusy}
              className="rounded-full w-10 h-10 p-0 flex-shrink-0 bg-white text-black"
              size="icon"
              variant="ghost"
              title="지문/나레이션 시작"
            >
              <Asterisk className="w-5 h-5" />
            </Button>

            {/* 전송 버튼 */}
            <Button
              type="submit"
              disabled={!canSend || isOrigBusy}
              className={`rounded-full w-10 h-10 p-0 flex-shrink-0 ${
                (!canSend || isOrigBusy) ? 'bg-gray-700 text-gray-400' : 'bg-white text-black'
              }`}
              size="icon"
            >
              {isOrigBusy ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
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
        // ✅ 원작챗: 모델 선택 UI 비활성 + 안내 문구 노출 (현재는 Claude 고정 동작)
        isOrigChat={isOrigChat}
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

      {/* 이미지 확대 모달 */}
      <Dialog open={imageModalOpen} onOpenChange={setImageModalOpen}>
        <DialogContent className="max-w-[96vw] max-h-[90vh] p-0 bg-transparent border-none shadow-none">
          {(() => {
            const list = Array.isArray(portraitImages) ? portraitImages : [];
            const max = Math.max(0, list.length - 1);
            const idx = Math.min(Math.max(0, imageModalIndex || 0), max);
            const rawUrl = list[idx] || imageModalSrc || '';
            const src = rawUrl ? resolveImageUrl(rawUrl) : '';

            if (!src) {
              return (
                <div className="w-[90vw] h-[70vh] bg-black/60 rounded-lg flex items-center justify-center text-white text-sm">
                  이미지가 없습니다.
                </div>
              );
            }

            return (
              <div className="relative">
                <img
                  src={src}
                  alt={character?.name}
                  className="w-full h-full object-contain max-h-[90vh] rounded-lg"
                />

                {list.length > 1 && (
                  <>
                    <button
                      type="button"
                      aria-label="이전 이미지"
                      disabled={idx <= 0}
                      onClick={() => setImageModalIndex((prev) => Math.max(0, (prev || 0) - 1))}
                      className={`absolute left-2 top-1/2 -translate-y-1/2 rounded-full w-10 h-10 flex items-center justify-center border transition ${
                        idx <= 0 ? 'opacity-30 cursor-not-allowed bg-black/30 border-white/10' : 'bg-black/50 border-white/20 hover:bg-black/70'
                      }`}
                    >
                      <ChevronLeft className="w-5 h-5 text-white" />
                    </button>
                    <button
                      type="button"
                      aria-label="다음 이미지"
                      disabled={idx >= max}
                      onClick={() => setImageModalIndex((prev) => Math.min(max, (prev || 0) + 1))}
                      className={`absolute right-2 top-1/2 -translate-y-1/2 rounded-full w-10 h-10 flex items-center justify-center border transition ${
                        idx >= max ? 'opacity-30 cursor-not-allowed bg-black/30 border-white/10' : 'bg-black/50 border-white/20 hover:bg-black/70'
                      }`}
                    >
                      <ChevronRight className="w-5 h-5 text-white" />
                    </button>
                    <div className="absolute bottom-3 left-1/2 -translate-x-1/2 bg-black/60 text-white text-xs px-2 py-1 rounded-md border border-white/10">
                      {idx + 1} / {list.length}
                    </div>
                  </>
                )}
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ChatPage;
