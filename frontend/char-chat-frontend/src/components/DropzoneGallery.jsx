import React, { useCallback, useMemo, useRef, useState, useEffect } from 'react';
import { Button } from './ui/button';
import { X, Upload, Loader2, RotateCcw } from 'lucide-react';
import { resolveImageUrl } from '../lib/images';

const ACCEPTED_TYPES = ['image/jpeg','image/png','image/webp','image/gif'];
const MAX_FILES = 12;
const MAX_SIZE_MB = 10;

export default function DropzoneGallery({
  existingImages = [], // [{url, description}]
  newFiles = [], // File[] (제어 컴포넌트 외부 상태와 동기화)
  onAddFiles, // (File[]) => void
  onRemoveExisting, // (index) => void
  onRemoveNew, // (index) => void
  onReorder, // ({from, to, isNew}) => void
  onUpload, // async (File[]) => string[] (업로드 후 url 목록 반환)
}) {
  const inputRef = useRef(null);
  const [isDragging, setIsDragging] = useState(false);
  const [progressMap, setProgressMap] = useState({}); // filename -> 0..100
  const [errorMap, setErrorMap] = useState({}); // filename -> message
  const [isUploading, setIsUploading] = useState(false);

  const totalCount = (existingImages?.length || 0) + (newFiles?.length || 0);

  const validateFiles = useCallback((files) => {
    const result = [];
    for (const f of files) {
      if (!ACCEPTED_TYPES.includes(f.type)) {
        result.push({ file: f, error: '이미지 형식만 허용됩니다(jpg/png/webp/gif).' });
        continue;
      }
      const sizeMb = (f.size || 0) / (1024*1024);
      if (sizeMb > MAX_SIZE_MB) {
        result.push({ file: f, error: `파일이 너무 큽니다(${MAX_SIZE_MB}MB 이하).` });
        continue;
      }
      result.push({ file: f, error: null });
    }
    return result;
  }, []);

  const handleFiles = useCallback((files) => {
    const arr = Array.from(files || []);
    const remain = Math.max(0, MAX_FILES - totalCount);
    const selected = arr.slice(0, remain);
    const validated = validateFiles(selected);
    const ok = validated.filter(v => !v.error).map(v => v.file);
    const errs = validated.filter(v => v.error);
    if (errs.length) {
      const newMap = { ...errorMap };
      errs.forEach(v => { newMap[v.file.name] = v.error; });
      setErrorMap(newMap);
    }
    if (ok.length) onAddFiles?.(ok);
  }, [validateFiles, totalCount, onAddFiles, errorMap]);

  const onDrop = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    handleFiles(e.dataTransfer.files);
  }, [handleFiles]);

  const onDragOver = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const onDragLeave = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  // 새 파일 미리보기 URL 생성/정리
  const previewList = useMemo(() => {
    const list = [];
    for (let i = 0; i < newFiles.length; i += 1) {
      const f = newFiles[i];
      let src = '';
      let isObjectUrl = false;
      try {
        if (typeof f === 'string') {
          src = f;
        } else if (f instanceof Blob) {
          src = URL.createObjectURL(f);
          isObjectUrl = true;
        }
      } catch (_) { /* noop */ }
      list.push({
        key: typeof f === 'object' && f && 'name' in f ? f.name : `new-${i}`,
        src,
        isObjectUrl,
      });
    }
    return list;
  }, [newFiles]);

  useEffect(() => {
    return () => {
      try {
        previewList.forEach(p => { if (p.isObjectUrl && p.src) URL.revokeObjectURL(p.src); });
      } catch(_) {}
    };
  }, [previewList]);

  const startUpload = useCallback(async () => {
    if (!onUpload || newFiles.length === 0) return;
    setIsUploading(true);
    setProgressMap({});
    setErrorMap({});
    try {
      const urlList = await onUpload(newFiles, (percent) => {
        // 전체 진행률을 모든 파일에 동일 반영(단순화)
        const pm = {};
        newFiles.forEach(f => { pm[f.name] = percent; });
        setProgressMap(pm);
      });
      // 업로드 성공 시 진행률 100%
      const done = {};
      newFiles.forEach(f => { done[f.name] = 100; });
      setProgressMap(done);
    } catch (err) {
      const newMap = {};
      newFiles.forEach(f => { newMap[f.name] = '업로드 실패. 재시도하세요.'; });
      setErrorMap(newMap);
    } finally {
      setIsUploading(false);
    }
  }, [onUpload, newFiles]);

  // 파일이 추가되면 자동 업로드
  useEffect(() => {
    if (!onUpload) return;
    if (newFiles.length === 0) return;
    // 자동 업로드 트리거
    startUpload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newFiles]);

  const retryFile = useCallback((file) => {
    // 단일 파일만 재업로드: 간단히 onUpload([file]) 호출
    if (!onUpload) return;
    setIsUploading(true);
    setErrorMap(prev => ({ ...prev, [file.name]: undefined }));
    onUpload([file], (percent) => {
      setProgressMap(prev => ({ ...prev, [file.name]: percent }));
    }).then(() => {
      setProgressMap(prev => ({ ...prev, [file.name]: 100 }));
    }).catch(() => {
      setErrorMap(prev => ({ ...prev, [file.name]: '업로드 실패. 재시도하세요.' }));
    }).finally(() => setIsUploading(false));
  }, [onUpload]);

  // 간단한 정렬(드래그핸들 없이 인덱스 버튼으로 이동) — 추후 DnD로 대체 가능
  const moveItem = useCallback((from, to, isNew) => {
    if (from === to) return;
    onReorder?.({ from, to, isNew });
  }, [onReorder]);

  return (
    <div>
      <div
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        className={`border-2 border-dashed rounded-lg p-4 text-center bg-white text-black ${isDragging ? 'border-purple-500 bg-purple-500/10' : 'border-gray-300'}`}
      >
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED_TYPES.join(',')}
          multiple
          className="hidden"
          onChange={(e) => {
            handleFiles(e.target.files);
            e.target.value = '';
          }}
        />
        <div className="flex flex-col items-center gap-2">
          <Upload className="w-5 h-5 text-gray-500" />
          <div className="text-sm text-gray-800">이미지를 끌어다 놓거나 클릭하여 업로드</div>
          <div className="text-xs text-gray-600">허용: jpg, png, webp, gif • 최대 {MAX_FILES}장 • {MAX_SIZE_MB}MB/파일</div>
          <Button variant="outline" size="sm" onClick={() => inputRef.current?.click()}>파일 선택</Button>
        </div>
      </div>

      {(existingImages.length > 0 || newFiles.length > 0) && (
        <div className="mt-4 grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-3">
          {existingImages.map((img, index) => (
            <div key={`exist-${img.url}-${index}`} className="relative aspect-square group">
              <img src={resolveImageUrl(img.url)} alt="" className="w-full h-full object-cover rounded-md" />
              <button
                type="button"
                onClick={() => onRemoveExisting?.(index)}
                className="absolute top-1 right-1 bg-black/60 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}

          {previewList.map((item, index) => {
            const file = newFiles[index];
            const fileName = typeof file === 'object' && file && 'name' in file ? file.name : item.key;
            return (
            <div key={`new-${item.key}-${index}`} className="relative aspect-square group">
              {item.src ? (
                <img src={item.src} alt="" className="w-full h-full object-cover rounded-md" />
              ) : (
                <div className="w-full h-full bg-gray-200 rounded-md flex items-center justify-center text-gray-500 text-xs">미리보기를 생성할 수 없습니다</div>
              )}
              <button
                type="button"
                onClick={() => onRemoveNew?.(index)}
                className="absolute top-1 right-1 bg-black/60 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <X className="w-3 h-3" />
              </button>
              {typeof progressMap[fileName] === 'number' && (
                <div className="absolute left-1 bottom-1 text-[10px] bg-black/70 text-white px-1 py-0.5 rounded">
                  {progressMap[fileName]}%
                </div>
              )}
              {errorMap[fileName] && (
                <div className="absolute left-1 bottom-1 right-1 text-[11px] bg-red-600 text-white px-1 py-0.5 rounded flex items-center justify-between gap-2">
                  <span>{errorMap[fileName]}</span>
                  <button onClick={() => retryFile(file)} className="inline-flex items-center gap-1"><RotateCcw className="w-3 h-3" />재시도</button>
                </div>
              )}
            </div>
          )})}
        </div>
      )}

      {/* 자동 업로드로 전환: 버튼 제거 */}
    </div>
  );
}


