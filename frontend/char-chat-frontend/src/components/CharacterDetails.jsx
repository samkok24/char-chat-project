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
import { replacePromptTokens } from '../lib/prompt';

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
  /**
   * ✅ 크리에이터 코멘트 HTML 렌더링(자바스크립트 차단)
   *
   * 의도/원칙:
   * - 크리에이터가 입력한 HTML(<b>, <br>, <a> 등)은 표시하되, 스크립트 실행은 절대 허용하지 않는다.
   * - 서버에서 1차 sanitize를 수행하지만, 프론트에서도 토큰 치환 시 HTML 주입이 생기지 않도록 "토큰 값은 escape"한다.
   * - 외부 라이브러리 없이 최소 방어 로직만 추가한다(기능 추가만).
   */
  const escapeHtml = (v) => {
    try {
      return String(v ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
    } catch (_) {
      return '';
    }
  };
  const safeReplaceTokensForHtml = (html, { assistantName = '캐릭터', userName = '당신' } = {}) => {
    try {
      if (!html) return '';
      let s = String(html);
      // 금지 토큰 제거
      s = s.split('{{system}}').join('').split('{{dev}}').join('');
      // 허용되지 않은 커스텀 토큰 제거(허용 토큰만 유지)
      s = s.replace(/\{\{[^}]+\}\}/g, (tok) => (['{{assistant}}', '{{character}}', '{{user}}'].includes(tok) ? tok : ''));
      const a = escapeHtml(assistantName);
      const u = escapeHtml(userName);
      return s
        .replaceAll('{{assistant}}', a)
        .replaceAll('{{character}}', a)
        .replaceAll('{{user}}', u);
    } catch (_) {
      return '';
    }
  };

  return (
    <div className="space-y-8">
      {/* 소개 */}
      <section id="overview">
        <h2 className="text-lg font-semibold mb-2">캐릭터 설명</h2>
        <div className="bg-gray-800 rounded-md border border-gray-700 p-4 text-gray-200 whitespace-pre-wrap min-h-[56px]">
          {(() => {
            const nm = character?.name || '캐릭터';
            const raw = character?.description || '';
            const rendered = replacePromptTokens(raw, { assistantName: nm, userName: '당신' }).trim();
            return rendered || '아직 캐릭터 설명이 없습니다.';
          })()}
        </div>
      </section>

      {/* 세계관 */}
      <section id="world">
        <h2 className="text-lg font-semibold mb-2">세계관</h2>
        <div className="bg-gray-800 rounded-md border border-gray-700 p-4 text-gray-200 whitespace-pre-wrap min-h-[56px]">
          {(() => {
            const nm = character?.name || '캐릭터';
            const raw = character?.world_setting || '';
            const rendered = replacePromptTokens(raw, { assistantName: nm, userName: '당신' }).trim();
            return rendered || '아직 세계관 설정이 없습니다.';
          })()}
        </div>
        {/* 원작 웹소설 카드: 세계관 섹션 내부에 포함 (섹션 순서 요구사항 유지) */}
        {originStoryCard}
      </section>

      {/* 크리에이터 코멘트 (요구사항: 세계관 밑으로 이동) */}
      <section id="creator-comment">
        <h2 className="text-lg font-semibold mb-2">크리에이터 코멘트</h2>
        <div className="bg-gray-800 rounded-md border border-gray-700 p-4 text-gray-200 min-h-[56px]">
          {(() => {
            const nm = character?.name || '캐릭터';
            const raw = character?.user_display_description || '';
            const rendered = safeReplaceTokensForHtml(raw, { assistantName: nm, userName: '당신' }).trim();
            if (!rendered) {
              return <div className="text-gray-400 whitespace-pre-wrap">아직 크리에이터 코멘트가 없습니다.</div>;
            }
            // ✅ 서버 sanitize + 토큰 escape 기반으로 안전한 HTML만 렌더링
            return (
              <div
                className="whitespace-pre-wrap leading-7"
                dangerouslySetInnerHTML={{ __html: rendered }}
              />
            );
          })()}
        </div>
      </section>

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
        <form onSubmit={handleCommentSubmit} className="flex flex-col sm:flex-row gap-2 mb-4">
          <Input
            value={commentText}
            onChange={(e) => setCommentText(e.target.value)}
            placeholder="댓글을 남겨보세요..."
            className="bg-gray-700 border-gray-600 text-white placeholder:text-gray-400"
          />
          <Button type="submit" disabled={submittingComment} className="w-full sm:w-auto">
            {submittingComment ? <Loader2 className="w-4 h-4 animate-spin" /> : '작성'}
          </Button>
        </form>
        {/* ✅ 모바일 UX: 내부 스크롤(중첩 스크롤) 제거 → 페이지 스크롤로 자연스럽게 읽기 */}
        <div className="space-y-4 max-h-none overflow-visible sm:max-h-96 sm:overflow-y-auto">
          {comments.map(comment => (
            <div key={comment.id} className="flex justify-between items-start">
              <div className="flex-1">
                <div className="flex items-center space-x-2">
                  <span className="font-semibold text-white">{comment.username}</span>
                  <span className="text-xs text-gray-500">{timeAgo(comment.created_at)}</span>
                </div>
                <p className="text-gray-300 mt-1">{comment.content}</p>
              </div>
                {(user && (user.id === comment.user_id || user.is_admin)) && (
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