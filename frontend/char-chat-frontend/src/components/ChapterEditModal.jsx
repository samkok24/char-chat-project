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
  const [imageFiles, setImageFiles] = useState([]);
  const [imagePreviews, setImagePreviews] = useState([]);
  const [currentImageUrls, setCurrentImageUrls] = useState([]);

  useEffect(() => {
    if (chapter && open) {
      setTitle(chapter.title || '');
      setContent(chapter.content || '');
      // image_url이 배열인지 확인
      const urls = Array.isArray(chapter.image_url) 
        ? chapter.image_url.filter(url => url)
        : (chapter.image_url ? [chapter.image_url] : []);
      setCurrentImageUrls(urls);
      setImagePreviews([]);
      setImageFiles([]);
    }
  }, [chapter, open]);

  const handleImageChange = (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    
    const imageFiles = files.filter(file => file.type.startsWith('image/'));
    if (imageFiles.length !== files.length) {
      setError('이미지 파일만 업로드 가능합니다.');
      return;
    }
    
    const previews = imageFiles.map(file => URL.createObjectURL(file));
    setImageFiles(prev => [...prev, ...imageFiles]);
    setImagePreviews(prev => [...prev, ...previews]);
    setError('');
  };

  const removeImage = (index, isPreview) => {
    if (isPreview) {
      // 새로 추가한 이미지 제거
      URL.revokeObjectURL(imagePreviews[index]);
      setImagePreviews(prev => prev.filter((_, i) => i !== index));
      setImageFiles(prev => prev.filter((_, i) => i !== index));
    } else {
      // 기존 이미지 제거
      setCurrentImageUrls(prev => prev.filter((_, i) => i !== index));
    }
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
      const allImageUrls = [...currentImageUrls];
      
      if (imageFiles.length > 0) {
        try {
          const formData = new FormData();
          imageFiles.forEach(file => {
            formData.append('files', file);
          });
          const uploadRes = await mediaAPI.upload(formData);
          const uploadedUrls = uploadRes.data?.items?.map(item => item.url).filter(Boolean) || [];
          allImageUrls.push(...uploadedUrls);
        } catch (imgErr) {
          console.error('이미지 업로드 실패:', imgErr);
          setError('이미지 업로드에 실패했습니다.');
          setLoading(false);
          return;
        }
      }

      // 3. 이미지 URL 배열 설정
      if (allImageUrls.length > 0) {
        updateData.image_url = allImageUrls;
      } else {
        // 모든 이미지가 제거된 경우
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
            <label className="block text-sm text-gray-300 mb-2">
              이미지 삽입 (선택사항) - 여러 장 업로드 가능
            </label>
            
            {/* 기존 이미지들 */}
            {currentImageUrls.length > 0 && (
              <div className="space-y-2 mb-4">
                {currentImageUrls.map((url, index) => (
                  <div key={`current-${index}`} className="relative">
                    <img
                      src={url}
                      alt={`기존 이미지 ${index + 1}`}
                      className="w-full max-h-96 object-contain bg-gray-800 rounded border border-gray-700"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="absolute top-2 right-2 bg-red-600 hover:bg-red-700 text-white"
                      onClick={() => removeImage(index, false)}
                      title="이미지 제거"
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
            
            {/* 새로 추가한 이미지 미리보기 */}
            {imagePreviews.length > 0 && (
              <div className="space-y-2 mb-4">
                {imagePreviews.map((preview, index) => (
                  <div key={`preview-${index}`} className="relative">
                    <img
                      src={preview}
                      alt={`새 이미지 ${index + 1}`}
                      className="w-full max-h-96 object-contain bg-gray-800 rounded border border-gray-700"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="absolute top-2 right-2 bg-red-600 hover:bg-red-700 text-white"
                      onClick={() => removeImage(index, true)}
                      title="이미지 제거"
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
            
            {/* 이미지 업로드 버튼 */}
            <label className="flex items-center justify-center w-full h-32 border-2 border-dashed border-gray-700 rounded-lg cursor-pointer hover:border-gray-600 bg-gray-800">
              <div className="flex flex-col items-center gap-2">
                <ImageIcon className="w-8 h-8 text-gray-400" />
                <span className="text-sm text-gray-400">이미지 추가 (여러 개 선택 가능)</span>
              </div>
              <input
                type="file"
                accept="image/*"
                multiple
                onChange={handleImageChange}
                className="hidden"
              />
            </label>
            
            <div className="mt-2 text-xs text-gray-400">
              여러 장을 업로드하면 세로로 이어져서 이미지 회차처럼 표시됩니다.
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
      </DialogContent>
    </Dialog>
  );
};

export default ChapterEditModal;

