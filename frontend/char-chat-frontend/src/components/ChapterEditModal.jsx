import React, { useState, useEffect } from 'react';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog';
import { Textarea } from './ui/textarea';
import { Input } from './ui/input';
import { Alert, AlertDescription } from './ui/alert';
import { AlertCircle, Image as ImageIcon, X } from 'lucide-react';
import { chaptersAPI, mediaAPI } from '../lib/api';

const ChapterEditModal = ({ open, onClose, chapter, onAfterSave }) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [currentImageUrl, setCurrentImageUrl] = useState(null);

  useEffect(() => {
    if (chapter && open) {
      setTitle(chapter.title || '');
      setContent(chapter.content || '');
      setCurrentImageUrl(chapter.image_url || null);
      setImagePreview(null);
      setImageFile(null);
    }
  }, [chapter, open]);

  const handleImageChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    if (!file.type.startsWith('image/')) {
      setError('이미지 파일만 업로드 가능합니다.');
      return;
    }
    
    const preview = URL.createObjectURL(file);
    setImageFile(file);
    setImagePreview(preview);
    setError('');
  };

  const removeImage = () => {
    if (imagePreview) {
      URL.revokeObjectURL(imagePreview);
    }
    setImageFile(null);
    setImagePreview(null);
    setCurrentImageUrl(null); // 이미지 제거 시 currentImageUrl도 null로 설정
  };

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

      // 2. 이미지 업로드 (새 이미지가 있는 경우)
      if (imageFile) {
        try {
          const formData = new FormData();
          formData.append('files', imageFile);
          const uploadRes = await mediaAPI.upload(formData);
          const imageUrl = uploadRes.data?.items?.[0]?.url;
          
          if (imageUrl) {
            updateData.image_url = imageUrl;
          }
        } catch (imgErr) {
          console.error('이미지 업로드 실패:', imgErr);
          setError('이미지 업로드에 실패했습니다.');
          setLoading(false);
          return;
        }
      }

      // 3. 이미지 제거 처리 (이미지가 있었는데 제거한 경우)
      // currentImageUrl이 null이면 이미지가 제거된 것으로 간주
      if (!imageFile && !imagePreview && !currentImageUrl && chapter.image_url) {
        updateData.image_url = null;
      }

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

  const displayImage = imagePreview || currentImageUrl;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose?.(); }}>
      <DialogContent className="sm:max-w-3xl max-h-[90vh] bg-gray-900 text-gray-100 border border-gray-700 overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="text-white">회차 수정</DialogTitle>
        </DialogHeader>
        
        <div className="flex-1 overflow-auto pr-1 space-y-4">
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
              내용 <span className="text-red-400">*</span> (필수 - AI 프롬프팅용)
            </label>
            <Textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={12}
              placeholder="회차 내용을 입력하세요 (AI가 이 텍스트를 읽습니다)"
              className="bg-gray-800 border-gray-700 text-white"
            />
          </div>

          <div>
            <label className="block text-sm text-gray-300 mb-2">
              웹툰 이미지 (선택사항)
            </label>
            {displayImage ? (
              <div className="relative">
                <img
                  src={displayImage}
                  alt="웹툰 미리보기"
                  className="w-full max-h-96 object-contain bg-gray-800 rounded border border-gray-700"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute top-2 right-2 bg-red-600 hover:bg-red-700 text-white"
                  onClick={removeImage}
                  title="이미지 제거"
                >
                  <X className="w-4 h-4" />
                </Button>
                {currentImageUrl && !imagePreview && (
                  <div className="mt-2 text-xs text-gray-400">
                    현재 이미지: 기존 이미지가 유지됩니다.
                  </div>
                )}
              </div>
            ) : (
              <label className="flex items-center justify-center w-full h-32 border-2 border-dashed border-gray-700 rounded-lg cursor-pointer hover:border-gray-600 bg-gray-800">
                <div className="flex flex-col items-center gap-2">
                  <ImageIcon className="w-8 h-8 text-gray-400" />
                  <span className="text-sm text-gray-400">이미지 업로드</span>
                </div>
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleImageChange}
                  className="hidden"
                />
              </label>
            )}
            {!displayImage && (
              <div className="mt-2 text-xs text-gray-400">
                이미지를 업로드하면 웹툰 모드로 표시됩니다. 텍스트는 AI 프롬프팅용으로만 사용됩니다.
              </div>
            )}
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
      </DialogContent>
    </Dialog>
  );
};

export default ChapterEditModal;

