/**
 * 스토리 분석 기반 캐릭터 생성을 위한 페이지
 */
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { storyImporterAPI, charactersAPI } from '../lib/api'; // charactersAPI 추가
import { Button } from '../components/ui/button';
import { Textarea } from '../components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Alert, AlertDescription } from '../components/ui/alert';
import {
  ArrowLeft, Wand2, Loader2, AlertCircle, UserPlus, BarChart, BookText, Globe, Users, Info, Upload
} from 'lucide-react';
import AnalyzedCharacterCard from '../components/AnalyzedCharacterCard';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../components/ui/tooltip';

const StoryImporterPage = () => {
  const navigate = useNavigate();
  const [storyText, setStoryText] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [analysisResult, setAnalysisResult] = useState(null);
  const [isSaving, setIsSaving] = useState(false); // 저장 로딩 상태 추가
  const MAX_CHARS = 500000; // 최대 글자 수

  // 파일 업로드 핸들러
  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const allowedTypes = ['.txt', '.doc', '.docx', '.hwp', '.hwpx'];
    const fileExtension = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
    
    if (!allowedTypes.includes(fileExtension)) {
      setError('지원하지 않는 파일 형식입니다. (.txt, .doc, .docx, .hwp, .hwpx 파일만 가능)');
      return;
    }

    setLoading(true);
    setError('');
    
    try {
      const formData = new FormData();
      formData.append('file', file);
      
      // TODO: 백엔드에 파일 업로드 API 구현 필요
      // const response = await storyImporterAPI.uploadFile(formData);
      // setStoryText(response.data.content);
      
      // 임시로 FileReader로 txt 파일만 읽기
      if (fileExtension === '.txt') {
        const reader = new FileReader();
        reader.onload = (event) => {
          const content = event.target.result;
          if (content.length > MAX_CHARS) {
            setError(`파일 내용이 너무 깁니다. (최대 ${MAX_CHARS.toLocaleString()}자)`);
            setStoryText(content.substring(0, MAX_CHARS));
          } else {
            setStoryText(content);
          }
          setLoading(false);
        };
        reader.onerror = () => {
          setError('파일 읽기 중 오류가 발생했습니다.');
          setLoading(false);
        };
        reader.readAsText(file, 'utf-8');
      } else {
        setError('현재는 .txt 파일만 지원됩니다. 다른 형식은 준비 중입니다.');
        setLoading(false);
      }
    } catch (err) {
      setError('파일 업로드 중 오류가 발생했습니다.');
      setLoading(false);
    }
  };

  const handleAnalyze = async () => {
    if (!storyText.trim()) {
      setError('분석할 내용을 입력해주세요.');
      return;
    }
    setLoading(true);
    setError('');
    setAnalysisResult(null);

    try {
      const response = await storyImporterAPI.analyzeStory(storyText);
      setAnalysisResult(response.data);
    } catch (err) {
      console.error("분석 중 오류 발생:", err);
      const errorMessage = err.response?.data?.detail || '스토리 분석 중 알 수 없는 오류가 발생했습니다.';
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  // 캐릭터 저장 핸들러
  const handleSaveCharacter = async (characterData) => {
    setIsSaving(true);
    setError('');
    try {
      // API에 보낼 데이터 형식에 맞게 재구성
      const payload = {
        basic_info: {
          name: characterData.name,
          description: characterData.description,
          world_setting: analysisResult?.worldview || '',
        },
        // 대인관계 성향을 호감도 시스템과 연동하는 로직은 유지
        affinity_system: {
          has_affinity_system: true,
          affinity_rules: `대인관계 성향 점수(${characterData.social_tendency})를 기반으로 함`
        },
        // 기타 필요한 필드는 여기서 추가하거나 기본값을 사용할 수 있습니다.
        // 예: personality, speech_style 등
      };

      await charactersAPI.createCharacter(payload);
      
      // 간단한 alert로 성공 알림 후 프로필 페이지로 이동
      alert(`'${characterData.name}' 캐릭터가 성공적으로 생성되었습니다!`);
      navigate('/profile'); 

    } catch (err) {
      console.error("캐릭터 생성 중 오류 발생:", err);
      const errorMessage = err.response?.data?.detail || '캐릭터 생성 중 알 수 없는 오류가 발생했습니다.';
      setError(errorMessage); // 페이지 내 에러 메시지로 표시
      alert(errorMessage); // 사용자에게도 alert으로 알림
    } finally {
      setIsSaving(false);
    }
  };


  return (
    <div className="min-h-screen bg-gray-100 dark:bg-gray-900 text-gray-900 dark:text-gray-100 p-4 sm:p-6 lg:p-8">
      <div className="max-w-4xl mx-auto">
        <header className="mb-6">
          <Button variant="ghost" onClick={() => navigate('/')}>
            <ArrowLeft className="w-5 h-5 mr-2" />
            홈으로 돌아가기
          </Button>
        </header>

        <Card>
          <CardHeader>
            <CardTitle className="text-2xl flex items-center">
              <Wand2 className="w-6 h-6 mr-3 text-purple-500" />
              스토리로 캐릭터 생성하기
            </CardTitle>
            <CardDescription>
              웹소설, 시나리오, 혹은 직접 작성한 이야기를 붙여넣으세요. AI가 세계관과 캐릭터를 분석하여 생명을 불어넣어 줍니다.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-2 mb-2">
              <input
                type="file"
                id="fileUpload"
                accept=".txt,.doc,.docx,.hwp,.hwpx"
                onChange={handleFileUpload}
                className="hidden"
                disabled={loading || isSaving}
              />
              <label htmlFor="fileUpload">
                <Button 
                  variant="outline" 
                  size="sm"
                  disabled={loading || isSaving}
                  className="cursor-pointer"
                  asChild
                >
                  <span>
                    <Upload className="mr-2 h-4 w-4" />
                    파일 업로드
                  </span>
                </Button>
              </label>
              <span className="text-sm text-gray-500 flex items-center">
                (.txt, .doc, .docx, .hwp, .hwpx 지원)
              </span>
            </div>
            <div className="space-y-2">
              <Textarea
                value={storyText}
                onChange={(e) => {
                  if (e.target.value.length <= MAX_CHARS) {
                    setStoryText(e.target.value);
                  }
                }}
                placeholder="이곳에 분석할 이야기를 붙여넣으세요..."
                className="min-h-[300px] text-base"
                disabled={loading || isSaving} // 저장 중에도 비활성화
                maxLength={MAX_CHARS}
              />
              <div className="text-sm text-gray-500 text-right">
                {storyText.length.toLocaleString()} / {MAX_CHARS.toLocaleString()} 글자
              </div>
            </div>
            {error && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <Button onClick={handleAnalyze} disabled={loading || isSaving} className="w-full">
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  분석 중...
                </>
              ) : (
                <>
                  <Wand2 className="mr-2 h-4 w-4" />
                  분석하기
                </>
              )}
            </Button>
            {(loading || isSaving) && (
              <p className="text-sm text-center text-gray-500 mt-2">
                {loading ? 'AI가 열심히 당신의 이야기를 읽고 있어요... (최대 1분 정도 소요될 수 있습니다)' : '캐릭터를 저장하는 중입니다...'}
              </p>
            )}
          </CardContent>
        </Card>

        {analysisResult && (
          <div className="mt-8 space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>분석 결과</CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                <div>
                  <h3 className="font-semibold text-lg flex items-center mb-2">
                    <Globe className="w-5 h-5 mr-2 text-sky-500"/>
                    세계관
                  </h3>
                  <p className="text-gray-600 dark:text-gray-300 bg-gray-50 dark:bg-gray-800 p-3 rounded-md">{analysisResult.worldview}</p>
                </div>
                <div>
                  <h3 className="font-semibold text-lg flex items-center mb-2">
                    <BookText className="w-5 h-5 mr-2 text-amber-500"/>
                    플롯 요약
                  </h3>
                  <p className="text-gray-600 dark:text-gray-300 bg-gray-50 dark:bg-gray-800 p-3 rounded-md">{analysisResult.plot}</p>
                </div>
                <div>
                  <h3 className="font-semibold text-lg flex items-center mb-2">
                    <Users className="w-5 h-5 mr-2 text-emerald-500"/>
                    주요 캐릭터
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {analysisResult.characters.map((char) => (
                      <AnalyzedCharacterCard
                        key={char.name}
                        initialCharacter={char} // char -> initialCharacter 로 prop 이름 변경
                        onSave={handleSaveCharacter} // onStart -> onSave, 핸들러 변경
                      />
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
};

export default StoryImporterPage; 