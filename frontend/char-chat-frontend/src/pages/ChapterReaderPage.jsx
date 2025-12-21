import React, { useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import AppLayout from '../components/layout/AppLayout';
import { Button } from '../components/ui/button';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { chaptersAPI, storiesAPI, mediaAPI, storydiveAPI } from '../lib/api';
import { setReadingProgress, getReadingProgress } from '../lib/reading';
import { ArrowLeft, ArrowRight, Home, MessageCircle, Loader2 } from 'lucide-react';
import { resolveImageUrl } from '../lib/images';
import ChapterViewer from '../components/ChapterViewer';
import OrigChatStartModal from '../components/OrigChatStartModal';
import MiniChatWindow from '../components/MiniChatWindow';
import { toast } from 'sonner';

const ChapterReaderPage = () => {
  const { storyId: storyIdFromPath, chapterNumber } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [sp] = useSearchParams();
  const chatOpen = sp.get('chat') === '1';
  const storyId = storyIdFromPath || sp.get('storyId');
  const [origChatModalOpen, setOrigChatModalOpen] = useState(false);
  const [miniChatOpen, setMiniChatOpen] = useState(false);
  const [storyDivePreparing, setStoryDivePreparing] = useState(false);
  // 스토리 상세 (헤더/좌측 표지용)
  const { data: story } = useQuery({
    queryKey: ['story', storyId],
    queryFn: async () => {
      const res = await storiesAPI.getStory(storyId);
      return res.data;
    },
    enabled: !!storyId,
  });
  // 스토리 미디어 자산 목록 (대표/갤러리)
  const { data: mediaAssets = [] } = useQuery({
    queryKey: ['media-assets', 'story', storyId],
    queryFn: async () => {
      const res = await mediaAPI.listAssets({ entityType: 'story', entityId: storyId, presign: false, expiresIn: 300 });
      return Array.isArray(res.data?.items) ? res.data.items : (Array.isArray(res.data) ? res.data : []);
    },
    enabled: !!storyId,
    staleTime: 0,
    refetchOnMount: 'always',
  });
  const { data: chapterList = [] } = useQuery({
    queryKey: ['chapters-by-story', storyId],
    queryFn: async () => {
      const res = await chaptersAPI.getByStory(storyId, 'asc');
      return Array.isArray(res.data) ? res.data : [];
    },
    enabled: !!storyId,
  });
  const currentIdx = useMemo(() => {
    const cn = Number(chapterNumber);
    const idx = chapterList.findIndex(c => Number(c.no || 0) === cn);
    return idx >= 0 ? idx : -1;
  }, [chapterNumber, chapterList]);

  const chapter = chapterList[currentIdx] || null;
  const nextNo = useMemo(() => (Number(chapterNumber) + 1), [chapterNumber]);
  const prevNo = useMemo(() => (Math.max(1, Number(chapterNumber) - 1)), [chapterNumber]);

  // 갤러리: media_assets 우선, 없으면 cover_url + keywords의 cover: 항목들
  const galleryImages = useMemo(() => {
    const s = story || {};
    const assets = Array.isArray(mediaAssets) ? mediaAssets : [];
    if (assets.length > 0) {
      const urls = Array.from(new Set(assets.map(a => a.url).filter(Boolean)));
      return urls;
    }
    const kws = Array.isArray(s.keywords) ? s.keywords : [];
    const kwUrls = kws
      .filter((k) => typeof k === 'string' && k.startsWith('cover:'))
      .map((k) => k.replace(/^cover:/, ''))
      .filter(Boolean);
    return Array.from(new Set([s.cover_url, ...kwUrls].filter(Boolean)));
  }, [story, mediaAssets]);
  const coverUrl = useMemo(() => galleryImages[0] || '', [galleryImages]);

  const hasChapter = !!chapter;
  // image_url이 배열인지 확인
  const getImageUrl = (imageUrl) => {
    if (!imageUrl) return null;
    if (Array.isArray(imageUrl)) {
      return imageUrl.length > 0 ? imageUrl[0] : null;
    }
    return imageUrl; // 단일 문자열인 경우 (하위 호환)
  };
  const isWebtoon = !!getImageUrl(chapter?.image_url);
  const isStoryWebtoon = !!story?.is_webtoon || isWebtoon;
  
  // 디버깅용 로그
  React.useEffect(() => {
    if (chapter) {
      console.log('Chapter data:', {
        id: chapter.id,
        no: chapter.no,
        image_url: chapter.image_url,
        hasImage: !!getImageUrl(chapter.image_url),
        isWebtoon: isWebtoon
      });
    }
  }, [chapter, isWebtoon]);

  React.useEffect(() => {
    if (chapter?.no) setReadingProgress(storyId, chapter.no);
  }, [storyId, chapter?.no]);

  /**
   * 뷰어 하단 '스토리 다이브 시작' 버튼 클릭 시 동작
   *
   * 의도/동작:
   * - 현재 회차(toNo) 기준 최근 10화 합본 텍스트를 서버에서 준비(Novel 스냅샷 생성/재사용)
   * - 성공 시 StoryDive 화면으로 이동하며, returnTo를 함께 넘겨 뒤로가기가 항상 뷰어로 복귀하도록 보장
   * - 웹툰(이미지 회차/웹툰 플래그)인 경우 버튼 비활성 + 서버에서도 422로 방어
   */
  const handleStoryDiveStart = async () => {
    if (!storyId) return;
    const toNo = Number(chapter?.no || chapterNumber || 0);
    if (!toNo) return;
    if (storyDivePreparing) return;
    if (isStoryWebtoon) return;

    setStoryDivePreparing(true);
    try {
      const res = await storydiveAPI.prepareNovelFromStory(storyId, toNo, 10);
      const novelId = res?.data?.novel_id;
      if (!novelId) {
        toast.error('스토리 다이브 준비에 실패했습니다. (novel_id 없음)');
        return;
      }
      const returnTo = `/stories/${storyId}/chapters/${toNo}`;
      navigate(`/storydive/novels/${novelId}?returnTo=${encodeURIComponent(returnTo)}&auto=1`);
    } catch (e) {
      const status = e?.response?.status;
      const detail = e?.response?.data?.detail;
      if (status === 401) {
        toast.error('스토리 다이브는 로그인 후 이용할 수 있어요.');
      } else if (status === 422) {
        toast.error(detail || '웹툰 작품은 스토리 다이브를 지원하지 않습니다.');
      } else {
        toast.error(detail || '스토리 다이브 준비에 실패했습니다.');
      }
      console.error('prepareNovelFromStory error:', e);
    } finally {
      setStoryDivePreparing(false);
    }
  };

  // 회차 진입 시 뷰 카운트 증가 트리거 및 목록 무효화
  React.useEffect(() => {
    const run = async () => {
      try {
        const id = chapter?.id;
        if (!id) return;
        await chaptersAPI.getOne(id); // 서버에서 비동기로 view_count 증가
        // 스토리 상세의 회차 목록을 최신으로
        try { queryClient.invalidateQueries({ queryKey: ['chapters-by-story', storyId] }); } catch (_) {}
      } catch (_) {}
    };
    run();
    // chapter.id 변경 시마다 1회
  }, [chapter?.id, storyId, queryClient]);

  // 심리스 내비게이션 제거 (IntersectionObserver 비활성화)

  // 키보드 단축키: 좌/우 화살표로 이전/다음
  React.useEffect(() => {
    const onKey = (e) => {
      if (e.defaultPrevented) return;
      if (e.key === 'ArrowLeft') {
        if (currentIdx > 0) {
          const prev = chapterList[currentIdx - 1];
          if (prev) navigate(`/stories/${storyId}/chapters/${prev.no}`);
        }
      } else if (e.key === 'ArrowRight') {
        if (currentIdx >= 0 && currentIdx < chapterList.length - 1) {
          const next = chapterList[currentIdx + 1];
          if (next) navigate(`/stories/${storyId}/chapters/${next.no}`);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [chapterList, currentIdx, navigate, storyId]);

  // 웹툰 모드: AppLayout 없이 순수 이미지만 표시
  if (isWebtoon && hasChapter) {
    return (
      <div className="min-h-screen bg-white w-full overflow-x-hidden">
        <ChapterViewer chapter={chapter} />
        
        {/* 우측 하단 플로팅 버튼들 */}
        {story && (
          <>
            {/* 미니 채팅 버튼 (상단) */}
            <div className="fixed bottom-40 right-6 z-50">
              <Button 
                className="rounded-full w-14 h-14 bg-pink-600 hover:bg-pink-700 text-white shadow-lg" 
                onClick={() => setMiniChatOpen(true)}
                title="빠른 채팅"
              >
                <MessageCircle className="w-6 h-6" />
              </Button>
            </div>
            
            {/* 원작챗 버튼 (하단) */}
            <div className="fixed bottom-24 right-6 z-50">
              <Button 
                className="rounded-full w-14 h-14 bg-purple-600 hover:bg-purple-700 text-white shadow-lg" 
                onClick={() => setOrigChatModalOpen(true)}
                title="원작챗 시작"
              >
                <MessageCircle className="w-6 h-6" />
              </Button>
            </div>
          </>
        )}

        {/* 하단 내비게이션 */}
        <div className="bg-gray-900/95 backdrop-blur border-t border-gray-800 mt-10">
          <div className="max-w-6xl mx-auto px-5 py-4">
            <div className="grid grid-cols-3 items-center">
              <div className="justify-self-start">
                <Button
                  variant="ghost"
                  className="text-gray-300 hover:text-white hover:bg-gray-800"
                  disabled={currentIdx <= 0}
                  onClick={() => {
                    if (currentIdx > 0) {
                      const prev = chapterList[currentIdx - 1];
                      if (prev) navigate(`/stories/${storyId}/chapters/${prev.no}`);
                    }
                  }}
                >
                  <ArrowLeft className="w-5 h-5 mr-2" /> 이전화
                </Button>
              </div>
              <div className="justify-self-center">
                <Button
                  variant="ghost"
                  className="text-gray-300 hover:text-white hover:bg-gray-800"
                  onClick={() => navigate(`/stories/${storyId}`)}
                >
                  <Home className="w-5 h-5 mr-2" /> 작품홈
                </Button>
              </div>
              <div className="justify-self-end">
                <Button
                  className="bg-red-600 hover:bg-red-700 text-white"
                  disabled={currentIdx < 0 || currentIdx >= chapterList.length - 1}
                  onClick={() => {
                    if (currentIdx >= 0 && currentIdx < chapterList.length - 1) {
                      const next = chapterList[currentIdx + 1];
                      if (next) navigate(`/stories/${storyId}/chapters/${next.no}`);
                    }
                  }}
                >
                  다음화 <ArrowRight className="w-5 h-5 ml-2" />
                </Button>
              </div>
            </div>
          </div>
        </div>

        {/* 원작챗 시작 모달 */}
        {story && (
          <OrigChatStartModal
            open={origChatModalOpen}
            onClose={() => setOrigChatModalOpen(false)}
            storyId={storyId}
            totalChapters={chapterList.length || 1}
            lastReadNo={Number(chapter?.no || chapterNumber || getReadingProgress(storyId)) || 0}
          />
        )}

        {/* 미니 채팅창 */}
        <MiniChatWindow 
          open={miniChatOpen}
          onClose={() => setMiniChatOpen(false)}
          storyId={storyId}
          currentChapterNo={Number(chapter?.no || chapterNumber) || 1}
        />
      </div>
    );
  }

  return (
    <AppLayout>
      <div className={`min-h-screen ${isWebtoon ? 'bg-black' : 'bg-gray-900'} text-white`}>
        <div className={`${isWebtoon ? 'px-0 py-0' : 'max-w-6xl mx-auto px-5 py-6'} ${chatOpen ? 'pb-40' : 'pb-16'}`}>
          {/* 상단 헤더 - 웹툰 모드에서는 숨김 */}
          {!isWebtoon && (
            <div className="flex items-start justify-start mb-4">
              <div className="flex-1 min-w-0">
                <button
                  type="button"
                  onClick={() => navigate(`/stories/${storyId}`)}
                  className="inline-flex items-center text-gray-300 hover:text-white"
                >
                  <ArrowLeft className="w-5 h-5 mr-2" /> 작품 상세로
                </button>
                <h1 className="text-2xl sm:text-3xl font-bold mt-2 truncate">{story?.title || ''}</h1>
                {chapter && (
                  <div className="text-sm text-gray-400 truncate">
                    {chapter.no
                      ? `${chapter.no}화${chapter.title ? ` - ${chapter.title}` : ''}`
                      : (chapter.title || '제목 없음')}
                  </div>
                )}
                {typeof chapter?.view_count !== 'undefined' && (
                  <div className="text-xs text-gray-500 mt-1">
                    조회수 {Number(chapter.view_count || 0).toLocaleString()}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 웹툰 모드: 순수 이미지만 전체 화면 */}
          {isWebtoon ? (
            hasChapter ? (
              <ChapterViewer chapter={chapter} />
            ) : (
              <div className="flex items-center justify-center min-h-screen">
                <p className="text-gray-400">회차를 불러오는 중...</p>
              </div>
            )
          ) : (
            /* 웹소설 모드: 본문만 표시 */
            <div>
              <main>
                {hasChapter ? (
                  <ChapterViewer chapter={chapter} />
                ) : (
                  <article className="bg-gray-800/40 border border-gray-700 rounded-lg p-5 leading-8 text-gray-200 whitespace-pre-wrap text-left min-h-[40vh]">
                    회차를 불러오는 중입니다...
                  </article>
                )}
              </main>
            </div>
          )}
        </div>

        {/* 하단 내비게이션 (콘텐츠 폭 내부) */}
        <div className="max-w-5xl mx-auto mt-10">
          <div className="bg-gray-900/95 backdrop-blur border border-gray-800/80 rounded-2xl px-5 py-3 shadow-xl shadow-black/40">
            <div className="flex flex-col gap-3">
              {/* 스토리 다이브 시작 버튼 (회차 맨 아래) */}
              <Button
                className="w-full bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={!hasChapter || !storyId || storyDivePreparing || isStoryWebtoon}
                onClick={handleStoryDiveStart}
                title={isStoryWebtoon ? '웹툰 작품은 스토리 다이브를 지원하지 않습니다' : '최근 10화 합본으로 스토리 다이브를 시작합니다'}
              >
                {storyDivePreparing ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    스토리 다이브 준비 중...
                  </>
                ) : (
                  '스토리 다이브 시작'
                )}
              </Button>

              <div className="grid grid-cols-3 items-center gap-3">
                <div className="justify-self-start">
                  <Button
                    variant="ghost"
                    className="text-gray-300 hover:text-white hover:bg-gray-800"
                    disabled={currentIdx <= 0}
                    onClick={() => {
                      if (currentIdx > 0) {
                        const prev = chapterList[currentIdx - 1];
                        if (prev) navigate(`/stories/${storyId}/chapters/${prev.no}`);
                      }
                    }}
                  >
                    <ArrowLeft className="w-5 h-5 mr-2" /> 이전화
                  </Button>
                </div>
                <div className="justify-self-center">
                  <Button
                    variant="ghost"
                    className="text-gray-300 hover:text-white hover:bg-gray-800"
                    onClick={() => navigate(`/stories/${storyId}`)}
                  >
                    <Home className="w-5 h-5 mr-2" /> 작품홈
                  </Button>
                </div>
                <div className="justify-self-end">
                  <Button
                    className="bg-red-600 hover:bg-red-700 text-white"
                    disabled={currentIdx < 0 || currentIdx >= chapterList.length - 1}
                    onClick={() => {
                      if (currentIdx >= 0 && currentIdx < chapterList.length - 1) {
                        const next = chapterList[currentIdx + 1];
                        if (next) navigate(`/stories/${storyId}/chapters/${next.no}`);
                      }
                    }}
                  >
                    다음화 <ArrowRight className="w-5 h-5 ml-2" />
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* 우측 하단 플로팅 버튼들 */}
        {hasChapter && story && (
          <>
            {/* 미니 채팅 버튼 (상단) */}
            <div className="fixed bottom-40 right-6 z-40">
              <Button 
                className="rounded-full w-14 h-14 bg-pink-600 hover:bg-pink-700 text-white shadow-lg" 
                onClick={() => setMiniChatOpen(true)}
                title="빠른 채팅"
              >
                <MessageCircle className="w-6 h-6" />
              </Button>
            </div>
            
            {/* 원작챗 버튼 (하단) */}
            <div className="fixed bottom-24 right-6 z-40">
              <Button 
                className="rounded-full w-14 h-14 bg-purple-600 hover:bg-purple-700 text-white shadow-lg" 
                onClick={() => setOrigChatModalOpen(true)}
                title="원작챗 시작"
              >
                <MessageCircle className="w-6 h-6" />
              </Button>
            </div>
          </>
        )}

        {/* 심플 챗 섹션 (MVP: 열기/닫기만) */}
        {chatOpen && hasChapter && (
          <div className="bg-gray-850/95 backdrop-blur border border-gray-700 rounded-2xl max-w-6xl mx-auto mt-6">
            <div className="p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="text-white font-medium">캐릭터 챗 · {chapter?.title}</div>
                <Button variant="ghost" className="hover:bg-gray-800" onClick={() => navigate(`/stories/${storyId}/chapters/${chapter?.no}`)}>닫기</Button>
              </div>
              <div className="h-48 bg-gray-800 rounded-lg border border-gray-700 mb-3 flex items-center justify-center text-gray-400">
                메시지 영역 (MVP)
              </div>
              <div className="flex gap-2">
                <input className="flex-1 bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-white" placeholder="메시지를 입력하세요" />
                <Button className="bg-purple-600 hover:bg-purple-700">전송</Button>
              </div>
            </div>
          </div>
        )}

        {/* 원작챗 시작 모달 */}
        {story && (
          <OrigChatStartModal
            open={origChatModalOpen}
            onClose={() => setOrigChatModalOpen(false)}
            storyId={storyId}
            totalChapters={chapterList.length || 1}
            lastReadNo={Number(chapter?.no || chapterNumber || getReadingProgress(storyId)) || 0}
          />
        )}

        {/* 미니 채팅창 */}
        <MiniChatWindow 
          open={miniChatOpen}
          onClose={() => setMiniChatOpen(false)}
          storyId={storyId}
          currentChapterNo={Number(chapter?.no || chapterNumber) || 1}
        />
      </div>
    </AppLayout>
  );
};

export default ChapterReaderPage;



