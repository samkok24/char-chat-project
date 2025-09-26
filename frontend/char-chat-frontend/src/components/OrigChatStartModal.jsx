import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from './ui/dialog';
import { RefreshCw } from 'lucide-react';
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
  // 모드 선택: canon | parallel | plain(일대일 일반 챗)
  const [modeSel, setModeSel] = useState('canon');
  // 시작 옵션/미리보기
  const [startOpts, setStartOpts] = useState(null);
  const [optsLoading, setOptsLoading] = useState(false);
  const [selectedScene, setSelectedScene] = useState({ chapter: null, scene_id: null });
  const [sceneChap, setSceneChap] = useState(null);
  const [recap, setRecap] = useState('');
  const [sceneExcerpt, setSceneExcerpt] = useState('');
  const [narratorMode, setNarratorMode] = useState(false);
  const [selectedSeed, setSelectedSeed] = useState(null);
  // 시점 선택: possess(선택 캐릭터 빙의) | persona(내 페르소나)
  const [povMode, setPovMode] = useState('possess');
  // 사전 준비(프리워밍) 상태
  const [preparing, setPreparing] = useState(false);
  const [prepReady, setPrepReady] = useState(false);
  const [prepEtaSec, setPrepEtaSec] = useState(0);
  const [prepKeys, setPrepKeys] = useState([]);
  const prepTimerRef = useRef(null);
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
        // 시작 옵션 불러오기(개요/씬 인덱스/추천/씨앗)
        setOptsLoading(true);
        try {
          const so = await storiesAPI.getStartOptions(storyId);
          setStartOpts(so.data || null);
          // 추천 1순위를 기본 선택 장면으로 세팅
          const top = (so.data?.top_candidates || [])[0];
          if (top && typeof top.chapter === 'number') {
            setSelectedScene({ chapter: top.chapter, scene_id: top.scene_id || null });
            setSceneChap(top.chapter);
          } else {
            setSceneChap(null);
          }
        } catch (_) { setStartOpts(null); }
        finally { setOptsLoading(false); }

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
  // 선택 장면 변경 시 리캡/발췌 미리보기
  useEffect(() => {
    const load = async () => {
      if (!open) return;
      const chap = selectedScene?.chapter;
      if (!chap) { setRecap(''); setSceneExcerpt(''); return; }
      try {
        const [r1, r2] = await Promise.all([
          storiesAPI.getBackwardRecap ? storiesAPI.getBackwardRecap(storyId, chap) : Promise.resolve({ data: { recap: '' } }),
          storiesAPI.getSceneExcerpt ? storiesAPI.getSceneExcerpt(storyId, chap, selectedScene?.scene_id || null) : Promise.resolve({ data: { excerpt: '' } }),
        ]);
        setRecap(r1.data?.recap || '');
        setSceneExcerpt(r2.data?.excerpt || '');
      } catch (_) { setRecap(''); setSceneExcerpt(''); }
    };
    load();
  }, [open, storyId, selectedScene]);

  // fromNo 변경 시, 해당 화의 첫 번째 장면을 기본 선택
  useEffect(() => {
    try {
      if (!startOpts) return;
      const list = (startOpts.chapter_scene_index||[]);
      if (!list.length) return;
      const chapNo = Number(fromNo||'1');
      const ch = list.find(it => Number(it.no) === chapNo) || list[0];
      if (!ch) return;
      if (selectedScene?.chapter === ch.no) return;
      const first = (ch.scenes||[])[0];
      setSelectedScene({ chapter: ch.no, scene_id: first ? first.id : null });
    } catch (_) {}
  }, [startOpts, fromNo]);

  // 사전 준비(컨텍스트/요약/문체/인트로) 트리거 + 폴링
  useEffect(() => {
    if (!open) return;
    // 원작 모드가 아닐 땐 준비 불필요
    const isOrigMode = modeSel !== 'plain';
    if (!isOrigMode) { setPreparing(false); setPrepReady(true); return; }
    if (!selectedId) { setPreparing(false); setPrepReady(false); return; }
    const anchorNo = Number(fromNo || '1');
    const sceneId = selectedScene?.scene_id || null;
    // ETA 대략치: 기본 2초 + (범위 길이 * 0.5초)
    let span = 1;
    try {
      const f = Number(fromNo || '1');
      const t = rangeMode === 'single' ? f : Number(toNo || f);
      span = Math.max(1, (t - f + 1));
    } catch (_) {}
    const eta = Math.min(12, Math.max(2, 2 + span * 0.5));
    setPrepEtaSec(Math.round(eta));

    // 트리거(백엔드가 준비 작업 시작)
    (async () => {
      try {
        await origChatAPI.getContextPack(storyId, { anchor: anchorNo, characterId: selectedId, rangeFrom: Number(fromNo||'1'), rangeTo: rangeMode==='single'? Number(fromNo||'1') : Number(toNo||fromNo||'1'), sceneId });
      } catch (_) {}
      setPreparing(true);
      setPrepReady(false);
      setPrepKeys([]);
      // 폴링 시작
      if (prepTimerRef.current) { try { clearInterval(prepTimerRef.current); } catch(_){} }
      prepTimerRef.current = setInterval(async () => {
        try {
          const res = await storiesAPI.getContextStatus(storyId);
          const warmed = Boolean(res?.data?.warmed);
          const keys = Array.isArray(res?.data?.updated) ? res.data.updated : [];
          setPrepKeys(keys);
          if (warmed) {
            setPrepReady(true);
            setPreparing(false);
            clearInterval(prepTimerRef.current);
            prepTimerRef.current = null;
          }
        } catch (_) {}
      }, 1200);
    })();
    return () => { if (prepTimerRef.current) { try { clearInterval(prepTimerRef.current); } catch(_){} prepTimerRef.current = null; } };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, selectedId, fromNo, toNo, rangeMode, selectedScene?.scene_id, modeSel]);


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
        const mainRaw = ch?.avatar_url || (Array.isArray(ch?.image_descriptions) && ch.image_descriptions[0]?.url) || '';
        const main = (()=>{
          if (!mainRaw) return '';
          const resolved = resolveImageUrl(mainRaw) || mainRaw;
          return `${resolved}${resolved.includes('?') ? '&' : '?'}v=${Date.now()}`;
        })();
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
    const isOrigMode = modeSel !== 'plain';
    let cappedF = 1, cappedT = 1;
    if (isOrigMode) {
      const fRaw = Number(fromNo);
      const tRaw = rangeMode === 'single' ? Number(fromNo) : Number(toNo);
      if (!Number.isInteger(fRaw) || !Number.isInteger(tRaw) || fRaw < 1 || tRaw < 1 || fRaw > tRaw || fRaw > totalChapters || tRaw > totalChapters) {
        vibrate();
        setToast({ show: true, type: 'error', message: '유효한 회차 범위를 선택하세요' });
        return;
      }
      const f = Math.max(1, fRaw);
      const t = Math.max(f, tRaw);
      cappedF = Math.min(f, totalChapters);
      cappedT = Math.min(t, totalChapters);
    }
    try {
      setStarting(true);
      if (!isOrigMode) {
        // 일반 일대일 챗 시작
        const res = await chatAPI.startChat(selectedId);
        const roomId = res.data?.id || res.data?.room_id;
        onClose?.();
        navigate(`/ws/chat/${selectedId}`);
        return;
      }
      // 원작챗 시작(canon/parallel)
      try { localStorage.setItem(`origchat:range:${storyId}`, JSON.stringify({ from: cappedF, to: cappedT })); } catch (_) {}
      // 사전 준비는 이미 진행 중이나, 안전을 위해 한 번 더 트리거
      await origChatAPI.getContextPack(storyId, { anchor: cappedF, characterId: selectedId, rangeFrom: cappedF, rangeTo: cappedT, sceneId: selectedScene?.scene_id || null });
      const payload = { story_id: storyId, character_id: selectedId, mode: modeSel, start: { chapter: cappedF, scene_id: selectedScene?.scene_id || null }, range_from: cappedF, range_to: cappedT, focus_character_id: selectedId, narrator_mode: narratorMode, pov: povMode };
      if (modeSel==='parallel' && selectedSeed && selectedSeed.label) { payload.start.seed_label = selectedSeed.label; }
      const startRes = await origChatAPI.start(payload);
      const roomId = startRes.data?.id || startRes.data?.room_id;
      onClose?.();
      if (roomId) navigate(`/ws/chat/${selectedId}?source=origchat&storyId=${storyId}&anchor=${cappedF}&rangeFrom=${cappedF}&rangeTo=${cappedT}&room=${roomId}`);
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
      <DialogContent className="bg-gray-900 text-white border border-gray-700 w-[92vw] max-w-5xl md:max-w-6xl">
        <DialogHeader>
          <DialogTitle className="text-white">원작챗 시작</DialogTitle>
          <DialogDescription className="sr-only">원작 기반 채팅을 시작할 캐릭터와 회차 범위를 선택하세요.</DialogDescription>
        </DialogHeader>
        <div className="space-y-5 max-h-[70vh] overflow-auto pr-1">
          {/* 모드 선택: 제목 바로 아래 */}
          <div className="space-y-2">
            <div className="text-sm text-gray-300">모드를 선택하세요</div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={()=> { setModeSel('parallel'); }}
                aria-pressed={modeSel==='parallel'}
                className={`px-3 py-1 rounded-full border ${modeSel==='parallel' ? 'bg-white text-black border-white' : 'bg-gray-800 text-gray-300 border-gray-700'}`}
              >내맘대로 전개(평행세계)</button>
              <button
                type="button"
                onClick={()=> { setModeSel('canon'); setNarratorMode(false); }}
                aria-pressed={modeSel==='canon'}
                className={`px-3 py-1 rounded-full border ${modeSel==='canon' ? 'bg-white text-black border-white' : 'bg-gray-800 text-gray-300 border-gray-700'}`}
              >원작대로 전개</button>
              <button
                type="button"
                onClick={()=> { setModeSel('plain'); setNarratorMode(false); }}
                aria-pressed={modeSel==='plain'}
                className={`px-3 py-1 rounded-full border ${modeSel==='plain' ? 'bg-white text-black border-white' : 'bg-gray-800 text-gray-300 border-gray-700'}`}
              >그냥 일대일 채팅</button>
            </div>
          </div>

          {/* 장면 선택 (범위 아래로 이동) → 아래 범위 섹션 후 표시됨 */}

          {/* 그리드: 관전가(서술자) + 캐릭터 선택 */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 max-h-[60vh] overflow-auto pr-1" role="listbox" aria-label="등장인물 목록" onKeyDown={handleGridKeyDown}>
            {loading && Array.from({ length: 8 }).map((_, i) => (
              <div key={`sk-${i}`} className="h-32 bg-gray-800/40 border border-gray-700 rounded-md" />
            ))}
            {!loading && (
              <div
                key="observer-tile"
                className={`relative bg-gray-800/40 border rounded-xl p-4 ${modeSel==='parallel' ? 'cursor-pointer' : 'opacity-50 cursor-not-allowed'} ${narratorMode ? 'border-orange-500' : 'border-gray-700'}`}
                role="option"
                aria-selected={narratorMode}
                aria-disabled={modeSel!=='parallel'}
                onClick={() => { if (modeSel !== 'parallel') return; setNarratorMode(!narratorMode); }}
              >
                <div className="flex items-center gap-4">
                  <div className="w-14 h-14 rounded-full bg-white text-black flex items-center justify-center text-base font-bold">觀</div>
                  <div>
                    <div className="text-white font-semibold text-base">관전가(서술자)</div>
                    <div className="text-sm text-gray-400 line-clamp-2">유저는 서술/묘사 입력, AI는 인물 대사/행동 진행</div>
                  </div>
                </div>
                <div className={`absolute top-2 right-2 w-7 h-7 rounded ${narratorMode ? 'bg-orange-500 text-black' : 'bg-black/60 text-white'} flex items-center justify-center border border-white/20`}>{narratorMode ? '✓' : ' '}</div>
              </div>
            )}
            {!loading && items.map((c, idx) => {
              const selected = selectedId === c.character_id;
              return (
                <div
                  key={c.id}
                  className={`relative bg-gray-800/40 border rounded-xl p-4 cursor-pointer ${selected ? 'border-orange-500' : 'border-gray-700'} ${disabledOthers && !selected ? 'opacity-60' : ''}`}
                  role="option"
                  aria-selected={selected}
                  onClick={() => setSelectedId(selected ? null : c.character_id)}
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
                    onClick={(e) => { e.stopPropagation(); setSelectedId(selected ? null : c.character_id); }}
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

          {/* 포커스 캐릭터: 선택 캐릭터로 자동 설정 (UI 제거) */}

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
              <Select value={fromNo} onValueChange={(v)=>{ setFromNo(v); if(rangeMode==='single') setToNo(v); try { localStorage.setItem(`origchat:range:${storyId}`, JSON.stringify({ from: v, to: (rangeMode==='single'? v : toNo) })); } catch(_){} }} disabled={modeSel==='plain'}>
                <SelectTrigger className={`w-28 border ${modeSel==='plain' ? 'bg-gray-800/50 border-gray-700 opacity-70 cursor-not-allowed' : 'bg-gray-800 border-gray-700'}`}><SelectValue placeholder="From" /></SelectTrigger>
                <SelectContent className="bg-gray-800 text-white border-gray-700 max-h-64 overflow-auto">
                  {Array.from({ length: Math.max(1, totalChapters) }).map((_, i) => (
                    <SelectItem key={`f-${i+1}`} value={`${i+1}`}>{i+1}화</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <span className="text-gray-400">~</span>
              <Select value={toNo} onValueChange={(v)=>{ setToNo(v); try { localStorage.setItem(`origchat:range:${storyId}`, JSON.stringify({ from: fromNo, to: v })); } catch(_){} }} disabled={rangeMode==='single' || modeSel==='plain'}>
                <SelectTrigger className={`w-28 border ${(rangeMode==='single' || modeSel==='plain') ? 'bg-gray-800/50 border-gray-700 opacity-70 cursor-not-allowed' : 'bg-gray-800 border-gray-700'}`}><SelectValue placeholder="To" /></SelectTrigger>
                <SelectContent className="bg-gray-800 text-white border-gray-700 max-h-64 overflow-auto">
                  {Array.from({ length: Math.max(1, totalChapters) }).map((_, i) => (
                    <SelectItem key={`t-${i+1}`} value={`${i+1}`}>{i+1}화</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* 시점 선택 (범위와 장면 사이) */}
          <div className="bg-gray-800/40 border border-gray-700 rounded-xl p-3">
            <div className="text-sm text-gray-300 mb-2">시점/진행 방식 선택</div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={()=> setPovMode('possess')}
                aria-pressed={povMode==='possess'}
                className={`px-3 py-1 rounded-full border ${povMode==='possess' ? 'bg-white text-black border-white' : 'bg-gray-900 text-gray-200 border-gray-700'}`}
              >{(preview?.name || (items.find(i=>i.character_id===selectedId)?.name) || '선택 캐릭터')}에 빙의해 진행</button>
              <button
                type="button"
                onClick={()=> setPovMode('persona')}
                aria-pressed={povMode==='persona'}
                className={`px-3 py-1 rounded-full border ${povMode==='persona' ? 'bg-white text-black border-white' : 'bg-gray-900 text-gray-200 border-gray-700'}`}
              >내 페르소나를 살려 진행</button>
            </div>
          </div>

          {/* 장면 선택: 범위 From 기준 2~4개 탭 + 장면 발췌 미리보기 */}
          {startOpts && (
            <div className="bg-gray-800/40 border border-gray-700 rounded-xl p-3">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-sm text-gray-300">시작 장면을 선택하세요</span>
                <button
                  type="button"
                  aria-label="다음 화"
                  className="p-1 text-gray-300 rounded focus-visible:outline-none"
                  onClick={() => {
                    const f = Number(fromNo||'1');
                    const last = (startOpts.chapter_scene_index||[]).slice(-1)[0]?.no || 1;
                    const nf = Math.min(f + 1, last);
                    setFromNo(String(nf));
                    if (rangeMode==='single') setToNo(String(nf));
                  }}
                >
                  <RefreshCw className="w-4 h-4" />
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                {(() => {
                  const list = (startOpts.chapter_scene_index||[]);
                  const chapNo = Number(fromNo||'1');
                  const ch = list.find(it => Number(it.no) === chapNo) || list[0];
                  const raw = (ch?.scenes||[]);
                  const shown = raw.slice(0, 4);
                  if (shown.length < 2) {
                    shown.push({ id: `auto-${ch?.no||chapNo}-base`, title: '장 전체', hint: '이 화의 도입부터', __base: true });
                  }
                  return shown.map((sc) => {
                    const isBase = !!sc.__base;
                    const picked = selectedScene?.chapter===ch.no && String(selectedScene?.scene_id||'')===String(isBase? '': sc.id);
                    const baseText = isBase ? '이 화의 도입부터' : (String(sc.hint || '').replace(/\s+/g, ' ').trim() || '장면');
                    const full = `${baseText} 하는 장면`;
                    const shortBase = baseText.length > 15 ? (baseText.slice(0, 15) + '…') : baseText;
                    const short = `${shortBase} 하는 장면`;
                    return (
                      <button key={`${sc.id||'base'}`} type="button" title={full} onClick={() => setSelectedScene({ chapter: ch.no, scene_id: isBase? null : sc.id })} className={`px-2 py-1 rounded border text-xs ${picked? 'bg-white text-black border-white':'bg-gray-900 text-gray-200 border-gray-700'}`}>{short}</button>
                    );
                  });
                })()}
              </div>
              {Boolean(sceneExcerpt) && (
                <div className="mt-3 text-xs text-gray-300 whitespace-pre-wrap max-h-40 overflow-auto pr-1">
                  {sceneExcerpt}
                </div>
              )}
            </div>
          )}

          {/* 고정 버튼 바 */}
          <div className="sticky bottom-0 left-0 right-0 bg-gray-900/95 backdrop-blur border-t border-gray-800 -mx-3 px-3 py-3 flex items-center justify-between">
            <div className="text-sm text-gray-300 truncate">
              {selectedId ? (
                <>
                  <span className="text-gray-400">선택:</span> <span className="text-white font-medium">{items.find(i=>i.character_id===selectedId)?.name || '캐릭터'} {povMode==='possess' ? '' : '(페르소나)'}</span>
                  <span className="mx-2">·</span>
                  <span className="text-gray-400">범위:</span> <span className="text-white">{rangeMode==='single' ? `${fromNo}화` : `${fromNo}~${toNo}화`}</span>
                  {selectedScene?.chapter && (
                    <>
                      <span className="mx-2">·</span>
                      <span className="text-gray-400">시작:</span> <span className="text-white">{(() => {
                        const list = (startOpts?.chapter_scene_index||[]);
                        const ch = list.find(it => Number(it.no) === Number(selectedScene?.chapter));
                        const sc = (ch?.scenes||[]).find(s => s.id === selectedScene?.scene_id);
                        const baseText = sc ? String(sc.hint||'장면').replace(/\s+/g,' ').trim() : '이 화의 도입부터';
                        const short = baseText.length>15 ? baseText.slice(0,15)+'…' : baseText;
                        return `${short} 하는 장면`;
                      })()}</span>
                    </>
                  )}
                  {modeSel!=='plain' && (
                    <>
                      <span className="mx-2">·</span>
                      {prepReady ? (
                        <span className="text-green-400">준비 완료</span>
                      ) : (
                        <span className="text-gray-400">준비 중… 약 {prepEtaSec}초</span>
                      )}
                    </>
                  )}
                </>
              ) : <span className="text-gray-500">캐릭터를 선택하세요</span>}
            </div>
            <div className="flex items-center gap-2">
              <Button variant="ghost" onClick={onClose} className="text-gray-300 hover:text-white">취소</Button>
              <Button className="bg-purple-600 hover:bg-purple-700" disabled={!selectedId || starting || (modeSel!=='plain' && !prepReady)} onClick={startChat}>
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


