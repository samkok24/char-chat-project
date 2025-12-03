import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { storiesAPI, chaptersAPI, mediaAPI } from '../lib/api';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card';
import { Textarea } from '../components/ui/textarea';
import { Input } from '../components/ui/input';
import { Alert, AlertDescription } from '../components/ui/alert';
import { AlertCircle, ArrowLeft, Wand2, Menu, Trash2, Edit, Plus, Image as ImageIcon } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import ErrorBoundary from '../components/ErrorBoundary';
import ImageGenerateInsertModal from '../components/ImageGenerateInsertModal';
import StoryChapterImporterModal from '../components/StoryChapterImporterModal';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogContent, AlertDialogDescription, AlertDialogHeader, AlertDialogTitle } from '../components/ui/alert-dialog';

const WorkCreatePage = () => {
  const navigate = useNavigate();
  const [title, setTitle] = useState('');
  const [genre, setGenre] = useState('');
  const [keywords, setKeywords] = useState('');
  const [keywordError, setKeywordError] = useState('');
  const [synopsis, setSynopsis] = useState('');
  const [isWebtoon, setIsWebtoon] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [coverUrl, setCoverUrl] = useState('');
  const [openImgModal, setOpenImgModal] = useState(false);
  const [draftGallery, setDraftGallery] = useState(() => {
    try {
      const raw = localStorage.getItem('cc:work-new:gallery');
      const saved = raw ? JSON.parse(raw) : null;
      return Array.isArray(saved) ? saved : [];
    } catch { return []; }
  });
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
      image: null,
      imagePreview: null,
    }));
  });
  const [openImporter, setOpenImporter] = useState(false);
  const [editingTitleId, setEditingTitleId] = useState(null);
  const [editingTitleDraft, setEditingTitleDraft] = useState('');
  const [formRestored, setFormRestored] = useState(false);
  const [hasUnsaved, setHasUnsaved] = useState(false);
  const [confirmLeaveOpen, setConfirmLeaveOpen] = useState(false);
  const [savedModalOpen, setSavedModalOpen] = useState(false);

  const markDirty = () => setHasUnsaved(true);

  const validateKeywords = (value) => {
    const entries = value
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (entries.length > 10) {
      setKeywordError('키워드는 최대 10개까지 입력할 수 있습니다.');
      return false;
    }
    if (entries.some((k) => k.length > 50)) {
      setKeywordError('각 키워드는 50자 이하여야 합니다.');
      return false;
    }
    setKeywordError('');
    return true;
  };

  // 새로고침/창닫기 가드
  useEffect(() => {
    const onBeforeUnload = (e) => {
      if (!hasUnsaved) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [hasUnsaved]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    const hasCover = Boolean((coverUrl && coverUrl.trim()) || (draftGallery?.length || 0) > 0);
    if (!hasCover) {
      setError('대표 이미지를 추가해주세요.');
      return;
    }
    if (!title.trim()) {
      setError('제목을 입력하세요.');
      return;
    }
    if (!genre.trim()) {
      setError('장르를 선택하세요.');
      return;
    }
    if (!synopsis.trim()) {
      setError('소개글을 입력하세요.');
      return;
    }
    if (synopsis.trim().length < 20) {
      setError('소개글은 최소 20자 이상이어야 합니다.');
      return;
    }
    if (!validateKeywords(keywords)) {
      setError('키워드 입력을 확인해주세요.');
      return;
    }
    setLoading(true);
    try {
      // 키워드=태그 일치. 장르를 항상 첫 태그로 포함(중복 제거)
      const userKwRaw = keywords
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const userKw = userKwRaw.map(k => k.slice(0, 50));
      let kw = Array.from(new Set(userKw));
      if ((genre || '').trim()) {
        const g = genre.trim();
        kw = [g, ...kw.filter((k) => k !== g)];
      }
      // cover: 메타 태그는 더 이상 키워드에 주입하지 않음 (탐색 태그 오염 방지)
      const primaryCover = coverUrl || (draftGallery?.[0]?.url || '');
      const payload = {
        title: title.trim(),
        content: synopsis.trim(),
        cover_url: primaryCover,
        genre: genre || undefined,
        keywords: kw,
        is_public: true,
        is_webtoon: isWebtoon,
      };
      const res = await storiesAPI.createStory(payload);
      const id = res?.data?.id;
      try {
        if (id) {
          // 생성 모달에서 선택한 갤러리를 실제 스토리에 첨부(첫 장 대표)
          try {
            const assetIds = (draftGallery || []).map(a => a.id).filter(Boolean);
            if (assetIds.length > 0) {
              await mediaAPI.attach({ entityType: 'story', entityId: id, assetIds, asPrimary: true });
            }
          } catch (_) {}
          const filled = (episodes || []).filter((e) => (e?.content || '').trim().length > 0);
          const nowIso = new Date().toISOString();
          
          // 서버에 회차 저장 (이미지 업로드 포함)
          try {
            for (let idx = 0; idx < filled.length; idx++) {
              const e = filled[idx];
              const no = idx + 1;
              const title = (e.title || `${no}화`).trim();
              const content = (e.content || '').trim();
              
              // 1. 회차 생성 (텍스트)
              const chapterRes = await chaptersAPI.create({ 
                story_id: id, 
                no, 
                title, 
                content 
              });
              
              // 2. 이미지가 있으면 업로드 후 image_url 업데이트
              if (e.image && chapterRes.data?.id) {
                try {
                  const formData = new FormData();
                  formData.append('files', e.image);
                  
                  // 기존 media API 사용
                  const uploadRes = await mediaAPI.upload(formData);
                  const imageUrl = uploadRes.data?.items?.[0]?.url;
                  
                  if (imageUrl) {
                    // 회차에 image_url 업데이트
                    await chaptersAPI.update(chapterRes.data.id, {
                      image_url: imageUrl
                    });
                  }
                } catch (imgErr) {
                  console.error('이미지 업로드 실패:', imgErr);
                  // 이미지 업로드 실패해도 회차는 저장됨 (텍스트만)
                }
              }
            }
          } catch (_) { /* no-op */ }
          // 폴백: 로컬스토리지에도 저장해둠 (임시)
          try { localStorage.setItem(`cc:chapters:${id}`, JSON.stringify(payload)); } catch {}
          try { localStorage.removeItem('cc:episodes:new'); } catch {}
          try { localStorage.removeItem('cc:work-new'); } catch {}
        }
      } catch (_) {}
      setHasUnsaved(false);
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

  const handleManualSave = async () => {
    try {
      const draft = { title, genre, keywords, synopsis, coverUrl, isWebtoon };
      localStorage.setItem('cc:work-new', JSON.stringify(draft));
      localStorage.setItem('cc:episodes:new', JSON.stringify(episodes));
      localStorage.setItem('cc:work-new:gallery', JSON.stringify(draftGallery));
      localStorage.setItem('cc:work-new:explicit', '1');
      try { window.dispatchEvent(new CustomEvent('toast', { detail: { type: 'success', message: '임시 저장 완료' } })); } catch (_) {}
      setHasUnsaved(false);
      setSavedModalOpen(true);
    } catch (_) {}
  };

  // 자동 저장 제거: 임시 저장 버튼을 누를 때만 로컬에 보존

  // 폼 복원: 명시적 임시저장 되었을 때만 복원
  useEffect(() => {
    if (formRestored) return;
    try {
      const marker = localStorage.getItem('cc:work-new:explicit');
      if (marker === '1') {
        const raw = localStorage.getItem('cc:work-new');
        if (raw) {
          const draft = JSON.parse(raw);
          if (typeof draft.title === 'string') setTitle(draft.title);
          if (typeof draft.genre === 'string') setGenre(draft.genre);
          if (typeof draft.keywords === 'string') {
            setKeywords(draft.keywords);
            validateKeywords(draft.keywords);
          }
          if (typeof draft.synopsis === 'string') setSynopsis(draft.synopsis);
          if (typeof draft.coverUrl === 'string') setCoverUrl(draft.coverUrl);
          if (typeof draft.isWebtoon === 'boolean') setIsWebtoon(draft.isWebtoon);
        }
        try {
          const graw = localStorage.getItem('cc:work-new:gallery');
          const g = graw ? JSON.parse(graw) : [];
          if (Array.isArray(g)) setDraftGallery(g);
        } catch {}
      }
    } catch (_) {}
    setFormRestored(true);
  }, [formRestored]);

  // 자동 저장 비활성화: 임시 저장 눌렀을 때만 보존

  const handleResetForm = () => {
    if (!window.confirm('입력한 내용을 모두 초기화할까요?')) return;
    setTitle('');
    setGenre('');
    setKeywords('');
    setKeywordError('');
    setSynopsis('');
    setIsWebtoon(false);
    setCoverUrl('');
    setDraftGallery([]);
    setEpisodes(Array.from({ length: 3 }, () => ({ id: (crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`), title: '', content: '', expanded: true })));
    try {
      localStorage.removeItem('cc:work-new');
      localStorage.removeItem('cc:work-new:explicit');
      localStorage.removeItem('cc:episodes:new');
      localStorage.removeItem('cc:work-new:gallery');
    } catch (_) {}
    setHasUnsaved(false);
    try { window.dispatchEvent(new CustomEvent('toast', { detail: { type: 'success', message: '초기화 완료' } })); } catch (_) {}
  };

  const addEpisode = () => {
    setEpisodes(prev => [...prev, { id: (crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`), title: '', content: '', expanded: true, image: null, imagePreview: null }]);
    markDirty();
  };

  // 이미지 선택 핸들러
  const handleImageChange = (id, file) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('이미지 파일만 업로드 가능합니다.');
      return;
    }
    const preview = URL.createObjectURL(file);
    updateEpisode(id, { image: file, imagePreview: preview });
  };

  // 이미지 제거 (더블클릭 또는 컨텍스트 메뉴에서)
  const removeImage = (id) => {
    const ep = episodes.find(e => e.id === id);
    if (ep?.imagePreview) {
      URL.revokeObjectURL(ep.imagePreview);
    }
    updateEpisode(id, { image: null, imagePreview: null });
  };

  // 이미지 아이콘 더블클릭 시 제거
  const handleImageIconDoubleClick = (id, e) => {
    e.stopPropagation();
    if (window.confirm('업로드한 이미지를 제거하시겠습니까?')) {
      removeImage(id);
    }
  };
  const updateEpisode = (id, patch) => {
    setEpisodes(prev => prev.map(e => e.id === id ? { ...e, ...patch } : e));
    markDirty();
  };
  const removeEpisode = (id) => {
    if (!window.confirm('이 회차를 삭제하시겠습니까?')) return;
    setEpisodes(prev => prev.filter(e => e.id !== id));
    markDirty();
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
    image: null,
    imagePreview: null,
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
    markDirty();
  };
  const handleImporterReplace = (parsed) => { setEpisodes(mapChaptersToEpisodes(parsed)); markDirty(); };

  // 이미지 선택 모달 결과 처리
  const handleImageModalClose = (res) => {
    setOpenImgModal(false);
    try {
      const focus = typeof res?.focusUrl === 'string' ? res.focusUrl.trim() : '';
      const gallery = Array.isArray(res?.gallery) ? res.gallery : null;
      let touched = false;

      if (focus) {
        setCoverUrl(focus);
        touched = true;
      }

      if (gallery) {
        setDraftGallery(gallery);
        touched = true;

        if (!focus && gallery.length > 0) {
          setCoverUrl(prev => prev || gallery[0]?.url || '');
        }

        if (gallery.length === 0) {
          setCoverUrl('');
        }
      }

      if (touched) markDirty();
    } catch (_) {}
  };

  // 표지 URL은 모달 종료 시 직접 설정

  return (
    <div className="min-h-screen bg-gray-900 text-gray-200 p-4 sm:p-6 lg:p-8 pb-28">
      <div className="max-w-5xl mx-auto">
        <header className="mb-6 flex items-center justify-between">
          <Button variant="ghost" onClick={() => { if (hasUnsaved) setConfirmLeaveOpen(true); else navigate(-1); }}>
            <ArrowLeft className="w-5 h-5 mr-2" /> 홈으로 돌아가기
          </Button>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={handleResetForm}>일괄초기화</Button>
          </div>
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
              {/* 대표 이미지 미니 스트립 갤러리 */}
              <div>
                <label className="block text-sm">대표 이미지 <span className="text-red-400">*</span></label>
                <div className={`mt-2 flex items-center gap-2 overflow-x-auto pb-2 ${ (draftGallery?.length||0) === 0 ? 'justify-center' : 'justify-start' }`}>
                  {draftGallery.map((g, idx) => (
                    <div key={`${g.url}-${idx}`} className={`relative w-14 h-20 rounded border ${idx===0?'border-blue-500 ring-2 ring-blue-500':'border-gray-700'} flex-shrink-0 overflow-hidden bg-gray-800`} title={idx===0?'대표 이미지':''}>
                      {idx===0 && (<div className="absolute top-1 left-1 bg-blue-600 text-white text-[9px] px-1 rounded">대표</div>)}
                      <img src={g.url} alt={`img-${idx+1}`} className="w-full h-full object-cover" />
                    </div>
                  ))}
                  <button type="button" onClick={()=> setOpenImgModal(true)} className="w-14 h-20 rounded border-2 border-dashed border-gray-600 hover:border-purple-500 hover:bg-purple-500/10 flex items-center justify-center text-gray-400 hover:text-purple-400 flex-shrink-0" aria-label="이미지 추가">
                    <Plus className="w-5 h-5" />
                  </button>
                </div>
                { (draftGallery?.length||0) === 0 && (
                  <div className="text-xs text-gray-500 text-center">이미지를 추가하려면 +를 클릭하세요</div>
                )}
              </div>
              <div>
                <label className="block text-sm">제목 <span className="text-red-400">*</span></label>
                <Input value={title} onChange={(e)=>{ setTitle(e.target.value); markDirty(); }} placeholder="작품 제목" className="mt-2" />
              </div>
              <div>
                <label className="block text-sm">장르 <span className="text-red-400">*</span></label>
                <div className="mt-2">
                  <Select value={genre} onValueChange={(v)=>{ setGenre(v); markDirty(); }}>
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
                <Input
                  value={keywords}
                  onChange={(e)=>{ setKeywords(e.target.value); validateKeywords(e.target.value); markDirty(); }}
                  placeholder="예: 성장, 히로인, 전투"
                  className="mt-2"
                />
                {keywordError && (
                  <p className="text-sm text-red-400 mt-1">{keywordError}</p>
                )}
              </div>
              <div>
                <label className="block text-sm">소개글 <span className="text-red-400">*</span> (최소 20자)</label>
                <Textarea value={synopsis} onChange={(e)=>{ setSynopsis(e.target.value); markDirty(); }} rows={10} className="mt-2" />
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="is-webtoon"
                  checked={isWebtoon}
                  onChange={(e)=>{ setIsWebtoon(e.target.checked); markDirty(); }}
                  className="w-4 h-4"
                />
                <label htmlFor="is-webtoon" className="text-sm text-gray-300 cursor-pointer">
                  웹툰
                </label>
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
                  <Button variant="outline" onClick={()=>{
                    if (!window.confirm('추출/입력한 회차를 초기 상태로 되돌릴까요? (1~3화 기본 슬롯)')) return;
                    setEpisodes(Array.from({ length: 3 }, () => ({ id: (crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`), title: '', content: '', expanded: true, image: null, imagePreview: null })));
                    setHasUnsaved(true);
                  }}>회차 초기화</Button>
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
                          {/* 이미지 업로드 아이콘 */}
                          <label className="cursor-pointer" onClick={(e) => e.stopPropagation()}>
                            <input
                              type="file"
                              accept="image/*"
                              onChange={(e) => handleImageChange(ep.id, e.target.files?.[0])}
                              className="hidden"
                              id={`image-input-${ep.id}`}
                            />
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className={ep.imagePreview ? "text-blue-400" : "text-gray-300"}
                              onClick={(e) => {
                                e.stopPropagation();
                                document.getElementById(`image-input-${ep.id}`)?.click();
                              }}
                              onDoubleClick={(e) => handleImageIconDoubleClick(ep.id, e)}
                              title={ep.imagePreview ? "이미지 변경 (더블클릭: 제거)" : "웹툰 이미지 업로드"}
                            >
                              <ImageIcon className="w-4 h-4" />
                            </Button>
                          </label>
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
                          <label className="block text-sm text-gray-300 mt-2">
                            내용
                          </label>
                          <Textarea
                            value={ep.content}
                            onChange={(e)=> updateEpisode(ep.id, { content: e.target.value })}
                            rows={10}
                            placeholder="회차 내용을 입력하세요"
                            className="mt-2"
                          />
                          {ep.imagePreview && (
                            <div className="mt-2 text-xs text-gray-400">
                              ✓ 웹툰 이미지가 업로드되었습니다. 독자에게는 이미지만 표시됩니다.
                            </div>
                          )}
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
      {/* 이미지 생성/삽입 모달 */}
      <ImageGenerateInsertModal open={openImgModal} onClose={handleImageModalClose} entityType={undefined} entityId={undefined} initialGallery={draftGallery} />
      {/* 나가기 경고 모달 */}
      <Dialog open={confirmLeaveOpen} onOpenChange={(v)=> setConfirmLeaveOpen(v)}>
        <DialogContent className="bg-gray-900 text-white border border-gray-800 max-w-md">
          <DialogHeader>
            <DialogTitle>저장되지 않은 변경사항</DialogTitle>
          </DialogHeader>
          <div className="text-sm text-gray-300">임시 저장하지 않은 정보가 있습니다. 나가면 입력한 내용이 사라질 수 있어요.</div>
          <div className="mt-4 flex items-center justify-end gap-2">
            <Button variant="outline" className="bg-gray-800 border-gray-700 text-gray-200" onClick={()=> setConfirmLeaveOpen(false)}>계속 편집</Button>
            <Button className="bg-red-600 hover:bg-red-700" onClick={()=> { setConfirmLeaveOpen(false); setHasUnsaved(false); navigate(-1); }}>저장 안 하고 나가기</Button>
          </div>
        </DialogContent>
      </Dialog>
      {/* 임시 저장 완료 알림 모달 */}
      <AlertDialog open={savedModalOpen} onOpenChange={setSavedModalOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>임시 저장 완료</AlertDialogTitle>
            <AlertDialogDescription>
              입력하신 내용이 안전하게 임시 저장되었습니다. 계속 편집을 진행하셔도 됩니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex items-center justify-end gap-2">
            <AlertDialogAction onClick={()=> setSavedModalOpen(false)}>확인</AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialog>
      {/* 하단 액션 영역: 일반 섹션 */}
      <footer className="bg-gray-900 border-t border-gray-800 py-4 mt-10">
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

// 모달 마운트 (페이지 하단)
// eslint-disable-next-line react/prop-types
const WorkCreatePageWithModal = () => null;


