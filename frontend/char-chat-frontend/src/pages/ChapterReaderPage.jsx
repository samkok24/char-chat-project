import React, { useMemo } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import AppLayout from '../components/layout/AppLayout';
import { Button } from '../components/ui/button';
import { useQuery } from '@tanstack/react-query';
import { worksAPI } from '../lib/api';
import { setReadingProgress } from '../lib/reading';

const ChapterReaderPage = () => {
  const { workId, chapterNumber } = useParams();
  const navigate = useNavigate();
  const [sp] = useSearchParams();
  const chatOpen = sp.get('chat') === '1';

  const { data: chapterResp } = useQuery({
    queryKey: ['chapter', workId, chapterNumber],
    queryFn: () => worksAPI.getChapter(workId, chapterNumber),
  });

  const chapter = chapterResp?.data;
  const nextNo = useMemo(() => (Number(chapterNumber) + 1), [chapterNumber]);
  const prevNo = useMemo(() => (Math.max(1, Number(chapterNumber) - 1)), [chapterNumber]);

  if (!chapter) return null;

  React.useEffect(() => {
    if (chapter?.number) setReadingProgress(workId, chapter.number);
  }, [workId, chapter?.number]);

  return (
    <AppLayout>
      <div className="min-h-full bg-gray-900 text-gray-200">
        <div className="max-w-3xl mx-auto px-5 py-6">
          <div className="flex items-center justify-between mb-4">
            <Button variant="ghost" className="text-gray-300" onClick={() => navigate(-1)}>뒤로</Button>
            <div className="flex gap-2">
              <Button variant="outline" className="border-gray-700 text-gray-200" onClick={() => navigate(`/works/${workId}/chapters/${prevNo}`)}>이전</Button>
              <Button className="bg-purple-600 hover:bg-purple-700" onClick={() => navigate(`/works/${workId}/chapters/${nextNo}`)}>다음</Button>
            </div>
          </div>
          <h1 className="text-2xl font-semibold text-white mb-2">{chapter.title}</h1>
          <div className="leading-8 whitespace-pre-wrap">{chapter.content}</div>
        </div>

        {/* 하단 고정 챗 버튼 */}
        <div className="fixed bottom-6 right-6 z-50">
          <Button className="rounded-full w-14 h-14 bg-pink-600 hover:bg-pink-700" onClick={() => navigate(`/works/${workId}/chapters/${chapter.number}?chat=1`)}>챗</Button>
        </div>

        {/* 심플 챗 시트 (MVP: 열기/닫기만) */}
        {chatOpen && (
          <div className="fixed inset-x-0 bottom-0 bg-gray-850/95 backdrop-blur border-t border-gray-700">
            <div className="max-w-3xl mx-auto p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="text-white font-medium">캐릭터 챗 · {chapter.title}</div>
                <Button variant="ghost" onClick={() => navigate(`/works/${workId}/chapters/${chapter.number}`)}>닫기</Button>
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
      </div>
    </AppLayout>
  );
};

export default ChapterReaderPage;



