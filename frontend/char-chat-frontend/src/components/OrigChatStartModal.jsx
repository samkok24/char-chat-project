import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog';
import { Button } from './ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { charactersAPI, origChatAPI, storiesAPI } from '../lib/api';
import { useNavigate } from 'react-router-dom';
import { resolveImageUrl } from '../lib/images';

const OrigChatStartModal = ({ open, onClose, storyId, totalChapters = 1, lastReadNo = 0 }) => {
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [rangeMode, setRangeMode] = useState('multi');
  const [fromNo, setFromNo] = useState('1');
  const [toNo, setToNo] = useState('1');
  const [starting, setStarting] = useState(false);
  const [toast, setToast] = useState({ show: false, type: 'success', message: '' });
  const [preview, setPreview] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [activeImg, setActiveImg] = useState('');
  const gallery = useMemo(() => {
    const list = [];
    if (preview?.avatar_url) list.push(preview.avatar_url);
    const imgs = Array.isArray(preview?.image_descriptions) ? preview.image_descriptions.map(x => x.url).filter(Boolean) : [];
    for (const u of imgs) if (!list.includes(u)) list.push(u);
    return list;
  }, [preview]);

  useEffect(() => {
    if (!open) return;
    const run = async () => {
      setLoading(true);
      try {
        const r = await storiesAPI.getExtractedCharacters(storyId);
        const list = Array.isArray(r.data?.items) ? r.data.items : [];
        // 후보: character_id 존재한 항목만
        let candidates = list.filter((c) => !!c.character_id);
        // 공개 캐릭터 필터(실패 시 전체 허용)
        try {
          const details = await Promise.all(candidates.map(async (c) => {
            try {
              const d = await charactersAPI.getCharacter(c.character_id);
              return { ok: true, id: c.id, is_public: !!d.data?.is_public };
            } catch (_) { return { ok: false, id: c.id, is_public: true }; }
          }));
          const allowed = new Set(details.filter(d => d.ok && d.is_public).map(d => d.id));
          const atLeastOneOk = details.some(d => d.ok);
          if (atLeastOneOk) {
            candidates = candidates.filter(c => allowed.has(c.id));
          }
        } catch (_) {}
        setItems(candidates);
      } catch (_) {
        setItems([]);
      } finally {
        setLoading(false);
      }
    };
    run();
  }, [open, storyId]);

  useEffect(() => {
    if (!open) return;
    try {
      const key = `origchat:range:${storyId}`;
      const saved = JSON.parse(localStorage.getItem(key) || 'null');
      if (saved && saved.from && saved.to) {
        setFromNo(String(Math.min(Math.max(1, Number(saved.from)||1), totalChapters)));
        setToNo(String(Math.min(Math.max(1, Number(saved.to)||1), totalChapters)));
        return;
      }
    } catch (_) {}
    const defFrom = '1';
    const defTo = String(Math.min(totalChapters, lastReadNo > 0 ? lastReadNo : totalChapters));
    setFromNo(defFrom);
    setToNo(defTo);
  }, [open, storyId, totalChapters, lastReadNo]);

  const disabledOthers = !!selectedId;
  const itemRefs = useRef([]);

  const handleGridKeyDown = (e) => {
    const key = e.key;
    const idx = Number(e.target?.dataset?.idx ?? -1);
    if (Number.isNaN(idx) || idx < 0) return;
    if (key === 'ArrowRight' || key === 'ArrowLeft') {
      e.preventDefault();
      const next = key === 'ArrowRight' ? idx + 1 : idx - 1;
      const el = itemRefs.current[next];
      if (el && typeof el.focus === 'function') el.focus();
    } else if (key === 'Enter' || key === ' ') {
      e.preventDefault();
      const id = items[idx]?.character_id;
      if (!id) return;
      setSelectedId((cur) => (cur === id ? null : id));
    }
  };

  // 선택된 캐릭터 상세 프리페치 → 미리보기 데이터 구성
  useEffect(() => {
    const load = async () => {
      if (!selectedId) { setPreview(null); setActiveImg(''); return; }
      setPreviewLoading(true);
      try {
        const res = await charactersAPI.getCharacter(selectedId);
        const ch = res.data || null;
        setPreview(ch);
        const main = ch?.avatar_url || (Array.isArray(ch?.image_descriptions) && ch.image_descriptions[0]?.url) || '';
        setActiveImg(main || '');
      } catch (_) {
        setPreview(null);
        setActiveImg('');
      } finally {
        setPreviewLoading(false);
      }
    };
    load();
  }, [selectedId]);

  const startChat = async () => {
    const vibrate = (pattern = [40, 80, 40]) => { try { if (navigator?.vibrate) navigator.vibrate(pattern); } catch (_) {} };
    if (!selectedId) {
      vibrate();
      setToast({ show: true, type: 'error', message: '캐릭터를 선택하세요' });
      return;
    }
    const fRaw = Number(fromNo);
    const tRaw = rangeMode === 'single' ? Number(fromNo) : Number(toNo);
    if (!Number.isInteger(fRaw) || !Number.isInteger(tRaw) || fRaw < 1 || tRaw < 1 || fRaw > tRaw || fRaw > totalChapters || tRaw > totalChapters) {
      vibrate();
      setToast({ show: true, type: 'error', message: '유효한 회차 범위를 선택하세요' });
      return;
    }
    const f = Math.max(1, fRaw);
    const t = Math.max(f, tRaw);
    const cappedF = Math.min(f, totalChapters);
    const cappedT = Math.min(t, totalChapters);
    try {
      setStarting(true);
      try { localStorage.setItem(`origchat:range:${storyId}`, JSON.stringify({ from: cappedF, to: cappedT })); } catch (_) {}
      await origChatAPI.getContextPack(storyId, { anchor: cappedF, characterId: selectedId, rangeFrom: cappedF, rangeTo: cappedT });
      const startRes = await origChatAPI.start({ story_id: storyId, character_id: selectedId, chapter_anchor: cappedF, timeline_mode: 'fixed', range_from: cappedF, range_to: cappedT });
      const roomId = startRes.data?.id || startRes.data?.room_id;
      onClose?.();
      if (roomId) navigate(`/ws/chat/${selectedId}?source=origchat&storyId=${storyId}&anchor=${cappedF}&rangeFrom=${cappedF}&rangeTo=${cappedT}`);
      else navigate(`/ws/chat/${selectedId}`);
    } catch (e) {
      vibrate();
      setToast({ show: true, type: 'error', message: '원작챗 시작 실패' });
    } finally {
      setStarting(false);
    }
  };

  if (!open) return null;
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="bg-gray-900 text-white border border-gray-700 w-[92vw] max-w-5xl md:max-w-6xl" aria-describedby="orig-start-desc">
        <DialogHeader>
          <DialogTitle className="text-white">원작챗 시작</DialogTitle>
          <div id="orig-start-desc" className="sr-only">원작 기반 채팅을 시작할 캐릭터와 회차 범위를 선택하세요.</div>
        </DialogHeader>
        <div className="space-y-5 max-h-[70vh] overflow-auto pr-1">
          {/* 그리드: 먼저 캐릭터를 선택 */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 max-h-[60vh] overflow-auto pr-1" role="listbox" aria-label="등장인물 목록" onKeyDown={handleGridKeyDown}>
            {loading && Array.from({ length: 8 }).map((_, i) => (
              <div key={`sk-${i}`} className="h-32 bg-gray-800/40 border border-gray-700 rounded-md" />
            ))}
            {!loading && items.map((c, idx) => {
              const selected = selectedId === c.character_id;
              return (
                <div
                  key={c.id}
                  className={`relative bg-gray-800/40 border rounded-xl p-4 ${selected ? 'border-orange-500' : 'border-gray-700'} ${disabledOthers && !selected ? 'opacity-50 pointer-events-none' : ''}`}
                  role="option"
                  aria-selected={selected}
                >
                  <div className="flex items-center gap-4">
                    {c.avatar_url ? (
                      <img src={c.avatar_url} alt={c.name} className="w-14 h-14 rounded-full object-cover" />
                    ) : (
                      <div className="w-14 h-14 rounded-full bg-orange-500 text-black flex items-center justify-center text-base font-bold">
                        {(c.initial || (c.name||'')[0] || 'C')}
                      </div>
                    )}
                    <div>
                      <div className="text-white font-semibold text-base">{c.name}</div>
                      <div className="text-sm text-gray-400 line-clamp-2">{c.description || ''}</div>
                    </div>
                  </div>
                  <button
                    type="button"
                    className={`absolute top-2 right-2 w-7 h-7 rounded ${selected ? 'bg-orange-500 text-black' : 'bg-black/60 text-white'} flex items-center justify-center border border-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900`}
                    onClick={() => setSelectedId(selected ? null : c.character_id)}
                    ref={(el) => { itemRefs.current[idx] = el; }}
                    data-idx={idx}
                    aria-pressed={selected}
                    aria-label={`${c.name} 선택`}
                  >
                    {selected ? '✓' : '+'}
                  </button>
                </div>
              );
            })}
            {!loading && items.length === 0 && (
              <div className="col-span-2 md:col-span-3 lg:col-span-4 text-center text-gray-400 py-6">선택 가능한 등장인물이 없습니다.</div>
            )}
          </div>

          {/* 미리보기 패널: 선택 후 정보 확인 */}
          <div className="bg-gray-800/40 border border-gray-700 rounded-xl p-3">
            {selectedId ? (
              <div className="grid grid-cols-1 lg:grid-cols-[320px_minmax(0,1fr)] gap-4">
                {/* 대표 이미지 + 썸네일 */}
                <div>
                  <div className="relative w-full rounded-lg overflow-hidden border border-gray-700" style={{ paddingTop: '100%' }}>
                    {activeImg ? (
                      <img src={resolveImageUrl(activeImg) || activeImg} alt={preview?.name || ''} className="absolute inset-0 w-full h-full object-cover" />
                    ) : (
                      <div className="absolute inset-0 flex items-center justify-center text-gray-500">NO IMAGE</div>
                    )}
                  </div>
                  {gallery.length > 1 && (
                    <div className="flex gap-2 overflow-x-auto pt-2">
                      {gallery.map((u, i) => (
                        <button
                          key={`thumb-${i}`}
                          type="button"
                          onClick={() => setActiveImg(u)}
                          className={`flex-shrink-0 rounded-md overflow-hidden border ${activeImg===u?'border-purple-500':'border-gray-700'} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900`}
                          aria-label={`썸네일 ${i+1}`}
                        >
                          <img src={resolveImageUrl(u) || u} alt={`thumb-${i+1}`} className="w-14 h-14 object-cover" />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                {/* 텍스트 정보 */}
                <div className="space-y-2 min-w-0">
                  <div className="text-white font-semibold text-lg truncate">{preview?.name || '캐릭터'}</div>
                  {previewLoading ? (
                    <div className="h-16 bg-gray-800/60 rounded" />
                  ) : (
                    <>
                      <div className="text-sm text-gray-300 whitespace-pre-wrap">{preview?.description || '소개 정보가 없습니다.'}</div>
                      {/* 상세 필드 */}
                      {preview?.world_setting && (
                        <div className="text-sm"><span className="text-purple-400 drop-shadow-[0_0_6px_rgba(168,85,247,0.6)]">세계관</span> <span className="text-gray-200">{preview.world_setting}</span></div>
                      )}
                      {preview?.personality && (
                        <div className="text-sm"><span className="text-purple-400 drop-shadow-[0_0_6px_rgba(168,85,247,0.6)]">성격</span> <span className="text-gray-200">{preview.personality}</span></div>
                      )}
                      {preview?.speech_style && (
                        <div className="text-sm"><span className="text-purple-400 drop-shadow-[0_0_6px_rgba(168,85,247,0.6)]">말투</span> <span className="text-gray-200">{preview.speech_style}</span></div>
                      )}
                      {preview?.greeting && (
                        <div className="text-sm"><span className="text-purple-400 drop-shadow-[0_0_6px_rgba(168,85,247,0.6)]">인사</span> <span className="text-gray-200">{preview.greeting}</span></div>
                      )}
                      {preview?.background_story && (
                        <div className="text-sm"><span className="text-gray-400">배경</span> <span className="text-gray-200">{preview.background_story}</span></div>
                      )}
                    </>
                  )}
                </div>
              </div>
            ) : (
              <div className="text-gray-400 text-sm">그리드에서 캐릭터를 선택하면 미리보기가 표시됩니다.</div>
            )}
          </div>

          {/* 범위 */}
          <div className="space-y-2 pb-24">
            <div className="text-sm text-gray-300">회차 범위를 선택하세요 (예: 1~6, 4~35)</div>
            <div className="text-xs text-gray-400">마지막까지 본 회차는 {lastReadNo > 0 ? `${lastReadNo}화` : '없습니다'}.</div>
            <div className="flex items-center gap-3 pt-1">
              <button
                type="button"
                onClick={()=>{ setRangeMode('multi'); setToNo((v)=> v || fromNo); }}
                aria-pressed={rangeMode==='multi'}
                className={`px-3 py-1 rounded-full border ${rangeMode==='multi' ? 'bg-purple-600 text-white border-purple-500' : 'bg-gray-800 text-gray-300 border-gray-700'} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900`}
              >여러 회차(기본)</button>
              <button
                type="button"
                onClick={()=>{ setRangeMode('single'); setToNo(fromNo); }}
                aria-pressed={rangeMode==='single'}
                className={`px-3 py-1 rounded-full border ${rangeMode==='single' ? 'bg-purple-600 text-white border-purple-500' : 'bg-gray-800 text-gray-300 border-gray-700'} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900`}
              >단일 회차</button>
            </div>
            <div className="flex items-center gap-2">
              <Select value={fromNo} onValueChange={(v)=>{ setFromNo(v); if(rangeMode==='single') setToNo(v); try { localStorage.setItem(`origchat:range:${storyId}`, JSON.stringify({ from: v, to: (rangeMode==='single'? v : toNo) })); } catch(_){} }}>
                <SelectTrigger className="w-28 bg-gray-800 border-gray-700"><SelectValue placeholder="From" /></SelectTrigger>
                <SelectContent className="bg-gray-800 text-white border-gray-700 max-h-64 overflow-auto">
                  {Array.from({ length: Math.max(1, totalChapters) }).map((_, i) => (
                    <SelectItem key={`f-${i+1}`} value={`${i+1}`}>{i+1}화</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <span className="text-gray-400">~</span>
              <Select value={toNo} onValueChange={(v)=>{ setToNo(v); try { localStorage.setItem(`origchat:range:${storyId}`, JSON.stringify({ from: fromNo, to: v })); } catch(_){} }} disabled={rangeMode==='single'}>
                <SelectTrigger className={`w-28 border ${rangeMode==='single' ? 'bg-gray-800/50 border-gray-700 opacity-70 cursor-not-allowed' : 'bg-gray-800 border-gray-700'}`}><SelectValue placeholder="To" /></SelectTrigger>
                <SelectContent className="bg-gray-800 text-white border-gray-700 max-h-64 overflow-auto">
                  {Array.from({ length: Math.max(1, totalChapters) }).map((_, i) => (
                    <SelectItem key={`t-${i+1}`} value={`${i+1}`}>{i+1}화</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* 고정 버튼 바 */}
          <div className="sticky bottom-0 left-0 right-0 bg-gray-900/95 backdrop-blur border-t border-gray-800 -mx-3 px-3 py-3 flex items-center justify-between">
            <div className="text-sm text-gray-300 truncate">
              {selectedId ? (
                <>
                  <span className="text-gray-400">선택:</span> <span className="text-white font-medium">{items.find(i=>i.character_id===selectedId)?.name || '캐릭터'}</span>
                  <span className="mx-2">·</span>
                  <span className="text-gray-400">범위:</span> <span className="text-white">{rangeMode==='single' ? `${fromNo}화` : `${fromNo}~${toNo}화`}</span>
                </>
              ) : <span className="text-gray-500">캐릭터를 선택하세요</span>}
            </div>
            <div className="flex items-center gap-2">
              <Button variant="ghost" onClick={onClose} className="text-gray-300 hover:text-white">취소</Button>
              <Button className="bg-purple-600 hover:bg-purple-700" disabled={!selectedId || starting} onClick={startChat}>
                {starting ? '시작 중...' : '이 캐릭터와 원작챗 시작'}
              </Button>
            </div>
          </div>
        </div>
        {toast.show && (
          <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 px-4 py-2 rounded-md text-sm shadow-lg ${toast.type==='success' ? 'bg-green-600 text-white' : 'bg-red-600 text-white'}`}>
            {toast.message}
            <button className="ml-3 text-white/80 hover:text-white" onClick={()=> setToast({ show: false, type: 'success', message: '' })}>닫기</button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default OrigChatStartModal;


