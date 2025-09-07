import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from './ui/accordion';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';
import { Button } from './ui/button';
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



const CharacterDetails = ({ character, comments, commentText, setCommentText, handleCommentSubmit, handleDeleteComment, submittingComment, user, tags = [] }) => {
  return (
    <Accordion type="single" collapsible className="w-full" defaultValue="item-1">
      <AccordionItem value="item-1" className="border-b-0">
        <AccordionTrigger className="text-lg font-semibold">
          상세 정보
        </AccordionTrigger>
        <AccordionContent>
          <Tabs defaultValue="settings" className="w-full">
            <TabsList className="grid w-full grid-cols-4 bg-gray-800">
              <TabsTrigger value="settings">캐릭터 설정</TabsTrigger>
              <TabsTrigger value="worldview">세계관</TabsTrigger>
              <TabsTrigger value="comments">댓글 ({comments.length})</TabsTrigger>
              <TabsTrigger value="tags">태그</TabsTrigger>
            </TabsList>
            <TabsContent value="settings" className="p-4 bg-gray-800 rounded-b-lg">
              <p>{character.description || '아직 캐릭터 설정이 없습니다.'}</p>
            </TabsContent>
            <TabsContent value="worldview" className="p-4 bg-gray-800 rounded-b-lg">
              <p>{character.world_setting || '아직 세계관 설정이 없습니다.'}</p>
            </TabsContent>
            <TabsContent value="tags" className="p-4 bg-gray-800 rounded-b-lg">
              {tags.length === 0 ? (
                <p className="text-gray-400">등록된 태그가 없습니다.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {tags.map(t => (
                    <span key={t.id} className="px-3 py-1 rounded-full bg-gray-700 text-gray-100 border border-gray-600 inline-flex items-center gap-2">
                      <span>{t.emoji || '🏷️'}</span>
                      <span>{t.name}</span>
                    </span>
                  ))}
                </div>
              )}
            </TabsContent>
            <TabsContent value="comments" className="p-4 bg-gray-800 rounded-b-lg">
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
                      {/* 📍 닉네임과 시간을 함께 표시하도록 수정 */}
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
            </TabsContent>
          </Tabs>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
};

export default CharacterDetails; 