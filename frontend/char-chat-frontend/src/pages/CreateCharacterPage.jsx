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
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Textarea } from '../components/ui/textarea';
import { Switch } from '../components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Alert, AlertDescription } from '../components/ui/alert';
// 탭 컴포넌트 제거(롱폼 전환)
import { Badge } from '../components/ui/badge';
import { Separator } from '../components/ui/separator';
import { 
  ArrowLeft,
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
  ChevronDown,
  ChevronUp
} from 'lucide-react';
import { StoryImporterModal } from '../components/StoryImporterModal'; // StoryImporterModal 컴포넌트 추가
import AvatarCropModal from '../components/AvatarCropModal';
import TagSelectModal from '../components/TagSelectModal';
import ImageGenerateInsertModal from '../components/ImageGenerateInsertModal';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../components/ui/dialog';
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
      // - "사용자용 설명"은 기본적으로 별도 작성(ON)으로 간주한다.
      // - UI에서는 "크리에이터 코멘트"로 노출하며, 생성(Create) 시 필수 입력으로 검증한다.
      use_custom_description: true,
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
        // ✅ 옵션(신규/SSOT): 스토리 진행 턴수(기본 200) + 무한모드 허용
        // - start_sets는 "위저드 전용 JSON 저장소"이므로, 별도 DB 스키마 없이도 안전하게 확장 가능
        sim_options: {
          mode: 'preset', // 'preset' | 'custom'
          max_turns: 200,
          allow_infinite_mode: false,
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
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  // ✅ 위저드 전용: 채팅 미리보기(모바일 화면) - 최대 10회(유저 메시지 기준)
  const [isChatPreviewOpen, setIsChatPreviewOpen] = useState(false);
  const [chatPreviewInput, setChatPreviewInput] = useState('');
  const [chatPreviewMessages, setChatPreviewMessages] = useState([]); // [{id:string, role:'user'|'assistant', content:string}]
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
  const detailPrefsInitRef = useRef(false);
  // ✅ 비밀정보(프롬프트 하단) 토글: ON일 때만 입력/자동생성 UI 노출
  const [isSecretInfoEnabled, setIsSecretInfoEnabled] = useState(false);

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
  // - {{assistant}}: 레거시 호환(기존 데이터/입력 지원)
  const TOKEN_CHARACTER = '{{character}}';
  const TOKEN_ASSISTANT = '{{assistant}}';
  const TOKEN_USER = '{{user}}';
  const ALLOWED_TOKENS = [TOKEN_ASSISTANT, TOKEN_CHARACTER, TOKEN_USER];
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
    const allowedTokens = [TOKEN_ASSISTANT, TOKEN_CHARACTER, TOKEN_USER];
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
        name: z.string().min(1, '캐릭터 이름을 입력하세요'),
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
    // ✅ 경쟁사 키워드북 유사: 설정집(설정집 1/2... + 트리거 + 노트)
    { id: 'setting_book', label: '설정집' },
    // ✅ 경쟁사 구조: 오프닝(시작 설정) 옆에 엔딩 설정 탭
    { id: 'ending', label: '엔딩' },
    { id: 'options', label: '옵션' },
    { id: 'detail', label: '디테일' },
  ];
  const [normalWizardStep, setNormalWizardStep] = useState('profile');

  useEffect(() => {
    if (!useNormalCreateWizard) return;
    const ok = NORMAL_CREATE_WIZARD_STEPS.some((s) => s.id === normalWizardStep);
    if (!ok) setNormalWizardStep('profile');
  }, [useNormalCreateWizard, normalWizardStep]);

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
      if (normalWizardStep === 'profile') {
        const nameOk = !!String(formData?.basic_info?.name || '').trim();
        const descOk = !!String(formData?.basic_info?.description || '').trim();
        const audienceOk = (selectedTagSlugs || []).some((s) => REQUIRED_AUDIENCE_SLUGS.includes(s));
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
        return nameOk && descOk && audienceOk && turnsOk && imageOk;
      }
      if (normalWizardStep === 'prompt') {
        // 프롬프트(= 기존 world_setting) 최소 1자
        return !!String(formData?.basic_info?.world_setting || '').trim();
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
        return !!String(picked?.firstLine || '').trim();
      }
      return true;
    } catch (_) {
      return false;
    }
  }, [useNormalCreateWizard, normalWizardStep, formData, selectedTagSlugs]);

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

      // ✅ UX: 먼저 다음 단계로 이동(사용자가 채워지는 걸 바로 확인 가능)
      try { setNormalWizardStep(nextId); } catch (_) {}

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
        // ✅ 자동완성 대상 없음 → 그냥 이동(모달로 방해하지 않음)
        try { setNextStepAutoFillOpen(false); } catch (_) {}
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
        setNextStepAutoFillProgress(100);
        setNextStepAutoFillLabel('스탯은 보통 “프롬프트 자동 생성”과 함께 채워져요. (필요하면 스탯 탭에서 수정해주세요)');
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

        const aiModel = String(user?.preferred_model || 'claude').trim().toLowerCase() || 'claude';
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
            const draftRes = await charactersAPI.quickGenerateEndingDraft({
              name: nm,
              description: ds,
              world_setting: wd,
              opening_intro: openingIntro,
              opening_first_line: openingFirstLine,
              max_turns: Math.max(50, maxTurns || 200),
              min_turns: Math.max(10, minTurns || 30),
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
            title,
            base_condition: cond,
            hint: hint || '',
            epilogue: epilogue || '',
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
        setNextStepAutoFillProgress(100);
        setNextStepAutoFillLabel('이 단계는 자동완성할 항목이 없어요.');
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
      const firstLineOk = (() => {
        const ss = formData?.basic_info?.start_sets;
        const items = Array.isArray(ss?.items) ? ss.items : [];
        const sel = String(ss?.selectedId || '').trim();
        const picked = items.find((x) => String(x?.id || '').trim() === sel) || items[0] || {};
        return !!String(picked?.firstLine || '').trim();
      })();

      if (step === 'profile') {
        if (!nameOk) return '프로필에서 캐릭터 이름을 먼저 입력해주세요.';
        if (!audienceOk) return '프로필에서 남성향/여성향/전체 중 하나를 먼저 선택해주세요.';
        if (!descOk) return '프로필에서 캐릭터소개를 먼저 입력해주세요.';
        if (!profileImageOk) return '프로필에서 대표 이미지를 먼저 등록해주세요.';
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

  const resetChatPreview = useCallback(() => {
    try { chatPreviewEpochRef.current += 1; } catch (_) {}
    setChatPreviewMessages([]);
    setChatPreviewInput('');
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

  useEffect(() => {
    /**
     * ✅ 경쟁사 방식(가장 안정적): 위저드 입력값이 바뀌면 채팅 프리뷰를 항상 0/10으로 리셋
     *
     * 의도/원리:
     * - 프리뷰 채팅은 "현재 입력 폼 스냅샷"에 종속된 임시 세션이다.
     * - 입력값이 1글자라도 바뀌면(태그/이미지/성향 포함) 기존 프리뷰 대화는 더 이상 일관성을 보장할 수 없으므로 폐기한다.
     * - 따라서 모든 변경을 동일하게 처리: intro/firstLine만 다시 보여주고, 대화 턴은 0으로 초기화한다.
     */
    if (!useNormalCreateWizard) return;
    try { refreshChatPreviewSnapshot(); } catch (_) {}
    // ✅ 중요: 프리뷰 채팅 입력(chatPreviewInput) 자체는 "위저드 입력값"이 아니다.
    // - chatPreviewInput을 의존/참조하면, 프리뷰에 타이핑하는 순간 입력이 리셋되는 UX 버그가 발생한다.
    // - 따라서 위저드 폼(formData/태그/디테일) 변경에만 반응해 프리뷰를 리셋한다.
    try { resetChatPreview(); } catch (_) {}
  }, [useNormalCreateWizard, formData, selectedTagSlugs, detailPrefs, refreshChatPreviewSnapshot, resetChatPreview]);

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
        const payload = {
          character_data: previewCharacterData,
          user_message: msg,
          history: historyTurns,
          response_length_pref: 'short',
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
  const [quickSecretGenLoading, setQuickSecretGenLoading] = useState(false);
  const [quickEndingEpilogueGenLoadingId, setQuickEndingEpilogueGenLoadingId] = useState('');
  const [quickEndingBulkGenLoading, setQuickEndingBulkGenLoading] = useState(false);
  const handleAutoGenerateDetail = useCallback(async () => {
    /**
     * 디테일 자동 생성(요구사항):
     * - 프롬프트(world_setting)가 필수
     * - 관심사/좋아하는 것/싫어하는 것: 키워드 3개씩(칩)
     * - 성격/말투도 함께 채움
     */
    if (quickDetailGenLoading) return;
    try {
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

      setQuickDetailGenLoading(true);
      const aiModel = String(user?.preferred_model || 'claude').trim().toLowerCase() || 'claude';
      const res = await charactersAPI.quickGenerateDetailDraft({
        name,
        description: desc,
        world_setting: world,
        tags: Array.isArray(selectedTagSlugs) ? selectedTagSlugs : [],
        ai_model: (aiModel === 'gpt' ? 'gpt' : (aiModel === 'gemini' ? 'gemini' : 'claude')),
      });

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
          personality: nextPersonality.slice(0, 2000),
          speech_style: nextSpeech.slice(0, 2000),
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
  }, [quickDetailGenLoading, formData, selectedTagSlugs, user]);

  const handleAutoGenerateSecretInfo = useCallback(async () => {
    /**
     * ✅ 비밀정보 자동 생성(요구사항):
     * - 프롬프트(world_setting)가 작성되어 있어야 실행한다.
     * - 생성 결과는 '비밀정보(secret)' 입력칸에 반영한다.
     */
    if (quickSecretGenLoading) return;
    try {
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

      setQuickSecretGenLoading(true);
      const aiModel = String(user?.preferred_model || 'claude').trim().toLowerCase() || 'claude';
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
  }, [quickSecretGenLoading, formData, selectedTagSlugs, user]);

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

    // 3) ✅ 생성(Create) 필수 입력 검증(요구사항)
    // 필수: 이미지/캐릭터이름/필수태그/캐릭터설명/세계관설정/크리에이터 코멘트
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

        if (!String(formData?.basic_info?.description || '').trim()) {
          map['basic_info.description'] = '캐릭터 설명을 입력하세요.';
        }
        if (!String(formData?.basic_info?.world_setting || '').trim()) {
          map['basic_info.world_setting'] = '세계관 설정을 입력하세요.';
        }
        if (!String(formData?.basic_info?.user_display_description || '').trim()) {
          map['basic_info.user_display_description'] = '크리에이터 코멘트를 입력하세요.';
        }
      }
    } catch (_) {}

    const ok = Object.keys(map).length === 0;
    setFieldErrors(map);
    if (ok) return { success: true, data: result.success ? result.data : formData };
    return { success: false, errors: map };
  }, [formData, validationSchema, isEditMode, selectedTagSlugs, isOrigChatCharacter]);

  // 입력 디바운스 검증
  useEffect(() => {
    const t = setTimeout(() => {
      try { validateForm(); } catch (_) {}
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
  }, [formData, selectedTagSlugs, isEditMode, characterId, draftRestored, isDraftEnabled]);

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

  // 폼 변경 시 이탈 경고 플래그 설정
  useEffect(() => {
    setHasUnsavedChanges(true);
  }, [formData]);

  // 브라우저 이탈 경고
  useEffect(() => {
    const handler = (e) => {
      if (hasUnsavedChanges) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [hasUnsavedChanges]);

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
    // 이미지, 이름, 필수태그, 캐릭터설명, 세계관설정, 크리에이터 코멘트
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
      if (!String(formData.basic_info.user_display_description || '').trim()) errors.basic += 1;
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

      const characterData = {
        ...formData,
        basic_info: {
          ...formData.basic_info,
          description: safeDescription,
          personality: safePersonality,
          user_display_description: safeUserDisplay,
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
              if (s === 'basic_info.name') return '캐릭터 이름';
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
    const nextPersonality = clip(data?.personality, 2000) || '';
    const nextSpeech = clip(data?.speech_style, 2000) || '';
    const nextUserDisplay = clip(data?.user_display_description, 3000) || '';
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
  // ✅ 프롬프트(시뮬레이터): "자동 생성" 버튼
  const [quickPromptGenLoading, setQuickPromptGenLoading] = useState(false);
  // ✅ 첫시작(도입부+첫대사): "자동 생성" 버튼 (선택 세트에만 적용)
  const [quickFirstStartGenLoadingId, setQuickFirstStartGenLoadingId] = useState('');
  // ✅ 턴수별 사건(오프닝 내): "자동 생성" 버튼 (선택 세트에만 적용)
  const [quickTurnEventsGenLoadingId, setQuickTurnEventsGenLoadingId] = useState('');
  const [turnEventsGenConfirmOpen, setTurnEventsGenConfirmOpen] = useState(false);
  const [turnEventsGenPendingSetId, setTurnEventsGenPendingSetId] = useState('');
  const [turnEventsGenPendingEvents, setTurnEventsGenPendingEvents] = useState([]);

  const handleAutoGenerateFirstStart = useCallback(async (targetSetId) => {
    /**
     * 첫시작 자동 생성(요구사항):
     * - 프롬프트(world_setting)가 작성되어 있어야 실행한다.
     * - (도입부=서술형 지문) + (첫대사=캐릭터 발화) 를 분리해서 start_sets에 채운다.
     */
    const sid = String(targetSetId || '').trim();
    if (!sid) return null;
    if (quickFirstStartGenLoadingId) return null;
    try {
      const name = String(formData?.basic_info?.name || '').trim();
      const desc = String(formData?.basic_info?.description || '').trim();
      const world = String(formData?.basic_info?.world_setting || '').trim();
      if (!name || !desc) {
        dispatchToast('error', '프로필 정보를 먼저 입력해주세요.');
        return null;
      }
      if (!world) {
        dispatchToast('error', '프롬프트 정보를 먼저 입력해주세요.');
        return null;
      }

      setQuickFirstStartGenLoadingId(sid);
      const aiModel = String(user?.preferred_model || 'claude').trim().toLowerCase() || 'claude';
      const res = await charactersAPI.quickGenerateFirstStartDraft({
        name,
        description: desc,
        world_setting: world,
        tags: Array.isArray(selectedTagSlugs) ? selectedTagSlugs : [],
        ai_model: (aiModel === 'gpt' ? 'gpt' : (aiModel === 'gemini' ? 'gemini' : 'claude')),
      });

      const intro = String(res?.data?.intro || '').trim();
      const firstLine = String(res?.data?.first_line || '').trim();
      if (!intro || !firstLine) {
        dispatchToast('error', '첫시작 생성 결과가 비어있습니다. 잠시 후 다시 시도해주세요.');
        return null;
      }

      updateStartSets((prev) => {
        const cur = (prev && typeof prev === 'object') ? prev : {};
        const curItems = Array.isArray(cur.items) ? cur.items : [];
        const nextItems = curItems.map((x) => {
          const xid = String(x?.id || '').trim();
          if (xid !== sid) return x;
          return { ...(x || {}), intro, firstLine };
        });
        const nextSelected = String(cur.selectedId || '').trim() || sid;
        return { ...cur, selectedId: nextSelected, items: nextItems };
      });

      try { refreshChatPreviewSnapshot(); } catch (_) {}
      dispatchToast('success', '첫시작(도입부+첫대사)이 자동 생성되었습니다. 내용을 확인해주세요.');
      return { intro, firstLine };
    } catch (e) {
      console.error('[CreateCharacterPage] quick-generate-first-start failed:', e);
      dispatchToast('error', '첫시작 자동 생성에 실패했습니다. 잠시 후 다시 시도해주세요.');
      return null;
    } finally {
      setQuickFirstStartGenLoadingId('');
    }
  }, [quickFirstStartGenLoadingId, formData, selectedTagSlugs, user, updateStartSets, refreshChatPreviewSnapshot]);

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
      setQuickTurnEventsGenLoadingId(sid);
      const aiModel = String(user?.preferred_model || 'claude').trim().toLowerCase() || 'claude';
      const res = await charactersAPI.quickGenerateTurnEventsDraft({
        name,
        description: desc,
        world_setting: world,
        opening_intro: openingIntro,
        opening_first_line: openingFirstLine,
        max_turns: maxTurns,
        tags: Array.isArray(selectedTagSlugs) ? selectedTagSlugs : [],
        ai_model: (aiModel === 'gpt' ? 'gpt' : (aiModel === 'gemini' ? 'gemini' : 'claude')),
      });

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
  }, [quickTurnEventsGenLoadingId, formData, selectedTagSlugs, user, updateStartSets]);

  const handleAutoGeneratePromptOnlyForNextStepAutoFill = useCallback(async () => {
    /**
     * ✅ 다음단계 자동완성 전용: "프롬프트(world_setting)만" 자동 생성
     *
     * 의도/원리:
     * - 기존 `handleAutoGeneratePrompt`는 프롬프트 생성과 함께 스탯/디테일까지 자동 채움(올인원)으로 동작한다.
     * - 하지만 자동완성 요구사항은 "한 글자라도 입력 흔적이 있으면 자동완성 금지"이므로,
     *   다음 단계 자동완성에서는 world_setting만 채우고 다른 필드는 절대 건드리지 않는다.
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
      if (!name || !desc) {
        dispatchToast('error', '프로필 정보를 먼저 입력해주세요.');
        return null;
      }

      const aiModel = String(user?.preferred_model || 'claude').trim().toLowerCase() || 'claude';
      const ss = (formData?.basic_info?.start_sets && typeof formData.basic_info.start_sets === 'object')
        ? formData.basic_info.start_sets
        : null;
      const sim = (ss && typeof ss.sim_options === 'object' && ss.sim_options) ? ss.sim_options : {};
      const maxTurnsRaw = Number(sim?.max_turns ?? 200);
      const maxTurns = Number.isFinite(maxTurnsRaw) && maxTurnsRaw >= 50 ? Math.floor(maxTurnsRaw) : 200;
      const allowInfiniteMode = !!sim?.allow_infinite_mode;

      const res = await charactersAPI.quickGeneratePromptDraft({
        name,
        description: desc,
        mode: (mode === 'simulator' ? 'simulator' : 'roleplay'),
        max_turns: maxTurns,
        allow_infinite_mode: allowInfiniteMode,
        tags: Array.isArray(selectedTagSlugs) ? selectedTagSlugs : [],
        ai_model: (aiModel === 'gpt' ? 'gpt' : (aiModel === 'gemini' ? 'gemini' : 'claude')),
      });

      const promptText = String(res?.data?.prompt || '').trim();
      if (!promptText) {
        dispatchToast('error', '프롬프트 생성 결과가 비어있습니다. 잠시 후 다시 시도해주세요.');
        return null;
      }

      setFormData((prev) => ({
        ...prev,
        basic_info: {
          ...prev.basic_info,
          world_setting: promptText.slice(0, 6000),
        },
      }));
      return { prompt: promptText.slice(0, 6000) };
    } catch (e) {
      try { console.error('[CreateCharacterPage] prompt-only autofill failed:', e); } catch (_) {}
      try { dispatchToast('error', '프롬프트 자동 생성에 실패했습니다. 잠시 후 다시 시도해주세요.'); } catch (_) {}
      return null;
    }
  }, [formData, selectedTagSlugs, user, dispatchToast]);

  const handleAutoGeneratePrompt = useCallback(async () => {
    /**
     * 프롬프트 자동 생성(요구사항):
     * - 프로필(이름/소개) 2개가 모두 입력되어야만 실행한다.
     * - 시뮬레이터/롤플레잉 모드에서만 동작한다. (커스텀은 수동입력)
     * - 생성된 결과를 world_setting(프롬프트)에 채운다.
     */
    if (quickPromptGenLoading) return;
    try {
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

      setQuickPromptGenLoading(true);
      const aiModel = String(user?.preferred_model || 'claude').trim().toLowerCase() || 'claude';
      const ss = (formData?.basic_info?.start_sets && typeof formData.basic_info.start_sets === 'object')
        ? formData.basic_info.start_sets
        : null;
      const sim = (ss && typeof ss.sim_options === 'object' && ss.sim_options) ? ss.sim_options : {};
      const maxTurnsRaw = Number(sim?.max_turns ?? 200);
      const maxTurns = Number.isFinite(maxTurnsRaw) && maxTurnsRaw >= 50 ? Math.floor(maxTurnsRaw) : 200;
      const allowInfiniteMode = !!sim?.allow_infinite_mode;
      const res = await charactersAPI.quickGeneratePromptDraft({
        name,
        description: desc,
        mode: (mode === 'simulator' ? 'simulator' : 'roleplay'),
        max_turns: maxTurns,
        allow_infinite_mode: allowInfiniteMode,
        tags: Array.isArray(selectedTagSlugs) ? selectedTagSlugs : [],
        ai_model: (aiModel === 'gpt' ? 'gpt' : (aiModel === 'gemini' ? 'gemini' : 'claude')),
      });

      const promptText = String(res?.data?.prompt || '').trim();
      if (!promptText) {
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
      const _syncStatsIntoPromptText = (baseText, statsList) => {
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
          // 없으면 마지막에 추가
          return [text.trim(), block].filter(Boolean).join('\n\n').trim().slice(0, 6000);
        } catch (_) {
          return String(baseText || '').slice(0, 6000);
        }
      };

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
            name: String(s?.name || '').trim(),
            min_value: Number.isFinite(Number(s?.min_value)) ? Number(s.min_value) : '',
            max_value: Number.isFinite(Number(s?.max_value)) ? Number(s.max_value) : '',
            base_value: Number.isFinite(Number(s?.base_value)) ? Number(s.base_value) : '',
            unit: String(s?.unit || '').trim(),
            description: String(s?.description || '').trim(),
          }))
          .filter((s) => s.name && s.description)
          .slice(0, HARD_MAX_STATS_PER_OPENING);

        if (normalized.length) {
          // ✅ 자동생성 직후 1회: 프롬프트에도 스탯 블록을 함께 삽입(사용자가 프롬프트에서 확인 가능)
          try {
            const nextPrompt = _syncStatsIntoPromptText(promptText, normalized);
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
        }
      } catch (e3) {
        try { console.error('[CreateCharacterPage] stat auto-fill failed:', e3); } catch (_) {}
      }

      // ✅ 경쟁사 UX: 프롬프트 자동 생성 시 디테일도 함께 자동 생성
      // - 디테일 탭의 "자동 생성" 버튼은 유지하되, 프롬프트 버튼은 올인원으로 동작하게 한다.
      try {
        if (!quickDetailGenLoading) {
          setQuickDetailGenLoading(true);
          const detailRes = await charactersAPI.quickGenerateDetailDraft({
            name,
            description: desc,
            world_setting: promptText,
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
                personality: nextPersonality.slice(0, 2000),
                speech_style: nextSpeech.slice(0, 2000),
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
      } finally {
        try { setQuickDetailGenLoading(false); } catch (_) {}
      }

      dispatchToast('success', '프롬프트/디테일이 자동 생성되었습니다. 내용을 확인해주세요.');
    } catch (e) {
      console.error('[CreateCharacterPage] quick-generate-prompt failed:', e);
      dispatchToast('error', '프롬프트 자동 생성에 실패했습니다. 잠시 후 다시 시도해주세요.');
    } finally {
      setQuickPromptGenLoading(false);
    }
  }, [quickPromptGenLoading, quickDetailGenLoading, formData, selectedTagSlugs, user, setDetailPrefs, setDetailChipInputs]);

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
      // ✅ 경쟁사 UX: 버튼을 누를 때마다 "이름+소개"까지 자동 채움
      // - name/description이 비어도 동작해야 한다.
      // - 백엔드 quick-generate는 name/seed_text가 필수이므로, 비어있을 땐 placeholder + 태그 기반 seed를 사용한다.
      const nameRaw = String(formData?.basic_info?.name || '').trim();
      const descRaw = String(formData?.basic_info?.description || '').trim();
      const audienceSlug = (selectedTagSlugs || []).find((s) => REQUIRED_AUDIENCE_SLUGS.includes(s)) || '';
      const styleSlug = (selectedTagSlugs || []).find((s) => REQUIRED_STYLE_SLUGS.includes(s)) || '';
      // ✅ 이름이 비어있는 초기 상태에서도 "랜덤 생성"이 동작해야 한다.
      // - 백엔드가 name을 필수로 받으므로, 의미없는 placeholder는 '캐릭터'로 통일하고
      //   seed_text에 랜덤성을 강하게 요구한다.
      const name = nameRaw || '캐릭터';
      // ✅ 혼입 방지(요구사항):
      // - 자동 생성은 "완전히 새로" 만들어야 하므로, 기존 소개(descRaw)를 seed로 사용하지 않는다.
      const seedText = [
        `랜덤 시드: ${Date.now()}`,
        '기존에 입력된 이름/소개/설정 문구가 있더라도 참고하거나 이어붙이지 말고, 완전히 새로 작성해줘.',
        '아무 입력이 없어도 캐릭터챗에 적합한 오리지널 캐릭터를 랜덤으로 만들어줘.',
        '이름(고유한 한국어 이름/별명)과 캐릭터 소개(2~4문장, 500자 이내)를 생성해줘.',
        '매번 다른 콘셉트/직업/분위기가 나오게 해줘. 흔한 이름(예: 미정/캐릭터)은 쓰지 마.',
        audienceSlug ? `성향: ${audienceSlug}` : null,
        styleSlug ? `이미지 스타일: ${styleSlug}` : null,
        '형식: 이름은 2~12자, 소개는 2~4문장.',
      ].filter(Boolean).join('\n');

      const firstImageUrl = (() => {
        try {
          const imgs = Array.isArray(formData?.media_settings?.image_descriptions) ? formData.media_settings.image_descriptions : [];
          const first = imgs.find((x) => String(x?.url || '').trim());
          return String(first?.url || '').trim() || null;
        } catch (_) {
          return null;
        }
      })();

      setQuickGenLoading(true);
      const aiModel = String(user?.preferred_model || 'claude').trim().toLowerCase() || 'claude';
      const res = await charactersAPI.quickGenerateCharacterDraft({
        name,
        seed_text: seedText,
        image_url: firstImageUrl,
        tags: Array.isArray(selectedTagSlugs) ? selectedTagSlugs : [],
        ai_model: (aiModel === 'gpt' ? 'gpt' : (aiModel === 'gemini' ? 'gemini' : 'claude')),
      });

      const draft = res?.data || null;
      const bi = draft?.basic_info || {};
      // NOTE: 프로필 자동 생성은 "이름/소개"만 적용한다(다른 탭 영역과 독립 유지).

      setFormData((prev) => {
        // ✅ 요구사항: 프로필 자동 생성은 "프로필(이름/소개)"만 다룬다.
        // - 첫시작(도입부/첫대사)은 별도 영역(start_sets)이며, 여기서 절대 변경하지 않는다.
        return {
          ...prev,
          basic_info: {
            ...prev.basic_info,
            name: String(bi?.name || prev.basic_info.name || '').slice(0, 100),
            description: String(bi?.description || prev.basic_info.description || '').slice(0, 3000),
            // 크리에이터 코멘트는 옵션 탭에서 입력하는 게 기준이므로, 여기서는 기존값 보존
            greeting: prev.basic_info.greeting, // ✅ 첫대사(첫시작) 영역은 변경 금지
            greetings: prev.basic_info.greetings, // 유지(첫시작에서 미러링)
            introduction_scenes: prev.basic_info.introduction_scenes, // 유지(첫시작에서 미러링)
            start_sets: prev.basic_info.start_sets, // ✅ 첫시작(도입부/첫대사) 유지
          },
        };
      });

      try { dispatchToast('success', '자동 생성이 적용되었습니다. 내용을 확인해주세요.'); } catch (_) {}
      // ✅ 요구사항: 생성 직후/다른 곳 클릭 시 채팅 프리뷰 이름이 즉시 바뀌어야 한다.
      // - setFormData 직후 refreshChatPreviewSnapshot은 상태 반영 타이밍 때문에 stale일 수 있어,
      //   서버 응답(bi)을 기준으로 스냅샷을 직접 갱신한다.
      try {
        // ✅ 첫시작(도입부/첫대사)은 건드리지 않고, 이름만 반영한다.
        const nextName = String(bi?.name || formData?.basic_info?.name || '캐릭터').trim() || '캐릭터';
        setChatPreviewSnapshot((prev) => ({ ...prev, name: nextName }));
      } catch (_) {}
    } catch (e) {
      console.error('[CreateCharacterPage] quick-generate failed:', e);
      dispatchToast('error', '자동 생성에 실패했습니다. 잠시 후 다시 시도해주세요.');
    } finally {
      setQuickGenLoading(false);
    }
  }, [quickGenLoading, formData, selectedTagSlugs, user, refreshChatPreviewSnapshot]);


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
            이미지, 캐릭터 이름, 필수 태그, 캐릭터 설명, 세계관 설정, 크리에이터 코멘트
          </div>
          <div className="mt-1 text-xs text-gray-500">그 외 항목은 선택입니다.</div>
        </div>
      )}

      {/* 기존 기본 정보 입력 필드 */}
      <div className="space-y-4">
        {renderExistingImageUploadAndTriggers()}

        <div>
          <Label htmlFor="name">
            캐릭터 이름 <span className="text-red-400 ml-1">*</span>
          </Label>
          <Input
            id="name"
            className="mt-4"
            value={formData.basic_info.name}
            onChange={(e) => updateFormData('basic_info', 'name', e.target.value)}
            onBlur={refreshChatPreviewSnapshot}
            placeholder="캐릭터 이름을 입력하세요"
            required
            maxLength={100}
          />
          <p className="text-sm text-gray-500 mt-1">
            명확하고 기억하기 쉬운 이름을 사용하세요.
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
              <div className="mt-2 grid grid-cols-3 overflow-hidden rounded-lg border border-gray-700/80 bg-gray-900/30">
                {REQUIRED_AUDIENCE_CHOICES.map((opt, idx) => {
                  const selected = Array.isArray(selectedTagSlugs) && selectedTagSlugs.includes(opt.slug);
                  const isLast = idx === REQUIRED_AUDIENCE_CHOICES.length - 1;
                  return (
                    <button
                      key={opt.slug}
                      type="button"
                      onClick={() => toggleExclusiveTag(opt.slug, REQUIRED_AUDIENCE_SLUGS)}
                      aria-pressed={selected}
                      className={`h-10 px-3 text-sm font-medium transition-colors ${
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
              <div className="mt-2 grid grid-cols-4 overflow-hidden rounded-lg border border-gray-700/80 bg-gray-900/30">
                {REQUIRED_STYLE_CHOICES.map((opt, idx) => {
                  const selected = Array.isArray(selectedTagSlugs) && selectedTagSlugs.includes(opt.slug);
                  const isLast = idx === REQUIRED_STYLE_CHOICES.length - 1;
                  return (
                    <button
                      key={opt.slug}
                      type="button"
                      onClick={() => toggleExclusiveTag(opt.slug, REQUIRED_STYLE_SLUGS)}
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
          <Textarea
            id="description"
            data-autogrow="1"
            onInput={handleAutoGrowTextarea}
            className="mt-4 resize-none overflow-hidden"
            value={formData.basic_info.description}
            onChange={(e) => updateFormData('basic_info', 'description', e.target.value)}
            placeholder="캐릭터에 대한 설명입니다 (캐릭터 설명은 다른 사용자에게도 공개 됩니다)"
            rows={3}
            required={!isEditMode}
            maxLength={1000}
          />
          {fieldErrors['basic_info.description'] && (
            <p className="text-xs text-red-500">{fieldErrors['basic_info.description']}</p>
          )}
          <div className="flex items-center gap-2 mt-2">
            <span className="text-xs text-gray-500">토큰 삽입:</span>
            <Button type="button" variant="secondary" size="sm" title="{{character}} 삽입" onClick={() => insertBasicToken('description','description', TOKEN_CHARACTER)}>캐릭터</Button>
            <Button type="button" variant="secondary" size="sm" title="{{user}} 삽입" onClick={() => insertBasicToken('description','description', TOKEN_USER)}>유저</Button>
          </div>
        </div>

        <div>
          <Label htmlFor="personality">성격 및 특징</Label>
          <Textarea
            id="personality"
            data-autogrow="1"
            onInput={handleAutoGrowTextarea}
            className="mt-4 resize-none overflow-hidden"
            value={formData.basic_info.personality}
            onChange={(e) => updateFormData('basic_info', 'personality', e.target.value)}
            placeholder="캐릭터의 성격과 특징을 자세히 설명해주세요"
            rows={4}
            maxLength={2000}
          />
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
          <Label htmlFor="speech_style">말투</Label>
          <Textarea
            id="speech_style"
            data-autogrow="1"
            onInput={handleAutoGrowTextarea}
            className="mt-4 resize-none overflow-hidden"
            value={formData.basic_info.speech_style}
            onChange={(e) => updateFormData('basic_info', 'speech_style', e.target.value)}
            placeholder="캐릭터의 말투를 구체적으로 설명해주세요"
            rows={2}
            maxLength={1000}
          />
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

        {/* ✅ 요구사항: '사용자용 설명' → '크리에이터 코멘트' (생성 Create 시 필수) */}
        <div>
          <Label htmlFor="user_display_description">
            크리에이터 코멘트 {!isEditMode && <span className="text-red-400 ml-1">*</span>}
          </Label>
          <Textarea
            id="user_display_description"
            data-autogrow="1"
            onInput={handleAutoGrowTextarea}
            className="mt-2 resize-none overflow-hidden"
            value={formData.basic_info.user_display_description}
            onChange={(e) => updateFormData('basic_info', 'user_display_description', e.target.value)}
            placeholder="유저에게 보여줄 크리에이터 코멘트를 작성하세요"
            rows={3}
            maxLength={2000}
            required={!isEditMode}
          />
          {fieldErrors['basic_info.user_display_description'] && (
            <p className="text-xs text-red-500">{fieldErrors['basic_info.user_display_description']}</p>
          )}
          <div className="flex items-center gap-2 mt-2">
            <span className="text-xs text-gray-500">토큰 삽입:</span>
            <Button type="button" variant="secondary" size="sm" title="{{character}} 삽입" onClick={() => insertBasicToken('user_display_description','user_display_description', TOKEN_CHARACTER)}>캐릭터</Button>
            <Button type="button" variant="secondary" size="sm" title="{{user}} 삽입" onClick={() => insertBasicToken('user_display_description','user_display_description', TOKEN_USER)}>유저</Button>
          </div>
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
      <div className="space-y-6 p-6">
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
                  <Input
                    value={activeTitleRaw}
                    onChange={(e) => updateSetField(activeId, { title: e.target.value })}
                    onBlur={refreshChatPreviewSnapshot}
                    className="mt-2 bg-gray-950/40 border-white/10 text-white placeholder:text-gray-500"
                    maxLength={100}
                    placeholder={`예: ${activeTitleDisplay}`}
                  />
                  {!String(activeTitleRaw || '').trim() && (
                    <p className="mt-2 text-xs text-red-400 font-semibold">오프닝 이름을 입력해주세요.</p>
                  )}
                </div>

                <div>
                  <Label className="text-white">첫 상황(도입부)</Label>
                  <Textarea
                    data-autogrow="1"
                    onInput={handleAutoGrowTextarea}
                    value={String(activeSet?.intro || '')}
                    onChange={(e) => updateSetField(activeId, { intro: e.target.value })}
                    onBlur={refreshChatPreviewSnapshot}
                    className="mt-2 bg-gray-950/40 border border-white/10 text-white placeholder:text-gray-500 resize-none overflow-hidden"
                    rows={4}
                    maxLength={2000}
                    placeholder="예: 당신은 비 오는 밤, 낡은 서점에서 그를 만난다..."
                  />
                </div>

                <div>
                  <Label className="text-white">첫 대사</Label>
                  <Textarea
                    data-autogrow="1"
                    onInput={handleAutoGrowTextarea}
                    value={String(activeSet?.firstLine || '')}
                    onChange={(e) => updateSetField(activeId, { firstLine: e.target.value })}
                    onBlur={refreshChatPreviewSnapshot}
                    className="mt-2 bg-gray-950/40 border border-white/10 text-white placeholder:text-gray-500 resize-none overflow-hidden"
                    rows={2}
                    maxLength={500}
                    placeholder="예: ...드디어 왔네. 기다리고 있었어."
                  />
                  <div className="mt-3 flex justify-end">
                    <button
                      type="button"
                      onClick={() => handleAutoGenerateFirstStart(activeId)}
                      disabled={quickFirstStartGenLoadingId === activeId}
                      className="h-9 px-3 rounded-lg bg-purple-600 text-white text-sm font-semibold hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
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

                  return (
                    <div className="pt-2">
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
                            disabled={quickTurnEventsGenLoadingId === activeId}
                            className="h-8 px-3 rounded-lg bg-purple-600 text-white text-xs font-semibold hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center"
                            aria-label="턴수별 사건 자동 생성"
                            title="턴수별 사건 자동 생성"
                          >
                            {quickTurnEventsGenLoadingId === activeId ? (
                              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                            ) : (
                              '자동 생성'
                            )}
                          </button>
                        </div>
                      </div>

                      <div className="mt-3 space-y-3">
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
       * - 방어: 입력 흔적이 1글자라도 있으면 비활성화(덮어쓰기 방지)
       * - 프로필/프롬프트/오프닝(첫상황/첫대사) 필수
       */
      try {
        if (quickEndingBulkGenLoading) return false;
        if (String(quickEndingEpilogueGenLoadingId || '').trim()) return false;
        if (hasAnyEndingTrace) return false;
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

    const handleAutoGenerateTwoEndingsInEndingTab = async () => {
      /**
       * ✅ 엔딩탭: 엔딩 2개 자동 생성(요구사항)
       *
       * 원리:
       * - 현재 선택된 오프닝 기준으로 엔딩 2개(제목/기본조건/힌트/턴 + 에필로그)를 생성한다.
       *
       * 방어:
       * - 한 글자라도 입력 흔적이 있으면 절대 실행하지 않는다(덮어쓰기 방지).
       * - 로딩 중 중복 실행 방지.
       */
      if (quickEndingBulkGenLoading) return;
      if (!canAutoGenerateTwoEndings) {
        try {
          if (hasAnyEndingTrace) dispatchToast('info', '이미 입력된 엔딩이 있어 자동 생성이 비활성화되어 있어요.');
          else dispatchToast('error', '프로필/프롬프트/오프닝을 먼저 완성해주세요.');
        } catch (_) {}
        return;
      }
      try {
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

        const aiModel = String(user?.preferred_model || 'claude').trim().toLowerCase() || 'claude';
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
          const baseTitle = String(base?.title || '').trim();
          const baseCond = String(base?.base_condition || '').trim();
          const baseHint = String(base?.hint || '').trim();
          const baseEpilogue = String(base?.epilogue || '').trim();
          const baseExtra = Array.isArray(base?.extra_conditions) ? base.extra_conditions : [];

          // 1) 제목/기본조건(초안)
          let title = baseTitle;
          let cond = baseCond;
          let hint = baseHint;
          let suggestedTurn = 0;
          if (!title || !cond) {
            const draftRes = await charactersAPI.quickGenerateEndingDraft({
              name: nm,
              description: ds,
              world_setting: wd,
              opening_intro: openingIntro,
              opening_first_line: openingFirstLine,
              max_turns: maxTurnsForGen,
              min_turns: minTurnsForGen,
              tags: Array.isArray(selectedTagSlugs) ? selectedTagSlugs : [],
              ai_model: model,
            });
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
              tags: Array.isArray(selectedTagSlugs) ? selectedTagSlugs : [],
              ai_model: model,
            });
            epilogue = String(epRes?.data?.epilogue || '').trim();
          }

          const turnRaw = (base?.turn != null && base?.turn !== '') ? Number(base.turn) : (suggestedTurn || minTurnsForGen);
          const turn = clampTurn(turnRaw);

          built.push({
            id: baseId,
            turn,
            title,
            base_condition: cond,
            hint: hint || '',
            epilogue: epilogue || '',
            extra_conditions: baseExtra,
          });
        }

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
          <div className="text-lg font-semibold text-white">엔딩 설정</div>
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
          <Button
            type="button"
            size="sm"
            disabled={!canAutoGenerateTwoEndings}
            title={hasAnyEndingTrace ? '이미 입력된 엔딩이 있어 자동 생성이 비활성화됩니다' : '엔딩 2개를 자동으로 생성합니다'}
            className={[
              "h-8 px-3",
              quickEndingBulkGenLoading
                ? "bg-gray-800 text-gray-300 cursor-wait"
                : "bg-gray-800 text-gray-200 hover:bg-gray-700",
            ].join(' ')}
            onClick={handleAutoGenerateTwoEndingsInEndingTab}
          >
            {quickEndingBulkGenLoading ? '생성 중...' : '엔딩 2개 자동 생성'}
          </Button>
        </div>

        <div className="space-y-4">
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
                            const aiModel = String(user?.preferred_model || 'claude').trim().toLowerCase() || 'claude';
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
                              tags: Array.isArray(selectedTagSlugs) ? selectedTagSlugs : [],
                              ai_model: (aiModel === 'gpt' ? 'gpt' : (aiModel === 'gemini' ? 'gemini' : 'claude')),
                            });
                            const next = String(res?.data?.epilogue || '').trim();
                            if (!next) { dispatchToast('error', '엔딩 내용 생성 결과가 비어있습니다. 잠시 후 다시 시도해주세요.'); return; }
                            updateEndingAt(eid, { epilogue: next });
                            dispatchToast('success', '엔딩 내용이 자동 생성되었습니다. 내용을 확인해주세요.');
                          } catch (e) {
                            dispatchToast('error', '엔딩 내용 자동 생성에 실패했습니다. 잠시 후 다시 시도해주세요.');
                          } finally {
                            setQuickEndingEpilogueGenLoadingId('');
                          }
                        }}
                      >
                        {String(quickEndingEpilogueGenLoadingId || '') === String(eid || '') ? '생성 중...' : '자동생성'}
                      </Button>
                    </div>
                    <Textarea
                      value={epilogue}
                      maxLength={1000}
                      onChange={(e) => updateEndingAt(eid, { epilogue: e.target.value })}
                      placeholder="엔딩 연출(서술/대사)을 작성해 주세요 (AI가 더 자연스럽게 다듬어줄 예정)"
                      className="bg-gray-950/40 text-white border-white/10 resize-none"
                      rows={8}
                    />
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
        label: `기본 설정 ${idx + 1}`,
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
      <div className="space-y-6 p-6">
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
              const cleaned = arr.map((x) => String(x ?? '').trim()).filter(Boolean).slice(0, 5);
              return cleaned.length ? cleaned : [''];
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
                      <div className="text-xs text-gray-500">이 설정메모가 어떤 오프닝(기본 설정)에 적용될지 선택하세요.</div>
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
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={handleSyncStatsToPrompt}
              disabled={syncDisabled}
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

        <div className="space-y-3">
          {stats.map((st, idx) => {
            const sid = String(st?.id || '').trim() || `stat_${idx + 1}`;
            const name = String(st?.name || '');
            const unit = String(st?.unit || '');
            const desc = String(st?.description || '');
            const minv = (st?.min_value === '' || st?.min_value == null) ? '' : String(st.min_value);
            const maxv = (st?.max_value === '' || st?.max_value == null) ? '' : String(st.max_value);
            const basev = (st?.base_value === '' || st?.base_value == null) ? '' : String(st.base_value);
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
    <div className="p-1 sm:p-3 space-y-3 sm:space-y-4">
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
                      className="w-full h-full object-cover"
                      loading="lazy"
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
        <div className="grid grid-cols-3 overflow-hidden rounded-lg border border-gray-700/80 bg-gray-900/30">
          {REQUIRED_AUDIENCE_CHOICES.map((opt, idx) => {
            const selected = Array.isArray(selectedTagSlugs) && selectedTagSlugs.includes(opt.slug);
            const isLast = idx === REQUIRED_AUDIENCE_CHOICES.length - 1;
            return (
              <button
                key={opt.slug}
                type="button"
                onClick={() => toggleExclusiveTag(opt.slug, REQUIRED_AUDIENCE_SLUGS)}
                aria-pressed={selected}
                className={`h-10 px-3 text-sm font-medium transition-colors ${
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
        {fieldErrors['basic_info.audience_pref'] && (
          <p className="text-xs text-red-400">{fieldErrors['basic_info.audience_pref']}</p>
        )}
      </div>

      {/* ✅ 진행 턴수/무한모드: 프로필 탭(남/여/전체 바로 아래) */}
      {(() => {
        /**
         * ✅ 프로필 탭: 턴수/무한모드 설정
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
        const allowInfinite = !!sim?.allow_infinite_mode;
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
          <div className="rounded-xl border border-gray-800 bg-gray-900/30 p-4">
            <div className="text-sm font-semibold text-gray-200">진행 턴수</div>
            <div className="mt-1 text-xs text-gray-500">스토리 진행 길이를 선택하세요. (커스텀은 최소 50턴)</div>

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

            <div className="mt-4 flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-gray-200">무한모드 별도 허용</div>
                <div className="text-xs text-gray-500 mt-1">곧 도입 예정이에요. (현재는 비활성화)</div>
              </div>
              <Switch
                checked={false}
                disabled
                aria-label="무한모드 별도 허용"
              />
            </div>
            {fieldErrors['basic_info.sim_options.max_turns'] && (
              <p className="mt-3 text-xs text-red-400 font-semibold">{fieldErrors['basic_info.sim_options.max_turns']}</p>
            )}
          </div>
        );
      })()}

      {/* 캐릭터 이름 */}
      <div>
        <Label htmlFor="name">
          캐릭터 이름 <span className="text-red-400 ml-1">*</span>
        </Label>
        <Input
          id="name"
          className="mt-3"
          value={formData.basic_info.name}
          onChange={(e) => updateFormData('basic_info', 'name', e.target.value)}
          onBlur={refreshChatPreviewSnapshot}
          placeholder="캐릭터 이름을 입력하세요"
          required
          maxLength={100}
        />
      </div>

      {/* 캐릭터 소개 */}
      <div>
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="profile_intro">
            캐릭터 소개 <span className="text-red-400 ml-1">*</span>
          </Label>
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
        </div>
        <Textarea
          id="profile_intro"
          data-autogrow="1"
          onInput={handleAutoGrowTextarea}
          className="mt-3 resize-none overflow-hidden"
          value={formData.basic_info.description}
          onChange={(e) => updateFormData('basic_info', 'description', e.target.value)}
          onBlur={refreshChatPreviewSnapshot}
          placeholder="캐릭터를 간단히 소개해주세요."
          rows={5}
          maxLength={3000}
          required={!isEditMode}
        />
        {fieldErrors['basic_info.description'] && (
          <p className="text-xs text-red-500 mt-2">{fieldErrors['basic_info.description']}</p>
        )}
      </div>
    </div>
  );

  const renderExistingImageUploadAndTriggers = () => (
    <>
      {/* 기존: 캐릭터 이미지 업로드 + 이미지 생성 트리거 + 키워드 트리거 */}
      <Card className="p-4 border border-gray-800 bg-gray-900/40 text-gray-100">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-base sm:text-lg font-semibold flex items-center text-gray-100">
            <Image className="w-5 h-5 mr-2" />
            캐릭터 이미지 {!isEditMode && <span className="text-red-400 ml-1">*</span>}
          </h3>
          <Button
            type="button"
            size="sm"
            className="bg-purple-600 hover:bg-purple-700 text-white"
            onClick={() => setImgModalOpen(true)}
          >
            이미지 생성하기
          </Button>
        </div>
        <ErrorBoundary>
          <DropzoneGallery
            tone="dark"
            // ✅ 운영(배포)에서 API_BASE_URL이 `/api`로 끝나면 `/static/*` 이미지가 `/api/static/*`로 잘못 붙어 깨질 수 있다.
            // - 표준 유틸(`resolveImageUrl`)로만 렌더링 URL을 만든다.
            existingImages={formData.media_settings.image_descriptions.map((img) => ({
              url: resolveImageUrl(img?.url),
              description: img?.description,
              // ✅ 기본 공개 (undefined도 공개로 취급)
              is_public: img?.is_public !== false,
            }))}
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
    <div className="p-4 space-y-4">
      <div>
        <div className="text-sm font-semibold text-gray-200">모드</div>
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
      </div>

      <div>
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="world_setting">
            프롬프트 <span className="text-red-400 ml-1">*</span>
          </Label>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleApplyPromptStatsToStats}
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
        <Textarea
          id="world_setting"
          data-autogrow="1"
          data-autogrow-max="520"
          onInput={handleAutoGrowTextarea}
          className="mt-3 resize-none"
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
                updateFormData('basic_info', 'world_setting', nextText.slice(0, 6000));
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
                  setPromptStatsBlockGuardPendingText(nextText.slice(0, 6000));
                  setPromptStatsBlockGuardOpen(true);
                  return;
                }
                updateFormData('basic_info', 'world_setting', nextText.slice(0, 6000));
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
                  setPromptStatsBlockGuardPendingText(nextText.slice(0, 6000));
                  setPromptStatsBlockGuardOpen(true);
                  return;
                }
                updateFormData('basic_info', 'world_setting', nextText.slice(0, 6000));
                return;
              }

              // 3) 블록 외부 변경만 → 정상 반영
              updateFormData('basic_info', 'world_setting', nextText.slice(0, 6000));
            } catch (err) {
              try { console.error('[CreateCharacterPage] world_setting onChange guard failed:', err); } catch (_) {}
              try { updateFormData('basic_info', 'world_setting', String(e?.target?.value || '').slice(0, 6000)); } catch (_) {}
            }
          }}
          placeholder="세계관/관계/규칙/말투 지시 등을 포함해 프롬프트를 작성하세요."
          rows={8}
          maxLength={6000}
          required={!isEditMode}
        />
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
            <Textarea
              id="character_secret_info"
              data-autogrow="1"
              data-autogrow-max="320"
              onInput={handleAutoGrowTextarea}
              className="mt-3 resize-none"
              value={formData?.basic_info?.introduction_scenes?.[0]?.secret || ''}
              onChange={(e) => updateCharacterSecretInfo(e.target.value)}
              placeholder="유저에게는 노출되지 않는 설정(금기/약점/숨겨진 관계/진짜 목적 등)"
              rows={4}
              maxLength={1000}
            />
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
        <div className="grid grid-cols-4 overflow-hidden rounded-lg border border-gray-700/80 bg-gray-900/30">
          {REQUIRED_STYLE_CHOICES.map((opt, idx) => {
            const selected = Array.isArray(selectedTagSlugs) && selectedTagSlugs.includes(opt.slug);
            const isLast = idx === REQUIRED_STYLE_CHOICES.length - 1;
            return (
              <button
                key={opt.slug}
                type="button"
                onClick={() => toggleExclusiveTag(opt.slug, REQUIRED_STYLE_SLUGS)}
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
                    className="w-full h-full object-cover"
                    loading="lazy"
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
      {renderExistingImageUploadAndTriggers()}
    </div>
  );

  const renderOptionsWizardTab = () => (
    <div className="p-4 space-y-4">
      <div>
        <Label htmlFor="user_display_description">
          크리에이터 코멘트 <span className="text-red-400 ml-1">*</span>
        </Label>
        <Textarea
          id="user_display_description"
          data-autogrow="1"
          onInput={handleAutoGrowTextarea}
          className="mt-3 resize-none overflow-hidden"
          value={formData.basic_info.user_display_description}
          onChange={(e) => updateFormData('basic_info', 'user_display_description', e.target.value)}
          placeholder="유저에게 보여줄 크리에이터 코멘트를 작성하세요"
          rows={4}
          maxLength={3000}
          required={!isEditMode}
        />
        {fieldErrors['basic_info.user_display_description'] && (
          <p className="text-xs text-red-500 mt-2">{fieldErrors['basic_info.user_display_description']}</p>
        )}
      </div>

      {/* 공개/비공개 + 태그 */}
      <div className="rounded-xl border border-gray-800 bg-gray-900/30">
        {renderPublishTab()}
      </div>
    </div>
  );

  const renderDetailsWizardTab = () => (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-end">
        <button
          type="button"
          onClick={handleAutoGenerateDetail}
          disabled={quickDetailGenLoading}
          className="h-9 px-3 rounded-lg bg-white/10 text-white text-sm font-semibold hover:bg-white/15 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
          aria-label="디테일 자동 생성"
          title="디테일 자동 생성"
        >
          {quickDetailGenLoading ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            '자동 생성'
          )}
        </button>
      </div>
      <div>
        <Label htmlFor="personality">성격 및 특징</Label>
        <Textarea
          id="personality"
          className="mt-3"
          value={formData.basic_info.personality}
          onChange={(e) => updateFormData('basic_info', 'personality', e.target.value)}
          onBlur={refreshChatPreviewSnapshot}
          placeholder="캐릭터의 성격과 특징을 자세히 설명해주세요"
          rows={4}
          maxLength={2000}
        />
      </div>

      <div>
        <Label htmlFor="speech_style">말투</Label>
        <Textarea
          id="speech_style"
          className="mt-3"
          value={formData.basic_info.speech_style}
          onChange={(e) => updateFormData('basic_info', 'speech_style', e.target.value)}
          onBlur={refreshChatPreviewSnapshot}
          placeholder="캐릭터의 말투를 구체적으로 설명해주세요"
          rows={2}
          maxLength={2000}
        />
      </div>

      <div className="space-y-6">
        {[
          { key: 'interests', label: '관심사', placeholder: '관심사를 입력해주세요.' },
          { key: 'likes', label: '좋아하는 것', placeholder: '좋아하는 것을 입력해주세요.' },
          { key: 'dislikes', label: '싫어하는 것', placeholder: '싫어하는 것을 입력해주세요.' },
        ].map((cfg) => {
          const key = cfg.key;
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
              <div className="text-sm font-semibold text-gray-200">{cfg.label}</div>
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
                  placeholder={cfg.placeholder}
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
                      aria-label={`${cfg.label} 삭제`}
                      title={`${cfg.label} 삭제`}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* 예시대화 */}
      <div className="rounded-xl border border-gray-800 bg-gray-900/30">
        {renderDialoguesTab()}
      </div>
    </div>
  );

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
              <Textarea
                id={`dlg_user_${activeIdx}`}
                className="mt-2 bg-gray-950/40 border-white/10 text-white placeholder:text-gray-500"
                value={String(activeDialogue?.user_message || '')}
                onChange={(e) => updateExampleDialogue(activeIdx, 'user_message', e.target.value)}
                placeholder="사용자가 입력할 만한 메시지를 작성하세요"
                rows={2}
                maxLength={500}
              />
              <div className="flex items-center gap-2 mt-2">
                <span className="text-xs text-gray-400">토큰 삽입:</span>
                <Button type="button" variant="secondary" size="sm" title="{{character}} 삽입" onClick={() => insertDialogueToken(activeIdx, 'user_message', TOKEN_CHARACTER)}>캐릭터</Button>
                <Button type="button" variant="secondary" size="sm" title="{{user}} 삽입" onClick={() => insertDialogueToken(activeIdx, 'user_message', TOKEN_USER)}>유저</Button>
              </div>
            </div>

            <div>
              <Label className="text-white">캐릭터 응답</Label>
              <Textarea
                id={`dlg_char_${activeIdx}`}
                className="mt-2 bg-gray-950/40 border-white/10 text-white placeholder:text-gray-500"
                value={String(activeDialogue?.character_response || '')}
                onChange={(e) => updateExampleDialogue(activeIdx, 'character_response', e.target.value)}
                placeholder="캐릭터가 응답할 내용을 작성하세요"
                rows={3}
                maxLength={1000}
              />
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
              <Link to="/dashboard" className="flex items-center space-x-2">
                <h1 className="text-base sm:text-xl font-bold text-white whitespace-nowrap">캐릭터 만들기</h1>
              </Link>
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
                disabled={loading}
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
                      // ✅ 단계 탭이 PC에서도 아래로 밀리지 않게 크기 축소
                      'relative -mb-px px-1 py-1.5 text-sm sm:text-base font-semibold transition-colors shrink-0',
                      'border-b-2',
                      active
                        ? 'text-white border-purple-500'
                        : 'text-gray-400 border-transparent hover:text-gray-200'
                    ].join(' ')}
                    aria-current={active ? 'page' : undefined}
                  >
                    <span className="inline-flex items-center gap-2">
                      <span>{s.label}</span>
                      {Number(count) > 0 && (
                        <span
                          className={[
                            'inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[11px] font-bold',
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
                onClick={handleNextStepAutoFill}
                disabled={!wizardCanGoNext || wizardStepIndex >= NORMAL_CREATE_WIZARD_STEPS.length - 1 || nextStepAutoFillOpen}
                className={[
                  'h-11 w-full rounded-md font-semibold transition-colors',
                  'bg-gray-800 hover:bg-gray-700 text-gray-100',
                  'disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-gray-800',
                ].join(' ')}
                title="다음 단계로 이동하면서, 자동생성 가능한 항목을 채웁니다"
              >
                다음단계 자동완성
              </button>
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
                <div className="rounded-md bg-[#483136] px-2 text-[11px] text-rose-200">
                  {chatPreviewUserCount} / 10
                </div>
              </div>
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
                    onClick={() => navigate(-1)}
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
                <div className="text-xs text-gray-400">{chatPreviewUserCount}/10</div>
              </div>
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

      {/* 이미지 확대 모달 */}
      <Dialog open={imageViewerOpen} onOpenChange={setImageViewerOpen}>
        <DialogContent className="max-w-4xl p-0 bg-transparent border-none shadow-none">
          <div className="relative w-full h-full flex items-center justify-center" onClick={() => setImageViewerOpen(false)}>
            <img 
              src={imageViewerSrc} 
              alt="확대 이미지" 
              className="max-w-full max-h-[90vh] object-contain mx-auto rounded-lg" 
              onClick={(e) => e.stopPropagation()} 
            />
            <button
              onClick={() => setImageViewerOpen(false)}
              className="absolute top-2 right-2 p-2 bg-black/60 text-white rounded-full hover:bg-black/80 transition-colors"
            >
              <X className="w-5 h-5" />
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
                  // ✅ UX: 자동완성 완료 확인 → 다음 단계로 1번 더 이동
                  // - 자동완성은 이미 "다음 단계" 화면에서 실행되므로,
                  //   확인을 누르면 유저가 흐름을 끊지 않고 계속 진행할 수 있다.
                  try { setNextStepAutoFillOpen(false); } catch (_) {}
                  try {
                    const hasErr = !!String(nextStepAutoFillError || '').trim();
                    const done = (Math.max(0, Math.min(100, Number(nextStepAutoFillProgress) || 0)) >= 100);
                    if (!nextStepAutoFillRunningRef.current && !hasErr && done) {
                      goNextWizardStep();
                    }
                  } catch (_) {}
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