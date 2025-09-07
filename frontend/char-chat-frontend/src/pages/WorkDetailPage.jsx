import React from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import AppLayout from '../components/layout/AppLayout';
import { Button } from '../components/ui/button';
import { useQuery } from '@tanstack/react-query';
import { worksAPI } from '../lib/api';
import { Avatar, AvatarFallback, AvatarImage } from '../components/ui/avatar';
import { resolveImageUrl } from '../lib/images';
import { getReadingProgress } from '../lib/reading';

const WorkDetailPage = () => {
  const { workId } = useParams();
  const navigate = useNavigate();

  const { data } = useQuery({
    queryKey: ['work', workId],
    queryFn: () => worksAPI.getWork(workId),
  });

  const work = data?.data;

  if (!work) return null;
  const progress = getReadingProgress(workId);
  const continueChapter = progress > 0 ? progress : 1;

  return (
    <AppLayout>
      <div className="min-h-full bg-gray-900 text-white p-6">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-start gap-4">
            <div className="w-24 h-32 bg-gray-800 rounded-lg overflow-hidden flex items-center justify-center text-gray-400">
              {work.cover_url ? (
                <img src={resolveImageUrl(work.cover_url)} alt={work.title} className="w-full h-full object-cover" />
              ) : (
                <span>NO COVER</span>
              )}
            </div>
            <div className="flex-1">
              <h1 className="text-2xl font-bold">{work.title}</h1>
              <p className="text-gray-400 mt-1">{work.author}</p>
              <div className="mt-4 flex gap-2">
                <Button className="bg-purple-600 hover:bg-purple-700" onClick={() => navigate(`/works/${workId}/chapters/1`)}>첫화보기</Button>
                <Button variant="outline" className="border-gray-700 text-gray-200" onClick={() => navigate(`/works/${workId}/chapters/${continueChapter}`)}>
                  이어보기{progress > 0 ? ` (${continueChapter}화)` : ''}
                </Button>
                <Button variant="secondary" className="bg-pink-600 hover:bg-pink-700" onClick={() => navigate(`/works/${workId}/chapters/${continueChapter}?chat=1`)}>
                  대화하기
                </Button>
              </div>
            </div>
          </div>

          <div className="mt-6">
            <h2 className="text-lg font-semibold mb-2">주요 캐릭터</h2>
            <div className="flex gap-3">
              {work.main_characters.map(c => (
                <div key={c.id} className="flex flex-col items-center text-sm text-gray-300">
                  <Avatar>
                    <AvatarImage src={resolveImageUrl(c.avatar_url)} />
                    <AvatarFallback>{c.name.charAt(0)}</AvatarFallback>
                  </Avatar>
                  <span className="mt-1">{c.name}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  );
};

export default WorkDetailPage;



