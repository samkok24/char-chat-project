import React, { useState, useEffect } from 'react';
import { usersAPI, memoryNotesAPI, userPersonasAPI } from '../lib/api';
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle 
} from './ui/dialog';
import { Button } from './ui/button';
import { Popover, PopoverTrigger, PopoverContent } from './ui/popover';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { Switch } from './ui/switch';
import { Slider } from './ui/slider';
import { 
  ChevronDown, 
  Check, 
  X, 
  Menu,
} from 'lucide-react';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from './ui/collapsible';

const ModelSelectionModal = ({ isOpen, onClose, currentModel, currentSubModel, onModelChange, initialTab = 'model', characterName = '캐릭터', characterId, onUpdateChatSettings, isOrigChat = false }) => {
  // temperature 기본값: 백엔드 ai_service의 기본 temperature(0.7)와 정합
  const DEFAULT_TEMPERATURE = 0.7;
  // UI 그룹(속도최적화/프로바이더)을 로컬로 기억해서, 모달을 닫았다가 열어도 체크 표시가 일관되게 보이도록 한다.
  const MODEL_GROUP_KEY = 'cc:model-group:v1';
  // ✅ 채팅 화면에서는 아직 연동/지원하지 않는 모델(UX 혼란 방지용으로 비노출)
  const HIDDEN_CHAT_MODEL_IDS = new Set(['deepseek', 'short', 'caveduck']);
  // ✅ 요구사항 기본값: Claude Haiku 4.5
  // - 서버에서 사용자 설정을 불러오기 전/초기 진입에서도 UX를 동일하게 유지한다.
  const [selectedModel, setSelectedModel] = useState(currentModel || 'claude');
  const [selectedSubModel, setSelectedSubModel] = useState(currentSubModel || 'claude-haiku-4-5-20251001');
  // ✅ "큰 카테고리 체크"는 selectedUiGroup 기준으로 표시한다.
  // - speed에서 선택하면 speed에 체크, provider에서 선택하면 provider에 체크.
  const [selectedUiGroup, setSelectedUiGroup] = useState('speed');
  const [activeTab, setActiveTab] = useState(initialTab);
  const [expandedSections, setExpandedSections] = useState({
    speed: true,
    gemini: false,
    claude: false,
    gpt: false
  });
  const [responseLength, setResponseLength] = useState('medium'); // short|medium|long
  // 원작챗 추가 설정 초기값 바인딩용 상태
  const [ppModeSel, setPpModeSel] = useState('first2'); // always|first2|off
  const [nextLenSel, setNextLenSel] = useState(1); // 1|2
  const [prewarmSel, setPrewarmSel] = useState(true);
  // P0: 전역 UI 설정(로컬 저장)
  const [uiFontSize, setUiFontSize] = useState('base'); // sm|base|lg|xl
  const [uiLetterSpacing, setUiLetterSpacing] = useState('normal'); // tighter|tight|normal|wide|wider
  // ✅ 기본값은 0(오버레이 없음): 대표 이미지가 과도하게 어두워지는 문제 방지
  const [uiOverlay, setUiOverlay] = useState(0); // 0~100
  const [uiFontFamily, setUiFontFamily] = useState('sans'); // sans|serif
  const [uiColors, setUiColors] = useState({
    charSpeech: '#ffffff',
    charNarration: '#cfcfcf',
    userSpeech: '#111111',
    userNarration: '#333333'
  });
  // ✅ 현재는 다크테마를 기본/고정으로 사용한다(시스템/라이트는 추후 디자인 작업 후 오픈).
  const [uiTheme, setUiTheme] = useState('dark'); // dark (system/light 비활성화)
  const [typingSpeed, setTypingSpeed] = useState(40); // 10~80 cps
  const [temperatureSel, setTemperatureSel] = useState(DEFAULT_TEMPERATURE); // 0.0~1.0 (0.1 step)
  
  // 기억노트 관련 상태
  const [memories, setMemories] = useState([]);
  const [newMemoryTitle, setNewMemoryTitle] = useState('');
  const [editingMemory, setEditingMemory] = useState(null);
  
  // 유저 페르소나 관련 상태
  const [personas, setPersonas] = useState([]);
  const [newPersonaName, setNewPersonaName] = useState('');
  const [newPersonaDescription, setNewPersonaDescription] = useState('');
  const [editingPersona, setEditingPersona] = useState(null);
  const [activePersona, setActivePersona] = useState(null);

  const SPEED_SUB_MODELS = [
    // ✅ 요구사항 우선순위: Haiku 4.5 -> GPT-4o -> Gemini 2.5 Flash -> Gemini 3 Flash (Preview)
    { id: 'speed:claude-haiku-4-5-20251001', targetModel: 'claude', targetSubModel: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5', description: '초고속 응답에 강한 Haiku 라인', cost: 4 },
    { id: 'speed:gpt-4o', targetModel: 'gpt', targetSubModel: 'gpt-4o', name: 'GPT-4o', description: '응답 속도/안정성 밸런스 (멀티모달)', cost: 10 },
    { id: 'speed:gemini-2.5-flash', targetModel: 'gemini', targetSubModel: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', description: '빠른 응답에 최적화된 Flash 라인', cost: 2 },
    { id: 'speed:gemini-3-flash-preview', targetModel: 'gemini', targetSubModel: 'gemini-3-flash-preview', name: 'Gemini 3 Flash (Preview)', description: '최신 Flash 프리뷰(변동 가능)', cost: 2 },
  ];

  /**
   * ✅ Gemini 서브모델 레거시/중복 값 방어
   * - 과거 저장값(예: gemini-3-flash, gemini-3-pro)이 남아있어도,
   *   현재 SSOT(Preview 모델)로 자동 치환해서 "선택값 폴백/체크표시 꼬임"을 방지한다.
   */
  const normalizeGeminiSubModel = (subModelId) => {
    try {
      const s = String(subModelId || '').trim();
      if (s === 'gemini-3-flash') return 'gemini-3-flash-preview';
      if (s === 'gemini-3-pro') return 'gemini-3-pro-preview';
      return s;
    } catch (_) {
      return subModelId;
    }
  };

  const inferUiGroup = (m, s) => {
    try {
      const mm = String(m || '').trim();
      const ss = String(s || '').trim();
      if (SPEED_SUB_MODELS.some((it) => it.targetModel === mm && it.targetSubModel === ss)) return 'speed';
      if (mm === 'gemini' || mm === 'gpt' || mm === 'claude') return mm;
      return 'speed';
    } catch (_) {
      return 'speed';
    }
  };

  const models = {
    // ⚡ 속도 최적화 모델 모음: 실제 저장은 각 provider(gpt/gemini/claude)로 저장한다.
    // - 요구사항: 모달에 "햄버거 메뉴" 형태로 추가하고, 안에 빠른 모델들을 묶어서 보여준다.
    // - 방어: 여기의 id는 UI용 그룹키이며, 실제 API 호출/저장에는 subModel의 targetModel/targetSubModel을 사용한다.
    speed: {
      name: '속도최적화 모델',
      cost: 0,
      subModels: SPEED_SUB_MODELS,
    },
    gemini: {
      name: 'Gemini 모델',
      cost: 8,
      subModels: [
        // ✅ speed에서 선택해도 "모달 재오픈 시 폴백"되지 않도록, provider 리스트에도 포함한다.
        { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', description: '빠른 응답에 최적화된 Flash 라인', cost: 2 },
        { id: 'gemini-3-flash-preview', name: 'Gemini 3 Flash (Preview)', description: '최신 Flash 프리뷰(변동 가능)', cost: 2 },
        // ✅ SSOT: Gemini 3 Pro 정식 모델명은 gemini-3-pro-preview
        { id: 'gemini-3-pro-preview', name: 'Gemini 3 Pro (Preview)', description: '상황 묘사와 플롯테이킹이 강한 최고 성능의 AI', cost: 8 },
        // ✅ 기존 기본값(gemini-2.5-pro) 유지: 백엔드 호환 + 기본 선택값 유지
        { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro Standard', description: '비판적 사고, 냉철한 판단과 직설적 어조의 응답', cost: 8 },
      ]
    },
    claude: {
      name: 'Claude 모델',
      cost: 10,
      subModels: [
        // ✅ speed에서 선택해도 "모달 재오픈 시 폴백"되지 않도록, provider 리스트에도 포함한다.
        { id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5', description: '초고속 응답에 강한 Haiku 라인', cost: 4 },
        // ✅ 최신 Claude(4.0+) 모델명 기준으로 정리 (백엔드에서도 동일 문자열로 호출)
        { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4', description: '빠르고 안정적인 올라운더', cost: 10, badge: '기본', badgeClass: 'bg-pink-600 text-white hover:bg-pink-600' },
        { id: 'claude-opus-4-1-20250805', name: 'Claude Opus 4.1', description: '더 깊은 추론/품질을 지향하는 플래그십', cost: 20, badge: '신규', badgeClass: 'bg-pink-600 text-white hover:bg-pink-600' },
        { id: 'claude-sonnet-4-5-20250929', name: 'Claude Sonnet 4.5', description: '더 향상된 성능의 Sonnet 라인', cost: 12, badge: '인기', badgeClass: 'bg-pink-600 text-white hover:bg-pink-600' },
        { id: 'claude-opus-4-5-20251101', name: 'Claude Opus 4.5', description: '최상위 품질의 Opus 라인', cost: 25, badge: '최고', badgeClass: 'bg-pink-600 text-white hover:bg-pink-600' },
      ]
    },
    gpt: {
      name: 'GPT 모델',
      cost: 10,
      subModels: [
        // ✅ 기존 사용자 설정 모델도 유지(호환)
        { id: 'gpt-4o', name: 'GPT-4o', description: 'OpenAI의 멀티모달 모델', cost: 10 },
        // ✅ 기존 설정/테스트용으로는 유지(속도최적화 섹션에서는 "내림" 요구로 비노출)
        { id: 'gpt-5-mini', name: 'GPT 5 mini', description: '속도/비용 최적화', cost: 3 },
        { id: 'gpt-5.1', name: 'GPT-5.1', description: '깊은 이해와 유연한 대화를 겸비한 GPT의 최상위 모델', cost: 10, badge: '신규', badgeClass: 'bg-pink-600 text-white hover:bg-pink-600' },
        { id: 'gpt-5.2', name: 'GPT-5.2', description: '차세대 추론/지식 강화 모델 (연동 준비 중)', cost: 10, badge: '신규', badgeClass: 'bg-pink-600 text-white hover:bg-pink-600' },
      ]
    },
    // ✅ 경쟁사 UI 구성 맞춤(프론트만): 아직 연동 전이라도 섹션은 유지
    deepseek: {
      name: 'Deepseek 모델',
      cost: 0,
      subModels: [
        { id: 'deepseek-r1', name: 'Deepseek R1', description: '연동 준비 중', cost: 0, badge: '준비중', badgeClass: 'bg-gray-700 text-gray-200 hover:bg-gray-700' }
      ]
    },
    short: {
      name: '단문 모델',
      cost: 1,
      subModels: [
        { id: 'breeze', name: 'Breeze', description: '가볍고 시원하게 소개하는 대화', cost: 1 }
      ]
    },
    caveduck: {
      name: '케이브덕 전용 모델',
      cost: 0,
      subModels: [
        { id: 'caveduck-special', name: 'Caveduck Special', description: '연동 준비 중', cost: 0, badge: '준비중', badgeClass: 'bg-gray-700 text-gray-200 hover:bg-gray-700' }
      ]
    }
  };

  // 현재 모델이 변경되면 선택된 모델 업데이트(방어적)
  useEffect(() => {
    try {
      const rawModel = String(currentModel || '').trim();
      const isHiddenModel = HIDDEN_CHAT_MODEL_IDS.has(rawModel);

      // 일반 캐릭터챗: 숨김 모델이 저장돼있어도 UI에서는 claude로 안전 폴백
      const safeModel =
        (!isOrigChat && isHiddenModel)
          ? 'claude'
          : ((currentModel && models[currentModel]) ? currentModel : 'claude');

      if (!isOrigChat && isHiddenModel) {
        console.warn('[ModelSelectionModal] hidden model is not exposed in chat UI, fallback to claude:', rawModel);
      } else if (currentModel && !models[currentModel]) {
        console.warn('[ModelSelectionModal] unsupported model, fallback to claude:', currentModel);
      }
      setSelectedModel(safeModel);

      const list = models[safeModel]?.subModels || [];
      // ✅ Gemini 레거시/중복 서브모델 자동 치환
      const normalizedCurrentSub =
        safeModel === 'gemini'
          ? normalizeGeminiSubModel(currentSubModel)
          : currentSubModel;
      const safeSub =
        (normalizedCurrentSub && list.some((s) => s.id === normalizedCurrentSub))
          ? normalizedCurrentSub
          : (list[0]?.id || 'claude-haiku-4-5-20251001');
      setSelectedSubModel(safeSub);

      // ✅ UI 그룹 복원: (1) 로컬 저장된 그룹이 현재 모델/서브모델과 정합이면 사용, (2) 아니면 추론
      try {
        const raw = localStorage.getItem(MODEL_GROUP_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          const gm = String(parsed?.model || '').trim();
          const gs = String(parsed?.sub_model || '').trim();
          const gg = String(parsed?.group || '').trim();
          if (gm === safeModel && gs === safeSub && ['speed', 'gemini', 'gpt', 'claude'].includes(gg)) {
            setSelectedUiGroup(gg);
            return;
          }
        }
      } catch (_) {}
      setSelectedUiGroup(inferUiGroup(safeModel, safeSub));
    } catch (_) {
      setSelectedModel('claude');
      setSelectedSubModel('claude-haiku-4-5-20251001');
      setSelectedUiGroup('speed');
    }
  }, [currentModel, currentSubModel, isOpen, isOrigChat]);

  // ✅ 모달 오픈 시: "속도최적화"만 펼친 상태로 시작(요구사항)
  useEffect(() => {
    if (!isOpen) return;
    try {
      setExpandedSections({
        speed: true,
        gemini: false,
        claude: false,
        gpt: false,
      });
    } catch (_) {}
  }, [isOpen]);

  // initialTab이 변경되면 activeTab 업데이트
  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  // 사용자 현재 길이 선호도 및 원작챗 추가 설정 불러오기
  useEffect(() => {
    const load = async () => {
      try {
        const r = await usersAPI.getModelSettings();
        setResponseLength(r.data.response_length_pref || 'medium');
      } catch (_) {}
      // 원작챗 추가 설정(로컬) 불러오기
      try {
        const rawChat = localStorage.getItem('cc:chat:settings:v1');
        if (rawChat) {
          const parsed = JSON.parse(rawChat);
          if (parsed.postprocess_mode) setPpModeSel(String(parsed.postprocess_mode));
          if (parsed.next_event_len === 1 || parsed.next_event_len === 2) setNextLenSel(parsed.next_event_len);
          if (typeof parsed.prewarm_on_start === 'boolean') setPrewarmSel(!!parsed.prewarm_on_start);
          if (parsed.response_length_pref) setResponseLength(String(parsed.response_length_pref));
          // ✅ 공통 temperature: 숫자만 허용 + 0~1 클램핑 + 0.1 단위 반올림
          if (parsed.temperature !== undefined && parsed.temperature !== null) {
            const t = Number(parsed.temperature);
            if (Number.isFinite(t)) {
              const clipped = Math.max(0, Math.min(1, t));
              setTemperatureSel(Math.round(clipped * 10) / 10);
            }
          }
        }
      } catch (_) {}
      // 로컬 UI 설정 로드
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
    };
    if (isOpen) load();
  }, [isOpen]);

  // 캐릭터별 기억노트 로드
  useEffect(() => {
    if (isOpen && characterId && activeTab === 'notes') {
      loadMemoryNotes();
    }
  }, [isOpen, characterId, activeTab]);

  // 유저 페르소나 로드
  useEffect(() => {
    if (isOpen && activeTab === 'profile') {
      loadUserPersonas();
    }
  }, [isOpen, activeTab]);

  const loadMemoryNotes = async () => {
    try {
      const response = await memoryNotesAPI.getMemoryNotesByCharacter(characterId);
      setMemories(response.data.memory_notes.map(note => ({
        id: note.id,
        title: note.title,
        content: note.content,
        isActive: note.is_active
      })));
    } catch (error) {
      console.error('기억노트 로드 실패:', error);
    }
  };

  const saveMemoryNote = async (memory) => {
    try {
      if (typeof memory.id === 'number') {
        // 새로운 기억노트 생성
        const response = await memoryNotesAPI.createMemoryNote({
          character_id: characterId,
          title: memory.title,
          content: memory.content,
          is_active: memory.isActive
        });
        // ID를 실제 서버 ID로 업데이트
        setMemories(prev => prev.map(m => 
          m.id === memory.id ? { ...m, id: response.data.id } : m
        ));
      } else {
        // 기존 기억노트 수정
        await memoryNotesAPI.updateMemoryNote(memory.id, {
          title: memory.title,
          content: memory.content,
          is_active: memory.isActive
        });
      }
    } catch (error) {
      console.error('기억노트 저장 실패:', error);
    }
  };

  const deleteMemoryNoteFromServer = async (memoryId) => {
    try {
      if (typeof memoryId !== 'number') {
        await memoryNotesAPI.deleteMemoryNote(memoryId);
      }
    } catch (error) {
      console.error('기억노트 삭제 실패:', error);
    }
  };

  const loadUserPersonas = async () => {
    try {
      const response = await userPersonasAPI.getUserPersonas();
      setPersonas(response.data.personas.map(persona => ({
        id: persona.id,
        name: persona.name,
        description: persona.description,
        isDefault: persona.is_default,
        isActive: persona.is_active
      })));
      setActivePersona(response.data.active_persona);
    } catch (error) {
      console.error('페르소나 로드 실패:', error);
    }
  };

  const saveUserPersona = async (persona) => {
    try {
      if (typeof persona.id === 'number') {
        // 새로운 페르소나 생성
        const response = await userPersonasAPI.createUserPersona({
          name: persona.name,
          description: persona.description,
          is_default: persona.isDefault
        });
        // ID를 실제 서버 ID로 업데이트
        setPersonas(prev => prev.map(p => 
          p.id === persona.id ? { ...p, id: response.data.id } : p
        ));
        if (response.data.is_active) {
          setActivePersona(response.data);
        }
      } else {
        // 기존 페르소나 수정
        await userPersonasAPI.updateUserPersona(persona.id, {
          name: persona.name,
          description: persona.description,
          is_default: persona.isDefault
        });
      }
    } catch (error) {
      console.error('페르소나 저장 실패:', error);
    }
  };

  const deleteUserPersonaFromServer = async (personaId) => {
    try {
      if (typeof personaId !== 'number') {
        await userPersonasAPI.deleteUserPersona(personaId);
      }
    } catch (error) {
      console.error('페르소나 삭제 실패:', error);
    }
  };

  const setActiveUserPersona = async (personaId) => {
    try {
      const response = await userPersonasAPI.setActivePersona(personaId);
      setActivePersona(response.data);
      // 페르소나 목록에서 활성 상태 업데이트
      setPersonas(prev => prev.map(p => ({
        ...p,
        isActive: p.id === personaId
      })));
    } catch (error) {
      console.error('활성 페르소나 설정 실패:', error);
    }
  };

  // NOTE: models는 상단에서 경쟁사 구성에 맞춰 정의됨 (ARGO는 당분간 비노출)

  const toggleSection = (section) => {
    setExpandedSections(prev => ({
      ...prev,
      [section]: !prev[section]
    }));
  };

  const handleModelSelect = (modelId, subModelId) => {
    setSelectedModel(modelId);
    setSelectedSubModel(subModelId);
  };

  const handleSave = async () => {
    try {
      // 모델 탭: 모델/서브모델 + 답변 길이 저장
      if (activeTab === 'model') {
        await usersAPI.updateModelSettings(selectedModel, selectedSubModel, responseLength);
        onModelChange(selectedModel, selectedSubModel);
        // ✅ UI 그룹 로컬 저장(모달 재오픈 체크 정합)
        try {
          localStorage.setItem(MODEL_GROUP_KEY, JSON.stringify({ group: selectedUiGroup, model: selectedModel, sub_model: selectedSubModel }));
        } catch (_) {}
      } else if (activeTab === 'settings') {
        // 추가 설정 탭: 답변 길이 + 전역 UI 설정 로컬 저장
        await usersAPI.updateModelSettings(selectedModel, selectedSubModel, responseLength);
        // ✅ 저장 스키마 버전(마이그레이션/호환)
        const overlayClipped = (() => {
          try {
            const v = Number(uiOverlay);
            const clipped = Number.isFinite(v) ? Math.max(0, Math.min(100, Math.round(v))) : 0;
            return clipped;
          } catch (_) {
            return 0;
          }
        })();
        const ui = { schema_version: 2, fontSize: uiFontSize, letterSpacing: uiLetterSpacing, overlay: overlayClipped, fontFamily: uiFontFamily, colors: uiColors, theme: uiTheme, typingSpeed };
        localStorage.setItem('cc:ui:v1', JSON.stringify(ui));
        window.dispatchEvent(new CustomEvent('ui:settingsChanged', { detail: ui }));
        // ✅ UI 그룹 로컬 저장(모달 재오픈 체크 정합)
        try {
          localStorage.setItem(MODEL_GROUP_KEY, JSON.stringify({ group: selectedUiGroup, model: selectedModel, sub_model: selectedSubModel }));
        } catch (_) {}
      }
      // 페르소나 탭인 경우 별도 처리 필요 없음 (이미 개별적으로 저장됨)
      
      onClose();
    } catch (error) {
      console.error('설정 저장 실패:', error);
      // TODO: 에러 메시지 표시
    }
  };

  const isSelected = (modelId, subModelId) => {
    return selectedModel === modelId && selectedSubModel === subModelId;
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto p-4 sm:p-6" aria-describedby="model-modal-desc">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold">설정</DialogTitle>
          {/* 현재 선택된 모델 표시 */}
          <div className="mt-2 p-3 bg-blue-50 rounded-lg border">
            <div className="text-sm text-gray-600">현재 선택된 모델</div>
            <div className="font-medium text-blue-800">
              {isOrigChat
                ? '원작챗 모델 선택 준비중입니다'
                : `${models[selectedModel]?.name || selectedModel} - ${models[selectedModel]?.subModels?.find(sub => sub.id === selectedSubModel)?.name || selectedSubModel}`}
            </div>
            {isOrigChat && (
              <div className="text-xs text-gray-500 mt-1">
                현재 원작챗은 모델 선택 기능을 준비 중입니다.
              </div>
            )}
          </div>
        </DialogHeader>
        <div id="model-modal-desc" className="sr-only">모델 및 대화 설정을 구성하는 모달</div>


        {/* 탭 메뉴 */}
        <div className="border-b mb-5">
          {/* 모바일: 가로 스크롤 + 줄바꿈 방지로 가독성 개선 */}
          <div className="flex gap-5 overflow-x-auto whitespace-nowrap pr-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <button 
              onClick={() => setActiveTab('model')}
              className={`pb-2 text-sm ${activeTab === 'model' ? 'border-b-2 border-purple-500 text-purple-600 font-semibold' : 'text-gray-500 hover:text-gray-700'}`}
            >
              모델 선택
            </button>
            <button 
              onClick={() => setActiveTab('profile')}
              className={`pb-2 text-sm ${activeTab === 'profile' ? 'border-b-2 border-purple-500 text-purple-600 font-semibold' : 'text-gray-500 hover:text-gray-700'}`}
            >
              유저 페르소나
            </button>
            <button 
              onClick={() => setActiveTab('notes')}
              className={`pb-2 text-sm ${activeTab === 'notes' ? 'border-b-2 border-purple-500 text-purple-600 font-semibold' : 'text-gray-500 hover:text-gray-700'}`}
            >
              기억노트
            </button>
            <button 
              onClick={() => setActiveTab('settings')}
              className={`pb-2 text-sm ${activeTab === 'settings' ? 'border-b-2 border-purple-500 text-purple-600 font-semibold' : 'text-gray-500 hover:text-gray-700'}`}
            >
              추가 설정
            </button>
          </div>
        </div>

        {/* 탭 콘텐츠 */}
        {activeTab === 'model' && (
          <div className="space-y-4">
          <div>
            <h3 className="font-semibold mb-2">AI 모델 변경</h3>
            <p className="text-sm text-gray-600 mb-4">
              대화 중 모델을 변경해도 대화를 이어나갈 수 있어요!
            </p>
          </div>

          {/* ✅ 공통 대화 스타일(온도) 설정 (0~1, 0.1 step) */}
          <div className="rounded-xl border border-gray-700 bg-gray-900 text-white p-4">
            <div>
              <div className="text-sm font-semibold">대화스타일(온도) 설정</div>
              <div className="text-xs text-gray-300 mt-1">
                대답이 더 창의적으로 나오거나, 설정/맥락에 더 충실하게 나오도록 조절해요.
              </div>
            </div>
            <div className="mt-3">
              {(() => {
                // 0.0도 정상적으로 선택/표시되도록 (0은 falsy라서 || default 사용 금지)
                const t = Number(temperatureSel);
                const tSafe = Number.isFinite(t) ? Math.max(0, Math.min(1, t)) : DEFAULT_TEMPERATURE;
                return (
                  <>
                    <Slider
                      value={[tSafe]}
                      min={0}
                      max={1}
                      step={0.1}
                      onValueChange={(vals) => {
                        const raw = Array.isArray(vals) ? vals[0] : DEFAULT_TEMPERATURE;
                        const clipped = Math.max(0, Math.min(1, Number(raw)));
                        const v = Math.round(clipped * 10) / 10;
                        setTemperatureSel(v);
                        try { onUpdateChatSettings && onUpdateChatSettings({ temperature: v }); } catch (_) {}
                      }}
                    />
                    <div className="mt-2 flex items-center gap-2 text-[11px] text-gray-400">
                      <span className="whitespace-nowrap">설정에 충실하게</span>
                      <div className="flex-1 flex items-center gap-2">
                        <div className="h-px flex-1 bg-white/10" />
                        <span className="text-gray-500 whitespace-nowrap">기본값</span>
                        <div className="h-px flex-1 bg-white/10" />
                      </div>
                      <span className="whitespace-nowrap">창의적으로</span>
                    </div>
                  </>
                );
              })()}
            </div>
          </div>

          {Object.entries(models)
            // ✅ 일반 캐릭터챗: 연동 준비중 모델(Deepseek/단문/케이브덕)은 비노출
            .filter(([modelId]) => !['deepseek', 'short', 'caveduck'].includes(String(modelId || '')))
            .map(([modelId, model]) => (
            <Collapsible 
              key={modelId}
              open={expandedSections[modelId]}
              onOpenChange={() => toggleSection(modelId)}
            >
              <CollapsibleTrigger asChild>
                <div className="w-full flex items-center justify-between p-3 bg-gray-800 text-white rounded-lg hover:bg-gray-700 transition-colors cursor-pointer">
                  <div className="flex items-center space-x-3">
                    {modelId === 'speed' && <Menu className="w-4 h-4 text-gray-200" />}
                    <span className="font-medium">{model.name}</span>
                    {/* ✅ 큰 카테고리 체크: UI 그룹 기준 */}
                    {selectedUiGroup === modelId && (
                      <Check className="w-4 h-4 text-green-400" />
                    )}
                  </div>
                  <ChevronDown className={`w-4 h-4 transition-transform ${expandedSections[modelId] ? 'rotate-180' : ''}`} />
                </div>
              </CollapsibleTrigger>

              <CollapsibleContent className="mt-2 space-y-2">
                {model.subModels.map((subModel) => (
                  (() => {
                    // ✅ 속도최적화 그룹은 provider별로 저장되므로 targetModel/targetSubModel을 사용한다.
                    const effModelId = modelId === 'speed' ? (subModel.targetModel || 'gemini') : modelId;
                    const effSubId = modelId === 'speed' ? (subModel.targetSubModel || subModel.id) : subModel.id;
                    const selected = isSelected(effModelId, effSubId);
                    return (
                  <div
                    key={subModel.id}
                    className={`p-3 rounded-lg border transition-colors ${
                      selected
                        ? 'border-purple-500 bg-purple-50'
                        : (isOrigChat ? 'border-gray-200 bg-gray-50' : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50')
                    } ${isOrigChat ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}
                    aria-disabled={isOrigChat ? 'true' : undefined}
                    onClick={() => {
                      // ✅ 원작챗: 모델 선택 기능 준비중 → 클릭 비활성
                      if (isOrigChat) return;
                      // ✅ speed 그룹에서 선택한 경우: UI 체크는 speed에 유지
                      try {
                        setSelectedUiGroup(modelId === 'speed' ? 'speed' : effModelId);
                      } catch (_) {}
                      handleModelSelect(effModelId, effSubId);
                    }}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-3">
                        <div>
                          <div className="flex items-center space-x-2">
                            <span className="font-medium">{subModel.name}</span>
                            {selected && (
                              <Check className="w-4 h-4 text-purple-600" />
                            )}
                          </div>
                          <p className="text-sm text-gray-600 mt-1">{subModel.description}</p>
                        </div>
                      </div>
                    </div>
                  </div>
                    );
                  })()
                ))}
              </CollapsibleContent>
            </Collapsible>
          ))}
        </div>
        )}

        {/* 내 정보 수정 탭 */}
        {activeTab === 'profile' && (
          <div className="space-y-4">
            <div>
              <h3 className="font-semibold mb-2">유저 페르소나 관리</h3>
              <p className="text-sm text-gray-600 mb-4">캐릭터가 당신을 어떻게 인식할지 설정할 수 있는 멀티 프로필입니다.</p>
              {activePersona && (
                <div className="p-3 bg-green-50 rounded-lg border border-green-200 mb-4">
                  <div className="text-sm text-green-600">현재 활성 페르소나</div>
                  <div className="font-medium text-green-800">
                    {activePersona.name} - {activePersona.description}
                  </div>
                </div>
              )}
            </div>
            
            {/* 새 페르소나 추가 */}
            <div className="space-y-2">
              <Input
                placeholder="페르소나 이름 (예: 차서현, 레온하르트)"
                value={newPersonaName}
                onChange={(e) => setNewPersonaName(e.target.value)}
                className="flex-1"
              />
              <Textarea
                placeholder="페르소나 설명 (예: 키 180에 호감형 외모의 남자아이돌지망생)"
                value={newPersonaDescription}
                onChange={(e) => setNewPersonaDescription(e.target.value)}
                className="min-h-[80px]"
              />
              <Button 
                onClick={() => {
                  if (newPersonaName.trim() && newPersonaDescription.trim()) {
                    const newPersona = {
                      id: Date.now(), // Temporary local ID
                      name: newPersonaName,
                      description: newPersonaDescription,
                      isDefault: personas.length === 0, // 첫 번째 페르소나는 기본값
                      isActive: false
                    };
                    setPersonas([...personas, newPersona]);
                    setEditingPersona(newPersona.id);
                    setNewPersonaName('');
                    setNewPersonaDescription('');
                  }
                }}
                className="w-full bg-purple-600 hover:bg-purple-700 text-white"
              >
                페르소나 추가
              </Button>
            </div>

            {/* 저장된 페르소나가 없을 때 */}
            {personas.length === 0 && !editingPersona && (
              <div className="text-center text-gray-500 py-8">
                등록된 페르소나가 없습니다.<br/>
                첫 번째 페르소나를 만들어보세요!
              </div>
            )}

            {/* 페르소나 목록 */}
            {personas.map((persona) => (
              <div key={persona.id} className="space-y-4">
                {editingPersona === persona.id ? (
                  // 편집 모드
                  <div className="bg-gray-900 text-white rounded-lg p-4 space-y-4">
                    <div className="flex items-center justify-between">
                      <h4 className="font-semibold">페르소나 편집</h4>
                      <X 
                        className="w-5 h-5 cursor-pointer hover:text-red-400" 
                        onClick={() => {
                          deleteUserPersonaFromServer(persona.id);
                          setPersonas(personas.filter(p => p.id !== persona.id));
                          setEditingPersona(null);
                        }}
                      />
                    </div>
                    
                    <div>
                      <label className="text-sm text-gray-400">이름</label>
                      <Input
                        value={persona.name}
                        onChange={(e) => {
                          setPersonas(personas.map(p => 
                            p.id === persona.id ? { ...p, name: e.target.value } : p
                          ));
                        }}
                        className="bg-gray-800 border-gray-700 text-white"
                      />
                    </div>
                    
                    <div>
                      <label className="text-sm text-gray-400">설명</label>
                      <Textarea
                        value={persona.description}
                        onChange={(e) => {
                          setPersonas(personas.map(p => 
                            p.id === persona.id ? { ...p, description: e.target.value } : p
                          ));
                        }}
                        placeholder="이 페르소나의 특징을 자세히 설명해주세요"
                        className="bg-gray-800 border-gray-700 text-white min-h-[100px]"
                      />
                    </div>
                    
                    <div className="flex items-center justify-between">
                      <label className="text-sm text-gray-400">기본 페르소나</label>
                      <Switch
                        checked={persona.isDefault}
                        onCheckedChange={(checked) => {
                          setPersonas(personas.map(p => ({
                            ...p,
                            isDefault: p.id === persona.id ? checked : (checked ? false : p.isDefault)
                          })));
                        }}
                      />
                    </div>
                    
                    <Button 
                      onClick={() => {
                        saveUserPersona(persona);
                        setEditingPersona(null);
                      }}
                      className="w-full bg-purple-600 hover:bg-purple-700 text-white"
                    >
                      저장
                    </Button>
                  </div>
                ) : (
                  // 뷰 모드
                  <div 
                    className={`rounded-lg p-4 cursor-pointer border-2 transition-colors ${
                      persona.isActive 
                        ? 'bg-blue-50 border-blue-300 hover:bg-blue-100' 
                        : 'bg-gray-50 border-gray-200 hover:bg-gray-100'
                    }`}
                    onClick={() => setEditingPersona(persona.id)}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <h4 className="font-semibold">{persona.name}</h4>
                          {persona.isDefault && (
                            <span className="text-xs bg-yellow-500 text-white px-2 py-1 rounded">기본</span>
                          )}
                          {persona.isActive && (
                            <span className="text-xs bg-green-500 text-white px-2 py-1 rounded">활성</span>
                          )}
                        </div>
                        <p className="text-sm text-gray-600 mt-1">{persona.description}</p>
                      </div>
                      <div className="flex items-center space-x-2">
                        <Button
                          onClick={(e) => {
                            e.stopPropagation();
                            setActiveUserPersona(persona.id);
                          }}
                          size="sm"
                          className={persona.isActive ? 'bg-gray-400' : 'bg-blue-600 hover:bg-blue-700'}
                          disabled={persona.isActive}
                        >
                          {persona.isActive ? '활성중' : '활성화'}
                        </Button>
                        <X 
                          className="w-5 h-5 cursor-pointer hover:text-red-400" 
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteUserPersonaFromServer(persona.id);
                            setPersonas(personas.filter(p => p.id !== persona.id));
                          }}
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* 기억노트 탭 */}
        {activeTab === 'notes' && (
          <div className="space-y-4">
            <div>
              <h3 className="font-semibold mb-2">로어북 추가 후 그동안의 스토리를 내용 안에 적으면 다음 턴부터 캐릭터가 잊지 않고 기억해요.</h3>
            </div>
            
            {/* 새 로어북 추가 */}
            <div className="flex space-x-2">
              <Input
                placeholder="새 로어북 제목"
                value={newMemoryTitle}
                onChange={(e) => setNewMemoryTitle(e.target.value)}
                className="flex-1"
              />
              <Button 
                onClick={() => {
                  if (newMemoryTitle.trim()) {
                    const newMemory = {
                      id: Date.now(),
                      title: newMemoryTitle,
                      content: '',
                      isActive: true
                    };
                    setMemories([...memories, newMemory]);
                    setEditingMemory(newMemory.id);
                    setNewMemoryTitle('');
                  }
                }}
                className="bg-yellow-500 hover:bg-yellow-600 text-black"
              >
                추가
              </Button>
            </div>

            {/* 저장된 로어북이 없을 때 */}
            {memories.length === 0 && !editingMemory && (
              <div className="text-center text-gray-500 py-8">
                저장된 로어북이 없습니다.
              </div>
            )}

            {/* 기억노트 목록 */}
            {memories.map((memory) => (
              <div key={memory.id} className="space-y-4">
                {editingMemory === memory.id ? (
                  // 편집 모드
                  <div className="bg-gray-900 text-white rounded-lg p-4 space-y-4">
                    <div className="flex items-center justify-between">
                      <h4 className="font-semibold">{memory.title}</h4>
                      <X 
                        className="w-5 h-5 cursor-pointer hover:text-red-400" 
                        onClick={() => {
                          deleteMemoryNoteFromServer(memory.id);
                          setMemories(memories.filter(m => m.id !== memory.id));
                          setEditingMemory(null);
                        }}
                      />
                    </div>
                    
                    <div>
                      <label className="text-sm text-gray-400">제목</label>
                      <Input
                        value={memory.title}
                        onChange={(e) => {
                          setMemories(memories.map(m => 
                            m.id === memory.id ? { ...m, title: e.target.value } : m
                          ));
                        }}
                        className="bg-gray-800 border-gray-700 text-white"
                      />
                    </div>
                    
                    <div>
                      <label className="text-sm text-gray-400">내용</label>
                      <div className="relative">
                        <Textarea
                          value={memory.content}
                          onChange={(e) => {
                            const content = e.target.value;
                            if (content.length <= 1000) {
                              setMemories(memories.map(m => 
                                m.id === memory.id ? { ...m, content } : m
                              ));
                            }
                          }}
                          placeholder="내가 반말하는 걸 싫어한다."
                          className="bg-gray-800 border-gray-700 text-white min-h-[100px]"
                        />
                        <span className="absolute bottom-2 right-2 text-xs text-gray-400">
                          {memory.content.length}/1000
                        </span>
                      </div>
                    </div>
                    
                    <div className="flex items-center justify-between">
                      <label className="text-sm text-gray-400">활성화</label>
                      <Switch
                        checked={memory.isActive}
                        onCheckedChange={(checked) => {
                          setMemories(memories.map(m => 
                            m.id === memory.id ? { ...m, isActive: checked } : m
                          ));
                        }}
                      />
                    </div>
                    
                    <Button 
                      onClick={() => {
                        saveMemoryNote(memory);
                        setEditingMemory(null);
                      }}
                      className="w-full bg-yellow-500 hover:bg-yellow-600 text-black"
                    >
                      저장
                    </Button>
                  </div>
                ) : (
                  // 뷰 모드
                  <div 
                    className="bg-gray-900 text-white rounded-lg p-4 cursor-pointer hover:bg-gray-800"
                    onClick={() => setEditingMemory(memory.id)}
                  >
                    <div className="flex items-center justify-between">
                      <h4 className="font-semibold">{memory.title}</h4>
                      <div className="flex items-center space-x-2">
                        <Switch
                          checked={memory.isActive}
                          onCheckedChange={(checked) => {
                            const updatedMemory = { ...memory, isActive: checked };
                            setMemories(memories.map(m => 
                              m.id === memory.id ? { ...m, isActive: checked } : m
                            ));
                            // 서버에 즉시 저장
                            saveMemoryNote(updatedMemory);
                          }}
                          onClick={(e) => e.stopPropagation()}
                        />
                        <X 
                          className="w-5 h-5 cursor-pointer hover:text-red-400" 
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteMemoryNoteFromServer(memory.id);
                            setMemories(memories.filter(m => m.id !== memory.id));
                          }}
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* 추가 설정 탭 */}
        {activeTab === 'settings' && (
          <div className="space-y-4">
            <h3 className="font-semibold mb-2">추가 설정</h3>
            {/* 테마 (현재: 다크 고정 / 시스템·라이트 비활성화) */}
            <div className="mt-2 p-3 rounded-lg border">
              <div className="text-sm text-gray-700 mb-2">색상 테마</div>
              <div className="flex items-center gap-4">
                {['system','dark','light'].map(t => (
                  <label
                    key={t}
                    className={`inline-flex items-center gap-2 ${t === 'dark' ? 'cursor-pointer' : 'cursor-not-allowed opacity-50'}`}
                    title={t === 'dark' ? undefined : '준비 중인 기능입니다'}
                  >
                    <input
                      type="radio"
                      name="theme"
                      className="accent-purple-600"
                      checked={uiTheme===t}
                      disabled={t !== 'dark'}
                      onChange={() => {
                        if (t !== 'dark') return;
                        setUiTheme('dark');
                      }}
                    />
                    <span className="text-sm">{t==='system'?'시스템':t==='dark'?'다크':'라이트'}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* 출력 속도 */}
            <div className="mt-2 p-3 rounded-lg border">
              <div className="text-sm text-gray-700 mb-2">대화 출력 속도: {typingSpeed} chars/s</div>
              <input type="range" min="10" max="80" value={typingSpeed} onChange={(e)=>setTypingSpeed(parseInt(e.target.value)||40)} className="w-full" />
            </div>
            {/* 답변 길이 라디오 (이 탭으로 이동) */}
            <div className="mt-2 p-3 rounded-lg border">
              <div className="text-sm text-gray-700 mb-2">답변 길이</div>
              <div className="flex items-center gap-4">
                <label className="inline-flex items-center gap-2 cursor-pointer">
                  <input type="radio" name="respLen" className="accent-purple-600" checked={responseLength==='short'} onChange={()=>{ setResponseLength('short'); try { onUpdateChatSettings && onUpdateChatSettings({ response_length_pref: 'short' }); } catch(_) {} }} />
                  <span className="text-sm">짧게 (-50%)</span>
                </label>
                <label className="inline-flex items-center gap-2 cursor-pointer">
                  <input type="radio" name="respLen" className="accent-purple-600" checked={responseLength==='medium'} onChange={()=>{ setResponseLength('medium'); try { onUpdateChatSettings && onUpdateChatSettings({ response_length_pref: 'medium' }); } catch(_) {} }} />
                  <span className="text-sm">중간 (기본)</span>
                </label>
                <label className="inline-flex items-center gap-2 cursor-pointer">
                  <input type="radio" name="respLen" className="accent-purple-600" checked={responseLength==='long'} onChange={()=>{ setResponseLength('long'); try { onUpdateChatSettings && onUpdateChatSettings({ response_length_pref: 'long' }); } catch(_) {} }} />
                  <span className="text-sm">많이 (+50%)</span>
                </label>
              </div>
            </div>

            {/* 원작챗 추가 설정(즉시 저장) */}
            {isOrigChat && (
              <>
                <div className="mt-2 p-3 rounded-lg border">
                  <div className="text-sm text-gray-700 mb-2">보정 단계</div>
                  <div className="flex items-center gap-4">
                    {['always','first2','off'].map(v => (
                      <label key={v} className="inline-flex items-center gap-2 cursor-pointer">
                        <input type="radio" name="ppMode" className="accent-purple-600" checked={ppModeSel===v} onChange={()=>{ setPpModeSel(v); try { onUpdateChatSettings && onUpdateChatSettings({ postprocess_mode: v }); } catch(_) {} }} />
                        <span className="text-sm">{v==='always'?'항상 ON': v==='first2'?'처음 2턴만 ON':'OFF'}</span>
                      </label>
                    ))}
                  </div>
                </div>
                <div className="mt-2 p-3 rounded-lg border">
                  <div className="text-sm text-gray-700 mb-2">자동 진행 길이</div>
                  <div className="flex items-center gap-4">
                    {[1,2].map(v => (
                      <label key={v} className="inline-flex items-center gap-2 cursor-pointer">
                        <input type="radio" name="nextLen" className="accent-purple-600" checked={nextLenSel===v} onChange={()=>{ setNextLenSel(v); try { onUpdateChatSettings && onUpdateChatSettings({ next_event_len: v }); } catch(_) {} }} />
                        <span className="text-sm">{v}장면</span>
                      </label>
                    ))}
                  </div>
                </div>

                {/* 프리워밍: 현재 운영은 기본 ON으로만 사용(비노출) */}
              </>
            )}

            {/* 글자 크기 */}
            <div className="mt-2 p-3 rounded-lg border">
              <div className="text-sm text-gray-700 mb-2">글자 크기</div>
              <div className="flex items-center gap-4">
                {['sm','base','lg','xl'].map(sz => (
                  <label key={sz} className="inline-flex items-center gap-2 cursor-pointer">
                    <input type="radio" name="fontSize" className="accent-purple-600" checked={uiFontSize===sz} onChange={()=>setUiFontSize(sz)} />
                    <span className="text-sm">{sz}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* 자간 */}
            <div className="mt-2 p-3 rounded-lg border">
              <div className="text-sm text-gray-700 mb-2">자간</div>
              <div className="flex items-center gap-4">
                {['tighter','tight','normal','wide','wider'].map(sp => (
                  <label key={sp} className="inline-flex items-center gap-2 cursor-pointer">
                    <input type="radio" name="letterSpacing" className="accent-purple-600" checked={uiLetterSpacing===sp} onChange={()=>setUiLetterSpacing(sp)} />
                    <span className="text-sm">{sp}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* 배경 오버레이 투명도 */}
            <div className="mt-2 p-3 rounded-lg border">
              <div className="text-sm text-gray-700 mb-2">배경 오버레이 투명도: {uiOverlay}%</div>
              <input type="range" min="0" max="100" value={uiOverlay} onChange={(e)=>setUiOverlay(parseInt(e.target.value)||0)} className="w-full" />
            </div>

            {/* 폰트 */}
            <div className="mt-2 p-3 rounded-lg border">
              <div className="text-sm text-gray-700 mb-2">폰트</div>
              <div className="flex items-center gap-4">
                <label className="inline-flex items-center gap-2 cursor-pointer">
                  <input type="radio" name="fontFam" className="accent-purple-600" checked={uiFontFamily==='sans'} onChange={()=>setUiFontFamily('sans')} />
                  <span className="text-sm">고딕체 (Pretendard)</span>
                </label>
                <label className="inline-flex items-center gap-2 cursor-pointer">
                  <input type="radio" name="fontFam" className="accent-purple-600" checked={uiFontFamily==='serif'} onChange={()=>setUiFontFamily('serif')} />
                  <span className="text-sm">바탕체 (Noto Serif)</span>
                </label>
              </div>
            </div>

            {/* 색상: 팔레트 팝오버 */}
            <div className="mt-2 p-3 rounded-lg border">
              <div className="text-sm text-gray-700 mb-3">폰트 색상</div>
              <div className="grid grid-cols-2 gap-4">
                {[
                  { key: 'charSpeech', label: '캐릭터 대사' },
                  { key: 'userSpeech', label: '유저 대사' },
                  { key: 'charNarration', label: '캐릭터 지문' },
                  { key: 'userNarration', label: '유저 지문' }
                ].map((it) => (
                  <div key={it.key}>
                    <div className="text-xs text-gray-600 mb-1">{it.label}</div>
                    <Popover>
                      <PopoverTrigger asChild>
                        <button className="w-10 h-6 rounded border" style={{ backgroundColor: uiColors[it.key] }} title="색상 선택" />
                      </PopoverTrigger>
                      <PopoverContent align="start" className="w-auto p-2">
                        <div className="grid grid-cols-10 gap-1">
                          {['#000000','#434343','#666666','#999999','#b7b7b7','#cccccc','#d9d9d9','#efefef','#f3f3f3','#ffffff',
                            '#980000','#ff0000','#ff9900','#ffff00','#00ff00','#00ffff','#4a86e8','#0000ff','#9900ff','#ff00ff',
                            '#e6b8af','#f4cccc','#fce5cd','#fff2cc','#d9ead3','#d0e0e3','#c9daf8','#cfe2f3','#d9d2e9','#ead1dc',
                            '#dd7e6b','#ea9999','#f9cb9c','#ffe599','#b6d7a8','#a2c4c9','#a4c2f4','#9fc5e8','#b4a7d6','#d5a6bd',
                            '#cc4125','#e06666','#f6b26b','#ffd966','#93c47d','#76a5af','#6d9eeb','#6fa8dc','#8e7cc3','#c27ba0',
                            '#a61c00','#cc0000','#e69138','#f1c232','#6aa84f','#45818e','#3c78d8','#3d85c6','#674ea7','#a64d79'].map((c) => (
                              <button key={c} className="w-5 h-5 rounded border" style={{ backgroundColor: c }} onClick={()=>setUiColors({...uiColors, [it.key]: c})} />
                            ))}
                        </div>
                      </PopoverContent>
                    </Popover>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* 하단 버튼 */}
        <div className="flex justify-center space-x-4 pt-6">
          <Button 
            onClick={onClose}
            variant="outline"
            className="px-8"
          >
            취소
          </Button>
          <Button 
            onClick={handleSave}
            className="px-8 bg-purple-600 hover:bg-purple-700"
          >
            확인
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default ModelSelectionModal;