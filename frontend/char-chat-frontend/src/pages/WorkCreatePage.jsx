import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { storiesAPI, filesAPI, chaptersAPI } from '../lib/api';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card';
import { Textarea } from '../components/ui/textarea';
import { Input } from '../components/ui/input';
import { Alert, AlertDescription } from '../components/ui/alert';
import { AlertCircle, ArrowLeft, Wand2, Menu, Trash2, Edit } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import ErrorBoundary from '../components/ErrorBoundary';
import DropzoneGallery from '../components/DropzoneGallery';
import StoryChapterImporterModal from '../components/StoryChapterImporterModal';

const WorkCreatePage = () => {
  const navigate = useNavigate();
  const [title, setTitle] = useState('');
  const [genre, setGenre] = useState('');
  const [keywords, setKeywords] = useState('');
  const [synopsis, setSynopsis] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [coverUrl, setCoverUrl] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  // 미니 갤러리 상태
  const [galleryExisting, setGalleryExisting] = useState([]); // [{url}]
  const [galleryNew, setGalleryNew] = useState([]); // File[]
  // 회차 상태
  const [episodes, setEpisodes] = useState(() => {
    try {
      const raw = localStorage.getItem('cc:episodes:new');
      const saved = raw ? JSON.parse(raw) : null;
      if (Array.isArray(saved) && saved.length) return saved;
    } catch {}
    return Array.from({ length: 3 }, () => ({
      id: (crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`),
      title: '',
      content: '',
      expanded: true,
    }));
  });
  const [openImporter, setOpenImporter] = useState(false);
  const [editingTitleId, setEditingTitleId] = useState(null);
  const [editingTitleDraft, setEditingTitleDraft] = useState('');
  const [formRestored, setFormRestored] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!title.trim() || !synopsis.trim()) {
      setError('제목과 소개글을 입력하세요.');
      return;
    }
    if (synopsis.trim().length < 20) {
      setError('소개글은 최소 20자 이상이어야 합니다.');
      return;
    }
    setLoading(true);
    try {
      // 키워드=태그 일치. 장르를 항상 첫 태그로 포함(중복 제거)
      const userKw = keywords
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      let kw = Array.from(new Set(userKw));
      if ((genre || '').trim()) {
        const g = genre.trim();
        kw = [g, ...kw.filter((k) => k !== g)];
      }
      // cover 메타 태그 추가 (UI에서는 배지에서 제외됨)
      if (coverUrl) {
        if (!kw.some((k) => String(k).startsWith('cover:')) && kw.length < 10) {
          kw.push(`cover:${coverUrl}`);
        }
      }
      const payload = {
        title: title.trim(),
        content: synopsis.trim(),
        cover_url: coverUrl || undefined,
        genre: genre || undefined,
        keywords: kw,
        is_public: true,
      };
      const res = await storiesAPI.createStory(payload);
      const id = res?.data?.id;
      try {
        if (id) {
          const filled = (episodes || []).filter((e) => (e?.content || '').trim().length > 0);
          const nowIso = new Date().toISOString();
          const payload = {
            updatedAt: nowIso,
            episodes: filled.map((e, idx) => ({
              no: idx + 1,
              title: (e.title || `${idx + 1}화`).trim(),
              content: (e.content || '').trim(),
              created_at: nowIso,
            })),
          };
          // 서버에 회차 저장 (안전하게 순차/병렬 혼합, 실패 시도는 무시)
          try {
            await Promise.allSettled(
              payload.episodes.map((ep) =>
                chaptersAPI.create({ story_id: id, no: ep.no, title: ep.title, content: ep.content })
              )
            );
          } catch (_) { /* no-op */ }
          // 폴백: 로컬스토리지에도 저장해둠 (임시)
          try { localStorage.setItem(`cc:chapters:${id}`, JSON.stringify(payload)); } catch {}
          try { localStorage.removeItem('cc:episodes:new'); } catch {}
          try { localStorage.removeItem('cc:work-new'); } catch {}
        }
      } catch (_) {}
      navigate(id ? `/stories/${id}` : '/');
    } catch (e) {
      let msg = '작품 등록에 실패했습니다.';
      const detail = e?.response?.data?.detail;
      if (typeof detail === 'string') msg = detail;
      else if (Array.isArray(detail)) {
        // FastAPI/Pydantic 에러 배열을 사람이 읽을 수 있게 변환
        msg = detail.map(d => d?.msg || '').filter(Boolean).join('\n') || msg;
      } else if (detail && typeof detail === 'object') {
        msg = detail.msg || msg;
      }
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleManualSave = () => {
    try {
      const draft = { title, genre, keywords, synopsis, coverUrl, galleryExisting };
      localStorage.setItem('cc:work-new', JSON.stringify(draft));
      localStorage.setItem('cc:episodes:new', JSON.stringify(episodes));
      try { window.dispatchEvent(new CustomEvent('toast', { detail: { type: 'success', message: '임시 저장 완료' } })); } catch (_) {}
    } catch (_) {}
  };

  // 회차 자동 저장 (디바운스)
  useEffect(() => {
    const t = setTimeout(() => {
      try { localStorage.setItem('cc:episodes:new', JSON.stringify(episodes)); } catch {}
    }, 800);
    return () => clearTimeout(t);
  }, [episodes]);

  // 폼 자동 저장/복원
  useEffect(() => {
    if (formRestored) return;
    try {
      const raw = localStorage.getItem('cc:work-new');
      if (raw) {
        const draft = JSON.parse(raw);
        if (typeof draft.title === 'string') setTitle(draft.title);
        if (typeof draft.genre === 'string') setGenre(draft.genre);
        if (typeof draft.keywords === 'string') setKeywords(draft.keywords);
        if (typeof draft.synopsis === 'string') setSynopsis(draft.synopsis);
        if (Array.isArray(draft.galleryExisting)) setGalleryExisting(draft.galleryExisting);
        if (typeof draft.coverUrl === 'string') setCoverUrl(draft.coverUrl);
      }
    } catch (_) {}
    setFormRestored(true);
  }, [formRestored]);

  useEffect(() => {
    const t = setTimeout(() => {
      try {
        const draft = { title, genre, keywords, synopsis, coverUrl, galleryExisting };
        localStorage.setItem('cc:work-new', JSON.stringify(draft));
      } catch (_) {}
    }, 1000);
    return () => clearTimeout(t);
  }, [title, genre, keywords, synopsis, coverUrl, galleryExisting]);

  const addEpisode = () => {
    setEpisodes(prev => [...prev, { id: (crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`), title: '', content: '', expanded: true }]);
  };
  const updateEpisode = (id, patch) => {
    setEpisodes(prev => prev.map(e => e.id === id ? { ...e, ...patch } : e));
  };
  const removeEpisode = (id) => {
    if (!window.confirm('이 회차를 삭제하시겠습니까?')) return;
    setEpisodes(prev => prev.filter(e => e.id !== id));
  };
  const startEditTitle = (ep) => {
    setEditingTitleId(ep.id);
    setEditingTitleDraft(ep.title || '');
  };
  const commitEditTitle = () => {
    if (!editingTitleId) return;
    updateEpisode(editingTitleId, { title: editingTitleDraft });
    setEditingTitleId(null);
    setEditingTitleDraft('');
  };
  const cancelEditTitle = () => {
    setEditingTitleId(null);
    setEditingTitleDraft('');
  };
  const mapChaptersToEpisodes = (chs) => chs.map((c) => ({
    id: (crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`),
    title: (c.title || (c.no ? `${c.no}화` : '회차')).trim(),
    content: c.content || '',
    expanded: true,
  }));
  // 추가(append): 기존 기본 3개부터 차례로 채우고, 남으면 뒤에 추가
  const handleImporterAppend = (parsed) => {
    setEpisodes(prev => {
      const incoming = mapChaptersToEpisodes(parsed);
      let idx = 0;
      // 1) 기존 빈 슬롯부터 비파괴적으로 채움
      const filled = prev.map(ep => {
        if (idx < incoming.length && !(ep.content || '').trim()) {
          const src = incoming[idx++];
          return { ...ep, title: src.title, content: src.content, expanded: true };
        }
        return ep;
      });
      // 2) 남은 회차는 뒤에 추가
      const rest = incoming.slice(idx);
      return rest.length ? [...filled, ...rest] : filled;
    });
  };
  const handleImporterReplace = (parsed) => setEpisodes(mapChaptersToEpisodes(parsed));

  // 미니 갤러리 핸들러
  const handleGalleryAddFiles = (files) => {
    if (!Array.isArray(files) || files.length === 0) return;
    setGalleryNew(prev => [...prev, ...files]);
  };
  const handleGalleryRemoveExisting = (index) => {
    setGalleryExisting(prev => prev.filter((_, i) => i !== index));
  };
  const handleGalleryRemoveNew = (index) => {
    setGalleryNew(prev => prev.filter((_, i) => i !== index));
  };
  const handleGalleryReorder = ({ from, to, isNew }) => {
    if (isNew) {
      setGalleryNew(prev => {
        const arr = [...prev];
        const item = arr.splice(from, 1)[0];
        arr.splice(Math.max(0, Math.min(arr.length, to)), 0, item);
        return arr;
      });
    } else {
      setGalleryExisting(prev => {
        const arr = [...prev];
        const item = arr.splice(from, 1)[0];
        arr.splice(Math.max(0, Math.min(arr.length, to)), 0, item);
        return arr;
      });
    }
  };
  const handleGalleryUpload = async (files, onProgress) => {
    // files: File[] -> 업로드 후 URL 배열 반환
    const res = await filesAPI.uploadImages(files, onProgress);
    const urls = Array.isArray(res.data) ? res.data : [res.data];
    setGalleryExisting(prev => [...prev, ...urls.map(u => ({ url: u }))]);
    setGalleryNew([]);
    return urls;
  };

  // 갤러리의 첫 이미지 = 대표 표지
  useEffect(() => {
    try {
      const raw = galleryExisting[0]?.url || '';
      // 절대/상대 URL 보정
      const normalized = (() => {
        try {
          if (!raw) return '';
          if (/^https?:\/\//i.test(raw)) return raw;
          if (raw.startsWith('/')) {
            const base = (import.meta.env.VITE_API_URL || 'http://localhost:8000').replace(/\/$/, '');
            return `${base}${raw}`;
          }
          return raw;
        } catch { return raw; }
      })();
      setCoverUrl(normalized);
    } catch (_) {}
  }, [galleryExisting]);

  return (
    <div className="min-h-screen bg-gray-900 text-gray-200 p-4 sm:p-6 lg:p-8 pb-28">
      <div className="max-w-5xl mx-auto">
        <header className="mb-6 flex items-center justify-between">
          <Button variant="ghost" onClick={() => navigate(-1)}>
            <ArrowLeft className="w-5 h-5 mr-2" /> 홈으로 돌아가기
          </Button>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* 좌: 직접 작성 */}
          <Card className="bg-gray-800 border border-gray-700">
            <CardHeader>
              <CardTitle className="text-white">작품 쓰기</CardTitle>
              <CardDescription className="text-gray-400">제목, 장르, 키워드와 본문을 입력해 작품을 등록합니다.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {error && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
              {/* 이미지 미니 갤러리 (표지 대체) */}
              {/* 이미지 미니 갤러리 (선택) */}
              <div>
                <label className="block text-sm">이미지 미니 갤러리 (선택)</label>
                <div className="mt-2">
                  <DropzoneGallery
                    existingImages={galleryExisting}
                    newFiles={galleryNew}
                    onAddFiles={handleGalleryAddFiles}
                    onRemoveExisting={handleGalleryRemoveExisting}
                    onRemoveNew={handleGalleryRemoveNew}
                    onReorder={handleGalleryReorder}
                    onUpload={handleGalleryUpload}
                  />
                </div>
                {coverUrl && (
                  <div className="mt-3">
                    <label className="block text-sm">대표 표지</label>
                    <img src={coverUrl} alt="표지" className="mt-2 w-28 h-40 object-cover rounded border border-gray-700" />
                  </div>
                )}
              </div>
              <div>
                <label className="block text-sm">제목</label>
                <Input value={title} onChange={(e)=>setTitle(e.target.value)} placeholder="작품 제목" className="mt-2" />
              </div>
              <div>
                <label className="block text-sm">장르</label>
                <div className="mt-2">
                  <Select value={genre} onValueChange={setGenre}>
                    <SelectTrigger>
                      <SelectValue placeholder="장르 선택" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="판타지">판타지</SelectItem>
                      <SelectItem value="현대판타지">현대판타지</SelectItem>
                      <SelectItem value="무협">무협</SelectItem>
                      <SelectItem value="로맨스">로맨스</SelectItem>
                      <SelectItem value="로판">로판</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <label className="block text-sm">키워드(최대 10개, 쉼표로 구분)</label>
                <Input value={keywords} onChange={(e)=>setKeywords(e.target.value)} placeholder="예: 성장, 히로인, 전투" className="mt-2" />
              </div>
              <div>
                <label className="block text-sm">소개글 (최소 20자)</label>
                <Textarea value={synopsis} onChange={(e)=>setSynopsis(e.target.value)} rows={10} className="mt-2" />
              </div>
              {/* 등록 버튼은 우측 회차 관리 하단으로 이동 */}
            </CardContent>
          </Card>

          {/* 우: 회차 관리 (수동 + 임포터 모달) */}
          <ErrorBoundary>
            <Card className="bg-gray-800 border border-gray-700">
              <CardHeader className="flex-row items-center justify-between">
                <CardTitle className="text-white">회차 관리</CardTitle>
                <div className="flex items-center gap-2">
                  <Button onClick={() => setOpenImporter(true)}>txt로 일괄 업로드</Button>
                  <Button variant="outline" onClick={addEpisode}>+ 회차 추가</Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {episodes.length === 0 && (
                  <div className="bg-gray-800/30 border border-gray-700 rounded-md p-4 text-sm text-gray-400">
                    회차가 없습니다. “+ 회차 추가” 또는 “임포터로 추가”를 사용하세요.
                  </div>
                )}
                <ul className="space-y-2">
                  {episodes.map((ep, idx) => (
                    <li key={ep.id} className="rounded-md border border-gray-700 bg-gray-800">
                      <div
                        className="flex items-center gap-2 px-3 py-2 cursor-pointer select-none"
                        onClick={() => updateEpisode(ep.id, { expanded: !ep.expanded })}
                      >
                        <Menu className="w-4 h-4 text-gray-300" />
                        <div className="flex-1 min-w-0">
                          {editingTitleId === ep.id ? (
                            <Input
                              value={editingTitleDraft}
                              onClick={(e)=> e.stopPropagation()}
                              onChange={(e)=> setEditingTitleDraft(e.target.value)}
                              onKeyDown={(e)=> {
                                if (e.key === 'Enter') { e.preventDefault(); commitEditTitle(); }
                                if (e.key === 'Escape') { e.preventDefault(); cancelEditTitle(); }
                              }}
                              onBlur={commitEditTitle}
                              placeholder="회차 제목"
                              className="h-8"
                              autoFocus
                            />
                          ) : (
                            <div className="truncate text-sm text-gray-200" title={ep.title || `${idx + 1}화`}>
                              {ep.title?.trim() ? ep.title : `${idx + 1}화`}
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="text-gray-300"
                            onClick={(e) => { e.stopPropagation(); startEditTitle(ep); }}
                            title="회차 제목 수정"
                          >
                            <Edit className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="text-red-400"
                            onClick={(e) => { e.stopPropagation(); removeEpisode(ep.id); }}
                            title="삭제"
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                      {ep.expanded && (
                        <div className="px-3 pb-3">
                          <label className="block text-sm text-gray-300 mt-2">내용</label>
                          <Textarea
                            value={ep.content}
                            onChange={(e)=> updateEpisode(ep.id, { content: e.target.value })}
                            rows={10}
                            placeholder="회차 내용을 입력하세요"
                            className="mt-2"
                          />
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          </ErrorBoundary>
          <StoryChapterImporterModal
            open={openImporter}
            onClose={() => setOpenImporter(false)}
            onApplyAppend={handleImporterAppend}
            onApplyReplace={handleImporterReplace}
          />
        </div>
      </div>
      {/* 고정 푸터 바: 항상 화면 하단에 표시 */}
      <footer className="fixed bottom-0 left-0 right-0 bg-gray-900 border-t border-gray-800 py-3 z-50">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <Button
              type="button"
              onClick={handleManualSave}
              className="bg-gray-300 text-black hover:bg-gray-200"
            >
              임시 저장
            </Button>
            <Button
              type="button"
              onClick={handleSubmit}
              disabled={loading}
              className="flex-1"
            >
              {loading ? (<><Wand2 className="w-4 h-4 mr-2 animate-spin"/>등록 중...</>) : '작품 등록'}
            </Button>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default WorkCreatePage;


