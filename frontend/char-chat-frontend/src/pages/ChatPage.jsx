/**
 * 채팅 페이지
 */

import React, { useState, useEffect, useRef, useCallback, useMemo, useLayoutEffect } from 'react';
import ErrorBoundary from '../components/ErrorBoundary';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useSocket } from '../contexts/SocketContext';
import { charactersAPI, chatAPI, usersAPI, origChatAPI, mediaAPI, storiesAPI, userPersonasAPI } from '../lib/api'; // usersAPI 추가
import { showToastOnce } from '../lib/toastOnce';
import { resolveImageUrl, getCharacterPrimaryImage, getThumbnailUrl } from '../lib/images';
import { getReadingProgress } from '../lib/reading';
import { replacePromptTokens } from '../lib/prompt';
import { parseAssistantBlocks } from '../lib/assistantBlocks';
import { imageCodeIdFromUrl } from '../lib/imageCode';
import { hasChatHtmlLike, sanitizeChatMessageHtml } from '../lib/messageHtml';
import RichMessageHtml from '../components/RichMessageHtml';
import ImageZoomModal from '../components/ImageZoomModal';
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
  FileText,
  Sparkles
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
// 이미지 확대 모달은 `ImageZoomModal`로 통일
import { Tooltip, TooltipTrigger, TooltipContent } from '../components/ui/tooltip';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu';
import ModelSelectionModal from '../components/ModelSelectionModal';
import Sidebar from '../components/layout/Sidebar';
import { useLoginModal } from '../contexts/LoginModalContext';
import { consumePostLoginDraft, setPostLoginRedirect } from '../lib/postLoginRedirect';

function dedupeMessagesById(items) {
  const arr = Array.isArray(items) ? items : [];
  const out = [];
  const byId = new Map();

  for (const it of arr) {
    const id = String(it?.id || '').trim();
    if (!id) {
      out.push(it);
      continue;
    }
    if (!byId.has(id)) {
      byId.set(id, out.length);
      out.push(it);
      continue;
    }
    const idx = byId.get(id);
    const prev = out[idx] || {};
    out[idx] = { ...prev, ...it };
  }
  return out;
}

function resolveChatStreamErrorMessage(err, fallbackMessage = '전송에 실패했습니다. 다시 시도해주세요.') {
  const raw = String(err?.message || err?.detail || '').trim();
  const lower = raw.toLowerCase();

  if (raw === 'InsufficientRuby' || lower.includes('insufficientruby')) {
    return '루비가 부족합니다. 충전 후 다시 시도하거나, 무료 모델(Gemini 2.5 Flash)로 전환해보세요.';
  }

  if (
    raw.includes('Another request is already in progress') ||
    lower.includes('already in progress')
  ) {
    return '이미 응답 생성 중입니다. 잠시만 기다렸다가 다시 시도해주세요.';
  }

  if (raw === 'AiTimeout' || lower.includes('aitimeout') || lower.includes('timeout')) {
    return '응답이 지연되어 자동으로 중단되었습니다. 잠시 후 다시 시도해주세요.';
  }

  if (
    lower.includes('stream auth failed') ||
    lower.includes('unauthorized') ||
    lower.includes('not_authenticated')
  ) {
    return '로그인 상태가 만료되었습니다. 다시 로그인 후 시도해주세요.';
  }

  return fallbackMessage;
}

const ChatPage = () => {
  const { characterId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { user, isAuthenticated } = useAuth();
  const { openLoginModal } = useLoginModal();
  const { 
    socket,
    connected, 
    messages, 
    aiTyping,
    socketError,
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
  const [mediaPanelEnabled, setMediaPanelEnabled] = useState(false);
  const [isDesktopViewport, setIsDesktopViewport] = useState(() => {
    try {
      return typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches;
    } catch (_) {
      return false;
    }
  });

  // ✅ URL 기준 원작챗 여부(훅/상태 선언 순서와 무관하게 안전)
  // - isOrigChat(state)는 아래에서 선언되므로, 여기서는 URL 파라미터로만 판별한다.
  // - dependency 배열에서 isOrigChat을 참조하면 TDZ(초기화 전 접근)로 크래시가 날 수 있어 방어한다.
  const isOrigChatFromUrl = (() => {
    try {
      const params = new URLSearchParams(location.search || '');
      return String(params.get('source') || '').trim().toLowerCase() === 'origchat';
    } catch (_) {
      return false;
    }
  })();

  useEffect(() => {
    try {
      if (typeof window === 'undefined' || !window.matchMedia) return;
      const mql = window.matchMedia('(min-width: 1024px)');
      const onChange = () => setIsDesktopViewport(Boolean(mql.matches));
      onChange();
      try {
        mql.addEventListener('change', onChange);
        return () => mql.removeEventListener('change', onChange);
      } catch (_) {
        try {
          mql.addListener(onChange);
          return () => mql.removeListener(onChange);
        } catch (_) {
          return undefined;
        }
      }
    } catch (_) {
      return undefined;
    }
  }, []);

  /**
   * ✅ 원작챗 페르소나 적용 여부 안내(1회)
   *
   * 문제:
   * - 유저가 페르소나를 "만들기만" 하고 활성화를 안 했거나,
   * - 적용 범위를 "일반 캐릭터챗만"으로 둔 채 원작챗을 하면,
   *   캐릭터가 유저 이름을 모르는 것처럼 보여 혼란이 생긴다.
   *
   * 해결(UX/방어):
   * - 원작챗 진입 시 활성 페르소나를 조회해, 적용 중인지/미적용인지 토스트로 1회 알려준다.
   */
  useEffect(() => {
    if (!isOrigChatFromUrl || !chatRoomId) return;

    const SCOPE_LABEL = {
      all: '모두 적용',
      character: '일반 캐릭터챗만',
      origchat: '원작챗만',
    };

    let cancelled = false;
    (async () => {
      try {
        const res = await userPersonasAPI.getCurrentActivePersona();
        if (cancelled) return;

        const persona = res?.data || null;
        const name = String(persona?.name || '').trim();
        const scope = String(persona?.apply_scope || persona?.applyScope || 'all').toLowerCase();

        if (!name) return;

        if (scope === 'all' || scope === 'origchat') {
          showToastOnce({
            key: `origchat-persona-ok:${chatRoomId}`,
            type: 'info',
            message: `원작챗 페르소나 적용 중: ${name}`,
          });
        } else {
          const label = SCOPE_LABEL[scope] || scope;
          showToastOnce({
            key: `origchat-persona-scope:${chatRoomId}:${scope}`,
            type: 'warning',
            message: `현재 활성 페르소나 적용 범위(${label})라 원작챗에는 적용되지 않습니다.`,
          });
        }
      } catch (e) {
        const status = e?.response?.status;
        if (status === 404) {
          showToastOnce({
            key: `origchat-persona-none:${chatRoomId}`,
            type: 'info',
            message: '원작챗에서 이름을 반영하려면 유저 페르소나를 활성화하세요.',
          });
          return;
        }
        console.error('[ChatPage] active persona check failed:', e);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isOrigChatFromUrl, chatRoomId]);

  useEffect(() => {
    /**
     * ✅ 로그인 후 복귀 시 draft 복원
     *
     * - 게스트 상태에서 메시지를 입력하고 "전송"을 눌렀다가 로그인한 경우,
     *   동일 URL에 입력 텍스트를 복원한다.
     */
    if (!isAuthenticated) return;
    try {
      const url = `${location.pathname}${location.search || ''}`;
      const draft = consumePostLoginDraft(url);
      if (draft) setNewMessage(draft);
    } catch (_) {}
    // 의도: 로그인 전환 시점에만 1회
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated]);
  
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
  // ✅ 접근 불가(비공개) 경고 모달
  const [accessDeniedModal, setAccessDeniedModal] = useState({ open: false, message: '' });
  const [showModelModal, setShowModelModal] = useState(false);
  const [modalInitialTab, setModalInitialTab] = useState('model');
  // ✅ 기본 모델(요구사항): Claude Haiku 4.5
  // - 서버에서 사용자 설정을 불러오기 전까지 UI 기본값으로 사용한다.
  const [currentModel, setCurrentModel] = useState('claude');
  const [currentSubModel, setCurrentSubModel] = useState('claude-haiku-4-5-20251001');
  const [editingMessageId, setEditingMessageId] = useState(null);
  const [editText, setEditText] = useState('');
  // ✅ 메시지 피드백(추천/비추천) "눌림" 상태: 이 채팅방은 사용자 단일 소유이므로 로컬 UI 상태로도 충분히 UX를 보강할 수 있다.
  // - 서버는 count만 증가시키므로(토글/사용자별 상태 없음), 화면에서는 마지막 선택을 색상으로 표시한다.
  const [feedbackSelectionById, setFeedbackSelectionById] = useState({}); // { [messageId]: 'up'|'down' }
  // ✅ 메시지 편집 Textarea 포커스/커서 제어(백스페이스 스크롤/포커스 누락 방지)
  const editTextareaRef = useRef(null);
  const [regenOpen, setRegenOpen] = useState(false);
  const [regenInstruction, setRegenInstruction] = useState('');
  const [regenTargetId, setRegenTargetId] = useState(null);
  // ✅ 재생성 진행 상태(대상 말풍선에만 ... 로딩 표시)
  const [regenBusyId, setRegenBusyId] = useState(null);
  const [newMessage, setNewMessage] = useState('');
  // ✅ 요술봉 모드(경쟁사 UX): AI 답변 직후 3개 선택지 자동 제안
  const [magicMode, setMagicMode] = useState(false);
  const [magicChoices, setMagicChoices] = useState([]); // [{id,label}]
  const [magicLoading, setMagicLoading] = useState(false);
  // ✅ 다음행동(앞당기기) 버튼 - 1단계(UI/UX만)
  // - 서버/히스토리 SSOT를 건드리지 않고, 안전하게 버튼/상태/클릭 잠금만 구현한다.
  const [nextActionBusy, setNextActionBusy] = useState(false);
  const NEXT_ACTION_COOLDOWN_MS = 2500;
  const nextActionCooldownUntilRef = useRef(0);
  const nextActionTimerRef = useRef(null);
  // ✅ 다음행동 버튼: "AI 응답(스트리밍) 완료"까지 활성 상태 유지용
  const nextActionSeenAiTypingRef = useRef(false);
  const nextActionFailSafeTimerRef = useRef(null);
  // ✅ A안(일반챗): 요술봉 선택지 1→2→3 점진 노출
  const [magicRevealCount, setMagicRevealCount] = useState(0); // 0~3
  const magicRevealTimerRef = useRef(null);
  const magicRevealCancelSeqRef = useRef(0);
  const lastMagicSeedRef = useRef('');
  const magicModeHydratedRef = useRef(false);
  const magicChoicesHydratedRef = useRef(false);
  // 이미지 캐러셀 상태
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const [characterImages, setCharacterImages] = useState([]);
  // ✅ 이미지 코드([[img:...]])용: 대표이미지(avatar)를 제외한 상황별 이미지만 resolve 대상
  const codeResolvableImages = useMemo(() => {
    const avatar = String(character?.avatar_url || '').trim();
    if (!avatar) return characterImages;
    return characterImages.filter((u) => String(u || '').trim() !== avatar);
  }, [characterImages, character?.avatar_url]);
  const [imageKeywords, setImageKeywords] = useState([]); // [{url, keywords:[]}] 키워드 트리거용
  const [aiMessageImages, setAiMessageImages] = useState({}); // messageId -> imageUrl (말풍선 아래 이미지)
  // ✅ 새로고침 UX 안정화:
  // - "말풍선 아래 트리거 이미지"와 모바일 스테이지 배경이 새로고침 시 사라지는 현상을 줄이기 위해,
  //   최소한의 캐시를 sessionStorage로 복원한다(SSOT는 서버, UI 캐시는 클라이언트).
  const [stageFallbackUrl, setStageFallbackUrl] = useState(() => {
    try {
      const k = `cc:chat:stage:v1:${characterId || 'none'}`;
      const raw = sessionStorage.getItem(k);
      if (!raw) return '';
      const parsed = JSON.parse(raw);
      return String(parsed?.url || '').trim();
    } catch (_) {
      return '';
    }
  });
  const aiMessageImagesRef = useRef({});
  const [mediaAssets, setMediaAssets] = useState([]);
  const [isPinned, setIsPinned] = useState(false);
  const [pinnedUrl, setPinnedUrl] = useState('');
  // ✅ 새로고침 후에도 "... 로딩 말풍선"을 유지하기 위한 최소 상태(세션)
  // - 소켓 aiTyping/origTurnLoading은 새로고침 시 초기화되므로, "응답 대기 중" 플래그를 룸 단위로 보존한다.
  const [persistedTypingTs, setPersistedTypingTs] = useState(null); // number(ms) | null
  const [sseAwaitingFirstDelta, setSseAwaitingFirstDelta] = useState(false);
  // ✅ A안(가짜 스트리밍/타이핑 효과): UI에서만 "천천히 출력" (서버/DB 데이터 불변)
  //
  // 의도/동작:
  // - 일반 캐릭터챗에서 새로 도착한 AI 말풍선을 "점진적으로" 보여준다.
  // - 입력창/요술봉/전송 등은 "AI 출력이 끝난 뒤"에만 활성화(운영 버그/동시 입력 방지).
  //
  // 방어적:
  // - 히스토리 로드(초기/재동기화/페이지네이션)로 세팅된 기존 메시지는 스트리밍하지 않는다.
  // - 스트리밍은 '마지막 메시지(=바닥에 새로 붙은 AI)'에만 적용하고, 새 메시지가 오면 즉시 취소/교체한다.
  const [uiStream, setUiStream] = useState({ id: '', full: '', shown: '' }); // { id, full, shown }
  const uiStreamTimerRef = useRef(null);
  const uiStreamCancelSeqRef = useRef(0);
  const uiStreamHydratedRef = useRef(false); // 초기 히스토리 로드 1회 가드
  const uiStreamPrevLastIdRef = useRef(''); // 마지막(바닥) non-system 메시지 id 기억
  const uiStreamDoneByIdRef = useRef({}); // { [messageId]: true }
  // ✅ A안(일반챗): 오프닝(도입부 intro)도 점진 출력 (신규 대화 시작 시 1회)
  const [uiIntroStream, setUiIntroStream] = useState({ id: '', full: '', shown: '' }); // { id, full, shown }
  const uiIntroTimerRef = useRef(null);
  const uiIntroCancelSeqRef = useRef(0);
  const uiIntroDoneByIdRef = useRef({}); // { [messageId]: true }
  const uiOpeningRunKeyRef = useRef(''); // room/search 단위로 오프닝 연출 1회 초기화
  const [uiOpeningStage, setUiOpeningStage] = useState('idle'); // idle|intro|greeting|done
  // ✅ 로컬 UI 말풍선(상태창)도 타이핑처럼 스트리밍 (요구사항)
  // - 서버 SSOT(content)는 건드리지 않고, "표시만" 점진 출력한다.
  const [uiLocalBubbleStream, setUiLocalBubbleStream] = useState({ id: '', full: '', shown: '' }); // { id, full, shown }
  const uiLocalBubbleTimerRef = useRef(null);
  const uiLocalBubbleCancelSeqRef = useRef(0);
  // 이미지 확대 모달
  const [imageModalOpen, setImageModalOpen] = useState(false);
  const [imageModalSrc, setImageModalSrc] = useState('');
  // X 버튼만 있는 이미지 확대 모달(1장)
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
  // ✅ 데모 안정성 우선:
  // - postprocess(경량 재작성)는 "처음 본 대사"와 "재진입 시 로드된 대사"가 달라 보이는 문제를 만들 수 있어
  //   기본값은 off로 둔다. (필요하면 설정에서 다시 켤 수 있음)
  // ✅ 기본값(요구사항): 응답 길이 short(짧게)
  const defaultChatSettings = { postprocess_mode: 'off', next_event_len: 1, response_length_pref: 'short', prewarm_on_start: true, temperature: 0.7 };
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
  // ✅ 원작챗 수동 동기화(모바일↔PC 이어하기용)
  const [origSyncLoading, setOrigSyncLoading] = useState(false);
  const [showOrigSyncHint, setShowOrigSyncHint] = useState(false);
  const origSyncHintTimerRef = useRef(null);
  // 새로운 선택지가 도착하면 다시 활성화
  useEffect(() => { setChoiceLocked(false); }, [pendingChoices]);

  // ✅ 소켓 기반(일반 캐릭터챗)에서 비공개로 인해 서버가 거부한 경우에도 "접근 불가" 모달로 통일한다.
  useEffect(() => {
    try {
      const msg = String(socketError || '').trim();
      if (!msg) return;
      if (!msg.includes('비공개')) return;
      setAccessDeniedModal({ open: true, message: msg });
      try { setError(msg); } catch (_) {}
    } catch (_) {}
  }, [socketError]);

  /**
   * ✅ 원작챗 페르소나 적용 여부 안내(1회)
   *
   * ⚠️ 중요(버그 방지):
   * - `isOrigChat` 상태 선언(useState)보다 먼저 참조하면 TDZ(ReferenceError)가 발생할 수 있어,
   *   원작챗 상태 선언 이후에 배치한다.
   *
   * 문제:
   * - 유저가 페르소나를 "만들기만" 하고 활성화를 안 했거나,
   * - 적용 범위를 "일반 캐릭터챗만"으로 둔 채 원작챗을 하면,
   *   캐릭터가 유저 이름을 모르는 것처럼 보여 혼란이 생긴다.
   *
   * 해결(UX/방어):
   * - 원작챗 진입 시 활성 페르소나를 조회해, 적용 중인지/미적용인지 토스트로 1회 알려준다.
   */
  useEffect(() => {
    if (!isOrigChat || !chatRoomId) return;

    const SCOPE_LABEL = {
      all: '모두 적용',
      character: '일반 캐릭터챗만',
      origchat: '원작챗만',
    };

    let cancelled = false;
    (async () => {
      try {
        const res = await userPersonasAPI.getCurrentActivePersona();
        if (cancelled) return;

        const persona = res?.data || null;
        const name = String(persona?.name || '').trim();
        const scope = String(persona?.apply_scope || persona?.applyScope || 'all').toLowerCase();

        if (!name) return;

        if (scope === 'all' || scope === 'origchat') {
          showToastOnce({
            key: `origchat-persona-ok:${chatRoomId}`,
            type: 'info',
            message: `원작챗 페르소나 적용 중: ${name}`,
          });
        } else {
          const label = SCOPE_LABEL[scope] || scope;
          showToastOnce({
            key: `origchat-persona-scope:${chatRoomId}:${scope}`,
            type: 'warning',
            message: `현재 활성 페르소나 적용 범위(${label})라 원작챗에는 적용되지 않습니다.`,
          });
        }
      } catch (e) {
        const status = e?.response?.status;
        if (status === 404) {
          showToastOnce({
            key: `origchat-persona-none:${chatRoomId}`,
            type: 'info',
            message: '원작챗에서 이름을 반영하려면 유저 페르소나를 활성화하세요.',
          });
          return;
        }
        console.error('[ChatPage] active persona check failed:', e);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isOrigChat, chatRoomId]);
  const [rangeWarning, setRangeWarning] = useState('');
  // 원작챗 메타(진행도/완료/모드)
  const [origMeta, setOrigMeta] = useState({ turnCount: null, maxTurns: null, completed: false, mode: null, init_stage: null, intro_ready: null });
  /**
   * ✅ 일반챗(캐릭터챗) 진행률 UI 상태
   *
   * 요구사항:
   * - 채팅영역 바로 위에 "턴수/진행률바/%"를 노출한다.
   * - 레거시(위저드 도입 전) 방은 max_turns 정보가 없을 수 있으므로:
   *   - 바는 100% 채움 + 가운데 ∞ 표시
   *   - 텍스트는 `현재턴/∞`, 퍼센트는 `∞`
   *
   * SSOT:
   * - 서버(룸 메타)에서 내려주는 turn_count/max_turns/is_infinite를 우선 사용한다.
   */
  const INFTY = '∞';
  const [chatProgress, setChatProgress] = useState({ turnCount: 0, maxTurns: null, isInfinite: true, percent: 100 });
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
  // ✅ 원작챗: 상황 입력 안내 말풍선(로컬 UI 전용, DB 저장 안 함)
  const situationHintMsgIdRef = useRef(null);
  const situationHintTimerRef = useRef(null);
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
  // ✅ 시뮬 상태창/정보 말풍선 UX(요구사항)
  // - 입력창: "상태창 출력" 토글(룸별 저장)
  // - 명령: "!스탯" → 언제든 상태창 말풍선 출력
  // - 오프닝: 대표이미지 아래 info 말풍선(목표/상태) 표시
  const isSimulatorChat = useMemo(() => {
    try {
      const ct = String(
        character?.character_type
        || character?.characterType
        || character?.basic_info?.character_type
        || character?.basic_info?.characterType
        || ''
      ).toLowerCase().trim();
      if (ct === 'simulator') return true;
      // 방어: 레거시 데이터에서 start_sets.sim_options가 있으면 시뮬로 간주
      const ss = (character && typeof character === 'object')
        ? (character.start_sets || character.basic_info?.start_sets)
        : null;
      const sim = (ss && typeof ss === 'object' && ss.sim_options && typeof ss.sim_options === 'object')
        ? ss.sim_options
        : null;
      return Boolean(sim);
    } catch (_) {
      return false;
    }
  }, [character]);
  const [simStatusEnabled, setSimStatusEnabled] = useState(false);
  const [simStatusSnapshot, setSimStatusSnapshot] = useState(null); // { defs:[], state:{}, opening_id?:string }
  const lastAutoStatusByMsgIdRef = useRef('');
  const lastAutoStatusTurnRef = useRef(null);
  // ✅ 로컬 UI 말풍선(상태창/정보): messages 배열과 분리해 "사라짐" 방지
  // - messages는 히스토리/재입장/동기화 시 setMessages로 통째로 교체될 수 있어, 로컬로 끼운 말풍선이 유실될 수 있다.
  // - 따라서 로컬 UI 말풍선은 별도 state로 유지하고, 렌더링에서 anchor(특정 메시지 뒤)에 끼워 넣는다.
  const UI_TAIL_ANCHOR = '__tail__';
  const [localUiBubbles, setLocalUiBubbles] = useState([]); // [{id, roomId, anchorId, kind, payload, created_at}]
  const lastStatusFetchAtRef = useRef(0);
  // ✅ 입력 커서 위치 보정(요구사항):
  // - setState로 value가 바뀌면 브라우저가 커서를 끝으로 보내는 케이스가 있어,
  //   "다음 렌더 커밋 이후"에 selectionRange를 적용한다.
  const pendingInputSelectionRef = useRef(null); // { start:number, end:number } | null
  // ✅ 반응형(PC/모바일)에서 입력창이 2개 렌더될 수 있어(ref 공유 주의)
  // - hidden 처리된 Textarea가 ref를 덮어쓰면 커서 이동이 "안 되는 것처럼" 보일 수 있다.
  // - 실제로 화면에 보이는 Textarea만 inputRef에 보관한다.
  const setComposerInputRef = useCallback((node) => {
    try {
      if (!node) return;
      // display:none / hidden이면 getClientRects가 비어있다.
      if (typeof node.getClientRects === 'function' && node.getClientRects().length === 0) return;
      inputRef.current = node;
    } catch (_) {
      // 최후 폴백: node가 있으면 일단 참조
      try { if (node) inputRef.current = node; } catch(__) {}
    }
  }, []);
  const chatContainerRef = useRef(null); // For scroll handling
  const prevScrollHeightRef = useRef(0); // For scroll position restoration
  const isPinnedRef = useRef(false);
  const pinnedUrlRef = useRef('');
  const autoScrollRef = useRef(true); // 사용자가 맨 아래에 있는지 추적
  // ✅ 최신 roomId 추적(모바일 탭 전환/언마운트 시 leave_room 정확도 확보)
  const chatRoomIdRef = useRef(null);
  const genIdemKey = useCallback(() => {
    try { return `${chatRoomId || 'room'}:${Date.now()}:${Math.random().toString(36).slice(2,8)}`; } catch (_) { return `${Date.now()}`; }
  }, [chatRoomId]);

  const refreshGeneralChatProgress = useCallback(async (roomId) => {
    /**
     * ✅ 일반챗 진행률 갱신(서버 SSOT 우선)
     *
     * 동작:
     * - /chat/rooms/{roomId}/meta 에서 turn_count/max_turns/is_infinite를 받아 UI를 갱신한다.
     * - 실패해도 채팅 흐름은 유지되어야 하므로, 에러는 콘솔만 남기고 조용히 폴백한다.
     */
    try {
      if (!roomId) return;
      if (isOrigChat) return;
      if (!isAuthenticated) return; // 메타 API는 인증 필요
      const metaRes = await chatAPI.getRoomMeta(roomId);
      const m = metaRes?.data || {};
      const tcRaw = Number(m.turn_count ?? m.turnCount ?? m.turn_no_cache ?? m.turnNoCache ?? 0);
      const mtRaw = (m.max_turns === null || m.max_turns === undefined) ? null : Number(m.max_turns ?? m.maxTurns);
      const turnCount = Number.isFinite(tcRaw) && tcRaw >= 0 ? Math.floor(tcRaw) : 0;
      const maxTurnsFromMeta = (mtRaw !== null && Number.isFinite(mtRaw) && mtRaw >= 50) ? Math.floor(mtRaw) : null;
      // ✅ 운영 안정(요구사항): 메타에 max_turns가 없더라도, 캐릭터 설정(start_sets.sim_options.max_turns)이 있으면 그 값을 UI에 사용한다.
      // - 실제 무한모드(is_infinite=true)는 서버 SSOT를 우선한다.
      const maxTurnsFallback = (() => {
        try {
          const ss = (character && typeof character === 'object')
            ? (character.start_sets || character.basic_info?.start_sets)
            : null;
          const sim = (ss && typeof ss === 'object' && ss.sim_options && typeof ss.sim_options === 'object')
            ? ss.sim_options
            : null;
          const raw = sim ? Number(sim.max_turns ?? sim.maxTurns ?? 0) : 0;
          const v = Number.isFinite(raw) ? Math.floor(raw) : 0;
          return v >= 50 ? v : null;
        } catch (_) {
          return null;
        }
      })();
      const maxTurns = maxTurnsFromMeta ?? maxTurnsFallback;
      const isInfinite = Boolean(m.is_infinite) || !(maxTurns && maxTurns >= 50);
      const percent = isInfinite ? 100 : Math.max(0, Math.min(100, Math.round((turnCount / maxTurns) * 100)));
      setChatProgress({ turnCount, maxTurns, isInfinite, percent });
    } catch (e) {
      console.error('[ChatPage] general progress meta failed:', e);
    }
  }, [isOrigChat, isAuthenticated, character]);

  const parseGoalHintFromIntroText = useCallback((introText) => {
    /**
     * ✅ 시뮬 목표(표시용) 추출(휴리스틱)
     *
     * 의도:
     * - DB/메타에 "목표"가 구조화되어 저장되어 있지 않은 경우가 있어,
     *   오프닝 intro 지문에서 목표 문장을 1줄로 뽑아 "info 말풍선"에 표시한다.
     *
     * 방어:
     * - 실패해도 UI는 깨지면 안 된다(없으면 null).
     */
    try {
      const s = String(introText || '').replace(/\s+/g, ' ').trim();
      if (!s) return null;
      // 대표 패턴: "지금 목표는 ...", "목표: ..."
      const m1 = s.match(/(지금\s*목표는[^.。!?]*[.。!?]?)/);
      if (m1 && m1[1]) return String(m1[1]).trim();
      const m2 = s.match(/(목표\s*[:：]\s*[^.。!?]*[.。!?]?)/);
      if (m2 && m2[1]) return String(m2[1]).trim();
      return null;
    } catch (_) {
      return null;
    }
  }, []);

  const fetchSimStatusSnapshot = useCallback(async (roomId, options = null) => {
    /**
     * ✅ 시뮬 상태창 스냅샷 로드(서버 SSOT: /chat/rooms/{id}/meta)
     *
     * 동작:
     * - stat_defs: 스탯 정의(라벨/범위)
     * - stat_state: 현재 값(서버가 매 턴 누적/저장)
     */
    try {
      if (!roomId) return null;
      if (!isAuthenticated) return null;
      const force = Boolean(options && typeof options === 'object' && options.force);
      const now = Date.now();
      // 방어: 스팸 호출 방지(짧은 TTL)
      if (!force && now - (lastStatusFetchAtRef.current || 0) < 800) {
        return simStatusSnapshot;
      }
      lastStatusFetchAtRef.current = now;
      const metaRes = await chatAPI.getRoomMeta(roomId);
      const m = metaRes?.data || {};
      const defs = Array.isArray(m.stat_defs) ? m.stat_defs : [];
      const state = (m.stat_state && typeof m.stat_state === 'object') ? m.stat_state : null;
      const deltaById = (m.stat_last_delta && typeof m.stat_last_delta === 'object') ? m.stat_last_delta : null;
      const deltaTurnRaw = (m.stat_last_delta_turn !== undefined && m.stat_last_delta_turn !== null) ? Number(m.stat_last_delta_turn) : null;
      const turnCountRaw = (m.turn_count !== undefined && m.turn_count !== null) ? Number(m.turn_count) : null;
      const openingId = String(m.opening_id || '').trim();
      // ✅ stat_state가 아직 없으면(첫 대화 전) stat_defs의 base_value로 초기 state를 구성
      // - 서버는 send_message 시점에서야 stat_state를 초기화하므로, 그 전에 !스탯 호출 시 방어
      const effectiveState = state || (() => {
        if (!defs.length) return null;
        const init = {};
        for (const d of defs) {
          const id = String(d?.id || '').trim();
          if (!id) continue;
          const bv = d?.base_value;
          init[id] = (bv !== null && bv !== undefined && String(bv).trim() !== '') ? Number(bv) : 0;
        }
        return Object.keys(init).length > 0 ? init : null;
      })();
      if (!effectiveState) return null;
      const snap = {
        defs,
        state: effectiveState,
        opening_id: openingId,
        delta_by_id: deltaById,
        delta_turn: (deltaTurnRaw !== null && Number.isFinite(deltaTurnRaw)) ? Math.floor(deltaTurnRaw) : null,
        turn_count: (turnCountRaw !== null && Number.isFinite(turnCountRaw)) ? Math.floor(turnCountRaw) : null,
      };
      setSimStatusSnapshot(snap);
      return snap;
    } catch (e) {
      console.error('[ChatPage] fetchSimStatusSnapshot failed:', e);
      return null;
    }
  }, [isAuthenticated, simStatusSnapshot]);

  const buildSimStatusPayload = useCallback((snapshot, introText = '') => {
    try {
      const defs = Array.isArray(snapshot?.defs) ? snapshot.defs : [];
      const state = (snapshot?.state && typeof snapshot.state === 'object') ? snapshot.state : {};
      const deltaById0 = (snapshot?.delta_by_id && typeof snapshot.delta_by_id === 'object') ? snapshot.delta_by_id : null;
      const canUseDelta = (() => {
        try {
          const dt = snapshot?.delta_turn;
          const tc = snapshot?.turn_count;
          if (dt === null || dt === undefined) return false;
          if (tc === null || tc === undefined) return false;
          return Number(dt) === Number(tc);
        } catch (_) {
          return false;
        }
      })();
      const rows = defs.map((d) => {
        const id = String(d?.id || '').trim();
        if (!id) return null;
        const label = String(d?.label || id).trim();
        const vRaw = state[id];
        const v = (vRaw !== null && vRaw !== undefined && String(vRaw).trim() !== '') ? Number(vRaw) : 0;
        const minV = (d?.min_value !== null && d?.min_value !== undefined && String(d?.min_value).trim() !== '') ? Number(d?.min_value) : null;
        const maxV = (d?.max_value !== null && d?.max_value !== undefined && String(d?.max_value).trim() !== '') ? Number(d?.max_value) : null;
        const value = Number.isFinite(v) ? v : 0;
        const min_value = (minV !== null && Number.isFinite(minV)) ? minV : null;
        const max_value = (maxV !== null && Number.isFinite(maxV)) ? maxV : null;
        const deltaRaw = (canUseDelta && deltaById0) ? deltaById0[id] : null;
        const delta = (deltaRaw !== null && deltaRaw !== undefined && String(deltaRaw).trim() !== '')
          ? Number(deltaRaw)
          : null;
        const delta_i = (delta !== null && Number.isFinite(delta)) ? Math.trunc(delta) : null;
        return { id, label, value, min_value, max_value, delta: delta_i };
      }).filter(Boolean);
      const goalHint = parseGoalHintFromIntroText(introText);
      return { goalHint, rows };
    } catch (_) {
      return { goalHint: null, rows: [] };
    }
  }, [parseGoalHintFromIntroText]);

  useEffect(() => {
    // ✅ 룸 전환 시 로컬 UI 말풍선 리셋(다른 방으로 누수 방지)
    try { setLocalUiBubbles([]); } catch (_) {}
    try { lastAutoStatusByMsgIdRef.current = ''; } catch (_) {}
    try { lastAutoStatusTurnRef.current = null; } catch (_) {}
  }, [chatRoomId]);

  /**
   * ✅ 로컬 스탯 말풍선 앵커 복구(순서 보존)
   *
   * 배경:
   * - !스탯 버블은 특정 메시지(anchorId) 뒤에 붙는다.
   * - 히스토리 재동기화로 해당 메시지 id가 바뀌면(anchor orphan) 버블이 누락될 수 있다.
   *
   * 원칙:
   * - orphan을 무조건 tail로 보내지 않는다(기존 요구사항 유지).
   * - 버블 생성시각(created_at)을 기준으로 "가장 가까운 이전 메시지"에 재앵커한다.
   * - 이전 메시지를 못 찾을 때만 마지막 메시지로 붙인다.
   */
  useEffect(() => {
    try {
      if (!chatRoomId) return;
      const roomId = String(chatRoomId);
      const arr = Array.isArray(messages) ? messages : [];
      if (!arr.length) return;
      const msgList = arr.map((m) => ({
        id: String(m?.id || m?._id || '').trim(),
        ts: Date.parse(String(m?.created_at || m?.createdAt || m?.timestamp || '')),
      })).filter((x) => x.id);
      if (!msgList.length) return;
      const msgIdSet = new Set(msgList.map((x) => x.id));
      let changed = false;
      setLocalUiBubbles((prev) => {
        const list = Array.isArray(prev) ? prev : [];
        const next = list.map((b) => {
          if (String(b?.roomId || '') !== roomId) return b;
          const aid = String(b?.anchorId || '').trim();
          if (!aid || aid === String(UI_TAIL_ANCHOR)) return b;
          if (msgIdSet.has(aid)) return b;

          const bTsRaw = Date.parse(String(b?.created_at || ''));
          const bTs = Number.isFinite(bTsRaw) ? bTsRaw : Number.POSITIVE_INFINITY;
          let candidate = null;
          for (const m of msgList) {
            const mts = Number.isFinite(m.ts) ? m.ts : Number.NEGATIVE_INFINITY;
            if (mts <= bTs) candidate = m.id;
            else break;
          }
          if (!candidate) {
            candidate = msgList[msgList.length - 1]?.id || '';
          }
          if (!candidate || candidate === aid) return b;
          changed = true;
          return { ...b, anchorId: candidate };
        });
        return changed ? next : list;
      });
    } catch (e) {
      try { console.warn('[ChatPage] local ui bubble re-anchor failed:', e); } catch (_) {}
    }
  }, [chatRoomId, messages, UI_TAIL_ANCHOR]);

  const formatSimStatusPlainText = (simStatusObj) => {
    /**
     * ✅ 상태창 텍스트 직렬화(SSOT: UI 렌더링)
     *
     * 의도/원리:
     * - status/sim_info 말풍선을 "일반 말풍선과 동일한 UI"로 텍스트만 보여준다.
     * - 같은 규칙을 스트리밍/비스트리밍 표시에서 공유해 출력이 달라지지 않게 한다.
     */
    try {
      const rows = Array.isArray(simStatusObj?.rows) ? simStatusObj.rows : [];
      const goalHint = (simStatusObj && typeof simStatusObj.goalHint === 'string') ? simStatusObj.goalHint.trim() : '';
      const errMsg = (simStatusObj && typeof simStatusObj.error === 'string') ? simStatusObj.error.trim() : '';
      const out = ['INFO(스탯)'];
      if (goalHint) out.push(`목표 : ${goalHint}`);
      for (const r of rows.slice(0, 12)) {
        const label = String(r?.label || r?.id || '').trim();
        if (!label) continue;
        const v = Number(r?.value ?? 0);
        const value = Number.isFinite(v) ? Math.trunc(v) : 0;
        const d = (r?.delta !== null && r?.delta !== undefined) ? Number(r.delta) : null;
        const delta = (d !== null && Number.isFinite(d) && d !== 0) ? Math.trunc(d) : null;
        const deltaTxt = (delta === null) ? '' : ` (${delta > 0 ? `+${delta}` : `${delta}`})`;
        out.push(`${label} : ${value}${deltaTxt}`);
      }
      if (errMsg) out.push(errMsg);
      return out.join('\n');
    } catch (_) {
      return 'INFO(스탯)';
    }
  };

  const startLocalBubbleStream = useCallback((id, fullForDisplay) => {
    /**
     * ✅ 로컬 UI 말풍선 스트리밍(가짜 타이핑)
     *
     * 의도:
     * - !스탯으로 호출한 상태창도 "지문/대사처럼" 자연스럽게 등장하게 한다.
     *
     * 방어:
     * - 새 스트림이 시작되면 이전 타이머를 즉시 취소한다(중복/경합 방지).
     * - 실패해도 전체 채팅 UX는 유지되어야 한다.
     */
    try {
      uiLocalBubbleCancelSeqRef.current += 1;
      const token = uiLocalBubbleCancelSeqRef.current;
      if (uiLocalBubbleTimerRef.current) {
        clearInterval(uiLocalBubbleTimerRef.current);
        uiLocalBubbleTimerRef.current = null;
      }
      const full = String(fullForDisplay || '');
      if (!id || !full.trim()) {
        setUiLocalBubbleStream({ id: '', full: '', shown: '' });
        return;
      }
      setUiLocalBubbleStream({ id, full, shown: '' });

      const intervalMs = 33;
      const cps = Math.max(10, Math.min(120, Number(typingSpeed || 40) || 40)); // chars per second
      const totalMs = Math.max(450, Math.min(1800, Math.round((full.length / cps) * 1000)));
      const steps = Math.max(1, Math.ceil(totalMs / intervalMs));
      const chunk = Math.max(1, Math.ceil(full.length / steps));
      let idx = 0;

      uiLocalBubbleTimerRef.current = setInterval(() => {
        if (uiLocalBubbleCancelSeqRef.current !== token) {
          try { clearInterval(uiLocalBubbleTimerRef.current); } catch (_) {}
          uiLocalBubbleTimerRef.current = null;
          return;
        }
        idx = Math.min(full.length, idx + chunk);
        const nextShown = full.slice(0, idx);
        setUiLocalBubbleStream((prev) => {
          if (!prev || String(prev.id || '') !== String(id)) return prev;
          return { ...prev, shown: nextShown };
        });
        if (idx >= full.length) {
          try { clearInterval(uiLocalBubbleTimerRef.current); } catch (_) {}
          uiLocalBubbleTimerRef.current = null;
          // 완료 후 상태 유지(그대로 두면 렌더는 shown=full로 고정)
          setUiLocalBubbleStream((prev) => {
            if (!prev || String(prev.id || '') !== String(id)) return prev;
            return { ...prev, shown: full };
          });
        }
      }, intervalMs);
    } catch (e) {
      try { console.error('[ChatPage] startLocalBubbleStream failed:', e); } catch (_) {}
    }
  }, [typingSpeed]);

  // ✅ 언마운트 시 로컬 스트리밍 타이머 정리
  useEffect(() => {
    return () => {
      try {
        uiLocalBubbleCancelSeqRef.current += 1;
        if (uiLocalBubbleTimerRef.current) clearInterval(uiLocalBubbleTimerRef.current);
        uiLocalBubbleTimerRef.current = null;
      } catch (_) {}
    };
  }, []);

  const pushLocalAssistantBubble = useCallback((roomId, kind, payload, opts = null) => {
    try {
      const anchorId = (() => {
        try {
          const a = opts && typeof opts === 'object' ? String(opts.anchorId || '').trim() : '';
          return a || UI_TAIL_ANCHOR;
        } catch (_) {
          return UI_TAIL_ANCHOR;
        }
      })();
      const id = `local-${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const msg = {
        id,
        roomId,
        created_at: new Date().toISOString(),
        anchorId,
        kind,
        payload: payload || null,
      };
      setLocalUiBubbles((prev) => ([...(Array.isArray(prev) ? prev : []), msg]));
      // ✅ status는 "요청 시 1회" 스트리밍 가능(요구사항)
      try {
        const wantStream = Boolean(opts && typeof opts === 'object' && opts.stream) && String(kind || '').toLowerCase() === 'status';
        if (wantStream) {
          const full = formatSimStatusPlainText(payload || null);
          startLocalBubbleStream(id, full);
        }
      } catch (_) {}
      try { autoScrollRef.current = true; } catch (_) {}
      try {
        window.requestAnimationFrame(() => {
          // ✅ TDZ 방지: scrollToBottom은 아래에서 선언되므로 여기서는 직접 scrollIntoView로만 처리한다.
          try { messagesEndRef.current?.scrollIntoView({ block: 'end' }); } catch (_) {}
        });
      } catch (_) {}
    } catch (e) {
      console.error('[ChatPage] pushLocalAssistantBubble failed:', e);
    }
  }, [UI_TAIL_ANCHOR, formatSimStatusPlainText, startLocalBubbleStream]);

  // ✅ 시뮬 상태창 자동 출력: "모델 설정 > 추가 설정"에서만 제어(요구사항)
  // - 입력창에 토글 버튼은 노출하지 않는다.
  // - 저장 위치(SSOT): localStorage 'cc:chat:settings:v1'.sim_status_auto (boolean)
  useEffect(() => {
    if (!isSimulatorChat) return;
    const apply = () => {
      try {
        const raw = localStorage.getItem('cc:chat:settings:v1');
        if (!raw) {
          // ✅ 정책 변경(요구사항): 스탯은 "호출(!스탯)"했을 때만 1회 보여주는 게 기본.
          // - 자동 상태창은 사용자가 "모델 설정 > 추가 설정"에서 명시적으로 ON했을 때만 동작한다.
          setSimStatusEnabled(false);
          return;
        }
        const parsed = JSON.parse(raw);
        if (typeof parsed?.sim_status_auto === 'boolean') {
          setSimStatusEnabled(Boolean(parsed.sim_status_auto));
          return;
        }
        setSimStatusEnabled(false);
      } catch (_) {
        setSimStatusEnabled(false);
      }
    };
    apply();
    const onChanged = () => apply();
    try { window.addEventListener('chat:settingsUpdated', onChanged); } catch (_) {}
    return () => {
      try { window.removeEventListener('chat:settingsUpdated', onChanged); } catch (_) {}
    };
  }, [isSimulatorChat]);

  // ✅ 시뮬이면: meta에서 상태 스냅샷을 미리 1회 로드(오프닝 info/!스탯 즉시 반응)
  useEffect(() => {
    if (!chatRoomId) return;
    if (isOrigChat) return;
    if (!isSimulatorChat) return;
    if (!isAuthenticated) return;
    let cancelled = false;
    (async () => {
      try {
        if (cancelled) return;
        await fetchSimStatusSnapshot(chatRoomId);
      } catch (_) {}
    })();
    return () => { cancelled = true; };
  }, [chatRoomId, isOrigChat, isSimulatorChat, isAuthenticated, fetchSimStatusSnapshot]);

  // ✅ 자동 상태창: 시뮬 + 토글 ON이면, 새 assistant 메시지 뒤에 status 말풍선을 1회 붙인다.
  useEffect(() => {
    if (!chatRoomId) return;
    if (isOrigChat) return;
    if (!isSimulatorChat) return;
    if (!simStatusEnabled) return;
    // ✅ 재입장/히스토리 로딩 중에는 상태창을 끼워 넣지 않는다(UX: 본문/대사보다 먼저 떠서 혼란).
    if (historyLoading) return;
    // ✅ 가짜 스트리밍 중에는 상태창을 끼워 넣지 않는다(순서 꼬임 방지).
    // - TDZ 방어: uiStreamingActive/uiIntroStreamingActive는 아래에서 선언되므로 여기서는 state로 즉시 계산한다.
    const uiStreamingActiveNow = Boolean(uiStream?.id && uiStream?.full && uiStream?.shown !== uiStream?.full);
    const uiIntroStreamingActiveNow = Boolean(uiIntroStream?.id && uiIntroStream?.full && uiIntroStream?.shown !== uiIntroStream?.full);
    if (uiStreamingActiveNow || uiIntroStreamingActiveNow) return;
    // ✅ 초기 1회 히스토리 하이드레이션 전에는 끼워 넣지 않는다.
    try { if (!uiStreamHydratedRef.current) return; } catch (_) {}
    try {
      const arr = Array.isArray(messages) ? messages : [];
      // 마지막 non-system assistant 메시지 찾기
      let lastAi = null;
      for (let i = arr.length - 1; i >= 0; i -= 1) {
        const m = arr[i];
        const sender = String(m?.senderType || m?.sender_type || '').toLowerCase();
        if (sender !== 'assistant') continue;
        const kind = String(m?.message_metadata?.kind || '').toLowerCase();
        if (kind === 'intro' || kind === 'status' || kind === 'sim_info') continue;
        lastAi = m;
        break;
      }
      if (!lastAi) return;
      const msgId = String(lastAi?.id || lastAi?._id || '').trim();
      if (!msgId) return;
      (async () => {
        const snap = await fetchSimStatusSnapshot(chatRoomId);
        if (!snap) return;
        // ✅ 너무 자주 나오는 문제 해결:
        // - 자동 상태창은 "스탯 변화량(delta)이 실제로 있을 때"만 1회 출력한다.
        const deltaTurn = (snap?.delta_turn !== null && snap?.delta_turn !== undefined) ? Number(snap.delta_turn) : null;
        const deltaById = (snap?.delta_by_id && typeof snap.delta_by_id === 'object') ? snap.delta_by_id : null;
        const hasDelta = Boolean(deltaById && Object.keys(deltaById).length > 0 && deltaTurn !== null && Number.isFinite(deltaTurn));
        if (!hasDelta) return;
        if (lastAutoStatusTurnRef.current !== null && Number(lastAutoStatusTurnRef.current) === Number(deltaTurn)) return;
        const introMsg = (() => {
          try {
            const it = arr.find((x) => String(x?.message_metadata?.kind || '').toLowerCase() === 'intro');
            return it ? String(it?.content || '') : '';
          } catch (_) { return ''; }
        })();
        const payload = buildSimStatusPayload(snap, introMsg);
        // 마지막 턴 변화량 기준으로 1회만
        try { lastAutoStatusTurnRef.current = Math.floor(deltaTurn); } catch (_) {}
        try { lastAutoStatusByMsgIdRef.current = msgId; } catch (_) {}
        pushLocalAssistantBubble(chatRoomId, 'status', payload, { anchorId: msgId });
      })();
    } catch (e) {
      console.error('[ChatPage] auto status bubble failed:', e);
    }
  }, [messages, chatRoomId, isOrigChat, isSimulatorChat, simStatusEnabled, historyLoading, uiStream, uiIntroStream, fetchSimStatusSnapshot, buildSimStatusPayload, pushLocalAssistantBubble]);

  // ✅ 일반챗: 룸이 준비되면 1회 진행률 로드(채팅영역 상단 UI용)
  useEffect(() => {
    if (isOrigChat) return;
    if (!isAuthenticated) return;
    if (!chatRoomId) return;
    let cancelled = false;
    (async () => {
      try {
        if (cancelled) return;
        await refreshGeneralChatProgress(chatRoomId);
      } catch (_) {}
    })();
    return () => { cancelled = true; };
  }, [isOrigChat, isAuthenticated, chatRoomId, refreshGeneralChatProgress]);

  /**
   * ✅ 새로고침/탭 재로드에도 "응답 생성 중" UX를 유지하기 위한 세션 플래그
   *
   * 의도:
   * - 소켓 aiTyping/origTurnLoading은 새로고침 시 초기화된다.
   * - 하지만 서버는 계속 응답 생성 중일 수 있어, 사용자 입장에서는 "... 로딩"이 사라지면 불안/오류로 오해한다.
   *
   * 구현(방어):
   * - roomId 기준으로 sessionStorage에 타임스탬프를 기록하고,
   *   응답(assistant)이 도착하면 자동으로 제거한다.
   * - TTL을 둬서 영구히 남는 것을 방지한다.
   */
  const TYPING_PERSIST_TTL_MS = 5 * 60 * 1000;
  const buildTypingPersistKey = useCallback((rid) => `cc:chat:typing:v1:${rid || 'none'}`, []);
  const markTypingPersist = useCallback((rid, kind = 'chat') => {
    try {
      const room = String(rid || '').trim();
      if (!room) return;
      const now = Date.now();
      const k = buildTypingPersistKey(room);
      sessionStorage.setItem(k, JSON.stringify({ ts: now, kind }));
      setPersistedTypingTs(now);
    } catch (_) {}
  }, [buildTypingPersistKey]);
  const clearTypingPersist = useCallback((rid) => {
    try {
      const room = String(rid || '').trim();
      if (!room) return;
      const k = buildTypingPersistKey(room);
      sessionStorage.removeItem(k);
    } catch (_) {}
    try { setPersistedTypingTs(null); } catch (_) {}
  }, [buildTypingPersistKey]);

  /**
   * ✅ 원작챗: 삭제된 작품(원작) 처리
   *
   * 요구사항:
   * - 작품(스토리)이 삭제되면,
   *   - 접근 시: "삭제된 작품입니다" 안내
   *   - 채팅 중(턴 요청 시): "삭제된 작품입니다" 안내 후 강제 종료
   *
   * 동작:
   * - 백엔드가 410(Gone) 또는 "삭제된 작품" 문구(detail)를 반환하면 삭제 케이스로 간주한다.
   * - UX: 토스트 안내 + (옵션) 홈으로 이동(강제 종료)
   * - 방어: 로컬 최근방 캐시를 제거해 재진입 루프를 막는다.
   *
   * @returns {boolean} true면 "삭제된 작품" 케이스로 처리 완료(호출부는 재시도/추가처리 금지)
   */
  const handleOrigchatDeleted = useCallback((err, opts = { navigateAway: true }) => {
    try {
      const rid = chatRoomIdRef.current || null;
      const status = err?.response?.status;
      const detail = String(err?.response?.data?.detail || err?.message || '').trim();
      // ✅ 410(Gone)은 명시적으로 "삭제" 의미.
      // ✅ 일부 케이스(스토리/캐릭터/룸이 DB에서 사라져 404가 나는 경우)도 원작챗 컨텍스트에서는 삭제로 간주한다.
      let src = '';
      let sid = '';
      try {
        const params = new URLSearchParams(location.search || '');
        src = String(params.get('source') || '');
        sid = String(params.get('storyId') || '');
      } catch (_) {}
      const inOrigchat = String(src).toLowerCase() === 'origchat';
      const isDeleted = (
        status === 410 ||
        detail.includes('삭제된 작품') ||
        (
          inOrigchat &&
          status === 404 &&
          (
            detail.includes('스토리를 찾을 수 없습니다') ||
            detail.includes('채팅방을 찾을 수 없습니다') ||
            detail.includes('캐릭터를 찾을 수 없습니다')
          )
        )
      );
      if (!isDeleted) return false;

      const msg = '삭제된 작품입니다';
      showToastOnce({
        key: `origchat-deleted:${rid || 'unknown'}`,
        type: 'error',
        message: msg,
      });

      // 로컬 최근 방 캐시 제거(재진입 루프 방지)
      try {
        if (src === 'origchat' && sid) {
          const k = `cc:lastRoom:${user?.id || 'anon'}:${characterId || 'none'}:${sid || 'none'}:origchat`;
          localStorage.removeItem(k);
        }
      } catch (_) {}

      if (opts?.navigateAway) {
        try { if (rid) leaveRoom?.(rid); } catch (_) {}
        try { navigate('/', { replace: true }); } catch (_) {}
      }
      return true;
    } catch (_) {
      return false;
    }
  }, [leaveRoom, navigate, location.search, user?.id, characterId]);

  /**
   * ✅ 비공개(접근 불가) 처리: 경고 모달
   *
   * 요구사항(최신):
   * - 비공개된 웹소설/캐릭터챗/원작챗은 모두 접근 불가 → 경고 모달을 띄운다.
   *
   * @returns {boolean} true면 접근 불가로 처리 완료(호출부는 추가 처리/재시도 금지)
   */
  const handleAccessDenied = useCallback((err) => {
    try {
      const status = err?.response?.status;
      if (status !== 403) return false;

      const detailRaw = err?.response?.data?.detail || err?.message || '';
      const detail = String(detailRaw || '').trim();
      const msg = detail || '접근할 수 없습니다.';

      // ✅ 모달을 띄우고, 화면이 하얗게 깨지지 않도록 error도 안전 메시지로 세팅한다.
      setAccessDeniedModal({ open: true, message: msg });
      try { setError(msg); } catch (_) {}
      return true;
    } catch (_) {
      return false;
    }
  }, []);

  /**
   * ✅ 원작챗 수동 동기화:
   * - 원작챗은 Socket.IO 실시간 브로드캐스트가 아니라 REST로 메시지를 저장/조회한다.
   * - 그래서 모바일↔PC를 번갈아 사용할 때 현재 탭이 자동으로 최신 메시지를 못 받을 수 있다.
   * - 유저가 헤더의 ↻(동기화) 버튼을 누르면 DB 기준 최신 메시지 + 메타를 즉시 다시 로드한다.
   */
  const handleOrigSync = useCallback(async () => {
    if (!chatRoomId || !isOrigChat) return;
    // 생성/턴 처리 중에는 상태 경쟁을 피한다.
    if (origTurnLoading || origSyncLoading) return;

    setOrigSyncLoading(true);
    try {
      // 1) 메타 갱신(진행도/모드 등)
      const metaRes = await chatAPI.getRoomMeta(chatRoomId);
      const meta = metaRes?.data || {};
      setOrigMeta(prev => ({
        ...(prev || {}),
        turnCount: Number(meta.turn_count || meta.turnCount || 0) || 0,
        maxTurns: Number(meta.max_turns || meta.maxTurns || 500) || 500,
        completed: Boolean(meta.completed),
        mode: meta.mode || (prev?.mode || null),
        narrator_mode: Boolean(meta.narrator_mode),
        seed_label: meta.seed_label || null,
        init_stage: meta.init_stage || prev?.init_stage || null,
        intro_ready: typeof meta.intro_ready === 'boolean' ? meta.intro_ready : (prev?.intro_ready ?? null),
      }));

      // 2) 메시지 갱신(서버 SSOT) - 최근 기준(tail)
      const resp = await chatAPI.getMessages(chatRoomId, { tail: 1, skip: 0, limit: 200 });
      const serverMessages = Array.isArray(resp?.data) ? resp.data : [];
      setMessages(serverMessages);

      // 3) 선택지 복원(plain 모드는 의도적으로 스킵)
      try {
        const mode = (meta.mode || '').toLowerCase();
        if (mode !== 'plain') {
          if (meta.pending_choices_active) {
            try {
              const choiceResp = await origChatAPI.turn({
                room_id: chatRoomId,
                trigger: 'choices',
                idempotency_key: `sync-${Date.now()}`
              });
              const choiceMeta = choiceResp.data?.meta || {};
              if (Array.isArray(choiceMeta.choices) && choiceMeta.choices.length > 0) {
                setPendingChoices(choiceMeta.choices);
              }
            } catch (e) {
              // 삭제된 작품이면 강제 종료
              if (handleOrigchatDeleted(e)) return;
              if (handleAccessDenied(e)) return;
            }
          } else if (Array.isArray(meta.initial_choices) && meta.initial_choices.length > 0 && serverMessages.length <= 1) {
            setPendingChoices(meta.initial_choices);
          }
        }
      } catch (_) {}

      // 4) UX: 최신 메시지로 이동(유저가 바닥에 있던 경우)
      try {
        autoScrollRef.current = true;
        window.requestAnimationFrame(() => {
          try { scrollToBottom(); } catch (_) {}
        });
      } catch (_) {}

      // 안내 힌트는 동기화 클릭 시 바로 닫는다(자연스러운 학습)
      try { setShowOrigSyncHint(false); } catch (_) {}
    } catch (e) {
      console.error('[ChatPage] origchat sync failed:', e);
      if (handleOrigchatDeleted(e)) return;
      if (handleAccessDenied(e)) return;
      showToastOnce({ key: `origchat-sync-fail:${chatRoomId}`, type: 'error', message: '동기화에 실패했습니다. 잠시 후 다시 시도해주세요.' });
    } finally {
      setOrigSyncLoading(false);
    }
  }, [chatRoomId, isOrigChat, origTurnLoading, origSyncLoading, setMessages, handleOrigchatDeleted, handleAccessDenied]);

  // ✅ 원작챗 "수동 동기화" 힌트: 각 브라우저에서 첫 1회만 짧게 노출(모바일/PC 모두 동일)
  useEffect(() => {
    if (!isOrigChat) return;
    const LS_KEY = 'origchat_sync_hint_seen_v1';
    try {
      if (localStorage.getItem(LS_KEY) === '1') return;
      localStorage.setItem(LS_KEY, '1'); // 한번만 보여주기(브라우저 단위)
    } catch (_) {}

    setShowOrigSyncHint(true);
    try {
      if (origSyncHintTimerRef.current) clearTimeout(origSyncHintTimerRef.current);
      origSyncHintTimerRef.current = setTimeout(() => setShowOrigSyncHint(false), 6500);
    } catch (_) {}

    return () => {
      try {
        if (origSyncHintTimerRef.current) clearTimeout(origSyncHintTimerRef.current);
        origSyncHintTimerRef.current = null;
      } catch (_) {}
    };
  }, [isOrigChat]);
  
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
    /**
     * ✅ 오해 방지: AI가 "입력 중"(ai_typing_start)인 동안에는 전송 지연 팝업을 띄우지 않는다.
     *
     * 이유:
     * - 현재 채팅 서버는 ACK를 "전송 수신" 시점이 아니라 "AI 응답 생성 완료" 시점에 보낸다.
     * - 그래서 정상적으로 답변을 생성 중인 경우에도 pending이 3초 이상 유지되어
     *   '전송 지연' 팝업이 자주 뜨며, 유저가 오류로 오해해 새로고침/이탈할 수 있다.
     * - aiTyping이 true면 정상 처리 중이므로, 팝업 대신 상단 '입력 중' UI만으로 충분하다.
     */
    if (aiTyping) {
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
    // SSE 경로 보호:
    // - 스트림 첫 델타 대기 중이거나, assistant 스트리밍 말풍선이 이미 보이면
    //   "소켓 전송 지연" 팝업은 오탐이므로 비활성화한다.
    const hasStreamingAssistant = (() => {
      try {
        return Array.isArray(messages) && messages.some((m) => {
          const t = String(m?.senderType || m?.sender_type || '').toLowerCase();
          if (t !== 'assistant' && t !== 'ai' && t !== 'character') return false;
          return Boolean(m?.isStreaming);
        });
      } catch (_) {
        return false;
      }
    })();
    if (sseAwaitingFirstDelta || hasStreamingAssistant) {
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
  }, [isOrigChat, connected, messages, aiTyping, sseAwaitingFirstDelta]);

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

  /**
   * 오프닝 지문 스트리밍 표시용 HTML -> 텍스트 정규화
   *
   * 의도:
   * - intro가 HTML(<img>/<a>/태그)일 때도 지문박스 스트리밍 체감을 유지한다.
   * - 스트리밍 중에는 텍스트로 안전하게 보여주고, 완료 후 full HTML 렌더로 전환한다.
   */
  const normalizeIntroStreamText = useCallback((value) => {
    try {
      const raw = String(value || '');
      if (!raw) return '';
      if (!hasChatHtmlLike(raw)) return raw;
      const safeHtml = sanitizeChatMessageHtml(raw);
      if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
        const el = document.createElement('div');
        el.innerHTML = safeHtml;
        return String(el.textContent || el.innerText || '').replace(/\s+\n/g, '\n').trim();
      }
      return safeHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    } catch (_) {
      return String(value || '');
    }
  }, []);

  /**
   * 세이프티/정책 거절 응답 감지 + 한국어 안내 문구 렌더링용 변환
   *
   * 의도/동작:
   * - 현재 일반 캐릭터챗은 "완성본"을 한 번에 받는 구조라, 모델이 정책 거절을 반환하면 그대로 화면에 노출된다.
   * - UX 관점에서 영어 거절 템플릿이 그대로 보이면 이탈이 커서, 화면 표시용으로만 한국어 안내/대안을 제공한다.
   * - 원본(message.content)은 변경하지 않는다(로그/디버깅/재생성/백엔드 저장 정합 보호).
   *
   * 방어적 설계:
   * - 모델별 템플릿이 조금씩 달라서, 과도하게 넓지 않은 "대표 패턴"만 탐지한다.
   * - 오탐을 줄이기 위해 2개 이상 키워드 매칭을 기본으로 한다.
   */
  // ✅ 테스트/디버깅: 안전거절 "표시용 변환"을 끄고 원문을 그대로 본다.
  // - 실제 모델/백엔드 거절인지, 프론트 오탐인지 판단이 가능해진다.
  // - 운영 테스트를 위해 build-time env로도 끌 수 있다.
  // - 방법:
  //   1) URL에 ?nosafety=1
  //   2) localStorage: cc:debug:nosafety=1
  //   3) Vite env: VITE_DISABLE_SAFETY_UI=1
  const bypassSafetyUiRef = useRef(false);
  useEffect(() => {
    try {
      const params = new URLSearchParams(location.search || '');
      const byParam = String(params.get('nosafety') || '').trim() === '1';
      const byStorage = (() => {
        try { return String(localStorage.getItem('cc:debug:nosafety') || '').trim() === '1'; } catch (_) { return false; }
      })();
      const byEnv = String(import.meta.env.VITE_DISABLE_SAFETY_UI || '').trim() === '1';
      bypassSafetyUiRef.current = Boolean(byEnv || byParam || byStorage);
    } catch (_) {
      bypassSafetyUiRef.current = false;
    }
  }, [location.search]);

  const formatSafetyRefusalForDisplay = useCallback((text, messageMetadata = null) => {
    const s = String(text || '').trim();
    if (!s) return s;

    // ✅ 디버그 모드: 원문 그대로 표시
    try {
      if (bypassSafetyUiRef.current) return s;
    } catch (_) {}

    // ✅ 서버가 safety_blocked로 확정한 경우(가장 정확): 텍스트 휴리스틱 대신 바로 안내문으로 표시
    try {
      if (messageMetadata && typeof messageMetadata === 'object' && messageMetadata.safety_blocked) {
        return [
          '요청하신 내용은 안전 정책상 진행할 수 없어요.',
          '대신 안전한 범위에서 상황을 이어갈 수 있어요.',
          '원하시면 분위기(달달/긴장/서늘함)랑 상황(장소/시간/갈등)을 한 줄로만 말해줘요.'
        ].join('\n');
      }
    } catch (_) {}

    const lower = s.toLowerCase();
    const hit = (re) => {
      try { return re.test(s) || re.test(lower); } catch (_) { return false; }
    };

    // 영어/한국어에서 자주 보이는 "정책 거절" 템플릿 키워드들
    const k1 = (
      hit(/not able to continue/) ||
      hit(/can't continue/) ||
      hit(/cannot continue/) ||
      hit(/i can(?:not|'t) help with/) ||
      hit(/explicit sexual/) ||
      hit(/sexual direction/) ||
      hit(/content policy/) ||
      hit(/죄송하지만/) ||
      // "성적"은 (성적표/점수) 오탐이 많아서 "성적인/성적 콘텐츠"만 탐지
      hit(/성적인/) ||
      hit(/성적\s*(?:콘텐츠|묘사|행위|표현)/) ||
      hit(/노골적/) ||
      hit(/정책(상|에 의해|위반)/) ||
      hit(/안전(상|정책)/)
    );
    // "거절/불가" 성격을 더 강하게 확인하는 보조 키워드
    const k2 = (
      hit(/not (?:able|allowed)/) ||
      hit(/unable to/) ||
      hit(/won't/) ||
      hit(/cannot assist/) ||
      hit(/can't assist/) ||
      hit(/refuse/) ||
      hit(/진행할 수 없/) ||
      hit(/도와드릴 수 없/) ||
      hit(/제공할 수 없/)
    );

    // 오탐 방지: 텍스트만으로는 false positive가 치명적이라, 기본은 "2중 키워드" 매칭만 허용
    const isRefusal = (k1 && k2);
    if (!isRefusal) return s;

    // 표시용 한국어 안내(대체)
    return [
      '요청하신 내용은 안전 정책상 진행할 수 없어요.',
      '대신 안전한 범위에서 상황을 이어갈 수 있어요.',
      '원하시면 분위기(달달/긴장/서늘함)랑 상황(장소/시간/갈등)을 한 줄로만 말해줘요.'
    ].join('\n');
  }, []);

  // 설정 변경 적용 유틸(허용 키만 병합 + 저장 + 다음 턴 동기화 플래그)
  const updateChatSettings = useCallback((patch) => {
    try {
      const allowed = ['postprocess_mode','next_event_len','response_length_pref','prewarm_on_start','temperature'];
      const clean = Object.fromEntries(Object.entries(patch || {}).filter(([k]) => allowed.includes(k)));
      const merged = { ...defaultChatSettings, ...chatSettings, ...clean };
      // ✅ 로컬 저장 스키마 버전(마이그레이션용)
      merged.schema_version = 2;
      // 간단 유효성
      if (!['always','first2','off'].includes(String(merged.postprocess_mode))) merged.postprocess_mode = 'off';
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

    // ✅ new=1 진입 시 워밍 폴링 cleanup을 "effect return"로 빼앗지 않도록 분리
    // - 기존 구현은 new=1일 때 `return () => { mounted=false }`로 조기 return 되어,
    //   아래의 UI 설정 로드/리스너 등록이 스킵되어 탭 간 UI가 달라졌다.
    let warmMounted = true;
    let initMounted = true;
    let warmTimer = null;
    const stopWarmPoll = () => {
      warmMounted = false;
      try {
        if (warmTimer) clearTimeout(warmTimer);
      } catch (_) {}
      warmTimer = null;
    };

    const initializeChat = async () => {
      setLoading(true);
      setError('');
      try {
        /**
         * ✅ 치명 버그 방지(상태 누수 차단):
         * - 같은 `ChatPage` 라우트에서 (원작챗 → 일반챗)처럼 캐릭터만 바뀌면 컴포넌트가 언마운트되지 않아
         *   `isOrigChat`/선택지/메타가 그대로 남을 수 있다.
         * - 이 상태로 일반챗을 열면 "선택지"가 뜨거나 turn API를 호출하는 등 원작챗처럼 오동작한다.
         * - 따라서 초기화 단계에서 원작챗 관련 상태를 항상 리셋하고, 아래에서 조건에 맞으면 다시 켠다.
         */
        try {
          setIsOrigChat(false);
          setOrigAnchor(null);
          setOrigStoryId(null);
          setOrigTotalChapters(null);
          setOrigRangeFrom(null);
          setOrigRangeTo(null);
          setOrigTurnLoading(false);
          setLastOrigTurnPayload(null);
          setPendingChoices([]);
          setChoiceLocked(false);
          setOrigSyncLoading(false);
          setShowOrigSyncHint(false);
          setRangeWarning('');
          setOrigMeta({ turnCount: null, maxTurns: null, completed: false, mode: null, init_stage: null, intro_ready: null });
        } catch (_) {}

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
          /**
           * ✅ 상황이미지 공개/비공개(요구사항)
           *
           * - 기본값은 공개.
           * - 비공개 이미지는 "다른 유저"에게 채팅방/미니갤러리에 보이지 않아야 한다.
           * - 크리에이터(소유자)/관리자는 모두 볼 수 있다.
           */
          const canSeePrivate = (() => {
            try {
              if (!isAuthenticated) return false;
              const uid = user?.id;
              if (uid && data?.creator_id && uid === data.creator_id) return true;
              if (user?.is_admin) return true;
              return false;
            } catch (_) {
              return false;
            }
          })();
          const safeDescriptions = Array.isArray(data?.image_descriptions)
            ? data.image_descriptions.filter((d) => canSeePrivate || d?.is_public !== false)
            : [];
          const gallery = safeDescriptions.map((d) => d?.url).filter(Boolean);
          const fallback = !main.length && !gallery.length && data?.thumbnail_url ? [data.thumbnail_url] : [];
          baseImages = [...main, ...gallery, ...fallback];
          
          // 🎯 키워드 트리거용 이미지 데이터 저장
          if (safeDescriptions.length > 0) {
            setImageKeywords(safeDescriptions.map((d, idx) => ({
              url: d?.url || '',
              keywords: Array.isArray(d?.keywords) ? d.keywords : [],
              index: main.length ? idx + 1 : idx  // avatar_url이 있으면 +1
            })));
          }
        } catch (_) {
          // ✅ 방어: storyIdParam은 아래에서 선언되므로(Temporal Dead Zone) 여기서 참조하면 런타임 에러가 날 수 있다.
          // 컨텍스트 워밍 실패는 키를 고정해도 충분(중복 토스트 방지 목적).
          showToastOnce({ key: 'ctx-warm-fail', type: 'warning', message: '컨텍스트 준비가 지연되고 있습니다.' });
        }

        // mediaAPI 자산과 병합
        // ✅ 성능/안정성: 미디어 조회는 채팅방 진입을 블로킹하지 않는다.
        const applyImageSet = (images) => {
          if (!Array.isArray(images) || images.length === 0) return;
          setCharacterImages(images);
          if (isPinnedRef.current && pinnedUrlRef.current) {
            const idx = images.findIndex(u => u === pinnedUrlRef.current);
            setCurrentImageIndex(idx >= 0 ? idx : 0);
          } else {
            setCurrentImageIndex(0);
          }
        };
        if (baseImages.length) applyImageSet(baseImages);
        void (async () => {
          try {
            const mediaRes = await Promise.race([
              mediaAPI.listAssets({ entityType: 'character', entityId: characterId, presign: false, expiresIn: 300 }),
              new Promise((_, reject) => setTimeout(() => reject(new Error('media_assets_timeout')), 3500)),
            ]);
            if (!initMounted) return;
            const assets = Array.isArray(mediaRes.data?.items) ? mediaRes.data.items : (Array.isArray(mediaRes.data) ? mediaRes.data : []);
            setMediaAssets(assets);
            const mediaUrls = assets.map(a => a.url).filter(Boolean);
            const allImages = Array.from(new Set([...(baseImages || []), ...mediaUrls]));
            if (allImages.length) applyImageSet(allImages);
          } catch (_) {
            if (!initMounted) return;
            if (baseImages.length) applyImageSet(baseImages);
          }
        })();

        /**
         * ✅ 게스트 모드(요구사항)
         *
         * - 게스트는 채팅 화면까지는 진입 가능
         * - 하지만 방 생성/세션 조회/소켓 조인 등 "인증 필요" 작업은 수행하지 않는다.
         * - 전송 버튼을 누르는 순간에만 로그인 모달을 띄운다(handleSendMessage).
         */
        // ✅ URL 파라미터: 유저가 선택한 오프닝(start_set) 우선 적용
        // - opening, opening_id 두 개의 파라미터 이름을 모두 지원 (하위호환)
        const openingParam = (() => {
          try {
            const p = new URLSearchParams(location.search || '');
            return String(p.get('opening') || p.get('opening_id') || '').trim();
          } catch (_) {
            return '';
          }
        })();

        if (!isAuthenticated) {
          /**
           * ✅ 게스트 진입 시 "도입부/첫대사(인사말)" 미리보기 노출(요구사항)
           *
           * 원리:
           * - 게스트는 인증이 없어 방 생성/히스토리 로드(서버 SSOT)를 할 수 없다.
           * - 대신 캐릭터 공개 데이터(start_sets/intro+firstLine, 또는 레거시 greeting/introduction_scenes)를
           *   프론트에서 1회 메시지처럼 렌더링한다.
           *
           * 주의:
           * - 이 메시지들은 DB에 저장되지 않는다(프리뷰).
           * - 전송/요술봉 등 액션은 handleSendMessage/handleToggleMagicMode에서 로그인 모달로 유도한다.
           */
          const extractFirstStart = (characterData) => {
            // 우선순위: start_sets(SSOT) → introduction_scenes[0] + greeting(레거시)
            try {
              const ss = characterData?.start_sets;
              const items = Array.isArray(ss?.items) ? ss.items : [];
              const selectedId = String(ss?.selectedId || ss?.selected_id || '').trim();
              const pickedByOpening = openingParam
                ? (items.find((x) => String(x?.id || '').trim() === openingParam) || null)
                : null;
              const picked = pickedByOpening
                || items.find((x) => String(x?.id || '').trim() === selectedId)
                || items[0]
                || null;
              const intro = String(picked?.intro || '').trim();
              const firstLine = String(picked?.firstLine || picked?.first_line || '').trim();
              if (intro || firstLine) return { intro, firstLine };
            } catch (_) {}
            try {
              const scenes = Array.isArray(characterData?.introduction_scenes) ? characterData.introduction_scenes : [];
              const intro = String(scenes?.[0]?.content || '').trim();
              const greeting = String(characterData?.greeting || (Array.isArray(characterData?.greetings) ? characterData.greetings[0] : '') || '').trim();
              return { intro, firstLine: greeting };
            } catch (_) {
              return { intro: '', firstLine: '' };
            }
          };

          const { intro, firstLine } = extractFirstStart(data);
          const nm = data?.name || '캐릭터';
          const preview = [];
          const nowIso = new Date().toISOString();
          try {
            const introText = intro ? replacePromptTokens(intro, { assistantName: nm, userName: '당신' }).trim() : '';
            if (introText) {
              preview.push({
                id: `guest-intro-${characterId}`,
                roomId: null,
                senderType: 'assistant',
                sender_type: 'assistant',
                content: introText,
                created_at: nowIso,
                message_metadata: { kind: 'intro' },
              });
            }
          } catch (_) {}
          try {
            const firstLineText = firstLine ? replacePromptTokens(firstLine, { assistantName: nm, userName: '당신' }).trim() : '';
            if (firstLineText) {
              preview.push({
                id: `guest-firstline-${characterId}`,
                roomId: null,
                senderType: 'assistant',
                sender_type: 'assistant',
                content: firstLineText,
                created_at: nowIso,
              });
            }
          } catch (_) {}

          try { setChatRoomId(null); } catch (_) {}
          try { setMessages(preview); } catch (_) {}
          try { setLoading(false); } catch (_) {}
          return;
        }

        // 2. 🔥 채팅방 정보 가져오기 또는 생성
        const params = new URLSearchParams(location.search || '');
        const explicitRoom = params.get('room');
        const forceNew = (params.get('new') === '1') && !explicitRoom;
        const source = params.get('source');
        const anchorParam = params.get('anchor');
        const storyIdParam = params.get('storyId');
        const modeParam = params.get('mode');
        const rangeFromParam = params.get('rangeFrom');
        const rangeToParam = params.get('rangeTo');
        // ✅ 서비스 정책: 원작챗은 plain 모드만 사용한다.
        // - URL에 mode가 없거나 다른 값이 있어도, 프론트에서 plain으로 고정해 혼선을 방지한다.
        const modeNorm = (() => {
          try {
            if (source === 'origchat' && storyIdParam) return 'plain';
            return String(modeParam || '').trim().toLowerCase();
          } catch (_) {
            return (source === 'origchat' && storyIdParam) ? 'plain' : '';
          }
        })();

        /**
         * ✅ 새로 대화(new=1) UX/안전:
         * - 기존 룸의 messages가 잠깐 남아있으면 "새로 대화인데 왜 기존 대화방으로 들어가?"처럼 보인다.
         * - 특히 원작챗 plain 모드는 인사말이 백그라운드에서 생성/저장되므로, 첫 메시지 도착 전(0개) 구간이 존재한다.
         * - 이 구간에서 이전 messages 잔상을 제거해 혼란을 막는다.
         */
        if (forceNew) {
          /**
           * ✅ 전환 레이스 방어(치명: 새로 대화인데 이전 방으로 전송)
           *
           * 문제:
           * - `new=1` 진입 직후에도 `chatRoomId`가 잠깐 이전 방을 가리킬 수 있다.
           * - 이 구간에서 사용자가 빠르게 전송하면 새 방이 아닌 이전 방에 메시지가 저장된다.
           *
           * 해결:
           * - new=1 초기화 시점에 현재 room 포인터를 즉시 null로 비운다.
           * - 이후 initialize 흐름에서 새 room이 확정되면 setChatRoomId(roomId)로 교체된다.
           */
          // 일반 캐릭터챗(new=1)에서만 기존 room 포인터를 즉시 비워 오발송을 막는다.
          if (!(source === 'origchat' && storyIdParam)) {
            try { setChatRoomId(null); } catch (_) {}
          }
          try { setMessages([]); } catch (_) {}
          try { setPendingChoices([]); } catch (_) {}
          try { setRangeWarning(''); } catch (_) {}
          // 원작챗 새로 대화는 "준비 중" 오버레이가 자연스럽다(첫 메시지 도착 전까지 입력 차단).
          if (source === 'origchat' && storyIdParam) {
            try { setIsOrigChat(true); } catch (_) {}
            try {
              setOrigMeta((prev) => ({
                ...(prev || {}),
                mode: modeNorm || prev?.mode || null,
                init_stage: 'init',
                intro_ready: false,
              }));
            } catch (_) {}
          } else {
            /**
             * ✅ 일반 캐릭터챗(new=1) 즉시 체감 개선
             *
             * 목표:
             * - "새로 대화" 클릭 직후 로딩 모달 대신 오프닝(지문/첫대사)을 바로 보여준다.
             * - 서버 SSOT(실제 저장 메시지)가 도착하면 기존 히스토리 동기화가 자연스럽게 대체한다.
             *
             * 원리:
             * - 캐릭터 공개 데이터(start_sets 또는 레거시 intro/greeting)로
             *   임시 프리뷰 메시지를 즉시 구성한다.
             * - 오프닝 스트리밍 UI는 기존 로직(uiOpeningStage)을 그대로 재사용한다.
             */
            try {
              const extractFirstStartForNewChat = (characterData) => {
                try {
                  const ss = characterData?.start_sets;
                  const items = Array.isArray(ss?.items) ? ss.items : [];
                  const selectedId = String(ss?.selectedId || ss?.selected_id || '').trim();
                  const pickedByOpening = openingParam
                    ? (items.find((x) => String(x?.id || '').trim() === openingParam) || null)
                    : null;
                  const picked = pickedByOpening
                    || items.find((x) => String(x?.id || '').trim() === selectedId)
                    || items[0]
                    || null;
                  const intro = String(picked?.intro || '').trim();
                  const firstLine = String(picked?.firstLine || picked?.first_line || '').trim();
                  if (intro || firstLine) return { intro, firstLine };
                } catch (_) {}
                try {
                  const scenes = Array.isArray(characterData?.introduction_scenes) ? characterData.introduction_scenes : [];
                  const intro = String(scenes?.[0]?.content || '').trim();
                  const greeting = String(characterData?.greeting || (Array.isArray(characterData?.greetings) ? characterData.greetings[0] : '') || '').trim();
                  return { intro, firstLine: greeting };
                } catch (_) {
                  return { intro: '', firstLine: '' };
                }
              };

              const { intro, firstLine } = extractFirstStartForNewChat(data);
              const nm = data?.name || '캐릭터';
              const nowIso = new Date().toISOString();
              const preview = [];

              const introText = intro ? replacePromptTokens(intro, { assistantName: nm, userName: '당신' }).trim() : '';
              if (introText) {
                preview.push({
                  id: `optimistic-intro-${characterId}-${Date.now()}`,
                  roomId: null,
                  senderType: 'assistant',
                  sender_type: 'assistant',
                  content: introText,
                  created_at: nowIso,
                  message_metadata: { kind: 'intro' },
                });
              }

              const firstLineText = firstLine ? replacePromptTokens(firstLine, { assistantName: nm, userName: '당신' }).trim() : '';
              if (firstLineText) {
                preview.push({
                  id: `optimistic-firstline-${characterId}-${Date.now()}`,
                  roomId: null,
                  senderType: 'assistant',
                  sender_type: 'assistant',
                  content: firstLineText,
                  created_at: nowIso,
                });
              }

              if (preview.length > 0) {
                setMessages(preview);
                setUiOpeningStage('idle');
              }
            } catch (e) {
              try { console.warn('[ChatPage] new chat optimistic opening failed:', e); } catch (_) {}
            }
          }
        }
        
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
        /**
         * ✅ 원작챗 새로대화 중복 생성 방지(치명 UX 방지)
         *
         * 문제:
         * - React StrictMode(개발) / 라우트 전환 / 더블클릭 등으로 `origChatAPI.start()`가 짧은 시간에 2번 호출되면,
         *   같은 의도의 새 대화가 2개 방으로 생성되고(1개는 인사말만 있는 유령 방),
         *   대화내역에 "방이 1개 더 생기는" 문제가 발생한다.
         *
         * 해결(최소 수정/방어적):
         * - new=1(forceNew)일 때만 sessionStorage에 "inflight lock"을 걸고,
         *   같은 파라미터로 재호출되면 기존 결과(roomId)를 재사용한다.
         */
        const buildOrigStartGuardKey = (uid, cid, sid, modeKey, anchorNo, rf, rt) => {
          const m = String(modeKey || 'plain').trim().toLowerCase();
          const a = Number(anchorNo || 1) || 1;
          const rff = (rf === null || rf === undefined || Number.isNaN(rf)) ? 'none' : String(rf);
          const rtt = (rt === null || rt === undefined || Number.isNaN(rt)) ? 'none' : String(rt);
          return `cc:origStartGuard:v1:${uid || 'anon'}:${cid || 'none'}:${sid || 'none'}:${m}:${a}:${rff}:${rtt}`;
        };
        const ORIG_START_GUARD_TTL_MS = 12000;
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

        // ✅ room 파라미터가 있으면 우선 사용한다.
        // - 특히 "새로 대화"에서 선행 start API가 새 room을 생성해 전달한 경우, 이를 신뢰해 즉시 진입한다.
        // - room이 없거나 유효하지 않으면 아래에서 생성 경로로 폴백한다.
        let roomId = explicitRoom || null;
        // room 파라미터 유효성 검사 -> 실패 시 무효화하고 새 방 생성으로 폴백
        if (roomId) {
          try {
            const r = await chatAPI.getChatRoom(roomId);
            const fetchedId = String(r?.data?.id || '').trim();
            const fetchedCharId = String(r?.data?.character_id || r?.data?.character?.id || '').trim();
            const wantedCharId = String(characterId || '').trim();
            if (!fetchedId) {
              console.warn('room param looks invalid, will fallback to new room:', roomId);
              roomId = null;
            } else if (wantedCharId && fetchedCharId && fetchedCharId !== wantedCharId) {
              console.warn('room param character mismatch, will fallback to new room:', { roomId, fetchedCharId, wantedCharId });
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
            // ✅ 서비스 정책: 원작챗은 plain 모드만 사용한다.
            const isOrigChatRoom = raw === 'plain';
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
              const guardKey = buildOrigStartGuardKey(user?.id, characterId, storyIdParam, (modeParam || 'plain'), a, rf, rt);
              const readGuard = () => {
                try {
                  const raw = sessionStorage.getItem(guardKey);
                  if (!raw) return null;
                  const parsed = JSON.parse(raw);
                  const ts = Number(parsed?.ts || 0) || 0;
                  if (!ts) return null;
                  if (Date.now() - ts > ORIG_START_GUARD_TTL_MS) return null;
                  return parsed;
                } catch (_) {
                  return null;
                }
              };
              const waitForGuardRoom = async () => {
                for (let i = 0; i < 24; i += 1) {
                  await new Promise((resolve) => setTimeout(resolve, 250));
                  const g = readGuard();
                  const rid = String(g?.roomId || '').trim();
                  if (rid) return rid;
                }
                return null;
              };
              let createdByThisInit = false;

              // 0) new=1(새로 대화)인 경우: 중복 생성 방지 가드(잠금/대기/재사용)
              if (forceNew) {
                // 이미 생성된 room이 있으면 재사용
                const g0 = readGuard();
                const rid0 = String(g0?.roomId || '').trim();
                if (rid0) {
                  try {
                    const r = await chatAPI.getChatRoom(rid0);
                    if (r?.data?.id) roomId = rid0;
                  } catch (_) {}
                }
                // 다른 init이 생성 중이면 기다렸다가 재사용
                if (!roomId && g0 && g0.pending) {
                  const waited = await waitForGuardRoom();
                  if (waited) {
                    try {
                      const r = await chatAPI.getChatRoom(waited);
                      if (r?.data?.id) roomId = waited;
                    } catch (_) {}
                  }
                }
              }

              // 1) 아직 room이 없으면 실제 start 호출
              if (!roomId) {
                const startFn = async () => {
                  const startRes = await origChatAPI.start({ 
                    story_id: storyIdParam, 
                    character_id: characterId, 
                    mode: 'plain',
                    // ✅ new=1(새로 대화)일 때는 백엔드가 기존 plain 방을 재사용하지 않도록 강제한다.
                    force_new: !!forceNew,
                    start: { chapter: a }, 
                    range_from: rf, 
                    range_to: rt, 
                    pov: 'possess'
                  });
                  return startRes.data?.id || startRes.data?.room_id || startRes.data?.room?.id || null;
                };

                // new=1이면 잠금 선점(동시 init 중복 생성 방지)
                if (forceNew) {
                  const lock = `${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
                  try {
                    const existing = readGuard();
                    if (!existing) {
                      sessionStorage.setItem(guardKey, JSON.stringify({ pending: true, ts: Date.now(), roomId: null, lock }));
                    }
                  } catch (_) {}
                  const confirm = readGuard();
                  const iOwn = confirm && String(confirm.lock || '') === String(lock);
                  if (!iOwn) {
                    const waited = await waitForGuardRoom();
                    if (waited) {
                      try {
                        const r = await chatAPI.getChatRoom(waited);
                        if (r?.data?.id) roomId = waited;
                      } catch (_) {}
                    }
                  } else {
                    try {
                      roomId = await startChatWithRetry(startFn, 'origchat');
                      createdByThisInit = true;
                      try { sessionStorage.setItem(guardKey, JSON.stringify({ pending: false, ts: Date.now(), roomId })); } catch (_) {}
                    } catch (e) {
                      try { sessionStorage.removeItem(guardKey); } catch (_) {}
                      throw e;
                    }
                  }
                } else {
                  roomId = await startChatWithRetry(startFn, 'origchat');
                  createdByThisInit = true;
                }
              }

              // ✅ 새 방 생성 직후: 사이드바 히스토리/최근대화/대화내역이 즉시 갱신되어야 한다.
              // - 룸 생성만 하고 첫 메시지를 안 보낼 수도 있으므로(예: 인사말만 보고 뒤로가기),
              //   생성 즉시 갱신 이벤트를 쏴서 목록에 방이 나타나게 한다.
              if (createdByThisInit) {
                try { window.dispatchEvent(new Event('chat:roomsChanged')); } catch (_) {}
              }
              if (!roomId) {
                // 최후 폴백: 일반 시작
                const roomResponse = await startChatWithRetry(() => chatAPI.startChat(characterId), 'chat');
                roomId = roomResponse.data.id;
              }
            }
          } else {
            if (forceNew) {
              // ✅ new=1 일반챗 중복 생성 방지(StrictMode/중복 init 방어)
              // - 핵심: "과거 room 재사용"은 하지 않고, "동시 생성(pending) 중"일 때만 합류한다.
              // - 즉, 새로 대화 버튼을 다시 누르면 항상 새 room이 생성되어야 한다.
              const guardKey = buildNewGuardKey(characterId, openingParam || null);
              const NEW_START_GUARD_TTL_MS = 12000;
              const readNewGuard = () => {
                try {
                  const raw = sessionStorage.getItem(guardKey);
                  if (!raw) return null;
                  const parsed = JSON.parse(raw);
                  const ts = Number(parsed?.ts || 0) || 0;
                  if (!ts) return null;
                  if (Date.now() - ts > NEW_START_GUARD_TTL_MS) return null;
                  return parsed;
                } catch (_) {
                  return null;
                }
              };
              const waitForNewGuardRoom = async () => {
                for (let i = 0; i < 24; i += 1) {
                  await new Promise((resolve) => setTimeout(resolve, 250));
                  const g = readNewGuard();
                  const rid = String(g?.roomId || '').trim();
                  if (!rid || g?.pending !== false) continue;
                  return rid;
                }
                return null;
              };
              let createdByThisInit = false;

              // 1) 누군가 생성 중이면 완료까지 대기 후 합류(동시 생성 중복 방지)
              const g0 = readNewGuard();
              if (g0 && g0.pending) {
                const waited = await waitForNewGuardRoom();
                if (waited) {
                  try {
                    const r = await chatAPI.getChatRoom(waited);
                    if (r?.data?.id) roomId = waited;
                  } catch (_) {}
                }
              }

              // 2) 여전히 room이 없으면 내가 생성 owner가 되어 start-new 호출
              if (!roomId) {
                const lock = `${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
                try {
                  const existing = readNewGuard();
                  if (!existing || !existing.pending) {
                    sessionStorage.setItem(guardKey, JSON.stringify({ pending: true, ts: Date.now(), roomId: null, lock }));
                  }
                } catch (_) {}

                const confirm = readNewGuard();
                const iOwn = Boolean(confirm && confirm.pending && String(confirm.lock || '') === String(lock));

                if (!iOwn && confirm && confirm.pending) {
                  const waited = await waitForNewGuardRoom();
                  if (waited) {
                    try {
                      const r = await chatAPI.getChatRoom(waited);
                      if (r?.data?.id) roomId = waited;
                    } catch (_) {}
                  }
                }

                if (!roomId) {
                  try {
                    const roomResponse = await startChatWithRetry(
                      () => chatAPI.startNewChat(characterId, (openingParam ? { opening_id: openingParam } : null)),
                      'chat-new'
                    );
                    roomId = roomResponse.data.id;
                    createdByThisInit = true;
                    try { sessionStorage.setItem(guardKey, JSON.stringify({ pending: false, ts: Date.now(), roomId })); } catch (_) {}
                  } catch (e) {
                    // owner가 실패하면 pending 잠금 제거(다음 시도 복구)
                    try {
                      const g = readNewGuard();
                      if (g && String(g.lock || '') === String(lock)) {
                        sessionStorage.removeItem(guardKey);
                      }
                    } catch (_) {}
                    throw e;
                  }
                }
              }

              if (createdByThisInit) {
                try { window.dispatchEvent(new Event('chat:roomsChanged')); } catch (_) {}
              }
            } else {
              // URL에 room 파라미터가 있으면 그대로 사용, 없으면 최신 방 찾기
              if (!explicitRoom) {
                // ✅ 성능 최적화: 전체 세션 목록 조회(무거움) 대신 서버의 get-or-create(start) 경로를 사용한다.
                // - 목록 50개를 받아 프론트에서 필터/정렬하던 비용을 제거해 진입 지연/실패를 줄인다.
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
            // ✅ 마이그레이션(치명 UX 방지):
            // - 과거 기본값이 first2였던 시절 저장값이 남아 있으면,
            //   postprocess 때문에 "처음 본 대사"와 "재진입 시 대사"가 달라 보이거나
            //   캐릭터가 사용자 이름을 안 부르는 것처럼 느껴질 수 있다.
            // - ver<2 AND (없음/first2)인 경우에만 안전하게 off로 내려 데모 안정성을 확보한다.
            let ppm = parsed.postprocess_mode;
            try {
              const ver = Number(parsed.schema_version || parsed.schemaVersion || 0) || 0;
              const prev = String(ppm || '').trim().toLowerCase();
              if (ver < 2 && (!prev || prev === 'first2')) {
                ppm = 'off';
                try {
                  localStorage.setItem('cc:chat:settings:v1', JSON.stringify({ ...parsed, postprocess_mode: ppm, schema_version: 2 }));
                } catch (_) {}
              }
            } catch (_) {}
            const s = {
              postprocess_mode: ppm || 'off',
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
              const ctxRes = await origChatAPI.getContextPack(storyIdParam, { anchor: a, characterId, mode: 'plain', rangeFrom: rf, rangeTo: rt });
              const director = ctxRes.data?.director_context || {};
              if (typeof director.total_chapters === 'number') setOrigTotalChapters(director.total_chapters);
            }
          } catch (_) {
            // 실패해도 일반 챗은 진행 가능
          }
        }

      } catch (err) {
        // ✅ 비공개/삭제 접근 차단 UX(요구사항)
        // - 과거에 대화했던 방이 히스토리에 남아있더라도,
        //   크리에이터가 캐릭터/작품을 비공개로 바꾸면 진입 자체를 막아야 한다.
        // - 직접 URL 진입(딥링크)도 동일하게 차단한다.
        try {
          const status = err?.response?.status;
          const detail = String(err?.response?.data?.detail || err?.message || '').trim();
          if (status === 403) {
            // 메시지 톤을 제품 UX에 맞게 통일
            const msg = (detail.includes('비공개 작품') || detail.includes('작품'))
              ? '크리에이터가 비공개한 작품입니다.'
              : '크리에이터가 비공개한 캐릭터입니다.';
            try { showToastOnce({ key: `access-denied:${characterId}:${chatRoomId || 'none'}`, type: 'error', message: msg }); } catch (_) {}
            try { navigate('/dashboard', { replace: true }); } catch (_) { try { navigate('/', { replace: true }); } catch(__) {} }
            return;
          }
          if (status === 410 || detail.includes('삭제된 작품')) {
            try { showToastOnce({ key: `deleted:${characterId}:${chatRoomId || 'none'}`, type: 'error', message: '삭제된 작품입니다' }); } catch (_) {}
            try { navigate('/dashboard', { replace: true }); } catch (_) { try { navigate('/', { replace: true }); } catch(__) {} }
            return;
          }
          /**
           * ✅ 일반 캐릭터챗: 삭제된 캐릭터(404) UX
           *
           * 요구사항:
           * - 삭제된 캐릭터를 이전에 대화했던 유저가 접근할 때도, 일반 오류가 아니라
           *   "삭제된 캐릭터입니다"로 명확하게 안내한다.
           *
           * 동작:
           * - 404 + "캐릭터를 찾을 수 없습니다" → 토스트 안내 후 홈(또는 대시보드)로 이동
           */
          if (status === 404 && detail.includes('캐릭터를 찾을 수 없습니다')) {
            try { showToastOnce({ key: `deleted-character:${characterId}:${chatRoomId || 'none'}`, type: 'error', message: '삭제된 캐릭터입니다' }); } catch (_) {}
            try { navigate('/dashboard', { replace: true }); } catch (_) { try { navigate('/', { replace: true }); } catch(__) {} }
            return;
          }
        } catch (_) {}

        console.error('채팅 초기화 실패:', err);
        // ✅ 원작챗: 삭제된 작품이면 전용 메시지
        if (handleOrigchatDeleted(err, { navigateAway: false })) {
          setError('삭제된 작품입니다');
          return;
        }
        // ✅ 비공개/접근 불가(403): 경고 모달
        if (handleAccessDenied(err)) {
          return;
        }
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
        let attempts = 0;
        const poll = async () => {
          try {
            const res = await storiesAPI.getContextStatus(storyId2);
            const warmed = Boolean(res?.data?.warmed);
            if (!warmMounted) return;
            setCtxWarmed(warmed);
            attempts += 1;
            setCtxPollCount(attempts);
            if (!warmed && attempts < 5) {
              try { warmTimer = setTimeout(poll, 2000); } catch (_) {}
            } else {
              setCtxPollingDone(true);
            }
          } catch (_) {
            if (!warmMounted) return;
            setCtxWarmed(false);
          }
        };
        setCtxPollingDone(false);
        poll();
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
        // ✅ 대표 이미지 과다 딤(어두움) 방지 마이그레이션
        // - 과거 기본값이 overlay=60으로 저장되면서(사용자 의도와 무관하게) 대표 이미지가 지나치게 어두워지는 문제가 있었다.
        // - schema_version<2 이면서 overlay가 60(레거시 기본값)인 경우만 0으로 자동 보정한다.
        try {
          const schema = Number(parsed.schema_version || parsed.schemaVersion || 0) || 0;
          const ovRaw = (typeof parsed.overlay === 'number') ? parsed.overlay : null;
          if (typeof ovRaw === 'number') {
            const clipped = Math.max(0, Math.min(100, Math.round(ovRaw)));
            const migrated = (schema < 2 && clipped === 60) ? 0 : clipped;
            setUiOverlay(migrated);
            if (schema < 2 && clipped === 60) {
              try {
                localStorage.setItem('cc:ui:v1', JSON.stringify({ ...parsed, overlay: 0, schema_version: 2 }));
              } catch (_) {}
            }
          }
        } catch (_) {}
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
      // 워밍 폴링 중지(조기 return 방지 구조)
      stopWarmPoll();
      initMounted = false;
      // ✅ 주의: 이 effect는 chatRoomId를 deps에서 제외해(의도적으로) stale closure가 발생할 수 있다.
      // - 모바일 탭 전환/라우트 이동 시 leave_room이 누락되면,
      //   소켓 재연결/히스토리 복구가 "이전 방"을 기준으로 동작하며 messages가 덮어써져
      //   '내 말풍선이 사라진 것처럼 보이는' 치명 UX가 발생할 수 있다.
      // - 따라서 최신 roomId는 ref로 추적해 안전하게 leave한다.
      const rid = chatRoomIdRef.current;
      if (rid) leaveRoom(rid);
      // 페이지 이동 시 메시지를 보존하기 위해 초기화하지 않음
      window.removeEventListener('ui:settingsChanged', onUiChanged);
    };
  }, [characterId, leaveRoom, location.search]); // chatRoomId 제거

  // 최신 핀 상태를 ref에 반영
  useEffect(() => { isPinnedRef.current = isPinned; pinnedUrlRef.current = pinnedUrl; }, [isPinned, pinnedUrl]);
  // 최신 roomId를 ref에 반영(언마운트/탭 전환에서 stale closure 방지)
  useEffect(() => { chatRoomIdRef.current = chatRoomId; }, [chatRoomId]);

  // ✅ stageFallbackUrl은 동일 컴포넌트에서 characterId만 바뀌는 케이스에서도 복원되도록 별도 처리한다.
  useEffect(() => {
    try {
      const k = `cc:chat:stage:v1:${characterId || 'none'}`;
      const raw = sessionStorage.getItem(k);
      if (!raw) { setStageFallbackUrl(''); return; }
      const parsed = JSON.parse(raw);
      setStageFallbackUrl(String(parsed?.url || '').trim());
    } catch (_) {
      setStageFallbackUrl('');
    }
  }, [characterId]);

  // ✅ aiMessageImages를 ref로도 유지(이미지 매칭 effect에서 deps 루프 방지)
  useEffect(() => { aiMessageImagesRef.current = aiMessageImages || {}; }, [aiMessageImages]);

  // ✅ 새로고침 시에도 "말풍선 아래 트리거 이미지"가 사라지지 않도록 룸 단위로 세션 복원한다.
  useEffect(() => {
    if (!chatRoomId) return;
    try {
      const k = `cc:chat:triggerImages:v1:${chatRoomId}`;
      const raw = sessionStorage.getItem(k);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      const map = parsed?.map && typeof parsed.map === 'object' ? parsed.map : null;
      if (map && Object.keys(map).length > 0) {
        setAiMessageImages(map);
      }
    } catch (_) {}
  }, [chatRoomId]);

  // ✅ 트리거 이미지 맵을 세션에 저장(현재 룸에 존재하는 메시지만)
  useEffect(() => {
    if (!chatRoomId) return;
    try {
      const k = `cc:chat:triggerImages:v1:${chatRoomId}`;
      const ids = new Set();
      try {
        (Array.isArray(messages) ? messages : []).forEach((m) => {
          const id = String(m?.id || m?._id || '').trim();
          if (id) ids.add(id);
        });
      } catch (_) {}
      const src = (aiMessageImages && typeof aiMessageImages === 'object') ? aiMessageImages : {};
      const filtered = {};
      for (const [mid, url] of Object.entries(src)) {
        if (!mid || !url) continue;
        if (ids.size && !ids.has(String(mid))) continue;
        filtered[mid] = url;
      }
      if (!Object.keys(filtered).length) {
        sessionStorage.removeItem(k);
        return;
      }
      sessionStorage.setItem(k, JSON.stringify({ v: 1, ts: Date.now(), map: filtered }));
    } catch (_) {}
  }, [chatRoomId, aiMessageImages, messages]);

  // ✅ 새로고침 후에도 "... 로딩"을 유지하기 위한 룸 단위 복원
  useEffect(() => {
    if (!chatRoomId) { setPersistedTypingTs(null); return; }
    try {
      const k = buildTypingPersistKey(chatRoomId);
      const raw = sessionStorage.getItem(k);
      if (!raw) { setPersistedTypingTs(null); return; }
      const parsed = JSON.parse(raw);
      const ts = Number(parsed?.ts);
      if (!Number.isFinite(ts)) { setPersistedTypingTs(null); return; }
      // TTL 초과면 제거
      if (Date.now() - ts > TYPING_PERSIST_TTL_MS) {
        try { sessionStorage.removeItem(k); } catch (_) {}
        setPersistedTypingTs(null);
        return;
      }
      setPersistedTypingTs(ts);
    } catch (_) {
      setPersistedTypingTs(null);
    }
  }, [chatRoomId, buildTypingPersistKey, TYPING_PERSIST_TTL_MS]);

  // ✅ 응답(assistant)이 도착하면 persisted typing 플래그를 자동 해제한다(새로고침/탭 복귀 포함)
  useEffect(() => {
    if (!chatRoomId) return;
    try {
      const k = buildTypingPersistKey(chatRoomId);
      // persistedTypingTs가 없더라도 세션에 남은 값이 있을 수 있어, 메시지 상태로 정리한다.
      const arr = Array.isArray(messages) ? messages : [];
      if (!arr.length) {
        // TTL 초과면 정리
        if (persistedTypingTs && (Date.now() - persistedTypingTs > TYPING_PERSIST_TTL_MS)) {
          try { sessionStorage.removeItem(k); } catch (_) {}
          setPersistedTypingTs(null);
        }
        return;
      }
      // 마지막 "비시스템" 메시지 기준으로 판단(상황 안내 등 system bubble은 제외)
      let last = null;
      for (let i = arr.length - 1; i >= 0; i--) {
        const t = String(arr[i]?.senderType || arr[i]?.sender_type || '').toLowerCase();
        if (t === 'system') continue;
        last = arr[i];
        break;
      }
      if (!last) return;
      const lastType = String(last?.senderType || last?.sender_type || '').toLowerCase();
      const isAi = lastType === 'assistant' || lastType === 'ai' || lastType === 'character';
      if (isAi) {
        try { sessionStorage.removeItem(k); } catch (_) {}
        setPersistedTypingTs(null);
        return;
      }
      // TTL 초과면 정리(유령 로딩 방지)
      if (persistedTypingTs && (Date.now() - persistedTypingTs > TYPING_PERSIST_TTL_MS)) {
        try { sessionStorage.removeItem(k); } catch (_) {}
        setPersistedTypingTs(null);
      }
    } catch (_) {}
  }, [chatRoomId, messages, persistedTypingTs, buildTypingPersistKey, TYPING_PERSIST_TTL_MS]);

  // 🎯 AI 메시지 도착 시 키워드 매칭으로 이미지 자동 전환 + 말풍선 아래 이미지 저장
  useEffect(() => {
    const arr = Array.isArray(messages) ? messages : [];
    if (!arr.length) return;
    if (!Array.isArray(characterImages) || characterImages.length === 0) return;

    // ✅ 새로고침 케이스:
    // - 마지막 메시지가 user일 수 있다(그 직후 ... 로딩 말풍선이 별도 렌더됨).
    // - 이때도 "가장 최근 assistant 메시지"의 트리거 이미지는 유지되어야 한다.
    let firstAssistantId = '';
    try {
      for (let i = 0; i < arr.length; i++) {
        if (!isAssistantMessage(arr[i])) continue;
        const id = String(arr[i]?.id || arr[i]?._id || '').trim();
        if (id) { firstAssistantId = id; break; }
      }
    } catch (_) { firstAssistantId = ''; }

    const existing = aiMessageImagesRef.current || {};
    const patch = {};
    let focusedIdx = null;
    let processed = 0;

    for (let i = arr.length - 1; i >= 0; i--) {
      if (processed >= 12) break; // 방어: 너무 많은 업데이트로 렌더 부담 증가 방지
      const m = arr[i];
      if (!isAssistantMessage(m)) continue;
      const msgId = String(m?.id || m?._id || '').trim();
      if (!msgId) continue;
      if (existing[msgId]) continue;

      const content = String(m?.content || '');
      const hasInlineImageCode = (() => {
        /**
         * ✅ 인라인 이미지 코드 감지(신규 UX)
         *
         * 의도/원리:
         * - 경쟁사처럼 크리에이터가 텍스트 안에 "이미지 코드"를 넣으면, 이미지가 말풍선/지문 박스 "도중"에 렌더된다.
         * - 이 경우 기존 "말풍선 아래 트리거 이미지"는 중복이 되므로, 자동 트리거 이미지는 적용하지 않는다.
         */
        try {
          return /\[\[\s*img\s*:|\{\{\s*img\s*:/.test(content);
        } catch (_) {
          return false;
        }
      })();
      if (hasInlineImageCode) {
        processed += 1;
        continue;
      }

      // 1) suggested_image_index 우선 (백엔드)
      let idx = m?.meta?.suggested_image_index ?? m?.suggested_image_index ?? -1;

      // 2) 백엔드 값이 없으면 프론트 키워드 매칭 (핀 고정 중이면 자동 전환 안 함)
      if (idx < 0 && !isPinned) {
        idx = findMatchingImageByKeywords(content);
      }

      // 3) 첫 assistant(인사말)은 0번 이미지로 폴백
      if (idx < 0 && firstAssistantId && msgId === firstAssistantId) {
        idx = 0;
      }

      if (Number.isFinite(idx) && idx >= 0 && idx < characterImages.length) {
        const imageUrl = characterImages[idx];
        const resolvedUrl = resolveImageUrl(imageUrl);
        if (resolvedUrl) {
          patch[msgId] = resolvedUrl;
          // 가장 최근 assistant 기준으로 미니갤러리 포커싱
          if (focusedIdx === null) focusedIdx = idx;
          processed += 1;
        }
      } else {
        processed += 1;
      }
    }

    if (Object.keys(patch).length > 0) {
      setAiMessageImages((prev) => ({ ...(prev || {}), ...patch }));
      if (!isPinned && typeof focusedIdx === 'number') {
        setCurrentImageIndex((prev) => (prev === focusedIdx ? prev : focusedIdx));
      }
    }
  }, [messages, characterImages, isPinned, findMatchingImageByKeywords, isAssistantMessage]);

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
    /**
     * ✅ 일반(소켓) 챗만 소켓 히스토리를 로드한다.
     *
     * 원작챗은 HTTP(REST)로 메시지를 로드/저장하는 구조라,
     * 여기서 소켓의 message_history가 `setMessages()`를 덮어쓰면
     * "나갔다가 재진입했더니 내 대사가 사라진 것처럼 보이는" 치명적 UX가 발생할 수 있다.
     */
    const params = new URLSearchParams(location.search || '');
    const isOrigFromQuery = (params.get('source') === 'origchat') && Boolean(params.get('storyId'));
    if (isOrigFromQuery) return;

    // 소켓 연결 및 채팅방 정보 로드 완료 후 채팅방 입장
    // - 히스토리 요청은 SocketContext.joinRoom에서 단일 처리한다(레이스/중복 요청 방지).
    if (connected && chatRoomId && currentRoom?.id !== chatRoomId) {
      joinRoom(chatRoomId);
    }
  }, [connected, chatRoomId, currentRoom, location.search]); // location.search 추가: source=origchat 가드 반영

  // ✅ 일반 캐릭터챗 new=1 진입: 메시지가 안 오면 히스토리 재요청 + 최종 타임아웃 해제
  // - 레이스 컨디션 방어: startNewChat 직후 message_history가 빈 배열로 올 수 있음
  // - 3초 후 재요청, 8초 후에도 없으면 URL에서 new=1 제거해 오버레이 강제 해제
  useEffect(() => {
    if (isOrigChat) return;
    const p = new URLSearchParams(location.search || '');
    if (p.get('new') !== '1') return;
    if (!chatRoomId || !connected) return;
    if (Array.isArray(messages) && messages.length > 0) return;

    // 3초 후 히스토리 재요청
    const retryTimer = setTimeout(() => {
      if (Array.isArray(messages) && messages.length > 0) return;
      try {
        console.info('[ChatPage] new=1 retry: re-requesting message_history after 3s');
        getMessageHistory(chatRoomId, 1);
      } catch (_) {}
    }, 3000);

    // 8초 후에도 메시지 없으면 URL에서 new=1 제거 → isNewChatFromUrl이 false가 되어 오버레이 해제
    const forceTimer = setTimeout(() => {
      if (Array.isArray(messages) && messages.length > 0) return;
      try {
        console.warn('[ChatPage] new=1 force release: no messages after 8s, removing new=1 from URL');
        const usp = new URLSearchParams(location.search || '');
        usp.delete('new');
        navigate(`${location.pathname}?${usp.toString()}`, { replace: true });
      } catch (_) {}
    }, 8000);

    return () => {
      clearTimeout(retryTimer);
      clearTimeout(forceTimer);
    };
  }, [isOrigChat, chatRoomId, connected, messages, location.search]);

  // ✅ 일반 캐릭터챗: 대화가 이미 진행된 방에서는 URL의 new=1을 정리한다.
  // - 모바일 앱 전환/탭 복귀 후 재마운트 시 new=1이 남아 있으면
  //   initialize 단계가 "새 대화" 분기를 다시 타며 메시지 깜빡임(초기화→오프닝→히스토리 복구)이 발생할 수 있다.
  // - 사용자 메시지가 1개라도 존재하면 "새 대화 시작 단계"를 지난 것으로 보고 new 플래그를 제거한다.
  useEffect(() => {
    if (isOrigChat) return;
    const p = new URLSearchParams(location.search || '');
    if (p.get('new') !== '1') return;
    if (!chatRoomId) return;
    const arr = Array.isArray(messages) ? messages : [];
    if (!arr.length) return;
    const hasUserTurn = arr.some((m) => String(m?.senderType || m?.sender_type || '').toLowerCase() === 'user');
    if (!hasUserTurn) return;
    try {
      const usp = new URLSearchParams(location.search || '');
      usp.delete('new');
      navigate(`${location.pathname}?${usp.toString()}`, { replace: true });
    } catch (_) {}
  }, [isOrigChat, chatRoomId, messages, location.pathname, location.search, navigate]);

  // ✅ 탭 전환/복귀 이벤트는 원작챗 동기화에만 사용한다.
  // - 일반챗에서 visibilitychange로 히스토리를 재요청하면 오프닝 연출이 재트리거될 수 있다.
  // - 일반챗은 소켓 실시간 흐름을 SSOT로 유지하고, 탭 복귀 자체로는 아무 것도 재요청하지 않는다.
  useEffect(() => {
    if (!chatRoomId) return;
    /**
     * ✅ 재입장/복귀 히스토리 재요청(중요: 오동작 방지)
     *
     * 문제(실제 재현):
     * - 일부 환경(DevTools 도킹/포커스 변동/브라우저 버그)에서 visibilitychange가
     *   hidden↔visible로 짧은 간격으로 반복 발생한다.
     * - 기존 로직은 visible이 될 때마다 getMessageHistory(1)를 재요청해,
     *   message_history 수신 → setMessages(...)가 반복되며 "느림/깜빡임/스크롤 튐" 체감이 생긴다.
     *
     * 해결(최소 수정, 기능 유지):
     * - '진짜로 백그라운드에 갔다가 돌아온' 경우에만 재동기화를 수행한다.
     *   (hidden 상태가 일정 시간 이상 지속 + focus 보장 + 강한 디바운스)
     */
    let lastAt = 0;
    let lastHiddenAt = 0;
    const onVis = () => {
      // hidden 시각 기록(복귀 판정에 사용)
      try {
        if (document.visibilityState === 'hidden') {
          lastHiddenAt = Date.now();
          return;
        }
      } catch (_) { /* ignore */ }

      try {
        if (document.visibilityState !== 'visible') return;
      } catch (_) { /* ignore */ }

      // 과도한 호출 방지(짧은 시간 내 연속 복귀)
      const now = Date.now();
      // 1) focus가 없는 "가짜 visible"은 스킵(DevTools/오버레이 등)
      try { if (typeof document.hasFocus === 'function' && !document.hasFocus()) return; } catch (_) {}
      // 2) hidden 상태가 아주 짧았다면(깜빡) 스킵
      const hiddenForMs = lastHiddenAt ? (now - lastHiddenAt) : 0;
      if (hiddenForMs > 0 && hiddenForMs < 1500) return;
      // 3) 강한 디바운스(실제 복귀에서도 1회만)
      if (now - lastAt < 8000) return;
      lastAt = now;

      // 원작챗: HTTP SSOT로 즉시 동기화
      if (isOrigChat) {
        try { handleOrigSync(); } catch (_) {}
        return;
      }

      // 일반챗: no-op (탭 복귀로 스트리밍/오프닝 재시작 금지)
      return;
    };

    try { document.addEventListener('visibilitychange', onVis); } catch (_) {}
    return () => {
      try { document.removeEventListener('visibilitychange', onVis); } catch (_) {}
    };
  }, [chatRoomId, isOrigChat, connected, getMessageHistory, handleOrigSync]);

  // ✅ 원작챗: HTTP로 메시지 로드 및 선택지 복원
  useEffect(() => {
    if (!chatRoomId) return;
    
    const loadOrigChatMessages = async () => {
      try {
              // ✅ 방어: 룸 전환(새로대화/이어하기) 중 이전 비동기 로드가 현재 룸의 messages를 덮어쓰지 않도록 한다.
        const rid = chatRoomId;
              // 1. 룸 메타 먼저 로드하여 원작챗 여부 확인
        const metaRes = await chatAPI.getRoomMeta(rid);
        const meta = metaRes?.data || {};
        try {
          if (chatRoomIdRef.current && String(chatRoomIdRef.current) !== String(rid)) return;
        } catch (_) {}

        // ✅ 원작챗 여부 확인 및 설정 (plain 모드도 포함)
        // ✅ 서비스 정책: 원작챗은 plain 모드만 사용한다.
        const isOrigChatRoom = meta.mode === 'plain';
        
        if (!isOrigChatRoom) {
          // ✅ 일반 챗이면 아무것도 안 함 (소켓이 처리)
          // 단, 원작챗에서 일반챗으로 이동했을 때 상태가 남아 오동작하는 케이스를 확실히 차단한다.
          try { setIsOrigChat(false); } catch (_) {}
          try { setPendingChoices([]); } catch (_) {}
          try { setChoiceLocked(false); } catch (_) {}
          try { setOrigMeta({ turnCount: null, maxTurns: null, completed: false, mode: null, init_stage: null, intro_ready: null }); } catch (_) {}
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
      // ✅ 재진입/이어하기에서 "최근 대화"가 보여야 한다 → tail(최근 기준)로 로드
      let response = await chatAPI.getMessages(rid, { tail: 1, skip: 0, limit: 120 });
      let messages = Array.isArray(response?.data) ? response.data : [];
      try {
        if (chatRoomIdRef.current && String(chatRoomIdRef.current) !== String(rid)) return;
      } catch (_) {}
      
      // ✅ plain 모드일 때 인사말이 백그라운드에서 생성되므로 폴링
      if (meta.mode === 'plain' && messages.length === 0) {
        // 인사말이 생성될 때까지 최대 10초 대기
        for (let i = 0; i < 20; i++) {
          await new Promise(resolve => setTimeout(resolve, 500));
          response = await chatAPI.getMessages(rid, { tail: 1, skip: 0, limit: 120 });
          messages = Array.isArray(response?.data) ? response.data : [];
          try {
            if (chatRoomIdRef.current && String(chatRoomIdRef.current) !== String(rid)) return;
          } catch (_) {}
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
                room_id: rid,
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
          const hasAssistant = messages.some((m) => String(m?.senderType || m?.sender_type || '').toLowerCase() === 'assistant');
          if (hasAssistant) {
            setOrigMeta((prev) => ({ ...(prev || {}), init_stage: 'ready', intro_ready: true }));
          }
        } catch (_) {}
      }
      
    } catch (error) {
      console.error('원작챗 상태 로드 실패:', error);
      if (handleOrigchatDeleted(error)) return;
      if (handleAccessDenied(error)) return;
    }
  };
  
  loadOrigChatMessages();
}, [chatRoomId, handleOrigchatDeleted, handleAccessDenied]); // ✅ isOrigChat 의존성 제거
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
    /**
     * ✅ 타이핑(…) 표시/해제 시 스크롤 바닥 유지
     *
     * 문제:
     * - `aiTypingEffective`(점 3개 말풍선)는 `messages` 배열 밖에서 렌더된다.
     * - 그래서 기존 `useEffect([messages])` 자동 스크롤만으로는
     *   "유저 메시지 전송 → 잠시 후 … 말풍선 등장" 구간에서 스크롤이 바닥을 놓칠 수 있다.
     *
     * 동작:
     * - 사용자가 이미 바닥에 있던 상태(autoScrollRef.current=true)라면,
     *   타이핑 UI가 나타나거나 사라질 때도 맨 아래로 유지한다.
     * - 사용자가 위로 스크롤해 과거를 보고 있는 경우에는 강제 스크롤하지 않는다.
     */
    if (!autoScrollRef.current) return;
    // DOM 업데이트 후 스크롤(레이아웃 반영 보장)
    let raf = 0;
    try {
      raf = window.requestAnimationFrame(() => {
        try { scrollToBottom(); } catch (_) {}
      });
    } catch (_) {
      try { scrollToBottom(); } catch (_) {}
    }
    return () => {
      try { if (raf) window.cancelAnimationFrame(raf); } catch (_) {}
    };
  }, [aiTyping, isOrigChat, origTurnLoading]);

  useEffect(() => {
    /**
     * ✅ 선택지 UI 표시/해제 시 스크롤 바닥 유지
     *
     * 배경:
     * - 요술봉 선택지/원작 선택지는 `messages` 배열 밖에서 렌더되거나(요술봉),
     *   메시지 추가 없이 상태만 바뀌는 경우가 있어(선택지 표시/해제),
     *   기존 `useEffect([messages])`만으로는 바닥이 유지되지 않을 수 있다.
     *
     * 동작:
     * - 사용자가 이미 바닥에 있던 상태(autoScrollRef.current=true)일 때만
     *   선택지 표시/해제 시 맨 아래로 유지한다.
     */
    if (!autoScrollRef.current) return;
    const magicLen = Array.isArray(magicChoices) ? magicChoices.length : 0;
    const pendingLen = Array.isArray(pendingChoices) ? pendingChoices.length : 0;
    const shouldKeepBottom = (
      (!isOrigChat && magicMode && (magicLoading || magicLen > 0)) ||
      (isOrigChat && pendingLen > 0)
    );
    if (!shouldKeepBottom) return;

    let raf = 0;
    try {
      raf = window.requestAnimationFrame(() => {
        try { scrollToBottom(); } catch (_) {}
      });
    } catch (_) {
      try { scrollToBottom(); } catch (_) {}
    }
    return () => {
      try { if (raf) window.cancelAnimationFrame(raf); } catch (_) {}
    };
  }, [isOrigChat, magicMode, magicLoading, magicChoices, pendingChoices]);
  
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

  useEffect(() => {
    /**
     * ✅ 메시지 편집 모드 UX 안정화
     *
     * 문제:
     * - 연필(수정) 클릭 직후 Textarea가 렌더되더라도 포커스가 다른 곳(바닥 입력창/페이지)으로 남아있으면,
     *   백스페이스가 편집 텍스트를 지우지 않고(입력 대상 아님) 스크롤/브라우저 기본 동작을 유발할 수 있다.
     *
     * 해결:
     * - 편집 모드 진입 시점에 편집 Textarea로 포커스를 강제하고, 커서를 끝으로 보낸다.
     * - requestAnimationFrame으로 DOM 반영 후 실행(방어적).
     */
    if (!editingMessageId) return;
    let raf = 0;
    try {
      raf = window.requestAnimationFrame(() => {
        try {
          const el = editTextareaRef.current;
          if (!el) return;
          if (typeof el.focus === 'function') el.focus();
          // 커서를 맨 끝으로 이동
          try {
            const v = String(el.value || '');
            if (typeof el.setSelectionRange === 'function') el.setSelectionRange(v.length, v.length);
          } catch (_) {}
        } catch (_) {}
      });
    } catch (_) {}
    return () => {
      try { if (raf) window.cancelAnimationFrame(raf); } catch (_) {}
    };
  }, [editingMessageId]);

  const scrollToBottom = () => {
    /**
     * ✅ 맨 아래 스크롤(즉시)
     *
     * - `scrollIntoView()`만 쓰면 브라우저/레이아웃에 따라 "정확히 바닥"까지 안 내려가는 케이스가 있다.
     * - 우선 컨테이너 scrollTop을 직접 설정하고, 실패 시에만 scrollIntoView로 폴백한다.
     */
    const el = chatContainerRef.current;
    if (el) {
      try {
        el.scrollTop = el.scrollHeight;
        return;
      } catch (_) {
        try {
          el.scrollTo({ top: el.scrollHeight, behavior: 'auto' });
          return;
        } catch (_) {}
      }
    }
    try {
      messagesEndRef.current?.scrollIntoView({ block: 'end' });
    } catch (_) {
      messagesEndRef.current?.scrollIntoView(); // 최후 폴백
    }
  };

  /**
   * ✅ 원작챗: 상황 입력 UX(안내 말풍선 + 캐릭터 반응)
   *
   * 의도/동작:
   * - '상황 입력'은 유저/캐릭터의 대사가 아니라, 시스템(중립) 메시지로 취급하는 게 UX상 자연스럽다.
   * - 적용 시 `/chat/origchat/turn`에 `situation_text`를 보내고,
   *   응답으로 온 `ai_message`를 즉시 말풍선으로 추가한다(현재는 누락되어 상대 대사가 안 보였음).
   * - 안내 말풍선은 입력 토글을 열면 잠깐 보여주고 자동으로 사라진다(채팅 UI 오염 방지).
   */
  const removeSituationHintBubble = useCallback(() => {
    try {
      const id = situationHintMsgIdRef.current;
      if (id) {
        setMessages(prev => prev.filter(m => m.id !== id));
        situationHintMsgIdRef.current = null;
      }
    } catch (_) {}
    try {
      if (situationHintTimerRef.current) {
        clearTimeout(situationHintTimerRef.current);
        situationHintTimerRef.current = null;
      }
    } catch (_) {}
  }, [setMessages]);

  const showSituationHintBubble = useCallback(() => {
    if (!isOrigChat || !chatRoomId) return;
    // 중복 표시 방지
    if (situationHintMsgIdRef.current) return;

    const id = `sys-sit-hint-${Date.now()}`;
    situationHintMsgIdRef.current = id;
    setMessages(prev => ([
      ...prev,
      {
        id,
        roomId: chatRoomId,
        senderType: 'system',
        // ✅ UX 변경: 별도 입력 박스 없이 "상황입력 모드"에서 메인 입력창으로 바로 적용
        content: "상황 입력 모드예요. 아래 입력창에 쓰고 전송하면 바로 반영돼요.",
        created_at: new Date().toISOString(),
        isSystem: true,
      }
    ]));
    try { autoScrollRef.current = true; } catch (_) {}
    try {
      window.requestAnimationFrame(() => { try { scrollToBottom(); } catch (_) {} });
    } catch (_) { try { scrollToBottom(); } catch (_) {} }

    try {
      situationHintTimerRef.current = setTimeout(() => {
        try { setMessages(prev => prev.filter(m => m.id !== id)); } catch (_) {}
        situationHintMsgIdRef.current = null;
        situationHintTimerRef.current = null;
      }, 4500);
    } catch (_) {}
  }, [isOrigChat, chatRoomId, setMessages]);

  const applyOrigSituation = useCallback(async (textOverride = null) => {
    if (!isOrigChat || !chatRoomId) return;
    if (origTurnLoading) return;

    const text = String((textOverride !== null && textOverride !== undefined) ? textOverride : (situationText || '')).trim();
    if (!text) return false;

    // 안내 말풍선이 떠 있으면 정리
    removeSituationHintBubble();

    // ✅ 시스템(중립) 말풍선로 "상황"을 먼저 보여준다(유저/캐릭터 말풍선 아님)
    const sysId = `sys-sit-${Date.now()}`;
    setMessages(prev => ([
      ...prev,
      {
        id: sysId,
        roomId: chatRoomId,
        senderType: 'system',
        content: `상황: ${text}`,
        created_at: new Date().toISOString(),
        isSystem: true,
      }
    ]));
    try { autoScrollRef.current = true; } catch (_) {}
    try {
      window.requestAnimationFrame(() => { try { scrollToBottom(); } catch (_) {} });
    } catch (_) { try { scrollToBottom(); } catch (_) {} }

    try {
      // ✅ 새로고침/탭 재로드에도 "응답 생성 중(...)" 상태를 유지하기 위한 세션 플래그
      try { markTypingPersist(chatRoomId, 'orig'); } catch (_) {}
      setOrigTurnLoading(true);
      const resp = await origChatAPI.turn({ room_id: chatRoomId, situation_text: text, idempotency_key: genIdemKey() });

      // ✅ 버그 수정: 상황 적용 후 캐릭터 응답 말풍선을 반드시 추가한다.
      const assistantText = resp.data?.ai_message?.content || resp.data?.assistant || '';
      if (assistantText) {
        const aiId = resp.data?.ai_message?.id || `temp-ai-${Date.now()}`;
        const aiCreatedAt = resp.data?.ai_message?.created_at || new Date().toISOString();
        setMessages(prev => ([
          ...prev,
          { id: aiId, roomId: chatRoomId, senderType: 'assistant', content: assistantText, created_at: aiCreatedAt }
        ]));
      }

      const meta = resp.data?.meta || {};
      if (Array.isArray(meta.choices)) setPendingChoices(meta.choices);
      const warn = meta.warning;
      setRangeWarning(typeof warn === 'string' ? warn : '');

      // 입력 종료
      setSituationText('');
      setShowSituation(false);
      return true;
    } catch (e) {
      console.error('상황 적용 실패', e);
      try { setSseAwaitingFirstDelta(false); } catch (_) {}
      try { clearTypingPersist(chatRoomId); } catch (_) {}
      if (handleOrigchatDeleted(e)) return;
      if (handleAccessDenied(e)) return;
      // 실패 시 시스템 말풍선 롤백(유저 혼란 방지)
      try { setMessages(prev => prev.filter(m => m.id !== sysId)); } catch (_) {}
      showToastOnce({ key: `orig-sit-fail:${chatRoomId}`, type: 'error', message: '상황 적용에 실패했습니다. 잠시 후 다시 시도해주세요.' });
      return false;
    } finally {
      setOrigTurnLoading(false);
    }
  }, [isOrigChat, chatRoomId, origTurnLoading, situationText, genIdemKey, removeSituationHintBubble, setMessages, handleOrigchatDeleted, handleAccessDenied, markTypingPersist, clearTypingPersist]);

  // ✅ 상황 입력 토글이 열릴 때: 안내 말풍선을 잠깐 보여준다(모바일/PC 공통)
  useEffect(() => {
    if (!isOrigChat || !chatRoomId) {
      removeSituationHintBubble();
      return;
    }
    if (showSituation) showSituationHintBubble();
    else removeSituationHintBubble();
  }, [isOrigChat, chatRoomId, showSituation, showSituationHintBubble, removeSituationHintBubble]);
  
  const handleScroll = useCallback(() => {
    const el = chatContainerRef.current;
    if (!el) return;
    // ✅ 바닥 판정에 여유를 둔다(모바일 키보드/이미지 로드/레이아웃 변동으로 수 px~수십 px 차이가 자주 발생)
    const BOTTOM_THRESHOLD_PX = 80;
    const distanceToBottom = el.scrollHeight - el.clientHeight - el.scrollTop;
    const atBottom = distanceToBottom <= BOTTOM_THRESHOLD_PX;
    autoScrollRef.current = atBottom;
    // 맨 위 도달 시 과거 로드 (일반 챗만)
    // - 원작챗은 HTTP 로드(SSOT)이며, 소켓 history가 messages를 덮어쓰면 유실처럼 보일 수 있어 방지한다.
    if (!isOrigChat && el.scrollTop <= 0 && hasMoreMessages && !historyLoading) {
      prevScrollHeightRef.current = el.scrollHeight;
      getMessageHistory(chatRoomId, currentPage + 1);
    }


  }, [isOrigChat, hasMoreMessages, historyLoading, getMessageHistory, chatRoomId, currentPage]);

  const sseDeltaPipelinesRef = useRef(new Map()); // streamId -> { roomId, buffer, timer }

  const appendStreamingChunkById = useCallback((streamId, roomId, chunkText) => {
    const chunk = String(chunkText || '');
    if (!chunk) return;
    setMessages((prev) => {
      const idx = prev.findIndex((m) => String(m?.id || '') === String(streamId));
      if (idx < 0) {
        return [
          ...prev,
          {
            id: streamId,
            roomId,
            senderType: 'assistant',
            content: chunk,
            created_at: new Date().toISOString(),
            isStreaming: true,
            pending: true,
          },
        ];
      }
      const next = [...prev];
      const cur = next[idx] || {};
      next[idx] = {
        ...cur,
        content: `${String(cur?.content || '')}${chunk}`,
        isStreaming: true,
        pending: true,
      };
      return next;
    });
  }, []);

  const clearSseDeltaPipeline = useCallback((streamId) => {
    try {
      const key = String(streamId || '').trim();
      if (!key) return;
      const map = sseDeltaPipelinesRef.current;
      const st = map.get(key);
      if (!st) return;
      if (st.timer) {
        try { clearInterval(st.timer); } catch (_) {}
      }
      map.delete(key);
    } catch (_) {}
  }, []);

  const pushSseDeltaChunk = useCallback((streamId, roomId, chunkText) => {
    const key = String(streamId || '').trim();
    const chunk = String(chunkText || '');
    if (!key || !chunk) return;
    appendStreamingChunkById(key, roomId, chunk);
  }, [appendStreamingChunkById]);

  useEffect(() => {
    return () => {
      try {
        const map = sseDeltaPipelinesRef.current;
        for (const [, st] of map.entries()) {
          if (st?.timer) {
            try { clearInterval(st.timer); } catch (_) {}
          }
        }
        map.clear();
      } catch (_) {}
    };
  }, []);


  const handleSendMessage = async (e, overrideText = null) => {
    try { e?.preventDefault?.(); } catch (_) {}
    const draft = (overrideText !== null && overrideText !== undefined) ? String(overrideText || '') : String(newMessage || '');
    if (!draft.trim()) return;

    /**
     * ✅ 게스트 전송 UX(요구사항)
     *
     * - 채팅방 진입은 허용
     * - "전송" 시점에 로그인 모달을 띄움
     * - 로그인 성공 시 메인(/dashboard) → 동일 URL로 자동 복귀
     */
    if (!isAuthenticated) {
      try {
        const url = `${location.pathname}${location.search || ''}`;
        setPostLoginRedirect({ url, draft });
      } catch (err) {
        try { console.error('[ChatPage] setPostLoginRedirect failed:', err); } catch (_) {}
      }
      try {
        openLoginModal({ initialTab: 'login', reason: 'send_message' });
      } catch (err) {
        try { console.error('[ChatPage] openLoginModal failed:', err); } catch (_) {}
        // 최후 폴백: 로그인 페이지로 이동
        try { navigate('/login'); } catch (_) {}
      }
      return;
    }

    // 일반 캐릭터챗은 URL room을 우선 신뢰해 전송 대상 room을 결정한다(stale state 방지).
    const resolvedGeneralRoomId = (() => {
      if (isOrigChat) return '';
      try {
        const qRoom = String(new URLSearchParams(window.location.search || '').get('room') || '').trim();
        if (qRoom) return qRoom;
      } catch (_) {}
      try {
        return String(chatRoomIdRef.current || chatRoomId || '').trim();
      } catch (_) {
        return String(chatRoomId || '').trim();
      }
    })();
    const roomIdForSend = String(isOrigChat ? (chatRoomId || '') : (resolvedGeneralRoomId || '')).trim();

    // ✅ 초기화/룸 전환 레이스 방어: room 정렬이 끝나기 전에는 전송하지 않는다.
    if (!isOrigChat && loading) {
      try {
        showToastOnce({
          key: `chat-preparing:${characterId}`,
          type: 'info',
          message: '채팅방을 준비 중입니다. 잠시만 기다려 주세요.',
        });
      } catch (_) {}
      return;
    }
    if (!isOrigChat) {
      try {
        const qRoom = String(new URLSearchParams(window.location.search || '').get('room') || '').trim();
        const rid = String(chatRoomId || '').trim();
        if (qRoom && rid && qRoom !== rid) {
          try {
            showToastOnce({
              key: `chat-room-syncing:${characterId}`,
              type: 'info',
              message: '새 대화를 불러오는 중입니다. 잠시 후 전송해 주세요.',
            });
          } catch (_) {}
          return;
        }
      } catch (_) {}
    }

    // 일반챗/원작챗 모두 소켓 연결 여부와 무관하게 HTTP 기반 전송 경로를 사용
    const messageContentRaw = draft.trim();
    const firstToken = String(messageContentRaw.split(/\s+/)[0] || '').trim();
    const tokenNoSpace = firstToken.replace(/\s+/g, '').trim();
    const tokenLower = tokenNoSpace.toLowerCase();
    const isStatCmd = (
      tokenNoSpace.startsWith('!스탯') ||
      tokenNoSpace.startsWith('!스텟') ||
      tokenLower.startsWith('!stat') ||
      tokenLower.startsWith('!status')
    );
    if (!roomIdForSend) return;
    // 방어적: 원작챗은 한 턴씩 순차 처리(중복 전송/경합 방지)
    if (isOrigChat && origTurnLoading) {
      showToastOnce({ key: `orig-busy:${roomIdForSend}`, type: 'info', message: '응답 생성 중입니다. 잠시만 기다려 주세요.' });
      return;
    }
    // 선택지 노출 중에는 next_event(자동진행)만 제한하고, 일반 입력은 허용(요구사항 반영 시 UI로 전환)

    // ✅ "!스탯" 명령: 시뮬에서 언제든 상태창을 캐릭터(assistant) 말풍선으로 출력
    // - 서버 호출 없이 room meta(서버 SSOT)에서 stat_state를 읽어온다.
    if (!isOrigChat && isSimulatorChat && isStatCmd) {
      if (isStatCmd) {
        try { setNewMessage(''); } catch (_) {}
        try { if (inputRef.current) inputRef.current.style.height = 'auto'; } catch (_) {}
        try { autoScrollRef.current = true; } catch (_) {}
        const statusRoomId = String(roomIdForSend || '').trim();
        if (!statusRoomId) return;
        let snap = await fetchSimStatusSnapshot(statusRoomId, { force: true });
        if (!snap) {
          // ✅ 상태창 초기화 지연(첫 턴 직후/메타 반영 지연) 방어:
          // - 즉시 실패 문구를 노출하지 않고, 짧게 재시도 후 판단한다.
          for (let i = 0; i < 2; i += 1) {
            await new Promise((resolve) => setTimeout(resolve, 500));
            snap = await fetchSimStatusSnapshot(statusRoomId, { force: true });
            if (snap) break;
          }
        }
        const anchorForManualStat = (() => {
          try {
            const arr = Array.isArray(messages) ? messages : [];
            for (let i = arr.length - 1; i >= 0; i -= 1) {
              const mm = arr[i];
              const id = String(mm?.id || mm?._id || '').trim();
              if (!id) continue;
              return id;
            }
            return UI_TAIL_ANCHOR;
          } catch (_) {
            return UI_TAIL_ANCHOR;
          }
        })();
        if (!snap) {
          // ✅ "기다리면 되는" 일시 지연을 오류처럼 보이지 않게 처리
          // - 사용자에게는 실패 말풍선 대신 안내 토스트만 노출한다.
          showToastOnce({
            key: `sim-status-warmup:${statusRoomId}`,
            type: 'info',
            message: '상태창을 준비 중입니다. 잠시 후 다시 시도해 주세요.',
          });
          return;
        }
        const introMsg = (() => {
          try {
            const it = (Array.isArray(messages) ? messages : []).find((x) => String(x?.message_metadata?.kind || '').toLowerCase() === 'intro');
            return it ? String(it?.content || '') : '';
          } catch (_) { return ''; }
        })();
        const payload = buildSimStatusPayload(snap, introMsg);
        // ✅ 수동 !스탯은 "호출 시점" 위치에 고정한다.
        // - tail 고정이면 이후 메시지가 추가될 때 계속 아래로 밀려 UX가 어긋난다.
        pushLocalAssistantBubble(statusRoomId, 'status', payload, { anchorId: anchorForManualStat, stream: true });
        return;
      }
    }
    // ✅ 나레이션은 "* " (별표+공백/개행)으로만 판별: "**" 또는 "*abc*" 같은 인라인 강조로 말풍선 전체가 이탤릭 되는 오작동 방지
    const isNarration = /^\*\s/.test(messageContentRaw);
    const messageContent = isNarration ? messageContentRaw.replace(/^\*\s*/, '') : messageContentRaw;
    
    // ✅ 상황 입력 모드(원작챗): 별도 입력 박스 없이 "메인 입력창 전송 = 상황 적용"
    if (isOrigChat && showSituation) {
      const ok = await applyOrigSituation(messageContentRaw);
      if (ok) {
        try { setNewMessage(''); } catch (_) {}
        try { if (inputRef.current) inputRef.current.style.height = 'auto'; } catch (_) {}
      }
      return;
    }

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
    // ✅ 유저가 메시지를 보냈다면 기본적으로 "맨 아래 고정"이 자연스럽다.
    try { autoScrollRef.current = true; } catch (_) {}
    try {
      window.requestAnimationFrame(() => {
        try { scrollToBottom(); } catch (_) {}
      });
    } catch (_) {
      try { scrollToBottom(); } catch (_) {}
    }
      try {
        // ✅ 새로고침/탭 재로드에도 "... 로딩"을 유지하기 위한 세션 플래그(원작챗)
        try { markTypingPersist(roomIdForSend, 'orig'); } catch (_) {}
        setOrigTurnLoading(true);
        const payload = { room_id: roomIdForSend, user_text: messageContentRaw, idempotency_key: genIdemKey(), settings_patch: (settingsSyncedRef.current ? null : chatSettings) };
        setLastOrigTurnPayload(payload);
        const resp = await origChatAPI.turn(payload);
        const assistantText = resp.data?.ai_message?.content || resp.data?.assistant || '';
        const meta = resp.data?.meta || {};
        const aiMessage = {
          id: `temp-ai-${Date.now()}`,
          roomId: roomIdForSend,
          senderType: 'assistant',
          content: assistantText,
          created_at: new Date().toISOString()
        };
        setMessages(prev => [...prev, aiMessage]);
        // 진행도 갱신 + 설정 싱크 플래그 고정
        try {
          if (roomIdForSend) {
            const metaRes = await chatAPI.getRoomMeta(roomIdForSend);
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

        // ✅ 최근대화/대화내역 갱신(룸의 last_chat_time/snippet이 바뀜)
        try { window.dispatchEvent(new Event('chat:roomsChanged')); } catch (_) {}
      } catch (err) {
        console.error('원작챗 턴 실패', err);
        try { setSseAwaitingFirstDelta(false); } catch (_) {}
        try { setSseAwaitingFirstDelta(false); } catch (_) {}
        try { clearTypingPersist(roomIdForSend); } catch (_) {}
        if (handleOrigchatDeleted(err)) {
          try { setNewMessage(''); } catch (_) {}
          return;
        }
        if (handleAccessDenied(err)) {
          try { setNewMessage(''); } catch (_) {}
          return;
        }
        showToastOnce({ key: `turn-fail:${roomIdForSend}`, type: 'error', message: '응답 생성에 실패했습니다.' });
        try {
          const retry = window.confirm('응답 생성에 실패했습니다. 다시 시도할까요?');
          if (retry && lastOrigTurnPayload) {
            try { markTypingPersist(roomIdForSend, 'orig'); } catch (_) {}
            const resp = await origChatAPI.turn(lastOrigTurnPayload);
            const assistantText = resp.data?.assistant || '';
            const meta = resp.data?.meta || {};
            const aiMessage = {
              id: `temp-ai-${Date.now()}`,
              roomId: roomIdForSend,
              senderType: 'assistant',
              content: assistantText,
              created_at: new Date().toISOString()
            };
            setMessages(prev => [...prev, aiMessage]);
            setPendingChoices(Array.isArray(meta.choices) ? meta.choices : []);
            const warn = meta.warning;
            setRangeWarning(typeof warn === 'string' ? warn : '');
          }
        } catch(e2) {
          if (handleOrigchatDeleted(e2)) return;
          if (handleAccessDenied(e2)) return;
        }
      } finally {
        setOrigTurnLoading(false);
      }
      setNewMessage('');
      if (inputRef.current) { inputRef.current.style.height = 'auto'; }
      return;
    } else {
      // Send message via SSE stream (낙관적 추가 + 스트리밍 갱신 + 최종 응답 동기화)
      // ✅ 요술봉 모드: 전송 시 기존 선택지는 즉시 비움(다음 AI 응답 후 다시 생성)
      if (magicMode) {
        try { setMagicChoices([]); } catch (_) {}
      }

      const tempId = `temp-user-${Date.now()}`;
      const streamAiId = `temp-ai-stream-${Date.now()}`;
      const tempUserMessage = {
        id: tempId,
        roomId: roomIdForSend,
        senderType: 'user',
        senderId: user.id,
        content: messageContent,
        isNarration: isNarration,
        created_at: new Date().toISOString(),
        pending: true,
      };
      setMessages(prev => [...prev, tempUserMessage]);
      // ✅ 유저가 보낸 시점에 바닥 고정(레이아웃 변동/타이핑 UI 등장에도 유지)
      try { autoScrollRef.current = true; } catch (_) {}
      try {
        window.requestAnimationFrame(() => {
          try { scrollToBottom(); } catch (_) {}
        });
      } catch (_) {
        try { scrollToBottom(); } catch (_) {}
      }
      setNewMessage('');
      if (inputRef.current) {
        inputRef.current.style.height = 'auto';
      }

      try {
        // ✅ 새로고침/탭 재로드에도 "... 로딩"을 유지하기 위한 세션 플래그(일반챗)
        try { setSseAwaitingFirstDelta(true); } catch (_) {}
        try { markTypingPersist(roomIdForSend, 'chat'); } catch (_) {}
        const emitRelayMessages = (items = []) => {
          try {
            if (!socket) return;
            const list = Array.isArray(items) ? items.filter(Boolean) : [];
            if (!list.length) return;
            try {
              // SSE 경로에서 소켓이 잠시 끊겨도, relay 이벤트를 버퍼링/재전송하도록 재연결 시도
              if (!socket.connected && typeof socket.connect === 'function') socket.connect();
            } catch (_) {}
            socket.emit('relay_messages', { roomId: roomIdForSend, messages: list }, (resp) => {
              try {
                if (resp && resp.ok === false) console.warn('[ChatPage] relay_messages failed:', resp);
              } catch (_) {}
            });
          } catch (_) {}
        };

        const streamResult = await chatAPI.sendMessageStream(
          {
            room_id: roomIdForSend,
            character_id: characterId,
            content: messageContent,
            settings_patch: (settingsSyncedRef.current ? null : chatSettings),
          },
          {
            onDelta: (delta) => {
              const chunk = String(delta || '');
              if (!chunk) return;
              try { setSseAwaitingFirstDelta(false); } catch (_) {}
              pushSseDeltaChunk(streamAiId, roomIdForSend, chunk);
            },
          }
        );

        if (!streamResult?.ok || !streamResult?.data) {
          throw streamResult?.error || new Error('stream send failed');
        }
        clearSseDeltaPipeline(streamAiId, { flush: true });

        const payload = streamResult.data || {};
        const savedUser = payload?.user_message || null;
        const savedAi = payload?.ai_message || null;
        const savedEnding = payload?.ending_message || null;
        const meta = payload?.meta || {};

        setMessages((prev) => {
          let next = Array.isArray(prev) ? [...prev] : [];

          // 1) 임시 유저 메시지를 서버 저장본으로 치환
          if (savedUser && savedUser.id) {
            next = next.map((m) => (
              (String(m?.id || '') === String(tempId) || String(m?.id || '') === String(savedUser.id))
                ? { ...m, ...savedUser, senderType: savedUser.sender_type || 'user', pending: false }
                : m
            ));
          } else {
            next = next.map((m) => (
              String(m?.id || '') === String(tempId)
                ? { ...m, pending: false }
                : m
            ));
          }

          // 2) 스트리밍 말풍선 -> 서버 저장 AI 메시지로 치환
          if (savedAi && savedAi.id) {
            const aiMapped = {
              ...savedAi,
              senderType: savedAi.sender_type || 'assistant',
              pending: false,
              isStreaming: false,
            };
            const aiIdx = next.findIndex((m) => String(m?.id || '') === String(streamAiId));
            if (aiIdx >= 0) next[aiIdx] = { ...next[aiIdx], ...aiMapped };
            else if (!next.some((m) => String(m?.id || '') === String(savedAi.id))) next.push(aiMapped);
          } else {
            next = next.map((m) => (
              String(m?.id || '') === String(streamAiId)
                ? { ...m, pending: false, isStreaming: false }
                : m
            ));
          }

          // 3) 엔딩 메시지(선택) 추가
          if (savedEnding && savedEnding.id && !next.some((m) => String(m?.id || '') === String(savedEnding.id))) {
            next.push({ ...savedEnding, senderType: savedEnding.sender_type || 'assistant' });
          }

          return dedupeMessagesById(next);
        });

        // ✅ SSE 실시간 스트리밍 완료 → savedAi.id를 done 처리하여 가짜 UI 스트리밍 재실행 방지
        if (savedAi?.id) {
          try { uiStreamDoneByIdRef.current[String(savedAi.id)] = true; } catch (_) {}
        }

        // ✅ 다른 디바이스(모바일/PC 동시 접속) 즉시 동기화
        emitRelayMessages([
          (savedUser && savedUser.id) ? {
            id: savedUser.id,
            senderType: 'user',
            senderId: savedUser.sender_id || user?.id,
            senderName: user?.username || user?.nickname || 'user',
            content: savedUser.content || messageContent,
            messageType: isNarration ? 'narration' : 'text',
            timestamp: savedUser.created_at || new Date().toISOString(),
            message_metadata: savedUser.message_metadata || undefined,
          } : null,
          savedAi && savedAi.id ? {
            id: savedAi.id,
            senderType: 'character',
            senderId: savedAi.sender_id || characterId,
            senderName: character?.name || 'AI',
            content: savedAi.content || '',
            timestamp: savedAi.created_at || new Date().toISOString(),
            message_metadata: savedAi.message_metadata || undefined,
          } : null,
          savedEnding && savedEnding.id ? {
            id: savedEnding.id,
            senderType: 'character',
            senderId: savedEnding.sender_id || characterId,
            senderName: character?.name || 'AI',
            content: savedEnding.content || '',
            timestamp: savedEnding.created_at || new Date().toISOString(),
            message_metadata: savedEnding.message_metadata || undefined,
          } : null,
        ]);

        settingsSyncedRef.current = true;
        try { setSseAwaitingFirstDelta(false); } catch (_) {}
        try { clearTypingPersist(roomIdForSend); } catch (_) {}

        // ✅ 일반챗 진행률 갱신(서버 SSOT): 유저 메시지 1회 성공 후 turn_count가 증가했을 수 있다.
        try { await refreshGeneralChatProgress(roomIdForSend); } catch (_) {}

        // ✅ 응답 메타 반영(선택지/경고)
        try { setPendingChoices(Array.isArray(meta?.choices) ? meta.choices : []); } catch (_) {}
        try { setRangeWarning(typeof meta?.warning === 'string' ? meta.warning : ''); } catch (_) {}

        // ✅ 최근대화/대화내역 갱신(룸의 last_chat_time/snippet이 바뀜)
        try { window.dispatchEvent(new Event('chat:roomsChanged')); } catch (_) {}
      } catch (err) {
        console.error('SSE 전송 실패', err);
        try { setSseAwaitingFirstDelta(false); } catch (_) {}
        try { clearTypingPersist(roomIdForSend); } catch (_) {}
        try { clearSseDeltaPipeline(streamAiId, { flush: false }); } catch (_) {}
        setMessages(prev => prev.filter(m => String(m?.id || '') !== String(tempId) && String(m?.id || '') !== String(streamAiId)));
        showToastOnce({
          key: `sse-send-fail:${roomIdForSend}`,
          type: 'error',
          message: resolveChatStreamErrorMessage(err, '전송에 실패했습니다. 다시 시도해주세요.'),
        });
      }
    }
  };

  /**
   * ✅ 요술봉 선택지 생성 요청
   *
   * 의도/동작:
   * - 요술봉 ON 상태에서 "AI 메시지가 끝났을 때" 자동으로 3개 선택지를 받아온다.
   * - 유저가 수동 입력을 하더라도, ON이면 다음 AI 응답 후 다시 선택지가 뜬다.
   *
   * 방어:
   * - 원작챗(isOrigChat)에는 적용하지 않는다(기존 선택지 시스템과 충돌 방지).
   * - 로그인 전에는 호출하지 않는다(백엔드 인증 필요).
   * - 같은 seed(마지막 AI 메시지 id)로 중복 호출하지 않는다.
   */
  const requestMagicChoices = useCallback(async ({ seedMessageId = '', seedHint = '' } = {}) => {
    if (isOrigChat) return;
    if (!magicMode) return;
    if (!isAuthenticated) return;
    if (!chatRoomId) return;
    if (magicLoading) return;

    const seed = String(seedMessageId || '').trim();
    if (seed && lastMagicSeedRef.current === seed) return;

    try {
      setMagicLoading(true);
      const res = await chatAPI.getMagicChoices(chatRoomId, { n: 3, seed_message_id: seed || undefined, seed_hint: seedHint || undefined });
      const items = Array.isArray(res?.data?.choices) ? res.data.choices : [];
      const filtered = items.filter((c) => c && typeof c.label === 'string' && String(c.label).trim());
      setMagicChoices(filtered);
      if (seed) lastMagicSeedRef.current = seed;
      // ✅ 재접속/뒤로가기 복원을 위해 마지막 선택지를 룸 단위로 캐시(SSOT는 서버, UX 캐시는 클라이언트)
      try {
        if (chatRoomId && seed && filtered.length) {
          const k = `cc:chat:magicChoices:v1:${chatRoomId}`;
          localStorage.setItem(k, JSON.stringify({ seed, choices: filtered, ts: Date.now() }));
        }
      } catch (_) {}
    } catch (e) {
      console.error('[ChatPage] magic choices failed:', e);
      // 실패해도 채팅 흐름은 유지(UX만 보조 기능)
      showToastOnce({ key: `magic-choices-fail:${chatRoomId}`, type: 'error', message: '선택지 생성에 실패했습니다. 잠시 후 다시 시도해주세요.' });
    } finally {
      setMagicLoading(false);
    }
  }, [isOrigChat, magicMode, isAuthenticated, chatRoomId, magicLoading]);

  /**
   * ✅ 요술봉 모드 복원(재접속/뒤로가기/대화내역 진입 대응)
   *
   * 요구사항:
   * - 요술봉을 켠 상태에서 채팅방을 나갔다가(뒤로가기/재접속),
   *   다시 같은 채팅방에 들어오면 "요술봉 ON 상태"가 유지되어야 한다.
   *
   * 구현:
   * - 선택지 자체를 저장하지 않고(서버 SSOT 불가), "ON 상태"만 룸 단위로 localStorage에 저장한다.
   * - 재진입 시 마지막 AI 메시지를 seed로 선택지를 다시 생성한다(기존 자동 생성 useEffect가 담당).
   */
  useEffect(() => {
    if (isOrigChat) return;
    if (!chatRoomId) return;
    // 같은 룸에서 중복 복원 방지
    if (magicModeHydratedRef.current) return;
    magicModeHydratedRef.current = true;

    try {
      const k = `cc:chat:magicMode:v1:${chatRoomId}`;
      const v = localStorage.getItem(k);
      const next = v === '1';
      setMagicMode(next);
      // 재진입 시 선택지는 "캐시에서 복원"하거나, 없으면 자동 생성(useEffect)에서 생성된다.
      try { setMagicChoices([]); } catch (_) {}
      try { lastMagicSeedRef.current = ''; } catch (_) {}
      try { magicChoicesHydratedRef.current = false; } catch (_) {}
    } catch (_) {
      // 로컬스토리지 접근 실패 시 무시(UX만 보조 기능)
    }
  }, [isOrigChat, chatRoomId]);

  // 룸이 바뀌면 다시 복원 가능하도록 reset
  useEffect(() => {
    if (!chatRoomId) return;
    magicModeHydratedRef.current = false;
    magicChoicesHydratedRef.current = false;
  }, [chatRoomId]);

  /**
   * ✅ 요술봉 토글(공통 핸들러)
   *
   * 의도/동작:
   * - 데스크톱/모바일 입력 UI가 다르더라도, 요술봉 토글 로직은 1곳에서 SSOT로 유지한다.
   * - ON으로 켜질 때는 즉시 1회 선택지 생성(가능하면 최근 AI 메시지 seed 사용).
   */
  const handleToggleMagicMode = useCallback(() => {
    if (isOrigChat) return;
    // 로그인 전에는 사용 불가(선택지 생성 API는 인증 필요)
    if (!isAuthenticated) {
      // ✅ 게스트 UX: 요술봉 클릭 시 로그인 모달을 띄운다.
      // - 선택지 생성은 인증이 필요하므로, 토스트만 띄우면 "버튼이 안 눌리는" 것처럼 느껴진다.
      try {
        const url = `${location.pathname}${location.search || ''}`;
        setPostLoginRedirect({ url, draft: '' });
      } catch (err) {
        try { console.error('[ChatPage] setPostLoginRedirect(magic) failed:', err); } catch (_) {}
      }
      try {
        openLoginModal({ initialTab: 'login', reason: 'magic' });
      } catch (err) {
        try { console.error('[ChatPage] openLoginModal(magic) failed:', err); } catch (_) {}
        try { navigate('/login'); } catch (_) {}
      }
      showToastOnce({ key: 'magic-login-required', type: 'info', message: '요술봉 선택지는 로그인 후 사용할 수 있습니다.' });
      return;
    }
    setMagicMode((v) => {
      const next = !v;
      // 룸 단위로 ON 상태 저장(재접속 복원용)
      try {
        if (chatRoomId) {
          const k = `cc:chat:magicMode:v1:${chatRoomId}`;
          localStorage.setItem(k, next ? '1' : '0');
        }
      } catch (_) {}
      if (next) {
        try { setMagicChoices([]); } catch (_) {}
        try { lastMagicSeedRef.current = ''; } catch (_) {}
        try {
          const arr = Array.isArray(messages) ? messages : [];
          let lastAi = null;
          for (let i = arr.length - 1; i >= 0; i--) {
            const t = String(arr[i]?.senderType || arr[i]?.sender_type || '').toLowerCase();
            if (t === 'system') continue;
            if (t === 'assistant' || t === 'ai' || t === 'character') { lastAi = arr[i]; break; }
            break;
          }
          const seedId = String(lastAi?.id || lastAi?._id || '').trim();
          if (seedId) {
            setTimeout(() => { try { requestMagicChoices({ seedMessageId: seedId, seedHint: 'toggle_on' }); } catch (_) {} }, 0);
          } else {
            setTimeout(() => { try { requestMagicChoices({ seedHint: 'toggle_on_no_seed' }); } catch (_) {} }, 0);
          }
        } catch (_) {}
      } else {
        try { setMagicChoices([]); } catch (_) {}
      }
      return next;
    });
  }, [isOrigChat, isAuthenticated, chatRoomId, messages, requestMagicChoices]);

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
      // ✅ 새로고침/탭 재로드에도 "... 로딩"을 유지하기 위한 세션 플래그(선택 처리)
      try { markTypingPersist(chatRoomId, 'orig'); } catch (_) {}
      setOrigTurnLoading(true);
      if (isOrigChat) setTurnStage('generating');

      const payload = { room_id: chatRoomId, choice_id: choice.id, user_text: choice.label, idempotency_key: genIdemKey(), settings_patch: null };
      setLastOrigTurnPayload(payload);
      const resp = await origChatAPI.turn(payload);
      const assistantText = resp.data?.ai_message?.content || resp.data?.assistant || '';
      if (isOrigChat && assistantText) {
        if ((chatSettings?.postprocess_mode||'off') !== 'off') {
          setTurnStage('polishing');
          setTimeout(()=> setTurnStage(null), 300);
        } else {
          setTurnStage(null);
        }
      }
      if (isOrigChat && assistantText) {
        // 보정 모드가 켜졌다면 아주 짧게 '보정 중'을 표시(체감용)
        if ((chatSettings?.postprocess_mode||'off') !== 'off') {
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
      try { setSseAwaitingFirstDelta(false); } catch (_) {}
      try { clearTypingPersist(chatRoomId); } catch (_) {}
      if (handleOrigchatDeleted(e)) return;
      if (handleAccessDenied(e)) return;
      try {
        const retry = window.confirm('응답 생성에 실패했습니다. 다시 시도할까요?');
        if (retry && lastOrigTurnPayload) {
          try { markTypingPersist(chatRoomId, 'orig'); } catch (_) {}
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
      } catch(e2) {
        // 재시도 중에도 삭제되었을 수 있음
        if (handleOrigchatDeleted(e2)) return;
        if (handleAccessDenied(e2)) return;
      }
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
      // ✅ 새로고침/탭 재로드에도 "... 로딩"을 유지하기 위한 세션 플래그(선택지 요청)
      try { markTypingPersist(chatRoomId, 'orig'); } catch (_) {}
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
      try { setSseAwaitingFirstDelta(false); } catch (_) {}
      try { clearTypingPersist(chatRoomId); } catch (_) {}
      if (handleOrigchatDeleted(e)) return;
      if (handleAccessDenied(e)) return;
      showToastOnce({ key: `choices-fail:${chatRoomId}`, type: 'error', message: '선택지 요청에 실패했습니다.' });
    } finally {
      setOrigTurnLoading(false);
    }
  }, [chatRoomId, origTurnLoading, genIdemKey, handleOrigchatDeleted, handleAccessDenied, markTypingPersist, clearTypingPersist]); // ✅ isOrigChat 의존성 제거

  // 온디맨드: 자동 진행(next_event) — 선택지 표시 중엔 서버/프론트 모두 가드
  const requestNextEvent = useCallback(async () => {
    if (!isOrigChat || !chatRoomId || origTurnLoading) return;
    if (pendingChoices && pendingChoices.length > 0) { setRangeWarning('선택지가 표시 중입니다. 선택 처리 후 진행하세요.'); return; }
    try {
      // ✅ 새로고침/탭 재로드에도 "... 로딩"을 유지하기 위한 세션 플래그(계속/자동진행)
      try { markTypingPersist(chatRoomId, 'orig'); } catch (_) {}
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
      try { setSseAwaitingFirstDelta(false); } catch (_) {}
      try { clearTypingPersist(chatRoomId); } catch (_) {}
      if (handleOrigchatDeleted(e)) return;
      if (handleAccessDenied(e)) return;
      showToastOnce({ key: `next-fail:${chatRoomId}`, type: 'error', message: '자동 진행에 실패했습니다.' });
    } finally {
      setOrigTurnLoading(false);
      setTurnStage(null);
    }
  }, [isOrigChat, chatRoomId, origTurnLoading, pendingChoices, genIdemKey, chatSettings, handleOrigchatDeleted, handleAccessDenied, markTypingPersist, clearTypingPersist]);
  
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
        // ✅ 사용자 저장값이 없거나 비정상일 때는 요구사항 기본값(Claude Haiku 4.5)로 폴백
        setCurrentModel(response.data.preferred_model || 'claude');
        setCurrentSubModel(response.data.preferred_sub_model || 'claude-haiku-4-5-20251001');
      } catch (error) {
        console.error('모델 설정 로드 실패:', error);
      }
    };

    if (user) {
      loadUserModelSettings();
    }
  }, [user]);

  const insertNarrationAsterisksAtCursor = useCallback(() => {
    /**
     * ✅ 지문 입력 편의(요구사항): 애스터리스크 버튼 클릭 시 `*|*` 템플릿 삽입
     *
     * 의도/동작:
     * - 키보드 '*' 타이핑은 건드리지 않는다(요구사항).
     * - UI의 애스터리스크(✱) 버튼을 누르면 입력창 커서 위치에 `**`(별 2개)를 넣고,
     *   커서를 가운데로 옮겨 `*|*` 상태가 되게 한다.
     * - 선택 영역이 있으면 *선택영역* 으로 감싼다.
     */
    try {
      const el = (() => {
        try {
          const a = document.activeElement;
          if (a && a.tagName === 'TEXTAREA') return a;
        } catch (_) {}
        return inputRef?.current;
      })();
      if (!el) return;
      const start = Number(el.selectionStart);
      const end = Number(el.selectionEnd);
      if (!Number.isFinite(start) || !Number.isFinite(end)) return;

      const v = String(newMessage ?? '');
      const before = v.slice(0, start);
      const after = v.slice(end);
      const selected = v.slice(start, end);

      let next = '';
      let selStart = start;
      let selEnd = start;
      if (start !== end) {
        next = `${before}*${selected}*${after}`;
        // 선택 영역을 그대로 유지(감싼 내부)
        selStart = start + 1;
        selEnd = start + 1 + selected.length;
      } else {
        next = `${before}**${after}`;
        // 커서를 가운데로
        selStart = start + 1;
        selEnd = start + 1;
      }

      setNewMessage(next);
      // 렌더 후 커서 보정을 위해 저장
      try { pendingInputSelectionRef.current = { start: selStart, end: selEnd }; } catch (_) {}
    } catch (_) {}
  }, [newMessage]);

  useLayoutEffect(() => {
    // ✅ newMessage 반영 이후에만 selectionRange 적용(커서가 끝으로 튀는 문제 방지)
    try {
      const p = pendingInputSelectionRef.current;
      if (!p) return;
      pendingInputSelectionRef.current = null;
      const el = inputRef?.current;
      if (!el || typeof el.setSelectionRange !== 'function') return;
      el.focus?.();
      el.setSelectionRange(Number(p.start) || 0, Number(p.end) || 0);
    } catch (_) {}
  }, [newMessage]);

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
  // ✅ 게스트 UX: 전송 버튼을 누르는 순간 로그인 모달을 띄우기 위해, 게스트도 "전송 가능" 상태로 둔다.
  /**
   * ✅ 전송 가능 조건(강화)
   *
   * - 초기화 중(loading)에는 전송 금지: new=1 전환 중 이전 room 오발송 방지
   * - URL에 room 파라미터가 있으면, 상태의 chatRoomId와 일치할 때만 전송 허용
   * - 게스트는 기존 UX(전송 클릭 시 로그인 모달)를 유지한다.
   */
  const canSend = Boolean(newMessage.trim()) && (() => {
    if (!isAuthenticated) return true;
    // 일반 캐릭터챗만 loading 전송 차단(원작챗은 기존 동작 유지)
    // 단, new=1에서 "새 room이 이미 확정"된 경우에는 불필요한 지연 잠금을 풀어
    // 오프닝 표시 후 전송 버튼이 늦게 활성화되는 UX를 줄인다.
    if (!isOrigChat && loading) {
      const ridDuringLoad = String(chatRoomId || '').trim();
      const isNewChatBootstrap = (() => {
        try {
          return String(new URLSearchParams(location.search || '').get('new') || '').trim() === '1';
        } catch (_) {
          return false;
        }
      })();
      if (!(isNewChatBootstrap && ridDuringLoad)) return false;
    }
    const rid = String(chatRoomId || '').trim();
    if (!rid) return false;
    // 일반 캐릭터챗만 URL room 불일치 차단(원작챗은 기존 동작 유지)
    if (!isOrigChat) {
      try {
        const qRoom = String(new URLSearchParams(location.search || '').get('room') || '').trim();
        if (qRoom && qRoom !== rid) return false;
      } catch (_) {}
    }
    return true;
  })();
  // ✅ 원작챗 생성 중에는 입력/전송을 UI에서도 잠가, "눌렀는데 왜 안 보내져?" 혼란을 방지한다.
  const isOrigBusy = Boolean(isOrigChat && origTurnLoading);
  // ✅ 새로고침 방어:
  // - 소켓 aiTyping/origTurnLoading은 새로고침 시 초기화되어 "... 로딩 말풍선"이 사라질 수 있다.
  // - 마지막 유저 메시지가 최근(TTL 이내)인데 아직 assistant가 오지 않았다면, 응답 대기 중으로 간주해 유지한다.
  const isAwaitingAiByHistory = (() => {
    try {
      if (!chatRoomId) return false;
      const arr = Array.isArray(messages) ? messages : [];
      if (!arr.length) return false;
      let last = null;
      for (let i = arr.length - 1; i >= 0; i--) {
        const t = String(arr[i]?.senderType || arr[i]?.sender_type || '').toLowerCase();
        if (t === 'system') continue;
        last = arr[i];
        break;
      }
      if (!last) return false;
      const lastType = String(last?.senderType || last?.sender_type || '').toLowerCase();
      if (lastType !== 'user') return false;
      const ts = Date.parse(last?.created_at || last?.timestamp || '');
      // timestamp 누락/깨짐 데이터는 "대기 중"으로 고정하지 않는다(잠금 오탐 방지).
      if (!Number.isFinite(ts)) return false;
      return (Date.now() - ts) <= TYPING_PERSIST_TTL_MS;
    } catch (_) {
      return false;
    }
  })();
  const isAwaitingAiByPersist = Boolean(
    typeof persistedTypingTs === 'number' &&
    Number.isFinite(persistedTypingTs) &&
    (Date.now() - persistedTypingTs) <= TYPING_PERSIST_TTL_MS
  );
  // ✅ stale aiTyping 방어:
  // - 일부 환경에서 ai_typing_stop 누락/지연 시 aiTyping=true가 남아 "영구 로딩 스피너"처럼 보일 수 있다.
  // - 마지막 비시스템 메시지가 user가 아니면(= 이미 assistant/intro가 보이면) aiTyping은 표시에서 제외한다.
  const shouldIgnoreSocketAiTyping = (() => {
    try {
      if (!aiTyping) return false;
      if (isOrigChat) return false;
      const arr = Array.isArray(messages) ? messages : [];
      if (!arr.length) return false;
      let last = null;
      for (let i = arr.length - 1; i >= 0; i -= 1) {
        const t = String(arr[i]?.senderType || arr[i]?.sender_type || '').toLowerCase();
        if (t === 'system') continue;
        last = arr[i];
        break;
      }
      if (!last) return false;
      const lastType = String(last?.senderType || last?.sender_type || '').toLowerCase();
      return lastType !== 'user';
    } catch (_) {
      return false;
    }
  })();
  // ✅ "서버 응답 대기" 상태(점 3개 말풍선용)
  // - 원작챗은 HTTP 호출이므로, 소켓 aiTyping 대신 origTurnLoading을 포함한다.
  const aiWaitingServer = Boolean(
    ((aiTyping && !shouldIgnoreSocketAiTyping) || (isOrigChat && origTurnLoading) || isAwaitingAiByPersist || isAwaitingAiByHistory)
  );
  // ✅ UI 가짜 스트리밍 중(입력 잠금/요술봉 생성 지연)
  const uiStreamingActive = Boolean(uiStream?.id && uiStream?.full && uiStream?.shown !== uiStream?.full);
  const uiIntroStreamingActive = Boolean(uiIntroStream?.id && uiIntroStream?.full && uiIntroStream?.shown !== uiIntroStream?.full);
  // 스트리밍 말풍선이 보이는 동안에는 점(대기) 말풍선을 숨긴다.
  const hasVisibleStreamingAssistantBubble = (() => {
    try {
      if (uiStreamingActive || uiIntroStreamingActive) return true;
      const arr = Array.isArray(messages) ? messages : [];
      for (let i = arr.length - 1; i >= 0; i -= 1) {
        const m = arr[i];
        const t = String(m?.senderType || m?.sender_type || '').toLowerCase();
        if (t !== 'assistant' && t !== 'ai' && t !== 'character') continue;
        if (Boolean(m?.isStreaming)) return true;
      }
      return false;
    } catch (_) {
      return false;
    }
  })();
  // ✅ 입력 잠금 최종값: "응답 대기" + "가짜 스트리밍"(AI) + "오프닝 스트리밍"(intro)
  const aiTypingEffective = Boolean(aiWaitingServer || uiStreamingActive || uiIntroStreamingActive);
  /**
   * 진입 직후 유령 로딩 말풍선 방어
   *
   * 원칙:
   * - "응답 대기 점(…)"은 마지막 비시스템 메시지가 user일 때만 표시한다.
   * - intro/assistant가 이미 보이는 상태에서는 로딩 말풍선을 표시하지 않는다.
   */
  const shouldShowWaitingBubble = (() => {
    try {
      if (!aiWaitingServer) return false;
      if (hasVisibleStreamingAssistantBubble) return false;
      const arr = Array.isArray(messages) ? messages : [];
      if (!arr.length) return true; // 메시지 자체가 없으면 대기 표시 허용
      let last = null;
      for (let i = arr.length - 1; i >= 0; i -= 1) {
        const t = String(arr[i]?.senderType || arr[i]?.sender_type || '').toLowerCase();
        if (t === 'system') continue;
        last = arr[i];
        break;
      }
      if (!last) return true;
      const lastType = String(last?.senderType || last?.sender_type || '').toLowerCase();
      return lastType === 'user';
    } catch (_) {
      return aiWaitingServer;
    }
  })();
  // ✅ 입력바 UI 잠금(1단계: 다음행동 버튼까지 포함)
  const inputUiLocked = Boolean(aiTypingEffective || nextActionBusy);
  const textSizeClass = uiFontSize==='sm' ? 'text-sm' : uiFontSize==='lg' ? 'text-lg' : uiFontSize==='xl' ? 'text-xl' : 'text-base';

  /**
   * ✅ Next Action 활성 상태 해제(스트리밍 종료 트리거)
   *
   * 요구사항:
   * - 다음행동 버튼은 "메시지 출력이 모두 끝날 때까지" 활성 상태를 유지한다.
   *
   * 동작:
   * - aiTypingEffective가 한번이라도 true가 된 뒤,
   * - 다시 false로 돌아오면 nextActionBusy를 false로 되돌린다.
   *
   * 방어:
   * - AI가 시작 자체를 못하면(fail) 아래 failsafe 타이머가 해제한다.
   */
  useEffect(() => {
    try {
      if (!nextActionBusy) return;
      if (aiTypingEffective) {
        nextActionSeenAiTypingRef.current = true;
        return;
      }
      if (!nextActionSeenAiTypingRef.current) return;
      nextActionSeenAiTypingRef.current = false;
      try {
        if (nextActionFailSafeTimerRef.current) clearTimeout(nextActionFailSafeTimerRef.current);
      } catch (_) {}
      nextActionFailSafeTimerRef.current = null;
      try { setNextActionBusy(false); } catch (_) {}
    } catch (_) {}
  }, [nextActionBusy, aiTypingEffective]);

  // ✅ 룸 전환 시 스트리밍 상태 초기화(상태 누수 방지)
  useEffect(() => {
    try {
      uiStreamCancelSeqRef.current += 1;
      if (uiStreamTimerRef.current) clearInterval(uiStreamTimerRef.current);
      uiStreamTimerRef.current = null;
    } catch (_) {}
    try { setUiStream({ id: '', full: '', shown: '' }); } catch (_) {}
    try { uiStreamHydratedRef.current = false; } catch (_) {}
    try { uiStreamPrevLastIdRef.current = ''; } catch (_) {}
    try { uiStreamDoneByIdRef.current = {}; } catch (_) {}
    // intro 스트리밍도 초기화
    try {
      uiIntroCancelSeqRef.current += 1;
      if (uiIntroTimerRef.current) clearInterval(uiIntroTimerRef.current);
      uiIntroTimerRef.current = null;
    } catch (_) {}
    try { setUiIntroStream({ id: '', full: '', shown: '' }); } catch (_) {}
    try { uiIntroDoneByIdRef.current = {}; } catch (_) {}
    try { setUiOpeningStage('idle'); } catch (_) {}
    // 선택지 점진 노출 초기화
    try {
      magicRevealCancelSeqRef.current += 1;
      if (magicRevealTimerRef.current) clearInterval(magicRevealTimerRef.current);
      magicRevealTimerRef.current = null;
    } catch (_) {}
    try { setMagicRevealCount(0); } catch (_) {}
    // ✅ 다음행동 버튼 상태/타이머 초기화(룸 전환 누수 방지)
    try { nextActionSeenAiTypingRef.current = false; } catch (_) {}
    try {
      if (nextActionFailSafeTimerRef.current) clearTimeout(nextActionFailSafeTimerRef.current);
    } catch (_) {}
    nextActionFailSafeTimerRef.current = null;
    try { setNextActionBusy(false); } catch (_) {}
  }, [chatRoomId, isOrigChat]);

  /**
   * ✅ A안(가짜 스트리밍): "새로 도착한 마지막 AI 메시지"만 점진 출력
   *
   * 의도/원리:
   * - 소켓/REST 구조를 바꾸지 않고, UI에서만 텍스트를 단계적으로 보여준다.
   * - 입력은 출력 완료 후에만 허용(요술봉 선택지 생성 타이밍도 동일).
   *
   * 방어:
   * - 초기 히스토리 로드/재동기화에서 들어온 기존 메시지는 스트리밍하지 않는다.
   * - 마지막 메시지 id가 바뀐 경우만 "새 메시지"로 간주한다(페이지네이션 prepend는 제외됨).
   */
  useEffect(() => {
    if (isOrigChat) return;
    if (!chatRoomId) return;
    // ✅ 오프닝(new=1) 연출 중에는 일반 AI 스트리밍 이펙트를 잠시 중단한다.
    // - 오프닝 지문/첫대사 전용 스트리밍이 우선이며, 두 스트리밍이 동시에 돌면
    //   지문 스트리밍이 스킵되거나 첫대사가 완성본으로 선노출될 수 있다.
    const isOpeningFlowActive = (() => {
      try {
        const params = new URLSearchParams(location.search || '');
        const isNewChat = String(params.get('new') || '').trim() === '1';
        return isNewChat && uiOpeningStage !== 'done';
      } catch (_) {
        return false;
      }
    })();
    if (isOpeningFlowActive) return;

    const arr = Array.isArray(messages) ? messages : [];
    // 마지막 non-system 메시지 찾기
    let last = null;
    for (let i = arr.length - 1; i >= 0; i -= 1) {
      const t = String(arr[i]?.senderType || arr[i]?.sender_type || '').toLowerCase();
      if (t === 'system') continue;
      last = arr[i];
      break;
    }
    const lastId = String(last?.id || last?._id || '').trim();

    // ✅ 최초 1회(히스토리 로드 직후)는 스트리밍 금지(경쟁사처럼 "과거는 즉시 표시")
    if (!uiStreamHydratedRef.current) {
      uiStreamHydratedRef.current = true;
      uiStreamPrevLastIdRef.current = lastId;
      return;
    }

    const prevLastId = String(uiStreamPrevLastIdRef.current || '').trim();
    uiStreamPrevLastIdRef.current = lastId;
    if (!lastId || lastId === prevLastId) return;

    // ✅ 마지막 말풍선이 AI가 아니면 스킵(유저 전송/시스템 메시지 등)
    if (!isAssistantMessage(last)) return;

    // ✅ intro(도입부) 같은 특수 메시지는 제외(추후 HTML 렌더/정책 별도)
    const metaKind = (() => {
      try { return String(last?.message_metadata?.kind || '').toLowerCase(); } catch (_) { return ''; }
    })();
    if (metaKind === 'intro') return;

    // ✅ 재생성 진행 중인 메시지는 별도 로딩('...')을 이미 처리하므로 스트리밍 금지
    if (regenBusyId && String(regenBusyId) === String(lastId)) return;

    // ✅ 이미 스트리밍 완료한 메시지는 재진입/재동기화에서 재스트리밍 금지
    if (uiStreamDoneByIdRef.current && uiStreamDoneByIdRef.current[lastId]) return;

    const raw = (typeof last?.content === 'string') ? last.content : '';
    const lastMd = (() => {
      try { return last?.message_metadata || last?.messageMetadata || null; } catch (_) { return null; }
    })();
    const fullForDisplay = formatSafetyRefusalForDisplay(sanitizeAiText(raw), lastMd);
    if (!String(fullForDisplay || '').trim()) {
      uiStreamDoneByIdRef.current[lastId] = true;
      return;
    }

    // ✅ 기존 스트리밍 취소 + 새 메시지로 시작
    try {
      uiStreamCancelSeqRef.current += 1;
      const token = uiStreamCancelSeqRef.current;
      if (uiStreamTimerRef.current) {
        clearInterval(uiStreamTimerRef.current);
        uiStreamTimerRef.current = null;
      }
      setUiStream({ id: lastId, full: fullForDisplay, shown: '' });

      // 속도(방어적 클램프): 너무 길면 지루하고, 너무 짧으면 "스트리밍 느낌"이 없다.
      const full = String(fullForDisplay);
      const intervalMs = 33; // ~30fps
      const totalMs = Math.max(700, Math.min(2600, Math.round(full.length * 18)));
      const steps = Math.max(1, Math.ceil(totalMs / intervalMs));
      const chunk = Math.max(1, Math.ceil(full.length / steps));
      let idx = 0;
      let tick = 0;

      uiStreamTimerRef.current = setInterval(() => {
        if (uiStreamCancelSeqRef.current !== token) {
          try { clearInterval(uiStreamTimerRef.current); } catch (_) {}
          uiStreamTimerRef.current = null;
          return;
        }
        idx = Math.min(full.length, idx + chunk);
        const nextShown = full.slice(0, idx);
        setUiStream((prev) => {
          if (!prev || String(prev.id || '') !== String(lastId)) return prev;
          return { ...prev, shown: nextShown };
        });

        // ✅ 스크롤 안정: 유저가 바닥 근처일 때만 가끔 따라가기(매 tick 강제 X)
        tick += 1;
        if (autoScrollRef.current && (tick % 3 === 0 || idx >= full.length)) {
          try {
            window.requestAnimationFrame(() => {
              try { scrollToBottom(); } catch (_) {}
            });
          } catch (_) {
            try { scrollToBottom(); } catch (_) {}
          }
        }

        if (idx >= full.length) {
          try { clearInterval(uiStreamTimerRef.current); } catch (_) {}
          uiStreamTimerRef.current = null;
          try { uiStreamDoneByIdRef.current[lastId] = true; } catch (_) {}
          // 마지막 글자가 보인 뒤 다음 프레임에서 스트리밍 상태를 해제(입력/요술봉 활성화)
          try {
            window.setTimeout(() => {
              setUiStream((prev) => (prev && String(prev.id || '') === String(lastId)) ? { id: '', full: '', shown: '' } : prev);
            }, 0);
          } catch (_) {
            setUiStream((prev) => (prev && String(prev.id || '') === String(lastId)) ? { id: '', full: '', shown: '' } : prev);
          }
        }
      }, intervalMs);
    } catch (e) {
      // 실패해도 채팅 기능은 유지(UX 보조 기능)
      try { console.error('[ChatPage] ui fake streaming start failed:', e); } catch (_) {}
      try { uiStreamDoneByIdRef.current[lastId] = true; } catch (_) {}
      try { setUiStream({ id: '', full: '', shown: '' }); } catch (_) {}
    }
  }, [isOrigChat, chatRoomId, messages, regenBusyId, isAssistantMessage, sanitizeAiText, formatSafetyRefusalForDisplay, location.search, uiOpeningStage]);

  // ✅ 언마운트 시 스트리밍 타이머 정리(메모리/중복 타이머 방지)
  useEffect(() => {
    return () => {
      try {
        uiStreamCancelSeqRef.current += 1;
        if (uiStreamTimerRef.current) clearInterval(uiStreamTimerRef.current);
        uiStreamTimerRef.current = null;
      } catch (_) {}
    };
  }, []);

  /**
   * ✅ A안(일반챗): 오프닝(도입부 intro + 첫 AI 답변)도 점진 출력 (new=1 진입 시 1회)
   *
   * 의도/원리:
   * - "새로 대화 시작"으로 들어온 경우(new=1), 오프닝은 경쟁사처럼 타이핑 느낌으로 보여준다.
   * - 재진입/대화내역에서는 다시 스트리밍하지 않도록 룸 단위로 1회만 실행한다.
   */
  useEffect(() => {
    if (isOrigChat) return;

    // ✅ new=1 일 때만 오프닝 스트리밍을 켠다.
    const isNewChat = (() => {
      try {
        const params = new URLSearchParams(location.search || '');
        return String(params.get('new') || '').trim() === '1';
      } catch (_) {
        return false;
      }
    })();
    if (!isNewChat) return;
    // ✅ new=1에서는 room 생성 전(optimistic preview)에도 스트리밍을 시작할 수 있어야 한다.
    // - chatRoomId가 아직 없더라도 메시지가 있으면 진행한다.
    if (!chatRoomId) {
      const hasAny = Array.isArray(messages) && messages.length > 0;
      if (!hasAny) return;
    }

    let shouldSkipByReload = false;
    try {
      const nav = (typeof performance !== 'undefined' && performance.getEntriesByType)
        ? performance.getEntriesByType('navigation')
        : [];
      const nav0 = nav?.[0] || null;
      const navType = String(nav0?.type || '').trim().toLowerCase();
      // ✅ 진짜 문서 reload + 현재 라우트 일치일 때만 생략
      const navName = String(nav0?.name || '').trim();
      const docPath = navName ? String(new URL(navName).pathname || '').trim() : '';
      const curPath = String(location.pathname || '').trim();
      shouldSkipByReload = Boolean(navType === 'reload' && docPath && curPath && docPath === curPath);
    } catch (_) {
      shouldSkipByReload = false;
    }

    // ✅ new=1 + non-reload 진입에서는 오프닝 스트리밍 상태를 매 진입마다 초기화한다.
    // - 같은 room 파라미터를 재사용해도(운영 링크/딥링크) intro 스트리밍이 다시 실행되게 한다.
    try {
      const rid = String(chatRoomId || `new:${characterId || 'none'}`).trim();
      const runKey = `${rid}|${String(location.search || '')}`;
      if (uiOpeningRunKeyRef.current !== runKey) {
        uiOpeningRunKeyRef.current = runKey;
        if (!shouldSkipByReload) {
          uiIntroDoneByIdRef.current = {};
          uiStreamDoneByIdRef.current = {};
          setUiOpeningStage('idle');
        }
      }
    } catch (_) {}

    /**
     * ✅ 새로고침/복구 진입에서는 오프닝 재연출을 생략한다.
     *
     * 문제:
     * - reload 직후에는 서버 히스토리(완성본)가 먼저 보인 다음,
     *   오프닝 스트리밍이 다시 시작되며 "보였다가 비는" 깜빡임이 발생한다.
     *
     * 방어:
     * - 네비게이션 타입이 reload인 경우, 해당 룸의 오프닝 스트리밍을 완료 처리한다.
     * - 최초 신규 진입(일반 navigation)에서만 기존 스트리밍 UX를 유지한다.
     */
    if (shouldSkipByReload) {
      try { setUiOpeningStage('done'); } catch (_) {}
      return;
    }

    // ✅ 오프닝 스트리밍 시작 가드(단계별)
    // - intro 단계는 "신규 진입 연출"이므로, persisted typing 등 서버 대기 플래그에 막히지 않게 한다.
    // - greeting 단계는 기존과 동일하게 서버 대기/타 스트리밍과 충돌하지 않도록 막는다.
    if (uiIntroStreamingActive) return;
    if (uiStreamingActive && uiOpeningStage !== 'greeting') return;

    const arr = Array.isArray(messages) ? messages : [];
    if (!arr.length) return;

    const pickIntro = () => {
      for (const m of arr) {
        const kind = (() => { try { return String(m?.message_metadata?.kind || '').toLowerCase(); } catch (_) { return ''; } })();
        if (kind !== 'intro') continue;
        const txt = (typeof m?.content === 'string') ? m.content : '';
        const id = String(m?.id || m?._id || '').trim();
        if (id && txt.trim()) return { id, text: txt };
      }
      return null;
    };
    const pickGreeting = () => {
      // intro 다음에 오는 첫 assistant를 찾는 게 가장 자연스럽다.
      for (let i = 0; i < arr.length; i += 1) {
        if (!isAssistantMessage(arr[i])) continue;
        const kind = (() => { try { return String(arr[i]?.message_metadata?.kind || '').toLowerCase(); } catch (_) { return ''; } })();
        if (kind === 'intro') continue;
        const raw = (typeof arr[i]?.content === 'string') ? arr[i].content : '';
        const id = String(arr[i]?.id || arr[i]?._id || '').trim();
        const md = (() => { try { return arr[i]?.message_metadata || arr[i]?.messageMetadata || null; } catch (_) { return null; } })();
        if (id && String(raw).trim()) return { id, text: raw, md };
      }
      return null;
    };

    const startIntroStream = (id, full) => {
      try {
        const fullRaw = String(full || '');
        // HTML/태그가 많은 intro는 "보이는 텍스트 길이" 기준으로 스트리밍해야
        // 화면상 완료 후 입력 잠금이 늦게 풀리는 현상을 줄일 수 있다.
        const visibleFull = String(normalizeIntroStreamText(fullRaw) || fullRaw);

        uiIntroCancelSeqRef.current += 1;
        const token = uiIntroCancelSeqRef.current;
        if (uiIntroTimerRef.current) {
          clearInterval(uiIntroTimerRef.current);
          uiIntroTimerRef.current = null;
        }
        setUiIntroStream({ id, full: fullRaw, shown: '' });

        const intervalMs = 33;
        // 오프닝 지문은 "스트리밍이 보이도록" 최소 시간을 높여 체감을 확보한다.
        const totalMs = Math.max(1200, Math.min(4500, Math.round(visibleFull.length * 20)));
        const steps = Math.max(1, Math.ceil(totalMs / intervalMs));
        const chunk = Math.max(1, Math.ceil(visibleFull.length / steps));
        let idx = 0;
        let tick = 0;

        uiIntroTimerRef.current = setInterval(() => {
          if (uiIntroCancelSeqRef.current !== token) {
            try { clearInterval(uiIntroTimerRef.current); } catch (_) {}
            uiIntroTimerRef.current = null;
            return;
          }
          idx = Math.min(visibleFull.length, idx + chunk);
          const nextShown = visibleFull.slice(0, idx);
          setUiIntroStream((prev) => {
            if (!prev || String(prev.id || '') !== String(id)) return prev;
            return { ...prev, shown: nextShown };
          });
          tick += 1;
          if (autoScrollRef.current && (tick % 3 === 0 || idx >= visibleFull.length)) {
            try { window.requestAnimationFrame(() => { try { scrollToBottom(); } catch (_) {} }); } catch (_) {}
          }
          if (idx >= visibleFull.length) {
            try { clearInterval(uiIntroTimerRef.current); } catch (_) {}
            uiIntroTimerRef.current = null;
            try { uiIntroDoneByIdRef.current[id] = true; } catch (_) {}
            try { setUiIntroStream({ id: '', full: '', shown: '' }); } catch (_) {}
            try { setUiOpeningStage('greeting'); } catch (_) {}
          }
        }, intervalMs);
      } catch (e) {
        try { console.error('[ChatPage] opening intro stream failed:', e); } catch (_) {}
        try { setUiIntroStream({ id: '', full: '', shown: '' }); } catch (_) {}
      }
    };

    const startGreetingStream = (id, fullForDisplay) => {
      try {
        const fullRaw = String(fullForDisplay || '');
        // greeting도 동일하게 "보이는 길이" 기준으로 스트리밍 시간을 맞춘다.
        const visibleFull = String(normalizeIntroStreamText(fullRaw) || fullRaw);

        uiStreamCancelSeqRef.current += 1;
        const token = uiStreamCancelSeqRef.current;
        if (uiStreamTimerRef.current) {
          clearInterval(uiStreamTimerRef.current);
          uiStreamTimerRef.current = null;
        }
        // auto-stream effect의 초기 가드와 충돌하지 않게 "초기화 완료"로 간주
        uiStreamHydratedRef.current = true;
        uiStreamPrevLastIdRef.current = id;
        setUiStream({ id, full: fullRaw, shown: '' });

        const intervalMs = 33;
        const totalMs = Math.max(650, Math.min(2400, Math.round(visibleFull.length * 18)));
        const steps = Math.max(1, Math.ceil(totalMs / intervalMs));
        const chunk = Math.max(1, Math.ceil(visibleFull.length / steps));
        let idx = 0;
        let tick = 0;

        uiStreamTimerRef.current = setInterval(() => {
          if (uiStreamCancelSeqRef.current !== token) {
            try { clearInterval(uiStreamTimerRef.current); } catch (_) {}
            uiStreamTimerRef.current = null;
            return;
          }
          idx = Math.min(visibleFull.length, idx + chunk);
          const nextShown = visibleFull.slice(0, idx);
          setUiStream((prev) => {
            if (!prev || String(prev.id || '') !== String(id)) return prev;
            return { ...prev, shown: nextShown };
          });
          tick += 1;
          if (autoScrollRef.current && (tick % 3 === 0 || idx >= visibleFull.length)) {
            try { window.requestAnimationFrame(() => { try { scrollToBottom(); } catch (_) {} }); } catch (_) {}
          }
          if (idx >= visibleFull.length) {
            try { clearInterval(uiStreamTimerRef.current); } catch (_) {}
            uiStreamTimerRef.current = null;
            try { uiStreamDoneByIdRef.current[id] = true; } catch (_) {}
            try { setUiStream({ id: '', full: '', shown: '' }); } catch (_) {}
            try { setUiOpeningStage('done'); } catch (_) {}
          }
        }, intervalMs);
      } catch (e) {
        try { console.error('[ChatPage] opening greeting stream failed:', e); } catch (_) {}
        try { setUiStream({ id: '', full: '', shown: '' }); } catch (_) {}
      }
    };

    // 단계 진행
    if (uiOpeningStage === 'idle') {
      const intro = pickIntro();
      if (intro && !uiIntroDoneByIdRef.current[intro.id]) {
        setUiOpeningStage('intro');
        startIntroStream(intro.id, String(intro.text));
        return;
      }
      setUiOpeningStage('greeting');
      return;
    }
    if (uiOpeningStage === 'intro') {
      // intro 스트리밍 완료 후 setUiOpeningStage('greeting')로 넘어감
      return;
    }
    if (uiOpeningStage === 'greeting') {
      const g = pickGreeting();
      if (!g) return;
      const display = formatSafetyRefusalForDisplay(sanitizeAiText(String(g.text || '')), g?.md || null);
      if (!String(display || '').trim()) {
        setUiOpeningStage('done');
        return;
      }
      startGreetingStream(g.id, display);
    }
  }, [
    isOrigChat,
    chatRoomId,
    location.search,
    messages,
    aiWaitingServer,
    uiStreamingActive,
    uiIntroStreamingActive,
    uiOpeningStage,
    isAssistantMessage,
    sanitizeAiText,
    formatSafetyRefusalForDisplay,
    normalizeIntroStreamText,
  ]);

  /**
   * ✅ A안(일반챗): 요술봉 선택지 점진 노출(1→2→3)
   */
  useEffect(() => {
    if (isOrigChat) return;
    if (!magicMode) {
      try { setMagicRevealCount(0); } catch (_) {}
      return;
    }
    // 답변 출력/오프닝 출력이 끝나야 선택지가 보이므로, 그 전에는 카운트도 초기화
    if (aiTypingEffective) {
      try { setMagicRevealCount(0); } catch (_) {}
      return;
    }
    if (magicLoading) {
      try { setMagicRevealCount(0); } catch (_) {}
      return;
    }
    const arr = Array.isArray(magicChoices) ? magicChoices : [];
    const total = Math.min(3, arr.length);
    if (total <= 0) {
      try { setMagicRevealCount(0); } catch (_) {}
      return;
    }

    try {
      magicRevealCancelSeqRef.current += 1;
      const token = magicRevealCancelSeqRef.current;
      if (magicRevealTimerRef.current) {
        clearInterval(magicRevealTimerRef.current);
        magicRevealTimerRef.current = null;
      }
      setMagicRevealCount(1);
      let shown = 1;
      magicRevealTimerRef.current = setInterval(() => {
        if (magicRevealCancelSeqRef.current !== token) {
          try { clearInterval(magicRevealTimerRef.current); } catch (_) {}
          magicRevealTimerRef.current = null;
          return;
        }
        shown += 1;
        if (shown >= total) {
          setMagicRevealCount(total);
          try { clearInterval(magicRevealTimerRef.current); } catch (_) {}
          magicRevealTimerRef.current = null;
          return;
        }
        setMagicRevealCount(shown);
      }, 180);
    } catch (e) {
      try { console.error('[ChatPage] magic reveal failed:', e); } catch (_) {}
      try { setMagicRevealCount(total); } catch (_) {}
    }
  }, [isOrigChat, magicMode, aiTypingEffective, magicLoading, magicChoices]);

  /**
   * ✅ 요술봉 선택지 복원(캐시)
   *
   * 요구사항:
   * - 뒤로가기/재접속으로 같은 채팅방에 들어왔을 때,
   *   "마지막 AI 메시지"가 동일하면 선택지를 다시 생성하지 말고 그대로 보여줘야 한다.
   *
   * 방어:
   * - seed(마지막 AI 메시지 id)가 다르면 캐시를 쓰지 않는다(새 맥락이므로 새 선택지가 맞음).
   */
  useEffect(() => {
    if (isOrigChat) return;
    if (!magicMode) return;
    if (!isAuthenticated) return;
    if (!chatRoomId) return;
    if (aiTypingEffective) return;
    // 이미 UI에 선택지가 있으면 복원/재생성 불필요
    if (Array.isArray(magicChoices) && magicChoices.length > 0) return;
    // 같은 진입에서 캐시 복원은 1회만 시도
    if (magicChoicesHydratedRef.current) return;
    magicChoicesHydratedRef.current = true;

    // 현재 seed(마지막 AI 메시지 id) 계산
    const arr = Array.isArray(messages) ? messages : [];
    let lastAi = null;
    for (let i = arr.length - 1; i >= 0; i--) {
      const t = String(arr[i]?.senderType || arr[i]?.sender_type || '').toLowerCase();
      if (t === 'system') continue;
      if (t === 'assistant' || t === 'ai' || t === 'character') { lastAi = arr[i]; break; }
      break;
    }
    const seedId = String(lastAi?.id || lastAi?._id || '').trim();
    if (!seedId) return;

    // 캐시 조회
    try {
      const k = `cc:chat:magicChoices:v1:${chatRoomId}`;
      const raw = localStorage.getItem(k);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      const seed = String(parsed?.seed || '').trim();
      const choices = Array.isArray(parsed?.choices) ? parsed.choices : [];
      if (!seed || seed !== seedId) return;
      const safe = choices.filter((c) => c && typeof c.label === 'string' && String(c.label).trim()).slice(0, 3);
      if (!safe.length) return;
      setMagicChoices(safe);
      lastMagicSeedRef.current = seedId;
    } catch (_) {
      // 캐시 실패 시 무시하고 아래 자동 생성(useEffect)이 담당
    }
  }, [isOrigChat, magicMode, isAuthenticated, chatRoomId, aiTypingEffective, messages, magicChoices]);

  // ✅ 요술봉 ON + AI 응답 완료 후 자동으로 선택지 생성
  // (중요) aiTypingEffective 선언 이후에 둬야 TDZ 크래시를 막을 수 있다.
  useEffect(() => {
    if (isOrigChat) return;
    if (!magicMode) return;
    if (!isAuthenticated) return;
    if (!chatRoomId) return;
    if (aiTypingEffective) return;
    // ✅ 이미 동일 seed의 선택지를 갖고 있으면 재생성하지 않음(재접속/복원 시 리젠 방지)
    if (Array.isArray(magicChoices) && magicChoices.length > 0) {
      const arr0 = Array.isArray(messages) ? messages : [];
      let lastAi0 = null;
      for (let i = arr0.length - 1; i >= 0; i--) {
        const t = String(arr0[i]?.senderType || arr0[i]?.sender_type || '').toLowerCase();
        if (t === 'system') continue;
        if (t === 'assistant' || t === 'ai' || t === 'character') { lastAi0 = arr0[i]; break; }
        break;
      }
      const seedId0 = String(lastAi0?.id || lastAi0?._id || '').trim();
      if (seedId0 && lastMagicSeedRef.current === seedId0) return;
    }

    // 가장 최근 AI 메시지 기준으로 seed를 잡는다.
    const arr = Array.isArray(messages) ? messages : [];
    let lastAi = null;
    for (let i = arr.length - 1; i >= 0; i--) {
      const t = String(arr[i]?.senderType || arr[i]?.sender_type || '').toLowerCase();
      if (t === 'system') continue;
      if (t === 'assistant' || t === 'ai' || t === 'character') { lastAi = arr[i]; break; }
      // 마지막이 user면(방금 보낸 직후) 아직 AI가 안 왔으니 스킵
      break;
    }
    const seedId = String(lastAi?.id || lastAi?._id || '').trim();
    if (!seedId) return;
    requestMagicChoices({ seedMessageId: seedId });
  }, [isOrigChat, magicMode, isAuthenticated, chatRoomId, aiTypingEffective, messages, requestMagicChoices, magicChoices]);

  const handleTriggerNextAction = useCallback(async () => {
    /**
     * ✅ 다음행동(앞당기기)
     *
     * 요구사항:
     * - 아이콘: FastForward (요술봉의 "왼쪽")
     * - RP/시뮬 공통 (원작챗은 별도 continue/next_event가 있어 제외)
     * - 1회 클릭 시 최소 N초(2~3초) 추가 클릭 잠금
     * - 눌린 동안 활성화(보라색 원 + 흰색 아이콘), 끝나면 다시 비활성화
     */
    try {
      if (isOrigChat) return;
      if (nextActionBusy) return;
      if (!chatRoomId) return;
      if (!isAuthenticated) {
        try { setPostLoginRedirect(`${location.pathname}${location.search || ''}`); } catch (_) {}
        try { openLoginModal(); } catch (_) {}
        showToastOnce({ key: `next-action-login:${chatRoomId || 'none'}`, type: 'warning', message: '다음행동을 사용하려면 로그인이 필요합니다.' });
        return;
      }
      // 응답 대기/스트리밍 중에는 추가 트리거 금지(입력 잠금과 동일)
      if (aiTypingEffective) return;
      // ✅ UX 클릭 잠금(아이템포턴시와 별개)
      const now = Date.now();
      if (now < (nextActionCooldownUntilRef.current || 0)) return;
      nextActionCooldownUntilRef.current = now + NEXT_ACTION_COOLDOWN_MS;

      // ✅ 활성 상태 진입(스트리밍 종료 시 useEffect가 해제)
      try { setNextActionBusy(true); } catch (_) {}
      try { nextActionSeenAiTypingRef.current = false; } catch (_) {}
      // ✅ 요술봉 선택지와 UX 충돌 방지: 다음행동을 누르는 순간 기존 선택지는 즉시 비움
      // - 다음 AI 응답이 끝난 뒤에만 새로운 선택지가 다시 생성된다(useEffect 로직이 담당).
      if (magicMode) {
        try { setMagicChoices([]); } catch (_) {}
        try { setMagicRevealCount(0); } catch (_) {}
      }
      try {
        if (nextActionFailSafeTimerRef.current) clearTimeout(nextActionFailSafeTimerRef.current);
      } catch (_) {}
      nextActionFailSafeTimerRef.current = setTimeout(() => {
        try {
          // 스트리밍이 시작도 못한 경우를 대비한 방어 해제
          nextActionSeenAiTypingRef.current = false;
          setNextActionBusy(false);
          showToastOnce({ key: `next-action-timeout:${chatRoomId}`, type: 'error', message: '다음행동 생성이 지연되고 있습니다. 잠시 후 다시 시도해주세요.' });
        } catch (_) {}
      }, 65000);

      // seed: 가장 최근 AI 메시지 id(있으면)
      const arr = Array.isArray(messages) ? messages : [];
      let lastAi = null;
      for (let i = arr.length - 1; i >= 0; i--) {
        const t = String(arr[i]?.senderType || arr[i]?.sender_type || '').toLowerCase();
        if (t === 'system') continue;
        if (t === 'assistant' || t === 'ai' || t === 'character') { lastAi = arr[i]; break; }
        break;
      }
      const seedId = String(lastAi?.id || lastAi?._id || '').trim();

      // 1) 백엔드에서 다음행동 지문 생성
      let narration = '';
      try {
        const res = await chatAPI.getNextAction(chatRoomId, { seed_message_id: seedId || undefined, seed_hint: 'button' });
        narration = String(res?.data?.narration || '').trim();
      } catch (e) {
        console.error('[ChatPage] next action api failed:', e);
        try { setSseAwaitingFirstDelta(false); } catch (_) {}
        try { clearTypingPersist(chatRoomId); } catch (_) {}
        try {
          if (nextActionFailSafeTimerRef.current) clearTimeout(nextActionFailSafeTimerRef.current);
        } catch (_) {}
        nextActionFailSafeTimerRef.current = null;
        try { nextActionSeenAiTypingRef.current = false; } catch (_) {}
        try { setNextActionBusy(false); } catch (_) {}
        showToastOnce({ key: `next-action-api-fail:${chatRoomId}`, type: 'error', message: '다음행동 생성에 실패했습니다. 잠시 후 다시 시도해주세요.' });
        return;
      }
      if (!narration) {
        try {
          if (nextActionFailSafeTimerRef.current) clearTimeout(nextActionFailSafeTimerRef.current);
        } catch (_) {}
        nextActionFailSafeTimerRef.current = null;
        try { nextActionSeenAiTypingRef.current = false; } catch (_) {}
        try { setNextActionBusy(false); } catch (_) {}
        showToastOnce({ key: `next-action-empty:${chatRoomId}`, type: 'error', message: '다음행동 생성 결과가 비어 있습니다.' });
        return;
      }

      // 2) 유저 메시지로 소켓 전송(서버/DB에 kind 저장) + 낙관적 UI
      const contentToSend = `* ${narration}`; // UI/모델 모두에 "지문"임을 명확히
      const tempId = `temp-user-nextaction-${Date.now()}`;
      const streamAiId = `temp-ai-nextaction-stream-${Date.now()}`;
      const tempUserMessage = {
        id: tempId,
        roomId: chatRoomId,
        senderType: 'user',
        senderId: user?.id,
        content: contentToSend,
        isNarration: true,
        message_metadata: { kind: 'next_action' },
        created_at: new Date().toISOString(),
        pending: true,
      };
      setMessages(prev => [...prev, tempUserMessage]);
      try { autoScrollRef.current = true; } catch (_) {}
      try {
        window.requestAnimationFrame(() => {
          try { scrollToBottom(); } catch (_) {}
        });
      } catch (_) {
        try { scrollToBottom(); } catch (_) {}
      }

      try { setSseAwaitingFirstDelta(true); } catch (_) {}
      try { markTypingPersist(chatRoomId, 'chat'); } catch (_) {}
      try {
        const emitRelayMessages = (items = []) => {
          try {
            if (!socket) return;
            const list = Array.isArray(items) ? items.filter(Boolean) : [];
            if (!list.length) return;
            try {
              if (!socket.connected && typeof socket.connect === 'function') socket.connect();
            } catch (_) {}
            socket.emit('relay_messages', { roomId: chatRoomId, messages: list }, (resp) => {
              try {
                if (resp && resp.ok === false) console.warn('[ChatPage] relay_messages failed:', resp);
              } catch (_) {}
            });
          } catch (_) {}
        };

        const streamResult = await chatAPI.sendMessageStream(
          {
            room_id: chatRoomId,
            character_id: characterId,
            content: contentToSend,
            settings_patch: (settingsSyncedRef.current ? null : chatSettings),
            client_message_kind: 'next_action',
          },
          {
            onDelta: (delta) => {
              const chunk = String(delta || '');
              if (!chunk) return;
              try { setSseAwaitingFirstDelta(false); } catch (_) {}
              pushSseDeltaChunk(streamAiId, chatRoomId, chunk);
            },
          }
        );
        if (!streamResult?.ok || !streamResult?.data) {
          throw streamResult?.error || new Error('next_action stream send failed');
        }
        clearSseDeltaPipeline(streamAiId, { flush: true });
        const payload = streamResult.data || {};
        const savedUser = payload?.user_message || null;
        const savedAi = payload?.ai_message || null;
        const savedEnding = payload?.ending_message || null;
        const meta = payload?.meta || {};

        setMessages((prev) => {
          let next = Array.isArray(prev) ? [...prev] : [];

          if (savedUser && savedUser.id) {
            next = next.map((m) => (
              (String(m?.id || '') === String(tempId) || String(m?.id || '') === String(savedUser.id))
                ? { ...m, ...savedUser, senderType: savedUser.sender_type || 'user', pending: false }
                : m
            ));
          } else {
            next = next.map((m) => (
              String(m?.id || '') === String(tempId)
                ? { ...m, pending: false }
                : m
            ));
          }

          if (savedAi && savedAi.id) {
            const aiMapped = {
              ...savedAi,
              senderType: savedAi.sender_type || 'assistant',
              pending: false,
              isStreaming: false,
            };
            const aiIdx = next.findIndex((m) => String(m?.id || '') === String(streamAiId));
            if (aiIdx >= 0) next[aiIdx] = { ...next[aiIdx], ...aiMapped };
            else if (!next.some((m) => String(m?.id || '') === String(savedAi.id))) next.push(aiMapped);
          } else {
            next = next.map((m) => (
              String(m?.id || '') === String(streamAiId)
                ? { ...m, pending: false, isStreaming: false }
                : m
            ));
          }

          if (savedEnding && savedEnding.id && !next.some((m) => String(m?.id || '') === String(savedEnding.id))) {
            next.push({ ...savedEnding, senderType: savedEnding.sender_type || 'assistant' });
          }

          return dedupeMessagesById(next);
        });

        // ✅ SSE 스트리밍 완료 → savedAi.id를 done 처리하여 가짜 UI 스트리밍 재실행 방지
        if (savedAi?.id) {
          try { uiStreamDoneByIdRef.current[String(savedAi.id)] = true; } catch (_) {}
        }

        emitRelayMessages([
          savedUser && savedUser.id ? {
            id: savedUser.id,
            senderType: 'user',
            senderId: savedUser.sender_id || user?.id,
            senderName: user?.username || user?.nickname || 'user',
            content: savedUser.content || contentToSend,
            messageType: 'text',
            timestamp: savedUser.created_at || new Date().toISOString(),
            message_metadata: savedUser.message_metadata || undefined,
          } : null,
          savedAi && savedAi.id ? {
            id: savedAi.id,
            senderType: 'character',
            senderId: savedAi.sender_id || characterId,
            senderName: character?.name || 'AI',
            content: savedAi.content || '',
            timestamp: savedAi.created_at || new Date().toISOString(),
            message_metadata: savedAi.message_metadata || undefined,
          } : null,
          savedEnding && savedEnding.id ? {
            id: savedEnding.id,
            senderType: 'character',
            senderId: savedEnding.sender_id || characterId,
            senderName: character?.name || 'AI',
            content: savedEnding.content || '',
            timestamp: savedEnding.created_at || new Date().toISOString(),
            message_metadata: savedEnding.message_metadata || undefined,
          } : null,
        ]);

        settingsSyncedRef.current = true;
        try { setSseAwaitingFirstDelta(false); } catch (_) {}
        try { clearTypingPersist(chatRoomId); } catch (_) {}
        try { await refreshGeneralChatProgress(chatRoomId); } catch (_) {}
        try { setPendingChoices(Array.isArray(meta?.choices) ? meta.choices : []); } catch (_) {}
        try { setRangeWarning(typeof meta?.warning === 'string' ? meta.warning : ''); } catch (_) {}
        try { window.dispatchEvent(new Event('chat:roomsChanged')); } catch (_) {}
        try {
          if (nextActionFailSafeTimerRef.current) clearTimeout(nextActionFailSafeTimerRef.current);
        } catch (_) {}
        nextActionFailSafeTimerRef.current = null;
        try { nextActionSeenAiTypingRef.current = false; } catch (_) {}
        try { setNextActionBusy(false); } catch (_) {}
      } catch (err) {
        console.error('[ChatPage] next action SSE send failed:', err);
        try { setSseAwaitingFirstDelta(false); } catch (_) {}
        try { clearTypingPersist(chatRoomId); } catch (_) {}
        try { clearSseDeltaPipeline(streamAiId, { flush: false }); } catch (_) {}
        setMessages(prev => prev.filter(m => String(m?.id || '') !== String(tempId) && String(m?.id || '') !== String(streamAiId)));
        try {
          if (nextActionFailSafeTimerRef.current) clearTimeout(nextActionFailSafeTimerRef.current);
        } catch (_) {}
        nextActionFailSafeTimerRef.current = null;
        try { nextActionSeenAiTypingRef.current = false; } catch (_) {}
        try { setNextActionBusy(false); } catch (_) {}
        showToastOnce({
          key: `next-action-send-fail:${chatRoomId}`,
          type: 'error',
          message: resolveChatStreamErrorMessage(err, '다음행동 전송에 실패했습니다. 다시 시도해주세요.'),
        });
        return;
      }
    } catch (e) {
      console.error('[ChatPage] handleTriggerNextAction failed:', e);
      try {
        if (nextActionFailSafeTimerRef.current) clearTimeout(nextActionFailSafeTimerRef.current);
      } catch (_) {}
      nextActionFailSafeTimerRef.current = null;
      try { nextActionSeenAiTypingRef.current = false; } catch (_) {}
      try { setNextActionBusy(false); } catch (_) {}
    }
  }, [isOrigChat, nextActionBusy, chatRoomId, isAuthenticated, openLoginModal, location.pathname, location.search, aiTypingEffective, messages, socket, user, chatSettings, characterId, character?.name, refreshGeneralChatProgress, pushSseDeltaChunk, clearSseDeltaPipeline]);

  const handleContinueAction = useCallback(async () => {
    if (isOrigChat) {
      requestNextEvent();
      return;
    }
    if (!chatRoomId) return;
    if (aiTypingEffective) return;
    let streamAiId = '';
    try {
      try { setSseAwaitingFirstDelta(true); } catch (_) {}
      try { markTypingPersist(chatRoomId, 'chat'); } catch (_) {}
      streamAiId = `temp-ai-continue-stream-${Date.now()}`;
      const streamResult = await chatAPI.sendMessageStream(
        {
          room_id: chatRoomId,
          character_id: characterId,
          content: '',
          settings_patch: (settingsSyncedRef.current ? null : chatSettings),
        },
        {
          onDelta: (delta) => {
            const chunk = String(delta || '');
            if (!chunk) return;
            try { setSseAwaitingFirstDelta(false); } catch (_) {}
            pushSseDeltaChunk(streamAiId, chatRoomId, chunk);
          },
        }
      );
      if (!streamResult?.ok || !streamResult?.data) {
        throw streamResult?.error || new Error('continue stream send failed');
      }
      clearSseDeltaPipeline(streamAiId, { flush: true });
      const payload = streamResult.data || {};
      const savedAi = payload?.ai_message || null;
      const savedEnding = payload?.ending_message || null;

      setMessages((prev) => {
        let next = Array.isArray(prev) ? [...prev] : [];
        if (savedAi && savedAi.id) {
          const aiMapped = {
            ...savedAi,
            senderType: savedAi.sender_type || 'assistant',
            pending: false,
            isStreaming: false,
          };
          const aiIdx = next.findIndex((m) => String(m?.id || '') === String(streamAiId));
          if (aiIdx >= 0) next[aiIdx] = { ...next[aiIdx], ...aiMapped };
          else if (!next.some((m) => String(m?.id || '') === String(savedAi.id))) next.push(aiMapped);
        } else {
          next = next.map((m) => (
            String(m?.id || '') === String(streamAiId)
              ? { ...m, pending: false, isStreaming: false }
              : m
          ));
        }
        if (savedEnding && savedEnding.id && !next.some((m) => String(m?.id || '') === String(savedEnding.id))) {
          next.push({ ...savedEnding, senderType: savedEnding.sender_type || 'assistant' });
        }
        return dedupeMessagesById(next);
      });

      // ✅ SSE 스트리밍 완료 → savedAi.id를 done 처리하여 가짜 UI 스트리밍 재실행 방지
      if (savedAi?.id) {
        try { uiStreamDoneByIdRef.current[String(savedAi.id)] = true; } catch (_) {}
      }

      try {
        if (socket) {
          const relayList = [
            savedAi && savedAi.id ? {
              id: savedAi.id,
              senderType: 'character',
              senderId: savedAi.sender_id || characterId,
              senderName: character?.name || 'AI',
              content: savedAi.content || '',
              timestamp: savedAi.created_at || new Date().toISOString(),
              message_metadata: savedAi.message_metadata || undefined,
            } : null,
            savedEnding && savedEnding.id ? {
              id: savedEnding.id,
              senderType: 'character',
              senderId: savedEnding.sender_id || characterId,
              senderName: character?.name || 'AI',
              content: savedEnding.content || '',
              timestamp: savedEnding.created_at || new Date().toISOString(),
              message_metadata: savedEnding.message_metadata || undefined,
            } : null,
          ].filter(Boolean);
          if (relayList.length) {
            try {
              if (!socket.connected && typeof socket.connect === 'function') socket.connect();
            } catch (_) {}
            socket.emit('relay_messages', { roomId: chatRoomId, messages: relayList }, (resp) => {
              try {
                if (resp && resp.ok === false) console.warn('[ChatPage] relay_messages failed:', resp);
              } catch (_) {}
            });
          }
        }
      } catch (_) {}

      settingsSyncedRef.current = true;
      try { setSseAwaitingFirstDelta(false); } catch (_) {}
      try { clearTypingPersist(chatRoomId); } catch (_) {}
      try { window.dispatchEvent(new Event('chat:roomsChanged')); } catch (_) {}
    } catch (err) {
      console.error('[ChatPage] continue SSE send failed:', err);
      try { setSseAwaitingFirstDelta(false); } catch (_) {}
      try { clearTypingPersist(chatRoomId); } catch (_) {}
      try { clearSseDeltaPipeline(streamAiId, { flush: false }); } catch (_) {}
      setMessages(prev => prev.filter(m => String(m?.id || '') !== String(streamAiId)));
      showToastOnce({
        key: `continue-sse-send-fail:${chatRoomId}`,
        type: 'error',
        message: resolveChatStreamErrorMessage(err, '계속 진행에 실패했습니다. 다시 시도해주세요.'),
      });
    }
  }, [isOrigChat, requestNextEvent, chatRoomId, aiTypingEffective, chatSettings, characterId, character?.name, socket, markTypingPersist, clearTypingPersist, pushSseDeltaChunk, clearSseDeltaPipeline]);

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
    : (portraitImages[currentImageIndex] || portraitImages[0] || primaryPortrait || stageFallbackUrl || '');
  // ✅ 모바일 스테이지(배경) 이미지가 새로고침 때 사라지지 않도록 마지막 URL을 세션에 캐시한다.
  useEffect(() => {
    try {
      const url = String(currentPortraitUrl || '').trim();
      if (!url) return;
      const k = `cc:chat:stage:v1:${characterId || 'none'}`;
      sessionStorage.setItem(k, JSON.stringify({ url, ts: Date.now() }));
      // 다음 렌더에서 primary/gallery가 비어도 즉시 복원할 수 있게 state에도 반영
      setStageFallbackUrl((prev) => (prev === url ? prev : url));
    } catch (_) {}
  }, [characterId, currentPortraitUrl]);
  // 모바일은 기본적으로 최소한의 딤을 강제해(경쟁사처럼 이미지 위에서도 글자가 읽히게), 사용자가 uiOverlay를 올리면 그 값이 우선한다.
  const mobileStageOverlayAlpha = Math.max(0.35, Math.min(0.85, (Number(uiOverlay) || 0) / 100));

  /**
   * ✅ 대표이미지: 오프닝 인사(첫 assistant 대사) 직후 1회 "말풍선형 이미지"로 표시
   *
   * 요구사항:
   * - 오프닝 인사 끝나고 대표이미지를 말풍선으로 보여준다.
   * - 아바타 이미지/캐릭터 네이밍은 붙이지 않는다(이미지 단독 블록).
   */
  const openingGreetingMessageId = useMemo(() => {
    try {
      if (isOrigChat) return '';
      const arr = Array.isArray(messages) ? messages : [];
      // 1) 이상 케이스 방어: firstLine까지 kind='intro'로 내려와도
      //    "첫 intro 다음 assistant 1개"를 첫대사로 강제 식별한다.
      const firstIntroIdx = arr.findIndex((m) => {
        try { return String(m?.message_metadata?.kind || '').toLowerCase() === 'intro'; } catch (_) { return false; }
      });
      if (firstIntroIdx >= 0) {
        for (let i = firstIntroIdx + 1; i < arr.length; i += 1) {
          const m = arr[i];
          const t = String(m?.senderType || m?.sender_type || '').toLowerCase();
          if (t !== 'assistant' && t !== 'ai' && t !== 'character') continue;
          const mid = String(m?.id || m?._id || '').trim();
          if (!mid) continue;
          return mid;
        }
      }
      // 2) 정상 케이스: 첫 non-intro assistant
      for (let i = 0; i < arr.length; i += 1) {
        const m = arr[i];
        const kind = (() => { try { return String(m?.message_metadata?.kind || '').toLowerCase(); } catch (_) { return ''; } })();
        if (kind === 'intro') continue;
        const t = String(m?.senderType || m?.sender_type || '').toLowerCase();
        if (t !== 'assistant' && t !== 'ai' && t !== 'character') continue;
        const mid = String(m?.id || m?._id || '').trim();
        if (!mid) continue;
        return mid;
      }
      return '';
    } catch (e) {
      try { console.warn('[ChatPage] resolve opening greeting id failed:', e); } catch (_) {}
      return '';
    }
  }, [isOrigChat, messages]);
  const openingIntroMessageId = useMemo(() => {
    /**
     * 오프닝 intro는 첫 intro 메시지 ID로 고정 식별한다.
     * index 기반 판정보다 안정적이며, 오프닝 스트리밍 타깃 매칭이 흔들리지 않는다.
     */
    try {
      if (isOrigChat) return '';
      const arr = Array.isArray(messages) ? messages : [];
      for (let i = 0; i < arr.length; i += 1) {
        const m = arr[i];
        const kind = String(m?.message_metadata?.kind || '').toLowerCase();
        if (kind !== 'intro') continue;
        const mid = String(m?.id || m?._id || '').trim();
        if (!mid) continue;
        return mid;
      }
      return '';
    } catch (_) {
      return '';
    }
  }, [isOrigChat, messages]);
  const openingRepresentativeImageUrl = useMemo(() => {
    try {
      if (isOrigChat) return '';
      const primary = getCharacterPrimaryImage(character);
      const raw = String(primary || '').trim();
      if (!raw) return '';
      return resolveImageUrl(raw) || raw;
    } catch (e) {
      try { console.warn('[ChatPage] resolve opening representative image failed:', e); } catch (_) {}
      return '';
    }
  }, [isOrigChat, character]);
  
  const handleCopy = async (text) => {
    /**
     * ✅ 말풍선 복사 UX
     *
     * 요구사항:
     * - 복사 버튼 누르면 "복사되었습니다" 토스트를 반드시 보여준다.
     * - 실패하면 조용히 삼키지 않고 콘솔 로그 + 에러 토스트를 노출한다.
     */
    try {
      await navigator.clipboard.writeText(text);
      try { window.dispatchEvent(new CustomEvent('toast', { detail: { type: 'success', message: '복사되었습니다.' } })); } catch (_) {}
    } catch (e) {
      console.error('[ChatPage] copy failed:', e);
      try { window.dispatchEvent(new CustomEvent('toast', { detail: { type: 'error', message: '복사에 실패했습니다.' } })); } catch (_) {}
    }
  };
  const handleFeedback = async (msg, type) => {
    try {
      const res = await chatAPI.feedbackMessage(msg.id, type === 'up' ? 'upvote' : 'downvote');
      const updated = res.data;
      setMessages(prev => prev.map(m => m.id === updated.id ? { ...m, upvotes: updated.upvotes, downvotes: updated.downvotes } : m));
      // ✅ 로컬 "눌림" 상태 업데이트(시각화)
      try {
        const mid = String(msg?.id || '').trim();
        if (mid) setFeedbackSelectionById((prev) => ({ ...(prev || {}), [mid]: type }));
      } catch (_) {}
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
    if (regenBusyId) return; // 중복 클릭 방지
    try {
      // ✅ 대상 말풍선에 즉시 로딩 표시(사용자 메시지로 남기지 않음)
      try { setRegenBusyId(regenTargetId); } catch (_) {}
      const res = await chatAPI.regenerateMessage(regenTargetId, regenInstruction);
      const { ai_message } = res.data || {};
      if (ai_message && ai_message.id) {
        // ✅ 같은 메시지(id)를 제자리에서 교체 (새 말풍선 추가 금지)
        setMessages(prev => prev.map(m => String(m.id) === String(ai_message.id) ? { ...m, ...ai_message, senderType: ai_message.sender_type } : m));
        try { scrollToBottom(); } catch (_) {}
      }
    } catch (e) { console.error('재생성 실패:', e); }
    try { setRegenBusyId(null); } catch (_) {}
    setRegenOpen(false); setRegenInstruction(''); setRegenTargetId(null);
  };
  
  /**
   * ✅ 오프닝(intro)에서도 이미지 코드([[img:...]]/{{img:...}})를 렌더하기 위한 공용 함수
   *
   * 배경:
   * - 기존 구현은 MessageBubble 내부에만 `renderTextWithInlineImages`가 존재해서,
   *   intro 렌더링 구간에서 ReferenceError가 발생할 수 있다.
   *
   * 원칙:
   * - URL 직접 주입은 허용하지 않는다. 반드시 캐릭터에 등록된 `characterImages`에서만 매칭한다.
   */
  const renderTextWithInlineImages = (text) => {
    try {
      const srcText = String(text ?? '');
      if (!srcText) return srcText;
      const TOKEN_RE = /(\[\[\s*img\s*:\s*([^\]]+?)\s*\]\]|\{\{\s*img\s*:\s*([^}]+?)\s*\}\})/gi;
      if (!TOKEN_RE.test(srcText)) return srcText;
      TOKEN_RE.lastIndex = 0;

      const resolveBySpec = (rawSpec) => {
        try {
          const spec = String(rawSpec ?? '').trim();
          if (!spec) return '';
          // 1) 숫자(구버전): codeResolvableImages(1-based, avatar 제외)
          if (/^\d+$/.test(spec)) {
            const n = Number(spec);
            if (!Number.isFinite(n)) return '';
            const idx = Math.max(0, Math.floor(n) - 1);
            const url = (Array.isArray(codeResolvableImages) && idx >= 0 && idx < codeResolvableImages.length)
              ? codeResolvableImages[idx]
              : '';
            return url ? resolveImageUrl(url) : '';
          }
          // 2) 고유 id: 상황별 이미지 목록에서 URL→id로 역매핑(avatar 제외)
          const want = spec.toLowerCase();
          for (const u of (Array.isArray(codeResolvableImages) ? codeResolvableImages : [])) {
            const id = imageCodeIdFromUrl(u);
            if (id && id.toLowerCase() === want) {
              const resolved = resolveImageUrl(u);
              return resolved || '';
            }
          }
          return '';
        } catch (_) {
          return '';
        }
      };

      const nodes = [];
      let last = 0;
      let keySeq = 0;
      let m = null;
      while ((m = TOKEN_RE.exec(srcText)) !== null) {
        const full = m[1] || '';
        const spec = (m[2] != null ? m[2] : m[3]) || '';
        const start = m.index ?? 0;
        const end = start + full.length;
        if (start > last) {
          nodes.push(<React.Fragment key={`intro-txt-${keySeq++}`}>{srcText.slice(last, start)}</React.Fragment>);
        }
        const resolved = resolveBySpec(spec);
        if (resolved) {
          nodes.push(
            // ✅ 이미지 폭 정책(요구사항)
            // - 원본이 지문박스보다 크면: 지문박스 폭(max)까지 맞춰 축소
            // - 원본이 지문박스보다 작으면: 늘리지 않고 원본 폭 유지(스트레치 금지)
            <span key={`intro-img-${keySeq++}`} className="block my-2 w-fit max-w-full">
              <img
                src={resolved}
                alt=""
                loading="lazy"
                decoding="async"
                className="block w-auto max-w-full h-auto rounded-xl cursor-zoom-in border border-white/10"
                onClick={() => {
                  try {
                    setImageModalSrc(resolved);
                    setImageModalOpen(true);
                  } catch (_) {}
                }}
              />
            </span>
          );
        } else {
          // 매칭 실패 시 토큰은 그대로(운영 대응/디버깅)
          nodes.push(<span key={`intro-bad-${keySeq++}`} className="text-xs text-gray-400">{full}</span>);
        }
        last = end;
      }
      if (last < srcText.length) nodes.push(<React.Fragment key={`intro-tail-${keySeq++}`}>{srcText.slice(last)}</React.Fragment>);
      return nodes;
    } catch (e) {
      try { console.warn('[ChatPage] renderTextWithInlineImages failed:', e); } catch (_) {}
      return String(text ?? '');
    }
  };

  const stripHiddenStatDeltaBlocks = (text) => {
    /**
     * ✅ 방어: 내부용 스탯 델타 숨김 블록이 말풍선에 노출되는 사고 방지
     *
     * - 서버가 제거하는 게 SSOT지만, 운영 중 예외 케이스(턴 0/에러/중간 저장 등)로 유출될 수 있어
     *   프론트에서도 한 번 더 제거한다.
     */
    try {
      const src = String(text ?? '');
      if (!src) return '';
      if (!src.includes('CC_STAT_DELTA')) return src;
      const START = '<!-- CC_STAT_DELTA_START -->';
      const END = '<!-- CC_STAT_DELTA_END -->';
      const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (src.includes(START) && src.includes(END)) {
        return src.replace(new RegExp(`${esc(START)}[\\s\\S]*?${esc(END)}`, 'g'), '').trim();
      }
      if (src.includes(START) && !src.includes(END)) {
        return src.split(START, 1)[0].trim();
      }
      if (!src.includes(START) && src.includes(END)) {
        return src.replaceAll(END, '').trim();
      }
      return src;
    } catch (_) {
      return String(text ?? '');
    }
  };

  const MessageBubble = ({ message, isLast, triggerImageUrl, disableAssistantBlocks = false }) => {
    const rawType = String(message?.sender_type || message?.senderType || '').toLowerCase();
    const metaKind = (() => {
      try { return String(message?.message_metadata?.kind || '').toLowerCase(); } catch (_) { return ''; }
    })();
    const simStatus = (() => {
      try { return message?.message_metadata?.sim_status || null; } catch (_) { return null; }
    })();
    const isSystemBubble = (
      Boolean(message?.isSystem) ||
      rawType === 'system' ||
      String(message?.messageType || '').toLowerCase() === 'system' ||
      // ✅ 상황 입력(서버 저장)도 "시스템 말풍선"으로 동일하게 렌더링
      metaKind === 'situation'
    );
    if (isSystemBubble) {
      const txt0 = typeof message.content === 'string' ? message.content : String(message.content ?? '');
      const txt = stripHiddenStatDeltaBlocks(txt0);
      return (
        <div ref={isLast ? messagesEndRef : null} className="mt-4 mb-1 flex justify-center">
          <div
            className={`max-w-full sm:max-w-[85%] px-3 py-2 rounded-2xl text-xs border ${
              resolvedTheme === 'light'
                ? 'bg-gray-100 border-gray-200 text-gray-700'
                : 'bg-white/5 border-white/10 text-gray-200'
            }`}
          >
            {hasChatHtmlLike(txt) ? (
              <RichMessageHtml html={txt} className="message-rich" />
            ) : (
              <p className="whitespace-pre-wrap break-words">{txt}</p>
            )}
          </div>
        </div>
      );
    }

    // ✅ 시뮬: 상태창/정보 말풍선(assistant 전용)
    // - message_metadata.kind === 'status' | 'sim_info' 인 로컬 UI 메시지
    if (metaKind === 'status' || metaKind === 'sim_info') {
      const plainTextFull = formatSimStatusPlainText(simStatus || null);
      const canStream = Boolean(uiLocalBubbleStream?.id && String(uiLocalBubbleStream.id) === String(message?.id || '') && uiLocalBubbleStream.full);
      const plainText = canStream ? String(uiLocalBubbleStream.shown || '') : plainTextFull;
      return (
        <div ref={isLast ? messagesEndRef : null} className="mt-4 mb-1 flex flex-col items-start">
          <div className="flex items-center gap-2 mt-0 mb-1">
            <Avatar className="size-10 rounded-full">
              <AvatarImage className="object-cover object-top" src={getCharacterPrimaryImage(character)} alt={character?.name} />
              <AvatarFallback className="bg-gradient-to-r from-purple-500 to-blue-500 text-white">
                {character?.name?.charAt(0) || <Bot className="w-4 h-4" />}
              </AvatarFallback>
            </Avatar>
            <span className="text-sm text-gray-300">{character?.name}</span>
          </div>
          <div
            className={`relative w-fit max-w-full sm:max-w-[85%] px-3 py-2 rounded-2xl shadow-md overflow-hidden rounded-tl-none cc-assistant-speech-bubble ${
              resolvedTheme === 'light' ? 'bg-white border border-gray-300' : 'bg-white/10 lg:bg-white/10'
            }`}
            style={{ color: resolvedTheme === 'light' ? '#0b0b0b' : uiColors.charSpeech }}
          >
            <p className="whitespace-pre-wrap break-words select-text" style={{ wordBreak: 'break-word', overflowWrap: 'break-word', hyphens: 'auto' }}>
              {plainText}
            </p>
          </div>
        </div>
      );
    }

    const isUser = message.senderType === 'user' || message.sender_type === 'user';
    const isRegenPending = Boolean(!isUser && regenBusyId && String(message?.id || '') === String(regenBusyId));
    const mid = String(message?.id || '').trim();
    const mid2 = String(message?._id || '').trim();
    const msgId = mid || mid2;
    // ✅ 오프닝 첫대사(첫 assistant 메시지) 식별: 이 메시지에는 툴바를 노출하지 않는다(요구사항)
    const isOpeningGreeting = (() => {
      try {
        if (isOrigChat) return false;
        if (!openingGreetingMessageId) return false;
        return String(openingGreetingMessageId) === String(msgId);
      } catch (_) {
        return false;
      }
    })();
    const upCount = Number(message?.upvotes || 0) || 0;
    const downCount = Number(message?.downvotes || 0) || 0;
    const derivedSel = (upCount > downCount) ? 'up' : (downCount > upCount) ? 'down' : null;
    const selectedFeedback = (feedbackSelectionById && mid && feedbackSelectionById[mid]) ? feedbackSelectionById[mid] : derivedSel;
    const rawContent0 = typeof message.content === 'string' ? message.content : '';
    const rawContent = stripHiddenStatDeltaBlocks(rawContent0);

    // ✅ 다음행동(앞당기기) 지문 박스: 유저 메시지지만 "지문박스" UI로 보라색/흰색
    if ((message.senderType === 'user' || message.sender_type === 'user') && metaKind === 'next_action') {
      const txt = (() => {
        try {
          const s = String(rawContent ?? '');
          return s.replace(/^\s*\*\s*/, '').trim();
        } catch (_) {
          return String(rawContent ?? '').trim();
        }
      })();
      return (
        <div ref={isLast ? messagesEndRef : null} className="mt-4 mb-1 w-full flex justify-center">
          {/* ✅ 지문박스처럼: 가운데 정렬 + 사각형(rounded-md) + 이탤릭 */}
          <div className="w-full max-w-full sm:max-w-[92%] lg:max-w-full">
            <div
              className={`whitespace-pre-line break-words rounded-md px-3 py-2 text-center text-sm italic border ${
                resolvedTheme === 'light'
                  ? 'bg-purple-100 text-purple-900 border-purple-200'
                  : 'bg-purple-700/70 text-white border-purple-500/40'
              }`}
            >
              {hasChatHtmlLike(txt) ? (
                <RichMessageHtml html={txt} className="message-rich text-left" />
              ) : (
                txt
              )}
            </div>
          </div>
        </div>
      );
    }
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
    // ✅ A안(가짜 스트리밍): 마지막 AI 말풍선은 UI에서만 점진 출력
    // - 서버 저장값(message.content)은 변경하지 않는다(SSOT/디버깅/재생성 정합).
    const assistantDisplayFull = (!isUser && !isRegenPending)
      ? formatSafetyRefusalForDisplay(sanitizeAiText(rawContent), message?.message_metadata || message?.messageMetadata || null)
      : '';
    const assistantDisplayStreamed = (!isUser && !isRegenPending && uiStream?.id && String(uiStream.id) === String(message?.id || ''))
      ? stripHiddenStatDeltaBlocks(String(uiStream.shown || ''))
      : null;
    const displayText = isRegenPending
      ? '...'
      : (
        isUser
          ? (message.isNarration ? (rawContent.startsWith('*') ? rawContent : `* ${rawContent}`) : rawContent)
          : (assistantDisplayStreamed !== null ? assistantDisplayStreamed : assistantDisplayFull)
      );
    const displayTextWithInlineTrigger = (() => {
      /**
       * ✅ 요구사항: 트리거 이미지는 "말풍선 아래"가 아니라 "말풍선 안(인라인)"으로만 표시한다.
       *
       * 원리:
       * - DB/서버 content는 바꾸지 않는다(SSOT).
       * - 렌더링 텍스트에만 `[[img:...]]` 토큰을 덧붙여, 기존 인라인 이미지 렌더러로 처리한다.
       *
       * 방어:
       * - 이미 인라인 이미지 코드가 있으면 중복 삽입하지 않는다.
       * - HTML 렌더링(ul/ol/li 등)인 경우에는 토큰을 붙이지 않는다(토큰이 그대로 보일 수 있음).
       */
      try {
        if (isUser) return displayText;
        if (!triggerImageUrl) return displayText;
        const base = String(displayText ?? '');
        if (!base.trim()) return base;
        if (hasChatHtmlLike(base)) return base;
        if (/(\[\[\s*img\s*:|\{\{\s*img\s*:)/i.test(base)) return base;

        // 1) 고유 id 기반 토큰 우선
        const id = imageCodeIdFromUrl(triggerImageUrl);
        if (id) return `${base}\n\n[[img:${id}]]`;

        // 2) 폴백: 현재 캐릭터 이미지 배열에서 index(1-based) 매칭
        const idx = (() => {
          try {
            const want = String(resolveImageUrl(triggerImageUrl) || triggerImageUrl).trim();
            if (!want) return -1;
            const arr = Array.isArray(codeResolvableImages) ? codeResolvableImages : [];
            for (let i = 0; i < arr.length; i += 1) {
              const u = arr[i];
              const resolved = String(resolveImageUrl(u) || u || '').trim();
              if (resolved && resolved === want) return i;
            }
            return -1;
          } catch (_) {
            return -1;
          }
        })();
        if (idx >= 0) return `${base}\n\n[[img:${idx + 1}]]`;
        return base;
      } catch (_) {
        return displayText;
      }
    })();
    const bubbleRef = isLast ? messagesEndRef : null;

    /**
     * ✅ HTML 리스트 렌더(ul/ol/li) - AI 말풍선 전용
     *
     * 의도/동작:
     * - 요즘 UI처럼 말풍선 안에 `<ul>/<ol>/<li>`를 넣어도 보기 좋게 렌더한다.
     * - 단, 스크립트 실행은 절대 허용하지 않으므로 allowlist sanitize 후에만 HTML로 출력한다.
     *
     * 방어:
     * - "리스트 태그가 있는 경우"에만 HTML 렌더를 켜서, 기존 텍스트 렌더(이탤릭/이미지코드/블록 파서)를 최대한 유지한다.
     */
    const shouldRenderBubbleAsHtml = Boolean(!isRegenPending && hasChatHtmlLike(displayTextWithInlineTrigger));
    const renderBubbleHtml = (text) => {
      if (!text) return null;
      return <RichMessageHtml html={text} className="message-rich" />;
    };

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
     * ✅ 이미지 코드 → 인라인 이미지 렌더
     *
     * 요구사항(확정):
     * - 채팅은 `[[img:...]]` / `{{img:...}}` 형태만 인식한다.
     * - `...`는 "이미지 고유 id"를 우선으로 사용한다(오프닝/순서 변경에도 안전).
     * - 구버전 호환을 위해 숫자(`[[img:1]]`)도 동일 포맷 안에서 허용한다.
     *
     * 주의:
     * - URL 직접 주입은 허용하지 않는다(보안/SSOT). 반드시 "캐릭터에 등록된 이미지"에서만 선택된다.
     */
    const renderTextWithInlineImages = (text) => {
      const srcText = String(text ?? '');
      if (!srcText) return srcText;
      const TOKEN_RE = /(\[\[\s*img\s*:\s*([^\]]+?)\s*\]\]|\{\{\s*img\s*:\s*([^}]+?)\s*\}\})/gi;
      if (!TOKEN_RE.test(srcText)) return renderInlineItalics(srcText);
      // re-test는 lastIndex를 소비하므로 초기화
      TOKEN_RE.lastIndex = 0;

      const resolveBySpec = (rawSpec) => {
        try {
          const spec = String(rawSpec ?? '').trim();
          if (!spec) return '';
          // 1) 숫자(구버전): codeResolvableImages(1-based, avatar 제외)
          if (/^\d+$/.test(spec)) {
            const n = Number(spec);
            if (!Number.isFinite(n)) return '';
            const idx = Math.max(0, Math.floor(n) - 1);
            const url = (Array.isArray(codeResolvableImages) && idx >= 0 && idx < codeResolvableImages.length)
              ? codeResolvableImages[idx]
              : '';
            return url ? resolveImageUrl(url) : '';
          }
          // 2) 고유 id: 상황별 이미지 목록에서 URL→id로 역매핑(avatar 제외)
          const want = spec.toLowerCase();
          for (const u of (Array.isArray(codeResolvableImages) ? codeResolvableImages : [])) {
            const id = imageCodeIdFromUrl(u);
            if (id && id.toLowerCase() === want) {
              const resolved = resolveImageUrl(u);
              return resolved || '';
            }
          }
          return '';
        } catch (_) {
          return '';
        }
      };

      const nodes = [];
      let last = 0;
      let keySeq = 0;
      let m = null;
      while ((m = TOKEN_RE.exec(srcText)) !== null) {
        const full = m[1] || '';
        const spec = (m[2] != null ? m[2] : m[3]) || '';
        const start = m.index ?? 0;
        const end = start + full.length;
        if (start > last) {
          const chunk = srcText.slice(last, start);
          nodes.push(<React.Fragment key={`txt-${mid || 'x'}-${keySeq++}`}>{renderInlineItalics(chunk)}</React.Fragment>);
        }
        const resolved = resolveBySpec(spec);
        if (resolved) {
          nodes.push(
            // ✅ 이미지 폭 정책(요구사항)
            // - 원본이 지문박스보다 크면: 말풍선 폭을 지문박스 폭(max)까지 늘려 그 안에 맞춰 렌더
            // - 원본이 지문박스보다 작으면: 말풍선/이미지는 원본 폭 유지(늘리지 않음)
            <span key={`img-${mid || 'x'}-${keySeq++}`} className="block my-2 w-fit max-w-full">
              <img
                src={resolved}
                alt=""
                loading="lazy"
                decoding="async"
                className="block w-auto max-w-full h-auto rounded-xl cursor-zoom-in border border-white/10"
                onClick={() => {
                  try {
                    setImageModalSrc(resolved);
                    setImageModalOpen(true);
                  } catch (_) {}
                }}
              />
            </span>
          );
        } else {
          // 매칭 실패 시: 코드를 그대로 노출(디버깅/운영 대응)
          nodes.push(<span key={`bad-${mid || 'x'}-${keySeq++}`} className="text-xs text-gray-400">{full}</span>);
        }
        last = end;
      }
      if (last < srcText.length) {
        const tail = srcText.slice(last);
        nodes.push(<React.Fragment key={`tail-${mid || 'x'}-${keySeq++}`}>{renderInlineItalics(tail)}</React.Fragment>);
      }
      return nodes;
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

    // ✅ 일반 챗(가독성 개선): 캐릭터 응답에서 "서술/지문"을 대사와 분리해 중앙 박스로 렌더
    // - 원문을 바꾸지 않고(displayText 기반), UI에서만 블록화한다.
    const assistantBlocks = (!isUser && !isRegenPending && editingMessageId !== message.id)
      ? parseAssistantBlocks(displayText)
      : [];

    // assistantBlocks 사용 시: message 단위 렌더 대신 "블록" 단위로 렌더한다.
    const shouldRenderAssistantAsBlocks = (!isUser && !isRegenPending && editingMessageId !== message.id && !isOpeningGreeting && !disableAssistantBlocks && !(isNewChatFromUrl && uiOpeningStage !== 'done'))
      ? (Array.isArray(assistantBlocks) && assistantBlocks.length > 0 && assistantBlocks.some((b) => b && b.kind === 'narration'))
      : false;

    if (shouldRenderAssistantAsBlocks) {
      return (
        // ✅ 블록(지문/대사) 간 간격을 "단일 기준"으로 통일(요구사항)
        // - 개별 블록에 mt/mb를 섞어두면 케이스마다 간격이 달라져 "같아 보이지" 않는다.
        // - 부모 컨테이너 gap으로만 간격을 결정해, 지문↔대사 간격을 완전히 동일하게 만든다.
        <div ref={bubbleRef} className={`${isOpeningGreeting ? 'mt-3' : 'mt-4'} mb-1 flex flex-col gap-3`}>
          {(Array.isArray(assistantBlocks) ? assistantBlocks : []).map((b, bi) => {
            const kind = String(b?.kind || 'narration');
            const txt = String(b?.text || '');
            if (!txt.trim()) return null;
            if (kind === 'dialogue') {
              return (
                <div key={`ab-${mid || 'x'}-${bi}-d`} className="flex flex-col items-start">
                  <div className="flex items-center gap-2 mt-0 mb-1">
                    <Avatar className="size-10 rounded-full">
                      <AvatarImage className="object-cover object-top" src={getCharacterPrimaryImage(character)} alt={character?.name} />
                      <AvatarFallback className="bg-gradient-to-r from-purple-500 to-blue-500 text-white">
                        {character?.name?.charAt(0) || <Bot className="w-4 h-4" />}
                      </AvatarFallback>
                    </Avatar>
                    <span className="text-sm text-gray-300">{character?.name}</span>
                  </div>
                  <div
                    className={`relative w-fit max-w-full sm:max-w-[85%] px-3 py-2 rounded-2xl shadow-md overflow-hidden rounded-tl-none cc-assistant-speech-bubble ${
                      resolvedTheme === 'light' ? 'bg-white border border-gray-300' : 'bg-white/10 lg:bg-white/10'
                    }`}
                    style={{ color: resolvedTheme === 'light' ? '#0b0b0b' : uiColors.charSpeech }}
                  >
                    {(!isRegenPending && hasChatHtmlLike(txt)) ? (
                      <div className="message-rich">
                        <RichMessageHtml html={txt} className="message-rich" />
                        {message.isStreaming && <span className="streaming-cursor"></span>}
                      </div>
                    ) : (
                      <p
                        className="whitespace-pre-wrap break-words select-text"
                        style={{ wordBreak: 'break-word', overflowWrap: 'break-word', hyphens: 'auto' }}
                      >
                        {renderTextWithInlineImages(txt)}
                        {message.isStreaming && <span className="streaming-cursor"></span>}
                      </p>
                    )}
                  </div>
                </div>
              );
            }

            // narration
            return (
              <div key={`ab-${mid || 'x'}-${bi}-n`} className="w-full flex justify-center lg:justify-start">
                {/* ✅ PC 요구사항: 아바타 시작점부터 지문박스 시작 + 폭 확대 */}
                <div className="w-full max-w-full sm:max-w-[92%] lg:max-w-full">
                  <div
                    className={`whitespace-pre-line break-words rounded-md px-3 py-2 text-center text-sm ${
                      resolvedTheme === 'light'
                        ? 'bg-gray-100 text-gray-900 border border-gray-200'
                        : 'bg-[#363636]/80 text-white border border-white/10'
                    }`}
                  >
                    {(!isRegenPending && hasChatHtmlLike(txt)) ? (
                      <RichMessageHtml html={txt} className="message-rich text-left" />
                    ) : (
                      renderTextWithInlineImages(txt)
                    )}
                  </div>
                </div>
              </div>
            );
          })}

          {/* ✅ 요구사항: 트리거 이미지는 모두 "인라인"으로 처리한다(말풍선 아래 이미지는 비노출). */}

          {/* 말풍선 바깥 하단 툴바 (AI 메시지 전용) */}
          {!isOpeningGreeting && (
            <div className="mt-1 max-w-full sm:max-w-[85%]">
              <div className="flex items-center gap-2 text-[var(--app-fg)]">
                <Tooltip><TooltipTrigger asChild>
                  <button onClick={()=>handleCopy(message.content)} className="p-1.5 rounded hover:bg-[var(--hover-bg)] text-[var(--app-fg)]"><Copy className="w-4 h-4"/></button>
                </TooltipTrigger><TooltipContent>복사</TooltipContent></Tooltip>
                <Tooltip><TooltipTrigger asChild>
                  <button
                    onClick={()=>handleFeedback(message,'up')}
                    className={`p-1.5 rounded transition-colors ${
                      selectedFeedback === 'up'
                        ? 'bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-400/30'
                        : 'hover:bg-[var(--hover-bg)] text-[var(--app-fg)]'
                    }`}
                    title={selectedFeedback === 'up' ? '추천됨' : '추천'}
                  >
                    <ThumbsUp className="w-4 h-4"/>
                  </button>
                </TooltipTrigger><TooltipContent>추천</TooltipContent></Tooltip>
                <Tooltip><TooltipTrigger asChild>
                  <button
                    onClick={()=>handleFeedback(message,'down')}
                    className={`p-1.5 rounded transition-colors ${
                      selectedFeedback === 'down'
                        ? 'bg-rose-500/20 text-rose-300 ring-1 ring-rose-400/30'
                        : 'hover:bg-[var(--hover-bg)] text-[var(--app-fg)]'
                    }`}
                    title={selectedFeedback === 'down' ? '비추천됨' : '비추천'}
                  >
                    <ThumbsDown className="w-4 h-4"/>
                  </button>
                </TooltipTrigger><TooltipContent>비추천</TooltipContent></Tooltip>
                <Tooltip><TooltipTrigger asChild>
                  <button onClick={()=>openRegenerate(message)} className="p-1.5 rounded hover:bg-[var(--hover-bg)] text-[var(--app-fg)]"><RefreshCcw className="w-4 h-4"/></button>
                </TooltipTrigger><TooltipContent>재생성</TooltipContent></Tooltip>
                <Tooltip><TooltipTrigger asChild>
                  <button onClick={()=>startEdit(message)} className="p-1.5 rounded hover:bg-[var(--hover-bg)] text-[var(--app-fg)]"><Pencil className="w-4 h-4"/></button>
                </TooltipTrigger><TooltipContent>수정</TooltipContent></Tooltip>
              </div>
            </div>
          )}
        </div>
      );
    }

    return (
      <div ref={bubbleRef} className={`${isOpeningGreeting ? 'mt-3' : 'mt-4'} mb-1 ${isUser ? 'flex flex-col items-end' : 'flex flex-col items-start'}`}>
        {/* ✅ 일반챗 유저 말풍선: 아바타/이름 비노출(프리뷰 방식으로 통일) */}
        {!isUser && (
          <div className="flex items-center gap-2 mt-0 mb-1">
            <Avatar className="size-10 rounded-full">
              <AvatarImage className="object-cover object-top" src={getCharacterPrimaryImage(character)} alt={character?.name} />
              <AvatarFallback className="bg-gradient-to-r from-purple-500 to-blue-500 text-white">
                {character?.name?.charAt(0) || <Bot className="w-4 h-4" />}
              </AvatarFallback>
            </Avatar>
            <span className="text-sm text-gray-300">{character?.name}</span>
          </div>
        )}

        <div
          className={`relative w-fit max-w-full ${(!isUser && triggerImageUrl) ? 'sm:max-w-[92%]' : 'sm:max-w-[85%]'} px-3 py-2 rounded-2xl shadow-md overflow-hidden ${isUser ? 'rounded-tr-none' : 'rounded-tl-none'}
            ${isUser
              ? (resolvedTheme === 'light' ? 'bg-white border border-gray-300' : 'bg-white text-black')
              : (resolvedTheme === 'light' ? 'bg-white border border-gray-300' : 'bg-white/10 lg:bg-white/10')}
            ${(!isUser && !message?.isNarration && !shouldApplyNarrationBubbleStyle) ? 'cc-assistant-speech-bubble' : ''}
          `}
          style={{ color: isUser
            ? (resolvedTheme === 'light' ? '#111827' : (message.isNarration ? uiColors.userNarration : uiColors.userSpeech))
            : (resolvedTheme === 'light' ? '#0b0b0b' : (message.isNarration ? uiColors.charNarration : uiColors.charSpeech))
          }}
        >
          {(!isUser && editingMessageId === message.id) ? (
            <div className="space-y-2">
              <Textarea
                ref={editTextareaRef}
                value={editText}
                onChange={(e)=>setEditText(e.target.value)}
                rows={4}
                onKeyDown={(e) => {
                  // 편집 입력 중 키 입력이 상위로 전파되어 스크롤/단축키에 영향 주는 것을 방지
                  try { e.stopPropagation(); } catch (_) {}
                }}
              />
              <div className="flex gap-2 justify-end">
                <Button size="sm" variant="outline" onClick={cancelEdit}>취소</Button>
                <Button size="sm" onClick={saveEdit}>저장</Button>
              </div>
            </div>
          ) : (
            <>
              {(() => {
                /**
                 * ✅ 경쟁사 UX 정합(검수 포인트)
                 *
                 * 요구사항:
                 * - 유저 말풍선에서 "대사 1줄(흰색) + 지문 1줄(분홍색)"이 유지되어야 한다.
                 *
                 * 원리:
                 * - 요술봉 선택지는 `대사\n* 지문` 형태로 전송된다.
                 * - 메시지 렌더에서 2줄 구조를 감지하면, 2번째 줄만 분홍색으로 렌더링한다.
                 *
                 * 방어:
                 * - 정확히 2줄 + 2번째 줄이 `*`로 시작하는 경우에만 적용해 기존 메시지 스타일을 깨지 않는다.
                 */
                const raw = String(displayTextWithInlineTrigger ?? '');
                const lines = raw.split('\n');
                const l1 = String(lines[0] || '').trim();
                const l2raw = String(lines[1] || '').trim();
                const isTwoLineNarration = Boolean(lines.length === 2 && l1 && l2raw && l2raw.startsWith('*'));
                if (!isTwoLineNarration) {
                  if (shouldRenderBubbleAsHtml) {
                    const node = renderBubbleHtml(displayTextWithInlineTrigger);
                    return (
                      <div
                        className="break-words select-text"
                        style={{
                          wordBreak: 'break-word',
                          overflowWrap: 'break-word',
                          hyphens: 'auto',
                        }}
                      >
                        {node}
                        {message.isStreaming && <span className="streaming-cursor"></span>}
                      </div>
                    );
                  }
                  return (
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
                      {/* ✅ 트리거 이미지까지 포함해 인라인 렌더(토큰 → 이미지) */}
                      {renderTextWithInlineImages(displayTextWithInlineTrigger)}
                      {message.isStreaming && <span className="streaming-cursor"></span>}
                    </p>
                  );
                }

                // 2번째 줄: "* " 제거 후 표시(색은 분홍, 스타일은 기존대로 유지)
                const l2 = l2raw.replace(/^\*\s*/, '').trim();
                return (
                  <div className="space-y-1">
                    {hasChatHtmlLike(l1) ? (
                      <RichMessageHtml html={l1} className={`message-rich break-words select-text ${isUser ? 'text-black' : ''}`} />
                    ) : (
                      <p className={`whitespace-pre-wrap break-words select-text ${isUser ? 'text-black' : ''}`}>{l1}</p>
                    )}

                    {hasChatHtmlLike(l2) ? (
                      <div className={`message-rich break-words select-text italic ${isUser ? 'text-black' : ''}`} style={{ fontStyle: 'italic' }}>
                        <RichMessageHtml html={l2} className="message-rich" />
                        {message.isStreaming && <span className="streaming-cursor"></span>}
                      </div>
                    ) : (
                      <p
                        className={`whitespace-pre-wrap break-words select-text italic ${isUser ? 'text-black' : ''}`}
                      >
                        {l2}
                        {message.isStreaming && <span className="streaming-cursor"></span>}
                      </p>
                    )}
                  </div>
                );
              })()}
              {/* ✅ 말풍선 시간 비노출(요구사항): 일반캐릭터챗/원작챗 공통 */}
              {/* 툴바는 말풍선 바깥으로 이동 (아래에서 렌더) */}
            </>
          )}
        </div>

        {/* ✅ 요구사항: 트리거 이미지는 모두 "인라인"으로 처리한다(말풍선 아래 이미지는 비노출). */}

        {/* 말풍선 바깥 하단 툴바 (AI 메시지 전용) */}
        {!isUser && !isOpeningGreeting && (
          <div className="mt-1 max-w-full sm:max-w-[85%]">
            <div className="flex items-center gap-2 text-[var(--app-fg)]">
              <Tooltip><TooltipTrigger asChild>
                <button onClick={()=>handleCopy(message.content)} className="p-1.5 rounded hover:bg-[var(--hover-bg)] text-[var(--app-fg)]"><Copy className="w-4 h-4"/></button>
              </TooltipTrigger><TooltipContent>복사</TooltipContent></Tooltip>
              <Tooltip><TooltipTrigger asChild>
                <button
                  onClick={()=>handleFeedback(message,'up')}
                  className={`p-1.5 rounded transition-colors ${
                    selectedFeedback === 'up'
                      ? 'bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-400/30'
                      : 'hover:bg-[var(--hover-bg)] text-[var(--app-fg)]'
                  }`}
                  title={selectedFeedback === 'up' ? '추천됨' : '추천'}
                >
                  <ThumbsUp className="w-4 h-4"/>
                </button>
              </TooltipTrigger><TooltipContent>추천</TooltipContent></Tooltip>
              <Tooltip><TooltipTrigger asChild>
                <button
                  onClick={()=>handleFeedback(message,'down')}
                  className={`p-1.5 rounded transition-colors ${
                    selectedFeedback === 'down'
                      ? 'bg-rose-500/20 text-rose-300 ring-1 ring-rose-400/30'
                      : 'hover:bg-[var(--hover-bg)] text-[var(--app-fg)]'
                  }`}
                  title={selectedFeedback === 'down' ? '비추천됨' : '비추천'}
                >
                  <ThumbsDown className="w-4 h-4"/>
                </button>
              </TooltipTrigger><TooltipContent>비추천</TooltipContent></Tooltip>
              <Tooltip><TooltipTrigger asChild>
                <button onClick={()=>startEdit(message)} className="p-1.5 rounded hover:bg-[var(--hover-bg)] text-[var(--app-fg)]"><Pencil className="w-4 h-4"/></button>
              </TooltipTrigger><TooltipContent>수정</TooltipContent></Tooltip>
              {isLast && (
                <>
                  <Tooltip><TooltipTrigger asChild>
                    <button
                      onClick={()=>openRegenerate(message)}
                      disabled={Boolean(regenBusyId)}
                      className={`p-1.5 rounded text-[var(--app-fg)] ${regenBusyId ? 'opacity-50 cursor-not-allowed' : 'hover:bg-[var(--hover-bg)]'}`}
                    >
                      <RefreshCcw className="w-4 h-4"/>
                    </button>
                  </TooltipTrigger><TooltipContent>재생성</TooltipContent></Tooltip>
                  <Tooltip><TooltipTrigger asChild>
                    <button
                      onClick={handleContinueAction}
                      disabled={Boolean(inputUiLocked || (isOrigChat && origTurnLoading))}
                      className={`p-1.5 rounded text-[var(--app-fg)] ${
                        (inputUiLocked || (isOrigChat && origTurnLoading)) ? 'opacity-50 cursor-not-allowed' : 'hover:bg-[var(--hover-bg)]'
                      }`}
                    >
                      {(aiTypingEffective || (isOrigChat && origTurnLoading))
                        ? <Loader2 className="w-4 h-4 animate-spin" />
                        : <FastForward className="w-4 h-4"/>
                      }
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
  // ✅ 일반 캐릭터챗도 new=1(새 대화)일 때 메시지가 없으면 로딩 오버레이 표시
  const isNewChatFromUrl = (() => {
    try {
      const p = new URLSearchParams(location.search || '');
      return p.get('new') === '1';
    } catch (_) { return false; }
  })();
  const isInitOverlayActive = Boolean(
    (loading && !hasAnyMessages) ||
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
  // ✅ 소켓 연결 실패가 명확히 발생한 경우(예: connect_error), "연결 중" 오버레이만 계속 보여주면 UX가 매우 나빠진다.
  // - socketError가 있으면 중앙 상태 팝업은 숨기고, 상단 에러(Alert) + 액션 버튼으로 유도한다.
  const isSocketDisconnectedPopupActive = Boolean(!isOrigChat && chatRoomId && !connected && !socketError);
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

  useEffect(() => {
    /**
     * ✅ 채팅 이미지 패널(대표이미지+갤러리) 표시 옵션(기본 OFF)
     *
     * 요구사항:
     * - PC: OFF면 채팅만(단색 배경), ON이면 채팅 옆에 대표이미지+갤러리 패널 표시
     * - 모바일: OFF면 단색 배경(PC와 동일), ON이면 현재처럼 배경 이미지+미니 갤러리 표시
     *
     * SSOT:
     * - localStorage 'cc:chat:settings:v1'.media_panel
     * - ModelSelectionModal(추가 설정)에서 즉시 저장/이벤트로 동기화한다.
     */
    const apply = () => {
      try {
        const raw = localStorage.getItem('cc:chat:settings:v1');
        if (!raw) { setMediaPanelEnabled(false); return; }
        const parsed = JSON.parse(raw || '{}') || {};
        if (typeof parsed?.media_panel === 'boolean') {
          setMediaPanelEnabled(Boolean(parsed.media_panel));
          return;
        }
        setMediaPanelEnabled(false);
      } catch (_) {
        setMediaPanelEnabled(false);
      }
    };
    apply();
    const onChanged = () => apply();
    try { window.addEventListener('chat:settingsUpdated', onChanged); } catch (_) {}
    return () => {
      try { window.removeEventListener('chat:settingsUpdated', onChanged); } catch (_) {}
    };
  }, []);

  // ✅ 접근 불가(비공개) 경고 모달 (어떤 return 경로에서도 렌더되도록 상단에 선언)
  // ✅ AlertDialog(onOpenChange) 방어:
  // - 일부 환경에서 onOpenChange가 동일 값(false)을 반복 호출하면, object state를 매번 새 객체로 set하여
  //   "Maximum update depth exceeded" 루프가 생길 수 있다.
  const accessDeniedWasOpenRef = useRef(false);
  useEffect(() => { accessDeniedWasOpenRef.current = !!accessDeniedModal?.open; }, [accessDeniedModal?.open]);

  const accessDeniedDialogEl = (
    <AlertDialog
      open={!!accessDeniedModal.open}
      onOpenChange={(open) => {
        const nextOpen = !!open;
        // ✅ 동일 값이면 state를 업데이트하지 않는다(무한루프 방지)
        setAccessDeniedModal((prev) => {
          const prevOpen = !!(prev?.open);
          if (prevOpen === nextOpen) return prev || { open: false, message: '' };
          return { ...(prev || {}), open: nextOpen };
        });
        // 확인/닫기에서만 이동(초기 렌더/동일 false 콜백에서 이동 방지)
        if (accessDeniedWasOpenRef.current && !nextOpen) {
          try { navigate('/', { replace: true }); } catch (_) {}
        }
      }}
    >
      <AlertDialogContent className="bg-gray-900 border border-gray-700 text-white">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-white">접근 불가</AlertDialogTitle>
          <AlertDialogDescription className="text-gray-300">
            {accessDeniedModal.message || '비공개된 콘텐츠입니다.'}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogAction
            className="bg-purple-600 hover:bg-purple-700 text-white"
            onClick={() => {
              setAccessDeniedModal({ open: false, message: '' });
              try { navigate('/', { replace: true }); } catch (_) {}
            }}
          >
            확인
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

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
        {accessDeniedDialogEl}
      </div>
    );
  }

  if (error && !character) {
    const isDeletedWork = String(error || '').includes('삭제된 작품');
    const isDeletedCharacter = String(error || '').includes('삭제된 캐릭터');
    const isPrivateWork = String(error || '').includes('비공개');
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-50 via-blue-50 to-indigo-50 flex items-center justify-center">
        <div className="text-center">
          <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">
            {isDeletedWork ? '삭제된 작품입니다' : (isDeletedCharacter ? '삭제된 캐릭터입니다' : (isPrivateWork ? '접근할 수 없습니다' : '오류가 발생했습니다'))}
          </h3>
          <p className="text-gray-600 mb-4">{error}</p>
          <Button onClick={() => navigate('/')} variant="outline">
            홈으로 돌아가기
          </Button>
        </div>
        {accessDeniedDialogEl}
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
      // ✅ (오해 방지) 이 팝업은 aiTyping=false 인 상태에서만 켜지므로,
      // "응답 생성 중"이 아니라 "전송 확인(ACK) 지연"에 가깝다.
      const title = '전송 확인이 지연되고 있어요';
      const body = '네트워크/서버 상황으로 전송 확인이 늦어질 수 있어요. 잠시만 기다려 주세요.';
      const slow = '10초 이상 지속되면 Wi‑Fi/데이터를 확인하거나 페이지를 새로고침 해주세요.';
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
        const res = await chatAPI.getMessages(chatRoomId, { tail: 1, skip: 0, limit: 200 });
        const items = Array.isArray(res?.data) ? res.data : [];
        if (items.length > 0) {
          setMessages(items);
          // ✅ 오프닝 연출 생략은 실제 reload에서만 처리한다.
          // - 수동 재시도(handleInitRetry) 경로에서는 uiOpeningStage를 강제 완료 처리하지 않는다.
          // assistant 메시지가 하나라도 있으면 "준비 완료"로 간주(무한 오버레이 방지)
          const hasAssistant = items.some((m) => String(m?.senderType || m?.sender_type || '').toLowerCase() === 'assistant');
          if (hasAssistant) {
            setOrigMeta((prev) => ({ ...(prev || {}), init_stage: 'ready', intro_ready: true }));
          }
        }
      } catch (_) {}
    } catch (_) {}
  };

  return (
    <div className="h-screen h-[100dvh] bg-[var(--app-bg)] text-[var(--app-fg)] flex">
      {/* ✅ PC 전용: 좌측 앱 사이드바(경쟁사 UX) */}
      <div className="hidden lg:flex h-full">
        <Sidebar />
      </div>
      <div className="flex-1 min-w-0 flex flex-col">
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
          <div className={`flex items-center justify-between h-16 px-4 sm:px-6 ${
            // ✅ 경쟁사 PC 레이아웃(사이드바 제외 본문): media 패널 OFF일 때 max-w 840 + px-9로 센터 정렬
            // - ON일 때는 기존(이미지 패널 + 채팅) 정렬을 유지한다.
            mediaPanelEnabled ? 'lg:px-8 lg:max-w-[1200px] lg:mx-auto' : 'lg:px-9 lg:max-w-[840px] lg:mx-auto'
          }`}>
            <div className="flex items-center space-x-2">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => {
                  /**
                   * ✅ 원작챗 뒤로가기 UX(요구사항):
                   * - 원작챗 채팅방에서 뒤로가기(←)를 누르면 "원작챗 상세페이지"로 돌아가야 한다.
                   * - 현재 프론트의 "원작챗 격자 카드 클릭" 동작이 `캐릭터 상세(/characters/:id)`이므로,
                   *   채팅방에서도 동일하게 `/characters/:id`로 복귀시킨다.
                   * - 단, 원작챗 컨텍스트(스토리Id)는 상세에서 원작 카드/링크 등에 필요할 수 있어 쿼리에 유지한다(베스트 에포트).
                   */
                  if (isOrigChat) {
                    try {
                      const sid = String(origStoryId || '').trim();
                      if (sid) {
                        navigate(`/characters/${characterId}?source=origchat&storyId=${encodeURIComponent(sid)}`);
                        return;
                      }
                    } catch (_) {}
                    navigate(`/characters/${characterId}`);
                    return;
                  }
                  navigate(`/characters/${characterId}`);
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
              {/* ✅ 일반챗 진행률 UI: PC에서는 헤더 안에 (모바일은 헤더 아래) */}
              {!isOrigChat && (
                <div className="hidden lg:flex items-center gap-3">
                  {(() => {
                    const tc = Number.isFinite(Number(chatProgress?.turnCount)) ? Math.max(0, Math.floor(Number(chatProgress.turnCount))) : 0;
                    const mt = (chatProgress?.maxTurns != null && Number.isFinite(Number(chatProgress.maxTurns)) && Number(chatProgress.maxTurns) >= 50)
                      ? Math.floor(Number(chatProgress.maxTurns))
                      : null;
                    const isInf = Boolean(chatProgress?.isInfinite) || !mt;
                    const pct = isInf ? 100 : Math.max(0, Math.min(100, Math.round((tc / mt) * 100)));
                    const pctLabel = isInf ? INFTY : `${pct}%`;
                    const denomLabel = isInf ? INFTY : String(mt);
                    const leftLabel = `${tc}/${denomLabel}`;
                    return (
                      <div className="flex items-center gap-3">
                        <div className={`text-[12px] font-semibold tabular-nums ${
                          resolvedTheme === 'light' ? 'text-gray-700' : 'text-gray-200'
                        }`}>
                          {leftLabel}
                        </div>
                        <div
                          className={`relative w-[220px] h-2.5 rounded-full overflow-hidden ${
                            resolvedTheme === 'light' ? 'bg-gray-200 border border-gray-300' : 'bg-white/10 border border-white/10'
                          }`}
                          role="progressbar"
                          aria-label={`진행률 ${leftLabel} (${pctLabel})`}
                          aria-valuenow={isInf ? 100 : pct}
                          aria-valuemin={0}
                          aria-valuemax={100}
                        >
                          <div
                            className="absolute inset-y-0 left-0 bg-gradient-to-r from-purple-500 to-indigo-500"
                            style={{ width: `${pct}%` }}
                          />
                          {isInf && (
                            <div className="absolute inset-0 flex items-center justify-center text-[10px] font-bold text-white drop-shadow">
                              {INFTY}
                            </div>
                          )}
                        </div>
                        <div className={`text-[12px] font-bold tabular-nums ${
                          resolvedTheme === 'light' ? 'text-gray-800' : 'text-gray-100'
                        }`}>
                          {pctLabel}
                        </div>
                      </div>
                    );
                  })()}
                </div>
              )}
              {/* ✅ 원작챗: 수동 동기화 버튼(모바일/PC 공통) */}
              {isOrigChat && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="동기화"
                      className="rounded-full text-[var(--app-fg)] hover:bg-[var(--hover-bg)]"
                      onClick={handleOrigSync}
                      disabled={origTurnLoading || origSyncLoading}
                      title="동기화"
                    >
                      <RefreshCcw className={`w-5 h-5 ${origSyncLoading ? 'animate-spin' : ''}`} />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>동기화</TooltipContent>
                </Tooltip>
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

      {/* ✅ 일반챗 진행률바: 헤더 바로 아래로 이동(요구사항) */}
      {!isOrigChat && (
        <div className="lg:hidden bg-[var(--header-bg)] text-[var(--app-fg)] border-b border-gray-800">
          {/* ✅ PC 정렬 안정화: 본문 그리드와 동일한 구조로 정렬 */}
          <div className="lg:grid lg:grid-cols-[480px_560px] lg:justify-center lg:mx-auto lg:items-center">
            {/* 왼쪽: 빈 공간(이미지 영역과 정렬 맞춤) */}
            <div className="hidden lg:block w-[480px]"></div>

            {/* 오른쪽: 진행률 UI */}
            <div className="w-full px-4 py-2 lg:px-0 lg:py-2">
              {(() => {
                const tc = Number.isFinite(Number(chatProgress?.turnCount)) ? Math.max(0, Math.floor(Number(chatProgress.turnCount))) : 0;
                const mt = (chatProgress?.maxTurns != null && Number.isFinite(Number(chatProgress.maxTurns)) && Number(chatProgress.maxTurns) >= 50)
                  ? Math.floor(Number(chatProgress.maxTurns))
                  : null;
                const isInf = Boolean(chatProgress?.isInfinite) || !mt;
                const pct = isInf ? 100 : Math.max(0, Math.min(100, Math.round((tc / mt) * 100)));
                const pctLabel = isInf ? INFTY : `${pct}%`;
                const denomLabel = isInf ? INFTY : String(mt);
                const leftLabel = `${tc}/${denomLabel}`;

                return (
                  <div className="flex items-center gap-3">
                    <div className={`text-[12px] font-semibold tabular-nums ${
                      resolvedTheme === 'light' ? 'text-gray-700' : 'text-gray-200'
                    }`}>
                      {leftLabel}
                    </div>

                    <div
                      className={`relative flex-1 h-3 rounded-full overflow-hidden ${
                        resolvedTheme === 'light' ? 'bg-gray-200 border border-gray-300' : 'bg-white/10 border border-white/10'
                      }`}
                      role="progressbar"
                      aria-label={`진행률 ${leftLabel} (${pctLabel})`}
                      aria-valuenow={isInf ? 100 : pct}
                      aria-valuemin={0}
                      aria-valuemax={100}
                    >
                      <div
                        className="absolute inset-y-0 left-0 bg-gradient-to-r from-purple-500 to-indigo-500"
                        style={{ width: `${pct}%` }}
                      />
                      {isInf && (
                        <div className="absolute inset-0 flex items-center justify-center text-[10px] font-bold text-white drop-shadow">
                          {INFTY}
                        </div>
                      )}
                    </div>

                    <div className={`text-[12px] font-bold tabular-nums ${
                      resolvedTheme === 'light' ? 'text-gray-800' : 'text-gray-100'
                    }`}>
                      {pctLabel}
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {/* ✅ 원작챗 수동 동기화 안내(1회): UI를 해치지 않게 작게, 헤더 아래에 잠깐만 노출 */}
      {isOrigChat && showOrigSyncHint && (
        <div className="fixed top-[72px] right-3 z-50 pointer-events-auto">
          <div className="max-w-[280px] rounded-xl border border-gray-700 bg-black/80 text-white shadow-xl px-3 py-2">
            <div className="flex items-start gap-2">
              <RefreshCcw className="w-4 h-4 mt-0.5 text-cyan-200" />
              <div className="text-xs leading-relaxed text-gray-200">
                <span className="font-semibold text-white">↻</span> 눌러 최신 대화 불러오기
              </div>
              <button
                type="button"
                className="ml-1 text-gray-400 hover:text-white"
                aria-label="닫기"
                onClick={() => setShowOrigSyncHint(false)}
              >
                ×
              </button>
            </div>
            <div className="mt-2 flex justify-end">
              <Button
                variant="outline"
                className="h-7 px-2 bg-gray-900 border-gray-700 text-gray-100 hover:bg-gray-800"
                onClick={handleOrigSync}
                disabled={origTurnLoading || origSyncLoading}
              >
                동기화
              </Button>
            </div>
          </div>
        </div>
      )}
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
        {mediaPanelEnabled && !isDesktopViewport && (
          <div className={`lg:hidden absolute inset-0 overflow-hidden ${resolvedTheme === 'light' ? 'bg-white' : 'bg-black'}`}>
            {currentPortraitUrl ? (
              (() => {
                // ✅ 크롭 금지: 원본 비율 그대로 표시(object-contain)
                const raw = resolveImageUrl(getThumbnailUrl(currentPortraitUrl, 1200) || currentPortraitUrl);
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
            {/* ✅ 모바일: 배경 위 회색 딤/그라데이션 레이어 제거(윤곽선 밖으로 튀어나오는 현상 방지) */}
          </div>
        )}

        {/* ✅ 높이 고정(calc) 제거: footer(입력바) 높이만큼 좌측 미니갤러리가 잘리는 문제 방지 */}
        <div className={`relative z-10 grid grid-cols-1 ${mediaPanelEnabled ? 'lg:grid-cols-[480px_560px]' : 'lg:grid-cols-[minmax(0,840px)]'} lg:justify-center h-full min-h-0`}>
          {mediaPanelEnabled && isDesktopViewport && (
          <aside className="hidden lg:flex flex-col border-r w-[480px] flex-shrink-0">
            {/* 대표 이미지 영역 */}
            <div className="flex-1 relative min-h-0">
              {/* 캐러셀: 상반신 기준 포트레이트 */}
              {(() => {
                const primary = getCharacterPrimaryImage(character);
                const currentImage = (characterImages && characterImages.length > 0)
                  ? characterImages[currentImageIndex]
                  : primary;
                const fullSrc = resolveImageUrl(getThumbnailUrl(currentImage, 1400) || currentImage);
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
                        setImageModalSrc(resolveImageUrl(currentImage) || fullSrc);
                        setImageModalOpen(true);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          setImageModalSrc(resolveImageUrl(currentImage) || fullSrc);
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
                          key={String(img || idx)}
                          onClick={() => setCurrentImageIndex(idx)}
                          className={`relative flex-shrink-0 transition-all ${
                            idx === currentImageIndex 
                              ? 'ring-2 ring-purple-500 ring-offset-1 ring-offset-black' 
                              : 'opacity-70 hover:opacity-100'
                          }`}
                          aria-label={`이미지 ${idx + 1}`}
                        >
                          <img
                            src={resolveImageUrl(getThumbnailUrl(img, 144) || img)}
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
          )}
          <main
            ref={chatContainerRef}
            onScroll={handleScroll}
            className={`relative overflow-y-auto p-4 md:p-6 ${mediaPanelEnabled ? 'lg:px-8' : 'lg:px-9'} pt-4 sm:pt-6 lg:pt-6 ${mediaPanelEnabled ? 'bg-transparent lg:bg-[var(--app-bg)]' : 'bg-[var(--app-bg)]'} scrollbar-dark w-full`}
            style={{ scrollbarGutter: 'stable' }}
          >
            <div className={`relative z-10 w-full space-y-6 mt-0 ${textSizeClass} ${
              uiLetterSpacing==='tighter'?'tracking-tighter':uiLetterSpacing==='tight'?'tracking-tight':uiLetterSpacing==='wide'?'tracking-wide':uiLetterSpacing==='wider'?'tracking-wider':'tracking-normal'
            } ${uiFontFamily==='serif'?'cc-chat-serif':'cc-chat-pretendard'}`}>
          {historyLoading && (
            <div className="flex justify-center py-4">
              <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
            </div>
          )}
          {socketError && (
            <Alert variant="destructive" className="mb-4">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                <div className="space-y-2">
                  <div>{socketError}</div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <Button
                      type="button"
                      variant="outline"
                      className="h-8 px-3 bg-white/5 border-white/20 text-white hover:bg-white/10"
                      onClick={() => {
                        try { window.location.reload(); } catch (_) {}
                      }}
                    >
                      새로고침
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      className="h-8 px-3 bg-white/5 border-white/20 text-white hover:bg-white/10"
                      onClick={() => {
                        try {
                          localStorage.removeItem('access_token');
                          localStorage.removeItem('refresh_token');
                        } catch (_) {}
                        try { window.location.href = '/login'; } catch (_) {}
                      }}
                    >
                      다시 로그인
                    </Button>
                  </div>
                </div>
              </AlertDescription>
            </Alert>
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
                {(() => {
                  const nm = character?.name || '캐릭터';
                  const raw = character?.description || '';
                  const rendered = replacePromptTokens(raw, { assistantName: nm, userName: '당신' }).trim();
                  return rendered || '';
                })()}
              </p>
            </div>
          ) : (
            <ErrorBoundary>
              {messages.map((m, index) => {
                const mid = String(m?.id || m?._id || m?.message_id || m?.messageId || '').trim();
                const ts = String(m?.created_at || m?.createdAt || m?.timestamp || '').trim();
                const sender = String(m?.senderType || m?.sender_type || '').trim();
                const contentHead = String(m?.content || '').slice(0, 24);
                const stableKey = mid || `${sender}:${ts}:${contentHead}:${index}`;
                const shouldHideOpeningGreetingDuringIntro = (() => {
                  /**
                   * ✅ 요구사항: 오프닝에서 "지문(intro)" 스트리밍이 끝난 뒤에야
                   * 첫 대사(첫 assistant 말풍선)가 나타나며 스트리밍되는 것이 자연스럽다.
                   *
                   * 문제:
                   * - 메시지 배열에는 intro 다음의 첫 대사 메시지가 이미 존재하므로,
                   *   intro 스트리밍 중(uiOpeningStage: idle/intro)에도 첫 대사가 "완성 텍스트"로 먼저 보일 수 있다.
                   *
                   * 해결(최소 변경/방어적):
                   * - new=1 진입 + 오프닝 스트리밍이 아직 완료되지 않은 구간에서만,
                   *   "첫 대사 메시지" 렌더를 잠깐 숨긴다.
                   * - greeting 단계에서는 숨기지 않는다(그때부터는 uiStream으로 스트리밍 렌더).
                   */
                  try {
                    if (isOrigChat) return false;
                    if (!openingGreetingMessageId) return false;
                    if (!mid || String(mid) !== String(openingGreetingMessageId)) return false;

                    const params = new URLSearchParams(location.search || '');
                    const isNewChat = String(params.get('new') || '').trim() === '1';
                    if (!isNewChat) return false;

                    // greeting 단계에서는 스트리밍을 보여줘야 하므로 숨기지 않는다.
                    if (uiOpeningStage === 'greeting') {
                      // ✅ 첫대사 완성본 선노출 방지:
                      // - greeting 단계에서 실제 스트리밍 바인딩(uiStream.id)이 붙기 전까지는 숨긴다.
                      // - 스트리밍이 끝난(done) 상태면 정상 노출한다.
                      const hasGreetingStream = Boolean(uiStream?.id && String(uiStream.id) === String(mid));
                      const done = Boolean(uiStreamDoneByIdRef.current && uiStreamDoneByIdRef.current[String(mid)]);
                      return !hasGreetingStream && !done;
                    }
                    if (uiOpeningStage === 'done') return false;

                    // idle/intro 단계에서만 숨김(첫 대사 선노출 방지)
                    return (uiOpeningStage === 'idle' || uiOpeningStage === 'intro');
                  } catch (_) {
                    return false;
                  }
                })();
                if (shouldHideOpeningGreetingDuringIntro) return null;
                const isIntro = (() => {
                  try {
                    const kind = String(m?.message_metadata?.kind || '').toLowerCase();
                    const params = new URLSearchParams(location.search || '');
                    const isNewChat = String(params.get('new') || '').trim() === '1';
                    const sender = String(m?.senderType || m?.sender_type || '').toLowerCase();
                    const isAssistantLike = (sender === 'assistant' || sender === 'ai' || sender === 'character');
                    // 1) 정상: metadata.kind=intro
                    if (kind === 'intro') {
                      const introMid = String(mid || '').trim();
                      if (!introMid) return false;
                      return Boolean(openingIntroMessageId && introMid === String(openingIntroMessageId));
                    }
                    // 2) 방어: new=1 오프닝인데 메타 누락/변형 시 첫 assistant 메시지를 intro로 간주
                    if (isNewChat && index === 0 && isAssistantLike) return true;
                    return false;
                  } catch (_) {
                    return false;
                  }
                })();
                if (isIntro) {
                  const introId = String(m?.id || m?._id || '').trim();
                  const introRender = (() => {
                    /**
                     * ✅ 경쟁사처럼 "오프닝부터 웹툰 컷 이미지(<img>)가 박스 안에 렌더"되게 하기.
                     *
                     * 핵심:
                     * - intro(지문박스)는 기존에 [[img:...]] 토큰만 렌더했어서, 크리에이터가 넣은 <img>/<a>가 텍스트로 보였다.
                     * - intro에 HTML이 포함된 경우에는 RichMessageHtml로 안전 렌더해야 한다(이미 sanitize 적용).
                     *
                     * 방어:
                     * - intro 스트리밍(uiIntroStream.shown)은 HTML 태그가 "중간에 끊긴 상태"를 만들 수 있어,
                     *   HTML이 있는 intro에서는 스트리밍 텍스트를 사용하지 않고 항상 full content를 사용한다.
                     */
                    const full = String(m?.content || '');
                    const hasHtml = hasChatHtmlLike(full);
                    const canStream = Boolean(introId && uiIntroStream?.id && String(uiIntroStream.id) === introId);
                    const isNewChatNow = (() => {
                      try {
                        const params = new URLSearchParams(location.search || '');
                        return String(params.get('new') || '').trim() === '1';
                      } catch (_) {
                        return false;
                      }
                    })();
                    if (!canStream) {
                      // ✅ 오프닝 구간(new=1, idle/intro)에서는 완성본 선노출을 막는다.
                      // - 지문박스가 "스트리밍 안 되는 것처럼" 보이는 현상을 방지한다.
                      if (isNewChatNow && (uiOpeningStage === 'idle' || uiOpeningStage === 'intro')) {
                        return { text: String(uiIntroStream?.shown || ''), asHtml: false };
                      }
                      return { text: full, asHtml: hasHtml };
                    }
                    const shown = String(uiIntroStream.shown || '');
                    if (!hasHtml) return { text: shown, asHtml: false };
                    return { text: normalizeIntroStreamText(shown), asHtml: false };
                  })();
                  return (
                    <div key={`intro-${stableKey}`} className="mt-3 w-full flex justify-center lg:justify-start">
                      {/* ✅ PC 요구사항: 아바타 시작점부터 지문박스가 시작하도록 더 넓게(=컨테이너 풀폭) */}
                      <div className="w-full max-w-full sm:max-w-[92%] lg:max-w-full">
                        <div
                          className={`whitespace-pre-line break-words rounded-md px-3 py-2 text-center text-sm ${
                            resolvedTheme === 'light'
                              ? 'bg-gray-100 text-gray-900 border border-gray-200'
                              : 'bg-[#363636]/80 text-white border border-white/10'
                          }`}
                        >
                          {(() => {
                            // ✅ intro도 HTML(<img>/<a>/리스트 태그 등)이면 RichMessageHtml로 렌더
                            // - HTML이 아니면 기존대로 이미지 토큰([[img:...]]/{{img:...}}) 렌더를 유지
                            if (introRender?.asHtml && hasChatHtmlLike(introRender?.text)) {
                              return <RichMessageHtml html={introRender.text} className="message-rich" />;
                            }
                            return renderTextWithInlineImages(String(introRender?.text || ''));
                          })()}
                        </div>
                      </div>
                    </div>
                  );
                }

                return (
                  // ✅ 편집 Textarea에서 Backspace 연속 입력(키 반복)이 끊기는 문제 방지
                  //
                  // 원인:
                  // - ChatPage 내부에 `const MessageBubble = (...) => {}` 형태로 컴포넌트를 선언하고
                  //   `<MessageBubble />`로 렌더하면, ChatPage가 re-render 될 때마다 MessageBubble의
                  //   "컴포넌트 타입(함수 참조)"이 바뀌어 React가 말풍선을 언마운트/리마운트할 수 있다.
                  // - 편집 중 editText가 바뀌면 re-render가 발생 → Textarea가 재마운트 → 포커스가 풀리며
                  //   Backspace 키 반복이 1회로 끊기는 현상이 발생할 수 있다.
                  //
                  // 해결(최소 변경):
                  // - MessageBubble을 "컴포넌트"로 쓰지 않고, 단순 렌더 함수로 호출해 JSX를 반환한다.
                  // - hooks를 사용하지 않는 순수 렌더 함수라 안전하며, DOM 노드가 안정적으로 유지된다.
                  <React.Fragment key={`msg-${stableKey}`}>
                    {MessageBubble({
                      message: m,
                      isLast: index === messages.length - 1 && !aiTypingEffective,
                      // ✅ 오프닝 고정:
                      // - "intro 바로 다음 assistant 메시지"는 항상 첫대사 말풍선으로 렌더한다.
                      // - 휴리스틱 블록 파서(parseAssistantBlocks)를 태우지 않아 지문 박스로 오분류되지 않게 한다.
                      disableAssistantBlocks: (() => {
                        try {
                          const metaKind = String(m?.message_metadata?.kind || '').toLowerCase();
                          if (metaKind === 'opening_first_line') return true;
                          const arr = Array.isArray(messages) ? messages : [];
                          if (index <= 0) return false;
                          const prevKind = String(arr?.[index - 1]?.message_metadata?.kind || '').toLowerCase();
                          const t = String(m?.senderType || m?.sender_type || '').toLowerCase();
                          const isAssistantLike = (t === 'assistant' || t === 'ai' || t === 'character');
                          return prevKind === 'intro' && isAssistantLike;
                        } catch (_) {
                          return false;
                        }
                      })(),
                      // ✅ 요구사항: RP/시뮬 모두 "트리거 이미지"는 그대로 노출한다.
                      triggerImageUrl: aiMessageImages[mid || stableKey],
                    })}
                    {(() => {
                      // ✅ 로컬 UI 말풍선(상태창/정보)을 "해당 메시지 바로 아래"에 렌더(사라짐 방지)
                      try {
                        const activeRoomId = (() => {
                          try {
                            const rid = String(chatRoomId || '').trim();
                            if (rid) return rid;
                            return String(new URLSearchParams(location.search || '').get('room') || '').trim();
                          } catch (_) {
                            return '';
                          }
                        })();
                        if (!activeRoomId) return null;
                        const anchor = String(mid || '').trim();
                        if (!anchor) return null;
                        const list = Array.isArray(localUiBubbles) ? localUiBubbles : [];
                        const anchored = list.filter((b) => String(b?.roomId || '') === activeRoomId && String(b?.anchorId || '') === anchor);
                        if (!anchored.length) return null;
                        return (
                          <>
                            {anchored.map((b) => (
                              <React.Fragment key={`local-${String(b?.id || '')}`}>
                                {MessageBubble({
                                  message: {
                                    id: b.id,
                                    roomId: activeRoomId,
                                    senderType: 'assistant',
                                    sender_type: 'assistant',
                                    content: '',
                                    created_at: b.created_at,
                                    message_metadata: { kind: b.kind, ...(b.payload ? { sim_status: b.payload } : {}) },
                                  },
                                  isLast: false,
                                  triggerImageUrl: null,
                                })}
                              </React.Fragment>
                            ))}
                          </>
                        );
                      } catch (e) {
                        try { console.warn('[ChatPage] render local ui bubble failed:', e); } catch (_) {}
                        return null;
                      }
                    })()}
                    {(() => {
                      try {
                        if (isOrigChat) return null;
                        // ✅ 요구사항: 오프닝 후 "대표이미지" 별도 노출은 비활성화한다.
                        // - 트리거 이미지와 겹치면 UX가 꼬일 수 있어, 대표이미지 블록은 아예 숨긴다.
                        return null;
                        // ✅ 계속대화(재입장)에서도 대표이미지가 항상 떠야 한다(요구사항)
                        // - 오프닝 스트리밍은 new=1일 때만 실행되므로, 재입장에서는 uiOpeningStage가 idle로 남는다.
                        // - 따라서 new=1인 경우에만 done을 기다리고, 그 외에는 즉시 표시한다.
                        const isNewChat = (() => {
                          try {
                            const params = new URLSearchParams(location.search || '');
                            return String(params.get('new') || '').trim() === '1';
                          } catch (_) {
                            return false;
                          }
                        })();
                        if (isNewChat && uiOpeningStage !== 'done') return null;
                        const mid = String(m?.id || m?._id || '').trim();
                        if (!mid) return null;
                        if (!openingGreetingMessageId || mid !== openingGreetingMessageId) return null;
                        if (!openingRepresentativeImageUrl) return null;
                        const introText = (() => {
                          try {
                            const it = (Array.isArray(messages) ? messages : []).find((x) => String(x?.message_metadata?.kind || '').toLowerCase() === 'intro');
                            return it ? String(it?.content || '') : '';
                          } catch (_) { return ''; }
                        })();
                        const simInfoPayload = (() => {
                          try {
                            if (!isSimulatorChat) return null;
                            if (!simStatusSnapshot) return null;
                            return buildSimStatusPayload(simStatusSnapshot, introText);
                          } catch (_) { return null; }
                        })();
                        return (
                          <>
                            <div className="mt-2 flex justify-center">
                              <button
                                type="button"
                                className="max-w-full sm:max-w-[85%] block"
                                onClick={() => {
                                  try {
                                    setImageModalSrc(openingRepresentativeImageUrl);
                                    setImageModalOpen(true);
                                  } catch (_) {}
                                }}
                                aria-label="대표 이미지 확대"
                                title="대표 이미지"
                              >
                                <img
                                  src={openingRepresentativeImageUrl}
                                  alt=""
                                  loading="lazy"
                                  decoding="async"
                                  className="block w-full h-auto rounded-xl border border-white/10 cursor-zoom-in"
                                />
                              </button>
                            </div>
                            {/* ✅ 시뮬: 오프닝 대표이미지 아래 info(목표/상태) 말풍선 */}
                            {isSimulatorChat && simInfoPayload && (
                              <div className="mt-2">
                                {MessageBubble({
                                  message: {
                                    id: `opening-sim-info-${mid}`,
                                    senderType: 'assistant',
                                    sender_type: 'assistant',
                                    content: '',
                                    message_metadata: { kind: 'sim_info', sim_status: simInfoPayload },
                                  },
                                  isLast: false,
                                  triggerImageUrl: null,
                                })}
                              </div>
                            )}
                          </>
                        );
                      } catch (e) {
                        try { console.warn('[ChatPage] render opening representative image failed:', e); } catch (_) {}
                        return null;
                      }
                    })()}
                  </React.Fragment>
                );
              })}
              {(() => {
                // ✅ tail(맨 아래) 로컬 UI 말풍선: 명시적으로 tail에 붙인 버블만 렌더
                try {
                  const activeRoomId = (() => {
                    try {
                      const rid = String(chatRoomId || '').trim();
                      if (rid) return rid;
                      return String(new URLSearchParams(location.search || '').get('room') || '').trim();
                    } catch (_) {
                      return '';
                    }
                  })();
                  if (!activeRoomId) return null;
                  const list = Array.isArray(localUiBubbles) ? localUiBubbles : [];
                  const anchored = list.filter((b) => String(b?.roomId || '') === activeRoomId && String(b?.anchorId || '') === String(UI_TAIL_ANCHOR));
                  if (!anchored.length) return null;
                  return (
                    <>
                      {anchored.map((b) => (
                        <React.Fragment key={`local-tail-${String(b?.id || '')}`}>
                          {MessageBubble({
                            message: {
                              id: b.id,
                              roomId: activeRoomId,
                              senderType: 'assistant',
                              sender_type: 'assistant',
                              content: '',
                              created_at: b.created_at,
                              message_metadata: { kind: b.kind, ...(b.payload ? { sim_status: b.payload } : {}) },
                            },
                            isLast: false,
                            triggerImageUrl: null,
                          })}
                        </React.Fragment>
                      ))}
                    </>
                  );
                } catch (_) {
                  return null;
                }
              })()}
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

              {/* ✅ 요술봉 선택지(일반챗): "채팅창(스크롤) 안" 맨 아래에 표시 */}
              {!isOrigChat && magicMode && !aiTypingEffective && !nextActionBusy && (magicChoices.length > 0 || magicLoading) && (
                <div className="mt-3">
                  {/* ✅ 로딩 중 UI: 선택지 3개 자리에서 각각 "... 말풍선"으로 표시 */}
                  {magicLoading && (!Array.isArray(magicChoices) || magicChoices.length === 0) ? (
                    <div className="flex flex-col items-end">
                      {/* ✅ 로딩 말풍선 우측 정렬: w-full을 쓰면 좌측처럼 보이므로, 폭을 제한하고 ml-auto로 밀어준다 */}
                      <div className="w-full max-w-[85%] space-y-2">
                        {['loading-1', 'loading-2', 'loading-3'].map((id) => (
                          <div
                            key={id}
                            className={`ml-auto w-full px-4 py-3 rounded-2xl border ${
                              resolvedTheme === 'light'
                                ? 'bg-white border-gray-200'
                                : 'bg-black/40 border-white/10'
                            }`}
                            title="선택지 생성 중"
                            aria-busy="true"
                          >
                            {/* 캐릭터 타이핑 말풍선의 점 애니메이션과 동일한 형태 */}
                            <div className="flex space-x-1">
                              <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
                              <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                              <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col items-end">
                      <div className="w-full sm:max-w-[85%]">
                        <div className="space-y-2">
                          {(Array.isArray(magicChoices) ? magicChoices : []).slice(0, Math.max(0, Math.min(3, magicRevealCount || 0))).map((c) => (
                            <button
                              key={c.id}
                              type="button"
                              disabled={magicLoading || !c?.label}
                              onClick={() => {
                                const dialogue = String(c?.dialogue || '').trim();
                                const narrationRaw = String(c?.narration || '').trim();
                                const label = String(c?.label || '').trim();
                                const base = label || [dialogue, narrationRaw].filter(Boolean).join('\n');
                                if (!base) return;
                                const parts = base.split('\n').map((p) => String(p || '').trim()).filter(Boolean);
                                const out = (parts.length >= 2)
                                  ? `${parts[0]}\n${parts[1].startsWith('*') ? parts[1] : `* ${parts[1]}`}`
                                  : base;
                                // ✅ 게스트 UX: 요술봉 선택지도 "전송 액션"이므로 로그인 모달을 띄운다.
                                // - 게스트가 눌렀을 때 선택지가 곧바로 전송/입력 반영되는 것을 방지한다.
                                if (!isAuthenticated) {
                                  try { handleSendMessage({ preventDefault: () => {} }, out); } catch (_) {}
                                  return;
                                }
                                try { setNewMessage(out); } catch (_) {}
                                try { handleSendMessage({ preventDefault: () => {} }, out); } catch (_) {}
                              }}
                              className={`w-full text-left px-4 py-3 rounded-2xl border transition ${
                                magicLoading ? 'opacity-70 cursor-wait' : 'hover:bg-white/10'
                              } ${
                                resolvedTheme === 'light'
                                  ? 'bg-white border-gray-200 text-gray-900'
                                  : 'bg-black/40 border-white/10 text-gray-100'
                              }`}
                              title="클릭하면 전송"
                            >
                              {(() => {
                                const d = String(c?.dialogue || '').trim();
                                const nrr = String(c?.narration || '').trim();
                                const label = String(c?.label || '').trim();
                                const parts = label ? label.split('\n').map((p) => String(p || '').trim()).filter(Boolean) : [];
                                const line1 = d || parts[0] || label;
                                const line2 = nrr || parts[1] || '';
                                return (
                                  <div className="space-y-1">
                                    <div className={`text-sm leading-6 ${resolvedTheme === 'light' ? 'text-gray-900' : 'text-white'}`}>{line1}</div>
                                  {line2 ? (
                                    <div className={`text-sm leading-6 italic ${resolvedTheme === 'light' ? 'text-purple-700' : 'text-purple-300'}`}>{line2}</div>
                                  ) : null}
                                  </div>
                                );
                              })()}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
              {/* 완결 안내 토스트 + 내레이터 말풍선 */}
              {isOrigChat && lastOrigTurnPayload && messages.length > 0 && (() => {
                const last = messages[messages.length - 1];
                return null;
              })()}
              {/* ✅ 점 3개 말풍선은 "서버 응답 대기"에만 노출(가짜 스트리밍 중엔 중복 노출 방지) */}
              {shouldShowWaitingBubble && (
                <div className="mt-4 mb-1 flex items-start space-x-3">
                  <Avatar className="w-8 h-8 flex-shrink-0">
                    <AvatarImage className="object-cover object-top" src={getCharacterPrimaryImage(character)} alt={character?.name} />
                    <AvatarFallback className="bg-gradient-to-r from-purple-500 to-blue-500 text-white">
                      {character?.name?.charAt(0) || <Bot className="w-4 h-4" />}
                    </AvatarFallback>
                  </Avatar>
                  <div
                    className={`max-w-xs lg:max-w-md px-4 py-2 rounded-lg shadow-md border cc-assistant-speech-bubble ${
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
      <footer className="bg-[var(--footer-bg)] text-[var(--app-fg)] border-t border-gray-800 px-3 py-2 md:p-1 pb-[calc(env(safe-area-inset-bottom)+0.5rem)]">
        <ErrorBoundary>
        {/* ✅ PC 정렬 안정화: 본문 그리드(480px_560px)와 footer 그리드를 동일하게 맞춰 "삐뚤어짐" 방지 */}
        <div className={`hidden lg:grid ${mediaPanelEnabled ? 'lg:grid-cols-[480px_560px]' : 'lg:grid-cols-[minmax(0,840px)]'} lg:justify-center lg:mx-auto lg:items-center ${mediaPanelEnabled ? '' : 'lg:px-9'}`}>
          {/* 왼쪽: 빈 공간 (미니 갤러리는 이미지 아래로 이동) */}
          {mediaPanelEnabled ? <div className="w-[480px]"></div> : null}
          
          {/* 오른쪽: 채팅 입력 컨테이너 (채팅 메시지 영역 아래) */}
          <div className="w-full">
          <ErrorBoundary>
          <form id="chat-send-form" onSubmit={handleSendMessage} className="flex w-full items-center gap-2">
            {/* 모델 선택 버튼 */}
            <Button
              type="button"
              disabled={aiTypingEffective}
              className="h-9 w-9 rounded-xl bg-transparent text-[#ddd] p-0 flex items-center justify-center hover:bg-white/5 hover:text-white"
              onClick={() => {
                // ✅ 게스트 UX: 설정(모델 선택)은 로그인 후에만.
                // - 게스트가 눌렀을 때 "로그인 모달 + 설정 모달"이 동시에 뜨는 것을 방지한다.
                if (!isAuthenticated) {
                  try { setShowModelModal(false); } catch (_) {}
                  openLoginModal();
                  return;
                }
                setModalInitialTab('model');
                setShowModelModal(true);
              }}
              aria-label="모델 선택"
              title="모델 선택"
            >
              <Settings className="size-5" />
            </Button>

            {/* 입력 컨테이너: textarea + 우측 버튼 영역(absolute) */}
            <div className="relative flex-1">
              {/* ✅ 회색 레이어 제거(요구사항): bg/blur 제거, 테두리만 최소 유지 */}
              <div className="w-full rounded-2xl border border-white/15 bg-transparent">
                <Textarea
                  ref={setComposerInputRef}
                  value={newMessage}
                  onChange={(e) => setNewMessage(e.target.value)}
                  onKeyDown={handleKeyDown}
                  disabled={inputUiLocked}
                  placeholder={
                    (isOrigChat && showSituation)
                      ? '상황 입력 모드: 여기에 쓰고 전송하면 바로 반영돼요.'
                      : (isOrigChat && (origMeta?.narrator_mode || origMeta?.mode==='parallel' && false)
                        ? '서술/묘사로 입력하세요. 예) * 창밖에는 비가 내리고 있었다.'
                        : (!isOrigChat && isSimulatorChat ? '!스탯으로 상태창을 불러올 수 있습니다.' : '메시지 보내기'))
                  }
                  className="w-full min-h-0 bg-transparent border-0 focus:border-0 focus:ring-0 outline-none text-[13px] leading-[18px] px-4 py-[0.30rem] text-white caret-white placeholder:text-[#ddd]/70 resize-none"
                  style={{ height: 32, maxHeight: 32, scrollbarWidth: 'none', lineHeight: '18px', paddingRight: 128 }}
                  rows={1}
                />
              </div>

              {/* ✅ 버튼 3개 영역(요술봉/나레이션/전송) - DOM은 분리, UI는 입력창 안처럼 보이게 */}
              <div className="absolute bottom-0 right-3 flex items-center h-[32px]">
                {!isOrigChat && (
                  <button
                    type="button"
                    onClick={handleTriggerNextAction}
                    disabled={inputUiLocked}
                    aria-pressed={nextActionBusy}
                    className={`inline-flex items-center justify-center w-7 h-7 rounded-full transition ${
                      nextActionBusy
                        ? 'bg-purple-600 text-white shadow-[0_6px_18px_rgba(0,0,0,0.25)] hover:bg-purple-700'
                        : 'bg-transparent text-[#ddd] hover:bg-white/5 hover:text-white'
                    }`}
                    title="다음행동(앞당기기)"
                  >
                    {nextActionBusy ? <Loader2 className="size-5 animate-spin" /> : <FastForward className="size-5" />}
                  </button>
                )}
                {!isOrigChat && (
                  <button
                    type="button"
                    onClick={handleToggleMagicMode}
                    disabled={inputUiLocked}
                    aria-pressed={magicMode}
                    className={`inline-flex items-center justify-center w-7 h-7 rounded-full transition ${
                      magicMode
                        ? 'bg-purple-600 text-white shadow-[0_6px_18px_rgba(0,0,0,0.25)] hover:bg-purple-700'
                        : 'bg-transparent text-[#ddd] hover:bg-white/5 hover:text-white'
                    }`}
                    title={magicMode ? '요술봉 ON (선택지 자동 생성)' : '요술봉 OFF'}
                  >
                    {magicLoading ? <Loader2 className="size-5 animate-spin" /> : <Sparkles className="size-5" />}
                  </button>
                )}
                <button
                  type="button"
                  onClick={insertNarrationAsterisksAtCursor}
                  disabled={inputUiLocked}
                  className="inline-flex items-center justify-center w-8 h-8 rounded-xs -ml-1 text-[#ddd] transition-colors hover:text-white"
                  title="나레이션(지문) 시작"
                >
                  <Asterisk className="size-5" />
                </button>
                <button
                  type="submit"
                  disabled={!canSend || inputUiLocked}
                  className="ml-1 flex size-7 items-center justify-center rounded-full bg-purple-600 text-white transition-colors hover:bg-purple-700 disabled:opacity-50 disabled:pointer-events-none"
                  title="전송"
                >
                  {aiTypingEffective ? <Loader2 className="size-5 animate-spin" /> : <Send className="size-5 relative -left-px top-px" />}
                </button>
              </div>
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
            {/* ✅ 상황 입력(원작챗): 별도 입력 박스 없음
                - 상황입력 버튼(토글) ON 상태에서 메인 입력창에 쓰고 전송하면 즉시 반영된다. */}

            {/* 상황 입력 토글 버튼 */}
            {isOrigChat && (
              <Button
                type="button"
                onClick={() => setShowSituation((v)=>!v)}
                disabled={aiTypingEffective}
                className={`rounded-full w-10 h-10 p-0 flex-shrink-0 ${
                  showSituation ? 'bg-blue-600 text-white' : 'bg-white text-black'
                }`}
                size="icon"
                title="상황 입력"
              >
                <FileText className="w-5 h-5" />
              </Button>
            )}

            {/* (버튼 3개는 입력 컨테이너 내부 absolute 영역으로 이동) */}
          </form>
          </ErrorBoundary>
          </div>
        </div>
        </ErrorBoundary>
        
        {/* 모바일용 입력 컨테이너 */}
        <div className="lg:hidden w-full">
          {/* ✅ 이미지 스트립(상시 노출): 입력바 위에 얇게 표시(눈에 밟히지 않게) */}
          {mediaPanelEnabled && !isDesktopViewport && Array.isArray(portraitImages) && portraitImages.length > 0 && (
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
                            src={resolveImageUrl(getThumbnailUrl(img, 128) || img)}
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

          {/* ✅ 원작챗: 상황 입력(모바일)도 별도 입력 박스 없음
              - 상황입력 버튼(토글) ON 상태에서 메인 입력창 전송으로 적용 */}

          <ErrorBoundary>
          <form onSubmit={handleSendMessage} className="flex w-full items-center gap-2">
            {/* 모델 선택 버튼 */}
            <Button
              type="button"
              disabled={aiTypingEffective}
              className="h-9 w-9 rounded-xl bg-transparent text-[#ddd] p-0 flex items-center justify-center hover:bg-white/5 hover:text-white"
              onClick={() => {
                // ✅ 게스트 UX: 설정(모델 선택)은 로그인 후에만.
                // - 게스트가 눌렀을 때 "로그인 모달 + 설정 모달"이 동시에 뜨는 것을 방지한다.
                if (!isAuthenticated) {
                  try { setShowModelModal(false); } catch (_) {}
                  openLoginModal();
                  return;
                }
                setModalInitialTab('model');
                setShowModelModal(true);
              }}
              aria-label="모델 선택"
              title="모델 선택"
            >
              <Settings className="size-4" />
            </Button>

            {/* 입력 컨테이너: textarea + 우측 버튼 영역(absolute) */}
            <div className="relative flex-1">
              {/* ✅ 회색 레이어 제거(요구사항): bg/blur 제거, 테두리만 최소 유지 */}
              <div className="w-full rounded-2xl border border-white/15 bg-transparent">
                <Textarea
                  ref={setComposerInputRef}
                  value={newMessage}
                  onChange={(e) => setNewMessage(e.target.value)}
                  onKeyDown={handleKeyDown}
                  disabled={inputUiLocked}
                  placeholder={
                    (isOrigChat && showSituation)
                      ? '상황 입력 모드: 여기에 쓰고 전송하면 바로 반영돼요.'
                      : (isOrigChat && (origMeta?.narrator_mode || origMeta?.mode==='parallel' && false)
                        ? '서술/묘사로 입력하세요. 예) * 창밖에는 비가 내리고 있었다.'
                        : (!isOrigChat && isSimulatorChat ? '!스탯으로 상태창을 불러올 수 있습니다.' : '메시지 보내기'))
                  }
                  // ✅ 모바일 입력 UX(운영 안정):
                  // - 너무 낮은 height(26px)는 타이핑/가독성이 급격히 떨어지고, 하단에 "바짝 붙어" 보이게 만든다.
                  // - iOS 확대(줌) 방지 관점에서도 16px 이상이 안전하다.
                  className="w-full min-h-0 bg-transparent border-0 focus:border-0 focus:ring-0 outline-none text-[16px] leading-[20px] px-4 py-2 text-white caret-white placeholder:text-[11px] placeholder:leading-[16px] placeholder:text-[#ddd]/70 resize-none"
                  style={{ height: 40, maxHeight: 120, scrollbarWidth: 'none', lineHeight: '20px', paddingRight: 128 }}
                  rows={1}
                />
              </div>

              {/* ✅ 버튼 3개 영역(요술봉/나레이션/전송) */}
              <div className="absolute bottom-1 right-3 flex items-center h-[32px]">
                {!isOrigChat && (
                  <button
                    type="button"
                    onClick={handleTriggerNextAction}
                    disabled={inputUiLocked}
                    aria-pressed={nextActionBusy}
                    className={`inline-flex items-center justify-center w-7 h-7 rounded-full transition ${
                      nextActionBusy
                        ? 'bg-purple-600 text-white shadow-[0_6px_18px_rgba(0,0,0,0.25)] hover:bg-purple-700'
                        : 'bg-transparent text-[#ddd] hover:bg-white/5 hover:text-white'
                    }`}
                    title="다음행동(앞당기기)"
                  >
                    {nextActionBusy ? <Loader2 className="size-5 animate-spin" /> : <FastForward className="size-5" />}
                  </button>
                )}
                {!isOrigChat && (
                  <button
                    type="button"
                    onClick={handleToggleMagicMode}
                    disabled={inputUiLocked}
                    aria-pressed={magicMode}
                    className={`inline-flex items-center justify-center w-7 h-7 rounded-full transition ${
                      magicMode
                        ? 'bg-purple-600 text-white shadow-[0_6px_18px_rgba(0,0,0,0.25)] hover:bg-purple-700'
                        : 'bg-transparent text-[#ddd] hover:bg-white/5 hover:text-white'
                    }`}
                    title={magicMode ? '요술봉 ON (선택지 자동 생성)' : '요술봉 OFF'}
                  >
                    {magicLoading ? <Loader2 className="size-5 animate-spin" /> : <Sparkles className="size-5" />}
                  </button>
                )}
                <button
                  type="button"
                  onClick={insertNarrationAsterisksAtCursor}
                  disabled={inputUiLocked}
                  className="inline-flex items-center justify-center w-8 h-8 rounded-xs -ml-1 text-[#ddd] transition-colors hover:text-white"
                  title="나레이션(지문) 시작"
                >
                  <Asterisk className="size-5" />
                </button>
                <button
                  type="submit"
                  disabled={!canSend || inputUiLocked}
                  className="ml-1 flex size-7 items-center justify-center rounded-full bg-purple-600 text-white transition-colors hover:bg-purple-700 disabled:opacity-50 disabled:pointer-events-none"
                  title="전송"
                >
                  {aiTypingEffective ? <Loader2 className="size-5 animate-spin" /> : <Send className="size-5 relative -left-px top-px" />}
                </button>
              </div>
            </div>

            {/* 상황 입력 토글 버튼 (원작챗) */}
            {isOrigChat && (
              <Button
                type="button"
                onClick={() => setShowSituation((v)=>!v)}
                disabled={aiTypingEffective}
                className={`rounded-full w-7 h-7 p-0 flex-shrink-0 ${
                  showSituation ? 'bg-blue-600 text-white' : 'bg-white text-black'
                }`}
                size="icon"
                variant="ghost"
                title="상황 입력"
              >
                <FileText className="w-4 h-4" />
              </Button>
            )}

            {/* (버튼 3개는 입력 컨테이너 내부 absolute 영역으로 이동) */}
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

      {/* ✅ 접근 불가(비공개) 경고 모달 */}
      {accessDeniedDialogEl}

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

      {/* 이미지 확대 모달 (X 버튼만) */}
      <ImageZoomModal
        open={imageModalOpen}
        src={imageModalSrc ? resolveImageUrl(imageModalSrc) : ''}
        alt={character?.name || ''}
        onClose={() => { try { setImageModalOpen(false); } catch (_) {} try { setImageModalSrc(''); } catch (_) {} }}
      />
      </div>
    </div>
  );
};

export default ChatPage;
