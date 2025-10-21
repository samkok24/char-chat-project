import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { chatAPI } from '../lib/api';
import AppLayout from '../components/layout/AppLayout';
import AgentSidebar from '../components/layout/AgentSidebar';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { ArrowLeft, Loader2, Trash2, ChevronDown, ChevronUp } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

const AgentDrawerPage = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState('snap');
  const [contents, setContents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [expandedIds, setExpandedIds] = useState(new Set());

  useEffect(() => {
    loadContents(activeTab, 1);
  }, [activeTab]);

  const loadContents = async (mode, pageNum) => {
    setLoading(true);
    try {
      const res = await chatAPI.getAgentContents({ 
        story_mode: mode, 
        page: pageNum, 
        limit: 20 
      });
      setContents(res.data.items || []);
      setPage(pageNum);
    } catch (err) {
      console.error('Failed to load contents:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('삭제하시겠습니까?')) return;
    try {
      await chatAPI.deleteAgentContent(id);
      loadContents(activeTab, page);
    } catch (err) {
      console.error('Failed to delete:', err);
    }
  };

  const handleCardClick = (item) => {
    navigate(`/agent#session=${item.session_id}&scrollTo=${item.message_id}`);
  };

  const handlePublish = async (id) => {
    try {
      console.log('[AgentDrawer] 발행 요청 시작:', id);
      
      const response = await chatAPI.publishAgentContent(id, true);
      console.log('[AgentDrawer] 발행 성공:', response);
      
      // 🔥 1초 후 unread 설정 (캐릭터 로드 완료 대기)
      // setTimeout(() => {
      //   window.dispatchEvent(new CustomEvent('set-all-unread', { detail: { count: 5 } }));
      //   console.log('[AgentDrawer] ✅ unread 설정 이벤트 발생 (1초 후)');
      // }, 1000);
      
      window.dispatchEvent(new CustomEvent('toast', { 
        detail: { type: 'success', message: '피드에 발행되었습니다' } 
      }));
      
      navigate('/agent/feed');
    } catch (err) {
      console.error('[AgentDrawer] 발행 실패:', err);
      window.dispatchEvent(new CustomEvent('toast', { 
        detail: { type: 'error', message: '발행에 실패했습니다' } 
      }));
    }
  };
  const handleUnpublish = async (id) => {
    try {
      console.log('[AgentDrawer] 발행 취소 요청 시작:', id);
      await chatAPI.unpublishAgentContent(id);
      window.dispatchEvent(new CustomEvent('toast', { 
        detail: { 
          type: 'success', 
          message: '발행이 취소되었습니다' 
        } 
      }));
      loadContents(activeTab, page);
    } catch (err) {
      console.error('[AgentDrawer] 발행 취소 실패:', err);
      window.dispatchEvent(new CustomEvent('toast', { 
        detail: { 
          type: 'error', 
          message: '발행 취소에 실패했습니다' 
        } 
      }));
    }
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

  // 날짜별 그룹화
  const groupedByDate = contents.reduce((acc, item) => {
    const date = new Date(item.created_at).toLocaleDateString('ko-KR', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
    if (!acc[date]) acc[date] = [];
    acc[date].push(item);
    return acc;
  }, {});

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
              <h1 className="text-2xl font-bold">내 서랍</h1>
            </div>
          </div>

          {/* 탭 */}
          <Tabs value={activeTab} onValueChange={setActiveTab} className="mb-6">
            <TabsList className="bg-gray-800">
              <TabsTrigger value="snap">스냅</TabsTrigger>
              <TabsTrigger value="genre">장르</TabsTrigger>
            </TabsList>

            <TabsContent value={activeTab} className="mt-6">
              {loading ? (
                <div className="flex justify-center py-12">
                  <Loader2 className="w-8 h-8 animate-spin text-purple-500" />
                </div>
              ) : Object.keys(groupedByDate).length === 0 ? (
                <div className="text-center py-12 text-gray-400">
                  저장된 콘텐츠가 없습니다
                </div>
              ) : (
                Object.entries(groupedByDate).map(([date, items]) => (
                    <div key={date} className="mb-8">
                      <h2 className="text-lg font-semibold mb-4 text-gray-300">
                        {date} ({items.length})
                      </h2>
                      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
                      {items.map((item) => {
                        const isExpanded = expandedIds.has(item.id);
                        const textPreview = item.generated_text.slice(0, 80);
                        const needsExpand = item.generated_text.length > 80;
                        
                        return (
                          <div
                            key={item.id}
                            className="bg-gray-800 border border-gray-700 rounded-lg overflow-hidden hover:border-purple-500 transition-colors group relative"
                          >
                            {/* 삭제 버튼 */}
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDelete(item.id);
                              }}
                              className="absolute top-3 right-3 z-10 p-1.5 bg-black/80 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                            >
                              <Trash2 className="w-4 h-4 text-red-400" />
                            </button>

                            {/* 이미지 영역 */}
                            {item.user_image_url && (
                              <div 
                                className="w-full h-56 overflow-hidden cursor-pointer bg-gray-900"
                                onClick={() => handleCardClick(item)}
                              >
                                <img
                                  src={item.user_image_url}
                                  alt="content"
                                  className="w-full h-full object-cover hover:scale-105 transition-transform duration-300"
                                />
                              </div>
                            )}

                            {/* 텍스트 영역 */}
                            <div className="p-3">
                              <p className={`text-xs text-gray-300 leading-tight whitespace-pre-wrap ${!isExpanded ? 'line-clamp-2' : ''}`}>
                                {isExpanded ? item.generated_text : item.generated_text.slice(0, 80)}
                                {!isExpanded && item.generated_text.length > 80 && '...'}
                              </p>
                              
                              {/* 펼치기/접기 버튼 */}
                              {needsExpand && (
                                <div className="flex justify-center mt-2">
                                  <button
                                    onClick={() => toggleExpand(item.id)}
                                    className="p-1 rounded-full hover:bg-gray-700 transition-colors text-gray-500 hover:text-gray-300"
                                    title={isExpanded ? '접기' : '펼치기'}
                                  >
                                    {isExpanded ? (
                                      <ChevronUp className="w-4 h-4" />
                                    ) : (
                                      <ChevronDown className="w-4 h-4" />
                                    )}
                                  </button>
                                </div>
                              )}
                              
                              {/* 메타 정보 */}
                              <div className="flex items-center justify-between mt-3 pt-2 border-t border-gray-700">
                                <p className="text-xs text-gray-500">
                                  {new Date(item.created_at).toLocaleTimeString('ko-KR', {
                                    hour: '2-digit',
                                    minute: '2-digit'
                                  })}
                                </p>
                                
                                {/* 발행 상태 및 버튼 */}
                                <div className="flex items-center gap-2">
                                  {item.is_published ? (
                                    <>
                                      <Badge className="text-xs bg-green-600/20 text-green-400 border border-green-600/30">
                                        발행됨
                                      </Badge>
                                      <button
                                        onClick={(e) => { e.stopPropagation(); handleUnpublish(item.id); }}
                                        className="text-xs px-2 py-1 rounded bg-gray-600 hover:bg-gray-700 text-white transition-colors"
                                      >
                                        취소
                                      </button>
                                      <button
                                        onClick={() => navigate('/agent/feed')}
                                        className="text-xs text-pink-400 hover:text-pink-300"
                                      >
                                        피드 →
                                      </button>
                                    </>
                                  ) : (
                                    <button
                                      onClick={(e) => { e.stopPropagation(); handlePublish(item.id); }}
                                      className="text-xs px-3 py-1 rounded bg-green-600 hover:bg-green-700 text-white transition-colors"
                                    >
                                      피드에 발행
                                    </button>
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))
              )}
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </AppLayout>
  );
};

export default AgentDrawerPage;

