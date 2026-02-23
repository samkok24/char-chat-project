import React from 'react';
import { Button } from './ui/button';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Textarea } from './ui/textarea';
import { Input } from './ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog';
import { Alert, AlertDescription } from './ui/alert';
import { AlertCircle, Edit, Menu, Trash2, Upload, Image as ImageIcon, X } from 'lucide-react';
import { chaptersAPI, mediaAPI } from '../lib/api';
import StoryChapterImporterModal from './StoryChapterImporterModal';
import BlockingLoadingOverlay from './BlockingLoadingOverlay';

const ChapterManageModal = ({ open, onClose, storyId, onAfterSave }) => {
  const [loading, setLoading] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [saveProgress, setSaveProgress] = React.useState({ current: 0, total: 0 });
  const [error, setError] = React.useState('');
  const [episodes, setEpisodes] = React.useState([]); // 신규 추가분만 관리
  const [existingCount, setExistingCount] = React.useState(0);
  const [openImporter, setOpenImporter] = React.useState(false);
  const [editingTitleId, setEditingTitleId] = React.useState(null);
  const [editingTitleDraft, setEditingTitleDraft] = React.useState('');
  const listEndRef = React.useRef(null);

  const scrollToEnd = () => {
    try { listEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); } catch (_) {}
  };

  React.useEffect(() => {
    if (!open) return;
    (async () => {
      try {
        setLoading(true);
        const res = await chaptersAPI.getByStory(storyId, 'asc');
        const arr = Array.isArray(res.data) ? res.data : [];
        const count = arr.length || 0;
        setExistingCount(count);
        if (count === 0) {
          // 회차가 0개일 때는 1~3화 기본 슬롯을 미리 제공
          setEpisodes([
            { id: crypto?.randomUUID?.() || `${Date.now()}-a`, title: '1화', content: '', expanded: true, image: null, imagePreview: null },
            { id: crypto?.randomUUID?.() || `${Date.now()}-b`, title: '2화', content: '', expanded: true, image: null, imagePreview: null },
            { id: crypto?.randomUUID?.() || `${Date.now()}-c`, title: '3화', content: '', expanded: true, image: null, imagePreview: null },
          ]);
        } else {
          setEpisodes([]);
        }
      } catch (_) {
        setExistingCount(0);
        // API 실패 시에도 기본 3개 제공
        setEpisodes([
          { id: crypto?.randomUUID?.() || `${Date.now()}-a`, title: '1화', content: '', expanded: true, image: null, imagePreview: null },
          { id: crypto?.randomUUID?.() || `${Date.now()}-b`, title: '2화', content: '', expanded: true, image: null, imagePreview: null },
          { id: crypto?.randomUUID?.() || `${Date.now()}-c`, title: '3화', content: '', expanded: true, image: null, imagePreview: null },
        ]);
      } finally {
        setLoading(false);
      }
    })();
  }, [open, storyId]);

  const addEpisode = () => {
    setEpisodes((prev) => {
      const next = [...prev, { id: crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`, title: '', content: '', expanded: true, image: null, imagePreview: null }];
      setTimeout(scrollToEnd, 0);
      return next;
    });
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

  // 이미지 제거
  const removeImage = (id) => {
    const ep = episodes.find(e => e.id === id);
    if (ep?.imagePreview) {
      URL.revokeObjectURL(ep.imagePreview);
    }
    updateEpisode(id, { image: null, imagePreview: null });
  };

  const updateEpisode = (id, patch) => {
    setEpisodes(prev => prev.map(e => e.id === id ? { ...e, ...patch } : e));
  };

  const removeEpisode = (id) => {
    if (!window.confirm('이 회차를 삭제하시겠습니까?')) return;
    setEpisodes(prev => prev.filter(e => e.id !== id));
  };

  const startEditTitle = (ep) => { setEditingTitleId(ep.id); setEditingTitleDraft(ep.title || ''); };
  const commitEditTitle = () => { if (!editingTitleId) return; updateEpisode(editingTitleId, { title: editingTitleDraft }); setEditingTitleId(null); setEditingTitleDraft(''); };
  const cancelEditTitle = () => { setEditingTitleId(null); setEditingTitleDraft(''); };

  const mapChaptersToEpisodes = (chs) => chs.map((c) => ({
    id: crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`,
    title: (c.title || (c.no ? `${c.no}화` : '회차')).trim(),
    content: c.content || '',
    expanded: true,
    image: null,  // 이미지 파일
    imagePreview: null,  // 미리보기 URL
  }));

  const handleImporterAppend = (parsed) => {
    setEpisodes(prev => {
      const incoming = mapChaptersToEpisodes(parsed);
      const next = [...prev, ...incoming];
      setTimeout(scrollToEnd, 0);
      return next;
    });
    setOpenImporter(false);
  };
  const handleImporterReplace = (parsed) => {
    setEpisodes(mapChaptersToEpisodes(parsed));
    setOpenImporter(false);
    setTimeout(scrollToEnd, 0);
  };

  const handleSaveAll = async () => {
    const valid = (episodes || []).filter(e => (e.content || '').trim().length > 0);
    if (valid.length === 0) { setError('내용이 있는 회차가 없습니다.'); return; }
    setLoading(true);
    setSaving(true);
    setSaveProgress({ current: 0, total: valid.length });
    setError('');
    try {
      // 기존 마지막 번호 기준으로 번호 매김
      let no = existingCount + 1;
      for (let i = 0; i < valid.length; i++) {
        const ep = valid[i];
        try { setSaveProgress({ current: i + 1, total: valid.length }); } catch (_) {}
        const title = (ep.title || `${no}화`).trim();
        
        // 1. 회차 생성 (텍스트)
        const chapterRes = await chaptersAPI.create({ 
          story_id: storyId, 
          no, 
          title, 
          content: ep.content 
        });
        
        // 2. 이미지가 있으면 업로드 후 image_url 업데이트
        if (ep.image) {
          try {
            const formData = new FormData();
            formData.append('files', ep.image);
            
            // 기존 media API 사용
            const uploadRes = await mediaAPI.upload(formData);
            const imageUrl = uploadRes.data?.items?.[0]?.url;
            
            if (imageUrl && chapterRes.data?.id) {
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
        
        no += 1;
      }
      setEpisodes([]);
      if (onAfterSave) onAfterSave();
      try { window.dispatchEvent(new CustomEvent('toast', { detail: { type: 'success', message: '회차가 저장되었습니다.' } })); } catch (_) {}
      onClose?.();
    } catch (e) {
      setError('회차 저장에 실패했습니다.');
    } finally {
      setLoading(false);
      setSaving(false);
      setSaveProgress({ current: 0, total: 0 });
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v)=> { if (!v) { if (saving) return; onClose?.(); } }}>
      <DialogContent className="sm:max-w-4xl max-h-[85vh] bg-gray-900 text-gray-100 border border-gray-700 overflow-hidden flex flex-col relative" aria-describedby="chapter-manage-desc">
        <BlockingLoadingOverlay
          open={saving}
          title="회차를 저장하고 있어요"
          description={`AI 분석(요약/등장인물 보강) 때문에 시간이 걸릴 수 있어요.\n진행: ${saveProgress.total ? `${saveProgress.current}/${saveProgress.total}` : '0/0'}\n완료될 때까지 페이지를 이동하지 말아주세요.`}
        />
        <DialogHeader>
          <DialogTitle className="text-white">회차 등록</DialogTitle>
        </DialogHeader>
        <div id="chapter-manage-desc" className="sr-only">회차 등록 및 일괄 업로드 모달</div>
        <div className="flex items-center justify-between px-1 pb-2">
          <div className="text-sm text-gray-400">현재 등록된 회차: {existingCount.toLocaleString()}개</div>
          <div className="flex items-center gap-2">
            <Button onClick={() => setOpenImporter(true)}>txt로 일괄 업로드</Button>
            <Button variant="outline" onClick={addEpisode}>+ 회차 추가</Button>
          </div>
        </div>
        <div className="flex-1 overflow-auto pr-1">
          {error && (
            <div className="px-1">
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            </div>
          )}
          <Card className="bg-gray-800 border border-gray-700">
            <CardHeader>
              <CardTitle className="text-white text-base">회차 관리</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {(episodes || []).length === 0 && (
                <div className="bg-gray-800/30 border border-gray-700 rounded-md p-4 text-sm text-gray-400">
                  “+ 회차 추가” 또는 “txt로 일괄 업로드”를 사용하세요.
                </div>
              )}
              <ul className="space-y-2">
                {episodes.map((ep, idx) => (
                  <li key={ep.id} className="rounded-md border border-gray-700 bg-gray-800">
                    <div className="flex items-center gap-2 px-3 py-2 cursor-pointer select-none" onClick={() => updateEpisode(ep.id, { expanded: !ep.expanded })}>
                      <Menu className="w-4 h-4 text-gray-300" />
                      <div className="flex-1 min-w-0">
                        {editingTitleId === ep.id ? (
                          <Input
                            value={editingTitleDraft}
                            onClick={(e)=> e.stopPropagation()}
                            onChange={(e)=> setEditingTitleDraft(e.target.value)}
                            onKeyDown={(e)=> { if (e.key === 'Enter') { e.preventDefault(); commitEditTitle(); } if (e.key === 'Escape') { e.preventDefault(); cancelEditTitle(); } }}
                            onBlur={commitEditTitle}
                            placeholder="회차 제목"
                            className="h-8"
                            autoFocus
                          />
                        ) : (
                          <div className="truncate text-sm text-gray-200" title={ep.title || `${existingCount + idx + 1}화`}>
                            {ep.title?.trim() ? ep.title : `${existingCount + idx + 1}화`}
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-1">
                        <Button variant="ghost" size="icon" className="text-gray-300" onClick={(e) => { e.stopPropagation(); startEditTitle(ep); }} title="회차 제목 수정">
                          <Edit className="w-4 h-4" />
                        </Button>
                        <Button variant="ghost" size="icon" className="text-red-400" onClick={(e) => { e.stopPropagation(); removeEpisode(ep.id); }} title="삭제">
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                    {ep.expanded && (
                      <div className="px-3 pb-3 space-y-3">
                        {/* 텍스트 내용 */}
                        <div>
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
                        </div>

                        {/* 이미지 업로드 (선택) */}
                        <div>
                          <label className="block text-sm text-gray-300 mb-2">
                            이미지 삽입 (선택사항)
                          </label>
                          {ep.imagePreview ? (
                            // 이미지 미리보기
                            <div className="relative">
                              <img 
                                src={ep.imagePreview} 
                                alt="미리보기" 
                                className="max-h-64 mx-auto rounded border border-gray-600" 
                              />
                              <Button
                                type="button"
                                size="sm"
                                variant="destructive"
                                className="absolute top-2 right-2"
                                onClick={() => removeImage(ep.id)}
                              >
                                <X className="w-4 h-4" />
                              </Button>
                              <div className="mt-2 text-xs text-gray-400 text-center">
                                이미지가 있으면 독자에게는 이미지만 표시됩니다
                              </div>
                            </div>
                          ) : (
                            // 업로드 버튼
                            <label className="flex flex-col items-center justify-center h-32 border-2 border-dashed border-gray-600 rounded-lg cursor-pointer hover:border-gray-500 transition-colors">
                              <ImageIcon className="w-8 h-8 text-gray-400 mb-2" />
                              <span className="text-sm text-gray-400">클릭하여 이미지 삽입</span>
                              <span className="text-xs text-gray-500 mt-1">이미지가 없으면 텍스트로 표시됩니다</span>
                              <input
                                type="file"
                                accept="image/*"
                                onChange={(e) => handleImageChange(ep.id, e.target.files?.[0])}
                                className="hidden"
                              />
                            </label>
                          )}
                        </div>
                      </div>
                    )}
                  </li>
                ))}
                <li ref={listEndRef} />
              </ul>
            </CardContent>
          </Card>
        </div>
        <div className="pt-3 flex items-center justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={loading}>닫기</Button>
          <Button onClick={handleSaveAll} disabled={loading}>{loading ? '저장 중...' : '저장'}</Button>
        </div>
        <StoryChapterImporterModal open={openImporter} onClose={() => setOpenImporter(false)} onApplyAppend={handleImporterAppend} onApplyReplace={handleImporterReplace} />
      </DialogContent>
    </Dialog>
  );
};

export default ChapterManageModal;


