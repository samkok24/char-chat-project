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
import { Badge } from './ui/badge';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { Switch } from './ui/switch';
import { Slider } from './ui/slider';
import { 
  ChevronDown, 
  Check, 
  X, 
  Coins 
} from 'lucide-react';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from './ui/collapsible';

const ModelSelectionModal = ({ isOpen, onClose, currentModel, currentSubModel, onModelChange, initialTab = 'model', characterName = '캐릭터', characterId, onUpdateChatSettings }) => {
  // temperature 기본값: 백엔드 ai_service의 기본 temperature(0.7)와 정합
  const DEFAULT_TEMPERATURE = 0.7;
  const [selectedModel, setSelectedModel] = useState(currentModel || 'gemini');
  const [selectedSubModel, setSelectedSubModel] = useState(currentSubModel || 'gemini-2.5-pro');
  const [activeTab, setActiveTab] = useState(initialTab);
  const [expandedSections, setExpandedSections] = useState({
    gemini: true,
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
  const [uiOverlay, setUiOverlay] = useState(60); // 0~100
  const [uiFontFamily, setUiFontFamily] = useState('sans'); // sans|serif
  const [uiColors, setUiColors] = useState({
    charSpeech: '#ffffff',
    charNarration: '#cfcfcf',
    userSpeech: '#111111',
    userNarration: '#333333'
  });
  const [uiTheme, setUiTheme] = useState('system'); // system|dark|light
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

  const models = {
    gemini: {
      name: 'Gemini 모델',
      cost: 8,
      subModels: [
        { id: 'gemini-3-flash', name: 'Gemini 3 Flash', description: '빠르면서 밀도 있는 AI', cost: 4, badge: '이벤트', badgeClass: 'bg-amber-500 text-black hover:bg-amber-500' },
        { id: 'gemini-3-pro', name: 'Gemini 3 Pro', description: '상황 묘사와 플롯테이킹이 강한 최고 성능의 AI', cost: 8, badge: '이벤트', badgeClass: 'bg-amber-500 text-black hover:bg-amber-500' },
        { id: 'gemini-2.5-pro-positive', name: 'Gemini 2.5 Pro Positive', description: '긍정적 사고, 희망적인 시선과 따뜻한 어조의 응답', cost: 8 },
        // ✅ 기존 기본값(gemini-2.5-pro) 유지: 백엔드 호환 + 기본 선택값 유지
        { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro Standard', description: '비판적 사고, 냉철한 판단과 직설적 어조의 응답', cost: 8, badge: '인기', badgeClass: 'bg-pink-600 text-white hover:bg-pink-600' },
        { id: 'gemini-2.5-pro-image', name: 'Gemini 2.5 Pro Image', description: '대화 중에도 이미지를 자연스럽게, 파란색 Gemini 2.5 Pro 기반', cost: 8, badge: '추천', badgeClass: 'bg-emerald-500 text-black hover:bg-emerald-500' },
      ]
    },
    claude: {
      name: 'Claude 모델',
      cost: 10,
      subModels: [
        { id: 'claude-opus-4.5', name: 'Claude Opus 4.5', description: '더 향상된 Claude의 플래그십 모델', cost: 20, badge: '신규', badgeClass: 'bg-pink-600 text-white hover:bg-pink-600' },
        { id: 'claude-sonnet-4.5', name: 'Claude Sonnet 4.5', description: '빠르고 안정적인 성능의 올라운더 AI', cost: 10, badge: '인기', badgeClass: 'bg-pink-600 text-white hover:bg-pink-600' },
        { id: 'claude-sonnet-4.5-think', name: 'Claude Sonnet 4.5 Think', description: '추론을 더해 깊이 있는 대화', cost: 12 },
        // ✅ 백엔드 매핑 존재(claude-4-sonnet, claude-3.7-sonnet)
        { id: 'claude-4-sonnet', name: 'Claude Sonnet 4', description: '정확한 정보 처리와 자연스러운 대화의 조화, 다양한 분야에 적합', cost: 10 },
        { id: 'claude-3.7-sonnet', name: 'Claude 3.7 Sonnet', description: '안정적인 하이브리드 모델, Claude 시리즈의 균형 잡힌 선택지', cost: 10 },
      ]
    },
    gpt: {
      name: 'GPT 모델',
      cost: 10,
      subModels: [
        // ✅ 기존 사용자 설정 모델도 유지(호환)
        { id: 'gpt-4o', name: 'GPT-4o', description: 'OpenAI의 멀티모달 모델', cost: 10 },
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
      const safeModel = (currentModel && models[currentModel]) ? currentModel : 'gemini';
      if (currentModel && !models[currentModel]) {
        console.warn('[ModelSelectionModal] unsupported model, fallback to gemini:', currentModel);
      }
      setSelectedModel(safeModel);

      const list = models[safeModel]?.subModels || [];
      const safeSub =
        (currentSubModel && list.some((s) => s.id === currentSubModel))
          ? currentSubModel
          : (list[0]?.id || 'gemini-2.5-pro');
      setSelectedSubModel(safeSub);
    } catch (_) {
      setSelectedModel('gemini');
      setSelectedSubModel('gemini-2.5-pro');
    }
  }, [currentModel, currentSubModel, isOpen]);

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
          if (parsed.theme) setUiTheme(parsed.theme);
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
      } else if (activeTab === 'settings') {
        // 추가 설정 탭: 답변 길이 + 전역 UI 설정 로컬 저장
        await usersAPI.updateModelSettings(selectedModel, selectedSubModel, responseLength);
        const ui = { fontSize: uiFontSize, letterSpacing: uiLetterSpacing, overlay: uiOverlay, fontFamily: uiFontFamily, colors: uiColors, theme: uiTheme, typingSpeed };
        localStorage.setItem('cc:ui:v1', JSON.stringify(ui));
        window.dispatchEvent(new CustomEvent('ui:settingsChanged', { detail: ui }));
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
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" aria-describedby="model-modal-desc">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold">설정</DialogTitle>
          {/* 현재 선택된 모델 표시 */}
          <div className="mt-2 p-3 bg-blue-50 rounded-lg border">
            <div className="text-sm text-gray-600">현재 선택된 모델</div>
            <div className="font-medium text-blue-800">
              {models[selectedModel]?.name || selectedModel} - {models[selectedModel]?.subModels?.find(sub => sub.id === selectedSubModel)?.name || selectedSubModel}
            </div>
          </div>
        </DialogHeader>
        <div id="model-modal-desc" className="sr-only">모델 및 대화 설정을 구성하는 모달</div>


        {/* 탭 메뉴 */}
        <div className="border-b mb-6">
          <div className="flex space-x-6">
            <button 
              onClick={() => setActiveTab('model')}
              className={`pb-2 ${activeTab === 'model' ? 'border-b-2 border-purple-500 text-purple-600 font-medium' : 'text-gray-500 hover:text-gray-700'}`}
            >
              모델 선택
            </button>
                                    <button 
                          onClick={() => setActiveTab('profile')}
                          className={`pb-2 ${activeTab === 'profile' ? 'border-b-2 border-purple-500 text-purple-600 font-medium' : 'text-gray-500 hover:text-gray-700'}`}
                        >
                          유저 페르소나
                        </button>
            <button 
              onClick={() => setActiveTab('notes')}
              className={`pb-2 ${activeTab === 'notes' ? 'border-b-2 border-purple-500 text-purple-600 font-medium' : 'text-gray-500 hover:text-gray-700'}`}
            >
              기억노트
            </button>
            <button 
              onClick={() => setActiveTab('settings')}
              className={`pb-2 ${activeTab === 'settings' ? 'border-b-2 border-purple-500 text-purple-600 font-medium' : 'text-gray-500 hover:text-gray-700'}`}
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

          {/* ✅ 공통 Temperature 설정 (0~1, 0.1 step) */}
          <div className="rounded-lg border border-gray-700 bg-gray-900 text-white p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold">Temperature</div>
                <div className="text-xs text-gray-300 mt-1">
                  0에 가까울수록 안정적/일관적, 1에 가까울수록 창의적/다양해요.
                </div>
                <div className="text-[11px] text-gray-400 mt-1">
                  기본값: {DEFAULT_TEMPERATURE.toFixed(1)}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <div className="text-sm font-mono text-white/90">
                  {Number(temperatureSel).toFixed(1)}
                </div>
                <Button
                  type="button"
                  variant="outline"
                  className="h-8 px-3 border-white/20 bg-white/5 text-white hover:bg-white/10"
                  onClick={() => {
                    const v = DEFAULT_TEMPERATURE;
                    setTemperatureSel(v);
                    try { onUpdateChatSettings && onUpdateChatSettings({ temperature: v }); } catch (_) {}
                  }}
                >
                  기본값
                </Button>
              </div>
            </div>
            <div className="mt-3">
              <Slider
                value={[Number(temperatureSel) || DEFAULT_TEMPERATURE]}
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
              <div className="mt-2 flex justify-between text-[10px] text-gray-400">
                <span>0.0</span>
                <span>{DEFAULT_TEMPERATURE.toFixed(1)}</span>
                <span>1.0</span>
              </div>
            </div>
          </div>

          {Object.entries(models).map(([modelId, model]) => (
            <Collapsible 
              key={modelId}
              open={expandedSections[modelId]}
              onOpenChange={() => toggleSection(modelId)}
            >
              <CollapsibleTrigger asChild>
                <div className="w-full flex items-center justify-between p-3 bg-gray-800 text-white rounded-lg hover:bg-gray-700 transition-colors cursor-pointer">
                  <div className="flex items-center space-x-3">
                    <span className="font-medium">{model.name}</span>
                    {model.isEvent && (
                      <Badge className="bg-green-500 text-white text-xs">EVENT</Badge>
                    )}
                    {selectedModel === modelId && (
                      <Check className="w-4 h-4 text-green-400" />
                    )}
                  </div>
                  <ChevronDown className={`w-4 h-4 transition-transform ${expandedSections[modelId] ? 'rotate-180' : ''}`} />
                </div>
              </CollapsibleTrigger>

              <CollapsibleContent className="mt-2 space-y-2">
                {model.subModels.map((subModel) => (
                  <div
                    key={subModel.id}
                    className={`p-3 rounded-lg border cursor-pointer transition-colors ${
                      isSelected(modelId, subModel.id)
                        ? 'border-purple-500 bg-purple-50'
                        : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                    }`}
                    onClick={() => handleModelSelect(modelId, subModel.id)}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-3">
                        <div>
                          <div className="flex items-center space-x-2">
                            <span className="font-medium">{subModel.name}</span>
                            {subModel.badge && (
                              <Badge className={`${subModel.badgeClass || 'bg-red-500 text-white'} text-xs`}>
                                {subModel.badge}
                              </Badge>
                            )}
                            {isSelected(modelId, subModel.id) && (
                              <Check className="w-4 h-4 text-purple-600" />
                            )}
                          </div>
                          <p className="text-sm text-gray-600 mt-1">{subModel.description}</p>
                        </div>
                      </div>
                      <Badge className="bg-yellow-100 text-yellow-800">
                        {subModel.cost}P
                      </Badge>
                    </div>
                  </div>
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
              <h3 className="font-semibold mb-2">로어북 추가 후 그동안의 스토리를 내용 안에 적으면 캐릭터가 잊지 않고 기억해요.</h3>
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
            {/* 테마 */}
            <div className="mt-2 p-3 rounded-lg border">
              <div className="text-sm text-gray-700 mb-2">색상 테마</div>
              <div className="flex items-center gap-4">
                {['system','dark','light'].map(t => (
                  <label key={t} className="inline-flex items-center gap-2 cursor-pointer">
                    <input type="radio" name="theme" className="accent-purple-600" checked={uiTheme===t} onChange={()=>setUiTheme(t)} />
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
            <div className="mt-2 p-3 rounded-lg border">
              <div className="text-sm text-gray-700 mb-2">프리워밍</div>
              <div className="flex items-center gap-4">
                <label className="inline-flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" className="accent-purple-600" checked={prewarmSel} onChange={(e)=>{ setPrewarmSel(!!e.target.checked); try { onUpdateChatSettings && onUpdateChatSettings({ prewarm_on_start: !!e.target.checked }); } catch(_) {} }} />
                  <span className="text-sm">ON</span>
                </label>
              </div>
            </div>

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