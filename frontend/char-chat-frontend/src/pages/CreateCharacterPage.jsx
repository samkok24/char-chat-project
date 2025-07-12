/**
 * CAVEDUCK 스타일 고급 캐릭터 생성/수정 페이지
 * 5단계 탭 시스템: 기본정보 → 미디어 → 예시대화 → 호감도 → 공개설정
 */

import React, { useState, useEffect } from 'react';
import { useNavigate, Link, useParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { charactersAPI } from '../lib/api';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Textarea } from '../components/ui/textarea';
import { Switch } from '../components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Alert, AlertDescription } from '../components/ui/alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
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
  Palette
} from 'lucide-react';

const CreateCharacterPage = () => {
  const { characterId } = useParams();
  const isEditMode = !!characterId;

  // 🔥 CAVEDUCK 스타일 5단계 데이터 구조
  const [activeTab, setActiveTab] = useState('basic');
  const [formData, setFormData] = useState({
    // 1단계: 기본 정보
    basic_info: {
      name: '',
      description: '',
      personality: '',
      speech_style: '',
      greeting: '',
      world_setting: '',
      user_display_description: '',
      use_custom_description: false,
      introduction_scenes: [
        { title: '도입부 1', content: '', secret: '' }
      ],
      character_type: 'roleplay',
      base_language: 'ko'
    },
    // 2단계: 미디어 설정
    media_settings: {
      avatar_url: '',
      image_descriptions: [],
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

  const { isAuthenticated } = useAuth();
  const navigate = useNavigate();

  // 탭 정보 정의
  const tabs = [
    {
      id: 'basic',
      label: '기본 정보',
      icon: Sparkles,
      description: '캐릭터의 기본 설정',
      emoji: '🔥'
    },
    {
      id: 'media',
      label: '미디어',
      icon: Palette,
      description: '이미지와 음성 설정',
      emoji: '🎨'
    },
    {
      id: 'dialogues',
      label: '예시 대화',
      icon: MessageCircle,
      description: 'AI 응답 품질 향상',
      emoji: '💬'
    },
    {
      id: 'affinity',
      label: '호감도',
      icon: Heart,
      description: '관계 시스템 설정',
      emoji: '❤️'
    },
    {
      id: 'publish',
      label: '공개 설정',
      icon: Globe,
      description: '공개 및 고급 설정',
      emoji: '🚀'
    }
  ];

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
      // 🔥 고급 캐릭터 상세 정보 API 호출
      const response = await fetch(`/api/characters/advanced/${characterId}`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      });
      
      if (!response.ok) {
        throw new Error('캐릭터 정보를 불러올 수 없습니다.');
      }
      
      const char = await response.json();
      
      // 🔥 고급 캐릭터 데이터 구조로 매핑
      setFormData(prev => ({
        basic_info: {
          name: char.name || '',
          description: char.description || '',
          personality: char.personality || '',
          speech_style: char.speech_style || '',
          greeting: char.greeting || '',
          world_setting: char.world_setting || '',
          user_display_description: char.user_display_description || '',
          use_custom_description: char.use_custom_description || false,
          introduction_scenes: char.introduction_scenes || [{ title: '도입부 1', content: '', secret: '' }],
          character_type: char.character_type || 'roleplay',
          base_language: char.base_language || 'ko'
        },
        media_settings: {
          avatar_url: char.avatar_url || '',
          image_descriptions: char.image_descriptions || [],
          voice_settings: char.voice_settings || {
            voice_id: null,
            voice_style: null,
            enabled: false
          }
        },
        example_dialogues: {
          dialogues: char.example_dialogues || []
        },
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
    const newScene = { title: `도입부 ${formData.basic_info.introduction_scenes.length + 1}`, content: '', secret: '' };
    updateFormData('basic_info', 'introduction_scenes', [...formData.basic_info.introduction_scenes, newScene]);
  };

  const removeIntroductionScene = (index) => {
    const scenes = formData.basic_info.introduction_scenes.filter((_, i) => i !== index);
    updateFormData('basic_info', 'introduction_scenes', scenes);
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

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      if (isEditMode) {
        // 🔥 고급 캐릭터 수정 API 호출
        const updateData = {
          basic_info: {
            name: formData.basic_info.name,
            description: formData.basic_info.description,
            personality: formData.basic_info.personality,
            speech_style: formData.basic_info.speech_style,
            greeting: formData.basic_info.greeting,
            world_setting: formData.basic_info.world_setting,
            user_display_description: formData.basic_info.user_display_description,
            use_custom_description: formData.basic_info.use_custom_description,
            introduction_scenes: formData.basic_info.introduction_scenes,
            character_type: formData.basic_info.character_type,
            base_language: formData.basic_info.base_language
          },
          media_settings: {
            avatar_url: formData.media_settings.avatar_url,
            image_descriptions: formData.media_settings.image_descriptions,
            voice_settings: formData.media_settings.voice_settings
          },
          example_dialogues: {
            dialogues: formData.example_dialogues.dialogues
          },
          affinity_system: {
            has_affinity_system: formData.affinity_system.has_affinity_system,
            affinity_rules: formData.affinity_system.affinity_rules,
            affinity_stages: formData.affinity_system.affinity_stages
          },
          publish_settings: {
            is_public: formData.publish_settings.is_public,
            custom_module_id: formData.publish_settings.custom_module_id,
            use_translation: formData.publish_settings.use_translation
          }
        };
        
        const response = await fetch(`/api/characters/advanced/${characterId}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${localStorage.getItem('token')}`
          },
          body: JSON.stringify(updateData)
        });
        
        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.detail || '캐릭터 수정에 실패했습니다.');
        }
        
        navigate('/my-characters');
      } else {
        // 🔥 고급 캐릭터 생성 API 호출
        const createData = {
          basic_info: {
            name: formData.basic_info.name,
            description: formData.basic_info.description,
            personality: formData.basic_info.personality,
            speech_style: formData.basic_info.speech_style,
            greeting: formData.basic_info.greeting,
            world_setting: formData.basic_info.world_setting,
            user_display_description: formData.basic_info.user_display_description,
            use_custom_description: formData.basic_info.use_custom_description,
            introduction_scenes: formData.basic_info.introduction_scenes,
            character_type: formData.basic_info.character_type,
            base_language: formData.basic_info.base_language
          },
          media_settings: {
            avatar_url: formData.media_settings.avatar_url,
            image_descriptions: formData.media_settings.image_descriptions,
            voice_settings: formData.media_settings.voice_settings
          },
          example_dialogues: {
            dialogues: formData.example_dialogues.dialogues
          },
          affinity_system: {
            has_affinity_system: formData.affinity_system.has_affinity_system,
            affinity_rules: formData.affinity_system.affinity_rules,
            affinity_stages: formData.affinity_system.affinity_stages
          },
          publish_settings: {
            is_public: formData.publish_settings.is_public,
            custom_module_id: formData.publish_settings.custom_module_id,
            use_translation: formData.publish_settings.use_translation
          }
        };
        
        const response = await fetch('/api/characters/advanced', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${localStorage.getItem('token')}`
          },
          body: JSON.stringify(createData)
        });
        
        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.detail || '캐릭터 생성에 실패했습니다.');
        }
        
        const result = await response.json();
        navigate(`/chat/${result.id}`);
      }
    } catch (err) {
      console.error(`캐릭터 ${isEditMode ? '수정' : '생성'} 실패:`, err);
      setError(err.message || `캐릭터 ${isEditMode ? '수정' : '생성'}에 실패했습니다.`);
    } finally {
      setLoading(false);
    }
  };

  const renderBasicInfoTab = () => (
    <div className="space-y-6">
      <div className="space-y-4">
        <div>
          <Label htmlFor="name">캐릭터 이름 *</Label>
          <Input
            id="name"
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

        <div>
          <Label htmlFor="character_type">제작 유형</Label>
          <Select 
            value={formData.basic_info.character_type} 
            onValueChange={(value) => updateFormData('basic_info', 'character_type', value)}
          >
            <SelectTrigger>
              <SelectValue placeholder="캐릭터 유형 선택" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="roleplay">롤플레잉</SelectItem>
              <SelectItem value="simulator">시뮬레이터</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label htmlFor="base_language">기준 언어</Label>
          <Select 
            value={formData.basic_info.base_language} 
            onValueChange={(value) => updateFormData('basic_info', 'base_language', value)}
          >
            <SelectTrigger>
              <SelectValue placeholder="언어 선택" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ko">한국어</SelectItem>
              <SelectItem value="en">English</SelectItem>
              <SelectItem value="ja">日本語</SelectItem>
              <SelectItem value="zh">中文</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label htmlFor="description">캐릭터 설명 *</Label>
          <Textarea
            id="description"
            value={formData.basic_info.description}
            onChange={(e) => updateFormData('basic_info', 'description', e.target.value)}
            placeholder="캐릭터에 대한 설명입니다 (캐릭터 설명은 다른 사용자에게도 공개 됩니다)"
            rows={3}
            required
            maxLength={1000}
          />
        </div>

        <div>
          <Label htmlFor="personality">성격 및 특징</Label>
          <Textarea
            id="personality"
            value={formData.basic_info.personality}
            onChange={(e) => updateFormData('basic_info', 'personality', e.target.value)}
            placeholder="캐릭터의 성격과 특징을 자세히 설명해주세요"
            rows={4}
            maxLength={2000}
          />
        </div>

        <div>
          <Label htmlFor="speech_style">말투</Label>
          <Textarea
            id="speech_style"
            value={formData.basic_info.speech_style}
            onChange={(e) => updateFormData('basic_info', 'speech_style', e.target.value)}
            placeholder="캐릭터의 말투를 구체적으로 설명해주세요"
            rows={2}
            maxLength={1000}
          />
        </div>

        <div>
          <Label htmlFor="greeting">인사말</Label>
          <Textarea
            id="greeting"
            value={formData.basic_info.greeting}
            onChange={(e) => updateFormData('basic_info', 'greeting', e.target.value)}
            placeholder="채팅을 시작할 때 캐릭터가 건네는 첫마디"
            rows={2}
            maxLength={500}
          />
        </div>
      </div>

      <Separator />

      <div className="space-y-4">
        <h3 className="text-lg font-semibold">세계관</h3>
        <div>
          <Label htmlFor="world_setting">세계관 설정</Label>
          <Textarea
            id="world_setting"
            value={formData.basic_info.world_setting}
            onChange={(e) => updateFormData('basic_info', 'world_setting', e.target.value)}
            placeholder="이야기의 배경에 대해서 설명해주세요"
            rows={4}
            maxLength={3000}
          />
        </div>

        <div className="flex items-center space-x-2">
          <Switch
            id="use_custom_description"
            checked={formData.basic_info.use_custom_description}
            onCheckedChange={(checked) => updateFormData('basic_info', 'use_custom_description', checked)}
          />
          <Label htmlFor="use_custom_description">사용자에게 보여줄 설명을 별도로 작성할게요</Label>
        </div>

        {formData.basic_info.use_custom_description && (
          <div>
            <Label htmlFor="user_display_description">사용자용 설명</Label>
            <Textarea
              id="user_display_description"
              value={formData.basic_info.user_display_description}
              onChange={(e) => updateFormData('basic_info', 'user_display_description', e.target.value)}
              placeholder="사용자에게 보여질 별도의 설명을 작성하세요"
              rows={3}
              maxLength={2000}
            />
          </div>
        )}
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
          <Card key={index} className="p-4">
            <div className="flex items-center justify-between mb-3">
              <h4 className="font-medium">#{index + 1} {scene.title || '도입부'}</h4>
              {formData.basic_info.introduction_scenes.length > 1 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => removeIntroductionScene(index)}
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              )}
            </div>
            
            <div className="space-y-3">
              <div>
                <Label>시작하는 상황을 입력해주세요</Label>
                <Textarea
                  value={scene.content}
                  onChange={(e) => updateIntroductionScene(index, 'content', e.target.value)}
                  placeholder="시작 할 때 나오는 대사를 입력해주세요."
                  rows={3}
                  maxLength={2000}
                />
              </div>
              
              <div>
                <Label>비밀 정보 (선택)</Label>
                <Textarea
                  value={scene.secret}
                  onChange={(e) => updateIntroductionScene(index, 'secret', e.target.value)}
                  placeholder="대화중인 유저에게는 노출되지 않는 정보로, 프롬프트 생성기에 전달 됩니다."
                  rows={2}
                  maxLength={1000}
                />
                <p className="text-sm text-gray-500 mt-1">
                  사용자에게 보여지지 않는 비밀 정보입니다.
                </p>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );

  const renderMediaTab = () => (
    <div className="space-y-6">
      <div className="space-y-4">
        <h3 className="text-lg font-semibold flex items-center">
          <Image className="w-5 h-5 mr-2" />
          이미지
        </h3>
        
        <div>
          <Label htmlFor="avatar_url">아바타 이미지 URL</Label>
          <Input
            id="avatar_url"
            type="url"
            value={formData.media_settings.avatar_url}
            onChange={(e) => updateFormData('media_settings', 'avatar_url', e.target.value)}
            placeholder="https://example.com/avatar.jpg"
            maxLength={500}
          />
        </div>

        <div className="p-4 border-2 border-dashed border-gray-300 rounded-lg text-center">
          <Upload className="w-8 h-8 mx-auto mb-2 text-gray-400" />
          <p className="text-sm text-gray-500">이미지 업로드 기능 (곧 추가 예정)</p>
        </div>
      </div>

      <Separator />

      <div className="space-y-4">
        <h3 className="text-lg font-semibold flex items-center">
          <Volume2 className="w-5 h-5 mr-2" />
          슈퍼보이스 설정
        </h3>
        
        <div className="flex items-center space-x-2">
          <Switch
            id="voice_enabled"
            checked={formData.media_settings.voice_settings.enabled}
            onCheckedChange={(checked) => updateFormData('media_settings', 'voice_settings', {
              ...formData.media_settings.voice_settings,
              enabled: checked
            })}
          />
          <Label htmlFor="voice_enabled">음성 기능 사용</Label>
        </div>

        {formData.media_settings.voice_settings.enabled && (
          <div className="space-y-3">
            <div>
              <Label>음성 ID</Label>
              <Select 
                value={formData.media_settings.voice_settings.voice_id || ''} 
                onValueChange={(value) => updateFormData('media_settings', 'voice_settings', {
                  ...formData.media_settings.voice_settings,
                  voice_id: value
                })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="음성을 선택하세요" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="voice1">여성 음성 1</SelectItem>
                  <SelectItem value="voice2">남성 음성 1</SelectItem>
                  <SelectItem value="voice3">중성 음성 1</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  const renderDialoguesTab = () => (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold mb-2">예시 대화 데이터</h3>
        <p className="text-sm text-gray-600 mb-4">
          적절한 대화 예시는 캐릭터의 성격이나, 말투, 지식을 표현하는데 참고사항이 됩니다.
        </p>
      </div>

      <div className="space-y-4">
        {formData.example_dialogues.dialogues.map((dialogue, index) => (
          <Card key={index} className="p-4">
            <div className="flex items-center justify-between mb-3">
              <h4 className="font-medium">예시 대화 #{index + 1}</h4>
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
                <Label>사용자 메시지</Label>
                <Textarea
                  value={dialogue.user_message}
                  onChange={(e) => updateExampleDialogue(index, 'user_message', e.target.value)}
                  placeholder="사용자가 입력할 만한 메시지를 작성하세요"
                  rows={2}
                  maxLength={500}
                />
              </div>
              
              <div>
                <Label>캐릭터 응답</Label>
                <Textarea
                  value={dialogue.character_response}
                  onChange={(e) => updateExampleDialogue(index, 'character_response', e.target.value)}
                  placeholder="캐릭터가 응답할 내용을 작성하세요"
                  rows={3}
                  maxLength={1000}
                />
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
          예시 대화 추가 (ALT+N)
        </Button>
      </div>
    </div>
  );

  const renderAffinityTab = () => (
    <div className="space-y-6">
      <div className="flex items-center space-x-2">
        <Switch
          id="has_affinity_system"
          checked={formData.affinity_system.has_affinity_system}
          onCheckedChange={(checked) => updateFormData('affinity_system', 'has_affinity_system', checked)}
        />
        <Label htmlFor="has_affinity_system" className="text-lg font-semibold">
          캐릭터에 호감도 시스템을 설정할게요 (선택)
        </Label>
        <Badge variant="secondary">Beta</Badge>
      </div>

      {formData.affinity_system.has_affinity_system && (
        <div className="space-y-6">
          <div>
            <Label htmlFor="affinity_rules">호감도 정의 및 증감 규칙</Label>
            <Textarea
              id="affinity_rules"
              value={formData.affinity_system.affinity_rules}
              onChange={(e) => updateFormData('affinity_system', 'affinity_rules', e.target.value)}
              placeholder="값의 변화를 결정하는 논리를 입력합니다."
              rows={6}
              maxLength={2000}
            />
          </div>

          <div>
            <h4 className="font-semibold mb-3">호감도 구간 설정</h4>
            <div className="space-y-3">
              {formData.affinity_system.affinity_stages.map((stage, index) => (
                <div key={index} className="flex items-center space-x-3 p-3 border rounded-lg">
                  <div className="flex items-center space-x-2">
                    <Input
                      type="number"
                      value={stage.min_value}
                      className="w-20"
                      readOnly
                    />
                    <span>~</span>
                    <Input
                      type="number"
                      value={stage.max_value || ''}
                      placeholder="∞"
                      className="w-20"
                      readOnly
                    />
                  </div>
                  <Textarea
                    value={stage.description}
                    placeholder="호감도에 따라 캐릭터에게 줄 변화를 입력해보세요"
                    rows={1}
                    className="flex-1"
                    maxLength={500}
                    readOnly
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
    <div className="space-y-6">
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

      <Separator />

      <div className="space-y-4">
        <h3 className="text-lg font-semibold">고급 설정</h3>
        
        <div className="flex items-center space-x-2">
          <Switch
            id="use_translation"
            checked={formData.publish_settings.use_translation}
            onCheckedChange={(checked) => updateFormData('publish_settings', 'use_translation', checked)}
          />
          <Label htmlFor="use_translation">프롬프트 구성시 번역본 활용</Label>
        </div>
        
        <p className="text-sm text-gray-500">
          대화를 하는 유저가 사용하는 언어를 보고 번역본을 선택하여 프롬프트를 작성합니다.
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
    </div>
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 via-blue-50 to-indigo-50">
      {/* 헤더 */}
      <header className="bg-white/80 backdrop-blur-sm shadow-sm border-b sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center space-x-4">
              <Link to="/" className="flex items-center space-x-2">
                <div className="w-8 h-8 bg-gradient-to-r from-purple-600 to-blue-600 rounded-lg flex items-center justify-center">
                  <MessageCircle className="w-5 h-5 text-white" />
                </div>
                <h1 className="text-xl font-bold text-gray-900">캐릭터 만들기</h1>
              </Link>
            </div>
            <div className="flex items-center space-x-3">
              <Button variant="outline" onClick={() => navigate(-1)}>
                <ArrowLeft className="w-4 h-4 mr-2" />
                임포트
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
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          {/* 탭 네비게이션 */}
          <TabsList className="grid w-full grid-cols-5 h-auto p-1">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              return (
                <TabsTrigger
                  key={tab.id}
                  value={tab.id}
                  className="flex flex-col items-center p-3 data-[state=active]:bg-white data-[state=active]:shadow-sm"
                >
                  <div className="flex items-center space-x-2">
                    <span className="text-lg">{tab.emoji}</span>
                    <Icon className="w-4 h-4" />
                  </div>
                  <span className="text-sm font-medium">{tab.label}</span>
                  <span className="text-xs text-gray-500 mt-1 hidden sm:block">
                    {tab.description}
                  </span>
                </TabsTrigger>
              );
            })}
          </TabsList>

          {/* 탭 콘텐츠 */}
          <Card className="shadow-lg">
            <CardContent className="p-6">
              <TabsContent value="basic" className="mt-0">
                {renderBasicInfoTab()}
              </TabsContent>

              <TabsContent value="media" className="mt-0">
                {renderMediaTab()}
              </TabsContent>

              <TabsContent value="dialogues" className="mt-0">
                {renderDialoguesTab()}
              </TabsContent>

              <TabsContent value="affinity" className="mt-0">
                {renderAffinityTab()}
              </TabsContent>

              <TabsContent value="publish" className="mt-0">
                {renderPublishTab()}
              </TabsContent>
            </CardContent>
          </Card>
        </Tabs>
      </main>
    </div>
  );
};

export default CreateCharacterPage; 