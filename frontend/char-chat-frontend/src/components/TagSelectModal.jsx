import React, { useEffect, useMemo, useState } from 'react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Badge } from './ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog';
import { applyTagDisplayConfig } from '../lib/tagOrder';
import {
  CHARACTER_TAG_DISPLAY_CHANGED_EVENT,
  CHARACTER_TAG_DISPLAY_STORAGE_KEY,
  getCharacterTagDisplay,
  setCharacterTagDisplay,
} from '../lib/cmsTagDisplay';
import { cmsAPI } from '../lib/api';

const TagSelectModal = ({ isOpen, onClose, allTags = [], selectedSlugs = [], onSave }) => {
  const [query, setQuery] = useState('');
  const [localSelected, setLocalSelected] = useState(new Set(selectedSlugs));
  const [tagDisplay, setTagDisplay] = useState(() => {
    try { return getCharacterTagDisplay(); } catch (_) { return {}; }
  });

  useEffect(() => {
    setLocalSelected(new Set(selectedSlugs));
  }, [selectedSlugs, isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    try { setTagDisplay(getCharacterTagDisplay()); } catch (_) {}
  }, [isOpen]);

  // ✅ 운영 SSOT: 서버(DB)의 태그 노출/순서 설정을 모달 오픈 시점에도 동기화한다.
  // - 홈을 거치지 않고(직접 진입) 모달을 여는 경우에도 숨김/순서 설정이 적용되도록 방어한다.
  useEffect(() => {
    if (!isOpen) return;
    let active = true;
    (async () => {
      try {
        const res = await cmsAPI.getCharacterTagDisplay();
        if (!active) return;
        const cfg = (res && res.data && typeof res.data === 'object') ? res.data : null;
        if (!cfg) return;
        try { setCharacterTagDisplay(cfg); } catch (_) {}
        try { setTagDisplay(getCharacterTagDisplay()); } catch (_) {}
      } catch (e) {
        try { console.warn('[TagSelectModal] cmsAPI.getCharacterTagDisplay failed:', e); } catch (_) {}
      }
    })();
    return () => { active = false; };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const refresh = () => {
      try { setTagDisplay(getCharacterTagDisplay()); } catch (_) {}
    };
    const onStorage = (e) => {
      try {
        if (!e) return;
        if (e.key === CHARACTER_TAG_DISPLAY_STORAGE_KEY) refresh();
      } catch (_) {}
    };
    try { window.addEventListener(CHARACTER_TAG_DISPLAY_CHANGED_EVENT, refresh); } catch (_) {}
    try { window.addEventListener('storage', onStorage); } catch (_) {}
    return () => {
      try { window.removeEventListener(CHARACTER_TAG_DISPLAY_CHANGED_EVENT, refresh); } catch (_) {}
      try { window.removeEventListener('storage', onStorage); } catch (_) {}
    };
  }, [isOpen]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = Array.isArray(allTags) ? allTags : [];
    const arranged = applyTagDisplayConfig(base, tagDisplay);
    if (!q) return arranged;
    // 검색 시에도 우선순위 정렬을 유지한 채 필터링
    return arranged.filter(
      (t) =>
        String(t?.name || '').toLowerCase().includes(q) ||
        String(t?.slug || '').toLowerCase().includes(q)
    );
  }, [query, allTags, tagDisplay]);

  const toggle = (slug) => {
    setLocalSelected(prev => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug); else next.add(slug);
      return next;
    });
  };

  const handleSave = () => {
    onSave(Array.from(localSelected));
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>태그 선택</DialogTitle>
        </DialogHeader>

        {/* 검색 */}
        <div className="mb-3">
          <Input value={query} onChange={(e)=>setQuery(e.target.value)} placeholder="태그 검색 (이름/슬러그)" />
        </div>

        {/* 태그 목록 (마지막 5개 = 사용량 Top5) */}
        <div className="max-h-80 overflow-auto border rounded-md p-3">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {filtered.map(t => (
              <button key={t.id || t.slug} type="button" onClick={() => toggle(t.slug)}
                className={`text-left px-3 py-1 rounded-full border ${localSelected.has(t.slug) ? 'bg-purple-600 text-white border-purple-500' : 'bg-gray-100 text-gray-800 border-gray-300'}`}>
                {t.name}
              </button>
            ))}
          </div>
        </div>

        {/* 선택된 태그 */}
        <div className="mt-3">
          <div className="text-sm text-gray-500 mb-2">선택된 태그</div>
          <div className="flex flex-wrap gap-2">
            {Array.from(localSelected).map(slug => {
              const t = allTags.find(x => x.slug === slug);
              return (
                <Badge key={slug} className="bg-purple-600 hover:bg-purple-600">{t?.name || slug}</Badge>
              );
            })}
            {localSelected.size === 0 && <span className="text-sm text-gray-400">아직 선택 없음</span>}
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-4">
          <Button variant="outline" onClick={onClose}>취소</Button>
          <Button onClick={handleSave} className="bg-purple-600 hover:bg-purple-700">선택</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default TagSelectModal;


