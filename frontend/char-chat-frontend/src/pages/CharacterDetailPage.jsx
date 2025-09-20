/**
 * 캐릭터 상세 페이지
 */

import React, { useState, useEffect } from 'react';
import { useParams, useNavigate,useLocation} from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { charactersAPI,API_BASE_URL, api } from '../lib/api';
import { resolveImageUrl } from '../lib/images';
import { DEFAULT_SQUARE_URI } from '../lib/placeholder';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '../components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '../components/ui/avatar';
import { Badge } from '../components/ui/badge';
import {
  ArrowLeft,
  MessageCircle,
  Heart,
  Edit,
  Trash2,
  Settings,
  Loader2,
  AlertCircle,
  MoreVertical,
  Star,
  Plus
} from 'lucide-react';
import CharacterInfoHeader from '../components/CharacterInfoHeader'; // 컴포넌트 임포트
import ChatInteraction from '../components/ChatInteraction'; // 컴포넌트 임포트
import CharacterDetails from '../components/CharacterDetails'; // 컴포넌트 임포트
import AnalyzedCharacterCard from '../components/AnalyzedCharacterCard';
import StoryExploreCard from '../components/StoryExploreCard';
import { getReadingProgress } from '../lib/reading';

const CharacterDetailPage = () => {
  const { characterId } = useParams();
  const { user, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  // 2. useLocation hook을 호출하여 location 객체를 가져옵니다.
  const location = useLocation();
  const queryClient = useQueryClient();

  const [character, setCharacter] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  
  // Caveduck UI를 위한 임시 상태
  const [activeImage, setActiveImage] = useState('');
  const [galleryImages, setGalleryImages] = useState([]);
  const [isLiked, setIsLiked] = useState(false);
  // 첫 번째 이미지의 가로세로 비율을 기억하여 메인 프리뷰의 사이즈를 고정
  const [baseRatio, setBaseRatio] = useState(1); // height/width
  const [likeCount, setLikeCount] = useState(0);

  const [comments, setComments] = useState([]);
  const [commentText, setCommentText] = useState('');
  const [submittingComment, setSubmittingComment] = useState(false);
  const [tags, setTags] = useState([]);

  // 3. 뒤로가기: 항상 홈(메인 탭)으로 이동
  const handleGoBack = () => {
    navigate('/');
  };

  useEffect(() => {
    const loadCharacterData = async () => {
      setLoading(true);
      try {
        const response = await charactersAPI.getCharacter(characterId);
        const characterData = response.data;
        setCharacter(characterData);
        setLikeCount(characterData.like_count || 0);

        // [핵심 수정] 이미지 갤러리 설정
        const mainImageUrl = characterData.avatar_url;
        // characterData.image_descriptions가 있고, 배열인지 확인
        const galleryImageUrls = Array.isArray(characterData.image_descriptions)
          ? characterData.image_descriptions.map(img => img.url)
          : [];

        // 대표 아바타 이미지를 갤러리의 첫 번째 이미지로 포함
        const allImages = [mainImageUrl, ...galleryImageUrls].filter(Boolean);
        
        // 중복 제거 (아바타와 갤러리 이미지가 같을 수 있으므로)
        const uniqueImages = [...new Set(allImages)];

        setGalleryImages(uniqueImages);
        const first = uniqueImages[0] || DEFAULT_SQUARE_URI;
        setActiveImage(first); // 기본 이미지
        // 첫 이미지의 비율을 측정해 고정
        try {
          const probe = new Image();
          probe.onload = () => {
            const w = probe.naturalWidth || 1;
            const h = probe.naturalHeight || 1;
            setBaseRatio(h / w);
          };
          probe.src = resolveImageUrl(first) || first;
        } catch (_) {}
        
        // 좋아요 상태 확인
        if (isAuthenticated) {
          const likeStatusResponse = await charactersAPI.getLikeStatus(characterId);
          setIsLiked(likeStatusResponse.data.is_liked);
        }

        // 댓글 로드
        const commentsResponse = await charactersAPI.getComments(characterId);
        setComments(commentsResponse.data);

        // 태그 로드
        try {
          const tagRes = await api.get(`/characters/${characterId}/tags`);
          setTags(tagRes.data || []);
        } catch (_) {}


      } catch (err) {
        console.error('캐릭터 정보 로드 실패:', err);
        setError('캐릭터 정보를 불러올 수 없습니다.');
      } finally {
        setLoading(false);
      }
    };
    loadCharacterData();
  }, [characterId, isAuthenticated]);

  const handleCommentSubmit = async (e) => {
    e.preventDefault();
    // 📍 현재 로그인한 user 객체가 있는지 확인하는 가드 추가
    if (!isAuthenticated || !commentText.trim() || !user) return;

    setSubmittingComment(true);
    try {
      const response = await charactersAPI.createComment(characterId, { content: commentText.trim() });
      
      // [핵심 수정] 새로 생성된 댓글 정보에 현재 사용자 정보를 합쳐줍니다.
      const newComment = {
        ...response.data, // 백엔드로부터 받은 댓글 정보 (id, content, user_id 등)
        username: user.username, // 현재 로그인한 사용자의 닉네임
        user_avatar_url: user.avatar_url || null // 현재 로그인한 사용자의 아바타
      };

      // 📍 완전한 정보를 가진 newComment 객체를 상태에 추가합니다.
      setComments([newComment, ...comments]);
      setCommentText('');
    } catch (err) {
      console.error('댓글 작성 실패:', err);
    } finally {
      setSubmittingComment(false);
    }
  };

  const handleDeleteComment = async (commentId) => {
    if (!window.confirm('정말로 이 댓글을 삭제하시겠습니까?')) return;
    try {
      await charactersAPI.deleteComment(commentId);
      setComments(comments.filter(c => c.id !== commentId));
    } catch (err) {
      console.error('댓글 삭제 실패:', err);
    }
  };

  const startChat = () => {
    if (!isAuthenticated) {
      navigate('/login');
      return;
    }
    // 실제 채팅 페이지로 이동하도록 경로 수정
    navigate(`/ws/chat/${characterId}`);
  };

  // 🔥 useMutation을 사용한 좋아요 처리
  const likeMutation = useMutation({
    mutationFn: (liked) => 
      liked 
        ? charactersAPI.unlikeCharacter(characterId) 
        : charactersAPI.likeCharacter(characterId),
    onSuccess: () => {
      // 좋아요 상태 즉시 업데이트
      setIsLiked((prev) => !prev);
      setLikeCount((prev) => isLiked ? Math.max(0, prev - 1) : prev + 1);
      
      // 🚀 메인 페이지의 캐릭터 목록 캐시를 무효화하여 자동 업데이트 유도
      queryClient.invalidateQueries({ queryKey: ['characters'] });
      // 관심(좋아요) 목록 캐시 무효화: 홈 섹션 및 즐겨찾기 페이지 모두
      queryClient.invalidateQueries({ queryKey: ['liked-characters'] });
      queryClient.invalidateQueries({ queryKey: ['liked-characters-page'] });
    },
    onError: (err) => {
      console.error('좋아요 처리 실패:', err);
    },
  });

  const handleLike = () => {
    if (!isAuthenticated) {
      navigate('/login');
      return;
    }
    likeMutation.mutate(isLiked);
  };

  const isOwner = user && character?.creator_id === user.id;
  const originStoryId = character?.origin_story_id || null;

  const togglePublicMutation = useMutation({
    mutationFn: () => charactersAPI.toggleCharacterPublic(characterId),
    onSuccess: (data) => {
      // 서버로부터 받은 최신 정보로 캐릭터 상태 업데이트
      setCharacter(prev => ({ ...prev, is_public: data.data.is_public }));
      // 🚀 캐시를 무효화하여 다른 페이지에도 변경사항이 반영되도록 함
      queryClient.invalidateQueries({ queryKey: ['characters'] });
    },
    onError: (err) => {
      console.error('공개 상태 변경 실패:', err);
      // 필요하다면 여기에서 사용자에게 오류 알림
    },
  });

  const handleTogglePublic = () => {
    togglePublicMutation.mutate();
  };

  // 웹소설 원작 표시/연동 판단
  const searchParams = new URLSearchParams(location.search || '');
  const isWebNovel = (character?.source_type === 'IMPORTED') || (location.state?.source === 'webnovel') || (searchParams.get('source') === 'webnovel');
  const workId = location.state?.workId || searchParams.get('workId') || null;
  const progress = getReadingProgress(workId);
  const continueChapter = progress > 0 ? progress : 1;

  const deleteCharacter = async () => {
    if (!window.confirm('정말로 이 캐릭터를 삭제하시겠습니까?')) return;
    try {
      await charactersAPI.deleteCharacter(characterId);
      try {
        queryClient.invalidateQueries({ queryKey: ['top-origchat-daily'] });
        queryClient.invalidateQueries({ queryKey: ['webnovel-characters'] });
        queryClient.invalidateQueries({ queryKey: ['characters'] });
        queryClient.invalidateQueries({ queryKey: ['liked-characters'] });
        queryClient.invalidateQueries({ queryKey: ['explore-stories'] });
      } catch (_) {}
      navigate('/');
    } catch (err) {
      console.error('캐릭터 삭제 실패:', err);
      alert('캐릭터 삭제에 실패했습니다.');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-900 text-white">
        <Loader2 className="w-8 h-8 animate-spin" />
      </div>
    );
  }

  if (error || !character) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-900 text-white">
        <div className="text-center">
          <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
          <h3 className="text-lg font-medium mb-2">오류</h3>
          <p className="text-gray-400 mb-4">{error}</p>
          <Button onClick={() => navigate('/')} variant="outline">
            홈으로 돌아가기
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-gray-900 text-white min-h-screen p-4 sm:p-6 lg:p-8">
      <div className="max-w-7xl mx-auto">
        {/* 뒤로가기 버튼 등 헤더 영역 */}
        <header className="mb-6">
          <Button variant="ghost" onClick={handleGoBack} className="mb-4">
            <ArrowLeft className="w-5 h-5 mr-2" />
            뒤로 가기
          </Button>
        </header>

        {/* 메인 컨텐츠 그리드 */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Left: 이미지 갤러리 */}
          <div className="lg:col-span-1">
            {/* 메인 프리뷰: 첫 이미지 비율에 맞춰 컨테이너 고정 */}
            <div className="relative w-full mb-3" style={{ paddingTop: `${Math.max(0.1, baseRatio) * 100}%` }}>
              <img
                src={resolveImageUrl(activeImage) || activeImage}
                alt={character.name}
                className="absolute inset-0 w-full h-full object-cover rounded-lg"
              />
              <div className="absolute top-2 left-2">
                {character?.origin_story_id ? (
                  <Badge className="bg-orange-400 text-black hover:bg-orange-400">원작챗</Badge>
                ) : (isWebNovel || character?.source_type === 'IMPORTED') ? (
                  <Badge className="bg-blue-600 text-white hover:bg-blue-600">웹소설</Badge>
                ) : (
                  <Badge className="bg-purple-600 text-white hover:bg-purple-600">캐릭터</Badge>
                )}
              </div>
            </div>
            {/* 미니 갤러리: 가로 스크롤 */}
            <div id="detail-thumbnail-gallery" className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
              {galleryImages.map((imgUrl, index) => {
                const isActive = activeImage === imgUrl;
                return (
                  <button
                    key={index}
                    onClick={() => setActiveImage(imgUrl)}
                    className={`relative flex-shrink-0 ${isActive ? 'ring-2 ring-purple-500 ring-offset-1 ring-offset-gray-900' : 'opacity-80 hover:opacity-100'}`}
                    aria-label={`썸네일 ${index + 1}`}
                  >
                    <img
                      src={resolveImageUrl(imgUrl) || imgUrl}
                      alt={`${character.name} thumbnail ${index + 1}`}
                      className={`w-16 h-16 object-cover rounded-md ${isActive ? 'brightness-100' : 'brightness-90'}`}
                    />
                  </button>
                );
              })}
            </div>
          </div>

          {/* Right: 캐릭터 정보 */}
          <div className="lg:col-span-2 space-y-8">
            <CharacterInfoHeader 
              character={character}
              likeCount={likeCount}
              isLiked={isLiked}
              handleLike={handleLike}
              isOwner={isOwner}
              onEdit={() => navigate(`/characters/${characterId}/edit`)}
              onDelete={deleteCharacter}
              onSettings={() => navigate(`/characters/${characterId}/settings`)}
              onTogglePublic={handleTogglePublic} // 핸들러 함수 전달
              isWebNovel={isWebNovel}
              workId={workId}
              tags={tags}
            />

            {/* 원작 웹소설 카드는 CharacterDetails 내 '세계관' 아래에서만 노출 */}

            {isWebNovel && workId && (
              <div className="flex items-center gap-2">
                <Button className="bg-purple-600 hover:bg-purple-700" onClick={() => navigate(`/works/${workId}/chapters/1`)}>
                  첫화보기
                </Button>
                <Button variant="outline" className="border-gray-700 text-gray-200" onClick={() => navigate(`/works/${workId}/chapters/${continueChapter}`)}>
                  이어보기{progress > 0 ? ` (${continueChapter}화)` : ''}
                </Button>
                <Button
                  variant="secondary"
                  className="bg-pink-600 hover:bg-pink-700"
                  onClick={() => navigate(`/ws/chat/${characterId}?source=origchat&storyId=${workId}&anchor=${continueChapter}`)}
                >
                  원작챗 시작
                </Button>
              </div>
            )}

            {isWebNovel && (
              <div className="mt-4">
                <h3 className="text-lg font-semibold mb-2">소설 캐릭터 요약</h3>
                <AnalyzedCharacterCard
                  initialCharacter={{
                    name: character.name,
                    description: character.description || '',
                    social_tendency: 50,
                  }}
                  readOnly
                />
              </div>
            )}

            <ChatInteraction onStartChat={startChat} characterId={characterId} isAuthenticated={isAuthenticated} />
            <CharacterDetails 
              character={character}
              comments={comments}
              commentText={commentText}
              setCommentText={setCommentText}
              handleCommentSubmit={handleCommentSubmit}
              handleDeleteComment={handleDeleteComment}
              submittingComment={submittingComment}
              user={user}
              tags={tags}
              originStoryCard={originStoryId ? (
                <div className="max-w-sm">
                  <StoryExploreCard
                    story={{ id: originStoryId, title: character?.origin_story_title, cover_url: character?.origin_story_cover, creator_username: character?.origin_story_creator, view_count: character?.origin_story_views, like_count: character?.origin_story_likes, excerpt: character?.origin_story_excerpt }}
                    compact
                    onClick={() => navigate(`/stories/${originStoryId}`)}
                  />
                </div>
              ) : null}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default CharacterDetailPage; 