/**
 * CAVEDUCK 스타일 고급 캐릭터 생성/수정 페이지
 * 5단계 탭 시스템: 기본정보 → 미디어 → 예시대화 → 호감도 → 공개설정
 */

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react'; // useMemo 추가
import { useNavigate, Link, useParams, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useQueryClient } from '@tanstack/react-query';
import { charactersAPI, filesAPI, API_BASE_URL, tagsAPI, api, mediaAPI } from '../lib/api';
import { resolveImageUrl } from '../lib/images';
import { sanitizePromptTokens } from '../lib/prompt';
import { parseAssistantBlocks } from '../lib/assistantBlocks';
import { imageCodeIdFromUrl } from '../lib/imageCode';
import { buildAutoGenModeHint, buildAutoGenToneHint } from '../lib/autoGenModeHints';
import { countSentencesRoughKo } from '../lib/textMetrics';
import { PROFILE_NAME_MIN_LEN, PROFILE_NAME_MAX_LEN, PROFILE_ONE_LINE_MIN_LEN, PROFILE_ONE_LINE_MAX_LEN, PROFILE_CONCEPT_MAX_LEN, getProfileOneLineMaxLenByCharacterType } from '../lib/profileConstraints';
import { QUICK_MEET_GENRE_CHIPS, QUICK_MEET_TYPE_CHIPS, QUICK_MEET_HOOK_CHIPS, QUICK_MEET_HOOK_CHIPS_SIMULATOR, shuffleCopy, getQuickMeetGenrePriority, uniqStringsPreserveOrder } from '../lib/quickMeetFixedChips';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Textarea } from '../components/ui/textarea';
import CharLimitCounter from '../components/CharLimitCounter';
import WizardTokenHelpIcon from '../components/WizardTokenHelpIcon';
import { Switch } from '../components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Alert, AlertDescription } from '../components/ui/alert';
// 탭 컴포넌트 제거(롱폼 전환)
import { Badge } from '../components/ui/badge';
import { Separator } from '../components/ui/separator';
import { 
  ArrowLeft,
  ArrowLeftRight,
  Save,
  Loader2,
  MessageCircle,
  AlertCircle,
  Plus,
  Trash2,
  Send,
  Upload,
  Image,
  Volume2,
  Heart,
  Settings,
  Menu,
  Globe,
  Lock,
  Sparkles,
  BookOpen,
  Mic,
  Palette,
  SquarePen,
  X,
  Wand2, // Wand2 아이콘 추가
  Asterisk,
  Eye,
  RefreshCw,
  Pencil,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronUp
} from 'lucide-react';
import { StoryImporterModal } from '../components/StoryImporterModal'; // StoryImporterModal 컴포넌트 추가
import AvatarCropModal from '../components/AvatarCropModal';
import TagSelectModal from '../components/TagSelectModal';
import ImageGenerateInsertModal from '../components/ImageGenerateInsertModal';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../components/ui/dialog';
import ImageZoomModal from '../components/ImageZoomModal';
import { CharacterCard } from '../components/CharacterCard';
import DropzoneGallery from '../components/DropzoneGallery';
import ErrorBoundary from '../components/ErrorBoundary';
import { z } from 'zod';

/**
 * ✅ 필수 선택 옵션(메타) 정의
 *
 * 의도/원칙(최소 수정/최대 안전):
 * - DB 컬럼/테이블을 새로 만들지 않고, 기존 tags 저장(`/characters/:id/tags`)에 함께 저장한다.
 * - 백엔드 `set_character_tags`는 slug가 없으면 Tag를 자동 생성하므로, 프론트에서 선제 생성이 필요 없다.
 * - 생성(Create) 시에는 필수 선택으로 강제하고, 편집(Edit)은 기존 데이터가 깨지지 않도록 강제하지 않는다.
 */
const REQUIRED_AUDIENCE_CHOICES = [
  { slug: '남성향', label: '남성향', previewClass: 'bg-gradient-to-br from-slate-900 via-blue-900 to-purple-900' },
  { slug: '여성향', label: '여성향', previewClass: 'bg-gradient-to-br from-rose-900 via-fuchsia-900 to-indigo-900' },
  { slug: '전체', label: '전체', previewClass: 'bg-gradient-to-br from-emerald-900 via-slate-900 to-cyan-900' },
];
const REQUIRED_STYLE_CHOICES = [
  { slug: '애니풍', label: '애니풍', previewClass: 'bg-gradient-to-br from-purple-600 via-indigo-600 to-blue-600' },
  { slug: '실사풍', label: '실사풍', previewClass: 'bg-gradient-to-br from-zinc-900 via-gray-800 to-zinc-700' },
  { slug: '반실사', label: '반실사', previewClass: 'bg-gradient-to-br from-slate-800 via-stone-700 to-neutral-800' },
  { slug: '아트웤', label: '아트웤/디자인', previewClass: 'bg-gradient-to-br from-amber-700 via-orange-700 to-rose-700' },
];
const REQUIRED_AUDIENCE_SLUGS = REQUIRED_AUDIENCE_CHOICES.map((c) => c.slug);
const REQUIRED_STYLE_SLUGS = REQUIRED_STYLE_CHOICES.map((c) => c.slug);

// ✅ 스탯 최대 개수(오프닝 1개당)
// - 이전에는 4개로 제한했지만, 사용자 요구로 "추가 가능"해야 한다.
// - 프롬프트 길이(6000자) 초과 위험은 존재하므로, 너무 큰 값은 피하고 10개로 제한한다.
const HARD_MAX_STATS_PER_OPENING = 10;

/**
 * ✅ 호감도 규칙 예시 템플릿
 *
 * 의도:
 * - "주관식"으로 작성하더라도 LLM이 일관되게 따르도록 형식/제약을 제시한다.
 * - 사용자가 복붙해서 바로 수정/응용할 수 있도록 줄바꿈 기반 텍스트로 제공한다.
 */
const AFFINITY_RULES_TEMPLATE = `# 호감도 시스템 템플릿(예시)

- 호감도 범위: 0 ~ 300 (시작: 0)
- 1턴당 변화량: 최대 +20 / -20 (급변 금지)
- 증가 조건(예):
  - 배려/공감: +10
  - 진심 어린 칭찬: +10
  - 약속을 지킴/신뢰 행동: +20
- 감소 조건(예):
  - 무례/비하: -15
  - 강요/협박: -20
  - 거짓말/배신: -20
- 표현 규칙:
  - 숫자/점수/단계를 직접 말하지 말 것
  - 말투/행동/거리감으로만 변화가 드러나게 할 것
- 구간별 반응(예):
  - 0~100: 건조, 선 긋기, 경계
  - 101~200: 친근, 농담, 호감 표현 시작
  - 201~300: 친밀, 설렘, 적극적 배려

(필요하면 항목을 추가/수정해서 사용하세요)`;

const CreateCharacterPage = () => {
  const queryClient = useQueryClient();
  const { characterId } = useParams();
  const isEditMode = !!characterId;
  const [cropSrc, setCropSrc] = useState('');
  const [isCropOpen, setIsCropOpen] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  /**
   * ✅ 임시 비노출 플래그(요구사항):
   * - "AI로 캐릭터 설정 1분 만에 끝내기" 소개/진입 UI를 잠시 숨긴다.
   * - 기능 자체(StoryImporterModal/자동완성 로직)는 유지해서, 개편 시 쉽게 다시 켤 수 있게 한다.
   */
  const HIDE_AI_FAST_SETUP_CARD = true;
  const showAiFastSetupCard = !HIDE_AI_FAST_SETUP_CARD;

  // 🔥 롱폼 전환: 탭 상태 제거
  const [isStoryImporterOpen, setIsStoryImporterOpen] = useState(false); // 모달 상태 추가

  const [formData, setFormData] = useState({
    // 1단계: 기본 정보
    basic_info: {
      name: '',
      description: '',
      personality: '',
      speech_style: '',
      greeting: '',
      greetings: [''], // UI에서 배열로 사용, 저장 시 greeting 단일 문자열로 변환
      world_setting: '',
      user_display_description: '',
      // ✅ 요구사항:
      // - UI에서는 "크리에이터 코멘트"로 노출하며, 토글 ON일 때만 입력 박스를 보여준다.
      // - 입력은 선택이며(비어있으면 노출하지 않음), 토글 OFF여도 기존 입력값은 덮어쓰지 않는다.
      use_custom_description: false,
      introduction_scenes: [
        { title: '오프닝 1', content: '', secret: '' }
      ],
      // ✅ 시작 세트(도입부+첫대사) - 신규 일반 캐릭터 위저드 SSOT
      // - 백엔드에서 start_sets가 SSOT이며, 선택된 1개는 greeting/introduction_scenes로 미러링된다.
      // - 프론트에서도 저장/검증/미리보기 안정성을 위해 legacy 필드로도 즉시 미러링한다.
      start_sets: {
        selectedId: 'set_1',
        items: [
          { id: 'set_1', title: '오프닝 1', intro: '', firstLine: '' },
        ],
        // ✅ 옵션(신규/SSOT): 스토리 진행 턴수(기본 200)
        // - start_sets는 "위저드 전용 JSON 저장소"이므로, 별도 DB 스키마 없이도 안전하게 확장 가능
        sim_options: {
          mode: 'preset', // 'preset' | 'custom'
          max_turns: 200,
        },
        // ✅ 설정집(탭) - 설정메모(요구사항)
        // - 설정집은 "탭 이름"이며, 내부는 "설정메모 1/2/..." 리스트로만 관리한다.
        // - 설정메모: 상세 + 트리거(최대 5) + 적용대상(오프닝 선택)
        setting_book: {
          selectedId: 'memo_1',
          items: [
            {
              id: 'memo_1',
              detail: '',
              triggers: [''], // 최대 5개(빈 문자열 허용)
              // ✅ 적용 대상(오프닝 선택)
              // - 'all': 전체 오프닝
              // - 'set_1'...: 특정 오프닝(다중 선택)
              targets: ['all'],
            },
          ],
        },
      },
      character_type: 'roleplay',
      base_language: 'ko'
    },
    // [1단계] 상태 구조 변경: 역할을 명확히 분리
    media_settings: {
      avatar_url: '',
      image_descriptions: [], // 서버에 저장된 기존 이미지 {url, description}
      newly_added_files: [],  // 새로 추가할 파일 목록 (File 객체)
      voice_settings: {
        voice_id: null,
        voice_style: null,
        enabled: false
      }
    },
    // 3단계: 예시 대화
    example_dialogues: {
      dialogues: []
    },
    // 4단계: 호감도 시스템
    affinity_system: {
      has_affinity_system: false,
      affinity_rules: '',
      affinity_stages: [
        { min_value: 0, max_value: 100, description: '차가운 반응을 보입니다.' },
        { min_value: 101, max_value: 200, description: '친근하게 대화합니다.' },
        { min_value: 201, max_value: null, description: '매우 친밀하게 대화합니다.' }
      ]
    },
    // 5단계: 공개 설정
    publish_settings: {
      is_public: true,
      custom_module_id: null,
      use_translation: true
    }
  });

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [pageTitle, setPageTitle] = useState('새 캐릭터 만들기');
  const [isAutoSaving, setIsAutoSaving] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  // ✅ 이탈 경고(요구사항): 임시저장 없이 뒤로가기(앱/브라우저) 방지
  // - 브라우저 back(popstate)은 취소 불가라, pushState로 "가드 엔트리"를 1개 쌓아 confirm을 띄운다.
  const leaveBypassRef = useRef(false);
  const leaveGuardArmedRef = useRef(false);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  // ✅ 위저드 전용: 채팅 미리보기(모바일 화면) - 최대 10회(유저 메시지 기준)
  const [isChatPreviewOpen, setIsChatPreviewOpen] = useState(false);
  const [chatPreviewInput, setChatPreviewInput] = useState('');
  const [chatPreviewMessages, setChatPreviewMessages] = useState([]); // [{id:string, role:'user'|'assistant', content:string}]
  // ✅ 프리뷰(assistant 말풍선) 키워드 트리거 이미지: message_id -> resolved_url
  const [chatPreviewSuggestedImageById, setChatPreviewSuggestedImageById] = useState({});
  const [chatPreviewMagicMode, setChatPreviewMagicMode] = useState(false);
  const [chatPreviewMagicChoices, setChatPreviewMagicChoices] = useState([]); // [{id,label,dialogue?,narration?}]
  const [chatPreviewMagicLoading, setChatPreviewMagicLoading] = useState(false);
  // ✅ 프리뷰 전용: 응답 생성 중/출력 중 잠금(가짜 스트리밍 A안 적용)
  const [chatPreviewBusy, setChatPreviewBusy] = useState(false);
  const chatPreviewListRef = useRef(null);
  // ✅ 프리뷰 세션 epoch: 입력값 수정으로 프리뷰를 리셋할 때, in-flight 응답이 뒤늦게 붙는 것을 방지한다.
  // - 경쟁사 UX처럼 "입력 변경 = 프리뷰 0/10 리셋"을 안정적으로 구현하기 위한 방어 장치.
  const chatPreviewEpochRef = useRef(0);
  // ✅ 프리뷰 A안(가짜 스트리밍): UI에서만 마지막 AI 답변을 점진 출력
  // - preview 메시지는 DB/room이 없으므로, 프론트에서만 안전하게 구현한다.
  const [chatPreviewUiStream, setChatPreviewUiStream] = useState({ id: '', full: '', shown: '' }); // { id, full, shown }
  const chatPreviewUiStreamTimerRef = useRef(null);
  const chatPreviewUiStreamCancelSeqRef = useRef(0);
  const chatPreviewUiStreamHydratedRef = useRef(false);
  const chatPreviewUiStreamPrevLastIdRef = useRef('');
  const chatPreviewUiStreamDoneByIdRef = useRef({});
  const chatPreviewPendingMagicRef = useRef(null); // { epoch:number, seedHint:string } | null
  // ✅ 프리뷰 A안: 첫대사(오프닝 firstLine)도 점진 출력
  const [chatPreviewFirstLineUiStream, setChatPreviewFirstLineUiStream] = useState({ id: '', full: '', shown: '' }); // { id, full, shown }
  const chatPreviewFirstLineTimerRef = useRef(null);
  const chatPreviewFirstLineCancelSeqRef = useRef(0);
  const chatPreviewFirstLineHydratedRef = useRef(false);
  const chatPreviewFirstLinePrevFullRef = useRef('');
  // ✅ 프리뷰 A안: 요술봉 선택지도 "1개→2개→3개" 점진 노출
  const [chatPreviewMagicRevealCount, setChatPreviewMagicRevealCount] = useState(0); // 0~3
  const chatPreviewMagicRevealTimerRef = useRef(null);
  const chatPreviewMagicRevealCancelSeqRef = useRef(0);
  // ✅ 크리에이터 테스트(요구사항): "턴사건 프리뷰" 패널
  // - 목적: 턴수별 사건을 실제 채팅 흐름에 '중간 삽입'하지 않고, 1턴 전용 테스트로만 확인한다.
  const [turnEventPreviewOpen, setTurnEventPreviewOpen] = useState(false);
  const [turnEventPreviewLoading, setTurnEventPreviewLoading] = useState(false);
  const [turnEventPreviewError, setTurnEventPreviewError] = useState('');
  const [turnEventPreviewText, setTurnEventPreviewText] = useState('');
  const [turnEventPreviewPickedId, setTurnEventPreviewPickedId] = useState('');
  // ✅ 프리뷰 리셋 시그니처(ref): "정보 수정"일 때만 리셋하기 위한 내부 캐시
  const chatPreviewResetSigRef = useRef('');
  // ✅ 프리뷰 자동 스크롤 가드: 사용자가 위로 올리면 강제 스크롤 금지
  // - "바닥 근처일 때만" 자동 스크롤을 허용한다.
  const chatPreviewAutoScrollRef = useRef(true);

  const handleChatPreviewScroll = useCallback(() => {
    try {
      const el = chatPreviewListRef.current;
      if (!el) return;
      const BOTTOM_THRESHOLD_PX = 80;
      const distanceToBottom = el.scrollHeight - el.clientHeight - el.scrollTop;
      const atBottom = distanceToBottom <= BOTTOM_THRESHOLD_PX;
      chatPreviewAutoScrollRef.current = atBottom;
    } catch (_) {}
  }, []);
  // ✅ 채팅 미리보기는 "입력 즉시"가 아니라, 포커스가 빠질 때(onBlur)만 반영되는 스냅샷을 사용한다.
  const [chatPreviewSnapshot, setChatPreviewSnapshot] = useState({
    name: '캐릭터',
    intro: '',
    firstLine: '',
  });
  // ✅ 크리에이터 테스트용: 프리뷰 턴 강제 지정(턴수별 사건 발동 검증)
  // - 프리뷰는 room이 없어 N턴까지 직접 채우는 테스트가 번거로우므로, 서버에 override를 전달한다.
  const [chatPreviewTurnOverride, setChatPreviewTurnOverride] = useState('');
  const chatPreviewBgUrl = useMemo(() => {
    try {
      const first = Array.isArray(formData?.media_settings?.image_descriptions)
        ? formData.media_settings.image_descriptions.find((x) => String(x?.url || '').trim())
        : null;
      const url = String(first?.url || '').trim();
      return url ? resolveImageUrl(url) : '';
    } catch (_) {
      return '';
    }
  }, [formData]);
  const chatPreviewAvatarUrl = useMemo(() => {
    try {
      const url = String(formData?.media_settings?.avatar_url || '').trim();
      if (url) return resolveImageUrl(url);
      const first = Array.isArray(formData?.media_settings?.image_descriptions)
        ? formData.media_settings.image_descriptions.find((x) => String(x?.url || '').trim())
        : null;
      const fallback = String(first?.url || '').trim();
      return fallback ? resolveImageUrl(fallback) : '';
    } catch (_) {
      return '';
    }
  }, [formData]);

  const chatPreviewImageUrls = useMemo(() => {
    /**
     * ✅ 프리뷰 인라인 이미지 코드 해석용 이미지 목록(SSOT: media_settings.image_descriptions)
     *
     * 의도/원리:
     * - 프리뷰 채팅에서도 `[[img:...]]` / `{{img:...}}` 코드를 실제 이미지로 렌더해야 한다.
     * - URL 직접 주입은 허용하지 않고(SSOT/보안), 반드시 "캐릭터에 등록된 이미지"에서만 매핑한다.
     */
    try {
      const imgs = Array.isArray(formData?.media_settings?.image_descriptions)
        ? formData.media_settings.image_descriptions
        : [];
      return imgs.map((x) => String(x?.url || '').trim()).filter(Boolean);
    } catch (_) {
      return [];
    }
  }, [formData]);

  const renderChatPreviewTextWithInlineImages = useCallback((text, keyPrefix = 'pv') => {
    /**
     * ✅ 프리뷰: 이미지 코드 → 인라인 이미지 렌더(일반 챗과 동일 규칙)
     *
     * 규칙:
     * - `[[img:...]]` / `{{img:...}}`만 인식
     * - spec이 숫자면 1-based 인덱스(구버전 호환)
     * - spec이 문자열이면 imageCodeIdFromUrl(URL)로 역매핑
     */
    const srcText = String(text ?? '');
    if (!srcText) return srcText;
    const TOKEN_RE = /(\[\[\s*img\s*:\s*([^\]]+?)\s*\]\]|\{\{\s*img\s*:\s*([^}]+?)\s*\}\})/gi;
    if (!TOKEN_RE.test(srcText)) return srcText;
    TOKEN_RE.lastIndex = 0;

    const resolveBySpec = (rawSpec) => {
      try {
        const spec = String(rawSpec ?? '').trim();
        if (!spec) return '';
        if (/^\d+$/.test(spec)) {
          const n = Number(spec);
          if (!Number.isFinite(n)) return '';
          const idx = Math.max(0, Math.floor(n) - 1);
          const url = (Array.isArray(chatPreviewImageUrls) && idx >= 0 && idx < chatPreviewImageUrls.length)
            ? chatPreviewImageUrls[idx]
            : '';
          return url ? resolveImageUrl(url) : '';
        }
        const want = spec.toLowerCase();
        for (const u of (Array.isArray(chatPreviewImageUrls) ? chatPreviewImageUrls : [])) {
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
      if (start > last) nodes.push(<React.Fragment key={`${keyPrefix}-txt-${keySeq++}`}>{srcText.slice(last, start)}</React.Fragment>);
      const resolved = resolveBySpec(spec);
      if (resolved) {
        nodes.push(
          <span key={`${keyPrefix}-img-${keySeq++}`} className="block my-2">
            <img
              src={resolved}
              alt=""
              loading="lazy"
              decoding="async"
              className="block w-full h-auto rounded-xl cursor-zoom-in border border-white/10"
              onClick={() => {
                try {
                  setImageViewerSrc(resolved);
                  setImageViewerOpen(true);
                } catch (_) {}
              }}
            />
          </span>
        );
      } else {
        nodes.push(<span key={`${keyPrefix}-bad-${keySeq++}`} className="text-xs text-gray-400">{full}</span>);
      }
      last = end;
    }
    if (last < srcText.length) nodes.push(<React.Fragment key={`${keyPrefix}-tail-${keySeq++}`}>{srcText.slice(last)}</React.Fragment>);
    return nodes;
  }, [chatPreviewImageUrls]);

  // ✅ 디테일(추가 정보) - 백엔드 컬럼 추가 없이 프롬프트에 반영하기 위한 UI 필드
  // - 저장 시 personality에 섹션 형태로 병합해 전달한다(LLM 프롬프트에 반영 목적)
  const [detailPrefs, setDetailPrefs] = useState({ interests: [], likes: [], dislikes: [] });
  const [detailChipInputs, setDetailChipInputs] = useState({ interests: '', likes: '', dislikes: '' });
  // ✅ 디테일 필드 모드 토글(요구사항)
  // - 기본값: character_type(롤플/시뮬)에 따라 자동 전환
  // - 사용자가 토글로 강제 변경하면 override로 저장(=타입과 다른 방식으로 입력 가능)
  // - 강제 변경 상태에서는 경고문구를 노출한다(운영 안전/UX).
  const [detailModeOverrides, setDetailModeOverrides] = useState({
    personality: null, // 'roleplay' | 'simulator' | null(타입 따라감)
    speech_style: null,
    interests: null,
    likes: null,
    dislikes: null,
  });
  const detailPrefsInitRef = useRef(false);
  // ✅ 비밀정보(프롬프트 하단) 토글: ON일 때만 입력/자동생성 UI 노출
  const [isSecretInfoEnabled, setIsSecretInfoEnabled] = useState(false);

  const defaultDetailMode = useMemo(() => {
    /**
     * ✅ 디테일 기본 모드(SSOT)
     *
     * 의도/원리:
     * - "시뮬레이션"이면 디테일 입력의 의미가 룰/트리거 중심으로 자동 전환된다.
     * - "롤플레잉/커스텀"이면 디테일 입력은 캐릭터성/취향 중심으로 유지한다.
     */
    const t = String(formData?.basic_info?.character_type || 'roleplay').trim();
    return t === 'simulator' ? 'simulator' : 'roleplay';
  }, [formData?.basic_info?.character_type]);

  const getEffectiveDetailMode = useCallback((key) => {
    /**
     * ✅ 디테일 모드(roleplay/simulator)를 결정한다.
     *
     * 규칙:
     * - 커스텀 타입이면 _custom_toggle 값을 사용한다.
     * - 롤플레잉/시뮬레이터 타입이면 character_type 기반 기본값을 따른다.
     */
    try {
      const charType = String(formData?.basic_info?.character_type || 'roleplay').trim();
      // 커스텀 모드일 때는 _custom_toggle 값 사용
      if (charType === 'custom') {
        const toggle = detailModeOverrides?.['_custom_toggle'];
        if (toggle === 'simulator' || toggle === 'roleplay') return toggle;
        return 'roleplay'; // 커스텀 기본값은 롤플레이
      }
      return defaultDetailMode;
    } catch (_) {
      return defaultDetailMode;
    }
  }, [detailModeOverrides, defaultDetailMode, formData?.basic_info?.character_type]);

  const isDetailModeForced = useCallback((key) => {
    /**
     * ✅ 사용자가 "억지로" 토글을 바꿔 강제한 상태인지 판단한다.
     *
     * - 강제 상태: override가 존재 + 기본 모드와 다름
     * - 이때만 경고 문구를 노출한다.
     */
    try {
      const v = detailModeOverrides?.[key];
      return (v === 'simulator' || v === 'roleplay') && v !== defaultDetailMode;
    } catch (_) {
      return false;
    }
  }, [detailModeOverrides, defaultDetailMode]);

  const toggleDetailMode = useCallback((key) => {
    /**
     * ✅ 디테일 항목 모드 토글(ON/OFF)
     *
     * 의도/원리:
     * - 토글은 "시뮬 방식(ON) / 롤플 방식(OFF)"로 동작한다.
     * - 사용자가 타입 기본값과 동일한 상태로 되돌리면 override를 제거해,
     *   이후 타입 변경 시 자동 전환이 다시 살아나게 한다.
     */
    try {
      setDetailModeOverrides((prev) => {
        const currentOverride = prev?.[key];
        const current = (currentOverride === 'simulator' || currentOverride === 'roleplay')
          ? currentOverride
          : defaultDetailMode;
        const next = current === 'simulator' ? 'roleplay' : 'simulator';
        // next가 기본값과 같으면 강제 해제(자동 전환으로 복귀)
        if (next === defaultDetailMode) {
          return { ...(prev || {}), [key]: null };
        }
        return { ...(prev || {}), [key]: next };
      });
    } catch (_) {}
  }, [defaultDetailMode]);

  const detailFieldCopy = useMemo(() => ({
    roleplay: {
      personality: { label: '성격 및 특징', placeholder: '캐릭터의 성격과 특징을 자세히 설명해주세요' },
      speech_style: { label: '말투', placeholder: '캐릭터의 말투를 구체적으로 설명해주세요' },
      interests: { label: '관심사', placeholder: '관심사를 입력해주세요.' },
      likes: { label: '좋아하는 것', placeholder: '좋아하는 것을 입력해주세요.' },
      dislikes: { label: '싫어하는 것', placeholder: '싫어하는 것을 입력해주세요.' },
    },
    simulator: {
      personality: { label: '의사결정 규칙', placeholder: '예: 우선순위/금기/판단 기준을 짧은 규칙 형태로 적어주세요' },
      speech_style: { label: '출력 포맷 규칙', placeholder: '예: (지문→대사→선택지) 같은 출력 규칙/제약을 적어주세요' },
      interests: { label: '이벤트 훅', placeholder: '이야기에서 사건이 터지는 소재/훅을 입력해주세요.' },
      likes: { label: '보상 트리거', placeholder: '보상(호감/정보/자원 등)이 걸릴 키워드를 입력해주세요.' },
      dislikes: { label: '페널티 트리거', placeholder: '페널티(불리 이벤트/호감 하락 등) 키워드를 입력해주세요.' },
    },
  }), []);

  // ✅ 예시대화 탭 UI 상태(요구사항): "예시대화1/2/..." 탭으로 관리
  const [activeExampleDialogueIdx, setActiveExampleDialogueIdx] = useState(0);

  useEffect(() => {
    /**
     * ✅ 예시대화 탭 인덱스 방어 보정
     *
     * 의도/원리:
     * - 예시대화 추가/삭제 시 현재 선택 탭 인덱스가 범위를 벗어나면 UI가 깨질 수 있다.
     * - 따라서 dialogues 길이를 기준으로 activeExampleDialogueIdx를 clamp한다.
     */
    try {
      const len = Array.isArray(formData?.example_dialogues?.dialogues) ? formData.example_dialogues.dialogues.length : 0;
      setActiveExampleDialogueIdx((prev) => {
        if (len <= 0) return 0;
        const n = Number(prev);
        if (!Number.isFinite(n) || n < 0) return 0;
        if (n >= len) return len - 1;
        return n;
      });
    } catch (_) {}
  }, [formData?.example_dialogues?.dialogues?.length]);

  useEffect(() => {
    /**
     * ✅ 비밀정보 토글 초기값/동기화(방어)
     *
     * 의도:
     * - 편집 모드/데이터 로드로 비밀정보가 이미 존재하는 경우, 토글이 OFF면 사용자가 놓치기 쉽다.
     * - 최초 1회에 한해, 값이 존재하면 자동으로 ON으로 켠다(사용자 입력 우선).
     */
    try {
      const secret = String(formData?.basic_info?.introduction_scenes?.[0]?.secret || '').trim();
      if (!secret) return;
      setIsSecretInfoEnabled((prev) => (prev ? prev : true));
    } catch (_) {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formData?.basic_info?.introduction_scenes?.[0]?.secret]);

  const autoGrowTextareaEl = useCallback((el) => {
    /**
     * ✅ 경쟁사 UX: textarea 내부 스크롤 대신 "높이 자동 확장"
     *
     * 의도/원리:
     * - 글이 길어질수록 textarea 내부 스크롤이 생기면(=스크롤 2개) 작성 UX가 나빠진다.
     * - 입력량이 늘면 textarea 높이가 아래로 늘어나고, 페이지 전체 스크롤만 동작하게 만든다.
     *
     * 방어:
     * - el이 없거나 textarea가 아니면 무시
     */
    try {
      if (!el) return;
      if (String(el?.tagName || '').toLowerCase() !== 'textarea') return;
      /**
       * ✅ 스크롤 먹통/멈춤 방지:
       * - 특정 textarea에 data-autogrow-max(px)를 주면, 그 이상은 내부 스크롤로 전환한다.
       * - 값이 없으면 기존처럼 무제한 자동 확장(레거시 동작 유지).
       */
      const maxRaw = Number(el?.dataset?.autogrowMax || 0);
      const maxH = Number.isFinite(maxRaw) && maxRaw > 0 ? Math.floor(maxRaw) : 0;

      // 내용이 줄어들 때도 높이가 줄어들도록 'auto'로 리셋 후 scrollHeight 적용
      el.style.height = 'auto';
      const h = Number(el.scrollHeight || 0);
      if (maxH > 0 && h > maxH) {
        el.style.height = `${maxH}px`;
        el.style.overflowY = 'auto';
      } else {
        el.style.height = `${h}px`;
        el.style.overflowY = 'hidden';
      }
    } catch (_) {}
  }, []);

  const handleAutoGrowTextarea = useCallback((e) => {
    try { autoGrowTextareaEl(e?.currentTarget); } catch (_) {}
  }, [autoGrowTextareaEl]);

  useEffect(() => {
    /**
     * ✅ 자동 생성/복원 등으로 값이 프로그램적으로 바뀌어도 높이를 맞춘다.
     * - data-autogrow="1"이 있는 textarea만 대상으로 한다(채팅/다른 컴포넌트 영향 방지).
     */
    try {
      window.requestAnimationFrame(() => {
        try {
          const list = document.querySelectorAll('textarea[data-autogrow="1"]');
          list.forEach((el) => autoGrowTextareaEl(el));
        } catch (_) {}
      });
    } catch (_) {}
  }, [formData, autoGrowTextareaEl]);

  // ✅ 이미지 업로드: 새 파일 미리보기 URL은 최상위 훅에서 관리(훅 순서 불변)
  const newImagePreviews = useMemo(() => {
    try {
      const files = Array.isArray(formData?.media_settings?.newly_added_files)
        ? formData.media_settings.newly_added_files
        : [];
      return files.map((file) => ({ url: URL.createObjectURL(file), isNew: true }));
    } catch (_) {
      return [];
    }
  }, [formData?.media_settings?.newly_added_files]);

  useEffect(() => {
    return () => {
      try {
        (newImagePreviews || []).forEach((p) => {
          try { URL.revokeObjectURL(p.url); } catch (_) {}
        });
      } catch (_) {}
    };
  }, [newImagePreviews]);
  const [activeSection, setActiveSection] = useState('section-basic');
  const activeSectionRef = useRef('section-basic');
  const [fieldErrors, setFieldErrors] = useState({}); // zod 인라인 오류 맵
  const [draftRestored, setDraftRestored] = useState(false);
  const [isDraftEnabled, setIsDraftEnabled] = useState(false); // '임시저장'을 눌렀을 때만 로컬 초안 저장/복원
  const [imgModalOpen, setImgModalOpen] = useState(false);
  
  // 이미지 확대 모달 상태
  const [imageViewerOpen, setImageViewerOpen] = useState(false);
  const [imageViewerSrc, setImageViewerSrc] = useState('');
  // ✅ 작품 컨셉: 기본 잠금(수정 불가) + 연필로 잠금 해제 + 체크로 확정
  const [profileConceptEditConfirmOpen, setProfileConceptEditConfirmOpen] = useState(false);
  const [profileConceptEditMode, setProfileConceptEditMode] = useState(false);
  // ✅ 프롬프트 동기화(확인/취소) 모달 상태
  const [promptSyncConfirmOpen, setPromptSyncConfirmOpen] = useState(false);
  const [promptSyncPendingText, setPromptSyncPendingText] = useState('');
  // ✅ 프롬프트에서 "스탯 블록"을 직접 수정/삭제하려는 경우 경고 모달
  const [promptStatsBlockGuardOpen, setPromptStatsBlockGuardOpen] = useState(false);
  const [promptStatsBlockGuardPendingText, setPromptStatsBlockGuardPendingText] = useState('');
  const [promptStatsBlockGuardMode, setPromptStatsBlockGuardMode] = useState(''); // 'delete' | 'edit'
  // ✅ 프롬프트 스탯 블록 경고는 "최초 1회"만 (UX 요구사항)
  const promptStatsBlockGuardShownOnceRef = useRef(false);
  // ✅ 프롬프트 → 스탯 적용(확인 모달)
  const [promptApplyStatsConfirmOpen, setPromptApplyStatsConfirmOpen] = useState(false);
  const [promptApplyStatsPendingStats, setPromptApplyStatsPendingStats] = useState([]); // [{ id, name, min_value, max_value, base_value, unit, description }]
  // ✅ 자동생성 덮어쓰기 확인 모달(공통)
  const [autoGenOverwriteConfirmOpen, setAutoGenOverwriteConfirmOpen] = useState(false);
  const [autoGenOverwriteConfirmTargets, setAutoGenOverwriteConfirmTargets] = useState(''); // 예: "프롬프트", "오프닝(첫상황/첫대사)"
  const autoGenOverwriteConfirmActionRef = useRef(null); // () => Promise<void>
  // ✅ 프로필 자동생성(작품명) "독립 시행" 보장용
  // - 1회 자동생성으로 채워진 name을 그대로 다시 서버에 입력값으로 보내면,
  //   모델이 그 이름을 "고정 힌트"로 취급해 같은 이름이 반복될 수 있다.
  // - 따라서 "직전 자동생성 결과와 동일한 name"은 placeholder로 취급해 재생성되게 한다.
  const lastAutoGeneratedProfileNameRef = useRef('');
  // ✅ 스탯 변경 → 프롬프트 동기화 필요 여부(오프닝 단위)
  const [statsDirtyByStartSetId, setStatsDirtyByStartSetId] = useState({}); // { [startSetId]: boolean }
  // ✅ 엔딩 탭 아코디언 UI 상태(로컬 UI 전용)
  // - 저장/서버와 무관: 화면에서만 접기/펼치기를 관리한다.
  const [endingAccordionOpenById, setEndingAccordionOpenById] = useState({});
  // ✅ 설정집(키워드북 유사) UI 상태(로컬 UI 전용)
  // (요구사항 변경) 설정집(book) 레이어 제거로 미사용 상태 정리
  const [settingBookAccordionOpenById, setSettingBookAccordionOpenById] = useState({});
  const [settingBookTargetDraftById, setSettingBookTargetDraftById] = useState({}); // { [noteId]: 'all'|setId }
  // ✅ 오프닝(턴수별 사건) 아코디언 UI 상태(로컬 UI 전용)
  const [turnEventAccordionOpenById, setTurnEventAccordionOpenById] = useState({}); // { [eventId]: boolean }
  // ✅ 프로필(커스텀 턴수) 경고 모달: 0~30(및 50 미만) 입력 방지 UX
  const [customTurnsWarnOpen, setCustomTurnsWarnOpen] = useState(false);
  const [customTurnsWarnMessage, setCustomTurnsWarnMessage] = useState('');

  // ✅ 위저드: "다음단계 자동완성" 진행 모달(로딩/진행률/상태 메시지)
  const [nextStepAutoFillOpen, setNextStepAutoFillOpen] = useState(false);
  const [nextStepAutoFillLabel, setNextStepAutoFillLabel] = useState('');
  const [nextStepAutoFillProgress, setNextStepAutoFillProgress] = useState(0); // 0~100
  const [nextStepAutoFillError, setNextStepAutoFillError] = useState('');
  const nextStepAutoFillRunningRef = useRef(false);
  const [nextStepAutoFillSummaryLines, setNextStepAutoFillSummaryLines] = useState([]); // ["프롬프트 생성", ...]

  // ✅ 헤더: 전체요약 모달(스크롤로 한눈에 보기)
  const [wizardSummaryOpen, setWizardSummaryOpen] = useState(false);

  const openAutoGenOverwriteConfirm = useCallback((targetsLabel, onConfirm) => {
    /**
     * ✅ 자동생성 덮어쓰기 공통 확인 모달
     *
     * 의도/원리:
     * - 자동생성 결과가 마음에 들지 않을 수 있으므로 "덮어쓰기"를 허용한다.
     * - 단, 기존 입력값이 사라질 수 있으므로 덮어쓰기 직전에 경고 모달을 띄운다.
     */
    try {
      const label = String(targetsLabel || '').trim();
      const fn = (typeof onConfirm === 'function') ? onConfirm : null;
      if (!label || !fn) return;
      autoGenOverwriteConfirmActionRef.current = fn;
      setAutoGenOverwriteConfirmTargets(label);
      setAutoGenOverwriteConfirmOpen(true);
    } catch (e) {
      try { console.error('[CreateCharacterPage] openAutoGenOverwriteConfirm failed:', e); } catch (_) {}
    }
  }, []);

  const confirmAutoGenOverwrite = useCallback(async () => {
    try {
      const fn = autoGenOverwriteConfirmActionRef.current;
      setAutoGenOverwriteConfirmOpen(false);
      setAutoGenOverwriteConfirmTargets('');
      autoGenOverwriteConfirmActionRef.current = null;
      if (typeof fn !== 'function') return;
      await fn();
    } catch (e) {
      try { console.error('[CreateCharacterPage] confirmAutoGenOverwrite failed:', e); } catch (_) {}
      try { dispatchToast('error', '자동 생성에 실패했습니다. 잠시 후 다시 시도해주세요.'); } catch (_) {}
    }
  }, []);
  const insertKeywordToken = useCallback((index, token) => {
    if (!token) return;
    setFormData((prev) => {
      const updated = [...prev.media_settings.image_descriptions];
      const currentKeywords = updated[index]?.keywords || [];
      if (currentKeywords.includes(token)) return prev;
      updated[index] = {
        ...updated[index],
        keywords: [...currentKeywords, token],
      };
      return {
        ...prev,
        media_settings: {
          ...prev.media_settings,
          image_descriptions: updated,
        },
      };
    });
  }, [setFormData]);

  // 토큰 정의
  // - {{character}}: 권장(직관적)
  // - {{char}}: 단축 토큰(호환)
  // - {{assistant}}: 레거시 호환(기존 데이터/입력 지원)
  const TOKEN_CHARACTER = '{{character}}';
  const TOKEN_CHAR = '{{char}}';
  const TOKEN_ASSISTANT = '{{assistant}}';
  const TOKEN_USER = '{{user}}';
  const ALLOWED_TOKENS = [TOKEN_ASSISTANT, TOKEN_CHARACTER, TOKEN_CHAR, TOKEN_USER];
  const HEADER_OFFSET = 72;

  const scrollToField = useCallback((key) => {
    if (!key) return;
    const sectionId = key.startsWith('basic_info')
      ? 'section-basic'
      : key.startsWith('example_dialogues')
      ? 'section-dialogues'
      : key.startsWith('affinity_system')
      ? 'section-affinity'
      : key.startsWith('publish_settings')
      ? 'section-publish'
      : 'section-basic';

    const el = document.getElementById(sectionId);
    if (el) {
      const y = el.getBoundingClientRect().top + window.pageYOffset - HEADER_OFFSET;
      window.scrollTo({ top: y, behavior: 'smooth' });
    }
  }, []);

  const mapServerPathToKey = useCallback((loc = []) => {
    if (!Array.isArray(loc)) return null;
    const normalized = loc[0] === 'body' ? loc.slice(1) : loc;
    return normalized.join('.');
  }, []);

  const dispatchToast = useCallback((type, message) => {
    try {
      window.dispatchEvent(new CustomEvent('toast', { detail: { type, message } }));
    } catch (_) {}
  }, []);

  const applyGeneratedImages = useCallback((gallery = [], focusUrl) => {
    if (!gallery.length) return;
    const newUrls = gallery
      .map(item => item?.url)
      .filter(Boolean);
    if (!newUrls.length) return;
    setFormData(prev => {
      /**
       * ✅ 공개/비공개 메타 보존(필수)
       *
       * - 이미지 "추가" 동작에서 기존 메타(키워드/공개여부)가 사라지면 UX/데이터가 깨진다.
       * - 따라서 URL 기준으로 기존 항목을 우선 재사용하고, 새 URL만 기본값으로 만든다.
       */
      const existing = Array.isArray(prev?.media_settings?.image_descriptions)
        ? prev.media_settings.image_descriptions
        : [];
      const byUrl = new Map(existing.map((x) => [String(x?.url || '').trim(), x]));
      const merged = [...existing.map(img => img.url), ...newUrls];
      const dedup = Array.from(new Set(merged))
        .map((url) => {
          const u = String(url || '').trim();
          const found = byUrl.get(u);
          if (found) {
            // ✅ 기존 메타 그대로 유지
            return found;
          }
          return { url: u, description: '', is_public: true };
        })
        .filter((x) => String(x?.url || '').trim());
      return {
        ...prev,
        media_settings: {
          ...prev.media_settings,
          image_descriptions: dedup,
          avatar_url: focusUrl || prev.media_settings.avatar_url || dedup[0]?.url || prev.media_settings.avatar_url,
        },
      };
    });
  }, []);

  // Zod 스키마 정의
  const validationSchema = useMemo(() => {
    const tokenRegex = /\{\{[^}]+\}\}/g;
    const allowedTokens = [TOKEN_ASSISTANT, TOKEN_CHARACTER, TOKEN_CHAR, TOKEN_USER];
    const noIllegalTokens = (val) => !val || [...(val.matchAll(tokenRegex) || [])].every(m => allowedTokens.includes(m[0]));

    const introductionSceneSchema = z.object({
      title: z.string().optional(),
      content: z.string().optional().refine(noIllegalTokens, '허용되지 않은 토큰이 포함됨'),
      secret: z.string().optional().refine(noIllegalTokens, '허용되지 않은 토큰이 포함됨'),
    });

    const dialogueSchema = z.object({
      user_message: z.string().min(1, '사용자 메시지를 입력하세요').refine(noIllegalTokens, '허용되지 않은 토큰이 포함됨'),
      character_response: z.string().min(1, '캐릭터 응답을 입력하세요').refine(noIllegalTokens, '허용되지 않은 토큰이 포함됨'),
      order_index: z.number().optional(),
    });

    return z.object({
      basic_info: z.object({
        name: z.string().min(1, '작품명을 입력하세요'),
        // 설명은 선택 입력 (백엔드도 optional)
        description: z.string().optional().refine(noIllegalTokens, '허용되지 않은 토큰이 포함됨'),
        personality: z.string().optional().refine(noIllegalTokens, '허용되지 않은 토큰이 포함됨'),
        speech_style: z.string().optional().refine(noIllegalTokens, '허용되지 않은 토큰이 포함됨'),
        greeting: z.string().optional().refine(noIllegalTokens, '허용되지 않은 토큰이 포함됨'),
        world_setting: z.string().optional().refine(noIllegalTokens, '허용되지 않은 토큰이 포함됨'),
        user_display_description: z.string().optional().refine(noIllegalTokens, '허용되지 않은 토큰이 포함됨'),
        use_custom_description: z.boolean(),
        character_type: z.string(),
        base_language: z.string(),
        introduction_scenes: z.array(introductionSceneSchema),
      }),
      media_settings: z.object({
        avatar_url: z.string().optional(),
        image_descriptions: z.array(z.object({ 
          url: z.string(), 
          description: z.string().optional(),
          keywords: z.array(z.string()).optional()  // 키워드 트리거
        })).optional(),
        newly_added_files: z.array(z.any()).optional(),
        voice_settings: z.object({
          voice_id: z.any().nullable().optional(),
          voice_style: z.any().nullable().optional(),
          enabled: z.boolean(),
        })
      }),
      example_dialogues: z.object({
        dialogues: z.array(dialogueSchema),
      }),
      affinity_system: z.object({
        has_affinity_system: z.boolean(),
        affinity_rules: z.string().optional(),
        affinity_stages: z.array(z.object({
          min_value: z.number(),
          max_value: z.number().nullable(),
          description: z.string(),
        }))
      }).superRefine((val, ctx) => {
        if (val.has_affinity_system && !val.affinity_rules?.trim()) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: '호감도 규칙을 입력하세요',
            path: ['affinity_rules']
          });
        }
      }),
      publish_settings: z.object({
        is_public: z.boolean(),
        custom_module_id: z.any().nullable().optional(),
        use_translation: z.boolean(),
      }),
    });
  }, []);

  const { isAuthenticated, user } = useAuth();
  const [allTags, setAllTags] = useState([]);
  const [selectedTagSlugs, setSelectedTagSlugs] = useState([]);
  const [isTagModalOpen, setIsTagModalOpen] = useState(false);
  // ✅ 원작챗(OrigChat) 캐릭터는 이 페이지에서 "필수 선택 옵션"을 노출하지 않기 위한 플래그
  const [isOrigChatCharacter, setIsOrigChatCharacter] = useState(false);

  // ✅ 일반 캐릭터 생성 전용 위저드(UI 개편 범위 한정)
  // - 생성(Create) + 비-원작챗 캐릭터에서만 적용
  // - 원작챗/수정페이지/기존 흐름은 그대로 유지(회귀 방지)
  const useNormalCreateWizard = !isEditMode && !isOrigChatCharacter;
  const NORMAL_CREATE_WIZARD_STEPS = [
    // ✅ 사용자 요구사항(경쟁사 구조): 아이콘 없이 텍스트만
    { id: 'profile', label: '프로필' },
    { id: 'prompt', label: '프롬프트' },
    { id: 'image', label: '상황별이미지' },
    // ✅ 용어 정리(UX): "첫시작"은 혼동이 있어 "오프닝"으로 노출
    { id: 'first_start', label: '오프닝' },
    // ✅ 경쟁사 구조: 오프닝(시작 설정)별로 스탯을 설정
    { id: 'stat', label: '스탯' },
    // ✅ UX: 엔딩을 먼저 잡고(큰 골), 설정집으로 보강하는 흐름이 자연스럽다.
    { id: 'ending', label: '엔딩' },
    // ✅ 경쟁사 키워드북 유사: 설정집(설정집 1/2... + 트리거 + 노트)
    { id: 'setting_book', label: '설정집' },
    { id: 'detail', label: '디테일' },
    // ✅ 옵션(공개/태그 등)은 마지막에 두어 "출시/마무리" 감각을 준다.
    { id: 'options', label: '옵션' },
  ];
  const [normalWizardStep, setNormalWizardStep] = useState('profile');
  // ✅ 프롬프트 타입 변경 UX: "프로필 단계"로 이동 + 해당 영역 하이라이트(깜빡)
  const promptTypeSectionRef = useRef(null);
  const [promptTypeHighlight, setPromptTypeHighlight] = useState(false);

  // ✅ 위저드(프로필 탭): QuickMeet(30초)와 동일한 장르/유형/소재 칩(햄버거 아코디언) 상태
  // - SSOT: 실제 저장은 selectedTagSlugs이며, 칩 선택은 해당 배열에 반영된다.
  const QUICK_MEET_GENRE_MAX_SELECT = 2;
  const QUICK_MEET_GENRE_PREVIEW_COUNT = 8;
  const QUICK_MEET_TYPE_PAGE_SIZE = 18;
  const QUICK_MEET_HOOK_PAGE_SIZE = 14;

  const [qmGenrePool, setQmGenrePool] = useState(() => shuffleCopy(QUICK_MEET_GENRE_CHIPS));
  const [qmTypePool, setQmTypePool] = useState(() => shuffleCopy(QUICK_MEET_TYPE_CHIPS));
  const getQuickMeetHookChipsForWizardMode = useCallback(() => {
    /**
     * ✅ 위저드(프로필) 시뮬 훅/소재 풀 분리
     *
     * 요구사항:
     * - 시뮬은 "목표/루프/제약"이 보이는 훅 풀이 필요하다.
     * - 롤플과 시뮬은 동일 훅 풀을 공유하지 않는다(분리).
     */
    try {
      const t = String(formData?.basic_info?.character_type || 'roleplay').trim();
      const base = (t === 'simulator')
        ? (Array.isArray(QUICK_MEET_HOOK_CHIPS_SIMULATOR) ? QUICK_MEET_HOOK_CHIPS_SIMULATOR : QUICK_MEET_HOOK_CHIPS)
        : (Array.isArray(QUICK_MEET_HOOK_CHIPS) ? QUICK_MEET_HOOK_CHIPS : []);
      return uniqStringsPreserveOrder(base);
    } catch (_) {
      return uniqStringsPreserveOrder(Array.isArray(QUICK_MEET_HOOK_CHIPS) ? QUICK_MEET_HOOK_CHIPS : []);
    }
  }, [formData?.basic_info?.character_type]);

  const [qmHookPool, setQmHookPool] = useState(() => shuffleCopy(uniqStringsPreserveOrder(QUICK_MEET_HOOK_CHIPS)));
  const [qmGenreExpanded, setQmGenreExpanded] = useState(false);
  const [qmChipPanelsOpen, setQmChipPanelsOpen] = useState({ genre: true, type: false, hook: false });
  const [qmTypePage, setQmTypePage] = useState(0);
  const [qmHookPage, setQmHookPage] = useState(0);
  const [qmSelectedGenres, setQmSelectedGenres] = useState([]); // string[]
  const [qmSelectedType, setQmSelectedType] = useState(''); // string
  const [qmSelectedHook, setQmSelectedHook] = useState(''); // string

  useEffect(() => {
    /**
     * ✅ selectedTagSlugs(SSOT) ↔ QuickMeet 칩 상태 동기화
     * - TagSelectModal에서 제거/추가해도 칩 상태가 따라가야 한다(30초 모달과 동일 UX).
     */
    try {
      if (!useNormalCreateWizard) return;
      const slugs = Array.isArray(selectedTagSlugs) ? selectedTagSlugs : [];
      const set = new Set(slugs.map((x) => String(x || '').trim()).filter(Boolean));

      // 1) 장르(최대 2)
      try {
        setQmSelectedGenres((prev) => {
          const cur = Array.isArray(prev) ? prev.map((x) => String(x || '').trim()).filter(Boolean) : [];
          const kept = cur.filter((x) => set.has(x));
          if (kept.length >= QUICK_MEET_GENRE_MAX_SELECT) return kept.slice(0, QUICK_MEET_GENRE_MAX_SELECT);
          const pool = Array.isArray(QUICK_MEET_GENRE_CHIPS) ? QUICK_MEET_GENRE_CHIPS : [];
          const add = [];
          for (const g0 of pool) {
            const g = String(g0 || '').trim();
            if (!g) continue;
            if (!set.has(g)) continue;
            if (kept.includes(g)) continue;
            add.push(g);
            if (kept.length + add.length >= QUICK_MEET_GENRE_MAX_SELECT) break;
          }
          return [...kept, ...add].slice(0, QUICK_MEET_GENRE_MAX_SELECT);
        });
      } catch (_) {}

      // 2) 유형(단일)
      try {
        setQmSelectedType((prev) => {
          const cur = String(prev || '').trim();
          if (cur && set.has(cur)) return cur;
          const pool = Array.isArray(QUICK_MEET_TYPE_CHIPS) ? QUICK_MEET_TYPE_CHIPS : [];
          for (const t0 of pool) {
            const t = String(t0 || '').trim();
            if (!t) continue;
            if (set.has(t)) return t;
          }
          return '';
        });
      } catch (_) {}

      // 3) 소재(단일)
      try {
        setQmSelectedHook((prev) => {
          const cur = String(prev || '').trim();
          if (cur && set.has(cur)) return cur;
          // ✅ 방어: 시뮬 훅은 roleplay 훅 풀에 없을 수 있어 union을 본다.
          const pool = [
            ...(Array.isArray(QUICK_MEET_HOOK_CHIPS) ? QUICK_MEET_HOOK_CHIPS : []),
            ...(Array.isArray(QUICK_MEET_HOOK_CHIPS_SIMULATOR) ? QUICK_MEET_HOOK_CHIPS_SIMULATOR : []),
          ];
          for (const t0 of pool) {
            const t = String(t0 || '').trim();
            if (!t) continue;
            if (set.has(t)) return t;
          }
          return '';
        });
      } catch (_) {}
    } catch (_) {}
  }, [useNormalCreateWizard, selectedTagSlugs]);

  const upsertQuickMeetTagSlug = useCallback((slug, { remove = false } = {}) => {
    /**
     * ✅ QuickMeet 칩 선택을 selectedTagSlugs(SSOT)에 반영
     *
     * 배경:
     * - CreateCharacterPage 내부에서 QuickMeet(칩 UI) 선택 상태는 로컬 state로 보이지만,
     *   실제 저장/전송의 SSOT는 selectedTagSlugs 이다.
     *
     * 방어 정책:
     * - 필수 태그(성향/이미지 스타일)는 절대 제거하지 않는다.
     */
    try {
      const s = String(slug || '').trim();
      if (!s) return;
      const isReq = REQUIRED_AUDIENCE_SLUGS.includes(s) || REQUIRED_STYLE_SLUGS.includes(s);
      if (remove && isReq) return;
      setSelectedTagSlugs((prev) => {
        const arr = Array.isArray(prev) ? prev : [];
        if (remove) return arr.filter((x) => String(x || '').trim() !== s);
        const next = [...arr, s].map((x) => String(x || '').trim()).filter(Boolean);
        return Array.from(new Set(next));
      });
    } catch (_) {}
  }, []);

  useEffect(() => {
    /**
     * ✅ 위저드: 모드 변경 시 시뮬 훅 풀 교체
     *
     * - 시뮬로 바뀌면 목표/루프 중심 훅 풀이 보여야 한다.
     * - 롤플로 바뀌면 롤플 훅 풀을 유지한다.
     */
    try {
      if (!useNormalCreateWizard) return;
      const pool = shuffleCopy(getQuickMeetHookChipsForWizardMode());
      setQmHookPool(pool);
      setQmHookPage(0);
      const picked = String(qmSelectedHook || '').trim();
      if (picked && !pool.includes(picked)) {
        setQmSelectedHook('');
        try { upsertQuickMeetTagSlug(picked, { remove: true }); } catch (_) {}
      }
    } catch (_) {}
  }, [useNormalCreateWizard, getQuickMeetHookChipsForWizardMode, qmSelectedHook, upsertQuickMeetTagSlug]);

  const toggleQuickMeetGenreChip = useCallback((label) => {
    /**
     * ✅ 장르: 최대 2개 선택, 선택된 항목은 앞으로 모으기(최근 선택 우선)
     */
    try {
      const t = String(label || '').trim();
      if (!t) return;
      setQmSelectedGenres((prev) => {
        const arr = Array.isArray(prev) ? prev : [];
        if (arr.includes(t)) {
          const next = arr.filter((x) => x !== t);
          upsertQuickMeetTagSlug(t, { remove: true });
          return next;
        }
        if (arr.length >= QUICK_MEET_GENRE_MAX_SELECT) return arr;
        const next = [t, ...arr];
        upsertQuickMeetTagSlug(t, { remove: false });
        return next;
      });
    } catch (_) {}
  }, [upsertQuickMeetTagSlug]);

  const toggleQuickMeetSingleChip = useCallback((kind, label) => {
    /**
     * ✅ 유형/소재: 단일 선택(토글 가능)
     */
    try {
      const t = String(label || '').trim();
      if (!t) return;
      if (kind === 'type') {
        setQmSelectedType((prev) => {
          const prevV = String(prev || '').trim();
          const nextV = (prevV === t) ? '' : t;
          if (prevV && prevV !== nextV) upsertQuickMeetTagSlug(prevV, { remove: true });
          if (nextV) upsertQuickMeetTagSlug(nextV, { remove: false });
          return nextV;
        });
        return;
      }
      if (kind === 'hook') {
        setQmSelectedHook((prev) => {
          const prevV = String(prev || '').trim();
          const nextV = (prevV === t) ? '' : t;
          if (prevV && prevV !== nextV) upsertQuickMeetTagSlug(prevV, { remove: true });
          if (nextV) upsertQuickMeetTagSlug(nextV, { remove: false });
          return nextV;
        });
      }
    } catch (_) {}
  }, [upsertQuickMeetTagSlug]);

  const qmSelectedAudienceSlug = useMemo(() => {
    /**
     * ✅ 성향(남/여/전체) 기반 장르 선노출 우선순위 계산용
     */
    try {
      const slugs = Array.isArray(selectedTagSlugs) ? selectedTagSlugs : [];
      return String(slugs.find((s) => REQUIRED_AUDIENCE_SLUGS.includes(s)) || '').trim();
    } catch (_) {
      return '';
    }
  }, [selectedTagSlugs]);

  const qmGenreDisplay = useMemo(() => {
    try {
      const pool = Array.isArray(qmGenrePool) ? qmGenrePool : [];
      const pinned = Array.isArray(qmSelectedGenres) ? qmSelectedGenres : [];
      const priority = getQuickMeetGenrePriority(qmSelectedAudienceSlug);
      const prioSet = new Set(priority);
      const pinnedSet = new Set(pinned);
      const prioIn = priority.filter((x) => pool.includes(x) && !pinnedSet.has(x));
      const rest = pool.filter((x) => !pinnedSet.has(x) && !prioSet.has(x));
      return [...pinned, ...prioIn, ...rest];
    } catch (_) {
      return Array.isArray(qmGenrePool) ? qmGenrePool : [];
    }
  }, [qmGenrePool, qmSelectedGenres, qmSelectedAudienceSlug]);

  const qmTypeDisplay = useMemo(() => {
    try {
      const pool = Array.isArray(qmTypePool) ? qmTypePool : [];
      const p = String(qmSelectedType || '').trim();
      if (!p) return pool;
      return [p, ...pool.filter((x) => x !== p)];
    } catch (_) {
      return Array.isArray(qmTypePool) ? qmTypePool : [];
    }
  }, [qmTypePool, qmSelectedType]);

  const qmHookDisplay = useMemo(() => {
    try {
      const pool = Array.isArray(qmHookPool) ? qmHookPool : [];
      const p = String(qmSelectedHook || '').trim();
      if (!p) return pool;
      return [p, ...pool.filter((x) => x !== p)];
    } catch (_) {
      return Array.isArray(qmHookPool) ? qmHookPool : [];
    }
  }, [qmHookPool, qmSelectedHook]);

  const qmTypeVisible = useMemo(() => {
    try {
      const arr = Array.isArray(qmTypeDisplay) ? qmTypeDisplay : [];
      if (arr.length === 0) return [];
      const start = (Number(qmTypePage || 0) * QUICK_MEET_TYPE_PAGE_SIZE) % arr.length;
      const slice = arr.slice(start, start + QUICK_MEET_TYPE_PAGE_SIZE);
      if (slice.length < QUICK_MEET_TYPE_PAGE_SIZE) {
        const filled = [...slice, ...arr.slice(0, QUICK_MEET_TYPE_PAGE_SIZE - slice.length)];
        const picked = String(qmSelectedType || '').trim();
        if (!picked) return filled;
        const rest = filled.filter((x) => String(x || '').trim() !== picked);
        return [picked, ...rest].slice(0, QUICK_MEET_TYPE_PAGE_SIZE);
      }
      const picked = String(qmSelectedType || '').trim();
      if (!picked) return slice;
      const rest = slice.filter((x) => String(x || '').trim() !== picked);
      return [picked, ...rest].slice(0, QUICK_MEET_TYPE_PAGE_SIZE);
    } catch (_) {
      return [];
    }
  }, [qmTypeDisplay, qmTypePage, qmSelectedType, QUICK_MEET_TYPE_PAGE_SIZE]);

  const qmHookVisible = useMemo(() => {
    try {
      const arr = Array.isArray(qmHookDisplay) ? qmHookDisplay : [];
      if (arr.length === 0) return [];
      const start = (Number(qmHookPage || 0) * QUICK_MEET_HOOK_PAGE_SIZE) % arr.length;
      const slice = arr.slice(start, start + QUICK_MEET_HOOK_PAGE_SIZE);
      if (slice.length < QUICK_MEET_HOOK_PAGE_SIZE) {
        const filled = [...slice, ...arr.slice(0, QUICK_MEET_HOOK_PAGE_SIZE - slice.length)];
        const picked = String(qmSelectedHook || '').trim();
        if (!picked) return filled;
        const rest = filled.filter((x) => String(x || '').trim() !== picked);
        return [picked, ...rest].slice(0, QUICK_MEET_HOOK_PAGE_SIZE);
      }
      const picked = String(qmSelectedHook || '').trim();
      if (!picked) return slice;
      const rest = slice.filter((x) => String(x || '').trim() !== picked);
      return [picked, ...rest].slice(0, QUICK_MEET_HOOK_PAGE_SIZE);
    } catch (_) {
      return [];
    }
  }, [qmHookDisplay, qmHookPage, qmSelectedHook, QUICK_MEET_HOOK_PAGE_SIZE]);

  useEffect(() => {
    if (!useNormalCreateWizard) return;
    const ok = NORMAL_CREATE_WIZARD_STEPS.some((s) => s.id === normalWizardStep);
    if (!ok) setNormalWizardStep('profile');
  }, [useNormalCreateWizard, normalWizardStep]);

  useEffect(() => {
    if (!useNormalCreateWizard) return;
    if (normalWizardStep !== 'profile') return;
    if (!promptTypeHighlight) return;
    try {
      // DOM 렌더 후 스크롤(UX 안정)
      const t = setTimeout(() => {
        try { promptTypeSectionRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'center' }); } catch (_) {}
      }, 50);
      const off = setTimeout(() => { try { setPromptTypeHighlight(false); } catch (_) {} }, 2200);
      return () => { try { clearTimeout(t); } catch (_) {} try { clearTimeout(off); } catch (_) {} };
    } catch (_) {
      return undefined;
    }
  }, [useNormalCreateWizard, normalWizardStep, promptTypeHighlight]);

  const wizardStepIndex = useMemo(() => {
    try {
      const i = NORMAL_CREATE_WIZARD_STEPS.findIndex((s) => s.id === normalWizardStep);
      return i >= 0 ? i : 0;
    } catch (_) {
      return 0;
    }
  }, [NORMAL_CREATE_WIZARD_STEPS, normalWizardStep]);

  const wizardCanGoNext = useMemo(() => {
    // ✅ 경쟁사 UX: "다음단계"는 최소 입력이 채워져야 활성화
    // - 기존 전체 저장 검증(필수 항목 다수)과 분리: 단계별로 필요한 최소만 체크한다.
    try {
      if (!useNormalCreateWizard) return true;

      // ✅ 글자수 제한(초과 시 에러 대신 인라인 경고)
      // - maxLength로 막으면 350/300 같은 초과 표시가 불가능하므로,
      //   위저드 이동을 여기서 선제 차단하고(버튼 비활성화), UI는 인라인 경고로만 안내한다.
      const profileDescMax = getProfileOneLineMaxLenByCharacterType(formData?.basic_info?.character_type);
      const LIMITS = {
        profile_name: PROFILE_NAME_MAX_LEN,
        profile_desc: profileDescMax,
        prompt_world: 6000,
        prompt_secret: 1000,
        options_creator_comment: 1000,
        detail_personality: 300,
        detail_speech_style: 300,
        opening_title: 100,
        opening_intro: 2000,
        opening_first_line: 500,
        dialogue_user: 500,
        dialogue_char: 1000,
      };
      const len = (v) => String(v ?? '').length;
      const over = (v, mx) => len(v) > mx;

      if (normalWizardStep === 'profile') {
        const nameRaw = String(formData?.basic_info?.name || '');
        const descRaw = String(formData?.basic_info?.description || '');
        const nameTrim = nameRaw.trim();
        const descTrim = descRaw.trim();
        const nameOk = !!nameTrim;
        const descOk = !!descTrim;
        const nameNotOver = !over(nameRaw, LIMITS.profile_name);
        const descNotOver = !over(descRaw, LIMITS.profile_desc);
        // ✅ UX: 유저 수동 입력은 최소 1자(=비어있지 않음)만 요구한다.
        // - 최소 길이(8/150)는 자동생성 결과 품질/일관성을 위한 제약으로만 사용한다.
        const audienceOk = (selectedTagSlugs || []).some((s) => REQUIRED_AUDIENCE_SLUGS.includes(s));
        const promptTypeOk = (() => {
          try {
            const t = String(formData?.basic_info?.character_type || '').trim();
            return t === 'roleplay' || t === 'simulator' || t === 'custom';
          } catch (_) {
            return false;
          }
        })();
        const imageOk = (() => {
          /**
           * ✅ 프로필 단계 대표이미지 필수(요구사항)
           *
           * 의도/원리:
           * - 경쟁사 UX처럼 "프로필" 단계에서 대표 이미지를 필수로 만든다.
           * - 대표이미지(avatar_url)가 없더라도, 갤러리 1개 이상이면 대표가 될 수 있으므로 둘 중 하나를 허용한다.
           */
          try {
            const avatar = String(formData?.media_settings?.avatar_url || '').trim();
            if (avatar) return true;
            const imgs = Array.isArray(formData?.media_settings?.image_descriptions)
              ? formData.media_settings.image_descriptions
              : [];
            return imgs.some((img) => !!String(img?.url || '').trim());
          } catch (_) {
            return false;
          }
        })();
        const turnsOk = (() => {
          try {
            const ss = formData?.basic_info?.start_sets;
            const sim = (ss && typeof ss === 'object' && ss.sim_options && typeof ss.sim_options === 'object')
              ? ss.sim_options
              : null;
            const raw = sim ? Number(sim.max_turns ?? 0) : 0;
            const mt = Number.isFinite(raw) ? Math.floor(raw) : 0;
            return !!mt && mt >= 50;
          } catch (_) {
            return false;
          }
        })();
        // ✅ QuickMeet(30초)와 일관: 장르(>=1), 캐릭터 유형(1), 소재(1) 선택이 필수
        const qmGenreOk = (selectedTagSlugs || []).some((s) => (Array.isArray(QUICK_MEET_GENRE_CHIPS) ? QUICK_MEET_GENRE_CHIPS : []).includes(s));
        const qmTypeOk = (selectedTagSlugs || []).some((s) => (Array.isArray(QUICK_MEET_TYPE_CHIPS) ? QUICK_MEET_TYPE_CHIPS : []).includes(s));
        const qmHookOk = (selectedTagSlugs || []).some((s) => {
          const pool = [
            ...(Array.isArray(QUICK_MEET_HOOK_CHIPS) ? QUICK_MEET_HOOK_CHIPS : []),
            ...(Array.isArray(QUICK_MEET_HOOK_CHIPS_SIMULATOR) ? QUICK_MEET_HOOK_CHIPS_SIMULATOR : []),
          ];
          return pool.includes(s);
        });
        return nameOk && descOk && nameNotOver && descNotOver && audienceOk && promptTypeOk && turnsOk && qmGenreOk && qmTypeOk && qmHookOk && imageOk;
      }
      if (normalWizardStep === 'prompt') {
        // 프롬프트(= 기존 world_setting) 최소 1자
        const world = String(formData?.basic_info?.world_setting || '');
        const ok = !!world.trim();
        const notOver = !over(world, LIMITS.prompt_world);
        const secretOk = (() => {
          try {
            if (!isSecretInfoEnabled) return true;
            return !over(formData?.basic_info?.introduction_scenes?.[0]?.secret, LIMITS.prompt_secret);
          } catch (_) {
            return true;
          }
        })();
        return ok && notOver && secretOk;
      }
      if (normalWizardStep === 'image') {
        const hasExistingImages = Array.isArray(formData?.media_settings?.image_descriptions)
          && formData.media_settings.image_descriptions.some((img) => String(img?.url || '').trim());
        const hasNewFiles = Array.isArray(formData?.media_settings?.newly_added_files)
          && formData.media_settings.newly_added_files.length > 0;
        const hasBaseAvatar = !!String(formData?.media_settings?.avatar_url || '').trim();
        const styleOk = (selectedTagSlugs || []).some((s) => REQUIRED_STYLE_SLUGS.includes(s));
        // ✅ 경쟁사 UX(기본 이미지 고정):
        // - 프로필에서 등록한 대표이미지(avatar_url)를 "기본 이미지"로 간주한다.
        // - 따라서 추가 업로드가 없어도 avatar_url만 있으면 이미지 단계 통과 가능.
        return (hasExistingImages || hasNewFiles || hasBaseAvatar) && styleOk;
      }
      if (normalWizardStep === 'first_start') {
        const ss = formData?.basic_info?.start_sets;
        const items = Array.isArray(ss?.items) ? ss.items : [];
        const sel = String(ss?.selectedId || '').trim();
        const picked = items.find((x) => String(x?.id || '').trim() === sel) || items[0] || {};
        const titleRaw = String(picked?.title || '');
        const introRaw = String(picked?.intro || '');
        const firstRaw = String(picked?.firstLine || '');
        const firstOk = !!String(firstRaw || '').trim();
        return (
          firstOk
          && !over(titleRaw, LIMITS.opening_title)
          && !over(introRaw, LIMITS.opening_intro)
          && !over(firstRaw, LIMITS.opening_first_line)
        );
      }
      if (normalWizardStep === 'options') {
        try {
          if (!formData?.basic_info?.use_custom_description) return true;
          return !over(formData?.basic_info?.user_display_description, LIMITS.options_creator_comment);
        } catch (_) {
          return true;
        }
      }
      if (normalWizardStep === 'detail') {
        const pOk = !over(formData?.basic_info?.personality, LIMITS.detail_personality);
        const sOk = !over(formData?.basic_info?.speech_style, LIMITS.detail_speech_style);
        const dialoguesOk = (() => {
          try {
            const ds = Array.isArray(formData?.example_dialogues?.dialogues) ? formData.example_dialogues.dialogues : [];
            for (const d of ds) {
              const u = String(d?.user_message || '');
              const a = String(d?.character_response || '');
              if (over(u, LIMITS.dialogue_user) || over(a, LIMITS.dialogue_char)) return false;
            }
            return true;
          } catch (_) {
            return true;
          }
        })();
        return pOk && sOk && dialoguesOk;
      }
      return true;
    } catch (_) {
      return false;
    }
  }, [useNormalCreateWizard, normalWizardStep, formData, selectedTagSlugs, isSecretInfoEnabled]);

  const goNextWizardStep = useCallback(() => {
    try {
      if (!useNormalCreateWizard) return;
      /**
       * ✅ 다음단계 클릭 시 프리뷰 반영 보장(방어적):
       * - 일부 입력은 onBlur에서만 formData에 커밋될 수 있다.
       * - 모바일/일부 브라우저에서 "다음단계" 탭 전환이 먼저 일어나면, blur 커밋이 누락되어
       *   프리뷰가 이전 값으로 남는 UX 이슈가 발생할 수 있다.
       * - 따라서 단계 전환 전에 현재 포커스된 요소를 강제로 blur하여 커밋 기회를 보장한다.
       */
      try {
        const el = (typeof document !== 'undefined') ? document.activeElement : null;
        if (el && typeof el.blur === 'function') el.blur();
      } catch (_) {}
      const nextIdx = Math.min(NORMAL_CREATE_WIZARD_STEPS.length - 1, wizardStepIndex + 1);
      const nextId = NORMAL_CREATE_WIZARD_STEPS[nextIdx]?.id;
      if (nextId) setNormalWizardStep(nextId);
    } catch (_) {}
  }, [useNormalCreateWizard, NORMAL_CREATE_WIZARD_STEPS, wizardStepIndex]);

  const syncStatsIntoPromptText = (baseText, statsList) => {
    /**
     * ✅ 프롬프트에 스탯 블록을 안전하게 삽입/교체한다.
     *
     * 의도/원리:
     * - 프롬프트 자동생성 응답(stats)을 사용자가 프롬프트에서도 즉시 확인할 수 있어야 한다.
     * - 마커로 감싸 "관리 영역"만 교체해 사용자 작성 영역을 침범하지 않는다.
     *
     * 주의:
     * - 이 함수는 UI 상태를 바꾸지 않는 순수 함수여야 한다(CQS).
     */
    try {
      const START = '<!-- CC_STATS_START -->';
      const END = '<!-- CC_STATS_END -->';
      const header = '## 스탯 설정 (자동 동기화)\n';
      const body = (Array.isArray(statsList) ? statsList : []).map((s) => {
        const nm = String(s?.name || '').trim();
        if (!nm) return null;
        const mn = (s?.min_value === '' || s?.min_value == null) ? '' : String(s.min_value);
        const mx = (s?.max_value === '' || s?.max_value == null) ? '' : String(s.max_value);
        const bv = (s?.base_value === '' || s?.base_value == null) ? '' : String(s.base_value);
        const unit = String(s?.unit || '').trim();
        const desc = String(s?.description || '').trim();
        const range = (mn !== '' && mx !== '') ? `${mn}~${mx}` : '';
        const base = (bv !== '') ? `기본 ${bv}` : '';
        const unitPart = unit ? `(${unit})` : '';
        const meta = [range, base].filter(Boolean).join(', ');
        const metaPart = meta ? ` — ${meta}` : '';
        const descPart = desc ? `\n  - 설명: ${desc}` : '';
        return `- **${nm}** ${unitPart}${metaPart}${descPart}`;
      }).filter(Boolean).join('\n');
      const block = [START, header + (body || '- (스탯 없음)'), END].join('\n');

      const text = String(baseText || '');
      const sIdx = text.indexOf(START);
      const eIdx = text.indexOf(END);
      if (sIdx >= 0 && eIdx > sIdx) {
        const before = text.slice(0, sIdx).trimEnd();
        const after = text.slice(eIdx + END.length).trimStart();
        return [before, block, after].filter(Boolean).join('\n\n').trim().slice(0, 6000);
      }
      /**
       * ✅ 방어적 복구:
       * - 사용자가 프롬프트에서 START/END 중 하나만 삭제하면, 기존 블록이 "깨진 상태"가 된다.
       * - 이 경우에는 이중 삽입/잔여 마커가 남을 수 있으므로, 깨진 블록을 교체하는 방식으로 복구한다.
       */
      if (sIdx >= 0 && !(eIdx > sIdx)) {
        // START는 있는데 END가 없거나 위치가 이상함 → START부터 끝까지는 관리영역으로 보고 교체
        const before = text.slice(0, sIdx).trimEnd();
        return [before, block].filter(Boolean).join('\n\n').trim().slice(0, 6000);
      }
      if (eIdx >= 0 && sIdx < 0) {
        // END만 남은 경우 → END 마커만 제거 후 정상 삽입(중복/잔여 마커 방지)
        const before = text.slice(0, eIdx).trimEnd();
        const after = text.slice(eIdx + END.length).trimStart();
        const cleaned = [before, after].filter(Boolean).join('\n\n').trim();
        return [cleaned, block].filter(Boolean).join('\n\n').trim().slice(0, 6000);
      }
      // 없으면 마지막에 추가
      return [text.trim(), block].filter(Boolean).join('\n\n').trim().slice(0, 6000);
    } catch (_) {
      return String(baseText || '').slice(0, 6000);
    }
  };

  const extractStatsFromPromptStatsBlock = (promptTextRaw) => {
    /**
     * ✅ 프롬프트의 스탯 블록(<!-- CC_STATS_START/END -->)을 파싱해 스탯 리스트로 변환한다.
     *
     * 의도/원리:
     * - "다음단계 자동완성"에서 스탯 단계로 갈 때, 프롬프트에 블록이 있으면 그 내용을 SSOT처럼 사용한다.
     * - 파싱 실패 시에는 호출부에서 서버 스탯 생성(quick-generate-stat)으로 폴백한다.
     *
     * 방어:
     * - 블록 누락/형식 불일치/부분 누락에 안전하게 대응한다.
     */
    try {
      const text = String(promptTextRaw || '');
      const START = '<!-- CC_STATS_START -->';
      const END = '<!-- CC_STATS_END -->';
      const sIdx = text.indexOf(START);
      const eIdx = text.indexOf(END);
      if (!(sIdx >= 0 && eIdx > sIdx)) return [];

      const blockBody = text.slice(sIdx + START.length, eIdx);
      const lines = String(blockBody || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
      const parsed = [];
      for (let i = 0; i < lines.length; i += 1) {
        const line = String(lines[i] || '').trimEnd();
        const m = line.match(/^- \*\*(.+?)\*\*\s*(\((.*?)\))?\s*(?:—\s*(.*))?$/);
        if (!m) continue;
        const name = String(m[1] || '').trim();
        if (!name) continue;
        const unit = String(m[3] || '').trim();
        const meta = String(m[4] || '').trim();

        let minValue = '';
        let maxValue = '';
        let baseValue = '';
        if (meta) {
          const parts = meta.split(',').map((p) => p.trim()).filter(Boolean);
          for (const p of parts) {
            if (p.includes('~')) {
              const [a, b] = p.split('~').map((x) => String(x || '').trim());
              const na = Number(a);
              const nb = Number(b);
              if (Number.isFinite(na)) minValue = na;
              if (Number.isFinite(nb)) maxValue = nb;
              continue;
            }
            if (p.startsWith('기본')) {
              const raw = p.replace(/^기본\s*/g, '').trim();
              const nv = Number(raw);
              if (Number.isFinite(nv)) baseValue = nv;
              continue;
            }
          }
        }

        let desc = '';
        if (i + 1 < lines.length) {
          const next = String(lines[i + 1] || '');
          const dm = next.match(/^\s*-\s*설명:\s*(.*)$/);
          if (dm) {
            desc = String(dm[1] || '').trim();
            i += 1;
          }
        }

        parsed.push({
          id: `stat_${Date.now()}_${Math.random().toString(16).slice(2, 7)}`,
          name: name.slice(0, 20),
          min_value: minValue,
          max_value: maxValue,
          base_value: baseValue,
          unit: unit.slice(0, 10),
          description: desc.slice(0, 200),
        });
        if (parsed.length >= HARD_MAX_STATS_PER_OPENING) break;
      }
      return parsed.filter((s) => String(s?.name || '').trim() && String(s?.description || '').trim());
    } catch (_) {
      return [];
    }
  };

  const handleAutoGeneratePromptOnlyForNextStepAutoFill = useCallback(async () => {
    /**
     * ✅ 다음단계 자동완성 전용: "프롬프트(world_setting)만" 자동 생성
     *
     * 의도/원리:
     * - 기존 `handleAutoGeneratePrompt`는 프롬프트 생성과 함께 스탯/디테일까지 자동 채움(올인원)으로 동작한다.
     * - 하지만 자동완성 요구사항은 "한 글자라도 입력 흔적이 있으면 자동완성 금지"이므로,
     *   다음 단계 자동완성에서는 world_setting만 채우고 다른 필드는 절대 건드리지 않는다.
     *
     * ⚠️ 중요:
     * - 이 함수는 `handleNextStepAutoFill`에서 dependency로 사용되므로,
     *   선언 순서가 아래에 있으면 TDZ(선언 전 참조)로 런타임 에러가 날 수 있다.
     */
    try {
      const existing = String(formData?.basic_info?.world_setting || '').trim();
      if (existing) return { skipped: true, reason: 'already_filled' };

      const mode = String(formData?.basic_info?.character_type || 'roleplay').trim();
      if (mode !== 'simulator' && mode !== 'roleplay') {
        dispatchToast('error', '이 모드에서는 자동생성을 사용할 수 없어요.');
        return null;
      }

      const name = String(formData?.basic_info?.name || '').trim();
      const desc = String(formData?.basic_info?.description || '').trim();
      const concept = (() => {
        try {
          const ss = (formData?.basic_info?.start_sets && typeof formData.basic_info.start_sets === 'object')
            ? formData.basic_info.start_sets
            : null;
          const pc = (ss && typeof ss.profile_concept === 'object' && ss.profile_concept) ? ss.profile_concept : null;
          const enabled = !!pc?.enabled;
          if (!enabled) return '';
          return String(pc?.text || '').trim().slice(0, PROFILE_CONCEPT_MAX_LEN);
        } catch (_) {
          return '';
        }
      })();
      const descForPrompt = concept ? `${desc}\n\n[작품 컨셉(추가 참고)]\n${concept}` : desc;
      if (!name || !desc) {
        dispatchToast('error', '프로필 정보를 먼저 입력해주세요.');
        return null;
      }

      // ✅ 요구사항: "위저드만" 제미니 고정(다른 화면/로직에는 영향 주지 않음)
      const aiModel = useNormalCreateWizard
        ? 'gemini'
        : (String(user?.preferred_model || 'claude').trim().toLowerCase() || 'claude');
      const ss = (formData?.basic_info?.start_sets && typeof formData.basic_info.start_sets === 'object')
        ? formData.basic_info.start_sets
        : null;
      const sim = (ss && typeof ss.sim_options === 'object' && ss.sim_options) ? ss.sim_options : {};
      const maxTurnsRaw = Number(sim?.max_turns ?? 200);
      const maxTurns = Number.isFinite(maxTurnsRaw) && maxTurnsRaw >= 50 ? Math.floor(maxTurnsRaw) : 200;
      const simDatingElements = !!sim?.sim_dating_elements;

      const res = await charactersAPI.quickGeneratePromptDraft({
        name,
        description: descForPrompt,
        mode: (mode === 'simulator' ? 'simulator' : 'roleplay'),
        max_turns: maxTurns,
        sim_dating_elements: (mode === 'simulator' ? simDatingElements : undefined),
        tags: Array.isArray(selectedTagSlugs) ? selectedTagSlugs : [],
        ai_model: (aiModel === 'gpt' ? 'gpt' : (aiModel === 'gemini' ? 'gemini' : 'claude')),
      });

      const promptText = String(res?.data?.prompt || '').trim();
      if (!promptText) {
        dispatchToast('error', '프롬프트 생성 결과가 비어있습니다. 잠시 후 다시 시도해주세요.');
        return null;
      }

      // ✅ 다음단계 자동완성에서도 "프롬프트 안의 스탯 블록"은 같이 들어가야 한다(요구사항).
      // - 단, stats 탭(start_sets.stat_settings)까지는 건드리지 않는다(이 함수의 역할: world_setting만).
      let nextPromptText = promptText.slice(0, 6000);
      try {
        const rawStats = Array.isArray(res?.data?.stats) ? res.data.stats : [];
        const normalized = rawStats
          .map((s) => ({
            name: String(s?.name || '').trim().slice(0, 20),
            min_value: Number.isFinite(Number(s?.min_value)) ? Number(s.min_value) : '',
            max_value: Number.isFinite(Number(s?.max_value)) ? Number(s.max_value) : '',
            base_value: Number.isFinite(Number(s?.base_value)) ? Number(s.base_value) : '',
            unit: String(s?.unit || '').trim().slice(0, 10),
            description: String(s?.description || '').trim().slice(0, 200),
          }))
          .filter((s) => s.name && s.description)
          .slice(0, HARD_MAX_STATS_PER_OPENING);
        if (normalized.length) {
          nextPromptText = syncStatsIntoPromptText(nextPromptText, normalized).slice(0, 6000);
        } else {
          // 방어: stats가 비어있으면 알려주기(침묵 금지)
          dispatchToast('warning', '스탯을 불러오지 못했습니다. (프롬프트는 생성됨)');
        }
      } catch (e2) {
        try { console.error('[CreateCharacterPage] prompt-only stats inject failed:', e2); } catch (_) {}
      }

      setFormData((prev) => ({
        ...prev,
        basic_info: {
          ...prev.basic_info,
          world_setting: nextPromptText,
        },
      }));
      return { prompt: nextPromptText };
    } catch (e) {
      try { console.error('[CreateCharacterPage] prompt-only autofill failed:', e); } catch (_) {}
      try { dispatchToast('error', '프롬프트 자동 생성에 실패했습니다. 잠시 후 다시 시도해주세요.'); } catch (_) {}
      return null;
    }
  }, [formData, selectedTagSlugs, user, dispatchToast]);

  const genStartSetId = useCallback(() => {
    try {
      return `set_${Date.now()}_${Math.random().toString(16).slice(2, 7)}`;
    } catch (_) {
      return `set_${Date.now()}`;
    }
  }, []);

  /**
   * start_sets(SSOT) → legacy 필드 미러링
   *
   * 의도/원리:
   * - 신규 UI는 start_sets를 SSOT로 쓰되, 현재 페이지의 기존 저장/검증/미리보기 로직은
   *   greeting(greetings[0])/introduction_scenes를 참조한다.
   * - 따라서 사용자가 start_sets를 편집/선택할 때마다 legacy 필드도 같이 갱신해
   *   회귀 없이 단계적 전환을 가능하게 한다.
   */
  const mirrorLegacyFromStartSets = useCallback((nextStartSets) => {
    try {
      const ss = (nextStartSets && typeof nextStartSets === 'object') ? nextStartSets : null;
      const items = Array.isArray(ss?.items) ? ss.items : [];
      const selectedId = String(ss?.selectedId || '').trim();
      if (!items.length) return { greeting: '', introTitle: '오프닝 1', introContent: '' };
      const picked = items.find((x) => String(x?.id || '').trim() === selectedId) || items[0];
      const title = String(picked?.title || '오프닝 1').trim() || '오프닝 1';
      const intro = String(picked?.intro || '').trim();
      const firstLine = String(picked?.firstLine || '').trim();
      return {
        greeting: firstLine,
        introTitle: title,
        introContent: intro,
      };
    } catch (_) {
      return { greeting: '', introTitle: '오프닝 1', introContent: '' };
    }
  }, []);

  const updateStartSets = useCallback((updater) => {
    setFormData((prev) => {
      const cur = prev?.basic_info?.start_sets;
      const next = (typeof updater === 'function') ? updater(cur) : updater;
      const safeNext = (next && typeof next === 'object') ? next : { selectedId: '', items: [] };
      const m = mirrorLegacyFromStartSets(safeNext);
      const prevIntro = Array.isArray(prev?.basic_info?.introduction_scenes) ? prev.basic_info.introduction_scenes : [];
      const secret0 = String(prevIntro?.[0]?.secret || '').trim();
      const mergedIntro0 = {
        title: m.introTitle,
        content: m.introContent,
        secret: secret0,
      };
      const nextIntroScenes = (() => {
        // 기존에 여러 도입부가 있더라도, 신규 위저드에서는 1개(선택된 세트)만 안정적으로 유지한다.
        // (추가 도입부 지원은 start_sets 기반으로 확장 예정)
        return [mergedIntro0];
      })();
      const nextGreetings = [m.greeting || ''];
      return {
        ...prev,
        basic_info: {
          ...prev.basic_info,
          start_sets: safeNext,
          greetings: nextGreetings,
          greeting: m.greeting || '',
          introduction_scenes: nextIntroScenes,
        },
      };
    });
  }, [mirrorLegacyFromStartSets]);

  // ✅ 설정집 JSON 마이그레이션
  // - 렌더 중 setState 금지(무한루프 방지): useEffect에서 1회만 수행
  const settingBookDidMigrateRef = useRef(false);
  useEffect(() => {
    if (!useNormalCreateWizard) return;
    if (settingBookDidMigrateRef.current) return;
    try {
      const ss = (formData?.basic_info?.start_sets && typeof formData.basic_info.start_sets === 'object')
        ? formData.basic_info.start_sets
        : null;
      const sb = (ss?.setting_book && typeof ss.setting_book === 'object') ? ss.setting_book : null;
      if (!sb) return;

      /**
       * ✅ 최신 요구사항:
       * - 설정집은 "탭 이름"이고, 내부는 "설정메모" 리스트만 존재
       * - 저장: start_sets.setting_book.items = [{ id, detail, triggers, targets }]
       *
       * 하위호환:
       * - 구형1) setting_book.notes (노트 배열)
       * - 구형2) setting_book.items = [{..., notes:[...]}] (설정집(북) → 노트 구조)
       */
      const normalizeMemo = (maybe, fallbackId) => {
        try {
          const m = (maybe && typeof maybe === 'object') ? maybe : {};
          const id = String(m?.id || fallbackId || '').trim() || `memo_${Date.now()}`;
          const detail = String(m?.detail ?? m?.info ?? '');
          const rawTriggers = Array.isArray(m?.triggers)
            ? m.triggers
            : (Array.isArray(m?.keywords) ? m.keywords : ['']);
          const triggers = rawTriggers.map((x) => String(x ?? '')).slice(0, 5);
          const rawTargets = Array.isArray(m?.targets) ? m.targets : ['all'];
          const targets = rawTargets.map((x) => String(x || '').trim()).filter(Boolean);
          return {
            id,
            detail,
            triggers: (triggers.length ? triggers : ['']),
            targets: (targets.length ? targets : ['all']),
          };
        } catch (_) {
          return { id: String(fallbackId || `memo_${Date.now()}`), detail: '', triggers: [''], targets: ['all'] };
        }
      };

      const hasItems = Array.isArray(sb?.items);
      if (hasItems) {
        const items = Array.isArray(sb.items) ? sb.items : [];
        // 구형2: items[*].notes가 있으면 flatten
        const looksLikeBook = items.some((x) => x && typeof x === 'object' && Array.isArray(x.notes));
        if (!looksLikeBook) {
          // 이미 최신 형태로 간주
          settingBookDidMigrateRef.current = true;
          return;
        }
        const memos = [];
        for (const b of items) {
          const notes = (b && typeof b === 'object' && Array.isArray(b.notes)) ? b.notes : [];
          for (const n of notes) memos.push(normalizeMemo(n, String(n?.id || '').trim()));
        }
        const nextItems = memos.length ? memos : [normalizeMemo({}, 'memo_1')];
        settingBookDidMigrateRef.current = true;
        updateStartSets((prev) => {
          const cur = (prev && typeof prev === 'object') ? prev : { selectedId: '', items: [] };
          return {
            ...cur,
            setting_book: {
              selectedId: String(nextItems[0]?.id || 'memo_1'),
              items: nextItems,
            },
          };
        });
        return;
      }

      // 구형1: setting_book.notes
      const legacyNotes = Array.isArray(sb?.notes) ? sb.notes : [];
      const nextItems = (legacyNotes.length ? legacyNotes : [{}]).map((n, idx) => normalizeMemo(n, String(n?.id || '').trim() || `memo_${idx + 1}`));
      settingBookDidMigrateRef.current = true;
      updateStartSets((prev) => {
        const cur = (prev && typeof prev === 'object') ? prev : { selectedId: '', items: [] };
        return {
          ...cur,
          setting_book: {
            selectedId: String(nextItems[0]?.id || 'memo_1'),
            items: nextItems,
          },
        };
      });
    } catch (_) {
      // 실패해도 기능은 작동 가능(빈 설정집으로 시작)
      settingBookDidMigrateRef.current = true;
    }
  }, [formData?.basic_info?.start_sets, updateStartSets, useNormalCreateWizard]);

  const chatPreviewUserCount = useMemo(() => {
    try {
      const list = Array.isArray(chatPreviewMessages) ? chatPreviewMessages : [];
      return list.filter((m) => m?.role === 'user' && String(m?.content || '').trim()).length;
    } catch (_) {
      return 0;
    }
  }, [chatPreviewMessages]);

  const chatPreviewGateReason = useMemo(() => {
    if (!useNormalCreateWizard) return null;
    try {
      const step = String(normalWizardStep || '').trim();
      const nameOk = !!String(formData?.basic_info?.name || '').trim();
      const descOk = !!String(formData?.basic_info?.description || '').trim();
      const audienceOk = (selectedTagSlugs || []).some((s) => REQUIRED_AUDIENCE_SLUGS.includes(s));
      const styleOk = (selectedTagSlugs || []).some((s) => REQUIRED_STYLE_SLUGS.includes(s));
      const promptOk = !!String(formData?.basic_info?.world_setting || '').trim();
      const profileImageOk = (() => {
        /**
         * ✅ 프로필 입력 가드: 대표 이미지 필수(요구사항)
         *
         * 의도/원리:
         * - 프로필 단계에서 대표이미지는 필수이며, 프리뷰 입력 가드 문구로도 명확히 안내한다.
         * - avatar_url이 없더라도, 갤러리 1개 이상이면 대표로 사용할 수 있어 둘 중 하나를 허용한다.
         */
        try {
          const avatar = String(formData?.media_settings?.avatar_url || '').trim();
          if (avatar) return true;
          const imgs = Array.isArray(formData?.media_settings?.image_descriptions)
            ? formData.media_settings.image_descriptions
            : [];
          return imgs.some((img) => !!String(img?.url || '').trim());
        } catch (_) {
          return false;
        }
      })();
      const imageOk = (() => {
        const hasExistingImages = Array.isArray(formData?.media_settings?.image_descriptions)
          && formData.media_settings.image_descriptions.some((img) => String(img?.url || '').trim());
        const hasNewFiles = Array.isArray(formData?.media_settings?.newly_added_files)
          && formData.media_settings.newly_added_files.length > 0;
        const hasBaseAvatar = !!String(formData?.media_settings?.avatar_url || '').trim();
        // ✅ 기본 이미지(대표이미지)를 상황별 이미지 단계에서도 인정
        return hasExistingImages || hasNewFiles || hasBaseAvatar;
      })();
      const turnsOk = (() => {
        try {
          const ss = formData?.basic_info?.start_sets;
          const sim = (ss && typeof ss === 'object' && ss.sim_options && typeof ss.sim_options === 'object')
            ? ss.sim_options
            : null;
          const raw = sim ? Number(sim.max_turns ?? 0) : 0;
          const mt = Number.isFinite(raw) ? Math.floor(raw) : 0;
          return !!mt && mt >= 50;
        } catch (_) {
          return false;
        }
      })();
      const promptTypeOk = (() => {
        try {
          const t = String(formData?.basic_info?.character_type || '').trim();
          return t === 'roleplay' || t === 'simulator' || t === 'custom';
        } catch (_) {
          return false;
        }
      })();
      const firstLineOk = (() => {
        const ss = formData?.basic_info?.start_sets;
        const items = Array.isArray(ss?.items) ? ss.items : [];
        const sel = String(ss?.selectedId || '').trim();
        const picked = items.find((x) => String(x?.id || '').trim() === sel) || items[0] || {};
        return !!String(picked?.firstLine || '').trim();
      })();

      if (step === 'profile') {
        if (!nameOk) return '프로필에서 작품명을 먼저 입력해주세요.';
        if (!audienceOk) return '프로필에서 남성향/여성향/전체 중 하나를 먼저 선택해주세요.';
        if (!descOk) return '프로필에서 한줄소개를 먼저 입력해주세요.';
        if (!profileImageOk) return '프로필에서 대표 이미지를 먼저 등록해주세요.';
        if (!promptTypeOk) return '프로필에서 프롬프트 타입(롤플레잉/시뮬레이션/커스텀)을 먼저 선택해주세요.';
        if (!turnsOk) return '프로필에서 진행 턴수를 50턴 이상으로 선택/입력해주세요.';
      }
      if (step === 'prompt') {
        if (!promptOk) return '프롬프트에서 내용을 먼저 입력해주세요.';
      }
      if (step === 'image') {
        if (!styleOk) return '상황별이미지에서 이미지 스타일을 먼저 선택해주세요.';
        if (!imageOk) return '상황별이미지에서 대표이미지를 최소 1장 추가해주세요.';
      }
      if (step === 'first_start') {
        if (!firstLineOk) return '오프닝에서 “첫대사”를 먼저 입력해주세요.';
      }
      return null;
    } catch (_) {
      return '입력값을 확인한 뒤 다시 시도해주세요.';
    }
  }, [useNormalCreateWizard, normalWizardStep, formData, selectedTagSlugs]);

  const buildPreviewStatInfoText = useCallback(() => {
    /**
     * ✅ 프리뷰: "!스탯" 상태창 텍스트 생성(실채팅 느낌 최소 구현)
     *
     * 의도/원리:
     * - 실채팅(ChatPage)은 room meta(stat_state/stat_defs)를 읽어 상태창을 렌더한다.
     * - 프리뷰는 room/db가 없으므로, start_sets(오프닝 단위)의 stat_settings.stats(base_value)를 사용한다.
     * - 출력 포맷은 ChatPage의 `INFO(스탯)` 텍스트 직렬화와 유사하게 맞춘다.
     */
    try {
      const bi = formData?.basic_info || {};
      const ss = bi?.start_sets;
      const items = Array.isArray(ss?.items) ? ss.items : [];
      const sel = String(ss?.selectedId || '').trim() || String(items?.[0]?.id || '').trim();
      const picked = items.find((x) => String(x?.id || '').trim() === sel) || items[0] || {};
      const st = (picked?.stat_settings && typeof picked.stat_settings === 'object') ? picked.stat_settings : null;
      const stats = Array.isArray(st?.stats) ? st.stats : [];
      const out = ['INFO(스탯)'];
      if (!stats.length) {
        out.push('스탯이 설정되어 있지 않습니다.');
        return out.join('\\n');
      }
      for (const s0 of stats.slice(0, 12)) {
        const label = String(s0?.name || s0?.id || '').trim();
        if (!label) continue;
        const vRaw = (s0?.base_value !== null && s0?.base_value !== undefined) ? Number(s0.base_value) : 0;
        const value = Number.isFinite(vRaw) ? Math.trunc(vRaw) : 0;
        out.push(`${label} : ${value}`);
      }
      return out.join('\\n').trim();
    } catch (_) {
      return 'INFO(스탯)';
    }
  }, [formData]);

  const chatPreviewTurnEvents = useMemo(() => {
    /**
     * ✅ 프리뷰 "턴사건 프리뷰" 버튼용 사건 목록(선택 오프닝 기준)
     *
     * 의도:
     * - turn_events는 start_sets.items[] 단위(오프닝 단위) 데이터다.
     * - 테스트는 "중간 턴 강제 삽입"이 아니라, 1턴에서 '선택한 사건'을 미리보기로 확인한다.
     */
    try {
      const ss = formData?.basic_info?.start_sets;
      const items = Array.isArray(ss?.items) ? ss.items : [];
      const selectedId = String(ss?.selectedId || '').trim() || String(items?.[0]?.id || '').trim();
      const active = items.find((x) => String(x?.id || '').trim() === selectedId) || items[0] || null;
      const evsRaw = Array.isArray(active?.turn_events) ? active.turn_events : [];
      const evs = evsRaw
        .map((ev) => {
          const id = String(ev?.id || '').trim();
          const title = String(ev?.title || '').trim();
          const summary = String(ev?.summary || '').trim();
          const aboutRaw = Number(ev?.about_turn);
          const about = (Number.isFinite(aboutRaw) && aboutRaw > 0) ? Math.floor(aboutRaw) : 0;
          return { id, title, summary, about };
        })
        .filter((x) => x.id || x.title || x.summary || (Number(x.about) > 0));
      return [...evs].sort((a, b) => (Number(a?.about || 0) - Number(b?.about || 0)));
    } catch (_) {
      return [];
    }
  }, [formData]);

  // ⚠️ 중요(운영 안정): 아래 함수들은 다른 useCallback의 dependency로 사용되므로
  // TDZ(초기화 전 참조) 방지를 위해 먼저 선언해야 한다.
  const buildPersonalityWithDetailPrefs = useCallback((rawPersonality, prefs) => {
    /**
     * personality(기존 필드)에 디테일(관심사/좋아하는 것/싫어하는 것)을 섹션으로 병합한다.
     *
     * 의도/원리:
     * - DB/스키마 변경 없이도 LLM 프롬프트에 반영되게 하려면, 기존 프롬프트에 들어가는 필드에 함께 넣어야 한다.
     * - 기존 personality 텍스트에 이미 같은 섹션이 들어있을 수 있으므로, 먼저 제거 후 최신 값을 다시 붙인다(중복 방지).
     */
    try {
      const base = String(rawPersonality || '');
      const cleaned = base
        .replace(/\n?\[관심사\][\s\S]*?(?=\n\[좋아하는 것\]|\n\[싫어하는 것\]|\n*$)/g, '')
        .replace(/\n?\[좋아하는 것\][\s\S]*?(?=\n\[관심사\]|\n\[싫어하는 것\]|\n*$)/g, '')
        .replace(/\n?\[싫어하는 것\][\s\S]*?(?=\n\[관심사\]|\n\[좋아하는 것\]|\n*$)/g, '')
        .trim();

      const interests = Array.isArray(prefs?.interests) ? prefs.interests : [];
      const likes = Array.isArray(prefs?.likes) ? prefs.likes : [];
      const dislikes = Array.isArray(prefs?.dislikes) ? prefs.dislikes : [];

      const blocks = [];
      if (interests.length) blocks.push(`[관심사]\n${interests.join('\n')}`);
      if (likes.length) blocks.push(`[좋아하는 것]\n${likes.join('\n')}`);
      if (dislikes.length) blocks.push(`[싫어하는 것]\n${dislikes.join('\n')}`);

      if (!blocks.length) return cleaned;
      return [cleaned, blocks.join('\n\n')].filter(Boolean).join('\n\n').trim();
    } catch (_) {
      return String(rawPersonality || '').trim();
    }
  }, []);

  const extractDetailPrefsFromPersonality = useCallback((rawPersonality) => {
    try {
      const s = String(rawPersonality || '');
      const pick = (label) => {
        const rx = new RegExp(`\\[${label}\\]\\n([\\s\\S]*?)(?=\\n\\[(관심사|좋아하는 것|싫어하는 것)\\]|\\n*$)`, 'm');
        const m = s.match(rx);
        return (m && m[1]) ? String(m[1]).trim() : '';
      };
      const splitKeywords = (block) => {
        const t = String(block || '').trim();
        if (!t) return [];
        const lines = t
          .replace(/\r/g, '\n')
          .split('\n')
          .map((x) => x.trim())
          .filter(Boolean)
          .map((x) => x.replace(/^[-•\s]+/, '').trim())
          .filter(Boolean);
        const flat = [];
        for (const ln of lines) {
          const parts = ln.split(/[,|/]+/).map((p) => p.trim()).filter(Boolean);
          for (const p of parts) flat.push(p);
        }
        const uniq = [];
        for (const k of flat) {
          if (!uniq.includes(k)) uniq.push(k);
          if (uniq.length >= 20) break;
        }
        return uniq;
      };
      return {
        interests: splitKeywords(pick('관심사')),
        likes: splitKeywords(pick('좋아하는 것')),
        dislikes: splitKeywords(pick('싫어하는 것')),
      };
    } catch (_) {
      return { interests: [], likes: [], dislikes: [] };
    }
  }, []);

  // ⚠️ 중요(운영 안정): 아래 함수들은 다른 useCallback의 dependency로 사용되므로
  // TDZ(초기화 전 참조) 방지를 위해 먼저 선언해야 한다.
  const resetChatPreview = useCallback(() => {
    try { chatPreviewEpochRef.current += 1; } catch (_) {}
    setChatPreviewMessages([]);
    setChatPreviewInput('');
    try { setChatPreviewSuggestedImageById({}); } catch (_) {}
    try { setChatPreviewMagicChoices([]); } catch (_) {}
    try { setChatPreviewMagicLoading(false); } catch (_) {}
    try { setChatPreviewBusy(false); } catch (_) {}
    // ✅ 프리뷰 A안(가짜 스트리밍) 상태도 함께 리셋(상태 누수 방지)
    try {
      chatPreviewUiStreamCancelSeqRef.current += 1;
      if (chatPreviewUiStreamTimerRef.current) clearInterval(chatPreviewUiStreamTimerRef.current);
      chatPreviewUiStreamTimerRef.current = null;
    } catch (_) {}
    try { setChatPreviewUiStream({ id: '', full: '', shown: '' }); } catch (_) {}
    try { chatPreviewUiStreamHydratedRef.current = false; } catch (_) {}
    try { chatPreviewUiStreamPrevLastIdRef.current = ''; } catch (_) {}
    try { chatPreviewUiStreamDoneByIdRef.current = {}; } catch (_) {}
    try { chatPreviewPendingMagicRef.current = null; } catch (_) {}
    // ✅ 선택지 점진 노출 상태 리셋
    try {
      chatPreviewMagicRevealCancelSeqRef.current += 1;
      if (chatPreviewMagicRevealTimerRef.current) clearInterval(chatPreviewMagicRevealTimerRef.current);
      chatPreviewMagicRevealTimerRef.current = null;
    } catch (_) {}
    try { setChatPreviewMagicRevealCount(0); } catch (_) {}
    // ✅ 첫대사 스트리밍 상태 리셋
    try {
      chatPreviewFirstLineCancelSeqRef.current += 1;
      if (chatPreviewFirstLineTimerRef.current) clearInterval(chatPreviewFirstLineTimerRef.current);
      chatPreviewFirstLineTimerRef.current = null;
    } catch (_) {}
    try { setChatPreviewFirstLineUiStream({ id: '', full: '', shown: '' }); } catch (_) {}
    try { chatPreviewFirstLineHydratedRef.current = false; } catch (_) {}
    try { chatPreviewFirstLinePrevFullRef.current = ''; } catch (_) {}
  }, []);

  const refreshChatPreviewSnapshot = useCallback(() => {
    try {
      const bi = formData?.basic_info || {};
      const name = String(bi?.name || '').trim() || '캐릭터';
      const ss = bi?.start_sets;
      const items = Array.isArray(ss?.items) ? ss.items : [];
      const sel = String(ss?.selectedId || '').trim();
      const picked = items.find((x) => String(x?.id || '').trim() === sel) || items[0] || {};
      const intro = String(picked?.intro || '').trim();
      const firstLine = String(picked?.firstLine || '').trim();
      setChatPreviewSnapshot({ name, intro, firstLine });
    } catch (_) {}
  }, [formData]);

  const runTurnEventPreview = useCallback(async (turnEventId) => {
    /**
     * ✅ "턴사건 프리뷰" 실행(요구사항)
     *
     * 원리:
     * - 중간 턴 강제 삽입은 흐름을 깨므로 금지.
     * - 따라서 프리뷰를 리셋하고(=1턴), 선택한 사건을 '1턴 테스트 모드'로만 호출한다.
     */
    if (chatPreviewGateReason) return;
    if (chatPreviewBusy) return;
    const evId = String(turnEventId || '').trim();
    if (!evId) return;

    // ✅ 1턴 테스트를 위해 프리뷰를 초기화(대화 흐름 보호)
    try { setTurnEventPreviewOpen(false); } catch (_) {}
    try { resetChatPreview(); } catch (_) {}
    try { refreshChatPreviewSnapshot(); } catch (_) {}

    const epoch = chatPreviewEpochRef.current;
    const msg = '턴사건 프리뷰';

    // 유저 메시지를 먼저 UI에 넣고(턴 1), 응답을 비동기로 추가한다.
    try { chatPreviewAutoScrollRef.current = true; } catch (_) {}
    setChatPreviewMessages((prev) => {
      const base = Array.isArray(prev) ? prev : [];
      return [...base, { id: `pv-u-${Date.now()}`, role: 'user', content: msg }];
    });
    try { setChatPreviewBusy(true); } catch (_) {}

    try {
      const previewPersonality = sanitizePromptTokens(
        buildPersonalityWithDetailPrefs(formData?.basic_info?.personality || '', detailPrefs)
      );
      const previewCharacterData = {
        basic_info: {
          name: String(formData?.basic_info?.name || ''),
          description: String(formData?.basic_info?.description || ''),
          personality: String(previewPersonality || ''),
          speech_style: String(formData?.basic_info?.speech_style || ''),
          greeting: String(formData?.basic_info?.greeting || ''),
          world_setting: String(formData?.basic_info?.world_setting || ''),
          user_display_description: String(formData?.basic_info?.user_display_description || ''),
          use_custom_description: !!formData?.basic_info?.use_custom_description,
          introduction_scenes: Array.isArray(formData?.basic_info?.introduction_scenes) ? formData.basic_info.introduction_scenes : [],
          start_sets: (formData?.basic_info?.start_sets && typeof formData.basic_info.start_sets === 'object') ? formData.basic_info.start_sets : null,
          character_type: String(formData?.basic_info?.character_type || 'roleplay'),
          base_language: String(formData?.basic_info?.base_language || 'ko'),
          tags: Array.isArray(selectedTagSlugs) ? selectedTagSlugs : [],
        },
        media_settings: {
          avatar_url: String(formData?.media_settings?.avatar_url || ''),
          image_descriptions: Array.isArray(formData?.media_settings?.image_descriptions) ? formData.media_settings.image_descriptions : [],
          voice_settings: formData?.media_settings?.voice_settings || null,
        },
        example_dialogues: {
          dialogues: Array.isArray(formData?.example_dialogues?.dialogues) ? formData.example_dialogues.dialogues : [],
        },
        affinity_system: formData?.affinity_system || null,
        publish_settings: formData?.publish_settings || { is_public: true, custom_module_id: null, use_translation: true },
      };

      const payload = {
        character_data: previewCharacterData,
        user_message: msg,
        history: [],
        response_length_pref: 'short',
        turn_event_preview_mode: true,
        turn_event_id_override: evId,
        turn_no_override: 1,
      };
      const res = await api.post('/chat/preview', payload);
      const assistantText = String(res?.data?.assistant_message || '').trim();
      if (!assistantText) throw new Error('Empty assistant_message');
      if (chatPreviewEpochRef.current !== epoch) return;
      const aiId = `pv-a-${Date.now()}`;
      setChatPreviewMessages((prev) => {
        const base = Array.isArray(prev) ? prev : [];
        return [...base, { id: aiId, role: 'assistant', content: assistantText }];
      });
    } catch (e) {
      if (chatPreviewEpochRef.current !== epoch) return;
      try { console.error('[CreateCharacterPage] turn_event preview failed:', e); } catch (_) {}
      try { dispatchToast('error', '턴사건 프리뷰에 실패했습니다.'); } catch (_) {}
      const fallback = '(턴사건 프리뷰) 실행에 실패했어요. 잠시 후 다시 시도해주세요.';
      const aiId = `pv-a-${Date.now()}`;
      setChatPreviewMessages((prev) => {
        const base = Array.isArray(prev) ? prev : [];
        return [...base, { id: aiId, role: 'assistant', content: fallback }];
      });
    }
    try { setChatPreviewBusy(false); } catch (_) {}
  }, [
    chatPreviewGateReason,
    chatPreviewBusy,
    resetChatPreview,
    refreshChatPreviewSnapshot,
    buildPersonalityWithDetailPrefs,
    formData,
    detailPrefs,
    selectedTagSlugs,
  ]);

  useEffect(() => {
    /**
     * ✅ 프리뷰 리셋 정책(요구사항):
     * - "정보가 수정될 때만" 채팅 프리뷰를 0/10으로 리셋한다.
     * - 오프닝 탭 전환(= start_sets.selectedId 변경)은 '선택' 변경일 뿐, 채팅 내역을 날려서는 안 된다.
     *   (단, 상단에 보이는 intro/firstLine 스냅샷은 선택 오프닝에 맞게 갱신한다)
     *
     * 의도/원리:
     * - 프리뷰 채팅은 "현재 입력 폼 스냅샷"에 종속된 임시 세션이다.
     * - 다만 오프닝 "선택"만 바꾸는 동작은 크리에이터 테스트/비교 UX에서 빈번하므로,
     *   대화 내역은 유지하고 스냅샷만 갱신한다.
     */
    if (!useNormalCreateWizard) return;
    // 1) 항상: 스냅샷(name/intro/firstLine)은 최신 선택 오프닝 기준으로 갱신
    try { refreshChatPreviewSnapshot(); } catch (_) {}

    // 2) 조건부: "정보 수정"일 때만 프리뷰 채팅을 리셋
    // - start_sets.selectedId(오프닝 선택) 변화는 리셋 트리거에서 제외한다.
    try {
      const buildResetSignature = () => {
        const bi = formData?.basic_info || {};
        const ss = bi?.start_sets || {};
        const items = Array.isArray(ss?.items) ? ss.items : [];
        const sb = (ss && typeof ss === 'object' && ss.setting_book && typeof ss.setting_book === 'object') ? ss.setting_book : null;
        const imgDescs = Array.isArray(formData?.media_settings?.image_descriptions) ? formData.media_settings.image_descriptions : [];

        // ✅ 핵심: selectedId는 제외(오프닝 탭 전환 시 리셋 금지)
        const ssSig = {
          items: items.map((it) => ({
            id: String(it?.id || ''),
            title: String(it?.title || ''),
            intro: String(it?.intro || ''),
            firstLine: String(it?.firstLine || ''),
            // turn_events도 "정보"로 취급(수정 시 리셋)
            turn_events: Array.isArray(it?.turn_events)
              ? it.turn_events.map((ev) => ({
                id: String(ev?.id || ''),
                about_turn: Number(ev?.about_turn || 0),
                title: String(ev?.title || ''),
                summary: String(ev?.summary || ''),
                required_narration: String(ev?.required_narration || ''),
                required_dialogue: String(ev?.required_dialogue || ''),
              }))
              : [],
            stat_settings: it?.stat_settings || null,
            ending_settings: it?.ending_settings || null,
          })),
          // ✅ 선택 변경은 리셋 금지: setting_book.selectedId는 제외한다.
          setting_book: sb ? { items: Array.isArray(sb?.items) ? sb.items : [] } : null,
          sim_options: ss?.sim_options || null,
        };

        const sigObj = {
          bi: {
            name: String(bi?.name || ''),
            description: String(bi?.description || ''),
            personality: String(bi?.personality || ''),
            speech_style: String(bi?.speech_style || ''),
            world_setting: String(bi?.world_setting || ''),
            user_display_description: String(bi?.user_display_description || ''),
            use_custom_description: !!bi?.use_custom_description,
            character_type: String(bi?.character_type || ''),
            base_language: String(bi?.base_language || ''),
          },
          tags: Array.isArray(selectedTagSlugs) ? selectedTagSlugs : [],
          detailPrefs: detailPrefs || {},
          media: {
            avatar_url: String(formData?.media_settings?.avatar_url || ''),
            images: imgDescs.map((img) => ({
              url: String(img?.url || ''),
              keywords: Array.isArray(img?.keywords) ? img.keywords.map((k) => String(k || '')) : [],
            })),
          },
          start_sets: ssSig,
        };
        return JSON.stringify(sigObj);
      };

      const prev = String(chatPreviewResetSigRef.current || '');
      const next = buildResetSignature();
      if (!prev) {
        chatPreviewResetSigRef.current = next;
        // 최초 진입에서는 기존 정책 유지(안전): 리셋
        try { resetChatPreview(); } catch (_) {}
        return;
      }
      if (prev !== next) {
        chatPreviewResetSigRef.current = next;
        // ✅ 중요: 프리뷰 채팅 입력(chatPreviewInput) 자체는 "위저드 입력값"이 아니다.
        // - chatPreviewInput을 의존/참조하면, 프리뷰에 타이핑하는 순간 입력이 리셋되는 UX 버그가 발생한다.
        // - 따라서 위저드 폼(formData/태그/디테일) 변경에만 반응해 프리뷰를 리셋한다.
        try { resetChatPreview(); } catch (_) {}
      }
    } catch (_) {
      // 방어: 시그니처 계산 실패 시에는 기존처럼 리셋(일관성 우선)
      try { resetChatPreview(); } catch (_) {}
    }
  }, [useNormalCreateWizard, formData, selectedTagSlugs, detailPrefs, refreshChatPreviewSnapshot, resetChatPreview]);


  const requestChatPreviewMagicChoices = useCallback(async ({ seedHint = '', seedMessageId = '', epoch: epochParam = null } = {}) => {
    /**
     * ✅ 채팅 프리뷰: 요술봉 선택지(3개) 생성
     *
     * 의도/원리:
     * - 프리뷰는 room을 만들지 않으므로, 별도의 preview 전용 API로 선택지를 생성한다.
     * - 생성 결과는 "다음 유저 입력" 후보이므로, 프리뷰 히스토리(history) + 초안(character_data)을 함께 보낸다.
     */
    if (chatPreviewGateReason) return;
    if (chatPreviewUserCount >= 10) return;
    if (!chatPreviewMagicMode) return;
    if (chatPreviewMagicLoading) return;
    // ✅ A안: AI 응답 생성/출력 중에는 선택지 생성 금지(경쟁사 UX: 답변 다 뜬 후 선택지)
    if (chatPreviewBusy) return;
    const streamingActive = Boolean(chatPreviewUiStream?.id && chatPreviewUiStream?.full && chatPreviewUiStream?.shown !== chatPreviewUiStream?.full);
    if (streamingActive) return;

    const epoch = epochParam == null ? chatPreviewEpochRef.current : epochParam;
    try { setChatPreviewMagicLoading(true); } catch (_) {}
    try { setChatPreviewMagicChoices([]); } catch (_) {}

    try {
      const historyTurns = (Array.isArray(chatPreviewMessages) ? chatPreviewMessages : [])
        .filter((m) => (m?.role === 'user' || m?.role === 'assistant') && String(m?.content || '').trim())
        .map((m) => ({ role: m.role, content: String(m.content || '') }));

      const previewPersonality = sanitizePromptTokens(
        buildPersonalityWithDetailPrefs(formData?.basic_info?.personality || '', detailPrefs)
      );

      const previewCharacterData = {
        basic_info: {
          name: String(formData?.basic_info?.name || ''),
          description: String(formData?.basic_info?.description || ''),
          personality: String(previewPersonality || ''),
          speech_style: String(formData?.basic_info?.speech_style || ''),
          greeting: String(formData?.basic_info?.greeting || ''),
          world_setting: String(formData?.basic_info?.world_setting || ''),
          user_display_description: String(formData?.basic_info?.user_display_description || ''),
          use_custom_description: !!formData?.basic_info?.use_custom_description,
          introduction_scenes: Array.isArray(formData?.basic_info?.introduction_scenes) ? formData.basic_info.introduction_scenes : [],
          start_sets: (formData?.basic_info?.start_sets && typeof formData.basic_info.start_sets === 'object') ? formData.basic_info.start_sets : null,
          character_type: String(formData?.basic_info?.character_type || 'roleplay'),
          base_language: String(formData?.basic_info?.base_language || 'ko'),
          // ✅ 프리뷰에서도 태그 영향 반영(실채팅과 동일하게 체감)
          tags: Array.isArray(selectedTagSlugs) ? selectedTagSlugs : [],
        },
        media_settings: {
          avatar_url: String(formData?.media_settings?.avatar_url || ''),
          image_descriptions: Array.isArray(formData?.media_settings?.image_descriptions) ? formData.media_settings.image_descriptions : [],
          voice_settings: formData?.media_settings?.voice_settings || null,
        },
        example_dialogues: {
          dialogues: Array.isArray(formData?.example_dialogues?.dialogues) ? formData.example_dialogues.dialogues : [],
        },
        affinity_system: formData?.affinity_system || null,
        publish_settings: formData?.publish_settings || { is_public: true, custom_module_id: null, use_translation: true },
      };

      const payload = {
        character_data: previewCharacterData,
        history: historyTurns,
        n: 3,
        seed_hint: String(seedHint || '').trim() || undefined,
        seed_message_id: String(seedMessageId || '').trim() || undefined,
        // ✅ 크리에이터 테스트용: 프리뷰 턴 강제 지정(선택지 생성에도 동일 턴 컨텍스트 적용)
        turn_no_override: (() => {
          try {
            const raw = String(chatPreviewTurnOverride || '').trim();
            if (!raw) return null;
            const n = Number(raw);
            if (!Number.isFinite(n)) return null;
            const v = Math.max(1, Math.floor(n));
            return v;
          } catch (_) {
            return null;
          }
        })(),
      };
      const res = await api.post('/chat/preview-magic-choices', payload);
      if (chatPreviewEpochRef.current !== epoch) return;

      const raw = Array.isArray(res?.data?.choices) ? res.data.choices : [];
      const filtered = raw
        .map((c) => ({
          id: String(c?.id || ''),
          label: String(c?.label || ''),
          dialogue: c?.dialogue ? String(c.dialogue) : '',
          narration: c?.narration ? String(c.narration) : '',
        }))
        .filter((c) => c.id && c.label)
        .slice(0, 3);
      setChatPreviewMagicChoices(filtered);
    } catch (e) {
      try { console.error('[CreateCharacterPage] preview magic choices failed:', e); } catch (_) {}
      try { dispatchToast('error', '프리뷰 선택지 생성에 실패했습니다.'); } catch (_) {}
      try { setChatPreviewMagicChoices([]); } catch (_) {}
    } finally {
      try { setChatPreviewMagicLoading(false); } catch (_) {}
    }
  }, [
    chatPreviewGateReason,
    chatPreviewUserCount,
    chatPreviewMagicMode,
    chatPreviewMagicLoading,
    chatPreviewBusy,
    chatPreviewUiStream,
    chatPreviewMessages,
    formData,
    detailPrefs,
    chatPreviewTurnOverride,
    buildPersonalityWithDetailPrefs,
  ]);

  useEffect(() => {
    /**
     * ✅ 채팅 프리뷰: 요술봉 ON → 선택지 자동 생성
     *
     * 의도/원리:
     * - "요술봉을 누르면 선택지가 떠야 한다"는 UX를 프리뷰에서도 동일하게 제공한다.
     * - 프리뷰는 room이 없으므로, preview 전용 API를 호출한다.
     */
    try {
      if (!chatPreviewMagicMode) {
        // ✅ 중요: []는 매번 새 참조라서 무조건 set하면 무한 렌더 루프가 날 수 있다.
        // - 상태가 실제로 "변경"될 때만 reset 한다(배포 안정).
        if (Array.isArray(chatPreviewMagicChoices) && chatPreviewMagicChoices.length > 0) {
          setChatPreviewMagicChoices([]);
        }
        if (chatPreviewMagicLoading) {
          setChatPreviewMagicLoading(false);
        }
        return;
      }
      const hasChoices = Array.isArray(chatPreviewMagicChoices) && chatPreviewMagicChoices.length > 0;
      if (chatPreviewMagicLoading || hasChoices) return;
      if (chatPreviewGateReason) return;
      if (chatPreviewUserCount >= 10) return;
      // ✅ A안: AI 응답 생성/출력 중에는 자동 생성 금지
      if (chatPreviewBusy) return;
      const streamingActive = Boolean(chatPreviewUiStream?.id && chatPreviewUiStream?.full && chatPreviewUiStream?.shown !== chatPreviewUiStream?.full);
      if (streamingActive) return;
      requestChatPreviewMagicChoices({ seedHint: 'toggle_on' });
    } catch (_) {}
  }, [
    chatPreviewMagicMode,
    chatPreviewMagicChoices,
    chatPreviewMagicLoading,
    chatPreviewGateReason,
    chatPreviewUserCount,
    chatPreviewBusy,
    chatPreviewUiStream,
    requestChatPreviewMagicChoices,
  ]);

  // ✅ A안: "AI 출력 완료" 직후에만(프리뷰) 선택지 자동 생성(전송 후)
  useEffect(() => {
    try {
      const pending = chatPreviewPendingMagicRef.current;
      if (!pending) return;
      if (!chatPreviewMagicMode) { chatPreviewPendingMagicRef.current = null; return; }
      if (chatPreviewGateReason) return;
      if (chatPreviewUserCount >= 10) { chatPreviewPendingMagicRef.current = null; return; }
      if (chatPreviewMagicLoading) return;
      if (chatPreviewBusy) return;
      const streamingActive = Boolean(chatPreviewUiStream?.id && chatPreviewUiStream?.full && chatPreviewUiStream?.shown !== chatPreviewUiStream?.full);
      if (streamingActive) return;
      // ✅ epoch 가드: 리셋/입력 변경 후 도착한 pending은 폐기
      if (chatPreviewEpochRef.current !== pending.epoch) { chatPreviewPendingMagicRef.current = null; return; }
      chatPreviewPendingMagicRef.current = null;
      requestChatPreviewMagicChoices({ seedHint: pending.seedHint || 'after_assistant', epoch: pending.epoch });
    } catch (_) {}
  }, [
    chatPreviewMagicMode,
    chatPreviewGateReason,
    chatPreviewUserCount,
    chatPreviewMagicLoading,
    chatPreviewBusy,
    chatPreviewUiStream,
    requestChatPreviewMagicChoices,
  ]);

  const sendChatPreview = useCallback((overrideText = null) => {
    if (chatPreviewGateReason) return;
    // ✅ A안: 응답 생성/출력 중에는 추가 입력을 막는다(상태 경합/중복 요청 방지)
    const streamingActive = Boolean(chatPreviewUiStream?.id && chatPreviewUiStream?.full && chatPreviewUiStream?.shown !== chatPreviewUiStream?.full);
    if (chatPreviewBusy || streamingActive) return;
    // ✅ 방어: onClick 핸들러로 직접 전달되면 event 객체가 들어올 수 있다.
    const safeOverride = (overrideText && typeof overrideText === 'object') ? null : overrideText;
    const msg = String((safeOverride == null ? chatPreviewInput : safeOverride) || '').trim();
    if (!msg) return;
    // ✅ "!스탯" 명령: 프리뷰에서도 실채팅처럼 "상태창 말풍선"을 즉시 출력(턴/카운트 소비 없음)
    // - 오타 허용: "!스탯!", "!스탯??", "!stat", "!status"
    try {
      const firstToken = String(msg.split(/\s+/)[0] || '').trim();
      const tokenNoSpace = firstToken.replace(/\s+/g, '').trim();
      const tokenLower = tokenNoSpace.toLowerCase();
      const isStatCmd =
        tokenNoSpace.startsWith('!스탯') ||
        tokenLower.startsWith('!stat') ||
        tokenLower.startsWith('!status');
      if (isStatCmd) {
        try { setChatPreviewInput(''); } catch (_) {}
        const aiId = `pv-a-${Date.now()}`;
        const txt = buildPreviewStatInfoText();
        setChatPreviewMessages((prev) => {
          const base = Array.isArray(prev) ? prev : [];
          return [...base, { id: aiId, role: 'assistant', content: String(txt || 'INFO(스탯)') }];
        });
        try { chatPreviewAutoScrollRef.current = true; } catch (_) {}
        return;
      }
    } catch (_) {}
    if (chatPreviewUserCount >= 10) return;

    const epoch = chatPreviewEpochRef.current;
    const magicOnAtSend = !!chatPreviewMagicMode;
    // ✅ 실제 반영: 서버 미리보기 엔드포인트로 응답 생성
    // - 실패 시에도 사용자 경험이 깨지지 않도록: 더미 응답 + 에러 토스트/로그(요구사항)
    const historyTurns = (Array.isArray(chatPreviewMessages) ? chatPreviewMessages : [])
      .filter((m) => (m?.role === 'user' || m?.role === 'assistant') && String(m?.content || '').trim())
      .map((m) => ({ role: m.role, content: String(m.content || '') }));

    // CharacterCreateRequest에 맞춰 "불필요/제어 상태"는 제거해서 전송한다.
    const previewPersonality = sanitizePromptTokens(
      buildPersonalityWithDetailPrefs(formData?.basic_info?.personality || '', detailPrefs)
    );

    const previewCharacterData = {
      basic_info: {
        name: String(formData?.basic_info?.name || ''),
        description: String(formData?.basic_info?.description || ''),
        personality: String(previewPersonality || ''),
        speech_style: String(formData?.basic_info?.speech_style || ''),
        greeting: String(formData?.basic_info?.greeting || ''),
        world_setting: String(formData?.basic_info?.world_setting || ''),
        user_display_description: String(formData?.basic_info?.user_display_description || ''),
        use_custom_description: !!formData?.basic_info?.use_custom_description,
        introduction_scenes: Array.isArray(formData?.basic_info?.introduction_scenes) ? formData.basic_info.introduction_scenes : [],
        start_sets: (formData?.basic_info?.start_sets && typeof formData.basic_info.start_sets === 'object') ? formData.basic_info.start_sets : null,
        character_type: String(formData?.basic_info?.character_type || 'roleplay'),
        base_language: String(formData?.basic_info?.base_language || 'ko'),
        // ✅ 프리뷰에서도 태그 영향 반영(실채팅과 동일하게 체감)
        tags: Array.isArray(selectedTagSlugs) ? selectedTagSlugs : [],
      },
      media_settings: {
        avatar_url: String(formData?.media_settings?.avatar_url || ''),
        image_descriptions: Array.isArray(formData?.media_settings?.image_descriptions) ? formData.media_settings.image_descriptions : [],
        voice_settings: formData?.media_settings?.voice_settings || null,
      },
      example_dialogues: {
        dialogues: Array.isArray(formData?.example_dialogues?.dialogues) ? formData.example_dialogues.dialogues : [],
      },
      affinity_system: formData?.affinity_system || null,
      publish_settings: formData?.publish_settings || { is_public: true, custom_module_id: null, use_translation: true },
    };

    // 먼저 사용자 메시지를 UI에 넣고, 응답은 비동기로 교체/추가한다.
    // ✅ 유저가 전송한 순간에는 자연스럽게 바닥 고정이 맞다.
    try { chatPreviewAutoScrollRef.current = true; } catch (_) {}
    setChatPreviewMessages((prev) => {
      const base = Array.isArray(prev) ? prev : [];
      return [...base, { id: `pv-u-${Date.now()}`, role: 'user', content: msg }];
    });
    setChatPreviewInput('');
    try { setChatPreviewMagicChoices([]); } catch (_) {}
    try { setChatPreviewBusy(true); } catch (_) {}

    (async () => {
      try {
        // ✅ 프리뷰 응답(suggested_image_index) 해석용: 전송 시점의 이미지 URL 스냅샷
        const previewImageUrlsAtSend = (() => {
          try {
            const imgs = previewCharacterData?.media_settings?.image_descriptions;
            const arr = Array.isArray(imgs) ? imgs : [];
            return arr.map((x) => String(x?.url || '').trim()).filter(Boolean);
          } catch (_) {
            return [];
          }
        })();

        const payload = {
          character_data: previewCharacterData,
          user_message: msg,
          history: historyTurns,
          response_length_pref: 'short',
          // ✅ 크리에이터 테스트용: 프리뷰 턴 강제 지정(선택)
          turn_no_override: (() => {
            try {
              const raw = String(chatPreviewTurnOverride || '').trim();
              if (!raw) return null;
              const n = Number(raw);
              if (!Number.isFinite(n)) return null;
              const v = Math.max(1, Math.floor(n));
              return v;
            } catch (_) {
              return null;
            }
          })(),
        };
        const res = await api.post('/chat/preview', payload);
        const assistantText = String(res?.data?.assistant_message || '').trim();
        if (!assistantText) throw new Error('Empty assistant_message');
        // ✅ 입력 변경/리셋이 발생했다면, 이전 응답은 UI에 붙이지 않는다.
        if (chatPreviewEpochRef.current !== epoch) return;
        const aiId = `pv-a-${Date.now()}`;
        setChatPreviewMessages((prev) => {
          const base = Array.isArray(prev) ? prev : [];
          return [...base, { id: aiId, role: 'assistant', content: assistantText }];
        });
        // ✅ 키워드 트리거 이미지: 프리뷰에서도 실채팅처럼 말풍선에 노출
        try {
          const idxRaw = Number(res?.data?.suggested_image_index);
          const idx = (Number.isFinite(idxRaw) && idxRaw >= 0) ? Math.floor(idxRaw) : -1;
          const rawUrl = (idx >= 0 && idx < previewImageUrlsAtSend.length) ? previewImageUrlsAtSend[idx] : '';
          const resolved = rawUrl ? resolveImageUrl(rawUrl) : '';
          if (resolved) {
            setChatPreviewSuggestedImageById((prev) => ({ ...(prev || {}), [aiId]: resolved }));
          }
        } catch (_) {}
        // ✅ 요술봉 ON이면, "답변이 다 출력된 뒤" 다음 선택지를 생성한다(A안 동기화)
        if (magicOnAtSend) {
          try { chatPreviewPendingMagicRef.current = { epoch, seedHint: 'after_assistant' }; } catch (_) {}
        }
      } catch (e) {
        if (chatPreviewEpochRef.current !== epoch) return;
        try { console.error('[CreateCharacterPage] chat preview failed:', e); } catch (_) {}
        try { dispatchToast('error', '채팅 미리보기 응답 생성에 실패했습니다.'); } catch (_) {}
        // 폴백: UX가 멈추지 않게 더미 응답
        const fallback = '(미리보기) 응답 생성에 실패했어요. 잠시 후 다시 시도해주세요.';
        const aiId = `pv-a-${Date.now()}`;
        setChatPreviewMessages((prev) => {
          const base = Array.isArray(prev) ? prev : [];
          return [...base, { id: aiId, role: 'assistant', content: fallback }];
        });
      }
      try { setChatPreviewBusy(false); } catch (_) {}
    })();
  }, [
    chatPreviewGateReason,
    chatPreviewInput,
    chatPreviewUserCount,
    chatPreviewMessages,
    chatPreviewMagicMode,
    chatPreviewBusy,
    chatPreviewUiStream,
    formData,
    detailPrefs,
    chatPreviewTurnOverride,
    buildPreviewStatInfoText,
    buildPersonalityWithDetailPrefs,
    requestChatPreviewMagicChoices,
  ]);

  const toggleChatPreviewNarration = useCallback(() => {
    /**
     * 채팅 프리뷰 "나레이션" 토글
     *
     * 원리:
     * - ChatPage와 동일하게 `* ` (별표+공백) 프리픽스를 나레이션으로 취급한다.
     * - 버튼을 누르면 입력창 앞에 `* `를 붙이거나 제거한다.
     */
    try {
      if (chatPreviewGateReason) return;
      if (chatPreviewUserCount >= 10) return;
      setChatPreviewInput((prev) => {
        const raw = String(prev || '');
        const trimmedLeft = raw.replace(/^\s+/, '');
        const isNarr = /^\*\s/.test(trimmedLeft);
        if (isNarr) {
          return trimmedLeft.replace(/^\*\s*/, '');
        }
        return `* ${raw}`.trimEnd();
      });
    } catch (_) {}
  }, [chatPreviewGateReason, chatPreviewUserCount]);

  const toggleChatPreviewMagicMode = useCallback(() => {
    /**
     * ✅ 채팅 프리뷰: 요술봉 토글
     *
     * 의도/원리:
     * - 실제 채팅방에는 요술봉(선택지) UI가 있으므로, 프리뷰에서도 동일한 버튼을 노출한다.
     * - 요구사항: 요술봉을 누르면 선택지가 떠야 한다.
     */
    try {
      if (chatPreviewGateReason) return;
      if (chatPreviewUserCount >= 10) return;
      setChatPreviewMagicMode((prev) => !prev);
    } catch (_) {}
  }, [chatPreviewGateReason, chatPreviewUserCount]);

  const requestTurnEventPreview = useCallback(async (turnEventId) => {
    /**
     * ✅ 크리에이터 테스트(요구사항): "턴사건 프리뷰" 실행(1턴 전용)
     *
     * 의도/원리:
     * - 턴수별 사건을 '중간 턴에 억지 삽입'하면 대화 흐름이 깨진다.
     * - 따라서 프리뷰에서는 사건을 "1턴 테스트 모드"로만 실행해, 사건 지문/대사가 어떤 톤으로 나오는지 확인한다.
     * - 이 요청은 채팅 프리뷰 히스토리(chatPreviewMessages)를 건드리지 않는다(읽기/테스트 전용).
     */
    try {
      if (chatPreviewGateReason) {
        dispatchToast('error', String(chatPreviewGateReason));
        return;
      }
      const evId = String(turnEventId || '').trim();
      if (!evId) {
        dispatchToast('error', '턴사건을 선택해주세요.');
        return;
      }
      setTurnEventPreviewLoading(true);
      setTurnEventPreviewError('');
      setTurnEventPreviewText('');
      setTurnEventPreviewPickedId(evId);

      // sendChatPreview와 동일한 형태로 character_data를 구성(SSOT: formData)
      const previewPersonality = sanitizePromptTokens(
        buildPersonalityWithDetailPrefs(formData?.basic_info?.personality || '', detailPrefs)
      );
      const previewCharacterData = {
        basic_info: {
          name: String(formData?.basic_info?.name || ''),
          description: String(formData?.basic_info?.description || ''),
          personality: String(previewPersonality || ''),
          speech_style: String(formData?.basic_info?.speech_style || ''),
          greeting: String(formData?.basic_info?.greeting || ''),
          world_setting: String(formData?.basic_info?.world_setting || ''),
          user_display_description: String(formData?.basic_info?.user_display_description || ''),
          use_custom_description: !!formData?.basic_info?.use_custom_description,
          introduction_scenes: Array.isArray(formData?.basic_info?.introduction_scenes) ? formData.basic_info.introduction_scenes : [],
          start_sets: (formData?.basic_info?.start_sets && typeof formData.basic_info.start_sets === 'object') ? formData.basic_info.start_sets : null,
          character_type: String(formData?.basic_info?.character_type || 'roleplay'),
          base_language: String(formData?.basic_info?.base_language || 'ko'),
          tags: Array.isArray(selectedTagSlugs) ? selectedTagSlugs : [],
        },
        media_settings: {
          avatar_url: String(formData?.media_settings?.avatar_url || ''),
          image_descriptions: Array.isArray(formData?.media_settings?.image_descriptions) ? formData.media_settings.image_descriptions : [],
          voice_settings: formData?.media_settings?.voice_settings || null,
        },
        example_dialogues: {
          dialogues: Array.isArray(formData?.example_dialogues?.dialogues) ? formData.example_dialogues.dialogues : [],
        },
        affinity_system: formData?.affinity_system || null,
        publish_settings: formData?.publish_settings || { is_public: true, custom_module_id: null, use_translation: true },
      };

      const payload = {
        character_data: previewCharacterData,
        user_message: '턴사건 프리뷰',
        history: [],
        response_length_pref: 'short',
        turn_no_override: 1,
        turn_event_preview_mode: true,
        turn_event_id_override: evId,
      };
      const res = await api.post('/chat/preview', payload);
      const txt = String(res?.data?.assistant_message || '').trim();
      if (!txt) throw new Error('Empty assistant_message');
      setTurnEventPreviewText(txt);
    } catch (e) {
      try { console.error('[CreateCharacterPage] turn event preview failed:', e); } catch (_) {}
      setTurnEventPreviewError('failed');
      dispatchToast('error', '턴사건 프리뷰 실행에 실패했습니다.');
    } finally {
      setTurnEventPreviewLoading(false);
    }
  }, [
    chatPreviewGateReason,
    formData,
    detailPrefs,
    selectedTagSlugs,
    buildPersonalityWithDetailPrefs,
  ]);

  useEffect(() => {
    try {
      const el = chatPreviewListRef.current;
      if (!el) return;
      // ✅ 유저가 바닥 근처일 때만 자동 스크롤
      if (!chatPreviewAutoScrollRef.current) return;
      el.scrollTop = el.scrollHeight;
    } catch (_) {}
  }, [chatPreviewMessages, chatPreviewMagicChoices, chatPreviewMagicLoading, isChatPreviewOpen]);

  // ✅ 프리뷰 A안(가짜 스트리밍): 마지막 assistant 메시지만 점진 출력
  useEffect(() => {
    try {
      if (!useNormalCreateWizard) return;
      if (chatPreviewGateReason) return;
      if (chatPreviewBusy) return;

      const arr = Array.isArray(chatPreviewMessages) ? chatPreviewMessages : [];
      if (!arr.length) return;
      const last = arr[arr.length - 1] || null;
      const lastId = String(last?.id || '').trim();

      const prevLastId = String(chatPreviewUiStreamPrevLastIdRef.current || '').trim();
      chatPreviewUiStreamPrevLastIdRef.current = lastId;
      if (!lastId || lastId === prevLastId) return;

      if (String(last?.role || '').toLowerCase() !== 'assistant') return;
      if (chatPreviewUiStreamDoneByIdRef.current && chatPreviewUiStreamDoneByIdRef.current[lastId]) return;

      const full = String(last?.content || '');
      if (!full.trim()) {
        chatPreviewUiStreamDoneByIdRef.current[lastId] = true;
        return;
      }

      // 기존 스트리밍 취소 + 새 메시지로 시작
      chatPreviewUiStreamCancelSeqRef.current += 1;
      const token = chatPreviewUiStreamCancelSeqRef.current;
      if (chatPreviewUiStreamTimerRef.current) {
        clearInterval(chatPreviewUiStreamTimerRef.current);
        chatPreviewUiStreamTimerRef.current = null;
      }
      setChatPreviewUiStream({ id: lastId, full, shown: '' });

      // 속도(방어적): 길이에 비례, 너무 길면 상한
      const intervalMs = 33;
      const totalMs = Math.max(600, Math.min(2200, Math.round(full.length * 16)));
      const steps = Math.max(1, Math.ceil(totalMs / intervalMs));
      const chunk = Math.max(1, Math.ceil(full.length / steps));
      let idx = 0;
      let tick = 0;

      chatPreviewUiStreamTimerRef.current = setInterval(() => {
        if (chatPreviewUiStreamCancelSeqRef.current !== token) {
          try { clearInterval(chatPreviewUiStreamTimerRef.current); } catch (_) {}
          chatPreviewUiStreamTimerRef.current = null;
          return;
        }
        idx = Math.min(full.length, idx + chunk);
        const nextShown = full.slice(0, idx);
        setChatPreviewUiStream((prev) => {
          if (!prev || String(prev.id || '') !== String(lastId)) return prev;
          return { ...prev, shown: nextShown };
        });

        // 스크롤(가끔): UI 흔들림 최소화
        tick += 1;
        if (tick % 3 === 0 || idx >= full.length) {
          try {
            const el = chatPreviewListRef.current;
            if (chatPreviewAutoScrollRef.current && el) el.scrollTop = el.scrollHeight;
          } catch (_) {}
        }

        if (idx >= full.length) {
          try { clearInterval(chatPreviewUiStreamTimerRef.current); } catch (_) {}
          chatPreviewUiStreamTimerRef.current = null;
          try { chatPreviewUiStreamDoneByIdRef.current[lastId] = true; } catch (_) {}
          // 다음 프레임에 스트리밍 상태 해제(버튼 활성화)
          try {
            window.setTimeout(() => {
              setChatPreviewUiStream((prev) => (prev && String(prev.id || '') === String(lastId)) ? { id: '', full: '', shown: '' } : prev);
            }, 0);
          } catch (_) {
            setChatPreviewUiStream((prev) => (prev && String(prev.id || '') === String(lastId)) ? { id: '', full: '', shown: '' } : prev);
          }
        }
      }, intervalMs);
    } catch (e) {
      try { console.error('[CreateCharacterPage] preview ui streaming failed:', e); } catch (_) {}
      try {
        chatPreviewUiStreamCancelSeqRef.current += 1;
        if (chatPreviewUiStreamTimerRef.current) clearInterval(chatPreviewUiStreamTimerRef.current);
        chatPreviewUiStreamTimerRef.current = null;
      } catch (_) {}
      try { setChatPreviewUiStream({ id: '', full: '', shown: '' }); } catch (_) {}
    }
  }, [
    useNormalCreateWizard,
    chatPreviewGateReason,
    chatPreviewBusy,
    chatPreviewMessages,
  ]);

  // ✅ 프리뷰 스트리밍 타이머 정리(언마운트/모달 닫힘)
  useEffect(() => {
    if (isChatPreviewOpen) return;
    try {
      chatPreviewUiStreamCancelSeqRef.current += 1;
      if (chatPreviewUiStreamTimerRef.current) clearInterval(chatPreviewUiStreamTimerRef.current);
      chatPreviewUiStreamTimerRef.current = null;
    } catch (_) {}
    try { setChatPreviewUiStream({ id: '', full: '', shown: '' }); } catch (_) {}
  }, [isChatPreviewOpen]);

  // ✅ 프리뷰 A안: 첫대사(오프닝) 점진 출력 (오프닝 수정 후 다른 곳 클릭해도 계속 진행)
  useEffect(() => {
    if (!useNormalCreateWizard) return;
    if (chatPreviewGateReason) return;

    const full = String(chatPreviewSnapshot?.firstLine || '').trim();
    if (!full) {
      try {
        chatPreviewFirstLineCancelSeqRef.current += 1;
        if (chatPreviewFirstLineTimerRef.current) clearInterval(chatPreviewFirstLineTimerRef.current);
        chatPreviewFirstLineTimerRef.current = null;
      } catch (_) {}
      try { setChatPreviewFirstLineUiStream({ id: '', full: '', shown: '' }); } catch (_) {}
      try { chatPreviewFirstLinePrevFullRef.current = ''; } catch (_) {}
      return;
    }

    // 최초 1회는 점진 출력하지 않음(과거는 즉시 표시) — 이후 변경부터는 점진 출력
    if (!chatPreviewFirstLineHydratedRef.current) {
      chatPreviewFirstLineHydratedRef.current = true;
      chatPreviewFirstLinePrevFullRef.current = full;
      return;
    }

    const prevFull = String(chatPreviewFirstLinePrevFullRef.current || '');
    if (prevFull === full) return;
    chatPreviewFirstLinePrevFullRef.current = full;

    try {
      chatPreviewFirstLineCancelSeqRef.current += 1;
      const token = chatPreviewFirstLineCancelSeqRef.current;
      if (chatPreviewFirstLineTimerRef.current) {
        clearInterval(chatPreviewFirstLineTimerRef.current);
        chatPreviewFirstLineTimerRef.current = null;
      }

      const id = `pv-fl-${Date.now()}`;
      setChatPreviewFirstLineUiStream({ id, full, shown: '' });

      const intervalMs = 33;
      const totalMs = Math.max(520, Math.min(1800, Math.round(full.length * 14)));
      const steps = Math.max(1, Math.ceil(totalMs / intervalMs));
      const chunk = Math.max(1, Math.ceil(full.length / steps));
      let idx = 0;
      let tick = 0;

      chatPreviewFirstLineTimerRef.current = setInterval(() => {
        if (chatPreviewFirstLineCancelSeqRef.current !== token) {
          try { clearInterval(chatPreviewFirstLineTimerRef.current); } catch (_) {}
          chatPreviewFirstLineTimerRef.current = null;
          return;
        }
        idx = Math.min(full.length, idx + chunk);
        const nextShown = full.slice(0, idx);
        setChatPreviewFirstLineUiStream((prev) => {
          if (!prev || String(prev.id || '') !== String(id)) return prev;
          // full이 바뀌었다면(경합) 즉시 중단
          if (String(prev.full || '') !== String(full)) return prev;
          return { ...prev, shown: nextShown };
        });

        tick += 1;
        if (tick % 3 === 0 || idx >= full.length) {
          try {
            const el = chatPreviewListRef.current;
            if (chatPreviewAutoScrollRef.current && el) el.scrollTop = el.scrollHeight;
          } catch (_) {}
        }

        if (idx >= full.length) {
          try { clearInterval(chatPreviewFirstLineTimerRef.current); } catch (_) {}
          chatPreviewFirstLineTimerRef.current = null;
          try {
            window.setTimeout(() => {
              setChatPreviewFirstLineUiStream((prev) => (prev && String(prev.id || '') === String(id)) ? { id: '', full: '', shown: '' } : prev);
            }, 0);
          } catch (_) {
            setChatPreviewFirstLineUiStream((prev) => (prev && String(prev.id || '') === String(id)) ? { id: '', full: '', shown: '' } : prev);
          }
        }
      }, intervalMs);
    } catch (e) {
      try { console.error('[CreateCharacterPage] preview firstLine streaming failed:', e); } catch (_) {}
      try {
        chatPreviewFirstLineCancelSeqRef.current += 1;
        if (chatPreviewFirstLineTimerRef.current) clearInterval(chatPreviewFirstLineTimerRef.current);
        chatPreviewFirstLineTimerRef.current = null;
      } catch (_) {}
      try { setChatPreviewFirstLineUiStream({ id: '', full: '', shown: '' }); } catch (_) {}
    }
  }, [useNormalCreateWizard, chatPreviewGateReason, chatPreviewSnapshot?.firstLine]);

  // ✅ 프리뷰 A안: 요술봉 선택지 점진 노출(1→2→3)
  useEffect(() => {
    if (!useNormalCreateWizard) return;
    // 로딩 중이거나 선택지가 없으면 초기화
    if (!chatPreviewMagicMode || chatPreviewGateReason || chatPreviewUserCount >= 10) {
      try { setChatPreviewMagicRevealCount(0); } catch (_) {}
      return;
    }
    if (chatPreviewMagicLoading) {
      try { setChatPreviewMagicRevealCount(0); } catch (_) {}
      return;
    }
    const arr = Array.isArray(chatPreviewMagicChoices) ? chatPreviewMagicChoices : [];
    const total = Math.min(3, arr.length);
    if (total <= 0) {
      try { setChatPreviewMagicRevealCount(0); } catch (_) {}
      return;
    }

    try {
      chatPreviewMagicRevealCancelSeqRef.current += 1;
      const token = chatPreviewMagicRevealCancelSeqRef.current;
      if (chatPreviewMagicRevealTimerRef.current) {
        clearInterval(chatPreviewMagicRevealTimerRef.current);
        chatPreviewMagicRevealTimerRef.current = null;
      }
      // 첫 개는 즉시 보여주고, 이후 180ms 간격으로 추가 노출
      setChatPreviewMagicRevealCount(1);
      let shown = 1;
      chatPreviewMagicRevealTimerRef.current = setInterval(() => {
        if (chatPreviewMagicRevealCancelSeqRef.current !== token) {
          try { clearInterval(chatPreviewMagicRevealTimerRef.current); } catch (_) {}
          chatPreviewMagicRevealTimerRef.current = null;
          return;
        }
        shown += 1;
        if (shown >= total) {
          setChatPreviewMagicRevealCount(total);
          try { clearInterval(chatPreviewMagicRevealTimerRef.current); } catch (_) {}
          chatPreviewMagicRevealTimerRef.current = null;
          return;
        }
        setChatPreviewMagicRevealCount(shown);
      }, 180);
    } catch (e) {
      try { console.error('[CreateCharacterPage] preview magic reveal failed:', e); } catch (_) {}
      try { setChatPreviewMagicRevealCount(total); } catch (_) {}
    }
  }, [
    useNormalCreateWizard,
    chatPreviewMagicMode,
    chatPreviewGateReason,
    chatPreviewUserCount,
    chatPreviewMagicLoading,
    chatPreviewMagicChoices,
  ]);

  // ✅ 디테일 입력값 초기화(편집/자동생성 결과가 personality에 포함된 경우 1회 파싱)
  useEffect(() => {
    if (detailPrefsInitRef.current) return;
    try {
      const parsed = extractDetailPrefsFromPersonality(formData?.basic_info?.personality || '');
      const hasAny = (Array.isArray(parsed?.interests) && parsed.interests.length)
        || (Array.isArray(parsed?.likes) && parsed.likes.length)
        || (Array.isArray(parsed?.dislikes) && parsed.dislikes.length);
      if (!hasAny) return;
      setDetailPrefs(parsed);
      detailPrefsInitRef.current = true;
    } catch (_) {}
  }, [formData?.basic_info?.personality, extractDetailPrefsFromPersonality]);

  const [quickDetailGenLoading, setQuickDetailGenLoading] = useState(false);
  // ✅ 디테일 자동생성 취소용 ref
  const quickDetailGenAbortRef = useRef(false);
  const detailAutoGenPrevRef = useRef({ personality: '', speech_style: '', prefs: null });
  const [quickSecretGenLoading, setQuickSecretGenLoading] = useState(false);
  const [quickEndingEpilogueGenLoadingId, setQuickEndingEpilogueGenLoadingId] = useState('');
  const [quickEndingBulkGenLoading, setQuickEndingBulkGenLoading] = useState(false);
  // ✅ 엔딩 2개 자동생성 취소용 ref
  const quickEndingBulkGenAbortRef = useRef(false);
  const endingsAutoGenPrevRef = useRef([]);

  const inferAutoGenModeFromCharacterTypeAndWorld = useCallback((characterTypeRaw, worldSettingRaw) => {
    /**
     * ✅ 커스텀 프롬프트 지원(요구사항):
     * - character_type이 'custom'이면, 프롬프트(world_setting) 내용을 근거로 'roleplay' vs 'simulator'를 추정해
     *   자동생성(오프닝/사건/엔딩/디테일) 결과가 프롬프트 의도와 어긋나지 않게 한다.
     *
     * 제약(SSOT):
     * - 백엔드 quick-* 스키마는 mode='roleplay'|'simulator'만 받는다.
     * - 따라서 이 함수도 그 둘만 반환한다.
     */
    const t = String(characterTypeRaw || '').trim().toLowerCase();
    if (t === 'simulator' || t === 'simulation') return 'simulator';
    if (t === 'roleplay') return 'roleplay';

    // custom(또는 알 수 없음) → 프롬프트 텍스트 기반 추정(가벼운 휴리스틱, KISS)
    const w = String(worldSettingRaw || '');
    const wl = w.toLowerCase();
    const looksLikeSimulator =
      wl.includes('simulator')
      || /시뮬/.test(w)
      || /턴\s*수|max_turns|max turns|목표|미션|페널티|선택지|분기|엔딩|상태창|스탯/.test(w);
    return looksLikeSimulator ? 'simulator' : 'roleplay';
  }, []);

  const handleAutoGenerateDetail = useCallback(async (opts) => {
    /**
     * 디테일 자동 생성(요구사항):
     * - 프롬프트(world_setting)가 필수
     * - 관심사/좋아하는 것/싫어하는 것: 키워드 3개씩(칩)
     * - 성격/말투도 함께 채움
     */
    if (quickDetailGenLoading) return;
    try {
      const forceOverwrite = opts?.forceOverwrite === true;
      const name = String(formData?.basic_info?.name || '').trim();
      const desc = String(formData?.basic_info?.description || '').trim();
      const world = String(formData?.basic_info?.world_setting || '').trim();
      const promptType = String(formData?.basic_info?.character_type || 'roleplay').trim();
      const mode = inferAutoGenModeFromCharacterTypeAndWorld(promptType, world);
      if (!world) {
        dispatchToast('error', '프롬프트를 먼저 작성해주세요.');
        return;
      }
      if (!name || !desc) {
        dispatchToast('error', '프로필 정보를 먼저 입력해주세요.');
        return;
      }

      // ✅ 덮어쓰기 허용(요구사항): 기존 입력이 있으면 경고 모달 후 진행
      const hasAny = (v) => { try { return !!String(v ?? '').trim(); } catch (_) { return false; } };
      const hasPrefs =
        (Array.isArray(detailPrefs?.interests) && detailPrefs.interests.some((x) => hasAny(x)))
        || (Array.isArray(detailPrefs?.likes) && detailPrefs.likes.some((x) => hasAny(x)))
        || (Array.isArray(detailPrefs?.dislikes) && detailPrefs.dislikes.some((x) => hasAny(x)));
      const hasExisting =
        hasAny(formData?.basic_info?.personality)
        || hasAny(formData?.basic_info?.speech_style)
        || hasPrefs;
      if (hasExisting && !forceOverwrite) {
        openAutoGenOverwriteConfirm(
          '디테일(성격/말투/칩)',
          async () => { await handleAutoGenerateDetail({ forceOverwrite: true }); }
        );
        return;
      }

      // ✅ 원문 저장 (취소 시 복구용)
      detailAutoGenPrevRef.current = {
        personality: String(formData?.basic_info?.personality || ''),
        speech_style: String(formData?.basic_info?.speech_style || ''),
        prefs: detailPrefs ? { ...detailPrefs } : null,
      };
      quickDetailGenAbortRef.current = false;

      setQuickDetailGenLoading(true);
      // ✅ 요구사항: "위저드만" 제미니 고정(다른 화면/로직에는 영향 주지 않음)
      const aiModel = useNormalCreateWizard
        ? 'gemini'
        : (String(user?.preferred_model || 'claude').trim().toLowerCase() || 'claude');
      const res = await charactersAPI.quickGenerateDetailDraft({
        name,
        description: desc,
        world_setting: world,
        // ✅ 타입/토글 기반 모드: 자동생성 결과가 입력 의미(룰/트리거)와 일치해야 한다.
        mode,
        section_modes: {
          personality: getEffectiveDetailMode('personality'),
          speech_style: getEffectiveDetailMode('speech_style'),
          interests: getEffectiveDetailMode('interests'),
          likes: getEffectiveDetailMode('likes'),
          dislikes: getEffectiveDetailMode('dislikes'),
        },
        tags: Array.isArray(selectedTagSlugs) ? selectedTagSlugs : [],
        ai_model: (aiModel === 'gpt' ? 'gpt' : (aiModel === 'gemini' ? 'gemini' : 'claude')),
      });

      // ✅ 취소됐으면 결과 반영 안 함
      if (quickDetailGenAbortRef.current) return;

      const d = res?.data || {};
      const nextPersonality = String(d?.personality || '').trim();
      const nextSpeech = String(d?.speech_style || '').trim();
      const interests = Array.isArray(d?.interests) ? d.interests : [];
      const likes = Array.isArray(d?.likes) ? d.likes : [];
      const dislikes = Array.isArray(d?.dislikes) ? d.dislikes : [];
      // ✅ 예시대화(옵션): 백엔드가 내려주는 경우에만 적용(없으면 기존 입력 유지)
      const nextExampleDialogues = (() => {
        try {
          const rawList = Array.isArray(d?.example_dialogues)
            ? d.example_dialogues
            : (Array.isArray(d?.example_dialogues?.dialogues) ? d.example_dialogues.dialogues : []);
          const mapped = rawList
            .map((x, idx) => ({
              user_message: String(x?.user_message || '').slice(0, 500),
              character_response: String(x?.character_response || '').slice(0, 1000),
              order_index: Number.isFinite(Number(x?.order_index)) ? Number(x.order_index) : idx,
            }))
            .filter((x) => String(x.user_message || '').trim() && String(x.character_response || '').trim());
          return mapped;
        } catch (_) {
          return [];
        }
      })();
      if (!nextPersonality || !nextSpeech || interests.length < 3 || likes.length < 3 || dislikes.length < 3) {
        dispatchToast('error', '디테일 생성 결과가 비정상입니다. 잠시 후 다시 시도해주세요.');
        return;
      }

      setFormData((prev) => ({
        ...prev,
        basic_info: {
          ...prev.basic_info,
          personality: nextPersonality.slice(0, 300),
          speech_style: nextSpeech.slice(0, 300),
        },
        ...(nextExampleDialogues.length
          ? { example_dialogues: { ...(prev.example_dialogues || {}), dialogues: nextExampleDialogues } }
          : {}),
      }));
      setDetailPrefs({
        interests: interests.slice(0, 3).map((x) => String(x || '').trim()).filter(Boolean),
        likes: likes.slice(0, 3).map((x) => String(x || '').trim()).filter(Boolean),
        dislikes: dislikes.slice(0, 3).map((x) => String(x || '').trim()).filter(Boolean),
      });
      setDetailChipInputs({ interests: '', likes: '', dislikes: '' });

      dispatchToast('success', '디테일이 자동 생성되었습니다. 내용을 확인해주세요.');
    } catch (e) {
      console.error('[CreateCharacterPage] quick-generate-detail failed:', e);
      dispatchToast('error', '디테일 자동 생성에 실패했습니다. 잠시 후 다시 시도해주세요.');
    } finally {
      setQuickDetailGenLoading(false);
    }
  }, [quickDetailGenLoading, formData, selectedTagSlugs, user, getEffectiveDetailMode, detailPrefs, openAutoGenOverwriteConfirm, inferAutoGenModeFromCharacterTypeAndWorld]);

  // ✅ 디테일 자동생성 취소 핸들러
  const handleCancelDetailGeneration = useCallback(() => {
    try {
      quickDetailGenAbortRef.current = true;
      setQuickDetailGenLoading(false);
      
      // ✅ 취소 시 원문 복구 (원문이 있든 없든)
      const prev = detailAutoGenPrevRef.current || {};
      const prevPersonality = String(prev.personality || '');
      const prevSpeechStyle = String(prev.speech_style || '');
      const prevPrefs = prev.prefs;
      
      setFormData((fd) => ({
        ...fd,
        basic_info: {
          ...fd.basic_info,
          personality: prevPersonality.slice(0, 300),
          speech_style: prevSpeechStyle.slice(0, 300),
        },
      }));
      
      if (prevPrefs) {
        setDetailPrefs(prevPrefs);
      }
      
      // ✅ 취소 시 프리뷰 채팅방 리셋
      try { resetChatPreview(); } catch (_) {}
      
      dispatchToast('info', '디테일 자동 생성이 취소되었습니다.');
    } catch (e) {
      try { console.error('[CreateCharacterPage] cancel detail generation failed:', e); } catch (_) {}
    }
  }, [dispatchToast, resetChatPreview]);

  const handleAutoGenerateSecretInfo = useCallback(async (opts) => {
    /**
     * ✅ 비밀정보 자동 생성(요구사항):
     * - 프롬프트(world_setting)가 작성되어 있어야 실행한다.
     * - 생성 결과는 '비밀정보(secret)' 입력칸에 반영한다.
     */
    if (quickSecretGenLoading) return;
    try {
      const forceOverwrite = opts?.forceOverwrite === true;
      const name = String(formData?.basic_info?.name || '').trim();
      const desc = String(formData?.basic_info?.description || '').trim();
      const world = String(formData?.basic_info?.world_setting || '').trim();
      if (!world) {
        dispatchToast('error', '프롬프트를 먼저 작성해주세요.');
        return;
      }
      if (!name || !desc) {
        dispatchToast('error', '프로필 정보를 먼저 입력해주세요.');
        return;
      }

      // ✅ 덮어쓰기 허용(요구사항): 기존 비밀정보가 있으면 경고 모달 후 진행
      const scenes = Array.isArray(formData?.basic_info?.introduction_scenes)
        ? formData.basic_info.introduction_scenes
        : [];
      const existingSecret = scenes.some((s) => {
        try { return !!String(s?.secret || '').trim(); } catch (_) { return false; }
      });
      if (existingSecret && !forceOverwrite) {
        openAutoGenOverwriteConfirm(
          '비밀정보',
          async () => { await handleAutoGenerateSecretInfo({ forceOverwrite: true }); }
        );
        return;
      }

      setQuickSecretGenLoading(true);
      // ✅ 요구사항: "위저드만" 제미니 고정(다른 화면/로직에는 영향 주지 않음)
      const aiModel = useNormalCreateWizard
        ? 'gemini'
        : (String(user?.preferred_model || 'claude').trim().toLowerCase() || 'claude');
      const res = await charactersAPI.quickGenerateSecretDraft({
        name,
        description: desc,
        world_setting: world,
        tags: Array.isArray(selectedTagSlugs) ? selectedTagSlugs : [],
        ai_model: (aiModel === 'gpt' ? 'gpt' : (aiModel === 'gemini' ? 'gemini' : 'claude')),
      });
      const secret = String(res?.data?.secret || '').trim();
      if (!secret) {
        dispatchToast('error', '비밀정보 생성 결과가 비어있습니다. 잠시 후 다시 시도해주세요.');
        return;
      }

      // ✅ 비밀정보는 introduction_scenes[].secret을 SSOT로 유지한다(기존 구조 호환)
      // - 주의: updateCharacterSecretInfo는 파일 아래에서 선언되므로(TDZ), 여기서는 로직을 인라인으로 적용한다.
      const nextValue = secret.slice(0, 1000);
      setFormData((prev) => {
        const scenes = Array.isArray(prev?.basic_info?.introduction_scenes)
          ? prev.basic_info.introduction_scenes
          : [];
        const base = scenes.length ? scenes : [{ title: '도입부 1', content: '', secret: '' }];
        const merged = base.map((s) => ({ ...(s || {}), secret: nextValue }));
        return {
          ...prev,
          basic_info: {
            ...prev.basic_info,
            introduction_scenes: merged,
          },
        };
      });
      try { setIsSecretInfoEnabled(true); } catch (_) {}
      dispatchToast('success', '비밀정보가 자동 생성되었습니다. 내용을 확인해주세요.');
    } catch (e) {
      console.error('[CreateCharacterPage] quick-generate-secret failed:', e);
      dispatchToast('error', '비밀정보 자동 생성에 실패했습니다. 잠시 후 다시 시도해주세요.');
    } finally {
      setQuickSecretGenLoading(false);
    }
  }, [quickSecretGenLoading, formData, selectedTagSlugs, user, openAutoGenOverwriteConfirm]);

  // ✅ 위저드: start_sets 선택값 방어 보정(훅은 컴포넌트 최상위에서만 사용)
  useEffect(() => {
    if (!useNormalCreateWizard) return;
    try {
      const ss = formData?.basic_info?.start_sets;
      if (!ss || typeof ss !== 'object') return;
      const items = Array.isArray(ss.items) ? ss.items : [];
      if (!items.length) return;
      const selectedId = String(ss.selectedId || '').trim();
      const firstId = String(items[0]?.id || '').trim();
      if (!firstId) return;
      const selectedExists = selectedId && items.some((x) => String(x?.id || '').trim() === selectedId);
      if (selectedExists) return;
      setFormData((prev) => ({
        ...prev,
        basic_info: {
          ...prev.basic_info,
          start_sets: { ...(prev.basic_info.start_sets || {}), selectedId: firstId },
        },
      }));
    } catch (_) {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [useNormalCreateWizard, formData?.basic_info?.start_sets]);

  const validateForm = useCallback(() => {
    const result = validationSchema.safeParse(formData);
    const map = {};

    // 1) 기본(Zod) 검증 결과 반영
    if (!result.success) {
      const issues = result.error.issues || [];
      for (const issue of issues) {
        const key = issue.path.join('.');
        if (!map[key]) map[key] = issue.message;
      }
    }

    // 2) ✅ 필수 선택(메타) 검증 - 생성/편집 모두 강제(요구사항)
    // - 단, 원작챗 캐릭터는 이 페이지에서 해당 UI를 숨기므로 강제하지 않는다.
    try {
      if (!isOrigChatCharacter) {
        const audience = (selectedTagSlugs || []).find((s) => REQUIRED_AUDIENCE_SLUGS.includes(s)) || null;
        const style = (selectedTagSlugs || []).find((s) => REQUIRED_STYLE_SLUGS.includes(s)) || null;
        if (!audience) {
          map['basic_info.audience_pref'] = '남성향/여성향/전체 중 하나를 선택하세요.';
        }
        if (!style) {
          map['basic_info.visual_style'] = '애니풍/실사풍/반실사/아트웤(디자인) 중 하나를 선택하세요.';
        }
      }
    } catch (_) {}

    // 2.3) ✅ QuickMeet(30초)와 일관: 장르/유형/소재(훅) 필수 선택(위저드 생성에서만 강제)
    // - 프로필 자동생성/프롬프트/오프닝 품질과 흐름이 여기에서 결정되므로, 비어있으면 다음 단계가 꼬인다.
    try {
      if (!isEditMode && useNormalCreateWizard && !isOrigChatCharacter) {
        const slugs = Array.isArray(selectedTagSlugs) ? selectedTagSlugs : [];
        const hasGenre = slugs.some((s) => (Array.isArray(QUICK_MEET_GENRE_CHIPS) ? QUICK_MEET_GENRE_CHIPS : []).includes(s));
        const hasType = slugs.some((s) => (Array.isArray(QUICK_MEET_TYPE_CHIPS) ? QUICK_MEET_TYPE_CHIPS : []).includes(s));
        const hasHook = slugs.some((s) => {
          const pool = [
            ...(Array.isArray(QUICK_MEET_HOOK_CHIPS) ? QUICK_MEET_HOOK_CHIPS : []),
            ...(Array.isArray(QUICK_MEET_HOOK_CHIPS_SIMULATOR) ? QUICK_MEET_HOOK_CHIPS_SIMULATOR : []),
          ];
          return pool.includes(s);
        });
        if (!hasGenre) map['tags.quickmeet.genre'] = '장르를 1개 이상 선택해주세요.';
        if (!hasType) map['tags.quickmeet.type'] = '캐릭터 유형을 1개 선택해주세요.';
        if (!hasHook) map['tags.quickmeet.hook'] = '소재를 1개 선택해주세요.';
      }
    } catch (_) {}

    // 2.5) ✅ 진행 턴수(필수) 검증 - start_sets.sim_options.max_turns
    try {
      if (!isEditMode) {
        const ss = formData?.basic_info?.start_sets;
        const sim = (ss && typeof ss === 'object' && ss.sim_options && typeof ss.sim_options === 'object') ? ss.sim_options : null;
        const raw = sim ? Number(sim.max_turns ?? 0) : 0;
        const mt = Number.isFinite(raw) ? Math.floor(raw) : 0;
        if (!mt || mt < 50) {
          map['basic_info.sim_options.max_turns'] = '진행 턴수를 50턴 이상으로 선택/입력해주세요.';
        }
      }
    } catch (_) {}

    // 2.6) ✅ 프롬프트 타입(필수) 검증 - basic_info.character_type
    // - UI에서 버튼을 통해 선택되지만, 비정상 값(빈 문자열/알 수 없는 값) 유입 시 이후 단계가 꼬이므로 여기서 방어한다.
    try {
      if (!isEditMode) {
        const t = String(formData?.basic_info?.character_type || '').trim();
        const ok = (t === 'roleplay' || t === 'simulator' || t === 'custom');
        if (!ok) {
          map['basic_info.character_type'] = '프롬프트 타입(롤플레잉/시뮬레이션/커스텀) 중 하나를 선택해주세요.';
        }
      }
    } catch (_) {}

    // 3) ✅ 생성(Create) 필수 입력 검증(요구사항)
    // 필수: 이미지/캐릭터이름/필수태그/캐릭터설명/세계관설정
    // - 편집(Edit)에서는 기존 데이터가 깨지지 않도록 강제하지 않는다(최소 수정/안전).
    try {
      if (!isEditMode) {
        const hasExistingImages = Array.isArray(formData?.media_settings?.image_descriptions)
          && formData.media_settings.image_descriptions.some((img) => String(img?.url || '').trim());
        const hasNewFiles = Array.isArray(formData?.media_settings?.newly_added_files)
          && formData.media_settings.newly_added_files.length > 0;
        const hasBaseAvatar = !!String(formData?.media_settings?.avatar_url || '').trim();
        // ✅ 기본 이미지(대표이미지)를 "캐릭터 이미지 최소 1장" 조건으로 인정
        if (!hasExistingImages && !hasNewFiles && !hasBaseAvatar) {
          map['media_settings.image_descriptions'] = '캐릭터 이미지를 최소 1장 추가하세요.';
        }

        // ✅ 위저드(일반 생성)에서는 "한줄소개" 아래에 별도 경고를 이미 렌더링한다.
        // 중복 경고(두 줄)가 뜨지 않도록, 이 공통 검증 메시지는 위저드에서는 생략한다.
        if (!useNormalCreateWizard && !String(formData?.basic_info?.description || '').trim()) {
          map['basic_info.description'] = '캐릭터 설명을 입력하세요.';
        }
        if (!String(formData?.basic_info?.world_setting || '').trim()) {
          map['basic_info.world_setting'] = '세계관 설정을 입력하세요.';
        }
      }
    } catch (_) {}

    const ok = Object.keys(map).length === 0;
    setFieldErrors(map);
    if (ok) return { success: true, data: result.success ? result.data : formData };
    return { success: false, errors: map };
  }, [formData, validationSchema, isEditMode, selectedTagSlugs, isOrigChatCharacter, useNormalCreateWizard]);

  // 입력 디바운스 검증
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        const result = validateForm();
        // ✅ 검증 통과 시 상단 에러 메시지 초기화 (유저 경험)
        // - 저장 실패 후 입력을 수정해 조건을 충족하면 에러 메시지를 숨긴다.
        if (result?.success) setError('');
      } catch (_) {}
    }, 300);
    return () => clearTimeout(t);
  }, [formData, validateForm]);

  /**
   * ✅ 메타 태그 토글(레퍼런스 카드 선택)
   *
   * 의도/동작:
   * - 같은 그룹에서는 1개만 선택되도록(상호배타) 처리
   * - 같은 항목을 다시 클릭하면 해제(불 꺼짐)
   */
  const toggleExclusiveTag = useCallback((slug, groupSlugs) => {
    setSelectedTagSlugs((prev) => {
      const arr = Array.isArray(prev) ? prev : [];
      const has = arr.includes(slug);
      const cleaned = arr.filter((s) => !groupSlugs.includes(s));
      return has ? cleaned : [...cleaned, slug];
    });
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const res = await tagsAPI.getTags();
        setAllTags(res.data || []);
      } catch (_) {}
    })();
  }, []);

  /**
   * ✅ 로컬 초안(localStorage) 정책
   *
   * 문제/원인:
   * - 기존 구현은 사용자가 '임시저장'을 누르지 않아도 formData가 자동으로 localStorage에 저장되었고,
   *   재진입 시 해당 값이 그대로 복원되면서 "임시저장 안 눌렀는데도 내용/이미지가 남는" 현상이 발생했다.
   *
   * 해결/의도:
   * - 사용자가 '임시저장'을 **명시적으로 누른 경우에만** 초안을 저장/복원한다.
   * - File 객체(`newly_added_files`)는 JSON 직렬화 불가/의미가 없어 저장 대상에서 제외한다(복원 시 크래시 방지).
   */
  useEffect(() => {
    const key = `cc_draft_${isEditMode ? characterId : 'new'}`;
    const manualKey = `${key}_manual`; // '임시저장' 버튼을 눌렀는지 여부(복원/자동저장 ON 기준)

    // 초기 로드 시 기존 초안 복원(임시저장된 경우에만)
    if (!isEditMode && !draftRestored) {
      try {
        const isManual = localStorage.getItem(manualKey) === '1';
        if (isManual) {
          const raw = localStorage.getItem(key);
          if (raw) {
            const draft = JSON.parse(raw) || {};
            // ✅ 요구사항: '성향(남/여/전체)'은 selectedTagSlugs로 관리됨
            // - 기존 임시저장은 formData만 저장해서 성향/스타일 태그가 복원되지 않았다.
            try {
              const nextSelectedTagSlugs = Array.isArray(draft?.selectedTagSlugs) ? draft.selectedTagSlugs : null;
              if (nextSelectedTagSlugs) setSelectedTagSlugs(nextSelectedTagSlugs);
            } catch (_) {}
            // ✅ 디테일 모드 토글(억지 전환)도 초안에 포함(요구사항)
            try {
              const m = draft?.detailModeOverrides;
              if (m && typeof m === 'object') {
                setDetailModeOverrides((prev) => ({
                  ...(prev || {}),
                  ...(m || {}),
                }));
              }
            } catch (_) {}
            setFormData((prev) => ({
              ...prev,
              ...draft,
              basic_info: { ...prev.basic_info, ...(draft.basic_info || {}) },
              media_settings: {
                ...prev.media_settings,
                ...(draft.media_settings || {}),
                newly_added_files: [], // File은 복원 불가 → 안전하게 비움
              },
              example_dialogues: { ...prev.example_dialogues, ...(draft.example_dialogues || {}) },
              affinity_system: { ...prev.affinity_system, ...(draft.affinity_system || {}) },
              publish_settings: { ...prev.publish_settings, ...(draft.publish_settings || {}) },
            }));
          }
          setIsDraftEnabled(true);
        }
      } catch (_) {}
      // 방어: 초안이 없거나(혹은 복원을 하지 않더라도) 반복 restore 체크를 막는다.
      setDraftRestored(true);
    }

    // ✅ '임시저장'을 눌렀을 때만 로컬 초안을 자동저장(디바운스)
    if (!isDraftEnabled) return;

    const t = setTimeout(() => {
      try {
        setIsAutoSaving(true);
        const draftPayload = {
          ...formData,
          // ✅ 성향/스타일 등 "필수 태그"는 formData가 아닌 selectedTagSlugs에 있음 → 같이 저장
          selectedTagSlugs: Array.isArray(selectedTagSlugs) ? selectedTagSlugs : [],
          // ✅ 디테일 모드 토글(억지 전환) 상태도 같이 저장(복원 UX)
          detailModeOverrides: (detailModeOverrides && typeof detailModeOverrides === 'object') ? detailModeOverrides : {},
          media_settings: {
            ...(formData?.media_settings || {}),
            newly_added_files: [], // File은 직렬화 불가/의미 없음 → 저장하지 않음
          },
        };
        localStorage.setItem(key, JSON.stringify(draftPayload));
        setLastSavedAt(Date.now());
        setHasUnsavedChanges(false);
      } catch (_) {}
      setIsAutoSaving(false);
    }, 1500);
    return () => clearTimeout(t);
  }, [formData, selectedTagSlugs, detailModeOverrides, isEditMode, characterId, draftRestored, isDraftEnabled]);

  useEffect(() => {
    /**
     * ✅ 신규 캐릭터 생성: 성향/이미지스타일 기본값(남성향/애니풍) 자동 선택
     *
     * 의도/원리:
     * - 성향/스타일은 필수값이므로, 최초 진입에서 빈 값이면 UX가 불리하다.
     * - 단, 초안 복원/사용자 입력이 조금이라도 있으면 절대 덮어쓰지 않는다(노-오버라이트).
     */
    try {
      if (isEditMode) return;
      if (!useNormalCreateWizard) return;
      if (isOrigChatCharacter) return;
      if (!draftRestored) return;

      const slugs = Array.isArray(selectedTagSlugs) ? selectedTagSlugs : [];
      const hasAudience = slugs.some((s) => REQUIRED_AUDIENCE_SLUGS.includes(s));
      const hasStyle = slugs.some((s) => REQUIRED_STYLE_SLUGS.includes(s));
      if (hasAudience && hasStyle) return;

      const defaultAudienceSlug = String(REQUIRED_AUDIENCE_CHOICES?.[0]?.slug || '남성향').trim() || '남성향';
      const defaultStyleSlug = String(REQUIRED_STYLE_CHOICES?.[0]?.slug || '애니풍').trim() || '애니풍';

      setSelectedTagSlugs((prev) => {
        const arr = Array.isArray(prev) ? prev : [];
        const next = [...arr];
        const prevHasAudience = next.some((s) => REQUIRED_AUDIENCE_SLUGS.includes(s));
        const prevHasStyle = next.some((s) => REQUIRED_STYLE_SLUGS.includes(s));
        if (!prevHasAudience) {
          // 기존 그룹 선택값이 없을 때만 기본값을 추가한다.
          next.push(defaultAudienceSlug);
        }
        if (!prevHasStyle) {
          next.push(defaultStyleSlug);
        }
        // 중복 제거 + 빈값 제거
        return Array.from(new Set(next)).filter(Boolean);
      });
    } catch (e) {
      // 사용자 입력 흐름을 깨지 않기 위해 안전하게 로그만 남긴다.
      try { console.error('[CreateCharacterPage] default tags init failed:', e); } catch (_) {}
    }
  }, [isEditMode, useNormalCreateWizard, isOrigChatCharacter, draftRestored, selectedTagSlugs]);

  const handleManualDraftSave = () => {
    try {
      const key = `cc_draft_${isEditMode ? characterId : 'new'}`;
      const manualKey = `${key}_manual`;
      const draftPayload = {
        ...formData,
        // ✅ 성향/스타일 등 태그 상태도 임시저장(요구사항: 남/여/전체 저장)
        selectedTagSlugs: Array.isArray(selectedTagSlugs) ? selectedTagSlugs : [],
        media_settings: {
          ...(formData?.media_settings || {}),
          newly_added_files: [], // File은 직렬화 불가/의미 없음 → 저장하지 않음
        },
      };
      localStorage.setItem(manualKey, '1');
      localStorage.setItem(key, JSON.stringify(draftPayload));
      setIsDraftEnabled(true);
      setLastSavedAt(Date.now());
      setHasUnsavedChanges(false);
      try {
        dispatchToast('success', '임시저장 완료! 다음에 이어서 작성할 수 있어요.');
      } catch (_) {}
    } catch (e) {
      // 사용자가 체감하는 기능이므로, 실패 시 로그 + 토스트를 남긴다.
      console.error('[CreateCharacterPage] draft save failed:', e);
      try {
        dispatchToast('error', '임시저장에 실패했습니다. 브라우저 저장 공간/권한을 확인해주세요.');
      } catch (_) {}
    }
  };

  const hasAnyUserInput = useMemo(() => {
    /**
     * ✅ 이탈 경고 방지용 "실입력 감지"
     *
     * 요구사항:
     * - 캐릭터 생성 페이지에서 **아무것도 입력한 게 없으면** 경고 모달/브라우저 이탈 경고가 뜨지 않아야 한다.
     *
     * 의도/원리:
     * - formData에는 기본값(빈 배열/빈 문자열 등)이 항상 존재할 수 있다.
     * - 따라서 "유저가 실제로 입력/선택/업로드했는지"만 최소 기준으로 판단한다.
     */
    try {
      const t = (v) => String(v ?? '').trim();

      // 텍스트 입력(대표)
      if (t(formData?.basic_info?.name)) return true;
      if (t(formData?.basic_info?.description)) return true;
      if (t(formData?.basic_info?.world_setting)) return true;
      if (t(formData?.basic_info?.personality)) return true;
      if (t(formData?.basic_info?.speech_style)) return true;
      if (t(formData?.basic_info?.greeting)) return true;
      if (t(formData?.basic_info?.user_display_description)) return true;
      if (t(formData?.affinity_system?.affinity_rules)) return true;
      if (t(formData?.publish_settings?.custom_module_id)) return true;

      // 소개/비밀정보/예시대화 등
      try {
        const scenes = Array.isArray(formData?.basic_info?.introduction_scenes) ? formData.basic_info.introduction_scenes : [];
        if (scenes.some((s) => t(s?.content) || t(s?.secret))) return true;
      } catch (_) {}
      try {
        const ds = Array.isArray(formData?.example_dialogues?.dialogues) ? formData.example_dialogues.dialogues : [];
        if (ds.some((d) => t(d?.user_message) || t(d?.character_response))) return true;
      } catch (_) {}

      // 이미지/업로드
      try {
        if (t(formData?.media_settings?.avatar_url)) return true;
        const imgs = Array.isArray(formData?.media_settings?.image_descriptions) ? formData.media_settings.image_descriptions : [];
        if (imgs.some((img) => t(img?.url) || t(img?.description))) return true;
        const files = Array.isArray(formData?.media_settings?.newly_added_files) ? formData.media_settings.newly_added_files : [];
        if (files.length > 0) return true;
      } catch (_) {}

      // 태그 선택
      if (Array.isArray(selectedTagSlugs) && selectedTagSlugs.length > 0) return true;

      // ✅ 위저드 SSOT: start_sets (오프닝/스탯/턴사건/엔딩/작품컨셉 등)
      // - 기존 hasAnyUserInput이 basic_info만 보게 되면, 오프닝/스탯만 입력한 경우 이탈 경고가 누락될 수 있다.
      try {
        const ss = (formData?.basic_info?.start_sets && typeof formData.basic_info.start_sets === 'object')
          ? formData.basic_info.start_sets
          : null;
        const pc = (ss && typeof ss.profile_concept === 'object' && ss.profile_concept) ? ss.profile_concept : null;
        if (pc && (t(pc?.text) || t(pc?.enabled))) return true;

        const items = Array.isArray(ss?.items) ? ss.items : [];
        for (const it of items) {
          if (t(it?.title) || t(it?.intro) || t(it?.firstLine)) return true;
          // 턴수별 사건
          const evs = Array.isArray(it?.turn_events) ? it.turn_events : [];
          if (evs.some((ev) => t(ev?.title) || t(ev?.summary) || t(ev?.required_narration) || t(ev?.required_dialogue))) return true;
          // 스탯
          const stats = (it?.stat_settings && typeof it.stat_settings === 'object' && Array.isArray(it.stat_settings.stats))
            ? it.stat_settings.stats
            : [];
          if (stats.some((st) => t(st?.name) || t(st?.description) || t(st?.unit) || t(st?.min_value) || t(st?.max_value) || t(st?.base_value))) return true;
          // 엔딩
          const endings = (it?.ending_settings && typeof it.ending_settings === 'object' && Array.isArray(it.ending_settings.endings))
            ? it.ending_settings.endings
            : [];
          if (endings.some((en) => t(en?.title) || t(en?.base_condition) || t(en?.hint) || t(en?.epilogue))) return true;
          const extraConds = endings.flatMap((en) => (Array.isArray(en?.extra_conditions) ? en.extra_conditions : []));
          if (extraConds.some((c) => t(c?.text) || t(c?.stat) || t(c?.op) || t(c?.value))) return true;
        }
      } catch (_) {}

      return false;
    } catch (e) {
      try { console.warn('[CreateCharacterPage] hasAnyUserInput check failed:', e); } catch (_) {}
      return false;
    }
  }, [formData, selectedTagSlugs]);

  // 폼 변경 시 이탈 경고 플래그 설정
  useEffect(() => {
    setHasUnsavedChanges(true);
  }, [formData, selectedTagSlugs, detailModeOverrides]);

  // 브라우저 이탈 경고
  useEffect(() => {
    const handler = (e) => {
      if (hasUnsavedChanges && hasAnyUserInput) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [hasUnsavedChanges, hasAnyUserInput]);

  const confirmLeaveIfUnsaved = useCallback(() => {
    /**
     * ✅ 이탈(뒤로가기) 확인
     *
     * 의도/원리:
     * - 임시저장/등록 전 이탈 시 입력 유실을 막는다.
     * - hasAnyUserInput은 "실제 입력" 기준이라 초기 로딩/기본값으로는 경고하지 않는다.
     */
    try {
      // ✅ 방어: 일부 입력은 onBlur에서 커밋될 수 있으므로, 이탈 체크 전에 현재 포커스를 정리한다.
      try {
        const el = (typeof document !== 'undefined') ? document.activeElement : null;
        if (el && typeof el.blur === 'function') el.blur();
      } catch (_) {}
      if (hasUnsavedChanges && hasAnyUserInput) {
        return window.confirm('작성 중인 내용이 저장되지 않았습니다.\n이 페이지를 나가면 입력한 내용이 사라질 수 있어요.\n그래도 나가시겠어요?');
      }
      return true;
    } catch (_) {
      // 방어: confirm 실패 시 보수적으로 막지 않고 진행(기존 동작 유지)
      return true;
    }
  }, [hasUnsavedChanges, hasAnyUserInput]);

  // ✅ 브라우저 "뒤로가기" 가드(popstate)
  useEffect(() => {
    /**
     * 요구사항:
     * - 임시저장/등록 전 이탈(뒤로가기) 시, 변경사항이 있으면 반드시 경고한다.
     *
     * 원리:
     * - SPA에서 popstate는 취소 불가이므로, 현재 URL로 1회 pushState해 "가짜 히스토리"를 만든 뒤,
     *   뒤로가기를 누르면 먼저 이 가짜 엔트리로 돌아오게 해서 confirm을 띄운다.
     * - 사용자가 "나가기"를 선택하면 history.back()을 한 번 더 호출해 실제 이전 페이지로 이동한다.
     */
    /**
     * ✅ 문제/원인(버그):
     * - popstate 가드가 중복(혹은 재실행마다 pushState)되면, 뒤로가기 히스토리가 누적되어 UX가 붕괴한다.
     *
     * 해결:
     * - "변경사항이 있을 때만" 1회 arm(pushState)하고,
     * - 변경사항이 사라지면(임시저장 등) 가드 엔트리를 제거해 "뒤로가기 2번"을 방지한다.
     */
    if (typeof window === 'undefined' || !window.history || !window.location) return undefined;

    const shouldGuard = Boolean(hasUnsavedChanges && hasAnyUserInput);
    const KEY = '__cc_leave_guard';
    const msg = '작성 중인 내용이 저장되지 않았습니다.\n이 페이지를 나가면 입력한 내용이 사라질 수 있어요.\n그래도 나가시겠어요?';

    const pushGuard = () => {
      try {
        const cur = window.history.state || {};
        if (cur && cur[KEY] === true) return;
        window.history.pushState({ ...(cur || {}), [KEY]: true }, '', window.location.href);
      } catch (_) {}
    };

    const popGuardIfNeeded = () => {
      if (!leaveGuardArmedRef.current) return;
      try {
        const cur = window.history.state || {};
        if (cur && cur[KEY] === true) {
          leaveBypassRef.current = true;
          window.history.back(); // 동일 URL 가드 엔트리 제거
        }
      } catch (_) {}
      leaveGuardArmedRef.current = false;
    };

    const onPopState = () => {
      try {
        if (leaveBypassRef.current) {
          leaveBypassRef.current = false;
          return;
        }
        if (!(hasUnsavedChanges && hasAnyUserInput)) return;
        const ok = window.confirm(msg);
        if (ok) {
          // 실제 이전 페이지로 이동: 리스너 제거 + back 1회(가드 엔트리 제거 직후 이동)
          try { window.removeEventListener('popstate', onPopState); } catch (_) {}
          leaveGuardArmedRef.current = false;
          leaveBypassRef.current = true;
          try { window.history.back(); } catch (_) {}
          return;
        }
        // 취소: 현재 페이지 유지 위해 다시 가드 엔트리 주입
        pushGuard();
        leaveGuardArmedRef.current = true;
      } catch (e) {
        try { console.warn('[CreateCharacterPage] popstate guard failed:', e); } catch (_) {}
      }
    };

    if (shouldGuard) {
      if (!leaveGuardArmedRef.current) {
        pushGuard();
        leaveGuardArmedRef.current = true;
      }
      try { window.addEventListener('popstate', onPopState); } catch (_) {}
      return () => {
        try { window.removeEventListener('popstate', onPopState); } catch (_) {}
      };
    }

    // 변경사항이 없으면 가드 정리
    popGuardIfNeeded();
    return undefined;
  }, [hasUnsavedChanges, hasAnyUserInput]);

  // 섹션별 검증(필수값/토큰/리스트 유효성)
  const sectionErrors = useMemo(() => {
    const errors = {
      basic: 0,
      media: 0,
      dialogues: 0,
      affinity: 0,
      publish: 0,
      total: 0,
    };
    // ✅ 기본 정보 필수값(요구사항 / 생성 Create 기준):
    // 이미지, 이름, 필수태그, 캐릭터설명, 세계관설정
    if (!formData.basic_info.name?.trim()) errors.basic += 1;

    if (!isEditMode) {
      // 이미지(최소 1장)
      try {
        const hasExistingImages = Array.isArray(formData?.media_settings?.image_descriptions)
          && formData.media_settings.image_descriptions.some((img) => String(img?.url || '').trim());
        const hasNewFiles = Array.isArray(formData?.media_settings?.newly_added_files)
          && formData.media_settings.newly_added_files.length > 0;
        const hasBaseAvatar = !!String(formData?.media_settings?.avatar_url || '').trim();
        if (!hasExistingImages && !hasNewFiles && !hasBaseAvatar) errors.basic += 1;
      } catch (_) {}

      // 필수 텍스트
      if (!String(formData.basic_info.description || '').trim()) errors.basic += 1;
      if (!String(formData.basic_info.world_setting || '').trim()) errors.basic += 1;
    }

    // ✅ 필수 태그(성향/스타일): 생성/편집 모두 강제(요구사항), 단 원작챗 캐릭터 제외
    try {
      if (!isOrigChatCharacter) {
        const audience = (selectedTagSlugs || []).find((s) => REQUIRED_AUDIENCE_SLUGS.includes(s)) || null;
        const style = (selectedTagSlugs || []).find((s) => REQUIRED_STYLE_SLUGS.includes(s)) || null;
        if (!audience) errors.basic += 1;
        if (!style) errors.basic += 1;
      }
    } catch (_) {}

    // 허용되지 않은 토큰 사용 검사
    const tokenFields = [
      formData.basic_info.description,
      formData.basic_info.personality,
      formData.basic_info.speech_style,
      formData.basic_info.greeting,
      formData.basic_info.world_setting,
      formData.basic_info.user_display_description,
      ...(formData.basic_info.introduction_scenes || []).flatMap(s => [s.content, s.secret]),
      ...(formData.example_dialogues.dialogues || []).flatMap(d => [d.user_message, d.character_response]),
    ];
    const invalidTokenCount = tokenFields.reduce((acc, text) => {
      if (!text) return acc;
      const matches = [...(text.matchAll(/\{\{[^}]+\}\}/g) || [])].map(m => m[0]);
      const invalid = matches.filter(tok => !ALLOWED_TOKENS.includes(tok));
      return acc + invalid.length;
    }, 0);
    if (invalidTokenCount > 0) {
      errors.basic += invalidTokenCount; // 기본 섹션에 합산해 총 오류 배지에 반영
    }

    // 예시 대화: 선택 입력
    // - 0개면 오류로 취급하지 않는다.
    // - 입력한 항목이 있다면, 양쪽 메시지가 비어있지 않은지 검증한다.
    const ds = formData.example_dialogues.dialogues || [];
    if (ds.length > 0) {
      const incomplete = ds.filter(d => !d.user_message?.trim() || !d.character_response?.trim()).length;
      errors.dialogues += incomplete;
    }

    // 호감도: 활성화 시 규칙 필수 + 구간 겹침/순서 검사
    if (formData.affinity_system.has_affinity_system) {
      if (!formData.affinity_system.affinity_rules?.trim()) errors.affinity += 1;
      const stages = formData.affinity_system.affinity_stages || [];
      for (let i = 0; i < stages.length; i += 1) {
        const a = stages[i];
        const minA = Number(a.min_value) || 0;
        const maxA = a.max_value == null ? Number.POSITIVE_INFINITY : Number(a.max_value);
        if (maxA < minA) { errors.affinity += 1; break; }
        for (let j = i+1; j < stages.length; j += 1) {
          const b = stages[j];
          const minB = Number(b.min_value) || 0;
          const maxB = b.max_value == null ? Number.POSITIVE_INFINITY : Number(b.max_value);
          const overlap = Math.max(minA, minB) <= Math.min(maxA, maxB);
          if (overlap) { errors.affinity += 1; i = stages.length; break; }
        }
      }
    }

    errors.total = errors.basic + errors.media + errors.dialogues + errors.affinity + errors.publish;
    return errors;
  }, [formData, isEditMode, selectedTagSlugs, isOrigChatCharacter]);

  // 스크롤 스파이: 현재 섹션 추적
  useEffect(() => {
    const ids = ['section-basic','section-dialogues','section-affinity','section-publish'];
    const elements = ids.map(id => document.getElementById(id)).filter(Boolean);
    if (elements.length === 0) return;
    const observer = new IntersectionObserver((entries) => {
      const visible = entries
        .filter(e => e.isIntersecting)
        .sort((a,b) => b.intersectionRatio - a.intersectionRatio);
      if (visible[0]?.target?.id) {
        const nextId = visible[0].target.id;
        if (nextId !== activeSectionRef.current) {
          activeSectionRef.current = nextId;
          setActiveSection(nextId);
        }
      }
    }, { root: null, rootMargin: '-40% 0px -55% 0px', threshold: [0, 0.25, 0.5, 0.75, 1] });
    elements.forEach(el => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  useEffect(() => { activeSectionRef.current = activeSection; }, [activeSection]);

  // 미리보기용 캐릭터 객체 생성
  const previewCharacter = useMemo(() => {
    const firstImage = formData.media_settings.image_descriptions?.[0]?.url || '';
    const avatar = formData.media_settings.avatar_url || firstImage;
    const replaceTokens = (text) => (text || '')
      // 레거시/신규 토큰 모두 동일하게 처리
      .replaceAll(TOKEN_ASSISTANT, formData.basic_info.name || '캐릭터')
      .replaceAll(TOKEN_CHARACTER, formData.basic_info.name || '캐릭터')
      .replaceAll(TOKEN_CHAR, formData.basic_info.name || '캐릭터')
      .replaceAll(TOKEN_USER, '나');
    return {
      id: 'preview',
      name: formData.basic_info.name || '제목 미정',
      description: replaceTokens(formData.basic_info.user_display_description?.trim() || formData.basic_info.description || '설명이 없습니다.'),
      avatar_url: avatar,
      thumbnail_url: avatar,
      chat_count: 0,
      like_count: 0,
    };
  }, [formData]);

  // 토큰 삽입 유틸리티(커서 위치 삽입)
  const insertAtCursor = (el, value, token) => {
    try {
      if (!el || typeof el.selectionStart !== 'number' || typeof el.selectionEnd !== 'number') {
        return { next: `${value || ''}${token}`, caret: null };
      }
      const start = el.selectionStart;
      const end = el.selectionEnd;
      const before = (value || '').slice(0, start);
      const after = (value || '').slice(end);
      return { next: `${before}${token}${after}`, caret: start + token.length };
    } catch (_) {
      return { next: `${value || ''}${token}`, caret: null };
    }
  };

  const insertBasicToken = (field, elementId, token) => {
    const el = typeof document !== 'undefined' ? document.getElementById(elementId) : null;
    const current = formData.basic_info[field] || '';
    const { next, caret } = insertAtCursor(el, current, token);
    updateFormData('basic_info', field, next);
    if (el && caret !== null) {
      setTimeout(() => { try { el.focus(); el.setSelectionRange(caret, caret); } catch(_){} }, 0);
    }
  };

  /**
   * ✅ 캐릭터 비밀정보(도입부와 분리된 전역 입력)
   *
   * 의도/원칙:
   * - '비밀정보'는 도입부(시작 상황)와 별개로, 캐릭터 전체에 적용되는 숨김 정보에 가깝다.
   * - 백엔드 스키마/DB 변경 없이 기존 `introduction_scenes[].secret` 필드를 공통 값으로 유지하여 호환성을 보장한다.
   *
   * 동작:
   * - 입력값을 모든 `introduction_scenes[].secret`에 동기화한다.
   * - 도입부를 추가해도 비밀정보가 유지되도록 새 씬에도 동일 값을 채운다.
   */
  const updateCharacterSecretInfo = (rawValue) => {
    const nextValue = String(rawValue ?? '');
    setFormData((prev) => {
      const scenes = Array.isArray(prev?.basic_info?.introduction_scenes)
        ? prev.basic_info.introduction_scenes
        : [];
      const base = scenes.length ? scenes : [{ title: '도입부 1', content: '', secret: '' }];
      const merged = base.map((s) => ({ ...(s || {}), secret: nextValue }));
      return {
        ...prev,
        basic_info: {
          ...prev.basic_info,
          introduction_scenes: merged,
        },
      };
    });
  };

  const insertCharacterSecretToken = (token) => {
    const el = typeof document !== 'undefined' ? document.getElementById('character_secret_info') : null;
    const current = formData?.basic_info?.introduction_scenes?.[0]?.secret || '';
    const { next, caret } = insertAtCursor(el, current, token);
    updateCharacterSecretInfo(next);
    if (el && caret !== null) {
      setTimeout(() => { try { el.focus(); el.setSelectionRange(caret, caret); } catch(_){} }, 0);
    }
  };

  const insertIntroToken = (index, subfield, token) => {
    const elementId = subfield === 'content' ? `intro_content_${index}` : `intro_secret_${index}`;
    const el = typeof document !== 'undefined' ? document.getElementById(elementId) : null;
    const current = formData.basic_info.introduction_scenes[index]?.[subfield] || '';
    const { next, caret } = insertAtCursor(el, current, token);
    updateIntroductionScene(index, subfield, next);
    if (el && caret !== null) {
      setTimeout(() => { try { el.focus(); el.setSelectionRange(caret, caret); } catch(_){} }, 0);
    }
  };

  const insertDialogueToken = (index, subfield, token) => {
    const elementId = subfield === 'user_message' ? `dlg_user_${index}` : `dlg_char_${index}`;
    const el = typeof document !== 'undefined' ? document.getElementById(elementId) : null;
    const current = formData.example_dialogues.dialogues[index]?.[subfield] || '';
    const { next, caret } = insertAtCursor(el, current, token);
    updateExampleDialogue(index, subfield, next);
    if (el && caret !== null) {
      setTimeout(() => { try { el.focus(); el.setSelectionRange(caret, caret); } catch(_){} }, 0);
    }
  };

  // 탭 정보 제거(롱폼)

  useEffect(() => {
    const prefilledData = location.state?.prefilledData;
    if (prefilledData) {
      const updatedBasicInfo = { ...formData.basic_info };
      Object.keys(prefilledData).forEach(key => {
        if (key in updatedBasicInfo) {
          updatedBasicInfo[key] = prefilledData[key];
        }
      });
      setFormData(prev => ({
        ...prev,
        basic_info: updatedBasicInfo,
      }));
    }
  }, [location.state]);

  useEffect(() => {
    if (!isAuthenticated) {
      navigate('/login');
    }

    if (isEditMode) {
      loadCharacterData();
    }
  }, [isAuthenticated, navigate, isEditMode, characterId]);

  const loadCharacterData = async () => {
    setLoading(true);
    try {
      // 이제 API가 항상 일관된 형식의 데이터를 주므로, 코드가 매우 깔끔해집니다.
      const response = await charactersAPI.getCharacter(characterId);
      const char = response.data;
      // ✅ 원작챗 캐릭터(웹소설/OrigChat)면, 일반 캐릭터 전용 옵션 UI를 숨긴다.
      try {
        const isOrig = !!String(char?.origin_story_id || '').trim() || !!char?.is_origchat;
        setIsOrigChatCharacter(isOrig);
      } catch (_) {}
      
      // 🔥 고급 캐릭터 데이터 구조로 매핑
      // ✅ 비밀정보는 전역 입력으로 취급: introduction_scenes[].secret을 하나의 값으로 통일한다.
      const normalizeIntroScenes = (raw) => {
        try {
          const arr = Array.isArray(raw) && raw.length ? raw : [{ title: '도입부 1', content: '', secret: '' }];
          const secrets = arr
            .map((s) => String(s?.secret || '').trim())
            .filter(Boolean);
          const uniq = Array.from(new Set(secrets));
          const mergedSecret = (uniq.join('\n\n') || '').slice(0, 1000); // 기존 UI maxLength와 동일하게 방어
          return arr.map((s, idx) => ({
            title: String(s?.title || `도입부 ${idx + 1}`),
            content: String(s?.content || ''),
            secret: mergedSecret,
          }));
        } catch (_) {
          return [{ title: '도입부 1', content: '', secret: '' }];
        }
      };
      setFormData(prev => ({
        ...prev,
        basic_info: {
          name: char.name || '',
          description: char.description || '',
          personality: char.personality || '',
          speech_style: char.speech_style || '',
          greeting: char.greeting || '',
          // greeting 문자열을 greetings 배열로 변환 (UI에서 배열 사용)
          greetings: char.greeting ? char.greeting.split('\n').filter(g => g.trim()) : [''],
          world_setting: char.world_setting || '',
          user_display_description: char.user_display_description || '',
          use_custom_description: char.use_custom_description || false,
          introduction_scenes: normalizeIntroScenes(char.introduction_scenes),
          character_type: char.character_type || 'roleplay',
          base_language: char.base_language || 'ko'
        },
        media_settings: {
          ...prev.media_settings, 
          avatar_url: char.avatar_url || '',
          image_descriptions: char.image_descriptions || [],
          voice_settings: char.voice_settings || {
            voice_id: null,
            voice_style: null,
            enabled: false
          },
          // local_image_previews: char.image_descriptions?.map(img => img.url) || [],
          newly_added_files: [],
        },
        example_dialogues: { dialogues: char.example_dialogues || [] },
        affinity_system: {
          has_affinity_system: char.has_affinity_system || false,
          affinity_rules: char.affinity_rules || '',
          affinity_stages: char.affinity_stages || [
            { min_value: 0, max_value: 100, description: '차가운 반응을 보입니다.' },
            { min_value: 101, max_value: 200, description: '친근하게 대화합니다.' },
            { min_value: 201, max_value: null, description: '매우 친밀하게 대화합니다.' }
          ]
        },
        publish_settings: {
          is_public: char.is_public,
          custom_module_id: char.custom_module_id,
          use_translation: char.use_translation !== undefined ? char.use_translation : true
        }
      }));
      setPageTitle('캐릭터 수정');
      // 기존 태그 로드
      try {
        const tagRes = await api.get(`/characters/${characterId}/tags`);
        const slugs = (tagRes.data || []).map(t => t.slug);
        setSelectedTagSlugs(slugs);
      } catch (_) {}
    } catch (err) {
      console.error('캐릭터 정보 로드 실패:', err);
      setError(err.message || '캐릭터 정보를 불러올 수 없습니다.');
    } finally {
      setLoading(false);
    }
  };

  const updateFormData = (section, field, value) => {
    setFormData(prev => ({
      ...prev,
      [section]: {
        ...prev[section],
        [field]: value
      }
    }));
  };

  const addIntroductionScene = () => {
    // ✅ 도입부 추가 시에도 '캐릭터 비밀정보'가 유지되도록 현재 secret 값을 새 씬에도 복사한다.
    const currentSecret = formData?.basic_info?.introduction_scenes?.[0]?.secret || '';
    const newScene = { title: `도입부 ${formData.basic_info.introduction_scenes.length + 1}`, content: '', secret: String(currentSecret || '') };
    updateFormData('basic_info', 'introduction_scenes', [...formData.basic_info.introduction_scenes, newScene]);
  };

  const removeIntroductionScene = (index) => {
    /**
     * ✅ 도입부 삭제(UX 개선)
     *
     * 의도/동작:
     * - 사용자가 "도입부 삭제"를 명확히 찾을 수 있어야 한다.
     * - 다만 도입부 배열이 0개가 되면(백엔드/프롬프트 생성기 호환) 예외가 날 수 있어,
     *   마지막 1개를 삭제하려고 하면 "삭제" 대신 안전하게 내용 초기화로 처리한다.
     */
    const currentSecret = formData?.basic_info?.introduction_scenes?.[0]?.secret || '';
    const nextScenes = formData.basic_info.introduction_scenes.filter((_, i) => i !== index);
    if (!nextScenes.length) {
      updateFormData('basic_info', 'introduction_scenes', [{ title: '도입부 1', content: '', secret: String(currentSecret || '') }]);
      return;
    }
    updateFormData('basic_info', 'introduction_scenes', nextScenes);
  };

  const updateIntroductionScene = (index, field, value) => {
    const scenes = [...formData.basic_info.introduction_scenes];
    scenes[index] = { ...scenes[index], [field]: value };
    updateFormData('basic_info', 'introduction_scenes', scenes);
  };

  const addExampleDialogue = () => {
    const current = Array.isArray(formData?.example_dialogues?.dialogues) ? formData.example_dialogues.dialogues : [];
    const nextIndex = current.length;
    const newDialogue = { user_message: '', character_response: '', order_index: nextIndex };
    updateFormData('example_dialogues', 'dialogues', [...current, newDialogue]);
    // ✅ UX: 새로 추가된 탭으로 즉시 이동
    try { setActiveExampleDialogueIdx(nextIndex); } catch (_) {}
  };

  const removeExampleDialogue = (index) => {
    const current = Array.isArray(formData?.example_dialogues?.dialogues) ? formData.example_dialogues.dialogues : [];
    const idx = Number(index);
    const next = current.filter((_, i) => i !== idx);
    updateFormData('example_dialogues', 'dialogues', next);
    // ✅ 탭 인덱스 보정(삭제 후에도 안정적으로 선택 유지)
    try {
      setActiveExampleDialogueIdx((prev) => {
        const p = Number(prev);
        if (!Number.isFinite(p)) return 0;
        if (p === idx) return Math.max(0, idx - 1);
        if (p > idx) return Math.max(0, p - 1);
        return p;
      });
    } catch (_) {}
  };

  const updateExampleDialogue = (index, field, value) => {
    const dialogues = [...formData.example_dialogues.dialogues];
    dialogues[index] = { ...dialogues[index], [field]: value };
    updateFormData('example_dialogues', 'dialogues', dialogues);
  };

  /**
   * ✅ 호감도 구간(stage) 편집 핸들러
   *
   * 의도/동작(최소 수정/안전):
   * - 기존 `affinity_stages`(number/null/string) 구조를 유지한 채로 UI 입력을 가능하게 한다.
   * - `max_value`는 빈칸('')을 `null`(무한대, ∞)로 정규화한다.
   * - 숫자 입력은 NaN 방지를 위해 안전 파싱한다.
   */
  const updateAffinityStage = (index, field, rawValue) => {
    const stages = Array.isArray(formData?.affinity_system?.affinity_stages)
      ? [...formData.affinity_system.affinity_stages]
      : [];

    if (!stages[index]) return;

    if (field === 'min_value') {
      const next = Number.parseInt(String(rawValue ?? ''), 10);
      stages[index] = { ...stages[index], min_value: Number.isFinite(next) ? next : 0 };
      updateFormData('affinity_system', 'affinity_stages', stages);
      return;
    }

    if (field === 'max_value') {
      const s = String(rawValue ?? '').trim();
      if (!s) {
        stages[index] = { ...stages[index], max_value: null };
        updateFormData('affinity_system', 'affinity_stages', stages);
        return;
      }
      const next = Number.parseInt(s, 10);
      stages[index] = { ...stages[index], max_value: Number.isFinite(next) ? next : null };
      updateFormData('affinity_system', 'affinity_stages', stages);
      return;
    }

    if (field === 'description') {
      stages[index] = { ...stages[index], description: String(rawValue ?? '') };
      updateFormData('affinity_system', 'affinity_stages', stages);
      return;
    }
  };

  const allowedExt = ['jpg','jpeg','png','webp','gif'];
  const validateExt = (file) => {
    const ext = (file.name || '').toLowerCase().split('.').pop();
    return allowedExt.includes(ext);
  };

  const handleImageUpload = (e) => {
    const files = Array.from(e.target.files);
    if (files.length === 0) return;
    if (!validateExt(files[0])) {
      dispatchToast('error', 'jpg, jpeg, png, webp, gif 형식만 업로드할 수 있습니다.');
      e.target.value = '';
      return;
    }
    // 크롭 모달 오픈
    const objectUrl = URL.createObjectURL(files[0]);
    setCropSrc(objectUrl);
    setIsCropOpen(true);
    e.target.value = '';
  };

  // [2단계] 이미지 제거 핸들러 분리
  const handleRemoveExistingImage = (indexToRemove) => {
    setFormData(prev => ({
      ...prev,
      media_settings: {
        ...prev.media_settings,
        image_descriptions: prev.media_settings.image_descriptions.filter((_, index) => index !== indexToRemove)
      }
    }));
  };
  
  const handleRemoveNewFile = (indexToRemove) => {
    setFormData(prev => ({
      ...prev,
      media_settings: {
        ...prev.media_settings,
        newly_added_files: prev.media_settings.newly_added_files.filter((_, index) => index !== indexToRemove)
      }
    }));
  };

  // [3단계] 저장 로직 단순화
  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      // ✅ 요구사항: 글자수 초과는 "오류"가 아니라 인라인 경고로 안내한다.
      // - 저장 버튼은 가능하면 비활성화되지만, 방어적으로 저장 진입도 차단한다.
      if (useNormalCreateWizard) {
        try {
          const nameLen = String(formData?.basic_info?.name || '').length;
          const descLen = String(formData?.basic_info?.description || '').length;
          const worldLen = String(formData?.basic_info?.world_setting || '').length;
          const secretLen = String(formData?.basic_info?.introduction_scenes?.[0]?.secret || '').length;
          const commentLen = String(formData?.basic_info?.user_display_description || '').length;
          const personalityLen = String(formData?.basic_info?.personality || '').length;
          const speechLen = String(formData?.basic_info?.speech_style || '').length;
          const nameTrimLen = String(formData?.basic_info?.name || '').trim().length;
          const descTrimLen = String(formData?.basic_info?.description || '').trim().length;
          const openingAnyOver = (() => {
            /**
             * ✅ 오프닝(위저드) 글자수 방어
             *
             * - maxLength를 제거했으므로(초과 허용 UI), 저장 시점에 초과를 반드시 차단한다.
             * - start_sets.items[] 전체를 검사해, 하나라도 초과면 저장을 막는다(서버 422 방지).
             */
            try {
              const ss = formData?.basic_info?.start_sets;
              const items = Array.isArray(ss?.items) ? ss.items : [];
              for (const it of items) {
                const t = String(it?.title || '');
                const intro = String(it?.intro || '');
                const first = String(it?.firstLine || '');
                if (t.length > 100 || intro.length > 2000 || first.length > 500) return true;
              }
              return false;
            } catch (_) {
              return true;
            }
          })();
          const dialoguesAnyOver = (() => {
            /**
             * ✅ 예시대화 글자수 방어
             *
             * - maxLength를 제거했으므로(초과 허용 UI), 저장 시점에 초과를 반드시 차단한다.
             */
            try {
              const ds = Array.isArray(formData?.example_dialogues?.dialogues) ? formData.example_dialogues.dialogues : [];
              for (const d of ds) {
                const u = String(d?.user_message || '');
                const a = String(d?.character_response || '');
                if (u.length > 500 || a.length > 1000) return true;
              }
              return false;
            } catch (_) {
              return true;
            }
          })();
          if (
            nameLen > PROFILE_NAME_MAX_LEN
            || nameTrimLen === 0
            || descLen > PROFILE_ONE_LINE_MAX_LEN
            || descTrimLen === 0
            || worldLen > 6000
            || (isSecretInfoEnabled && secretLen > 1000)
            || (!!formData?.basic_info?.use_custom_description && commentLen > 1000)
            || personalityLen > 300
            || speechLen > 300
            || openingAnyOver
            || dialoguesAnyOver
          ) {
            // setError로 상단 에러(Alert)를 띄우지 않는다(요구사항).
            setLoading(false);
            return;
          }
        } catch (_) {
          setLoading(false);
          return;
        }
      }
      // Zod 검증
      const validation = validateForm();
      if (!validation.success) {
        const firstKey = Object.keys(validation.errors || {})[0];
        if (firstKey) scrollToField(firstKey);
        setError('필수 입력 항목을 다시 확인해주세요.');
        setLoading(false);
        return;
      }
      let uploadedImageUrls = [];
      if (formData.media_settings.newly_added_files.length > 0) {
        const uploadResponse = await filesAPI.uploadImages(formData.media_settings.newly_added_files);
        uploadedImageUrls = uploadResponse.data;
      }
      
      const existingImageUrls = (formData.media_settings.image_descriptions || []).map(img => img?.url);
      const finalImageUrlsRaw = [...existingImageUrls, ...uploadedImageUrls];

      // ✅ 서버 스키마 방어: image_descriptions.url 최대 500자
      // - 일부 환경에서 "임시 서명 URL"이 그대로 들어오면 길이가 500자를 넘을 수 있어 422가 난다.
      // - 가능하면 쿼리스트링을 제거해 축약하고, 그래도 길면 명확히 안내한다(조용히 삼키지 않음).
      const finalImageUrls = [];
      const tooLong = [];
      for (let i = 0; i < finalImageUrlsRaw.length; i += 1) {
        const raw = String(finalImageUrlsRaw[i] || '').trim();
        if (!raw) continue;
        let u = raw;
        if (u.length > 500) {
          try { u = u.split('?')[0].split('#')[0]; } catch (_) {}
        }
        if (!u || u.length > 500) {
          tooLong.push(i + 1);
          continue;
        }
        finalImageUrls.push(u);
      }
      if (tooLong.length > 0) {
        const msg = `이미지 URL이 너무 길어 저장할 수 없습니다. (해당 이미지: ${tooLong.slice(0, 5).join(', ')}번${tooLong.length > 5 ? ` 외 ${tooLong.length - 5}개` : ''})\n이미지를 다시 업로드/삽입해주세요.`;
        setError(msg);
        try { dispatchToast('error', '이미지 URL이 너무 길어 저장할 수 없습니다. 이미지를 다시 업로드/삽입해주세요.'); } catch (_) {}
        setLoading(false);
        return;
      }

      // ✅ 저장 시점에는 토큰을 "치환"하지 않고 원문 보존(SSOT)
      // - 금지/미등록 토큰만 제거(안전)
      const safeDescription = sanitizePromptTokens(formData.basic_info.description);
      const safeUserDisplay = sanitizePromptTokens(formData.basic_info.user_display_description);
      const safePersonality = sanitizePromptTokens(
        buildPersonalityWithDetailPrefs(formData.basic_info.personality, detailPrefs)
      );
      const useCustomDescription = Boolean((safeUserDisplay || '').trim());

      /**
       * ✅ 작품 컨셉(선택, 고급) → 프롬프트 수동입력에도 반영
       *
       * 의도/원리:
       * - 사용자가 프롬프트를 직접 작성하더라도, "작품 컨셉"이 있으면 모델이 더 잘 이해할 수 있다.
       * - 별도 DB 컬럼 없이 start_sets(JSON)에 저장된 컨셉을 world_setting에 안전하게 포함시켜 저장한다.
       * - CC_STATS 블록을 깨지 않도록, 스탯 블록이 있으면 그 앞에 삽입한다.
       *
       * 방어:
       * - 최대 6000자 제한 유지(초과 시 컨셉을 자동으로 잘라 넣고 warning 토스트로 알림)
       * - 중복 삽입 방지(마커 블록이 있으면 교체)
       */
      const buildWorldSettingWithConcept = (baseWorld, conceptTextRaw) => {
        const MAX = 6000;
        const CONCEPT_START = '<!-- CC_CONCEPT_START -->';
        const CONCEPT_END = '<!-- CC_CONCEPT_END -->';
        const STATS_START = '<!-- CC_STATS_START -->';

        const base0 = String(baseWorld ?? '');
        const concept0 = String(conceptTextRaw ?? '').trim();
        if (!concept0) return { text: base0, clipped: false, used: false };

        // 1) 기존 컨셉 블록 제거(중복 방지)
        let base = base0;
        try {
          const s = base.indexOf(CONCEPT_START);
          const e = base.indexOf(CONCEPT_END);
          if (s >= 0 && e > s) {
            const before = base.slice(0, s).trimEnd();
            const after = base.slice(e + CONCEPT_END.length).trimStart();
            base = [before, after].filter(Boolean).join('\n\n');
          }
        } catch (_) {}

        // 2) 삽입 위치: 스탯 블록 앞(있으면) / 없으면 끝
        const statsIdx = (() => {
          try { return base.indexOf(STATS_START); } catch (_) { return -1; }
        })();
        const before = statsIdx >= 0 ? base.slice(0, statsIdx).trimEnd() : base.trimEnd();
        const after = statsIdx >= 0 ? base.slice(statsIdx).trimStart() : '';

        const header = '## 작품 컨셉(추가 참고)\n';
        const blockPrefix = `${CONCEPT_START}\n${header}`;
        const blockSuffix = `\n${CONCEPT_END}`;
        const joinBefore = before ? `${before}\n\n` : '';
        const joinAfter = after ? `\n\n${after}` : '';

        // 3) 길이 계산 후 컨셉을 가능한 만큼만 삽입(스탯 블록 보호)
        const fixedLen = (joinBefore + blockPrefix + blockSuffix + joinAfter).length;
        const available = Math.max(0, MAX - fixedLen);
        const concept = concept0.length > available ? concept0.slice(0, available) : concept0;
        const clipped = concept !== concept0;
        const text = (joinBefore + blockPrefix + concept + blockSuffix + joinAfter).slice(0, MAX);
        return { text, clipped, used: true };
      };

      const conceptForPrompt = (() => {
        try {
          if (!useNormalCreateWizard) return '';
          const ss = (formData?.basic_info?.start_sets && typeof formData.basic_info.start_sets === 'object')
            ? formData.basic_info.start_sets
            : null;
          const pc = (ss && typeof ss.profile_concept === 'object' && ss.profile_concept) ? ss.profile_concept : null;
          if (!pc?.enabled) return '';
          const raw = String(pc?.text || '').trim();
          if (!raw) return '';
          // ✅ 길이/토큰 방어(컨셉도 prompt로 들어가므로 동일 정책 적용)
          return sanitizePromptTokens(raw).slice(0, PROFILE_CONCEPT_MAX_LEN);
        } catch (_) {
          return '';
        }
      })();

      const worldWithConcept = (() => {
        try {
          const base = String(formData?.basic_info?.world_setting || '');
          const { text, clipped, used } = buildWorldSettingWithConcept(base, conceptForPrompt);
          if (used && clipped) {
            try { dispatchToast('warning', '작품 컨셉이 길어 프롬프트에 일부만 반영되었습니다.'); } catch (_) {}
          }
          return text;
        } catch (_) {
          return String(formData?.basic_info?.world_setting || '');
        }
      })();

      // greetings 배열을 greeting 단일 문자열로 변환
      // UI에서는 greetings 배열을 사용하지만, 백엔드는 greeting 단일 문자열을 기대함
      const greetingsArray = formData.basic_info.greetings || [];
      const greetingValue = Array.isArray(greetingsArray) && greetingsArray.length > 0
        ? greetingsArray.filter(g => g?.trim()).join('\n')
        : (formData.basic_info.greeting || '');

      // ✅ 서버 스키마 방어: introduction_scenes는 (title/content) 필수(str)라 빈 값이면 422가 난다.
      // - UI/요구사항 상 도입부는 "필수 입력"이 아니므로, 비어있으면 안전한 기본값으로 보정해 저장 실패를 막는다.
      const normalizedIntroScenes = (() => {
        try {
          const raw = Array.isArray(formData?.basic_info?.introduction_scenes)
            ? formData.basic_info.introduction_scenes
            : [];
          if (!raw.length) return [];

          const nameSafe = String(formData?.basic_info?.name || '').trim() || '캐릭터';
          const baseTitle = (idx) => `도입부 ${idx + 1}`;

          const s0 = raw[0] || {};
          const title0 = String(s0?.title || baseTitle(0)).trim() || baseTitle(0);
          const content0Raw = String(s0?.content || '').trim();
          const secret0Raw = String(s0?.secret || '').trim();
          const content0 = content0Raw || `지금부터 ${nameSafe}와(과) 대화를 시작합니다.`;

          const out = [{
            title: title0,
            content: content0,
            ...(secret0Raw ? { secret: secret0Raw } : {}),
          }];

          for (let i = 1; i < raw.length; i += 1) {
            const sc = raw[i] || {};
            const title = String(sc?.title || baseTitle(i)).trim() || baseTitle(i);
            const contentRaw = String(sc?.content || '').trim();
            const secretRaw = String(sc?.secret || '').trim();
            if (!contentRaw) continue; // 비어있는 도입부는 전송하지 않음(선택 입력)
            const item = { title, content: contentRaw };
            if (secretRaw) item.secret = secretRaw;
            out.push(item);
          }
          return out;
        } catch (_) {
          return [];
        }
      })();

      // ✅ 서버 스키마 방어: avatar_url / image_descriptions 내부 타입 강제 정규화
      // - 운영/배포에서 간헐적으로 keywords/description에 비문자 타입이 섞이면 422가 날 수 있어
      //   저장 직전에 안전하게 문자열/문자열배열로 보정한다.
      const safeAvatarUrl = (() => {
        try {
          const v = formData?.media_settings?.avatar_url;
          let s = '';
          if (v == null) s = '';
          else if (typeof v === 'string') s = v;
          else s = String(v);
          s = String(s || '').trim();

          // ✅ 생성(Create) UX: 대표이미지 미지정이면 첫 번째 이미지로 자동 지정
          // - 홈/랭킹/추천 등 일부 영역은 avatar_url 기반 렌더가 많아, 비어있으면 기본이미지로 보일 수 있다.
          if (!isEditMode && !s) {
            try {
              const first = Array.isArray(finalImageUrls) ? String(finalImageUrls[0] || '').trim() : '';
              if (first) return first;
            } catch (_) {}
          }

          return s || undefined;
        } catch (_) {
          return undefined;
        }
      })();

      /**
       * ✅ 오프닝/엔딩 정규화 (저장 전)
       * 
       * 요구사항:
       * - 비어있는 오프닝(firstLine 없음) → 자동 삭제
       * - 비어있는 엔딩(title/base_condition/epilogue/hint 모두 없음) → 자동 삭제
       * - 오프닝 최소 1개 필수
       * - 각 오프닝에 엔딩 최소 1개 필수
       */
      const normalizedStartSets = (() => {
        try {
          const ss = formData?.basic_info?.start_sets;
          if (!ss || typeof ss !== 'object') return ss;
          
          const rawItems = Array.isArray(ss.items) ? ss.items : [];
          
          // 비어있지 않은 오프닝만 필터링 (firstLine이 있어야 함)
          const isOpeningValid = (item) => {
            const firstLine = String(item?.firstLine || '').trim();
            return !!firstLine;
          };
          
          // 비어있지 않은 엔딩만 필터링
          const isEndingValid = (ending) => {
            const title = String(ending?.title || '').trim();
            const baseCond = String(ending?.base_condition || '').trim();
            const epilogue = String(ending?.epilogue || '').trim();
            const hint = String(ending?.hint || '').trim();
            return !!(title || baseCond || epilogue || hint);
          };
          
          // 각 오프닝의 엔딩도 정규화
          const normalizedItems = rawItems
            .filter(isOpeningValid)
            .map((item) => {
              const endings = Array.isArray(item?.ending_settings?.endings)
                ? item.ending_settings.endings.filter(isEndingValid)
                : [];
              return {
                ...item,
                ending_settings: {
                  ...(item?.ending_settings || {}),
                  endings,
                },
              };
            });
          
          // 오프닝 최소 1개 필수 검증
          if (normalizedItems.length === 0) {
            dispatchToast('error', '오프닝(첫대사)을 최소 1개 입력해주세요.');
            return null; // null 반환 시 저장 중단
          }
          
          // 각 오프닝에 엔딩 최소 1개 필수 검증
          for (let i = 0; i < normalizedItems.length; i++) {
            const item = normalizedItems[i];
            const endings = item?.ending_settings?.endings || [];
            if (endings.length === 0) {
              const title = String(item?.title || '').trim() || `오프닝 ${i + 1}`;
              dispatchToast('error', `"${title}"에 엔딩을 최소 1개 입력해주세요.`);
              return null; // null 반환 시 저장 중단
            }
          }
          
          return {
            ...ss,
            items: normalizedItems,
          };
        } catch (_) {
          return formData?.basic_info?.start_sets;
        }
      })();
      
      // 오프닝/엔딩 검증 실패 시 저장 중단
      if (normalizedStartSets === null) {
        setLoading(false);
        return;
      }

      // ✅ 스탯 숫자 범위 검증 (모든 오프닝)
      const allItems = normalizedStartSets?.items || [];
      for (let itemIdx = 0; itemIdx < allItems.length; itemIdx++) {
        const statsToValidate = allItems[itemIdx]?.stat_settings?.stats || [];
        for (let i = 0; i < statsToValidate.length; i++) {
          const st = statsToValidate[i];
          const minNum = (st?.min_value !== '' && st?.min_value != null) ? Number(st.min_value) : null;
          const maxNum = (st?.max_value !== '' && st?.max_value != null) ? Number(st.max_value) : null;
          const baseNum = (st?.base_value !== '' && st?.base_value != null) ? Number(st.base_value) : null;
          const label = st?.name || `스탯 ${i + 1}`;
          const openingLabel = allItems.length > 1 ? `오프닝 ${itemIdx + 1} - ` : '';
          // 최소 > 최대 검증
          if (minNum !== null && maxNum !== null && Number.isFinite(minNum) && Number.isFinite(maxNum) && minNum > maxNum) {
            dispatch({ type: 'SHOW_TOAST', payload: { message: `${openingLabel}${label}: 최소값이 최대값보다 큽니다.`, type: 'error' } });
            setLoading(false);
            return;
          }
          // 기본값 < 최소 검증
          if (baseNum !== null && Number.isFinite(baseNum) && minNum !== null && Number.isFinite(minNum) && baseNum < minNum) {
            dispatch({ type: 'SHOW_TOAST', payload: { message: `${openingLabel}${label}: 기본값이 최소값보다 작습니다.`, type: 'error' } });
            setLoading(false);
            return;
          }
          // 기본값 > 최대 검증
          if (baseNum !== null && Number.isFinite(baseNum) && maxNum !== null && Number.isFinite(maxNum) && baseNum > maxNum) {
            dispatch({ type: 'SHOW_TOAST', payload: { message: `${openingLabel}${label}: 기본값이 최대값보다 큽니다.`, type: 'error' } });
            setLoading(false);
            return;
          }
        }
      }

      const characterData = {
        ...formData,
        basic_info: {
          ...formData.basic_info,
          start_sets: normalizedStartSets, // 정규화된 start_sets 사용
          description: safeDescription,
          personality: safePersonality,
          user_display_description: safeUserDisplay,
          // ✅ 위저드(일반 생성)에서만: 작품 컨셉을 프롬프트에 포함시켜 저장
          ...(useNormalCreateWizard ? { world_setting: worldWithConcept } : {}),
          // ✅ 방어: 코멘트가 비어있으면 별도 설명을 쓰지 않도록 보정(빈 텍스트 노출 방지)
          use_custom_description: useCustomDescription,
          greeting: greetingValue, // greetings 배열을 greeting 단일 문자열로 변환
          greetings: undefined, // 백엔드에 전송하지 않도록 제거
          introduction_scenes: normalizedIntroScenes,
        },
        media_settings: {
          ...formData.media_settings,
          avatar_url: safeAvatarUrl,
          newly_added_files: undefined, // 백엔드 전송 대상 아님(File 객체/제어상태)
          // 기존 이미지의 description/keywords 유지
          image_descriptions: (() => {
            const existingMap = {};
            (formData.media_settings.image_descriptions || []).forEach(img => {
              if (img.url) existingMap[img.url] = img;
            });
            return finalImageUrls.map(url => {
              const existing = existingMap[url];
              // ✅ 방어(최우선): 현재 생성(Create)에서 422가 "Input should be a valid string"으로 막히는 케이스가 있어
              // - 생성 시에는 url만 보내고(description/keywords는 서버 default로 두어) 생성 실패를 원천 차단한다.
              // - 수정(Edit)에서는 기존에 입력된 description/keywords를 가능한 한 유지한다(회귀 방지).
              if (!isEditMode) {
                void existing;
                return { url: String(url || '').trim() };
              }
              const safeImgDesc = (() => {
                try {
                  return String(existing?.description ?? '').slice(0, 500);
                } catch (_) {
                  return '';
                }
              })();
              const safeImgKeywords = (() => {
                try {
                  const raw = Array.isArray(existing?.keywords) ? existing.keywords : [];
                  const cleaned = [];
                  const seen = new Set();
                  for (const kw of raw) {
                    const s = String(kw ?? '').trim().slice(0, 50);
                    if (!s) continue;
                    const key = s.toLowerCase();
                    if (seen.has(key)) continue;
                    seen.add(key);
                    cleaned.push(s);
                    if (cleaned.length >= 20) break;
                  }
                  return cleaned;
                } catch (_) {
                  return [];
                }
              })();
              return {
                url: String(url || '').trim(),
                description: safeImgDesc,
                keywords: safeImgKeywords,
              };
            });
          })()
        }
      };

      if (isEditMode) {
        // 변경 없을 때도 저장 가능하게: 백엔드가 부분 업데이트 허용
        await charactersAPI.updateAdvancedCharacter(characterId, characterData);
        // 태그 저장(선택): 태그 저장 실패로 "저장 자체"가 실패처럼 보이지 않도록 분리 처리
        try {
          await api.put(`/characters/${characterId}/tags`, { tags: selectedTagSlugs });
        } catch (e) {
          console.error('[CreateCharacterPage] tag save failed (edit):', e);
          try { dispatchToast('warning', '태그 저장에 실패했습니다. 저장은 완료되었을 수 있어요.'); } catch (_) {}
        }
        // ✅ 사용자 피드백(저장 성공)
        try { dispatchToast('success', '저장되었습니다.'); } catch (_) {}
        navigate(`/characters/${characterId}`, { state: { fromEdit: true } });
      } else {
        const response = await charactersAPI.createAdvancedCharacter(characterData);
        const newId = response.data.id;
        // 🆕 캐시 무효화
        queryClient.invalidateQueries({ queryKey: ['trending-characters-daily'] });
        queryClient.invalidateQueries({ queryKey: ['characters'] });
        // 태그 저장(선택): 태그 저장 실패로 생성이 실패처럼 보이지 않도록 분리 처리
        if (selectedTagSlugs.length) {
          try {
            await api.put(`/characters/${newId}/tags`, { tags: selectedTagSlugs });
          } catch (e) {
            console.error('[CreateCharacterPage] tag save failed (create):', e);
            try { dispatchToast('warning', '태그 저장에 실패했습니다. 캐릭터는 생성되었을 수 있어요.'); } catch (_) {}
          }
        }
        // ✅ 생성 성공 시: 로컬 초안 정리(다음 '새 캐릭터 만들기'에서 이전 내용 노출 방지)
        try {
          const draftKey = `cc_draft_${isEditMode ? characterId : 'new'}`;
          localStorage.removeItem(draftKey);
          localStorage.removeItem(`${draftKey}_manual`);
        } catch (_) {}
        // ✅ 사용자 피드백(생성 성공)
        try { dispatchToast('success', '캐릭터가 생성되었습니다.'); } catch (_) {}
        navigate(`/characters/${newId}`, { state: { fromCreate: true } });
      }
    } catch (err) {
      console.error(`캐릭터 ${isEditMode ? '수정' : '생성'} 실패:`, err);

        // Pydantic 검증 에러 처리
      if (err.response?.data?.detail && Array.isArray(err.response.data.detail)) {
        const serverErrors = {};
        err.response.data.detail.forEach((detail) => {
          const key = mapServerPathToKey(detail.loc);
          if (!key) return;
          let message = detail.msg || detail.message || '입력값을 확인해주세요.';
          if (detail.type === 'string_too_short') {
            message = '필수 항목입니다.';
          } else if (detail.type === 'string_too_long' && detail.ctx?.max_length) {
            message = `최대 ${detail.ctx.max_length}자까지 입력할 수 있습니다.`;
          }
          serverErrors[key] = message;
        });
        if (Object.keys(serverErrors).length) {
          setFieldErrors(prev => ({ ...prev, ...serverErrors }));
          const first = Object.keys(serverErrors)[0];
          if (first) scrollToField(first);
          // ✅ UX: 화면 상단에도 "왜 실패했는지"를 짧게 보여준다(필드가 접혀있거나, 이미지 URL 같은 비가시 에러 대비)
          const toLabel = (k) => {
            try {
              const s = String(k || '');
            if (s === 'basic_info.name') return '작품명';
              if (s === 'basic_info.description') return '캐릭터 설명';
              if (s === 'basic_info.world_setting') return '세계관 설정';
              if (s === 'basic_info.user_display_description') return '크리에이터 코멘트';
              if (s.startsWith('basic_info.introduction_scenes.') && s.endsWith('.content')) {
                const m = s.match(/basic_info\.introduction_scenes\.(\d+)\.content/);
                const n = m ? (Number(m[1]) + 1) : 1;
                return `도입부 ${n} 내용`;
              }
              if (s.startsWith('media_settings.image_descriptions.') && s.endsWith('.url')) {
                const m = s.match(/media_settings\.image_descriptions\.(\d+)\.url/);
                const n = m ? (Number(m[1]) + 1) : 1;
                return `이미지 ${n}`;
              }
              if (s.startsWith('media_settings.image_descriptions')) return '캐릭터 이미지';
              return s;
            } catch (_) {
              return String(k || '');
            }
          };
          const lines = Object.entries(serverErrors)
            .slice(0, 3)
            .map(([k, m]) => `- ${toLabel(k)}: ${String(m || '').trim()}`)
            .filter(Boolean);
          setError(lines.length ? `입력값을 다시 확인해주세요.\n${lines.join('\n')}` : '입력값을 다시 확인해주세요.');
          try { dispatchToast('error', '저장에 실패했습니다. 입력값을 다시 확인해주세요.'); } catch (_) {}
        } else {
          setError('입력값을 확인해주세요.');
          try { dispatchToast('error', '저장에 실패했습니다. 입력값을 확인해주세요.'); } catch (_) {}
        }
      } else {
        const errorMessage = err.response?.data?.detail || err.message || `캐릭터 ${isEditMode ? '수정' : '생성'}에 실패했습니다.`;
        setError(errorMessage);
        try { dispatchToast('error', String(errorMessage || '저장에 실패했습니다.')); } catch (_) {}
      }
    } finally {
      setLoading(false);
    }
  };

  const handleApplyImportedData = (data) => {
    /**
     * AI 스토리 분석 결과를 "현재 고급 캐릭터 생성 폼"에 최대한 채워넣는다.
     *
     * 의도/원칙:
     * - 과거(간단) 스키마 수준(name/description/world_setting)만 채우던 방식에서,
     *   현재 확장된 입력 볼륨(성격/말투/인사말/예시대화/도입부 등)도 가능한 한 자동 채움.
     * - 방어적으로: 누락/타입 흔들림이 있어도 폼이 깨지지 않게 기본값 유지 + 최소 유효성(예시대화 1개) 확보.
     */
    const safeText = (v) => {
      try { return String(v ?? '').trim(); } catch (_) { return ''; }
    };
    const safeArray = (v) => (Array.isArray(v) ? v : []);
    const clip = (v, maxLen) => {
      const s = safeText(v);
      if (!s) return '';
      return s.length > maxLen ? s.slice(0, maxLen) : s;
    };
    const toGreetings = (v) => {
      // greetings는 list[str]가 이상적이지만, 문자열/혼합 타입도 방어적으로 처리
      const arr = safeArray(v)
        .map((x) => clip(x, 500))
        .map((x) => x.trim())
        .filter(Boolean);
      if (arr.length > 0) return arr.slice(0, 3);
      return [];
    };
    const toExampleDialogues = (v) => {
      // example_dialogues는 [{user_message, character_response}] 또는 {dialogues:[...]} 형태 모두 지원
      const rawList = Array.isArray(v) ? v : (Array.isArray(v?.dialogues) ? v.dialogues : []);
      const mapped = rawList
        .map((d) => ({
          user_message: clip(d?.user_message, 500),
          character_response: clip(d?.character_response, 1000),
          order_index: Number.isFinite(Number(d?.order_index)) ? Number(d.order_index) : undefined,
        }))
        .filter((d) => d.user_message.trim() && d.character_response.trim())
        .map((d, idx) => ({ ...d, order_index: d.order_index ?? idx }));
      return mapped;
    };
    const toIntroScenes = (v) => {
      const rawList = safeArray(v);
      const mapped = rawList
        .map((s, idx) => ({
          title: clip(s?.title || `도입부 ${idx + 1}`, 100),
          content: clip(s?.content, 2000),
          secret: clip(s?.secret, 1000),
        }))
        .filter((s) => s.content.trim() || s.secret.trim() || s.title.trim());
      // ✅ 비밀정보는 전역 입력으로 취급: 여러 씬의 secret이 있으면 합쳐서 하나로 통일한다.
      try {
        const secrets = mapped.map((x) => String(x?.secret || '').trim()).filter(Boolean);
        const uniq = Array.from(new Set(secrets));
        const mergedSecret = (uniq.join('\n\n') || '').slice(0, 1000);
        return mapped.map((x) => ({ ...x, secret: mergedSecret }));
      } catch (_) {
        return mapped;
      }
    };

    const nextName = clip(data?.name, 100) || '';
    const nextDesc = clip(data?.description, 3000) || '';
    const nextWorld = clip(data?.world_setting, 5000) || '';
    const nextPersonality = clip(data?.personality, 300) || '';
    const nextSpeech = clip(data?.speech_style, 300) || '';
    const nextUserDisplay = clip(data?.user_display_description, 1000) || '';
    const greetings = toGreetings(data?.greetings);
    const exampleDialogues = toExampleDialogues(data?.example_dialogues);
    const introScenes = toIntroScenes(data?.introduction_scenes);

    // 예시 대화 최소 1개 확보(현재 UI 검증/UX 안정)
    const fallbackDialogues = (() => {
      const n = nextName || '캐릭터';
      const g = greetings[0] || nextDesc || '안녕하세요. 어떤 이야기부터 시작해볼까요?';
      return [{
        user_message: '안녕, 오늘은 어떤 기분이야?',
        character_response: `${n}: ${g}`.slice(0, 1000),
        order_index: 0,
      }];
    })();

    setFormData(prev => ({
      ...prev,
      basic_info: {
        ...prev.basic_info,
        name: nextName || prev.basic_info.name,
        description: nextDesc || prev.basic_info.description,
        personality: nextPersonality || prev.basic_info.personality,
        speech_style: nextSpeech || prev.basic_info.speech_style,
        world_setting: nextWorld || prev.basic_info.world_setting,
        user_display_description: nextUserDisplay || prev.basic_info.user_display_description,
        use_custom_description: Boolean(nextUserDisplay) || prev.basic_info.use_custom_description,
        // 인사말: UI에서는 greetings 배열을 사용한다(저장 시 greeting 문자열로 join)
        greetings: greetings.length ? greetings : prev.basic_info.greetings,
        // 도입부: AI가 생성한 도입부가 있으면 적용.
        // 없으면 기존값을 최대한 보존하되, 기본 도입부가 "완전 빈값"이면 최소 1개를 자동 생성해 생성 실패를 방지한다.
        introduction_scenes: (() => {
          if (introScenes.length) return introScenes;
          const prevScenes = Array.isArray(prev.basic_info.introduction_scenes) ? prev.basic_info.introduction_scenes : [];
          const hasMeaningful = prevScenes.some(s => String(s?.content || '').trim() || String(s?.secret || '').trim());
          if (hasMeaningful) return prevScenes;
          const n = nextName || prev.basic_info.name || '캐릭터';
          const w = nextWorld || prev.basic_info.world_setting || '';
          return [{
            title: '도입부 1',
            content: (w ? `${w}\n\n` : '') + `${n}와(과) 대화가 시작됩니다. 지금 상황과 관계를 한 줄로 정해보세요.`,
            secret: '',
          }];
        })(),
      },
      // 예시 대화: AI 생성분이 있으면 적용, 없으면 최소 1개 폴백
      example_dialogues: {
        ...prev.example_dialogues,
        dialogues: (() => {
          if (exampleDialogues.length) return exampleDialogues;
          const prevDs = Array.isArray(prev.example_dialogues?.dialogues) ? prev.example_dialogues.dialogues : [];
          const hasMeaningful = prevDs.some(d => String(d?.user_message || '').trim() && String(d?.character_response || '').trim());
          return hasMeaningful ? prevDs : fallbackDialogues;
        })(),
      },
      affinity_system: {
        ...prev.affinity_system,
        // 기존 로직 유지: social_tendency가 있으면 호감도 시스템을 켜고 간단 규칙을 채운다.
        has_affinity_system: data?.social_tendency !== undefined,
        affinity_rules: data?.social_tendency !== undefined 
          ? `대인관계 성향 점수(${data.social_tendency})를 기반으로 함` 
          : prev.affinity_system.affinity_rules,
      }
    }));
    setIsStoryImporterOpen(false); // 모달 닫기
    dispatchToast('success', `'${data.name}' 정보가 폼에 적용되었습니다. 내용을 확인해주세요.`);
  };

  // ✅ 프로필: "자동 생성" 버튼
  const [quickGenLoading, setQuickGenLoading] = useState(false);
  // ✅ 프로필 자동생성 취소/원문복구
  const quickGenAbortRef = useRef(false);
  const profileAutoGenPrevNameRef = useRef('');
  const profileAutoGenPrevDescRef = useRef('');
  const profileAutoGenPrevConceptRef = useRef(null); // { enabled: boolean, text: string } | null
  // ✅ 프로필 자동 생성 옵션: "제목형/문장형 이름" 허용
  const [quickGenTitleNameMode, setQuickGenTitleNameMode] = useState(false);
  // ✅ 프로필 자동생성: "이미지 정보 포함" 토글(QuickMeet와 동일한 의미)
  // - OFF: 빠르고 트렌디하게 생성(이미지 분석 없이도 되는, 가벼운 후킹 중심)
  // - ON : 삽입한 이미지에 정확하게 생성(이미지 단서 기반 앵커 강화)
  const [profileAutoGenUseImage, setProfileAutoGenUseImage] = useState(false);
  const hasProfileImageForAutoGen = useMemo(() => {
    /**
     * ✅ 위저드 프로필 자동생성: 이미지 존재 여부
     *
     * 원리(QuickMeet와 동일):
     * - 이미지가 없으면 "이미지 정보 포함" 토글은 활성화될 수 없다(ON 의미가 없음).
     * - 따라서 UI는 disabled 처리하고, state도 방어적으로 OFF로 되돌린다.
     */
    try {
      const avatar = String(formData?.media_settings?.avatar_url || '').trim();
      if (avatar) return true;
      const imgs = Array.isArray(formData?.media_settings?.image_descriptions) ? formData.media_settings.image_descriptions : [];
      return imgs.some((x) => String(x?.url || '').trim());
    } catch (_) {
      return false;
    }
  }, [formData?.media_settings?.avatar_url, formData?.media_settings?.image_descriptions]);
  useEffect(() => {
    // ✅ 방어: 이미지가 없는데 ON 상태면 강제로 OFF
    if (!hasProfileImageForAutoGen && profileAutoGenUseImage) {
      try { setProfileAutoGenUseImage(false); } catch (_) {}
    }
  }, [hasProfileImageForAutoGen, profileAutoGenUseImage]);
  // ✅ 프롬프트(시뮬레이터): "자동 생성" 버튼
  const [quickPromptGenLoading, setQuickPromptGenLoading] = useState(false);
  // ✅ 프롬프트 자동생성 단계 표시 (여러 단계 동시 표시)
  const [quickPromptGenSteps, setQuickPromptGenSteps] = useState([]);
  // ✅ 프롬프트 자동생성 중지 플래그
  const quickPromptGenAbortRef = useRef(false);
  // ✅ 프롬프트 자동생성 UX: 덮어쓰기 시 즉시 비우고, 실패하면 복구 (올인원이므로 모든 필드 백업)
  const promptAutoGenPrevWorldRef = useRef('');
  const promptAutoGenPrevStatsRef = useRef(null); // start_sets 내 stat_settings.stats
  const promptAutoGenPrevPersonalityRef = useRef('');
  const promptAutoGenPrevSpeechStyleRef = useRef('');
  const promptAutoGenPrevDetailPrefsRef = useRef(null); // { interests, likes, dislikes }
  // ✅ 첫시작(도입부+첫대사): "자동 생성" 버튼 (선택 세트에만 적용)
  const [quickFirstStartGenLoadingId, setQuickFirstStartGenLoadingId] = useState('');
  // ✅ 오프닝(첫시작) 자동생성 중지 플래그 및 원문 복구용 ref
  const quickFirstStartGenAbortRef = useRef(false);
  const firstStartAutoGenPrevIntroRef = useRef('');
  const firstStartAutoGenPrevFirstLineRef = useRef('');
  // ✅ 턴수별 사건(오프닝 내): "자동 생성" 버튼 (선택 세트에만 적용)
  const [quickTurnEventsGenLoadingId, setQuickTurnEventsGenLoadingId] = useState('');
  // ✅ 턴수별 사건 자동생성 중지 플래그 및 원문 복구용 ref
  const quickTurnEventsGenAbortRef = useRef(false);
  const turnEventsAutoGenPrevRef = useRef([]);
  // ✅ 스탯 자동생성: 로딩 상태 및 취소용 ref
  const [quickStatsGenLoadingId, setQuickStatsGenLoadingId] = useState('');
  const quickStatsGenAbortRef = useRef(false);
  const statsAutoGenPrevRef = useRef([]);
  const [turnEventsGenConfirmOpen, setTurnEventsGenConfirmOpen] = useState(false);
  const [turnEventsGenPendingSetId, setTurnEventsGenPendingSetId] = useState('');
  const [turnEventsGenPendingEvents, setTurnEventsGenPendingEvents] = useState([]);

  const handleAutoGenerateFirstStart = useCallback(async (targetSetId, opts) => {
    /**
     * 첫시작 자동 생성(요구사항):
     * - 프롬프트(world_setting)가 작성되어 있어야 실행한다.
     * - (도입부=서술형 지문) + (첫대사=캐릭터 발화) 를 분리해서 start_sets에 채운다.
     */
    const sid = String(targetSetId || '').trim();
    if (!sid) return null;
    if (quickFirstStartGenLoadingId) return null;
    try {
      const forceOverwrite = opts?.forceOverwrite === true;
      const name = String(formData?.basic_info?.name || '').trim();
      const desc = String(formData?.basic_info?.description || '').trim();
      const world = String(formData?.basic_info?.world_setting || '').trim();
      // ✅ RP/시뮬 분기(요구사항): 백엔드가 모드별 첫시작 규칙을 선택할 수 있도록 mode를 전달한다.
      const mode = inferAutoGenModeFromCharacterTypeAndWorld(formData?.basic_info?.character_type, world);
      if (!name || !desc) {
        dispatchToast('error', '프로필 정보를 먼저 입력해주세요.');
        return null;
      }
      if (!world) {
        dispatchToast('error', '프롬프트 정보를 먼저 입력해주세요.');
        return null;
      }

      // ✅ 덮어쓰기 허용(요구사항): 해당 오프닝에 이미 첫시작이 있으면 경고 모달 후 덮어쓰기
      const ss = (formData?.basic_info?.start_sets && typeof formData.basic_info.start_sets === 'object')
        ? formData.basic_info.start_sets
        : null;
      const items = Array.isArray(ss?.items) ? ss.items : [];
      const active = items.find((x) => String(x?.id || '').trim() === sid) || null;
      const hasExisting = !!(String(active?.intro || '').trim() || String(active?.firstLine || '').trim());
      if (hasExisting && !forceOverwrite) {
        openAutoGenOverwriteConfirm(
          '오프닝(첫 상황/첫 대사)',
          async () => { await handleAutoGenerateFirstStart(sid, { forceOverwrite: true }); }
        );
        return null;
      }

      // ✅ 원문 저장 (취소 시 복구용)
      firstStartAutoGenPrevIntroRef.current = String(active?.intro || '');
      firstStartAutoGenPrevFirstLineRef.current = String(active?.firstLine || '');
      quickFirstStartGenAbortRef.current = false;

      setQuickFirstStartGenLoadingId(sid);
      // ✅ 요구사항: "위저드만" 제미니 고정(다른 화면/로직에는 영향 주지 않음)
      const aiModel = useNormalCreateWizard
        ? 'gemini'
        : (String(user?.preferred_model || 'claude').trim().toLowerCase() || 'claude');
      const sim = (ss && typeof ss?.sim_options === 'object' && ss.sim_options) ? ss.sim_options : {};
      const simDatingElements = !!sim?.sim_dating_elements;
      const res = await charactersAPI.quickGenerateFirstStartDraft({
        name,
        description: desc,
        world_setting: world,
        mode,
        sim_dating_elements: (mode === 'simulator' ? simDatingElements : undefined),
        tags: Array.isArray(selectedTagSlugs) ? selectedTagSlugs : [],
        ai_model: (aiModel === 'gpt' ? 'gpt' : (aiModel === 'gemini' ? 'gemini' : 'claude')),
      });

      // ✅ 취소됐으면 결과 반영 안 함
      if (quickFirstStartGenAbortRef.current) {
        return null;
      }

      const intro = String(res?.data?.intro || '').trim();
      const firstLine = String(res?.data?.first_line || '').trim();
      if (!intro || !firstLine) {
        dispatchToast('error', '첫시작 생성 결과가 비어있습니다. 잠시 후 다시 시도해주세요.');
        return null;
      }

      // ✅ 방어: 자동생성 결과도 UI 제한을 절대 넘기지 않게 클램프한다.
      // - maxLength는 "사용자 입력"만 막고, setState로 주입되는 값은 그대로 들어올 수 있다.
      const introClamped = intro.length > 2000 ? intro.slice(0, 2000) : intro;
      const firstLineClamped = firstLine.length > 500 ? firstLine.slice(0, 500) : firstLine;
      if (introClamped !== intro || firstLineClamped !== firstLine) {
        try { console.warn('[CreateCharacterPage] opening auto-generate clipped:', { introLen: intro.length, firstLineLen: firstLine.length }); } catch (_) {}
        try { dispatchToast('warning', '오프닝 자동생성 결과가 길어 일부가 잘렸습니다. 내용을 확인해주세요.'); } catch (_) {}
      }

      updateStartSets((prev) => {
        const cur = (prev && typeof prev === 'object') ? prev : {};
        const curItems = Array.isArray(cur.items) ? cur.items : [];
        const nextItems = curItems.map((x) => {
          const xid = String(x?.id || '').trim();
          if (xid !== sid) return x;
          return { ...(x || {}), intro: introClamped, firstLine: firstLineClamped };
        });
        const nextSelected = String(cur.selectedId || '').trim() || sid;
        return { ...cur, selectedId: nextSelected, items: nextItems };
      });

      try { refreshChatPreviewSnapshot(); } catch (_) {}
      dispatchToast('success', '첫시작(도입부+첫대사)이 자동 생성되었습니다. 내용을 확인해주세요.');
      return { intro: introClamped, firstLine: firstLineClamped };
    } catch (e) {
      console.error('[CreateCharacterPage] quick-generate-first-start failed:', e);
      dispatchToast('error', '첫시작 자동 생성에 실패했습니다. 잠시 후 다시 시도해주세요.');
      return null;
    } finally {
      setQuickFirstStartGenLoadingId('');
    }
  }, [quickFirstStartGenLoadingId, formData, selectedTagSlugs, user, updateStartSets, refreshChatPreviewSnapshot, openAutoGenOverwriteConfirm, inferAutoGenModeFromCharacterTypeAndWorld]);

  const handleAutoGenerateTurnEvents = useCallback(async (targetSetId, opts) => {
    /**
     * ✅ 턴수별 사건 자동 생성(요구사항):
     * - 프로필(name/description) + 프롬프트(world_setting) + 오프닝(intro/firstLine) + 진행 턴수(max_turns)가 있어야 실행한다.
     * - 진행 턴수에 따라 생성 개수 상한이 적용된다(50/100/200/300/커스텀).
     * - 기존 사건이 있을 경우, 덮어쓰기 확인 모달을 띄운다(운영 안전/데이터 보호).
     */
    const options = (opts && typeof opts === 'object') ? opts : {};
    const silent = options?.silent === true;
    const skipOverwrite = options?.skipOverwrite === true || options?.skip_if_exists === true;

    const sid = String(targetSetId || '').trim();
    if (!sid) return null;
    if (quickTurnEventsGenLoadingId) return null;

    const name = String(formData?.basic_info?.name || '').trim();
    const desc = String(formData?.basic_info?.description || '').trim();
    const world = String(formData?.basic_info?.world_setting || '').trim();
    // ✅ RP/시뮬 분기(요구사항)
    const mode = inferAutoGenModeFromCharacterTypeAndWorld(formData?.basic_info?.character_type, world);
    if (!name || !desc) {
      if (!silent) dispatchToast('error', '프로필 정보를 먼저 입력해주세요.');
      return null;
    }
    if (!world) {
      if (!silent) dispatchToast('error', '프롬프트 정보를 먼저 입력해주세요.');
      return null;
    }

    // start_sets / active opening 찾기
    const ss = (formData?.basic_info?.start_sets && typeof formData.basic_info.start_sets === 'object')
      ? formData.basic_info.start_sets
      : null;
    const items = Array.isArray(ss?.items) ? ss.items : [];
    const activeSet = items.find((x) => String(x?.id || '').trim() === sid) || null;
    // ✅ 연쇄 자동완성(옵션): 기존 사건이 있으면 서버 호출 없이 즉시 생략(운영 비용/혼선 방지)
    try {
      const existingEarly = Array.isArray(activeSet?.turn_events) ? activeSet.turn_events : [];
      if (skipOverwrite && existingEarly.length > 0) {
        return { skipped: true, reason: 'existing' };
      }
    } catch (_) {}
    const overrideIntro = String(options?.opening_intro ?? options?.openingIntro ?? '').trim();
    const overrideFirst = String(options?.opening_first_line ?? options?.openingFirstLine ?? '').trim();
    const openingIntro = overrideIntro || String(activeSet?.intro || '').trim();
    const openingFirstLine = overrideFirst || String(activeSet?.firstLine || '').trim();
    if (!openingIntro || !openingFirstLine) {
      if (!silent) dispatchToast('error', '오프닝의 첫 상황/첫 대사를 먼저 입력하거나 자동 생성해주세요.');
      return null;
    }

    // ✅ 진행 턴수(필수) - 50 미만이면 모달/검증에서 막히는 게 맞음
    const sim = (ss && typeof ss?.sim_options === 'object' && ss.sim_options) ? ss.sim_options : {};
    const maxTurnsOverrideRaw = Number(options?.max_turns ?? options?.maxTurns ?? 0);
    const maxTurnsBaseRaw = Number(sim?.max_turns ?? 200);
    const maxTurns = (Number.isFinite(maxTurnsOverrideRaw) && maxTurnsOverrideRaw >= 50)
      ? Math.floor(maxTurnsOverrideRaw)
      : (Number.isFinite(maxTurnsBaseRaw) ? Math.floor(maxTurnsBaseRaw) : 0);
    if (!maxTurns || maxTurns < 50) {
      if (!silent) dispatchToast('error', '프로필에서 진행 턴수를 50턴 이상으로 선택/입력해주세요.');
      return null;
    }

    try {
      // ✅ 원문 저장 (취소 시 복구용)
      const existingEvents = Array.isArray(activeSet?.turn_events) ? activeSet.turn_events : [];
      turnEventsAutoGenPrevRef.current = existingEvents;
      quickTurnEventsGenAbortRef.current = false;

      setQuickTurnEventsGenLoadingId(sid);
      // ✅ 요구사항: "위저드만" 제미니 고정(다른 화면/로직에는 영향 주지 않음)
      const aiModel = useNormalCreateWizard
        ? 'gemini'
        : (String(user?.preferred_model || 'claude').trim().toLowerCase() || 'claude');
      const simDatingElements = !!sim?.sim_dating_elements;
      const res = await charactersAPI.quickGenerateTurnEventsDraft({
        name,
        description: desc,
        world_setting: world,
        opening_intro: openingIntro,
        opening_first_line: openingFirstLine,
        mode,
        max_turns: maxTurns,
        sim_dating_elements: (mode === 'simulator' ? simDatingElements : undefined),
        tags: Array.isArray(selectedTagSlugs) ? selectedTagSlugs : [],
        ai_model: (aiModel === 'gpt' ? 'gpt' : (aiModel === 'gemini' ? 'gemini' : 'claude')),
      });

      // ✅ 취소됐으면 결과 반영 안 함
      if (quickTurnEventsGenAbortRef.current) {
        return null;
      }

      const rawEvents = Array.isArray(res?.data?.turn_events) ? res.data.turn_events : [];
      if (!rawEvents.length) {
        if (!silent) dispatchToast('error', '사건 생성 결과가 비어있습니다. 잠시 후 다시 시도해주세요.');
        return null;
      }

      // ✅ 방어적 정규화(타입/누락/길이/턴 범위)
      const clip = (v, mx) => {
        try {
          const s = String(v ?? '');
          return s.length > mx ? s.slice(0, mx) : s;
        } catch (_) {
          return '';
        }
      };
      const normalized = rawEvents.map((ev, idx) => {
        const id = String(ev?.id || '').trim() || `ev_${Date.now()}_${idx + 1}`;
        const title = clip(String(ev?.title || ''), 30);
        const summary = clip(String(ev?.summary || ''), 200);
        const rn = clip(String(ev?.required_narration || ''), 1000);
        const rd = clip(String(ev?.required_dialogue || ''), 500);
        const aboutRaw = Number(ev?.about_turn);
        let about = Number.isFinite(aboutRaw) ? Math.floor(aboutRaw) : '';
        if (about !== '') {
          about = Math.max(1, about);
          about = Math.min(maxTurns, about);
        }
        return {
          id,
          title,
          about_turn: about,
          summary,
          required_narration: rn,
          required_dialogue: rd,
        };
      });

      // 기존 사건이 있으면 덮어쓰기 확인
      const existing = Array.isArray(activeSet?.turn_events) ? activeSet.turn_events : [];
      if (existing.length > 0) {
        if (skipOverwrite) {
          return { skipped: true, reason: 'existing' };
        }
        try { setTurnEventsGenPendingSetId(sid); } catch (_) {}
        try { setTurnEventsGenPendingEvents(normalized); } catch (_) {}
        try { setTurnEventsGenConfirmOpen(true); } catch (_) {}
        return { skipped: true, reason: 'confirm_required' };
      }

      updateStartSets((prev) => {
        const cur = (prev && typeof prev === 'object') ? prev : {};
        const curItems = Array.isArray(cur.items) ? cur.items : [];
        const nextItems = curItems.map((x) => {
          const xid = String(x?.id || '').trim();
          if (xid !== sid) return x;
          return { ...(x || {}), turn_events: normalized };
        });
        const nextSelected = String(cur.selectedId || '').trim() || sid;
        return { ...cur, selectedId: nextSelected, items: nextItems };
      });
      if (!silent) dispatchToast('success', '턴수별 사건이 자동 생성되었습니다. 내용을 확인해주세요.');
      return { turn_events: normalized };
    } catch (e) {
      console.error('[CreateCharacterPage] quick-generate-turn-events failed:', e);
      if (!silent) dispatchToast('error', '턴수별 사건 자동 생성에 실패했습니다. 잠시 후 다시 시도해주세요.');
      return null;
    } finally {
      setQuickTurnEventsGenLoadingId('');
    }
  }, [quickTurnEventsGenLoadingId, formData, selectedTagSlugs, user, updateStartSets, inferAutoGenModeFromCharacterTypeAndWorld]);

  const handleNextStepAutoFill = useCallback(async () => {
    /**
     * ✅ 다음단계 자동완성(요구사항)
     *
     * 의도/원리:
     * - 사용자가 현재 단계의 최소 입력을 마치면, "다음 단계"로 이동하면서
     *   다음 단계에서 자동생성이 가능한 항목만 1회 채운다.
     * - 경쟁사 UX처럼 진행 모달을 띄워, "무엇을 작성 중인지"와 진행률을 보여준다.
     *
     * 방어:
     * - 동시 실행 방지(중복 API 호출/데이터 경합 방지)
     * - 자동생성 불가 단계(이미지/설정집/옵션 등)는 안내만 하고 종료
     *
     * ⚠️ 중요:
     * - 이 함수는 오프닝/턴사건/디테일 자동생성 핸들러들을 참조한다.
     *   (TDZ 방지) 반드시 해당 핸들러 선언 이후에 위치해야 한다.
     */
    if (!useNormalCreateWizard) return;
    if (nextStepAutoFillRunningRef.current) return;
    try {
      // 다음 단계가 없으면 종료
      if (wizardStepIndex >= NORMAL_CREATE_WIZARD_STEPS.length - 1) {
        dispatchToast('error', '이미 마지막 단계입니다.');
        return;
      }

      nextStepAutoFillRunningRef.current = true;
      setNextStepAutoFillError('');
      setNextStepAutoFillProgress(0);
      setNextStepAutoFillLabel('다음 단계 자동완성 준비 중...');
      setNextStepAutoFillOpen(true);
      setNextStepAutoFillSummaryLines([]);

      // ✅ blur 강제(다음단계 이동 전 커밋 보장)
      try {
        const el = (typeof document !== 'undefined') ? document.activeElement : null;
        if (el && typeof el.blur === 'function') el.blur();
      } catch (_) {}

      const nextIdx = Math.min(NORMAL_CREATE_WIZARD_STEPS.length - 1, wizardStepIndex + 1);
      const nextId = String(NORMAL_CREATE_WIZARD_STEPS[nextIdx]?.id || '').trim();
      if (!nextId) {
        dispatchToast('error', '다음 단계를 찾을 수 없습니다.');
        setNextStepAutoFillError('next_step_not_found');
        setNextStepAutoFillProgress(100);
        return;
      }

      // ✅ UX(수정): 자동완성은 "채우기"만 수행하고, 단계 이동은 자동으로 하지 않는다.
      // - 이유: 자동완성 대상이 없는 단계(이미지/옵션 등)에서 버튼을 누르면 빈 단계를 스킵해버리는 문제가 발생함.
      // - 사용자는 자동완성 완료 후 '다음단계' 버튼으로 직접 이동한다.

      // 단계별 자동완성 실행
      if (nextId === 'prompt') {
        // ✅ 한 글자라도 입력 흔적이 있으면 자동완성 금지
        const existing = String(formData?.basic_info?.world_setting || '').trim();
        if (existing) {
          try { setNextStepAutoFillSummaryLines((prev) => [...(Array.isArray(prev) ? prev : []), '프롬프트: 기존 입력 감지로 자동완성 생략']); } catch (_) {}
          setNextStepAutoFillProgress(100);
          setNextStepAutoFillLabel('이미 입력된 프롬프트가 있어 자동완성을 생략했어요.');
          return;
        }

        setNextStepAutoFillLabel('프롬프트 자동 생성 중...');
        setNextStepAutoFillProgress(15);
        const pr = await handleAutoGeneratePromptOnlyForNextStepAutoFill();
        if (pr && pr?.prompt) {
          try { setNextStepAutoFillSummaryLines((prev) => [...(Array.isArray(prev) ? prev : []), '프롬프트 자동 생성']); } catch (_) {}
          setNextStepAutoFillProgress(100);
          setNextStepAutoFillLabel('완료되었습니다. 내용을 확인해주세요.');
          return;
        }
        if (pr && pr?.skipped) {
          try { setNextStepAutoFillSummaryLines((prev) => [...(Array.isArray(prev) ? prev : []), '프롬프트: 기존 입력 감지로 자동완성 생략']); } catch (_) {}
          setNextStepAutoFillProgress(100);
          setNextStepAutoFillLabel('이미 입력된 프롬프트가 있어 자동완성을 생략했어요.');
          return;
        }

        setNextStepAutoFillError('prompt_autofill_failed');
        setNextStepAutoFillProgress(100);
        setNextStepAutoFillLabel('프롬프트 자동완성에 실패했습니다. 잠시 후 다시 시도해주세요.');
        return;
      }

      if (nextId === 'image') {
        // ✅ 자동완성 대상 없음 → 안내만 (단계 이동 금지)
        setNextStepAutoFillProgress(100);
        setNextStepAutoFillLabel('다음 단계(이미지)는 자동완성할 항목이 없어요. 직접 업로드 후 “다음단계”를 눌러주세요.');
        return;
      }

      if (nextId === 'first_start') {
        // 선택 오프닝(세트) 1개만 자동 생성
        setNextStepAutoFillLabel('오프닝 자동완성 확인 중...');
        setNextStepAutoFillProgress(15);
        const ss = (formData?.basic_info?.start_sets && typeof formData.basic_info.start_sets === 'object')
          ? formData.basic_info.start_sets
          : null;
        const items = Array.isArray(ss?.items) ? ss.items : [];
        const sel = String(ss?.selectedId || '').trim() || String(items?.[0]?.id || '').trim();
        if (!sel) {
          setNextStepAutoFillError('start_set_not_found');
          setNextStepAutoFillProgress(100);
          setNextStepAutoFillLabel('오프닝(시작 설정)이 없어 자동완성을 진행할 수 없습니다.');
          return;
        }

        const active = items.find((x) => String(x?.id || '').trim() === sel) || items[0] || {};
        const introExisting = String(active?.intro || '').trim();
        const firstExisting = String(active?.firstLine || '').trim();
        const turnEventsExisting = Array.isArray(active?.turn_events) ? active.turn_events : [];
        const hasTrace = !!(introExisting || firstExisting || (turnEventsExisting.length > 0));

        // ✅ 한 글자라도 입력 흔적이 있으면(오프닝/턴사건 포함) 자동완성 금지
        if (hasTrace) {
          try { setNextStepAutoFillSummaryLines((prev) => [...(Array.isArray(prev) ? prev : []), '오프닝: 기존 입력 감지로 자동완성 생략']); } catch (_) {}
          setNextStepAutoFillProgress(100);
          setNextStepAutoFillLabel('이미 입력된 값이 있어 오프닝 자동완성을 생략했어요.');
          return;
        }

        setNextStepAutoFillLabel('오프닝(첫 상황/첫 대사) 자동 생성 중...');
        setNextStepAutoFillProgress(25);
        const firstRes = await handleAutoGenerateFirstStart(sel);
        if (!firstRes || !String(firstRes?.intro || '').trim() || !String(firstRes?.firstLine || '').trim()) {
          setNextStepAutoFillError('first_start_failed');
          setNextStepAutoFillProgress(100);
          setNextStepAutoFillLabel('오프닝 자동완성에 실패했습니다. 잠시 후 다시 시도해주세요.');
          return;
        }
        try { setNextStepAutoFillSummaryLines((prev) => [...(Array.isArray(prev) ? prev : []), '오프닝(첫 상황/첫 대사) 자동 생성']); } catch (_) {}

        // ✅ 연쇄: 오프닝 생성 직후 턴수별 사건까지 자동 생성(덮어쓰기 방지)
        setNextStepAutoFillLabel('턴수별 사건 자동 생성 중...');
        setNextStepAutoFillProgress(65);
        const sim = (ss && typeof ss?.sim_options === 'object' && ss.sim_options) ? ss.sim_options : {};
        const maxTurnsRaw = Number(sim?.max_turns ?? 200);
        const maxTurns = Number.isFinite(maxTurnsRaw) ? Math.floor(maxTurnsRaw) : 200;
        const turnRes = await handleAutoGenerateTurnEvents(sel, {
          opening_intro: String(firstRes.intro || '').trim(),
          opening_first_line: String(firstRes.firstLine || '').trim(),
          max_turns: Math.max(50, maxTurns || 200),
          skipOverwrite: true,
          silent: true,
        });
        if (turnRes && turnRes?.turn_events && Array.isArray(turnRes.turn_events)) {
          try { setNextStepAutoFillSummaryLines((prev) => [...(Array.isArray(prev) ? prev : []), `턴수별 사건 자동 생성 (${turnRes.turn_events.length}개)`]); } catch (_) {}
        } else if (turnRes && turnRes?.skipped) {
          try { setNextStepAutoFillSummaryLines((prev) => [...(Array.isArray(prev) ? prev : []), '턴수별 사건: 기존 값 유지(자동생성 생략)']); } catch (_) {}
        } else {
          try { setNextStepAutoFillSummaryLines((prev) => [...(Array.isArray(prev) ? prev : []), '턴수별 사건: 자동생성 실패(수동으로 진행 가능)']); } catch (_) {}
        }

        setNextStepAutoFillProgress(100);
        setNextStepAutoFillLabel('완료되었습니다. 내용을 확인해주세요.');
        return;
      }

      if (nextId === 'detail') {
        // ✅ 한 글자라도 입력 흔적이 있으면 자동완성 금지
        const hasPersonality = !!String(formData?.basic_info?.personality || '').trim();
        const hasSpeech = !!String(formData?.basic_info?.speech_style || '').trim();
        const hasChips = (() => {
          try {
            const i = Array.isArray(detailPrefs?.interests) ? detailPrefs.interests : [];
            const l = Array.isArray(detailPrefs?.likes) ? detailPrefs.likes : [];
            const d = Array.isArray(detailPrefs?.dislikes) ? detailPrefs.dislikes : [];
            return [...i, ...l, ...d].some((x) => String(x || '').trim());
          } catch (_) {
            return false;
          }
        })();
        if (hasPersonality || hasSpeech || hasChips) {
          try { setNextStepAutoFillSummaryLines((prev) => [...(Array.isArray(prev) ? prev : []), '디테일: 기존 입력 감지로 자동완성 생략']); } catch (_) {}
          setNextStepAutoFillProgress(100);
          setNextStepAutoFillLabel('이미 입력된 디테일이 있어 자동완성을 생략했어요.');
          return;
        }

        setNextStepAutoFillLabel('디테일(성격/말투/키워드) 자동 생성 중...');
        setNextStepAutoFillProgress(20);
        await handleAutoGenerateDetail();
        try { setNextStepAutoFillSummaryLines((prev) => [...(Array.isArray(prev) ? prev : []), '디테일(성격/말투/키워드) 자동 생성']); } catch (_) {}
        setNextStepAutoFillProgress(100);
        setNextStepAutoFillLabel('완료되었습니다. 내용을 확인해주세요.');
        return;
      }

      if (nextId === 'stat') {
        /**
         * ✅ 스탯 단계 자동완성(요구사항)
         *
         * 동작:
         * - 1) 프롬프트에 스탯 블록이 있으면 → 그 블록을 파싱해서 스탯 탭을 채운다.
         * - 2) 없으면(수동 프롬프트 등) → 프로필/태그/프롬프트(+작품컨셉/오프닝 참고)로 스탯을 생성해 채운다.
         *
         * 주의:
         * - 스탯은 start_sets(오프닝 단위)에 저장된다.
         */
        const nm = String(formData?.basic_info?.name || '').trim();
        const ds = String(formData?.basic_info?.description || '').trim();
        const wd = String(formData?.basic_info?.world_setting || '').trim();
        if (!nm || !ds || !wd) {
          setNextStepAutoFillError('stat_prereq_missing');
          setNextStepAutoFillProgress(100);
          setNextStepAutoFillLabel('프로필/프롬프트를 먼저 완성해주세요.');
          return;
        }

        // 현재 오프닝(세트) 찾기
        const ss = (formData?.basic_info?.start_sets && typeof formData.basic_info.start_sets === 'object')
          ? formData.basic_info.start_sets
          : null;
        const items = Array.isArray(ss?.items) ? ss.items : [];
        const sel = String(ss?.selectedId || '').trim() || String(items?.[0]?.id || '').trim();
        const active = items.find((x) => String(x?.id || '').trim() === sel) || items[0] || {};
        const activeId = String(active?.id || '').trim() || sel;
        if (!activeId) {
          setNextStepAutoFillError('stat_opening_missing');
          setNextStepAutoFillProgress(100);
          setNextStepAutoFillLabel('오프닝(시작 설정)이 없어 스탯 자동완성을 진행할 수 없습니다.');
          return;
        }

        // ✅ 한 글자라도 입력 흔적이 있으면 자동완성 금지(운영 안전)
        const existingStats = (active?.stat_settings && typeof active.stat_settings === 'object' && Array.isArray(active.stat_settings.stats))
          ? active.stat_settings.stats
          : [];
        const hasAnyText = (v) => { try { return !!String(v ?? '').trim(); } catch (_) { return false; } };
        const hasExistingTrace = (Array.isArray(existingStats) ? existingStats : []).some((s) => hasAnyText(s?.name) || hasAnyText(s?.description));
        if (hasExistingTrace) {
          try { setNextStepAutoFillSummaryLines((prev) => [...(Array.isArray(prev) ? prev : []), '스탯: 기존 입력 감지로 자동완성 생략']); } catch (_) {}
          setNextStepAutoFillProgress(100);
          setNextStepAutoFillLabel('이미 입력된 스탯이 있어 자동완성을 생략했어요.');
          return;
        }

        setNextStepAutoFillLabel('스탯 자동완성 확인 중...');
        setNextStepAutoFillProgress(15);

        // 1) 프롬프트의 스탯 블록이 있으면 파싱해서 적용
        const parsedFromPrompt = extractStatsFromPromptStatsBlock(wd);
        if (parsedFromPrompt.length) {
          updateStartSets((prev) => {
            const cur = (prev && typeof prev === 'object') ? prev : {};
            const curItems = Array.isArray(cur.items) ? cur.items : [];
            const nextItems = curItems.map((it, idx) => {
              const iid = String(it?.id || '').trim() || `set_${idx + 1}`;
              if (iid !== activeId) return it;
              const base = (it && typeof it === 'object') ? it : {};
              const st = (base.stat_settings && typeof base.stat_settings === 'object') ? base.stat_settings : {};
              return { ...base, stat_settings: { ...st, stats: parsedFromPrompt.slice(0, HARD_MAX_STATS_PER_OPENING) } };
            });
            return { ...cur, items: nextItems };
          });
          // ✅ 프롬프트 블록 기준으로 채운 것이므로 dirty 해제
          try { setStatsDirtyByStartSetId((prev) => ({ ...(prev || {}), [activeId]: false })); } catch (_) {}
          try { setNextStepAutoFillSummaryLines((prev) => [...(Array.isArray(prev) ? prev : []), '스탯: 프롬프트 스탯 블록으로 자동 채움']); } catch (_) {}
          setNextStepAutoFillProgress(100);
          setNextStepAutoFillLabel('완료되었습니다. 스탯 탭에서 내용을 확인해주세요.');
          return;
        }

        // 2) 없으면 서버에서 스탯 초안 생성
        setNextStepAutoFillLabel('스탯(프롬프트 기반) 자동 생성 중...');
        setNextStepAutoFillProgress(40);
        try {
          const promptType = String(formData?.basic_info?.character_type || 'roleplay').trim();
          const mode = inferAutoGenModeFromCharacterTypeAndWorld(promptType, wd);
          const openingIntro = String(active?.intro || '').trim();
          const openingFirstLine = String(active?.firstLine || '').trim();
          const concept = (() => {
            try {
              const pc = (ss && typeof ss.profile_concept === 'object' && ss.profile_concept) ? ss.profile_concept : null;
              const enabled = !!pc?.enabled;
              if (!enabled) return '';
              return String(pc?.text || '').trim().slice(0, PROFILE_CONCEPT_MAX_LEN);
            } catch (_) {
              return '';
            }
          })();
          const worldForStat = (() => {
            const parts = [wd];
            if (concept) parts.push(`[작품 컨셉(추가 참고)]\n${concept}`);
            if (openingIntro || openingFirstLine) {
              parts.push('[오프닝(추가 참고)]');
              if (openingIntro) parts.push(`- 첫 상황: ${openingIntro}`);
              if (openingFirstLine) parts.push(`- 첫 대사: ${openingFirstLine}`);
            }
            return parts.filter(Boolean).join('\n\n').slice(0, 6000);
          })();

          const statRes = await charactersAPI.quickGenerateStatDraft({
            name: nm,
            description: ds,
            world_setting: worldForStat,
            mode,
            tags: Array.isArray(selectedTagSlugs) ? selectedTagSlugs : [],
            ai_model: (useNormalCreateWizard ? 'gemini' : (String(user?.preferred_model || 'claude').trim().toLowerCase() || 'claude')),
          });

          const raw = Array.isArray(statRes?.data?.stats) ? statRes.data.stats : [];
          const normalized = raw
            .map((s, idx) => ({
              id: String(s?.id || '').trim() || `stat_${Date.now()}_${Math.random().toString(16).slice(2, 7)}_${idx}`,
              name: String(s?.name || '').trim().slice(0, 20),
              min_value: Number.isFinite(Number(s?.min_value)) ? Number(s.min_value) : '',
              max_value: Number.isFinite(Number(s?.max_value)) ? Number(s.max_value) : '',
              base_value: Number.isFinite(Number(s?.base_value)) ? Number(s.base_value) : '',
              unit: String(s?.unit || '').trim().slice(0, 10),
              description: String(s?.description || '').trim().slice(0, 200),
            }))
            .filter((s) => s.name && s.description)
            .slice(0, HARD_MAX_STATS_PER_OPENING);

          if (!normalized.length) {
            setNextStepAutoFillError('stat_generate_empty');
            setNextStepAutoFillProgress(100);
            setNextStepAutoFillLabel('스탯 생성 결과가 비어있습니다. 스탯 탭에서 “프롬프트의 스탯 블록을 스탯에 적용” 또는 수동 입력으로 진행해주세요.');
            return;
          }

          updateStartSets((prev) => {
            const cur = (prev && typeof prev === 'object') ? prev : {};
            const curItems = Array.isArray(cur.items) ? cur.items : [];
            const nextItems = curItems.map((it, idx) => {
              const iid = String(it?.id || '').trim() || `set_${idx + 1}`;
              if (iid !== activeId) return it;
              const base = (it && typeof it === 'object') ? it : {};
              const st = (base.stat_settings && typeof base.stat_settings === 'object') ? base.stat_settings : {};
              return { ...base, stat_settings: { ...st, stats: normalized } };
            });
            return { ...cur, items: nextItems };
          });
          // ✅ 자동완성 직후 1회: 프롬프트에도 스탯 블록을 함께 삽입(일관 UX)
          try {
            const nextPrompt = syncStatsIntoPromptText(wd, normalized);
            const nextText = String(nextPrompt || '').trim() ? String(nextPrompt || '') : wd;
            setFormData((prev) => ({
              ...prev,
              basic_info: {
                ...prev.basic_info,
                world_setting: nextText.slice(0, 6000),
              },
            }));
          } catch (_) {}

          // ✅ 프롬프트에도 동일 내용이 반영되었으므로 dirty 해제
          try { setStatsDirtyByStartSetId((prev) => ({ ...(prev || {}), [activeId]: false })); } catch (_) {}

          try {
            setNextStepAutoFillSummaryLines((prev) => [
              ...(Array.isArray(prev) ? prev : []),
              `스탯: 자동 생성 (${normalized.length}개)`,
              '프롬프트: 스탯 블록 자동 반영',
            ]);
          } catch (_) {}
          setNextStepAutoFillProgress(100);
          setNextStepAutoFillLabel('완료되었습니다. 프롬프트/스탯 탭에서 내용을 확인해주세요.');
          return;
        } catch (eStat) {
          try { console.error('[CreateCharacterPage] stat autofill failed:', eStat); } catch (_) {}
          setNextStepAutoFillError('stat_autofill_failed');
          setNextStepAutoFillProgress(100);
          setNextStepAutoFillLabel('스탯 자동완성에 실패했습니다. 잠시 후 다시 시도해주세요.');
          return;
        }
        // no-op
        return;
      }

      if (nextId === 'setting_book') {
        // ✅ 자동완성 대상 없음 → 그냥 이동(모달로 방해하지 않음)
        try { setNextStepAutoFillOpen(false); } catch (_) {}
        return;
      }

      if (nextId === 'ending') {
        /**
         * ✅ 엔딩 자동완성(요구사항)
         *
         * 원리:
         * - 오프닝(첫 상황/첫대사)이 이미 만들어진 상태에서,
         *   오프닝당 엔딩 2개를 자동 생성한다. (제목/기본조건/힌트/턴 + 에필로그)
         *
         * 방어:
         * - 기존 엔딩이 있으면 "비어있는 경우만" 채운다(덮어쓰기 방지).
         */
        const nm = String(formData?.basic_info?.name || '').trim();
        const ds = String(formData?.basic_info?.description || '').trim();
        const wd = String(formData?.basic_info?.world_setting || '').trim();
        if (!nm || !ds || !wd) {
          setNextStepAutoFillError('ending_prereq_missing');
          setNextStepAutoFillProgress(100);
          setNextStepAutoFillLabel('프로필/프롬프트를 먼저 완성해주세요.');
          return;
        }

        const ss = (formData?.basic_info?.start_sets && typeof formData.basic_info.start_sets === 'object')
          ? formData.basic_info.start_sets
          : null;
        const items = Array.isArray(ss?.items) ? ss.items : [];
        const sel = String(ss?.selectedId || '').trim() || String(items?.[0]?.id || '').trim();
        const active = items.find((x) => String(x?.id || '').trim() === sel) || items[0] || {};
        const openingIntro = String(active?.intro || '').trim();
        const openingFirstLine = String(active?.firstLine || '').trim();
        if (!openingIntro || !openingFirstLine) {
          setNextStepAutoFillError('opening_missing');
          setNextStepAutoFillProgress(100);
          setNextStepAutoFillLabel('오프닝(첫 상황/첫 대사)을 먼저 생성/입력해주세요.');
          return;
        }

        const sim = (ss && typeof ss?.sim_options === 'object' && ss.sim_options) ? ss.sim_options : {};
        const maxTurnsRaw = Number(sim?.max_turns ?? 200);
        const maxTurns = Number.isFinite(maxTurnsRaw) ? Math.floor(maxTurnsRaw) : 200;
        const es = (active?.ending_settings && typeof active.ending_settings === 'object') ? active.ending_settings : {};
        const minTurnsRaw = Number(es?.min_turns ?? 30);
        const minTurns = Number.isFinite(minTurnsRaw) ? Math.max(10, Math.floor(minTurnsRaw)) : 30;

        // ✅ 요구사항: "위저드만" 제미니 고정(다른 화면/로직에는 영향 주지 않음)
        const aiModel = useNormalCreateWizard
          ? 'gemini'
          : (String(user?.preferred_model || 'claude').trim().toLowerCase() || 'claude');
        const model = (aiModel === 'gpt' ? 'gpt' : (aiModel === 'gemini' ? 'gemini' : 'claude'));

        const WANT_ENDINGS = 2;
        const existingEnds = Array.isArray(active?.ending_settings?.endings) ? active.ending_settings.endings : [];
        const hasAnyText = (v) => {
          try { return !!String(v ?? '').trim(); } catch (_) { return false; }
        };
        const hasAnyEndingTrace = (() => {
          try {
            return (Array.isArray(existingEnds) ? existingEnds : []).some((e) => {
              // ✅ 한 글자라도 입력 흔적이 있으면 자동완성 금지(요구사항)
              return !!(hasAnyText(e?.title) || hasAnyText(e?.base_condition) || hasAnyText(e?.hint) || hasAnyText(e?.epilogue));
            });
          } catch (_) {
            return false;
          }
        })();
        if (hasAnyEndingTrace) {
          try { setNextStepAutoFillSummaryLines((prev) => [...(Array.isArray(prev) ? prev : []), '엔딩: 기존 입력 감지로 자동완성 생략']); } catch (_) {}
          setNextStepAutoFillProgress(100);
          setNextStepAutoFillLabel('이미 입력된 값이 있어 엔딩 자동완성을 생략했어요.');
          return;
        }

        const clampTurn = (t) => {
          try {
            const v = Number(t);
            const n = Number.isFinite(v) ? Math.floor(v) : 0;
            if (!n) return Math.max(minTurns, Math.min(maxTurns, minTurns));
            return Math.max(minTurns, Math.min(maxTurns, n));
          } catch (_) {
            return Math.max(minTurns, Math.min(maxTurns, minTurns));
          }
        };
        const genEndingId = () => {
          try { return `ending_${Date.now()}_${Math.random().toString(16).slice(2, 7)}`; }
          catch (_) { return `ending_${Date.now()}`; }
        };

        const built = [];
        for (let idx = 0; idx < WANT_ENDINGS; idx += 1) {
          const base = (existingEnds[idx] && typeof existingEnds[idx] === 'object') ? existingEnds[idx] : null;
          const baseId = String(base?.id || '').trim() || genEndingId();
          const baseTitle = String(base?.title || '').trim();
          const baseCond = String(base?.base_condition || '').trim();
          const baseHint = String(base?.hint || '').trim();
          const baseEpilogue = String(base?.epilogue || '').trim();
          const baseExtra = Array.isArray(base?.extra_conditions) ? base.extra_conditions : [];

          // 1) 제목/조건이 비어있으면 초안 생성
          let title = baseTitle;
          let cond = baseCond;
          let hint = baseHint;
          let suggestedTurn = 0;

          if (!title || !cond) {
            setNextStepAutoFillLabel(`엔딩 ${idx + 1}/2 (제목/기본조건) 자동 생성 중...`);
            setNextStepAutoFillProgress(idx === 0 ? 18 : 55);
            // ✅ RP/시뮬 분기(요구사항) + 커스텀 프롬프트 지원
            const mode = inferAutoGenModeFromCharacterTypeAndWorld(formData?.basic_info?.character_type, wd);
            const sim = (formData?.basic_info?.start_sets && typeof formData.basic_info.start_sets === 'object')
              ? formData.basic_info.start_sets?.sim_options
              : null;
            const simDatingElements = !!sim?.sim_dating_elements;
            const draftRes = await charactersAPI.quickGenerateEndingDraft({
              name: nm,
              description: ds,
              world_setting: wd,
              opening_intro: openingIntro,
              opening_first_line: openingFirstLine,
              mode,
              max_turns: Math.max(50, maxTurns || 200),
              min_turns: Math.max(10, minTurns || 30),
              sim_dating_elements: (mode === 'simulator' ? simDatingElements : undefined),
              tags: Array.isArray(selectedTagSlugs) ? selectedTagSlugs : [],
              ai_model: model,
            });
            title = title || String(draftRes?.data?.title || '').trim();
            cond = cond || String(draftRes?.data?.base_condition || '').trim();
            hint = hint || String(draftRes?.data?.hint || '').trim();
            const suggestedTurnRaw = Number(draftRes?.data?.suggested_turn ?? 0);
            suggestedTurn = Number.isFinite(suggestedTurnRaw) ? Math.floor(suggestedTurnRaw) : 0;
            if (!title || !cond) {
              setNextStepAutoFillError('ending_draft_empty');
              setNextStepAutoFillProgress(100);
              setNextStepAutoFillLabel('엔딩 초안 생성 결과가 비어있습니다. 잠시 후 다시 시도해주세요.');
              return;
            }
            try { setNextStepAutoFillSummaryLines((prev) => [...(Array.isArray(prev) ? prev : []), `엔딩 ${idx + 1}: 제목/기본조건 자동 생성`]); } catch (_) {}
          }

          // 2) 에필로그가 비어있으면 생성
          let epilogue = baseEpilogue;
          if (!epilogue) {
            setNextStepAutoFillLabel(`엔딩 ${idx + 1}/2 (에필로그) 자동 생성 중...`);
            setNextStepAutoFillProgress(idx === 0 ? 35 : 72);
            // ✅ RP/시뮬 분기(요구사항) + 커스텀 프롬프트 지원
            const mode2 = inferAutoGenModeFromCharacterTypeAndWorld(formData?.basic_info?.character_type, wd);
            const sim2 = (formData?.basic_info?.start_sets && typeof formData.basic_info.start_sets === 'object')
              ? formData.basic_info.start_sets?.sim_options
              : null;
            const simDatingElements2 = !!sim2?.sim_dating_elements;
            const epRes = await charactersAPI.quickGenerateEndingEpilogueDraft({
              name: nm,
              description: ds,
              world_setting: wd,
              opening_intro: openingIntro,
              opening_first_line: openingFirstLine,
              ending_title: title,
              base_condition: cond,
              hint,
              extra_conditions: baseExtra,
              mode: mode2,
              sim_dating_elements: (mode2 === 'simulator' ? simDatingElements2 : undefined),
              tags: Array.isArray(selectedTagSlugs) ? selectedTagSlugs : [],
              ai_model: model,
            });
            epilogue = String(epRes?.data?.epilogue || '').trim();
            if (!epilogue) {
              try { setNextStepAutoFillSummaryLines((prev) => [...(Array.isArray(prev) ? prev : []), `엔딩 ${idx + 1}: 에필로그 생성 실패(수동 가능)`]); } catch (_) {}
            } else {
              try { setNextStepAutoFillSummaryLines((prev) => [...(Array.isArray(prev) ? prev : []), `엔딩 ${idx + 1}: 에필로그 자동 생성`]); } catch (_) {}
            }
          }

          const turnRaw = (base?.turn != null && base?.turn !== '') ? Number(base.turn) : (suggestedTurn || minTurns);
          const turn = clampTurn(turnRaw);
          built.push({
            id: baseId,
            turn,
            // ✅ 방어: 자동생성 결과도 UI 제한을 넘기지 않게 클램프(엔딩 탭 maxLength와 일치)
            title: String(title || '').slice(0, 20),
            base_condition: String(cond || '').slice(0, 500),
            hint: String(hint || '').slice(0, 20),
            epilogue: String(epilogue || '').slice(0, 1000),
            extra_conditions: baseExtra,
          });
        }

        // ✅ start_sets에 "앞 2개 엔딩"을 보장(기존 데이터는 뒤에 유지)
        setNextStepAutoFillProgress(88);
        updateStartSets((prev) => {
          const cur = (prev && typeof prev === 'object') ? prev : {};
          const curItems = Array.isArray(cur.items) ? cur.items : [];
          const sid = String(cur.selectedId || '').trim() || sel;
          const nextItems = curItems.map((it) => {
            const iid = String(it?.id || '').trim();
            if (iid !== sid) return it;
            const base = (it && typeof it === 'object') ? it : {};
            const curEs = (base.ending_settings && typeof base.ending_settings === 'object') ? base.ending_settings : {};
            const curEnds = Array.isArray(curEs?.endings) ? curEs.endings : [];
            const tail = curEnds.slice(WANT_ENDINGS);
            return {
              ...base,
              ending_settings: {
                ...curEs,
                min_turns: Number.isFinite(Number(curEs?.min_turns)) ? curEs.min_turns : minTurns,
                endings: [...built, ...tail],
              },
            };
          });
          return { ...cur, items: nextItems };
        });

        setNextStepAutoFillProgress(100);
        setNextStepAutoFillLabel('완료되었습니다. 내용을 확인해주세요.');
        return;
      }

      if (nextId === 'options') {
        // ✅ 자동완성 대상 없음 → 안내만 (단계 이동 금지)
        setNextStepAutoFillProgress(100);
        setNextStepAutoFillLabel('다음 단계(옵션)는 자동완성할 항목이 없어요. 필요한 내용을 직접 입력 후 “다음단계”를 눌러주세요.');
        return;
      }

      // 기타 단계(예외): 안내만
      setNextStepAutoFillProgress(100);
      setNextStepAutoFillLabel('이 단계는 자동완성할 항목이 없어요.');
    } catch (e) {
      try { console.error('[CreateCharacterPage] next step auto-fill failed:', e); } catch (_) {}
      setNextStepAutoFillError(String(e?.message || e || 'unknown_error'));
      setNextStepAutoFillProgress(100);
      setNextStepAutoFillLabel('자동완성에 실패했습니다. 잠시 후 다시 시도해주세요.');
      try { dispatchToast('error', '다음단계 자동완성에 실패했습니다.'); } catch (_) {}
    } finally {
      nextStepAutoFillRunningRef.current = false;
    }
  }, [
    useNormalCreateWizard,
    wizardStepIndex,
    NORMAL_CREATE_WIZARD_STEPS,
    formData,
    dispatchToast,
    handleAutoGeneratePromptOnlyForNextStepAutoFill,
    handleAutoGenerateFirstStart,
    handleAutoGenerateTurnEvents,
    handleAutoGenerateDetail,
    selectedTagSlugs,
    user,
    updateStartSets,
    detailPrefs,
  ]);

  const handleAutoGeneratePrompt = useCallback(async (opts) => {
    /**
     * 프롬프트 자동 생성(요구사항):
     * - 프로필(이름/소개) 2개가 모두 입력되어야만 실행한다.
     * - 시뮬레이터/롤플레잉 모드에서만 동작한다. (커스텀은 수동입력)
     * - 생성된 결과를 world_setting(프롬프트)에 채운다.
     */
    if (quickPromptGenLoading) return;
    try {
      const forceOverwrite = opts?.forceOverwrite === true;
      const mode = String(formData?.basic_info?.character_type || 'roleplay').trim();
      if (mode !== 'simulator' && mode !== 'roleplay') {
        dispatchToast('error', '이 모드에서는 자동생성을 사용할 수 없어요.');
        return;
      }

      const name = String(formData?.basic_info?.name || '').trim();
      const desc = String(formData?.basic_info?.description || '').trim();
      if (!name || !desc) {
        dispatchToast('error', '프로필 정보를 먼저 입력해주세요.');
        return;
      }

      // ✅ 덮어쓰기 허용(요구사항): 기존 프롬프트가 있으면 경고 모달 후 진행
      // - 이 버튼은 프롬프트 뿐 아니라 스탯/디테일까지 일부 바뀔 수 있다(올인원 동작).
      const existing = String(formData?.basic_info?.world_setting || '').trim();
      if (existing && !forceOverwrite) {
        openAutoGenOverwriteConfirm(
          '프롬프트(세계관 설정)',
          async () => { await handleAutoGeneratePrompt({ forceOverwrite: true }); }
        );
        return;
      }

      setQuickPromptGenLoading(true);
      setQuickPromptGenSteps(['1/3 프롬프트 생성 준비 중...']);
      quickPromptGenAbortRef.current = false;
      /**
       * ✅ UX(요구사항): 자동생성 버튼을 누르면 즉시 텍스트박스를 비우고 스피너 상태가 체감되게 한다.
       * - 실패 시에는 원문 복구(침묵/유실 금지).
       * - 프롬프트 자동생성은 올인원(스탯/디테일 포함)이므로 모든 필드 백업
       */
      try {
        // 프롬프트 원문 저장
        promptAutoGenPrevWorldRef.current = String(formData?.basic_info?.world_setting || '');
        // 성격/말투 원문 저장
        promptAutoGenPrevPersonalityRef.current = String(formData?.basic_info?.personality || '');
        promptAutoGenPrevSpeechStyleRef.current = String(formData?.basic_info?.speech_style || '');
        // 스탯 원문 저장 (현재 선택된 오프닝의 스탯)
        try {
          const ss = (formData?.basic_info?.start_sets && typeof formData.basic_info.start_sets === 'object')
            ? formData.basic_info.start_sets
            : null;
          const statSettings = ss?.stat_settings;
          promptAutoGenPrevStatsRef.current = (statSettings?.stats && Array.isArray(statSettings.stats))
            ? JSON.parse(JSON.stringify(statSettings.stats))
            : null;
        } catch (_) {
          promptAutoGenPrevStatsRef.current = null;
        }
        // detailPrefs 원문 저장 (interests, likes, dislikes)
        try {
          promptAutoGenPrevDetailPrefsRef.current = detailPrefs
            ? JSON.parse(JSON.stringify(detailPrefs))
            : null;
        } catch (_) {
          promptAutoGenPrevDetailPrefsRef.current = null;
        }
        setFormData((prev) => ({
          ...prev,
          basic_info: {
            ...prev.basic_info,
            world_setting: '',
          },
        }));
      } catch (_) {}
      
      // 중지 체크
      if (quickPromptGenAbortRef.current) {
        // ✅ 취소 시 원문 복구 (원문이 비어있든 안 비어있든)
        try {
          const prevWorld = String(promptAutoGenPrevWorldRef.current || '');
          setFormData((prev) => ({
            ...prev,
            basic_info: {
              ...prev.basic_info,
              world_setting: prevWorld.slice(0, 6000),
            },
          }));
        } catch (_) {}
        setQuickPromptGenLoading(false);
        setQuickPromptGenSteps([]);
        return;
      }
      // ✅ 요구사항: "위저드만" 제미니 고정(다른 화면/로직에는 영향 주지 않음)
      const aiModel = useNormalCreateWizard
        ? 'gemini'
        : (String(user?.preferred_model || 'claude').trim().toLowerCase() || 'claude');
      const ss = (formData?.basic_info?.start_sets && typeof formData.basic_info.start_sets === 'object')
        ? formData.basic_info.start_sets
        : null;
      const sim = (ss && typeof ss.sim_options === 'object' && ss.sim_options) ? ss.sim_options : {};
      const maxTurnsRaw = Number(sim?.max_turns ?? 200);
      const maxTurns = Number.isFinite(maxTurnsRaw) && maxTurnsRaw >= 50 ? Math.floor(maxTurnsRaw) : 200;
      const simDatingElements = !!sim?.sim_dating_elements;
      // ✅ 단계 표시: 프롬프트 생성 중
      setQuickPromptGenSteps(['1/3 프롬프트 생성 중...']);
      
      const res = await charactersAPI.quickGeneratePromptDraft({
        name,
        description: (() => {
          // ✅ 작품 컨셉(선택, 고급): 프롬프트 자동생성에만 참고로 추가한다.
          // - 비필수/옵션이며, 입력되어도 원문을 그대로 전달해 모델 이해를 돕는다.
          try {
            const ss2 = (formData?.basic_info?.start_sets && typeof formData.basic_info.start_sets === 'object')
              ? formData.basic_info.start_sets
              : null;
            const pc = (ss2 && typeof ss2.profile_concept === 'object' && ss2.profile_concept) ? ss2.profile_concept : null;
            const enabled = !!pc?.enabled;
            const concept = enabled ? String(pc?.text || '').trim().slice(0, PROFILE_CONCEPT_MAX_LEN) : '';
            return concept ? `${desc}\n\n[작품 컨셉(추가 참고)]\n${concept}` : desc;
          } catch (_) {
            return desc;
          }
        })(),
        mode: (mode === 'simulator' ? 'simulator' : 'roleplay'),
        max_turns: maxTurns,
        sim_dating_elements: (mode === 'simulator' ? simDatingElements : undefined),
        tags: Array.isArray(selectedTagSlugs) ? selectedTagSlugs : [],
        ai_model: (aiModel === 'gpt' ? 'gpt' : (aiModel === 'gemini' ? 'gemini' : 'claude')),
      });

      // ✅ 단계 표시: 프롬프트 완료
      setQuickPromptGenSteps(['✓ 1/3 프롬프트 생성 완료', '2/3 스탯 처리 중...']);

      const promptText = String(res?.data?.prompt || '').trim();
      if (!promptText) {
        // 방어: 비정상 응답이면 원문 복구
        try {
          const prevWorld = String(promptAutoGenPrevWorldRef.current || '');
          if (prevWorld.trim()) {
            setFormData((prev) => ({
              ...prev,
              basic_info: { ...prev.basic_info, world_setting: prevWorld.slice(0, 6000) },
            }));
          }
        } catch (_) {}
        setQuickPromptGenSteps([]);
        setQuickPromptGenLoading(false);
        dispatchToast('error', '프롬프트 생성 결과가 비어있습니다. 잠시 후 다시 시도해주세요.');
        return;
      }

      setFormData((prev) => ({
        ...prev,
        basic_info: {
          ...prev.basic_info,
          world_setting: promptText.slice(0, 6000),
        },
      }));

      /**
       * ✅ 프롬프트 동기화(스탯 → 프롬프트)
       *
       * 의도/원리:
       * - 스탯은 구조화된 UI(스탯 탭)에서 수정될 수 있으므로, 프롬프트 텍스트와 자동으로 매 순간 동기화하면 충돌이 난다.
       * - 대신 "동기화 버튼" 또는 "자동생성 직후 1회"처럼 명시적인 타이밍에만, 프롬프트의 관리 블록을 갱신한다.
       * - 블록은 마커로 감싸 안전하게 교체한다(사용자 작성 영역 침범 방지).
       */
      // ✅ 스탯 자동 입력(요구사항): 프롬프트 생성 시 '스탯 설정' 탭도 함께 채운다.
      // - 태그칩처럼 "자동입력"되어야 사용자가 수정/검증할 수 있다.
      try {
        const rawStats = Array.isArray(res?.data?.stats) ? res.data.stats : [];
        if (!rawStats.length) {
          // ✅ 요구사항: 프롬프트로부터 스탯을 불러오지 못한 경우 안내(재시도 유도)
          dispatchToast('error', '스탯을 불러오지 못했습니다. 잠시 후 “자동 생성”을 다시 시도해주세요.');
        }
        const normalized = rawStats
          .map((s) => ({
            id: `stat_${Date.now()}_${Math.random().toString(16).slice(2, 7)}`,
            name: String(s?.name || '').trim().slice(0, 20),
            min_value: Number.isFinite(Number(s?.min_value)) ? Number(s.min_value) : '',
            max_value: Number.isFinite(Number(s?.max_value)) ? Number(s.max_value) : '',
            base_value: Number.isFinite(Number(s?.base_value)) ? Number(s.base_value) : '',
            unit: String(s?.unit || '').trim().slice(0, 10),
            description: String(s?.description || '').trim().slice(0, 200),
          }))
          .filter((s) => s.name && s.description)
          .slice(0, HARD_MAX_STATS_PER_OPENING);

        if (normalized.length) {
          // ✅ 자동생성 직후 1회: 프롬프트에도 스탯 블록을 함께 삽입(사용자가 프롬프트에서 확인 가능)
          try {
            const nextPrompt = syncStatsIntoPromptText(promptText, normalized);
            setFormData((prev) => ({
              ...prev,
              basic_info: {
                ...prev.basic_info,
                world_setting: String(nextPrompt || '').slice(0, 6000),
              },
            }));
          } catch (_) {}

          updateStartSets((prev) => {
            const cur = (prev && typeof prev === 'object') ? prev : { selectedId: '', items: [] };
            const curItems = Array.isArray(cur.items) ? cur.items : [];
            if (!curItems.length) return cur;
            const sel = String(cur.selectedId || '').trim() || String(curItems?.[0]?.id || '').trim();
            const nextItems = curItems.map((it) => {
              const iid = String(it?.id || '').trim();
              if (iid !== sel) return it;
              const base = (it && typeof it === 'object') ? it : {};
              const ss = (base.stat_settings && typeof base.stat_settings === 'object') ? base.stat_settings : { stats: [] };
              const existing = Array.isArray(ss.stats) ? ss.stats : [];
              // 방어적/보수적: 기존 스탯이 있으면 이름 기준으로 중복 없이 병합(최대 N)
              const byName = new Map();
              for (const ex of existing) {
                const nm = String(ex?.name || '').trim();
                if (nm && !byName.has(nm)) byName.set(nm, ex);
              }
              for (const nx of normalized) {
                const nm = String(nx?.name || '').trim();
                if (!nm) continue;
                if (!byName.has(nm)) byName.set(nm, nx);
              }
              const merged = Array.from(byName.values()).slice(0, HARD_MAX_STATS_PER_OPENING);
              return { ...base, stat_settings: { ...ss, stats: merged } };
            });
            return { ...cur, items: nextItems };
          });

          // ✅ 자동생성 직후에는 프롬프트에도 동일 내용이 반영되었으므로 dirty 해제
          try {
            const ss2 = (formData?.basic_info?.start_sets && typeof formData.basic_info.start_sets === 'object')
              ? formData.basic_info.start_sets
              : null;
            const items2 = Array.isArray(ss2?.items) ? ss2.items : [];
            const sel = String(ss2?.selectedId || '').trim() || String(items2?.[0]?.id || '').trim();
            if (sel) setStatsDirtyByStartSetId((prev) => ({ ...(prev || {}), [sel]: false }));
          } catch (_) {}
          // ✅ 단계 표시: 스탯 처리 완료
          setQuickPromptGenSteps(['✓ 1/3 프롬프트 생성 완료', '✓ 2/3 스탯 처리 완료']);
        }
      } catch (e3) {
        try { console.error('[CreateCharacterPage] stat auto-fill failed:', e3); } catch (_) {}
        setQuickPromptGenSteps(['✓ 1/3 프롬프트 생성 완료', '⚠ 2/3 스탯 처리 실패']);
      }

      // 중지 체크
      if (quickPromptGenAbortRef.current) {
        // ✅ 취소 시 원문 복구 (원문이 비어있든 안 비어있든)
        try {
          const prevWorld = String(promptAutoGenPrevWorldRef.current || '');
          setFormData((prev) => ({
            ...prev,
            basic_info: {
              ...prev.basic_info,
              world_setting: prevWorld.slice(0, 6000),
            },
          }));
        } catch (_) {}
        setQuickPromptGenLoading(false);
        setQuickPromptGenSteps([]);
        return;
      }
      
      // ✅ 디테일 생성 전 취소 체크 - 취소됐으면 디테일 생성 없이 즉시 종료
      if (quickPromptGenAbortRef.current) {
        setQuickPromptGenLoading(false);
        setQuickPromptGenSteps([]);
        return;
      }
      
      // ✅ 경쟁사 UX: 프롬프트 자동 생성 시 디테일도 함께 자동 생성
      // - 디테일 탭의 "자동 생성" 버튼은 유지하되, 프롬프트 버튼은 올인원으로 동작하게 한다.
      try {
        if (!quickDetailGenLoading) {
          setQuickPromptGenSteps((prev) => {
            const base = Array.isArray(prev) ? prev : [];
            return [...base.filter((s) => !s.includes('3/3')), '3/3 디테일 생성 중...'];
          });
          setQuickDetailGenLoading(true);
          const promptType = String(formData?.basic_info?.character_type || 'roleplay').trim();
          const mode = (promptType === 'simulator' ? 'simulator' : 'roleplay');
          const detailRes = await charactersAPI.quickGenerateDetailDraft({
            name,
            description: desc,
            world_setting: promptText,
            mode,
            section_modes: {
              personality: getEffectiveDetailMode('personality'),
              speech_style: getEffectiveDetailMode('speech_style'),
              interests: getEffectiveDetailMode('interests'),
              likes: getEffectiveDetailMode('likes'),
              dislikes: getEffectiveDetailMode('dislikes'),
            },
            tags: Array.isArray(selectedTagSlugs) ? selectedTagSlugs : [],
            ai_model: (aiModel === 'gpt' ? 'gpt' : (aiModel === 'gemini' ? 'gemini' : 'claude')),
          });
          const d = detailRes?.data || {};
          const nextPersonality = String(d?.personality || '').trim();
          const nextSpeech = String(d?.speech_style || '').trim();
          const interests = Array.isArray(d?.interests) ? d.interests : [];
          const likes = Array.isArray(d?.likes) ? d.likes : [];
          const dislikes = Array.isArray(d?.dislikes) ? d.dislikes : [];

          // 방어적 검증: 비정상 결과면 적용하지 않는다.
          if (nextPersonality && nextSpeech) {
            setFormData((prev) => ({
              ...prev,
              basic_info: {
                ...prev.basic_info,
                personality: nextPersonality.slice(0, 300),
                speech_style: nextSpeech.slice(0, 300),
              },
            }));
          }
          setDetailPrefs({
            interests: interests.slice(0, 3).map((x) => String(x || '').trim()).filter(Boolean),
            likes: likes.slice(0, 3).map((x) => String(x || '').trim()).filter(Boolean),
            dislikes: dislikes.slice(0, 3).map((x) => String(x || '').trim()).filter(Boolean),
          });
          setDetailChipInputs({ interests: '', likes: '', dislikes: '' });
        }
      } catch (e2) {
        console.error('[CreateCharacterPage] quick-generate-detail (via prompt) failed:', e2);
        dispatchToast('error', '디테일 자동 생성에 실패했습니다. 잠시 후 다시 시도해주세요.');
        setQuickPromptGenSteps((prev) => {
          const base = Array.isArray(prev) ? prev : [];
          return [...base.filter((s) => !s.includes('3/3')), '⚠ 3/3 디테일 생성 실패'];
        });
      } finally {
        try { 
          setQuickDetailGenLoading(false);
          // ✅ 단계 표시: 모든 단계 완료 (성공한 경우만)
          setQuickPromptGenSteps((prev) => {
            const base = Array.isArray(prev) ? prev : [];
            const hasFailure = base.some((s) => s.includes('실패') || s.includes('❌') || s.includes('⚠'));
            if (!hasFailure) {
              return ['✓ 1/3 프롬프트 생성 완료', '✓ 2/3 스탯 생성 완료', '✓ 3/3 디테일 생성 완료'];
            }
            return base;
          });
        } catch (_) {}
      }

      dispatchToast('success', '프롬프트/디테일이 자동 생성되었습니다. 내용을 확인해주세요.');
      } catch (e) {
        console.error('[CreateCharacterPage] quick-generate-prompt failed:', e);
        // ✅ 실패 시 원문 복구(유실 방지)
        try {
          const prevWorld = String(promptAutoGenPrevWorldRef.current || '');
          if (prevWorld.trim()) {
            setFormData((prev) => ({
              ...prev,
              basic_info: { ...prev.basic_info, world_setting: prevWorld.slice(0, 6000) },
            }));
          }
        } catch (_) {}
        setQuickPromptGenSteps(['❌ 프롬프트 생성 실패']);
        dispatchToast('error', '프롬프트 자동 생성에 실패했습니다. 잠시 후 다시 시도해주세요.');
      } finally {
        setQuickPromptGenLoading(false);
        // ✅ 완료 후 1초 뒤 단계 표시 초기화 (사용자가 완료 메시지를 볼 수 있게)
        setTimeout(() => {
          setQuickPromptGenSteps([]);
        }, 1000);
      }
  }, [quickPromptGenLoading, quickDetailGenLoading, formData, selectedTagSlugs, user, setDetailPrefs, setDetailChipInputs, getEffectiveDetailMode, openAutoGenOverwriteConfirm]);

  // ✅ 프롬프트 자동생성 취소 핸들러 - 올인원이므로 모든 필드(프롬프트/스탯/성격/말투/디테일) 복구
  const handleCancelPromptGeneration = useCallback(() => {
    try {
      quickPromptGenAbortRef.current = true;
      setQuickPromptGenLoading(false);
      setQuickPromptGenSteps([]);
      
      // ✅ 취소 시 원문 복구 - 프롬프트, 성격, 말투
      const prevWorld = String(promptAutoGenPrevWorldRef.current || '');
      const prevPersonality = String(promptAutoGenPrevPersonalityRef.current || '');
      const prevSpeechStyle = String(promptAutoGenPrevSpeechStyleRef.current || '');
      setFormData((prev) => ({
        ...prev,
        basic_info: {
          ...prev.basic_info,
          world_setting: prevWorld.slice(0, 6000),
          personality: prevPersonality.slice(0, 300),
          speech_style: prevSpeechStyle.slice(0, 300),
        },
      }));
      
      // ✅ 취소 시 원문 복구 - 스탯 (start_sets 내 stat_settings.stats)
      const prevStats = promptAutoGenPrevStatsRef.current;
      if (prevStats !== null) {
        updateStartSets((prev) => {
          const cur = (prev && typeof prev === 'object') ? prev : {};
          const existingStatSettings = (cur.stat_settings && typeof cur.stat_settings === 'object') ? cur.stat_settings : {};
          return {
            ...cur,
            stat_settings: {
              ...existingStatSettings,
              stats: prevStats,
            },
          };
        });
      }
      
      // ✅ 취소 시 원문 복구 - detailPrefs (interests, likes, dislikes)
      const prevDetailPrefs = promptAutoGenPrevDetailPrefsRef.current;
      if (prevDetailPrefs !== null && setDetailPrefs) {
        try {
          setDetailPrefs(prevDetailPrefs);
        } catch (_) {}
      }
      
      // ✅ 취소 시 프리뷰 채팅방 리셋
      try { resetChatPreview(); } catch (_) {}
      
      dispatchToast('info', '프롬프트 자동 생성이 취소되었습니다.');
    } catch (e) {
      try { console.error('[CreateCharacterPage] cancel prompt generation failed:', e); } catch (_) {}
    }
  }, [dispatchToast, updateStartSets, setDetailPrefs, resetChatPreview]);

  // ✅ 프로필 자동생성 취소 핸들러 - 작품명/한줄소개/작품컨셉 모두 복구
  const handleCancelProfileGeneration = useCallback(() => {
    try {
      quickGenAbortRef.current = true;
      setQuickGenLoading(false);
      
      // ✅ 취소 시 원문 복구 (원문이 있든 없든) - 3개 필드 모두
      const prevName = String(profileAutoGenPrevNameRef.current || '');
      const prevDesc = String(profileAutoGenPrevDescRef.current || '');
      const prevConcept = profileAutoGenPrevConceptRef.current; // { enabled, text } | null
      
      setFormData((prev) => ({
        ...prev,
        basic_info: {
          ...prev.basic_info,
          name: prevName.slice(0, 100),
          description: prevDesc.slice(0, 300),
        },
      }));
      
      // ✅ 작품컨셉 원문 복구
      if (prevConcept !== null) {
        updateStartSets((prev) => {
          const cur = (prev && typeof prev === 'object') ? prev : {};
          return {
            ...cur,
            profile_concept: {
              enabled: !!prevConcept.enabled,
              text: String(prevConcept.text || ''),
            },
          };
        });
      }
      
      // ✅ 취소 시 프리뷰 채팅방 리셋
      try { resetChatPreview(); } catch (_) {}
      
      dispatchToast('info', '프로필 자동 생성이 취소되었습니다.');
    } catch (e) {
      try { console.error('[CreateCharacterPage] cancel profile generation failed:', e); } catch (_) {}
    }
  }, [dispatchToast, updateStartSets, resetChatPreview]);

  // ✅ 오프닝(첫시작) 자동생성 취소 핸들러
  const handleCancelFirstStartGeneration = useCallback(() => {
    try {
      quickFirstStartGenAbortRef.current = true;
      const cancelledSetId = quickFirstStartGenLoadingId;
      setQuickFirstStartGenLoadingId('');
      
      // ✅ 취소 시 원문 복구 (원문이 있든 없든)
      const prevIntro = String(firstStartAutoGenPrevIntroRef.current || '');
      const prevFirstLine = String(firstStartAutoGenPrevFirstLineRef.current || '');
      
      if (cancelledSetId) {
        updateStartSets((prev) => {
          const cur = (prev && typeof prev === 'object') ? prev : {};
          const curItems = Array.isArray(cur.items) ? cur.items : [];
          const nextItems = curItems.map((x) => {
            const xid = String(x?.id || '').trim();
            if (xid !== cancelledSetId) return x;
            return { ...(x || {}), intro: prevIntro.slice(0, 2000), firstLine: prevFirstLine.slice(0, 500) };
          });
          return { ...cur, items: nextItems };
        });
      }
      
      // ✅ 취소 시 프리뷰 채팅방 리셋
      try { resetChatPreview(); } catch (_) {}
      
      dispatchToast('info', '오프닝 자동 생성이 취소되었습니다.');
    } catch (e) {
      try { console.error('[CreateCharacterPage] cancel first-start generation failed:', e); } catch (_) {}
    }
  }, [quickFirstStartGenLoadingId, updateStartSets, dispatchToast, resetChatPreview]);

  // ✅ 턴수별 사건 자동생성 취소 핸들러
  const handleCancelTurnEventsGeneration = useCallback(() => {
    try {
      quickTurnEventsGenAbortRef.current = true;
      const cancelledSetId = quickTurnEventsGenLoadingId;
      setQuickTurnEventsGenLoadingId('');
      
      // ✅ 취소 시 원문 복구 (원문이 있든 없든)
      const prevEvents = Array.isArray(turnEventsAutoGenPrevRef.current) ? turnEventsAutoGenPrevRef.current : [];
      
      if (cancelledSetId) {
        updateStartSets((prev) => {
          const cur = (prev && typeof prev === 'object') ? prev : {};
          const curItems = Array.isArray(cur.items) ? cur.items : [];
          const nextItems = curItems.map((x) => {
            const xid = String(x?.id || '').trim();
            if (xid !== cancelledSetId) return x;
            return { ...(x || {}), turn_events: prevEvents };
          });
          return { ...cur, items: nextItems };
        });
      }
      
      // ✅ 취소 시 프리뷰 채팅방 리셋
      try { resetChatPreview(); } catch (_) {}
      
      dispatchToast('info', '턴수별 사건 자동 생성이 취소되었습니다.');
    } catch (e) {
      try { console.error('[CreateCharacterPage] cancel turn-events generation failed:', e); } catch (_) {}
    }
  }, [quickTurnEventsGenLoadingId, updateStartSets, dispatchToast, resetChatPreview]);

  // ✅ 스탯 자동생성 함수 (스탯 탭 전용)
  const handleAutoGenerateStats = useCallback(async (targetSetId, opts) => {
    /**
     * 스탯 자동 생성(요구사항):
     * - 프로필(name/description) + 프롬프트(world_setting)가 있어야 실행한다.
     * - 기존 스탯이 있으면 덮어쓰기 확인 모달을 띄운다.
     * - 프롬프트 기반으로 AI가 스탯을 생성한다.
     */
    const sid = String(targetSetId || '').trim();
    if (!sid) return null;
    if (quickStatsGenLoadingId) return null;

    const options = (opts && typeof opts === 'object') ? opts : {};
    const forceOverwrite = options?.forceOverwrite === true;

    const name = String(formData?.basic_info?.name || '').trim();
    const desc = String(formData?.basic_info?.description || '').trim();
    const world = String(formData?.basic_info?.world_setting || '').trim();
    const promptType = String(formData?.basic_info?.character_type || 'roleplay').trim();
    const mode = inferAutoGenModeFromCharacterTypeAndWorld(promptType, world);

    if (!name || !desc) {
      dispatchToast('error', '프로필 정보를 먼저 입력해주세요.');
      return null;
    }
    if (!world) {
      dispatchToast('error', '프롬프트 정보를 먼저 입력해주세요.');
      return null;
    }

    // start_sets / active opening 찾기
    const ss = (formData?.basic_info?.start_sets && typeof formData.basic_info.start_sets === 'object')
      ? formData.basic_info.start_sets
      : null;
    const items = Array.isArray(ss?.items) ? ss.items : [];
    const activeSet = items.find((x) => String(x?.id || '').trim() === sid) || null;
    
    // 기존 스탯 확인
    const existingStats = (activeSet?.stat_settings && typeof activeSet.stat_settings === 'object' && Array.isArray(activeSet.stat_settings.stats))
      ? activeSet.stat_settings.stats
      : [];
    const hasExisting = existingStats.some((s) => String(s?.name || '').trim() || String(s?.description || '').trim());
    
    if (hasExisting && !forceOverwrite) {
      openAutoGenOverwriteConfirm(
        '스탯',
        async () => { await handleAutoGenerateStats(sid, { forceOverwrite: true }); }
      );
      return null;
    }

    try {
      // ✅ 원문 저장 (취소 시 복구용)
      statsAutoGenPrevRef.current = existingStats;
      quickStatsGenAbortRef.current = false;

      setQuickStatsGenLoadingId(sid);

      // 오프닝 정보 (참고용)
      const openingIntro = String(activeSet?.intro || '').trim();
      const openingFirstLine = String(activeSet?.firstLine || '').trim();
      const concept = (() => {
        try {
          const pc = (ss && typeof ss.profile_concept === 'object' && ss.profile_concept) ? ss.profile_concept : null;
          const enabled = !!pc?.enabled;
          if (!enabled) return '';
          return String(pc?.text || '').trim().slice(0, PROFILE_CONCEPT_MAX_LEN);
        } catch (_) {
          return '';
        }
      })();
      const worldForStat = (() => {
        const parts = [world];
        if (concept) parts.push(`[작품 컨셉(추가 참고)]\n${concept}`);
        if (openingIntro || openingFirstLine) {
          parts.push('[오프닝(추가 참고)]');
          if (openingIntro) parts.push(`- 첫 상황: ${openingIntro}`);
          if (openingFirstLine) parts.push(`- 첫 대사: ${openingFirstLine}`);
        }
        return parts.filter(Boolean).join('\n\n').slice(0, 6000);
      })();

      // ✅ 요구사항: "위저드만" 제미니 고정
      const aiModel = useNormalCreateWizard
        ? 'gemini'
        : (String(user?.preferred_model || 'claude').trim().toLowerCase() || 'claude');

      const statRes = await charactersAPI.quickGenerateStatDraft({
        name,
        description: desc,
        world_setting: worldForStat,
        mode,
        tags: Array.isArray(selectedTagSlugs) ? selectedTagSlugs : [],
        ai_model: (aiModel === 'gpt' ? 'gpt' : (aiModel === 'gemini' ? 'gemini' : 'claude')),
      });

      // ✅ 취소됐으면 결과 반영 안 함
      if (quickStatsGenAbortRef.current) {
        return null;
      }

      const raw = Array.isArray(statRes?.data?.stats) ? statRes.data.stats : [];
      const normalized = raw
        .map((s, idx) => ({
          id: String(s?.id || '').trim() || `stat_${Date.now()}_${Math.random().toString(16).slice(2, 7)}_${idx}`,
          name: String(s?.name || '').trim().slice(0, 20),
          min_value: Number.isFinite(Number(s?.min_value)) ? Number(s.min_value) : '',
          max_value: Number.isFinite(Number(s?.max_value)) ? Number(s.max_value) : '',
          base_value: Number.isFinite(Number(s?.base_value)) ? Number(s.base_value) : '',
          unit: String(s?.unit || '').trim().slice(0, 10),
          description: String(s?.description || '').trim().slice(0, 200),
        }))
        .filter((s) => s.name && s.description)
        .slice(0, HARD_MAX_STATS_PER_OPENING);

      if (!normalized.length) {
        dispatchToast('error', '스탯 생성 결과가 비어있습니다. 잠시 후 다시 시도해주세요.');
        return null;
      }

      // ✅ 스탯 저장 (start_sets.items[].stat_settings.stats)
      updateStartSets((prev) => {
        const cur = (prev && typeof prev === 'object') ? prev : {};
        const curItems = Array.isArray(cur.items) ? cur.items : [];
        const nextItems = curItems.map((it, idx) => {
          const iid = String(it?.id || '').trim() || `set_${idx + 1}`;
          if (iid !== sid) return it;
          const base = (it && typeof it === 'object') ? it : {};
          const st = (base.stat_settings && typeof base.stat_settings === 'object') ? base.stat_settings : {};
          return { ...base, stat_settings: { ...st, stats: normalized } };
        });
        return { ...cur, items: nextItems };
      });

      // ✅ 프롬프트에도 스탯 블록 반영 (일관 UX)
      try {
        const nextPrompt = syncStatsIntoPromptText(world, normalized);
        const nextText = String(nextPrompt || '').trim() ? String(nextPrompt || '') : world;
        setFormData((prev) => ({
          ...prev,
          basic_info: {
            ...prev.basic_info,
            world_setting: nextText.slice(0, 6000),
          },
        }));
      } catch (_) {}

      // ✅ 프롬프트에도 동일 내용이 반영되었으므로 dirty 해제
      try { setStatsDirtyByStartSetId((prev) => ({ ...(prev || {}), [sid]: false })); } catch (_) {}

      dispatchToast('success', '스탯이 자동 생성되었습니다. 내용을 확인해주세요.');
      return { stats: normalized };
    } catch (e) {
      console.error('[CreateCharacterPage] quick-generate-stats failed:', e);
      dispatchToast('error', '스탯 자동 생성에 실패했습니다. 잠시 후 다시 시도해주세요.');
      return null;
    } finally {
      setQuickStatsGenLoadingId('');
    }
  }, [quickStatsGenLoadingId, formData, selectedTagSlugs, user, updateStartSets, openAutoGenOverwriteConfirm, inferAutoGenModeFromCharacterTypeAndWorld, syncStatsIntoPromptText]);

  // ✅ 스탯 자동생성 취소 핸들러
  const handleCancelStatsGeneration = useCallback(() => {
    try {
      quickStatsGenAbortRef.current = true;
      const cancelledSetId = quickStatsGenLoadingId;
      setQuickStatsGenLoadingId('');
      
      // ✅ 취소 시 원문 복구 (원문이 있든 없든)
      const prevStats = Array.isArray(statsAutoGenPrevRef.current) ? statsAutoGenPrevRef.current : [];
      
      if (cancelledSetId) {
        updateStartSets((prev) => {
          const cur = (prev && typeof prev === 'object') ? prev : {};
          const curItems = Array.isArray(cur.items) ? cur.items : [];
          const nextItems = curItems.map((x) => {
            const xid = String(x?.id || '').trim();
            if (xid !== cancelledSetId) return x;
            const base = (x && typeof x === 'object') ? x : {};
            const st = (base.stat_settings && typeof base.stat_settings === 'object') ? base.stat_settings : {};
            return { ...base, stat_settings: { ...st, stats: prevStats } };
          });
          return { ...cur, items: nextItems };
        });
      }
      
      // ✅ 취소 시 프리뷰 채팅방 리셋
      try { resetChatPreview(); } catch (_) {}
      
      dispatchToast('info', '스탯 자동 생성이 취소되었습니다.');
    } catch (e) {
      try { console.error('[CreateCharacterPage] cancel stats generation failed:', e); } catch (_) {}
    }
  }, [quickStatsGenLoadingId, updateStartSets, dispatchToast, resetChatPreview]);

  const handleSyncStatsToPrompt = useCallback(() => {
    /**
     * ✅ 프롬프트 동기화 버튼(요구사항)
     *
     * 의도/원리:
     * - 스탯을 수정한 뒤, 프롬프트 텍스트의 '스탯 설정' 블록을 최신 값으로 갱신한다.
     * - 자동 실시간 동기화는 충돌 위험이 있으므로, 사용자가 버튼으로 명시적으로 실행한다.
     */
    try {
      const ss = (formData?.basic_info?.start_sets && typeof formData.basic_info.start_sets === 'object')
        ? formData.basic_info.start_sets
        : null;
      const items = Array.isArray(ss?.items) ? ss.items : [];
      if (!items.length) {
        dispatchToast('error', '오프닝이 없어 스탯을 동기화할 수 없습니다.');
        return;
      }
      const sel = String(ss?.selectedId || '').trim() || String(items?.[0]?.id || '').trim();
      const picked = items.find((x) => String(x?.id || '').trim() === sel) || items[0] || {};
      const stats = (picked?.stat_settings && typeof picked.stat_settings === 'object' && Array.isArray(picked.stat_settings.stats))
        ? picked.stat_settings.stats
        : [];

      const START = '<!-- CC_STATS_START -->';
      const END = '<!-- CC_STATS_END -->';
      const header = '## 스탯 설정 (자동 동기화)\n';
      const body = (Array.isArray(stats) ? stats : []).map((s) => {
        const nm = String(s?.name || '').trim();
        if (!nm) return null;
        const mn = (s?.min_value === '' || s?.min_value == null) ? '' : String(s.min_value);
        const mx = (s?.max_value === '' || s?.max_value == null) ? '' : String(s.max_value);
        const bv = (s?.base_value === '' || s?.base_value == null) ? '' : String(s.base_value);
        const unit = String(s?.unit || '').trim();
        const desc = String(s?.description || '').trim();
        const range = (mn !== '' && mx !== '') ? `${mn}~${mx}` : '';
        const base = (bv !== '') ? `기본 ${bv}` : '';
        const unitPart = unit ? `(${unit})` : '';
        const meta = [range, base].filter(Boolean).join(', ');
        const metaPart = meta ? ` — ${meta}` : '';
        const descPart = desc ? `\n  - 설명: ${desc}` : '';
        return `- **${nm}** ${unitPart}${metaPart}${descPart}`;
      }).filter(Boolean).join('\n');
      const block = [START, header + (body || '- (스탯 없음)'), END].join('\n');

      const curText = String(formData?.basic_info?.world_setting || '');
      const sIdx = curText.indexOf(START);
      const eIdx = curText.indexOf(END);
      const nextText = (() => {
        if (sIdx >= 0 && eIdx > sIdx) {
          const before = curText.slice(0, sIdx).trimEnd();
          const after = curText.slice(eIdx + END.length).trimStart();
          return [before, block, after].filter(Boolean).join('\n\n').trim().slice(0, 6000);
        }
        return [curText.trim(), block].filter(Boolean).join('\n\n').trim().slice(0, 6000);
      })();

      // ✅ 변경이 없으면 모달 없이 종료
      if (String(nextText || '').trim() === String(curText || '').trim()) {
        dispatchToast('success', '이미 프롬프트에 최신 스탯이 반영되어 있어요.');
        return;
      }
      // ✅ 경고 모달: 동기화는 프롬프트 내용을 변경할 수 있으므로 확인/취소를 받는다.
      setPromptSyncPendingText(nextText);
      setPromptSyncConfirmOpen(true);
    } catch (e) {
      try { console.error('[CreateCharacterPage] sync stats to prompt failed:', e); } catch (_) {}
      try { dispatchToast('error', '프롬프트 동기화에 실패했습니다.'); } catch (_) {}
    }
  }, [formData, dispatchToast]);

  const confirmSyncStatsToPrompt = useCallback(() => {
    try {
      const next = String(promptSyncPendingText || '');
      if (!next.trim()) {
        dispatchToast('error', '동기화할 프롬프트가 비어있습니다.');
        setPromptSyncConfirmOpen(false);
        return;
      }
      setFormData((prev) => ({
        ...prev,
        basic_info: {
          ...prev.basic_info,
          world_setting: next.slice(0, 6000),
        },
      }));

      // ✅ 스탯 → 프롬프트 동기화가 완료되었으므로, 오프닝 단위 dirty 해제
      try {
        const ss = (formData?.basic_info?.start_sets && typeof formData.basic_info.start_sets === 'object')
          ? formData.basic_info.start_sets
          : null;
        const items = Array.isArray(ss?.items) ? ss.items : [];
        const sel = String(ss?.selectedId || '').trim() || String(items?.[0]?.id || '').trim();
        if (sel) setStatsDirtyByStartSetId((prev) => ({ ...(prev || {}), [sel]: false }));
      } catch (_) {}

      setPromptSyncConfirmOpen(false);
      setPromptSyncPendingText('');
      dispatchToast('success', '프롬프트에 스탯이 동기화되었습니다.');
    } catch (e) {
      try { console.error('[CreateCharacterPage] confirm sync stats to prompt failed:', e); } catch (_) {}
      try { dispatchToast('error', '프롬프트 동기화에 실패했습니다.'); } catch (_) {}
    }
  }, [promptSyncPendingText, dispatchToast, formData]);

  const confirmApplyPromptStatsBlockEdit = useCallback(() => {
    /**
     * ✅ 사용자가 "스탯 블록"을 직접 수정/삭제하려는 경우 확인 후 적용
     *
     * 의도/원리:
     * - 스탯 블록은 동기화로 관리되는 영역이라, 실수로 지우면 이후 동기화/검수에 혼선이 생긴다.
     * - 사용자가 의도적으로 삭제/수정을 원한다면 확인 후 적용한다.
     */
    try {
      const next = String(promptStatsBlockGuardPendingText || '');
      if (!next.trim()) {
        dispatchToast('error', '적용할 프롬프트가 비어있습니다.');
        setPromptStatsBlockGuardOpen(false);
        setPromptStatsBlockGuardPendingText('');
        setPromptStatsBlockGuardMode('');
        return;
      }
      setFormData((prev) => ({
        ...prev,
        basic_info: {
          ...prev.basic_info,
          world_setting: next.slice(0, 6000),
        },
      }));
      setPromptStatsBlockGuardOpen(false);
      setPromptStatsBlockGuardPendingText('');
      setPromptStatsBlockGuardMode('');
      dispatchToast('success', '프롬프트 변경이 적용되었습니다.');
    } catch (e) {
      try { console.error('[CreateCharacterPage] confirm apply prompt stats block edit failed:', e); } catch (_) {}
      try { dispatchToast('error', '프롬프트 변경 적용에 실패했습니다.'); } catch (_) {}
    }
  }, [promptStatsBlockGuardPendingText, dispatchToast]);

  const handleApplyPromptStatsToStats = useCallback(() => {
    /**
     * ✅ 프롬프트 → 스탯 적용(요구사항)
     *
     * 의도/원리:
     * - 사용자가 프롬프트 텍스트에서 "스탯 블록"을 직접 수정한 뒤,
     *   스탯 탭에 그 내용을 덮어씌울 수 있어야 한다.
     *
     * 방어:
     * - 파싱 실패/블록 누락 시 토스트로 명확히 안내한다.
     * - 스탯은 운영 안정성을 위해 최대 4개까지만 반영한다(기존 정책 유지).
     */
    try {
      const text = String(formData?.basic_info?.world_setting || '');
      const START = '<!-- CC_STATS_START -->';
      const END = '<!-- CC_STATS_END -->';
      const sIdx = text.indexOf(START);
      const eIdx = text.indexOf(END);
      const has = sIdx >= 0 && eIdx > sIdx;
      if (!has) {
        dispatchToast('error', '프롬프트에 스탯 블록이 없습니다. 먼저 “프롬프트 동기화”로 스탯 블록을 생성해 주세요.');
        return;
      }

      const blockBody = text.slice(sIdx + START.length, eIdx);
      const lines = String(blockBody || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');

      const parsed = [];
      for (let i = 0; i < lines.length; i += 1) {
        const line = String(lines[i] || '').trimEnd();
        const m = line.match(/^- \*\*(.+?)\*\*\s*(\((.*?)\))?\s*(?:—\s*(.*))?$/);
        if (!m) continue;
        const name = String(m[1] || '').trim();
        if (!name) continue;
        const unit = String(m[3] || '').trim();
        const meta = String(m[4] || '').trim();

        let minValue = '';
        let maxValue = '';
        let baseValue = '';
        if (meta) {
          const parts = meta.split(',').map((p) => p.trim()).filter(Boolean);
          for (const p of parts) {
            // range: a~b (음수 허용)
            if (p.includes('~')) {
              const [a, b] = p.split('~').map((x) => String(x || '').trim());
              const na = Number(a);
              const nb = Number(b);
              if (Number.isFinite(na)) minValue = na;
              if (Number.isFinite(nb)) maxValue = nb;
              continue;
            }
            // base: 기본 n
            if (p.startsWith('기본')) {
              const raw = p.replace(/^기본\s*/g, '').trim();
              const nv = Number(raw);
              if (Number.isFinite(nv)) baseValue = nv;
              continue;
            }
          }
        }

        // description: 다음 줄들 중 "설명:" 1개만 사용
        let desc = '';
        if (i + 1 < lines.length) {
          const next = String(lines[i + 1] || '');
          const dm = next.match(/^\s*-\s*설명:\s*(.*)$/);
          if (dm) {
            desc = String(dm[1] || '').trim();
            i += 1; // 소비
          }
        }

        parsed.push({
          id: `stat_${Date.now()}_${Math.random().toString(16).slice(2, 7)}`,
          name,
          min_value: minValue,
          max_value: maxValue,
          base_value: baseValue,
          unit,
          description: desc,
        });
        if (parsed.length >= HARD_MAX_STATS_PER_OPENING) break;
      }

      if (!parsed.length) {
        dispatchToast('error', '프롬프트의 스탯 블록에서 스탯을 읽지 못했습니다. 형식을 확인해주세요.');
        return;
      }

      setPromptApplyStatsPendingStats(parsed);
      setPromptApplyStatsConfirmOpen(true);
    } catch (e) {
      try { console.error('[CreateCharacterPage] apply prompt stats to stats failed:', e); } catch (_) {}
      dispatchToast('error', '스탯에 적용에 실패했습니다. 잠시 후 다시 시도해주세요.');
    }
  }, [formData, dispatchToast]);

  const confirmApplyPromptStatsToStats = useCallback(() => {
    try {
      const pending = Array.isArray(promptApplyStatsPendingStats) ? promptApplyStatsPendingStats : [];
      if (!pending.length) {
        dispatchToast('error', '적용할 스탯이 없습니다.');
        setPromptApplyStatsConfirmOpen(false);
        return;
      }
      const ss = (formData?.basic_info?.start_sets && typeof formData.basic_info.start_sets === 'object')
        ? formData.basic_info.start_sets
        : null;
      const items = Array.isArray(ss?.items) ? ss.items : [];
      if (!items.length) {
        dispatchToast('error', '오프닝이 없어 스탯에 적용할 수 없습니다.');
        setPromptApplyStatsConfirmOpen(false);
        return;
      }
      const sel = String(ss?.selectedId || '').trim() || String(items?.[0]?.id || '').trim();

      updateStartSets((prev) => {
        const cur = (prev && typeof prev === 'object') ? prev : { selectedId: '', items: [] };
        const curItems = Array.isArray(cur.items) ? cur.items : [];
        const nextItems = curItems.map((it) => {
          const iid = String(it?.id || '').trim();
          if (iid !== sel) return it;
          const base = (it && typeof it === 'object') ? it : {};
          const st = (base.stat_settings && typeof base.stat_settings === 'object') ? base.stat_settings : {};
          // ✅ 요구사항: "덮어쓰기"
          return { ...base, stat_settings: { ...st, stats: pending.slice(0, HARD_MAX_STATS_PER_OPENING) } };
        });
        return { ...cur, items: nextItems };
      });

      // ✅ 프롬프트의 스탯 블록을 기준으로 덮어썼으므로, "동기화 필요"는 해제한다.
      try { setStatsDirtyByStartSetId((prev) => ({ ...(prev || {}), [sel]: false })); } catch (_) {}

      setPromptApplyStatsConfirmOpen(false);
      setPromptApplyStatsPendingStats([]);
      dispatchToast('success', '프롬프트의 스탯 블록이 스탯 탭에 적용되었습니다.');
    } catch (e) {
      try { console.error('[CreateCharacterPage] confirm apply prompt stats to stats failed:', e); } catch (_) {}
      dispatchToast('error', '스탯에 적용에 실패했습니다.');
    }
  }, [formData, promptApplyStatsPendingStats, updateStartSets, dispatchToast]);
  const handleAutoGenerateProfile = useCallback(async () => {
    /**
     * 프로필 자동 생성(요구사항):
     * - 버튼을 누르면 서버에서 초안(draft)을 받아와 폼에 자동 입력한다.
     * - DB 저장은 하지 않는다(SSOT: 최종 저장은 /characters/advanced).
     */
    if (quickGenLoading) return;
    try {
      /**
       * ✅ 2단계 자동생성(요구사항):
       * 1) 남성향/여성향 + 롤플레잉/시뮬 + 대표이미지 기반으로 "작품명" 먼저 생성
       * 2) 위 선택값 + 대표이미지 + (1)에서 생성된 작품명 기반으로 "한줄소개" 생성
       *
       * 이유:
       * - 한번에 name/description을 같이 만들면 description이 이미지/네이밍과 엇나가거나,
       *   대사/지문 톤이 섞이는 확률이 높다.
       * - name을 먼저 고정해두면 description의 일관성이 훨씬 올라간다.
       */
      const nameRaw = String(formData?.basic_info?.name || '').trim();
      const audienceSlug = (selectedTagSlugs || []).find((s) => REQUIRED_AUDIENCE_SLUGS.includes(s)) || '';
      const styleSlug = (selectedTagSlugs || []).find((s) => REQUIRED_STYLE_SLUGS.includes(s)) || '';
      const promptType = String(formData?.basic_info?.character_type || 'roleplay').trim();
      const promptTypeLabel = (promptType === 'simulator' ? '시뮬레이션' : (promptType === 'custom' ? '커스텀' : '롤플레잉'));
      const coreUserTags = (() => {
        /**
         * ✅ 유저 태그(뼈대) 추출
         *
         * 의도/원리:
         * - 요구사항: "롤플/시뮬 + 유저 태그"를 뼈대로 유지하고, 성향은 테이스트로 재해석한다.
         * - 따라서 성향/스타일 같은 필수 메타 태그는 제외하고, 나머지를 "핵심 태그"로 간주한다.
         */
        try {
          const slugs = Array.isArray(selectedTagSlugs) ? selectedTagSlugs : [];
          const filtered = slugs
            .map((x) => String(x || '').trim())
            .filter(Boolean)
            .filter((s) => !REQUIRED_AUDIENCE_SLUGS.includes(s) && !REQUIRED_STYLE_SLUGS.includes(s));
          // 너무 길면 모델이 본질을 놓칠 수 있어 상위 N개만
          return filtered.slice(0, 10);
        } catch (_) {
          return [];
        }
      })();
      const coreTagHint = coreUserTags.length
        ? [
          `핵심 태그(뼈대): ${coreUserTags.join(', ')}`,
          '중요: 위 핵심 태그의 "장르/관계 구도/핵심 소재"를 절대 바꾸지 마. (태그 본질 유지)',
          '성향(남/여/전체)은 같은 뼈대를 "표현/후킹/어조"만 다르게 재해석하는 용도다. (본질 변형 금지)',
        ].join('\n')
        : [
          '중요: 선택된 모드(RP/시뮬)의 본질을 유지하라.',
          '성향(남/여/전체)은 표현/후킹/어조만 조절하고, 이야기 본질을 바꾸지 마.',
        ].join('\n');
      const profileTagBalanceHint = (() => {
        /**
         * ✅ 태그 "쏠림" 방지 유도(프로필용, 금지 없이)
         *
         * 배경/문제:
         * - 유저는 여러 태그를 고르지만, 모델은 '사건 엔진 태그'(감시/통제/권력/위험 등)에 과도하게 쏠려
         *   나머지 태그(일상/순애/힐링/성장/코미디 등)가 묻히는 문제가 있었다.
         *
         * 의도/원리:
         * - 금지로 막지 않고, 태그를 2축으로 해석해 "둘 다" 프로필에 드러나게 유도한다.
         *   1) 사건/갈등 축(엔진): 목표/리스크/비밀/제약
         *   2) 감정/리듬 축(결): 관계의 결/일상 리듬/설렘/안전감/성장
         * - 핵심 태그(뼈대)는 유지하되, 한쪽(특히 엔진 축)으로만 몰리지 않게 "분산 반영"한다.
         */
        try {
          const tagSet = new Set(coreUserTags.map((x) => String(x || '').trim()).filter(Boolean));
          const has = (k) => tagSet.has(k);
          const hasSoftTone = (
            has('순애')
            || has('로맨스')
            || has('연애')
            || has('일상')
            || has('힐링')
            || has('코미디')
            || has('성장')
            // ✅ 크랙/바베챗 빈출(톤 훅): UI 칩 확장에 맞춰 "관계 결" 유도 대상으로 포함
            || has('달달')
            || has('로코')
            || has('귀여움')
            || has('소꿉친구')
            || has('짝사랑')
            || has('오해→해소')
          );
          return [
            '중요(태그 균형 유도): 선택한 태그를 스스로 2축으로 나눠라. (A=사건/갈등 축, B=감정/리듬 축)',
            '규칙: (A)만 과도하게 반복하지 말고, (B)의 결이 최소 1회 이상 "문장으로" 분명히 드러나게 작성하라. (태그 나열 금지)',
            hasSoftTone
              ? '유도: 로맨스/일상/힐링/성장/코미디 같은 (B) 태그가 있으면, 같은 사건이라도 "보호/배려/선택권/존중" 방식으로 풀어 관계 결이 살아나게 하라.'
              : '유도: (B) 태그가 약하더라도, 관계 결(거리감 변화/신뢰/약속/긴장)을 최소 1문장 포함해 몰입감을 확보하라.',
          ].join('\n');
        } catch (_) {
          return [
            '중요(태그 균형 유도): 선택한 태그를 2축(사건/갈등 vs 감정/리듬)으로 나눠 둘 다 반영하라.',
            '규칙: 태그 나열 금지. 한쪽으로만 쏠리지 말고 문장으로 구현하라.',
          ].join('\n');
        }
      })();
      const audienceGuardHint = (() => {
        /**
         * ✅ 성향(남/여/전체) 강제 가드(중요 요구사항)
         *
         * 의도/원리:
         * - 단순히 `성향: 남성향` 같은 "정보"만 주면 모델이 여성향 클리셰(로판/공작/황태자/남주/여주 등)로 새는 경우가 있다.
         * - 따라서 '강제/금지' 규칙을 명시해, 제목/한줄소개가 성향을 벗어나지 않게 방어적으로 고정한다.
         */
        try {
          const a = String(audienceSlug || '').trim();
          if (!a) return null;
          const tagSet = new Set(coreUserTags.map((x) => String(x || '').trim()).filter(Boolean));
          const hasCore = (k) => tagSet.has(k);
          // ⚠️ 유저 태그가 뼈대(SSOT)이므로, 특정 클리셰/키워드는 "유저가 선택하지 않은 경우에만" 금지/회피한다.
          const femaleCoded = ['로판', '궁정', '황태자', '공작', '백작', '영애', '성녀', '남주', '여주'];
          const maleCoded = ['하렘', '치트', '레벨업', '헌터', '던전', '각성', '스탯'];
          const allowFemaleCodedByTags = femaleCoded.some((k) => hasCore(k));
          const allowMaleCodedByTags = maleCoded.some((k) => hasCore(k));
          if (a === '전체') {
            return [
              '중요(성향 테이스트): 전체(중립). 남성향/여성향 어느 한쪽의 클리셰로 과도하게 치우치지 말고 균형 있게.',
              '금지: 특정 성향을 전제하는 메타 문구(예: "여성향/남성향이라서" 같은 설명) 넣지 마.',
              '중요: 모드(RP/시뮬) + 핵심 태그(뼈대)는 유지하고, 표현만 중립 톤으로 조절하라.',
            ].join('\n');
          }
          if (a === '남성향') {
            return [
              '중요(성향 테이스트): 남성향. 모드(RP/시뮬)+핵심 태그(뼈대)를 유지한 채, 남성향 톤/후킹/표현으로 재해석하라.',
              '지시: 남성향 유저가 클릭할 만한 직관적/강한 후킹(상황/리스크/보상)을 우선.',
              allowFemaleCodedByTags
                ? '주의: 일부 여성향 클리셰 단어가 태그(뼈대)에 포함되어 있으므로, 본질은 유지하되 남성향 톤으로만 재해석하라.'
                : '금지(여성향 틱 방지): 로판/궁정(공작/황태자/백작/영애/성녀), "남주/여주" 호칭, 감성 서정 과다, 여성향 클리셰 중심 표현.',
            ].join('\n');
          }
          if (a === '여성향') {
            return [
              '중요(성향 테이스트): 여성향. 모드(RP/시뮬)+핵심 태그(뼈대)를 유지한 채, 여성향 톤/후킹/표현으로 재해석하라.',
              '지시: 감정선/관계의 긴장/설렘/금기가 느껴지는 후킹을 우선.',
              allowMaleCodedByTags
                ? '주의: 일부 남성향 클리셰 단어가 태그(뼈대)에 포함되어 있으므로, 본질은 유지하되 여성향 톤으로만 재해석하라.'
                : '금지(남성향 틱 방지): 하렘/치트/레벨업/헌터/던전/각성/스탯 등 남성향 클리셰 중심 표현.',
            ].join('\n');
          }
          return `중요(성향 테이스트): ${a}. 모드+핵심 태그는 유지하고, 표현/후킹만 이 성향에 맞춰라.`;
        } catch (_) {
          return null;
        }
      })();
      const autoGenModeHintForName = buildAutoGenModeHint({
        mode: (promptType === 'simulator' ? 'simulator' : (promptType === 'custom' ? 'custom' : 'roleplay')),
        isDescription: false,
      });
      const autoGenModeHintForDesc = buildAutoGenModeHint({
        mode: (promptType === 'simulator' ? 'simulator' : (promptType === 'custom' ? 'custom' : 'roleplay')),
        isDescription: true,
      });
      const autoGenToneHintForName = buildAutoGenToneHint({
        tags: coreUserTags,
        mode: (promptType === 'simulator' ? 'simulator' : (promptType === 'custom' ? 'custom' : 'roleplay')),
        audienceSlug,
        isDescription: false,
      });
      const autoGenToneHintForDesc = buildAutoGenToneHint({
        tags: coreUserTags,
        mode: (promptType === 'simulator' ? 'simulator' : (promptType === 'custom' ? 'custom' : 'roleplay')),
        audienceSlug,
        isDescription: true,
      });
      const maxTurns = (() => {
        try {
          const ss = (formData?.basic_info?.start_sets && typeof formData.basic_info.start_sets === 'object')
            ? formData.basic_info.start_sets
            : null;
          const sim = (ss && typeof ss.sim_options === 'object' && ss.sim_options) ? ss.sim_options : null;
          const n = Number(sim?.max_turns ?? NaN);
          return Number.isFinite(n) && n >= 50 ? Math.floor(n) : null;
        } catch (_) {
          return null;
        }
      })();
      const simDatingElements = (() => {
        /**
         * ✅ 시뮬 자동생성 옵션(위저드 SSOT: start_sets.sim_options)
         * - sim_dating_elements: 시뮬 내 미연시 요소(루트/호감도/공략) 포함 여부
         */
        try {
          if (promptType !== 'simulator') return false;
          const ss = (formData?.basic_info?.start_sets && typeof formData.basic_info.start_sets === 'object')
            ? formData.basic_info.start_sets
            : null;
          const sim = (ss && typeof ss.sim_options === 'object' && ss.sim_options) ? ss.sim_options : {};
          return !!sim?.sim_dating_elements;
        } catch (_) {
          return false;
        }
      })();

      const buildAutoProfileConceptDraftText = ({ name, desc, isSim, simDatingOn } = {}) => {
        /**
         * ✅ 작품 컨셉: 프로필 자동생성 시 "전체 덮어쓰기"용 자동 초안 텍스트를 만든다.
         *
         * 의도/원리:
         * - 유저 요구: 자동생성 시 작품 컨셉도 "크게" 바뀌어야 한다.
         * - 별도 AI 호출 없이, 현재 SSOT(선택 태그/칩/모드)를 근거로 초안 텍스트를 구성한다.
         * - 길이 제한(PROFILE_CONCEPT_MAX_LEN)은 유지한다.
         */
        try {
          const nm = String(name || '').trim();
          const ds = String(desc || '').trim();
          const headLines = [
            nm ? `작품명: ${nm}` : null,
            ds ? `한줄소개: ${ds}` : null,
            audienceSlug ? `성향: ${audienceSlug}` : null,
            isSim ? '모드: 시뮬레이션' : null,
            simDatingOn ? '시뮬 내 미연시 요소(가중): ON' : null,
          ].filter(Boolean);
          const headerBlock = headLines.length ? `${headLines.join('\n')}\n\n` : '';

          const pick = (arr) => (Array.isArray(arr) ? arr.map((x) => String(x || '').trim()).filter(Boolean) : []);
          const genres = pick(qmSelectedGenres).slice(0, 2);
          const type = String(qmSelectedType || '').trim();
          const hook = String(qmSelectedHook || '').trim();

          const tagSet = new Set((Array.isArray(selectedTagSlugs) ? selectedTagSlugs : []).map((x) => String(x || '').trim()).filter(Boolean));
          const has = (k) => tagSet.has(k);
          const tone = (() => {
            if (isSim) return '목표/리스크 중심, 선택과 결과 누적';
            // ✅ 본질(태그)을 우선 유지하고, 성향은 "테이스트"로만 반영한다.
            const romanceCore = has('순애') || has('로맨스') || has('연애') || hook === '순애';
            if (romanceCore && audienceSlug === '남성향') return '남성향 로맨스: 직관적/강한 후킹, 감정선은 빠르게 진입';
            if (romanceCore && audienceSlug === '여성향') return '여성향 로맨스: 감정선/관계 텐션, 설렘/금기 중심';
            if (romanceCore && audienceSlug === '전체') return '중립 로맨스: 관계 변화 중심, 과도한 클리셰 치우침 없음';
            if (audienceSlug === '남성향') return '남성향 테이스트: 직관적/강한 후킹, 쾌감/성취';
            if (audienceSlug === '여성향') return '여성향 테이스트: 감정선/관계의 미묘함, 설렘/긴장';
            if (audienceSlug === '전체') return '중립 테이스트: 균형, 과도한 치우침 없음';
            if (has('순애') || hook === '순애') return '달달한 순애, 생활 밀착 오피스 로맨스';
            if (has('로맨스') || has('연애')) return '설렘 중심 로맨스, 관계 변화';
            if (has('일상')) return '일상/루틴, 서서히 깊어지는 관계';
            return '관계/거리감 변화 중심 롤플레잉';
          })();

          const conflictGoal = (() => {
            if (isSim) return '목표 1개 + 즉시 제약/리스크 1개를 명확히.';
            if (hook) return `${hook} 키워드를 중심으로, 직장 규칙/소문/비밀 중 1개를 갈등으로 얹기.`;
            return '업무 규칙/소문/비밀 중 1개를 갈등으로 얹기.';
          })();

          const relRole = (() => {
            const base = [];
            if (type) base.push(type);
            if (has('비서') || hook === '비서') base.push('비서(상대)');
            if (has('오피스') || has('직장')) base.push('오피스');
            return base.length ? base.join(' · ') : '유저 ↔ 상대 캐릭터 (업무 관계에서 시작하는 감정선)';
          })();

          const worldRule = (() => {
            if (isSim) return '규칙/자원/시간/서열 중 1개를 시스템 룰로 고정.';
            return '금기: 사내 규정/비밀 유지/소문 확산 중 1개를 명확히.';
          })();

          const progression = (() => {
            /**
             * ✅ 전개 포인트(턴 진행 방식) 다양화
             *
             * 의도/원리:
             * - 기존은 고정 문구라 자동생성할 때마다 동일하게 보여 UX가 단조로웠다.
             * - 모드(RP/시뮬) + 유저 태그(뼈대) + 훅을 기준으로 "몇 가지 후보 템플릿" 중 하나를 선택한다.
             * - 난수는 nonce(자동생성 1회마다 달라짐)를 시드로 사용해 "매번 조금씩" 달라지게 한다.
             */
            try {
              const romanceCore = has('순애') || has('로맨스') || has('연애') || hook === '순애';
              const schoolCore = has('학교') || has('학원') || has('아카데미');
              const actionCore = has('액션') || has('전투') || has('싸움');
              const fantasyCore = has('판타지') || has('이세계') || has('중세판타지');

              const poolSim = [];
              if (romanceCore) {
                poolSim.push(
                  '초반 1~3턴: 관계/호감도(또는 루트) 조건 노출 → 선택지 → 결과 누적(분기 암시).',
                  '초반: 첫 만남 + 금기/제약 1개 노출 → 중반: 호감도 이벤트/갈등 분기 → 후반: 루트 확정/엔딩 조건 충족.'
                );
              }
              if (actionCore || fantasyCore) {
                poolSim.push(
                  '초반 1~3턴: 목표/룰/리스크 노출 → 선택지 → 결과 누적.',
                  '초반: 자원/제약 1개 제시 → 중반: 난관/전투(또는 사건) 분기 → 후반: 성과/대가로 엔딩 조건 조정.'
                );
              }
              if (schoolCore) {
                poolSim.push(
                  '초반: 규칙/서열/평가 기준 노출 → 중반: 경쟁/라이벌 이벤트 → 후반: 선택으로 결과(평판/관계) 확정.'
                );
              }
              // 기본 풀백(시뮬)
              if (poolSim.length === 0) {
                poolSim.push(
                  '초반 1~3턴: 목표/룰/리스크 노출 → 선택지 → 결과 누적.',
                  '초반: 목표/제약 제시 → 중반: 분기 이벤트 → 후반: 누적 결과로 엔딩 조건 확정.'
                );
              }

              const poolRp = [];
              if (romanceCore) {
                poolRp.push(
                  '초반: 첫 인상/거리감 → 중반: 금기/비밀로 긴장 → 후반: 선택으로 관계 확정.',
                  '초반: 티키타카로 결 얹기 → 중반: 오해/질투/소문으로 흔들기 → 후반: 고백/결단으로 수습.'
                );
              }
              if (actionCore) {
                poolRp.push(
                  '초반: 사건 발생(충돌) → 중반: 공조/대립으로 관계 재정의 → 후반: 한 번의 선택으로 판을 뒤집기.'
                );
              }
              if (schoolCore) {
                poolRp.push(
                  '초반: 학교/동아리/과제 장면 → 중반: 서열/소문/라이벌 → 후반: 관계/평판이 갈리는 선택.'
                );
              }
              // 기본 풀백(RP)
              if (poolRp.length === 0) {
                poolRp.push(
                  '초반: 업무/거리감 → 중반: 소문/비밀로 긴장 → 후반: 선택으로 관계 확정.',
                  '초반: 상황 던지기 → 중반: 갈등을 키우기 → 후반: 선택으로 관계/목표를 고정.'
                );
              }

              // 간단한 문자열 해시(외부 라이브러리 없이)로 풀에서 1개 선택
              const seed = `${nonce || ''}|${audienceSlug || ''}|${hook || ''}|${type || ''}|${(genres || []).join(',')}`;
              let h = 0;
              for (let i = 0; i < seed.length; i += 1) {
                h = ((h << 5) - h) + seed.charCodeAt(i);
                h |= 0;
              }
              const pool = isSim ? poolSim : poolRp;
              const idx = Math.abs(h) % Math.max(1, pool.length);
              return pool[idx] || (isSim ? '초반 1~3턴: 목표/룰/리스크 노출 → 선택지 → 결과 누적.' : '초반: 업무/거리감 → 중반: 소문/비밀로 긴장 → 후반: 선택으로 관계 확정.');
            } catch (_) {
              return isSim ? '초반 1~3턴: 목표/룰/리스크 노출 → 선택지 → 결과 누적.' : '초반: 업무/거리감 → 중반: 소문/비밀로 긴장 → 후반: 선택으로 관계 확정.';
            }
          })();

          const keywords = (() => {
            const extra = [];
            for (const k of [hook, type, ...genres]) {
              const s = String(k || '').trim();
              if (s && !extra.includes(s)) extra.push(s);
            }
            for (const s0 of (Array.isArray(selectedTagSlugs) ? selectedTagSlugs : [])) {
              const s = String(s0 || '').trim();
              if (!s) continue;
              if (extra.includes(s)) continue;
              extra.push(s);
              if (extra.length >= 6) break;
            }
            return extra;
          })();

          const coreTagsLine = (() => {
            /**
             * ✅ 작품 컨셉 초안 보강: 핵심 태그(뼈대) 라인
             * - 유저가 선택한 태그가 "무엇을 의도했는지" 컨셉에서 한눈에 보이게 한다.
             */
            try {
              const arr = Array.isArray(coreUserTags) ? coreUserTags : [];
              const list = arr.map((x) => String(x || '').trim()).filter(Boolean).slice(0, 10);
              return list.length ? `- 핵심 태그(뼈대): ${list.join(', ')}` : null;
            } catch (_) {
              return null;
            }
          })();
          const romanceCore = has('순애') || has('로맨스') || has('연애') || hook === '순애';
          const engineCore = (() => {
            /**
             * ✅ 엔진(사건/갈등) 축 감지(컨셉 보강용)
             * - 감시/통제/거래 같은 엔진이 "희미해지는" 것을 막기 위해, 컨셉에서 최소 1줄은 구조를 고정한다.
             * - 강화가 아니라 "형태 유지"가 목적이므로, 과도한 강제/반복은 금지한다.
             */
            try {
              const keys = ['감시', '통제', '거래', '협박', '권력', '약점', '비밀', '계약', '도청', '지배', '조종'];
              return keys.some((k) => has(k)) || (hook === '정체 숨김');
            } catch (_) {
              return false;
            }
          })();
          const framingLine = (() => {
            /**
             * ✅ 프레이밍 1줄 보강(드리프트 방지)
             * - 로맨스가 있으면 "강압만"으로 수렴하지 않게 합의/선택권 프레임을 같이 둔다.
             * - 엔진만 있을 때는 리스크/대가가 흐릿해지지 않게 1줄만 고정한다.
             */
            try {
              if (romanceCore) {
                return '- 프레이밍(중요): 사건/거래가 있어도 “합의/선택권/자기 억제/보호” 결을 반드시 같이 둔다. (강압 단독 수렴 금지)';
              }
              if (engineCore) {
                return '- 프레이밍(중요): 리스크/대가가 보이는 거래/권력/비밀 구조를 1줄로 분명히 유지한다. (갑툭튀 해결/무효화 금지)';
              }
              return null;
            } catch (_) {
              return null;
            }
          })();
          const earlyBeats = (() => {
            /**
             * ✅ 초반 전개(예시) 3포인트
             * - 유저가 "컨셉이 짧다"는 체감을 줄이기 위해, 프롬프트 자동생성에서 바로 활용 가능한 전개 스케치를 넣는다.
             * - SSOT(태그/훅/모드)를 바꾸지 않고, "표현/리듬"만 제안한다.
             */
            try {
              if (isSim) {
                return [
                  '- 초반(1~3턴): 목표/제약/리스크 1개를 상황/선택지로 노출.',
                  '- 중반(4~10턴): 분기 이벤트 1개 + 누적 결과(보상/대가) 암시.',
                  '- 후반: 누적 선택으로 엔딩 조건에 수렴(결말 조건 1~2개 힌트).',
                ].join('\n');
              }
              if (romanceCore && engineCore) {
                return [
                  '- 초반: “거래/비밀”의 제약 1개를 먼저 깔고, 동시에 “챙김/보호 행동” 1개로 순애 결을 즉시 체감시킨다.',
                  '- 중반: 제3자/감사/소문 등 외부 압박 1개로 긴장을 올리되, 둘의 선택(신뢰/거리)이 분기 포인트가 되게 한다.',
                  '- 후반: 계약의 끝/고백/결단으로 관계 정의를 확정(달달/긴장 균형).',
                ].join('\n');
              }
              if (romanceCore) {
                return [
                  '- 초반: 거리감/호감도 변곡점 1개(챙김/오해/질투)를 빠르게 배치.',
                  '- 중반: 금기/비밀/약속 중 1개로 긴장을 올리고 관계의 선택을 요구.',
                  '- 후반: 고백/결단/재회로 관계를 확정.',
                ].join('\n');
              }
              if (engineCore) {
                return [
                  '- 초반: 리스크/대가 1개를 명확히 제시(거래/권력/비밀).',
                  '- 중반: 흔들리는 증거/의심/방문자 등 사건 1개로 압박.',
                  '- 후반: 선택(협력/배신/고립/폭로)로 관계/목표가 갈리는 포인트.',
                ].join('\n');
              }
              return [
                '- 초반: 상황/갈등 1개를 던지고 관계의 거리감을 고정.',
                '- 중반: 오해/소문/비밀로 긴장을 올림.',
                '- 후반: 선택으로 관계/목표 확정.',
              ].join('\n');
            } catch (_) {
              return '';
            }
          })();

          const body = [
            '## 작품 컨셉(자동 생성)',
            `- 장르/톤: ${genres.length ? `${genres.join(', ')} / ${tone}` : tone}`,
            `- 핵심 갈등/목표: ${conflictGoal}`,
            `- 관계/역할(혐관/서브캐/삼각관계 등): ${relRole}`,
            `- 세계관 규칙/금기: ${worldRule}`,
            `- 전개 포인트(턴 진행 방식): ${progression}`,
            keywords.length ? `- 참고 키워드: ${keywords.join(', ')}` : null,
            coreTagsLine,
            framingLine,
            '',
            '## 초반 전개(예시)',
            earlyBeats || null,
            '',
            '(이 내용은 프롬프트 자동생성 시 참고합니다.)',
            '(직접 수정은 우상단 연필로 잠금 해제 후, 체크로 확정하세요. 자동생성은 이 내용을 덮어쓸 수 있습니다.)',
          ].filter(Boolean).join('\n');

          return String((headerBlock + body) || '').slice(0, PROFILE_CONCEPT_MAX_LEN);
        } catch (_) {
          return '';
        }
      };
      // ✅ 이름이 비어있는 초기 상태에서도 "랜덤 생성"이 동작해야 한다.
      // - 백엔드가 name을 필수로 받으므로, 의미없는 placeholder는 '캐릭터'로 통일하고
      //   seed_text에 랜덤성을 강하게 요구한다.
      // ✅ 독립 시행(핵심):
      // - 직전 자동생성으로 채워진 name을 다시 입력값으로 보내면 "같은 이름"이 반복될 수 있다.
      // - 사용자가 수동으로 바꾼 이름은 유지하되, 자동생성 이름(직전 값과 동일)은 placeholder로 취급한다.
      const isAutoGeneratedName = !!nameRaw && (String(lastAutoGeneratedProfileNameRef.current || '') === nameRaw);
      const placeholderName = (!nameRaw || isAutoGeneratedName) ? '캐릭터' : nameRaw;
      // ✅ 독립 시행(추가 보강): 같은 조건이면 모델이 같은 제목을 다시 뱉는 경우가 있어,
      // seed에 강한 nonce + 직전 결과 제목은 "금지" 힌트를 함께 넣는다.
      const prevAutoName = String(lastAutoGeneratedProfileNameRef.current || '').trim();
      const nonce = (() => {
        try { return `${Date.now()}_${Math.random().toString(16).slice(2, 8)}`; } catch (_) { return String(Date.now()); }
      })();

      // ✅ 이미지 기반 생성(스토리 에이전트 느낌):
      // - 대표 이미지(avatar_url)가 있으면 그걸 우선 사용한다.
      // - 없으면 업로드된 이미지 목록 첫 장을 사용한다.
      const firstImageUrl = (() => {
        try {
          const avatar = String(formData?.media_settings?.avatar_url || '').trim();
          if (avatar) return avatar;
          const imgs = Array.isArray(formData?.media_settings?.image_descriptions) ? formData.media_settings.image_descriptions : [];
          const first = imgs.find((x) => String(x?.url || '').trim());
          return String(first?.url || '').trim() || null;
        } catch (_) {
          return null;
        }
      })();

      // ✅ 프로필 자동생성: 원문 저장 (취소 시 복구용) - 작품명/한줄소개/작품컨셉 모두
      profileAutoGenPrevNameRef.current = String(formData?.basic_info?.name || '');
      profileAutoGenPrevDescRef.current = String(formData?.basic_info?.description || '');
      // 작품컨셉 원문 저장
      try {
        const ss = (formData?.basic_info?.start_sets && typeof formData.basic_info.start_sets === 'object')
          ? formData.basic_info.start_sets
          : null;
        const pc = (ss && typeof ss.profile_concept === 'object' && ss.profile_concept) ? ss.profile_concept : null;
        profileAutoGenPrevConceptRef.current = pc ? { enabled: !!pc.enabled, text: String(pc.text || '') } : null;
      } catch (_) {
        profileAutoGenPrevConceptRef.current = null;
      }
      quickGenAbortRef.current = false;
      
      setQuickGenLoading(true);
      // ✅ 요구사항: "위저드만" 제미니 고정(다른 화면/로직에는 영향 주지 않음)
      const aiModel = useNormalCreateWizard
        ? 'gemini'
        : (String(user?.preferred_model || 'claude').trim().toLowerCase() || 'claude');
      const resolvedImageUrlForAi = (() => {
        try {
          const raw = String(firstImageUrl || '').trim();
          if (!raw) return null;
          const resolved = resolveImageUrl(raw);
          return String(resolved || raw).trim() || null;
        } catch (_) {
          return firstImageUrl || null;
        }
      })();
      // ✅ QuickMeet와 동일: 이미지 정보 포함 OFF면 image_url을 보내지 않는다.
      const imageUrlForAi = profileAutoGenUseImage ? resolvedImageUrlForAi : null;

      // 1) 작품명 생성(이미지+선택값 기반)
      const seedNameOnly = [
        `랜덤 시드: ${nonce}`,
        prevAutoName ? `직전 생성된 작품명(중복 금지): ${prevAutoName}` : null,
        prevAutoName ? '중요: 이번에는 위 작품명과 "절대" 같은 작품명을 쓰지 마. 완전히 다른 이름으로 새로 만들어.' : null,
        autoGenModeHintForName,
        coreTagHint,
        profileTagBalanceHint,
        autoGenToneHintForName,
        audienceGuardHint,
        profileAutoGenUseImage
          ? '가능하면 제공된 대표이미지의 인물/의상/표정/배경/분위기와 일치하는 콘셉트로 만들어줘. (이미지와 무관한 설정은 피하기)'
          : '이미지 분석 없이도 성향/타입/태그에 맞는 “클릭을 부르는 후킹”으로 간결하게 만들어줘. (추상/메타 문구 금지)',
        '출력은 작품명(name)만. description/대사/지문/키워드/첫대사/대화 시작 문구 등 다른 텍스트는 절대 포함하지 마.',
        (promptType === 'simulator' && simDatingElements)
          ? '시뮬 내 미연시 요소: ON. 공략 인물(핵심 3~6명)과 각 인물의 루트/호감도 이벤트(최소 2개)를 암시하되, 운영 공지/업데이트/명령어/스펙 나열은 금지.'
          : null,
        // ✅ 시뮬 vs RP: 위저드에서도 한줄소개를 먼저 머릿속으로 구상 후 제목
        promptType === 'simulator'
          ? [
              `[생성 순서] 머릿속으로 한줄소개(세계관, 상황, 규칙, 유저 역할)를 먼저 구상한 뒤, 그것을 바탕으로 작품명을 지어라.`,
              `[작품명 역할·시뮬] 크랙/바베챗 인기 시뮬 크리에이터로서 제목을 지어라. 세계관/장소/시스템/상황이 제목에서 바로 보여야 함. 캐릭터 이름보다 "어디서/무엇을" 하는지가 핵심. 짧고 직관적, 밈/구어체 허용.`,
              `- 길이: ${PROFILE_NAME_MIN_LEN}~${PROFILE_NAME_MAX_LEN}자, 따옴표/마침표/이모지 금지`,
            ].join('\n')
          : (quickGenTitleNameMode
            ? [
                `[생성 순서] 머릿속으로 한줄소개(캐릭터 고유 이름, 상황, 갈등)를 먼저 구상한 뒤, 그 이름을 포함한 작품명을 지어라. 종족/직업명 대체 금지.`,
                `[작품명 역할] 너는 노벨피아/카카오페이지 베테랑 웹소설 작가다. 반전/떡밥을 밈·가십 톤으로 함축해 제목을 지어라. 필수: 반말 구어체 종결(~함, ~임, ~됨, ~해버림, ~인데, ~했음, ~음). 금지: 문학체(~하다/~이다/~지다), 명사 종결.`,
                `- 길이: ${PROFILE_NAME_MIN_LEN}~${PROFILE_NAME_MAX_LEN}자, 따옴표/마침표/이모지 금지`,
              ].join('\n')
            : [
                `[생성 순서] 머릿속으로 한줄소개(캐릭터 고유 이름, 상황, 갈등)를 먼저 구상한 뒤, 그 이름을 포함한 작품명을 지어라. 종족/직업명 대체 금지.`,
                `[작품명 역할] 너는 캐릭터챗 인기 크리에이터다. 클릭을 부르는 제목을 지어라. 캐릭터 고유 이름 포함 필수. 스타일은 65%는 짧고 강한 형태(이름+수식어/상황), 35%는 웹소설 밈 톤 문장형(반말 구어체 ~함/~됨/~인데/~해버림 종결) 중 자연스럽게 선택.`,
                `- 길이: ${PROFILE_NAME_MIN_LEN}~${PROFILE_NAME_MAX_LEN}자, 따옴표/마침표/이모지 금지`,
              ].join('\n')
          ),
        audienceSlug ? `성향: ${audienceSlug}` : null,
        styleSlug ? `이미지 스타일: ${styleSlug}` : null,
        promptTypeLabel ? `프롬프트 타입: ${promptTypeLabel}` : null,
        maxTurns ? `분량(진행 턴수): ${maxTurns}턴` : null,
      ].filter(Boolean).join('\n');

      const resName = await charactersAPI.quickGenerateCharacterDraft({
        name: placeholderName,
        seed_text: seedNameOnly,
        image_url: imageUrlForAi,
        tags: Array.isArray(selectedTagSlugs) ? selectedTagSlugs : [],
        // ✅ SSOT: 유저가 선택한 모드(롤플/시뮬/커스텀)를 서버에 명시 전달
        // - 서버는 이 값이 있을 때만 1순위로 사용하고, 없으면 레거시(키워드 추정)로 폴백한다.
        character_type: (promptType === 'simulator' ? 'simulator' : (promptType === 'custom' ? 'custom' : 'roleplay')),
        ai_model: (aiModel === 'gpt' ? 'gpt' : (aiModel === 'gemini' ? 'gemini' : 'claude')),
      });

      // ✅ 작품명 API 완료 후 취소 체크 - 취소됐으면 한줄소개 생성 없이 즉시 종료
      if (quickGenAbortRef.current) {
        setQuickGenLoading(false);
        return;
      }

      const biName = resName?.data?.basic_info || {};
      const nextNameRaw = String(biName?.name || '').trim();
      const nextName = nextNameRaw; // ✅ 요구사항: 초과/미달이면 재생성으로 처리(아래 검증)
      if (!nextName) {
        throw new Error('name_missing');
      }
      if (nextName.length < PROFILE_NAME_MIN_LEN || nextName.length > PROFILE_NAME_MAX_LEN) {
        throw new Error('name_len_invalid');
      }

      // 1) 적용: 작품명 (덮어쓰기)
      setFormData((prev) => ({
        ...prev,
        basic_info: {
          ...prev.basic_info,
          name: nextName,
          greeting: prev.basic_info.greeting,
          greetings: prev.basic_info.greetings,
          introduction_scenes: prev.basic_info.introduction_scenes,
          start_sets: prev.basic_info.start_sets,
        },
      }));
      // ✅ 독립 시행(SSOT): "직전 자동생성 name"을 기록해,
      // 다음 번 자동생성에서 입력값 앵커로 재사용되지 않게 한다.
      try { lastAutoGeneratedProfileNameRef.current = nextName; } catch (_) {}
      try { setChatPreviewSnapshot((prev) => ({ ...prev, name: nextName })); } catch (_) {}

      // 2) 한줄소개 생성(이미지+선택값+작품명 기반)
      const seedDescOnly = [
        `랜덤 시드: ${nonce}_desc`,
        `작품명(name): ${nextName}`,
        autoGenModeHintForDesc,
        coreTagHint,
        profileTagBalanceHint,
        autoGenToneHintForDesc,
        audienceGuardHint,
        profileAutoGenUseImage
          ? '가능하면 제공된 대표이미지의 인물/의상/표정/배경/분위기와 일치하는 콘셉트로 작성해줘. (이미지와 무관한 설정은 피하기)'
          : '이미지 없이도 “구체 디테일 1개 + 갈등/목표/제약 1개”가 느껴지게 4~5문장으로 후킹해줘. (추상/메타 문장 금지)',
        '출력은 한줄소개(description)만. name/대사/지문/키워드/첫대사/대화 시작 문구 등 다른 텍스트는 절대 포함하지 마.',
        '구성 유도(중요): 4~5문장 중 최소 1문장은 (A=사건/갈등: 목표/리스크/비밀/제약), 최소 1문장은 (B=감정/리듬: 관계 결/일상 리듬/설렘/안전감) 이 분명히 드러나야 한다.',
        `한줄소개(description)는 "대사"가 아니라 소개 문장이다. 4~5문장, ${PROFILE_ONE_LINE_MIN_LEN}~${PROFILE_ONE_LINE_MAX_LEN}자, 줄바꿈 금지.`,
        '문장 끝은 마침표로 끝내라. (문장 수 검증을 위해 중요)',
        (promptType === 'simulator' && simDatingElements)
          ? '시뮬 내 미연시 요소: ON. 한줄소개에 (공략 인물/루트 느낌 1개 + 호감도 이벤트/분기 암시 1개)를 자연스럽게 포함하라. 메타/운영 문구 금지.'
          : null,
        audienceSlug ? `성향: ${audienceSlug}` : null,
        styleSlug ? `이미지 스타일: ${styleSlug}` : null,
        promptTypeLabel ? `프롬프트 타입: ${promptTypeLabel}` : null,
        maxTurns ? `분량(진행 턴수): ${maxTurns}턴` : null,
      ].filter(Boolean).join('\n');

      const resDesc = await charactersAPI.quickGenerateCharacterDraft({
        name: nextName,
        seed_text: seedDescOnly,
        image_url: imageUrlForAi,
        tags: Array.isArray(selectedTagSlugs) ? selectedTagSlugs : [],
        // ✅ SSOT: 유저가 선택한 모드(롤플/시뮬/커스텀)를 서버에 명시 전달
        character_type: (promptType === 'simulator' ? 'simulator' : (promptType === 'custom' ? 'custom' : 'roleplay')),
        ai_model: (aiModel === 'gpt' ? 'gpt' : (aiModel === 'gemini' ? 'gemini' : 'claude')),
      });

      // ✅ 한줄소개 API 완료 후 취소 체크 - 취소됐으면 작품컨셉 생성 없이 즉시 종료
      if (quickGenAbortRef.current) {
        setQuickGenLoading(false);
        return;
      }

      const biDesc = resDesc?.data?.basic_info || {};
      const nextDescRaw = String(biDesc?.description || '').replace(/\s*\n+\s*/g, ' ').trim();
      const nextDesc0 = nextDescRaw.length > PROFILE_ONE_LINE_MAX_LEN ? nextDescRaw.slice(0, PROFILE_ONE_LINE_MAX_LEN) : nextDescRaw;
      if (!nextDesc0) {
        throw new Error('description_missing');
      }
      if (nextDesc0.length < PROFILE_ONE_LINE_MIN_LEN) {
        throw new Error('description_too_short');
      }
      let nextDescFinal = nextDesc0;
      // ✅ 요구사항: 4~5문장 강제(1회 보정). 길이만 맞추면 여전히 2~3문장으로 수렴하는 문제가 있어 방어적으로 보정한다.
      const sentenceCount = countSentencesRoughKo(nextDesc0);
      if (sentenceCount < 4 || sentenceCount > 5) {
        const seedDescRetry = [
          seedDescOnly,
          `중요: 한줄소개(description)는 반드시 4~5문장이어야 한다. 문장 끝은 마침표로 끝내라. (${PROFILE_ONE_LINE_MIN_LEN}~${PROFILE_ONE_LINE_MAX_LEN}자, 줄바꿈 금지)`,
        ].join('\n');
        const resDesc2 = await charactersAPI.quickGenerateCharacterDraft({
          name: nextName,
          seed_text: seedDescRetry,
          image_url: imageUrlForAi,
          tags: Array.isArray(selectedTagSlugs) ? selectedTagSlugs : [],
          // ✅ SSOT: 유저가 선택한 모드(롤플/시뮬/커스텀)를 서버에 명시 전달
          character_type: (promptType === 'simulator' ? 'simulator' : (promptType === 'custom' ? 'custom' : 'roleplay')),
          ai_model: (aiModel === 'gpt' ? 'gpt' : (aiModel === 'gemini' ? 'gemini' : 'claude')),
        });
        // ✅ 재시도 API 완료 후 취소 체크
        if (quickGenAbortRef.current) {
          setQuickGenLoading(false);
          return;
        }
        const biDesc2 = resDesc2?.data?.basic_info || {};
        const raw2 = String(biDesc2?.description || '').replace(/\s*\n+\s*/g, ' ').trim();
        const cand = raw2.length > PROFILE_ONE_LINE_MAX_LEN ? raw2.slice(0, PROFILE_ONE_LINE_MAX_LEN) : raw2;
        const sc2 = countSentencesRoughKo(cand);
        if (cand && cand.length >= PROFILE_ONE_LINE_MIN_LEN && sc2 >= 4 && sc2 <= 5) {
          // ✅ 더 좋은 결과만 채택
          nextDescFinal = cand;
        }
      }

      // ✅ 자동생성 버튼을 1회라도 눌렀다면, 작품 컨셉(고급/선택) 토글을 자동으로 ON.
      // - 처음부터 노출하면 부담이 크므로, 자동생성 흐름에서만 자연스럽게 보여준다.
      // - 내용이 비어있다면 기본 템플릿을 채워 "무엇을 쓰면 되는지" 즉시 보이게 한다.
      try {
        updateStartSets((prev) => {
          const cur = (prev && typeof prev === 'object') ? prev : {};
          const existing = (cur.profile_concept && typeof cur.profile_concept === 'object') ? cur.profile_concept : {};
          const existingText = String(existing?.text || '').trim();
          // ✅ 시뮬 옵션(SSOT: start_sets.sim_options) 기반으로 작품 컨셉 템플릿에 상태를 반영
          // - "까먹지 않게" 하는 정보는 프롬프트 조립(payload)에서도 들어가지만,
          //   유저가 작품 컨셉을 보는 순간에도 시뮬/미연시 ON 여부가 한눈에 보이도록 최소 문장만 추가한다.
          const simOptions = (cur?.sim_options && typeof cur.sim_options === 'object') ? cur.sim_options : {};
          const isSim = String(formData?.basic_info?.character_type || 'roleplay').trim() === 'simulator';
          const simDatingOn = isSim && !!simOptions?.sim_dating_elements;
          const defaultText = [
            `작품명: ${nextName}`,
            `한줄소개: ${nextDescFinal}`,
            ...(isSim ? ['모드: 시뮬레이션'] : []),
            ...(simDatingOn ? ['시뮬 내 미연시 요소(가중): ON'] : []),
            '',
            '## 작품 컨셉(선택, 고급)',
            '- 장르/톤:',
            '- 핵심 갈등/목표:',
            '- 관계/역할(혐관/서브캐/삼각관계 등):',
            '- 세계관 규칙/금기:',
            '- 전개 포인트(턴 진행 방식):',
            '',
            '(이 내용은 프롬프트 자동생성 시 참고합니다.)',
          ].join('\n');
          // ✅ 요구사항: 프로필 자동생성 시 작품 컨셉도 "전체 덮어쓰기"로 크게 갱신
          const nextText = buildAutoProfileConceptDraftText({ name: nextName, desc: nextDescFinal, isSim, simDatingOn }) || defaultText;
          return {
            ...cur,
            profile_concept: {
              ...(existing || {}),
              enabled: true,
              text: nextText,
            },
          };
        });
      } catch (_) {}
      // 자동생성 후에는 기본 잠금 상태로 복귀(요구사항)
      try { setProfileConceptEditMode(false); } catch (_) {}

      // 2) 적용: 한줄소개 (덮어쓰기)
      setFormData((prev) => ({
        ...prev,
        basic_info: {
          ...prev.basic_info,
          name: nextName,
          description: nextDescFinal,
          greeting: prev.basic_info.greeting,
          greetings: prev.basic_info.greetings,
          introduction_scenes: prev.basic_info.introduction_scenes,
          start_sets: prev.basic_info.start_sets,
        },
      }));

      try { dispatchToast('success', '작품명/한줄소개가 자동 생성되었습니다. 내용을 확인해주세요.'); } catch (_) {}
    } catch (e) {
      console.error('[CreateCharacterPage] quick-generate failed:', e);
      dispatchToast('error', '자동 생성에 실패했습니다. 잠시 후 다시 시도해주세요.');
    } finally {
      setQuickGenLoading(false);
    }
  }, [quickGenLoading, quickGenTitleNameMode, profileAutoGenUseImage, formData, selectedTagSlugs, user, refreshChatPreviewSnapshot]);


  const renderBasicInfoTab = () => (
    <div className="p-6 space-y-8">
      {/* AI 스토리 임포터 기능 소개 섹션 */}
      {!isEditMode && showAiFastSetupCard && (
        <Card className="bg-purple-50 dark:bg-purple-900/20 border-purple-200 dark:border-purple-700/50 shadow-md hover:shadow-lg transition-shadow">
          <CardHeader className="flex flex-row items-center gap-4">
            <div className="flex-shrink-0">
              <div className="p-3 bg-purple-100 dark:bg-purple-800/50 rounded-full">
                <Sparkles className="w-6 h-6 text-purple-600 dark:text-purple-300" />
              </div>
            </div>
            <div className="flex-grow">
              <CardTitle className="text-lg font-bold text-purple-800 dark:text-purple-200">
                AI로 캐릭터 설정 1분 만에 끝내기 🚀
              </CardTitle>
              <CardDescription className="text-purple-600 dark:text-purple-300/80">
                웹소설, 시나리오를 붙여넣으면 AI가 핵심 설정을 분석하여 자동으로 완성해줘요.
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <Button className="w-full bg-purple-600 hover:bg-purple-700 text-white font-semibold" onClick={() => setIsStoryImporterOpen(true)}>
              <Wand2 className="w-5 h-5 mr-2" />
              AI로 분석하여 자동 완성
            </Button>
          </CardContent>
        </Card>
      )}

      {/* ✅ 필수 입력 안내(요구사항): 생성 화면에서만 노출 */}
      {!isEditMode && (
        <div className="rounded-xl border border-gray-700/70 bg-gray-900/40 p-4 text-gray-100">
          <div className="text-sm font-semibold">필수 입력</div>
          <div className="mt-1 text-xs text-gray-300">
            이미지, 작품명, 필수 태그, 한줄소개, 세계관 설정
          </div>
          <div className="mt-1 text-xs text-gray-500">그 외 항목은 선택입니다.</div>
        </div>
      )}

      {/* 기존 기본 정보 입력 필드 */}
      <div className="space-y-4">
        {renderExistingImageUploadAndTriggers()}

        <div>
          <Label htmlFor="name">
            작품명 <span className="text-red-400 ml-1">*</span>
          </Label>
          <div className="relative mt-4">
            {quickGenLoading ? (
              <>
                <Input
                  id="name"
                  className="bg-gray-950/40 border-gray-700 text-transparent caret-transparent"
                  value=""
                  onChange={() => {}}
                  placeholder=""
                  disabled
                  readOnly
                  aria-busy="true"
                />
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <Loader2 className="h-5 w-5 animate-spin text-gray-200" aria-hidden="true" />
                </div>
              </>
            ) : (
              <Input
                id="name"
                className="bg-gray-950/40 border-gray-700 text-gray-100 placeholder:text-gray-500"
                value={formData.basic_info.name}
                onChange={(e) => updateFormData('basic_info', 'name', e.target.value)}
                onBlur={refreshChatPreviewSnapshot}
                placeholder="작품명을 입력하세요"
                required
                maxLength={100}
              />
            )}
          </div>
          <p className="text-sm text-gray-500 mt-1">
            명확하고 기억하기 쉬운 작품명을 사용하세요.
          </p>
        </div>

        {/* ✅ 요구사항: 일반 캐릭터챗 생성에서 '제작 유형'은 사용자에게 노출하지 않는다. */}

        {/* ✅ (요구사항 반영) 필수 선택 박스/이미지형 카드 제거 → '캐릭터 설명' 바로 위에 심플 세그먼트 UI로 배치 */}
        {!isOrigChatCharacter && (
          <div className="space-y-4">
            <div className="text-sm font-semibold text-gray-200">
              필수 태그 <span className="text-red-400">*</span>
            </div>
            {/* 성향 */}
            <div>
              <div className="flex items-baseline justify-between">
                <div className="text-sm font-semibold text-gray-200">
                  남성향 / 여성향 / 전체 <span className="text-red-400">*</span>
                </div>
                <div className="text-xs text-gray-500">클릭하면 선택, 다시 클릭하면 해제</div>
              </div>
              <div className="mt-2 grid grid-cols-3 gap-2 rounded-xl border border-gray-800 bg-gray-950/40 p-2">
                {REQUIRED_AUDIENCE_CHOICES.map((opt, idx) => {
                  const selected = Array.isArray(selectedTagSlugs) && selectedTagSlugs.includes(opt.slug);
                  return (
                    <button
                      key={opt.slug}
                      type="button"
                      onClick={() => toggleExclusiveTag(opt.slug, REQUIRED_AUDIENCE_SLUGS)}
                      aria-pressed={selected}
                      className={[
                        'h-10 rounded-lg px-3 text-sm font-semibold transition-all',
                        'outline-none focus-visible:ring-2 focus-visible:ring-purple-500/30',
                        selected
                          ? 'bg-gradient-to-br from-purple-600 to-indigo-600 text-white shadow-sm ring-1 ring-purple-400/40'
                          : 'bg-gray-900/30 text-gray-200 hover:bg-gray-800/60 ring-1 ring-transparent',
                      ].join(' ')}
                    >
                      <span className="block w-full truncate">{opt.label}</span>
                    </button>
                  );
                })}
              </div>
              {fieldErrors['basic_info.audience_pref'] && (
                <p className="text-xs text-red-400 mt-2">{fieldErrors['basic_info.audience_pref']}</p>
              )}
            </div>

            {/* 스타일 */}
            <div>
              <div className="flex items-baseline justify-between">
                <div className="text-sm font-semibold text-gray-200">
                  이미지 스타일 <span className="text-red-400">*</span>
                </div>
                <div className="text-xs text-gray-500">레퍼런스 느낌을 선택하세요</div>
              </div>
              <div className="mt-2 grid grid-cols-4 gap-2 rounded-xl border border-gray-800 bg-gray-950/40 p-2">
                {REQUIRED_STYLE_CHOICES.map((opt, idx) => {
                  const selected = Array.isArray(selectedTagSlugs) && selectedTagSlugs.includes(opt.slug);
                  return (
                    <button
                      key={opt.slug}
                      type="button"
                      onClick={() => toggleExclusiveTag(opt.slug, REQUIRED_STYLE_SLUGS)}
                      aria-pressed={selected}
                      className={[
                        'h-10 rounded-lg px-2 text-xs sm:text-sm font-semibold transition-all',
                        'outline-none focus-visible:ring-2 focus-visible:ring-purple-500/30',
                        selected
                          ? 'bg-gradient-to-br from-purple-600 to-indigo-600 text-white shadow-sm ring-1 ring-purple-400/40'
                          : 'bg-gray-900/30 text-gray-200 hover:bg-gray-800/60 ring-1 ring-transparent',
                      ].join(' ')}
                    >
                      <span className="block w-full truncate">{opt.label}</span>
                    </button>
                  );
                })}
              </div>
              {fieldErrors['basic_info.visual_style'] && (
                <p className="text-xs text-red-400 mt-2">{fieldErrors['basic_info.visual_style']}</p>
              )}
            </div>
          </div>
        )}


        <div>
          <Label htmlFor="description">
            캐릭터 설명 {!isEditMode && <span className="text-red-400 ml-1">*</span>}
          </Label>
          <div className="relative mt-4">
            {quickGenLoading ? (
              <>
                <Textarea
                  id="description"
                  data-autogrow="1"
                  onInput={handleAutoGrowTextarea}
                  className="resize-none overflow-hidden text-transparent caret-transparent"
                  value=""
                  onChange={() => {}}
                  placeholder=""
                  rows={3}
                  disabled
                  readOnly
                  aria-busy="true"
                />
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <Loader2 className="h-6 w-6 animate-spin text-gray-200" aria-hidden="true" />
                </div>
              </>
            ) : (
              <Textarea
                id="description"
                data-autogrow="1"
                onInput={handleAutoGrowTextarea}
                className="resize-none overflow-hidden"
                value={formData.basic_info.description}
                onChange={(e) => updateFormData('basic_info', 'description', e.target.value)}
                placeholder="캐릭터에 대한 설명입니다 (캐릭터 설명은 다른 사용자에게도 공개 됩니다)"
                rows={3}
                required={!isEditMode}
                maxLength={3000}
              />
            )}
          </div>
          {fieldErrors['basic_info.description'] && (
            quickGenLoading ? null : <p className="text-xs text-red-500">{fieldErrors['basic_info.description']}</p>
          )}
          <div className="flex items-center gap-2 mt-2">
            <span className="text-xs text-gray-500">토큰 삽입:</span>
            <Button type="button" variant="secondary" size="sm" title="{{character}} 삽입" onClick={() => insertBasicToken('description','description', TOKEN_CHARACTER)}>캐릭터</Button>
            <Button type="button" variant="secondary" size="sm" title="{{user}} 삽입" onClick={() => insertBasicToken('description','description', TOKEN_USER)}>유저</Button>
          </div>
        </div>

        <div>
          {(() => {
            const mode = getEffectiveDetailMode('personality');
            const copy = (mode === 'simulator' ? detailFieldCopy.simulator : detailFieldCopy.roleplay).personality;
            const forced = isDetailModeForced('personality');
            return (
              <>
                <div className="flex items-center justify-between gap-3">
                  <Label htmlFor="personality">{copy.label}</Label>
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-400 select-none">시뮬 방식</span>
                      <Switch
                        id="detail_personality_mode_switch"
                        checked={mode === 'simulator'}
                        onCheckedChange={() => toggleDetailMode('personality')}
                      />
                    </div>
                  </div>
                </div>
                {forced && (
                  <div className="mt-2 rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
                    <div className="font-semibold">경고: 현재 타입과 다른 방식으로 입력 중입니다.</div>
                    <div className="mt-1 text-amber-100/90">타입에 맞는 항목이 권장됩니다.</div>
                  </div>
                )}
                <Textarea
                  id="personality"
                  data-autogrow="1"
                  onInput={handleAutoGrowTextarea}
                  className="mt-4 resize-none overflow-hidden"
                  value={formData.basic_info.personality}
                  onChange={(e) => updateFormData('basic_info', 'personality', e.target.value)}
                  placeholder={copy.placeholder}
                  rows={4}
                  maxLength={300}
                />
              </>
            );
          })()}
          {fieldErrors['basic_info.personality'] && (
            <p className="text-xs text-red-500">{fieldErrors['basic_info.personality']}</p>
          )}
          <div className="flex items-center gap-2 mt-2">
            <span className="text-xs text-gray-500">토큰 삽입:</span>
            <Button type="button" variant="secondary" size="sm" title="{{character}} 삽입" onClick={() => insertBasicToken('personality','personality', TOKEN_CHARACTER)}>캐릭터</Button>
            <Button type="button" variant="secondary" size="sm" title="{{user}} 삽입" onClick={() => insertBasicToken('personality','personality', TOKEN_USER)}>유저</Button>
          </div>
        </div>

        <div>
          {(() => {
            const mode = getEffectiveDetailMode('speech_style');
            const copy = (mode === 'simulator' ? detailFieldCopy.simulator : detailFieldCopy.roleplay).speech_style;
            const forced = isDetailModeForced('speech_style');
            return (
              <>
                <div className="flex items-center justify-between gap-3">
                  <Label htmlFor="speech_style">{copy.label}</Label>
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-400 select-none">시뮬 방식</span>
                      <Switch
                        id="detail_speech_style_mode_switch"
                        checked={mode === 'simulator'}
                        onCheckedChange={() => toggleDetailMode('speech_style')}
                      />
                    </div>
                  </div>
                </div>
                {forced && (
                  <div className="mt-2 rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
                    <div className="font-semibold">경고: 현재 타입과 다른 방식으로 입력 중입니다.</div>
                    <div className="mt-1 text-amber-100/90">타입에 맞는 항목이 권장됩니다.</div>
                  </div>
                )}
                <Textarea
                  id="speech_style"
                  data-autogrow="1"
                  onInput={handleAutoGrowTextarea}
                  className="mt-4 resize-none overflow-hidden"
                  value={formData.basic_info.speech_style}
                  onChange={(e) => updateFormData('basic_info', 'speech_style', e.target.value)}
                  placeholder={copy.placeholder}
                  rows={2}
                  maxLength={300}
                />
              </>
            );
          })()}
          {fieldErrors['basic_info.speech_style'] && (
            <p className="text-xs text-red-500">{fieldErrors['basic_info.speech_style']}</p>
          )}
          <div className="flex items-center gap-2 mt-2">
            <span className="text-xs text-gray-500">토큰 삽입:</span>
            <Button type="button" variant="secondary" size="sm" title="{{character}} 삽입" onClick={() => insertBasicToken('speech_style','speech_style', TOKEN_CHARACTER)}>캐릭터</Button>
            <Button type="button" variant="secondary" size="sm" title="{{user}} 삽입" onClick={() => insertBasicToken('speech_style','speech_style', TOKEN_USER)}>유저</Button>
          </div>
        </div>

        {/* ✅ 위저드(일반 생성)에서는 "도입부/첫대사"를 start_sets 탭에서 입력한다.
            - 기존 인사말 UI는 중복 노출/혼란을 만들 수 있어 숨긴다(최소 수정/안전). */}
        {!useNormalCreateWizard && (
        <div>
          <Label htmlFor="greetings">인사말</Label>
          {(formData.basic_info.greetings || ['']).map((greeting, index) => (
            <div key={index} className="mt-4">
              <div className="flex gap-2">
                <Textarea
                  id={index === 0 ? "greeting" : `greeting_${index}`}
                  data-autogrow="1"
                  onInput={handleAutoGrowTextarea}
                  className="flex-1 resize-none overflow-hidden"
                  value={greeting}
                  onChange={(e) => {
                    const newGreetings = [...(formData.basic_info.greetings || [''])];
                    newGreetings[index] = e.target.value;
                    updateFormData('basic_info', 'greetings', newGreetings);
                  }}
                  placeholder={`인사말 ${index + 1} - 채팅을 시작할 때 캐릭터가 건네는 첫마디`}
                  rows={2}
                  maxLength={500}
                />
                {(formData.basic_info.greetings || ['']).length > 1 && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const newGreetings = (formData.basic_info.greetings || ['']).filter((_, i) => i !== index);
                      updateFormData('basic_info', 'greetings', newGreetings.length ? newGreetings : ['']);
                    }}
                    className="px-3 self-start mt-1"
                  >
                    삭제
                  </Button>
                )}
              </div>
              <div className="flex items-center gap-2 mt-2">
                <span className="text-xs text-gray-500">토큰 삽입:</span>
                <Button 
                  type="button" 
                  variant="secondary" 
                  size="sm" 
                  title="{{character}} 삽입" 
                  onClick={() => {
                    const el = document.getElementById(index === 0 ? "greeting" : `greeting_${index}`);
                    const current = greeting || '';
                    const { next, caret } = insertAtCursor(el, current, TOKEN_CHARACTER);
                    const newGreetings = [...(formData.basic_info.greetings || [''])];
                    newGreetings[index] = next;
                    updateFormData('basic_info', 'greetings', newGreetings);
                    if (el && caret !== null) {
                      setTimeout(() => { try { el.focus(); el.setSelectionRange(caret, caret); } catch(_){} }, 0);
                    }
                  }}
                >
                  캐릭터
                </Button>
                <Button 
                  type="button" 
                  variant="secondary" 
                  size="sm" 
                  title="{{user}} 삽입"
                  onClick={() => {
                    const el = document.getElementById(index === 0 ? "greeting" : `greeting_${index}`);
                    const current = greeting || '';
                    const { next, caret } = insertAtCursor(el, current, TOKEN_USER);
                    const newGreetings = [...(formData.basic_info.greetings || [''])];
                    newGreetings[index] = next;
                    updateFormData('basic_info', 'greetings', newGreetings);
                    if (el && caret !== null) {
                      setTimeout(() => { try { el.focus(); el.setSelectionRange(caret, caret); } catch(_){} }, 0);
                    }
                  }}
                >
                  유저
                </Button>
              </div>
            </div>
          ))}
          
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              const newGreetings = [...(formData.basic_info.greetings || ['']), ''];
              updateFormData('basic_info', 'greetings', newGreetings);
            }}
            className="w-full mt-4"
          >
            인사말 추가
          </Button>
          
          {(formData.basic_info.greetings || ['']).length > 1 && (
            <p className="text-sm text-gray-500 mt-2">
              2개 이상일 때 채팅 시작 시 랜덤으로 선택됩니다
            </p>
          )}
          
          {fieldErrors['basic_info.greetings'] && (
            <p className="text-xs text-red-500 mt-2">{fieldErrors['basic_info.greetings']}</p>
          )}
        </div>
        )}
      </div>

      <Separator />

      <div className="space-y-4">
        <h3 className="text-lg font-semibold">세계관</h3>
        <div>
          <Label htmlFor="world_setting">
            세계관 설정 {!isEditMode && <span className="text-red-400 ml-1">*</span>}
          </Label>
          <Textarea
            id="world_setting"
            data-autogrow="1"
            onInput={handleAutoGrowTextarea}
            className="mt-2 resize-none overflow-hidden"
            value={formData.basic_info.world_setting}
            onChange={(e) => updateFormData('basic_info', 'world_setting', e.target.value)}
            placeholder="이야기의 배경에 대해서 설명해주세요"
            rows={4}
            maxLength={3000}
            required={!isEditMode}
          />
          {fieldErrors['basic_info.world_setting'] && (
            <p className="text-xs text-red-500">{fieldErrors['basic_info.world_setting']}</p>
          )}
          <div className="flex items-center gap-2 mt-2">
            <span className="text-xs text-gray-500">토큰 삽입:</span>
            <Button type="button" variant="secondary" size="sm" title="{{character}} 삽입" onClick={() => insertBasicToken('world_setting','world_setting', TOKEN_CHARACTER)}>캐릭터</Button>
            <Button type="button" variant="secondary" size="sm" title="{{user}} 삽입" onClick={() => insertBasicToken('world_setting','world_setting', TOKEN_USER)}>유저</Button>
          </div>
        </div>

        {/* ✅ 캐릭터 비밀정보(선택): 도입부와 분리된 기본 정보 항목 */}
        <div>
          <Label htmlFor="character_secret_info">비밀정보 (선택)</Label>
          <Textarea
            id="character_secret_info"
            data-autogrow="1"
            onInput={handleAutoGrowTextarea}
            className="mt-2 resize-none overflow-hidden"
            value={formData?.basic_info?.introduction_scenes?.[0]?.secret || ''}
            onChange={(e) => updateCharacterSecretInfo(e.target.value)}
            placeholder="유저에게는 노출되지 않는 설정(금기/약점/숨겨진 관계/진짜 목적 등)을 적어두면 프롬프트 생성기에 전달됩니다."
            rows={3}
            maxLength={1000}
          />
          <p className="text-sm text-gray-500 mt-1">필수 입력이 아니며, 캐릭터 전체에 적용됩니다.</p>
          {(() => {
            try {
              const keys = Object.keys(fieldErrors || {}).filter((k) => k.startsWith('basic_info.introduction_scenes.') && k.endsWith('.secret'));
              const firstKey = keys[0];
              return firstKey ? <p className="text-xs text-red-500 mt-2">{fieldErrors[firstKey]}</p> : null;
            } catch (_) {
              return null;
            }
          })()}
          <div className="flex items-center gap-2 mt-2">
            <span className="text-xs text-gray-500">토큰 삽입:</span>
            <Button type="button" variant="secondary" size="sm" title="{{character}} 삽입" onClick={() => insertCharacterSecretToken(TOKEN_CHARACTER)}>캐릭터</Button>
            <Button type="button" variant="secondary" size="sm" title="{{user}} 삽입" onClick={() => insertCharacterSecretToken(TOKEN_USER)}>유저</Button>
          </div>
        </div>

        {/* ✅ 요구사항: '사용자용 설명' → '크리에이터 코멘트' (토글 ON일 때만 입력 박스 노출) */}
        <div>
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="user_display_description">
              크리에이터 코멘트 <span className="text-xs text-gray-500 ml-2">(선택)</span>
            </Label>
            <div className="flex items-center gap-2">
              <Switch
                id="creator_comment_toggle"
                checked={!!formData?.basic_info?.use_custom_description}
                onCheckedChange={(checked) => {
                  try {
                    updateFormData('basic_info', 'use_custom_description', !!checked);
                  } catch (e) {
                    try { console.error('[CreateCharacterPage] creator comment toggle failed:', e); } catch (_) {}
                  }
                }}
                aria-label="크리에이터 코멘트 사용"
              />
            </div>
          </div>
          {!!formData?.basic_info?.use_custom_description ? (
            <>
              <Textarea
                id="user_display_description"
                data-autogrow="1"
                onInput={handleAutoGrowTextarea}
                className="mt-3 resize-none overflow-hidden bg-gray-950/30 border-gray-700 text-gray-100 placeholder:text-gray-500"
                value={formData.basic_info.user_display_description}
                onChange={(e) => updateFormData('basic_info', 'user_display_description', e.target.value)}
                placeholder="유저에게 보여줄 크리에이터 코멘트를 작성하세요"
                rows={3}
                maxLength={1000}
              />
              {fieldErrors['basic_info.user_display_description'] && (
                <p className="text-xs text-red-500 mt-2">{fieldErrors['basic_info.user_display_description']}</p>
              )}
              <div className="flex items-center gap-2 mt-2">
                <span className="text-xs text-gray-500">토큰 삽입:</span>
                <Button type="button" variant="secondary" size="sm" title="{{character}} 삽입" onClick={() => insertBasicToken('user_display_description','user_display_description', TOKEN_CHARACTER)}>캐릭터</Button>
                <Button type="button" variant="secondary" size="sm" title="{{user}} 삽입" onClick={() => insertBasicToken('user_display_description','user_display_description', TOKEN_USER)}>유저</Button>
              </div>
            </>
          ) : (
            <div className="mt-2 text-xs text-gray-500">원하면 켜고 작성할 수 있어요.</div>
          )}
        </div>
      </div>

      <Separator />

      {/* ✅ 위저드(일반 생성)에서는 start_sets(도입부+첫대사)로 대체한다. */}
      {!useNormalCreateWizard && (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">도입부</h3>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={addIntroductionScene}
          >
            <Plus className="w-4 h-4 mr-2" />
            도입부 추가
          </Button>
        </div>
        
        {formData.basic_info.introduction_scenes.map((scene, index) => (
          <Card key={index} className="p-4 bg-white text-black border border-gray-200">
            <div className="flex items-center justify-between mb-3">
              <h4 className="font-medium">#{index + 1} {scene.title || '도입부'}</h4>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="text-red-600 border-red-200 hover:bg-red-50"
                onClick={() => removeIntroductionScene(index)}
              >
                <Trash2 className="w-4 h-4 mr-1" />
                도입부 삭제
              </Button>
            </div>
            
            <div className="space-y-3">
              <div>
                <div className="flex items-center justify-between">
                  <Label className="!text-black">시작하는 상황을 입력해주세요</Label>
                  <div className="flex gap-1">
                    <Button type="button" variant="secondary" size="sm" onClick={() => {
                      setFormData(prev => {
                        const arr = [...prev.basic_info.introduction_scenes];
                        if (index === 0) return prev;
                        const item = arr.splice(index, 1)[0];
                        arr.splice(index-1, 0, item);
                        return { ...prev, basic_info: { ...prev.basic_info, introduction_scenes: arr } };
                      });
                    }}>위로</Button>
                    <Button type="button" variant="secondary" size="sm" onClick={() => {
                      setFormData(prev => {
                        const arr = [...prev.basic_info.introduction_scenes];
                        if (index >= arr.length-1) return prev;
                        const item = arr.splice(index, 1)[0];
                        arr.splice(index+1, 0, item);
                        return { ...prev, basic_info: { ...prev.basic_info, introduction_scenes: arr } };
                      });
                    }}>아래로</Button>
                  </div>
                </div>
                <Textarea
                  id={`intro_content_${index}`}
                  data-autogrow="1"
                  onInput={handleAutoGrowTextarea}
                  className="mt-4 bg-white text-black placeholder-gray-500 border-gray-300 resize-none overflow-hidden"
                  value={scene.content}
                  onChange={(e) => updateIntroductionScene(index, 'content', e.target.value)}
                  placeholder="시작 할 때 나오는 대사를 입력해주세요."
                  rows={3}
                  maxLength={2000}
                />
                {fieldErrors[`basic_info.introduction_scenes.${index}.content`] && (
                  <p className="text-xs text-red-500">{fieldErrors[`basic_info.introduction_scenes.${index}.content`]}</p>
                )}
                <div className="flex items-center gap-2 mt-2">
                  <span className="text-xs text-gray-500">토큰 삽입:</span>
                  <Button type="button" variant="secondary" size="sm" title="{{character}} 삽입" onClick={() => insertIntroToken(index, 'content', TOKEN_CHARACTER)}>캐릭터</Button>
                  <Button type="button" variant="secondary" size="sm" title="{{user}} 삽입" onClick={() => insertIntroToken(index, 'content', TOKEN_USER)}>유저</Button>
                </div>
              </div>
            </div>
          </Card>
        ))}
      </div>
      )}
    </div>
  );

  const renderStartSetsWizardTab = () => {
    const ss = (formData?.basic_info?.start_sets && typeof formData.basic_info.start_sets === 'object')
      ? formData.basic_info.start_sets
      : { selectedId: '', items: [] };
    const items = Array.isArray(ss.items) ? ss.items : [];
    const selectedId = String(ss.selectedId || '').trim() || String(items?.[0]?.id || '').trim();

    const addSet = () => {
      const id = genStartSetId();
      updateStartSets((prev) => {
        const cur = (prev && typeof prev === 'object') ? prev : {};
        const curItems = Array.isArray(cur.items) ? cur.items : [];
        const nextItems = [
          ...curItems,
          // ✅ 기본 탭명(UX): 오프닝 N
          {
            id,
            title: `오프닝 ${curItems.length + 1}`,
            intro: '',
            firstLine: '',
            // ✅ 턴수별 사건(확장): start_sets item 단위로 저장(SSOT)
            // - "턴 사건(필수) > 설정메모 트리거(보조)" 우선순위는 추후 런타임/프롬프트에서 적용한다.
            turn_events: [], // [{ id, title, about_turn, summary, required_narration, required_dialogue }]
            // ✅ 엔딩 설정(확장): start_sets item 단위로 저장(SSOT)
            ending_settings: { min_turns: 30, endings: [] },
            // ✅ 스탯 설정(확장): start_sets item 단위로 저장(SSOT)
            stat_settings: { stats: [] },
          },
        ];
        // ✅ 새로 추가한 탭을 즉시 활성화
        const nextSelected = id;
        // ✅ 방어: start_sets에는 추가 키(sim_options 등)가 붙을 수 있으므로 유지한다.
        return { ...cur, selectedId: nextSelected, items: nextItems };
      });
    };

    const removeSet = (idLike) => {
      const id = String(idLike || '').trim();
      if (!id) return;
      updateStartSets((prev) => {
        const cur = (prev && typeof prev === 'object') ? prev : {};
        const curItems = Array.isArray(cur.items) ? cur.items : [];
        const nextItems = curItems.filter((x) => String(x?.id || '').trim() !== id);
        if (!nextItems.length) {
          const fallbackId = genStartSetId();
          return {
            ...cur,
            selectedId: fallbackId,
            items: [{
              id: fallbackId,
              title: '오프닝 1',
              intro: '',
              firstLine: '',
              turn_events: [],
              ending_settings: { min_turns: 30, endings: [] },
              stat_settings: { stats: [] },
            }],
          };
        }
        const curSelected = String(cur.selectedId || '').trim();
        const nextSelected = (curSelected && curSelected !== id) ? curSelected : String(nextItems[0]?.id || '').trim();
        return { ...cur, selectedId: nextSelected, items: nextItems };
      });
    };

    const moveSet = (from, to) => {
      updateStartSets((prev) => {
        const cur = (prev && typeof prev === 'object') ? prev : {};
        const curItems = Array.isArray(cur.items) ? [...cur.items] : [];
        const f = Number(from);
        const t = Number(to);
        if (!Number.isFinite(f) || !Number.isFinite(t)) return cur;
        if (f < 0 || f >= curItems.length) return cur;
        if (t < 0 || t >= curItems.length) return cur;
        if (f === t) return cur;
        const item = curItems.splice(f, 1)[0];
        curItems.splice(t, 0, item);
        return { ...cur, items: curItems };
      });
    };

    const updateSetField = (idLike, patch) => {
      const id = String(idLike || '').trim();
      if (!id) return;
      updateStartSets((prev) => {
        const cur = (prev && typeof prev === 'object') ? prev : {};
        const curItems = Array.isArray(cur.items) ? cur.items : [];
        const nextItems = curItems.map((x) => {
          const xid = String(x?.id || '').trim();
          if (xid !== id) return x;
          return { ...(x || {}), ...(patch || {}) };
        });
        const nextSelected = String(cur.selectedId || '').trim() || id;
        return { ...cur, selectedId: nextSelected, items: nextItems };
      });
    };

    const selectSet = (idLike) => {
      const id = String(idLike || '').trim();
      if (!id) return;
      updateStartSets((prev) => ({ ...(prev || {}), selectedId: id, items: Array.isArray(prev?.items) ? prev.items : items }));
    };

    return (
      <div className="relative space-y-6 p-6">
        {/* ✅ 토큰 안내(i): 오프닝에서 {{char}}/{{user}} 지원 */}
        <WizardTokenHelpIcon />
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-sm text-gray-300">
              여러 개의 <span className="text-white font-semibold">오프닝(첫 상황+첫대사)</span>을 만들고, 탭으로 전환해 시작을 선택할 수 있어요.
            </div>
            <div className="text-xs text-gray-500 mt-1">
              선택된 오프닝은 저장 시 기존 `인사말/도입부`에도 자동 반영됩니다(호환/안전).
            </div>
          </div>
        </div>

        {(() => {
          const safeItems = items.length
            ? items
            : [{
              id: genStartSetId(),
              title: '오프닝 1',
              intro: '',
              firstLine: '',
              turn_events: [],
              ending_settings: { min_turns: 30, endings: [] },
              stat_settings: { stats: [] },
            }];
          const activeIdx = Math.max(0, safeItems.findIndex((x) => String(x?.id || '').trim() === String(selectedId || '').trim()));
          const activeSet = safeItems[activeIdx] || safeItems[0] || {};
          const activeId = String(activeSet?.id || '').trim() || String(selectedId || '').trim() || `set_${activeIdx + 1}`;
          // ✅ 탭 라벨과 입력값 분리(요구사항):
          // - title이 비어 있으면: 탭에는 "오프닝 N"으로 보이되, 입력필드는 빈 값이어야 한다.
          // - 입력필드가 비어 있으면 경고 문구를 노출한다.
          const activeTitleRaw = String(activeSet?.title || '');
          const activeTitleDisplay = String(activeSet?.title || '').trim() || `오프닝 ${activeIdx + 1}`;

          return (
            <div className="space-y-4">
              {/* 탭(세트) 선택 */}
              <div className="flex flex-wrap items-center gap-2">
                {safeItems.map((set, idx) => {
                  const id = String(set?.id || '').trim() || `set_${idx + 1}`;
                  const active = id === activeId;
                  const title = String(set?.title || '').trim() || `오프닝 ${idx + 1}`;
                  return (
                    <div
                      key={id}
                      role="button"
                      tabIndex={0}
                      onClick={() => selectSet(id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          selectSet(id);
                        }
                      }}
                      className={[
                        'inline-flex items-center gap-2 h-9 px-3 rounded-full border transition cursor-pointer select-none',
                        active
                          ? 'bg-black/20 border-purple-500 text-white'
                          : 'bg-black/20 border-white/10 text-white/80 hover:bg-white/5 hover:text-white',
                      ].join(' ')}
                      title={title}
                      aria-current={active ? 'true' : undefined}
                    >
                      <span className="text-sm font-semibold max-w-[140px] truncate">{title}</span>
                      {safeItems.length > 1 && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            removeSet(id);
                          }}
                          className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-black/30 text-gray-200 hover:bg-black/50 hover:text-white"
                          aria-label="오프닝 삭제"
                          title="오프닝 삭제"
                        >
                          ×
                        </button>
                      )}
                    </div>
                  );
                })}

                {/* ✅ 경쟁사 UX: "오프닝 추가 +"를 탭으로 제공 */}
                <button
                  type="button"
                  onClick={() => {
                    try { addSet(); } catch (_) {}
                  }}
                  className={[
                    'inline-flex items-center gap-2 h-9 px-3 rounded-full border transition',
                    'bg-black/20 border-white/10 text-white/80 hover:bg-white/5 hover:text-white',
                  ].join(' ')}
                  title="오프닝 추가"
                  aria-label="오프닝 추가"
                >
                  <span className="text-sm font-semibold">오프닝 추가 +</span>
                </button>

                {/* (요구사항) 오프닝 전환용 좌/우(<>) 버튼 제거: 탭 클릭으로만 전환 */}
              </div>

              {/* 선택된 탭 편집(심플 UI): 박스 중첩 제거 + textarea 자동 확장 */}
              <div className="space-y-4">
                <div>
                  <Label className="text-white">오프닝 이름(탭 제목)</Label>
                  <div className="relative mt-2">
                    <Input
                      value={activeTitleRaw}
                      onChange={(e) => updateSetField(activeId, { title: e.target.value })}
                      onBlur={refreshChatPreviewSnapshot}
                      className="bg-gray-950/40 border-white/10 text-white placeholder:text-gray-500 pr-16"
                      placeholder={`예: ${activeTitleDisplay}`}
                    />
                    <CharLimitCounter value={activeTitleRaw} max={100} />
                  </div>
                  {String(activeTitleRaw || '').length > 100 ? (
                    <p className="mt-1 text-xs text-rose-400">최대 100자까지 입력할 수 있어요.</p>
                  ) : null}
                  {!String(activeTitleRaw || '').trim() && (
                    <p className="mt-2 text-xs text-red-400 font-semibold">오프닝 이름을 입력해주세요.</p>
                  )}
                </div>

                <div>
                  <Label className="text-white">첫 상황(도입부)</Label>
                  <div className="relative mt-2">
                    <Textarea
                      data-autogrow="1"
                      onInput={handleAutoGrowTextarea}
                      value={String(activeSet?.intro || '')}
                      onChange={(e) => updateSetField(activeId, { intro: e.target.value })}
                      onBlur={refreshChatPreviewSnapshot}
                      className="bg-gray-950/40 border border-white/10 text-white placeholder:text-gray-500 resize-none overflow-hidden pr-16 pb-6"
                      rows={4}
                      placeholder="예: 당신은 비 오는 밤, 낡은 서점에서 그를 만난다..."
                      disabled={quickFirstStartGenLoadingId === activeId}
                      readOnly={quickFirstStartGenLoadingId === activeId}
                      aria-busy={quickFirstStartGenLoadingId === activeId}
                    />
                    <CharLimitCounter value={String(activeSet?.intro || '')} max={2000} />
                    {quickFirstStartGenLoadingId === activeId ? (
                      <div className="absolute inset-0 flex items-center justify-center rounded-md bg-black/20 cursor-wait">
                        <div className="relative flex items-center justify-center">
                          <Loader2 className="h-6 w-6 animate-spin text-gray-200" aria-hidden="true" />
                          <button
                            type="button"
                            onClick={handleCancelFirstStartGeneration}
                            className="absolute -top-1 -right-4 p-1 rounded-full bg-red-500/20 hover:bg-red-500/30 text-red-300 hover:text-red-200 transition-colors pointer-events-auto z-10"
                            aria-label="오프닝 자동 생성 취소"
                            title="오프닝 자동 생성 취소"
                          >
                            <X className="h-3 w-3" aria-hidden="true" />
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                  {String(activeSet?.intro || '').length > 2000 ? (
                    <p className="mt-1 text-xs text-rose-400">최대 2000자까지 입력할 수 있어요.</p>
                  ) : null}
                </div>

                <div>
                  <Label className="text-white">첫 대사 <span className="text-red-400">*</span></Label>
                  <div className="relative mt-2">
                    <Textarea
                      data-autogrow="1"
                      onInput={handleAutoGrowTextarea}
                      value={String(activeSet?.firstLine || '')}
                      onChange={(e) => updateSetField(activeId, { firstLine: e.target.value })}
                      onBlur={refreshChatPreviewSnapshot}
                      className="bg-gray-950/40 border border-white/10 text-white placeholder:text-gray-500 resize-none overflow-hidden pr-16 pb-6"
                      rows={2}
                      placeholder="예: ...드디어 왔네. 기다리고 있었어."
                      disabled={quickFirstStartGenLoadingId === activeId}
                      readOnly={quickFirstStartGenLoadingId === activeId}
                      aria-busy={quickFirstStartGenLoadingId === activeId}
                    />
                    <CharLimitCounter value={String(activeSet?.firstLine || '')} max={500} />
                    {quickFirstStartGenLoadingId === activeId ? (
                      <div className="absolute inset-0 flex items-center justify-center rounded-md bg-black/20 cursor-wait">
                        <div className="relative flex items-center justify-center">
                          <Loader2 className="h-6 w-6 animate-spin text-gray-200" aria-hidden="true" />
                          <button
                            type="button"
                            onClick={handleCancelFirstStartGeneration}
                            className="absolute -top-1 -right-4 p-1 rounded-full bg-red-500/20 hover:bg-red-500/30 text-red-300 hover:text-red-200 transition-colors pointer-events-auto z-10"
                            aria-label="오프닝 자동 생성 취소"
                            title="오프닝 자동 생성 취소"
                          >
                            <X className="h-3 w-3" aria-hidden="true" />
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                  {String(activeSet?.firstLine || '').length > 500 ? (
                    <p className="mt-1 text-xs text-rose-400">최대 500자까지 입력할 수 있어요.</p>
                  ) : null}
                  <div className="mt-3 flex justify-end">
                    <button
                      type="button"
                      onClick={() => handleAutoGenerateFirstStart(activeId)}
                      disabled={quickFirstStartGenLoadingId === activeId}
                      className="h-9 px-3 rounded-lg bg-white/10 text-white text-sm font-semibold hover:bg-white/15 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
                      aria-label="오프닝 자동 생성"
                      title="오프닝 자동 생성"
                    >
                      {quickFirstStartGenLoadingId === activeId ? (
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                      ) : (
                        '자동 생성'
                      )}
                    </button>
                  </div>
                </div>

                {/* ✅ 턴수별 사건(오프닝 내): 햄버거 카드 + 필수 지문/대사 */}
                {(() => {
                  /**
                   * ✅ 턴수별 사건(오프닝 단위)
                   *
                   * 의도/원리:
                   * - 오프닝은 탭 기반이므로, "이 오프닝으로 시작했을 때의 진행표"를 같은 화면에서 설계하는 것이 UX가 가장 자연스럽다.
                   * - 사건은 "필수 연출(지문/대사)"가 핵심이며, 턴은 '약' 개념(LLM 임의성)으로만 사용한다.
                   *
                   * 충돌 규칙(확정):
                   * - 턴 사건(필수) > 설정메모 트리거(보조)
                   * - 같은 턴에 트리거가 걸리더라도 사건은 유지되고, 트리거는 컨텍스트 보강으로만 반영(충돌 시 다음 턴부터 반영)
                   *
                   * 저장(SSOT):
                   * - basic_info.start_sets.items[].turn_events
                   *   [{ id, title, about_turn, summary, required_narration, required_dialogue }]
                   */
                  const simMaxTurns = (() => {
                    try {
                      const sim = (ss && typeof ss === 'object' && ss.sim_options && typeof ss.sim_options === 'object')
                        ? ss.sim_options
                        : null;
                      const raw = sim ? Number(sim.max_turns ?? 0) : 0;
                      const mt = Number.isFinite(raw) ? Math.floor(raw) : 0;
                      return (mt >= 50) ? mt : null;
                    } catch (_) {
                      return null;
                    }
                  })();

                  const turnEvents = Array.isArray(activeSet?.turn_events) ? activeSet.turn_events : [];
                  const genEventId = () => {
                    try { return `ev_${Date.now()}_${Math.random().toString(16).slice(2, 7)}`; } catch (_) { return `ev_${Date.now()}`; }
                  };
                  const updateEvents = (next) => {
                    const list = Array.isArray(next) ? next : [];
                    updateSetField(activeId, { turn_events: list });
                  };

                  const usedTurns = (() => {
                    try {
                      const map = {};
                      for (const ev of (Array.isArray(turnEvents) ? turnEvents : [])) {
                        const t = Number(ev?.about_turn);
                        if (!Number.isFinite(t)) continue;
                        const n = Math.floor(t);
                        if (n <= 0) continue;
                        map[n] = (map[n] || 0) + 1;
                      }
                      return map;
                    } catch (_) {
                      return {};
                    }
                  })();

                  const isTurnEventsAutoGenBusy = (quickTurnEventsGenLoadingId === activeId);

                  return (
                    <div className="relative pt-2">
                      {/* ✅ 요구사항: 턴수별 사건 자동생성 중 입력박스 스피너(오버레이) */}
                      {isTurnEventsAutoGenBusy ? (
                        <div className="absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-black/25 cursor-wait">
                          <div className="relative flex items-center justify-center">
                            <Loader2 className="h-7 w-7 animate-spin text-gray-200" aria-hidden="true" />
                            <button
                              type="button"
                              onClick={handleCancelTurnEventsGeneration}
                              className="absolute -top-1 -right-4 p-1 rounded-full bg-red-500/20 hover:bg-red-500/30 text-red-300 hover:text-red-200 transition-colors pointer-events-auto z-10"
                              aria-label="턴수별 사건 자동 생성 취소"
                              title="턴수별 사건 자동 생성 취소"
                            >
                              <X className="h-3 w-3" aria-hidden="true" />
                            </button>
                          </div>
                        </div>
                      ) : null}
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-white font-semibold">턴수별 사건</div>
                          <div className="mt-1 text-xs text-gray-400">
                            턴 사건은 <span className="text-gray-200 font-semibold">필수 연출</span>이에요. 설정메모 트리거와 충돌 시 사건이 우선합니다.
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="text-xs text-gray-500">
                            {turnEvents.length}개
                          </div>
                          <button
                            type="button"
                            onClick={() => handleAutoGenerateTurnEvents(activeId)}
                            disabled={isTurnEventsAutoGenBusy}
                            className="h-9 px-3 rounded-lg bg-white/10 text-white text-sm font-semibold hover:bg-white/15 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
                            aria-label="턴수별 사건 자동 생성"
                            title="턴수별 사건 자동 생성"
                          >
                            {isTurnEventsAutoGenBusy ? (
                              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                            ) : (
                              '자동 생성'
                            )}
                          </button>
                        </div>
                      </div>

                      <div className={["mt-3 space-y-3", isTurnEventsAutoGenBusy ? "pointer-events-none opacity-70" : ""].join(' ')}>
                        {turnEvents.map((ev, idx) => {
                          const eid = String(ev?.id || '').trim() || `ev_${idx + 1}`;
                          const title = String(ev?.title || '').trim();
                          const label = title || `사건 ${idx + 1}`;
                          const aboutTurnRaw = ev?.about_turn;
                          const aboutTurnNum = Number(aboutTurnRaw);
                          const aboutTurn = Number.isFinite(aboutTurnNum) ? Math.floor(aboutTurnNum) : null;
                          const summary = String(ev?.summary || '').trim();
                          const reqNarr = String(ev?.required_narration || '');
                          const reqDlg = String(ev?.required_dialogue || '');
                          const isOpen = !!(turnEventAccordionOpenById && turnEventAccordionOpenById[eid] !== false);
                          const isTurnDuplicate = (aboutTurn != null && usedTurns[aboutTurn] >= 2);

                          const updateEventAt = (patch) => {
                            updateEvents(turnEvents.map((x) => (String(x?.id || '').trim() === eid ? { ...(x || {}), ...(patch || {}) } : x)));
                          };
                          const removeEvent = () => {
                            updateEvents(turnEvents.filter((x) => String(x?.id || '').trim() !== eid));
                            try { setTurnEventAccordionOpenById((prev) => { const next = { ...(prev || {}) }; delete next[eid]; return next; }); } catch (_) {}
                          };

                          return (
                            <div key={eid} className="rounded-lg border border-gray-700 bg-gray-900/30">
                              <div
                                role="button"
                                tabIndex={0}
                                onClick={() => {
                                  try {
                                    setTurnEventAccordionOpenById((prev) => {
                                      const cur = (prev && typeof prev === 'object') ? prev : {};
                                      const nextOpen = !(cur[eid] !== false);
                                      return { ...cur, [eid]: nextOpen };
                                    });
                                  } catch (_) {}
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault();
                                    try {
                                      setTurnEventAccordionOpenById((prev) => {
                                        const cur = (prev && typeof prev === 'object') ? prev : {};
                                        const nextOpen = !(cur[eid] !== false);
                                        return { ...cur, [eid]: nextOpen };
                                      });
                                    } catch (_) {}
                                  }
                                }}
                                className="w-full flex items-center justify-between gap-3 px-4 py-3 border-b border-gray-800 text-left hover:bg-white/5 transition-colors"
                                aria-expanded={isOpen}
                              >
                                <div className="min-w-0 flex items-center gap-3">
                                  <div className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-black/20 border border-white/10">
                                    <Menu className="h-4 w-4 text-gray-200" />
                                  </div>
                                  <div className="min-w-0">
                                    <div className="text-sm font-semibold text-white truncate">{label}</div>
                                    <div className="text-xs text-gray-400 truncate">
                                      {(aboutTurn != null ? `약 ${aboutTurn}턴` : '약 ?턴')}
                                      {summary ? ` · ${summary}` : ''}
                                    </div>
                                  </div>
                                </div>
                                <div className="flex items-center gap-1">
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.preventDefault();
                                      e.stopPropagation();
                                      try { setTurnEventAccordionOpenById((prev) => ({ ...(prev || {}), [eid]: true })); } catch (_) {}
                                      try {
                                        requestAnimationFrame(() => {
                                          try {
                                            const el = (typeof document !== 'undefined') ? document.getElementById(`turn-event-title-${eid}`) : null;
                                            if (el && typeof el.focus === 'function') el.focus();
                                          } catch (_) {}
                                        });
                                      } catch (_) {}
                                    }}
                                    className="inline-flex items-center justify-center h-8 w-8 rounded-md text-gray-300 hover:text-white hover:bg-gray-800 transition-colors"
                                    aria-label="사건 이름 수정"
                                    title="수정"
                                  >
                                    <SquarePen className="h-4 w-4" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.preventDefault();
                                      e.stopPropagation();
                                      removeEvent();
                                    }}
                                    className="inline-flex items-center justify-center h-8 w-8 rounded-md text-gray-300 hover:text-white hover:bg-gray-800 transition-colors"
                                    aria-label="사건 삭제"
                                    title="삭제"
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </button>
                                  <div className="ml-1 text-gray-400">
                                    {isOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                                  </div>
                                </div>
                              </div>

                              {isOpen && (
                                <div className="p-4 space-y-5">
                                  <div className="space-y-2">
                                    <div className="flex items-center justify-between gap-3">
                                      <Label className="text-white">사건명</Label>
                                      <div className="text-xs text-gray-500">{Math.min(30, title.length)} / 30</div>
                                    </div>
                                    <Input
                                      id={`turn-event-title-${eid}`}
                                      value={title}
                                      maxLength={30}
                                      onChange={(e) => updateEventAt({ title: e.target.value })}
                                      placeholder={`예: 사건 ${idx + 1}`}
                                      className="bg-gray-950/40 text-white border-white/10"
                                    />
                                    <div className="text-xs text-gray-500">비워두면 자동으로 {`사건 ${idx + 1}`}로 표시돼요.</div>
                                  </div>

                                  <div className="space-y-2">
                                    <Label className="text-white">약 턴수</Label>
                                    <Input
                                      type="number"
                                      min={1}
                                      max={simMaxTurns ?? undefined}
                                      value={aboutTurnRaw ?? ''}
                                      onChange={(e) => updateEventAt({ about_turn: e.target.value })}
                                      onBlur={() => {
                                        try {
                                          const raw = String(aboutTurnRaw ?? '').trim();
                                          if (!raw) { updateEventAt({ about_turn: '' }); return; }
                                          const n = Number(raw);
                                          if (!Number.isFinite(n)) { updateEventAt({ about_turn: '' }); return; }
                                          let v = Math.max(1, Math.floor(n));
                                          if (simMaxTurns != null) v = Math.min(simMaxTurns, v);
                                          updateEventAt({ about_turn: v });
                                        } catch (_) {}
                                      }}
                                      placeholder={simMaxTurns != null ? `예: 20 (1~${simMaxTurns})` : '예: 20'}
                                      className="bg-gray-950/40 text-white border-white/10"
                                    />
                                    {simMaxTurns != null && (aboutTurn != null && aboutTurn > simMaxTurns) ? (
                                      <div className="text-xs text-red-400 font-semibold">총 진행 턴수({simMaxTurns}턴)를 초과할 수 없습니다.</div>
                                    ) : null}
                                    {isTurnDuplicate ? (
                                      <div className="text-xs text-red-400 font-semibold">같은 턴에 사건이 중복되어 있어요. 턴수를 조정해주세요.</div>
                                    ) : null}
                                  </div>

                                  <div className="space-y-2">
                                    <div className="flex items-center justify-between gap-3">
                                      <Label className="text-white">발생사건(요약)</Label>
                                      <div className="text-xs text-gray-500">{Math.min(200, summary.length)} / 200</div>
                                    </div>
                                    <Textarea
                                      value={summary}
                                      maxLength={200}
                                      onChange={(e) => updateEventAt({ summary: e.target.value })}
                                      rows={3}
                                      className="bg-gray-950/40 text-white border-white/10 resize-none"
                                      placeholder="예: 경쟁자가 등장해 둘의 관계에 균열이 생긴다"
                                    />
                                  </div>

                                  <div className="space-y-2">
                                    <div className="flex items-center justify-between gap-3">
                                      <Label className="text-white">반드시 들어가야 하는 지문</Label>
                                      <div className="text-xs text-gray-500">{Math.min(1000, String(reqNarr || '').length)} / 1000</div>
                                    </div>
                                    <Textarea
                                      value={reqNarr}
                                      maxLength={1000}
                                      onChange={(e) => updateEventAt({ required_narration: e.target.value })}
                                      rows={4}
                                      className="bg-gray-950/40 text-white border-white/10 resize-none"
                                      placeholder="예: (여기에 지문을 입력) — 런타임에서는 `* ` 형태로 처리됩니다."
                                    />
                                    {/* ✅ 요구사항: 필수 지문에 이미지 코드([[img:...]]/{{img:...}})가 있으면, '지문 박스' 안에서 인라인 이미지로 미리보기 */}
                                    {(/\[\[\s*img\s*:/i.test(reqNarr) || /\{\{\s*img\s*:/i.test(reqNarr)) ? (
                                      <div className="mt-2 rounded-lg border border-white/10 bg-black/20 px-3 py-2">
                                        <div className="text-[11px] text-gray-400 font-semibold">미리보기</div>
                                        <div className="mt-2 flex justify-center">
                                          <div className="w-full my-1 whitespace-pre-line break-words rounded-md bg-[#363636]/80 px-3 py-2 text-center text-sm text-white border border-white/10">
                                            {renderChatPreviewTextWithInlineImages(reqNarr, `turn-ev-${eid}-req-narr`)}
                                          </div>
                                        </div>
                                      </div>
                                    ) : null}
                                  </div>

                                  <div className="space-y-2">
                                    <div className="flex items-center justify-between gap-3">
                                      <Label className="text-white">반드시 들어가야 하는 대사</Label>
                                      <div className="text-xs text-gray-500">{Math.min(500, String(reqDlg || '').length)} / 500</div>
                                    </div>
                                    <Textarea
                                      value={reqDlg}
                                      maxLength={500}
                                      onChange={(e) => updateEventAt({ required_dialogue: e.target.value })}
                                      rows={3}
                                      className="bg-gray-950/40 text-white border-white/10 resize-none"
                                      placeholder={'예: (여기에 대사를 입력) — 런타임에서는 "..." 형태로 처리됩니다.'}
                                    />
                                    {/* ✅ 요구사항: 필수 대사에 이미지 코드([[img:...]]/{{img:...}})가 있으면, '대사 말풍선' 안에서 인라인 이미지로 미리보기 */}
                                    {(/\[\[\s*img\s*:/i.test(reqDlg) || /\{\{\s*img\s*:/i.test(reqDlg)) ? (
                                      <div className="mt-2 rounded-lg border border-white/10 bg-black/20 px-3 py-2">
                                        <div className="text-[11px] text-gray-400 font-semibold">미리보기</div>
                                        <div className="mt-2 flex justify-start font-normal">
                                          <div className="mr-[0.62rem] mt-2 min-w-10">
                                            {chatPreviewAvatarUrl ? (
                                              <img alt="" loading="lazy" className="size-10 rounded-full object-cover" src={chatPreviewAvatarUrl} />
                                            ) : (
                                              <div className="size-10 rounded-full bg-[#2a2a2a]" />
                                            )}
                                          </div>
                                          <div className="relative max-w-[70%]">
                                            <div className="text-[0.75rem] text-white">
                                              {String(chatPreviewSnapshot?.name || '').trim() || '캐릭터'}
                                            </div>
                                            <div className="whitespace-pre-line break-words rounded-r-xl rounded-bl-xl bg-[#262727] p-2 text-sm text-white">
                                              {renderChatPreviewTextWithInlineImages(reqDlg, `turn-ev-${eid}-req-dlg`)}
                                            </div>
                                          </div>
                                        </div>
                                      </div>
                                    ) : null}
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })}

                        {(() => {
                          /**
                           * ✅ 수동 추가 개수 상한(요구사항)
                           * - 50:3, 100:6, 200:10, 300:15, 300초과:20
                           * - 프론트/백엔드 상한을 동일하게 유지(운영 안정).
                           */
                          const cap = (() => {
                            try {
                              const mt = (simMaxTurns != null) ? Number(simMaxTurns) : 0;
                              if (!Number.isFinite(mt) || mt <= 0) return 10;
                              if (mt <= 50) return 3;
                              if (mt <= 100) return 6;
                              if (mt <= 200) return 10;
                              if (mt <= 300) return 15;
                              return 20;
                            } catch (_) {
                              return 10;
                            }
                          })();
                          const reached = (turnEvents.length >= cap);
                          return reached ? (
                            <div className="text-xs text-gray-400">
                              이 진행 턴수에서는 사건을 <span className="text-gray-200 font-semibold">최대 {cap}개</span>까지 추가할 수 있어요.
                            </div>
                          ) : null;
                        })()}

                        <button
                          type="button"
                          onClick={() => {
                            const cap = (() => {
                              try {
                                const mt = (simMaxTurns != null) ? Number(simMaxTurns) : 0;
                                if (!Number.isFinite(mt) || mt <= 0) return 10;
                                if (mt <= 50) return 3;
                                if (mt <= 100) return 6;
                                if (mt <= 200) return 10;
                                if (mt <= 300) return 15;
                                return 20;
                              } catch (_) {
                                return 10;
                              }
                            })();
                            if (Array.isArray(turnEvents) && turnEvents.length >= cap) {
                              dispatchToast('error', `이 진행 턴수에서는 사건을 최대 ${cap}개까지 추가할 수 있어요.`);
                              return;
                            }
                            const id = genEventId();
                            updateEvents([
                              ...(Array.isArray(turnEvents) ? turnEvents : []),
                              { id, title: '', about_turn: '', summary: '', required_narration: '', required_dialogue: '' },
                            ]);
                            try { setTurnEventAccordionOpenById((prev) => ({ ...(prev || {}), [id]: true })); } catch (_) {}
                          }}
                          disabled={(() => {
                            try {
                              const mt = (simMaxTurns != null) ? Number(simMaxTurns) : 0;
                              const cap = (!Number.isFinite(mt) || mt <= 0) ? 10 : (mt <= 50 ? 3 : mt <= 100 ? 6 : mt <= 200 ? 10 : mt <= 300 ? 15 : 20);
                              return (Array.isArray(turnEvents) ? turnEvents.length : 0) >= cap;
                            } catch (_) {
                              return false;
                            }
                          })()}
                          className={[
                            "w-full h-12 rounded-md border border-gray-700 bg-gray-900/20 text-gray-200 hover:bg-gray-900/40 transition-colors font-semibold",
                            "disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-gray-900/20",
                          ].join(' ')}
                        >
                          + 사건 추가
                        </button>
                      </div>
                    </div>
                  );
                })()}
              </div>
            </div>
          );
        })()}
      </div>
    );
  };

  const renderEndingsWizardTab = () => {
    /**
     * ✅ 엔딩 설정(경쟁사 UI 기반)
     *
     * 저장 위치(SSOT):
     * - basic_info.start_sets.items[].ending_settings
     *   - min_turns: number (최소 10)
     *   - endings: [{ id, turn, title, base_condition, epilogue, hint, extra_conditions: [{id,...}] }]
     *
     * 의도/원리:
     * - 오프닝(시작 설정)마다 엔딩이 달라질 수 있으므로, start_sets "아이템 단위"로 엔딩을 보관한다.
     * - 스키마/DB 변경 없이도 안전하게 확장 가능(start_sets는 위저드 전용 JSON 저장소).
     */
    const ss = (formData?.basic_info?.start_sets && typeof formData.basic_info.start_sets === 'object')
      ? formData.basic_info.start_sets
      : { selectedId: '', items: [] };
    const items = Array.isArray(ss.items) ? ss.items : [];
    const selectedId = String(ss.selectedId || '').trim() || String(items?.[0]?.id || '').trim();
    const activeIdx = Math.max(0, items.findIndex((x) => String(x?.id || '').trim() === String(selectedId || '').trim()));
    const rawActive = items[activeIdx] || items[0] || {};
    const activeId = String(rawActive?.id || '').trim() || String(selectedId || '').trim() || `set_${activeIdx + 1}`;

    const normalizeEndingSettings = (maybe) => {
      try {
        const es = (maybe && typeof maybe === 'object') ? maybe : null;
        const minTurnsRaw = Number(es?.min_turns ?? 30);
        const minTurns = Number.isFinite(minTurnsRaw) ? Math.max(10, Math.floor(minTurnsRaw)) : 30;
        const endings = Array.isArray(es?.endings) ? es.endings : [];
        return { min_turns: minTurns, endings };
      } catch (_) {
        return { min_turns: 30, endings: [] };
      }
    };

    const endingSettings = normalizeEndingSettings(rawActive?.ending_settings);
    const endingMinTurns = endingSettings.min_turns;
    const endings = Array.isArray(endingSettings.endings) ? endingSettings.endings : [];
    const displaySetLabel = `기본 설정 ${activeIdx + 1}`;
    const activeTitle = String(rawActive?.title || '').trim() || `오프닝 ${activeIdx + 1}`;
    const simMaxTurns = (() => {
      /**
       * ✅ 전체 진행 턴수 상한(프로필 설정) 방어 계산
       *
       * 의도/원리:
       * - 사용자가 프로필에서 설정한 "총 진행 턴수"(예: 200턴)를 엔딩 턴수의 상한으로 사용한다.
       * - 값이 없거나 비정상이면 상한을 적용하지 않는다(하위호환/데이터 방어).
       */
      try {
        const sim = (ss && typeof ss === 'object' && ss.sim_options && typeof ss.sim_options === 'object')
          ? ss.sim_options
          : null;
        const raw = sim ? Number(sim.max_turns ?? 0) : 0;
        const mt = Number.isFinite(raw) ? Math.floor(raw) : 0;
        // ✅ 프로필에서 최소 50턴을 강제하고 있으므로, 50 미만이면 상한 적용하지 않음
        return (mt >= 50) ? mt : null;
      } catch (_) {
        return null;
      }
    })();

    /**
     * ✅ 엔딩 세부 조건: "스탯 조건" 지원(경쟁사 UX)
     *
     * - 기존(레거시): extra_conditions: [{ id, text }]
     * - 신규(스탯):  extra_conditions: [{ id, type:'stat', stat_id, op, value }]
     *
     * 방어/하위호환:
     * - 이미 저장된 text 조건은 그대로 렌더/편집 가능하게 유지한다.
     * - 스탯 이름은 id로 매칭하되, 없으면 저장된 stat_name(스냅샷) 또는 빈 값 처리.
     */
    const STAT_OP_OPTIONS = [
      { value: 'gt', label: '보다 높은' },
      { value: 'lt', label: '보다 낮은' },
      { value: 'eq', label: '같은' },
      { value: 'gte', label: '같거나 높은' },
      { value: 'lte', label: '같거나 낮은' },
    ];
    const availableStats = (() => {
      try {
        const st = rawActive?.stat_settings;
        const stats = Array.isArray(st?.stats) ? st.stats : [];
        return stats
          .map((s) => ({
            id: String(s?.id || '').trim(),
            name: String(s?.name || '').trim(),
          }))
          .filter((s) => s.id && s.name);
      } catch (_) {
        return [];
      }
    })();
    // ✅ 훅 금지: renderEndingsWizardTab 내부에서는 useMemo/useEffect 등 훅을 쓰면 훅 순서가 꼬여 런타임 크래시 위험이 있다.
    // - 스탯 개수는 매우 작으므로(최대 4) 렌더마다 단순 계산해도 부담이 없다.
    const statNameById = (() => {
      try {
        const map = {};
        for (const s of availableStats) map[s.id] = s.name;
        return map;
      } catch (_) {
        return {};
      }
    })();

    const genEndingId = () => {
      try { return `ending_${Date.now()}_${Math.random().toString(16).slice(2, 7)}`; }
      catch (_) { return `ending_${Date.now()}`; }
    };
    const genCondId = () => {
      try { return `cond_${Date.now()}_${Math.random().toString(16).slice(2, 7)}`; }
      catch (_) { return `cond_${Date.now()}`; }
    };

    const updateActiveEndingSettings = (patch) => {
      updateStartSets((prev) => {
        const cur = (prev && typeof prev === 'object') ? prev : {};
        const curItems = Array.isArray(cur.items) ? cur.items : [];
        const nextItems = curItems.map((x, idx) => {
          const xid = String(x?.id || '').trim() || `set_${idx + 1}`;
          if (xid !== activeId) return x;
          const base = (x && typeof x === 'object') ? x : {};
          const es = normalizeEndingSettings(base.ending_settings);
          return { ...base, ending_settings: { ...es, ...(patch || {}) } };
        });
        return { ...cur, items: nextItems };
      });
    };

    const updateEndingAt = (endingIdLike, patch) => {
      const endingId = String(endingIdLike || '').trim();
      if (!endingId) return;
      updateActiveEndingSettings({
        endings: endings.map((e) => {
          const id = String(e?.id || '').trim();
          if (id !== endingId) return e;
          return { ...(e || {}), ...(patch || {}) };
        }),
      });
    };

    const addEnding = () => {
      if (endings.length >= 10) return;
      const id = genEndingId();
      const defaultTurn = (() => {
        try {
          const base = Number(endingMinTurns || 10);
          if (simMaxTurns == null) return base;
          return Math.min(Number(simMaxTurns), base);
        } catch (_) {
          return Number(endingMinTurns || 10);
        }
      })();
      const next = [
        ...endings,
        // ✅ 신규 필드(요구사항): 엔딩 턴수(turn)
        // - 기존 데이터와 하위호환을 위해, 저장이 없으면 UI에서 min_turns로 안전 보정한다.
        { id, turn: defaultTurn, title: '', base_condition: '', epilogue: '', hint: '', extra_conditions: [] },
      ];
      updateActiveEndingSettings({ endings: next });
      // ✅ UX: 새로 추가된 엔딩은 자동으로 펼친다.
      try {
        setEndingAccordionOpenById((prev) => ({ ...(prev || {}), [id]: true }));
      } catch (_) {}
    };

    const removeEnding = (endingIdLike) => {
      const endingId = String(endingIdLike || '').trim();
      if (!endingId) return;
      const next = endings.filter((e) => String(e?.id || '').trim() !== endingId);
      updateActiveEndingSettings({ endings: next });
    };

    const addExtraCondition = (endingIdLike) => {
      const endingId = String(endingIdLike || '').trim();
      if (!endingId) return;
      const target = endings.find((e) => String(e?.id || '').trim() === endingId) || {};
      const list = Array.isArray(target?.extra_conditions) ? target.extra_conditions : [];
      if (list.length >= 7) return;
      // ✅ 경쟁사 UX: 기본은 스탯 조건으로 추가(스탯이 없으면 text 조건으로 폴백)
      if (availableStats.length > 0) {
        const first = availableStats[0];
        const nextList = [
          ...list,
          { id: genCondId(), type: 'stat', stat_id: first.id, stat_name: first.name, op: 'gte', value: '' },
        ];
        updateEndingAt(endingId, { extra_conditions: nextList });
        return;
      }
      const nextList = [...list, { id: genCondId(), type: 'text', text: '' }];
      updateEndingAt(endingId, { extra_conditions: nextList });
    };

    const removeExtraCondition = (endingIdLike, condIdLike) => {
      const endingId = String(endingIdLike || '').trim();
      const condId = String(condIdLike || '').trim();
      if (!endingId || !condId) return;
      const target = endings.find((e) => String(e?.id || '').trim() === endingId) || {};
      const list = Array.isArray(target?.extra_conditions) ? target.extra_conditions : [];
      updateEndingAt(endingId, { extra_conditions: list.filter((c) => String(c?.id || '').trim() !== condId) });
    };

    const hasAnyText = (v) => {
      try { return !!String(v ?? '').trim(); } catch (_) { return false; }
    };
    const hasAnyEndingTrace = (() => {
      try {
        // ✅ 이 버튼이 실제로 건드리는 범위는 "앞 2개 엔딩"이므로, 해당 범위만 검사한다.
        // - 뒤쪽(3번째 이후) 엔딩에 텍스트가 있어도 버튼이 불필요하게 막히지 않도록 방어
        const list = (Array.isArray(endings) ? endings : []).slice(0, 2);
        return list.some((e) => {
          // ✅ 한 글자라도 입력 흔적이 있으면 자동 생성 금지(요구사항)
          return !!(hasAnyText(e?.title) || hasAnyText(e?.base_condition) || hasAnyText(e?.hint) || hasAnyText(e?.epilogue));
        });
      } catch (_) {
        return false;
      }
    })();

    const canAutoGenerateTwoEndings = (() => {
      /**
       * ✅ 엔딩 2개 자동 생성 버튼 활성 조건(요구사항)
       *
       * - 덮어쓰기 허용: 입력 흔적이 있어도 경고 후 덮어쓸 수 있다.
       * - 프로필/프롬프트/오프닝(첫상황/첫대사) 필수
       */
      try {
        if (quickEndingBulkGenLoading) return false;
        if (String(quickEndingEpilogueGenLoadingId || '').trim()) return false;
        const nm = String(formData?.basic_info?.name || '').trim();
        const ds = String(formData?.basic_info?.description || '').trim();
        const wd = String(formData?.basic_info?.world_setting || '').trim();
        if (!nm || !ds || !wd) return false;
        const openingIntro = String(rawActive?.intro || '').trim();
        const openingFirstLine = String(rawActive?.firstLine || '').trim();
        if (!openingIntro || !openingFirstLine) return false;
        return true;
      } catch (_) {
        return false;
      }
    })();

    const handleAutoGenerateTwoEndingsInEndingTab = async (opts) => {
      /**
       * ✅ 엔딩탭: 엔딩 2개 자동 생성(요구사항)
       *
       * 원리:
       * - 현재 선택된 오프닝 기준으로 엔딩 2개(제목/기본조건/힌트/턴 + 에필로그)를 생성한다.
       *
       * 방어:
       * - 덮어쓰기 허용: 입력 흔적이 있으면 경고 모달 후 덮어쓴다.
       * - 로딩 중 중복 실행 방지.
       */
      if (quickEndingBulkGenLoading) return;
      if (!canAutoGenerateTwoEndings) {
        try {
          dispatchToast('error', '프로필/프롬프트/오프닝을 먼저 완성해주세요.');
        } catch (_) {}
        return;
      }
      const forceOverwrite = opts?.forceOverwrite === true;
      if (hasAnyEndingTrace && !forceOverwrite) {
        openAutoGenOverwriteConfirm(
          '엔딩(앞 2개)',
          async () => { await handleAutoGenerateTwoEndingsInEndingTab({ forceOverwrite: true }); }
        );
        return;
      }
      try {
        // ✅ 원문 저장 (취소 시 복구용)
        endingsAutoGenPrevRef.current = Array.isArray(endings) ? [...endings] : [];
        quickEndingBulkGenAbortRef.current = false;

        setQuickEndingBulkGenLoading(true);
        try { dispatchToast('info', '엔딩 2개 자동 생성 중...'); } catch (_) {}

        const nm = String(formData?.basic_info?.name || '').trim();
        const ds = String(formData?.basic_info?.description || '').trim();
        const wd = String(formData?.basic_info?.world_setting || '').trim();
        const openingIntro = String(rawActive?.intro || '').trim();
        const openingFirstLine = String(rawActive?.firstLine || '').trim();

        const maxTurnsForGen = (() => {
          try {
            const sim = (ss && typeof ss === 'object' && ss.sim_options && typeof ss.sim_options === 'object')
              ? ss.sim_options
              : null;
            const raw = sim ? Number(sim.max_turns ?? 200) : 200;
            const mt = Number.isFinite(raw) ? Math.floor(raw) : 200;
            return Math.max(50, mt || 200);
          } catch (_) {
            return 200;
          }
        })();
        const minTurnsForGen = Math.max(10, Number(endingMinTurns || 30));

        // ✅ 요구사항: "위저드만" 제미니 고정(다른 화면/로직에는 영향 주지 않음)
        const aiModel = useNormalCreateWizard
          ? 'gemini'
          : (String(user?.preferred_model || 'claude').trim().toLowerCase() || 'claude');
        const model = (aiModel === 'gpt' ? 'gpt' : (aiModel === 'gemini' ? 'gemini' : 'claude'));

        const clampTurn = (t) => {
          try {
            const v = Number(t);
            const n = Number.isFinite(v) ? Math.floor(v) : 0;
            if (!n) return Math.max(minTurnsForGen, Math.min(maxTurnsForGen, minTurnsForGen));
            return Math.max(minTurnsForGen, Math.min(maxTurnsForGen, n));
          } catch (_) {
            return Math.max(minTurnsForGen, Math.min(maxTurnsForGen, minTurnsForGen));
          }
        };

        const WANT_ENDINGS = 2;
        const existingEnds = Array.isArray(endings) ? endings : [];
        const built = [];

        for (let idx = 0; idx < WANT_ENDINGS; idx += 1) {
          const base = (existingEnds[idx] && typeof existingEnds[idx] === 'object') ? existingEnds[idx] : null;
          const baseId = String(base?.id || '').trim() || genEndingId();
          const baseTitle = forceOverwrite ? '' : String(base?.title || '').trim();
          const baseCond = forceOverwrite ? '' : String(base?.base_condition || '').trim();
          const baseHint = forceOverwrite ? '' : String(base?.hint || '').trim();
          const baseEpilogue = forceOverwrite ? '' : String(base?.epilogue || '').trim();
          const baseExtra = Array.isArray(base?.extra_conditions) ? base.extra_conditions : [];

          // 1) 제목/기본조건(초안)
          let title = baseTitle;
          let cond = baseCond;
          let hint = baseHint;
          let suggestedTurn = 0;
          if (!title || !cond) {
            // ✅ RP/시뮬 분기(요구사항) + 커스텀 프롬프트 지원
            const mode = inferAutoGenModeFromCharacterTypeAndWorld(formData?.basic_info?.character_type, wd);
            const draftRes = await charactersAPI.quickGenerateEndingDraft({
              name: nm,
              description: ds,
              world_setting: wd,
              opening_intro: openingIntro,
              opening_first_line: openingFirstLine,
              mode,
              max_turns: maxTurnsForGen,
              min_turns: minTurnsForGen,
              tags: Array.isArray(selectedTagSlugs) ? selectedTagSlugs : [],
              ai_model: model,
            });
            // ✅ 취소됐으면 결과 반영 안 함
            if (quickEndingBulkGenAbortRef.current) return;

            title = title || String(draftRes?.data?.title || '').trim();
            cond = cond || String(draftRes?.data?.base_condition || '').trim();
            hint = hint || String(draftRes?.data?.hint || '').trim();
            const suggestedTurnRaw = Number(draftRes?.data?.suggested_turn ?? 0);
            suggestedTurn = Number.isFinite(suggestedTurnRaw) ? Math.floor(suggestedTurnRaw) : 0;

            if (!title || !cond) {
              try { dispatchToast('error', '엔딩 초안 생성 결과가 비어있습니다. 잠시 후 다시 시도해주세요.'); } catch (_) {}
              return;
            }
          }

          // 2) 에필로그
          let epilogue = baseEpilogue;
          if (!epilogue) {
            // ✅ RP/시뮬 분기(요구사항) + 커스텀 프롬프트 지원
            const mode2 = inferAutoGenModeFromCharacterTypeAndWorld(formData?.basic_info?.character_type, wd);
            const epRes = await charactersAPI.quickGenerateEndingEpilogueDraft({
              name: nm,
              description: ds,
              world_setting: wd,
              opening_intro: openingIntro,
              opening_first_line: openingFirstLine,
              ending_title: title,
              base_condition: cond,
              hint,
              extra_conditions: baseExtra,
              mode: mode2,
              tags: Array.isArray(selectedTagSlugs) ? selectedTagSlugs : [],
              ai_model: model,
            });

            // ✅ 취소됐으면 결과 반영 안 함
            if (quickEndingBulkGenAbortRef.current) return;

            epilogue = String(epRes?.data?.epilogue || '').trim();
          }

          const turnRaw = (forceOverwrite ? (suggestedTurn || minTurnsForGen) : ((base?.turn != null && base?.turn !== '') ? Number(base.turn) : (suggestedTurn || minTurnsForGen)));
          const turn = clampTurn(turnRaw);

          built.push({
            id: baseId,
            turn,
            // ✅ 방어: 자동생성 결과도 UI 제한을 넘기지 않게 클램프(엔딩 탭 maxLength와 일치)
            title: String(title || '').slice(0, 20),
            base_condition: String(cond || '').slice(0, 500),
            hint: String(hint || '').slice(0, 20),
            epilogue: String(epilogue || '').slice(0, 1000),
            extra_conditions: baseExtra,
          });
        }

        // ✅ 취소됐으면 결과 반영 안 함
        if (quickEndingBulkGenAbortRef.current) return;

        // ✅ start_sets에 "앞 2개 엔딩" 보장(기존 데이터는 뒤에 유지)
        updateActiveEndingSettings({
          endings: [...built, ...existingEnds.slice(WANT_ENDINGS)],
        });

        // ✅ UX: 생성된 2개 엔딩은 펼쳐서 바로 확인
        try {
          setEndingAccordionOpenById((prev) => {
            const cur = (prev && typeof prev === 'object') ? prev : {};
            const next = { ...cur };
            for (const e of built) {
              const id = String(e?.id || '').trim();
              if (id) next[id] = true;
            }
            return next;
          });
        } catch (_) {}

        try { dispatchToast('success', '엔딩 2개 자동 생성 완료'); } catch (_) {}
      } catch (e) {
        try { console.error('[CreateCharacterPage] ending bulk auto-generate failed:', e); } catch (_) {}
        try { dispatchToast('error', '엔딩 자동 생성에 실패했습니다. 잠시 후 다시 시도해주세요.'); } catch (_) {}
      } finally {
        try { setQuickEndingBulkGenLoading(false); } catch (_) {}
      }
    };

    // ✅ 엔딩 2개 자동생성 취소 핸들러
    const handleCancelEndingBulkGeneration = () => {
      try {
        quickEndingBulkGenAbortRef.current = true;
        setQuickEndingBulkGenLoading(false);
        
        // ✅ 취소 시 원문 복구 (원문이 있든 없든)
        const prevEndings = Array.isArray(endingsAutoGenPrevRef.current) ? endingsAutoGenPrevRef.current : [];
        updateActiveEndingSettings({ endings: prevEndings });
        
        // ✅ 취소 시 프리뷰 채팅방 리셋
        try { resetChatPreview(); } catch (_) {}
        
        dispatchToast('info', '엔딩 자동 생성이 취소되었습니다.');
      } catch (e) {
        try { console.error('[CreateCharacterPage] cancel ending bulk generation failed:', e); } catch (_) {}
      }
    };

    return (
      <div className="space-y-6 p-6">
        {/* ✅ 오프닝 탭 선택(요구사항): 엔딩도 오프닝별로 관리 */}
        <div className="flex flex-wrap items-center gap-2">
          {items.map((set, idx) => {
            const id = String(set?.id || '').trim() || `set_${idx + 1}`;
            const active = id === activeId;
            const title = String(set?.title || '').trim() || `오프닝 ${idx + 1}`;
            return (
              <button
                key={`ending-opening-${id}`}
                type="button"
                onClick={() => {
                  updateStartSets((prev) => {
                    const cur = (prev && typeof prev === 'object') ? prev : {};
                    return { ...cur, selectedId: id };
                  });
                }}
                className={[
                  'inline-flex items-center gap-2 h-9 px-3 rounded-full border transition',
                  active
                    ? 'bg-black/20 border-purple-500 text-white'
                    : 'bg-black/20 border-white/10 text-white/80 hover:bg-white/5 hover:text-white',
                ].join(' ')}
                title={title}
                aria-current={active ? 'true' : undefined}
              >
                <span className="text-sm font-semibold max-w-[140px] truncate">{title}</span>
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => {
              try { setNormalWizardStep('first_start'); } catch (_) {}
            }}
            className="inline-flex items-center gap-2 h-9 px-3 rounded-full border transition bg-black/20 border-white/10 text-white/80 hover:bg-white/5 hover:text-white"
            title="오프닝 관리로 이동"
          >
            <span className="text-sm font-semibold">오프닝 관리</span>
          </button>
        </div>

        <div>
          <div className="text-lg font-semibold text-white">엔딩 설정 <span className="text-red-400 text-sm font-normal ml-1">* 최소 1개 필수</span></div>
          <div className="mt-1 text-sm text-gray-400">
            각 시작설정에 따른 엔딩을 설정해보세요. 가장 먼저 조건에 도달한 엔딩 <span className="text-gray-200 font-semibold">하나만</span> 제공됩니다.
          </div>
          <div className="mt-1 text-xs text-gray-500">(시작설정 별 최대 10개)</div>
        </div>

        {/* ✅ 오프닝 맥락(고정): 현재 오프닝 + 엔딩 제공 시점 */}
        <div className="rounded-xl border border-gray-800 bg-gray-900/30 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex items-center rounded-full border border-gray-700 bg-gray-900/40 px-3 py-1 text-sm font-semibold text-gray-200">
              {displaySetLabel}
            </div>
            <div className="text-sm text-gray-300">
              <span className="text-gray-400">오프닝:</span>{' '}
              <span className="font-semibold text-gray-200">{activeTitle}</span>
            </div>
          </div>

          <div className="mt-4 space-y-2">
            <div className="flex items-center justify-between gap-3">
              <Label className="text-white">
                엔딩 제공 시점 <span className="text-red-400">*</span>
              </Label>
              <div className="text-xs text-gray-500">(최소 10턴)</div>
            </div>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min={10}
                step={1}
                value={String(endingMinTurns)}
                onChange={(e) => {
                  const raw = Number(e?.target?.value ?? 0);
                  const next = Number.isFinite(raw) ? Math.floor(raw) : 0;
                  updateActiveEndingSettings({ min_turns: next });
                }}
                onBlur={(e) => {
                  try {
                    const raw = Number(e?.target?.value ?? 0);
                    const next = Number.isFinite(raw) ? Math.max(10, Math.floor(raw)) : 30;
                    updateActiveEndingSettings({ min_turns: next });
                  } catch (_) {}
                }}
                className="w-[160px] bg-gray-950/40 text-white border-white/10"
              />
              <span className="text-sm text-gray-300 font-semibold">턴 이상</span>
            </div>
          </div>
        </div>

        {/* ✅ 엔딩탭: 엔딩 2개 자동 생성(결과 영역 근처) */}
        <div className="flex items-center justify-end">
          <button
            type="button"
            disabled={!canAutoGenerateTwoEndings || quickEndingBulkGenLoading}
            title={hasAnyEndingTrace ? '이미 입력된 엔딩이 있어도, 경고 후 덮어쓸 수 있어요' : '엔딩 2개를 자동으로 생성합니다'}
            className="h-9 px-3 rounded-lg bg-white/10 text-white text-sm font-semibold hover:bg-white/15 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
            aria-label="엔딩 2개 자동 생성"
            onClick={() => handleAutoGenerateTwoEndingsInEndingTab()}
          >
            {quickEndingBulkGenLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              '자동 생성'
            )}
          </button>
        </div>

        <div className="relative space-y-4" aria-busy={quickEndingBulkGenLoading ? 'true' : 'false'}>
          {/* ✅ 요구사항: 엔딩 2개 자동생성 중 입력박스 스피너(오버레이) */}
          {quickEndingBulkGenLoading ? (
            <div className="absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-black/25 cursor-wait">
              <div className="relative flex items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-gray-200" aria-hidden="true" />
                <button
                  type="button"
                  onClick={handleCancelEndingBulkGeneration}
                  className="absolute -top-1 -right-4 p-1 rounded-full bg-red-500/20 hover:bg-red-500/30 text-red-300 hover:text-red-200 transition-colors pointer-events-auto z-10"
                  aria-label="엔딩 자동 생성 취소"
                  title="엔딩 자동 생성 취소"
                >
                  <X className="h-3 w-3" aria-hidden="true" />
                </button>
              </div>
            </div>
          ) : null}
          <div className={quickEndingBulkGenLoading ? 'pointer-events-none opacity-70' : ''}>
            {endings.map((ending, idx) => {
            const eid = String(ending?.id || '').trim() || `ending_${idx + 1}`;
            const title = String(ending?.title || '');
            const baseCond = String(ending?.base_condition || '');
            const epilogue = String(ending?.epilogue || '');
            const hint = String(ending?.hint || '');
            const endingTurn = (() => {
              try {
                const raw = ending?.turn ?? ending?.turns ?? '';
                if (raw === '' || raw == null) return '';
                const n = Number(raw);
                return Number.isFinite(n) ? Math.floor(n) : '';
              } catch (_) {
                return '';
              }
            })();
            const endingTurnBelowMin = (() => {
              try {
                if (endingTurn === '' || endingTurn == null) return false;
                const n = Number(endingTurn);
                if (!Number.isFinite(n)) return false;
                return n < Number(endingMinTurns || 10);
              } catch (_) {
                return false;
              }
            })();
            const endingTurnAboveMax = (() => {
              try {
                if (simMaxTurns == null) return false;
                if (endingTurn === '' || endingTurn == null) return false;
                const n = Number(endingTurn);
                if (!Number.isFinite(n)) return false;
                return n > Number(simMaxTurns);
              } catch (_) {
                return false;
              }
            })();
            const extra = Array.isArray(ending?.extra_conditions) ? ending.extra_conditions : [];
            const isOpen = !!(endingAccordionOpenById && endingAccordionOpenById[eid] !== false);
            const headerTitle = String(title || '').trim() || `엔딩 ${idx + 1}`;
            return (
              <div key={eid} className="rounded-lg border border-gray-700 bg-gray-900/30">
                {/* ✅ 아코디언 헤더 */}
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => {
                    try {
                      setEndingAccordionOpenById((prev) => {
                        const cur = (prev && typeof prev === 'object') ? prev : {};
                        const nextOpen = !(cur[eid] !== false);
                        return { ...cur, [eid]: nextOpen };
                      });
                    } catch (_) {}
                  }}
                  onKeyDown={(e) => {
                    // ✅ 접근성/UX: Enter/Space로 토글
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      try {
                        setEndingAccordionOpenById((prev) => {
                          const cur = (prev && typeof prev === 'object') ? prev : {};
                          const nextOpen = !(cur[eid] !== false);
                          return { ...cur, [eid]: nextOpen };
                        });
                      } catch (_) {}
                    }
                  }}
                  className="w-full flex items-center justify-between gap-3 px-4 py-3 border-b border-gray-800 text-left hover:bg-white/5 transition-colors"
                  aria-expanded={isOpen}
                >
                  <div className="min-w-0">
                    <div className="text-xs text-gray-400 font-semibold">엔딩 {idx + 1}</div>
                    <div className="text-sm font-semibold text-white truncate">{headerTitle}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        removeEnding(eid);
                      }}
                      className="inline-flex items-center justify-center h-8 w-8 rounded-md text-gray-300 hover:text-white hover:bg-gray-800 transition-colors"
                      aria-label="엔딩 삭제"
                      title="엔딩 삭제"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                    <span className="inline-flex items-center justify-center h-8 w-8 rounded-md text-gray-300">
                      {isOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </span>
                  </div>
                </div>

                {isOpen && (
                <div className="p-4 space-y-5">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-3">
                      <Label className="text-white">
                        엔딩 이름 <span className="text-red-400">*</span>
                      </Label>
                      <div className="text-xs text-gray-500">{Math.min(20, title.length)} / 20</div>
                    </div>
                    <Input
                      value={title}
                      maxLength={20}
                      onChange={(e) => updateEndingAt(eid, { title: e.target.value })}
                      placeholder="예) 마누의 해피엔딩"
                      className="bg-gray-950/40 text-white border-white/10"
                    />
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-3">
                      <Label className="text-white">
                        엔딩 턴수 <span className="text-red-400">*</span>
                      </Label>
                      <div className="text-xs text-gray-500">최소 {endingMinTurns}턴</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        min={endingMinTurns}
                        max={simMaxTurns == null ? undefined : simMaxTurns}
                        step={1}
                        value={endingTurn === '' ? '' : String(endingTurn)}
                        onChange={(e) => {
                          const v = String(e?.target?.value ?? '');
                          if (v === '') {
                            updateEndingAt(eid, { turn: '' });
                            return;
                          }
                          const n = Number(v);
                          if (!Number.isFinite(n)) return;
                          updateEndingAt(eid, { turn: Math.floor(n) });
                        }}
                        onBlur={(e) => {
                          try {
                            const v = String(e?.target?.value ?? '').trim();
                            if (!v) {
                              updateEndingAt(eid, { turn: endingMinTurns });
                              return;
                            }
                            const n = Number(v);
                            const floor = Number.isFinite(n) ? Math.floor(n) : Number(endingMinTurns || 10);
                            let next = Math.max(Number(endingMinTurns || 10), floor);
                            if (simMaxTurns != null) next = Math.min(Number(simMaxTurns), next);
                            updateEndingAt(eid, { turn: next });
                          } catch (_) {}
                        }}
                        className="w-[160px] bg-gray-950/40 text-white border-white/10"
                      />
                      <span className="text-sm text-gray-300 font-semibold">턴</span>
                    </div>
                    {endingTurnBelowMin ? (
                      <div className="text-xs text-red-400 font-semibold">
                        엔딩 턴수는 최소 {endingMinTurns}턴 이상이어야 합니다.
                      </div>
                    ) : null}
                    {endingTurnAboveMax ? (
                      <div className="text-xs text-red-400 font-semibold">
                        엔딩 턴수는 전체 진행 턴수({simMaxTurns}턴)를 초과할 수 없습니다.
                      </div>
                    ) : null}
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-3">
                      <Label className="text-white">
                        엔딩 기본 조건 <span className="text-red-400">*</span>
                      </Label>
                      <div className="text-xs text-gray-500">{Math.min(500, baseCond.length)} / 500</div>
                    </div>
                    <Textarea
                      value={baseCond}
                      maxLength={500}
                      onChange={(e) => updateEndingAt(eid, { base_condition: e.target.value })}
                      placeholder="엔딩을 판단하기 위한 상황/조건을 묘사해 주세요"
                      className="bg-gray-950/40 text-white border-white/10 resize-none"
                      rows={6}
                    />
                    {/* ✅ 엔딩(기본 조건): 이미지 코드([[img:...]]/{{img:...}}) 미리보기 */}
                    {(/\[\[\s*img\s*:/i.test(baseCond) || /\{\{\s*img\s*:/i.test(baseCond)) ? (
                      <div className="mt-2 rounded-lg border border-white/10 bg-black/20 px-3 py-2">
                        <div className="text-[11px] text-gray-400 font-semibold">미리보기</div>
                        <div className="mt-2 text-sm text-gray-100">
                          {renderChatPreviewTextWithInlineImages(baseCond, `end-cond-${eid}`)}
                        </div>
                      </div>
                    ) : null}
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <Label className="text-white">
                          엔딩 내용 <span className="text-red-400">*</span>
                        </Label>
                        <div className="text-xs text-gray-500">{Math.min(1000, epilogue.length)} / 1000</div>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        disabled={(() => {
                          // ✅ 동작 조건: 프로필/프롬프트/엔딩 제목+기본조건 필요 + 로딩 중 잠금
                          try {
                            if (String(quickEndingEpilogueGenLoadingId || '') === String(eid || '')) return true;
                            const nm = String(formData?.basic_info?.name || '').trim();
                            const ds = String(formData?.basic_info?.description || '').trim();
                            const wd = String(formData?.basic_info?.world_setting || '').trim();
                            if (!nm || !ds || !wd) return true;
                            if (!String(title || '').trim()) return true;
                            if (!String(baseCond || '').trim()) return true;
                            return false;
                          } catch (_) {
                            return true;
                          }
                        })()}
                        title="엔딩 내용을 자동으로 초안 생성합니다"
                        className={[
                          "h-8 px-3",
                          (String(quickEndingEpilogueGenLoadingId || '') === String(eid || ''))
                            ? "bg-gray-800 text-gray-300 cursor-wait"
                            : "bg-gray-800 text-gray-200 hover:bg-gray-700",
                        ].join(' ')}
                        onClick={async () => {
                          // ✅ 엔딩 에필로그 자동 생성(SSOT: start_sets.items[].ending_settings.endings[].epilogue)
                          if (String(quickEndingEpilogueGenLoadingId || '') === String(eid || '')) return;
                          try {
                            const nm = String(formData?.basic_info?.name || '').trim();
                            const ds = String(formData?.basic_info?.description || '').trim();
                            const wd = String(formData?.basic_info?.world_setting || '').trim();
                            if (!wd) { dispatchToast('error', '프롬프트를 먼저 작성해주세요.'); return; }
                            if (!nm || !ds) { dispatchToast('error', '프로필 정보를 먼저 입력해주세요.'); return; }
                            if (!String(title || '').trim()) { dispatchToast('error', '엔딩 이름을 먼저 입력해주세요.'); return; }
                            if (!String(baseCond || '').trim()) { dispatchToast('error', '엔딩 기본 조건을 먼저 입력해주세요.'); return; }

                            setQuickEndingEpilogueGenLoadingId(String(eid || ''));
        // ✅ 요구사항: "위저드만" 제미니 고정(다른 화면/로직에는 영향 주지 않음)
        const aiModel = useNormalCreateWizard
          ? 'gemini'
          : (String(user?.preferred_model || 'claude').trim().toLowerCase() || 'claude');
                            // ✅ RP/시뮬 분기(요구사항)
                            const modeRaw = String(formData?.basic_info?.character_type || '').trim().toLowerCase();
                            const mode = (modeRaw === 'simulator' || modeRaw === 'simulation') ? 'simulator' : 'roleplay';
                            const res = await charactersAPI.quickGenerateEndingEpilogueDraft({
                              name: nm,
                              description: ds,
                              world_setting: wd,
                              opening_intro: String(rawActive?.intro || '').trim(),
                              opening_first_line: String(rawActive?.firstLine || '').trim(),
                              ending_title: String(title || '').trim(),
                              base_condition: String(baseCond || '').trim(),
                              hint: String(hint || '').trim(),
                              extra_conditions: Array.isArray(extra) ? extra : [],
                              mode,
                              tags: Array.isArray(selectedTagSlugs) ? selectedTagSlugs : [],
                              ai_model: (aiModel === 'gpt' ? 'gpt' : (aiModel === 'gemini' ? 'gemini' : 'claude')),
                            });
                            const nextRaw = String(res?.data?.epilogue || '').trim();
                            const next = nextRaw.length > 1000 ? nextRaw.slice(0, 1000) : nextRaw;
                            if (!next) { dispatchToast('error', '엔딩 내용 생성 결과가 비어있습니다. 잠시 후 다시 시도해주세요.'); return; }
                            updateEndingAt(eid, { epilogue: next });
                            if (next !== nextRaw) {
                              try { dispatchToast('warning', '엔딩 내용이 길어 일부가 잘렸습니다. 내용을 확인해주세요.'); } catch (_) {}
                            }
                            dispatchToast('success', '엔딩 내용이 자동 생성되었습니다. 내용을 확인해주세요.');
                          } catch (e) {
                            dispatchToast('error', '엔딩 내용 자동 생성에 실패했습니다. 잠시 후 다시 시도해주세요.');
                          } finally {
                            setQuickEndingEpilogueGenLoadingId('');
                          }
                        }}
                      >
                        {String(quickEndingEpilogueGenLoadingId || '') === String(eid || '') ? (
                          <span className="inline-flex items-center gap-2">
                            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                            생성 중...
                          </span>
                        ) : (
                          '자동생성'
                        )}
                      </Button>
                    </div>
                    <div className="relative">
                      <Textarea
                        value={epilogue}
                        maxLength={1000}
                        onChange={(e) => updateEndingAt(eid, { epilogue: e.target.value })}
                        placeholder="엔딩 연출(서술/대사)을 작성해 주세요 (AI가 더 자연스럽게 다듬어줄 예정)"
                        className="bg-gray-950/40 text-white border-white/10 resize-none"
                        rows={8}
                        disabled={String(quickEndingEpilogueGenLoadingId || '') === String(eid || '')}
                        readOnly={String(quickEndingEpilogueGenLoadingId || '') === String(eid || '')}
                        aria-busy={String(quickEndingEpilogueGenLoadingId || '') === String(eid || '')}
                      />
                      {String(quickEndingEpilogueGenLoadingId || '') === String(eid || '') ? (
                        <div className="absolute inset-0 flex items-center justify-center rounded-md bg-black/20 cursor-wait">
                          <Loader2 className="h-7 w-7 animate-spin text-gray-200" aria-hidden="true" />
                        </div>
                      ) : null}
                    </div>
                    {/* ✅ 엔딩(내용/에필로그): 이미지 코드([[img:...]]/{{img:...}}) 미리보기 */}
                    {(/\[\[\s*img\s*:/i.test(epilogue) || /\{\{\s*img\s*:/i.test(epilogue)) ? (
                      <div className="mt-2 rounded-lg border border-white/10 bg-black/20 px-3 py-2">
                        <div className="text-[11px] text-gray-400 font-semibold">미리보기</div>
                        <div className="mt-2 text-sm text-gray-100">
                          {renderChatPreviewTextWithInlineImages(epilogue, `end-epi-${eid}`)}
                        </div>
                      </div>
                    ) : null}
                  </div>

                  <div className="space-y-2">
                    <div className="text-sm font-semibold text-white">엔딩 충족 스탯</div>
                    <div className="text-xs text-gray-500">
                      - 1개의 조건만 충족돼도 엔딩이 제공됩니다(최대 7개)
                      <br />
                      - 턴 수 조건과 관계 없이 해당 조건이 충족되면 엔딩이 노출됩니다
                    </div>
                    <div className="space-y-2">
                      {extra.map((c, cIdx) => {
                        const cid = String(c?.id || '').trim() || `cond_${cIdx + 1}`;
                        const cType = String(c?.type || '').trim() || (typeof c?.text === 'string' ? 'text' : 'stat');
                        const text = String(c?.text || '');
                        const statId = String(c?.stat_id || '').trim();
                        const statName = String(statNameById?.[statId] || c?.stat_name || '').trim();
                        const op = String(c?.op || 'gte').trim();
                        const value = String(c?.value ?? '');
                        return (
                          <div key={cid} className="flex items-start gap-2">
                            {cType === 'text' || availableStats.length === 0 ? (
                              <Input
                                value={text}
                                onChange={(e) => {
                                  const nextList = extra.map((x) => {
                                    const xid = String(x?.id || '').trim() || '';
                                    if (xid !== cid) return x;
                                    return { ...(x || {}), type: 'text', text: e.target.value };
                                  });
                                  updateEndingAt(eid, { extra_conditions: nextList });
                                }}
                                placeholder="세부 조건을 입력하세요(예: 호감도가 일정 이상 상승함)"
                                className="flex-1 bg-gray-950/40 text-white border-white/10"
                              />
                            ) : (
                              <div className="flex-1 grid grid-cols-12 gap-2">
                                <div className="col-span-5">
                                  <select
                                    value={statId}
                                    onChange={(e) => {
                                      const nextStatId = String(e.target.value || '').trim();
                                      const nextStatName = String(statNameById?.[nextStatId] || '').trim();
                                      const nextList = extra.map((x) => {
                                        const xid = String(x?.id || '').trim() || '';
                                        if (xid !== cid) return x;
                                        return { ...(x || {}), type: 'stat', stat_id: nextStatId, stat_name: nextStatName };
                                      });
                                      updateEndingAt(eid, { extra_conditions: nextList });
                                    }}
                                    className="w-full h-10 rounded-md bg-gray-950/40 text-white border border-white/10 px-2 text-sm"
                                    aria-label="스탯 선택"
                                  >
                                    {availableStats.map((s) => (
                                      <option key={s.id} value={s.id}>{s.name}</option>
                                    ))}
                                  </select>
                                </div>
                                <div className="col-span-3">
                                  <Input
                                    value={value}
                                    inputMode="text"
                                    pattern="-?[0-9]*"
                                    onChange={(e) => {
                                      const raw = String(e.target.value || '');
                                      // ✅ 정수/중간상태('-')만 허용 (기존 스탯 입력 UX와 동일)
                                      if (!(raw === '' || raw === '-' || /^-?\d+$/.test(raw))) return;
                                      const nextList = extra.map((x) => {
                                        const xid = String(x?.id || '').trim() || '';
                                        if (xid !== cid) return x;
                                        return { ...(x || {}), type: 'stat', value: raw };
                                      });
                                      updateEndingAt(eid, { extra_conditions: nextList });
                                    }}
                                    onBlur={(e) => {
                                      const raw = String(e.target.value || '');
                                      if (raw !== '-') return;
                                      const nextList = extra.map((x) => {
                                        const xid = String(x?.id || '').trim() || '';
                                        if (xid !== cid) return x;
                                        return { ...(x || {}), type: 'stat', value: '' };
                                      });
                                      updateEndingAt(eid, { extra_conditions: nextList });
                                    }}
                                    placeholder="값"
                                    className="h-10 bg-gray-950/40 text-white border-white/10"
                                    aria-label="비교 값"
                                  />
                                </div>
                                <div className="col-span-4">
                                  <select
                                    value={STAT_OP_OPTIONS.some((o) => o.value === op) ? op : 'gte'}
                                    onChange={(e) => {
                                      const nextOp = String(e.target.value || 'gte').trim();
                                      const nextList = extra.map((x) => {
                                        const xid = String(x?.id || '').trim() || '';
                                        if (xid !== cid) return x;
                                        return { ...(x || {}), type: 'stat', op: nextOp };
                                      });
                                      updateEndingAt(eid, { extra_conditions: nextList });
                                    }}
                                    className="w-full h-10 rounded-md bg-gray-950/40 text-white border border-white/10 px-2 text-sm"
                                    aria-label="비교 연산"
                                  >
                                    {STAT_OP_OPTIONS.map((o) => (
                                      <option key={o.value} value={o.value}>{o.label}</option>
                                    ))}
                                  </select>
                                </div>
                                {/* 화면 상에서 이름이 비어보이는 케이스 방어 */}
                                {!statName && (
                                  <div className="col-span-12 text-[11px] text-amber-300/80">
                                    선택된 스탯을 찾지 못했습니다. 스탯 설정에서 이름/목록을 확인해주세요.
                                  </div>
                                )}
                              </div>
                            )}
                            <button
                              type="button"
                              onClick={() => removeExtraCondition(eid, cid)}
                              className="h-10 px-3 rounded-md bg-gray-800 text-gray-200 hover:bg-gray-700 transition-colors text-sm font-semibold"
                            >
                              삭제
                            </button>
                          </div>
                        );
                      })}
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => addExtraCondition(eid)}
                        disabled={extra.length >= 7}
                        className={[
                          'h-10 px-4 rounded-md text-sm font-semibold transition-colors',
                          extra.length >= 7
                            ? 'bg-gray-800 text-gray-500 cursor-not-allowed'
                            : 'bg-gray-800 text-gray-200 hover:bg-gray-700',
                        ].join(' ')}
                      >
                        + 추가
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          try { setNormalWizardStep('stat'); } catch (_) {}
                        }}
                        className="h-10 px-4 rounded-md text-sm font-semibold bg-purple-600 text-white hover:bg-purple-700 transition-colors"
                        title="스탯 설정으로 이동"
                      >
                        스탯 추가하기 &gt;
                      </button>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-3">
                      <Label className="text-white">엔딩 힌트</Label>
                      <div className="text-xs text-gray-500">{Math.min(20, hint.length)} / 20</div>
                    </div>
                    <Input
                      value={hint}
                      maxLength={20}
                      onChange={(e) => updateEndingAt(eid, { hint: e.target.value })}
                      placeholder="유저에게 보일 힌트(최대 20자)"
                      className="bg-gray-950/40 text-white border-white/10"
                    />
                  </div>
                </div>
                )}
              </div>
            );
            })}

          <button
            type="button"
            onClick={addEnding}
            disabled={endings.length >= 10}
            className={[
              'w-full h-12 rounded-md border transition-colors font-semibold',
              endings.length >= 10
                ? 'border-gray-800 bg-gray-900/40 text-gray-500 cursor-not-allowed'
                : 'border-gray-700 bg-gray-900/20 text-gray-200 hover:bg-gray-900/40',
            ].join(' ')}
          >
            + 엔딩 추가
          </button>
          </div>
        </div>
      </div>
    );
  };

  const renderSettingBookWizardTab = () => {
    /**
     * ✅ 설정집(경쟁사 "키워드북" 유사)
     *
     * 요구사항:
     * - 설정집 단계(탭) 안에서 "설정집 1/2/3..."을 추가/이름변경/삭제할 수 있다.
     * - 설정집별로 트리거를 최대 5개 입력할 수 있다.
     * - 각 설정집 안에는 기존의 "키워드 노트" UI(정보/키워드/적용대상)를 유지한다.
     *
     * 저장 위치(SSOT):
     * - basic_info.start_sets.setting_book
     *   - selectedId: string
     *   - items: [{ id, title, triggers: string[], notes: Note[] }]
     *     - Note: { id, info, keywords: string[], targets: ('all'|start_set_id)[] }
     *
     * 방어:
     * - 서버/DB 스키마 변경 없이 start_sets(JSON)에만 저장한다.
     * - 빈 값/구형 데이터도 화면이 깨지지 않도록 fallback + 마이그레이션(useEffect)로 보정한다.
     */
    const ss = (formData?.basic_info?.start_sets && typeof formData.basic_info.start_sets === 'object')
      ? formData.basic_info.start_sets
      : { selectedId: '', items: [], setting_book: { selectedId: 'memo_1', items: [] } };
    const startSetItems = Array.isArray(ss?.items) ? ss.items : [];
    const setOptions = [
      { id: 'all', label: '전체' },
      ...startSetItems.map((x, idx) => ({
        id: String(x?.id || `set_${idx + 1}`).trim(),
        // ✅ SSOT: 오프닝 이름(title)을 그대로 사용(크리에이터가 이름을 바꾸면 즉시 반영)
        label: String(x?.title || '').trim() || `오프닝 ${idx + 1}`,
      })),
    ].filter((x) => x.id);

    const sb = (ss?.setting_book && typeof ss.setting_book === 'object')
      ? ss.setting_book
      : { selectedId: 'memo_1', items: [] };
    const memos0 = Array.isArray(sb?.items) ? sb.items : [];
    const safeMemos = memos0.length ? memos0 : [{ id: 'memo_1', detail: '', triggers: [''], targets: ['all'] }];

    const genMemoId = () => {
      try { return `memo_${Date.now()}_${Math.random().toString(16).slice(2, 7)}`; }
      catch (_) { return `memo_${Date.now()}`; }
    };

    const updateSettingBook = (updater) => {
      updateStartSets((prev) => {
        const cur = (prev && typeof prev === 'object') ? prev : {};
        const base = (cur.setting_book && typeof cur.setting_book === 'object')
          ? cur.setting_book
          : { selectedId: 'memo_1', items: [] };
        const next = (typeof updater === 'function') ? updater(base) : updater;
        const safeNext = (next && typeof next === 'object') ? next : base;
        return { ...cur, setting_book: safeNext };
      });
    };

    const updateMemoAt = (memoIdLike, patch) => {
      const mid = String(memoIdLike || '').trim();
      if (!mid) return;
      updateSettingBook((prevBook) => {
        const pb = (prevBook && typeof prevBook === 'object') ? prevBook : { selectedId: 'memo_1', items: [] };
        const arr0 = Array.isArray(pb?.items) ? pb.items : [];
        const arr = arr0.length ? arr0 : [{ id: 'memo_1', detail: '', triggers: [''], targets: ['all'] }];
        const nextItems = arr.map((m, idx) => {
          const id = String(m?.id || '').trim() || `memo_${idx + 1}`;
          if (id !== mid) return m;
          return { ...(m || {}), ...(patch || {}) };
        });
        return { ...pb, items: nextItems };
      });
    };

    const addMemo = () => {
      if (safeMemos.length >= 20) return;
      const id = genMemoId();
      updateSettingBook((prevBook) => {
        const pb = (prevBook && typeof prevBook === 'object') ? prevBook : { selectedId: 'memo_1', items: [] };
        const arr0 = Array.isArray(pb?.items) ? pb.items : [];
        const arr = arr0.length ? arr0 : [{ id: 'memo_1', detail: '', triggers: [''], targets: ['all'] }];
        return { ...pb, selectedId: id, items: [...arr, { id, detail: '', triggers: [''], targets: ['all'] }] };
      });
      try { setSettingBookAccordionOpenById((prev) => ({ ...(prev || {}), [id]: true })); } catch (_) {}
    };

    const removeMemo = (memoIdLike) => {
      const mid = String(memoIdLike || '').trim();
      if (!mid) return;
      updateSettingBook((prevBook) => {
        const pb = (prevBook && typeof prevBook === 'object') ? prevBook : { selectedId: 'memo_1', items: [] };
        const arr0 = Array.isArray(pb?.items) ? pb.items : [];
        const arr = arr0.length ? arr0 : [{ id: 'memo_1', detail: '', triggers: [''], targets: ['all'] }];
        const next0 = arr.filter((m) => String(m?.id || '').trim() !== mid);
        const next = next0.length ? next0 : [{ id: 'memo_1', detail: '', triggers: [''], targets: ['all'] }];
        const nextSelected = (String(pb?.selectedId || '').trim() === mid)
          ? String(next[0]?.id || 'memo_1')
          : String(pb?.selectedId || next[0]?.id || 'memo_1');
        return { ...pb, selectedId: nextSelected, items: next };
      });
      try {
        setSettingBookTargetDraftById((prev) => { const next = { ...(prev || {}) }; delete next[mid]; return next; });
        setSettingBookAccordionOpenById((prev) => { const next = { ...(prev || {}) }; delete next[mid]; return next; });
      } catch (_) {}
    };

    return (
      <div className="relative space-y-6 p-6">
        {/* ✅ 토큰 안내(i): 설정메모에서 {{char}}/{{user}} 지원 */}
        <WizardTokenHelpIcon />
        <div>
          <div className="text-lg font-semibold text-white">설정집</div>
          <div className="mt-1 text-sm text-gray-400">
            설정집은 “설정메모”로만 구성돼요. 각 설정메모는 상세/트리거/적용 대상을 가집니다.
          </div>
        </div>

        <div className="space-y-3">
          {safeMemos.map((memo, idx) => {
            const mid = String(memo?.id || '').trim() || `memo_${idx + 1}`;
            const detail = String(memo?.detail ?? memo?.info ?? '');
            const triggers = (() => {
              const arr = Array.isArray(memo?.triggers) ? memo.triggers : (Array.isArray(memo?.keywords) ? memo.keywords : []);
              const clipped = arr.map((x) => String(x ?? '').trim()).slice(0, 5);
              const list = clipped.length ? clipped : [''];
              // ✅ 빈 값만 있는 경우에도 입력란 1개는 유지(추가 버튼/UX 안정)
              const hasAny = list.some((t) => String(t || '').trim());
              return hasAny ? list : [''];
            })();
            const targets = Array.isArray(memo?.targets) ? memo.targets.map((t) => String(t || '').trim()).filter(Boolean) : ['all'];
            const isOpenMemo = !!(settingBookAccordionOpenById && settingBookAccordionOpenById[mid] !== false);
            const memoNo = idx + 1;

            const updateMemoTriggers = (nextList) => {
              const cleaned = Array.isArray(nextList)
                ? nextList.map((x) => String(x ?? '').trim()).slice(0, 5)
                : [''];
              const normalized = cleaned.length ? cleaned : [''];
              updateMemoAt(mid, { triggers: normalized, keywords: normalized });
            };
            const addMemoTrigger = () => {
              const nonEmptyCount = triggers.filter((t) => String(t || '').trim()).length;
              if (nonEmptyCount >= 5) return;
              // ✅ UX: 이미 빈 입력칸이 있으면 중복 추가하지 않는다.
              if (triggers.some((t) => !String(t || '').trim())) return;
              updateMemoTriggers([...triggers, '']);
            };
            const removeMemoTriggerAt = (tidx) => {
              const i = Number(tidx);
              if (!Number.isFinite(i) || i < 0) return;
              const next = triggers.filter((_, k) => k !== i);
              updateMemoTriggers(next.length ? next : ['']);
            };

            const draftTarget = String(settingBookTargetDraftById?.[mid] || 'all');
            const addTargetFromDraft = () => {
              const t = String(draftTarget || '').trim() || 'all';
              if (t === 'all') {
                updateMemoAt(mid, { targets: ['all'] });
                return;
              }
              const next = Array.from(new Set((targets.length ? targets : ['all']).filter((x) => x !== 'all').concat([t]))).filter(Boolean);
              updateMemoAt(mid, { targets: next.length ? next : ['all'] });
            };
            const removeTarget = (t) => {
              const x = String(t || '').trim();
              if (!x) return;
              const next = (targets.length ? targets : ['all']).filter((v) => String(v) !== x);
              updateMemoAt(mid, { targets: next.length ? next : ['all'] });
            };

            return (
              <div key={mid} className="rounded-lg border border-gray-700 bg-gray-900/30">
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => {
                    try {
                      setSettingBookAccordionOpenById((prev) => {
                        const cur = (prev && typeof prev === 'object') ? prev : {};
                        const nextOpen = !(cur[mid] !== false);
                        return { ...cur, [mid]: nextOpen };
                      });
                    } catch (_) {}
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      try {
                        setSettingBookAccordionOpenById((prev) => {
                          const cur = (prev && typeof prev === 'object') ? prev : {};
                          const nextOpen = !(cur[mid] !== false);
                          return { ...cur, [mid]: nextOpen };
                        });
                      } catch (_) {}
                    }
                  }}
                  className="w-full flex items-center justify-between gap-3 px-4 py-3 border-b border-gray-800 text-left hover:bg-white/5 transition-colors"
                  aria-expanded={isOpenMemo}
                >
                  <div className="min-w-0">
                    {/* ✅ 중복 방지: 헤더에는 "설정메모 N"만 노출하고, 상세 미입력 시엔 동일 문구를 반복하지 않는다. */}
                    <div className="text-sm font-semibold text-white truncate">설정메모 {memoNo}</div>
                    {detail.trim() && (
                      <div className="mt-0.5 text-xs text-gray-400 truncate">
                        {detail.trim().slice(0, 40)}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        // ✅ "수정"은 상세 편집으로 안내: 펼치고 textarea에 포커스
                        try {
                          setSettingBookAccordionOpenById((prev) => ({ ...(prev || {}), [mid]: true }));
                        } catch (_) {}
                        try {
                          // 렌더 이후 포커스
                          requestAnimationFrame(() => {
                            try {
                              const el = (typeof document !== 'undefined')
                                ? document.getElementById(`setting-memo-detail-${mid}`)
                                : null;
                              if (el && typeof el.focus === 'function') el.focus();
                            } catch (_) {}
                          });
                        } catch (_) {}
                      }}
                      className="inline-flex items-center justify-center h-8 w-8 rounded-md text-gray-300 hover:text-white hover:bg-gray-800 transition-colors"
                      aria-label="설정메모 수정"
                      title="수정"
                    >
                      <SquarePen className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        removeMemo(mid);
                      }}
                      className="inline-flex items-center justify-center h-8 w-8 rounded-md text-gray-300 hover:text-white hover:bg-gray-800 transition-colors"
                      aria-label="설정메모 삭제"
                      title="삭제"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {isOpenMemo && (
                  <div className="p-4 space-y-5">
                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-3">
                        <Label className="text-white">상세</Label>
                        <div className="text-xs text-gray-500">{Math.min(400, detail.length)} / 400</div>
                      </div>
                      <Textarea
                        id={`setting-memo-detail-${mid}`}
                        value={detail}
                        maxLength={400}
                        onChange={(e) => updateMemoAt(mid, { detail: e.target.value, info: e.target.value })}
                        placeholder="트리거로 불러오게 되는 추가 설정 정보를 입력해 주세요"
                        className="bg-gray-950/40 text-white border-white/10 resize-none"
                        rows={4}
                      />
                      {/* ✅ 설정메모: 이미지 코드([[img:...]]/{{img:...}}) 미리보기 */}
                      {(/\[\[\s*img\s*:/i.test(detail) || /\{\{\s*img\s*:/i.test(detail)) ? (
                        <div className="mt-2 rounded-lg border border-white/10 bg-black/20 px-3 py-2">
                          <div className="text-[11px] text-gray-400 font-semibold">미리보기</div>
                          <div className="mt-2 text-sm text-gray-100">
                            {renderChatPreviewTextWithInlineImages(detail, `sb-${mid}`)}
                          </div>
                        </div>
                      ) : null}
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-3">
                        <Label className="text-white">트리거</Label>
                        <div className="text-xs text-gray-500">{Math.min(5, triggers.filter((t) => String(t || '').trim()).length)} / 5</div>
                      </div>
                      <div className="space-y-2">
                        {triggers.map((t, tidx) => (
                          <div key={`memo-trg-${mid}-${tidx}`} className="flex items-center gap-2">
                            <Input
                              value={String(t ?? '')}
                              onChange={(e) => {
                                const next = triggers.map((x, k) => (k === tidx ? e.target.value : x));
                                updateMemoTriggers(next);
                              }}
                              placeholder={`트리거 ${tidx + 1}`}
                              maxLength={80}
                              className="flex-1 bg-gray-950/40 text-white border-white/10"
                            />
                            <button
                              type="button"
                              onClick={() => removeMemoTriggerAt(tidx)}
                              disabled={triggers.length <= 1}
                              className={[
                                'h-10 px-3 rounded-md text-sm font-semibold transition-colors',
                                triggers.length <= 1
                                  ? 'bg-gray-800 text-gray-500 cursor-not-allowed'
                                  : 'bg-gray-800 text-gray-200 hover:bg-gray-700',
                              ].join(' ')}
                            >
                              삭제
                            </button>
                          </div>
                        ))}
                        <button
                          type="button"
                          onClick={addMemoTrigger}
                          disabled={triggers.filter((t) => String(t || '').trim()).length >= 5}
                          className={[
                            'h-10 px-4 rounded-md text-sm font-semibold transition-colors',
                            triggers.filter((t) => String(t || '').trim()).length >= 5
                              ? 'bg-gray-800 text-gray-500 cursor-not-allowed'
                              : 'bg-gray-800 text-gray-200 hover:bg-gray-700',
                          ].join(' ')}
                        >
                          + 트리거 추가
                        </button>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label className="text-white">적용 대상</Label>
                      <div className="text-xs text-gray-500">이 설정메모가 어떤 오프닝에 적용될지 선택하세요.</div>
                      <div className="flex flex-wrap gap-2">
                        {(targets.length ? targets : ['all']).map((t) => {
                          const label = (t === 'all')
                            ? '전체'
                            : (setOptions.find((x) => x.id === t)?.label || t);
                          return (
                            <span
                              key={`tgt-${mid}-${t}`}
                              className="inline-flex items-center gap-2 rounded-full bg-white/10 text-gray-100 text-xs px-3 py-1"
                            >
                              <span className="truncate max-w-[200px]">{label}</span>
                              <button
                                type="button"
                                onClick={() => removeTarget(t)}
                                className="text-gray-300 hover:text-white"
                                aria-label="대상 삭제"
                                title="대상 삭제"
                              >
                                ×
                              </button>
                            </span>
                          );
                        })}
                      </div>
                      <div className="grid grid-cols-12 gap-2">
                        <div className="col-span-8">
                          <select
                            value={draftTarget}
                            onChange={(e) => setSettingBookTargetDraftById((prev) => ({ ...(prev || {}), [mid]: e.target.value }))}
                            className="w-full h-10 rounded-md bg-gray-950/40 text-white border border-white/10 px-2 text-sm"
                            aria-label="적용 대상 선택"
                          >
                            {setOptions.map((o) => (
                              <option key={o.id} value={o.id}>{o.label}</option>
                            ))}
                          </select>
                        </div>
                        <div className="col-span-4">
                          <button
                            type="button"
                            onClick={addTargetFromDraft}
                            className="w-full h-10 rounded-md bg-gray-800 text-gray-200 hover:bg-gray-700 transition-colors text-sm font-semibold"
                          >
                            + 추가
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          <button
            type="button"
            onClick={addMemo}
            disabled={safeMemos.length >= 20}
            className={[
              'w-full h-12 rounded-md border transition-colors font-semibold',
              safeMemos.length >= 20
                ? 'border-gray-800 bg-gray-900/40 text-gray-500 cursor-not-allowed'
                : 'border-gray-700 bg-gray-900/20 text-gray-200 hover:bg-gray-900/40',
            ].join(' ')}
          >
            + 설정메모 추가
          </button>
        </div>
      </div>
    );
  };

  const renderStatsWizardTab = () => {
    /**
     * ✅ 스탯 설정(경쟁사 구조 기반)
     *
     * 저장 위치(SSOT):
     * - basic_info.start_sets.items[].stat_settings
     *   - stats: [{ id, name, min_value, max_value, base_value, unit, description }]
     *
     * 의도/원리:
     * - 오프닝(시작 설정)마다 스탯 구성이 달라질 수 있으므로, start_sets "아이템 단위"로 스탯을 보관한다.
     * - 프롬프트에는 "동기화 버튼"으로만 요약 블록을 넣는다(자동 실시간 동기화는 충돌 위험).
     * - 운영 안정성을 위해 기본 UI에서는 스탯 최대 4개를 권장/제한한다(프롬프트 길이 폭증 방지).
     */
    const HARD_MAX_STATS = HARD_MAX_STATS_PER_OPENING;
    const ss = (formData?.basic_info?.start_sets && typeof formData.basic_info.start_sets === 'object')
      ? formData.basic_info.start_sets
      : { selectedId: '', items: [] };
    const items = Array.isArray(ss.items) ? ss.items : [];
    const selectedId = String(ss.selectedId || '').trim() || String(items?.[0]?.id || '').trim();
    const activeIdx = Math.max(0, items.findIndex((x) => String(x?.id || '').trim() === String(selectedId || '').trim()));
    const rawActive = items[activeIdx] || items[0] || {};
    const activeId = String(rawActive?.id || '').trim() || String(selectedId || '').trim() || `set_${activeIdx + 1}`;
    const activeTitle = String(rawActive?.title || '').trim() || `오프닝 ${activeIdx + 1}`;

    const normalizeStatSettings = (maybe) => {
      try {
        const st = (maybe && typeof maybe === 'object') ? maybe : null;
        const stats = Array.isArray(st?.stats) ? st.stats : [];
        return { stats };
      } catch (_) {
        return { stats: [] };
      }
    };

    const statSettings = normalizeStatSettings(rawActive?.stat_settings);
    const stats = Array.isArray(statSettings.stats) ? statSettings.stats : [];
    const isStatsDirty = !!(statsDirtyByStartSetId && statsDirtyByStartSetId[activeId]);
    const promptHasStatsBlock = (() => {
      try {
        const text = String(formData?.basic_info?.world_setting || '');
        const START = '<!-- CC_STATS_START -->';
        const END = '<!-- CC_STATS_END -->';
        const sIdx = text.indexOf(START);
        const eIdx = text.indexOf(END);
        return sIdx >= 0 && eIdx > sIdx;
      } catch (_) {
        return false;
      }
    })();
    const syncDisabled = !isStatsDirty && promptHasStatsBlock;

    const genStatId = () => {
      try { return `stat_${Date.now()}_${Math.random().toString(16).slice(2, 7)}`; }
      catch (_) { return `stat_${Date.now()}`; }
    };

    /**
     * ✅ 숫자 입력(정수) 처리: 음수 허용 + 입력 중간 상태 방어
     *
     * 의도/원리:
     * - min/max/base는 음수 범위도 허용되어야 한다.
     * - 사용자가 타이핑 중에는 `-`(마이너스만) 같은 "중간 상태"가 발생하므로 이를 허용해야 UX가 끊기지 않는다.
     * - 다만 포커스가 빠질 때 `-`만 남아있으면 저장값 오염을 막기 위해 빈 값('')으로 정리한다.
     */
    const handleIntDraftChange = (sid, key, rawValue) => {
      try {
        const raw = String(rawValue ?? '');
        const s = raw.trim();
        if (!s) {
          updateStatAt(sid, { [key]: '' });
          return;
        }
        if (s === '-') {
          // 입력 중간 상태 허용
          updateStatAt(sid, { [key]: '-' });
          return;
        }
        if (!/^-?\d+$/.test(s)) {
          // 비정상 입력은 무시(기존 값 유지)
          return;
        }
        const n = Number(s);
        if (!Number.isFinite(n)) return;
        updateStatAt(sid, { [key]: n });
      } catch (_) {}
    };

    const finalizeIntDraft = (sid, key, currentValue) => {
      try {
        const s = String(currentValue ?? '').trim();
        if (s === '-') updateStatAt(sid, { [key]: '' });
      } catch (_) {}
    };

    const updateActiveStatSettings = (patch) => {
      updateStartSets((prev) => {
        const cur = (prev && typeof prev === 'object') ? prev : {};
        const curItems = Array.isArray(cur.items) ? cur.items : [];
        const nextItems = curItems.map((x, idx) => {
          const xid = String(x?.id || '').trim() || `set_${idx + 1}`;
          if (xid !== activeId) return x;
          const base = (x && typeof x === 'object') ? x : {};
          const st = normalizeStatSettings(base.stat_settings);
          return { ...base, stat_settings: { ...st, ...(patch || {}) } };
        });
        return { ...cur, items: nextItems };
      });
      // ✅ 스탯 변경 시, 현재 오프닝은 프롬프트 동기화가 필요하다.
      try { setStatsDirtyByStartSetId((prev) => ({ ...(prev || {}), [activeId]: true })); } catch (_) {}
    };

    const updateStatAt = (statIdLike, patch) => {
      const sid = String(statIdLike || '').trim();
      if (!sid) return;
      updateActiveStatSettings({
        stats: stats.map((s) => {
          const id = String(s?.id || '').trim();
          if (id !== sid) return s;
          return { ...(s || {}), ...(patch || {}) };
        }),
      });
    };

    const addStat = () => {
      if (stats.length >= HARD_MAX_STATS) return;
      const id = genStatId();
      updateActiveStatSettings({
        stats: [
          ...stats,
          { id, name: '', min_value: '', max_value: '', base_value: '', unit: '', description: '' },
        ],
      });
    };

    const removeStat = (statIdLike) => {
      const sid = String(statIdLike || '').trim();
      if (!sid) return;
      updateActiveStatSettings({ stats: stats.filter((s) => String(s?.id || '').trim() !== sid) });
    };

    const mode = String(formData?.basic_info?.character_type || 'roleplay').trim();
    const autoGenDisabled = (mode !== 'simulator' && mode !== 'roleplay');

    return (
      <div className="space-y-6 p-6">
        {/* ✅ 오프닝 탭 선택(요구사항): 스탯도 오프닝별로 관리 */}
        <div className="flex flex-wrap items-center gap-2">
          {items.map((set, idx) => {
            const id = String(set?.id || '').trim() || `set_${idx + 1}`;
            const active = id === activeId;
            const title = String(set?.title || '').trim() || `오프닝 ${idx + 1}`;
            return (
              <button
                key={`stat-opening-${id}`}
                type="button"
                onClick={() => {
                  updateStartSets((prev) => {
                    const cur = (prev && typeof prev === 'object') ? prev : {};
                    return { ...cur, selectedId: id };
                  });
                }}
                className={[
                  'inline-flex items-center gap-2 h-9 px-3 rounded-full border transition',
                  active
                    ? 'bg-black/20 border-purple-500 text-white'
                    : 'bg-black/20 border-white/10 text-white/80 hover:bg-white/5 hover:text-white',
                ].join(' ')}
                title={title}
                aria-current={active ? 'true' : undefined}
              >
                <span className="text-sm font-semibold max-w-[140px] truncate">{title}</span>
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => {
              try { setNormalWizardStep('first_start'); } catch (_) {}
            }}
            className="inline-flex items-center gap-2 h-9 px-3 rounded-full border transition bg-black/20 border-white/10 text-white/80 hover:bg-white/5 hover:text-white"
            title="오프닝 관리로 이동"
          >
            <span className="text-sm font-semibold">오프닝 관리</span>
          </button>
        </div>

        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="text-sm text-gray-300">
              <span className="text-white font-semibold">{activeTitle}</span>에 연동된 스탯을 설정할 수 있어요.
            </div>
            <div className="text-xs text-gray-500">
              프롬프트 자동 생성 시 스탯이 함께 채워지고, 이후에는 <span className="text-white font-semibold">“프롬프트 동기화”</span>로만 프롬프트에 반영됩니다.
            </div>
            {autoGenDisabled && (
              <div className="text-xs text-amber-400 font-semibold">
                커스텀 모드에서는 자동 생성이 비활성화됩니다. 스탯은 수동으로 입력해주세요.
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => handleAutoGenerateStats(activeId)}
              disabled={quickStatsGenLoadingId === activeId || autoGenDisabled}
              className="h-9 px-3 rounded-lg bg-white/10 text-white text-sm font-semibold hover:bg-white/15 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
              aria-label="스탯 자동 생성"
              title="스탯 자동 생성"
            >
              {quickStatsGenLoadingId === activeId ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                '자동 생성'
              )}
            </button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={handleSyncStatsToPrompt}
              disabled={syncDisabled || quickStatsGenLoadingId === activeId}
              title="프롬프트에 스탯 블록 반영"
            >
              프롬프트 동기화
            </Button>
          </div>
        </div>
        {isStatsDirty && (
          <div className="text-xs text-amber-300/90">
            스탯 수정으로 동기화가 필요합니다.
          </div>
        )}

        <div className="relative">
          {/* ✅ 스탯 자동생성 중 오버레이 스피너 */}
          {quickStatsGenLoadingId === activeId ? (
            <div className="absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-black/25 cursor-wait">
              <div className="relative flex items-center justify-center">
                <Loader2 className="h-7 w-7 animate-spin text-gray-200" aria-hidden="true" />
                <button
                  type="button"
                  onClick={handleCancelStatsGeneration}
                  className="absolute -top-1 -right-4 p-1 rounded-full bg-red-500/20 hover:bg-red-500/30 text-red-300 hover:text-red-200 transition-colors pointer-events-auto z-10"
                  aria-label="스탯 자동 생성 취소"
                  title="스탯 자동 생성 취소"
                >
                  <X className="h-3 w-3" aria-hidden="true" />
                </button>
              </div>
            </div>
          ) : null}
        <div className={["space-y-3", quickStatsGenLoadingId === activeId ? "pointer-events-none opacity-70" : ""].join(' ')}>
          {stats.map((st, idx) => {
            const sid = String(st?.id || '').trim() || `stat_${idx + 1}`;
            const name = String(st?.name || '');
            const unit = String(st?.unit || '');
            const desc = String(st?.description || '');
            const minv = (st?.min_value === '' || st?.min_value == null) ? '' : String(st.min_value);
            const maxv = (st?.max_value === '' || st?.max_value == null) ? '' : String(st.max_value);
            const basev = (st?.base_value === '' || st?.base_value == null) ? '' : String(st.base_value);
            // ✅ 숫자 범위 검증
            const statRangeError = (() => {
              const minNum = minv !== '' && minv !== '-' ? Number(minv) : null;
              const maxNum = maxv !== '' && maxv !== '-' ? Number(maxv) : null;
              const baseNum = basev !== '' && basev !== '-' ? Number(basev) : null;
              // 최소 > 최대 검증
              if (minNum !== null && maxNum !== null && Number.isFinite(minNum) && Number.isFinite(maxNum)) {
                if (minNum > maxNum) return '최소값이 최대값보다 큽니다.';
              }
              // 기본값 범위 검증
              if (baseNum !== null && Number.isFinite(baseNum)) {
                if (minNum !== null && Number.isFinite(minNum) && baseNum < minNum) {
                  return '기본값이 최소값보다 작습니다.';
                }
                if (maxNum !== null && Number.isFinite(maxNum) && baseNum > maxNum) {
                  return '기본값이 최대값보다 큽니다.';
                }
              }
              return null;
            })();
            return (
              <div key={sid} className="rounded-lg border border-gray-700 bg-gray-900/20 p-4 space-y-4">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-semibold text-white">스탯 {idx + 1}</div>
                  <button
                    type="button"
                    onClick={() => removeStat(sid)}
                    className="h-9 px-3 rounded-md bg-gray-800 text-gray-200 hover:bg-gray-700 transition-colors text-sm font-semibold"
                  >
                    삭제
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label className="text-white">스탯 이름</Label>
                    <Input
                      value={name}
                      maxLength={20}
                      onChange={(e) => updateStatAt(sid, { name: e.target.value })}
                      placeholder="예: 호감도"
                      className="bg-gray-950 text-white border-gray-700"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-white">단위(선택)</Label>
                    <Input
                      value={unit}
                      maxLength={10}
                      onChange={(e) => updateStatAt(sid, { unit: e.target.value })}
                      placeholder="예: 점, %"
                      className="bg-gray-950 text-white border-gray-700"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="space-y-2">
                    <Label className="text-white">최소값(선택)</Label>
                    <Input
                      inputMode="text"
                      pattern="-?[0-9]*"
                      value={minv}
                      onChange={(e) => handleIntDraftChange(sid, 'min_value', e.target.value)}
                      onBlur={() => finalizeIntDraft(sid, 'min_value', minv)}
                      placeholder="예: 0"
                      className="bg-gray-950 text-white border-gray-700"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-white">최대값(선택)</Label>
                    <Input
                      inputMode="text"
                      pattern="-?[0-9]*"
                      value={maxv}
                      onChange={(e) => handleIntDraftChange(sid, 'max_value', e.target.value)}
                      onBlur={() => finalizeIntDraft(sid, 'max_value', maxv)}
                      placeholder="예: 100"
                      className="bg-gray-950 text-white border-gray-700"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-white">기본값(선택)</Label>
                    <Input
                      inputMode="text"
                      pattern="-?[0-9]*"
                      value={basev}
                      onChange={(e) => handleIntDraftChange(sid, 'base_value', e.target.value)}
                      onBlur={() => finalizeIntDraft(sid, 'base_value', basev)}
                      placeholder="예: 50"
                      className="bg-gray-950 text-white border-gray-700"
                    />
                  </div>
                </div>
                {/* ✅ 숫자 범위 에러 메시지 */}
                {statRangeError && (
                  <p className="text-sm text-red-400">{statRangeError}</p>
                )}

                <div className="space-y-2">
                  <Label className="text-white">설명</Label>
                  <Textarea
                    value={desc}
                    onChange={(e) => updateStatAt(sid, { description: e.target.value })}
                    placeholder="예: 대화 선택지/행동에 따라 변화하며, 특정 구간에 따라 엔딩이 달라질 수 있어요."
                    className="bg-gray-950 text-white border-gray-700 resize-none"
                    rows={2}
                    maxLength={200}
                  />
                  <div className="text-right text-xs text-gray-500">{Math.min(200, String(desc || '').length)} / 200</div>
                </div>
              </div>
            );
          })}

          <button
            type="button"
            onClick={addStat}
            disabled={stats.length >= HARD_MAX_STATS}
            className={[
              'w-full h-12 rounded-md border transition-colors font-semibold',
              stats.length >= HARD_MAX_STATS
                ? 'border-gray-800 bg-gray-900/40 text-gray-500 cursor-not-allowed'
                : 'border-gray-700 bg-gray-900/20 text-gray-200 hover:bg-gray-900/40',
            ].join(' ')}
          >
            + 스탯 추가
          </button>

          <div className="text-xs text-gray-500">
            현재 {stats.length} / {HARD_MAX_STATS}
          </div>
        </div>
        </div>
      </div>
    );
  };

  const renderMediaTab = () => {
    /**
     * 대표이미지/갤러리 렌더
     *
     * 주의:
     * - 이 함수 내부에서는 훅을 호출하면 안 된다(탭 조건부 렌더로 훅 순서가 바뀌어 크래시 발생).
     * - newImagePreviews는 컴포넌트 최상위 훅에서 계산/정리한다.
     */
    void newImagePreviews;
    return (
      <div className="space-y-6">
        <div className="space-y-4">
          <h3 className="text-lg font-semibold">
            대표이미지
          </h3>
          
          <Card className="p-4">
            <DropzoneGallery
              // ✅ 운영(배포)에서 API_BASE_URL(`/api`)로 `/static`이 깨지지 않게 resolveImageUrl로 통일
              existingImages={formData.media_settings.image_descriptions.map((img) => ({
                url: resolveImageUrl(img?.url),
                description: img?.description,
                // ✅ 기본 공개 (undefined도 공개로 취급)
                is_public: img?.is_public !== false,
              }))}
              onOpenGenerate={() => { try { setImgModalOpen(true); } catch (_) {} }}
              newFiles={formData.media_settings.newly_added_files}
              onToggleExistingPublic={(index) => {
                setFormData((prev) => {
                  const arr = Array.isArray(prev?.media_settings?.image_descriptions)
                    ? [...prev.media_settings.image_descriptions]
                    : [];
                  if (index < 0 || index >= arr.length) return prev;
                  const cur = arr[index] || {};
                  // ✅ 기본값은 공개(true). 클릭 시 토글한다.
                  const isPublic = cur?.is_public !== false;
                  arr[index] = { ...cur, is_public: !isPublic ? true : false };
                  return { ...prev, media_settings: { ...prev.media_settings, image_descriptions: arr } };
                });
              }}
              onAddFiles={(files) => setFormData(prev => ({
                ...prev,
                media_settings: { ...prev.media_settings, newly_added_files: [...prev.media_settings.newly_added_files, ...files] }
              }))}
              onRemoveExisting={(index) => handleRemoveExistingImage(index)}
              onRemoveNew={(index) => handleRemoveNewFile(index)}
              onReorder={({ from, to, isNew }) => {
                if (isNew) {
                  setFormData(prev => {
                    const arr = [...prev.media_settings.newly_added_files];
                    const item = arr.splice(from, 1)[0];
                    arr.splice(Math.min(arr.length, Math.max(0, to)), 0, item);
                    return { ...prev, media_settings: { ...prev.media_settings, newly_added_files: arr } };
                  });
                } else {
                  setFormData(prev => {
                    const arr = [...prev.media_settings.image_descriptions];
                    const item = arr.splice(from, 1)[0];
                    arr.splice(Math.min(arr.length, Math.max(0, to)), 0, item);
                    return { ...prev, media_settings: { ...prev.media_settings, image_descriptions: arr } };
                  });
                }
              }}
              onUpload={async (files, onProgress) => {
                const res = await filesAPI.uploadImages(files, onProgress);
                const urls = Array.isArray(res.data) ? res.data : [res.data];
                // 업로드 성공 시: 신규 파일 비우고, 기존 이미지 배열에 추가
                setFormData(prev => ({
                  ...prev,
                  media_settings: {
                    ...prev.media_settings,
                    image_descriptions: [
                      ...prev.media_settings.image_descriptions,
                      ...urls.map(u => ({ url: u, description: '', is_public: true })),
                    ],
                    newly_added_files: [],
                  }
                }));
                return urls;
              }}
            />
          </Card>
        </div>
      </div>
    );
  };

  const renderProfileWizardTab = () => (
    <div className="relative p-1 sm:p-3 space-y-3 sm:space-y-4">
      {/* ✅ 토큰 안내(i): 한줄소개에서 {{char}}/{{user}} 지원 */}
      <WizardTokenHelpIcon className="top-2 right-2" />
      {/* ✅ 대표이미지(프로필 탭에서 바로 등록) */}
      {/* ✅ 경쟁사 톤: 박스(배경/테두리) 없이 시원하게 */}
      <div className="pb-4 border-b border-gray-800/70">
        {(() => {
          const avatarRaw = String(formData?.media_settings?.avatar_url || '').trim();
          const firstImg = Array.isArray(formData?.media_settings?.image_descriptions)
            ? String(formData.media_settings.image_descriptions?.[0]?.url || '').trim()
            : '';
          const previewUrl = avatarRaw || firstImg;
          const hasPreview = !!previewUrl;
          return (
            <div className="flex items-start gap-4">
              <div className="shrink-0">
                <div className="text-sm font-semibold text-gray-200 mb-2">
                  이미지 <span className="text-red-400">*</span>
                </div>
                <div className="w-[84px] h-[84px] rounded-lg overflow-hidden border border-gray-700 bg-gray-950/40 flex items-center justify-center">
                  {hasPreview ? (
                    <img
                      src={resolveImageUrl(previewUrl)}
                      alt=""
                      className="w-full h-full object-cover cursor-zoom-in"
                      loading="lazy"
                      onClick={() => {
                        try {
                          const src = resolveImageUrl(previewUrl);
                          if (!src) return;
                          setImageViewerSrc(src);
                          setImageViewerOpen(true);
                        } catch (_) {}
                      }}
                    />
                  ) : (
                    <div className="text-[11px] text-gray-500 text-center px-2">
                      대표<br />이미지
                    </div>
                  )}
                </div>
              </div>

              <div className="flex-1 min-w-0">
                <div className="text-sm text-gray-200 font-semibold">이미지를 필수로 등록해 주세요.</div>
                <div className="text-xs text-gray-500 mt-1">부적절한 이미지는 업로드가 제한됩니다.</div>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      // ✅ 요구사항: "업로드" 버튼은 파일 선택기가 아니라 이미지 모달을 연다.
                      try { setImgModalOpen(true); } catch (_) {}
                    }}
                    disabled={isUploading}
                    className="bg-gray-800 text-gray-100 hover:bg-gray-700"
                    title="대표이미지 업로드"
                  >
                    업로드
                  </Button>

                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      setFormData((prev) => ({
                        ...prev,
                        media_settings: {
                          ...prev.media_settings,
                          avatar_url: '',
                        },
                      }));
                    }}
                    disabled={!String(formData?.media_settings?.avatar_url || '').trim()}
                    className="bg-gray-800 text-gray-100 hover:bg-gray-700 disabled:opacity-50"
                    title="대표이미지 삭제(avatar_url만 비움)"
                  >
                    삭제
                  </Button>

                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => setImgModalOpen(true)}
                    className="bg-gray-800 text-gray-100 hover:bg-gray-700"
                    title="이미지 생성"
                  >
                    생성
                  </Button>
                </div>
                {!hasPreview && (
                  <div className="mt-3 text-xs text-red-400 font-semibold">
                    대표 이미지를 등록해주세요.
                  </div>
                )}
              </div>
            </div>
          );
        })()}
      </div>

      {/* 남성향/여성향 선택 */}
      <div className="space-y-3">
        <div className="text-sm font-semibold text-gray-200">
          남성향 / 여성향 / 전체 <span className="text-red-400">*</span>
        </div>
        <div className="grid grid-cols-3 gap-2 rounded-xl border border-gray-800 bg-gray-950/40 p-2">
          {REQUIRED_AUDIENCE_CHOICES.map((opt, idx) => {
            const selected = Array.isArray(selectedTagSlugs) && selectedTagSlugs.includes(opt.slug);
            return (
              <button
                key={opt.slug}
                type="button"
                onClick={() => toggleExclusiveTag(opt.slug, REQUIRED_AUDIENCE_SLUGS)}
                aria-pressed={selected}
                className={[
                  'h-10 rounded-lg px-3 text-sm font-semibold transition-all',
                  'outline-none focus-visible:ring-2 focus-visible:ring-purple-500/30',
                  selected
                    ? 'bg-gradient-to-br from-purple-600 to-indigo-600 text-white shadow-sm ring-1 ring-purple-400/40'
                    : 'bg-gray-900/30 text-gray-200 hover:bg-gray-800/60 ring-1 ring-transparent',
                ].join(' ')}
              >
                <span className="block w-full truncate">{opt.label}</span>
              </button>
            );
          })}
        </div>
        {fieldErrors['basic_info.audience_pref'] && (
          <p className="text-xs text-red-400">{fieldErrors['basic_info.audience_pref']}</p>
        )}
      </div>

      {/* ✅ 진행 턴수: 프로필 탭(남/여/전체 바로 아래) */}
      {(() => {
        /**
         * ✅ 프로필 탭: 턴수 설정
         *
         * 의도/원리:
         * - 옵션 탭에 있으면 프롬프트/초기 설정 흐름(앞단)과 분리되어 UX가 어긋난다.
         * - 저장은 start_sets(위저드 SSOT JSON)로 유지해서, 서버 스키마/DB 변경 없이도 안전하게 확장한다.
         */
        const ss = (formData?.basic_info?.start_sets && typeof formData.basic_info.start_sets === 'object')
          ? formData.basic_info.start_sets
          : null;
        const sim = (ss && typeof ss.sim_options === 'object' && ss.sim_options) ? ss.sim_options : {};
        const mode = String(sim?.mode || 'preset'); // 'preset' | 'custom'
        const maxTurnsRaw = Number(sim?.max_turns ?? 200);
        const maxTurns = Number.isFinite(maxTurnsRaw) && maxTurnsRaw >= 50 ? Math.floor(maxTurnsRaw) : 200;
        const presets = [50, 100, 200, 300];
        const selectedPreset = presets.includes(maxTurns) && mode !== 'custom' ? maxTurns : null;
        const showCustom = mode === 'custom';

        const setSimOptions = (patch) => {
          updateStartSets((prev) => {
            const cur = (prev && typeof prev === 'object') ? prev : {};
            const curSim = (cur?.sim_options && typeof cur.sim_options === 'object') ? cur.sim_options : {};
            return { ...cur, sim_options: { ...curSim, ...(patch || {}) } };
          });
        };

        return (
          <div className="space-y-1">
            <div className="text-sm font-semibold text-gray-200">
              진행 턴수 <span className="text-red-400 ml-1">*</span>
            </div>
            <div className="text-xs text-gray-500">스토리 진행 길이를 선택하세요. (커스텀은 최소 50턴)</div>

            <div className="mt-3 grid grid-cols-5 overflow-hidden rounded-lg border border-gray-700/80 bg-gray-900/30">
              {[50, 100, 200, 300].map((n, idx) => {
                const selected = selectedPreset === n;
                const isLast = idx === 3; // 300 버튼은 커스텀 버튼 앞
                return (
                  <button
                    key={`turns-${n}`}
                    type="button"
                    onClick={() => setSimOptions({ mode: 'preset', max_turns: n })}
                    aria-pressed={selected}
                    className={[
                      'h-10 px-2 text-xs sm:text-sm font-semibold transition-colors',
                      isLast ? '' : 'border-r border-gray-700/80',
                      selected ? 'bg-purple-600 text-white' : 'bg-transparent text-gray-200 hover:bg-gray-800/60',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500/30',
                    ].join(' ')}
                  >
                    {n}턴
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() => setSimOptions({ mode: 'custom', max_turns: maxTurns || 200 })}
                aria-pressed={showCustom}
                className={[
                  'h-10 px-2 text-xs sm:text-sm font-semibold transition-colors',
                  'border-l border-gray-700/80',
                  showCustom ? 'bg-purple-600 text-white' : 'bg-transparent text-gray-200 hover:bg-gray-800/60',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500/30',
                ].join(' ')}
              >
                직접입력
              </button>
            </div>

            {showCustom ? (
              <div className="mt-3 flex items-center gap-2">
                <Input
                  key={`custom-turns-${maxTurns}`}
                  type="number"
                  min={50}
                  step={1}
                  defaultValue={String(maxTurns)}
                  className="w-40 bg-gray-900/30 border-gray-700 text-gray-100"
                  placeholder="예: 250"
                  onBlur={(e) => {
                    try {
                      const v = String(e?.target?.value ?? '').trim();
                      const n = Number(v);
                      if (!Number.isFinite(n)) return;
                      const nextRaw = Math.floor(n);
                      if (nextRaw < 50) {
                        // ✅ 요구사항: 직접입력에서 0~30(및 50 미만)은 입력 불가 → 경고 모달
                        try {
                          setCustomTurnsWarnMessage('직접입력은 최소 50턴부터 가능합니다. (0~30턴은 입력할 수 없어요)');
                          setCustomTurnsWarnOpen(true);
                        } catch (_) {}
                        setSimOptions({ mode: 'custom', max_turns: 50 });
                        return;
                      }
                      setSimOptions({ mode: 'custom', max_turns: nextRaw });
                    } catch (err) {
                      try { console.error('[CreateCharacterPage] custom max_turns blur failed:', err); } catch (_) {}
                    }
                  }}
                />
                <div className="text-sm text-gray-300">턴</div>
                <div className="text-xs text-gray-500">입력 후 포커스를 빼면 적용돼요.</div>
              </div>
            ) : null}
            {fieldErrors['basic_info.sim_options.max_turns'] && (
              <p className="mt-3 text-xs text-red-400 font-semibold">{fieldErrors['basic_info.sim_options.max_turns']}</p>
            )}
          </div>
        );
      })()}

      {/* ✅ 프롬프트 타입(롤플레잉/시뮬/커스텀): 프로필 단계에서 선택 */}
      <div
        ref={promptTypeSectionRef}
        className={[
          // ✅ 요구사항: "프롬프트 타입"을 박스(카드)에서 빼고 필수 영역으로 취급한다.
          // - 기존 카드 스타일(테두리/배경)을 제거해 다른 필수 입력들과 톤을 맞춘다.
          'space-y-1',
          promptTypeHighlight ? 'highlight-flash' : '',
        ].filter(Boolean).join(' ')}
      >
        <div className="text-sm font-semibold text-gray-200">
          프롬프트 타입 <span className="text-red-400 ml-1">*</span>
        </div>
        <div className="text-xs text-gray-500">선택한 타입에 맞춰 프롬프트/자동생성이 동작합니다.</div>
        <div className="mt-2 grid grid-cols-3 overflow-hidden rounded-lg border border-gray-700/80 bg-gray-900/30">
          {[
            { value: 'roleplay', label: '롤플레잉' },
            { value: 'simulator', label: '시뮬레이션' },
            { value: 'custom', label: '커스텀' },
          ].map((opt, idx, arr) => {
            const selected = String(formData?.basic_info?.character_type || 'roleplay') === opt.value;
            const isLast = idx === arr.length - 1;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => updateFormData('basic_info', 'character_type', opt.value)}
                aria-pressed={selected}
                className={`h-10 px-2 text-xs sm:text-sm font-medium transition-colors ${
                  isLast ? '' : 'border-r border-gray-700/80'
                } ${
                  selected ? 'bg-purple-600 text-white' : 'bg-transparent text-gray-200 hover:bg-gray-800/60'
                } focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500/30`}
              >
                <span className="block w-full truncate">{opt.label}</span>
              </button>
            );
          })}
        </div>
        <div className="mt-2 text-xs text-gray-500">
          {String(formData?.basic_info?.character_type || 'roleplay') === 'roleplay' && (
            <span>실제 사람과 대화하는 것처럼 자연스러운 소통을 즐겨보세요.</span>
          )}
          {String(formData?.basic_info?.character_type || 'roleplay') === 'simulator' && (
            <span>다양한 캐릭터가 등장하는 흥미진진한 이야기를 AI가 펼쳐요.</span>
          )}
          {String(formData?.basic_info?.character_type || 'roleplay') === 'custom' && (
            <span>크리에이터의 의도대로 AI를 조정할 수 있는 커스텀 설정이에요.</span>
          )}
        </div>
        {fieldErrors['basic_info.character_type'] && (
          <p className="text-xs text-red-400 mt-2">{fieldErrors['basic_info.character_type']}</p>
        )}
      </div>

      {/* ✅ 요구사항: 30초 모달과 동일한 "장르/캐릭터유형/소재" 햄버거(아코디언) UI를
          위저드의 "프롬프트 타입" 아래, "작품명" 위에 배치한다. */}
      <div className="space-y-2">
        <div className="text-xs sm:text-sm font-semibold text-gray-200">
          장르/캐릭터유형/소재를 골라주세요.
        </div>

        <div className="rounded-xl border border-gray-800 bg-gray-950/20 overflow-hidden">
          {/* 장르 */}
          <button
            type="button"
            onClick={() => {
              setQmChipPanelsOpen((prev) => ({ ...(prev || {}), genre: !Boolean(prev?.genre) }));
            }}
            className="w-full h-11 px-3 flex items-center justify-between gap-3 bg-gray-950/10 hover:bg-gray-900/20 border-b border-gray-800"
            aria-expanded={!!qmChipPanelsOpen?.genre}
          >
            <div className="flex items-center gap-2 min-w-0">
              <Menu className="w-4 h-4 text-gray-400 flex-shrink-0" aria-hidden="true" />
              <div className="text-xs sm:text-sm font-semibold text-gray-200 truncate">
                장르<span className="text-rose-400"> *</span>
              </div>
              <div className="text-[11px] text-gray-500 flex-shrink-0">(최대 2)</div>
            </div>
            <div className="flex items-center gap-2">
              <div className="text-[11px] sm:text-xs text-gray-400 max-w-[180px] truncate">
                {(Array.isArray(qmSelectedGenres) && qmSelectedGenres.length > 0) ? qmSelectedGenres.join(', ') : '미선택'}
              </div>
              {qmChipPanelsOpen?.genre
                ? <ChevronUp className="w-4 h-4 text-gray-400" aria-hidden="true" />
                : <ChevronDown className="w-4 h-4 text-gray-400" aria-hidden="true" />}
            </div>
          </button>
          {qmChipPanelsOpen?.genre ? (
            <div className="p-3 space-y-2">
              <div className="text-[11px] sm:text-xs text-gray-400">장르는 최대 2개까지 선택할 수 있어요.</div>
              <div className="flex flex-wrap gap-2">
                {(qmGenreExpanded ? qmGenreDisplay : qmGenreDisplay.slice(0, QUICK_MEET_GENRE_PREVIEW_COUNT)).map((t) => {
                  const selected = (Array.isArray(qmSelectedGenres) ? qmSelectedGenres : []).includes(t);
                  const atLimit = !selected && (Array.isArray(qmSelectedGenres) ? qmSelectedGenres.length : 0) >= QUICK_MEET_GENRE_MAX_SELECT;
                  return (
                    <button
                      key={`wizard-genre-${t}`}
                      type="button"
                      disabled={atLimit}
                      onClick={() => toggleQuickMeetGenreChip(t)}
                      aria-pressed={selected}
                      className={[
                        'h-7 px-2.5 rounded-full border text-xs font-semibold transition-colors whitespace-nowrap flex-shrink-0',
                        selected
                          ? 'border-purple-400/50 bg-purple-600/20 text-purple-100'
                          : 'border-gray-700/60 bg-gray-900/10 text-gray-200 hover:bg-gray-800/30',
                        atLimit ? 'opacity-40 cursor-not-allowed' : '',
                      ].join(' ')}
                      title={atLimit ? '장르는 최대 2개까지 선택할 수 있어요.' : t}
                    >
                      {t}
                    </button>
                  );
                })}

                {/* 더보기/접기 */}
                <button
                  key="wizard-genre-more-toggle"
                  type="button"
                  onClick={() => setQmGenreExpanded((v) => !v)}
                  aria-label={qmGenreExpanded ? '장르 접기' : '장르 더보기'}
                  className="h-7 px-2.5 rounded-full border text-xs font-semibold transition-colors whitespace-nowrap flex-shrink-0 border-gray-700/60 bg-gray-900/10 text-gray-200 hover:bg-gray-800/30 inline-flex items-center gap-1"
                  title={qmGenreExpanded ? '접기' : '더보기'}
                >
                  <span>{qmGenreExpanded ? '접기' : '더보기'}</span>
                  {qmGenreExpanded
                    ? <ChevronUp className="w-3.5 h-3.5 opacity-80" aria-hidden="true" />
                    : <ChevronDown className="w-3.5 h-3.5 opacity-80" aria-hidden="true" />}
                </button>
              </div>
              {fieldErrors['tags.quickmeet.genre'] && (
                <p className="text-xs text-red-400 mt-2">{fieldErrors['tags.quickmeet.genre']}</p>
              )}
            </div>
          ) : null}

          {/* 캐릭터 유형 */}
          <button
            type="button"
            onClick={() => {
              setQmChipPanelsOpen((prev) => ({ ...(prev || {}), type: !Boolean(prev?.type) }));
            }}
            className="w-full h-11 px-3 flex items-center justify-between gap-3 bg-gray-950/10 hover:bg-gray-900/20 border-b border-gray-800"
            aria-expanded={!!qmChipPanelsOpen?.type}
          >
            <div className="flex items-center gap-2 min-w-0">
              <Menu className="w-4 h-4 text-gray-400 flex-shrink-0" aria-hidden="true" />
              <div className="text-xs sm:text-sm font-semibold text-gray-200 truncate">
                캐릭터 유형<span className="text-rose-400"> *</span>
              </div>
              <div className="text-[11px] text-gray-500 flex-shrink-0">(1개)</div>
            </div>
            <div className="flex items-center gap-2">
              <div className="text-[11px] sm:text-xs text-gray-400 max-w-[180px] truncate">
                {String(qmSelectedType || '').trim() ? String(qmSelectedType || '').trim() : '미선택'}
              </div>
              {qmChipPanelsOpen?.type
                ? <ChevronUp className="w-4 h-4 text-gray-400" aria-hidden="true" />
                : <ChevronDown className="w-4 h-4 text-gray-400" aria-hidden="true" />}
            </div>
          </button>
          {qmChipPanelsOpen?.type ? (
            <div className="p-3 space-y-2">
              <div className="flex items-center justify-between gap-3">
                <div className="text-[11px] sm:text-xs text-gray-400">유형은 1개만 선택할 수 있어요.</div>
                <button
                  type="button"
                  onClick={() => {
                    const len = Array.isArray(qmTypeDisplay) ? qmTypeDisplay.length : 0;
                    if (len <= 0) return;
                    setQmTypePage((p) => ((Number(p || 0) + 1) * QUICK_MEET_TYPE_PAGE_SIZE >= len ? 0 : Number(p || 0) + 1));
                  }}
                  aria-label="캐릭터 유형 교체"
                  className="h-8 w-9 rounded-lg border border-gray-800 bg-gray-950/20 hover:bg-gray-900/30 text-gray-300 inline-flex items-center justify-center disabled:opacity-50"
                  title="교체"
                >
                  <RefreshCw className="w-4 h-4" aria-hidden="true" />
                </button>
              </div>
              <div className="flex flex-wrap gap-2 max-h-[96px] overflow-hidden">
                {qmTypeVisible.map((t) => {
                  const selected = String(qmSelectedType || '') === t;
                  return (
                    <button
                      key={`wizard-type-${t}`}
                      type="button"
                      onClick={() => toggleQuickMeetSingleChip('type', t)}
                      aria-pressed={selected}
                      className={[
                        'h-7 px-2.5 rounded-full border text-xs font-semibold transition-colors whitespace-nowrap flex-shrink-0',
                        selected
                          ? 'border-purple-400/50 bg-purple-600/20 text-purple-100'
                          : 'border-gray-700/60 bg-gray-900/10 text-gray-200 hover:bg-gray-800/30',
                      ].join(' ')}
                      title={t}
                    >
                      {t}
                    </button>
                  );
                })}
              </div>
              {fieldErrors['tags.quickmeet.type'] && (
                <p className="text-xs text-red-400 mt-2">{fieldErrors['tags.quickmeet.type']}</p>
              )}
            </div>
          ) : null}

          {/* 소재(훅/행동/소재) */}
          <button
            type="button"
            onClick={() => {
              setQmChipPanelsOpen((prev) => ({ ...(prev || {}), hook: !Boolean(prev?.hook) }));
            }}
            className="w-full h-11 px-3 flex items-center justify-between gap-3 bg-gray-950/10 hover:bg-gray-900/20"
            aria-expanded={!!qmChipPanelsOpen?.hook}
          >
            <div className="flex items-center gap-2 min-w-0">
              <Menu className="w-4 h-4 text-gray-400 flex-shrink-0" aria-hidden="true" />
              <div className="text-xs sm:text-sm font-semibold text-gray-200 truncate">
                소재<span className="text-rose-400"> *</span>
              </div>
              <div className="text-[11px] text-gray-500 flex-shrink-0">(1개)</div>
            </div>
            <div className="flex items-center gap-2">
              <div className="text-[11px] sm:text-xs text-gray-400 max-w-[180px] truncate">
                {String(qmSelectedHook || '').trim() ? String(qmSelectedHook || '').trim() : '미선택'}
              </div>
              {qmChipPanelsOpen?.hook
                ? <ChevronUp className="w-4 h-4 text-gray-400" aria-hidden="true" />
                : <ChevronDown className="w-4 h-4 text-gray-400" aria-hidden="true" />}
            </div>
          </button>
          {qmChipPanelsOpen?.hook ? (
            <div className="p-3 space-y-2">
              <div className="flex items-center justify-between gap-3">
                <div className="text-[11px] sm:text-xs text-gray-400">소재는 1개만 선택할 수 있어요.</div>
                <button
                  type="button"
                  onClick={() => {
                    const len = Array.isArray(qmHookDisplay) ? qmHookDisplay.length : 0;
                    if (len <= 0) return;
                    setQmHookPage((p) => ((Number(p || 0) + 1) * QUICK_MEET_HOOK_PAGE_SIZE >= len ? 0 : Number(p || 0) + 1));
                  }}
                  aria-label="소재 교체"
                  className="h-8 w-9 rounded-lg border border-gray-800 bg-gray-950/20 hover:bg-gray-900/30 text-gray-300 inline-flex items-center justify-center disabled:opacity-50"
                  title="교체"
                >
                  <RefreshCw className="w-4 h-4" aria-hidden="true" />
                </button>
              </div>
              <div className="flex flex-wrap gap-2 max-h-[64px] overflow-hidden">
                {qmHookVisible.map((t) => {
                  const selected = String(qmSelectedHook || '') === t;
                  return (
                    <button
                      key={`wizard-hook-${t}`}
                      type="button"
                      onClick={() => toggleQuickMeetSingleChip('hook', t)}
                      aria-pressed={selected}
                      className={[
                        'h-7 px-2.5 rounded-full border text-xs font-semibold transition-colors whitespace-nowrap flex-shrink-0',
                        selected
                          ? 'border-purple-400/50 bg-purple-600/20 text-purple-100'
                          : 'border-gray-700/60 bg-gray-900/10 text-gray-200 hover:bg-gray-800/30',
                      ].join(' ')}
                      title={t}
                    >
                      {t}
                    </button>
                  );
                })}
              </div>
              {fieldErrors['tags.quickmeet.hook'] && (
                <p className="text-xs text-red-400 mt-2">{fieldErrors['tags.quickmeet.hook']}</p>
              )}
            </div>
          ) : null}
        </div>
      </div>

      {/* 작품명 */}
      <div>
        <Label htmlFor="name">
          작품명 <span className="text-red-400 ml-1">*</span>
        </Label>
        <div className="relative mt-3">
          {quickGenLoading ? (
            /**
             * ✅ 요구사항: 자동생성 완료 전까지 입력필드 텍스트는 비우고 스피너만 노출
             * - 순차 자동생성(작품명 → 한줄소개) 중간 결과가 화면에 먼저 박히면 UX가 깨진다.
             * - 상태(SSOT)는 그대로 두되, "표시"만 스피너로 잠시 대체한다.
             */
            <>
              <Input
                id="name"
                className="bg-gray-950/40 border-gray-700 text-transparent caret-transparent pr-16"
                value=""
                onChange={() => {}}
                placeholder=""
                disabled
                readOnly
                aria-busy="true"
              />
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="relative flex items-center justify-center">
                  <Loader2 className="h-5 w-5 animate-spin text-gray-200" aria-hidden="true" />
                  <button
                    type="button"
                    onClick={handleCancelProfileGeneration}
                    className="absolute -top-1 -right-4 p-1 rounded-full bg-red-500/20 hover:bg-red-500/30 text-red-300 hover:text-red-200 transition-colors pointer-events-auto z-10"
                    aria-label="자동 생성 취소"
                    title="자동 생성 취소"
                  >
                    <X className="h-3 w-3" aria-hidden="true" />
                  </button>
                </div>
              </div>
            </>
          ) : (
            <>
              <Input
                id="name"
                className="bg-gray-950/40 border-gray-700 text-gray-100 placeholder:text-gray-500 pr-16"
                value={formData.basic_info.name}
                onChange={(e) => updateFormData('basic_info', 'name', e.target.value)}
                onBlur={refreshChatPreviewSnapshot}
                placeholder="작품명을 입력하세요"
                required
              />
              <CharLimitCounter value={formData.basic_info.name} max={PROFILE_NAME_MAX_LEN} />
            </>
          )}
        </div>
        {(() => {
          if (quickGenLoading) return null;
          const raw = String(formData?.basic_info?.name || '');
          if (raw.trim().length === 0) return <p className="text-xs text-red-400 mt-2">작품명은 필수입니다.</p>;
          if (raw.length > PROFILE_NAME_MAX_LEN) return <p className="text-xs text-rose-400 mt-2">작품명은 최대 {PROFILE_NAME_MAX_LEN}자까지 입력할 수 있어요.</p>;
          return null;
        })()}
      </div>

      {/* 한줄소개 */}
      <div>
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="profile_intro">
            한줄소개 <span className="text-red-400 ml-1">*</span>
          </Label>
        </div>
        <div className="relative mt-3">
          {(() => {
            const descMax = getProfileOneLineMaxLenByCharacterType(formData?.basic_info?.character_type);
            return (
              <>
                {quickGenLoading ? (
                  <>
                    <Textarea
                      id="profile_intro"
                      data-autogrow="1"
                      onInput={handleAutoGrowTextarea}
                      className="resize-none overflow-hidden pr-16 pb-6 text-transparent caret-transparent"
                      value=""
                      onChange={() => {}}
                      placeholder=""
                      rows={5}
                      disabled
                      readOnly
                      aria-busy="true"
                    />
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                      <Loader2 className="h-6 w-6 animate-spin text-gray-200" aria-hidden="true" />
                    </div>
                  </>
                ) : (
                  <>
                    <Textarea
                      id="profile_intro"
                      data-autogrow="1"
                      onInput={handleAutoGrowTextarea}
                      className="resize-none overflow-hidden pr-16 pb-6"
                      value={formData.basic_info.description}
                      onChange={(e) => updateFormData('basic_info', 'description', e.target.value)}
                      onBlur={refreshChatPreviewSnapshot}
                      placeholder="캐릭터를 간단히 소개해주세요."
                      rows={5}
                      required={!isEditMode}
                      maxLength={descMax}
                    />
                    <CharLimitCounter value={formData.basic_info.description} max={descMax} />
                  </>
                )}
              </>
            );
          })()}
        </div>
        {(() => {
          if (quickGenLoading) return null;
          const raw = String(formData?.basic_info?.description || '');
          if (raw.trim().length === 0) return <p className="text-xs text-red-400 mt-2">한줄소개는 필수입니다.</p>;
          const descMax = getProfileOneLineMaxLenByCharacterType(formData?.basic_info?.character_type);
          if (raw.length > descMax) return <p className="text-xs text-rose-400 mt-2">한줄소개는 최대 {descMax}자까지 입력할 수 있어요.</p>;
          return null;
        })()}
        {fieldErrors['basic_info.description'] && (
          quickGenLoading ? null : <p className="text-xs text-red-500 mt-2">{fieldErrors['basic_info.description']}</p>
        )}

        {/* ✅ 요구사항: 자동생성 버튼을 한줄소개 박스 아래(우측 하단)로 이동 */}
        <div className="mt-2 flex justify-end">
          <div className="flex flex-col items-end gap-2">
            <button
              type="button"
              onClick={handleAutoGenerateProfile}
              disabled={quickGenLoading}
              className="h-9 px-3 rounded-lg bg-white/10 text-white text-sm font-semibold hover:bg-white/15 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
              aria-label="프로필 자동 생성"
              title="프로필 자동 생성"
            >
              {quickGenLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                '자동 생성'
              )}
            </button>

            {/* ✅ QuickMeet와 동일 의미: 이미지 정보 포함 토글 (OFF=빠르고 트렌디하게 생성) */}
            <label className="inline-flex items-center gap-2 text-xs text-gray-300 select-none">
              {profileAutoGenUseImage ? '삽입한 이미지에 정확하게 생성' : '빠르고 트렌디하게 생성'}
              <Switch
                checked={profileAutoGenUseImage}
                onCheckedChange={(v) => setProfileAutoGenUseImage(Boolean(v))}
                disabled={quickGenLoading || !hasProfileImageForAutoGen}
              />
            </label>

            {/* ✅ 30초 모달과 동일 배치: "제목 스타일 자유/작품명 구체적으로" 토글은 '빠르고 트렌디하게 생성' 바로 아래 */}
            {String(formData?.basic_info?.character_type || 'roleplay') !== 'simulator' ? (
              <label className="inline-flex items-center gap-2 text-xs text-gray-300 select-none">
                {quickGenTitleNameMode ? '작품명 구체적으로' : '제목 스타일 자유'}
                <Switch
                  checked={quickGenTitleNameMode}
                  onCheckedChange={(v) => setQuickGenTitleNameMode(Boolean(v))}
                  disabled={quickGenLoading}
                />
              </label>
            ) : null}

            {/* ✅ 요구사항: "빠르고 트렌디하게 생성" 바로 아래에 동일한 ON/OFF 토글로 붙이기 */}
            {String(formData?.basic_info?.character_type || 'roleplay') === 'simulator' && (() => {
              const ss = (formData?.basic_info?.start_sets && typeof formData.basic_info.start_sets === 'object')
                ? formData.basic_info.start_sets
                : null;
              const sim = (ss && typeof ss.sim_options === 'object' && ss.sim_options) ? ss.sim_options : {};
              const simDatingElements = !!sim?.sim_dating_elements;
              return (
                <label className="inline-flex items-center gap-2 text-xs text-gray-300 select-none">
                  시뮬 내 미연시 요소
                  <Switch
                    checked={simDatingElements}
                    onCheckedChange={(v) => {
                      const on = !!v;
                      updateStartSets((prev) => {
                        const cur = (prev && typeof prev === 'object') ? prev : {};
                        const curSim = (cur?.sim_options && typeof cur.sim_options === 'object') ? cur.sim_options : {};
                        return { ...cur, sim_options: { ...curSim, sim_dating_elements: on } };
                      });
                    }}
                    disabled={quickGenLoading}
                  />
                </label>
              );
            })()}
          </div>
        </div>
      </div>

      {/* ✅ 작품 컨셉(선택, 고급): 프롬프트 자동생성 보강용 */}
      {(() => {
        const ss = (formData?.basic_info?.start_sets && typeof formData.basic_info.start_sets === 'object')
          ? formData.basic_info.start_sets
          : null;
        const pc = (ss && typeof ss.profile_concept === 'object' && ss.profile_concept) ? ss.profile_concept : null;
        const enabled = !!pc?.enabled;
        const text = String(pc?.text || '');
        return (
          <div className="rounded-xl border border-gray-800 bg-gray-900/30 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-gray-200">
                  작품 컨셉 <span className="text-xs text-gray-500 font-medium">(선택 · 고급)</span>
                </div>
                <div className="mt-1 text-xs text-gray-500">
                  작품의 컨셉을 모델이 좀 더 잘 이해하게 됩니다. 프롬프트 자동생성 시 참고합니다.
                </div>
              </div>
              <div className="flex items-center gap-2">
                {enabled ? (
                  profileConceptEditMode ? (
                    <button
                      type="button"
                      onClick={() => {
                        // ✅ 편집 확정(잠금)
                        try { setProfileConceptEditMode(false); } catch (_) {}
                      }}
                      disabled={quickGenLoading}
                      className="h-8 w-8 inline-flex items-center justify-center rounded-md border border-gray-700 bg-gray-950/40 text-gray-200 hover:bg-gray-800/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      title="수정 확정"
                      aria-label="작품 컨셉 수정 확정"
                    >
                      <Check className="h-4 w-4" aria-hidden="true" />
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        // ✅ 경고 후 편집 모드 진입(연필)
                        try { setProfileConceptEditConfirmOpen(true); } catch (_) {}
                      }}
                      disabled={quickGenLoading}
                      className="h-8 w-8 inline-flex items-center justify-center rounded-md border border-gray-700 bg-gray-950/40 text-gray-200 hover:bg-gray-800/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      title="직접 수정(잠금 해제)"
                      aria-label="작품 컨셉 직접 수정"
                    >
                      <Pencil className="h-4 w-4" aria-hidden="true" />
                    </button>
                  )
                ) : null}
                <Switch
                  id="profile_concept_toggle"
                  checked={enabled}
                  onCheckedChange={(v) => {
                    const on = !!v;
                    // ✅ 토글 OFF 시 편집/확인 모달은 강제 종료(방어)
                    if (!on) {
                      try { setProfileConceptEditMode(false); } catch (_) {}
                      try { setProfileConceptEditConfirmOpen(false); } catch (_) {}
                    }
                    updateStartSets((prev) => {
                      const cur = (prev && typeof prev === 'object') ? prev : {};
                      const existing = (cur.profile_concept && typeof cur.profile_concept === 'object') ? cur.profile_concept : {};
                      return { ...cur, profile_concept: { ...(existing || {}), enabled: on } };
                    });
                  }}
                  aria-label="작품 컨셉 사용"
                />
              </div>
            </div>

            {enabled ? (
              <div className="mt-3">
                <div className="relative">
                  {quickGenLoading ? (
                    /**
                     * ✅ 요구사항: 자동생성 중에는 작품 컨셉도 텍스트를 비우고 스피너만 노출
                     * - 작품명/한줄소개가 갱신되는 동안 컨셉도 함께 "동기화 중"임을 명확히 보여준다.
                     */
                    <>
                      <Textarea
                        id="profile_concept_text"
                        data-autogrow="1"
                        onInput={handleAutoGrowTextarea}
                        className="resize-none overflow-hidden pr-16 pb-6 bg-gray-950/40 border-gray-700 text-transparent caret-transparent placeholder:text-transparent"
                        value=""
                        onChange={() => {}}
                        placeholder=""
                        rows={6}
                        disabled
                        readOnly
                        aria-busy="true"
                      />
                      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                        <Loader2 className="h-6 w-6 animate-spin text-gray-200" aria-hidden="true" />
                      </div>
                    </>
                  ) : (
                    <>
                      <Textarea
                        id="profile_concept_text"
                        data-autogrow="1"
                        onInput={handleAutoGrowTextarea}
                        className={[
                          'resize-none overflow-hidden pr-16 pb-6 border-gray-700 text-gray-100 placeholder:text-gray-500',
                          profileConceptEditMode ? 'bg-gray-950/40' : 'bg-gray-950/20 opacity-90',
                        ].join(' ')}
                        value={text}
                        onChange={(e) => {
                          // ✅ 기본값은 잠금(읽기 전용). 연필로 해제한 경우에만 반영한다.
                          if (!profileConceptEditMode) return;
                          const v = String(e?.target?.value || '');
                          updateStartSets((prev) => {
                            const cur = (prev && typeof prev === 'object') ? prev : {};
                            const existing = (cur.profile_concept && typeof cur.profile_concept === 'object') ? cur.profile_concept : {};
                            return {
                              ...cur,
                              profile_concept: { ...(existing || {}), enabled: true, text: v.slice(0, PROFILE_CONCEPT_MAX_LEN) },
                            };
                          });
                        }}
                        placeholder="예) 장르/톤, 핵심 갈등, 관계/역할, 세계관 규칙, 전개 포인트 등을 적어주세요."
                        rows={6}
                        maxLength={PROFILE_CONCEPT_MAX_LEN}
                        readOnly={!profileConceptEditMode}
                      />
                      <CharLimitCounter value={text} max={PROFILE_CONCEPT_MAX_LEN} />
                    </>
                  )}
                </div>
                <div className="mt-2 text-xs text-gray-500">
                  {profileConceptEditMode
                    ? '직접 수정 중입니다. 우상단 체크 버튼을 누르면 수정이 확정(잠금)됩니다.'
                    : '기본 잠금 상태입니다. 우상단 연필로 잠금 해제 후 직접 수정할 수 있습니다.'}
                </div>
              </div>
            ) : null}
          </div>
        );
      })()}
    </div>
  );

  const renderExistingImageUploadAndTriggers = (opts = {}) => (
    <>
      {/* 기존: 캐릭터 이미지 업로드 + 이미지 생성 트리거 + 키워드 트리거 */}
      <Card className="p-4 border border-gray-800 bg-gray-900/40 text-gray-100">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-base sm:text-lg font-semibold flex items-center text-gray-100">
            <Image className="w-5 h-5 mr-2" />
            캐릭터 이미지 {!isEditMode && <span className="text-red-400 ml-1">*</span>}
          </h3>
          {opts?.hideGenerateButton ? null : (
            <Button
              type="button"
              size="sm"
              className="bg-purple-600 hover:bg-purple-700 text-white"
              onClick={() => setImgModalOpen(true)}
            >
              이미지 생성하기
            </Button>
          )}
        </div>
        <ErrorBoundary>
          <DropzoneGallery
            tone="dark"
            maxFiles={opts?.gallery?.maxFiles}
            gridColumns={opts?.gallery?.gridColumns}
            enableInfiniteScroll={!!opts?.gallery?.enableInfiniteScroll}
            pageSize={opts?.gallery?.pageSize}
            layoutVariant={opts?.gallery?.layoutVariant || 'with_dropzone'}
            inlineAddSlotVariant={opts?.gallery?.inlineAddSlotVariant || 'none'}
            onOpenGenerate={opts?.gallery?.onOpenGenerate}
            // ✅ 운영(배포)에서 API_BASE_URL이 `/api`로 끝나면 `/static/*` 이미지가 `/api/static/*`로 잘못 붙어 깨질 수 있다.
            // - 표준 유틸(`resolveImageUrl`)로만 렌더링 URL을 만든다.
            existingImages={formData.media_settings.image_descriptions.map((img) => ({
              url: resolveImageUrl(img?.url),
              description: img?.description,
              // ✅ 기본 공개 (undefined도 공개로 취급)
              is_public: img?.is_public !== false,
            }))}
            // ⚠️ 중요: onOpenGenerate는 상황별 이미지 탭에서만 외부로 제어한다.
            // - 기본(프로필/대표이미지/기타)에서는 "그리드 내부 생성 아이콘"을 노출하지 않는다.
            onToggleExistingPublic={(index) => {
              setFormData((prev) => {
                const arr = Array.isArray(prev?.media_settings?.image_descriptions)
                  ? [...prev.media_settings.image_descriptions]
                  : [];
                if (index < 0 || index >= arr.length) return prev;
                const cur = arr[index] || {};
                // ✅ 기본값은 공개(true). 클릭 시 토글한다.
                const isPublic = cur?.is_public !== false;
                arr[index] = { ...cur, is_public: !isPublic ? true : false };
                return { ...prev, media_settings: { ...prev.media_settings, image_descriptions: arr } };
              });
            }}
            getCopyText={(url) => {
              /**
               * ✅ 이미지 코드 복사(요구사항)
               *
               * 의도/원리:
               * - 채팅에서 `[[img:<id>]]` 또는 `{{img:<id>}}`로 "이미지 고유 id" 기반 인라인 삽입을 지원한다.
               * - 여기서는 통일된 포맷으로 `[[img:<id>]]`만 복사한다.
               */
              try {
                const id = imageCodeIdFromUrl(url);
                if (!id) return '';
                return `[[img:${id}]]`;
              } catch (_) {
                return '';
              }
            }}
            newFiles={formData.media_settings.newly_added_files}
            onAddFiles={(files) => setFormData(prev => ({
              ...prev,
              media_settings: { ...prev.media_settings, newly_added_files: [...prev.media_settings.newly_added_files, ...files] }
            }))}
            onRemoveExisting={(index) => handleRemoveExistingImage(index)}
            onRemoveNew={(index) => handleRemoveNewFile(index)}
            onReorder={({ from, to, isNew }) => {
              if (isNew) {
                setFormData(prev => {
                  const arr = [...prev.media_settings.newly_added_files];
                  const item = arr.splice(from, 1)[0];
                  arr.splice(Math.min(arr.length, Math.max(0, to)), 0, item);
                  return { ...prev, media_settings: { ...prev.media_settings, newly_added_files: arr } };
                });
              } else {
                setFormData(prev => {
                  const arr = [...prev.media_settings.image_descriptions];
                  const item = arr.splice(from, 1)[0];
                  arr.splice(Math.min(arr.length, Math.max(0, to)), 0, item);
                  return { ...prev, media_settings: { ...prev.media_settings, image_descriptions: arr } };
                });
              }
            }}
            onUpload={async (files, onProgress) => {
              const res = await filesAPI.uploadImages(files, onProgress);
              const urls = Array.isArray(res.data) ? res.data : [res.data];
              setFormData(prev => ({
                ...prev,
                media_settings: {
                  ...prev.media_settings,
                  image_descriptions: [
                    ...prev.media_settings.image_descriptions,
                    ...urls.map(u => ({ url: u, description: '', is_public: true })),
                  ],
                  newly_added_files: [],
                }
              }));
              return urls;
            }}
            onImageClick={(url) => {
              setImageViewerSrc(url);
              setImageViewerOpen(true);
            }}
          />
        </ErrorBoundary>
        {fieldErrors['media_settings.image_descriptions'] && (
          <p className="text-xs text-red-500 mt-2">{fieldErrors['media_settings.image_descriptions']}</p>
        )}
      </Card>

      {/* 🎯 이미지 키워드 트리거 설정 */}
      {formData.media_settings.image_descriptions.length > 0 && (
        <Card className="mt-6 border border-gray-200/70 dark:border-gray-700/80 bg-white dark:bg-gray-900/60 shadow-sm text-gray-900 dark:text-gray-100">
          <CardHeader className="pb-2 space-y-2">
            <div className="flex items-center gap-2">
              <div className="inline-flex items-center justify-center rounded-full bg-purple-600/15 text-purple-700 dark:text-purple-200 p-2">
                <Sparkles className="w-4 h-4" />
              </div>
              <CardTitle className="text-base font-semibold text-gray-900 dark:text-gray-100">이미지 키워드 트리거</CardTitle>
            </div>
            <CardDescription className="text-sm text-gray-600 dark:text-gray-400">
              이미지마다 감정/상황 키워드를 지정하면, 대화 중 해당 단어가 나오면 자동으로 이미지가 전환됩니다.
            </CardDescription>
            <p className="text-xs text-gray-500 dark:text-gray-500">
              쉼표로 구분해 간결하게 작성하세요. 예: 웃음, 기쁨, 행복
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            {formData.media_settings.image_descriptions.map((img, index) => {
              const displayUrl = resolveImageUrl(img?.url);
              return (
                <div
                  key={`keyword-${img.url}-${index}`}
                  className="flex gap-4 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50/80 dark:bg-gray-800/60 p-3"
                >
                  <div className="relative w-24 h-24 flex-shrink-0">
                    {displayUrl ? (
                      <img
                        src={displayUrl}
                        alt={`이미지 ${index + 1}`}
                        className="w-full h-full object-cover rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-100 dark:bg-gray-800"
                        onError={(e) => {
                          e.target.style.display = 'none';
                          e.target.parentElement.classList.add('bg-gray-100', 'flex', 'items-center', 'justify-center');
                          e.target.parentElement.innerHTML = '<span class="text-xs text-gray-400">이미지 로드 실패</span>';
                        }}
                      />
                    ) : (
                      <div className="w-full h-full rounded-lg border border-dashed border-gray-300 dark:border-gray-700 flex items-center justify-center text-xs text-gray-400">
                        이미지 없음
                      </div>
                    )}
                    <span className="absolute -top-2 -left-2 px-2 py-0.5 rounded-full text-[11px] font-medium bg-white shadow border border-gray-200 dark:bg-gray-900 dark:border-gray-700 text-gray-700 dark:text-gray-200">
                      #{index + 1}
                    </span>
                  </div>
                  <div className="flex-1">
                    <Label className="text-xs text-gray-500 dark:text-gray-400">키워드 (쉼표로 구분)</Label>
                    <Input
                      value={(img.keywords || []).join(', ')}
                      onChange={(e) => {
                        const keywords = String(e.target.value || '')
                          .split(/[,，、\n]+/g)
                          .map((k) => k.trim())
                          .filter(Boolean)
                          .slice(0, 20);
                        setFormData((prev) => {
                          const updated = [...prev.media_settings.image_descriptions];
                          updated[index] = { ...updated[index], keywords };
                          return { ...prev, media_settings: { ...prev.media_settings, image_descriptions: updated } };
                        });
                      }}
                      placeholder="예: 웃음, 기쁨, 행복"
                      className="mt-1 text-sm bg-white dark:bg-gray-900 border-gray-300 dark:border-gray-700 text-gray-900 dark:text-gray-100 placeholder:text-gray-400"
                    />
                    <p className="mt-1 text-[11px] text-gray-400">캐릭터 응답에 키워드가 포함되면 자동으로 캐릭터가 이 이미지를 노출합니다.</p>
                    <div className="mt-2 flex items-center justify-end gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-7 px-2 text-xs border-gray-300 dark:border-gray-600"
                        onClick={() => insertKeywordToken(index, '{{character}}')}
                      >
                        캐릭터+
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-7 px-2 text-xs border-gray-300 dark:border-gray-600"
                        onClick={() => insertKeywordToken(index, '{{user}}')}
                      >
                        사용자+
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}
    </>
  );

  const renderPromptWizardTab = () => (
    <div className="relative p-4 space-y-4">
      {/* ✅ 토큰 안내(i): 프롬프트/비밀정보에서 {{char}}/{{user}} 지원 */}
      {/* ✅ 프롬프트 탭: 토큰 안내(i)는 우상단 "전역 도움말"로 유지 (프롬프트 타입 변경과 맥락이 다름)
          - 프롬프트 타입 변경 버튼과 겹치지 않도록 '더 위'로 올려 배치한다. */}
      <WizardTokenHelpIcon className="-top-2 right-3" />
      {/* ✅ 프롬프트 타입은 프로필 단계에서 선택(요구사항) */}
      {(() => {
        const t = String(formData?.basic_info?.character_type || 'roleplay').trim();
        const label = (t === 'simulator' ? '시뮬레이션' : (t === 'custom' ? '커스텀' : '롤플레잉'));
        const canAuto = (t === 'roleplay' || t === 'simulator');
        return (
          // ✅ 우상단 토큰 안내(i)가 absolute라, 우측 끝 버튼(프롬프트 타입 변경)과 겹칠 수 있다.
          // - 요구사항: "변경 버튼을 안쪽으로 당기기" → 안내 영역에 우측 패딩을 확보한다.
          <div className="text-gray-100 pr-12">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-gray-200 truncate">
                  {label} <span className="text-gray-500 font-medium">방식으로 선택하셨습니다.</span>
                </div>
                <div className="mt-1 text-xs text-gray-500">
                  그에 맞게 프롬프트를 입력해주세요{canAuto ? ' (자동생성도 프로필 정보를 반영해 생성됩니다).' : '.'}
                </div>
              </div>
              <button
                type="button"
                className="shrink-0 inline-flex items-center justify-center h-9 w-9 rounded-lg bg-white/10 text-white hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500/30"
                aria-label="프롬프트 타입 변경"
                title="프롬프트 타입 변경"
                onClick={() => {
                  try { setNormalWizardStep('profile'); } catch (_) {}
                  try { setPromptTypeHighlight(true); } catch (_) {}
                }}
              >
                <ArrowLeftRight className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          </div>
        );
      })()}

      <div>
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="world_setting">
            프롬프트 <span className="text-red-400 ml-1">*</span>
          </Label>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleApplyPromptStatsToStats}
              disabled={quickPromptGenLoading}
              className="h-9 px-3 rounded-lg bg-white/10 text-white text-sm font-semibold hover:bg-white/15 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
              aria-label="스탯에 적용"
              title="프롬프트의 스탯 블록을 스탯 탭에 덮어쓰기"
            >
              스탯에 적용
            </button>
            {(String(formData?.basic_info?.character_type || 'roleplay') === 'simulator' || String(formData?.basic_info?.character_type || 'roleplay') === 'roleplay') && (
              <button
                type="button"
                onClick={handleAutoGeneratePrompt}
                disabled={quickPromptGenLoading}
                className="h-9 px-3 rounded-lg bg-white/10 text-white text-sm font-semibold hover:bg-white/15 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
                aria-label="프롬프트 자동 생성"
                title="프롬프트 자동 생성"
              >
                {quickPromptGenLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  '자동 생성'
                )}
              </button>
            )}
          </div>
        </div>
        <div className="mt-2 text-xs text-gray-500">
          스탯 탭에서 수정했다면 <span className="text-gray-200 font-semibold">스탯 탭의 프롬프트 동기화</span>로 반영하고,
          프롬프트에서 스탯 블록을 수정했다면 <span className="text-gray-200 font-semibold">스탯에 적용</span>으로 스탯 탭에 반영하세요.
        </div>
        {(() => {
          // ✅ 프롬프트 탭 안내(요구사항): 스탯 수정으로 동기화가 필요할 때 노출
          try {
            const ss = (formData?.basic_info?.start_sets && typeof formData.basic_info.start_sets === 'object')
              ? formData.basic_info.start_sets
              : null;
            const items = Array.isArray(ss?.items) ? ss.items : [];
            const sel = String(ss?.selectedId || '').trim() || String(items?.[0]?.id || '').trim();
            const isDirty = !!(sel && statsDirtyByStartSetId && statsDirtyByStartSetId[sel]);
            if (!isDirty) return null;
            return (
              <div className="mt-1 text-xs text-amber-300/90">
                스탯 수정으로 동기화가 필요합니다.
              </div>
            );
          } catch (_) {
            return null;
          }
        })()}
        <div className="relative mt-3">
        {quickPromptGenLoading ? (
          <>
            <Textarea
              id="world_setting"
              data-autogrow="1"
              data-autogrow-max="520"
              onInput={handleAutoGrowTextarea}
              className="resize-none pr-16 pb-6 text-transparent caret-transparent"
              value=""
              onChange={() => {}}
              placeholder=""
              rows={8}
              disabled
              readOnly
              aria-busy="true"
            />
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
              <div className="relative flex flex-col items-center gap-3">
                {/* ✅ 스피너와 X 아이콘을 함께 배치 */}
                <div className="relative flex items-center justify-center">
                  <Loader2 className="h-6 w-6 animate-spin text-gray-200" aria-hidden="true" />
                  <button
                    type="button"
                    onClick={handleCancelPromptGeneration}
                    className="absolute -top-1 -right-1 p-1 rounded-full bg-red-500/20 hover:bg-red-500/30 text-red-300 hover:text-red-200 transition-colors pointer-events-auto z-10"
                    aria-label="자동 생성 취소"
                    title="자동 생성 취소"
                  >
                    <X className="h-3 w-3" aria-hidden="true" />
                  </button>
                </div>
                {Array.isArray(quickPromptGenSteps) && quickPromptGenSteps.length > 0 ? (
                  <span className="text-sm text-gray-300 font-medium pointer-events-none">{quickPromptGenSteps.join(', ')}</span>
                ) : null}
              </div>
            </div>
          </>
        ) : (
          <>
            <Textarea
              id="world_setting"
              data-autogrow="1"
              data-autogrow-max="520"
              onInput={handleAutoGrowTextarea}
              className="resize-none pr-16 pb-6"
              value={formData.basic_info.world_setting}
              onChange={(e) => {
                /**
                 * ✅ 스탯 블록 보호(요구사항)
                 *
                 * 동작:
                 * - 프롬프트 내부의 관리 블록(<!-- CC_STATS_START/END -->)을 사용자가 지우거나 수정하려고 하면
                 *   즉시 적용하지 않고 확인/취소 모달을 띄운다.
                 * - 블록 밖의 일반 텍스트 편집은 그대로 허용한다.
                 */
                try {
                  const prevText = String(formData?.basic_info?.world_setting || '');
                  const nextText = String(e?.target?.value || '');
                  const START = '<!-- CC_STATS_START -->';
                  const END = '<!-- CC_STATS_END -->';

                  const prevS = prevText.indexOf(START);
                  const prevE = prevText.indexOf(END);
                  const prevHas = prevS >= 0 && prevE > prevS;
                  if (!prevHas) {
                    updateFormData('basic_info', 'world_setting', nextText);
                    return;
                  }

                  const nextS = nextText.indexOf(START);
                  const nextE = nextText.indexOf(END);
                  const nextHas = nextS >= 0 && nextE > nextS;

                  // 1) 블록 자체가 사라지거나(마커 손상 포함) → 삭제 경고
                  if (!nextHas) {
                    // ✅ 최초 1회만 경고(이후엔 방해하지 않고 편집 허용)
                    if (!promptStatsBlockGuardShownOnceRef.current) {
                      promptStatsBlockGuardShownOnceRef.current = true;
                      setPromptStatsBlockGuardMode('delete');
                      setPromptStatsBlockGuardPendingText(nextText);
                      setPromptStatsBlockGuardOpen(true);
                      return;
                    }
                    updateFormData('basic_info', 'world_setting', nextText);
                    return;
                  }

                  // 2) 블록이 남아있지만 블록 내용이 바뀜 → 수정 경고
                  const prevBlock = prevText.slice(prevS, prevE + END.length);
                  const nextBlock = nextText.slice(nextS, nextE + END.length);
                  if (prevBlock !== nextBlock) {
                    // ✅ 최초 1회만 경고(이후엔 방해하지 않고 편집 허용)
                    if (!promptStatsBlockGuardShownOnceRef.current) {
                      promptStatsBlockGuardShownOnceRef.current = true;
                      setPromptStatsBlockGuardMode('edit');
                      setPromptStatsBlockGuardPendingText(nextText);
                      setPromptStatsBlockGuardOpen(true);
                      return;
                    }
                    updateFormData('basic_info', 'world_setting', nextText);
                    return;
                  }

                  // 3) 블록 외부 변경만 → 정상 반영
                  updateFormData('basic_info', 'world_setting', nextText);
                } catch (err) {
                  try { console.error('[CreateCharacterPage] world_setting onChange guard failed:', err); } catch (_) {}
                  try { updateFormData('basic_info', 'world_setting', String(e?.target?.value || '')); } catch (_) {}
                }
              }}
              placeholder="세계관/관계/규칙/말투 지시 등을 포함해 프롬프트를 작성하세요."
              rows={8}
              required={!isEditMode}
            />
            <CharLimitCounter value={formData.basic_info.world_setting} max={6000} />
          </>
        )}
        </div>
        {String(formData?.basic_info?.world_setting || '').length > 6000 ? (
          <p className="text-xs text-rose-400 mt-1">최대 6000자까지 입력할 수 있어요.</p>
        ) : null}
        {fieldErrors['basic_info.world_setting'] && (
          <p className="text-xs text-red-500 mt-2">{fieldErrors['basic_info.world_setting']}</p>
        )}
      </div>

      <div>
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="character_secret_info">비밀정보</Label>
          <div className="flex items-center gap-2">
            <Switch
              id="secret_info_toggle"
              checked={isSecretInfoEnabled}
              onCheckedChange={(checked) => setIsSecretInfoEnabled(!!checked)}
            />
          </div>
        </div>

        {isSecretInfoEnabled ? (
          <>
            <div className="relative mt-3">
              {/* ✅ 요구사항: 비밀정보 자동생성 중 입력박스 스피너(오버레이) */}
              {quickSecretGenLoading ? (
                <>
                  <Textarea
                    id="character_secret_info"
                    data-autogrow="1"
                    data-autogrow-max="320"
                    onInput={handleAutoGrowTextarea}
                    className="resize-none pr-16 pb-6 opacity-60"
                    value={formData?.basic_info?.introduction_scenes?.[0]?.secret || ''}
                    onChange={() => {}}
                    placeholder=""
                    rows={4}
                    disabled
                    readOnly
                    aria-busy="true"
                  />
                  <div className="absolute inset-0 flex items-center justify-center rounded-md bg-black/20 cursor-wait">
                    <Loader2 className="h-6 w-6 animate-spin text-gray-200" aria-hidden="true" />
                  </div>
                </>
              ) : (
                <>
                  <Textarea
                    id="character_secret_info"
                    data-autogrow="1"
                    data-autogrow-max="320"
                    onInput={handleAutoGrowTextarea}
                    className="resize-none pr-16 pb-6"
                    value={formData?.basic_info?.introduction_scenes?.[0]?.secret || ''}
                    onChange={(e) => updateCharacterSecretInfo(e.target.value)}
                    placeholder="유저에게는 노출되지 않는 설정(금기/약점/숨겨진 관계/진짜 목적 등)"
                    rows={4}
                  />
                  <CharLimitCounter value={formData?.basic_info?.introduction_scenes?.[0]?.secret || ''} max={1000} />
                </>
              )}
            </div>
            {String(formData?.basic_info?.introduction_scenes?.[0]?.secret || '').length > 1000 ? (
              <p className="text-xs text-rose-400 mt-1">최대 1000자까지 입력할 수 있어요.</p>
            ) : null}
            <div className="mt-3 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={handleAutoGenerateSecretInfo}
                disabled={quickSecretGenLoading || !String(formData?.basic_info?.world_setting || '').trim()}
                className="h-9 px-3 rounded-lg bg-white/10 text-white text-sm font-semibold hover:bg-white/15 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
                aria-label="비밀정보 자동 생성"
                title="비밀정보 자동 생성"
              >
                {quickSecretGenLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  '자동 생성'
                )}
              </button>
            </div>
          </>
        ) : (
          <div className="mt-2 text-xs text-gray-500" />
        )}
      </div>
    </div>
  );

  const renderImageWizardTab = () => (
    <div className="p-4 space-y-4">
      <div className="space-y-3">
        <div className="text-sm font-semibold text-gray-200">
          이미지 스타일 <span className="text-red-400">*</span>
        </div>
        <div className="grid grid-cols-4 gap-2 rounded-xl border border-gray-800 bg-gray-950/40 p-2">
          {REQUIRED_STYLE_CHOICES.map((opt, idx) => {
            const selected = Array.isArray(selectedTagSlugs) && selectedTagSlugs.includes(opt.slug);
            return (
              <button
                key={opt.slug}
                type="button"
                onClick={() => toggleExclusiveTag(opt.slug, REQUIRED_STYLE_SLUGS)}
                aria-pressed={selected}
                className={[
                  'h-10 rounded-lg px-2 text-xs sm:text-sm font-semibold transition-all',
                  'outline-none focus-visible:ring-2 focus-visible:ring-purple-500/30',
                  selected
                    ? 'bg-gradient-to-br from-purple-600 to-indigo-600 text-white shadow-sm ring-1 ring-purple-400/40'
                    : 'bg-gray-900/30 text-gray-200 hover:bg-gray-800/60 ring-1 ring-transparent',
                ].join(' ')}
              >
                <span className="block w-full truncate">{opt.label}</span>
              </button>
            );
          })}
        </div>
        {fieldErrors['basic_info.visual_style'] && (
          <p className="text-xs text-red-400">{fieldErrors['basic_info.visual_style']}</p>
        )}
      </div>

      {/* ✅ 경쟁사 UX: 기본 이미지(대표이미지) 고정 노출 */}
      {(() => {
        /**
         * 기본 이미지(고정) 정책:
         * - SSOT는 profile 단계에서 입력되는 media_settings.avatar_url 이다.
         * - 상황별 이미지(image_descriptions)는 "추가 이미지"만 관리한다(중복/충돌 방지).
         * - 따라서 여기서는 avatar_url을 별도 카드로 노출하고, 삭제/변경 UI는 제공하지 않는다.
         */
        try {
          const avatarRaw = String(formData?.media_settings?.avatar_url || '').trim();
          const firstImg = Array.isArray(formData?.media_settings?.image_descriptions)
            ? String(formData.media_settings.image_descriptions.find((x) => String(x?.url || '').trim())?.url || '').trim()
            : '';
          const previewUrl = avatarRaw || firstImg;
          if (!previewUrl) {
            return (
              <div className="rounded-xl border border-gray-800 bg-gray-900/30 p-4">
                <div className="text-sm font-semibold text-gray-200">기본 이미지(고정)</div>
                <div className="mt-1 text-xs text-gray-400">
                  프로필에서 대표 이미지를 등록하면, 이 탭에서 “기본 이미지”로 고정 표시됩니다.
                </div>
              </div>
            );
          }
          return (
            <div className="rounded-xl border border-gray-800 bg-gray-900/30 p-4">
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-semibold text-gray-200">기본 이미지(대표 이미지)</div>
                <span className="text-[11px] font-semibold rounded-full bg-purple-600/20 text-purple-200 px-2 py-0.5">
                  고정
                </span>
              </div>
              <div className="mt-3 flex items-center gap-3">
                <div className="w-[84px] h-[84px] rounded-lg overflow-hidden border border-gray-700 bg-gray-950/40">
                  <img
                    src={resolveImageUrl(previewUrl)}
                    alt=""
                    className="w-full h-full object-cover cursor-zoom-in"
                    loading="lazy"
                    onClick={() => {
                      try {
                        const src = resolveImageUrl(previewUrl);
                        if (!src) return;
                        setImageViewerSrc(src);
                        setImageViewerOpen(true);
                      } catch (_) {}
                    }}
                  />
                </div>
                <div className="min-w-0">
                  <div className="text-xs text-gray-400">
                    이 이미지는 프로필에서 등록한 대표 이미지로, 상황별 이미지 목록의 “기본 이미지”로 사용됩니다.
                  </div>
                  <div className="mt-1 text-[11px] text-gray-500">
                    추가 상황별 이미지는 아래에서 업로드/정렬할 수 있어요.
                  </div>
                </div>
              </div>
            </div>
          );
        } catch (_) {
          return null;
        }
      })()}

      {/* ✅ 기존 이미지 업로드 박스/트리거를 그대로 재사용 */}
      {renderExistingImageUploadAndTriggers({
        // ✅ 상황별이미지(위저드) 전용: 3열 정사각 그리드 + 50개 단위 무한스크롤 + 최대 101장
        // - 다른 페이지/탭은 기존 UI를 유지한다.
        hideGenerateButton: true,
        gallery: {
          maxFiles: 101,
          gridColumns: 3,
          enableInfiniteScroll: true,
          pageSize: 50,
          // ✅ 상황별 이미지 탭 전용 UX: 박스 제거 + 그리드 내부 업로드/생성 슬롯
          layoutVariant: 'grid_only',
          inlineAddSlotVariant: 'upload_generate',
          onOpenGenerate: () => { try { setImgModalOpen(true); } catch (_) {} },
        },
      })}
    </div>
  );

  const renderOptionsWizardTab = () => (
    <div className="p-4 space-y-4">
      <div>
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="user_display_description">
            크리에이터 코멘트 <span className="text-xs text-gray-500 ml-2">(선택)</span>
          </Label>
          <div className="flex items-center gap-2">
            <Switch
              id="creator_comment_toggle_wizard"
              checked={!!formData?.basic_info?.use_custom_description}
              onCheckedChange={(checked) => {
                try {
                  updateFormData('basic_info', 'use_custom_description', !!checked);
                } catch (e) {
                  try { console.error('[CreateCharacterPage] creator comment toggle(wizard) failed:', e); } catch (_) {}
                }
              }}
              aria-label="크리에이터 코멘트 사용"
            />
          </div>
        </div>
        {!!formData?.basic_info?.use_custom_description ? (
          <>
            <div className="relative mt-3">
              <Textarea
                id="user_display_description"
                data-autogrow="1"
                onInput={handleAutoGrowTextarea}
                className="resize-none overflow-hidden bg-gray-950/30 border-gray-700 text-gray-100 placeholder:text-gray-500 pr-16 pb-6"
                value={formData.basic_info.user_display_description}
                onChange={(e) => updateFormData('basic_info', 'user_display_description', e.target.value)}
                placeholder="유저에게 보여줄 크리에이터 코멘트를 작성하세요"
                rows={4}
              />
              <CharLimitCounter value={formData.basic_info.user_display_description} max={1000} />
            </div>
            {String(formData?.basic_info?.user_display_description || '').length > 1000 ? (
              <p className="text-xs text-rose-400 mt-1">최대 1000자까지 입력할 수 있어요.</p>
            ) : null}
            {fieldErrors['basic_info.user_display_description'] && (
              <p className="text-xs text-red-500 mt-2">{fieldErrors['basic_info.user_display_description']}</p>
            )}
          </>
        ) : (
          <div className="mt-2 text-xs text-gray-500">원하면 켜고 작성할 수 있어요.</div>
        )}
      </div>

      {/* 공개/비공개 + 태그 */}
      <div className="rounded-xl border border-gray-800 bg-gray-900/30">
        {renderPublishTab()}
      </div>
    </div>
  );

  const renderDetailsWizardTab = () => {
    // 프롬프트 단계에서 선택한 타입
    const charType = String(formData?.basic_info?.character_type || 'roleplay').trim();
    // 커스텀 모드일 때 롤플/시뮬 적용 토글 상태
    const customModeOverride = detailModeOverrides?.['_custom_toggle'] ?? null;
    const effectiveMode = charType === 'custom'
      ? (customModeOverride ?? 'roleplay')
      : charType === 'simulator' ? 'simulator' : 'roleplay';
    const copy = effectiveMode === 'simulator' ? detailFieldCopy.simulator : detailFieldCopy.roleplay;

    // 커스텀 모드 토글 핸들러
    const handleCustomModeToggle = () => {
      setDetailModeOverrides((prev) => ({
        ...(prev || {}),
        _custom_toggle: (prev?._custom_toggle ?? 'roleplay') === 'roleplay' ? 'simulator' : 'roleplay',
      }));
    };

    return (
      <div className="relative p-4 space-y-4">
        {/* ✅ 디테일 자동생성 중 오버레이 스피너 */}
        {quickDetailGenLoading ? (
          <div className="absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-black/25 cursor-wait">
            <div className="relative flex items-center justify-center">
              <Loader2 className="h-7 w-7 animate-spin text-gray-200" aria-hidden="true" />
              <button
                type="button"
                onClick={handleCancelDetailGeneration}
                className="absolute -top-1 -right-4 p-1 rounded-full bg-red-500/20 hover:bg-red-500/30 text-red-300 hover:text-red-200 transition-colors pointer-events-auto z-10"
                aria-label="디테일 자동 생성 취소"
                title="디테일 자동 생성 취소"
              >
                <X className="h-3 w-3" aria-hidden="true" />
              </button>
            </div>
          </div>
        ) : null}
        {/* ✅ 상단: 타입 안내 문구 + 토큰 안내(i) 동일 선상 */}
        <div className="flex items-center justify-between">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-3">
              <span className="text-sm">
                {charType === 'roleplay' && <><span className="text-white font-semibold">롤플레잉</span><span className="text-gray-400"> 방식으로 선택하셨습니다.</span></>}
                {charType === 'simulator' && <><span className="text-white font-semibold">시뮬레이터</span><span className="text-gray-400"> 방식으로 선택하셨습니다.</span></>}
                {charType === 'custom' && <><span className="text-white font-semibold">커스텀</span><span className="text-gray-400"> 방식으로 선택하셨습니다.</span></>}
              </span>
              {charType === 'custom' && (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-400 select-none">
                    {effectiveMode === 'simulator' ? '시뮬모드' : '롤플모드'} 적용
                  </span>
                  <Switch
                    id="detail_wizard_custom_mode_toggle"
                    checked={effectiveMode === 'simulator'}
                    onCheckedChange={handleCustomModeToggle}
                  />
                </div>
              )}
            </div>
            <span className="text-xs text-gray-500">롤플레잉/시뮬레이션/커스텀 타입 선택에 따라 디테일 항목이 변경됩니다.</span>
          </div>
          <WizardTokenHelpIcon inline />
        </div>

        <div>
          {/* 성격/의사결정규칙 */}
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="personality">{copy.personality.label}</Label>
          </div>
          <div className="relative mt-3">
            <Textarea
              id="personality"
              className="pr-16 pb-6"
              value={formData.basic_info.personality}
              onChange={(e) => updateFormData('basic_info', 'personality', e.target.value)}
              onBlur={refreshChatPreviewSnapshot}
              placeholder={copy.personality.placeholder}
              rows={4}
            />
            <CharLimitCounter value={formData.basic_info.personality} max={300} />
          </div>
          {String(formData?.basic_info?.personality || '').length > 300 ? (
            <p className="text-xs text-rose-400 mt-1">최대 300자까지 입력할 수 있어요.</p>
          ) : null}
        </div>

        {/* 말투/출력포맷규칙 */}
        <div>
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="speech_style">{copy.speech_style.label}</Label>
          </div>
          <div className="relative mt-3">
            <Textarea
              id="speech_style"
              className="pr-16 pb-6"
              value={formData.basic_info.speech_style}
              onChange={(e) => updateFormData('basic_info', 'speech_style', e.target.value)}
              onBlur={refreshChatPreviewSnapshot}
              placeholder={copy.speech_style.placeholder}
              rows={2}
            />
            <CharLimitCounter value={formData.basic_info.speech_style} max={300} />
          </div>
          {String(formData?.basic_info?.speech_style || '').length > 300 ? (
            <p className="text-xs text-rose-400 mt-1">최대 300자까지 입력할 수 있어요.</p>
          ) : null}
        </div>

        {/* 관심사/이벤트훅, 좋아하는것/보상트리거, 싫어하는것/페널티트리거 */}
        <div className="space-y-6">
          {[
            { key: 'interests' },
            { key: 'likes' },
            { key: 'dislikes' },
          ].map((cfg) => {
            const key = cfg.key;
            const fieldCopy = copy[key];
            const chips = Array.isArray(detailPrefs?.[key]) ? detailPrefs[key] : [];
            const inputVal = String(detailChipInputs?.[key] || '');
            const addChip = () => {
              const raw = String(inputVal || '').trim();
              if (!raw) return;
              const parts = raw.split(/[,|/]+/).map((p) => p.trim()).filter(Boolean);
              setDetailPrefs((prev) => {
                const cur = Array.isArray(prev?.[key]) ? prev[key] : [];
                const next = [...cur];
                for (const p of parts) {
                  const t = p.replace(/\s+/g, ' ').trim();
                  if (!t) continue;
                  if (!next.includes(t)) next.push(t);
                  if (next.length >= 12) break;
                }
                return { ...(prev || {}), [key]: next };
              });
              setDetailChipInputs((prev) => ({ ...(prev || {}), [key]: '' }));
            };
            const removeChip = (chip) => {
              const c = String(chip || '').trim();
              if (!c) return;
              setDetailPrefs((prev) => {
                const cur = Array.isArray(prev?.[key]) ? prev[key] : [];
                return { ...(prev || {}), [key]: cur.filter((x) => String(x) !== c) };
              });
            };
            return (
              <div key={key} className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-semibold text-gray-200">{fieldCopy?.label || key}</div>
                </div>
                <div className="flex items-center gap-2">
                  <Input
                    value={inputVal}
                    onChange={(e) => setDetailChipInputs((prev) => ({ ...(prev || {}), [key]: e.target.value }))}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        addChip();
                      }
                    }}
                    placeholder={fieldCopy?.placeholder || ''}
                    className="flex-1 min-w-0 bg-gray-900/30 border-gray-700 text-gray-100"
                  />
                  <button
                    type="button"
                    onClick={addChip}
                    className="shrink-0 h-9 px-4 min-w-[64px] rounded-lg bg-purple-600 text-white text-sm font-semibold hover:bg-purple-700 whitespace-nowrap"
                  >
                    추가
                  </button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {chips.map((chip) => (
                    <span
                      key={`${key}:${chip}`}
                      className="inline-flex items-center gap-2 rounded-full bg-white/10 text-gray-100 text-xs px-3 py-1"
                    >
                      <span className="truncate max-w-[180px]">{chip}</span>
                      <button
                        type="button"
                        onClick={() => removeChip(chip)}
                        className="text-gray-300 hover:text-white"
                        aria-label={`${fieldCopy?.label || key} 삭제`}
                        title={`${fieldCopy?.label || key} 삭제`}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              </div>
            );
          })}

          {/* ✅ 디테일 자동생성 버튼: 싫어하는 것 아래 우하단 (UI 일관성) */}
          <div className="flex justify-end pt-2">
            <button
              type="button"
              onClick={handleAutoGenerateDetail}
              disabled={quickDetailGenLoading}
              className="h-9 px-3 rounded-lg bg-white/10 text-white text-sm font-semibold hover:bg-white/15 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
              aria-label="디테일 자동 생성"
              title="성격/말투/관심사/좋아하는 것/싫어하는 것 자동 생성"
            >
              {quickDetailGenLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                '자동 생성'
              )}
            </button>
          </div>
        </div>

        {/* 예시대화 */}
        <div className="rounded-xl border border-gray-800 bg-gray-900/30">
          {renderDialoguesTab()}
        </div>
      </div>
    );
  };

  const renderDialoguesTab = () => {
    /**
     * ✅ 예시대화 탭 UI(요구사항)
     *
     * 의도/원리:
     * - 여러 개의 예시대화를 카드로 길게 나열하면 화면이 “따로 놀고” 복잡해진다.
     * - 오프닝처럼 탭(예시대화 1/2/…)으로 전환하면서 1개씩 편집하면 심플하고 깔끔하다.
     */
    const safeDialogues = Array.isArray(formData?.example_dialogues?.dialogues) ? formData.example_dialogues.dialogues : [];
    const activeIdx = (() => {
      const len = safeDialogues.length;
      if (len <= 0) return 0;
      const n = Number(activeExampleDialogueIdx);
      if (!Number.isFinite(n) || n < 0) return 0;
      if (n >= len) return len - 1;
      return n;
    })();
    const activeDialogue = safeDialogues[activeIdx] || { user_message: '', character_response: '' };

    return (
      <div className="space-y-4 p-6">
        <div className="flex items-center gap-2 overflow-x-auto scrollbar-hide">
          {safeDialogues.map((_, idx) => {
            const isActive = idx === activeIdx;
            return (
              <button
                key={`dlg-tab-${idx}`}
                type="button"
                onClick={() => setActiveExampleDialogueIdx(idx)}
                className={[
                  'relative inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm whitespace-nowrap',
                  'bg-black/20 transition-colors',
                  isActive ? 'border-purple-500 text-white' : 'border-white/10 text-white/80 hover:border-white/20 hover:text-white',
                ].join(' ')}
                title={`예시대화 ${idx + 1}`}
              >
                <span className="max-w-[160px] truncate">{`예시대화 ${idx + 1}`}</span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    removeExampleDialogue(idx);
                  }}
                  className="ml-1 inline-flex size-5 items-center justify-center rounded hover:bg-white/10 text-white/70 hover:text-white"
                  aria-label={`예시대화 ${idx + 1} 삭제`}
                  title="삭제"
                >
                  ×
                </button>
              </button>
            );
          })}

          <button
            type="button"
            onClick={addExampleDialogue}
            className="inline-flex items-center rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-white/80 hover:border-white/20 hover:text-white whitespace-nowrap"
            title="예시대화 추가"
          >
            예시대화 추가 +
          </button>
        </div>

        {useNormalCreateWizard && (
          <div className="text-xs text-gray-400">
            예시대화를 추가하면 캐릭터의 말투/대화 흐름이 더 정확해집니다.
          </div>
        )}

        {safeDialogues.length === 0 ? (
          <div className="rounded-xl border border-white/10 bg-black/20 p-4">
            <div className="text-sm text-white/80">예시대화가 없습니다. 탭에서 “예시대화 추가 +”를 눌러 추가하세요.</div>
          </div>
        ) : (
          <div className="rounded-xl border border-white/10 bg-black/20 p-4 space-y-4">
            <div>
              <Label className="text-white">사용자 메시지</Label>
              <div className="relative mt-2">
                <Textarea
                  id={`dlg_user_${activeIdx}`}
                  className="bg-gray-950/40 border-white/10 text-white placeholder:text-gray-500 pr-16 pb-6"
                  value={String(activeDialogue?.user_message || '')}
                  onChange={(e) => updateExampleDialogue(activeIdx, 'user_message', e.target.value)}
                  placeholder="사용자가 입력할 만한 메시지를 작성하세요"
                  rows={2}
                />
                <CharLimitCounter value={String(activeDialogue?.user_message || '')} max={500} />
              </div>
              {String(activeDialogue?.user_message || '').length > 500 ? (
                <p className="mt-1 text-xs text-rose-400">최대 500자까지 입력할 수 있어요.</p>
              ) : null}
              <div className="flex items-center gap-2 mt-2">
                <span className="text-xs text-gray-400">토큰 삽입:</span>
                <Button type="button" variant="secondary" size="sm" title="{{character}} 삽입" onClick={() => insertDialogueToken(activeIdx, 'user_message', TOKEN_CHARACTER)}>캐릭터</Button>
                <Button type="button" variant="secondary" size="sm" title="{{user}} 삽입" onClick={() => insertDialogueToken(activeIdx, 'user_message', TOKEN_USER)}>유저</Button>
              </div>
            </div>

            <div>
              <Label className="text-white">캐릭터 응답</Label>
              <div className="relative mt-2">
                <Textarea
                  id={`dlg_char_${activeIdx}`}
                  className="bg-gray-950/40 border-white/10 text-white placeholder:text-gray-500 pr-16 pb-6"
                  value={String(activeDialogue?.character_response || '')}
                  onChange={(e) => updateExampleDialogue(activeIdx, 'character_response', e.target.value)}
                  placeholder="캐릭터가 응답할 내용을 작성하세요"
                  rows={3}
                />
                <CharLimitCounter value={String(activeDialogue?.character_response || '')} max={1000} />
              </div>
              {String(activeDialogue?.character_response || '').length > 1000 ? (
                <p className="mt-1 text-xs text-rose-400">최대 1000자까지 입력할 수 있어요.</p>
              ) : null}
              <div className="flex items-center gap-2 mt-2">
                <span className="text-xs text-gray-400">토큰 삽입:</span>
                <Button type="button" variant="secondary" size="sm" title="{{character}} 삽입" onClick={() => insertDialogueToken(activeIdx, 'character_response', TOKEN_CHARACTER)}>캐릭터</Button>
                <Button type="button" variant="secondary" size="sm" title="{{user}} 삽입" onClick={() => insertDialogueToken(activeIdx, 'character_response', TOKEN_USER)}>유저</Button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderAffinityTab = () => (
    <div className="space-y-6 p-6">
      <div className="flex items-center space-x-2">
        <Switch
          id="has_affinity_system"
          checked={formData.affinity_system.has_affinity_system}
          onCheckedChange={(checked) => updateFormData('affinity_system', 'has_affinity_system', checked)}
        />
        <Label htmlFor="has_affinity_system" className="text-lg font-semibold">
          캐릭터에 호감도 시스템을 설정할게요 (Beta)
        </Label>
        <Badge variant="secondary">Beta</Badge>
      </div>

      {formData.affinity_system.has_affinity_system && (
        <div className="space-y-6">
          <div>
            <Label htmlFor="affinity_rules">호감도 정의 및 증감 규칙</Label>
            <Textarea
              id="affinity_rules"
              data-autogrow="1"
              onInput={handleAutoGrowTextarea}
              className="mt-4 resize-none overflow-hidden"
              value={formData.affinity_system.affinity_rules}
              onChange={(e) => updateFormData('affinity_system', 'affinity_rules', e.target.value)}
              placeholder="값의 변화를 결정하는 논리를 입력합니다."
              rows={6}
              maxLength={2000}
            />
            {/* ✅ 복붙용 템플릿(예시): 사용자가 바로 응용할 수 있게 제공 */}
            <div className="mt-3 rounded-lg border border-gray-700/80 bg-gray-900/40 p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="text-xs text-gray-400">예시 템플릿(복붙해서 수정하세요)</div>
                <button
                  type="button"
                  className="text-xs text-gray-300 hover:text-white underline underline-offset-2"
                  onClick={async () => {
                    try {
                      if (!navigator?.clipboard?.writeText) {
                        dispatchToast('error', '복사 기능을 사용할 수 없습니다. 아래 텍스트를 드래그해서 복사해주세요.');
                        return;
                      }
                      await navigator.clipboard.writeText(AFFINITY_RULES_TEMPLATE);
                      dispatchToast('success', '호감도 템플릿을 클립보드에 복사했습니다.');
                    } catch (err) {
                      console.error('[affinity_rules] template copy failed:', err);
                      dispatchToast('error', '복사에 실패했습니다. 아래 텍스트를 드래그해서 복사해주세요.');
                    }
                  }}
                >
                  복사
                </button>
              </div>
              <pre className="mt-2 whitespace-pre-wrap text-xs text-gray-200 leading-relaxed select-text">
                {AFFINITY_RULES_TEMPLATE}
              </pre>
            </div>
          </div>

          <div>
            <h4 className="font-semibold mb-3">호감도 구간 설정</h4>
            <div className="space-y-3">
              {formData.affinity_system.affinity_stages.map((stage, index) => (
                <div key={index} className="flex items-center space-x-3 p-3 border rounded-lg">
                  <div className="flex items-center space-x-2">
                    <Input
                      type="number"
                      value={stage?.min_value ?? 0}
                      className="w-20 mt-4"
                      onChange={(e) => updateAffinityStage(index, 'min_value', e.target.value)}
                    />
                    <span>~</span>
                    <Input
                      type="number"
                      value={stage?.max_value ?? ''}
                      placeholder="∞"
                      className="w-20 mt-4"
                      onChange={(e) => updateAffinityStage(index, 'max_value', e.target.value)}
                    />
                  </div>
                  <Textarea
                    data-autogrow="1"
                    onInput={handleAutoGrowTextarea}
                    value={stage?.description ?? ''}
                    placeholder="호감도에 따라 캐릭터에게 줄 변화를 입력해보세요"
                    rows={1}
                    className="flex-1 mt-4 resize-none overflow-hidden"
                    maxLength={500}
                    onChange={(e) => updateAffinityStage(index, 'description', e.target.value)}
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {!formData.affinity_system.has_affinity_system && (
        <div className="text-center py-8 text-gray-500">
          <Heart className="w-12 h-12 mx-auto mb-3 opacity-50" />
          <p>호감도 시스템을 활성화하면 더 다채로운 대화를 경험할 수 있습니다.</p>
        </div>
      )}
    </div>
  );

  const renderPublishTab = () => (
    <div className="space-y-6 p-6">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Switch
              id="is_public"
              checked={formData.publish_settings.is_public}
              onCheckedChange={(checked) => updateFormData('publish_settings', 'is_public', checked)}
            />
            <Label htmlFor="is_public" className="text-lg font-semibold">
              공개 캐릭터로 설정
            </Label>
          </div>
          {formData.publish_settings.is_public ? (
            <Badge variant="default" className="bg-green-100 text-green-800">
              {useNormalCreateWizard ? '공개' : (
                <span className="inline-flex items-center">
                  <Globe className="w-3 h-3 mr-1" />
                  공개
                </span>
              )}
            </Badge>
          ) : (
            <Badge variant="secondary">
              {useNormalCreateWizard ? '비공개' : (
                <span className="inline-flex items-center">
                  <Lock className="w-3 h-3 mr-1" />
                  비공개
                </span>
              )}
            </Badge>
          )}
        </div>

        <p className="text-sm text-gray-600">
          {formData.publish_settings.is_public 
            ? '다른 사용자들이 이 캐릭터와 대화할 수 있습니다.' 
            : '나만 사용할 수 있는 비공개 캐릭터입니다.'}
        </p>
      </div>


      <div className="bg-blue-50 p-4 rounded-lg">
        <h4 className="font-semibold mb-2 text-blue-900">💡 공개 캐릭터 가이드라인</h4>
        <ul className="text-sm text-blue-800 space-y-1">
          <li>• 다른 사용자들이 즐길 수 있는 흥미로운 캐릭터를 만들어보세요</li>
          <li>• 불쾌감을 줄 수 있는 내용은 피해주세요</li>
          <li>• 저작권이 있는 캐릭터는 주의해서 사용해주세요</li>
        </ul>
      </div>

      {/* 태그 설정 */}
      <Separator />
      <div className="space-y-3">
        <h3 className="text-lg font-semibold">태그 설정</h3>
        <div className="flex flex-wrap gap-2">
          {selectedTagSlugs.length === 0 && (
            <span className="text-sm text-gray-500">선택된 태그가 없습니다.</span>
          )}
          {selectedTagSlugs.map(slug => {
            const t = allTags.find(x => x.slug === slug);
            return (
              <Badge key={slug} className="bg-purple-600 hover:bg-purple-600">
                {useNormalCreateWizard ? (t?.name || slug) : `${t?.emoji || '🏷️'} ${t?.name || slug}`}
              </Badge>
            );
          })}
        </div>
        <div>
          <Button type="button" variant="outline" onClick={() => setIsTagModalOpen(true)}>태그 선택</Button>
        </div>
        {selectedTagSlugs.length > 0 && (
          <div className="text-sm text-gray-500">
            선택됨: {selectedTagSlugs.join(', ')}
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      {isStoryImporterOpen && (
        <StoryImporterModal 
          isOpen={isStoryImporterOpen}
          onClose={() => setIsStoryImporterOpen(false)}
          onApply={handleApplyImportedData}
        />
      )}
      {/* 헤더 */}
      <header className="bg-gray-900/80 backdrop-blur-sm shadow-sm border-b border-gray-800 sticky top-0 z-50">
        {/* ✅ 여백 최적화: 모바일/PC 모두 좌우 여백 축소 */}
        <div className="max-w-[var(--page-max-width)] mx-auto px-2 sm:px-4 lg:px-4">
          <div className="flex items-center justify-between h-[62px]">
            <div className="flex items-center space-x-2">
              <button
                type="button"
                className="group flex items-center gap-2"
                onClick={() => {
                  /**
                   * ✅ 이탈 경고 + 뒤로가기(요구사항)
                   *
                   * 요구사항:
                   * - "캐릭터 만들기" 문구 옆에 '<'를 추가한다.
                   * - '<' 또는 문구를 누르면 뒤로간다.
                   *
                   * 동작:
                   * - 변경사항이 있으면 confirm으로 1회 확인한다.
                   * - history가 없으면 대시보드로 폴백한다(방어).
                   */
                  try { if (!confirmLeaveIfUnsaved()) return; } catch (_) {}
                  try {
                    // ✅ popstate 가드가 "가짜 히스토리"를 쌓아둔 경우, -1은 같은 페이지로만 이동할 수 있다.
                    // - confirm을 통과했으면 1회 bypass 후 -2로 실제 이전 페이지로 빠진다.
                    try { leaveBypassRef.current = true; } catch (_) {}
                    if (typeof window !== 'undefined' && window.history && window.history.length > 1) {
                      const st = window.history.state || {};
                      if (st && st.cc_leave_guard === true && window.history.length > 2) {
                        try { window.history.go(-2); } catch (_) { navigate(-1); }
                      } else {
                        navigate(-1);
                      }
                    } else {
                      navigate('/dashboard');
                    }
                  } catch (_) {
                    try { navigate('/dashboard'); } catch (e2) { void e2; }
                  }
                }}
                aria-label="뒤로가기"
                title="뒤로가기"
              >
                <ChevronLeft className="w-5 h-5 text-white/80 group-hover:text-white transition-colors" aria-hidden="true" />
                <h1 className="text-base sm:text-xl font-bold text-white whitespace-nowrap">캐릭터 만들기</h1>
              </button>
            </div>
            <div className="flex items-center space-x-2">
              <div className="text-xs text-gray-500 mr-2 hidden sm:block">
                {isAutoSaving ? '임시저장 중…' : lastSavedAt ? `임시저장됨 • ${new Date(lastSavedAt).toLocaleTimeString()}` : ''}
              </div>
              <button
                type="button"
                onClick={handleManualDraftSave}
                className="h-8 px-1 text-xs sm:h-9 sm:px-2 sm:text-sm font-semibold text-white/80 hover:text-white transition-colors whitespace-nowrap"
                aria-label="임시저장"
                title="임시저장"
              >
                임시저장
              </button>
              <button
                type="button"
                onClick={() => setWizardSummaryOpen(true)}
                className="h-8 px-1 text-xs sm:h-9 sm:px-2 sm:text-sm font-semibold text-white/80 hover:text-white transition-colors whitespace-nowrap"
                aria-label="전체요약"
                title="현재 입력값을 한눈에 보기"
              >
                전체요약
              </button>
              <Button 
                onClick={handleSubmit}
                disabled={loading || (useNormalCreateWizard && (
                  String(formData?.basic_info?.name || '').length > PROFILE_NAME_MAX_LEN
                  || String(formData?.basic_info?.name || '').trim().length === 0
                  || String(formData?.basic_info?.description || '').length > PROFILE_ONE_LINE_MAX_LEN
                  || String(formData?.basic_info?.description || '').trim().length === 0
                  || String(formData?.basic_info?.world_setting || '').length > 6000
                  || (isSecretInfoEnabled && String(formData?.basic_info?.introduction_scenes?.[0]?.secret || '').length > 1000)
                  || (!!formData?.basic_info?.use_custom_description && String(formData?.basic_info?.user_display_description || '').length > 1000)
                  || String(formData?.basic_info?.personality || '').length > 300
                  || String(formData?.basic_info?.speech_style || '').length > 300
                ))}
                className="h-8 px-3 text-xs sm:h-9 sm:px-4 sm:text-sm bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700"
              >
                저장
              </Button>
            </div>
          </div>
        </div>
      </header>

      {/* 메인 컨텐츠 */}
      <main className={useNormalCreateWizard ? 'w-full' : 'max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8'}>
        {useNormalCreateWizard ? (
          <div className="w-full" style={{ maxWidth: 'unset', display: 'flex', flexDirection: 'column', flex: '1 1 0%' }}>
            {/* ✅ 경쟁사처럼: 상위는 max-width unset, 내부는 반응형 사이드 여백 + max-w 컨테이너 */}
            {/* ✅ 여백 최적화: 모바일/PC 모두 좌우 여백 축소 */}
            <div className="w-full px-1 sm:px-4 lg:px-4">
              <div className="mx-auto flex flex-row justify-center gap-4 w-full max-w-[var(--page-max-width)]">
                {/* ✅ 좌측 위저드(form) */}
                <form className="flex h-[calc(100dvh-62px)] min-w-0 flex-1 flex-col">
            {/* ✅ 여백 최적화: 모바일/PC 모두 좌측/상단 여백 축소 */}
            {error && (
              <Alert variant="destructive" className="mx-1 sm:mx-2 lg:mx-2 mt-3 shrink-0">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  {error.split('\n').map((line, index) => (
                    <div key={index}>{line}</div>
                  ))}
                </AlertDescription>
              </Alert>
            )}
            {/* ✅ 탭 디자인: HomePage(추천/캐릭터/웹소설) 스타일 재사용 */}
            {/* ✅ 모바일: 줄바꿈 대신 가로 스크롤(한 줄 유지) */}
            {/* ✅ 여백 최적화: 모바일/PC 모두 좌측 여백 축소 */}
            <div className="mx-1 sm:mx-2 lg:mx-2 flex flex-nowrap md:flex-wrap items-center gap-2 md:gap-3 border-b border-gray-800/80 overflow-x-auto md:overflow-visible scrollbar-hide">
              {(() => {
                /**
                 * ✅ 위저드 탭 카운트(경쟁사 UX 일관성)
                 *
                 * 의도/원리:
                 * - 설정집만 카운트를 보여주면 다른 탭과 톤이 달라 어색해진다.
                 * - 따라서 "콘텐츠 개수"가 의미 있는 탭(오프닝/스탯/설정집/엔딩/이미지)에만
                 *   작은 숫자 배지를 같이 노출한다.
                 *
                 * 방어:
                 * - SSOT는 start_sets(위저드 JSON)이며, 여기서만 읽어 표시한다.
                 * - 값이 없으면 배지를 숨긴다.
                 */
                const ss = (formData?.basic_info?.start_sets && typeof formData.basic_info.start_sets === 'object')
                  ? formData.basic_info.start_sets
                  : { items: [], setting_book: { selectedId: 'memo_1', items: [] } };
                const items = Array.isArray(ss?.items) ? ss.items : [];
                const totalOpenings = items.length || 0;
                const totalStats = (() => {
                  try {
                    let n = 0;
                    for (const it of items) {
                      const stats = Array.isArray(it?.stat_settings?.stats) ? it.stat_settings.stats : [];
                      n += stats.length;
                    }
                    return n;
                  } catch (_) {
                    return 0;
                  }
                })();
                const totalEndings = (() => {
                  try {
                    let n = 0;
                    for (const it of items) {
                      const ends = Array.isArray(it?.ending_settings?.endings) ? it.ending_settings.endings : [];
                      n += ends.length;
                    }
                    return n;
                  } catch (_) {
                    return 0;
                  }
                })();
                const totalSettingBooks = (() => {
                  try {
                    const sb = (ss?.setting_book && typeof ss.setting_book === 'object') ? ss.setting_book : null;
                    const books = Array.isArray(sb?.items) ? sb.items : [];
                    return books.length;
                  } catch (_) {
                    return 0;
                  }
                })();
                const totalImages = (() => {
                  try {
                    const imgs = Array.isArray(formData?.media_settings?.image_descriptions)
                      ? formData.media_settings.image_descriptions
                      : [];
                    return imgs.filter((x) => String(x?.url || '').trim()).length;
                  } catch (_) {
                    return 0;
                  }
                })();

                const map = {
                  image: totalImages,
                  first_start: totalOpenings,
                  stat: totalStats,
                  setting_book: totalSettingBooks,
                  ending: totalEndings,
                };
                // eslint-disable-next-line no-unused-vars
                return null;
              })()}
              {NORMAL_CREATE_WIZARD_STEPS.map((s) => {
                const active = normalWizardStep === s.id;
                const count = (() => {
                  try {
                    const ss = (formData?.basic_info?.start_sets && typeof formData.basic_info.start_sets === 'object')
                      ? formData.basic_info.start_sets
                      : { items: [], setting_book: { selectedId: 'memo_1', items: [] } };
                    const items = Array.isArray(ss?.items) ? ss.items : [];
                    if (s.id === 'image') {
                      const imgs = Array.isArray(formData?.media_settings?.image_descriptions)
                        ? formData.media_settings.image_descriptions
                        : [];
                      return imgs.filter((x) => String(x?.url || '').trim()).length;
                    }
                    if (s.id === 'first_start') return items.length || 0;
                    if (s.id === 'stat') {
                      let n = 0;
                      for (const it of items) n += (Array.isArray(it?.stat_settings?.stats) ? it.stat_settings.stats.length : 0);
                      return n;
                    }
                    if (s.id === 'setting_book') {
                      const sb = (ss?.setting_book && typeof ss.setting_book === 'object') ? ss.setting_book : null;
                      const books = Array.isArray(sb?.items) ? sb.items : [];
                      return books.length;
                    }
                    if (s.id === 'ending') {
                      let n = 0;
                      for (const it of items) n += (Array.isArray(it?.ending_settings?.endings) ? it.ending_settings.endings.length : 0);
                      return n;
                    }
                    return 0;
                  } catch (_) {
                    return 0;
                  }
                })();
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setNormalWizardStep(s.id)}
                    className={[
                      // ✅ 단계 탭이 PC에서도 아래로 밀리지 않게 크기 축소 (폰트/여백 최소화)
                      'relative -mb-px px-0.5 py-1 text-xs sm:text-sm font-semibold transition-colors shrink-0',
                      'border-b-2',
                      active
                        ? 'text-white border-purple-500'
                        : 'text-gray-400 border-transparent hover:text-gray-200'
                    ].join(' ')}
                    aria-current={active ? 'page' : undefined}
                  >
                    <span className="inline-flex items-center gap-1">
                      <span>{s.label}</span>
                      {Number(count) > 0 && (
                        <span
                          className={[
                            'inline-flex items-center justify-center min-w-[16px] h-[16px] px-0.5 rounded-full text-[10px] font-bold',
                            active ? 'bg-purple-600 text-white' : 'bg-white/10 text-gray-200',
                          ].join(' ')}
                          aria-label={`${s.label} 개수 ${count}`}
                          title={`${count}`}
                        >
                          {count}
                        </span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* 단계별 내용 영역(경쟁사 베이스) */}
            {/* ✅ 모바일에서 공간 낭비(좌우 여백 과다) 방지: 모바일은 px를 줄이고 컨텐츠 폭을 확보 */}
            <div className="relative overflow-hidden h-[calc(100dvh-102px)] px-1 sm:px-3 lg:px-3">
              <div className="h-full overflow-y-auto scrollbar-hide">
                {/* ✅ 여백 최적화: 모바일/PC 모두 상단 여백 축소 */}
                <div className="mt-0.5 sm:mt-2 lg:mt-2" />
                <div className="space-y-2 sm:space-y-3">
                  {normalWizardStep === 'profile' && (
                    <div className="text-white">
                      {renderProfileWizardTab()}
                    </div>
                  )}
                  {normalWizardStep === 'prompt' && (
                    <div className="text-white">
                      {renderPromptWizardTab()}
                    </div>
                  )}
                  {normalWizardStep === 'image' && (
                    <div className="text-white">
                      {renderImageWizardTab()}
                    </div>
                  )}
                  {normalWizardStep === 'first_start' && (
                    <div className="text-white">
                      {renderStartSetsWizardTab()}
                    </div>
                  )}
                  {normalWizardStep === 'stat' && (
                    <div className="text-white">
                      {renderStatsWizardTab()}
                    </div>
                  )}
                  {normalWizardStep === 'setting_book' && (
                    <div className="text-white">
                      {renderSettingBookWizardTab()}
                    </div>
                  )}
                  {normalWizardStep === 'ending' && (
                    <div className="text-white">
                      {renderEndingsWizardTab()}
                    </div>
                  )}
                  {normalWizardStep === 'options' && (
                    <div className="text-white">
                      {renderOptionsWizardTab()}
                    </div>
                  )}
                  {normalWizardStep === 'detail' && (
                    <div className="text-white">
                      {renderDetailsWizardTab()}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* 하단 CTA(경쟁사 위치/크기 톤) */}
            <div className="my-7 space-y-2">
              <button
                type="button"
                onClick={goNextWizardStep}
                disabled={!wizardCanGoNext || wizardStepIndex >= NORMAL_CREATE_WIZARD_STEPS.length - 1 || nextStepAutoFillOpen}
                className={[
                  'h-12 w-full rounded-md font-semibold transition-colors',
                  'bg-purple-600 hover:bg-purple-700 text-white',
                  'disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-purple-600',
                ].join(' ')}
              >
                다음단계
              </button>
              <button
                type="button"
                onClick={handleNextStepAutoFill}
                disabled={!wizardCanGoNext || wizardStepIndex >= NORMAL_CREATE_WIZARD_STEPS.length - 1 || nextStepAutoFillOpen}
                className={[
                  'h-11 w-full rounded-md font-semibold transition-colors',
                  'bg-gray-800 hover:bg-gray-700 text-gray-100',
                  'disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-gray-800',
                ].join(' ')}
                title="다음 단계의 자동생성 가능한 항목을 채웁니다 (단계 이동 없음)"
              >
                다음단계 자동완성
              </button>
            </div>
                </form>

                {/* ✅ 우측 채팅 미리보기(PC): 고정 폭 + 내부 스크롤, 좌우 여백 유지 */}
                <div className="hidden lg:flex relative h-[calc(100dvh-62px)] w-[520px] flex-col overflow-hidden p-4">
            <div className="z-20 p-4">
              <div className="flex w-full flex-row items-center justify-between rounded-md bg-[#1C1C1C] px-4 py-3">
                <div className="text-sm font-semibold text-white">
                  채팅 프리뷰
                  <span className="text-gray-400 font-semibold">({chatPreviewUserCount}/10)</span>
                </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setTurnEventPreviewOpen((v) => !v)}
                      disabled={!!chatPreviewGateReason || chatPreviewBusy}
                      className={[
                        'inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold transition-colors',
                        'bg-white/10 text-gray-100 hover:bg-white/15',
                        'disabled:opacity-60 disabled:cursor-not-allowed',
                      ].join(' ')}
                      title="턴수별 사건을 1턴에서 테스트로 확인합니다(프리뷰 리셋)"
                      aria-label="턴사건 프리뷰"
                    >
                      <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                      턴사건 프리뷰
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        try { setTurnEventPreviewOpen(false); } catch (_) {}
                        try { resetChatPreview(); } catch (_) {}
                        try { refreshChatPreviewSnapshot(); } catch (_) {}
                      }}
                      disabled={!!chatPreviewGateReason || chatPreviewBusy}
                      className={[
                        'inline-flex items-center justify-center rounded-md px-2 py-1 text-[11px] font-semibold transition-colors',
                        'bg-white/10 text-gray-100 hover:bg-white/15',
                        'disabled:opacity-60 disabled:cursor-not-allowed',
                      ].join(' ')}
                      title="프리뷰 채팅 초기화"
                      aria-label="프리뷰 채팅 초기화"
                    >
                      <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                    <div className="rounded-md bg-[#483136] px-2 text-[11px] text-rose-200">
                      {chatPreviewUserCount} / 10
                    </div>
                  </div>
              </div>
                {/* ✅ 턴사건 프리뷰 패널(오버레이 X): 채팅방을 가리지 않고 아래로 밀어내는 방식 */}
                {turnEventPreviewOpen ? (
                  <div className="mt-2 rounded-md border border-white/10 bg-black/40 px-3 py-2">
                    <div className="flex items-center justify-between">
                      <div className="text-xs font-semibold text-gray-200">턴수별 사건(1턴 테스트)</div>
                      <button
                        type="button"
                        onClick={() => setTurnEventPreviewOpen(false)}
                        className="text-xs text-gray-400 hover:text-gray-200"
                        aria-label="닫기"
                        title="닫기"
                      >
                        닫기
                      </button>
                    </div>
                    <div className="mt-1 max-h-[180px] overflow-y-auto space-y-1 custom-scrollbar">
                      {(Array.isArray(chatPreviewTurnEvents) ? chatPreviewTurnEvents : []).length > 0 ? (
                        (chatPreviewTurnEvents || []).slice(0, 30).map((ev) => (
                          <button
                            key={ev.id || `${ev.about}-${ev.title}`}
                            type="button"
                            onClick={() => runTurnEventPreview(ev.id)}
                            disabled={!!chatPreviewGateReason || chatPreviewBusy || !String(ev.id || '').trim()}
                            className={[
                              'w-full text-left rounded-md px-2 py-1.5 text-xs transition',
                              'border border-white/10 bg-white/5 hover:bg-white/10 text-gray-100',
                              'disabled:opacity-60 disabled:cursor-not-allowed',
                            ].join(' ')}
                            title="이 사건으로 1턴 테스트 실행(프리뷰 리셋)"
                          >
                            <span className="text-purple-200 font-semibold">{ev.about ? `${ev.about}턴` : '턴'}</span>
                            <span className="mx-1 text-gray-500">·</span>
                            <span className="font-semibold">{ev.title || '사건'}</span>
                            {ev.summary ? <span className="text-gray-300"> — {ev.summary}</span> : null}
                          </button>
                        ))
                      ) : (
                        <div className="text-xs text-gray-400">턴수별 사건이 아직 없어요. 오프닝에서 턴사건을 먼저 생성해주세요.</div>
                      )}
                    </div>
                    <div className="mt-2 text-[11px] text-gray-400">
                      중간 턴 강제삽입은 흐름을 깨서 금지. 선택한 사건을 <span className="text-gray-200 font-semibold">1턴에서만</span> 테스트합니다.
                    </div>
                  </div>
                ) : null}
            </div>

            <div className="absolute left-4 top-4 z-0 h-[calc(100dvh-62px-32px)] w-[calc(100%-32px)] overflow-hidden rounded-md border border-[#ffffff10] bg-[#212121]" />

            <form style={{ position: 'relative', flex: '1 1 0%' }}>
              <div
                ref={chatPreviewListRef}
                className="z-10 size-full overflow-y-auto px-5 scrollbar-hide"
                onScroll={handleChatPreviewScroll}
                style={{ maskImage: 'linear-gradient(to top, rgba(0,0,0,0) 0%, rgb(0,0,0) 12%)', contain: 'strict' }}
              >
                <div id="messages-area" className="flex flex-col gap-3 pb-28 sm:pb-28">
                  {/* ✅ 스크롤 중에도 프로필(아바타/이름)이 보이도록 상단 고정 */}
                  <div className="sticky top-0 z-20 -mx-2 mb-1 flex items-center gap-2 bg-[#212121]/95 px-2 py-2 backdrop-blur">
                    {chatPreviewAvatarUrl ? (
                      <img
                        alt=""
                        loading="lazy"
                        className="size-7 rounded-full object-cover border border-[#ffffff10]"
                        src={chatPreviewAvatarUrl}
                      />
                    ) : (
                      <div className="size-7 rounded-full bg-[#2a2a2a] border border-[#ffffff10]" />
                    )}
                    <div className="min-w-0 text-sm font-semibold text-white truncate">
                      {String(chatPreviewSnapshot?.name || '').trim() || '캐릭터'}
                    </div>
                  </div>

                  {/* 첫 시작(상황) */}
                  <div className="my-3 whitespace-pre-line break-words rounded-md bg-[#363636]/80 px-3 py-2 text-center text-sm text-white">
                    {String(chatPreviewSnapshot?.intro || '').trim()
                      ? renderChatPreviewTextWithInlineImages(String(chatPreviewSnapshot.intro), 'pv-intro')
                      : '첫 시작'}
                  </div>

                  {/* 첫대사(캐릭터) */}
                  <div className="flex justify-start font-normal">
                    <div className="mr-[0.62rem] mt-2 min-w-10">
                      {chatPreviewAvatarUrl ? (
                        <img
                          alt=""
                          loading="lazy"
                          className="size-10 rounded-full object-cover"
                          src={chatPreviewAvatarUrl}
                        />
                      ) : (
                        <div className="size-10 rounded-full bg-[#2a2a2a]" />
                      )}
                    </div>
                    <div className="relative max-w-[70%]">
                      <div className="text-[0.75rem] text-white">
                        {String(chatPreviewSnapshot?.name || '').trim() || '캐릭터'}
                      </div>
                      <div className="whitespace-pre-line rounded-r-xl rounded-bl-xl bg-[#262727] p-2 text-sm text-white">
                        <span className="font-semibold">
                      {(() => {
                        const full = String(chatPreviewSnapshot?.firstLine || '').trim();
                        const streamingActive = Boolean(chatPreviewFirstLineUiStream?.id && chatPreviewFirstLineUiStream?.full && chatPreviewFirstLineUiStream?.shown !== chatPreviewFirstLineUiStream?.full);
                        const raw = (() => {
                          if (!full) return '첫대사';
                          if (streamingActive && String(chatPreviewFirstLineUiStream.full || '').trim() === full) {
                            return String(chatPreviewFirstLineUiStream.shown || '');
                          }
                          return full;
                        })();
                        return renderChatPreviewTextWithInlineImages(raw, 'pv-firstline');
                      })()}
                        </span>
                      </div>
                    </div>
                  </div>
                  {Array.isArray(chatPreviewMessages) && chatPreviewMessages.length > 0 ? (
                    chatPreviewMessages.map((m, idx) => {
                      const isUser = m?.role === 'user';
                      const baseText = String(m?.content || '');
                      const mid = String(m?.id || '').trim();
                      const suggestedImgUrl = (() => {
                        try {
                          if (!mid) return '';
                          const u = chatPreviewSuggestedImageById?.[mid];
                          const s = String(u || '').trim();
                          return s || '';
                        } catch (_) {
                          return '';
                        }
                      })();
                      const streamingActive = Boolean(chatPreviewUiStream?.id && chatPreviewUiStream?.full && chatPreviewUiStream?.shown !== chatPreviewUiStream?.full);
                      const text = (!isUser && mid && chatPreviewUiStream?.id && String(chatPreviewUiStream.id) === mid)
                        ? String(chatPreviewUiStream.shown || '')
                        : baseText;
                      return (
                        <div
                          key={`${idx}-${isUser ? 'u' : 'a'}`}
                          className={isUser ? 'flex justify-end' : 'flex justify-start'}
                        >
                          {isUser ? (
                            <div
                              className={[
                                'whitespace-pre-line break-words p-2 text-sm text-white',
                                'max-w-[70%] rounded-l-xl rounded-br-xl bg-purple-600',
                              ].join(' ')}
                            >
                              {renderChatPreviewTextWithInlineImages(text, `pv-u-${mid || idx}`)}
                            </div>
                          ) : (
                            <div className="w-full">
                              {(() => {
                                // ✅ 프리뷰: !스탯 상태창은 "캐릭터 말풍선"으로 렌더(실채팅 느낌)
                                // - INFO(스탯) 텍스트는 parseAssistantBlocks로 분해하면 중앙 지문박스로 가버려 UX가 다르다.
                                const statInfo = String(text || '').trim();
                                if (statInfo.startsWith('INFO(스탯)')) {
                                  return (
                                    <div className="flex justify-start font-normal">
                                      <div className="mr-[0.62rem] mt-2 min-w-10">
                                        {chatPreviewAvatarUrl ? (
                                          <img alt="" loading="lazy" className="size-10 rounded-full object-cover" src={chatPreviewAvatarUrl} />
                                        ) : (
                                          <div className="size-10 rounded-full bg-[#2a2a2a]" />
                                        )}
                                      </div>
                                      <div className="relative max-w-[70%]">
                                        <div className="text-[0.75rem] text-white">
                                          {String(chatPreviewSnapshot?.name || '').trim() || '캐릭터'}
                                        </div>
                                        <div className="whitespace-pre-line break-words rounded-r-xl rounded-bl-xl bg-[#262727] p-2 text-sm text-white">
                                          {renderChatPreviewTextWithInlineImages(statInfo, `pv-a-${mid || idx}-stat`)}
                                        </div>
                                      </div>
                                    </div>
                                  );
                                }
                                const blocks = parseAssistantBlocks(text);
                                if (!Array.isArray(blocks) || blocks.length === 0) return null;
                                return (
                                  <div className="space-y-2 w-full">
                                    {blocks.map((b, bi) => {
                                      const kind = String(b?.kind || 'narration');
                                      const t = String(b?.text || '');
                                      if (!t.trim()) return null;
                                      if (kind === 'dialogue') {
                                        return (
                                          <div key={`pv-a-${idx}-${bi}-d`} className="flex justify-start font-normal">
                                            <div className="mr-[0.62rem] mt-2 min-w-10">
                                              {chatPreviewAvatarUrl ? (
                                                <img alt="" loading="lazy" className="size-10 rounded-full object-cover" src={chatPreviewAvatarUrl} />
                                              ) : (
                                                <div className="size-10 rounded-full bg-[#2a2a2a]" />
                                              )}
                                            </div>
                                            <div className="relative max-w-[70%]">
                                              <div className="text-[0.75rem] text-white">
                                                {String(chatPreviewSnapshot?.name || '').trim() || '캐릭터'}
                                              </div>
                                              <div className="whitespace-pre-line break-words rounded-r-xl rounded-bl-xl bg-[#262727] p-2 text-sm text-white">
                                                {renderChatPreviewTextWithInlineImages(t, `pv-a-${mid || idx}-${bi}-d`)}
                                              </div>
                                            </div>
                                          </div>
                                        );
                                      }
                                      // narration
                                      return (
                                        <div key={`pv-a-${idx}-${bi}-n`} className="flex justify-center">
                                          <div className="w-full my-1 whitespace-pre-line break-words rounded-md bg-[#363636]/80 px-3 py-2 text-center text-sm text-white border border-white/10">
                                            {renderChatPreviewTextWithInlineImages(t, `pv-a-${mid || idx}-${bi}-n`)}
                                          </div>
                                        </div>
                                      );
                                    })}
                                  </div>
                                );
                              })()}
                              {/* ✅ 키워드 트리거 이미지: 프리뷰에서도 실채팅처럼 바로 노출 */}
                              {suggestedImgUrl ? (
                                <div className="mt-2 flex justify-start font-normal">
                                  <div className="mr-[0.62rem] mt-2 min-w-10">
                                    {chatPreviewAvatarUrl ? (
                                      <img alt="" loading="lazy" className="size-10 rounded-full object-cover" src={chatPreviewAvatarUrl} />
                                    ) : (
                                      <div className="size-10 rounded-full bg-[#2a2a2a]" />
                                    )}
                                  </div>
                                  <div className="relative max-w-[70%]">
                                    <div className="text-[0.75rem] text-white">
                                      {String(chatPreviewSnapshot?.name || '').trim() || '캐릭터'}
                                    </div>
                                    <div className="whitespace-pre-line break-words rounded-r-xl rounded-bl-xl bg-[#262727] p-2 text-sm text-white">
                                      <img
                                        src={suggestedImgUrl}
                                        alt=""
                                        loading="lazy"
                                        decoding="async"
                                        className="block w-full h-auto rounded-xl cursor-zoom-in border border-white/10"
                                        onClick={() => {
                                          try {
                                            setImageViewerSrc(suggestedImgUrl);
                                            setImageViewerOpen(true);
                                          } catch (_) {}
                                        }}
                                      />
                                    </div>
                                  </div>
                                </div>
                              ) : null}
                            </div>
                          )}
                        </div>
                      );
                    })
                  ) : null}
                  {/* ✅ 캐릭터 타이핑(… 말풍선): 프리뷰에서도 응답 생성/스트리밍 중에 표시 */}
                  {(() => {
                    try {
                      const streamingActive = Boolean(
                        chatPreviewUiStream?.id
                        && chatPreviewUiStream?.full
                        && chatPreviewUiStream?.shown !== chatPreviewUiStream?.full
                      );
                      const streamingButEmpty = streamingActive && !String(chatPreviewUiStream?.shown || '').trim();
                      const showTyping = !!chatPreviewBusy || streamingButEmpty;
                      if (!showTyping) return null;
                      return (
                        <div className="flex justify-start font-normal">
                          <div className="mr-[0.62rem] mt-2 min-w-10">
                            {chatPreviewAvatarUrl ? (
                              <img alt="" loading="lazy" className="size-10 rounded-full object-cover" src={chatPreviewAvatarUrl} />
                            ) : (
                              <div className="size-10 rounded-full bg-[#2a2a2a]" />
                            )}
                          </div>
                          <div className="relative max-w-[70%]">
                            <div className="text-[0.75rem] text-white">
                              {String(chatPreviewSnapshot?.name || '').trim() || '캐릭터'}
                            </div>
                            <div className="rounded-r-xl rounded-bl-xl bg-[#262727] px-3 py-3 text-sm text-white">
                              <span className="inline-flex items-center gap-1" aria-label="타이핑 중">
                                <span className="inline-block h-1.5 w-1.5 rounded-full bg-white/80 animate-bounce" style={{ animationDelay: '0ms' }} />
                                <span className="inline-block h-1.5 w-1.5 rounded-full bg-white/80 animate-bounce" style={{ animationDelay: '120ms' }} />
                                <span className="inline-block h-1.5 w-1.5 rounded-full bg-white/80 animate-bounce" style={{ animationDelay: '240ms' }} />
                              </span>
                            </div>
                          </div>
                        </div>
                      );
                    } catch (_) {
                      return null;
                    }
                  })()}
                  {/* ✅ 프리뷰 요술봉 선택지(채팅창 안에 표시) */}
                  {chatPreviewMagicMode
                    && !chatPreviewGateReason
                    && chatPreviewUserCount < 10
                    && (
                      chatPreviewMagicLoading
                      || (Array.isArray(chatPreviewMagicChoices) && chatPreviewMagicChoices.length > 0)
                    ) ? (
                      <div className="flex flex-col items-end">
                        <div className="w-full sm:max-w-[85%]">
                          {chatPreviewMagicLoading && (!Array.isArray(chatPreviewMagicChoices) || chatPreviewMagicChoices.length === 0) ? (
                            <div className="flex flex-col items-end">
                              {/* ✅ 로딩 중 UI(일반챗 스타일): 선택지 3개 자리에서 각각 "... 말풍선" */}
                              <div className="w-full max-w-[85%] space-y-2">
                                {['loading-1', 'loading-2', 'loading-3'].map((id) => (
                                  <div
                                    key={`pv-choice-${id}`}
                                    className="ml-auto w-full px-4 py-3 rounded-2xl border border-white/10 bg-black/40"
                                    aria-label="선택지 생성 중"
                                    title="선택지 생성 중"
                                    aria-busy="true"
                                  >
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
                            <div className="space-y-2">
                          {(Array.isArray(chatPreviewMagicChoices) ? chatPreviewMagicChoices : []).slice(0, Math.max(0, Math.min(3, chatPreviewMagicRevealCount || 0))).map((c) => {
                                const label = String(c?.label || '').trim();
                                const dialogue = String(c?.dialogue || '').trim() || label.split('\n')[0] || label;
                                const narration = String(c?.narration || '').trim() || label.split('\n').slice(1).join('\n').trim();
                                return (
                                  <button
                                    key={String(c?.id || label)}
                                    type="button"
                                    onClick={() => sendChatPreview(label)}
                                disabled={chatPreviewMagicLoading || !label || chatPreviewBusy || (chatPreviewUiStream?.id && chatPreviewUiStream?.full && chatPreviewUiStream?.shown !== chatPreviewUiStream?.full) || (chatPreviewFirstLineUiStream?.id && chatPreviewFirstLineUiStream?.full && chatPreviewFirstLineUiStream?.shown !== chatPreviewFirstLineUiStream?.full)}
                                    className={[
                                      'w-full text-left px-4 py-3 rounded-2xl border transition',
                                      'bg-black/40 border-white/10 text-gray-100',
                                      'hover:bg-white/10',
                                      'disabled:opacity-60 disabled:cursor-not-allowed',
                                    ].join(' ')}
                                    title="선택지 전송(프리뷰)"
                                  >
                                    <div className="space-y-1">
                                      <div className="text-sm leading-6 text-white whitespace-pre-line break-words">{dialogue}</div>
                                      {narration ? (
                                        <div className="text-sm leading-6 italic text-purple-300 whitespace-pre-line break-words">{narration}</div>
                                      ) : null}
                                    </div>
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </div>
                    ) : null}
                  </div>
              </div>

              <div className="absolute inset-x-0 bottom-2 z-20 mx-auto flex w-full items-center px-4">
                <div className="relative w-full">
                  <input
                    value={chatPreviewInput}
                    onChange={(e) => setChatPreviewInput(e.target.value)}
                    placeholder={chatPreviewGateReason ? String(chatPreviewGateReason) : '메시지 입력…'}
                    className="w-full h-12 rounded-full border border-[#ffffff10] bg-[rgba(54,54,54,0.3)] pl-4 pr-36 text-sm text-white placeholder:text-gray-400 backdrop-blur-sm disabled:opacity-50"
                    disabled={!!chatPreviewGateReason || chatPreviewUserCount >= 10 || chatPreviewBusy || (chatPreviewUiStream?.id && chatPreviewUiStream?.full && chatPreviewUiStream?.shown !== chatPreviewUiStream?.full)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        sendChatPreview();
                      }
                    }}
                  />
                  <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
                    <button
                      type="button"
                      onClick={toggleChatPreviewMagicMode}
                      disabled={!!chatPreviewGateReason || chatPreviewUserCount >= 10 || chatPreviewBusy || (chatPreviewUiStream?.id && chatPreviewUiStream?.full && chatPreviewUiStream?.shown !== chatPreviewUiStream?.full)}
                      className={[
                        'size-9 rounded-full border text-gray-200 disabled:opacity-50 disabled:cursor-not-allowed',
                        chatPreviewMagicMode
                          ? 'bg-black text-white border-[#ffffff10] hover:bg-black/80'
                          : 'bg-black/30 border-[#ffffff10] hover:bg-black/40',
                      ].join(' ')}
                      title="요술봉(프리뷰)"
                      aria-label="요술봉(프리뷰)"
                    >
                      <Wand2 className="w-4 h-4 mx-auto" />
                    </button>
                    <button
                      type="button"
                      onClick={toggleChatPreviewNarration}
                      disabled={!!chatPreviewGateReason || chatPreviewUserCount >= 10 || chatPreviewBusy || (chatPreviewUiStream?.id && chatPreviewUiStream?.full && chatPreviewUiStream?.shown !== chatPreviewUiStream?.full)}
                      className="size-9 rounded-full bg-black/30 border border-[#ffffff10] text-gray-200 hover:bg-black/40 disabled:opacity-50 disabled:cursor-not-allowed"
                      title="나레이션"
                    >
                      <Asterisk className="w-4 h-4 mx-auto" />
                    </button>
                    <button
                      type="button"
                      onClick={sendChatPreview}
                      disabled={!!chatPreviewGateReason || chatPreviewUserCount >= 10 || !String(chatPreviewInput || '').trim() || chatPreviewBusy || (chatPreviewUiStream?.id && chatPreviewUiStream?.full && chatPreviewUiStream?.shown !== chatPreviewUiStream?.full)}
                      className="size-9 rounded-full bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed"
                      title="전송"
                    >
                      <Send className="w-4 h-4 mx-auto" />
                    </button>
                  </div>
                </div>
              </div>
            </form>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <>
            {error && (
              <Alert variant="destructive" className="mb-6">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  {error.split('\n').map((line, index) => (
                    <div key={index}>{line}</div>
                  ))}
                </AlertDescription>
              </Alert>
            )}

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_220px]">
              <div>
                <div className="flex items-center justify-between mb-4">
                  <Button
                    variant="ghost"
                    onClick={() => {
                      try { if (!confirmLeaveIfUnsaved()) return; } catch (_) {}
                      // ✅ popstate 가드가 있을 때는 -2로 실제 이탈(요청한 UX)
                      try { leaveBypassRef.current = true; } catch (_) {}
                      try {
                        if (typeof window !== 'undefined' && window.history && window.history.length > 1) {
                          const st = window.history.state || {};
                          if (st && st.cc_leave_guard === true && window.history.length > 2) {
                            try { window.history.go(-2); } catch (_) { navigate(-1); }
                          } else {
                            navigate(-1);
                          }
                        } else {
                          navigate('/dashboard');
                        }
                      } catch (_) {
                        try { navigate('/dashboard'); } catch (e2) { void e2; }
                      }
                    }}
                    className="text-gray-300 hover:text-gray-900 hover:bg-gray-100 dark:hover:text-white dark:hover:bg-white/10 flex items-center gap-2 rounded-md px-2 py-1 transition-colors"
                  >
                    <ArrowLeft className="w-4 h-4" />
                    뒤로 가기
                  </Button>
                </div>

                {/* 롱폼 섹션: 탭 제거 후 순차 배치 */}
                <Card id="section-basic" className="shadow-lg mb-8 bg-gray-800 text-white border border-gray-700">
                  <CardHeader>
                    <CardTitle className="text-lg text-white">기본 정보</CardTitle>
                  </CardHeader>
                  {renderBasicInfoTab()}
                </Card>

                <Card id="section-dialogues" className="shadow-lg mb-8 bg-gray-800 text-white border border-gray-700">
                  <CardHeader>
                    <CardTitle className="text-lg text-white">예시 대화</CardTitle>
                  </CardHeader>
                  {renderDialoguesTab()}
                </Card>

                <Card id="section-affinity" className="shadow-lg mb-8 bg-gray-800 text-white border border-gray-700">
                  <CardHeader>
                    <CardTitle className="text-lg text-white">호감도</CardTitle>
                  </CardHeader>
                  {renderAffinityTab()}
                </Card>

                <Card id="section-publish" className="shadow-lg bg-gray-800 text-white border border-gray-700">
                  <CardHeader>
                    <CardTitle className="text-lg text-white">공개 설정 & 태그</CardTitle>
                  </CardHeader>
                  {renderPublishTab()}
                </Card>
              </div>

              {/* 우측 앵커 네비게이션 */}
              <aside className="hidden lg:block sticky top-20 h-fit">
                <div className="bg-gray-800 border border-gray-700 rounded-lg p-3 text-sm text-gray-200">
                  <div className="font-semibold mb-2">빠른 이동</div>
                  <ul className="space-y-2">
                    <li>
                      <a onClick={(e)=>{e.preventDefault(); const el=document.getElementById('section-basic'); if(el){const y=el.getBoundingClientRect().top+window.pageYOffset-HEADER_OFFSET; window.scrollTo({top:y,behavior:'smooth'});} }} href="#section-basic" className={`flex items-center justify-between hover:underline ${activeSection === 'section-basic' ? 'text-purple-300' : ''}`}>
                        <span>기본 정보</span>
                        {sectionErrors.basic > 0 && <Badge variant="destructive" className="ml-2">{sectionErrors.basic}</Badge>}
                      </a>
                    </li>
                    <li>
                      <a onClick={(e)=>{e.preventDefault(); const el=document.getElementById('section-dialogues'); if(el){const y=el.getBoundingClientRect().top+window.pageYOffset-HEADER_OFFSET; window.scrollTo({top:y,behavior:'smooth'});} }} href="#section-dialogues" className={`flex items-center justify-between hover:underline ${activeSection === 'section-dialogues' ? 'text-purple-300' : ''}`}>
                        <span>예시 대화</span>
                        {sectionErrors.dialogues > 0 && <Badge variant="destructive" className="ml-2">{sectionErrors.dialogues}</Badge>}
                      </a>
                    </li>
                    <li>
                      <a onClick={(e)=>{e.preventDefault(); const el=document.getElementById('section-affinity'); if(el){const y=el.getBoundingClientRect().top+window.pageYOffset-HEADER_OFFSET; window.scrollTo({top:y,behavior:'smooth'});} }} href="#section-affinity" className={`flex items-center justify-between hover:underline ${activeSection === 'section-affinity' ? 'text-purple-300' : ''}`}>
                        <span>호감도</span>
                        {sectionErrors.affinity > 0 && <Badge variant="destructive" className="ml-2">{sectionErrors.affinity}</Badge>}
                      </a>
                    </li>
                    <li>
                      <a onClick={(e)=>{e.preventDefault(); const el=document.getElementById('section-publish'); if(el){const y=el.getBoundingClientRect().top+window.pageYOffset-HEADER_OFFSET; window.scrollTo({top:y,behavior:'smooth'});} }} href="#section-publish" className={`flex items-center justify-between hover:underline ${activeSection === 'section-publish' ? 'text-purple-300' : ''}`}>
                        <span>공개/태그</span>
                        {sectionErrors.publish > 0 && <Badge variant="destructive" className="ml-2">{sectionErrors.publish}</Badge>}
                      </a>
                    </li>
                  </ul>
                </div>
              </aside>
            </div>
          </>
        )}
      </main>

      {/* ✅ 모바일 채팅 미리보기: 풀스크린 느낌으로 */}
      <Dialog open={isChatPreviewOpen} onOpenChange={setIsChatPreviewOpen}>
        <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-4xl p-0">
          <div className="bg-gray-950 text-white">
            <div className="px-4 py-3 border-b border-gray-800">
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold truncate">채팅 프리뷰</div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setTurnEventPreviewOpen((v) => !v)}
                    disabled={!!chatPreviewGateReason || chatPreviewBusy}
                    className={[
                      'inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold transition-colors',
                      'bg-white/10 text-gray-100 hover:bg-white/15',
                      'disabled:opacity-60 disabled:cursor-not-allowed',
                    ].join(' ')}
                    title="턴수별 사건을 1턴에서 테스트로 확인합니다(프리뷰 리셋)"
                    aria-label="턴사건 프리뷰"
                  >
                    <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                    턴사건 프리뷰
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      try { setTurnEventPreviewOpen(false); } catch (_) {}
                      try { resetChatPreview(); } catch (_) {}
                      try { refreshChatPreviewSnapshot(); } catch (_) {}
                    }}
                    disabled={!!chatPreviewGateReason || chatPreviewBusy}
                    className={[
                      'inline-flex items-center justify-center rounded-md px-2 py-1 text-[11px] font-semibold transition-colors',
                      'bg-white/10 text-gray-100 hover:bg-white/15',
                      'disabled:opacity-60 disabled:cursor-not-allowed',
                    ].join(' ')}
                    title="프리뷰 채팅 초기화"
                    aria-label="프리뷰 채팅 초기화"
                  >
                    <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                  <div className="text-xs text-gray-400">{chatPreviewUserCount}/10</div>
                </div>
              </div>
              {turnEventPreviewOpen ? (
                <div className="mt-2 rounded-md border border-white/10 bg-black/40 px-3 py-2">
                  <div className="flex items-center justify-between">
                    <div className="text-xs font-semibold text-gray-200">턴수별 사건(1턴 테스트)</div>
                    <button
                      type="button"
                      onClick={() => setTurnEventPreviewOpen(false)}
                      className="text-xs text-gray-400 hover:text-gray-200"
                      aria-label="닫기"
                      title="닫기"
                    >
                      닫기
                    </button>
                  </div>
                  <div className="mt-1 max-h-[180px] overflow-y-auto space-y-1 custom-scrollbar">
                    {(Array.isArray(chatPreviewTurnEvents) ? chatPreviewTurnEvents : []).length > 0 ? (
                      (chatPreviewTurnEvents || []).slice(0, 30).map((ev) => (
                        <button
                          key={ev.id || `${ev.about}-${ev.title}`}
                          type="button"
                          onClick={() => runTurnEventPreview(ev.id)}
                          disabled={!!chatPreviewGateReason || chatPreviewBusy || !String(ev.id || '').trim()}
                          className={[
                            'w-full text-left rounded-md px-2 py-1.5 text-xs transition',
                            'border border-white/10 bg-white/5 hover:bg-white/10 text-gray-100',
                            'disabled:opacity-60 disabled:cursor-not-allowed',
                          ].join(' ')}
                          title="이 사건으로 1턴 테스트 실행(프리뷰 리셋)"
                        >
                          <span className="text-purple-200 font-semibold">{ev.about ? `${ev.about}턴` : '턴'}</span>
                          <span className="mx-1 text-gray-500">·</span>
                          <span className="font-semibold">{ev.title || '사건'}</span>
                          {ev.summary ? <span className="text-gray-300"> — {ev.summary}</span> : null}
                        </button>
                      ))
                    ) : (
                      <div className="text-xs text-gray-400">턴수별 사건이 아직 없어요. 오프닝에서 턴사건을 먼저 생성해주세요.</div>
                    )}
                  </div>
                  <div className="mt-2 text-[11px] text-gray-400">
                    중간 턴 강제삽입은 흐름을 깨서 금지. 선택한 사건을 <span className="text-gray-200 font-semibold">1턴에서만</span> 테스트합니다.
                  </div>
                </div>
              ) : null}
            </div>
            <div ref={chatPreviewListRef} className="h-[70vh] overflow-y-auto px-3 py-3 space-y-2" onScroll={handleChatPreviewScroll}>
              {/* ✅ 스크롤 중에도 프로필(아바타/이름)이 보이도록 상단 고정 */}
              <div className="sticky top-0 z-20 -mx-3 mb-1 flex items-center gap-2 bg-gray-950/95 px-3 py-2 backdrop-blur">
                {chatPreviewAvatarUrl ? (
                  <img
                    alt=""
                    loading="lazy"
                    className="size-7 rounded-full object-cover border border-gray-800"
                    src={chatPreviewAvatarUrl}
                  />
                ) : (
                  <div className="size-7 rounded-full bg-[#2a2a2a] border border-gray-800" />
                )}
                <div className="min-w-0 text-sm font-semibold text-white truncate">
                  {String(chatPreviewSnapshot?.name || '').trim() || '캐릭터'}
                </div>
              </div>

              <div className="my-3 whitespace-pre-line break-words rounded-md bg-[#363636]/80 px-3 py-2 text-center text-sm text-white">
                {String(chatPreviewSnapshot?.intro || '').trim() ? String(chatPreviewSnapshot.intro) : '첫 시작'}
              </div>
              <div className="flex justify-start font-normal">
                <div className="mr-[0.62rem] mt-2 min-w-10">
                  {chatPreviewAvatarUrl ? (
                    <img alt="" loading="lazy" className="size-10 rounded-full object-cover" src={chatPreviewAvatarUrl} />
                  ) : (
                    <div className="size-10 rounded-full bg-[#2a2a2a]" />
                  )}
                </div>
                <div className="relative max-w-[70%]">
                  <div className="text-[0.75rem] text-white">
                    {String(chatPreviewSnapshot?.name || '').trim() || '캐릭터'}
                  </div>
                  <div className="whitespace-pre-line rounded-r-xl rounded-bl-xl bg-[#262727] p-2 text-sm text-white">
                    <span className="font-semibold">
                      {(() => {
                        const full = String(chatPreviewSnapshot?.firstLine || '').trim();
                        const streamingActive = Boolean(chatPreviewFirstLineUiStream?.id && chatPreviewFirstLineUiStream?.full && chatPreviewFirstLineUiStream?.shown !== chatPreviewFirstLineUiStream?.full);
                        if (!full) return '첫대사';
                        if (streamingActive && String(chatPreviewFirstLineUiStream.full || '').trim() === full) {
                          return String(chatPreviewFirstLineUiStream.shown || '');
                        }
                        return full;
                      })()}
                    </span>
                  </div>
                </div>
              </div>
              {Array.isArray(chatPreviewMessages) && chatPreviewMessages.length > 0 ? (
                chatPreviewMessages.map((m, idx) => {
                  const isUser = m?.role === 'user';
                  const baseText = String(m?.content || '');
                  const mid = String(m?.id || '').trim();
                  const suggestedImgUrl = (() => {
                    try {
                      if (!mid) return '';
                      const u = chatPreviewSuggestedImageById?.[mid];
                      const s = String(u || '').trim();
                      return s || '';
                    } catch (_) {
                      return '';
                    }
                  })();
                  const text = (!isUser && mid && chatPreviewUiStream?.id && String(chatPreviewUiStream.id) === mid)
                    ? String(chatPreviewUiStream.shown || '')
                    : baseText;
                  return (
                    <div key={`${idx}-${isUser ? 'u' : 'a'}`} className={isUser ? 'flex justify-end' : 'flex justify-start'}>
                      {isUser ? (
                        <div className="max-w-[85%] rounded-2xl bg-purple-600 px-3 py-2 text-sm leading-relaxed text-white">
                          {text}
                        </div>
                      ) : (
                        <div className="w-full">
                          {(() => {
                            // ✅ 프리뷰: !스탯 상태창(텍스트)은 "캐릭터 말풍선"으로 렌더(실채팅 느낌)
                            const statInfo = String(text || '').trim();
                            if (statInfo.startsWith('INFO(스탯)')) {
                              return (
                                <div className="flex justify-start font-normal">
                                  <div className="mr-[0.62rem] mt-1 min-w-9">
                                    {chatPreviewAvatarUrl ? (
                                      <img alt="" loading="lazy" className="size-9 rounded-full object-cover" src={chatPreviewAvatarUrl} />
                                    ) : (
                                      <div className="size-9 rounded-full bg-[#2a2a2a] border border-gray-800" />
                                    )}
                                  </div>
                                  <div className="relative max-w-[85%]">
                                    <div className="text-[0.75rem] text-gray-200">
                                      {String(chatPreviewSnapshot?.name || '').trim() || '캐릭터'}
                                    </div>
                                    <div className="whitespace-pre-line break-words rounded-2xl bg-gray-800 px-3 py-2 text-sm leading-relaxed text-gray-100">
                                      {statInfo}
                                    </div>
                                  </div>
                                </div>
                              );
                            }
                            const blocks = parseAssistantBlocks(text);
                            if (!Array.isArray(blocks) || blocks.length === 0) return null;
                            return (
                              <div className="space-y-2 w-full">
                                {blocks.map((b, bi) => {
                                  const kind = String(b?.kind || 'narration');
                                  const t = String(b?.text || '');
                                  if (!t.trim()) return null;
                                  if (kind === 'dialogue') {
                                    return (
                                      <div key={`pv-m-${idx}-${bi}-d`} className="flex justify-start font-normal">
                                        <div className="mr-[0.62rem] mt-1 min-w-9">
                                          {chatPreviewAvatarUrl ? (
                                            <img alt="" loading="lazy" className="size-9 rounded-full object-cover" src={chatPreviewAvatarUrl} />
                                          ) : (
                                            <div className="size-9 rounded-full bg-[#2a2a2a] border border-gray-800" />
                                          )}
                                        </div>
                                        <div className="relative max-w-[85%]">
                                          <div className="text-[0.75rem] text-gray-200">
                                            {String(chatPreviewSnapshot?.name || '').trim() || '캐릭터'}
                                          </div>
                                          <div className="whitespace-pre-line break-words rounded-2xl bg-gray-800 px-3 py-2 text-sm leading-relaxed text-gray-100">
                                            {t}
                                          </div>
                                        </div>
                                      </div>
                                    );
                                  }
                                  return (
                                    <div key={`pv-m-${idx}-${bi}-n`} className="flex justify-center">
                                      <div className="w-full my-1 whitespace-pre-line break-words rounded-md bg-[#363636]/80 px-3 py-2 text-center text-sm text-white border border-white/10">
                                        {t}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            );
                          })()}
                          {/* ✅ 키워드 트리거 이미지: 프리뷰에서도 실채팅처럼 바로 노출 */}
                          {suggestedImgUrl ? (
                            <div className="mt-2 flex justify-start font-normal">
                              <div className="mr-[0.62rem] mt-1 min-w-9">
                                {chatPreviewAvatarUrl ? (
                                  <img alt="" loading="lazy" className="size-9 rounded-full object-cover" src={chatPreviewAvatarUrl} />
                                ) : (
                                  <div className="size-9 rounded-full bg-[#2a2a2a] border border-gray-800" />
                                )}
                              </div>
                              <div className="relative max-w-[85%]">
                                <div className="text-[0.75rem] text-gray-200">
                                  {String(chatPreviewSnapshot?.name || '').trim() || '캐릭터'}
                                </div>
                                <div className="whitespace-pre-line break-words rounded-2xl bg-gray-800 px-3 py-2 text-sm leading-relaxed text-gray-100">
                                  <img
                                    src={suggestedImgUrl}
                                    alt=""
                                    loading="lazy"
                                    decoding="async"
                                    className="block w-full h-auto rounded-xl cursor-zoom-in border border-white/10"
                                    onClick={() => {
                                      try {
                                        setImageViewerSrc(suggestedImgUrl);
                                        setImageViewerOpen(true);
                                      } catch (_) {}
                                    }}
                                  />
                                </div>
                              </div>
                            </div>
                          ) : null}
                        </div>
                      )}
                    </div>
                  );
                })
              ) : (
                <div className="text-xs text-gray-500 px-1">
                  위저드 입력을 채우고, 여기서 최대 10번까지 대화를 테스트할 수 있어요.
                </div>
              )}
              {/* ✅ 프리뷰 요술봉 선택지(채팅창 안에 표시) */}
              {chatPreviewMagicMode
                && !chatPreviewGateReason
                && chatPreviewUserCount < 10
                && (
                  chatPreviewMagicLoading
                  || (Array.isArray(chatPreviewMagicChoices) && chatPreviewMagicChoices.length > 0)
                ) ? (
                  <div className="flex justify-end pt-1">
                    <div className="max-w-[85%] w-full">
                      {chatPreviewMagicLoading && (!Array.isArray(chatPreviewMagicChoices) || chatPreviewMagicChoices.length === 0) ? (
                        <div className="flex justify-end">
                          <div className="rounded-2xl border border-purple-500/25 bg-purple-500/10 px-3 py-2">
                            <Loader2 className="size-4 animate-spin text-purple-200" aria-hidden="true" />
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          {(Array.isArray(chatPreviewMagicChoices) ? chatPreviewMagicChoices : []).slice(0, Math.max(0, Math.min(3, chatPreviewMagicRevealCount || 0))).map((c) => {
                            const label = String(c?.label || '').trim();
                            const dialogue = String(c?.dialogue || '').trim() || label.split('\n')[0] || label;
                            const narration = String(c?.narration || '').trim() || label.split('\n').slice(1).join('\n').trim();
                            return (
                              <button
                                key={String(c?.id || label)}
                                type="button"
                                onClick={() => sendChatPreview(label)}
                                disabled={chatPreviewMagicLoading || !label || chatPreviewBusy || (chatPreviewUiStream?.id && chatPreviewUiStream?.full && chatPreviewUiStream?.shown !== chatPreviewUiStream?.full) || (chatPreviewFirstLineUiStream?.id && chatPreviewFirstLineUiStream?.full && chatPreviewFirstLineUiStream?.shown !== chatPreviewFirstLineUiStream?.full)}
                                className={[
                                  'w-full rounded-2xl border border-gray-800 bg-gray-900/40 px-3 py-2 text-left',
                                  'transition-colors hover:bg-gray-900/60',
                                  'disabled:opacity-60 disabled:cursor-not-allowed',
                                ].join(' ')}
                                title="선택지 전송(프리뷰)"
                              >
                                <div className="text-sm text-gray-100 whitespace-pre-line break-words">{dialogue}</div>
                                {narration ? (
                                  <div className="mt-1 text-xs text-gray-400 whitespace-pre-line break-words">{narration}</div>
                                ) : null}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                ) : null}
            </div>
            <div className="border-t border-gray-800 p-3">
              <div className="flex gap-2">
                <input
                  value={chatPreviewInput}
                  onChange={(e) => setChatPreviewInput(e.target.value)}
                  placeholder="메시지 입력…"
                  className="flex-1 h-11 rounded-xl border border-gray-800 bg-gray-900/40 px-3 text-sm text-gray-100 placeholder:text-gray-500 outline-none focus:ring-2 focus:ring-purple-500/30"
                  disabled={!!chatPreviewGateReason || chatPreviewUserCount >= 10 || chatPreviewBusy || (chatPreviewUiStream?.id && chatPreviewUiStream?.full && chatPreviewUiStream?.shown !== chatPreviewUiStream?.full)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      sendChatPreview();
                    }
                  }}
                />
                <button
                  type="button"
                  onClick={toggleChatPreviewNarration}
                  disabled={!!chatPreviewGateReason || chatPreviewUserCount >= 10 || chatPreviewBusy || (chatPreviewUiStream?.id && chatPreviewUiStream?.full && chatPreviewUiStream?.shown !== chatPreviewUiStream?.full)}
                  className="h-11 w-11 rounded-xl border border-gray-800 bg-gray-900/40 text-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
                  title="나레이션"
                >
                  <Asterisk className="w-5 h-5 mx-auto" />
                </button>
                <button
                  type="button"
                  onClick={toggleChatPreviewMagicMode}
                  disabled={!!chatPreviewGateReason || chatPreviewUserCount >= 10 || chatPreviewBusy || (chatPreviewUiStream?.id && chatPreviewUiStream?.full && chatPreviewUiStream?.shown !== chatPreviewUiStream?.full)}
                  className={[
                    'h-11 w-11 rounded-xl border border-gray-800 text-gray-100 disabled:opacity-50 disabled:cursor-not-allowed',
                    chatPreviewMagicMode ? 'bg-black hover:bg-black/80' : 'bg-gray-900/40 hover:bg-gray-900/60',
                  ].join(' ')}
                  title="요술봉(프리뷰)"
                  aria-label="요술봉(프리뷰)"
                >
                  <Wand2 className="w-5 h-5 mx-auto" />
                </button>
                <button
                  type="button"
                  onClick={sendChatPreview}
                  disabled={!!chatPreviewGateReason || chatPreviewUserCount >= 10 || !String(chatPreviewInput || '').trim() || chatPreviewBusy || (chatPreviewUiStream?.id && chatPreviewUiStream?.full && chatPreviewUiStream?.shown !== chatPreviewUiStream?.full)}
                  className="h-11 w-11 rounded-xl bg-purple-600 text-white disabled:opacity-50 disabled:cursor-not-allowed"
                  title="전송"
                >
                  <Send className="w-5 h-5 mx-auto" />
                </button>
              </div>
              <div className="mt-2 flex justify-between">
                <button
                  type="button"
                  onClick={resetChatPreview}
                  className="text-xs text-gray-400 hover:text-gray-200 transition-colors"
                >
                  초기화
                </button>
                <button
                  type="button"
                  onClick={() => setIsChatPreviewOpen(false)}
                  className="text-xs text-gray-400 hover:text-gray-200 transition-colors"
                >
                  닫기
                </button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* 미리보기 모달 */}
      <Dialog open={isPreviewOpen} onOpenChange={setIsPreviewOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>캐릭터 미리보기</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <CharacterCard character={previewCharacter} onCardClick={() => {}} />
            </div>
            <div className="text-sm text-gray-600 space-y-2">
              <div><span className="font-medium">이름:</span> {formData.basic_info.name || '—'}</div>
              <div><span className="font-medium">설명:</span> {(formData.basic_info.user_display_description || formData.basic_info.description || '').slice(0, 200) || '—'}</div>
              <div><span className="font-medium">공개 설정:</span> {formData.publish_settings.is_public ? '공개' : '비공개'}</div>
              <div className="text-xs text-gray-400">실제 저장 후 웹 전체 카드와 동일한 레이아웃으로 표시됩니다.</div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* 크롭 모달 */}
      <AvatarCropModal
        isOpen={isCropOpen}
        src={cropSrc}
        outputSize={1024}
        onCancel={() => { try { URL.revokeObjectURL(cropSrc); } catch(_){} setCropSrc(''); setIsCropOpen(false); }}
        onConfirm={async (croppedFile) => {
          setIsCropOpen(false);
          setIsUploading(true);
          try {
            const res = await filesAPI.uploadImages([croppedFile]);
            const uploadedUrl = Array.isArray(res.data) ? res.data[0] : res.data;
            /**
             * ✅ 대표이미지 업로드 반영(요구사항):
             * - 프로필 탭에서 대표이미지(avatar_url)를 바로 설정할 수 있어야 한다.
             * - 동시에 갤러리(image_descriptions)에도 포함시켜 상세/카드/미리보기에서 동일하게 활용한다.
             */
            setFormData(prev => {
              const existing = Array.isArray(prev?.media_settings?.image_descriptions)
                ? prev.media_settings.image_descriptions
                : [];
              const merged = [
                ...existing.map((x) => String(x?.url || '').trim()).filter(Boolean),
                String(uploadedUrl || '').trim(),
              ].filter(Boolean);
              // ✅ 메타 보존 + 신규 기본 공개
              const byUrl = new Map(existing.map((x) => [String(x?.url || '').trim(), x]));
              const dedup = Array.from(new Set(merged))
                .map((url) => {
                  const u = String(url || '').trim();
                  const found = byUrl.get(u);
                  if (found) return found;
                  return { url: u, description: '', is_public: true };
                })
                .filter((x) => String(x?.url || '').trim());
              return ({
                ...prev,
                media_settings: {
                  ...prev.media_settings,
                  avatar_url: String(uploadedUrl || '').trim(),
                  image_descriptions: dedup,
                },
              });
            });
          } catch (err) {
            console.error('이미지 업로드 실패:', err);
            dispatchToast('error', '이미지 업로드에 실패했습니다. 잠시 후 다시 시도해주세요.');
          } finally {
            setIsUploading(false);
            try { URL.revokeObjectURL(cropSrc); } catch(_){}
            setCropSrc('');
          }
        }}
      />
      {/* 이미지 생성/삽입 모달 (수정 모드) */}
      <ImageGenerateInsertModal
        open={imgModalOpen}
        onClose={(result)=>{
          setImgModalOpen(false);
          if (!result) return;
          const { attached, gallery, focusUrl } = result;
          if (attached && isEditMode) {
            try {
              mediaAPI.listAssets({ entityType: 'character', entityId: characterId, presign: true, expiresIn: 300 }).then((res)=>{
                const items = Array.isArray(res.data?.items) ? res.data.items : [];
                const urls = items.map(it => it.url).filter(Boolean);
                setFormData(prev => ({
                  ...prev,
                  media_settings: {
                    ...prev.media_settings,
                    avatar_url: urls[0] || prev.media_settings.avatar_url,
                    image_descriptions: urls.map(u => ({ url: u, description: '', is_public: true })),
                  }
                }));
              });
            } catch(_) {}
          } else if (Array.isArray(gallery) && gallery.length) {
            applyGeneratedImages(gallery, focusUrl);
          }
        }}
        entityType={isEditMode ? 'character' : undefined}
        entityId={isEditMode ? characterId : undefined}
        initialGallery={formData.media_settings.image_descriptions.map((img, idx) => ({
          id: `form:${idx}`,
          url: img.url,
        }))}
      />
      {/* 태그 선택 모달 */}
      <TagSelectModal
        isOpen={isTagModalOpen}
        onClose={() => setIsTagModalOpen(false)}
        allTags={allTags}
        selectedSlugs={selectedTagSlugs}
        onSave={(slugs) => setSelectedTagSlugs(slugs)}
      />

      {/* 이미지 확대 모달 (X 버튼만, 모바일 최적화) */}
      <ImageZoomModal
        open={imageViewerOpen}
        src={imageViewerSrc}
        alt="확대 이미지"
        onClose={() => { try { setImageViewerOpen(false); } catch (_) {} }}
      />

      {/* ✅ 자동생성 덮어쓰기 경고 모달(공통) */}
      <Dialog
        open={autoGenOverwriteConfirmOpen}
        onOpenChange={(v) => {
          // ✅ 닫힐 때만 정리: 확인/취소/바깥클릭/ESC 모두 동일하게 처리
          setAutoGenOverwriteConfirmOpen(!!v);
          if (v) return;
          setAutoGenOverwriteConfirmTargets('');
          autoGenOverwriteConfirmActionRef.current = null;
        }}
      >
        <DialogContent className="bg-[#111111] border border-purple-500/70 text-white max-w-[420px] rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-center text-white text-base font-semibold">
              자동생성 결과로 덮어쓸까요?
            </DialogTitle>
          </DialogHeader>
          <div className="mt-2 text-xs text-gray-400 leading-relaxed">
            현재 입력된 <span className="text-gray-200 font-semibold">{String(autoGenOverwriteConfirmTargets || '내용')}</span>이(가)
            자동생성 결과로 변경될 수 있어요.
          </div>
          <div className="mt-4 space-y-3">
            <button
              type="button"
              onClick={confirmAutoGenOverwrite}
              className="w-full h-11 rounded-md bg-purple-600 text-white font-semibold hover:bg-purple-700 transition-colors"
            >
              덮어쓰기
            </button>
            <button
              type="button"
              onClick={() => {
                setAutoGenOverwriteConfirmOpen(false);
                setAutoGenOverwriteConfirmTargets('');
                autoGenOverwriteConfirmActionRef.current = null;
              }}
              className="w-full h-11 rounded-md bg-gray-800 text-gray-100 font-semibold hover:bg-gray-700 transition-colors"
            >
              취소
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ✅ 작품 컨셉 직접 수정(잠금 해제) 확인 모달 */}
      <Dialog
        open={profileConceptEditConfirmOpen}
        onOpenChange={(v) => {
          // ✅ 닫힐 때만 정리(바깥클릭/ESC 포함)
          try { setProfileConceptEditConfirmOpen(!!v); } catch (_) {}
        }}
      >
        <DialogContent className="bg-[#111111] border border-purple-500/70 text-white max-w-[420px] rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-center text-white text-base font-semibold">
              직접 수정하시겠습니까?
              <br />
              자동생성 시 덮어쓸 수 있습니다.
            </DialogTitle>
          </DialogHeader>
          <div className="mt-4 space-y-3">
            <button
              type="button"
              onClick={() => {
                try { setProfileConceptEditConfirmOpen(false); } catch (_) {}
              }}
              className="w-full h-11 rounded-md bg-purple-900/60 text-white font-semibold hover:bg-purple-900/80 transition-colors"
            >
              취소
            </button>
            <button
              type="button"
              onClick={() => {
                try { setProfileConceptEditConfirmOpen(false); } catch (_) {}
                try { setProfileConceptEditMode(true); } catch (_) {}
              }}
              className="w-full h-11 rounded-md bg-purple-600 text-white font-semibold hover:bg-purple-700 transition-colors"
            >
              확인
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ✅ 프롬프트 동기화 경고 모달 */}
      <Dialog open={promptSyncConfirmOpen} onOpenChange={setPromptSyncConfirmOpen}>
        <DialogContent className="bg-[#111111] border border-purple-500/70 text-white max-w-[380px] rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-center text-white text-base font-semibold">
              프롬프트 내용이 수정될 수 있어요.
              <br />
              동기화할까요?
            </DialogTitle>
          </DialogHeader>
          <div className="mt-2 text-xs text-gray-400 leading-relaxed">
            스탯 동기화는 프롬프트 안의 <span className="text-gray-200 font-semibold">스탯 블록</span>을 최신 값으로 교체합니다.
          </div>
          <div className="mt-4 space-y-3">
            <button
              type="button"
              onClick={() => {
                try { setPromptSyncConfirmOpen(false); } catch (_) {}
                try { setPromptSyncPendingText(''); } catch (_) {}
              }}
              className="w-full h-11 rounded-md bg-purple-900/60 text-white font-semibold hover:bg-purple-900/80 transition-colors"
            >
              취소
            </button>
            <button
              type="button"
              onClick={confirmSyncStatsToPrompt}
              className="w-full h-11 rounded-md bg-purple-600 text-white font-semibold hover:bg-purple-700 transition-colors"
            >
              확인
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ✅ 프롬프트 스탯 블록(관리 영역) 수정/삭제 경고 모달 */}
      <Dialog open={promptStatsBlockGuardOpen} onOpenChange={setPromptStatsBlockGuardOpen}>
        <DialogContent className="bg-[#111111] border border-purple-500/70 text-white max-w-[420px] rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-center text-white text-base font-semibold">
              {promptStatsBlockGuardMode === 'delete'
                ? '스탯 블록을 삭제하려고 해요.'
                : '스탯 블록을 수정하려고 해요.'}
              <br />
              계속할까요?
            </DialogTitle>
          </DialogHeader>
          <div className="mt-2 text-xs text-gray-400 leading-relaxed">
            이 블록은 <span className="text-gray-200 font-semibold">프롬프트 동기화</span>로 관리되는 영역이에요.
            <br />
            직접 수정하면 다음 동기화에서 덮어씌워지거나, 삭제하면 다시 생성될 수 있어요.
          </div>
          <div className="mt-4 space-y-3">
            <button
              type="button"
              onClick={() => {
                try { setPromptStatsBlockGuardOpen(false); } catch (_) {}
                try { setPromptStatsBlockGuardPendingText(''); } catch (_) {}
                try { setPromptStatsBlockGuardMode(''); } catch (_) {}
              }}
              className="w-full h-11 rounded-md bg-purple-900/60 text-white font-semibold hover:bg-purple-900/80 transition-colors"
            >
              취소
            </button>
            <button
              type="button"
              onClick={confirmApplyPromptStatsBlockEdit}
              className="w-full h-11 rounded-md bg-purple-600 text-white font-semibold hover:bg-purple-700 transition-colors"
            >
              계속
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ✅ 프롬프트 → 스탯 적용(덮어쓰기) 확인 모달 */}
      <Dialog open={promptApplyStatsConfirmOpen} onOpenChange={setPromptApplyStatsConfirmOpen}>
        <DialogContent className="bg-[#111111] border border-purple-500/70 text-white max-w-[420px] rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-center text-white text-base font-semibold">
              프롬프트의 스탯 블록을
              <br />
              스탯 탭에 적용할까요?
            </DialogTitle>
          </DialogHeader>
          <div className="mt-2 text-xs text-gray-400 leading-relaxed">
            이 작업은 <span className="text-gray-200 font-semibold">현재 선택된 오프닝의 스탯</span>을
            프롬프트의 스탯 블록 내용으로 <span className="text-gray-200 font-semibold">덮어씌웁니다</span>.
          </div>
          <div className="mt-3 rounded-md bg-black/30 border border-white/10 p-3">
            <div className="text-xs text-gray-400">
              적용될 스탯: <span className="text-gray-200 font-semibold">{Array.isArray(promptApplyStatsPendingStats) ? promptApplyStatsPendingStats.length : 0}</span>개
            </div>
          </div>
          <div className="mt-4 space-y-3">
            <button
              type="button"
              onClick={() => {
                try { setPromptApplyStatsConfirmOpen(false); } catch (_) {}
                try { setPromptApplyStatsPendingStats([]); } catch (_) {}
              }}
              className="w-full h-11 rounded-md bg-purple-900/60 text-white font-semibold hover:bg-purple-900/80 transition-colors"
            >
              취소
            </button>
            <button
              type="button"
              onClick={confirmApplyPromptStatsToStats}
              className="w-full h-11 rounded-md bg-purple-600 text-white font-semibold hover:bg-purple-700 transition-colors"
            >
              적용
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ✅ 프로필: 커스텀 턴수 입력 경고 모달(0~30 포함 50 미만 방지) */}
      <Dialog open={customTurnsWarnOpen} onOpenChange={setCustomTurnsWarnOpen}>
        <DialogContent className="bg-[#111111] border border-purple-500/70 text-white max-w-[420px] rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-center text-white text-base font-semibold">
              진행 턴수를 확인해주세요
            </DialogTitle>
          </DialogHeader>
          <div className="mt-2 text-sm text-gray-300 leading-relaxed">
            {String(customTurnsWarnMessage || '직접입력은 최소 50턴부터 가능합니다.')}
          </div>
          <div className="mt-5">
            <button
              type="button"
              onClick={() => {
                try { setCustomTurnsWarnOpen(false); } catch (_) {}
                try { setCustomTurnsWarnMessage(''); } catch (_) {}
              }}
              className="w-full h-11 rounded-md bg-purple-600 text-white font-semibold hover:bg-purple-700 transition-colors"
            >
              확인
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ✅ 다음단계 자동완성(진행률/상태) 모달 */}
      <Dialog
        open={nextStepAutoFillOpen}
        onOpenChange={(open) => {
          // ✅ 실행 중에는 닫기 방지(중복/중단으로 인한 혼선 방지)
          if (!open && nextStepAutoFillRunningRef.current) return;
          setNextStepAutoFillOpen(open);
        }}
      >
        <DialogContent className="bg-[#111111] border border-gray-700 text-white max-w-[420px] rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-center text-white text-base font-semibold">
              다음단계 자동완성
            </DialogTitle>
          </DialogHeader>

          <div className="mt-2 space-y-3">
            <div className="text-sm text-gray-200 font-semibold">
              {String(nextStepAutoFillLabel || '진행 중...')}
            </div>

            <div className="w-full">
              <div className="h-2 w-full rounded-full bg-white/10 overflow-hidden">
                <div
                  className="h-2 bg-purple-600 transition-[width] duration-300"
                  style={{ width: `${Math.max(0, Math.min(100, Number(nextStepAutoFillProgress) || 0))}%` }}
                />
              </div>
              <div className="mt-1 text-[11px] text-gray-400 flex items-center justify-between">
                <span>{Math.max(0, Math.min(100, Number(nextStepAutoFillProgress) || 0))}%</span>
                {String(nextStepAutoFillError || '').trim() ? (
                  <span className="text-rose-300 font-semibold">오류</span>
                ) : null}
              </div>
            </div>

            {String(nextStepAutoFillError || '').trim() ? (
              <div className="rounded-md border border-rose-500/40 bg-rose-900/15 p-3 text-xs text-rose-200 whitespace-pre-line">
                자동완성에 실패했습니다. 잠시 후 다시 시도해주세요.
              </div>
            ) : null}

            {Array.isArray(nextStepAutoFillSummaryLines) && nextStepAutoFillSummaryLines.length > 0 ? (
              <div className="rounded-xl border border-white/10 bg-black/20 p-4">
                <div className="text-xs font-semibold text-gray-200">이번 자동완성 요약</div>
                <ul className="mt-2 space-y-1 text-xs text-gray-300">
                  {nextStepAutoFillSummaryLines.slice(0, 8).map((ln, idx) => (
                    <li key={`autofill-sum-${idx}`} className="flex items-start gap-2">
                      <span className="mt-[3px] inline-block size-1.5 rounded-full bg-purple-500/80" />
                      <span className="min-w-0 break-words">{String(ln || '')}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div className="pt-2 flex items-center gap-2">
              <button
                type="button"
                onClick={() => setWizardSummaryOpen(true)}
                disabled={nextStepAutoFillRunningRef.current}
                className="flex-1 h-11 rounded-md bg-white/10 text-white font-semibold hover:bg-white/15 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                전체요약 보기
              </button>
              <button
                type="button"
                onClick={() => {
                  // ✅ UX(수정): 확인은 모달만 닫는다. (단계 자동 이동 금지)
                  try { setNextStepAutoFillOpen(false); } catch (_) {}
                }}
                disabled={nextStepAutoFillRunningRef.current}
                className="flex-1 h-11 rounded-md bg-purple-600 text-white font-semibold hover:bg-purple-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-purple-600"
              >
                {nextStepAutoFillRunningRef.current ? '작성 중...' : '확인'}
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ✅ 전체요약 모달: 현재 입력값을 한눈에 보기 */}
      <Dialog open={wizardSummaryOpen} onOpenChange={setWizardSummaryOpen}>
        <DialogContent
          className={[
            // ✅ 모바일: 풀스크린(경쟁사 UX)
            'w-screen h-[100dvh] max-w-none rounded-none p-0',
            // ✅ PC: 중앙 모달 유지
            'sm:w-[calc(100vw-2rem)] sm:h-auto sm:max-w-3xl sm:rounded-2xl sm:p-6',
            // ✅ 기존 모달 톤과 통일(배경/테두리)
            'bg-[#111111] border border-gray-700 text-white',
          ].join(' ')}
        >
          {/* 헤더(고정): 모바일에서도 항상 보이게 */}
          <div className="sticky top-0 z-10 flex items-center justify-between border-b border-white/10 bg-[#111111]/95 px-4 py-3 sm:static sm:border-b-0 sm:bg-transparent sm:px-0 sm:py-0">
            <div className="text-base font-semibold">전체요약</div>
            <button
              type="button"
              onClick={() => setWizardSummaryOpen(false)}
              className="p-2 rounded-full hover:bg-white/10 transition-colors"
              aria-label="닫기"
              title="닫기"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {(() => {
            // ✅ 요약은 "보여주기 전용"이므로, 단순 계산으로 구성한다(KISS).
            const safe = (v) => {
              try { return String(v ?? '').trim(); } catch (_) { return ''; }
            };
            const clip = (v, n) => {
              const s = safe(v);
              if (!s) return '';
              return s.length > n ? `${s.slice(0, n)}…` : s;
            };
            const ss = (formData?.basic_info?.start_sets && typeof formData.basic_info.start_sets === 'object')
              ? formData.basic_info.start_sets
              : null;
            const items = Array.isArray(ss?.items) ? ss.items : [];
            const sel = safe(ss?.selectedId) || safe(items?.[0]?.id);
            const active = items.find((x) => safe(x?.id) === sel) || items[0] || {};
            const audience = (selectedTagSlugs || []).find((s) => REQUIRED_AUDIENCE_SLUGS.includes(s)) || '';
            const style = (selectedTagSlugs || []).find((s) => REQUIRED_STYLE_SLUGS.includes(s)) || '';
            const sim = (ss && typeof ss?.sim_options === 'object' && ss.sim_options) ? ss.sim_options : {};
            const maxTurns = Number.isFinite(Number(sim?.max_turns)) ? Math.floor(Number(sim.max_turns)) : 0;
            const avatar = safe(formData?.media_settings?.avatar_url);
            const imgs = Array.isArray(formData?.media_settings?.image_descriptions) ? formData.media_settings.image_descriptions : [];
            const ends = Array.isArray(active?.ending_settings?.endings) ? active.ending_settings.endings : [];
            const stats = Array.isArray(active?.stat_settings?.stats) ? active.stat_settings.stats : [];
            const turnEvents = Array.isArray(active?.turn_events) ? active.turn_events : [];

            return (
              <div className="px-4 pb-6 pt-3 sm:px-0 sm:pb-0 sm:pt-3 max-h-[calc(100dvh-56px)] sm:max-h-[70vh] overflow-y-auto scrollbar-hide space-y-4">
                <div className="rounded-xl border border-white/10 bg-black/20 p-4 space-y-2">
                  <div className="text-sm font-semibold text-gray-200">프로필</div>
                  <div className="text-xs text-gray-300">- 이름: <span className="text-gray-100 font-semibold">{safe(formData?.basic_info?.name) || '-'}</span></div>
                  <div className="text-xs text-gray-300">- 성향/스타일: <span className="text-gray-100 font-semibold">{audience || '-'}</span> / <span className="text-gray-100 font-semibold">{style || '-'}</span></div>
                  <div className="text-xs text-gray-300">- 진행 턴수: <span className="text-gray-100 font-semibold">{maxTurns ? `${maxTurns}턴` : '-'}</span></div>
                  <div className="text-xs text-gray-300">- 소개: <span className="text-gray-100">{clip(formData?.basic_info?.description, 180) || '-'}</span></div>
                </div>

                <div className="rounded-xl border border-white/10 bg-black/20 p-4 space-y-2">
                  <div className="text-sm font-semibold text-gray-200">프롬프트</div>
                  <div className="text-xs text-gray-300 whitespace-pre-line break-words">{clip(formData?.basic_info?.world_setting, 240) || '(비어있음)'}</div>
                </div>

                <div className="rounded-xl border border-white/10 bg-black/20 p-4 space-y-2">
                  <div className="text-sm font-semibold text-gray-200">이미지</div>
                  <div className="text-xs text-gray-300">- 기본 이미지(대표): <span className="text-gray-100 font-semibold">{avatar ? '등록됨' : '없음'}</span></div>
                  <div className="text-xs text-gray-300">- 상황별 이미지: <span className="text-gray-100 font-semibold">{imgs.length}장</span></div>
                </div>

                <div className="rounded-xl border border-white/10 bg-black/20 p-4 space-y-2">
                  <div className="text-sm font-semibold text-gray-200">오프닝(선택)</div>
                  <div className="text-xs text-gray-300">- 오프닝명: <span className="text-gray-100 font-semibold">{safe(active?.title) || '오프닝'}</span></div>
                  <div className="text-xs text-gray-300">- 첫 상황: <span className="text-gray-100">{clip(active?.intro, 180) || '-'}</span></div>
                  <div className="text-xs text-gray-300">- 첫 대사: <span className="text-gray-100">{clip(active?.firstLine, 120) || '-'}</span></div>
                  <div className="text-xs text-gray-300">- 턴 사건: <span className="text-gray-100 font-semibold">{turnEvents.length}개</span></div>
                </div>

                <div className="rounded-xl border border-white/10 bg-black/20 p-4 space-y-2">
                  <div className="text-sm font-semibold text-gray-200">스탯(선택 오프닝)</div>
                  <div className="text-xs text-gray-300">- 개수: <span className="text-gray-100 font-semibold">{stats.length}개</span></div>
                  {stats.length ? (
                    <div className="text-xs text-gray-300">- 목록: <span className="text-gray-100">{stats.map((s) => safe(s?.name)).filter(Boolean).slice(0, 6).join(', ') || '-'}</span></div>
                  ) : null}
                </div>

                <div className="rounded-xl border border-white/10 bg-black/20 p-4 space-y-2">
                  <div className="text-sm font-semibold text-gray-200">엔딩(선택 오프닝)</div>
                  <div className="text-xs text-gray-300">- 개수: <span className="text-gray-100 font-semibold">{ends.length}개</span></div>
                  {ends.length ? (
                    <>
                      <div className="text-xs text-gray-300">- 1번 제목: <span className="text-gray-100 font-semibold">{safe(ends[0]?.title) || '-'}</span></div>
                      <div className="text-xs text-gray-300">- 기본조건: <span className="text-gray-100">{clip(ends[0]?.base_condition, 160) || '-'}</span></div>
                      <div className="text-xs text-gray-300">- 에필로그: <span className="text-gray-100 font-semibold">{safe(ends[0]?.epilogue) ? '있음' : '없음'}</span></div>
                    </>
                  ) : null}
                </div>

                <div className="rounded-xl border border-white/10 bg-black/20 p-4 space-y-2">
                  <div className="text-sm font-semibold text-gray-200">디테일/비밀정보</div>
                  <div className="text-xs text-gray-300">- 성격: <span className="text-gray-100">{clip(formData?.basic_info?.personality, 160) || '-'}</span></div>
                  <div className="text-xs text-gray-300">- 말투: <span className="text-gray-100">{clip(formData?.basic_info?.speech_style, 140) || '-'}</span></div>
                  <div className="text-xs text-gray-300">- 비밀정보: <span className="text-gray-100">{safe(formData?.basic_info?.introduction_scenes?.[0]?.secret) ? '있음' : '없음'}</span></div>
                </div>

                <div className="rounded-xl border border-white/10 bg-black/20 p-4 space-y-2">
                  <div className="text-sm font-semibold text-gray-200">크리에이터 코멘트</div>
                  <div className="text-xs text-gray-300 whitespace-pre-line break-words">{clip(formData?.basic_info?.user_display_description, 220) || '(비어있음)'}</div>
                </div>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>

      {/* ✅ 턴수별 사건 자동 생성 덮어쓰기 확인 모달 */}
      <Dialog open={turnEventsGenConfirmOpen} onOpenChange={setTurnEventsGenConfirmOpen}>
        <DialogContent className="bg-[#111111] border border-purple-500/70 text-white max-w-[420px] rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-center text-white text-base font-semibold">
              기존 턴수별 사건이 있어요.
              <br />
              덮어쓸까요?
            </DialogTitle>
          </DialogHeader>
          <div className="mt-2 text-xs text-gray-400 leading-relaxed">
            자동 생성 결과로 <span className="text-gray-200 font-semibold">현재 사건 목록이 교체</span>됩니다.
          </div>
          <div className="mt-4 space-y-3">
            <button
              type="button"
              onClick={() => {
                try { setTurnEventsGenConfirmOpen(false); } catch (_) {}
                try { setTurnEventsGenPendingSetId(''); } catch (_) {}
                try { setTurnEventsGenPendingEvents([]); } catch (_) {}
              }}
              className="w-full h-11 rounded-md bg-purple-900/60 text-white font-semibold hover:bg-purple-900/80 transition-colors"
            >
              취소
            </button>
            <button
              type="button"
              onClick={() => {
                try {
                  const sid = String(turnEventsGenPendingSetId || '').trim();
                  const events = Array.isArray(turnEventsGenPendingEvents) ? turnEventsGenPendingEvents : [];
                  if (!sid || !events.length) {
                    dispatchToast('error', '적용할 사건 데이터가 없습니다. 다시 시도해주세요.');
                    try { setTurnEventsGenConfirmOpen(false); } catch (_) {}
                    return;
                  }
                  updateStartSets((prev) => {
                    const cur = (prev && typeof prev === 'object') ? prev : {};
                    const curItems = Array.isArray(cur.items) ? cur.items : [];
                    const nextItems = curItems.map((x) => {
                      const xid = String(x?.id || '').trim();
                      if (xid !== sid) return x;
                      return { ...(x || {}), turn_events: events };
                    });
                    const nextSelected = String(cur.selectedId || '').trim() || sid;
                    return { ...cur, selectedId: nextSelected, items: nextItems };
                  });
                  dispatchToast('success', '턴수별 사건이 자동 생성 결과로 교체되었습니다.');
                } catch (e) {
                  console.error('[CreateCharacterPage] apply turn events overwrite failed:', e);
                  dispatchToast('error', '적용 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.');
                } finally {
                  try { setTurnEventsGenConfirmOpen(false); } catch (_) {}
                  try { setTurnEventsGenPendingSetId(''); } catch (_) {}
                  try { setTurnEventsGenPendingEvents([]); } catch (_) {}
                }
              }}
              className="w-full h-11 rounded-md bg-purple-600 text-white font-semibold hover:bg-purple-700 transition-colors"
            >
              덮어쓰기
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default CreateCharacterPage; 