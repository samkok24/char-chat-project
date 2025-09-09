/**
 * CAVEDUCK 스타일 고급 캐릭터 생성/수정 페이지
 * 5단계 탭 시스템: 기본정보 → 미디어 → 예시대화 → 호감도 → 공개설정
 */

import React, { useState, useEffect, useRef, useMemo } from 'react'; // useMemo 추가
import { useNavigate, Link, useParams, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { charactersAPI, filesAPI, API_BASE_URL, tagsAPI, api } from '../lib/api';
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
  Wand2 // Wand2 아이콘 추가
} from 'lucide-react';
import { StoryImporterModal } from '../components/StoryImporterModal'; // StoryImporterModal 컴포넌트 추가
import AvatarCropModal from '../components/AvatarCropModal';
import TagSelectModal from '../components/TagSelectModal';

const CreateCharacterPage = () => {
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
      world_setting: '',
      user_display_description: '',
      use_custom_description: false,
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

  const { isAuthenticated } = useAuth();
  const [allTags, setAllTags] = useState([]);
  const [selectedTagSlugs, setSelectedTagSlugs] = useState([]);
  const [isTagModalOpen, setIsTagModalOpen] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await tagsAPI.getTags();
        setAllTags(res.data || []);
      } catch (_) {}
    })();
  }, []);

  // 자동저장(로컬 초안)
  useEffect(() => {
    const key = `cc_draft_${isEditMode ? characterId : 'new'}`;
    // 초기 로드 시 기존 초안 복원
    if (!isEditMode && location.state?.restored !== true) {
      try {
        const raw = localStorage.getItem(key);
        if (raw) {
          const draft = JSON.parse(raw);
          setFormData(prev => ({ ...prev, ...draft }));
        }
      } catch (_) {}
    }
    // 디바운스 저장
    const t = setTimeout(() => {
      try {
        setIsAutoSaving(true);
        localStorage.setItem(key, JSON.stringify(formData));
        setLastSavedAt(Date.now());
      } catch (_) {}
      setIsAutoSaving(false);
    }, 1500);
    return () => clearTimeout(t);
  }, [formData, isEditMode, characterId, location.state]);

  const handleManualDraftSave = () => {
    try {
      const key = `cc_draft_${isEditMode ? characterId : 'new'}`;
      localStorage.setItem(key, JSON.stringify(formData));
      setLastSavedAt(Date.now());
    } catch (_) {}
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
      
      // 🔥 고급 캐릭터 데이터 구조로 매핑
      setFormData(prev => ({
        ...prev,
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

  const allowedExt = ['jpg','jpeg','png','webp','gif'];
  const validateExt = (file) => {
    const ext = (file.name || '').toLowerCase().split('.').pop();
    return allowedExt.includes(ext);
  };

  const handleImageUpload = (e) => {
    const files = Array.from(e.target.files);
    if (files.length === 0) return;
    if (!validateExt(files[0])) {
      alert('jpg, jpeg, png, webp, gif 형식만 업로드할 수 있습니다.');
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
      let uploadedImageUrls = [];
      if (formData.media_settings.newly_added_files.length > 0) {
        const uploadResponse = await filesAPI.uploadImages(formData.media_settings.newly_added_files);
        uploadedImageUrls = uploadResponse.data;
      }
      
      const existingImageUrls = formData.media_settings.image_descriptions.map(img => img.url);
      const finalImageUrls = [...existingImageUrls, ...uploadedImageUrls];

      const characterData = {
        ...formData,
        media_settings: {
          ...formData.media_settings,
          image_descriptions: finalImageUrls.map(url => ({ description: '', url }))
        }
      };

      if (isEditMode) {
        await charactersAPI.updateAdvancedCharacter(characterId, characterData);
        // 태그 저장
        await api.put(`/characters/${characterId}/tags`, { tags: selectedTagSlugs });
        navigate(`/characters/${characterId}`, { state: { fromEdit: true } });
      } else {
        const response = await charactersAPI.createAdvancedCharacter(characterData);
        const newId = response.data.id;
        // 태그 저장
        if (selectedTagSlugs.length) {
          await api.put(`/characters/${newId}/tags`, { tags: selectedTagSlugs });
        }
        navigate(`/characters/${newId}`, { state: { fromCreate: true } });
      }
    } catch (err) {
      console.error(`캐릭터 ${isEditMode ? '수정' : '생성'} 실패:`, err);

        // Pydantic 검증 에러 처리
      if (err.response?.data?.detail && Array.isArray(err.response.data.detail)) {
        const validationErrors = err.response.data.detail;
        const errorMessages = validationErrors.map(error => {
          // 필드 위치를 한글로 변환
          const fieldPath = error.loc.join(' > ');
          const fieldMapping = {
            'body > basic_info > name': '캐릭터 이름',
            'body > basic_info > description': '캐릭터 설명',
            'body > basic_info > greeting': '첫 인사',
            'body > basic_info > personality': '성격',
            'body > basic_info > speech_style': '말투',
            'body > basic_info > world_setting': '세계관',
          };
          
          const fieldName = fieldMapping[fieldPath] || fieldPath;
          
          // 에러 타입별 메시지
          if (error.type === 'string_too_short') {
            return `${fieldName}을(를) 입력해주세요.`;
          } else if (error.type === 'string_too_long') {
            return `${fieldName}이(가) 너무 깁니다. (최대 ${error.ctx.max_length}자)`;
          } else if (error.type === 'missing') {
            return `${fieldName}은(는) 필수 항목입니다.`;
          } else {
            return `${fieldName}: ${error.msg}`;
          }
        });
        
        setError(errorMessages.join('\n'));
      } else {
        const errorMessage = err.response?.data?.detail || err.message || `캐릭터 ${isEditMode ? '수정' : '생성'}에 실패했습니다.`;
        setError(errorMessage);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleApplyImportedData = (data) => {
    // StoryImporterModal에서 전달받은 데이터로 폼 채우기
    setFormData(prev => ({
      ...prev,
      basic_info: {
        ...prev.basic_info,
        name: data.name || prev.basic_info.name,
        description: data.description || prev.basic_info.description,
        world_setting: data.world_setting || prev.basic_info.world_setting,
        // 필요에 따라 다른 필드도 채울 수 있습니다.
      },
      affinity_system: {
        ...prev.affinity_system,
        has_affinity_system: data.social_tendency !== undefined,
        affinity_rules: data.social_tendency !== undefined 
          ? `대인관계 성향 점수(${data.social_tendency})를 기반으로 함` 
          : prev.affinity_system.affinity_rules,
      }
    }));
    setIsStoryImporterOpen(false); // 모달 닫기
    alert(`'${data.name}'의 정보가 폼에 적용되었습니다. 내용을 확인하고 저장해주세요.`);
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

      {/* 기존 기본 정보 입력 필드 */}
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
          
          {/* 이미지 업로드 UI */}
          <Card className="p-4">
            <div className="flex items-center space-x-4">
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleImageUpload}
                multiple
                accept="image/jpeg,image/png,image/webp,image/gif,.jpg,.jpeg,.png,.webp,.gif"
                className="hidden"
              />
              <Button type="button" variant="outline" onClick={() => fileInputRef.current.click()}>
                <Upload className="w-4 h-4 mr-2" />
                이미지 업로드
              </Button>
              <p className="text-sm text-gray-500">
                캐릭터와 관련된 이미지를 업로드하세요. 갤러리에 표시됩니다.
              </p>
            </div>

            {/* 이미지 미리보기 영역 */}
            {allImages.length > 0 && (
              <div className="mt-4 grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-3">
                {allImages.map((image, index) => {
                  const imageUrl = image.isNew ? image.url : `${API_BASE_URL}${image.url}`;
                  return (
                    <div key={image.url} className="relative aspect-square group">
                      <img
                        src={imageUrl}
                        alt={`미리보기 ${index + 1}`}
                        className="w-full h-full object-cover rounded-md"
                      />
                      <button
                        type="button"
                        onClick={() => image.isNew ? handleRemoveNewFile(index - existingImages.length) : handleRemoveExistingImage(index)}
                        className="absolute top-1 right-1 bg-black/50 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>

          <div>
            <Label htmlFor="avatar_url">아바타 이미지 URL (선택 사항)</Label>
            <Input
              id="avatar_url"
              type="url"
              value={formData.media_settings.avatar_url}
              onChange={(e) => updateFormData('media_settings', 'avatar_url', e.target.value)}
              placeholder="https://example.com/avatar.jpg"
              maxLength={500}
            />
             <p className="text-sm text-gray-500 mt-1">
              업로드 대신 이미지 주소를 직접 입력하여 대표 아바타를 설정할 수도 있습니다.
            </p>
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
  };

  const renderDialoguesTab = () => (
    <div className="space-y-6 p-6">
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
    <div className="space-y-6 p-6">
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
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {isStoryImporterOpen && (
        <StoryImporterModal 
          isOpen={isStoryImporterOpen}
          onClose={() => setIsStoryImporterOpen(false)}
          onApply={handleApplyImportedData}
        />
      )}
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
              <div className="text-xs text-gray-500 mr-2 hidden sm:block">
                {isAutoSaving ? '자동저장 중…' : lastSavedAt ? `자동저장됨 • ${new Date(lastSavedAt).toLocaleTimeString()}` : ''}
              </div>
              <Button variant="outline" onClick={() => setIsStoryImporterOpen(true)}>
                <Wand2 className="w-4 h-4 mr-2" />
                AI 임포트
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
        {/* 롱폼 섹션: 탭 제거 후 순차 배치 */}
        <Card id="section-basic" className="shadow-lg mb-8">
          <CardHeader>
            <CardTitle className="text-lg">기본 정보</CardTitle>
          </CardHeader>
          {renderBasicInfoTab()}
        </Card>

        <Card id="section-media" className="shadow-lg mb-8">
          <CardHeader>
            <CardTitle className="text-lg">미디어</CardTitle>
          </CardHeader>
          <CardContent className="p-6">{renderMediaTab()}</CardContent>
        </Card>

        <Card id="section-dialogues" className="shadow-lg mb-8">
          <CardHeader>
            <CardTitle className="text-lg">예시 대화</CardTitle>
          </CardHeader>
          {renderDialoguesTab()}
        </Card>

        <Card id="section-affinity" className="shadow-lg mb-8">
          <CardHeader>
            <CardTitle className="text-lg">호감도</CardTitle>
          </CardHeader>
          {renderAffinityTab()}
        </Card>

        <Card id="section-publish" className="shadow-lg">
          <CardHeader>
            <CardTitle className="text-lg">공개/고급 설정 & 태그</CardTitle>
          </CardHeader>
          {renderPublishTab()}
        </Card>
          </div>

          {/* 우측 앵커 네비게이션 */}
          <aside className="hidden lg:block sticky top-20 h-fit">
            <div className="bg-gray-800 border border-gray-700 rounded-lg p-3 text-sm text-gray-200">
              <div className="font-semibold mb-2">빠른 이동</div>
              <ul className="space-y-2">
                <li><a href="#section-basic" className="hover:underline">기본 정보</a></li>
                <li><a href="#section-media" className="hover:underline">미디어</a></li>
                <li><a href="#section-dialogues" className="hover:underline">예시 대화</a></li>
                <li><a href="#section-affinity" className="hover:underline">호감도</a></li>
                <li><a href="#section-publish" className="hover:underline">공개/태그</a></li>
              </ul>
              <div className="mt-3 text-xs text-gray-400">
                {isAutoSaving ? '자동저장 중…' : lastSavedAt ? `자동저장됨: ${new Date(lastSavedAt).toLocaleTimeString()}` : ''}
              </div>
            </div>
          </aside>
        </div>
      </main>

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
            alert('이미지 업로드에 실패했습니다.');
          } finally {
            setIsUploading(false);
            try { URL.revokeObjectURL(cropSrc); } catch(_){}
            setCropSrc('');
          }
        }}
      />
      {/* 태그 선택 모달 */}
      <TagSelectModal
        isOpen={isTagModalOpen}
        onClose={() => setIsTagModalOpen(false)}
        allTags={allTags}
        selectedSlugs={selectedTagSlugs}
        onSave={(slugs) => setSelectedTagSlugs(slugs)}
      />
    </div>
  );
};

export default CreateCharacterPage; 