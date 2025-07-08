/**
 * 캐릭터 상세 페이지
 */

import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { charactersAPI } from '../lib/api';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '../components/ui/avatar';
import { Badge } from '../components/ui/badge';
import { Alert, AlertDescription } from '../components/ui/alert';
import { 
  ArrowLeft,
  MessageCircle,
  Heart,
  Edit,
  Trash2,
  Settings,
  Send,
  Loader2,
  AlertCircle,
  MoreVertical
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../components/ui/dropdown-menu";

const CharacterDetailPage = () => {
  const { characterId } = useParams();
  const { user, isAuthenticated } = useAuth();
  const navigate = useNavigate();

  const [character, setCharacter] = useState(null);
  const [comments, setComments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isLiked, setIsLiked] = useState(false);
  const [likeCount, setLikeCount] = useState(0);
  const [commentText, setCommentText] = useState('');
  const [submittingComment, setSubmittingComment] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    loadCharacterData();
  }, [characterId]);

  const loadCharacterData = async () => {
    setLoading(true);
    try {
      // 캐릭터 정보 로드
      const characterResponse = await charactersAPI.getCharacter(characterId);
      setCharacter(characterResponse.data);
      setLikeCount(characterResponse.data.like_count || 0);

      // 댓글 로드
      const commentsResponse = await charactersAPI.getComments(characterId);
      setComments(commentsResponse.data);

      // TODO: 좋아요 상태 확인 API 필요
      // 현재는 임시로 false 설정
      setIsLiked(false);
    } catch (err) {
      console.error('캐릭터 정보 로드 실패:', err);
      setError('캐릭터 정보를 불러올 수 없습니다.');
    } finally {
      setLoading(false);
    }
  };

  const handleLike = async () => {
    if (!isAuthenticated) {
      navigate('/login');
      return;
    }

    try {
      if (isLiked) {
        await charactersAPI.unlikeCharacter(characterId);
        setIsLiked(false);
        setLikeCount(prev => Math.max(0, prev - 1));
      } else {
        await charactersAPI.likeCharacter(characterId);
        setIsLiked(true);
        setLikeCount(prev => prev + 1);
      }
    } catch (err) {
      console.error('좋아요 처리 실패:', err);
    }
  };

  const handleCommentSubmit = async (e) => {
    e.preventDefault();
    if (!isAuthenticated) {
      navigate('/login');
      return;
    }

    if (!commentText.trim()) return;

    setSubmittingComment(true);
    try {
      const response = await charactersAPI.createComment(characterId, {
        content: commentText.trim()
      });
      setComments([response.data, ...comments]);
      setCommentText('');
    } catch (err) {
      console.error('댓글 작성 실패:', err);
    } finally {
      setSubmittingComment(false);
    }
  };

  const handleDeleteComment = async (commentId) => {
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
    navigate(`/chat/${characterId}`);
  };

  const editCharacter = () => {
    navigate(`/characters/${characterId}/edit`);
  };

  const deleteCharacter = async () => {
    if (window.confirm('정말로 이 캐릭터를 삭제하시겠습니까?')) {
      try {
        await charactersAPI.deleteCharacter(characterId);
        navigate('/');
      } catch (err) {
        console.error('캐릭터 삭제 실패:', err);
      }
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-50 via-blue-50 to-indigo-50 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4" />
          <p className="text-gray-600">캐릭터 정보를 불러오는 중...</p>
        </div>
      </div>
    );
  }

  if (error || !character) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-50 via-blue-50 to-indigo-50 flex items-center justify-center">
        <div className="text-center">
          <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">캐릭터를 찾을 수 없습니다</h3>
          <p className="text-gray-600 mb-4">{error}</p>
          <Button onClick={() => navigate('/')} variant="outline">
            홈으로 돌아가기
          </Button>
        </div>
      </div>
    );
  }

  const isOwner = user && character.creator_id === user.id;

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 via-blue-50 to-indigo-50">
      {/* 헤더 */}
      <header className="bg-white/80 backdrop-blur-sm shadow-sm border-b sticky top-0 z-50">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center space-x-4">
              <Link to="/" className="flex items-center space-x-2">
                <div className="w-8 h-8 bg-gradient-to-r from-purple-600 to-blue-600 rounded-lg flex items-center justify-center">
                  <MessageCircle className="w-5 h-5 text-white" />
                </div>
                <h1 className="text-xl font-bold text-gray-900">AI 캐릭터 챗</h1>
              </Link>
            </div>
            <Button variant="outline" onClick={() => navigate(-1)}>
              <ArrowLeft className="w-4 h-4 mr-2" />
              뒤로 가기
            </Button>
          </div>
        </div>
      </header>

      {/* 메인 컨텐츠 */}
      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* 캐릭터 정보 카드 */}
        <Card className="shadow-lg mb-8">
          <CardHeader>
            <div className="flex items-start justify-between">
              <div className="flex items-start space-x-4">
                <Avatar className="w-20 h-20">
                  <AvatarImage src={character.avatar_url} alt={character.name} />
                  <AvatarFallback className="bg-gradient-to-r from-purple-500 to-blue-500 text-white text-2xl">
                    {character.name.charAt(0)}
                  </AvatarFallback>
                </Avatar>
                <div>
                  <CardTitle className="text-2xl mb-2">{character.name}</CardTitle>
                  <CardDescription className="text-base">
                    작성자: {character.creator_username || 'Unknown'}
                  </CardDescription>
                  <div className="flex items-center space-x-4 mt-2 text-sm text-gray-500">
                    <div className="flex items-center space-x-1">
                      <MessageCircle className="w-4 h-4" />
                      <span>{(character.chat_count || 0).toLocaleString()} 대화</span>
                    </div>
                    <div className="flex items-center space-x-1">
                      <Heart className="w-4 h-4" />
                      <span>{likeCount} 좋아요</span>
                    </div>
                  </div>
                </div>
              </div>
              {isOwner && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon">
                      <MoreVertical className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={editCharacter}>
                      <Edit className="mr-2 h-4 w-4" />
                      수정
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => navigate(`/characters/${characterId}/settings`)}>
                      <Settings className="mr-2 h-4 w-4" />
                      AI 설정
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={deleteCharacter} className="text-red-600">
                      <Trash2 className="mr-2 h-4 w-4" />
                      삭제
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <h3 className="font-semibold mb-2">설명</h3>
              <p className="text-gray-600">{character.description}</p>
            </div>
            
            {character.personality && (
              <div>
                <h3 className="font-semibold mb-2">성격 및 특징</h3>
                <p className="text-gray-600">{character.personality}</p>
              </div>
            )}
            
            {character.background_story && (
              <div>
                <h3 className="font-semibold mb-2">배경 스토리</h3>
                <p className="text-gray-600">{character.background_story}</p>
              </div>
            )}

            <div className="flex items-center space-x-4 pt-4">
              <Button
                onClick={startChat}
                className="bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700"
              >
                <MessageCircle className="w-4 h-4 mr-2" />
                대화 시작하기
              </Button>
              <Button
                variant="outline"
                onClick={handleLike}
                className={isLiked ? 'text-red-600 border-red-600' : ''}
              >
                <Heart className={`w-4 h-4 mr-2 ${isLiked ? 'fill-current' : ''}`} />
                {isLiked ? '좋아요 취소' : '좋아요'}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* 댓글 섹션 */}
        <Card className="shadow-lg">
          <CardHeader>
            <CardTitle>댓글 ({comments.length})</CardTitle>
          </CardHeader>
          <CardContent>
            {/* 댓글 작성 폼 */}
            {isAuthenticated ? (
              <form onSubmit={handleCommentSubmit} className="mb-6">
                <div className="flex space-x-2">
                  <Input
                    value={commentText}
                    onChange={(e) => setCommentText(e.target.value)}
                    placeholder="댓글을 작성해주세요..."
                    maxLength={1000}
                    disabled={submittingComment}
                  />
                  <Button
                    type="submit"
                    disabled={submittingComment || !commentText.trim()}
                    className="bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700"
                  >
                    {submittingComment ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Send className="w-4 h-4" />
                    )}
                  </Button>
                </div>
              </form>
            ) : (
              <Alert className="mb-6">
                <AlertDescription>
                  댓글을 작성하려면 <Link to="/login" className="font-medium text-purple-600 hover:text-purple-500">로그인</Link>이 필요합니다.
                </AlertDescription>
              </Alert>
            )}

            {/* 댓글 목록 */}
            <div className="space-y-4">
              {comments.length > 0 ? (
                comments.map((comment) => (
                  <div key={comment.id} className="border-b pb-4 last:border-0">
                    <div className="flex items-start justify-between">
                      <div className="flex items-start space-x-3">
                        <Avatar className="w-8 h-8">
                          <AvatarImage src={comment.user_avatar_url} />
                          <AvatarFallback>{comment.username?.charAt(0) || '?'}</AvatarFallback>
                        </Avatar>
                        <div>
                          <div className="flex items-center space-x-2">
                            <span className="font-medium">{comment.username}</span>
                            <span className="text-sm text-gray-500">
                              {new Date(comment.created_at).toLocaleDateString()}
                            </span>
                          </div>
                          <p className="text-gray-600 mt-1">{comment.content}</p>
                        </div>
                      </div>
                      {user && comment.user_id === user.id && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleDeleteComment(comment.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-center text-gray-500 py-8">
                  아직 댓글이 없습니다. 첫 번째 댓글을 작성해보세요!
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
};

export default CharacterDetailPage; 