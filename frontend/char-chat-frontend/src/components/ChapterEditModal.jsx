import React, { useState, useEffect } from 'react';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog';
import { Textarea } from './ui/textarea';
import { Input } from './ui/input';
import { Alert, AlertDescription } from './ui/alert';
import { AlertCircle, Image as ImageIcon, X } from 'lucide-react';
import { chaptersAPI } from '../lib/api';
import BlockingLoadingOverlay from './BlockingLoadingOverlay';
import ImageGenerateInsertModal from './ImageGenerateInsertModal';
import { resolveImageUrl } from '../lib/images';

const ChapterEditModal = ({ open, onClose, chapter, onAfterSave }) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  // ✅ 회차 이미지(웹툰): URL만 저장(백엔드 스키마와 동일). 모달에서는 id/url 갤러리 형태로 관리한다.
  const [imageAssets, setImageAssets] = useState([]); // [{id,url}]
  const [imgModalOpen, setImgModalOpen] = useState(false);
  const scrollWrapRef = React.useRef(null);

  useEffect(() => {
    if (chapter && open) {
      setTitle(chapter.title || '');
      setContent(chapter.content || '');
      // image_url이 배열인지 확인
      const urls = Array.isArray(chapter.image_url) 
        ? chapter.image_url.filter(url => url)
        : (chapter.image_url ? [chapter.image_url] : []);
      // 기존 URL은 MediaAsset id를 알 수 없으므로(레거시) url:* 로 래핑해 표시만 한다.
      setImageAssets((urls || []).map((u, i) => ({ id: `url:${i}:${u}`, url: u })));
      setImgModalOpen(false);
    }
  }, [chapter, open]);

  const removeImageAt = (index) => {
    setImageAssets((prev) => (Array.isArray(prev) ? prev : []).filter((_, i) => i !== index));
  };

  /**
   * ✅ 모달 스크롤 잠김 방지(UX)
   *
   * ChapterManageModal과 동일한 이유로, Textarea 끝에서 휠을 굴릴 때
   * 바깥(모달) 스크롤로 체인되도록 보강한다.
   */
  const handleWheelCapture = React.useCallback((e) => {
    try {
      const target = e?.target;
      if (!(target instanceof HTMLElement)) return;
      const ta = target.closest('textarea');
      if (!ta) return;

      const dy = Number(e?.deltaY || 0);
      if (!dy) return;

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

  const handleSave = async () => {
    if (!content.trim()) {
      setError('내용은 필수입니다.');
      return;
    }

    setLoading(true);
    setError('');

    try {
      // 1. 회차 기본 정보 업데이트
      const updateData = {
        title: title.trim() || undefined,
        content: content.trim(),
      };

      // 2. 이미지 URL 배열 설정 (모달에서 업로드된 URL/순서 그대로 저장)
      const urls = (() => {
        try {
          const arr = Array.isArray(imageAssets) ? imageAssets : [];
          return arr.map((x) => String(x?.url || '').trim()).filter(Boolean);
        } catch (_) {
          return [];
        }
      })();
      updateData.image_url = urls.length ? urls : null;

      // 4. 회차 업데이트
      await chaptersAPI.update(chapter.id, updateData);

      if (onAfterSave) onAfterSave();
      try {
        window.dispatchEvent(new CustomEvent('toast', {
          detail: { type: 'success', message: '회차가 수정되었습니다.' }
        }));
      } catch (_) {}
      onClose?.();
    } catch (e) {
      console.error('회차 수정 실패:', e);
      setError('회차 수정에 실패했습니다.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) { if (loading) return; onClose?.(); } }}>
      <DialogContent className="sm:max-w-3xl max-h-[92svh] md:max-h-[90vh] bg-gray-900 text-gray-100 border border-gray-700 overflow-y-auto md:overflow-hidden flex flex-col data-[state=open]:animate-none data-[state=closed]:animate-none">
        <BlockingLoadingOverlay
          open={loading}
          title="회차를 저장하고 있어요"
          description={'AI 분석(요약/등장인물 보강) 때문에 시간이 걸릴 수 있어요.\n완료될 때까지 페이지를 이동하지 말아주세요.'}
        />
        <DialogHeader>
          <DialogTitle className="text-white">회차 수정</DialogTitle>
        </DialogHeader>
        
        <div
          ref={scrollWrapRef}
          className="flex-1 min-h-0 overflow-visible md:overflow-auto pr-1 space-y-4"
          onWheelCapture={handleWheelCapture}
        >
          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div>
            <label className="block text-sm text-gray-300 mb-2">
              회차 제목
            </label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="회차 제목 (선택사항)"
              className="bg-gray-800 border-gray-700 text-white"
            />
          </div>

          <div>
            <label className="block text-sm text-gray-300 mb-2">
              내용
            </label>
            <Textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={12}
              placeholder="회차 내용을 입력하세요"
              className="bg-gray-800 border-gray-700 text-white"
            />
          </div>

          <div>
            <div className="flex items-center justify-between gap-2 mb-2">
              <label className="block text-sm text-gray-300">
                이미지 삽입 (선택사항)
                <span className="text-xs text-gray-500 ml-2">
                  {`${Array.isArray(imageAssets) ? imageAssets.length : 0}개`}
                </span>
              </label>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-9 w-9 text-gray-300 hover:text-white hover:bg-gray-700/60"
                onClick={() => setImgModalOpen(true)}
                title="이미지 삽입"
              >
                <ImageIcon className="w-5 h-5" />
              </Button>
            </div>

            {Array.isArray(imageAssets) && imageAssets.length > 0 && (
              <div className="space-y-2 mb-2">
                {imageAssets.map((it, index) => {
                  const raw = String(it?.url || '').trim();
                  const src = resolveImageUrl(raw) || raw;
                  if (!src) return null;
                  return (
                    <div key={`${it?.id || 'img'}-${index}`} className="relative">
                      <img
                        src={src}
                        alt={`이미지 ${index + 1}`}
                        className="w-full max-h-96 object-contain bg-gray-800 rounded border border-gray-700"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="absolute top-2 right-2 bg-red-600 hover:bg-red-700 text-white"
                        onClick={() => removeImageAt(index)}
                        title="이미지 제거"
                      >
                        <X className="w-4 h-4" />
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="mt-2 text-xs text-gray-400">
              여러 장을 삽입하면 세로로 이어져서 이미지 회차(웹툰)처럼 표시됩니다.
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 pt-4 border-t border-gray-700">
          <Button
            variant="outline"
            onClick={onClose}
            disabled={loading}
            className="bg-gray-800 border-gray-700 text-gray-200"
          >
            취소
          </Button>
          <Button
            onClick={handleSave}
            disabled={loading || !content.trim()}
            className="bg-purple-600 hover:bg-purple-700 text-white"
          >
            {loading ? '저장 중...' : '저장'}
          </Button>
        </div>

        {/* ✅ 이미지 삽입 모달 (엔티티 미부착: URL만 회차에 저장) */}
        <ImageGenerateInsertModal
          open={imgModalOpen}
          entityType={null}
          entityId={null}
          initialGallery={Array.isArray(imageAssets) ? imageAssets : []}
          onClose={(payload) => {
            setImgModalOpen(false);
            const nextGallery = Array.isArray(payload?.gallery) ? payload.gallery : (Array.isArray(payload) ? payload : []);
            setImageAssets(Array.isArray(nextGallery) ? nextGallery : []);
          }}
        />
      </DialogContent>
    </Dialog>
  );
};

export default ChapterEditModal;

