import React, { useEffect, useMemo, useState } from 'react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Badge } from './ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog';
import { tagsAPI } from '../lib/api';

const TagSelectModal = ({ isOpen, onClose, allTags = [], selectedSlugs = [], onSave }) => {
  const [query, setQuery] = useState('');
  const [localSelected, setLocalSelected] = useState(new Set(selectedSlugs));
  const [topTags, setTopTags] = useState([]);

  useEffect(() => {
    setLocalSelected(new Set(selectedSlugs));
  }, [selectedSlugs, isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    (async () => {
      try {
        const res = await tagsAPI.getUsedTags();
        setTopTags(res.data || []);
      } catch (_) { setTopTags([]); }
    })();
  }, [isOpen]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      // 기본 정렬: 전체 태그 + (마지막 5개는 사용량 Top5, 뒤에서 5번째가 최다 사용)
      const top = (topTags || []).slice(0, 5);
      const topSlugs = new Set(top.map(t => t.slug));
      const base = allTags.filter(t => !topSlugs.has(t.slug));
      // 뒤쪽에 top5를 역순으로 붙임 => 끝에서 5번째가 최다 사용
      const arranged = [...base, ...[...top].reverse()];
      return arranged;
    }
    return allTags.filter(t => (t.name || '').toLowerCase().includes(q) || (t.slug || '').toLowerCase().includes(q));
  }, [query, allTags, topTags]);

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
              <button key={t.id} type="button" onClick={() => toggle(t.slug)}
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


