/**
 * 마이페이지
 */

import React, { useState, useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { usersAPI, filesAPI } from '../lib/api'; 
import AppLayout from '../components/layout/AppLayout';
import ErrorBoundary from '../components/ErrorBoundary';
import AvatarCropModal from '../components/AvatarCropModal';
import ImageGenerateInsertModal from '../components/ImageGenerateInsertModal';
import ProfileEditModal from '../components/ProfileEditModal';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '../components/ui/avatar';
import { resolveImageUrl } from '../lib/images';
import { Badge } from '../components/ui/badge';
// Tabs 제거: 대시보드로 리팩토링
import { 
  User,
  Mail,
  Calendar,
  MessageCircle,
  Heart,
  Gem,
  Edit,
  Save,
  X,
  Globe,
  Upload,
  Trash2,
  Users,
  Loader2,
  AlertCircle,
  ArrowLeft
} from 'lucide-react';
import { RecentCharactersList } from '../components/RecentCharactersList'; // RecentCharactersList 추가
import { Separator } from '../components/ui/separator';

// import { PageLoader } from '../App';

// PageLoader가 없다면 이 부분을 추가하거나, App.jsx에서 import 해야 합니다.
const PageLoader = () => (
  <div className="min-h-screen flex items-center justify-center">
    <Loader2 className="w-8 h-8 animate-spin text-purple-600" />
  </div>
);

const ProfilePage = () => {
  // --- 기존의 정적인 데이터는 모두 삭제하고, 아래 로직으로 교체합니다. ---
  
  // [추가] URL 파라미터와 현재 로그인 유저 정보를 가져옵니다.
  const { userId: paramUserId } = useParams();
  const { user: currentUser, isAuthenticated, loading: authLoading, checkAuth, refreshProfileVersion } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  // 표시할 프로필의 최종 userId는 이펙트에서 계산 (auth 로딩 완료 후)

  // [추가] API 데이터를 담을 상태들을 선언합니다.
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [avatarDeleting, setAvatarDeleting] = useState(false);
  const fileInputRef = useRef(null);
  const [cropSrc, setCropSrc] = useState('');
  const [isCropOpen, setIsCropOpen] = useState(false);
  const [imgModalOpen, setImgModalOpen] = useState(false);

  // 대시보드 통계 상태 (항상 훅은 컴포넌트 최상단에서 선언)
  const [overview, setOverview] = useState(null);
  const [series, setSeries] = useState([]);
  const [seriesRange, setSeriesRange] = useState('24h'); // '24h' | '7d'
  const [topChars, setTopChars] = useState([]);
  const [showEdit, setShowEdit] = useState(false);

  // [추가] API를 호출하여 데이터를 가져오는 useEffect 로직입니다.
  useEffect(() => {
    if (authLoading) return; // 인증 상태 로딩 중이면 대기
    const uid = paramUserId || currentUser?.id;
    if (!uid) {
      if (!isAuthenticated) {
        navigate('/login');
      } else {
        setError('프로필 정보를 불러올 수 없습니다.');
      }
      setLoading(false);
      return;
    }
    const loadProfile = async () => {
      setLoading(true);
      try {
        const response = await usersAPI.getUserProfile(uid);
        setProfile(response.data);
      } catch (err) {
        setError('프로필 정보를 불러올 수 없습니다.');
      } finally {
        setLoading(false);
      }
    };
    loadProfile();
  }, [paramUserId, currentUser, isAuthenticated, authLoading, navigate]);

  // 통계 로드 (profile이 준비된 후 실행)
  useEffect(() => {
    if (!profile) return;
    (async () => {
      try {
        const [ov, ts, top] = await Promise.all([
          usersAPI.getCreatorStatsOverview(profile.id, { range: '30d' }),
          usersAPI.getCreatorTimeseries(profile.id, { metric: 'chats', range: seriesRange }),
          usersAPI.getCreatorTopCharacters(profile.id, { metric: 'chats', range: '7d', limit: 5 })
        ]);
        setOverview(ov.data || {});
        setSeries(ts.data?.series || ts.data || []);
        setTopChars(top.data || []);
      } catch (e) {
        // 백엔드 통계 API가 없거나 실패한 경우, 사용자 캐릭터 목록으로 대체 집계
        console.warn('통계 API 미구현/실패 - 사용자 캐릭터 목록으로 대체 집계');
        try {
          const res = await usersAPI.getUserCharacters(profile.id, { limit: 1000 });
          const chars = res.data || [];
          const character_total = chars.length;
          const character_public = chars.filter(c => c.is_public).length;
          const chats_total = chars.reduce((s, c) => s + (c.chat_count || 0), 0);
          const likes_total = chars.reduce((s, c) => s + (c.like_count || 0), 0);
          setOverview({ character_total, character_public, chats_total, unique_users_30d: 0, likes_total });
          const total = chats_total;
          const count = seriesRange === '24h' ? 24 : 7;
          const pseudo = Array.from({ length: count }).map((_, i) => ({ date: String(i), value: Math.round(total / count || 0) }));
          setSeries(pseudo);
          const top5 = [...chars]
            .sort((a, b) => (b.chat_count || 0) - (a.chat_count || 0))
            .slice(0, 5)
            .map(c => ({ id: c.id, name: c.name, avatar_url: c.avatar_url, value_7d: c.chat_count || 0 }));
          setTopChars(top5);
        } catch (err) {
          console.error('대체 집계도 실패:', err);
        }
      }
    })();
  }, [profile, seriesRange]);

  // [추가] 통계 카드를 위한 재사용 컴포넌트입니다.
  const StatCard = ({ title, value, icon: Icon, onClick, clickable = false }) => (
    <Card className={`text-center p-4 ${clickable ? 'cursor-pointer hover:bg-gray-750/50 transition-colors' : ''}`} onClick={onClick}>
      <CardHeader className="p-0 mb-2">
        <CardTitle className="text-sm font-medium text-gray-500 dark:text-gray-400">{title}</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="text-3xl font-bold flex items-center justify-center">
          <Icon className="w-6 h-6 mr-2 text-purple-500" />
          {value?.toLocaleString?.() ?? '0'}
        </div>
      </CardContent>
    </Card>
  );

  // [추가] 로딩 및 에러 상태에 대한 UI 처리입니다.
  if (loading || authLoading) {
    return <PageLoader />;
  }

  if (error || !profile) {
    return (
      <div className="flex flex-col items-center justify-center h-screen">
        <AlertCircle className="w-12 h-12 text-red-500 mb-4" />
        <h3 className="text-lg font-medium">오류</h3>
        <p className="text-gray-600 mb-4">{error || '프로필을 찾을 수 없습니다.'}</p>
        <Button onClick={() => navigate('/')} variant="outline">홈으로 돌아가기</Button>
      </div>
    );
  }

  // [추가] 내 프로필인지 다른 사람 프로필인지 확인하는 변수입니다.
  const isOwnProfile = currentUser?.id === profile.id;
  const joinDate = new Date(profile.created_at).toLocaleDateString('ko-KR');

  const Sparkline = ({ data = [], width = 220, height = 48 }) => {
    if (!data.length) return <div className="text-xs text-gray-500">데이터 없음</div>;
    const max = Math.max(...data.map(d => d.value || d));
    const min = Math.min(...data.map(d => d.value || d));
    const range = Math.max(1, max - min);
    const step = width / Math.max(1, data.length - 1);
    const points = data.map((d, i) => {
      const v = (d.value ?? d) - min;
      const x = i * step;
      const y = height - (v / range) * height;
      return `${x},${y}`;
    }).join(' ');
    return (
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="overflow-visible">
        <polyline fill="none" stroke="#8b5cf6" strokeWidth="2" points={points} />
      </svg>
    );
  };

  const handleClickUploadAvatar = () => {
    // 이미지 생성/삽입 모달을 우선 띄우고, 선택/확인 시 대표 아바타로 반영
    setImgModalOpen(true);
  };

  const validateExt = (file) => {
    const allowed = ['jpg','jpeg','png','webp','gif'];
    const name = (file?.name || '').toLowerCase();
    const ext = name.split('.').pop();
    return allowed.includes(ext);
  };

  const handleChangeAvatar = async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    if (!validateExt(files[0])) {
      alert('jpg, jpeg, png, webp, gif 형식만 업로드할 수 있습니다.');
      e.target.value = '';
      return;
    }
    // 크롭 모달 오픈: objectURL 생성
    const objectUrl = URL.createObjectURL(files[0]);
    setCropSrc(objectUrl);
    setIsCropOpen(true);
    if (e.target) e.target.value = '';
  };

  const handleDeleteAvatar = async () => {
    if (!profile.avatar_url) return;
    if (!window.confirm('프로필 이미지를 삭제할까요?')) return;
    setAvatarDeleting(true);
    try {
      await usersAPI.updateUserProfile(profile.id, { avatar_url: null });
      setProfile(prev => ({ ...prev, avatar_url: null }));
    } catch (err) {
      console.error('프로필 이미지 삭제 실패:', err);
      alert('프로필 이미지 삭제에 실패했습니다.');
    } finally {
      setAvatarDeleting(false);
    }
  };

  // --- 기존의 return 문 전체를 아래 내용으로 교체합니다. ---
  return (
    <AppLayout>
      <div className="max-w-5xl mx-auto p-4 sm:p-6 lg:p-8 text-gray-200">
        {/* [수정] 뒤로가기 버튼 추가 */}
        <header className="mb-6">
          <Button variant="ghost" onClick={() => navigate(-1)}>
            <ArrowLeft className="w-5 h-5 mr-2" />
            뒤로 가기
          </Button>
        </header>

        {/* [수정] 프로필 카드: 더미 데이터 대신 'profile' 상태의 실제 데이터를 사용 */}
        <Card className="mb-8 overflow-hidden bg-gray-800 border border-gray-700">
          <CardContent className="p-6 flex flex-col sm:flex-row items-center space-y-4 sm:space-y-0 sm:space-x-6">
            <div className="relative">
              <Avatar className="w-24 h-24 text-4xl">
                <AvatarImage src={resolveImageUrl(profile.avatar_url)} alt={profile.username} />
                <AvatarFallback>{profile.username.charAt(0).toUpperCase()}</AvatarFallback>
              </Avatar>
              {/* 삭제 아이콘 (이미지가 있을 때만) */}
              {profile.avatar_url && (
                <button
                  type="button"
                  onClick={handleDeleteAvatar}
                  disabled={avatarDeleting}
                  className="absolute -top-2 -right-2 bg-black/70 hover:bg-black text-white rounded-full p-1"
                  title="프로필 이미지 삭제"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
              {/* 업로드 아이콘 */}
              <button
                type="button"
                onClick={handleClickUploadAvatar}
                disabled={avatarUploading}
                className="absolute -bottom-2 -right-2 bg-purple-600 hover:bg-purple-700 text-white rounded-full p-1"
                title="프로필 이미지 업로드/생성"
              >
                <Upload className="w-4 h-4" />
              </button>
            </div>

            {/* 이미지 생성/삽입 모달 (유저 아바타 전용) */}
            <ImageGenerateInsertModal
              open={imgModalOpen}
              onClose={async (res) => {
                setImgModalOpen(false);
                try {
                  if (res && res.focusUrl) {
                    // 모달에서 선택된 첫 번째 이미지를 유저 아바타로 저장
                    await usersAPI.updateUserProfile(profile.id, { avatar_url: res.focusUrl });
                    setProfile(prev => ({ ...prev, avatar_url: res.focusUrl }));
                    try { await checkAuth?.(); } catch (_) {}
                    try { refreshProfileVersion?.(); } catch (_) {}
                    try { window.dispatchEvent(new CustomEvent('profile:updated', { detail: { ts: Date.now() } })); } catch (_) {}
                    try {
                      queryClient.invalidateQueries({ queryKey: ['trending-characters-daily'] });
                      queryClient.invalidateQueries({ queryKey: ['explore-stories'] });
                      queryClient.invalidateQueries({ queryKey: ['characters'] });
                      queryClient.invalidateQueries({ queryKey: ['top-origchat-daily'] });
                    } catch (_) {}
                  }
                } catch (_) {}
              }}
              entityType={undefined}
              entityId={undefined}
              initialGallery={profile?.avatar_url ? [{ id: `url:0:${profile.avatar_url}`, url: profile.avatar_url }] : []}
            />

            {/* 크롭 모달 (기존 파일 업로드 경로 유지) */}
            <AvatarCropModal
              isOpen={isCropOpen}
              src={cropSrc}
              outputSize={1024}
              onCancel={() => {
                try { URL.revokeObjectURL(cropSrc); } catch (_) {}
                setIsCropOpen(false);
                setCropSrc('');
              }}
              onConfirm={async (croppedFile) => {
                setIsCropOpen(false);
                setAvatarUploading(true);
                try {
                  const res = await filesAPI.uploadImages([croppedFile]);
                  const uploadedUrl = Array.isArray(res.data) ? res.data[0] : res.data;
                  await usersAPI.updateUserProfile(profile.id, { avatar_url: uploadedUrl });
                  setProfile(prev => ({ ...prev, avatar_url: uploadedUrl }));
                } catch (err) {
                  console.error('프로필 이미지 업로드 실패:', err);
                  alert('프로필 이미지 업로드에 실패했습니다.');
                } finally {
                  setAvatarUploading(false);
                  try { URL.revokeObjectURL(cropSrc); } catch (_) {}
                  setCropSrc('');
                }
              }}
            />
            <div className="flex-grow text-center sm:text-left">
              <div className="flex items-center justify-center sm:justify-start space-x-4 mb-1">
                <h1 className="text-2xl font-bold text-white">{profile.username}</h1>
                {isOwnProfile && ( // [수정] 내 프로필일 때만 '프로필 수정' 버튼 표시
                  <Button onClick={() => setShowEdit(true)} variant="outline" size="sm">
                    프로필 수정
                  </Button>
                )}
              </div>
              <p className="text-sm text-gray-400">{profile.email}</p>
              <p className="text-sm text-gray-400 mt-1">가입일: {joinDate}</p>
              <p className="mt-3 text-base">{profile.bio || '자기소개가 없습니다.'}</p>
            </div>
          </CardContent>
        </Card>

        {/* KPI 카드 */}
        <ErrorBoundary>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <StatCard
            title="캐릭터 수"
            value={overview?.character_total ?? profile.character_count ?? 0}
            icon={Users}
            clickable
            onClick={() => navigate('/my-characters')}
          />
          <StatCard title="공개 캐릭터" value={overview?.character_public ?? 0} icon={Globe} />
          <StatCard
            title="누적 대화"
            value={overview?.chats_total ?? profile.total_chat_count ?? 0}
            icon={MessageCircle}
            clickable
            onClick={() => navigate('/history')}
          />
          <StatCard title="최근 30일 유저수" value={overview?.unique_users_30d ?? 0} icon={User} />
        </div>
        </ErrorBoundary>

        {/* 시계열 범위 선택 */}
        <div className="flex items-center justify-end mb-2 gap-3">
          <span className="text-sm text-gray-400">범위</span>
          <label className="flex items-center gap-1 text-sm cursor-pointer">
            <input type="radio" name="ts-range" value="24h" checked={seriesRange==='24h'} onChange={() => setSeriesRange('24h')} />
            <span>최근 24시간</span>
          </label>
          <label className="flex items-center gap-1 text-sm cursor-pointer">
            <input type="radio" name="ts-range" value="7d" checked={seriesRange==='7d'} onChange={() => setSeriesRange('7d')} />
            <span>최근 7일</span>
          </label>
        </div>

        {/* 최근 X 범위 대화 추이 */}
        <ErrorBoundary>
        <Card className="mb-8 overflow-hidden bg-gray-800 border border-gray-700">
          <CardHeader className="pb-2">
            <CardTitle className="text-white text-base">최근 {seriesRange==='24h'?'24시간':'7일'} 대화 추이</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="p-3"><Sparkline data={series} width={480} height={64} /></div>
          </CardContent>
        </Card>
        </ErrorBoundary>

        {/* Top 5 캐릭터 */}
        <ErrorBoundary>
        <Card className="mb-2 overflow-hidden bg-gray-800 border border-gray-700">
          <CardHeader className="pb-2">
            <CardTitle className="text-white text-base">최근 7일 Top 5 캐릭터</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            {(!topChars || topChars.length === 0) && (
              <div className="text-sm text-gray-400 p-3">데이터 없음</div>
            )}
            <ul className="divide-y divide-gray-700">
              {topChars.map((c) => (
                <li key={c.id} className="flex items-center gap-3 py-2">
                  <Avatar className="w-8 h-8">
                    <AvatarImage src={resolveImageUrl(c.avatar_url)} alt={c.name} />
                    <AvatarFallback>{c.name?.charAt(0)?.toUpperCase() || 'C'}</AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <span className="text-white text-sm truncate">{c.name}</span>
                      <span className="text-purple-300 text-sm">{(c.value_7d ?? c.value)?.toLocaleString?.() ?? 0}</span>
                    </div>
                    {Array.isArray(c.series) && c.series.length > 0 && (
                      <Sparkline data={c.series} width={180} height={36} />
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
        </ErrorBoundary>

        {/* 탭 제거: 대시보드 단일 화면 */}
      </div>

      {/* 프로필 수정 모달 */}
      <ProfileEditModal
        isOpen={showEdit}
        onClose={(reason)=>{ setShowEdit(false); if (reason==='saved') { // 저장 후 최신 프로필 재로딩
          (async()=>{ try{ const r=await usersAPI.getUserProfile(profile.id); setProfile(r.data);}catch(_){}})();
        }}}
        profile={profile}
      />
    </AppLayout>
  );
};

export default ProfilePage; 