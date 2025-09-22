import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { storiesAPI, filesAPI } from '../lib/api';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Textarea } from '../components/ui/textarea';
import { Alert, AlertDescription } from '../components/ui/alert';
import { ArrowLeft, Loader2 } from 'lucide-react';
import ImageGenerateInsertModal from '../components/ImageGenerateInsertModal';

const StoryEditPage = () => {
  const { storyId } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [title, setTitle] = useState('');
  const [genre, setGenre] = useState('');
  const [keywords, setKeywords] = useState('');
  const [synopsis, setSynopsis] = useState('');
  const [coverUrl, setCoverUrl] = useState('');
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [imgModalOpen, setImgModalOpen] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await storiesAPI.getStory(storyId);
        const s = res.data || {};
        setTitle(s.title || '');
        setGenre(s.genre || '');
        setSynopsis(s.content || '');
        const kws = Array.isArray(s.keywords) ? s.keywords : [];
        setKeywords(kws.filter(k => !String(k).startsWith('cover:')).join(', '));
        const coverK = kws.find(k => String(k).startsWith('cover:'));
        setCoverUrl(coverK ? coverK.replace(/^cover:/, '') : (s.cover_url || ''));
      } catch (_) {
        setError('작품 정보를 불러오지 못했습니다.');
      } finally {
        setLoading(false);
      }
    })();
  }, [storyId]);

  const handleSave = async () => {
    setError('');
    if (!title.trim() || !synopsis.trim()) { setError('제목과 소개글을 입력하세요.'); return; }
    setSaving(true);
    try {
      const kw = keywords.split(',').map(s=>s.trim()).filter(Boolean).slice(0,10);
      if (coverUrl && !kw.some(k=>k.startsWith('cover:'))) kw.push(`cover:${coverUrl}`);
      await storiesAPI.updateStory(storyId, { title: title.trim(), content: synopsis.trim(), genre: genre || null, keywords: kw });
      navigate(`/stories/${storyId}`);
    } catch (_) {
      setError('저장에 실패했습니다.');
    } finally {
      setSaving(false);
    }
  };

  const handleUpload = async (file) => {
    setUploading(true); setProgress(0); setError('');
    try {
      const res = await filesAPI.uploadImages([file], (p)=>setProgress(p));
      const url = Array.isArray(res.data) ? res.data[0] : res.data;
      setCoverUrl(url);
    } catch (_) {
      setError('표지 업로드 실패');
    } finally { setUploading(false); }
  };

  if (loading) {
    return (<div className="min-h-screen bg-gray-900 text-white flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin"/></div>);
  }

  return (
    <div className="min-h-screen bg-gray-900 text-gray-200 p-4 sm:p-6 lg:p-8">
      <div className="max-w-3xl mx-auto space-y-4">
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={()=>navigate('/')}><ArrowLeft className="w-5 h-5 mr-2"/>뒤로 가기</Button>
          <Button onClick={()=> setImgModalOpen(true)}>대표이미지 생성/삽입</Button>
        </div>
        {error && (
          <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>
        )}
        <div>
          <label className="block text-sm">표지 이미지</label>
          <div className="mt-2 flex items-center gap-3">
            <label className="inline-flex items-center px-3 py-2 rounded-md border border-gray-600 text-sm cursor-pointer hover:bg-gray-700">
              <input type="file" accept="image/*" className="hidden" onChange={(e)=>{ const f=e.target.files?.[0]; if(f) handleUpload(f); }} />
              업로드
            </label>
            <Button variant="outline" onClick={()=> setImgModalOpen(true)}>이미지 생성/삽입</Button>
            {uploading && <span className="text-xs text-gray-400">업로드 중... {progress}%</span>}
          </div>
          {coverUrl && <img src={coverUrl} alt="cover" className="mt-3 w-28 h-40 object-cover rounded border border-gray-700"/>}
        </div>

        <div>
          <label className="block text-sm">제목</label>
          <Input className="mt-2" value={title} onChange={(e)=>setTitle(e.target.value)} />
        </div>
        <div>
          <label className="block text-sm">장르(선택)</label>
          <Input className="mt-2" value={genre} onChange={(e)=>setGenre(e.target.value)} />
        </div>
        <div>
          <label className="block text-sm">키워드(쉼표로 구분)</label>
          <Input className="mt-2" value={keywords} onChange={(e)=>setKeywords(e.target.value)} />
        </div>
        <div>
          <label className="block text-sm">소개글</label>
          <Textarea className="mt-2" rows={10} value={synopsis} onChange={(e)=>setSynopsis(e.target.value)} />
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={()=>navigate(`/stories/${storyId}`)}>취소</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? '저장 중...' : '저장'}</Button>
        </div>
      </div>
      {/* 이미지 생성/삽입 모달 */}
      <ImageGenerateInsertModal
        open={imgModalOpen}
        onClose={(e)=>{
          setImgModalOpen(false);
          if (e && e.attached) {
            // 스토리 편집 페이지에서는 대표 이미지가 갱신되도록 표지 URL을 즉시 반영
            try {
              // 모달이 story 엔티티에 부착했으므로, 첫 번째 이미지가 대표가 됨
              const focusUrl = e?.focusUrl;
              if (focusUrl) {
                setCoverUrl(focusUrl);
              }
            } catch(_) {}
          }
        }}
        entityType={'story'}
        entityId={storyId}
      />
    </div>
  );
};

export default StoryEditPage;




