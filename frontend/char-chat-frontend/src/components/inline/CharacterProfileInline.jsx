import React, { useEffect, useState } from 'react';
import { charactersAPI } from '../../lib/api';
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar';
import { resolveImageUrl } from '../../lib/images';
import { Skeleton } from '../ui/skeleton';

const CharacterProfileInline = ({ characterId }) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      setLoading(true);
      setError('');
      try {
        const res = await charactersAPI.getCharacter(characterId);
        if (mounted) setData(res.data);
      } catch (e) {
        if (mounted) setError('프로필을 불러오지 못했습니다.');
      } finally {
        if (mounted) setLoading(false);
      }
    };
    if (characterId) load();
    return () => { mounted = false; };
  }, [characterId]);

  if (loading) {
    return (
      <div className="flex items-center gap-3">
        <Skeleton className="w-12 h-12 rounded-full" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-3 w-60" />
        </div>
      </div>
    );
  }
  if (error || !data) {
    return <div className="text-sm text-gray-400">{error || '데이터가 없습니다.'}</div>;
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <Avatar className="w-12 h-12">
          <AvatarImage src={resolveImageUrl(data.avatar_url)} />
          <AvatarFallback>{(data.name || 'C').charAt(0)}</AvatarFallback>
        </Avatar>
        <div>
          <div className="text-white font-semibold">{data.name}</div>
          <div className="text-xs text-gray-300">{data.description}</div>
        </div>
      </div>
      <div className="text-xs text-gray-400 grid grid-cols-2 gap-x-4 gap-y-1">
        {data.personality && (<div><span className="text-gray-500">성격:</span> {data.personality}</div>)}
        {data.speech_style && (<div><span className="text-gray-500">말투:</span> {data.speech_style}</div>)}
        {data.world_setting && (<div className="col-span-2"><span className="text-gray-500">세계관:</span> {data.world_setting}</div>)}
      </div>
      {Array.isArray(data.introduction_scenes) && data.introduction_scenes.length > 0 && (
        <div className="bg-gray-800/40 border border-gray-700 rounded-md p-2 text-sm text-gray-200">
          <div className="font-medium mb-1">도입부</div>
          <div className="space-y-1 max-h-40 overflow-auto">
            {data.introduction_scenes.slice(0,2).map((sc, i) => (
              <div key={i}>
                <div className="text-xs text-gray-400">{sc.title || `장면 ${i+1}`}</div>
                <div className="whitespace-pre-wrap">{sc.content || ''}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default CharacterProfileInline;
