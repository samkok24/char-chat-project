import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog';
import { Button } from './ui/button';
import { mediaAPI, charactersAPI, storiesAPI } from '../lib/api';
import { Loader2, Trash2, X } from 'lucide-react';

const ImageGenerateInsertModal = ({ open, onClose, entityType, entityId, initialGallery }) => {
  // 단일 갤러리: 업로드/생성 결과를 모두 여기에 누적
  const inputRef = React.useRef(null);
  const [busy, setBusy] = React.useState(false);
  // 현재 갤러리(이미 삽입된 자산) 상태
  const [gallery, setGallery] = React.useState([]);
  const [galleryBusy, setGalleryBusy] = React.useState(false);
  const dragIndexRef = React.useRef(null);
  const saveTimerRef = React.useRef(null);
  const hasLoadedRef = React.useRef(false);
  // 생성 탭 상태
  const [genProvider] = React.useState('gemini'); // 고정: gemini
  const [genModel, setGenModel] = React.useState('gemini-2.5-flash-image-preview');
  // 기본값: 상세 페이지 메인 컨테이너(세로 3:4)에 맞춤
  const [genRatio, setGenRatio] = React.useState('3:4');
  const [genCount, setGenCount] = React.useState(1);
  const [genPrompt, setGenPrompt] = React.useState('');
  const lastParamsRef = React.useRef(null);
  // 남은 시간 표시
  const [etaMs, setEtaMs] = React.useState(0);
  const etaTimerRef = React.useRef(null);
  const abortRef = React.useRef(null);

  // 크롭 모달 상태
  const [cropOpen, setCropOpen] = React.useState(false);
  const [cropIndex, setCropIndex] = React.useState(-1);
  const [cropLoading, setCropLoading] = React.useState(false);
  const cropImgRef = React.useRef(null);
  const cropWrapRef = React.useRef(null);
  const cropImgBoxRef = React.useRef({ x: 0, y: 0, w: 0, h: 0 }); // 화면에 표시된 이미지 영역
  const cropInitializedRef = React.useRef(false); // 크롭 영역 초기화 플래그
  const [cropRect, setCropRect] = React.useState({ x: 0, y: 0, w: 100, h: 100 });
  const [cropDragging, setCropDragging] = React.useState(false);
  const [cropResizing, setCropResizing] = React.useState(null); // 'nw' | 'ne' | 'sw' | 'se' | null
  const cropStartRef = React.useRef({ x: 0, y: 0, rect: { x: 0, y: 0, w: 0, h: 0 } });

  const clearEta = () => {
    if (etaTimerRef.current) {
      clearInterval(etaTimerRef.current);
      etaTimerRef.current = null;
    }
    setEtaMs(0);
  };

  const startEta = (provider, count) => {
    // 간단한 기준치: OpenAI 90s, Gemini 60s 기준
    const base = provider === 'gemini' ? 60000 : 90000;
    const total = base * Math.max(1, Number(count) || 1);
    setEtaMs(total);
    if (etaTimerRef.current) clearInterval(etaTimerRef.current);
    etaTimerRef.current = setInterval(() => {
      setEtaMs((prev) => {
        const next = Math.max(0, prev - 1000);
        if (next === 0) {
          clearEta();
        }
        return next;
      });
    }, 1000);
  };

  const onPick = () => inputRef.current?.click();
  const canonUrl = (u) => {
    try {
      const q = String(u || '');
      const i = q.indexOf('?');
      return i >= 0 ? q.slice(0, i) : q;
    } catch (_) { return String(u || ''); }
  };
  const dedupAssets = (arr) => {
    const seen = new Set();
    const out = [];
    for (const a of arr) {
      const u = canonUrl(a?.url);
      const key = u || (a?.id ? String(a.id) : '');
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(a);
    }
    return out;
  };
  const onFiles = async (e) => {
    const selected = Array.from(e.target.files || []);
    if (!selected.length) return;
    setBusy(true);
    try {
      const res = await mediaAPI.upload(selected);
      const items = res.data?.items || [];
      setGallery((prev) => dedupAssets([...prev, ...items]));
    } catch (_) {
      // noop
    } finally { setBusy(false); }
  };

  const confirmAttach = async () => {
    if (!gallery.length) { onClose?.(); return; }
    setBusy(true);
    try {
      const focusUrl = gallery[0]?.url || '';
      const realIds = gallery.filter(s => !String(s.id).startsWith('url:')).map(s => s.id);
      // 엔티티가 있을 때만 서버에 첨부
      if (entityType && entityId && realIds.length) {
        await mediaAPI.attach({ entityType, entityId, assetIds: realIds, asPrimary: true });
        try { window.dispatchEvent(new CustomEvent('media:updated', { detail: { entityType, entityId } })); } catch(_) {}
        try { window.dispatchEvent(new CustomEvent('toast', { detail: { type: 'success', message: `삽입 완료 (${gallery.length}개)` } })); } catch(_) {}
        onClose?.({ attached: true, focusUrl, gallery: gallery.map(g => ({ id: g.id, url: g.url })) });
      } else {
        // 생성/업로드만 하고 표지로만 사용할 때(생성 페이지 등)
        try { window.dispatchEvent(new CustomEvent('toast', { detail: { type: 'success', message: '이미지 선택 완료' } })); } catch(_) {}
        onClose?.({ attached: false, focusUrl, gallery: gallery.map(g => ({ id: g.id, url: g.url })) });
      }
    } finally { setBusy(false); }
  };

  const deleteOne = async (id) => {
    setBusy(true);
    try { await mediaAPI.deleteAssets([id]); setGallery(prev => prev.filter(s => s.id !== id)); }
    catch(_) {}
    finally { setBusy(false); }
  };

  const loadGallery = async () => {
    if (!entityType || !entityId) return;
    try {
      setGalleryBusy(true);
      const res = await mediaAPI.listAssets({ entityType, entityId, presign: false, expiresIn: 300 });
      const items = Array.isArray(res.data?.items) ? res.data.items : (Array.isArray(res.data) ? res.data : []);
      if (Array.isArray(items) && items.length > 0) {
        setGallery(dedupAssets(items));
      } else {
        // R2 연동 이전(레거시) 자산 표시: 엔티티 상세에서 avatar/cover 및 image_descriptions를 합성해 보여줌
        try {
          if (entityType === 'character') {
            const r = await charactersAPI.getCharacter(entityId);
            const d = r?.data || {};
            const urls = [d.avatar_url, ...(Array.isArray(d.image_descriptions) ? d.image_descriptions.map(x => x.url) : [])].filter(Boolean).map(u => `${u}${u.includes('?') ? '&' : '?'}v=${Date.now()}`);
            const legacy = urls.map((u, i) => ({ id: `url:${i}:${u}`, url: u, is_primary: i === 0 }));
            setGallery(legacy);
          } else if (entityType === 'story') {
            const r = await storiesAPI.getStory(entityId);
            const d = r?.data || {};
            const urls = [d.cover_url].filter(Boolean).map(u => `${u}${u.includes('?') ? '&' : '?'}v=${Date.now()}`);
            const legacy = urls.map((u, i) => ({ id: `url:${i}:${u}`, url: u, is_primary: i === 0 }));
            setGallery(legacy);
          } else {
            setGallery([]);
          }
        } catch (_) {
          setGallery([]);
        }
      }
    } catch (_) {
      setGallery([]);
    } finally { setGalleryBusy(false); }
  };

  React.useEffect(() => {
    if (!open) { hasLoadedRef.current = false; return; }
    if (open && !hasLoadedRef.current) {
      hasLoadedRef.current = true;
      if (entityType && entityId) {
        loadGallery();
      } else {
        // 엔티티가 없는 생성 페이지 등: 초기 갤러리 주입
        try {
          const seed = Array.isArray(initialGallery) ? initialGallery : [];
          if (seed.length) setGallery(dedupAssets(seed));
        } catch (_) { setGallery([]); }
      }
    }
  }, [open, entityType, entityId, initialGallery]);

  // 대표 이미지 비율에 맞춰 생성 비율 기본값을 자동으로 선택
  // 기본값은 3:4 유지. 이전 대표 이미지 비율로 자동 조정하지 않음.

  const ratioToNumber = (key) => {
    switch (key) {
      case '1:1': return 1;
      case '3:4': return 3/4;
      case '4:3': return 4/3;
      case '16:9': return 16/9;
      case '9:16': return 9/16;
      default: return 1;
    }
  };

  const openCropFor = (index) => {
    if (index == null || index < 0 || index >= gallery.length) return;
    setCropIndex(index);
    setCropOpen(true);
    cropInitializedRef.current = false; // 크롭 모달 열 때 초기화 플래그 리셋
    // 초기 크롭 사각형 계산은 이미지 onLoad에서 수행
  };

  const onCropImgLoad = () => {
    try {
      const img = cropImgRef.current;
      const wrap = cropWrapRef.current;
      if (!img || !wrap) return;
      
      const wrapW = wrap.clientWidth;
      const wrapH = wrap.clientHeight;
      const naturalW = img.naturalWidth || 1;
      const naturalH = img.naturalHeight || 1;
      // object-contain으로 표시된 실제 이미지 영역 계산
      const scale = Math.min(wrapW / naturalW, wrapH / naturalH);
      const dispW = Math.round(naturalW * scale);
      const dispH = Math.round(naturalH * scale);
      const dispX = Math.round((wrapW - dispW) / 2);
      const dispY = Math.round((wrapH - dispH) / 2);
      cropImgBoxRef.current = { x: dispX, y: dispY, w: dispW, h: dispH };

      // 최초 1회만 크롭 영역 초기화
      if (!cropInitializedRef.current) {
        // 주어진 비율로 표시 이미지 영역을 가득 채우는 최대 사각형 계산
        const r = ratioToNumber(genRatio);
        let w = dispW;
        let h = Math.round(w / r);
        if (h > dispH) {
          h = dispH;
          w = Math.round(h * r);
        }
        const x = Math.round(dispX + (dispW - w) / 2);
        const y = Math.round(dispY + (dispH - h) / 2);
        setCropRect({ x, y, w, h });
        cropInitializedRef.current = true; // 초기화 완료 표시
      }
    } catch (_) {}
  };

  const onCropMouseDown = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setCropDragging(true);
    cropStartRef.current = { 
      x: e.clientX - cropRect.x, 
      y: e.clientY - cropRect.y,
      rect: { ...cropRect }
    };
  };

  const onResizeHandleMouseDown = (e, corner) => {
    e.preventDefault();
    e.stopPropagation();
    setCropResizing(corner);
    cropStartRef.current = { 
      x: e.clientX, 
      y: e.clientY,
      rect: { ...cropRect }
    };
  };

  const onCropMouseMove = (e) => {
    const box = cropImgBoxRef.current;
    const wrap = cropWrapRef.current;
    if (!wrap || !box) return;

    // 리사이징 중
    if (cropResizing) {
      const dx = e.clientX - cropStartRef.current.x;
      const dy = e.clientY - cropStartRef.current.y;
      const startRect = cropStartRef.current.rect;
      const r = ratioToNumber(genRatio);
      
      let newRect = { ...startRect };

      if (cropResizing === 'se') {
        // 우하단: 너비/높이 증가
        let newW = Math.max(30, startRect.w + dx);
        let newH = Math.round(newW / r);
        // 경계 체크
        if (startRect.x + newW > box.x + box.w) newW = box.x + box.w - startRect.x;
        if (startRect.y + newH > box.y + box.h) {
          newH = box.y + box.h - startRect.y;
          newW = Math.round(newH * r);
        }
        newRect = { x: startRect.x, y: startRect.y, w: newW, h: newH };
      } else if (cropResizing === 'sw') {
        // 좌하단: x 이동, 너비 변경, 높이 증가
        let newX = Math.max(box.x, Math.min(startRect.x + dx, startRect.x + startRect.w - 30));
        let newW = startRect.x + startRect.w - newX;
        let newH = Math.round(newW / r);
        if (startRect.y + newH > box.y + box.h) {
          newH = box.y + box.h - startRect.y;
          newW = Math.round(newH * r);
          newX = startRect.x + startRect.w - newW;
        }
        newRect = { x: newX, y: startRect.y, w: newW, h: newH };
      } else if (cropResizing === 'ne') {
        // 우상단: y 이동, 높이 변경, 너비 증가
        let newY = Math.max(box.y, Math.min(startRect.y + dy, startRect.y + startRect.h - 30));
        let newH = startRect.y + startRect.h - newY;
        let newW = Math.round(newH * r);
        if (startRect.x + newW > box.x + box.w) {
          newW = box.x + box.w - startRect.x;
          newH = Math.round(newW / r);
          newY = startRect.y + startRect.h - newH;
        }
        newRect = { x: startRect.x, y: newY, w: newW, h: newH };
      } else if (cropResizing === 'nw') {
        // 좌상단: x, y 이동, 너비/높이 변경
        let newX = Math.max(box.x, Math.min(startRect.x + dx, startRect.x + startRect.w - 30));
        let newY = Math.max(box.y, Math.min(startRect.y + dy, startRect.y + startRect.h - 30));
        let newW = startRect.x + startRect.w - newX;
        let newH = startRect.y + startRect.h - newY;
        // 비율 유지: 더 제한적인 쪽에 맞춤
        const targetH = Math.round(newW / r);
        if (targetH > newH) {
          newW = Math.round(newH * r);
          newX = startRect.x + startRect.w - newW;
        } else {
          newH = targetH;
          newY = startRect.y + startRect.h - newH;
        }
        newRect = { x: newX, y: newY, w: newW, h: newH };
      }

      setCropRect(newRect);
      return;
    }

    // 드래그 중 (이동)
    if (cropDragging) {
      let nx = e.clientX - cropStartRef.current.x;
      let ny = e.clientY - cropStartRef.current.y;
      // 경계 클램프
      nx = Math.max(box.x, Math.min(nx, box.x + box.w - cropRect.w));
      ny = Math.max(box.y, Math.min(ny, box.y + box.h - cropRect.h));
      setCropRect(prev => ({ ...prev, x: nx, y: ny }));
    }
  };

  const onCropMouseUp = () => {
    setCropDragging(false);
    setCropResizing(null);
  };


  const applyCrop = async () => {
    if (cropIndex < 0) { setCropOpen(false); return; }
    try {
      setCropLoading(true);
      const imgEl = cropImgRef.current;
      const wrap = cropWrapRef.current;
      if (!imgEl || !wrap) return;
      // 실 이미지 픽셀 기준 좌표로 변환
      const naturalW = imgEl.naturalWidth || 0;
      const naturalH = imgEl.naturalHeight || 0;
      const box = cropImgBoxRef.current;
      const dispW = box.w || wrap.clientWidth;
      const dispH = box.h || wrap.clientHeight;
      const offX = box.x || 0;
      const offY = box.y || 0;
      const sx = Math.max(0, Math.min(naturalW, (cropRect.x - offX) / dispW * naturalW));
      const sy = Math.max(0, Math.min(naturalH, (cropRect.y - offY) / dispH * naturalH));
      const sw = Math.max(1, Math.min(naturalW - sx, cropRect.w / dispW * naturalW));
      const sh = Math.max(1, Math.min(naturalH - sy, cropRect.h / dispH * naturalH));
      // 캔버스에 크롭
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(sw);
      canvas.height = Math.round(sh);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(imgEl, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png', 0.92));
      if (!blob) {
        try { window.dispatchEvent(new CustomEvent('toast', { detail: { type: 'error', message: '크롭 실패: 원본 이미지를 불러올 수 없습니다 (CORS 확인 필요).' } })); } catch {}
        return;
      }
      const file = new File([blob], 'crop.png', { type: 'image/png' });
      const res = await mediaAPI.upload([file]);
      const items = Array.isArray(res.data?.items) ? res.data.items : (res.data?.items ? [res.data.items] : []);
      if (items.length > 0) {
        setGallery(prev => {
          const next = prev.slice();
          next[cropIndex] = items[0];
          return next;
        });
      }
      setCropOpen(false);
    } catch (_) {
      try { window.dispatchEvent(new CustomEvent('toast', { detail: { type: 'error', message: '크롭 실패' } })); } catch {}
    } finally {
      setCropLoading(false);
    }
  };

  const onDragStartItem = (e, idx) => {
    dragIndexRef.current = idx;
    try {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', String(idx));
    } catch (_) {}
  };
  const onDragOverItem = (e) => { try { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; } catch(_) {} };
  const onDragEnterItem = (e) => { try { e.preventDefault(); } catch(_) {} };
  const onDropItem = (e, idx) => {
    try {
      e.preventDefault();
      let from = dragIndexRef.current;
      if (from === null || from === undefined) {
        try { from = parseInt(e.dataTransfer.getData('text/plain') || '-1', 10); } catch (_) { from = -1; }
      }
      if (from === -1 || from === idx) return;
      // 안전 가드: 인덱스 범위 확인
      if (from < 0 || from >= gallery.length || idx < 0 || idx >= gallery.length) return;
      setGallery(prev => {
        const next = prev.slice();
        const [moved] = next.splice(from, 1);
        next.splice(idx, 0, moved);
        return next;
      });
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        saveReorder();
      }, 400);
    } finally { dragIndexRef.current = null; }
  };

  const saveReorder = async () => {
    if (!gallery || gallery.length === 0) return;
    // 엔티티 없는 경우(생성 페이지)에는 서버 저장 없이 로컬 순서만 유지
    if (!entityType || !entityId) return;
    setGalleryBusy(true);
    try {
      const orderedIds = gallery.map(g => g.id);
      await mediaAPI.reorder({ entityType, entityId, orderedIds });
      const firstId = orderedIds[0];
      if (firstId) {
        try { await mediaAPI.update(firstId, { is_primary: true }); } catch (_) {}
      }
      try { window.dispatchEvent(new CustomEvent('toast', { detail: { type: 'success', message: '순서 저장됨 (첫 번째가 대표)' } })); } catch(_) {}
      try { window.dispatchEvent(new CustomEvent('media:updated', { detail: { entityType, entityId } })); } catch(_) {}
    } catch (_) {
      try { window.dispatchEvent(new CustomEvent('toast', { detail: { type: 'error', message: '순서 저장 실패' } })); } catch(_) {}
    } finally { setGalleryBusy(false); }
  };

  return (
    <>
    <Dialog open={open} onOpenChange={(v)=>{ if(!v) onClose?.(); }}>
      <DialogContent className="bg-gray-900 text-white border border-gray-800 max-w-4xl flex flex-col max-h-[85vh] overflow-hidden" aria-describedby="img-gen-insert-desc">
        <button
          type="button"
          onClick={()=> onClose?.()}
          aria-label="닫기"
          className="absolute top-2 right-2 p-2 rounded-md bg-black/40 hover:bg-black/60 text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900"
        >
          <X className="w-4 h-4" />
        </button>
        <DialogHeader>
          <DialogTitle>이미지 생성/삽입</DialogTitle>
          <div id="img-gen-insert-desc" className="sr-only">이미지를 업로드하거나 생성하여 갤러리에 추가하고 순서를 변경합니다.</div>
        </DialogHeader>
        {/* 상단 생성/업로드 영역 */}
        <div className="flex-shrink-0 p-4 bg-gray-800 border-b border-gray-700">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {/* 프로바이더는 Gemini 고정 */}
              <div className="space-y-2">
                <label className="text-xs text-gray-400">모델</label>
                <input aria-label="이미지 생성 모델" value={genModel} onChange={(e)=> setGenModel(e.target.value)} className="w-full bg-gray-800 border border-gray-700 rounded p-2 text-sm text-white focus-visible:ring-2 focus-visible:ring-purple-500 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900" />
              </div>
              <div className="space-y-2">
                <label className="text-xs text-gray-400">비율</label>
                <select aria-label="이미지 비율" value={genRatio} onChange={(e)=> setGenRatio(e.target.value)} className="w-full bg-gray-800 border border-gray-700 rounded p-2 text-sm text-white focus-visible:ring-2 focus-visible:ring-purple-500 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900">
                  <option value="1:1">1:1</option>
                  <option value="3:4">3:4</option>
                  <option value="4:3">4:3</option>
                  <option value="16:9">16:9</option>
                  <option value="9:16">9:16</option>
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-xs text-gray-400">개수 (1~8)</label>
                <input aria-label="생성 개수" type="number" min={1} max={8} value={genCount} onChange={(e)=> setGenCount(Math.max(1, Math.min(8, Number(e.target.value)||1)))} className="w-full bg-gray-800 border border-gray-700 rounded p-2 text-sm text-white focus-visible:ring-2 focus-visible:ring-purple-500 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900" />
              </div>
            </div>
            <div className="space-y-2 mt-3">
              <label className="text-xs text-gray-400">프롬프트</label>
              <textarea rows={4} value={genPrompt} onChange={(e)=> setGenPrompt(e.target.value)} className="w-full bg-gray-800 border border-gray-700 rounded p-2 text-sm text-white focus-visible:ring-2 focus-visible:ring-purple-500 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900" placeholder="예) 보랏빛 네온의 사이버펑크 도시에서 미소짓는 요정" />
              <div className="text-xs text-gray-500">- 팁: 스타일/조명/앵글/색감 키워드가 품질을 높입니다.</div>
            </div>
            <div className="flex items-center justify-end gap-2 mt-3">
              {/* 취소를 위해 AbortController 사용 */}
              
              <Button onClick={async()=>{
                if (!genPrompt.trim()) { try { window.dispatchEvent(new CustomEvent('toast', { detail: { type: 'error', message: '프롬프트를 입력해주세요.' } })); } catch(_) {} return; }
                setBusy(true);
                startEta('gemini', genCount);
                const params = { provider: 'gemini', model: genModel, ratio: genRatio, count: genCount, prompt: genPrompt };
                lastParamsRef.current = params;
                try {
                  try { await mediaAPI.trackEvent({ event: 'generate_start', entityType, entityId, count: genCount }); } catch(_) {}
                  const controller = new AbortController();
                  abortRef.current = controller;
                  const res = await mediaAPI.generate(params, { signal: controller.signal });
                  const items = Array.isArray(res.data?.items) ? res.data.items : [];
                  if (items.length === 0) {
                    try { window.dispatchEvent(new CustomEvent('toast', { detail: { type: 'error', message: '생성 결과가 없습니다.' } })); } catch(_) {}
              } else {
                setGallery(prev => dedupAssets([...prev, ...items]));
                    try { window.dispatchEvent(new CustomEvent('toast', { detail: { type: 'success', message: `${items.length}개 생성됨` } })); } catch(_) {}
                    try { await mediaAPI.trackEvent({ event: 'generate_success', entityType, entityId, count: items.length }); } catch(_) {}
                  }
                } catch (e) {
                  try { window.dispatchEvent(new CustomEvent('toast', { detail: { type: 'error', message: '생성 실패. 재시도 해주세요.' } })); } catch(_) {}
                } finally { setBusy(false); clearEta(); abortRef.current = null; }
              }} disabled={busy} className="bg-purple-600 hover:bg-purple-700 inline-flex items-center gap-2">
                {busy && <Loader2 className="w-4 h-4 animate-spin" />}<span>생성</span>
              </Button>
              {/* 재시도 버튼 제거 */}
              <Button onClick={async()=>{ try { if (abortRef.current) { abortRef.current.abort(); } await mediaAPI.cancelJob('ad-hoc'); await mediaAPI.trackEvent({ event: 'generate_cancel', entityType, entityId }); window.dispatchEvent(new CustomEvent('toast', { detail: { type: 'success', message: '생성 취소됨' } })); } catch(_) {} clearEta(); setBusy(false); abortRef.current = null; }} disabled={!busy} variant="outline" className="bg-gray-800 border-gray-700 text-gray-200">취소</Button>
            </div>
            {busy && (
              <div className="mt-2 text-xs text-gray-400">
                <div className="flex items-center justify-between">
                  <span>남은 시간(예상)</span>
                  <span>{Math.ceil(etaMs/1000)}초</span>
                </div>
                <div className="h-1.5 bg-gray-800 rounded overflow-hidden mt-1">
                  <div className="h-full bg-purple-500" style={{ width: `${Math.max(0, 100 - (etaMs / ( 60000 * Math.max(1, Number(genCount)||1) ))*100)}%` }} />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* 단일 갤러리 영역 (스크롤 가능) */}
        <div className="flex-grow overflow-y-auto p-4 space-y-4 custom-scrollbar">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-medium text-gray-200">갤러리</h3>
            <div className="text-xs text-gray-400">드래그로 순서 변경 · 첫 번째가 대표</div>
          </div>
          {galleryBusy && <div className="text-xs text-gray-400 mb-2">불러오는 중...</div>}
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-3" role="list" aria-label="이미지 갤러리">
            {gallery.length===0 && !galleryBusy && (
              <div className="col-span-3 text-center text-gray-400 py-8">갤러리에 이미지가 없습니다. 업로드하거나 생성해보세요.</div>
            )}
            {gallery.map((g, idx) => (
              <div
                key={g.id}
                role="listitem"
                draggable={true}
                onDragStart={(e)=> onDragStartItem(e, idx)}
                onDragOver={(e)=> onDragOverItem(e)}
                onDragEnter={(e)=> onDragEnterItem(e)}
                onDrop={(e)=> onDropItem(e, idx)}
                onDragEnd={()=> { dragIndexRef.current = null; }}
                className={`group relative border rounded-md overflow-hidden ${idx===0?'border-blue-500 ring-2 ring-blue-500':'border-gray-700'} bg-gray-800 cursor-grab active:cursor-grabbing select-none`}
                title={idx===0?'대표 이미지':''}
                onClick={() => openCropFor(idx)}
              >
                {idx===0 && (
                  <div className="absolute top-1 left-1 z-10 bg-blue-600 text-white text-[10px] px-1.5 py-0.5 rounded">대표</div>
                )}
                <img src={g.url} alt={`갤러리 이미지 ${idx+1}`} className="w-full h-28 object-cover" draggable={false} />
                <button
                  type="button"
                  onMouseDown={(e)=> { e.stopPropagation(); e.preventDefault(); }}
                  onDragStart={(e)=> { e.stopPropagation(); e.preventDefault(); }}
                  onClick={(e)=> { e.stopPropagation(); e.preventDefault(); if (!String(g.id).startsWith('url:')) deleteOne(g.id); }}
                  className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition bg-black/60 hover:bg-black/80 text-white rounded p-1"
                  aria-label="이미지 삭제"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* 로딩 오버레이 제거: 취소 버튼 접근 가능 유지 */}

        {/* 하단 확인 바 (좌측 업로드 추가) */}
        <div className="flex-shrink-0 flex items-center justify-between gap-2 p-4 bg-gray-800 border-t border-gray-700">
          <div className="flex items-center gap-2">
            <input ref={inputRef} type="file" accept="image/*" multiple className="hidden" onChange={onFiles} />
            <Button onClick={onPick} disabled={busy} className="bg-white text-black hover:bg-gray-100">업로드</Button>
          </div>
          <Button onClick={confirmAttach} disabled={busy || gallery.length === 0} className="bg-purple-600 hover:bg-purple-700">확인 ({gallery.length}개 삽입)</Button>
        </div>
        {/* ↑ 상단 생성/업로드 영역의 바깥 그리드 닫기 보완 */}
      </DialogContent>
    </Dialog>

    {/* 크롭 모달 */}
    <Dialog open={cropOpen} onOpenChange={(v)=>{ if(!v) setCropOpen(false); }}>
      <DialogContent className="bg-gray-900 text-white border border-gray-800 max-w-3xl">
        <DialogHeader>
          <DialogTitle>이미지 크롭</DialogTitle>
        </DialogHeader>
        <div
          ref={cropWrapRef}
          className="relative w-full h-[60vh] bg-black/50 rounded-md overflow-hidden select-none"
          onMouseMove={onCropMouseMove}
          onMouseUp={onCropMouseUp}
          onMouseLeave={onCropMouseUp}
        >
          {cropIndex >= 0 && gallery[cropIndex] && (
            <img
              ref={cropImgRef}
              crossOrigin="anonymous"
              src={`${gallery[cropIndex].url}${(gallery[cropIndex].url||'').includes('?') ? '&' : '?'}v=${Date.now()}`}
              alt="crop"
              className="absolute inset-0 w-full h-full object-contain"
              onLoad={onCropImgLoad}
              onError={() => { try { window.dispatchEvent(new CustomEvent('toast', { detail: { type: 'error', message: '이미지를 불러오지 못했습니다. 공개 URL/CORS를 확인하세요.' } })); } catch {} }}
              draggable={false}
            />
          )}
          {/* 크롭 사각형 */}
          <div
            className="absolute border-2 border-purple-500 bg-purple-500/10 cursor-move select-none"
            style={{ left: `${cropRect.x}px`, top: `${cropRect.y}px`, width: `${cropRect.w}px`, height: `${cropRect.h}px` }}
            onMouseDown={onCropMouseDown}
          >
            {/* 리사이즈 핸들 - 네 모서리 */}
            <div
              className="absolute w-4 h-4 bg-white border-2 border-purple-500 rounded-full cursor-nw-resize"
              style={{ left: '-8px', top: '-8px' }}
              onMouseDown={(e) => onResizeHandleMouseDown(e, 'nw')}
            />
            <div
              className="absolute w-4 h-4 bg-white border-2 border-purple-500 rounded-full cursor-ne-resize"
              style={{ right: '-8px', top: '-8px' }}
              onMouseDown={(e) => onResizeHandleMouseDown(e, 'ne')}
            />
            <div
              className="absolute w-4 h-4 bg-white border-2 border-purple-500 rounded-full cursor-sw-resize"
              style={{ left: '-8px', bottom: '-8px' }}
              onMouseDown={(e) => onResizeHandleMouseDown(e, 'sw')}
            />
            <div
              className="absolute w-4 h-4 bg-white border-2 border-purple-500 rounded-full cursor-se-resize"
              style={{ right: '-8px', bottom: '-8px' }}
              onMouseDown={(e) => onResizeHandleMouseDown(e, 'se')}
            />
          </div>
        </div>
        <div className="mt-3 flex items-center justify-end gap-2">
          <Button variant="outline" className="bg-gray-800 border-gray-700 text-gray-200" onClick={()=> setCropOpen(false)} disabled={cropLoading}>취소</Button>
          <Button className="bg-purple-600 hover:bg-purple-700" onClick={applyCrop} disabled={cropLoading}>{cropLoading ? '적용 중…' : '적용'}</Button>
        </div>
      </DialogContent>
    </Dialog>
    </>
  );
};

export default ImageGenerateInsertModal;


