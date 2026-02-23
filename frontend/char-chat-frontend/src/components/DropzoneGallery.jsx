import React, { useCallback, useMemo, useRef, useState, useEffect } from 'react';
import { Button } from './ui/button';
import { X, Upload, Loader2, RotateCcw, Copy, Lock, Sparkles } from 'lucide-react';
import { resolveImageUrl } from '../lib/images';

const ACCEPTED_TYPES = ['image/jpeg','image/png','image/webp','image/gif'];
const MAX_FILES = 12;
const MAX_SIZE_MB = 10;

export default function DropzoneGallery({
  existingImages = [], // [{url, description}]
  newFiles = [], // File[] (제어 컴포넌트 외부 상태와 동기화)
  maxFiles, // number (optional) - default MAX_FILES
  gridColumns, // number (optional) - default responsive grid
  enableInfiniteScroll = false, // boolean (optional)
  pageSize = 50, // number (optional)
  registerOpenFilePicker, // (fn: (() => void) | null) => void (optional)
  getCopyText, // (url: string, index: number) => string  (optional) - code copy for inline image
  onToggleExistingPublic, // (index: number) => void (optional) - 공개/비공개 토글
  tone = 'light', // 'light' | 'dark' (optional) - 상황별 이미지 탭 UI 톤 통일용
  // ✅ 경쟁사 UX 옵션(요구사항): 상황별 이미지 탭에서만 "그리드 내부 업로드/생성 슬롯"을 사용한다.
  layoutVariant = 'with_dropzone', // 'with_dropzone' | 'grid_only'
  inlineAddSlotVariant = 'upload', // 'none' | 'upload' | 'upload_generate'
  onAddFiles, // (File[]) => void
  onRemoveExisting, // (index) => void
  onRemoveNew, // (index) => void
  onReorder, // ({from, to, isNew}) => void
  onUpload, // async (File[]) => string[] (업로드 후 url 목록 반환)
  onImageClick, // (url) => void (이미지 확대)
  onOpenGenerate, // () => void (optional) - 이미지 생성 모달 열기(경쟁사 UX)
}) {
  const inputRef = useRef(null);
  const maxFilesFinal = (() => {
    const n = Number(maxFiles);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : MAX_FILES;
  })();
  const colsFinal = (() => {
    const n = Number(gridColumns);
    return Number.isFinite(n) && n > 0 ? Math.max(1, Math.min(6, Math.floor(n))) : null;
  })();
  const [isDragging, setIsDragging] = useState(false);
  const [progressMap, setProgressMap] = useState({}); // filename -> 0..100
  const [errorMap, setErrorMap] = useState({}); // filename -> message
  const [isUploading, setIsUploading] = useState(false);
  // ✅ 이미지 코드 UX(요구사항): "복사 아이콘" 클릭 시 코드를 화면에 직접 보여준다.
  const [codePeek, setCodePeek] = useState({ key: '', text: '', copied: false });
  const codePeekTimerRef = useRef(null);

  const totalCount = (existingImages?.length || 0) + (newFiles?.length || 0);
  const openPicker = useCallback(() => {
    try { inputRef.current?.click(); } catch (_) {}
  }, []);

  useEffect(() => {
    if (typeof registerOpenFilePicker !== 'function') return;
    try { registerOpenFilePicker(openPicker); } catch (_) {}
    return () => {
      try { registerOpenFilePicker(null); } catch (_) {}
    };
  }, [registerOpenFilePicker, openPicker]);

  const dispatchToast = useCallback((type, message) => {
    try {
      window.dispatchEvent(new CustomEvent('toast', { detail: { type, message } }));
    } catch (_) {}
  }, []);

  const copyToClipboard = useCallback(async (text) => {
    const t = String(text || '').trim();
    if (!t) return false;
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(t);
        return true;
      }
    } catch (_) {}
    // fallback
    try {
      const el = document.createElement('textarea');
      el.value = t;
      el.setAttribute('readonly', '');
      el.style.position = 'fixed';
      el.style.left = '-9999px';
      el.style.top = '-9999px';
      document.body.appendChild(el);
      el.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(el);
      return !!ok;
    } catch (_) {
      return false;
    }
  }, []);

  const showCodePeek = useCallback((key, text, copied = false) => {
    /**
     * ✅ 이미지 코드 미리보기(짧은 팝오버)
     *
     * 의도/원리:
     * - 경쟁사 UX처럼 "복사 아이콘"을 누르면 코드가 바로 눈에 보여야 한다.
     * - 자동으로 닫히되, 사용자가 다시 복사할 수 있도록 유지 시간(짧게)을 둔다.
     */
    try {
      const k = String(key || '').trim();
      const t = String(text || '').trim();
      if (!k || !t) return;
      try { if (codePeekTimerRef.current) clearTimeout(codePeekTimerRef.current); } catch (_) {}
      setCodePeek({ key: k, text: t, copied: !!copied });
      codePeekTimerRef.current = setTimeout(() => {
        try { setCodePeek({ key: '', text: '', copied: false }); } catch (_) {}
      }, 4000);
    } catch (_) {}
  }, []);

  useEffect(() => {
    return () => {
      try { if (codePeekTimerRef.current) clearTimeout(codePeekTimerRef.current); } catch (_) {}
    };
  }, []);

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
    // 현재 업로드 중이면 무시
    if (isUploading) return;

    const remain = Math.max(0, maxFilesFinal - totalCount);
    const selected = arr.slice(0, remain);
    if (selected.length === 0) return; // 추가할 파일 없음

    const validated = validateFiles(selected);
    const ok = validated.filter(v => !v.error).map(v => v.file);
    const errs = validated.filter(v => v.error);
    if (errs.length) {
      const newMap = { ...errorMap };
      errs.forEach(v => { newMap[v.file.name] = v.error; });
      setErrorMap(newMap);
    }
    if (ok.length) onAddFiles?.(ok);
  }, [validateFiles, totalCount, onAddFiles, errorMap, isUploading, maxFilesFinal]);

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

  /**
   * ✅ 무한 스크롤(옵션)
   *
   * 의도/원리:
   * - 이미지가 많아질 때 DOM 렌더 비용을 줄이고, "50개씩" 자연스럽게 더 보이게 한다.
   * - 실제 업로드/저장은 기존 로직(SSOT)을 그대로 사용한다.
   */
  const mergedItems = useMemo(() => {
    const base = [];
    (Array.isArray(existingImages) ? existingImages : []).forEach((img, idx) => {
      base.push({ kind: 'exist', img, idx });
    });
    (Array.isArray(previewList) ? previewList : []).forEach((p, idx) => {
      base.push({ kind: 'new', p, idx });
    });
    return base;
  }, [existingImages, previewList]);

  const [visibleCount, setVisibleCount] = useState(() => {
    if (!enableInfiniteScroll) return mergedItems.length;
    const ps = Number(pageSize);
    const n = Number.isFinite(ps) && ps > 0 ? Math.floor(ps) : 50;
    return Math.min(mergedItems.length, n);
  });

  useEffect(() => {
    if (!enableInfiniteScroll) {
      setVisibleCount(mergedItems.length);
      return;
    }
    const ps = Number(pageSize);
    const n = Number.isFinite(ps) && ps > 0 ? Math.floor(ps) : 50;
    setVisibleCount(Math.min(mergedItems.length, n));
  }, [enableInfiniteScroll, pageSize, mergedItems.length]);

  const sentinelRef = useRef(null);
  useEffect(() => {
    if (!enableInfiniteScroll) return;
    const el = sentinelRef.current;
    if (!el) return;
    if (visibleCount >= mergedItems.length) return;
    if (typeof IntersectionObserver === 'undefined') return;

    const ps = Number(pageSize);
    const step = Number.isFinite(ps) && ps > 0 ? Math.floor(ps) : 50;
    const obs = new IntersectionObserver(
      (entries) => {
        try {
          const hit = entries && entries[0] && entries[0].isIntersecting;
          if (!hit) return;
          setVisibleCount((prev) => Math.min(mergedItems.length, (Number(prev) || 0) + step));
        } catch (_) {}
      },
      { root: null, rootMargin: '600px 0px', threshold: 0.01 }
    );
    try { obs.observe(el); } catch (_) {}
    return () => { try { obs.disconnect(); } catch (_) {} };
  }, [enableInfiniteScroll, pageSize, mergedItems.length, visibleCount]);

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

  // HTML5 Drag & Drop state
  const [draggingIndex, setDraggingIndex] = useState(null);
  const [dragOverIndex, setDragOverIndex] = useState(null);

  // 정렬 핸들러
  const handleDragStart = (e, index) => {
    setDraggingIndex(index);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', index);
    // 잔상 이미지 투명도 조절 등은 기본 브라우저 동작 사용
  };

  const handleDragEnter = (e, index) => {
    e.preventDefault();
    if (draggingIndex === null || draggingIndex === index) return;
    setDragOverIndex(index);
  };

  const handleDragEnd = () => {
    setDraggingIndex(null);
    setDragOverIndex(null);
  };

  const handleDropItem = (e, dropIndex) => {
    e.preventDefault();
    if (draggingIndex === null) return;
    const dragIndex = draggingIndex;
    setDraggingIndex(null);
    setDragOverIndex(null);
    if (dragIndex === dropIndex) return;

    // existingImages와 newFiles를 분리해서 처리하지 않고, 
    // 현재 UI는 existingImages -> newFiles 순서로 나열된다고 가정하고 전체 인덱스 기준으로 처리
    // 하지만 CreateCharacterPage의 onReorder는 {from, to, isNew}를 받도록 되어 있음
    // 따라서 여기서는 'existingImages' 내부끼리의 정렬만 우선 지원하거나,
    // 전체 통합 정렬을 지원하려면 상위 컴포넌트 로직 수정이 필요함.
    // 현재 요구사항(순서 바꾸기)을 위해 existingImages 내부 정렬만 지원 (업로드 전 파일은 보통 정렬 필요성이 낮음)
    
    // newFiles가 있으면 정렬이 복잡해지므로, 업로드된 이미지들끼리만 정렬 지원
    if (dragIndex < existingImages.length && dropIndex < existingImages.length) {
        onReorder?.({ from: dragIndex, to: dropIndex, isNew: false });
    }
  };

  return (
    <div>
      {/* ✅ 업로드 input (공용) */}
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

      {/* ✅ 기본형(기존 유지): 안내/드롭존 박스 */}
      {layoutVariant !== 'grid_only' && (
        <div
          onDrop={onDrop}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          className={[
            'border-2 border-dashed rounded-lg p-4 text-center',
            tone === 'dark'
              ? 'bg-gray-950/30 text-gray-100'
              : 'bg-white text-black',
            isDragging
              ? 'border-purple-500 bg-purple-500/10'
              : (tone === 'dark' ? 'border-gray-700' : 'border-gray-300'),
          ].join(' ')}
        >
          <div className="flex flex-col items-center gap-2">
            {isUploading ? (
              <Loader2 className={['w-6 h-6 animate-spin', tone === 'dark' ? 'text-purple-400' : 'text-purple-600'].join(' ')} />
            ) : (
              <Upload className={['w-5 h-5', tone === 'dark' ? 'text-gray-400' : 'text-gray-500'].join(' ')} />
            )}
            <div className={['text-sm', tone === 'dark' ? 'text-gray-200' : 'text-gray-800'].join(' ')}>
              {isUploading ? '업로드 중...' : '이미지를 끌어다 놓거나 클릭하여 업로드'}
            </div>
            <div className={['text-xs', tone === 'dark' ? 'text-gray-400' : 'text-gray-600'].join(' ')}>
              허용: jpg, png, webp, gif • 최대 {maxFilesFinal}장 • {MAX_SIZE_MB}MB/파일
            </div>
            <Button
              variant="outline"
              size="sm"
              type="button"
              onClick={(e) => {
                // ✅ 방어: <form> 내부에서 기본 submit 방지
                try { e.preventDefault(); } catch (_) {}
                try { e.stopPropagation(); } catch (_) {}
                openPicker();
              }}
              disabled={isUploading}
              className={tone === 'dark' ? 'border-gray-700 bg-gray-900/20 text-gray-100 hover:bg-gray-900/40' : ''}
            >
              {isUploading ? '처리 중...' : '파일 선택'}
            </Button>
          </div>
        </div>
      )}

      {(mergedItems.length > 0 || (totalCount < maxFilesFinal && inlineAddSlotVariant !== 'none') || layoutVariant === 'grid_only') && (
        <div
          onDrop={onDrop}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          className={[
            'mt-4 grid gap-3',
            (colsFinal ? '' : 'grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6'),
            // 드래그 중에는 아주 약하게 하이라이트(박스 없이도 드롭 가능 인지)
            isDragging ? 'ring-2 ring-purple-500/50 ring-offset-2 ring-offset-black/0 rounded-md p-1' : '',
          ].join(' ')}
          style={colsFinal ? { gridTemplateColumns: `repeat(${colsFinal}, minmax(0, 1fr))` } : undefined}
        >
          {(enableInfiniteScroll ? mergedItems.slice(0, visibleCount) : mergedItems).map((it) => {
            if (it.kind === 'exist') {
              const img = it.img || {};
              const index = Number(it.idx) || 0;
              const codeKey = `exist_${index}_${String(img?.url || '').slice(0, 48)}`;
              return (
                <div
                  key={`exist-${img.url}-${index}`}
                  className={`relative aspect-square group transition-transform ${draggingIndex === index ? 'opacity-50 scale-95' : ''} ${dragOverIndex === index ? 'ring-2 ring-purple-500 ring-offset-2 scale-105' : ''}`}
                  draggable
                  onDragStart={(e) => handleDragStart(e, index)}
                  onDragEnter={(e) => handleDragEnter(e, index)}
                  onDragOver={(e) => e.preventDefault()} // 필수
                  onDragEnd={handleDragEnd}
                  onDrop={(e) => handleDropItem(e, index)}
                >
                  <img
                    src={resolveImageUrl(img.url)}
                    alt=""
                    className="w-full h-full object-cover rounded-md cursor-grab active:cursor-grabbing"
                    loading="lazy"
                    decoding="async"
                    onClick={(e) => {
                      if (!draggingIndex && onImageClick) {
                        onImageClick(resolveImageUrl(img.url));
                      }
                    }}
                  />
                  {/* ✅ 인라인 이미지 코드 복사(항상 노출): 회색 배경 + 흰색 아이콘 */}
                  {typeof getCopyText === 'function' && (
                    <button
                      type="button"
                      onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
                      onClick={async (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        try {
                          const raw = getCopyText(img?.url, index);
                          // ✅ 1) 먼저 화면에 코드 표시(체감)
                          showCodePeek(codeKey, raw, false);
                          // ✅ 2) 클립보드 복사
                          const ok = await copyToClipboard(raw);
                          if (ok) {
                            showCodePeek(codeKey, raw, true);
                            dispatchToast('success', '이미지 코드가 복사되었습니다.');
                          }
                          else dispatchToast('error', '코드 복사에 실패했습니다.');
                        } catch (_) {
                          dispatchToast('error', '코드 복사에 실패했습니다.');
                        }
                      }}
                      className="absolute top-1 right-1 z-20 bg-gray-700/70 hover:bg-gray-700 text-white rounded-md p-1"
                      title="이미지 코드 보기/복사"
                      aria-label="이미지 코드 보기/복사"
                    >
                      <Copy className="w-4 h-4" />
                    </button>
                  )}
                  {/* ✅ 코드 팝오버(복사 아이콘 클릭 시 노출) */}
                  {(codePeek?.key === codeKey && String(codePeek?.text || '').trim()) ? (
                    <div
                      className="absolute top-9 right-1 z-30 rounded-md border border-white/10 bg-black/80 px-2 py-1.5 backdrop-blur"
                      onMouseDown={(e) => { try { e.preventDefault(); e.stopPropagation(); } catch (_) {} }}
                      onClick={(e) => { try { e.preventDefault(); e.stopPropagation(); } catch (_) {} }}
                      role="dialog"
                      aria-label="이미지 코드"
                    >
                      <div className="flex items-center gap-2">
                        <div className="text-[11px] font-mono text-gray-100 select-all">
                          {String(codePeek.text || '')}
                        </div>
                        <button
                          type="button"
                          className={[
                            'h-6 px-2 rounded bg-gray-700/70 hover:bg-gray-700 text-[11px] font-semibold text-white',
                            (codePeek?.copied ? 'opacity-80' : ''),
                          ].join(' ')}
                          onMouseDown={(e) => { try { e.preventDefault(); e.stopPropagation(); } catch (_) {} }}
                          onClick={async (e) => {
                            try { e.preventDefault(); e.stopPropagation(); } catch (_) {}
                            try {
                              const ok = await copyToClipboard(String(codePeek.text || ''));
                              if (ok) {
                                showCodePeek(codeKey, String(codePeek.text || ''), true);
                                dispatchToast('success', '이미지 코드가 복사되었습니다.');
                              } else {
                                dispatchToast('error', '코드 복사에 실패했습니다.');
                              }
                            } catch (_) {
                              dispatchToast('error', '코드 복사에 실패했습니다.');
                            }
                          }}
                          aria-label="코드 복사"
                          title="코드 복사"
                        >
                          {codePeek?.copied ? '복사됨' : '복사'}
                        </button>
                      </div>
                    </div>
                  ) : null}

                  {/* ✅ 공개/비공개 배지(기본 공개): 항상 노출, 클릭으로 토글 */}
                  {typeof onToggleExistingPublic === 'function' && (
                    <button
                      type="button"
                      onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        try { onToggleExistingPublic(index); } catch (_) {}
                      }}
                      className={[
                        'absolute bottom-1 left-1 z-20 inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-semibold',
                        (img?.is_public === false)
                          ? 'bg-rose-600/90 hover:bg-rose-600 text-white'
                          : 'bg-gray-700/75 hover:bg-gray-700 text-white',
                      ].join(' ')}
                      title={(img?.is_public === false) ? '공개로 전환' : '비공개로 전환'}
                      aria-label={(img?.is_public === false) ? '공개로 전환' : '비공개로 전환'}
                    >
                      <Lock className="w-3 h-3" />
                      {(img?.is_public === false) ? '공개' : '비공개'}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => onRemoveExisting?.(index)}
                    className="absolute top-1 left-1 bg-black/60 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity z-10"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              );
            }

            // new
            const item = it.p || {};
            const index = Number(it.idx) || 0;
            const file = newFiles[index];
            const fileName = typeof file === 'object' && file && 'name' in file ? file.name : item.key;
            return (
              <div key={`new-${item.key}-${index}`} className="relative aspect-square group">
                {item.src ? (
                  <img src={item.src} alt="" className="w-full h-full object-cover rounded-md opacity-70" loading="lazy" decoding="async" />
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
            );
          })}

          {/* ✅ 경쟁사 UX: 그리드 내부 "+ 빈 슬롯"(다음 자리) */}
          {(() => {
            try {
              const canAddMore = totalCount < maxFilesFinal;
              if (!canAddMore) return null;
              if (inlineAddSlotVariant === 'none') return null;
              const label = `${totalCount}/${maxFilesFinal}`;
              // upload + generate (상황별 이미지 탭 전용)
              if (inlineAddSlotVariant === 'upload_generate') {
                return (
                  <div
                    className={[
                      'relative aspect-square rounded-md border border-white/10',
                      tone === 'dark'
                        ? 'bg-gray-900/30 text-gray-200'
                        : 'bg-gray-100 text-gray-700 border-gray-300',
                      'transition-colors flex items-center justify-center',
                      isUploading ? 'opacity-60 cursor-wait' : '',
                    ].join(' ')}
                    onMouseDown={(e) => { try { e.preventDefault(); e.stopPropagation(); } catch (_) {} }}
                    onClick={(e) => { try { e.preventDefault(); e.stopPropagation(); } catch (_) {} }}
                    role="group"
                    aria-label="이미지 추가"
                  >
                    <div className="flex flex-col items-center justify-center gap-2">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          disabled={isUploading}
                          onMouseDown={(e) => { try { e.preventDefault(); e.stopPropagation(); } catch (_) {} }}
                          onClick={(e) => {
                            try { e.preventDefault(); e.stopPropagation(); } catch (_) {}
                            openPicker();
                          }}
                          className={[
                            'h-11 w-11 rounded-full flex items-center justify-center border transition-colors',
                            tone === 'dark'
                              ? 'bg-black/20 border-white/10 hover:bg-black/30 text-gray-100'
                              : 'bg-white border-gray-300 hover:bg-gray-50 text-gray-700',
                            isUploading ? 'opacity-70 cursor-wait' : 'cursor-pointer',
                          ].join(' ')}
                          title="업로드"
                          aria-label="업로드"
                        >
                          <Upload className="h-5 w-5" aria-hidden="true" />
                        </button>

                        <button
                          type="button"
                          disabled={isUploading || typeof onOpenGenerate !== 'function'}
                          onMouseDown={(e) => { try { e.preventDefault(); e.stopPropagation(); } catch (_) {} }}
                          onClick={(e) => {
                            try { e.preventDefault(); e.stopPropagation(); } catch (_) {}
                            try { onOpenGenerate?.(); } catch (_) {}
                          }}
                          className={[
                            'h-11 w-11 rounded-full flex items-center justify-center border transition-colors',
                            tone === 'dark'
                              ? 'bg-purple-900/25 border-purple-500/30 hover:bg-purple-900/35 text-purple-100'
                              : 'bg-white border-gray-300 hover:bg-gray-50 text-purple-700',
                            (typeof onOpenGenerate !== 'function') ? 'opacity-40 cursor-not-allowed' : '',
                            isUploading ? 'opacity-70 cursor-wait' : '',
                          ].join(' ')}
                          title={(typeof onOpenGenerate === 'function') ? '이미지 생성' : '이미지 생성(지원 안됨)'}
                          aria-label="이미지 생성"
                        >
                          <Sparkles className="h-5 w-5" aria-hidden="true" />
                        </button>
                      </div>
                      <div className={['text-xs font-semibold', tone === 'dark' ? 'text-gray-400' : 'text-gray-500'].join(' ')}>
                        {label}
                      </div>
                    </div>
                  </div>
                );
              }
              // upload only
              if (inlineAddSlotVariant === 'upload') {
                return (
                  <button
                    type="button"
                    className={[
                      'relative aspect-square rounded-md border border-white/10',
                      tone === 'dark'
                        ? 'bg-gray-900/30 hover:bg-gray-900/45 text-gray-200'
                        : 'bg-gray-100 hover:bg-gray-200 text-gray-700 border-gray-300',
                      'transition-colors flex items-center justify-center',
                      isUploading ? 'opacity-60 cursor-wait' : 'cursor-pointer',
                    ].join(' ')}
                    disabled={isUploading}
                    onMouseDown={(e) => { try { e.preventDefault(); e.stopPropagation(); } catch (_) {} }}
                    onClick={(e) => {
                      try { e.preventDefault(); e.stopPropagation(); } catch (_) {}
                      openPicker();
                    }}
                    title="이미지 추가"
                    aria-label="이미지 추가"
                  >
                    <div className="flex flex-col items-center justify-center gap-2">
                      <div
                        className={[
                          'h-11 w-11 rounded-full flex items-center justify-center border transition-colors',
                          tone === 'dark'
                            ? 'bg-black/20 border-white/10 hover:bg-black/30 text-gray-100'
                            : 'bg-white border-gray-300 hover:bg-gray-50 text-gray-700',
                        ].join(' ')}
                      >
                        <Upload className="h-5 w-5" aria-hidden="true" />
                      </div>
                      <div className={['text-xs font-semibold', tone === 'dark' ? 'text-gray-400' : 'text-gray-500'].join(' ')}>
                        {label}
                      </div>
                    </div>
                  </button>
                );
              }
              return null;
            } catch (_) {
              return null;
            }
          })()}

          {/* sentinel (infinite) */}
          {enableInfiniteScroll && (visibleCount < mergedItems.length) ? (
            <div ref={sentinelRef} className="col-span-full h-8" />
          ) : null}
        </div>
      )}

      {/* 자동 업로드로 전환: 버튼 제거 */}
    </div>
  );
}


