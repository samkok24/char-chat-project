import React, { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { storyImporterAPI, charactersAPI } from '../lib/api';
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
  const queryClient = useQueryClient();
  const [storyText, setStoryText] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [analysisResult, setAnalysisResult] = useState(null);
  // 분석 결과 중 "캐릭터 배열"은 사용자 편집/선택/생성에 쓰기 위해 별도 상태로 유지
  const [charactersDraft, setCharactersDraft] = useState([]);
  const [selectedIdxSet, setSelectedIdxSet] = useState(() => new Set());
  const [createAsPublic, setCreateAsPublic] = useState(true);
  const [creating, setCreating] = useState(false);
  const [createProgress, setCreateProgress] = useState({ total: 0, done: 0 });
  const [createSummary, setCreateSummary] = useState('');
  const [selectedAiModel, setSelectedAiModel] = useState('gemini');

  const handleAnalyze = async () => {
    if (!storyText.trim()) {
      setError('분석할 내용을 입력해주세요.');
      return;
    }
    setLoading(true);
    setError('');
    setAnalysisResult(null);
    setCharactersDraft([]);
    setSelectedIdxSet(new Set());
    setCreateSummary('');

    try {
      const response = await storyImporterAPI.analyzeStory(storyText, selectedAiModel);
      const data = response.data;
      setAnalysisResult(data);
      setCharactersDraft(Array.isArray(data?.characters) ? data.characters : []);
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

  const selectedCount = selectedIdxSet?.size || 0;
  const totalCount = Array.isArray(charactersDraft) ? charactersDraft.length : 0;

  const updateCharacterAt = (index, next) => {
    setCharactersDraft((prev) => {
      const arr = Array.isArray(prev) ? [...prev] : [];
      if (index < 0 || index >= arr.length) return prev;
      arr[index] = next;
      return arr;
    });
  };

  const toggleSelected = (index) => {
    setSelectedIdxSet((prev) => {
      const next = new Set(prev || []);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const selectAll = () => {
    setSelectedIdxSet(() => new Set(Array.from({ length: totalCount }, (_, i) => i)));
  };

  const clearSelection = () => setSelectedIdxSet(new Set());

  const buildAdvancedPayload = (char) => {
    /**
     * 스토리 임포터(LLM) 결과를 고급 캐릭터 생성 요청(payload)으로 매핑한다.
     *
     * 방어적 원칙:
     * - 필드 누락/타입 흔들림이 있어도 서버 검증에 걸리지 않도록 최소 유효성을 확보한다.
     * - "채울 수 있는 만큼" 채우되, 실패 리스크가 있는 필드는 보수적으로 기본값을 둔다.
     */
    const safeText = (v) => { try { return String(v ?? '').trim(); } catch (_) { return ''; } };
    const clip = (v, maxLen) => {
      const s = safeText(v);
      if (!s) return '';
      return s.length > maxLen ? s.slice(0, maxLen) : s;
    };
    const safeArray = (v) => (Array.isArray(v) ? v : []);
    const name = clip(char?.name, 100) || '캐릭터';
    const description = clip(char?.description, 3000);
    const personality = clip(char?.personality, 2000);
    const speech_style = clip(char?.speech_style, 2000);
    const world_setting = clip(analysisResult?.worldview, 5000);
    const user_display_description = clip(char?.user_display_description, 3000);
    const use_custom_description = Boolean(user_display_description);

    // greetings → greeting 단일 문자열(서버 스키마는 greeting만 받음)
    const greetingsArr = safeArray(char?.greetings)
      .map((g) => clip(g, 500))
      .map((g) => g.trim())
      .filter(Boolean)
      .slice(0, 3);
    const greeting = greetingsArr.length
      ? greetingsArr.join('\n')
      : (clip(char?.greeting, 500) || `안녕하세요. 저는 ${name}입니다.`);

    // 예시 대화(없으면 최소 1개 폴백)
    const exRaw = safeArray(char?.example_dialogues);
    const ex = exRaw
      .map((d, idx) => ({
        user_message: clip(d?.user_message, 500),
        character_response: clip(d?.character_response, 1000),
        order_index: idx,
      }))
      .filter((d) => d.user_message && d.character_response);
    const dialogues = ex.length ? ex : [{
      user_message: '안녕. 오늘은 어떤 이야기 해볼까?',
      character_response: clip(greeting, 1000) || `안녕하세요. 저는 ${name}입니다.`,
      order_index: 0,
    }];

    // 도입부(있으면 1개만 사용, 없으면 최소 1개 생성: 서버가 required 필드일 수 있어 안전하게 채움)
    const introRaw = safeArray(char?.introduction_scenes);
    const intro0 = introRaw[0];
    const introContent = clip(intro0?.content, 2000) || `지금부터 ${name}와(과) 이야기를 시작합니다.`;
    const introSecret = clip(intro0?.secret, 1000);
    const introduction_scenes = [{
      title: clip(intro0?.title, 100) || '도입부 1',
      content: introContent,
      secret: introSecret,
    }];

    return {
      basic_info: {
        name,
        description,
        personality,
        speech_style,
        greeting,
        world_setting,
        user_display_description,
        use_custom_description,
        introduction_scenes,
        character_type: 'roleplay',
        base_language: 'ko',
      },
      example_dialogues: {
        dialogues,
      },
      publish_settings: {
        is_public: createAsPublic,
        custom_module_id: null,
        use_translation: true,
      },
    };
  };

  const createCharacters = async (indices) => {
    const list = Array.isArray(indices) ? indices : [];
    if (!list.length) {
      setCreateSummary('선택된 캐릭터가 없습니다.');
      return;
    }
    setCreating(true);
    setCreateProgress({ total: list.length, done: 0 });
    setCreateSummary('');
    let ok = 0;
    const failed = [];

    for (let i = 0; i < list.length; i += 1) {
      const idx = list[i];
      const c = charactersDraft?.[idx];
      const label = (c?.name ? String(c.name) : `캐릭터 ${idx + 1}`);
      try {
        const payload = buildAdvancedPayload(c);
        const res = await charactersAPI.createAdvancedCharacter(payload);
        ok += 1;
        // eslint-disable-next-line no-unused-vars
        const createdId = res?.data?.id;
      } catch (e) {
        console.error('[StoryImporterModal] createAdvancedCharacter failed:', label, e);
        const msg = e?.response?.data?.detail || e?.message || '알 수 없는 오류';
        failed.push(`${label}: ${msg}`);
      } finally {
        setCreateProgress((prev) => ({ total: list.length, done: (prev?.done || 0) + 1 }));
      }
    }

    const summary = [
      ok ? `생성 완료: ${ok}명` : '',
      failed.length ? `실패: ${failed.length}명` : '',
    ].filter(Boolean).join(' / ');
    setCreateSummary(summary || '완료');

    // 생성 성공이 1건이라도 있으면: 홈/목록 캐시 갱신 유도(한 번만)
    if (ok > 0) {
      try { queryClient.invalidateQueries({ queryKey: ['characters'] }); } catch (_) {}
      try { queryClient.invalidateQueries({ queryKey: ['trending-characters-daily'] }); } catch (_) {}
      // 최근대화는 유저 액션(채팅) 후에 생기지만, UI는 즉시 갱신될 수 있으니 무효화만 수행
      try { queryClient.invalidateQueries({ queryKey: ['recent-characters'] }); } catch (_) {}
    }

    if (failed.length) {
      // 너무 길어지지 않게 상위 3개만 노출
      setError(`일부 생성 실패:\n- ${failed.slice(0, 3).join('\n- ')}${failed.length > 3 ? `\n…외 ${failed.length - 3}건` : ''}`);
    } else {
      setError('');
    }
    setCreating(false);
  };

  const selectedIndicesSorted = useMemo(() => {
    try { return Array.from(selectedIdxSet || []).sort((a, b) => a - b); } catch (_) { return []; }
  }, [selectedIdxSet]);

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
                     {/* ✅ 선택 생성(벌크) 컨트롤 */}
                     <div className="flex flex-col gap-2 rounded-md border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/40 p-3">
                       <div className="flex flex-wrap items-center justify-between gap-2">
                         <div className="text-sm text-gray-700 dark:text-gray-200">
                           선택: {selectedCount}/{totalCount}
                           {creating && (
                             <span className="ml-2 text-xs text-gray-500">
                               생성 중… {createProgress.done}/{createProgress.total}
                             </span>
                           )}
                         </div>
                         <label className="inline-flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
                           <input
                             type="checkbox"
                             checked={createAsPublic}
                             onChange={(e) => setCreateAsPublic(e.target.checked)}
                             disabled={creating}
                           />
                           공개로 생성
                         </label>
                       </div>
                       <div className="flex flex-wrap gap-2">
                         <Button type="button" variant="outline" onClick={selectAll} disabled={creating || totalCount === 0}>
                           전체 선택
                         </Button>
                         <Button type="button" variant="outline" onClick={clearSelection} disabled={creating || selectedCount === 0}>
                           선택 해제
                         </Button>
                         <Button
                           type="button"
                           className="bg-purple-600 hover:bg-purple-700 text-white"
                           onClick={() => createCharacters(selectedIndicesSorted)}
                           disabled={creating || selectedCount === 0}
                         >
                           선택 생성
                         </Button>
                         <Button
                           type="button"
                           variant="secondary"
                           onClick={() => createCharacters(Array.from({ length: totalCount }, (_, i) => i))}
                           disabled={creating || totalCount === 0}
                         >
                           전체 생성
                         </Button>
                         {createSummary && (
                           <span className="text-sm text-gray-600 dark:text-gray-300 self-center">
                             {createSummary}
                           </span>
                         )}
                       </div>
                       <div className="text-xs text-gray-500">
                         - “선택 생성”은 선택한 캐릭터만 만들고, 나머지는 만들지 않습니다(=버림).
                       </div>
                     </div>
                     <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                       {(Array.isArray(charactersDraft) ? charactersDraft : []).map((char, idx) => (
                         <div key={`${char?.name || 'char'}-${idx}`} className="relative">
                           <label className="absolute top-2 right-2 z-10 inline-flex items-center gap-1 rounded bg-white/90 dark:bg-gray-900/80 border border-gray-200 dark:border-gray-700 px-2 py-1 text-xs text-gray-700 dark:text-gray-200">
                             <input
                               type="checkbox"
                               checked={selectedIdxSet?.has?.(idx) || false}
                               onChange={() => toggleSelected(idx)}
                               disabled={creating}
                             />
                             선택
                           </label>
                           <AnalyzedCharacterCard
                             initialCharacter={char}
                             onChange={(next) => updateCharacterAt(idx, next)}
                             onSave={handleApplyCharacterData} // '저장'이 아닌 '적용' 핸들러 연결
                             buttonText="이 캐릭터로 채우기"      // 버튼 텍스트 변경
                             buttonIcon={UserPlus}            // 버튼 아이콘 변경
                           />
                         </div>
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