import React from 'react';
import { resolveImageUrl } from '../lib/images';

const timeAgo = (iso) => {
  try {
    const d = new Date(iso);
    const diff = Math.floor((Date.now() - d.getTime()) / 1000);
    if (diff < 60) return '방금';
    const m = Math.floor(diff / 60);
    if (m < 60) return `${m}분 전`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}시간 전`;
    const day = Math.floor(h / 24);
    if (day < 7) return `${day}일 전`;
    return d.toLocaleDateString();
  } catch (_) { return ''; }
};

const RecentGeneratedStrip = ({ items = [], onSelect }) => {
  if (!Array.isArray(items) || items.length === 0) return null;
  const sorted = [...items].sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
  return (
    <div className="mt-2">
      <div className="text-xs text-gray-300 mb-1">최근 생성</div>
      <div className="flex gap-2 overflow-x-auto pb-1 custom-scrollbar" role="list" aria-label="최근 생성 이미지 목록">
        {sorted.map((it) => (
          <button
            key={it.id}
            type="button"
            onClick={() => onSelect?.(it.url)}
            className="group relative flex-shrink-0 rounded-md overflow-hidden border border-gray-700 bg-gray-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900 hover:border-purple-500/60 hover:shadow-md hover:shadow-purple-900/20 transition"
            aria-label={`생성 이미지 ${timeAgo(it.created_at)}`}
            title={timeAgo(it.created_at)}
            role="listitem"
          >
            <img
              src={resolveImageUrl(it.url) || it.url}
              alt="최근 생성된 이미지"
              className="w-16 h-16 object-cover object-center"
            />
            {/* 하단 그라데이션 + 시간 라벨: 어두운 배경에 백색 텍스트로 대비 보장 */}
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-6 bg-gradient-to-t from-black/70 to-transparent" />
            <span className="absolute left-1 bottom-1 text-[10px] leading-none px-1.5 py-0.5 rounded bg-black/70 text-white shadow-sm">
              {timeAgo(it.created_at)}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
};

export default RecentGeneratedStrip;


