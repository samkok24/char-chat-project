/**
 * FavoriteStoriesPage.jsx
 * 선호작(웹소설) 목록 페이지
 *
 * 요구사항/의도:
 * - 기존 큰 격자(StoryExploreCard) 대신, "원작소설 탭"과 동일한 리스트형 카드(StorySerialCard)로 표시한다.
 * - 내 캐릭터 페이지처럼 "선택" 모드로 여러 작품을 선택해 선호작(좋아요)을 해제할 수 있게 한다.
 *
 * 방어적 처리:
 * - API 응답이 예상과 다르거나 일부 항목이 누락되어도 페이지가 깨지지 않도록 배열/ID를 검증한다.
 * - 실패는 콘솔 로그 + 토스트로 사용자에게 명확히 알린다.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import AppLayout from '../components/layout/AppLayout';
import { storiesAPI, usersAPI } from '../lib/api';
import { Button } from '../components/ui/button';
import StorySerialCard from '../components/StorySerialCard';
import { Loader2 } from 'lucide-react';

const StorySerialSkeletonList = () => (
  <div className="bg-gray-800/50 rounded-xl overflow-hidden border border-gray-700/50">
    {Array.from({ length: 6 }).map((_, i) => (
      <div key={i} className="flex gap-4 py-5 px-4 border-b border-gray-700/50 animate-pulse">
        <div className="w-[100px] h-[140px] bg-gray-700 rounded-lg" />
        <div className="flex-1 space-y-3">
          <div className="h-5 w-16 bg-gray-700 rounded" />
          <div className="h-5 w-48 bg-gray-700 rounded" />
          <div className="h-4 w-24 bg-gray-700 rounded" />
          <div className="h-4 w-full bg-gray-700 rounded" />
          <div className="h-4 w-3/4 bg-gray-700 rounded" />
        </div>
      </div>
    ))}
  </div>
);

const FavoriteStoriesPage = () => {
  const queryClient = useQueryClient();
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);

  const notify = useCallback((type, message) => {
    try {
      window.dispatchEvent(new CustomEvent('toast', { detail: { type, message } }));
    } catch (_) {}
  }, []);

  const { data: raw = [], isLoading, isError, refetch } = useQuery({
    queryKey: ['liked-stories-page'],
    queryFn: async () => {
      try {
        const res = await usersAPI.getLikedStories({ limit: 48 });
        return Array.isArray(res.data) ? res.data : [];
      } catch (e) {
        console.error('선호작(웹소설) 목록 로드 실패:', e);
        throw e;
      }
    },
    staleTime: 30000,
  });

  const items = useMemo(() => (Array.isArray(raw) ? raw : []), [raw]);

  const toggleSelect = useCallback((id) => {
    const sid = String(id || '').trim();
    if (!sid) return;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(sid)) next.delete(sid);
      else next.add(sid);
      return next;
    });
  }, []);

  const exitSelectMode = useCallback(() => {
    setSelectMode(false);
    setSelectedIds(new Set());
  }, []);

  const bulkUnlike = useCallback(async () => {
    if (bulkLoading) return;
    const ids = Array.from(selectedIds || [])
      .map((x) => String(x || '').trim())
      .filter(Boolean);

    if (ids.length === 0) {
      notify('warning', '선택된 작품이 없습니다.');
      return;
    }

    if (!window.confirm(`${ids.length}개의 작품을 선호작에서 해제하시겠습니까?`)) return;

    setBulkLoading(true);
    let success = 0;
    let failed = 0;
    for (const id of ids) {
      try {
        await storiesAPI.unlikeStory(id);
        success += 1;
      } catch (e) {
        failed += 1;
        console.error('선호작 해제 실패:', { id, error: e });
      }
    }

    try {
      await refetch();
    } catch (e) {
      console.error('선호작(웹소설) 목록 재조회 실패:', e);
    }

    // 다른 화면의 좋아요 상태가 즉시 반영되도록 힌트성 invalidate
    try {
      queryClient.invalidateQueries({ queryKey: ['liked-stories-page'] });
    } catch (_) {}

    setSelectedIds(new Set());
    setSelectMode(false);
    setBulkLoading(false);

    if (failed > 0) notify('warning', `${success}개 선호작 해제, ${failed}개 실패`);
    else notify('success', `${success}개 선호작 해제 완료`);
  }, [bulkLoading, notify, queryClient, refetch, selectedIds]);

  return (
    <AppLayout>
      <div className="min-h-full bg-gray-900 text-gray-200 px-4 sm:px-8 py-6">
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 mb-4">
          <div>
            <h1 className="text-2xl font-bold">선호작</h1>
            <p className="text-sm text-gray-400 mt-1">좋아요한 웹소설</p>
          </div>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={bulkLoading || isLoading}
              onClick={() => {
                if (selectMode) exitSelectMode();
                else setSelectMode(true);
              }}
            >
              {selectMode ? '선택 해제' : '선택'}
            </Button>
            <Button
              size="sm"
              className="bg-red-600 hover:bg-red-700 disabled:opacity-50"
              disabled={!selectMode || selectedIds.size === 0 || bulkLoading || isLoading}
              onClick={bulkUnlike}
            >
              {bulkLoading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  해제 중...
                </>
              ) : (
                `선호작 해제 (${selectedIds.size})`
              )}
            </Button>
          </div>
        </div>

        {isLoading ? (
          <StorySerialSkeletonList />
        ) : isError ? (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-red-200">
            <div className="font-medium">선호작을 불러오지 못했습니다.</div>
            <button
              className="mt-3 px-3 py-1.5 rounded bg-red-600 hover:bg-red-700 text-white text-sm transition-colors"
              onClick={() => { try { refetch(); } catch {} }}
            >
              다시 시도
            </button>
          </div>
        ) : items.length === 0 ? (
          <p className="text-gray-400">선호작(좋아요)한 웹소설이 없습니다.</p>
        ) : (
          <div className="bg-gray-800/50 rounded-xl overflow-hidden border border-purple-500/30 shadow-lg">
            {items
              .filter((s) => !!String(s?.id || '').trim())
              .map((story) => {
                const sid = String(story.id).trim();
                const checked = selectedIds.has(sid);
                return (
                  <div key={sid} className="relative">
                    {selectMode && (
                      <label
                        className="absolute top-3 right-3 z-20 inline-flex items-center gap-1 bg-black/60 backdrop-blur-sm text-white text-xs px-2 py-1 rounded-md ring-1 ring-white/20 shadow-sm cursor-pointer"
                        onClick={(e) => { e.stopPropagation(); }}
                      >
                        <input
                          className="w-4 h-4"
                          disabled={bulkLoading}
                          type="checkbox"
                          checked={checked}
                          onClick={(e) => { e.stopPropagation(); }}
                          onChange={() => toggleSelect(sid)}
                        />{' '}
                        선택
                      </label>
                    )}
                    {/* 선택 상태 시 시각적 힌트(미세 오버레이) */}
                    {selectMode && checked && (
                      <div className="pointer-events-none absolute inset-0 bg-purple-500/10" />
                    )}
                    <StorySerialCard
                      story={story}
                      onClick={
                        selectMode
                          ? () => toggleSelect(sid)
                          : undefined
                      }
                    />
                  </div>
                );
              })}
          </div>
        )}
      </div>
    </AppLayout>
  );
};

export default FavoriteStoriesPage;


