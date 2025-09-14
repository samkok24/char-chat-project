/**
 * 스토리 분석 기반 캐릭터 생성을 위한 페이지
 */
import React, { useMemo, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';

const StoryImporterPage = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const searchParams = useMemo(() => new URLSearchParams(location.search || ''), [location.search]);
  const targetStoryId = searchParams.get('storyId');
  const [storyText, setStoryText] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [analysisResult, setAnalysisResult] = useState(null);
  const [isSaving, setIsSaving] = useState(false); // 저장 로딩 상태 추가
  const [selectedAiModel, setSelectedAiModel] = useState('gemini');
  const [chapterFiles, setChapterFiles] = useState([]);
  const [chaptersPreview, setChaptersPreview] = useState([]);
  const [mergeLoading, setMergeLoading] = useState(false);
  const [parsedChapters, setParsedChapters] = useState([]);
  const MAX_CHARS = 500000; // 최대 글자 수

  // 파일 업로드 핸들러 (단일 파일)
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
      // 임시: txt만 로컬에서 읽기
      if (fileExtension === '.txt') {
        const text = await file.text();
        setStoryText(text.length > MAX_CHARS ? text.substring(0, MAX_CHARS) : text);
      } else {
        setError('현재는 .txt 파일만 지원됩니다. 다른 형식은 준비 중입니다.');
      }
    } catch (err) {
      setError('파일 업로드 중 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  };

  // 회차 모드: 다중 txt 업로드 후 자동 합치기
  const handleChaptersUpload = async (e) => {
    const files = Array.from(e.target.files || []).filter(f => f.name.toLowerCase().endsWith('.txt'));
    if (files.length === 0) return;
    files.sort((a, b) => a.name.localeCompare(b.name, 'ko'));
    setMergeLoading(true);
    setError('');
    try {
      const previews = [];
      let merged = '';
      for (const f of files) {
        const text = await f.text();
        previews.push({ name: f.name, size: f.size, chars: text.length });
        merged += (merged ? '\n\n' : '') + text;
      }
      setChapterFiles(files);
      setChaptersPreview(previews);
      setStoryText(merged.slice(0, MAX_CHARS));
    } catch {
      setError('회차 파일 처리 중 오류가 발생했습니다.');
    } finally {
      setMergeLoading(false);
    }
  };

  const splitIntoChapters = (text) => {
    if (!text) return [];
    const lines = text.split(/\r?\n/);
    const chapters = [];
    let current = { no: null, title: '', content: [] };
    const headingRegex = /^(\s*)(?:제\s*)?(\d{1,4})(?:\s*)(화|장)\b\s*(.*)$|^(프롤로그|에필로그)\b\s*(.*)$|^(?:Chapter|CHAPTER)\s+(\d{1,4})\b\s*(.*)$/;
    const pushCurrent = () => {
      if (current.content.length > 0 || current.title) {
        const content = current.content.join('\n').trim();
        const title = (current.title || '').trim() || (current.no ? `${current.no}화` : '');
        chapters.push({ no: current.no, title, content, created_at: new Date().toISOString() });
      }
    };
    lines.forEach((raw) => {
      const line = raw.replace(/\uFEFF/g, '');
      const m = line.match(headingRegex);
      if (m) {
        // 새 챕터 시작
        pushCurrent();
        const no = m[2] || m[7] || (m[5] === '프롤로그' ? 0 : (m[5] === '에필로그' ? 9999 : null));
        const tail = m[4] || m[6] || m[8] || '';
        const title = m[5] ? `${m[5]} ${tail}`.trim() : (tail || `${no}화`).trim();
        current = { no: no ? Number(no) : null, title, content: [] };
      } else {
        current.content.push(raw);
      }
    });
    pushCurrent();
    // 정렬: 프롤로그(0) 먼저, 숫자 오름차순, 에필로그(9999) 마지막
    return chapters
      .map((c, idx) => ({ ...c, no: (c.no === null ? idx + 1 : c.no) }))
      .sort((a, b) => (a.no || 0) - (b.no || 0));
  };

  const handleExtractChapters = () => {
    const arr = splitIntoChapters(storyText);
    setParsedChapters(arr);
    if (arr.length === 0) setError('회차 형식을 찾지 못했습니다. 제목 패턴(예: 1화, 제1장)을 확인하세요.');
  };

  const handleSaveChapters = () => {
    if (!targetStoryId) { setError('storyId가 없습니다. 상세 페이지에서 회차등록 버튼으로 진입하세요.'); return; }
    try {
      const key = `cc:chapters:${targetStoryId}`;
      const payload = { updatedAt: new Date().toISOString(), episodes: parsedChapters };
      localStorage.setItem(key, JSON.stringify(payload));
      navigate(`/stories/${targetStoryId}`);
    } catch {
      setError('회차 저장에 실패했습니다.');
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

  // 캐릭터 저장 핸들러
  const handleSaveCharacter = async (characterData) => {
    setIsSaving(true);
    setError('');
    try {
      const payload = {
        basic_info: {
          name: characterData.name,
          description: characterData.description,
          world_setting: analysisResult?.worldview || '',
        },
        affinity_system: {
          has_affinity_system: true,
          affinity_rules: `대인관계 성향 점수(${characterData.social_tendency})를 기반으로 함`
        },
      };

      await charactersAPI.createCharacter(payload);
      alert(`'${characterData.name}' 캐릭터가 성공적으로 생성되었습니다!`);
      navigate('/profile'); 

    } catch (err) {
      console.error("캐릭터 생성 중 오류 발생:", err);
      const errorMessage = err.response?.data?.detail || '캐릭터 생성 중 알 수 없는 오류가 발생했습니다.';
      setError(errorMessage);
      alert(errorMessage);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-100 dark:bg-gray-900 text-gray-900 dark:text-gray-100 p-4 sm:p-6 lg:p-8">
      <div className="max-w-4xl mx-auto">
        <header className="mb-6">
          <Button variant="ghost" onClick={() => navigate(-1)}>
            <ArrowLeft className="w-5 h-5 mr-2" />
            홈으로 돌아가기
          </Button>
        </header>

        <Card>
          <CardHeader>
            <CardTitle className="text-2xl flex items-center">
              <Wand2 className="w-6 h-6 mr-3 text-purple-500" />
              회차등록
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* AI 모델 선택 */}
            <div className="hidden" aria-hidden="true"></div>

            {/* 단일 파일 업로드 */}
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
                    회차 파일 업로드
                  </span>
                </Button>
              </label>
              <span className="text-sm text-gray-500 flex items-center">
                (.txt, .doc, .docx, .hwp, .hwpx)
              </span>
            </div>

            {/* 회차 모드: 다중 파일 업로드 */}
            <div className="space-y-3 p-3 rounded-lg border border-gray-700/50 bg-gray-800/30">
              <div className="flex items-center justify-between">
                <div className="text-sm text-gray-300">회차 모드(여러 .txt 파일 선택)</div>
                {(mergeLoading) && <Loader2 className="w-4 h-4 animate-spin text-gray-400" />}
              </div>
              <input
                type="file"
                id="chaptersUpload"
                accept=".txt"
                multiple
                onChange={handleChaptersUpload}
                className="hidden"
                disabled={loading || isSaving || mergeLoading}
              />
              <label htmlFor="chaptersUpload">
                <Button variant="outline" size="sm" disabled={loading || isSaving || mergeLoading} className="cursor-pointer" asChild>
                  <span><Upload className="mr-2 h-4 w-4" /> 회차(.txt) 여러 개 업로드</span>
                </Button>
              </label>
              {chaptersPreview.length > 0 && (
                <div className="text-xs text-gray-400 space-y-1">
                  <div>파일 {chaptersPreview.length}개, 총 글자수 {chaptersPreview.reduce((a,b)=>a+b.chars,0).toLocaleString()}자</div>
                  <ul className="max-h-28 overflow-auto list-disc pl-4">
                    {chaptersPreview.map((c) => (
                      <li key={c.name} className="truncate">{c.name} · {c.chars.toLocaleString()}자</li>
                    ))}
                  </ul>
                  <p className="text-gray-500">파일명 오름차순으로 자동 결합되어 분석 입력에 채워집니다.</p>
                </div>
              )}
            </div>

            {/* 입력 박스 */}
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
                disabled={loading || isSaving}
                maxLength={MAX_CHARS}
              />
              <div className="text-sm text-gray-500 text-right">
                {storyText.length.toLocaleString()} / {MAX_CHARS.toLocaleString()} 글자
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={handleExtractChapters} disabled={!storyText.trim() || loading || isSaving}>회차 추출</Button>
              {targetStoryId && (
                <Button onClick={handleSaveChapters} disabled={parsedChapters.length === 0 || loading || isSaving}>회차목록 저장</Button>
              )}
            </div>
            {parsedChapters.length > 0 && (
              <div className="mt-4">
                <div className="text-sm text-gray-400 mb-2">추출된 회차 {parsedChapters.length}개</div>
                <ul className="divide-y divide-gray-800 rounded-md border border-gray-700 overflow-hidden">
                  {parsedChapters.map((ch) => (
                    <li key={`${ch.no}-${ch.title}`} className="px-3 py-2 bg-gray-800/30">
                      <div className="text-sm text-gray-200 truncate">
                        <span className="text-gray-400 mr-2">{ch.no ? `${ch.no}화` : '회차'}</span>
                        <span>{ch.title}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
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
                    주요 캐릭터 (수정 가능)
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {analysisResult.characters.map((char) => (
                      <AnalyzedCharacterCard
                        key={char.name}
                        initialCharacter={char}
                        onSave={handleSaveCharacter}
                        buttonText="이 캐릭터 저장하기"
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