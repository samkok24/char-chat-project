import React, { useState } from 'react';
import { metricsAPI } from '../lib/api';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';

const MetricsSummaryPage = () => {
  const [day, setDay] = useState(''); // YYYYMMDD
  const [storyId, setStoryId] = useState('');
  const [roomId, setRoomId] = useState('');
  const [mode, setMode] = useState(''); // canon|parallel
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  const fetchSummary = async () => {
    setLoading(true); setError('');
    try {
      const params = {};
      if (day) params.day = day;
      if (storyId) params.story_id = storyId;
      if (roomId) params.room_id = roomId;
      if (mode) params.mode = mode;
      const res = await metricsAPI.getSummary(params);
      setResult(res.data || {});
    } catch (e) {
      console.error(e);
      setError('불러오기 실패');
    } finally { setLoading(false); }
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white p-6">
      <div className="max-w-3xl mx-auto">
        <h1 className="text-xl font-bold mb-4">메트릭 요약 (개발용)</h1>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
          <Input placeholder="YYYYMMDD" value={day} onChange={(e)=>setDay(e.target.value)} className="bg-gray-800 border-gray-700 text-white" />
          <Input placeholder="story_id" value={storyId} onChange={(e)=>setStoryId(e.target.value)} className="bg-gray-800 border-gray-700 text-white" />
          <Input placeholder="room_id" value={roomId} onChange={(e)=>setRoomId(e.target.value)} className="bg-gray-800 border-gray-700 text-white" />
          <Input placeholder="mode (canon|parallel)" value={mode} onChange={(e)=>setMode(e.target.value)} className="bg-gray-800 border-gray-700 text-white" />
        </div>
        <Button onClick={fetchSummary} disabled={loading} className={`bg-white text-black ${loading ? 'opacity-60 cursor-not-allowed' : ''}`}>불러오기</Button>
        {error && <div className="mt-3 text-red-400 text-sm">{error}</div>}
        <div className="mt-6 bg-gray-800 border border-gray-700 rounded p-4 overflow-auto">
          <pre className="text-sm whitespace-pre-wrap">{JSON.stringify(result, null, 2)}</pre>
        </div>
      </div>
    </div>
  );
};

export default MetricsSummaryPage;





