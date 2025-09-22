import React from 'react';
import { useQueryClient } from '@tanstack/react-query';

// 전역 media:updated 이벤트를 수신해 관련 그리드/랭킹/탐색 쿼리를 무효화
const MediaEventsBridge = () => {
  const queryClient = useQueryClient();

  React.useEffect(() => {
    const handler = (e) => {
      const detail = e?.detail || {};
      try {
        // 공통: 주요 그리드/랭킹/탭 무효화
        queryClient.invalidateQueries({ queryKey: ['explore-stories'] });
        queryClient.invalidateQueries({ queryKey: ['top-stories-views'] });
        queryClient.invalidateQueries({ queryKey: ['trending-characters-daily'] });
        queryClient.invalidateQueries({ queryKey: ['top-origchat-daily'] });
        queryClient.invalidateQueries({ queryKey: ['characters'] });
        queryClient.invalidateQueries({ queryKey: ['webnovel-characters'] });
        queryClient.invalidateQueries({ queryKey: ['liked-characters'] });

        // 엔티티별 세부 무효화 (있으면)
        if (detail?.entityType === 'story' && detail?.entityId) {
          // 스토리 상세/챕터 목록 등
          queryClient.invalidateQueries({ queryKey: ['story-detail', detail.entityId] });
          queryClient.invalidateQueries({ queryKey: ['chapters-by-story', detail.entityId] });
        }
        if ((detail?.entityType === 'character' || detail?.entityType === 'origchat') && detail?.entityId) {
          queryClient.invalidateQueries({ queryKey: ['character-detail', detail.entityId] });
        }
      } catch (_) {}
    };

    window.addEventListener('media:updated', handler);
    return () => window.removeEventListener('media:updated', handler);
  }, [queryClient]);

  return null;
};

export default MediaEventsBridge;


