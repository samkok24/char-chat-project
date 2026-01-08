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
  Upload,
  Image,
  Volume2,
  Heart,
  Settings,
  Globe,
  Lock,
  Sparkles,
  BookOpen,
  Mic,
  Palette,
  X,
  Wand2, // Wand2 아이콘 추가
  Eye
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
  const fileInputRef = useRef(null);
  const [cropSrc, setCropSrc] = useState('');
  const [isCropOpen, setIsCropOpen] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

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
        { title: '도입부 1', content: '', secret: '' }
      ],
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
  const [activeSection, setActiveSection] = useState('section-basic');
  const activeSectionRef = useRef('section-basic');
  const [fieldErrors, setFieldErrors] = useState({}); // zod 인라인 오류 맵
  const [draftRestored, setDraftRestored] = useState(false);
  const [isDraftEnabled, setIsDraftEnabled] = useState(false); // '임시저장'을 눌렀을 때만 로컬 초안 저장/복원
  const [imgModalOpen, setImgModalOpen] = useState(false);
  
  // 이미지 확대 모달 상태
  const [imageViewerOpen, setImageViewerOpen] = useState(false);
  const [imageViewerSrc, setImageViewerSrc] = useState('');
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
      const existing = prev.media_settings.image_descriptions || [];
      const merged = [
        ...existing.map(img => img.url),
        ...newUrls,
      ];
      const dedup = Array.from(new Set(merged)).map(url => ({ url, description: '' }));
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

  const { isAuthenticated } = useAuth();
  const [allTags, setAllTags] = useState([]);
  const [selectedTagSlugs, setSelectedTagSlugs] = useState([]);
  const [isTagModalOpen, setIsTagModalOpen] = useState(false);
  // ✅ 원작챗(OrigChat) 캐릭터는 이 페이지에서 "필수 선택 옵션"을 노출하지 않기 위한 플래그
  const [isOrigChatCharacter, setIsOrigChatCharacter] = useState(false);

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

    // 2) ✅ 신규 필수 선택(메타) 검증 - 생성(Create)에서만 강제(기존 편집 안전)
    try {
      if (!isEditMode) {
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

    // 3) ✅ 생성(Create) 필수 입력 검증(요구사항)
    // 필수: 이미지/캐릭터이름/필수태그/캐릭터설명/세계관설정/크리에이터 코멘트
    // - 편집(Edit)에서는 기존 데이터가 깨지지 않도록 강제하지 않는다(최소 수정/안전).
    try {
      if (!isEditMode) {
        const hasExistingImages = Array.isArray(formData?.media_settings?.image_descriptions)
          && formData.media_settings.image_descriptions.some((img) => String(img?.url || '').trim());
        const hasNewFiles = Array.isArray(formData?.media_settings?.newly_added_files)
          && formData.media_settings.newly_added_files.length > 0;
        if (!hasExistingImages && !hasNewFiles) {
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
  }, [formData, validationSchema, isEditMode, selectedTagSlugs]);

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
  }, [formData, isEditMode, characterId, draftRestored, isDraftEnabled]);

  const handleManualDraftSave = () => {
    try {
      const key = `cc_draft_${isEditMode ? characterId : 'new'}`;
      const manualKey = `${key}_manual`;
      const draftPayload = {
        ...formData,
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
        if (!hasExistingImages && !hasNewFiles) errors.basic += 1;
      } catch (_) {}

      // 필수 텍스트
      if (!String(formData.basic_info.description || '').trim()) errors.basic += 1;
      if (!String(formData.basic_info.world_setting || '').trim()) errors.basic += 1;
      if (!String(formData.basic_info.user_display_description || '').trim()) errors.basic += 1;

      // 필수 태그(성향/스타일)
      try {
        const audience = (selectedTagSlugs || []).find((s) => REQUIRED_AUDIENCE_SLUGS.includes(s)) || null;
        const style = (selectedTagSlugs || []).find((s) => REQUIRED_STYLE_SLUGS.includes(s)) || null;
        if (!audience) errors.basic += 1;
        if (!style) errors.basic += 1;
      } catch (_) {}
    }

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
  }, [formData, isEditMode, selectedTagSlugs]);

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
    const newDialogue = { user_message: '', character_response: '', order_index: formData.example_dialogues.dialogues.length };
    updateFormData('example_dialogues', 'dialogues', [...formData.example_dialogues.dialogues, newDialogue]);
  };

  const removeExampleDialogue = (index) => {
    const dialogues = formData.example_dialogues.dialogues.filter((_, i) => i !== index);
    updateFormData('example_dialogues', 'dialogues', dialogues);
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
      
      const existingImageUrls = formData.media_settings.image_descriptions.map(img => img.url);
      const finalImageUrls = [...existingImageUrls, ...uploadedImageUrls];

      // ✅ 저장 시점에는 토큰을 "치환"하지 않고 원문 보존(SSOT)
      // - 금지/미등록 토큰만 제거(안전)
      const safeDescription = sanitizePromptTokens(formData.basic_info.description);
      const safeUserDisplay = sanitizePromptTokens(formData.basic_info.user_display_description);
      const useCustomDescription = Boolean((safeUserDisplay || '').trim());

      // greetings 배열을 greeting 단일 문자열로 변환
      // UI에서는 greetings 배열을 사용하지만, 백엔드는 greeting 단일 문자열을 기대함
      const greetingsArray = formData.basic_info.greetings || [];
      const greetingValue = Array.isArray(greetingsArray) && greetingsArray.length > 0
        ? greetingsArray.filter(g => g?.trim()).join('\n')
        : (formData.basic_info.greeting || '');

      const characterData = {
        ...formData,
        basic_info: {
          ...formData.basic_info,
          description: safeDescription,
          user_display_description: safeUserDisplay,
          // ✅ 방어: 코멘트가 비어있으면 별도 설명을 쓰지 않도록 보정(빈 텍스트 노출 방지)
          use_custom_description: useCustomDescription,
          greeting: greetingValue, // greetings 배열을 greeting 단일 문자열로 변환
          greetings: undefined, // 백엔드에 전송하지 않도록 제거
        },
        media_settings: {
          ...formData.media_settings,
          // 기존 이미지의 description/keywords 유지
          image_descriptions: (() => {
            const existingMap = {};
            (formData.media_settings.image_descriptions || []).forEach(img => {
              if (img.url) existingMap[img.url] = img;
            });
            return finalImageUrls.map(url => {
              const existing = existingMap[url];
              return {
                url,
                description: existing?.description || '',
                keywords: existing?.keywords || []
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
          setError('입력값을 다시 확인해주세요.');
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


  const renderBasicInfoTab = () => (
    <div className="p-6 space-y-8">
      {/* AI 스토리 임포터 기능 소개 섹션 */}
      {!isEditMode && (
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
        {/* 캐릭터 이미지 (AI 자동완성 아래) */}
        <Card className="p-4 bg-white text-black border border-gray-200">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-lg font-semibold flex items-center text-black">
              <Image className="w-5 h-5 mr-2" />
              캐릭터 이미지 <span className="text-red-500 ml-1">*</span>
            </h3>
            <Button
              type="button"
              size="sm"
              className="bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 text-white"
              onClick={() => setImgModalOpen(true)}
            >
              이미지 생성하기
            </Button>
          </div>
          <ErrorBoundary>
          <DropzoneGallery
            // ✅ 운영(배포)에서 API_BASE_URL이 `/api`로 끝나면 `/static/*` 이미지가 `/api/static/*`로 잘못 붙어 깨질 수 있다.
            // - 표준 유틸(`resolveImageUrl`)로만 렌더링 URL을 만든다.
            existingImages={formData.media_settings.image_descriptions.map((img) => ({
              url: resolveImageUrl(img?.url),
              description: img?.description,
            }))}
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
                    ...urls.map(u => ({ url: u, description: '' })),
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
                // ✅ 운영(배포) 경로 방어: `/static/*` 는 `/api`가 아닌 origin으로 내려야 하므로 resolveImageUrl로 통일
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
                        const keywords = e.target.value
                          .split(',')
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

        <div>
          <Label htmlFor="name">캐릭터 이름 *</Label>
          <Input
            id="name"
            className="mt-4"
            value={formData.basic_info.name}
            onChange={(e) => updateFormData('basic_info', 'name', e.target.value)}
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
          <Label htmlFor="description">캐릭터 설명 *</Label>
          <Textarea
            id="description"
            className="mt-4"
            value={formData.basic_info.description}
            onChange={(e) => updateFormData('basic_info', 'description', e.target.value)}
            placeholder="캐릭터에 대한 설명입니다 (캐릭터 설명은 다른 사용자에게도 공개 됩니다)"
            rows={3}
            required
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
            className="mt-4"
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
            className="mt-4"
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

        <div>
          <Label htmlFor="greetings">인사말</Label>
          {(formData.basic_info.greetings || ['']).map((greeting, index) => (
            <div key={index} className="mt-4">
              <div className="flex gap-2">
                <Textarea
                  id={index === 0 ? "greeting" : `greeting_${index}`}
                  className="flex-1"
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
      </div>

      <Separator />

      <div className="space-y-4">
        <h3 className="text-lg font-semibold">세계관</h3>
        <div>
          <Label htmlFor="world_setting">세계관 설정 *</Label>
          <Textarea
            id="world_setting"
            className="mt-2"
            value={formData.basic_info.world_setting}
            onChange={(e) => updateFormData('basic_info', 'world_setting', e.target.value)}
            placeholder="이야기의 배경에 대해서 설명해주세요"
            rows={4}
            maxLength={3000}
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
            className="mt-2"
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
          <Label htmlFor="user_display_description">크리에이터 코멘트 *</Label>
          <Textarea
            id="user_display_description"
            className="mt-2"
            value={formData.basic_info.user_display_description}
            onChange={(e) => updateFormData('basic_info', 'user_display_description', e.target.value)}
            placeholder="유저에게 보여줄 크리에이터 코멘트를 작성하세요"
            rows={3}
            maxLength={2000}
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
                  className="mt-4 bg-white text-black placeholder-gray-500 border-gray-300"
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
    </div>
  );

  const renderMediaTab = () => {
    // 새로 추가된 파일에 대한 임시 미리보기 URL 생성 (렌더링 시점에만)
    const newImagePreviews = useMemo(() => 
      formData.media_settings.newly_added_files.map(file => ({
        url: URL.createObjectURL(file),
        isNew: true // 새 이미지임을 구분하기 위한 플래그
      })), 
      [formData.media_settings.newly_added_files]
    );

    // 컴포넌트 언마운트 시 임시 URL 메모리 해제
    useEffect(() => {
      return () => {
        newImagePreviews.forEach(preview => URL.revokeObjectURL(preview.url));
      };
    }, [newImagePreviews]);

    const existingImages = formData.media_settings.image_descriptions.map(img => ({ ...img, isNew: false }));
    const allImages = [...existingImages, ...newImagePreviews];

    return (
      <div className="space-y-6">
        <div className="space-y-4">
          <h3 className="text-lg font-semibold flex items-center">
            <Image className="w-5 h-5 mr-2" />
            이미지 갤러리
          </h3>
          
          <Card className="p-4">
            <DropzoneGallery
              // ✅ 운영(배포)에서 API_BASE_URL(`/api`)로 `/static`이 깨지지 않게 resolveImageUrl로 통일
              existingImages={formData.media_settings.image_descriptions.map((img) => ({
                url: resolveImageUrl(img?.url),
                description: img?.description,
              }))}
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
                // 업로드 성공 시: 신규 파일 비우고, 기존 이미지 배열에 추가
                setFormData(prev => ({
                  ...prev,
                  media_settings: {
                    ...prev.media_settings,
                    image_descriptions: [
                      ...prev.media_settings.image_descriptions,
                      ...urls.map(u => ({ url: u, description: '' })),
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

  const renderDialoguesTab = () => (
    <div className="space-y-6 p-6">
      <div className="space-y-4">
        {formData.example_dialogues.dialogues.map((dialogue, index) => (
          <Card key={index} className="p-4 bg-white text-black border border-gray-200">
            <div className="flex items-center justify-between mb-3">
              <h4 className="font-medium !text-black">예시 #{index + 1}</h4>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => removeExampleDialogue(index)}
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
            
            <div className="space-y-3">
              <div>
                <div className="flex items-center justify-between">
                  <Label className="!text-black">사용자 메시지</Label>
                  <div className="flex gap-1">
                    <Button type="button" variant="secondary" size="sm" onClick={() => {
                      setFormData(prev => {
                        const arr = [...prev.example_dialogues.dialogues];
                        if (index === 0) return prev;
                        const item = arr.splice(index, 1)[0];
                        arr.splice(index-1, 0, item);
                        return { ...prev, example_dialogues: { ...prev.example_dialogues, dialogues: arr } };
                      });
                    }}>위로</Button>
                    <Button type="button" variant="secondary" size="sm" onClick={() => {
                      setFormData(prev => {
                        const arr = [...prev.example_dialogues.dialogues];
                        if (index >= arr.length-1) return prev;
                        const item = arr.splice(index, 1)[0];
                        arr.splice(index+1, 0, item);
                        return { ...prev, example_dialogues: { ...prev.example_dialogues, dialogues: arr } };
                      });
                    }}>아래로</Button>
                  </div>
                </div>
                <Textarea
                  id={`dlg_user_${index}`}
                  className="mt-4 bg-white text-black placeholder-gray-500 border-gray-300"
                  value={dialogue.user_message}
                  onChange={(e) => updateExampleDialogue(index, 'user_message', e.target.value)}
                  placeholder="사용자가 입력할 만한 메시지를 작성하세요"
                  rows={2}
                  maxLength={500}
                />
                <div className="flex items-center gap-2 mt-2">
                  <span className="text-xs text-gray-600">토큰 삽입:</span>
                  <Button type="button" variant="secondary" size="sm" title="{{character}} 삽입" onClick={() => insertDialogueToken(index, 'user_message', TOKEN_CHARACTER)}>캐릭터</Button>
                  <Button type="button" variant="secondary" size="sm" title="{{user}} 삽입" onClick={() => insertDialogueToken(index, 'user_message', TOKEN_USER)}>유저</Button>
                </div>
              </div>
              
              <div>
                <Label className="!text-black">캐릭터 응답</Label>
                <Textarea
                  id={`dlg_char_${index}`}
                  className="mt-4 bg-white text-black placeholder-gray-500 border-gray-300"
                  value={dialogue.character_response}
                  onChange={(e) => updateExampleDialogue(index, 'character_response', e.target.value)}
                  placeholder="캐릭터가 응답할 내용을 작성하세요"
                  rows={3}
                  maxLength={1000}
                />
                <div className="flex items-center gap-2 mt-2">
                  <span className="text-xs text-gray-600">토큰 삽입:</span>
                  <Button type="button" variant="secondary" size="sm" title="{{character}} 삽입" onClick={() => insertDialogueToken(index, 'character_response', TOKEN_CHARACTER)}>캐릭터</Button>
                  <Button type="button" variant="secondary" size="sm" title="{{user}} 삽입" onClick={() => insertDialogueToken(index, 'character_response', TOKEN_USER)}>유저</Button>
                </div>
              </div>
            </div>
          </Card>
        ))}

        <Button
          type="button"
          variant="outline"
          onClick={addExampleDialogue}
          className="w-full"
        >
          <Plus className="w-4 h-4 mr-2" />
          예시 추가 (ALT+N)
        </Button>
      </div>
    </div>
  );

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
              className="mt-4"
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
                    value={stage?.description ?? ''}
                    placeholder="호감도에 따라 캐릭터에게 줄 변화를 입력해보세요"
                    rows={1}
                    className="flex-1 mt-4"
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
              <Globe className="w-3 h-3 mr-1" />
              공개
            </Badge>
          ) : (
            <Badge variant="secondary">
              <Lock className="w-3 h-3 mr-1" />
              비공개
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
              <Badge key={slug} className="bg-purple-600 hover:bg-purple-600">{t?.emoji || '🏷️'} {t?.name || slug}</Badge>
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
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center space-x-2">
              <Link to="/dashboard" className="flex items-center space-x-2">
                <div className="w-8 h-8 bg-gradient-to-r from-purple-600 to-blue-600 rounded-lg flex items-center justify-center">
                  <MessageCircle className="w-5 h-5 text-white" />
                </div>
                <h1 className="text-xl font-bold text-white">캐릭터 만들기</h1>
              </Link>
            </div>
            <div className="flex items-center space-x-3">
              <div className="text-xs text-gray-500 mr-2 hidden sm:block">
                {isAutoSaving ? '임시저장 중…' : lastSavedAt ? `임시저장됨 • ${new Date(lastSavedAt).toLocaleTimeString()}` : ''}
              </div>
              <Button variant="outline" onClick={() => setIsPreviewOpen(true)}>
                <Eye className="w-4 h-4 mr-2" />
                미리보기
              </Button>
              <Button variant="outline" onClick={handleManualDraftSave}>
                <Save className="w-4 h-4 mr-2" />
                임시저장
              </Button>
              <Button 
                onClick={handleSubmit}
                disabled={loading}
                className="bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700"
              >
                {loading ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Save className="w-4 h-4 mr-2" />
                )}
                저장
              </Button>
            </div>
          </div>
        </div>
      </header>

      {/* 메인 컨텐츠 */}
      <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
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

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_220px] gap-6">
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

        {/* 미디어 섹션 제거: 상단 기본 정보 섹션 내 갤러리로 대체 */}

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
                {/* 미디어 앵커 제거 */}
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
      </main>

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
            // 새로 추가할 파일 목록 대신, 업로드 즉시 URL을 갤러리에 반영
            setFormData(prev => ({
              ...prev,
              media_settings: {
                ...prev.media_settings,
                image_descriptions: [...prev.media_settings.image_descriptions, { url: uploadedUrl, description: '' }]
              }
            }));
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
                    image_descriptions: urls.map(u => ({ url: u, description: '' })),
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
    </div>
  );
};

export default CreateCharacterPage; 