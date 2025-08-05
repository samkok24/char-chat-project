import React, { useState, useEffect } from 'react';
import { usersAPI, memoryNotesAPI, userPersonasAPI } from '../lib/api';
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle 
} from './ui/dialog';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { Switch } from './ui/switch';
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

const ModelSelectionModal = ({ isOpen, onClose, currentModel, currentSubModel, onModelChange, initialTab = 'model', characterName = '캐릭터', characterId }) => {
  const [selectedModel, setSelectedModel] = useState(currentModel || 'gemini');
  const [selectedSubModel, setSelectedSubModel] = useState(currentSubModel || 'gemini-2.5-pro');
  const [activeTab, setActiveTab] = useState(initialTab);
  const [expandedSections, setExpandedSections] = useState({
    gemini: true,
    claude: false,
    gpt: false,
    argo: false
  });
  
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

  // 현재 모델이 변경되면 선택된 모델 업데이트
  useEffect(() => {
    if (currentModel) {
      setSelectedModel(currentModel);
    }
    if (currentSubModel) {
      setSelectedSubModel(currentSubModel);
    }
  }, [currentModel, currentSubModel]);

  // initialTab이 변경되면 activeTab 업데이트
  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

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

  const models = {
    gemini: {
      name: 'Gemini 모델',
      cost: 10,
      subModels: [
        { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', description: 'Google의 최신 2.5 Pro 모델', cost: 10 },
        { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', description: '빠른 응답 속도의 2.5 Flash', cost: 5 }
      ]
    },
    claude: {
      name: 'Claude 모델',
      cost: 10,
      subModels: [
        { 
          id: 'claude-4-sonnet', 
          name: 'Claude 4 Sonnet', 
          description: 'Claude 시리즈 중 가장 최신 모델을 현존 최고 지능의 모델',
          cost: 10,
          isNew: true
        },
        { 
          id: 'claude-3.7-sonnet', 
          name: 'Claude 3.7 Sonnet', 
          description: 'Claude 3.5 Sonnet v2의 후속 모델을 뛰어난 지능의 모델',
          cost: 10
        },
        { 
          id: 'claude-3.5-sonnet-v2', 
          name: 'Claude 3.5 Sonnet v2', 
          description: '기존 Claude 3.5 Sonnet 보다 향상된 표현력과 지능',
          cost: 10
        }
      ]
    },
    gpt: {
      name: 'GPT 모델',
      cost: 10,
      subModels: [
        { id: 'gpt-4.1', name: 'GPT-4.1', description: 'OpenAI의 최신 GPT-4.1 모델', cost: 12 },
        { id: 'gpt-4.1-mini', name: 'GPT-4.1 Mini', description: '경량화된 GPT-4.1 모델', cost: 6 },
        { id: 'gpt-4o', name: 'GPT-4o', description: 'OpenAI의 멀티모달 모델', cost: 10 }
      ]
    },
    argo: {
      name: 'ARGO 모델',
      isEvent: true,
      cost: 4,
      subModels: [
        { id: 'argo-custom', name: 'ARGO Custom', description: '자사 커스텀 파인튜닝 모델', cost: 4 }
      ]
    }
  };

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
      // 모델 탭인 경우에만 모델 설정 저장
      if (activeTab === 'model') {
        await usersAPI.updateModelSettings(selectedModel, selectedSubModel);
        onModelChange(selectedModel, selectedSubModel);
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
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold">설정</DialogTitle>
          {/* 현재 선택된 모델 표시 */}
          <div className="mt-2 p-3 bg-blue-50 rounded-lg border">
            <div className="text-sm text-gray-600">현재 선택된 모델</div>
            <div className="font-medium text-blue-800">
              {models[selectedModel]?.name} - {models[selectedModel]?.subModels.find(sub => sub.id === selectedSubModel)?.name}
            </div>
          </div>
        </DialogHeader>



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
                            {subModel.isNew && (
                              <Badge className="bg-red-500 text-white text-xs">신규</Badge>
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
            <p className="text-sm text-gray-600">추가 설정 옵션들이 여기에 표시됩니다.</p>
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