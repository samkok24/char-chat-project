import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { chatAPI } from '../lib/api';
import AppLayout from '../components/layout/AppLayout';
import AgentSidebar from '../components/layout/AgentSidebar';
import { Button } from '../components/ui/button';
import { ArrowLeft, Loader2, Heart, MessageCircle, Share2, X } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

const AgentFeedPage = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [contents, setContents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [expandedIds, setExpandedIds] = useState(new Set());

  useEffect(() => {
    loadFeed(1);
  }, []);

  const loadFeed = async (pageNum) => {
    setLoading(true);
    try {
      const res = await chatAPI.getAgentFeed({ 
        page: pageNum, 
        limit: 20 
      });
      setContents(res.data.items || []);
      setPage(pageNum);
    } catch (err) {
      console.error('Failed to load feed:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleUnpublish = async (id) => {
    if (!window.confirm('피드에서 내리시겠습니까?')) return;
    try {
      await chatAPI.unpublishAgentContent(id);
      window.dispatchEvent(new CustomEvent('toast', { 
        detail: { 
          type: 'success', 
          message: '피드에서 내렸습니다' 
        } 
      }));
      loadFeed(page);
    } catch (err) {
      console.error('Failed to unpublish:', err);
      window.dispatchEvent(new CustomEvent('toast', { 
        detail: { 
          type: 'error', 
          message: '발행 취소에 실패했습니다' 
        } 
      }));
    }
  };

  const handleCardClick = (item) => {
    navigate(`/agent#session=${item.session_id}&scrollTo=${item.message_id}`);
  };

  const toggleExpand = (id) => {
    setExpandedIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });
  };

  return (
    <AppLayout 
      SidebarComponent={AgentSidebar}
      sidebarProps={{ 
        onCreateSession: () => navigate('/agent'), 
        activeSessionId: null, 
        onSessionSelect: (id) => navigate(`/agent#session=${id}`), 
        onDeleteSession: () => {},
        isGuest: !user,
        isNewChatButtonDisabled: false,
      }}
    >
      <div className="min-h-screen bg-gray-900 text-white p-6">
        <div className="max-w-6xl mx-auto">
          {/* 헤더 */}
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-4">
              <Button
                variant="ghost"
                onClick={() => navigate('/agent')}
                className="text-gray-300 hover:text-white"
              >
                <ArrowLeft className="w-5 h-5" />
              </Button>
              <h1 className="text-2xl font-bold">내 피드</h1>
            </div>
          </div>

          {/* 콘텐츠 */}
          {loading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-pink-500" />
            </div>
          ) : contents.length === 0 ? (
            <div className="text-center py-12">
              <div className="text-gray-400 mb-4">발행된 콘텐츠가 없습니다</div>
              <Button 
                onClick={() => navigate('/agent/drawer')}
                className="bg-purple-600 hover:bg-purple-700"
              >
                내 서랍에서 발행하기
              </Button>
            </div>
          ) : (
            <div className="max-w-2xl mx-auto space-y-6">
              {contents.map((item) => {
                    const isExpanded = expandedIds.has(item.id);
                    
                    return (
                      <div
                        key={item.id}
                        className="bg-gray-800 border border-gray-700 rounded-lg overflow-hidden group relative"
                      >
                        {/* 이미지 - 컨테이너 꽉 채우기 */}
                        {item.user_image_url && (
                          <div 
                            className="w-full overflow-hidden cursor-pointer bg-gray-900"
                            onClick={() => handleCardClick(item)}
                          >
                            <img
                              src={item.user_image_url}
                              alt="content"
                              className="w-full h-auto"
                              style={{ display: 'block' }}
                            />
                          </div>
                        )}

                        {/* 텍스트 영역 */}
                        <div className="p-4">
                          {/* 텍스트 기본 3줄 표시 + 펼치기 */}
                          <div className="mb-3">
                            <p className={`text-sm text-gray-200 leading-relaxed whitespace-pre-wrap ${
                              isExpanded ? '' : 'line-clamp-3'
                            }`}>
                              {item.generated_text}
                            </p>
                            
                            {/* 펼치기/접기 버튼 */}
                            {item.generated_text.length > 100 && (
                              <button 
                                onClick={() => toggleExpand(item.id)}
                                className="text-xs text-pink-400 hover:text-pink-300 mt-2"
                              >
                                {isExpanded ? '접기' : '더보기'}
                              </button>
                            )}
                          </div>
                          
                          {/* 인터랙션 버튼들 (Phase 1: 비활성) */}
                          <div className="flex items-center gap-4 mb-3 pb-3 border-b border-gray-700">
                            <button className="flex items-center gap-1 text-gray-500 cursor-not-allowed" disabled>
                              <Heart className="w-5 h-5" />
                              <span className="text-sm">0</span>
                            </button>
                            <button className="flex items-center gap-1 text-gray-500 cursor-not-allowed" disabled>
                              <MessageCircle className="w-5 h-5" />
                              <span className="text-sm">0</span>
                            </button>
                            <button className="flex items-center gap-1 text-gray-500 cursor-not-allowed" disabled>
                              <Share2 className="w-5 h-5" />
                            </button>
                          </div>
                          
                          {/* 댓글 미리보기 영역 */}
                          <div className="text-xs text-gray-500 mb-3">
                            댓글 기능은 곧 추가됩니다
                          </div>
                          
                          {/* 발행 시간 */}
                          <div className="mt-3 pt-3 border-t border-gray-700">
                            <p className="text-xs text-gray-500">
                              {new Date(item.published_at).toLocaleString('ko-KR')}
                            </p>
                          </div>
                        </div>
                        
                        {/* 발행 취소 버튼 (우상단) */}
                        <button 
                          onClick={(e) => { e.stopPropagation(); handleUnpublish(item.id); }}
                          className="absolute top-3 right-3 p-2 bg-black/80 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                          title="피드에서 내리기"
                        >
                          <X className="w-4 h-4 text-yellow-400" />
                        </button>
                      </div>
                    );
              })}
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  );
};

export default AgentFeedPage;

