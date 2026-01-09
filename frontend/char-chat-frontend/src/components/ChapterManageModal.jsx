import React from 'react';
import { Button } from './ui/button';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Textarea } from './ui/textarea';
import { Input } from './ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog';
import { Alert, AlertDescription } from './ui/alert';
import { AlertCircle, Edit, Menu, Trash2, Image as ImageIcon } from 'lucide-react';
import { chaptersAPI } from '../lib/api';
import { resolveImageUrl } from '../lib/images';
import StoryChapterImporterModal from './StoryChapterImporterModal';
import BlockingLoadingOverlay from './BlockingLoadingOverlay';
import ImageGenerateInsertModal from './ImageGenerateInsertModal';

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
  const scrollWrapRef = React.useRef(null);
  // ✅ 회차별 이미지 삽입 모달
  const [imgModalFor, setImgModalFor] = React.useState(null); // episodeId

  const scrollToEnd = () => {
    try { listEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); } catch (_) {}
  };

  /**
   * ✅ 모달 스크롤 잠김 방지(UX)
   *
   * 문제:
   * - 큰 Textarea 위에서 휠을 굴리면, Textarea가 휠 이벤트를 소비하면서(내용이 짧아도)
   *   바깥(모달) 스크롤로 "체인"이 안 되는 브라우저/상황이 있다.
   * - 특히 이미지 삽입 후 모달 높이가 늘어나 스크롤이 필요해지면 "스크롤이 잠긴 것처럼" 느껴진다.
   *
   * 해결:
   * - Textarea가 더 이상 스크롤할 수 없는 방향(상단에서 위로 / 하단에서 아래로)일 때는
   *   모달 스크롤 컨테이너로 스크롤을 넘겨준다.
   *
   * 방어적:
   * - 필요한 경우에만 preventDefault (기존 textarea 내부 스크롤은 유지)
   */
  const handleWheelCapture = React.useCallback((e) => {
    try {
      const target = e?.target;
      if (!(target instanceof HTMLElement)) return;
      const ta = target.closest('textarea');
      if (!ta) return;

      const dy = Number(e?.deltaY || 0);
      if (!dy) return;

      // textarea가 실제로 스크롤 가능한 경우에는 그대로 두고,
      // 끝(상단/하단)에서 더 스크롤하려 할 때만 바깥으로 넘긴다.
      const atTop = ta.scrollTop <= 0;
      const atBottom = Math.ceil(ta.scrollTop + ta.clientHeight) >= Math.floor(ta.scrollHeight);
      const shouldBubble = (dy < 0 && atTop) || (dy > 0 && atBottom);
      if (!shouldBubble) return;

      const wrap = scrollWrapRef.current;
      if (!(wrap instanceof HTMLElement)) return;
      const canScrollWrap = wrap.scrollHeight > wrap.clientHeight + 1;
      if (!canScrollWrap) return;

      wrap.scrollTop += dy;
      e.preventDefault();
    } catch (_) {}
  }, []);

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
            { id: crypto?.randomUUID?.() || `${Date.now()}-a`, title: '1화', content: '', expanded: true, imageAssets: [] },
            { id: crypto?.randomUUID?.() || `${Date.now()}-b`, title: '2화', content: '', expanded: true, imageAssets: [] },
            { id: crypto?.randomUUID?.() || `${Date.now()}-c`, title: '3화', content: '', expanded: true, imageAssets: [] },
          ]);
        } else {
          setEpisodes([]);
        }
      } catch (_) {
        setExistingCount(0);
        // API 실패 시에도 기본 3개 제공
        setEpisodes([
          { id: crypto?.randomUUID?.() || `${Date.now()}-a`, title: '1화', content: '', expanded: true, imageAssets: [] },
          { id: crypto?.randomUUID?.() || `${Date.now()}-b`, title: '2화', content: '', expanded: true, imageAssets: [] },
          { id: crypto?.randomUUID?.() || `${Date.now()}-c`, title: '3화', content: '', expanded: true, imageAssets: [] },
        ]);
      } finally {
        setLoading(false);
      }
    })();
  }, [open, storyId]);

  const addEpisode = () => {
    setEpisodes((prev) => {
      const next = [...prev, { id: crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`, title: '', content: '', expanded: true, imageAssets: [] }];
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
    imageAssets: [],
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

        // ✅ 회차별 이미지(웹툰용)는 이미지 삽입 모달에서 먼저 업로드되어 URL 목록으로 저장된다.
        //    - 생성 API는 image_url(List[str])를 지원하므로, 여기서는 URL만 함께 전송한다.
        const imageUrls = (() => {
          try {
            const arr = Array.isArray(ep?.imageAssets) ? ep.imageAssets : [];
            return arr.map((x) => String(x?.url || '').trim()).filter(Boolean);
          } catch (_) {
            return [];
          }
        })();

        // 1. 회차 생성 (텍스트 + 이미지 URL들)
        await chaptersAPI.create({
          story_id: storyId,
          no,
          title,
          content: ep.content,
          ...(imageUrls.length ? { image_url: imageUrls } : {}),
        });
        
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
      <DialogContent
        className="sm:max-w-4xl max-h-[92svh] md:max-h-[85vh] bg-gray-900 text-gray-100 border border-gray-700 overflow-y-auto md:overflow-hidden flex flex-col data-[state=open]:animate-none data-[state=closed]:animate-none"
        aria-describedby="chapter-manage-desc"
      >
        <BlockingLoadingOverlay
          open={saving}
          title="회차를 저장하고 있어요"
          description={`AI 분석(요약/등장인물 보강) 때문에 시간이 걸릴 수 있어요.\n진행: ${saveProgress.total ? `${saveProgress.current}/${saveProgress.total}` : '0/0'}\n완료될 때까지 페이지를 이동하지 말아주세요.`}
        />
        <DialogHeader>
          <DialogTitle className="text-white">회차 등록</DialogTitle>
        </DialogHeader>
        <div id="chapter-manage-desc" className="sr-only">회차 등록 및 일괄 업로드 모달</div>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 px-1 pb-2">
          <div className="text-sm text-gray-400">현재 등록된 회차: {existingCount.toLocaleString()}개</div>
          <div className="flex items-center gap-2 flex-wrap justify-end">
            <Button onClick={() => setOpenImporter(true)}>txt로 일괄 업로드</Button>
            <Button variant="outline" onClick={addEpisode}>+ 회차 추가</Button>
          </div>
        </div>
        <div
          ref={scrollWrapRef}
          className="flex-1 min-h-0 overflow-visible md:overflow-auto pr-1"
          onWheelCapture={handleWheelCapture}
        >
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

                        {/* ✅ 이미지 삽입(선택) - 사진 아이콘 → 이미지 삽입 모달(미니 갤러리) */}
                        <div>
                          <div className="flex items-center justify-between gap-2">
                            <label className="block text-sm text-gray-300">
                              이미지 삽입 (선택사항)
                              <span className="text-xs text-gray-500 ml-2">
                                {(() => {
                                  try { return `${(Array.isArray(ep?.imageAssets) ? ep.imageAssets.length : 0)}개`; } catch (_) { return '0개'; }
                                })()}
                              </span>
                            </label>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-9 w-9 text-gray-300 hover:text-white hover:bg-gray-700/60"
                              onClick={() => setImgModalFor(ep.id)}
                              title="이미지 삽입"
                            >
                              <ImageIcon className="w-5 h-5" />
                            </Button>
                          </div>
                          {Array.isArray(ep?.imageAssets) && ep.imageAssets.length > 0 && (
                            <div className="mt-2 grid grid-cols-3 sm:grid-cols-4 gap-2">
                              {ep.imageAssets.map((it, ii) => {
                                const raw = String(it?.url || '').trim();
                                const src = resolveImageUrl(raw) || raw;
                                if (!src) return null;
                                return (
                                  <div key={`${it?.id || 'img'}-${ii}`} className="border border-gray-700 rounded overflow-hidden bg-gray-800">
                                    <img src={src} alt={`삽입 이미지 ${ii + 1}`} className="w-full h-24 object-cover object-top" />
                                  </div>
                                );
                              })}
                            </div>
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
        {/* ✅ 회차별 이미지 삽입 모달 (엔티티 미부착: URL만 회차에 저장) */}
        <ImageGenerateInsertModal
          open={!!imgModalFor}
          entityType={null}
          entityId={null}
          initialGallery={(() => {
            try {
              const ep = (Array.isArray(episodes) ? episodes : []).find((x) => x?.id === imgModalFor);
              const g = Array.isArray(ep?.imageAssets) ? ep.imageAssets : [];
              return g;
            } catch (_) {
              return [];
            }
          })()}
          onClose={(payload) => {
            const targetId = imgModalFor;
            setImgModalFor(null);
            if (!targetId) return;
            const nextGallery = Array.isArray(payload?.gallery) ? payload.gallery : (Array.isArray(payload) ? payload : []);
            updateEpisode(targetId, { imageAssets: Array.isArray(nextGallery) ? nextGallery : [] });
          }}
        />
      </DialogContent>
    </Dialog>
  );
};

export default ChapterManageModal;


