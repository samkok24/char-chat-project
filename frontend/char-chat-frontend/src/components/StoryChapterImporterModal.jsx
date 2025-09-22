import React, { useMemo, useRef, useState } from 'react';
import { Button } from './ui/button';
import { Textarea } from './ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Alert, AlertDescription } from './ui/alert';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from './ui/dialog';
import { AlertCircle, Upload, Wand2 } from 'lucide-react';

const StoryChapterImporterModal = ({ open, onClose, onApplyAppend, onApplyReplace }) => {
  const [storyText, setStoryText] = useState('');
  const [parsedChapters, setParsedChapters] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const MAX_CHARS = 500000;
  const fileInputRef = useRef(null);

  // 다양한 회차 헤더 패턴 지원
  // 예: [1화], 작품명-1화, 작품명 : 1화, 1화, 프롤로그, 1. 회차명, Chapter 1: Title
  const headingMatchers = useMemo(() => [
    // [1화] or [ 12 장 ] Title  (반드시 화/장 토큰이 있어야 함: [9] 같은 카운트다운 방지)
    (line) => {
      const m = line.match(/^\s*\[\s*(?:제\s*)?(\d{1,4})\s*(?:화|장)\s*\]\s*(.*)$/i);
      return m ? { no: Number(m[1]), tail: m[2] || '' } : null;
    },
    // 제 1 화  /  1화  /  2장  Title  (한글 토큰 뒤 \b 제거)
    (line) => {
      const m = line.match(/^\s*(?:제\s*)?(\d{1,4})\s*(?:화|장)\s*(.*)$/);
      return m ? { no: Number(m[1]), tail: m[2] || '' } : null;
    },
    // 프롤로그 / 에필로그
    (line) => {
      const m = line.match(/^(프롤로그|에필로그)\s*(.*)$/);
      if (!m) return null;
      const isPro = m[1] === '프롤로그';
      return { no: isPro ? 0 : 9999, tail: m[2] || m[1] };
    },
    // Chapter 1: Title / CHAPTER 2 - Title
    (line) => {
      const m = line.match(/^(?:Chapter|CHAPTER)\s+(\d{1,4})\b\s*[:\-]?\s*(.*)$/);
      return m ? { no: Number(m[1]), tail: m[2] || '' } : null;
    },
    // 작품명 - 1화  /  작품명 : 12장  Title  (한글 토큰 뒤 \b 제거)
    (line) => {
      const m = line.match(/^\s*.*?(?:-|:)\s*(?:제\s*)?(\d{1,4})\s*(?:화|장)\s*(.*)$/);
      return m ? { no: Number(m[1]), tail: m[2] || '' } : null;
    },
    // 1. 회차명
    (line) => {
      const m = line.match(/^\s*(\d{1,4})\.\s*(.*)$/);
      return m ? { no: Number(m[1]), tail: m[2] || '' } : null;
    },
  ], []);

  const splitIntoChapters = (text) => {
    if (!text) return [];
    const lines = text.split(/\r?\n/);
    const chapters = [];
    let current = { no: null, title: '', content: [] };
    const pushCurrent = () => {
      if (current.content.length > 0 || current.title) {
        const content = current.content.join('\n').trim();
        const title = (current.title || '').trim() || (current.no ? `${current.no}화` : '');
        chapters.push({ no: current.no, title, content, created_at: new Date().toISOString() });
      }
    };
    lines.forEach((raw) => {
      const line = raw.replace(/\uFEFF/g, '');
      let matched = null;
      for (const fn of headingMatchers) {
        const r = fn(line);
        if (r) { matched = r; break; }
      }
      if (matched) {
        // 동일 회차 헤더가 연속해서 나오는 경우(예: "1화" 다음 줄 "1화 제목") 병합 처리
        const nextNo = matched.no ?? null;
        let tail = (matched.tail || '').replace(/^[\s:\-\u00A0]+/, '').trim();
        // tail이 "1화"/"1장"과 같은 중복 토큰이면 무시
        if (nextNo !== null && (tail === `${nextNo}화` || tail === `${nextNo}장` || /^\d{1,4}\s*(?:화|장)$/.test(tail))) {
          tail = '';
        }
        if (current.no !== null && nextNo !== null && Number(current.no) === Number(nextNo) && current.content.length === 0) {
          // 직전 헤더와 동일 회차, 아직 본문 시작 전 → 제목 보강만 하고 계속 진행
          if (tail) current.title = tail;
          return;
        }
        // 새 회차로 전환
        pushCurrent();
        const title = (tail || (nextNo !== null ? `${nextNo}화` : '')).trim();
        current = { no: nextNo !== null ? Number(nextNo) : null, title, content: [] };
      } else {
        current.content.push(raw);
      }
    });
    pushCurrent();
    // 번호가 비어있는 항목은 등장 순서로 보정, 그리고 동일 번호+제목 중복 제거
    const normalized = chapters
      .map((c, idx) => ({ ...c, no: (c.no === null ? idx + 1 : c.no) }))
      .sort((a, b) => (a.no || 0) - (b.no || 0));

    // 1) 같은 번호 중 제목이 비어있는 항목과 제목이 있는 항목이 함께 있으면, 제목이 있는 항목을 우선
    //    또한 내용 길이가 더 긴 항목을 우선하여 하나로 병합
    const byNo = new Map();
    const score = (c) => ((c.title || '').trim().length > 0 ? 10 : 0) + ((c.content || '').length || 0);
    for (const c of normalized) {
      const prev = byNo.get(c.no);
      if (!prev || score(c) > score(prev)) byNo.set(c.no, c);
    }
    const merged = Array.from(byNo.values()).sort((a,b)=> (a.no||0)-(b.no||0));

    // 2) 번호+제목 완전중복 제거 (방어적)
    const seen = new Set();
    const dedup = [];
    for (const c of merged) {
      const key = `${c.no}||${(c.title || '').trim()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      dedup.push(c);
    }
    return dedup;
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
    const allowed = ['.txt', '.hwp', '.hwpx'];
    if (!allowed.includes(ext)) {
      setError('현재는 .txt, .hwp, .hwpx 파일만 지원됩니다.');
      e.target.value = '';
      return;
    }
    setLoading(true);
    setError('');
    try {
      if (ext === '.txt') {
        const text = await file.text();
        setStoryText(text.length > MAX_CHARS ? text.substring(0, MAX_CHARS) : text);
      } else {
        // HWP/HWPX는 브라우저에서 직접 파싱이 어려움 → 안내
        setError('한글(.hwp/.hwpx)은 브라우저에서 바로 파싱할 수 없습니다. 텍스트로 변환하여 붙여넣어 주세요.');
      }
    } catch {
      setError('파일 업로드 중 오류가 발생했습니다.');
    } finally {
      setLoading(false);
      try { e.target.value = ''; } catch {}
    }
  };

  const handleExtract = () => {
    const arr = splitIntoChapters(storyText);
    setParsedChapters(arr);
    if (arr.length === 0) setError('회차 형식을 찾지 못했습니다. 제목 패턴(예: 1화, 제1장)을 확인하세요.');
  };

  const disableApply = !parsedChapters.length;

  const handleApplyAppend = () => {
    if (disableApply) return;
    try { onApplyAppend?.(parsedChapters); } finally {
      setTimeout(() => { try { onClose?.(); } catch {} }, 0);
    }
  };
  const handleApplyReplace = () => {
    if (disableApply) return;
    try { onApplyReplace?.(parsedChapters); } finally {
      setTimeout(() => { try { onClose?.(); } catch {} }, 0);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose?.(); }}>
      <DialogContent className="sm:max-w-4xl max-h-[85vh] bg-gray-900 text-gray-100 border border-gray-700 overflow-hidden flex flex-col" aria-describedby="txt-import-desc">
        <DialogHeader>
          <DialogTitle className="text-white">txt로 일괄 업로드</DialogTitle>
        </DialogHeader>
        <div id="txt-import-desc" className="sr-only">텍스트 업로드 후 회차를 자동 추출하는 모달</div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 flex-1 min-h-0 overflow-auto pr-1">
          <Card className="bg-gray-800 border border-gray-700">
            <CardHeader>
              <CardTitle className="text-white text-base">원문 입력</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".txt,.hwp,.hwpx"
                  id="chapter-imp-txt"
                  className="hidden"
                  onChange={handleFileUpload}
                  disabled={loading}
                />
                <Button
                  variant="outline"
                  size="sm"
                  className="cursor-pointer"
                  onClick={() => { if (!loading) { try { fileInputRef.current?.click(); } catch {} } }}
                >
                  <Upload className="w-4 h-4 mr-2" /> txt 업로드
                </Button>
                <Button variant="outline" size="sm" onClick={handleExtract} disabled={!storyText.trim() || loading}>
                  <Wand2 className="w-4 h-4 mr-2" /> 회차 추출
                </Button>
              </div>
              <Textarea
                value={storyText}
                onChange={(e)=> setStoryText(e.target.value.slice(0, MAX_CHARS))}
                rows={16}
                placeholder="이곳에 원문을 붙여넣거나 .txt 파일을 업로드하세요"
                className="mt-2 h-80 max-h-[60vh] overflow-auto resize-y"
              />
            </CardContent>
          </Card>

          <Card className="bg-gray-800 border border-gray-700">
            <CardHeader>
              <CardTitle className="text-white text-base">추출 미리보기</CardTitle>
            </CardHeader>
            <CardContent>
              {parsedChapters.length > 0 ? (
                <ul className="max-h-[420px] overflow-auto divide-y divide-gray-700 rounded-md border border-gray-700">
                  {parsedChapters.map((ch, idx) => (
                    <li key={`${ch.no}-${ch.title}-${idx}`} className="px-3 py-2 bg-gray-800/30">
                      <div className="text-sm text-gray-200 truncate">
                        <span className="text-gray-400 mr-2">{ch.no ? `${ch.no}화` : '회차'}</span>
                        <span>{ch.title}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="text-sm text-gray-400">미리볼 내용이 없습니다. 왼쪽에서 회차를 추출하세요.</div>
              )}
            </CardContent>
          </Card>
        </div>

        {error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <DialogFooter className="flex items-center justify-between gap-2 sticky bottom-0 bg-gray-900 pt-3 mt-2 -mx-6 px-6 border-t border-gray-800">
          <div></div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={handleApplyAppend} disabled={disableApply}>추가</Button>
            <Button onClick={handleApplyReplace} disabled={disableApply}>확인(교체)</Button>
            <Button variant="ghost" onClick={onClose}>닫기</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default StoryChapterImporterModal;


