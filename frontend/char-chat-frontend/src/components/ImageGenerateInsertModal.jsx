import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog';
import { Button } from './ui/button';
import { mediaAPI, charactersAPI, storiesAPI } from '../lib/api';
import { resolveImageUrl } from '../lib/images';
import { buildImageGenerationPrompt } from '../lib/imageGenerationPrompt';
import { Loader2, Trash2 } from 'lucide-react';

const ImageGenerateInsertModal = ({ open, onClose, entityType, entityId, initialGallery, initialCropIndex = -1, cropOnly = false }) => {
  // 단일 갤러리: 업로드/생성 결과를 모두 여기에 누적
  const inputRef = React.useRef(null);
  const [busy, setBusy] = React.useState(false);
  // 현재 갤러리(이미 삽입된 자산) 상태
  const [gallery, setGallery] = React.useState([]);
  // ✅ 베스트-에포트: setTimeout 콜백에서 stale state를 참조하지 않도록 최신 갤러리를 ref로 유지
  const galleryRef = React.useRef([]);
  const [galleryBusy, setGalleryBusy] = React.useState(false);
  const [statusMessage, setStatusMessage] = React.useState('');
  const [errorMessage, setErrorMessage] = React.useState('');
  const dragIndexRef = React.useRef(null);
  const saveTimerRef = React.useRef(null);
  const hasLoadedRef = React.useRef(false);
  // 생성 탭 상태
  const [genModel, setGenModel] = React.useState('gemini-2.5-flash-image');
  // ✅ 스타일 키는 SSOT 유틸과 맞춘다(anime/photo/semi/artwork)
  const [genStyle, setGenStyle] = React.useState('anime');
  // 생성 비율 기본값: 3:4(세로) 유지
  // - 크롭은 별도 "비율 탭(직사각형/정사각형)"으로 선택한다.
  const [genRatio, setGenRatio] = React.useState('3:4');
  const [genCount, setGenCount] = React.useState(1);
  const [genPrompt, setGenPrompt] = React.useState('');
  const lastParamsRef = React.useRef(null);
  // 남은 시간 표시
  const [etaMs, setEtaMs] = React.useState(0);
  const etaTimerRef = React.useRef(null);
  const abortRef = React.useRef(null);
  // ✅ 모바일(터치) 환경 감지: hover/drag/crop UI가 깨지는 것을 방지한다.
  const isCoarsePointer = React.useMemo(() => {
    try {
      return typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    } catch (_) {
      return false;
    }
  }, []);

  // 크롭 모달 상태
  const [cropOpen, setCropOpen] = React.useState(false);
  const [cropIndex, setCropIndex] = React.useState(-1);
  const [cropLoading, setCropLoading] = React.useState(false);
  const cropImgRef = React.useRef(null);
  const cropWrapRef = React.useRef(null);
  const cropImgBoxRef = React.useRef({ x: 0, y: 0, w: 0, h: 0 }); // 화면에 표시된 이미지 영역
  const cropInitializedRef = React.useRef(false); // 크롭 영역 초기화 플래그
  const [cropRect, setCropRect] = React.useState({ x: 0, y: 0, w: 100, h: 100 });
  // ✅ 크롭 비율 선택(요구사항): 직사각형(기존) / 정사각형(1:1)
  // - 캐릭터(대표/격자)는 정사각형이 기본이라 square를 기본값으로 둔다.
  // - 그 외(스토리 등)는 기존처럼 직사각형이 기본.
  const [cropRatioMode, setCropRatioMode] = React.useState(() => {
    const et = String(entityType || '').trim().toLowerCase();
    return (et === 'character' || et === 'origchat') ? 'square' : 'rect'; // 'rect' | 'square'
  });
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
    // 간단한 기준치: OpenAI 90s, Gemini/FAL 60s 기준
    const base = provider === 'openai' ? 90000 : 60000;
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

  const dispatchToast = React.useCallback((type, message) => {
    try {
      window.dispatchEvent(new CustomEvent('toast', { detail: { type, message } }));
    } catch (_) {}
  }, []);

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
      setStatusMessage('이미지를 업로드하는 중입니다...');
      setErrorMessage('');
      const res = await mediaAPI.upload(selected);
      const items = res.data?.items || [];
      setGallery((prev) => dedupAssets([...prev, ...items]));
      setStatusMessage('이미지가 업로드되었습니다.');
    } catch (err) {
      console.error('이미지 업로드 실패', err);
      setErrorMessage('이미지 업로드에 실패했습니다. 잠시 후 다시 시도해주세요.');
      dispatchToast('error', '이미지 업로드에 실패했습니다.');
      setStatusMessage('');
    } finally { setBusy(false); }
  };

  const confirmAttach = async () => {
    if (!gallery.length) { onClose?.(); return; }
    setBusy(true);
    setStatusMessage('이미지를 적용하는 중입니다...');
    setErrorMessage('');
    try {
      const focusUrl = gallery[0]?.url || '';
      const realIds = gallery.filter(s => !String(s.id).startsWith('url:')).map(s => s.id);
      if (entityType && entityId && realIds.length) {
        await mediaAPI.attach({ entityType, entityId, assetIds: realIds, asPrimary: true });
        try { window.dispatchEvent(new CustomEvent('media:updated', { detail: { entityType, entityId } })); } catch(_) {}
        dispatchToast('success', `삽입 완료 (${gallery.length}개)`);
        onClose?.({ attached: true, focusUrl, gallery: gallery.map(g => ({ id: g.id, url: g.url })) });
      } else {
        dispatchToast('success', '이미지 선택 완료');
        onClose?.({ attached: false, focusUrl, gallery: gallery.map(g => ({ id: g.id, url: g.url })) });
      }
      setStatusMessage('');
    } catch (err) {
      console.error('이미지 첨부 실패', err);
      setErrorMessage('이미지를 적용하지 못했습니다. 잠시 후 다시 시도해주세요.');
      dispatchToast('error', '이미지를 적용하지 못했습니다.');
      setStatusMessage('');
    } finally { setBusy(false); }
  };

  const deleteOne = async (id) => {
    setBusy(true);
    try {
      await mediaAPI.deleteAssets([id]);
      setGallery(prev => prev.filter(s => s.id !== id));
      setStatusMessage('이미지를 삭제했습니다.');
      setErrorMessage('');
    } catch (err) {
      console.error('이미지 삭제 실패', err);
      setErrorMessage('이미지를 삭제하지 못했습니다.');
      dispatchToast('error', '이미지를 삭제하지 못했습니다.');
    } finally { setBusy(false); }
  };

  /**
   * 레거시(Story.cover_url / Character.avatar_url) 대표 이미지 제거
   *
   * 배경/의도:
   * - MediaAsset 테이블이 비어있어도, 엔티티의 cover_url/avatar_url에는 값이 남아있을 수 있다.
   * - 이 경우 모달이 레거시 URL로 폴백하며 "삭제가 안 된 것처럼" 보인다.
   * - 운영 안정성을 위해, 레거시 URL도 모달에서 직접 삭제(=필드 null)할 수 있게 한다.
   */
  const clearLegacyPrimary = async () => {
    if (!entityType || !entityId) return;
    const et = String(entityType || '').trim().toLowerCase();
    const eid = String(entityId || '').trim();
    if (!eid) return;
    setBusy(true);
    try {
      setStatusMessage('대표 이미지를 제거하는 중입니다...');
      setErrorMessage('');
      if (et === 'story') {
        await storiesAPI.updateStory(eid, { cover_url: null });
      } else if (et === 'character' || et === 'origchat') {
        await charactersAPI.updateCharacter(eid, { avatar_url: null });
      }
      try { window.dispatchEvent(new CustomEvent('media:updated', { detail: { entityType: et, entityId: eid } })); } catch(_) {}
      setStatusMessage('이미지를 삭제했습니다.');
    } catch (err) {
      console.error('레거시 대표 이미지 삭제 실패', err);
      setErrorMessage('이미지를 삭제하지 못했습니다.');
      dispatchToast('error', '이미지를 삭제하지 못했습니다.');
      throw err;
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteGalleryItem = async (g) => {
    const id = g?.id;
    const sid = String(id || '');
    // 1) 레거시(url:)는 엔티티 대표 URL을 비워야 진짜로 "삭제"가 된다.
    if (sid.startsWith('url:')) {
      await clearLegacyPrimary();
      setGallery((prev) => (prev || []).filter((x) => x?.id !== id));
      return;
    }
    // 2) 폼 임시 아이템(form:)은 서버 자산이 아니므로 로컬에서만 제거(불필요한 API 호출 방지)
    if (sid.startsWith('form:')) {
      setGallery((prev) => (prev || []).filter((x) => x?.id !== id));
      setStatusMessage('이미지를 제거했습니다.');
      setErrorMessage('');
      return;
    }
    // 3) 일반 MediaAsset은 서버에서 삭제
    await deleteOne(id);
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
    } catch (err) {
      console.error('갤러리 로드 실패', err);
      setGallery([]);
      setErrorMessage('갤러리를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.');
    } finally { setGalleryBusy(false); }
  };

  React.useEffect(() => {
    if (!open) {
      hasLoadedRef.current = false;
      setStatusMessage('');
      setErrorMessage('');
      clearEta();
      // ✅ 방어: 외부에서 open=false로 닫힐 때 크롭 모달이 남지 않게 정리
      setCropOpen(false);
      setCropIndex(-1);
      cropInitializedRef.current = false;
      if (abortRef.current) {
        try { abortRef.current.abort(); } catch (_) {}
        abortRef.current = null;
      }
      setBusy(false);
      return;
    }
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

  // 최신 갤러리 ref 동기화 (saveReorder / setTimeout 콜백에서 사용)
  React.useEffect(() => {
    try { galleryRef.current = Array.isArray(gallery) ? gallery : []; } catch (_) { galleryRef.current = []; }
  }, [gallery]);

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
  const getEffectiveCropRatioKey = () => {
    const mode = String(cropRatioMode || 'rect').trim();
    if (mode === 'square') return '1:1';
    const r = String(genRatio || '3:4').trim();
    return r || '3:4';
  };

  // ✅ 스타일/비율 프롬프트 보강 로직은 lib SSOT를 사용한다(DRY).

  const openCropFor = (index) => {
    if (index == null || index < 0 || index >= gallery.length) return;
    setCropIndex(index);
    setCropOpen(true);
    cropInitializedRef.current = false; // 크롭 모달 열 때 초기화 플래그 리셋
    // 초기 크롭 사각형 계산은 이미지 onLoad에서 수행
  };

  // ✅ 외부에서 "특정 인덱스 크롭 모달을 바로 열기" 지원(QuickMeet 등)
  const autoCropOnceRef = React.useRef(false);
  React.useEffect(() => {
    try {
      if (!open) {
        autoCropOnceRef.current = false;
        return;
      }
      if (autoCropOnceRef.current) return;
      const idx = Number(initialCropIndex);
      if (!Number.isFinite(idx) || idx < 0) return;
      // ✅ 모바일도 크롭 모달을 열 수 있어야 한다(원작챗/웹소설과 동일 UX).
      if (!Array.isArray(gallery) || gallery.length === 0) return;
      if (idx >= gallery.length) return;
      autoCropOnceRef.current = true;
      // 레이아웃 안정화 후 열기
      setTimeout(() => { try { openCropFor(idx); } catch (_) {} }, 0);
    } catch (_) {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialCropIndex, gallery?.length, isCoarsePointer, cropOnly, onClose]);

  const resetCropRectForRatioKey = (ratioKey) => {
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

      // 주어진 비율로 표시 이미지 영역을 가득 채우는 최대 사각형 계산
      const r = ratioToNumber(ratioKey);
      let w = dispW;
      let h = Math.round(w / r);
      if (h > dispH) {
        h = dispH;
        w = Math.round(h * r);
      }
      const x = Math.round(dispX + (dispW - w) / 2);
      const y = Math.round(dispY + (dispH - h) / 2);
      setCropRect({ x, y, w, h });
      cropInitializedRef.current = true;
    } catch (_) {}
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
        resetCropRectForRatioKey(getEffectiveCropRatioKey());
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
      const r = ratioToNumber(getEffectiveCropRatioKey());
      
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

  /**
   * ✅ 모바일/터치 지원(포인터 이벤트)
   *
   * 의도/원리:
   * - 기존 크롭 UI는 mouse 이벤트만 사용해서 모바일에서 조작이 불가능했다.
   * - PointerEvent로 mouse/touch/pen을 통합 지원한다.
   * - 기존 로직을 그대로 재사용해 중복을 피한다(DRY).
   */
  const toMouseLike = (ev) => {
    try {
      return {
        clientX: ev.clientX,
        clientY: ev.clientY,
        preventDefault: () => { try { ev.preventDefault(); } catch (_) {} },
        stopPropagation: () => { try { ev.stopPropagation(); } catch (_) {} },
      };
    } catch (_) {
      return null;
    }
  };
  const onCropPointerDown = (ev) => {
    try {
      try { ev.preventDefault(); } catch (_) {}
      try { ev.currentTarget?.setPointerCapture?.(ev.pointerId); } catch (_) {}
      const m = toMouseLike(ev);
      if (!m) return;
      onCropMouseDown(m);
    } catch (_) {}
  };
  const onResizeHandlePointerDown = (ev, corner) => {
    try {
      try { ev.preventDefault(); } catch (_) {}
      try { ev.currentTarget?.setPointerCapture?.(ev.pointerId); } catch (_) {}
      const m = toMouseLike(ev);
      if (!m) return;
      onResizeHandleMouseDown(m, corner);
    } catch (_) {}
  };
  const onCropPointerMove = (ev) => {
    try {
      const m = toMouseLike(ev);
      if (!m) return;
      onCropMouseMove(m);
    } catch (_) {}
  };
  const onCropPointerUp = (ev) => {
    try {
      try { ev.currentTarget?.releasePointerCapture?.(ev.pointerId); } catch (_) {}
      onCropMouseUp();
    } catch (_) {}
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

      /**
       * 크롭 적용(방어적)
       *
       * 의도/동작:
       * - 1차: 브라우저(canvas)로 빠르게 크롭 → 업로드(/media/upload)
       * - 2차(폴백): 운영에서 스토리지(CDN/R2 등) CORS 미설정이면 canvas 크롭이 실패할 수 있어
       *   서버 사이드 크롭(/media/assets/{id}/crop)으로 자동 폴백한다.
       */
      const tryServerCrop = async () => {
        const assetId = gallery?.[cropIndex]?.id;
        // 레거시 url 아이템(id가 url:로 시작)은 서버에서 조회할 수 없어서 크롭 불가
        if (!assetId || String(assetId).startsWith('url:')) {
          try { window.dispatchEvent(new CustomEvent('toast', { detail: { type: 'error', message: '크롭 실패: 이 이미지는 서버 크롭을 지원하지 않습니다. (업로드/생성 이미지로 시도해주세요)' } })); } catch {}
          return;
        }
        try {
          const res = await mediaAPI.cropAsset(String(assetId), {
            sx: Math.round(sx),
            sy: Math.round(sy),
            sw: Math.round(sw),
            sh: Math.round(sh),
          });
          const item = res?.data || null;
          if (item && item.id && item.url) {
            const base = Array.isArray(galleryRef.current) ? galleryRef.current : (Array.isArray(gallery) ? gallery : []);
            const next = base.slice();
            next[cropIndex] = item;
            setGallery(next);
            setCropOpen(false);
            if (cropOnly) {
              try {
                onClose?.({ focusUrl: next?.[0]?.url || '', gallery: next.map((g) => ({ id: g.id, url: g.url })) });
              } catch (e) {
                try { console.error('[ImageGenerateInsertModal] cropOnly onClose(after server crop) failed', e); } catch (_) {}
              }
            }
            return;
          }
          try { window.dispatchEvent(new CustomEvent('toast', { detail: { type: 'error', message: '크롭 실패: 서버 응답이 올바르지 않습니다.' } })); } catch {}
        } catch (e) {
          console.error('서버 크롭 실패', e);
          try { window.dispatchEvent(new CustomEvent('toast', { detail: { type: 'error', message: '크롭 실패: 서버 크롭에 실패했습니다.' } })); } catch {}
        }
      };

      // 캔버스에 크롭(시도) — CORS/보안 제약으로 실패할 수 있음
      let blob = null;
      try {
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(sw);
        canvas.height = Math.round(sh);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(imgEl, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
        blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png', 0.92));
      } catch (e) {
        // 보안 예외(SecurityError) 등 → 서버 크롭으로 폴백
        blob = null;
      }
      if (!blob) {
        // ✅ 운영에서 자주 발생: CORS로 canvas 크롭 불가 → 서버 크롭으로 폴백
        await tryServerCrop();
        return;
      }
      const file = new File([blob], 'crop.png', { type: 'image/png' });
      const res = await mediaAPI.upload([file]);
      const items = Array.isArray(res.data?.items) ? res.data.items : (res.data?.items ? [res.data.items] : []);
      if (items.length > 0) {
        const base = Array.isArray(galleryRef.current) ? galleryRef.current : (Array.isArray(gallery) ? gallery : []);
        const next = base.slice();
        next[cropIndex] = items[0];
        setGallery(next);
        if (cropOnly) {
          try {
            // ✅ QuickMeet 등: 크롭만 하고 바로 닫기
            onClose?.({ focusUrl: next?.[0]?.url || '', gallery: next.map((g) => ({ id: g.id, url: g.url })) });
          } catch (e) {
            try { console.error('[ImageGenerateInsertModal] cropOnly onClose(after canvas crop) failed', e); } catch (_) {}
          }
        }
      }
      setCropOpen(false);
    } catch (e) {
      try { console.error('[ImageGenerateInsertModal] applyCrop failed', e); } catch (_) {}
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

  /**
   * 모바일(터치)에서는 Drag & Drop이 브라우저에서 잘 동작하지 않아서,
   * "앞/뒤" 버튼으로 순서를 이동할 수 있게 보완한다.
   */
  const moveGalleryItem = (from, to) => {
    try {
      const f = Number(from);
      const t = Number(to);
      if (!Number.isFinite(f) || !Number.isFinite(t)) return;
      if (f === t) return;
      setGallery((prev) => {
        if (!Array.isArray(prev)) return prev;
        if (f < 0 || t < 0 || f >= prev.length || t >= prev.length) return prev;
        const next = prev.slice();
        const [moved] = next.splice(f, 1);
        next.splice(t, 0, moved);
        return next;
      });
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        saveReorder();
      }, 400);
    } catch (_) {}
  };

  const saveReorder = async () => {
    const currentGallery = Array.isArray(galleryRef.current) ? galleryRef.current : [];
    if (!currentGallery || currentGallery.length === 0) return;
    // 엔티티 없는 경우(생성 페이지)에는 서버 저장 없이 로컬 순서만 유지
    if (!entityType || !entityId) return;
    setGalleryBusy(true);
    try {
      const orderedIds = currentGallery.map(g => g.id);
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

  const emitLocalGallery = () => ({
    focusUrl: gallery[0]?.url || '',
    gallery: gallery.map(g => ({ id: g.id, url: g.url })),
  });

  const handleDismiss = () => {
    if (!entityType || !entityId) {
      onClose?.(emitLocalGallery());
    } else {
      onClose?.();
    }
  };

  return (
    <>
    {!cropOnly && (
      <Dialog open={open} onOpenChange={(v)=>{ if(!v) handleDismiss(); }}>
      {/* ✅ 모바일 최적화(컴포넌트 누락 방지)
          - 문제: 모바일에서 상단 폼이 커지면(flex-shrink-0) max-h 안에서 갤러리/하단바가 0px로 눌려 보이지 않을 수 있다.
          - 해결: 모바일은 DialogContent 자체를 스크롤 컨테이너로 만들고, 갤러리는 자연 높이로 렌더링한다.
            데스크탑은 기존대로 "갤러리 영역만 스크롤"을 유지한다. */}
      <DialogContent
        className="bg-gray-900 text-white border border-gray-800 max-w-4xl flex flex-col max-h-[92svh] md:max-h-[85vh] overflow-y-auto md:overflow-hidden md:min-h-0"
        aria-describedby="img-gen-insert-desc"
      >
        <DialogHeader>
          <DialogTitle>이미지 생성/삽입</DialogTitle>
          <div id="img-gen-insert-desc" className="sr-only">이미지를 업로드하거나 생성하여 갤러리에 추가하고 순서를 변경합니다.</div>
        </DialogHeader>
        {/* ✅ UX/버그fix: 상태 문구 on/off로 레이아웃이 흔들리면(높이 변화) 갤러리 스크롤이 튄다.
            - 메시지 영역을 "항상 같은 높이"로 렌더해 스크롤 앵커/레이아웃 쉬프트를 방지한다. */}
        <div className="px-4 min-h-[34px]" aria-live="polite">
          <p className="text-xs text-gray-400 min-h-[16px]">{statusMessage || ''}</p>
          <p className="text-xs text-red-400 min-h-[16px]">{errorMessage || ''}</p>
        </div>
        {/* 상단 생성/업로드 영역 */}
        {/* ✅ UX: 데스크탑에서 상단 폼이 커지면 갤러리가 가려질 수 있음
            - 상단 영역은 "최대 높이 + 내부 스크롤"로 제한해 갤러리를 항상 노출한다. */}
        <div className="flex-shrink-0 p-4 bg-gray-800 border-b border-gray-700 md:max-h-[320px] md:overflow-y-auto md:min-h-0 custom-scrollbar">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {/* ✅ UX: 모델명은 길고(예: Nano banana Pro), 비율은 짧다 → 모델 영역을 더 넓히고 비율은 슬림하게 */}
            <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
              {/* 프로바이더는 선택한 모델(model)에 따라 백엔드에서 분기됨 (gemini vs fal) */}
              <div className="space-y-2 md:col-span-6">
                <label className="text-xs text-gray-400">모델</label>
                <select
                  aria-label="이미지 생성 모델"
                  value={genModel}
                  onChange={(e) => setGenModel(e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded p-2 text-sm text-white focus-visible:ring-2 focus-visible:ring-purple-500 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900"
                >
                  <option value="gemini-2.5-flash-image">Nano banana</option>
                  <option value="gemini-3-pro-image-preview">Nano banana Pro</option>
                  <option value="fal-ai/z-image/turbo">Z-Image Turbo</option>
                </select>
              </div>
              <div className="space-y-2 md:col-span-3">
                <label className="text-xs text-gray-400">비율</label>
                <select aria-label="이미지 비율" value={genRatio} onChange={(e)=> setGenRatio(e.target.value)} className="w-full bg-gray-800 border border-gray-700 rounded p-2 text-sm text-white focus-visible:ring-2 focus-visible:ring-purple-500 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900">
                  <option value="1:1">1:1</option>
                  <option value="3:4">3:4</option>
                  <option value="4:3">4:3</option>
                  <option value="16:9">16:9</option>
                  <option value="9:16">9:16</option>
                </select>
              </div>
              <div className="space-y-2 md:col-span-3">
                <label className="text-xs text-gray-400">개수 (1~8)</label>
                <input aria-label="생성 개수" type="number" min={1} max={8} value={genCount} onChange={(e)=> setGenCount(Math.max(1, Math.min(8, Number(e.target.value)||1)))} className="w-full bg-gray-800 border border-gray-700 rounded p-2 text-sm text-white focus-visible:ring-2 focus-visible:ring-purple-500 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900" />
              </div>
            </div>
            <div className="space-y-2 mt-3">
              <label className="text-xs text-gray-400">스타일</label>
              <select
                aria-label="이미지 스타일"
                value={genStyle}
                onChange={(e) => setGenStyle(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded p-2 text-sm text-white focus-visible:ring-2 focus-visible:ring-purple-500 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900"
              >
                <option value="anime">애니메이션</option>
                <option value="semi">반실사</option>
                <option value="photo">실사</option>
                <option value="artwork">아트웤</option>
              </select>
              <label className="text-xs text-gray-400">프롬프트</label>
              <textarea
                rows={3}
                value={genPrompt}
                onChange={(e)=> setGenPrompt(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded p-2 text-sm text-white min-h-[92px] focus-visible:ring-2 focus-visible:ring-purple-500 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900"
                placeholder="예) 보랏빛 네온의 사이버펑크 도시에서 미소짓는 요정"
              />
              <div className="text-xs text-gray-500">- 팁: 스타일/조명/앵글/색감 키워드가 품질을 높입니다.</div>
            </div>
            <div className="flex items-center justify-end gap-2 mt-3">
              {/* 취소를 위해 AbortController 사용 */}
              
              <Button onClick={async()=>{
                if (!genPrompt.trim()) { dispatchToast('error', '프롬프트를 입력해주세요.'); return; }
                setBusy(true);
                setStatusMessage('이미지를 생성하는 중입니다...');
                setErrorMessage('');
                const provider = String(genModel || '').startsWith('fal-ai/') ? 'fal' : 'gemini';
                startEta(provider, genCount);
                const finalPrompt = buildImageGenerationPrompt(genPrompt, genStyle, genRatio);
                const params = { provider, model: genModel, ratio: genRatio, count: genCount, prompt: finalPrompt };
                lastParamsRef.current = params;
                try {
                  try { await mediaAPI.trackEvent({ event: 'generate_start', entityType, entityId, count: genCount }); } catch(_) {}
                  const controller = new AbortController();
                  abortRef.current = controller;
                  const res = await mediaAPI.generate(params, { signal: controller.signal });
                  const items = Array.isArray(res.data?.items) ? res.data.items : [];
                  if (items.length === 0) {
                    dispatchToast('warning', '생성 결과가 없습니다.');
                  } else {
                    setGallery(prev => dedupAssets([...prev, ...items]));
                    dispatchToast('success', `${items.length}개 생성됨`);
                    try { await mediaAPI.trackEvent({ event: 'generate_success', entityType, entityId, count: items.length }); } catch(_) {}
                  }
                  setStatusMessage(items.length ? `${items.length}개 생성되었습니다.` : '');
                } catch (e) {
                  if (e?.name === 'AbortError') {
                    setStatusMessage('생성이 취소되었습니다.');
                    setErrorMessage('');
                  } else {
                    console.error('이미지 생성 실패', e);
                    setErrorMessage('이미지 생성에 실패했습니다. 잠시 후 다시 시도해주세요.');
                    dispatchToast('error', '이미지 생성에 실패했습니다.');
                    setStatusMessage('');
                  }
                } finally { setBusy(false); clearEta(); abortRef.current = null; }
              }} disabled={busy} className="bg-purple-600 hover:bg-purple-700 inline-flex items-center gap-2">
                {busy && <Loader2 className="w-4 h-4 animate-spin" />}<span>생성</span>
              </Button>
              {/* 재시도 버튼 제거 */}
              <Button onClick={async()=>{ try { if (abortRef.current) { abortRef.current.abort(); } await mediaAPI.cancelJob('ad-hoc'); await mediaAPI.trackEvent({ event: 'generate_cancel', entityType, entityId }); dispatchToast('success', '생성이 취소되었습니다.'); setStatusMessage('생성이 취소되었습니다.'); setErrorMessage(''); } catch(_) {} clearEta(); setBusy(false); abortRef.current = null; }} disabled={!busy} variant="outline" className="bg-gray-800 border-gray-700 text-gray-200">취소</Button>
            </div>
            {/* ✅ 버그fix: busy 상태에서만 ETA 블록이 생기면(높이 변화) 갤러리가 위아래로 밀리며 스크롤이 튄다.
                - 항상 동일 높이를 차지하게 해서 레이아웃 쉬프트를 제거한다. */}
            <div className="mt-2 text-xs text-gray-400 min-h-[44px]">
              {busy ? (
                <div>
                  <div className="flex items-center justify-between">
                    <span>남은 시간(예상)</span>
                    <span>{Math.ceil(etaMs / 1000)}초</span>
                  </div>
                  <div className="h-1.5 bg-gray-800 rounded overflow-hidden mt-1">
                    <div className="h-full bg-purple-500" style={{ width: `${Math.max(0, 100 - (etaMs / (60000 * Math.max(1, Number(genCount) || 1))) * 100)}%` }} />
                  </div>
                </div>
              ) : (
                // 높이 고정을 위한 더미(시각적으로는 숨김)
                <div className="opacity-0 select-none pointer-events-none">
                  <div className="flex items-center justify-between">
                    <span>남은 시간(예상)</span>
                    <span>0초</span>
                  </div>
                  <div className="h-1.5 bg-gray-800 rounded overflow-hidden mt-1">
                    <div className="h-full bg-purple-500" style={{ width: '0%' }} />
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* 단일 갤러리 영역
            - 모바일: 전체 모달이 스크롤(갤러리는 자연 높이)
            - 데스크탑: 갤러리만 스크롤 */}
        {/* ✅ flex/overflow 안정화: min-h-0 없으면 내용이 1px라도 오버플로우하며 스크롤바가 생기거나 튈 수 있다. */}
        <div className="p-4 space-y-4 custom-scrollbar md:flex-1 md:min-h-0 md:overflow-y-auto">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-medium text-gray-200">갤러리</h3>
            <div className="text-xs text-gray-400">
              <span className="hidden md:inline">드래그로 순서 변경 · 첫 번째가 대표</span>
              <span className="md:hidden">버튼으로 순서 변경 · 첫 번째가 대표</span>
            </div>
          </div>
          {galleryBusy && <div className="text-xs text-gray-400 mb-2">불러오는 중...</div>}
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-3" role="list" aria-label="이미지 갤러리">
            {gallery.length===0 && !galleryBusy && (
              <div className="col-span-full text-center text-gray-400 py-8">갤러리에 이미지가 없습니다. 업로드하거나 생성해보세요.</div>
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
                onClick={() => { openCropFor(idx); }}
              >
                {idx===0 && (
                  <div className="absolute top-1 left-1 z-10 bg-blue-600 text-white text-[10px] px-1.5 py-0.5 rounded">대표</div>
                )}
                {/* 모바일용 순서 이동(드래그 대체) */}
                {isCoarsePointer && gallery.length > 1 && (
                  <div className="absolute bottom-1 left-1 right-1 z-10 flex items-center justify-between gap-1 md:hidden">
                    <button
                      type="button"
                      aria-label="앞으로 이동"
                      disabled={idx === 0 || busy || galleryBusy}
                      onMouseDown={(e)=> { e.stopPropagation(); e.preventDefault(); }}
                      onClick={(e)=> { e.stopPropagation(); e.preventDefault(); moveGalleryItem(idx, idx - 1); }}
                      className="px-2 py-1 rounded bg-black/60 hover:bg-black/80 text-white text-[10px] disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      ←
                    </button>
                    <button
                      type="button"
                      aria-label="뒤로 이동"
                      disabled={idx === gallery.length - 1 || busy || galleryBusy}
                      onMouseDown={(e)=> { e.stopPropagation(); e.preventDefault(); }}
                      onClick={(e)=> { e.stopPropagation(); e.preventDefault(); moveGalleryItem(idx, idx + 1); }}
                      className="px-2 py-1 rounded bg-black/60 hover:bg-black/80 text-white text-[10px] disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      →
                    </button>
                  </div>
                )}
                <img src={resolveImageUrl(g.url)} alt={`갤러리 이미지 ${idx+1}`} className="w-full h-28 object-cover" draggable={false} />
                <button
                  type="button"
                  onMouseDown={(e)=> { e.stopPropagation(); e.preventDefault(); }}
                  onDragStart={(e)=> { e.stopPropagation(); e.preventDefault(); }}
                  onClick={async (e)=> {
                    e.stopPropagation();
                    e.preventDefault();
                    try {
                      await handleDeleteGalleryItem(g);
                    } catch (_) {}
                  }}
                  className="absolute top-1 right-1 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition bg-black/60 hover:bg-black/80 text-white rounded p-1"
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
        <div className="flex-shrink-0 flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-4 bg-gray-800 border-t border-gray-700 sticky bottom-0 md:static z-10">
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <input ref={inputRef} type="file" accept="image/*" multiple className="hidden" onChange={onFiles} />
            <Button onClick={onPick} disabled={busy} className="w-full sm:w-auto bg-white text-black hover:bg-gray-100">업로드</Button>
          </div>
          <Button onClick={confirmAttach} disabled={busy || gallery.length === 0} className="w-full sm:w-auto bg-purple-600 hover:bg-purple-700">확인 ({gallery.length}개 삽입)</Button>
        </div>
        {/* ↑ 상단 생성/업로드 영역의 바깥 그리드 닫기 보완 */}
      </DialogContent>
      </Dialog>
    )}

    {/* 크롭 모달 */}
    <Dialog
      open={cropOpen}
      onOpenChange={(v)=>{ 
        if (v) return;
        if (cropOnly) {
          try { onClose?.(); } catch (e) { try { console.error('[ImageGenerateInsertModal] cropOnly dismiss failed', e); } catch (_) {} }
        }
        setCropOpen(false);
      }}
    >
      <DialogContent className="bg-gray-900 text-white border border-gray-800 max-w-3xl">
        <DialogHeader>
          <DialogTitle>이미지 크롭</DialogTitle>
        </DialogHeader>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
          <div className="text-xs text-gray-400">
            비율 선택: <span className="text-gray-200 font-semibold">{cropRatioMode === 'square' ? '정사각형(1:1)' : `직사각형(${String(genRatio || '3:4')})`}</span>
          </div>
          <div className="inline-flex overflow-hidden rounded-lg border border-gray-700/80 bg-gray-900/30">
            <button
              type="button"
              aria-pressed={cropRatioMode !== 'square'}
              className={[
                'h-9 px-3 text-xs sm:text-sm font-semibold transition-colors',
                cropRatioMode !== 'square' ? 'bg-purple-600 text-white' : 'bg-transparent text-gray-200 hover:bg-gray-800/60',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500/30',
              ].join(' ')}
              onClick={() => {
                try {
                  setCropRatioMode('rect');
                  // 비율 변경 즉시 크롭 사각형을 새 비율로 재정렬(UX)
                  cropInitializedRef.current = false;
                  setTimeout(() => { try { resetCropRectForRatioKey(String(genRatio || '3:4')); } catch (_) {} }, 0);
                } catch (_) {}
              }}
              title="기존처럼 직사각형 비율로 크롭"
            >
              직사각형
            </button>
            <button
              type="button"
              aria-pressed={cropRatioMode === 'square'}
              className={[
                'h-9 px-3 text-xs sm:text-sm font-semibold transition-colors border-l border-gray-700/80',
                cropRatioMode === 'square' ? 'bg-purple-600 text-white' : 'bg-transparent text-gray-200 hover:bg-gray-800/60',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500/30',
              ].join(' ')}
              onClick={() => {
                try {
                  setCropRatioMode('square');
                  cropInitializedRef.current = false;
                  setTimeout(() => { try { resetCropRectForRatioKey('1:1'); } catch (_) {} }, 0);
                } catch (_) {}
              }}
              title="정사각형(1:1)으로 크롭"
            >
              정사각형
            </button>
          </div>
        </div>
        <div
          ref={cropWrapRef}
          className="relative w-full h-[60vh] bg-black/50 rounded-md overflow-hidden select-none"
          onMouseMove={onCropMouseMove}
          onMouseUp={onCropMouseUp}
          onMouseLeave={onCropMouseUp}
          onPointerMove={onCropPointerMove}
          onPointerUp={onCropPointerUp}
          onPointerCancel={onCropPointerUp}
        >
          {cropIndex >= 0 && gallery[cropIndex] && (
            (() => {
              /**
               * ✅ 크롭 모달 이미지 로더(운영 안정)
               *
               * 문제:
               * - 일부 스토리지 URL은 쿼리 파라미터를 임의로 추가하면(예: &v=Date.now) 서명/토큰이 깨질 수 있다.
               * - 또한 crossOrigin="anonymous"는 서버가 CORS 헤더를 주지 않으면 이미지 로딩 자체가 실패할 수 있다.
               *
               * 해결:
               * - URL은 그대로 사용(추가 파라미터 금지)
               * - same-origin일 때만 crossOrigin을 설정하여 canvas 크롭을 허용하고,
               *   cross-origin은 로딩을 우선시키고(=crossOrigin 미설정) applyCrop에서 서버 크롭으로 폴백한다.
               */
              const raw = gallery?.[cropIndex]?.url || '';
              const src = resolveImageUrl(raw) || raw;
              const useAnon = (() => {
                try {
                  const s = String(src || '');
                  if (!s) return false;
                  if (s.startsWith('data:') || s.startsWith('blob:')) return false;
                  const u = new URL(s, window.location.origin);
                  return u.origin === window.location.origin;
                } catch (_) {
                  return false;
                }
              })();
              return (
                <img
                  ref={cropImgRef}
                  crossOrigin={useAnon ? "anonymous" : undefined}
                  src={src}
                  alt="crop"
                  className="absolute inset-0 w-full h-full object-contain"
                  onLoad={onCropImgLoad}
                  onError={() => {
                    try { console.error('[ImageGenerateInsertModal] crop image load failed', { src }); } catch (_) {}
                    try { window.dispatchEvent(new CustomEvent('toast', { detail: { type: 'error', message: '이미지를 불러오지 못했습니다. (URL/CORS/서명 여부 확인 필요)' } })); } catch {}
                  }}
                  draggable={false}
                />
              );
            })()
          )}
          {/* 크롭 사각형 */}
          <div
            className="absolute border-2 border-purple-500 bg-purple-500/10 cursor-move select-none"
            style={{ left: `${cropRect.x}px`, top: `${cropRect.y}px`, width: `${cropRect.w}px`, height: `${cropRect.h}px` }}
            onMouseDown={onCropMouseDown}
            onPointerDown={onCropPointerDown}
          >
            {/* 리사이즈 핸들 - 네 모서리 */}
            <div
              className="absolute w-4 h-4 bg-white border-2 border-purple-500 rounded-full cursor-nw-resize"
              style={{ left: '-8px', top: '-8px' }}
              onMouseDown={(e) => onResizeHandleMouseDown(e, 'nw')}
              onPointerDown={(e) => onResizeHandlePointerDown(e, 'nw')}
            />
            <div
              className="absolute w-4 h-4 bg-white border-2 border-purple-500 rounded-full cursor-ne-resize"
              style={{ right: '-8px', top: '-8px' }}
              onMouseDown={(e) => onResizeHandleMouseDown(e, 'ne')}
              onPointerDown={(e) => onResizeHandlePointerDown(e, 'ne')}
            />
            <div
              className="absolute w-4 h-4 bg-white border-2 border-purple-500 rounded-full cursor-sw-resize"
              style={{ left: '-8px', bottom: '-8px' }}
              onMouseDown={(e) => onResizeHandleMouseDown(e, 'sw')}
              onPointerDown={(e) => onResizeHandlePointerDown(e, 'sw')}
            />
            <div
              className="absolute w-4 h-4 bg-white border-2 border-purple-500 rounded-full cursor-se-resize"
              style={{ right: '-8px', bottom: '-8px' }}
              onMouseDown={(e) => onResizeHandleMouseDown(e, 'se')}
              onPointerDown={(e) => onResizeHandlePointerDown(e, 'se')}
            />
          </div>
        </div>
        <div className="mt-3 flex items-center justify-end gap-2">
          <Button
            variant="outline"
            className="bg-gray-800 border-gray-700 text-gray-200"
            onClick={() => {
              if (cropOnly) {
                try { onClose?.(); } catch (e) { try { console.error('[ImageGenerateInsertModal] cropOnly cancel failed', e); } catch (_) {} }
              }
              setCropOpen(false);
            }}
            disabled={cropLoading}
          >
            취소
          </Button>
          <Button className="bg-purple-600 hover:bg-purple-700" onClick={applyCrop} disabled={cropLoading}>{cropLoading ? '적용 중…' : '적용'}</Button>
        </div>
      </DialogContent>
    </Dialog>
    </>
  );
};

export default ImageGenerateInsertModal;


