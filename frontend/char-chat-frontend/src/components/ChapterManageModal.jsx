import React from 'react';
import { Button } from './ui/button';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Textarea } from './ui/textarea';
import { Input } from './ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog';
import { Alert, AlertDescription } from './ui/alert';
import { AlertCircle, Edit, Menu, Trash2, Upload } from 'lucide-react';
import { chaptersAPI } from '../lib/api';
import StoryChapterImporterModal from './StoryChapterImporterModal';

const ChapterManageModal = ({ open, onClose, storyId, onAfterSave }) => {
  const [loading, setLoading] = React.useState(false);
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
            { id: crypto?.randomUUID?.() || `${Date.now()}-a`, title: '1화', content: '', expanded: true },
            { id: crypto?.randomUUID?.() || `${Date.now()}-b`, title: '2화', content: '', expanded: true },
            { id: crypto?.randomUUID?.() || `${Date.now()}-c`, title: '3화', content: '', expanded: true },
          ]);
        } else {
          setEpisodes([]);
        }
      } catch (_) {
        setExistingCount(0);
        // API 실패 시에도 기본 3개 제공
        setEpisodes([
          { id: crypto?.randomUUID?.() || `${Date.now()}-a`, title: '1화', content: '', expanded: true },
          { id: crypto?.randomUUID?.() || `${Date.now()}-b`, title: '2화', content: '', expanded: true },
          { id: crypto?.randomUUID?.() || `${Date.now()}-c`, title: '3화', content: '', expanded: true },
        ]);
      } finally {
        setLoading(false);
      }
    })();
  }, [open, storyId]);

  const addEpisode = () => {
    setEpisodes((prev) => {
      const next = [...prev, { id: crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`, title: '', content: '', expanded: true }];
      setTimeout(scrollToEnd, 0);
      return next;
    });
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
    setLoading(true); setError('');
    try {
      // 기존 마지막 번호 기준으로 번호 매김
      let no = existingCount + 1;
      for (const ep of valid) {
        const title = (ep.title || `${no}화`).trim();
        await chaptersAPI.create({ story_id: storyId, no, title, content: ep.content });
        no += 1;
      }
      setEpisodes([]);
      if (onAfterSave) onAfterSave();
      try { window.dispatchEvent(new CustomEvent('toast', { detail: { type: 'success', message: '회차가 저장되었습니다.' } })); } catch (_) {}
      onClose?.();
    } catch (e) {
      setError('회차 저장에 실패했습니다.');
    } finally { setLoading(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(v)=> { if (!v) onClose?.(); }}>
      <DialogContent className="sm:max-w-4xl max-h-[85vh] bg-gray-900 text-gray-100 border border-gray-700 overflow-hidden flex flex-col" aria-describedby="chapter-manage-desc">
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
                      <div className="px-3 pb-3">
                        <label className="block text-sm text-gray-300 mt-2">내용</label>
                        <Textarea value={ep.content} onChange={(e)=> updateEpisode(ep.id, { content: e.target.value })} rows={10} placeholder="회차 내용을 입력하세요" className="mt-2" />
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


