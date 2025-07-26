import React, { useState } from 'react';
import { storyImporterAPI } from '../lib/api';
import { Button } from './ui/button';
import { Textarea } from './ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Alert, AlertDescription } from './ui/alert';
import {
  Wand2, Loader2, AlertCircle, BookText, Globe, Users, X, UserPlus
} from 'lucide-react';
import AnalyzedCharacterCard from './AnalyzedCharacterCard';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';

// StoryImporterPage의 로직을 재활용한 모달 컴포넌트
export const StoryImporterModal = ({ isOpen, onClose, onApply }) => {
  const [storyText, setStoryText] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [analysisResult, setAnalysisResult] = useState(null);
  const [selectedAiModel, setSelectedAiModel] = useState('gemini');

  const handleAnalyze = async () => {
    if (!storyText.trim()) {
      setError('분석할 내용을 입력해주세요.');
      return;
    }
    setLoading(true);
    setError('');
    setAnalysisResult(null);

    try {
      const response = await storyImporterAPI.analyzeStory(storyText, selectedAiModel);
      setAnalysisResult(response.data);
    } catch (err) {
      console.error("분석 중 오류 발생:", err);
      const errorMessage = err.response?.data?.detail || '스토리 분석 중 알 수 없는 오류가 발생했습니다.';
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };
  
  // 데이터 적용 및 모달 닫기
  const handleApplyCharacterData = (characterData) => {
    const dataToApply = {
        ...characterData,
        world_setting: analysisResult?.worldview || '',
    };
    onApply(dataToApply);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-60 z-50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-gray-900 rounded-lg shadow-2xl w-full max-w-4xl h-[90vh] flex flex-col">
        <header className="p-4 border-b flex justify-between items-center">
          <h2 className="text-xl font-bold flex items-center">
            <Wand2 className="w-6 h-6 mr-3 text-purple-500" />
            AI로 스토리 분석하여 자동 완성
          </h2>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-5 w-5" />
          </Button>
        </header>
        
        <div className="flex-grow overflow-y-auto p-6 space-y-6">
          {/* 분석 전 UI */}
          {!analysisResult && (
            <Card>
              <CardHeader>
                <CardTitle>스토리 입력</CardTitle>
                <CardDescription>
                  웹소설, 시나리오, 혹은 직접 작성한 이야기를 붙여넣으세요. AI가 세계관과 캐릭터를 분석하여 생명을 불어넣어 줍니다.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-2">AI 모델 선택</label>
                  <Select value={selectedAiModel} onValueChange={setSelectedAiModel}>
                    <SelectTrigger>
                      <SelectValue placeholder="AI 모델 선택" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="gemini">Gemini</SelectItem>
                      <SelectItem value="claude">Claude</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Textarea
                  value={storyText}
                  onChange={(e) => setStoryText(e.target.value)}
                  placeholder="이곳에 분석할 이야기를 붙여넣으세요..."
                  className="min-h-[300px] text-base"
                  disabled={loading}
                />
                {error && (
                  <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                )}
                <Button onClick={handleAnalyze} disabled={loading} className="w-full bg-purple-600 hover:bg-purple-700">
                  {loading ? (
                    <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> 분석 중...</>
                  ) : (
                    <><Wand2 className="mr-2 h-4 w-4" /> 분석하기</>
                  )}
                </Button>
                {loading && (
                  <p className="text-sm text-center text-gray-500 mt-2">
                    AI가 열심히 당신의 이야기를 읽고 있어요... (최대 1분 정도 소요될 수 있습니다)
                  </p>
                )}
              </CardContent>
            </Card>
          )}

          {/* 분석 후 UI */}
          {analysisResult && (
            <div className="space-y-6">
              <Button variant="outline" onClick={() => { setAnalysisResult(null); setStoryText(''); setError(''); }}>
                &larr; 다시 분석하기
              </Button>
              <Card>
                <CardHeader><CardTitle>분석 결과</CardTitle></CardHeader>
                <CardContent className="space-y-6">
                   <div>
                     <h3 className="font-semibold text-lg flex items-center mb-2"><Globe className="w-5 h-5 mr-2 text-sky-500"/> 세계관</h3>
                     <p className="text-gray-600 dark:text-gray-300 bg-gray-50 dark:bg-gray-800 p-3 rounded-md">{analysisResult.worldview}</p>
                   </div>
                   <div>
                     <h3 className="font-semibold text-lg flex items-center mb-2"><BookText className="w-5 h-5 mr-2 text-amber-500"/> 플롯 요약</h3>
                     <p className="text-gray-600 dark:text-gray-300 bg-gray-50 dark:bg-gray-800 p-3 rounded-md">{analysisResult.plot}</p>
                   </div>
                   <div>
                     <h3 className="font-semibold text-lg flex items-center mb-2"><Users className="w-5 h-5 mr-2 text-emerald-500"/> 주요 캐릭터 (수정 가능)</h3>
                     <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                       {analysisResult.characters.map((char) => (
                         <AnalyzedCharacterCard
                           key={char.name}
                           initialCharacter={char}
                           onSave={handleApplyCharacterData} // '저장'이 아닌 '적용' 핸들러 연결
                           buttonText="이 캐릭터로 채우기"      // 버튼 텍스트 변경
                           buttonIcon={UserPlus}            // 버튼 아이콘 변경
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
    </div>
  );
}; 