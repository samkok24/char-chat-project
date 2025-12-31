import React, { useState, useEffect } from 'react';
import { userPersonasAPI } from '../lib/api';
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle,
  DialogFooter
} from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { Switch } from './ui/switch';
import { X, Edit2, Trash2, Star, Check } from 'lucide-react';

const APPLY_SCOPE_OPTIONS = [
  { value: 'all', label: '모두 적용' },
  { value: 'character', label: '일반 캐릭터챗만' },
  { value: 'origchat', label: '원작챗만' },
];

const UserPersonaModal = ({ isOpen, onClose }) => {
  const [personas, setPersonas] = useState([]);
  const [newPersonaName, setNewPersonaName] = useState('');
  const [newPersonaDescription, setNewPersonaDescription] = useState('');
  const [newPersonaScope, setNewPersonaScope] = useState('all');
  const [editingPersona, setEditingPersona] = useState(null);
  const [activePersona, setActivePersona] = useState(null);

  // 모달이 열릴 때 페르소나 목록 로드
  useEffect(() => {
    if (isOpen) {
      loadUserPersonas();
    }
  }, [isOpen]);

  const loadUserPersonas = async () => {
    try {
      const response = await userPersonasAPI.getUserPersonas();
      setPersonas(response.data.personas.map(persona => ({
        id: persona.id,
        name: persona.name,
        description: persona.description,
        isDefault: persona.is_default,
        isActive: persona.is_active,
        applyScope: persona.apply_scope || 'all'
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
          is_default: persona.isDefault,
          apply_scope: persona.applyScope || 'all'
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
          is_default: persona.isDefault,
          apply_scope: persona.applyScope || 'all'
        });
      }
      // 페르소나 목록 새로고침
      await loadUserPersonas();
    } catch (error) {
      console.error('페르소나 저장 실패:', error);
    }
  };

  const deleteUserPersonaFromServer = async (personaId) => {
    try {
      if (typeof personaId !== 'number') {
        await userPersonasAPI.deleteUserPersona(personaId);
        // 페르소나 목록 새로고침
        await loadUserPersonas();
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

  const handleConfirm = () => {
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      {/* ✅ 모바일 최적화: 화면 높이 내에서 스크롤 가능하도록 제한 */}
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold">유저 페르소나 관리</DialogTitle>
          <p className="text-sm text-gray-600 mt-2">
            캐릭터가 당신을 어떻게 인식할지 설정할 수 있습니다.
          </p>
          {activePersona && (
            <div className="mt-3 p-3 bg-green-50 rounded-lg border border-green-200">
              <div className="text-sm text-green-600">현재 활성 페르소나</div>
              <div className="font-medium text-green-800 break-words">
                {activePersona.name} - {activePersona.description}
              </div>
            </div>
          )}
        </DialogHeader>

        <div className="py-6 space-y-4">
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
            {/* 적용 범위 선택 */}
            <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 py-2">
              <span className="text-sm text-gray-600 whitespace-nowrap">적용 범위:</span>
              <div className="flex gap-2 flex-wrap">
                {APPLY_SCOPE_OPTIONS.map(opt => (
                  <label key={opt.value} className="flex items-center gap-1 cursor-pointer">
                    <input
                      type="radio"
                      name="newPersonaScope"
                      value={opt.value}
                      checked={newPersonaScope === opt.value}
                      onChange={(e) => setNewPersonaScope(e.target.value)}
                      className="accent-purple-600"
                    />
                    <span className="text-sm">{opt.label}</span>
                  </label>
                ))}
              </div>
            </div>
            <Button 
              onClick={async () => {
                if (newPersonaName.trim() && newPersonaDescription.trim()) {
                  try {
                    const response = await userPersonasAPI.createUserPersona({
                      name: newPersonaName,
                      description: newPersonaDescription,
                      is_default: personas.length === 0,
                      apply_scope: newPersonaScope
                    });
                    setNewPersonaName('');
                    setNewPersonaDescription('');
                    setNewPersonaScope('all');
                    // 목록 새로고침
                    await loadUserPersonas();
                  } catch (error) {
                    console.error('페르소나 추가 실패:', error);
                  }
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
          <div className="space-y-3">
            {personas.map((persona) => (
              <div key={persona.id}>
                {editingPersona === persona.id ? (
                  // 편집 모드
                  <div className="bg-gray-50 rounded-lg p-4 space-y-3 border-2 border-purple-300">
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="font-semibold">페르소나 편집</h4>
                      <Button
                        onClick={() => setEditingPersona(null)}
                        size="sm"
                        variant="ghost"
                      >
                        <X className="w-4 h-4" />
                      </Button>
                    </div>
                    
                    <Input
                      placeholder="페르소나 이름"
                      value={persona.name}
                      onChange={(e) => {
                        setPersonas(personas.map(p => 
                          p.id === persona.id ? { ...p, name: e.target.value } : p
                        ));
                      }}
                    />
                    
                    <Textarea
                      placeholder="페르소나 설명"
                      value={persona.description}
                      onChange={(e) => {
                        setPersonas(personas.map(p => 
                          p.id === persona.id ? { ...p, description: e.target.value } : p
                        ));
                      }}
                      className="min-h-[80px]"
                    />
                    
                    {/* 적용 범위 선택 (편집 모드) */}
                    <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 py-2">
                      <span className="text-sm text-gray-600 whitespace-nowrap">적용 범위:</span>
                      <div className="flex gap-2 flex-wrap">
                        {APPLY_SCOPE_OPTIONS.map(opt => (
                          <label key={opt.value} className="flex items-center gap-1 cursor-pointer">
                            <input
                              type="radio"
                              name={`editScope-${persona.id}`}
                              value={opt.value}
                              checked={(persona.applyScope || 'all') === opt.value}
                              onChange={(e) => {
                                setPersonas(personas.map(p => 
                                  p.id === persona.id ? { ...p, applyScope: e.target.value } : p
                                ));
                              }}
                              className="accent-purple-600"
                            />
                            <span className="text-sm">{opt.label}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                    
                    <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
                      <Button
                        onClick={() => setEditingPersona(null)}
                        variant="outline"
                        size="sm"
                        className="w-full sm:w-auto"
                      >
                        취소
                      </Button>
                      <Button
                        onClick={() => {
                          saveUserPersona(persona);
                          setEditingPersona(null);
                        }}
                        size="sm"
                        className="w-full sm:w-auto bg-purple-600 hover:bg-purple-700"
                      >
                        저장
                      </Button>
                    </div>
                  </div>
                ) : (
                  // 뷰 모드
                  <div className={`rounded-lg p-4 border-2 transition-colors ${
                    persona.isActive 
                      ? 'bg-blue-50 border-blue-300' 
                      : 'bg-gray-50 border-gray-200'
                  }`}>
                    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <h4 className="font-semibold">{persona.name}</h4>
                          {persona.isDefault && (
                            <span className="text-xs bg-yellow-500 text-white px-2 py-0.5 rounded">기본</span>
                          )}
                          {persona.isActive && (
                            <span className="text-xs bg-green-500 text-white px-2 py-0.5 rounded">활성</span>
                          )}
                        </div>
                        <p className="text-sm text-gray-600">{persona.description}</p>
                        <p className="text-xs text-gray-400 mt-1">
                          적용: {APPLY_SCOPE_OPTIONS.find(o => o.value === (persona.applyScope || 'all'))?.label || '모두 적용'}
                        </p>
                      </div>
                      
                      <div className="flex flex-wrap items-center gap-1 ml-0 sm:ml-4">
                        {/* 활성화 버튼 */}
                        <Button
                          onClick={() => setActiveUserPersona(persona.id)}
                          size="sm"
                          variant={persona.isActive ? "default" : "outline"}
                          className={persona.isActive ? 'bg-green-600 hover:bg-green-700' : ''}
                          disabled={persona.isActive}
                        >
                          {persona.isActive ? <Check className="w-4 h-4" /> : '활성화'}
                        </Button>
                        
                        {/* 대표 설정 버튼 */}
                        <Button
                          onClick={async () => {
                            try {
                              await userPersonasAPI.updateUserPersona(persona.id, {
                                name: persona.name,
                                description: persona.description,
                                is_default: !persona.isDefault
                              });
                              await loadUserPersonas();
                            } catch (error) {
                              console.error('대표 페르소나 설정 실패:', error);
                            }
                          }}
                          size="sm"
                          variant="ghost"
                          className={persona.isDefault ? 'text-yellow-600' : ''}
                        >
                          <Star className={`w-4 h-4 ${persona.isDefault ? 'fill-current' : ''}`} />
                        </Button>
                        
                        {/* 수정 버튼 */}
                        <Button
                          onClick={() => setEditingPersona(persona.id)}
                          size="sm"
                          variant="ghost"
                        >
                          <Edit2 className="w-4 h-4" />
                        </Button>
                        
                        {/* 삭제 버튼 */}
                        <Button
                          onClick={() => {
                            if (confirm('이 페르소나를 삭제하시겠습니까?')) {
                              deleteUserPersonaFromServer(persona.id);
                            }
                          }}
                          size="sm"
                          variant="ghost"
                          className="text-red-600 hover:text-red-700"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        <DialogFooter>
          <Button 
            onClick={onClose}
            variant="outline"
            className="w-full sm:w-auto"
          >
            취소
          </Button>
          <Button 
            onClick={handleConfirm}
            className="w-full sm:w-auto bg-purple-600 hover:bg-purple-700"
          >
            확인
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default UserPersonaModal;