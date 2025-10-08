import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from './ui/accordion';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';
import { Button } from './ui/button';
import { Badge } from './ui/badge';  // 이 줄 추가
import { Input } from './ui/input';
import { Loader2, Trash2 } from 'lucide-react';

const timeAgo = (dateString) => {
  if (!dateString) return '';
  const date = new Date(dateString);
  const now = new Date();
  const seconds = Math.round((now - date) / 1000);
  const minutes = Math.round(seconds / 60);
  const hours = Math.round(minutes / 60);
  const days = Math.round(hours / 24);

  if (seconds < 60) return `방금 전`;
  if (minutes < 60) return `${minutes}분 전`;
  if (hours < 24) return `${hours}시간 전`;
  if (days < 7) return `${days}일 전`;
  
  return date.toLocaleDateString('ko-KR');
};



const CharacterDetails = ({ character, comments, commentText, setCommentText, handleCommentSubmit, handleDeleteComment, submittingComment, user, tags = [], originStoryCard = null }) => {
  return (
    <div className="space-y-8">
      {/* 소개 */}
      <section id="overview">
        <h2 className="text-lg font-semibold mb-2">캐릭터 설명</h2>
        <div className="bg-gray-800 rounded-md border border-gray-700 p-4 text-gray-200 whitespace-pre-wrap min-h-[56px]">
          {character.description || '아직 캐릭터 설명이 없습니다.'}
        </div>
      </section>

      {/* 세계관 */}
      <section id="world">
        <h2 className="text-lg font-semibold mb-2">세계관</h2>
        <div className="bg-gray-800 rounded-md border border-gray-700 p-4 text-gray-200 whitespace-pre-wrap min-h-[56px]">
          {character.world_setting || '아직 세계관 설정이 없습니다.'}
        </div>
      </section>

      {/* 원작 웹소설 카드: 세계관 바로 아래 */}
      {originStoryCard}

      {/* 태그 */}
      <section id="tags">
        <h2 className="text-lg font-semibold mb-2">태그</h2>
        {(!tags || tags.length === 0) ? (
          <p className="text-gray-400">등록된 태그가 없습니다.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {tags.map(t => (
              <Badge key={t.id || t.slug || t.name} variant="secondary" className="bg-gray-700 hover:bg-gray-600 text-white inline-flex items-center gap-1">
              {/* <span>{t.emoji || '🏷️'}</span> */}
              <span>{t.name}</span>
              </Badge>
            ))}
          </div>
        )}
      </section>

      {/* 댓글 */}
      <section id="comments">
        <h2 className="text-lg font-semibold mb-2">댓글 ({comments.length})</h2>
        <form onSubmit={handleCommentSubmit} className="flex space-x-2 mb-4">
          <Input value={commentText} onChange={(e) => setCommentText(e.target.value)} placeholder="댓글을 남겨보세요..." className="bg-gray-700 border-gray-600" />
          <Button type="submit" disabled={submittingComment}>
            {submittingComment ? <Loader2 className="w-4 h-4 animate-spin" /> : '작성'}
          </Button>
        </form>
        <div className="space-y-4 max-h-96 overflow-y-auto">
          {comments.map(comment => (
            <div key={comment.id} className="flex justify-between items-start">
              <div className="flex-1">
                <div className="flex items-center space-x-2">
                  <span className="font-semibold text-white">{comment.username}</span>
                  <span className="text-xs text-gray-500">{timeAgo(comment.created_at)}</span>
                </div>
                <p className="text-gray-300 mt-1">{comment.content}</p>
              </div>
              {user && user.id === comment.user_id && (
                <Button variant="ghost" size="icon" onClick={() => handleDeleteComment(comment.id)}>
                  <Trash2 className="w-4 h-4 text-gray-500" />
                </Button>
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
};

export default CharacterDetails; 