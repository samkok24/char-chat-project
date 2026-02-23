import React from 'react';
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
import { Loader2, Trash2, Bot } from 'lucide-react';
import { replacePromptTokens } from '../lib/prompt';
import { ChevronDown } from 'lucide-react';
import RichMessageHtml from './RichMessageHtml';
import { Avatar, AvatarFallback, AvatarImage } from './ui/avatar';
import { getCharacterPrimaryImage } from '../lib/images';

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



const CharacterDetails = ({
  character,
  comments,
  commentText,
  setCommentText,
  handleCommentSubmit,
  handleDeleteComment,
  submittingComment,
  user,
  tags = [],
  originStoryCard = null,
  hideCreatorComment = false,
  hideTags = false,
  hideOpeningSelect = false,
  openingId = '',
  onOpeningChange = null,
}) => {
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
      s = s.replace(/\{\{[^}]+\}\}/g, (tok) => (['{{assistant}}', '{{character}}', '{{char}}', '{{user}}'].includes(tok) ? tok : ''));
      const a = escapeHtml(assistantName);
      const u = escapeHtml(userName);
      return s
        .replaceAll('{{assistant}}', a)
        .replaceAll('{{character}}', a)
        .replaceAll('{{char}}', a)
        .replaceAll('{{user}}', u);
    } catch (_) {
      return '';
    }
  };

  const isNormalCharacterChat = !character?.origin_story_id;
  const [showDetail, setShowDetail] = React.useState(false);

  const detailPrefs = (() => {
    /**
     * ✅ personality에 포함된 디테일 섹션([관심사]/[좋아하는 것]/[싫어하는 것]) 파싱
     *
     * 주의:
     * - 이 포맷은 캐릭터 생성(CreateCharacterPage)에서 personality에 병합하는 방식과 정합을 맞춘다.
     */
    try {
      const s = String(character?.personality || '');
      const pick = (label) => {
        const rx = new RegExp(`\\[${label}\\]\\n([\\s\\S]*?)(?=\\n\\[(관심사|좋아하는 것|싫어하는 것)\\]|\\n*$)`, 'm');
        const m = s.match(rx);
        return (m && m[1]) ? String(m[1]).trim() : '';
      };
      const splitKeywords = (block) => {
        const t = String(block || '').trim();
        if (!t) return [];
        const lines = t
          .replace(/\r/g, '\n')
          .split('\n')
          .map((x) => x.trim())
          .filter(Boolean)
          .map((x) => x.replace(/^[-•\s]+/, '').trim())
          .filter(Boolean);
        const flat = [];
        for (const ln of lines) {
          const parts = ln.split(/[,|/]+/).map((p) => p.trim()).filter(Boolean);
          for (const p of parts) flat.push(p);
        }
        const uniq = [];
        for (const k of flat) {
          if (!uniq.includes(k)) uniq.push(k);
          if (uniq.length >= 20) break;
        }
        return uniq;
      };
      return {
        interests: splitKeywords(pick('관심사')),
        likes: splitKeywords(pick('좋아하는 것')),
        dislikes: splitKeywords(pick('싫어하는 것')),
      };
    } catch (_) {
      return { interests: [], likes: [], dislikes: [] };
    }
  })();

  const cleanPersonalityForDisplay = (() => {
    try {
      const base = String(character?.personality || '');
      return base
        .replace(/\n?\[관심사\][\s\S]*?(?=\n\[좋아하는 것\]|\n\[싫어하는 것\]|\n*$)/g, '')
        .replace(/\n?\[좋아하는 것\][\s\S]*?(?=\n\[관심사\]|\n\[싫어하는 것\]|\n*$)/g, '')
        .replace(/\n?\[싫어하는 것\][\s\S]*?(?=\n\[관심사\]|\n\[좋아하는 것\]|\n*$)/g, '')
        .trim();
    } catch (_) {
      return String(character?.personality || '').trim();
    }
  })();
  const startSetOptions = (() => {
    /**
     * ✅ 오프닝(=start_sets) 목록 추출
     *
     * 의도:
     * - 상세/모달에서 유저가 오프닝을 선택하면, 동일 화면에서 첫 상황/첫대사가 즉시 바뀌어 보여야 한다.
     * - "선택한 오프닝"은 채팅 시작 URL 파라미터로 전달되어 ChatPage에서 우선 적용된다.
     */
    try {
      const ss = character?.start_sets;
      const items = Array.isArray(ss?.items) ? ss.items : [];
      return items
        .map((x, idx) => ({
          id: String(x?.id || '').trim(),
          title: String(x?.title || '').trim() || `오프닝 ${idx + 1}`,
          intro: String(x?.intro || '').trim(),
          firstLine: String(x?.firstLine || x?.first_line || '').trim(),
        }))
        .filter((x) => x.id);
    } catch (_) {
      return [];
    }
  })();

  const effectiveOpeningId = (() => {
    try {
      const oid = String(openingId || '').trim();
      if (oid && startSetOptions.some((x) => x.id === oid)) return oid;
    } catch (_) {}
    try {
      const ss = character?.start_sets;
      const sid = String(ss?.selectedId || ss?.selected_id || '').trim();
      if (sid && startSetOptions.some((x) => x.id === sid)) return sid;
    } catch (_) {}
    return startSetOptions?.[0]?.id || '';
  })();

  const firstStart = (() => {
    /**
     * ✅ 첫시작 표시 데이터 추출(일반 캐릭터챗)
     *
     * 우선순위:
     * 1) start_sets(신규 위저드 SSOT)
     * 2) introduction_scenes[0].content + greeting(레거시)
     */
    try {
      if (startSetOptions.length > 0) {
        const picked = startSetOptions.find((x) => x.id === effectiveOpeningId) || startSetOptions[0] || null;
        const intro = String(picked?.intro || '').trim();
        const firstLine = String(picked?.firstLine || '').trim();
        if (intro || firstLine) return { intro, firstLine };
      }
    } catch (_) {}

    try {
      const scenes = Array.isArray(character?.introduction_scenes) ? character.introduction_scenes : [];
      const intro = String(scenes?.[0]?.content || '').trim();
      const firstLine = String(character?.greeting || (Array.isArray(character?.greetings) ? character.greetings[0] : '') || '').trim();
      return { intro, firstLine };
    } catch (_) {
      return { intro: '', firstLine: '' };
    }
  })();

  const canChangeOpening = typeof onOpeningChange === 'function';

  return (
    <div className="space-y-8">
      {/* ✅ 일반 캐릭터챗 상세: 캐릭터소개/첫시작/크리에이터 코멘트/댓글만 노출 */}
      {isNormalCharacterChat ? (
        <>
          {/* 캐릭터소개 */}
          <section id="overview">
            <div className="text-gray-200 whitespace-pre-wrap leading-7">
              {(() => {
                const nm = character?.name || '캐릭터';
                const raw = character?.description || '';
                const rendered = replacePromptTokens(raw, { assistantName: nm, userName: '당신' }).trim();
                return rendered || '아직 캐릭터 소개가 없습니다.';
              })()}
            </div>

            {/* 태그(모달/상세 공통)
             * - 상세 페이지(풀뷰): 소개 아래 그대로 노출
             * - 모달(compact): '공개일 | 수정일' 아래로 이동하므로 여기서는 숨길 수 있게 한다.
             */}
            {!hideTags && Array.isArray(tags) && tags.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {tags.slice(0, 12).map((t) => (
                  <Badge
                    key={t.id || t.slug || t.name}
                    variant="secondary"
                    className="bg-gray-800/70 hover:bg-gray-700 text-white"
                  >
                    #{t.name}
                  </Badge>
                ))}
              </div>
            )}

            {/* 상세보기 토글 */}
            <div className="mt-4">
              <Button
                type="button"
                variant="secondary"
                aria-expanded={showDetail ? true : false}
                aria-controls="detail"
                className={[
                  'w-full flex items-center justify-between',
                  'bg-gray-900/60 hover:bg-gray-900/80 text-white',
                  'border border-gray-800 hover:border-gray-700',
                  'shadow-sm hover:shadow-md transition-all',
                  'rounded-lg px-4 py-3',
                ].join(' ')}
                onClick={() => setShowDetail((prev) => !prev)}
              >
                <span className="text-sm font-semibold tracking-tight">
                  상세 정보 {showDetail ? '접기' : '더 보기'}
                </span>
                <span
                  className={[
                    'inline-flex items-center justify-center',
                    'w-8 h-8 rounded-full',
                    'bg-black/20 border border-gray-800',
                    'transition-transform duration-200',
                    showDetail ? 'rotate-180' : 'rotate-0',
                  ].join(' ')}
                  aria-hidden="true"
                >
                  <ChevronDown className="w-4 h-4" />
                </span>
              </Button>
            </div>
          </section>

          {/* 상세보기(성격/말투/관심사/좋아하는 것/싫어하는 것) */}
          {showDetail && (
            <section id="detail" className="space-y-6">
              <div>
                <h2 className="text-lg font-semibold mb-2">성격</h2>
                <div className="text-gray-200 whitespace-pre-wrap leading-7">
                  {(() => {
                    const nm = character?.name || '캐릭터';
                    const raw = cleanPersonalityForDisplay || '';
                    const rendered = replacePromptTokens(raw, { assistantName: nm, userName: '당신' }).trim();
                    return rendered || '등록된 성격 정보가 없습니다.';
                  })()}
                </div>
              </div>

              <div>
                <h2 className="text-lg font-semibold mb-2">말투</h2>
                <div className="text-gray-200 whitespace-pre-wrap leading-7">
                  {(() => {
                    const nm = character?.name || '캐릭터';
                    const raw = String(character?.speech_style || '').trim();
                    const rendered = replacePromptTokens(raw, { assistantName: nm, userName: '당신' }).trim();
                    return rendered || '등록된 말투 정보가 없습니다.';
                  })()}
                </div>
              </div>

              {(detailPrefs.interests.length || detailPrefs.likes.length || detailPrefs.dislikes.length) ? (
                <div className="space-y-4">
                  {detailPrefs.interests.length ? (
                    <div>
                      <h3 className="text-sm font-semibold text-gray-300 mb-2">관심사</h3>
                      <div className="flex flex-wrap gap-2">
                        {detailPrefs.interests.map((x) => (
                          <Badge key={`i:${x}`} className="bg-gray-800 text-white hover:bg-gray-700">{x}</Badge>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  {detailPrefs.likes.length ? (
                    <div>
                      <h3 className="text-sm font-semibold text-gray-300 mb-2">좋아하는 것</h3>
                      <div className="flex flex-wrap gap-2">
                        {detailPrefs.likes.map((x) => (
                          <Badge key={`l:${x}`} className="bg-gray-800 text-white hover:bg-gray-700">{x}</Badge>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  {detailPrefs.dislikes.length ? (
                    <div>
                      <h3 className="text-sm font-semibold text-gray-300 mb-2">싫어하는 것</h3>
                      <div className="flex flex-wrap gap-2">
                        {detailPrefs.dislikes.map((x) => (
                          <Badge key={`d:${x}`} className="bg-gray-800 text-white hover:bg-gray-700">{x}</Badge>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="text-sm text-gray-400">
                  관심사/좋아하는 것/싫어하는 것이 아직 등록되지 않았습니다.
                </div>
              )}
            </section>
          )}

          {/* 오프닝(=첫시작) : 경쟁사 UX처럼 상세보기와 무관하게 항상 노출 */}
          <section id="first-start">
            {/* ✅ 접근성/구조 유지: 섹션 제목은 숨김 처리 */}
            <h2 className="sr-only">오프닝</h2>

            {/* ✅ 요청사항: '오프닝' 문구 대신, 크리에이터가 설정한 오프닝명 "태그형 칩"을 노출 */}
            {!hideOpeningSelect && startSetOptions.length > 0 ? (
              <div className="mb-3 flex flex-wrap items-center gap-2">
                {startSetOptions.map((opt) => {
                  const active = String(opt?.id || '') === String(effectiveOpeningId || '');
                  const title = String(opt?.title || '').trim() || '오프닝';
                  return (
                    <button
                      key={`opening-chip:${opt.id}`}
                      type="button"
                      disabled={!canChangeOpening}
                      aria-pressed={active ? 'true' : 'false'}
                      onClick={() => {
                        if (!canChangeOpening) return;
                        try { onOpeningChange?.(opt.id); } catch (_) {}
                      }}
                      // ✅ 위저드 오프닝 칩(탭) 디자인과 동일 톤으로 통일
                      className={[
                        'inline-flex items-center gap-2 h-9 px-3 rounded-full border transition select-none',
                        active
                          ? 'bg-black/20 border-purple-500 text-white'
                          : 'bg-black/20 border-white/10 text-white/80 hover:bg-white/5 hover:text-white',
                        canChangeOpening ? 'cursor-pointer' : 'opacity-70 cursor-default pointer-events-none',
                      ].join(' ')}
                      title={title}
                    >
                      <span className="text-sm font-semibold max-w-[220px] truncate">{title}</span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="text-lg font-semibold mb-2">오프닝</div>
            )}
            <div className="space-y-3">
              <div className="text-gray-200 whitespace-pre-wrap leading-7">
                {(() => {
                  const nm = character?.name || '캐릭터';
                  const raw = firstStart?.intro || '';
                  const rendered = replacePromptTokens(raw, { assistantName: nm, userName: '당신' }).trim();
                  return rendered || '아직 도입부가 없습니다.';
                })()}
              </div>
              {/* ✅ 첫대사: 채팅창 assistant 말풍선 디자인 + 원형 아바타 + 볼드 유지 */}
              <div className="flex items-start gap-2">
                <Avatar className="size-10 rounded-full shrink-0">
                  <AvatarImage className="object-cover object-top" src={getCharacterPrimaryImage(character)} alt={character?.name || '캐릭터'} />
                  <AvatarFallback className="bg-gradient-to-r from-purple-500 to-blue-500 text-white">
                    {character?.name?.charAt?.(0) || <Bot className="w-4 h-4" />}
                  </AvatarFallback>
                </Avatar>
                <div className="relative w-fit max-w-full sm:max-w-[85%] px-3 py-2 rounded-2xl shadow-md overflow-hidden rounded-tl-none cc-assistant-speech-bubble bg-white/10 border border-white/10 text-gray-100 font-semibold">
                  <p className="whitespace-pre-wrap break-words">
                    {(() => {
                      try {
                        const nm = character?.name || '캐릭터';
                        const raw = firstStart?.firstLine || '';
                        const rendered = replacePromptTokens(raw, { assistantName: nm, userName: '당신' }).trim();
                        return rendered || '아직 첫대사가 없습니다.';
                      } catch (_) {
                        return '아직 첫대사가 없습니다.';
                      }
                    })()}
                  </p>
                </div>
              </div>
            </div>
          </section>
        </>
      ) : (
        <>
          {/* 소개 */}
          <section id="overview">
            <h2 className="text-lg font-semibold mb-2">캐릭터 설명</h2>
            <div className="text-gray-200 whitespace-pre-wrap leading-7">
              {(() => {
                const nm = character?.name || '캐릭터';
                const raw = character?.description || '';
                const rendered = replacePromptTokens(raw, { assistantName: nm, userName: '당신' }).trim();
                return rendered || '아직 캐릭터 설명이 없습니다.';
              })()}
            </div>
          </section>

          {/* 오프닝(=도입부/첫대사): 원작챗에서도 상단 정보로 노출 */}
          <section id="first-start">
            {/* ✅ 접근성/구조 유지: 섹션 제목은 숨김 처리 */}
            <h2 className="sr-only">오프닝</h2>

            {/* ✅ 요청사항: '오프닝' 문구 대신, 크리에이터가 설정한 오프닝명 "태그형 칩"을 노출 */}
            {!hideOpeningSelect && startSetOptions.length > 0 ? (
              <div className="mb-3 flex flex-wrap items-center gap-2">
                {startSetOptions.map((opt) => {
                  const active = String(opt?.id || '') === String(effectiveOpeningId || '');
                  const title = String(opt?.title || '').trim() || '오프닝';
                  return (
                    <button
                      key={`opening-chip:${opt.id}`}
                      type="button"
                      disabled={!canChangeOpening}
                      aria-pressed={active ? 'true' : 'false'}
                      onClick={() => {
                        if (!canChangeOpening) return;
                        try { onOpeningChange?.(opt.id); } catch (_) {}
                      }}
                      // ✅ 위저드 오프닝 칩(탭) 디자인과 동일 톤으로 통일
                      className={[
                        'inline-flex items-center gap-2 h-9 px-3 rounded-full border transition select-none',
                        active
                          ? 'bg-black/20 border-purple-500 text-white'
                          : 'bg-black/20 border-white/10 text-white/80 hover:bg-white/5 hover:text-white',
                        canChangeOpening ? 'cursor-pointer' : 'opacity-70 cursor-default pointer-events-none',
                      ].join(' ')}
                      title={title}
                    >
                      <span className="text-sm font-semibold max-w-[220px] truncate">{title}</span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="text-lg font-semibold mb-2">오프닝</div>
            )}
            <div className="space-y-3">
              <div className="text-gray-200 whitespace-pre-wrap leading-7">
                {(() => {
                  const nm = character?.name || '캐릭터';
                  const raw = firstStart?.intro || '';
                  const rendered = replacePromptTokens(raw, { assistantName: nm, userName: '당신' }).trim();
                  return rendered || '아직 도입부가 없습니다.';
                })()}
              </div>
              {/* ✅ 첫대사: 채팅창 assistant 말풍선 디자인 + 원형 아바타 + 볼드 유지 */}
              <div className="flex items-start gap-2">
                <Avatar className="size-10 rounded-full shrink-0">
                  <AvatarImage className="object-cover object-top" src={getCharacterPrimaryImage(character)} alt={character?.name || '캐릭터'} />
                  <AvatarFallback className="bg-gradient-to-r from-purple-500 to-blue-500 text-white">
                    {character?.name?.charAt?.(0) || <Bot className="w-4 h-4" />}
                  </AvatarFallback>
                </Avatar>
                <div className="relative w-fit max-w-full sm:max-w-[85%] px-3 py-2 rounded-2xl shadow-md overflow-hidden rounded-tl-none cc-assistant-speech-bubble bg-white/10 border border-white/10 text-gray-100 font-semibold">
                  <p className="whitespace-pre-wrap break-words">
                    {(() => {
                      try {
                        const nm = character?.name || '캐릭터';
                        const raw = firstStart?.firstLine || '';
                        const rendered = replacePromptTokens(raw, { assistantName: nm, userName: '당신' }).trim();
                        return rendered || '아직 첫대사가 없습니다.';
                      } catch (_) {
                        return '아직 첫대사가 없습니다.';
                      }
                    })()}
                  </p>
                </div>
              </div>
            </div>
          </section>

          {/* 성격/말투(원작챗에서 강조) */}
          <section id="persona" className="space-y-6">
            <div>
              <h2 className="text-lg font-semibold mb-2">성격</h2>
              <div className="text-gray-200 whitespace-pre-wrap leading-7">
                {(() => {
                  const nm = character?.name || '캐릭터';
                  const raw = cleanPersonalityForDisplay || '';
                  const rendered = replacePromptTokens(raw, { assistantName: nm, userName: '당신' }).trim();
                  return rendered || '등록된 성격 정보가 없습니다.';
                })()}
              </div>
            </div>
            <div>
              <h2 className="text-lg font-semibold mb-2">말투</h2>
              <div className="text-gray-200 whitespace-pre-wrap leading-7">
                {(() => {
                  const nm = character?.name || '캐릭터';
                  const raw = String(character?.speech_style || '').trim();
                  const rendered = replacePromptTokens(raw, { assistantName: nm, userName: '당신' }).trim();
                  return rendered || '등록된 말투 정보가 없습니다.';
                })()}
              </div>
            </div>
          </section>

          {/* 세계관 */}
          <section id="world">
            <h2 className="text-lg font-semibold mb-2">세계관</h2>
            <div className="text-gray-200 whitespace-pre-wrap leading-7">
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
        </>
      )}

      {/* 크리에이터 코멘트 (요구사항: 선택값 / 비어있으면 비노출) */}
      {!hideCreatorComment && (() => {
        const nm = character?.name || '캐릭터';
        const raw = character?.user_display_description || '';
        const rendered = safeReplaceTokensForHtml(raw, { assistantName: nm, userName: '당신' }).trim();
        if (!rendered) return null;
        return (
          <section id="creator-comment">
            <h2 className="text-lg font-semibold mb-2">크리에이터 코멘트</h2>
            <div className="text-gray-200">
              {/* ✅ 안전 HTML 렌더(이미지 클릭 시 확대 모달 포함) */}
              <RichMessageHtml html={rendered} className="message-rich whitespace-pre-wrap leading-7" />
            </div>
          </section>
        );
      })()}

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