/**
 * 온보딩: "30초만에 캐릭터 만나기" 모달
 *
 * 목표:
 * - 이미지 + 원하는 캐릭터 느낌(텍스트) + 태그를 입력하면,
 *   AI가 캐릭터 설정을 자동 완성(초안 생성)하고, 유저는 프리뷰/수정 후
 *   "공개 캐릭터"로 생성하여 바로 대화/상세로 진입할 수 있다.
 *
 * 안전/방어:
 * - AI 초안 생성은 `/characters/quick-generate`로 수행(DB 저장 X).
 * - 실제 저장은 기존 SSOT(`/characters/advanced`)로만 수행.
 * - 실패 시 조용히 무시하지 않고 console.error + 사용자 에러 메시지로 알림.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../contexts/AuthContext';
import { charactersAPI, filesAPI, mediaAPI, tagsAPI } from '../lib/api';
import { clearCreateCharacterDraft, hasCreateCharacterDraft } from '../lib/createCharacterDraft';
import { resolveImageUrl } from '../lib/images';
import { buildImageGenerationPrompt, styleKeyFromQuickMeetStyleSlug } from '../lib/imageGenerationPrompt';
import { buildAutoGenModeHint } from '../lib/autoGenModeHints';
import { countSentencesRoughKo } from '../lib/textMetrics';
import { PROFILE_NAME_MIN_LEN, PROFILE_NAME_MAX_LEN, PROFILE_ONE_LINE_MIN_LEN, PROFILE_ONE_LINE_MAX_LEN, PROFILE_ONE_LINE_MAX_LEN_SIMULATOR } from '../lib/profileConstraints';
import { guessNameGenderFromTitle, recommendAudienceSlugFromTitle } from '../lib/audienceNameHeuristics';
import { QUICK_MEET_GENRE_CHIPS, QUICK_MEET_TYPE_CHIPS, QUICK_MEET_HOOK_CHIPS, QUICK_MEET_HOOK_CHIPS_SIMULATOR, shuffleCopy, getQuickMeetGenrePriority, uniqStringsPreserveOrder } from '../lib/quickMeetFixedChips';
import CharLimitCounter from './CharLimitCounter';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from './ui/alert-dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { Alert, AlertDescription } from './ui/alert';
import TagSelectModal from './TagSelectModal';
import ImageGenerateInsertModal from './ImageGenerateInsertModal';
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, GripVertical, ImagePlus, Loader2, Menu, RefreshCw, Sparkles, Trash2, X } from 'lucide-react';

const dispatchToast = (type, message) => {
  try {
    window.dispatchEvent(new CustomEvent('toast', { detail: { type, message } }));
  } catch (e) {
    // 방어: toast 이벤트가 막혀도 UX가 완전히 죽지 않게 콘솔에만 남긴다.
    try { console.warn('[QuickMeetCharacterModal] toast dispatch failed:', e); } catch (err) { void err; }
  }
};

const hasAnyText = (v) => {
  try {
    return String(v ?? '').trim().length > 0;
  } catch (e) {
    try { console.warn('[QuickMeetCharacterModal] hasAnyText failed:', e); } catch (err) { void err; }
    return false;
  }
};

const sleepMs = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const stringifyApiDetail = (detail) => {
  /**
   * ✅ FastAPI validation detail(422) 메시지 정규화
   *
   * - detail이 list[{loc,msg,type}] 형태면 사람이 읽을 수 있게 합친다.
   * - 문자열/기타 타입이면 안전하게 문자열로 변환한다.
   */
  try {
    if (Array.isArray(detail)) {
      const parts = detail.map((d) => {
        try {
          const loc = Array.isArray(d?.loc) ? d.loc.join('.') : String(d?.loc || '');
          const msg = String(d?.msg || d?.message || '').trim();
          const core = msg || String(d || '').trim();
          return loc ? `${loc}: ${core}` : core;
        } catch (_) {
          return String(d || '').trim();
        }
      }).filter(Boolean);
      return parts.join(' / ') || '요청 형식 오류';
    }
    if (detail && typeof detail === 'object') {
      try { return JSON.stringify(detail); } catch (_) { return '요청 오류'; }
    }
    return String(detail || '').trim() || '알 수 없는 오류';
  } catch (_) {
    return '알 수 없는 오류';
  }
};

const buildSeedWithinLimit = (lines, maxChars = 1900) => {
  /**
   * ✅ seed_text 길이 제한(2000) 방어
   *
   * - 백엔드 QuickCharacterGenerateRequest.seed_text max_length=2000
   * - 선택 소재/키워드가 많으면 쉽게 초과하여 422가 난다.
   * - 핵심 라인을 우선 포함하고, 남는 예산 안에서만 추가 라인을 포함한다.
   */
  try {
    const arr = Array.isArray(lines) ? lines.map((x) => String(x || '').trim()).filter(Boolean) : [];
    const out = [];
    let total = 0;
    for (const ln of arr) {
      const add = ln.length + (out.length ? 1 : 0); // \n
      if (total + add > maxChars) break;
      out.push(ln);
      total += add;
    }
    return out.join('\n');
  } catch (_) {
    return '';
  }
};

const withTimeout = (promise, ms, label = 'request') => {
  /**
   * ✅ 생성중 무한대기 방지(프론트 최후 방어)
   * - 백엔드/SDK가 멈추면 finally가 실행되지 않아 "생성중..."이 고착될 수 있다.
   * - 일정 시간 내 응답이 없으면 타임아웃으로 끊고 사용자에게 재시도를 안내한다.
   */
  const t = Number(ms);
  const timeoutMs = Number.isFinite(t) ? Math.max(2000, Math.floor(t)) : 25000;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      const id = setTimeout(() => {
        try { clearTimeout(id); } catch (_) {}
        reject(new Error(`${label}_timeout`));
      }, timeoutMs);
    }),
  ]);
};

// NOTE: 타임아웃은 기존(28초) 동작을 유지한다.

const stripMetaFromOneLine = (text, { minLen = 20 } = {}) => {
  /**
   * ✅ 한줄소개 메타 문장 제거(프론트 최후 방어)
   *
   * 배경:
   * - 백엔드/모델이 가끔 "이미지의 분위기와 디테일에 맞춰 자연스럽게 전개된다" 같은
   *   '가이드 문장'을 한줄소개에 섞어 품질을 크게 떨어뜨린다.
   * - 서버가 어떤 버전으로 떠있든, UI에서는 이 문구가 절대 노출되지 않게 한다.
   *
   * 원칙:
   * - 문장 단위로 잘라 '이미지/사진/그림' 언급 또는 고정 패턴이 있는 문장을 제거한다.
   * - 제거 결과가 너무 짧아지면(최소 길이 미달) 원문을 유지해 빈 값/에러를 방지한다.
   */
  try {
    const src = String(text || '').trim();
    if (!src) return '';
    const badPhrases = [
      '이미지의 분위기와 디테일',
      '분위기와 디테일',
      '디테일에 맞춰',
      '맞춰 자연스럽게',
      '자연스럽게 전개',
    ];
    const sentences = src
      .split('.')
      .map((s) => s.trim())
      .filter(Boolean);
    if (sentences.length <= 1) {
      // ✅ 단문(마침표가 없거나 1개 이하)에서도 메타 구문을 잘라낸다.
      // - 예: "… 여유가 있다. 이미지의 분위기…" 같은 문장이 합쳐진 케이스,
      //       또는 "… 이미지의 분위기와 디테일에 맞춰…"가 한 문장으로 나온 케이스
      const markers = ['이미지', '사진', '그림', ...badPhrases];
      const idxs = markers
        .map((m) => src.indexOf(m))
        .filter((i) => Number.isFinite(i) && i >= 0);
      if (idxs.length === 0) return src;
      const cutAt = Math.min(...idxs);
      const prefix = src.slice(0, cutAt).trim().replace(/[.\s]+$/g, '').trim();
      return (prefix.length >= Number(minLen || 0)) ? prefix : src;
    }
    const kept = sentences.filter((s) => {
      if (!s) return false;
      if (s.includes('이미지') || s.includes('사진') || s.includes('그림')) return false;
      if (badPhrases.some((p) => s.includes(p))) return false;
      return true;
    });
    if (kept.length === 0) return src;
    const out = `${kept.join('. ')}${src.endsWith('.') ? '.' : ''}`.trim();
    return (out.length >= Number(minLen || 0)) ? out : src;
  } catch (_) {
    return String(text || '').trim();
  }
};

const stripBadGuidePhrasesOnly = (text, { minLen = 20 } = {}) => {
  /**
   * ✅ 시뮬 소개용: 메타/스펙/명령/공지 패턴은 유지하되,
   * 품질을 망치는 고정 가이드 문구만 제거한다.
   *
   * 배경:
   * - 시뮬 한줄소개는 [🖼️/캐릭터수/모드/명령어] 같은 메타가 자연스러울 수 있다.
   * - 하지만 `stripMetaFromOneLine`은 '이미지/사진/그림' 문장까지 제거해 시뮬 메타를 날릴 수 있어,
   *   시뮬 전용 보정에서는 "나쁜 가이드 문구"만 제거한다.
   */
  try {
    const src = String(text || '').trim();
    if (!src) return '';
    const badPhrases = [
      '이미지의 분위기와 디테일',
      '분위기와 디테일',
      '디테일에 맞춰',
      '맞춰 자연스럽게',
      '자연스럽게 전개',
    ];
    const sentences = src
      .split('.')
      .map((s) => s.trim())
      .filter(Boolean);
    if (sentences.length <= 1) {
      const idxs = badPhrases
        .map((m) => src.indexOf(m))
        .filter((i) => Number.isFinite(i) && i >= 0);
      if (idxs.length === 0) return src;
      const cutAt = Math.min(...idxs);
      const prefix = src.slice(0, cutAt).trim().replace(/[.\s]+$/g, '').trim();
      return (prefix.length >= Number(minLen || 0)) ? prefix : src;
    }
    const kept = sentences.filter((s) => !badPhrases.some((p) => s.includes(p)));
    if (kept.length === 0) return src;
    const out = `${kept.join('. ')}${src.endsWith('.') ? '.' : ''}`.trim();
    return (out.length >= Number(minLen || 0)) ? out : src;
  } catch (_) {
    return String(text || '').trim();
  }
};

const hasSimulatorBracketMetaAtStart = (text) => {
  /**
   * ✅ 시뮬 한줄소개 "메타 1줄" 강제 판정
   * - 크랙/바베챗 시뮬 샘플에서 흔한 `[ ... ]` 메타를 첫 부분에 두는 패턴을 따른다.
   */
  try {
    const s = String(text || '').trim();
    if (!s) return false;
    return /^\[[^\]]+\]/.test(s);
  } catch (_) {
    return false;
  }
};

const isGameySimulatorTitle = (title) => {
  /**
   * ✅ 시뮬 작품명(제목) 게임 타이틀 톤 판정(보수적)
   * - 너무 강하게 제한하면 다양성이 죽으므로, "재생성 여부 판단"에만 사용한다.
   */
  try {
    const s = String(title || '').trim();
    if (!s) return false;
    return /(시뮬|시뮬레이션|아카데미|학교|학원|생존|서바이벌|RPG|퀘스트|미션|직업|빙의|입학|전학|루트|이벤트|엔딩|던전|도시)/i.test(s);
  } catch (_) {
    return false;
  }
};

const extractSimulatorBodyForSentenceCount = (text) => {
  /**
   * ✅ 시뮬 "한줄소개" 문장수 판정용 본문 추출
   *
   * 배경:
   * - 남성향 시뮬 샘플(크랙/바베챗)에는 [🖼️30장]/[캐릭터 12명]/✔️체크리스트/!명령어/업데이트 공지 같은
   *   "메타/스펙/규칙"이 한줄소개에 섞이는 패턴이 흔하다.
   * - 이 메타를 포함한 전체 텍스트로 문장수를 세면 4~5문장 검증이 깨져 불필요한 재생성이 발생한다.
   *
   * 정책:
   * - 메타로 보이는 블록을 최대한 제거한 뒤, 남는 "서술 본문"만 문장수를 계산한다.
   * - 제거 결과가 비어버리면 원문(줄바꿈 제거)으로 폴백한다(방어).
   */
  try {
    const src = String(text || '');
    if (!src.trim()) return '';
    const cleaned = src
      // [🖼️229], [캐릭터 54명] 등 괄호 메타
      .replace(/\[[^\]]+\]/g, ' ')
      // !명령어(공백까지 포함한 토큰)
      .replace(/!\S+/g, ' ')
      // 체크/공지 계열 이모지/마커
      .replace(/[✔✅※☆]/g, ' ')
      // URL 제거(메타로 간주)
      .replace(/https?:\/\/\S+/gi, ' ')
      // 과도한 공백 정리
      .replace(/\s+/g, ' ')
      .trim();
    if (cleaned) return cleaned;
    return String(text || '').replace(/\s*\n+\s*/g, ' ').trim();
  } catch (_) {
    return String(text || '').replace(/\s*\n+\s*/g, ' ').trim();
  }
};

const hasSimulatorCtaLine = (text) => {
  /**
   * ✅ 시뮬 소개에서 "게임적 경험(CTA/시스템 멘트)" 존재 여부 판정
   *
   * 요구사항(사용자):
   * - 시뮬 한줄소개에는 "게임적 경험"이 바로 보이는 시스템/안내/명령 톤 문장이 포함되어야 한다.
   * - 단, 프롬프트에 특정 문구를 예시로 박으면 앵커링되어 같은 문장만 반복될 수 있어
   *   "검출은 코드에서", "생성 지시는 추상적으로" 유지한다.
   */
  try {
    const s = String(text || '').trim();
    if (!s) return false;
    // 방어: 너무 넓게 잡으면 일상 대사까지 걸릴 수 있어, 최소한 시뮬 CTA에서 자주 쓰는 어휘를 포함해 판정한다.
    return /(축하합니다|선택하세요|해보세요|찾아가세요|얻어보세요|이루세요|하세요)/.test(s);
  } catch (_) {
    return false;
  }
};

const normalizeSimulatorDescription = (text, {
  maxLen,
  maxTurns,
  audience,
  style,
  fixedChips = [],
  chosenThemes = [],
  extraKeywords = [],
} = {}) => {
  /**
   * ✅ 시뮬 한줄소개 "항상 성공" 보정기 (크랙/바베챗 느낌의 게임 포맷 강제)
   *
   * 결과 포맷:
   * - `[ ... ]` 메타 1줄 + (선택) 안내/명령 톤 1문장 + 본문 4~5문장
   *
   * 원칙:
   * - 모델이 못 맞춰도 프론트에서 채워 "실패 없이" 항상 완성 형태로 만든다.
   * - 과도한 앵커링을 피하려고 CTA는 여러 템플릿 중 1개를 선택한다.
   */
  try {
    const limit = (() => {
      const n = Number(maxLen);
      return Number.isFinite(n) && n > 0 ? Math.floor(n) : PROFILE_ONE_LINE_MAX_LEN;
    })();
    const src0 = String(text || '').replace(/\s*\n+\s*/g, ' ').trim();
    if (!src0) return '';

    // 1) 기존 메타 분리(있으면 유지)
    const m = src0.match(/^\s*(\[[^\]]+\])\s*(.*)$/);
    const metaExisting = m ? String(m[1] || '').trim() : '';
    const bodyRaw0 = m ? String(m[2] || '').trim() : src0;

    // 2) 메타(없으면 생성) — ✅ 요구사항: `[200턴 시뮬 | ... | 남성향 | 애니풍]` 같은 상세 메타는 금지
    // - 시뮬 "느낌"만 주는 아주 짧은 메타 1줄만 사용한다.
    // - 기존 메타가 있어도 너무 상세하면(턴/파이프/태그나열) 짧은 메타로 치환한다.
    const isTooDetailedMeta = (meta) => {
      const s = String(meta || '');
      // 파이프 구분, 턴수/턴 키워드, 너무 많은 구분자(·)가 있으면 상세 메타로 간주
      if (s.includes('|')) return true;
      if (/\d+\s*턴/.test(s)) return true;
      const dotCount = (s.match(/·/g) || []).length;
      if (dotCount >= 2) return true;
      return false;
    };
    const pickShortMeta = () => {
      const picks = [
        '[시뮬 시작]',
        '[게임 시작]',
        '[시스템 안내]',
        '[튜토리얼]',
      ];
      const idx = Math.floor(Math.random() * picks.length);
      return String(picks[idx] || picks[0] || '[시뮬 시작]').trim();
    };
    // ✅ 메타는 강제가 아닌 선택: AI가 이미 넣었으면 유지, 없으면 50% 확률로만 추가
    // - 바베챗 인기작은 메타 없이도 잘 작동함, 크랙만 메타 문화가 있음
    const metaLine = metaExisting
      ? (isTooDetailedMeta(metaExisting) ? pickShortMeta() : metaExisting)
      : (Math.random() < 0.5 ? pickShortMeta() : '');

    // 3) CTA(없으면 1문장 보정으로 추가)
    const needsCta = !hasSimulatorCtaLine(src0);
    const ctaLine = (() => {
      if (!needsCta) return '';
      const picks = [
        '자, 이제 시작하세요',
        '원하는 선택지를 골라 진행해보세요',
        '첫 선택은 당신에게 달려 있어요. 지금 선택하세요',
        '오늘부터 이 세계에서 살아가 보세요',
      ];
      const idx = Math.floor(Math.random() * picks.length);
      return String(picks[idx] || picks[0] || '').trim();
    })();

    // 4) 본문 문장수(메타/명령어/URL 제거 후) → 4~5문장으로 보정
    const bodyForCount = extractSimulatorBodyForSentenceCount(bodyRaw0) || bodyRaw0;
    const baseSentences = bodyForCount
      .split('.')
      .map((s) => s.trim())
      .filter(Boolean);

    const extraHint = (() => {
      const keys = (Array.isArray(extraKeywords) ? extraKeywords : [])
        .map((x) => String(x || '').trim())
        .filter(Boolean)
        .slice(0, 2)
        .join('·');
      return keys;
    })();
    const fillers = [
      '당신은 작은 선택 하나로 관계와 전개가 달라지는 분기 속에 들어갑니다',
      '목표를 세우고 자원과 기회를 모으며, 실패하면 대가를 치르게 됩니다',
      '대화·행동·이벤트를 통해 루트가 열리고, 엔딩은 선택의 누적 결과로 결정됩니다',
      extraHint ? `핵심 키워드(${extraHint})를 중심으로 사건이 굴러가며, 매 턴마다 상황이 갱신됩니다` : '매 턴마다 상황이 갱신되고, 선택의 결과가 바로 체감됩니다',
      '당신이 어떤 플레이를 하느냐에 따라 같은 세계도 완전히 다른 게임이 됩니다',
    ];

    const merged = [...baseSentences];
    for (const f of fillers) {
      if (merged.length >= 5) break;
      const key = String(f || '').slice(0, 6);
      if (merged.some((s) => s.includes(key))) continue;
      merged.push(String(f || '').trim());
    }
    const finalBody = merged.slice(0, 5)
      .map((s) => s.replace(/[.\s]+$/g, '').trim())
      .filter(Boolean);
    const bodyJoined = finalBody.length ? `${finalBody.join('. ')}.` : '';
    const ctaJoined = ctaLine ? `${ctaLine.replace(/[.\s]+$/g, '').trim()}.` : '';

    let out = `${metaLine} ${ctaJoined} ${bodyJoined}`.replace(/\s+/g, ' ').trim();
    // ✅ 방어: 상한 초과 시 5문장→4문장으로 줄여 우선 맞춘다(자르는 대신 문장 수를 줄임)
    if (out.length > limit && finalBody.length > 4) {
      const body4 = `${finalBody.slice(0, 4).join('. ')}.`;
      out = `${metaLine} ${ctaJoined} ${body4}`.replace(/\s+/g, ' ').trim();
    }
    // 그래도 초과면(극단 케이스) UX 깨짐 방지를 위해 마지막에만 컷
    if (out.length > limit) out = out.slice(0, limit).trim();
    return out;
  } catch (_) {
    return String(text || '').replace(/\s*\n+\s*/g, ' ').trim();
  }
};

const DEFAULT_SEED_PLACEHOLDER =
  '예) 무뚝뚝하지만 은근 다정한 경호원. 말투는 짧고 단호. 상황은 밤거리. 로맨스/긴장감.';

// ✅ QuickMeet(30초): 시뮬 내 미연시 요소(ON일 때만 seed에 주입)
// - OFF면 불필요한 '미연시 작법' 지시가 오히려 품질을 망칠 수 있어 절대 넣지 않는다(요구사항).
const QUICK_MEET_SIM_DATING_PRO_WRITER_LINE =
  '당신은 미연시 업계탑급의 베테랑 시나리오라이터입니다. 다양한 캐릭터유형을 만들고 거기에 맞게 매력적인 시나리오를 작성해주세요.';

// ✅ QuickMeet: 남성향 RP 품질 개선용 "고정 후보 칩"(요구사항)
// - 서버 태그 DB를 오염시키지 않고(SSOT/운영 안정), 프로필 자동생성 seed_text에만 반영한다.
// - 모달을 열 때마다 섞어서 노출한다.
// ✅ 장르 "풀"은 하나로 유지(요구사항)
// - 남성향/여성향/전체에 따라 "선노출(접힘 상태 1줄)"의 우선순위만 바꾼다.

// ✅ 이미지 생성 프롬프트 보강 로직은 `ImageGenerateInsertModal`과 SSOT로 공유한다.

/**
 * ✅ 위저드 입력 제한(로컬 SSOT)
 *
 * 의도/원리:
 * - 이 모달에서 사용 중인 숫자(기존 maxLength 하드코딩)를 한 곳에서 관리해
 *   글자수 UI/검증이 불일치하지 않게 한다.
 *
 * 주의:
 * - PROFILE_* 제약은 `profileConstraints`(전역 SSOT)에서 가져온다.
 * - 그 외 필드(키워드/설정메모)는 현재 화면에서만 쓰이므로 로컬 상수로 둔다.
 */
// ✅ 한줄소개 상한은 모드별로 다르다(시뮬 400, 그 외 300)
const QUICK_MEET_KEYWORDS_RAW_MAX_LEN = 120;
const QUICK_MEET_SETTING_MEMO_MAX_LEN = 200;
const QUICK_MEET_PROFILE_CONCEPT_MAX_LEN = 1500;

/**
 * ✅ 온보딩 필수 선택(메타) 옵션
 *
 * 의도:
 * - 기존 캐릭터 생성/편집(CreateCharacterPage)에서 강제하는 기준과 동일하게,
 *   온보딩 "30초만에 캐릭터 만나기"에서도 성향/이미지 스타일을 필수로 받는다.
 * - 태그 slug는 백엔드 `/characters/:id/tags`에서 없으면 자동 생성되므로,
 *   프론트는 slug만 보내면 된다(SSOT: 태그 연결은 백엔드).
 */
const REQUIRED_AUDIENCE_CHOICES = [
  { slug: '남성향', label: '남성향', previewClass: 'bg-gradient-to-br from-slate-900 via-blue-900 to-purple-900' },
  { slug: '여성향', label: '여성향', previewClass: 'bg-gradient-to-br from-rose-900 via-fuchsia-900 to-indigo-900' },
  { slug: '전체', label: '전체', previewClass: 'bg-gradient-to-br from-emerald-900 via-slate-900 to-cyan-900' },
];
const REQUIRED_STYLE_CHOICES = [
  { slug: '애니풍', label: '애니풍', previewClass: 'bg-gradient-to-br from-purple-600 via-indigo-600 to-blue-600' },
  { slug: '실사풍', label: '실사풍', previewClass: 'bg-gradient-to-br from-zinc-900 via-gray-800 to-zinc-700' },
  { slug: '반실사', label: '반실사', previewClass: 'bg-gradient-to-br from-slate-800 via-stone-700 to-neutral-800' },
  { slug: '아트웤', label: '아트웤/디자인', previewClass: 'bg-gradient-to-br from-amber-700 via-orange-700 to-rose-700' },
];
const REQUIRED_AUDIENCE_SLUGS = REQUIRED_AUDIENCE_CHOICES.map((c) => c.slug);
const REQUIRED_STYLE_SLUGS = REQUIRED_STYLE_CHOICES.map((c) => c.slug);

export default function QuickMeetCharacterModal({
  open,
  onClose,
  initialName = '',
  initialSeedText = '',
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const fileInputRef = useRef(null);
  const dialogContentRef = useRef(null);
  const scrollHideTimerRef = useRef(null);
  const { user } = useAuth();
  const autoUploadInFlightRef = useRef(false);
  const lastUploadedFileSigRef = useRef('');
  const visionHintsInFlightRef = useRef(false);
  const lastVisionUrlRef = useRef('');
  const lastVisionHintsRef = useRef(null);
  const lastAutoGeneratedNameRef = useRef('');
  const lastAutoGeneratedOneLineRef = useRef(''); // ✅ 연속 생성 중복 방지(한줄소개)

  const [step, setStep] = useState('input'); // 'input' | 'preview'
  const [name, setName] = useState(initialName);
  const [seedText, setSeedText] = useState(initialSeedText);
  const [error, setError] = useState('');

  const [allTags, setAllTags] = useState([]);
  const [selectedTagSlugs, setSelectedTagSlugs] = useState([]);
  const audienceTouchedRef = useRef(false);
  const [tagModalOpen, setTagModalOpen] = useState(false);

  const [imageFile, setImageFile] = useState(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState('');
  const [uploadedImageUrl, setUploadedImageUrl] = useState('');
  const resolvedUploadedUrl = useMemo(() => resolveImageUrl(uploadedImageUrl || '') || '', [uploadedImageUrl]);
  const [imageTrayOpen, setImageTrayOpen] = useState(false);
  const [imageTrayBusy, setImageTrayBusy] = useState(false);
  const [imageTrayError, setImageTrayError] = useState('');
  const [imageGenPrompt, setImageGenPrompt] = useState('');
  const [imageGenModel, setImageGenModel] = useState('gemini-2.5-flash-image');
  const [imageGenRatio, setImageGenRatio] = useState('1:1');
  const [imageGenOpen, setImageGenOpen] = useState(false);
  const [imageTrayGallery, setImageTrayGallery] = useState([]); // { id?: string|number, url: string }[]
  const imageDragIndexRef = useRef(null);
  const galleryStripRef = useRef(null);
  const [galleryCanLeft, setGalleryCanLeft] = useState(false);
  const [galleryCanRight, setGalleryCanRight] = useState(false);
  const [imgModalOpen, setImgModalOpen] = useState(false);
  const [imgModalInitialCropIndex, setImgModalInitialCropIndex] = useState(-1);
  const [imgModalSeedGallery, setImgModalSeedGallery] = useState(null); // crop용 임시 갤러리(업로드 전 프리뷰 포함)
  const [profileAutoGenUseImage, setProfileAutoGenUseImage] = useState(false); // ✅ 프로필 자동생성에서 이미지 정보 포함 여부(기본 OFF)
  const [useSentenceStyleName, setUseSentenceStyleName] = useState(false); // ✅ 문장형 제목 생성 여부(기본 OFF=제목형)
  const [draftPromptOpen, setDraftPromptOpen] = useState(false);
  const isCoarsePointer = useMemo(() => {
    try {
      return typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    } catch (_) {
      return false;
    }
  }, []);

  // ✅ quick-create-30s는 "생성 + 저장"까지 완료한 캐릭터 상세를 반환한다.
  const [createdCharacter, setCreatedCharacter] = useState(null); // CharacterDetailResponse 형태
  const [generating, setGenerating] = useState(false);
  const [createdCharacterId, setCreatedCharacterId] = useState(''); // 태그 저장 실패 시 중복 생성 방지용
  const [autoGenLoading, setAutoGenLoading] = useState(false);
  const autoGenInFlightRef = useRef(false);
  const [autoGenProgress, setAutoGenProgress] = useState(0);
  const autoGenProgressTimerRef = useRef(null);
  const autoGenProgressDoneTimerRef = useRef(null);
  // ✅ 30초 생성 진행률(프로필 자동생성과 UI 통일)
  const [createProgress, setCreateProgress] = useState(0);
  const createProgressTimerRef = useRef(null);
  const createProgressDoneTimerRef = useRef(null);
  const [createStageText, setCreateStageText] = useState(''); // 진행바 아래 "현재 단계" 표기

  // ✅ 30초 생성 옵션(요구사항)
  const [characterType, setCharacterType] = useState('roleplay'); // 'roleplay' | 'simulator'
  const [simDatingElements, setSimDatingElements] = useState(false); // ✅ 시뮬 내 미연시 요소(ON/OFF)
  const [maxTurns, setMaxTurns] = useState(125); // 100~150 기본값 (속도 최적화)
  const [settingMemos, setSettingMemos] = useState(['', '', '']); // 설정메모 3개(선택)
  const [profileConceptText, setProfileConceptText] = useState(''); // 작품컨셉(선택)
  const [profileConceptAutoGenLoading, setProfileConceptAutoGenLoading] = useState(false); // 작품컨셉 자동생성 로딩
  const requestIdRef = useRef('');
  const [advancedOpen, setAdvancedOpen] = useState(false); // 추가입력(접기/펼치기)

  // ✅ 프로필 단계 소재 태그칩(SSOT: 백엔드 제공)
  const [profileThemeSuggestions, setProfileThemeSuggestions] = useState({ roleplay: [], simulator: [] });
  const [selectedProfileThemes, setSelectedProfileThemes] = useState({ roleplay: [], simulator: [] }); // 모드별 유지
  // ✅ 이미지 분석 기반 추천 키워드(칩 하이라이트용)
  const [visionChipKeywords, setVisionChipKeywords] = useState([]); // string[]
  const [profileAutoGenMenuOpen, setProfileAutoGenMenuOpen] = useState(false); // 햄버거(접기/펼치기)
  const [profileAutoGenMode, setProfileAutoGenMode] = useState('auto'); // ✅ 요구사항: 알아서 생성만 사용
  const [profileAutoGenKeywordsRaw, setProfileAutoGenKeywordsRaw] = useState(''); // auto 모드에서만 사용(선택)
  const [overwriteConfirmOpen, setOverwriteConfirmOpen] = useState(false);
  const [overwriteConfirmKind, setOverwriteConfirmKind] = useState(''); // 'name' | 'oneLine' | 'profile' | 'concept'
  const [overwriteConfirmTargets, setOverwriteConfirmTargets] = useState([]); // ['작품명', '한줄소개']
  const [scrollbarActive, setScrollbarActive] = useState(false);
  
  // ✅ 남성향 RP: 고정 노출 칩(장르/유형/훅) - 모달 오픈마다 섞기
  const [genrePool, setGenrePool] = useState([]); // string[]
  const [genreExpanded, setGenreExpanded] = useState(false);
  const [selectedGenres, setSelectedGenres] = useState([]); // string[] (max 2)
  // ✅ 장르/유형/훅 선택 UI(요구사항): 햄버거(접기/펼치기)
  // - 정책(중요): 하나를 펼쳐도 다른 섹션은 자동으로 닫지 않는다(선택 비교/인지용).
  // - 기본값: 장르만 열림(요구사항) + 언제든 닫을 수 있어야 한다.
  const [chipPanelsOpen, setChipPanelsOpen] = useState({ genre: true, type: false, hook: false });

  const [typePool, setTypePool] = useState([]); // string[]
  const [typePage, setTypePage] = useState(0);
  const [selectedType, setSelectedType] = useState(''); // string (max 1)

  const [hookPool, setHookPool] = useState([]); // string[]
  const [hookPage, setHookPage] = useState(0);
  const [selectedHook, setSelectedHook] = useState(''); // string (max 1)

  useEffect(() => {
    /**
     * ✅ 모달 내부 스크롤바 UX 개선
     *
     * 의도/원리:
     * - 스크롤바가 페이지 바깥(밝은 기본)처럼 보이면 "따로 노는" 느낌이 강하다.
     * - 모달 내부 스크롤 컨테이너에만 다크 스크롤바를 적용한다.
     * - 스크롤 중에만 잠깐 보이게(페이드아웃) 해서 시각적 노이즈를 줄인다.
     */
    if (!open) {
      setScrollbarActive(false);
      if (scrollHideTimerRef.current) {
        try { clearTimeout(scrollHideTimerRef.current); } catch (_) {}
        scrollHideTimerRef.current = null;
      }
      return;
    }

    const el = dialogContentRef.current;
    if (!el) return;

    const onScroll = () => {
      try { setScrollbarActive(true); } catch (_) {}
      if (scrollHideTimerRef.current) {
        try { clearTimeout(scrollHideTimerRef.current); } catch (_) {}
      }
      scrollHideTimerRef.current = setTimeout(() => {
        try { setScrollbarActive(false); } catch (_) {}
      }, 900);
    };

    try { el.addEventListener('scroll', onScroll, { passive: true }); } catch (_) {}
    // 첫 렌더에서 스크롤바가 상시 보이지 않도록 초기 상태 유지
    return () => {
      try { el.removeEventListener('scroll', onScroll); } catch (_) {}
      if (scrollHideTimerRef.current) {
        try { clearTimeout(scrollHideTimerRef.current); } catch (_) {}
        scrollHideTimerRef.current = null;
      }
    };
  }, [open]);

  // ✅ 작품명(대부분 캐릭터 이름 포함) 기반 성향 "추천" (자동 변경 금지)
  // - 남자 이름(추정) → 여성향 추천
  // - 여자 이름(추정) → 남성향 추천
  // 정책(중요):
  // - 유저가 성향을 바꾸지 않았는데도 자동으로 스위치되면 UX 신뢰가 깨진다.
  // - 따라서 여기서는 "추천 UI"만 표시하고, 실제 변경은 유저가 버튼을 눌렀을 때만 수행한다.

  useEffect(() => {
    /**
     * ✅ 방어/SSOT:
     * - 시뮬이 아닐 때는 '시뮬 내 미연시 요소'를 켤 이유가 없다.
     * - 모드 전환 시 잔존 상태로 인해 seed가 의도치 않게 오염되는 것을 방지한다.
     */
    if (characterType !== 'simulator' && simDatingElements) {
      try { setSimDatingElements(false); } catch (_) {}
    }
  }, [characterType, simDatingElements]);

  useEffect(() => {
    /**
     * ✅ 자동생성 UX: 토스트 대신 "진행률 채워지는 로딩" 표시
     *
     * 의도/원리:
     * - 성공 토스트는 첫 클릭에 안 뜨는 등(이벤트 리스너 타이밍) UX가 흔들릴 수 있다.
     * - 자동생성은 버튼 자체가 진행 상태를 보여주는 게 더 직관적이다.
     *
     * 정책:
     * - autoGenLoading이 true일 때 0~90%까지 천천히 채우고,
     * - 로딩이 끝나면 100%로 마무리한 뒤 짧게 보여주고 리셋한다.
     */
    try {
      if (autoGenProgressTimerRef.current) {
        try { clearInterval(autoGenProgressTimerRef.current); } catch (_) {}
        autoGenProgressTimerRef.current = null;
      }
      if (autoGenProgressDoneTimerRef.current) {
        try { clearTimeout(autoGenProgressDoneTimerRef.current); } catch (_) {}
        autoGenProgressDoneTimerRef.current = null;
      }

      if (!autoGenLoading) {
        if (autoGenProgress > 0) {
          setAutoGenProgress(100);
          autoGenProgressDoneTimerRef.current = setTimeout(() => {
            try { setAutoGenProgress(0); } catch (_) {}
          }, 420);
        } else {
          setAutoGenProgress(0);
        }
        return;
      }

      setAutoGenProgress((p) => (p > 0 ? p : 8));
      autoGenProgressTimerRef.current = setInterval(() => {
        setAutoGenProgress((p) => {
          const cur = Number.isFinite(p) ? p : 0;
          if (cur >= 90) return 90;
          const bump = 1 + Math.floor(Math.random() * 4); // 1~4
          return Math.min(90, cur + bump);
        });
      }, 180);

      return () => {
        if (autoGenProgressTimerRef.current) {
          try { clearInterval(autoGenProgressTimerRef.current); } catch (_) {}
          autoGenProgressTimerRef.current = null;
        }
        if (autoGenProgressDoneTimerRef.current) {
          try { clearTimeout(autoGenProgressDoneTimerRef.current); } catch (_) {}
          autoGenProgressDoneTimerRef.current = null;
        }
      };
    } catch (_) {
      // 진행률 UI 실패는 기능 동작에 영향 없어야 한다.
      return () => {};
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoGenLoading]);

  useEffect(() => {
    /**
     * ✅ 30초 생성 UX: 프로필 자동생성과 동일한 "진행률 채워지는 로딩" 표시
     *
     * 요구사항:
     * - 괜히 UI가 다르면 안 된다 → 프로필 자동생성 진행바와 동일한 로직/스타일로 맞춘다.
     * - 진행바 아래에 "현재 단계" 문구가 표시되어야 한다(업로드/생성요청/마무리 등).
     */
    try {
      if (createProgressTimerRef.current) {
        try { clearInterval(createProgressTimerRef.current); } catch (_) {}
        createProgressTimerRef.current = null;
      }
      if (createProgressDoneTimerRef.current) {
        try { clearTimeout(createProgressDoneTimerRef.current); } catch (_) {}
        createProgressDoneTimerRef.current = null;
      }

      if (!generating) {
        if (createProgress > 0) {
          setCreateProgress(100);
          createProgressDoneTimerRef.current = setTimeout(() => {
            try { setCreateProgress(0); } catch (_) {}
            try { setCreateStageText(''); } catch (_) {}
          }, 420);
        } else {
          setCreateProgress(0);
          setCreateStageText('');
        }
        return;
      }

      // generating=true
      setCreateProgress((p) => (p > 0 ? p : 8));
      createProgressTimerRef.current = setInterval(() => {
        setCreateProgress((p) => {
          const cur = Number.isFinite(p) ? p : 0;
          if (cur >= 90) return 90;
          const bump = 1 + Math.floor(Math.random() * 4); // 1~4
          return Math.min(90, cur + bump);
        });
      }, 180);

      return () => {
        if (createProgressTimerRef.current) {
          try { clearInterval(createProgressTimerRef.current); } catch (_) {}
          createProgressTimerRef.current = null;
        }
        if (createProgressDoneTimerRef.current) {
          try { clearTimeout(createProgressDoneTimerRef.current); } catch (_) {}
          createProgressDoneTimerRef.current = null;
        }
      };
    } catch (_) {
      return () => {};
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [generating]);

  const getVisionUiMeta = () => {
    /**
     * ✅ UI 표기용: 이미지 해석(캐릭터챗 스타일) 요약
     *
     * 의도/원리:
     * - 백엔드 `/characters/quick-vision-hints`에서 vibe_ko + 훅 제안을 내려준다.
     * - 유저가 "중립 태그"가 아니라 "캐릭터챗 문법(관계/갈등/목표/제약)"으로 해석되었는지
     *   모달에서 즉시 확인할 수 있어야 한다.
     *
     * 주의:
     * - 값이 없으면 UI는 완전히 숨긴다(노이즈 방지).
     */
    try {
      const d = lastVisionHintsRef.current || {};
      const vibe = Array.isArray(d?.vibe_ko) ? d.vibe_ko : [];
      const rpHooks = Array.isArray(d?.roleplay_hook_suggestions) ? d.roleplay_hook_suggestions : [];
      const simHooks = Array.isArray(d?.simulator_hook_suggestions) ? d.simulator_hook_suggestions : [];
      const hook = (characterType === 'simulator' ? (simHooks[0] || '') : (rpHooks[0] || ''));
      return {
        vibe: vibe.map((x) => String(x || '').trim()).filter(Boolean).slice(0, 8),
        hook: String(hook || '').trim(),
      };
    } catch (e) {
      return { vibe: [], hook: '' };
    }
  };

  const upsertVisionChipKeywordsFromDraft = (draft) => {
    /**
     * ✅ quick-generate 응답에서 이미지 키워드 추출 → 칩 하이라이트에 사용
     *
     * 의도/원리:
     * - 백엔드가 `media_settings.image_descriptions[].keywords`에 이미지 앵커(한국어)를 넣어 내려준다.
     * - 프론트는 이 값을 저장해, 소재 태그칩 중 "이미지와 맞는" 항목을 은은하게 강조한다.
     */
    try {
      const kws = draft?.media_settings?.image_descriptions?.[0]?.keywords;
      if (!Array.isArray(kws)) return;
      const next = Array.from(new Set(kws.map((x) => String(x || '').trim()).filter(Boolean))).slice(0, 24);
      if (next.length === 0) return;
      setVisionChipKeywords(next);
    } catch (e) {
      try { console.warn('[QuickMeetCharacterModal] upsertVisionChipKeywordsFromDraft failed:', e); } catch (err) { void err; }
    }
  };

  const isVisionMatchedThemeChip = (label) => {
    /**
     * ✅ 칩 텍스트가 이미지 키워드와 매칭되는지 판정
     *
     * 규칙(보수적):
     * - 정확 일치 우선
     * - 그 외에는 "칩 라벨이 키워드를 포함"하는 경우만 매칭(과다 하이라이트 방지)
     */
    try {
      const t = String(label || '').trim();
      if (!t) return false;
      const normT = t.replace(/\s+/g, '').toLowerCase();
      const kws = Array.isArray(visionChipKeywords) ? visionChipKeywords : [];
      for (const k0 of kws) {
        const k = String(k0 || '').trim();
        if (!k) continue;
        const normK = k.replace(/\s+/g, '').toLowerCase();
        if (!normK) continue;
        if (normT === normK) return true;
        // 너무 짧은 키워드는 오탐이 많아 제외
        if (normK.length >= 2 && normT.includes(normK)) return true;
      }
      return false;
    } catch (e) {
      return false;
    }
  };

  const selectedTagNames = useMemo(() => {
    const map = new Map((allTags || []).map((t) => [t.slug, t.name]));
    return (selectedTagSlugs || []).map((slug) => map.get(slug) || slug);
  }, [allTags, selectedTagSlugs]);

  const allTagsForModal = useMemo(() => {
    /**
     * ✅ 태그 선택 모달용 태그 리스트(신규 태그 즉시 노출)
     *
     * 배경:
     * - QuickMeet의 장르/유형/훅 칩은 "태그로 간주"되며 selectedTagSlugs에 들어간다.
     * - 하지만 tagsAPI.getTags()는 모달 오픈 시점 1회 로드이므로, 아직 DB에 없는 신규 태그는 목록에 없을 수 있다.
     *
     * 정책:
     * - 선택된 slug가 서버 태그 목록에 없다면, 로컬 플레이스홀더(=name=slug)로 목록에 합쳐서 모달에서도 보이게 한다.
     * - 실제 DB 등재는 캐릭터 생성/태그 저장 시 백엔드가 자동 생성한다.
     */
    try {
      const base = Array.isArray(allTags) ? allTags : [];
      const bySlug = new Map(base.map((t) => [String(t?.slug || '').trim(), t]).filter(([s]) => !!s));
      const selected = Array.isArray(selectedTagSlugs) ? selectedTagSlugs : [];
      const extras = [];
      for (const raw of selected) {
        const s = String(raw || '').trim();
        if (!s) continue;
        if (s.startsWith('cover:')) continue;
        if (bySlug.has(s)) continue;
        extras.push({ id: `local:${s}`, slug: s, name: s });
      }
      return extras.length ? [...base, ...extras] : base;
    } catch (e) {
      try { console.warn('[QuickMeetCharacterModal] allTagsForModal failed:', e); } catch (_) {}
      return Array.isArray(allTags) ? allTags : [];
    }
  }, [allTags, selectedTagSlugs]);

  const selectedAudienceSlug = useMemo(() => {
    try {
      return (selectedTagSlugs || []).find((s) => REQUIRED_AUDIENCE_SLUGS.includes(s)) || '';
    } catch (e) {
      try { console.warn('[QuickMeetCharacterModal] selectedAudienceSlug failed:', e); } catch (err) { void err; }
      return '';
    }
  }, [selectedTagSlugs]);

  const selectedStyleSlug = useMemo(() => {
    try {
      return (selectedTagSlugs || []).find((s) => REQUIRED_STYLE_SLUGS.includes(s)) || '';
    } catch (e) {
      try { console.warn('[QuickMeetCharacterModal] selectedStyleSlug failed:', e); } catch (err) { void err; }
      return '';
    }
  }, [selectedTagSlugs]);

  const selectedStyleLabel = useMemo(() => {
    /**
     * ✅ 트레이 접힘 상태에서도 현재 이미지 스타일을 표시하기 위해 라벨을 계산한다.
     */
    try {
      const s = String(selectedStyleSlug || '').trim();
      if (!s) return '';
      const found = (Array.isArray(REQUIRED_STYLE_CHOICES) ? REQUIRED_STYLE_CHOICES : []).find((x) => String(x?.slug || '').trim() === s);
      return String(found?.label || s).trim();
    } catch (e) {
      try { console.warn('[QuickMeetCharacterModal] selectedStyleLabel failed:', e); } catch (err) { void err; }
      return String(selectedStyleSlug || '').trim();
    }
  }, [selectedStyleSlug]);

  const removeSlug = (slug) => {
    try {
      const s = String(slug || '').trim();
      if (!s) return;
      setSelectedTagSlugs((prev) => {
        const arr = Array.isArray(prev) ? prev : [];
        return arr.filter((x) => String(x || '').trim() !== s);
      });
    } catch (e) {
      try { console.error('[QuickMeetCharacterModal] removeSlug failed:', e); } catch (err) { void err; }
    }
  };

  // ✅ 고정 칩(장르/유형/훅) 표시/선택 로직
  const QUICK_MEET_GENRE_MAX_SELECT = 2;
  // ✅ 장르 접힘(1줄) 상태에서 보여줄 칩 개수(마지막은 "더보기" 칩)
  // - 반응형이라 100% 완벽하게 "첫줄 끝"을 보장하긴 어렵지만,
  //   고정 개수로 1줄에 가까운 UX를 만들고 마지막 칩을 더보기로 대체한다.
  const QUICK_MEET_GENRE_PREVIEW_COUNT = 8;
  const QUICK_MEET_TYPE_PAGE_SIZE = 18; // 2줄 정도로 보이도록 대략치(반응형이라도 UX 무난)
  const QUICK_MEET_HOOK_PAGE_SIZE = 14; // 1줄 정도로 보이도록 대략치

  /**
   * ✅ 시뮬 훅/소재/행동 칩 풀 선택(SSOT)
   *
   * 의도:
   * - 시뮬은 "게임 루프/목표/제약/시스템"이 보여야 해서,
   *   롤플 훅(감정선 중심)만으로는 소재가 부족해진다.
   */
  const getHookChipsForMode = (mode) => {
    try {
      const base = (String(mode || '') === 'simulator')
        ? (Array.isArray(QUICK_MEET_HOOK_CHIPS_SIMULATOR) ? QUICK_MEET_HOOK_CHIPS_SIMULATOR : QUICK_MEET_HOOK_CHIPS)
        : (Array.isArray(QUICK_MEET_HOOK_CHIPS) ? QUICK_MEET_HOOK_CHIPS : []);
      // ✅ 방어: 중복 칩이 있으면 UI가 즉시 망가진다 → 항상 unique로 정규화
      return uniqStringsPreserveOrder(base);
    } catch (_) {
      return uniqStringsPreserveOrder(Array.isArray(QUICK_MEET_HOOK_CHIPS) ? QUICK_MEET_HOOK_CHIPS : []);
    }
  };

  useEffect(() => {
    /**
     * ✅ 태그(selectedTagSlugs) ↔ 칩(장르/유형/훅) 양방향 동기화
     *
     * 배경:
     * - 칩 클릭으로 태그에 들어간 값은, 태그 영역에서 X로 제거하면 칩도 같이 해제되어야 UX가 자연스럽다.
     * - TagSelectModal에서 태그를 추가/삭제해도 칩 상태가 일관되게 따라가야 한다.
     *
     * 정책(보수적):
     * - `selectedTagSlugs`를 SSOT로 보고, 칩 상태는 이를 "반영"만 한다(칩 상태 변경이 태그를 다시 변경하지 않음).
     * - 장르는 최대 2개: 기존 선택을 유지하되, 태그에만 남아 있는 장르가 있다면 최대 2개까지 채운다.
     * - 유형/훅은 단일: 기존 선택이 태그에 없으면, 태그 중 첫 매칭(리스트 순)을 선택한다.
     */
    try {
      if (!open) return;
      const slugs = Array.isArray(selectedTagSlugs) ? selectedTagSlugs : [];
      const set = new Set(slugs.map((x) => String(x || '').trim()).filter(Boolean));

      // 1) 장르(최대 2) 동기화
      try {
        setSelectedGenres((prev) => {
          const cur = Array.isArray(prev) ? prev.map((x) => String(x || '').trim()).filter(Boolean) : [];
          const kept = cur.filter((x) => set.has(x));
          if (kept.length >= QUICK_MEET_GENRE_MAX_SELECT) return kept.slice(0, QUICK_MEET_GENRE_MAX_SELECT);

          const pool = Array.isArray(QUICK_MEET_GENRE_CHIPS) ? QUICK_MEET_GENRE_CHIPS : [];
          const add = [];
          for (const g0 of pool) {
            const g = String(g0 || '').trim();
            if (!g) continue;
            if (!set.has(g)) continue;
            if (kept.includes(g)) continue;
            add.push(g);
            if (kept.length + add.length >= QUICK_MEET_GENRE_MAX_SELECT) break;
          }
          const next = [...kept, ...add].slice(0, QUICK_MEET_GENRE_MAX_SELECT);
          return next;
        });
      } catch (_) {}

      // 2) 유형(단일) 동기화
      try {
        setSelectedType((prev) => {
          const cur = String(prev || '').trim();
          if (cur && set.has(cur)) return cur;
          const pool = Array.isArray(QUICK_MEET_TYPE_CHIPS) ? QUICK_MEET_TYPE_CHIPS : [];
          for (const t0 of pool) {
            const t = String(t0 || '').trim();
            if (!t) continue;
            if (set.has(t)) return t;
          }
          return '';
        });
      } catch (_) {}

      // 3) 훅(단일) 동기화
      try {
        setSelectedHook((prev) => {
          const cur = String(prev || '').trim();
          if (cur && set.has(cur)) return cur;
          // ✅ 모드와 무관하게 태그에서 훅을 복원할 수 있어야 한다(방어).
          // - 시뮬에서 선택한 훅이 roleplay 훅 풀에는 없을 수 있으므로 union을 본다.
          const pool = [
            ...(Array.isArray(QUICK_MEET_HOOK_CHIPS) ? QUICK_MEET_HOOK_CHIPS : []),
            ...(Array.isArray(QUICK_MEET_HOOK_CHIPS_SIMULATOR) ? QUICK_MEET_HOOK_CHIPS_SIMULATOR : []),
          ];
          for (const t0 of pool) {
            const t = String(t0 || '').trim();
            if (!t) continue;
            if (set.has(t)) return t;
          }
          return '';
        });
      } catch (_) {}
    } catch (e) {
      try { console.warn('[QuickMeetCharacterModal] sync chips from tags failed:', e); } catch (_) {}
    }
  }, [open, selectedTagSlugs]);

  useEffect(() => {
    /**
     * ✅ 모드(롤플/시뮬) 전환 시 훅 풀 교체
     *
     * 배경:
     * - 시뮬은 "훅/행동/소재"가 게임 루프 중심으로 달라져야 한다.
     * - 모드만 바뀌고 훅 풀은 그대로면, 시뮬에서도 롤플 훅만 보이는 문제가 생긴다.
     *
     * 정책:
     * - 모드에 맞는 훅 풀로 즉시 교체한다.
     * - 기존 선택 훅이 새 풀에 없으면 선택/태그에서 제거해 유령 선택을 막는다.
     */
    try {
      if (!open) return;
      const pool = shuffleCopy(getHookChipsForMode(characterType));
      setHookPool(pool);
      setHookPage(0);
      const picked = String(selectedHook || '').trim();
      if (picked && !pool.includes(picked)) {
        try { setSelectedHook(''); } catch (_) {}
        try { removeSlug(picked); } catch (_) {}
      }
    } catch (_) {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, characterType]);

  const genreDisplay = useMemo(() => {
    try {
      const pool = Array.isArray(genrePool) ? genrePool : [];
      const pinned = Array.isArray(selectedGenres) ? selectedGenres : [];
      const priority = getQuickMeetGenrePriority(selectedAudienceSlug);
      const prioSet = new Set(priority);

      // 선택된 건 항상 맨 앞(최근 선택 우선)
      const pinnedSet = new Set(pinned);

      // 우선순위 칩은 "풀은 그대로" 두되, 표시 순서에서만 앞쪽으로 끌어온다.
      const prioIn = priority.filter((x) => pool.includes(x) && !pinnedSet.has(x));
      const rest = pool.filter((x) => !pinnedSet.has(x) && !prioSet.has(x));
      return [...pinned, ...prioIn, ...rest];
    } catch (_) {
      return Array.isArray(genrePool) ? genrePool : [];
    }
  }, [genrePool, selectedGenres, selectedAudienceSlug]);

  const typeDisplay = useMemo(() => {
    try {
      const pool = Array.isArray(typePool) ? typePool : [];
      const p = String(selectedType || '').trim();
      if (!p) return pool;
      return [p, ...pool.filter((x) => x !== p)];
    } catch (_) {
      return Array.isArray(typePool) ? typePool : [];
    }
  }, [typePool, selectedType]);

  const hookDisplay = useMemo(() => {
    try {
      const pool = Array.isArray(hookPool) ? hookPool : [];
      const p = String(selectedHook || '').trim();
      if (!p) return pool;
      return [p, ...pool.filter((x) => x !== p)];
    } catch (_) {
      return Array.isArray(hookPool) ? hookPool : [];
    }
  }, [hookPool, selectedHook]);

  const typeVisible = useMemo(() => {
    try {
      const arr = Array.isArray(typeDisplay) ? typeDisplay : [];
      if (arr.length === 0) return [];
      const start = (Number(typePage || 0) * QUICK_MEET_TYPE_PAGE_SIZE) % arr.length;
      const slice = arr.slice(start, start + QUICK_MEET_TYPE_PAGE_SIZE);
      // 끝자락이면 앞에서 채우기(연속 교체 UX)
      if (slice.length < QUICK_MEET_TYPE_PAGE_SIZE) {
        const filled = [...slice, ...arr.slice(0, QUICK_MEET_TYPE_PAGE_SIZE - slice.length)];
        // ✅ UX: "교체(새로고침)"로 페이지가 넘어가도, 선택된 칩은 항상 화면에 남아야 한다.
        const picked = String(selectedType || '').trim();
        if (!picked) return filled;
        // 선택값을 맨 앞에 고정 + 나머지는 중복 제거
        const rest = filled.filter((x) => String(x || '').trim() !== picked);
        return [picked, ...rest].slice(0, QUICK_MEET_TYPE_PAGE_SIZE);
      }
      // ✅ UX: "교체(새로고침)"로 페이지가 넘어가도, 선택된 칩은 항상 화면에 남아야 한다.
      const picked = String(selectedType || '').trim();
      if (!picked) return slice;
      const rest = slice.filter((x) => String(x || '').trim() !== picked);
      return [picked, ...rest].slice(0, QUICK_MEET_TYPE_PAGE_SIZE);
    } catch (_) {
      return [];
    }
  }, [typeDisplay, typePage, selectedType]);

  const hookVisible = useMemo(() => {
    try {
      const arr = Array.isArray(hookDisplay) ? hookDisplay : [];
      if (arr.length === 0) return [];
      const start = (Number(hookPage || 0) * QUICK_MEET_HOOK_PAGE_SIZE) % arr.length;
      const slice = arr.slice(start, start + QUICK_MEET_HOOK_PAGE_SIZE);
      if (slice.length < QUICK_MEET_HOOK_PAGE_SIZE) {
        const filled = [...slice, ...arr.slice(0, QUICK_MEET_HOOK_PAGE_SIZE - slice.length)];
        // ✅ UX: "교체(새로고침)"로 페이지가 넘어가도, 선택된 칩은 항상 화면에 남아야 한다.
        const picked = String(selectedHook || '').trim();
        if (!picked) return filled;
        const rest = filled.filter((x) => String(x || '').trim() !== picked);
        return [picked, ...rest].slice(0, QUICK_MEET_HOOK_PAGE_SIZE);
      }
      // ✅ UX: "교체(새로고침)"로 페이지가 넘어가도, 선택된 칩은 항상 화면에 남아야 한다.
      const picked = String(selectedHook || '').trim();
      if (!picked) return slice;
      const rest = slice.filter((x) => String(x || '').trim() !== picked);
      return [picked, ...rest].slice(0, QUICK_MEET_HOOK_PAGE_SIZE);
    } catch (_) {
      return [];
    }
  }, [hookDisplay, hookPage, selectedHook]);

  const upsertExtraTagSlug = (slug, { remove = false } = {}) => {
    /**
     * ✅ 장르/유형/훅 칩 선택을 selectedTagSlugs(태그)로 동기화
     *
     * 원칙:
     * - 필수 태그(성향/이미지 스타일)는 절대 제거하지 않는다.
     * - 동일 slug 중복은 금지한다.
     */
    try {
      const s = String(slug || '').trim();
      if (!s) return;
      const isReq = REQUIRED_AUDIENCE_SLUGS.includes(s) || REQUIRED_STYLE_SLUGS.includes(s);
      if (remove && isReq) return;
      setSelectedTagSlugs((prev) => {
        const arr = Array.isArray(prev) ? prev : [];
        if (remove) return arr.filter((x) => String(x || '').trim() !== s);
        const next = [...arr, s].map((x) => String(x || '').trim()).filter(Boolean);
        return Array.from(new Set(next));
      });
    } catch (e) {
      try { console.warn('[QuickMeetCharacterModal] upsertExtraTagSlug failed:', e); } catch (err) { void err; }
    }
  };

  const toggleGenreChip = (label) => {
    /**
     * ✅ 장르: 최대 2개 선택, 선택된 항목은 앞으로 모으기(최근 선택 우선)
     */
    try {
      const t = String(label || '').trim();
      if (!t) return;
      // 장르 관련 에러가 있으면 클리어
      if (error && error.includes('장르')) setError('');
      setSelectedGenres((prev) => {
        const arr = Array.isArray(prev) ? prev : [];
        if (arr.includes(t)) {
          const next = arr.filter((x) => x !== t);
          upsertExtraTagSlug(t, { remove: true });
          return next;
        }
        if (arr.length >= QUICK_MEET_GENRE_MAX_SELECT) return arr;
        const next = [t, ...arr];
        upsertExtraTagSlug(t, { remove: false });
        return next;
      });
    } catch (e) {
      try { console.warn('[QuickMeetCharacterModal] toggleGenreChip failed:', e); } catch (err) { void err; }
    }
  };

  const toggleSingleChip = (kind, label) => {
    /**
     * ✅ 유형/훅: 단일 선택(토글 가능)
     */
    try {
      const t = String(label || '').trim();
      if (!t) return;
      if (kind === 'type') {
        // 캐릭터 유형 관련 에러가 있으면 클리어
        if (error && error.includes('캐릭터 유형')) setError('');
        setSelectedType((prev) => {
          const prevV = String(prev || '').trim();
          const nextV = (prevV === t) ? '' : t;
          if (prevV && prevV !== nextV) upsertExtraTagSlug(prevV, { remove: true });
          if (nextV) upsertExtraTagSlug(nextV, { remove: false });
          return nextV;
        });
        return;
      }
      if (kind === 'hook') {
        // 소재 관련 에러가 있으면 클리어
        if (error && error.includes('소재')) setError('');
        setSelectedHook((prev) => {
          const prevV = String(prev || '').trim();
          const nextV = (prevV === t) ? '' : t;
          if (prevV && prevV !== nextV) upsertExtraTagSlug(prevV, { remove: true });
          if (nextV) upsertExtraTagSlug(nextV, { remove: false });
          return nextV;
        });
      }
    } catch (e) {
      try { console.warn('[QuickMeetCharacterModal] toggleSingleChip failed:', e); } catch (err) { void err; }
    }
  };

  const resetAll = () => {
    setStep('input');
    setName(initialName || '');
    setSeedText(initialSeedText || '');
    setError('');
    lastAutoGeneratedNameRef.current = '';
    lastAutoGeneratedOneLineRef.current = '';
    setCreatedCharacter(null);
    setSelectedTagSlugs([]);
    setProfileThemeSuggestions({ roleplay: [], simulator: [] });
    setSelectedProfileThemes({ roleplay: [], simulator: [] });
    setVisionChipKeywords([]);
    setProfileAutoGenMenuOpen(false);
    setProfileAutoGenMode('auto');
    setProfileAutoGenKeywordsRaw('');
    setOverwriteConfirmOpen(false);
    setOverwriteConfirmKind('');
    setOverwriteConfirmTargets([]);
    setImageFile(null);
    setUploadedImageUrl('');
    setImageTrayOpen(false);
    setImageTrayBusy(false);
    setImageTrayError('');
    setImageGenPrompt('');
    setImageGenModel('gemini-2.5-flash-image');
    setImageGenRatio('1:1');
    setImageGenOpen(false);
    setDraftPromptOpen(false);
    setImageTrayGallery([]);
    setImgModalOpen(false);
    setImgModalInitialCropIndex(-1);
    setCreatedCharacterId('');
    setCharacterType('roleplay');
    setSimDatingElements(false);
    setMaxTurns(125);
    setSettingMemos(['', '', '']);
    setProfileConceptText('');
    setProfileConceptAutoGenLoading(false);
    setAdvancedOpen(false);
    setGenrePool(shuffleCopy(QUICK_MEET_GENRE_CHIPS));
    setGenreExpanded(false);
    setSelectedGenres([]);
    setChipPanelsOpen({ genre: true, type: false, hook: false });
    setTypePool(shuffleCopy(QUICK_MEET_TYPE_CHIPS));
    setTypePage(0);
    setSelectedType('');
    setHookPool(shuffleCopy(getHookChipsForMode('roleplay')));
    setHookPage(0);
    setSelectedHook('');
    requestIdRef.current = '';
    if (imagePreviewUrl) {
      try { URL.revokeObjectURL(imagePreviewUrl); } catch (e) { try { console.warn('[QuickMeetCharacterModal] revokeObjectURL failed:', e); } catch (err) { void err; } }
    }
    setImagePreviewUrl('');
  };

  const moveToCreateWizard = ({ clearDraft = false } = {}) => {
    try {
      if (isBusy) {
        dispatchToast('error', '진행 중에는 이동할 수 없어요. 잠시만 기다려주세요.');
        return;
      }
      if (clearDraft) {
        try { clearCreateCharacterDraft(); } catch (_) {}
      }
      try { onClose?.(); } catch (e) { try { console.warn('[QuickMeetCharacterModal] onClose failed:', e); } catch (_) {} }
      try { resetAll(); } catch (e) { try { console.warn('[QuickMeetCharacterModal] resetAll failed:', e); } catch (_) {} }
      try { navigate('/characters/create'); } catch (e) { try { console.warn('[QuickMeetCharacterModal] navigate failed:', e); } catch (_) {} }
    } catch (e) {
      try { console.warn('[QuickMeetCharacterModal] moveToCreateWizard failed:', e); } catch (_) {}
    }
  };

  const handleMoveToRichCreate = () => {
    try {
      if (isBusy) {
        dispatchToast('error', '진행 중에는 이동할 수 없어요. 잠시만 기다려주세요.');
        return;
      }
      try {
        if (hasCreateCharacterDraft()) {
          setDraftPromptOpen(true);
          return;
        }
      } catch (_) {}
      moveToCreateWizard({ clearDraft: false });
    } catch (e) {
      try { console.warn('[QuickMeetCharacterModal] handleMoveToRichCreate failed:', e); } catch (_) {}
    }
  };

  // 모달 열릴 때 초기값 반영 + 태그 로드(방어적)
  useEffect(() => {
    if (!open) return;
    setName((v) => (v?.trim() ? v : (initialName || '')));
    setSeedText((v) => (v?.trim() ? v : (initialSeedText || '')));
    setError('');
    lastAutoGeneratedNameRef.current = '';
    lastAutoGeneratedOneLineRef.current = '';
    setStep('input');
    setCreatedCharacter(null);
    setUploadedImageUrl('');
    setImageTrayOpen(false);
    setImageTrayBusy(false);
    setImageTrayError('');
    setImageGenPrompt('');
    setImageGenModel('gemini-2.5-flash-image');
    setImageGenRatio('1:1');
    setImageGenOpen(false);
    setImageTrayGallery([]);
    setImgModalOpen(false);
    setImgModalInitialCropIndex(-1);
    setCreatedCharacterId('');
    setCharacterType('roleplay');
    setSimDatingElements(false);
    setMaxTurns(125);
    setSettingMemos(['', '', '']);
    setProfileConceptText('');
    setProfileConceptAutoGenLoading(false);
    setAdvancedOpen(false);
    requestIdRef.current = '';
    setProfileThemeSuggestions({ roleplay: [], simulator: [] });
    setSelectedProfileThemes({ roleplay: [], simulator: [] });
    setVisionChipKeywords([]);
    setProfileAutoGenMenuOpen(false);
    setProfileAutoGenMode('auto'); // ✅ 요구사항: 알아서 생성만 사용
    setProfileAutoGenKeywordsRaw('');
    setOverwriteConfirmOpen(false);
    setOverwriteConfirmKind('');
    setOverwriteConfirmTargets([]);
    setGenrePool(shuffleCopy(QUICK_MEET_GENRE_CHIPS));
    setGenreExpanded(false);
    setSelectedGenres([]);
    setChipPanelsOpen({ genre: true, type: false, hook: false });
    setTypePool(shuffleCopy(QUICK_MEET_TYPE_CHIPS));
    setTypePage(0);
    setSelectedType('');
    setHookPool(shuffleCopy(getHookChipsForMode('roleplay')));
    setHookPage(0);
    setSelectedHook('');

    // ✅ 요구사항: 기본값(남성향/애니풍) - 유저가 이미 선택했다면 덮어쓰지 않는다.
    try {
      setSelectedTagSlugs((prev) => {
        const arr = Array.isArray(prev) ? prev : [];
        const hasAudience = arr.some((s) => REQUIRED_AUDIENCE_SLUGS.includes(s));
        const hasStyle = arr.some((s) => REQUIRED_STYLE_SLUGS.includes(s));
        const next = [...arr];
        if (!hasAudience) next.push(REQUIRED_AUDIENCE_CHOICES[0]?.slug || '남성향');
        if (!hasStyle) next.push(REQUIRED_STYLE_CHOICES[0]?.slug || '애니풍');
        return Array.from(new Set(next)).filter(Boolean);
      });
    } catch (e) {
      try { console.warn('[QuickMeetCharacterModal] apply default tags failed:', e); } catch (err) { void err; }
    }

    (async () => {
      try {
        const res = await tagsAPI.getTags();
        setAllTags(res.data || []);
      } catch (e) {
        console.error('[QuickMeetCharacterModal] failed to load tags:', e);
        setAllTags([]);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // ✅ 프로필 소재 태그칩 후보 로드(SSOT)
  useEffect(() => {
    if (!open) return;
    (async () => {
      try {
        const res = await charactersAPI.quickProfileThemeSuggestions();
        const data = res?.data || {};
        const rp = Array.isArray(data.roleplay) ? data.roleplay : [];
        const sim = Array.isArray(data.simulator) ? data.simulator : [];
        setProfileThemeSuggestions({ roleplay: rp, simulator: sim });
      } catch (e) {
        console.error('[QuickMeetCharacterModal] failed to load profile theme suggestions:', e);
        setProfileThemeSuggestions({ roleplay: [], simulator: [] });
      }
    })();
  }, [open]);

  const getImageFileSig = (file) => {
    /**
     * ✅ 파일 시그니처(중복 업로드 방지)
     *
     * 의도/원리:
     * - 이미지 선택 시 "하이라이트(비전 힌트)"를 위해 백그라운드 업로드를 수행한다.
     * - 같은 파일에 대해 업로드를 반복하지 않도록 간단한 signature로 중복을 차단한다.
     */
    try {
      if (!file) return '';
      const name = String(file.name || '').trim();
      const size = Number(file.size || 0) || 0;
      const lm = Number(file.lastModified || 0) || 0;
      return `${name}:${size}:${lm}`;
    } catch (e) {
      try { console.warn('[QuickMeetCharacterModal] getImageFileSig failed:', e); } catch (err) { void err; }
      return '';
    }
  };

  const applyVisionHintsToKeywords = (data, modeKey) => {
    /**
     * ✅ 비전 힌트 응답 → 현재 모드(theme) 기반으로 칩 하이라이트 키워드 구성
     *
     * 정책(보수적):
     * - 우선: 백엔드가 계산한 "모드별 소재칩 매칭"을 그대로 사용한다(SSOT).
     * - 매칭이 비면: 힌트(앵커) 자체를 보조로 사용한다(UX 폴백).
     */
    try {
      const mode = (modeKey === 'simulator' ? 'simulator' : 'roleplay');
      const rp = Array.isArray(data?.roleplay_theme_matches) ? data.roleplay_theme_matches : [];
      const sim = Array.isArray(data?.simulator_theme_matches) ? data.simulator_theme_matches : [];
      const hints = Array.isArray(data?.hints_ko) ? data.hints_ko : [];
      const primary = (mode === 'simulator') ? sim : rp;
      const fallback = primary.length > 0 ? [] : hints;
      const merged = Array.from(new Set([...primary, ...fallback].map((x) => String(x || '').trim()).filter(Boolean))).slice(0, 24);
      setVisionChipKeywords(merged);
    } catch (e) {
      try { console.warn('[QuickMeetCharacterModal] applyVisionHintsToKeywords failed:', e); } catch (err) { void err; }
    }
  };

  // ✅ 이미지 선택 시: (1) 백그라운드 업로드 → (2) 비전 힌트 조회 → (3) 소재칩 하이라이트
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        if (!open) return;
        if (!imageFile) return;
        if (uploadedImageUrl) return;
        // ✅ 인라인 갤러리 업로드(트레이) 중이거나, 이미 갤러리가 있으면 중복 업로드를 하지 않는다.
        if (imageTrayBusy) return;
        if (Array.isArray(imageTrayGallery) && imageTrayGallery.length > 0) return;
        if (generating || autoGenLoading) return;
        if (autoUploadInFlightRef.current) return;

        const sig = getImageFileSig(imageFile);
        if (sig && lastUploadedFileSigRef.current === sig) return;
        lastUploadedFileSigRef.current = sig;

        autoUploadInFlightRef.current = true;
        const uploadRes = await filesAPI.uploadImages([imageFile]);
        if (!active) return;
        const urls = Array.isArray(uploadRes?.data) ? uploadRes.data : [uploadRes?.data];
        const imgUrl = String(urls?.[0] || '').trim();
        if (!imgUrl) throw new Error('image_upload_failed');
        setUploadedImageUrl(imgUrl);
      } catch (e) {
        console.error('[QuickMeetCharacterModal] background image upload failed:', e);
        // 방어: 하이라이트 기능은 옵션이므로, 실패해도 생성 플로우는 유지
        dispatchToast('error', '이미지 분석 준비(업로드)에 실패했어요. 다시 시도하면 정상 동작할 수 있어요.');
      } finally {
        autoUploadInFlightRef.current = false;
      }
    })();
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, imageFile, uploadedImageUrl, generating, autoGenLoading]);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        if (!open) return;
        const imgUrl = String(uploadedImageUrl || '').trim();
        if (!imgUrl) return;
        if (visionHintsInFlightRef.current) return;
        if (lastVisionUrlRef.current === imgUrl && lastVisionHintsRef.current) {
          // 모드 변경은 별도 effect에서 반영
          return;
        }
        visionHintsInFlightRef.current = true;
        lastVisionUrlRef.current = imgUrl;

        const res = await charactersAPI.quickVisionHints({ image_url: imgUrl });
        const data = res?.data || {};
        if (!active) return;
        lastVisionHintsRef.current = data;
        applyVisionHintsToKeywords(data, characterType);
      } catch (e) {
        console.error('[QuickMeetCharacterModal] quickVisionHints failed:', e);
        // 방어: 힌트 실패는 UX만 영향
      } finally {
        visionHintsInFlightRef.current = false;
      }
    })();
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, uploadedImageUrl]);

  // 모드 전환 시: 기존에 받아둔 힌트를 현재 모드에 맞춰 재적용
  useEffect(() => {
    try {
      if (!open) return;
      const data = lastVisionHintsRef.current;
      if (!data) return;
      applyVisionHintsToKeywords(data, characterType);
    } catch (e) {
      try { console.warn('[QuickMeetCharacterModal] reapply vision hints failed:', e); } catch (err) { void err; }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, characterType]);

  const getSelectedProfileThemesForCurrentMode = () => {
    try {
      const mode = characterType === 'simulator' ? 'simulator' : 'roleplay';
      const m = selectedProfileThemes?.[mode];
      return Array.isArray(m) ? m : [];
    } catch (e) {
      try { console.warn('[QuickMeetCharacterModal] getSelectedProfileThemesForCurrentMode failed:', e); } catch (err) { void err; }
      return [];
    }
  };

  const getProfileAutoGenKeywords = () => {
    /**
     * ✅ '알아서 생성' 보조 키워드 파싱(방어)
     *
     * 의도/원리:
     * - 유저가 "단어 3개까지 ,로 끊어서" 입력한 값을 정규화해 seed_text에 주입한다.
     * - 빈 값/공백/중복/과다 입력을 방어하고, 상한(3개)을 강제한다.
     */
    try {
      const raw = String(profileAutoGenKeywordsRaw || '').trim();
      if (!raw) return [];
      const parts = raw
        .split(',')
        .map((s) => String(s || '').trim())
        .filter(Boolean);
      if (parts.length === 0) return [];
      const uniq = Array.from(new Set(parts));
      // ✅ 상한: 3개
      return uniq.slice(0, 3);
    } catch (e) {
      try { console.warn('[QuickMeetCharacterModal] getProfileAutoGenKeywords failed:', e); } catch (err) { void err; }
      return [];
    }
  };

  const getSelectedExtraTagsForAutoGen = () => {
    /**
     * ✅ 유저가 고른 "소재(태그)"를 자동생성 seed에 반영하기 위한 리스트
     *
     * 원칙:
     * - 필수(성향/이미지 스타일)는 제외
     * - cover:* 같은 내부 태그는 제외
     * - 너무 길어지면 품질이 떨어질 수 있어 적당히 컷(보수적으로 8개)
     */
    try {
      const audience = selectedAudienceSlug || '';
      const style = selectedStyleSlug || '';
      const arr = (Array.isArray(selectedTagSlugs) ? selectedTagSlugs : [])
        .map((x) => String(x || '').trim())
        .filter(Boolean)
        .filter((x) => x !== audience && x !== style)
        .filter((x) => !String(x || '').startsWith('cover:'));
      return Array.from(new Set(arr)).slice(0, 8);
    } catch (e) {
      try { console.warn('[QuickMeetCharacterModal] getSelectedExtraTagsForAutoGen failed:', e); } catch (_) {}
      return [];
    }
  };

  const openOverwriteConfirm = (kind, targets) => {
    /**
     * ✅ 덮어쓰기 경고 모달 오픈
     *
     * 의도/원리:
     * - 자동생성 결과가 마음에 들지 않을 수 있으므로 "덮어쓰기"를 허용한다.
     * - 단, 실수로 입력값을 날리지 않도록 덮어쓰기 직전에 경고 모달을 띄운다.
     */
    try {
      if (generating || autoGenLoading || profileConceptAutoGenLoading) return;
      const k = String(kind || '').trim();
      const t = Array.isArray(targets) ? targets.filter(Boolean) : [];
      if (!k || t.length === 0) return;
      setOverwriteConfirmKind(k);
      setOverwriteConfirmTargets(t);
      setOverwriteConfirmOpen(true);
    } catch (e) {
      try { console.warn('[QuickMeetCharacterModal] openOverwriteConfirm failed:', e); } catch (err) { void err; }
    }
  };

  const handleOverwriteConfirm = async () => {
    /**
     * ✅ 덮어쓰기 확인 클릭
     *
     * 동작:
     * - kind에 따라 해당 자동생성을 "강제로" 실행한다(덮어쓰기).
     */
    try {
      if (generating || autoGenLoading || profileConceptAutoGenLoading) return;
      const kind = String(overwriteConfirmKind || '').trim();
      setOverwriteConfirmOpen(false);

      if (kind === 'name') {
        await handleAutoGenerateName({ forceOverwrite: true });
        return;
      }
      if (kind === 'oneLine') {
        await handleAutoGenerateOneLine({ forceOverwrite: true });
        return;
      }
      if (kind === 'profile') {
        // ✅ 정책: '확인'은 작품명 → 한줄소개 순서로 함께 덮어쓴다(한줄소개는 작품명 기반).
        await handleAutoGenerateName({ forceOverwrite: true });
        await handleAutoGenerateOneLine({
          forceOverwrite: true,
          nameOverride: lastAutoGeneratedNameRef.current || name,
        });
        return;
      }
      if (kind === 'concept') {
        await handleAutoGenerateProfileConcept({ forceOverwrite: true });
        return;
      }
    } catch (e) {
      console.error('[QuickMeetCharacterModal] overwrite confirm failed:', e);
      const detail = e?.response?.data?.detail || e?.message || '알 수 없는 오류';
      dispatchToast('error', `자동생성 실패: ${detail}`);
    } finally {
      setOverwriteConfirmKind('');
      setOverwriteConfirmTargets([]);
    }
  };

  const toggleProfileTheme = (mode, theme) => {
    /**
     * ✅ 소재 태그칩 토글
     *
     * 의도/원리:
     * - 선택된 소재는 seed_text에 주입되어, 작품명/한줄소개 자동생성의 "방향"을 강제한다.
     * - 너무 많이 선택하면 모델이 무시할 수 있으므로, 상한을 둔다(UX/운영 안정).
     */
    try {
      const m = (mode === 'simulator' ? 'simulator' : 'roleplay');
      const t = String(theme || '').trim();
      if (!t) return;
      setSelectedProfileThemes((prev) => {
        const base = prev && typeof prev === 'object' ? prev : { roleplay: [], simulator: [] };
        const cur = Array.isArray(base[m]) ? base[m] : [];
        const has = cur.includes(t);
        const next = has ? cur.filter((x) => x !== t) : [...cur, t];
        // ✅ 상한(운영 안정): 3개를 넘기면 산만해져 품질이 떨어질 확률이 커진다.
        const capped = next.slice(0, 3);
        return { ...base, [m]: capped };
      });
    } catch (e) {
      try { console.error('[QuickMeetCharacterModal] toggleProfileTheme failed:', e); } catch (err) { void err; }
    }
  };

  const ThemeChip = ({ label, active, onClick, onRemoveClick }) => {
    const text = String(label || '').trim();
    if (!text) return null;
    const isVisionMatched = !active && isVisionMatchedThemeChip(text);
    return (
      <button
        type="button"
        onClick={onClick}
        disabled={isBusy}
        aria-pressed={!!active}
        className={[
          'inline-flex items-center gap-2 h-8 sm:h-9 px-3 rounded-full border transition select-none',
          'outline-none focus-visible:ring-2 focus-visible:ring-purple-500/30',
          isVisionMatched ? 'cc-vision-chip' : '',
          active
            ? 'bg-purple-600/30 border-purple-500 text-white ring-1 ring-purple-400/30'
            : 'bg-black/20 border-white/10 text-white/80 hover:bg-white/5 hover:text-white',
        ].join(' ')}
        title={text}
      >
        <span className="text-xs sm:text-sm font-semibold max-w-[160px] truncate">{text}</span>
        {active && typeof onRemoveClick === 'function' ? (
          <span
            role="button"
            tabIndex={0}
            aria-label="소재 선택 취소"
            title="선택 취소"
            className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-black/30 text-gray-200 hover:bg-black/50 hover:text-white"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onRemoveClick();
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                e.stopPropagation();
                onRemoveClick();
              }
            }}
          >
            ×
          </span>
        ) : null}
      </button>
    );
  };

  const handleApplyThemesAndAutoGenerate = async () => {
    /**
     * ✅ 소재 선택 "확인" → 자동생성 실행
     *
     * 의도/원리:
     * - 유저가 소재 태그칩을 고른 뒤 "확인"을 누르면 바로 자동생성이 진행되어야 한다(요구사항).
     * - 기존 정책(덮어쓰기 금지)을 그대로 유지한다:
     *   - 작품명이 이미 있으면 작품명 자동생성은 건너뛴다.
     *   - 한줄소개가 이미 있으면 한줄소개 자동생성은 건너뛴다.
     */
    try {
      if (autoGenInFlightRef.current || autoGenLoading || generating) return;
      setError('');

      // ✅ 덮어쓰기 허용(경고 모달 선행)
      const targets = [];
      if (hasAnyText(name)) targets.push('작품명');
      if (hasAnyText(seedText)) targets.push('한줄소개');
      if (targets.length > 0) {
        openOverwriteConfirm('profile', targets);
        return;
      }

      // 1) 작품명 → 2) 한줄소개(작품명 기반)
      await handleAutoGenerateName({ forceOverwrite: false });
      await handleAutoGenerateOneLine({
        forceOverwrite: false,
        nameOverride: lastAutoGeneratedNameRef.current || name,
      });
    } catch (e) {
      console.error('[QuickMeetCharacterModal] apply themes & auto-generate failed:', e);
      const detail = e?.response?.data?.detail || e?.message || '알 수 없는 오류';
      dispatchToast('error', `자동생성 실패: ${detail}`);
    }
  };

  const handleConfirmProfileAutoGen = async () => {
    /**
     * ✅ 생성 방식 선택 후 "확인"
     *
     * 요구사항:
     * - "선택해서 생성": 소재칩 선택 영역을 펼쳐서 고른 뒤 확인 → 자동생성
     * - "알아서 생성": (선택) 키워드 3개 입력 후 확인 → 자동생성
     *
     * 정책:
     * - 덮어쓰기 금지(기존 handleAutoGenerateName/OneLine 정책 유지)
     * - '선택해서 생성'은 최소 1개 이상 선택되었을 때만 진행(UX 일관)
     */
    try {
      if (autoGenInFlightRef.current || autoGenLoading || generating) return;
      setError('');

      if (profileAutoGenMode === 'select') {
        const chosen = getSelectedProfileThemesForCurrentMode();
        if (!Array.isArray(chosen) || chosen.length === 0) {
          dispatchToast('error', '소재를 1개 이상 선택해주세요.');
          return;
        }
        // ✅ UX: "확인"을 누르면 트레이는 닫고 진행한다(중복 클릭/시각적 노이즈 방지)
        try { setProfileAutoGenMenuOpen(false); } catch (_) {}
        // ✅ 덮어쓰기 허용(경고 모달 선행)
        const targets = [];
        if (hasAnyText(name)) targets.push('작품명');
        if (hasAnyText(seedText)) targets.push('한줄소개');
        if (targets.length > 0) {
          openOverwriteConfirm('profile', targets);
          return;
        }
        await handleAutoGenerateName({ forceOverwrite: false });
        await handleAutoGenerateOneLine({
          forceOverwrite: false,
          nameOverride: lastAutoGeneratedNameRef.current || name,
        });
        return;
      }

      // 'auto' 모드: 키워드는 선택(없어도 동작)
      const targets = [];
      if (hasAnyText(name)) targets.push('작품명');
      if (hasAnyText(seedText)) targets.push('한줄소개');
      if (targets.length > 0) {
        openOverwriteConfirm('profile', targets);
        return;
      }
      await handleAutoGenerateName({ forceOverwrite: false });
      await handleAutoGenerateOneLine({
        forceOverwrite: false,
        nameOverride: lastAutoGeneratedNameRef.current || name,
      });
      dispatchToast('success', '자동생성이 완료되었습니다.');
    } catch (e) {
      console.error('[QuickMeetCharacterModal] confirm profile auto-gen failed:', e);
      const detail = e?.response?.data?.detail || e?.message || '알 수 없는 오류';
      dispatchToast('error', `자동생성 실패: ${detail}`);
    }
  };

  // 모달 닫힐 때: 객체 URL 정리
  useEffect(() => {
    if (open) return;
    if (imagePreviewUrl) {
      try { URL.revokeObjectURL(imagePreviewUrl); } catch (e) { try { console.warn('[QuickMeetCharacterModal] revokeObjectURL(close) failed:', e); } catch (err) { void err; } }
    }
    setImagePreviewUrl('');
  }, [open, imagePreviewUrl]);

  const onPickImage = (file) => {
    try {
      setError('');
      setImageTrayError('');
      setCreatedCharacter(null);
      setUploadedImageUrl('');
      setCreatedCharacterId('');
      setVisionChipKeywords([]);
      lastVisionUrlRef.current = '';
      lastVisionHintsRef.current = null;
      lastUploadedFileSigRef.current = '';
      setImageFile(file || null);
      if (imagePreviewUrl) {
        try { URL.revokeObjectURL(imagePreviewUrl); } catch (e) { try { console.warn('[QuickMeetCharacterModal] revokeObjectURL(pick) failed:', e); } catch (err) { void err; } }
      }
      if (file) {
        const url = URL.createObjectURL(file);
        setImagePreviewUrl(url);
      } else {
        setImagePreviewUrl('');
      }
    } catch (e) {
      console.error('[QuickMeetCharacterModal] onPickImage failed:', e);
    }
  };

  const selectRepresentativeImageUrl = (url) => {
    /**
     * ✅ 대표 이미지 URL 선택(인라인 트레이 공용)
     *
     * 의도/동작:
     * - 업로드/생성으로 얻은 URL을 대표 이미지로 적용한다.
     * - 이미지가 바뀌면 비전 힌트/하이라이트를 다시 계산해야 하므로 캐시를 리셋한다.
     */
    try {
      const u = String(url || '').trim();
      if (!u) return;
      setError('');
      setImageTrayError('');
      setCreatedCharacter(null);
      setCreatedCharacterId('');
      setVisionChipKeywords([]);
      lastVisionUrlRef.current = '';
      lastVisionHintsRef.current = null;
      lastUploadedFileSigRef.current = '';
      setImageFile(null);
      if (imagePreviewUrl) {
        try { URL.revokeObjectURL(imagePreviewUrl); } catch (e) { try { console.warn('[QuickMeetCharacterModal] revokeObjectURL(selectRepresentativeImageUrl) failed:', e); } catch (_) {} }
      }
      setImagePreviewUrl('');
      setUploadedImageUrl(u);
    } catch (e) {
      console.error('[QuickMeetCharacterModal] selectRepresentativeImageUrl failed:', e);
      dispatchToast('error', '대표 이미지를 적용하지 못했습니다. 잠시 후 다시 시도해주세요.');
    }
  };

  const clearRepresentativeAndGallery = () => {
    /**
     * ✅ 대표/갤러리 초기화(방어)
     *
     * 의도:
     * - 대표 이미지를 비우면 validate에서 막히므로, 유저가 의도적으로 지웠다는 걸 UI가 즉시 반영해야 한다.
     * - 비전 힌트 캐시도 함께 리셋한다.
     */
    try {
      setImageTrayGallery([]);
      onPickImage(null);
      setUploadedImageUrl('');
      setVisionChipKeywords([]);
      lastVisionUrlRef.current = '';
      lastVisionHintsRef.current = null;
      lastUploadedFileSigRef.current = '';
      setImageTrayError('');
      setImgModalOpen(false);
      setImgModalInitialCropIndex(-1);
      setImgModalSeedGallery(null);
      setProfileAutoGenUseImage(false);
      setUseSentenceStyleName(false);
    } catch (e) {
      console.error('[QuickMeetCharacterModal] clearRepresentativeAndGallery failed:', e);
    }
  };

  useEffect(() => {
    // ✅ 이미지가 없는 상태에서는 토글을 강제로 OFF + 비활성(요구사항)
    const hasAnyImage = !!(
      (Array.isArray(imageTrayGallery) && imageTrayGallery.length > 0)
      || imageFile
      || uploadedImageUrl
      || imagePreviewUrl
    );
    if (!hasAnyImage && profileAutoGenUseImage) {
      setProfileAutoGenUseImage(false);
    }
  }, [imageTrayGallery.length, imageFile, uploadedImageUrl, imagePreviewUrl, profileAutoGenUseImage]);

  const openImageCropModal = (idx, { fallbackUrl } = {}) => {
    /**
     * ✅ 기존(전역) 이미지 생성/삽입 모달의 크롭 UI를 사용한다.
     *
     * 의도:
     * - "원래 쓰던 크롭 모달"을 SSOT로 재사용한다(새 UI 추가/중복 방지).
     * - 클릭한 이미지 인덱스로 크롭 모달을 즉시 연다.
     */
    try {
      if (isBusy || imageTrayBusy) return;
      const i = Number(idx);
      if (!Number.isFinite(i)) return;
      const arr = Array.isArray(imageTrayGallery) ? imageTrayGallery : [];
      if (arr.length === 0) {
        const fu = String(fallbackUrl || '').trim();
        if (!fu) {
          dispatchToast('error', '이미지를 먼저 업로드/선택해주세요.');
          return;
        }
        // 업로드가 아직 안 끝난 상태(로컬 프리뷰 등)에서도 크롭을 열 수 있게 임시 갤러리를 주입한다.
        setImgModalSeedGallery([{ id: 'tmp:rep', url: fu }]);
        setImgModalInitialCropIndex(0);
        setImgModalOpen(true);
        return;
      }
      if (i < 0 || i >= arr.length) return;
      setImgModalSeedGallery(null);
      setImgModalInitialCropIndex(i);
      setImgModalOpen(true);
    } catch (e) {
      console.error('[QuickMeetCharacterModal] openImageCropModal failed:', e);
    }
  };

  const updateGalleryScrollState = () => {
    try {
      const el = galleryStripRef.current;
      if (!el) return;
      const left = Number(el.scrollLeft || 0) || 0;
      const maxLeft = Math.max(0, (el.scrollWidth || 0) - (el.clientWidth || 0));
      const eps = 2; // 미세 오차 보정
      setGalleryCanLeft(left > eps);
      setGalleryCanRight(left < maxLeft - eps);
    } catch (_) {}
  };

  useEffect(() => {
    if (!open) return;
    updateGalleryScrollState();
    const onResize = () => updateGalleryScrollState();
    try { window.addEventListener('resize', onResize); } catch (_) {}
    return () => {
      try { window.removeEventListener('resize', onResize); } catch (_) {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, imageTrayOpen, imageTrayGallery.length]);

  useEffect(() => {
    /**
     * ✅ PC 마우스휠 → 가로 스크롤(경고 제거)
     *
     * 배경:
     * - React의 `onWheel`은 passive로 처리되는 경우가 있어 `preventDefault()`가 막히며 콘솔 경고가 난다.
     *
     * 해결:
     * - 갤러리 스트립 DOM에 직접 wheel 리스너를 붙이고 `{ passive: false }`로 등록해
     *   세로 휠(deltaY)을 가로 스크롤로 변환한다.
     * - shift+wheel(브라우저 기본 가로 스크롤)은 그대로 통과.
     * - 모바일(터치/coarse pointer)에서는 개입하지 않는다.
     */
    if (!open) return;
    if (!imageTrayOpen) return;
    if (isCoarsePointer) return;
    const el = galleryStripRef.current;
    if (!el) return;

    const onWheel = (ev) => {
      try {
        if (!galleryStripRef.current) return;
        // shift+wheel은 OS/브라우저 기본 동작을 존중
        if (ev.shiftKey) return;

        const dy = Number(ev.deltaY || 0) || 0;
        const dx = Number(ev.deltaX || 0) || 0;
        // 트랙패드가 이미 가로 스크롤을 주는 경우는 건드리지 않는다.
        if (Math.abs(dx) > Math.abs(dy)) return;
        if (Math.abs(dy) < 1) return;

        const maxLeft = Math.max(0, (el.scrollWidth || 0) - (el.clientWidth || 0));
        if (maxLeft <= 0) return; // 오버플로우 없으면 개입할 필요 없음

        ev.preventDefault();
        el.scrollLeft += dy;
        updateGalleryScrollState();
      } catch (_) {}
    };

    try { el.addEventListener('wheel', onWheel, { passive: false }); } catch (_) {}
    return () => {
      try { el.removeEventListener('wheel', onWheel); } catch (_) {}
    };
  }, [open, imageTrayOpen, isCoarsePointer, imageTrayGallery.length]);

  const normalizeGallery = (arr) => {
    /**
     * ✅ 갤러리 정규화(중복/빈 값 제거)
     *
     * 의도/동작:
     * - URL이 비어있거나 중복인 항목은 제거한다.
     * - 첫 번째 항목이 "대표"가 되므로, 순서는 입력된 순서를 유지한다.
     */
    try {
      const src = Array.isArray(arr) ? arr : [];
      const seen = new Set();
      const out = [];
      for (const it of src) {
        const u = String(it?.url || '').trim();
        if (!u || seen.has(u)) continue;
        seen.add(u);
        out.push({ id: it?.id ?? u, url: u });
      }
      return out.slice(0, 24);
    } catch (_) {
      return [];
    }
  };

  const syncRepresentativeFromGallery = (gallery) => {
    /**
     * ✅ 갤러리 첫 번째를 대표로 동기화
     *
     * 의도:
     * - 요구사항: "맨 먼저 있는 이미지가 대표이미지"
     * - 갤러리 순서 변경/삭제/추가 이후 대표 URL을 항상 첫 번째로 맞춘다.
     */
    try {
      const g = Array.isArray(gallery) ? gallery : [];
      const first = String(g?.[0]?.url || '').trim();
      if (!first) return;
      if (String(uploadedImageUrl || '').trim() === first) return;
      selectRepresentativeImageUrl(first);
    } catch (_) {}
  };

  const uploadImagesToGallery = async (files) => {
    /**
     * ✅ 여러 장 업로드 → 갤러리에 누적
     *
     * 원칙:
     * - 업로드 결과(URL)는 갤러리에 누적한다.
     * - 갤러리가 비어있었다면 첫 번째가 대표가 된다.
     */
    const list = Array.from(files || []).filter(Boolean);
    if (list.length === 0) return;
    if (imageTrayBusy || generating || autoGenLoading) return;
    setImageTrayBusy(true);
    setImageTrayError('');
    try {
      /**
       * ✅ 업로드 SSOT 정합(속도/크롭 안정)
       *
       * 배경:
       * - 다른 화면(원작챗/웹소설)은 `mediaAPI.upload`(MediaAsset)을 쓰며 업로드가 빠르고, 크롭(서버 폴백)도 asset id 기반으로 안정적이다.
       * - QuickMeet이 `/files/upload`로만 올리면:
       *   - 업로드가 상대적으로 느릴 수 있고(로컬 디스크/프록시/정적 서빙),
       *   - 크롭 서버 폴백에서 asset id가 없어 제약이 생긴다.
       *
       * 정책:
       * - QuickMeet 갤러리 업로드도 `mediaAPI.upload`로 통일한다.
       */
      const res = await mediaAPI.upload(list);
      const items = Array.isArray(res?.data?.items) ? res.data.items : [];
      const cleaned = items
        .map((it) => ({ id: it?.id ?? it?.url, url: String(it?.url || '').trim() }))
        .filter((x) => x.url);
      if (cleaned.length === 0) throw new Error('image_upload_failed');

      setImageTrayGallery((prev) => {
        const next = normalizeGallery([
          ...(Array.isArray(prev) ? prev : []),
          ...cleaned,
        ]);
        // 갤러리가 비어있던 경우에만 대표를 첫 번째로 맞춘다.
        if (!(Array.isArray(prev) && prev.length > 0)) {
          try { syncRepresentativeFromGallery(next); } catch (_) {}
        }
        return next;
      });

      dispatchToast('success', `이미지 ${cleaned.length}개 업로드됨`);
    } catch (e) {
      console.error('[QuickMeetCharacterModal] uploadImagesToGallery failed:', e);
      const detail = e?.response?.data?.detail || e?.message || '알 수 없는 오류';
      setImageTrayError(`업로드 실패: ${detail}`);
      dispatchToast('error', `업로드 실패: ${detail}`);
    } finally {
      setImageTrayBusy(false);
    }
  };

  const removeGalleryItem = (idx) => {
    try {
      const i = Number(idx);
      if (!Number.isFinite(i)) return;
      setImageTrayGallery((prev) => {
        const arr = Array.isArray(prev) ? prev : [];
        if (i < 0 || i >= arr.length) return arr;
        const next = arr.filter((_, k) => k !== i);
        // 대표 동기화: 첫 번째가 대표
        if (next.length > 0) syncRepresentativeFromGallery(next);
        else {
          // 전부 제거되면 대표도 비움
          clearRepresentativeAndGallery();
        }
        return next;
      });
    } catch (e) {
      console.error('[QuickMeetCharacterModal] removeGalleryItem failed:', e);
    }
  };

  const moveGalleryItem = (from, to) => {
    try {
      const f = Number(from);
      const t = Number(to);
      if (!Number.isFinite(f) || !Number.isFinite(t)) return;
      setImageTrayGallery((prev) => {
        const arr = Array.isArray(prev) ? prev : [];
        if (f < 0 || t < 0 || f >= arr.length || t >= arr.length) return arr;
        if (f === t) return arr;
        const next = arr.slice();
        const [moved] = next.splice(f, 1);
        next.splice(t, 0, moved);
        syncRepresentativeFromGallery(next);
        return next;
      });
    } catch (e) {
      console.error('[QuickMeetCharacterModal] moveGalleryItem failed:', e);
    }
  };

  const runInlineImageGenerate = async () => {
    /**
     * ✅ 대표 이미지 인라인 생성
     *
     * 원칙:
     * - 최소 옵션(모델/비율/개수)을 고정해 UX를 단순화한다.
     * - 생성된 첫 번째 이미지를 대표 이미지로 즉시 적용한다.
     */
    if (imageTrayBusy || generating || autoGenLoading) return;
    const styleSlug = String(selectedStyleSlug || '').trim();
    if (!styleSlug) {
      setImageTrayError('이미지 스타일을 먼저 선택해주세요.');
      return;
    }
    const prompt = String(imageGenPrompt || '').trim();
    if (!prompt) {
      setImageTrayError('프롬프트를 입력해주세요.');
      return;
    }
    setImageTrayBusy(true);
    setImageTrayError('');
    try {
      const model = String(imageGenModel || 'gemini-2.5-flash-image').trim() || 'gemini-2.5-flash-image';
      const ratio = String(imageGenRatio || '1:1').trim() || '1:1';
      const provider = model.startsWith('fal-ai/') ? 'fal' : 'gemini';
      const styleKey = styleKeyFromQuickMeetStyleSlug(styleSlug);
      const finalPrompt = buildImageGenerationPrompt(prompt, styleKey, ratio) || prompt;
      const params = { provider, model, ratio, count: 1, prompt: finalPrompt };
      const res = await mediaAPI.generate(params);
      const items = Array.isArray(res?.data?.items) ? res.data.items : [];
      const urls = items.map((x) => String(x?.url || '').trim()).filter(Boolean);
      if (urls.length === 0) {
        setImageTrayError('생성 결과가 없습니다. 프롬프트를 바꿔 다시 시도해주세요.');
        return;
      }

      setImageTrayGallery((prev) => {
        const arr = Array.isArray(prev) ? prev : [];
        const merged = [
          ...arr,
          ...items.map((it) => ({ id: it?.id ?? String(it?.url || '').trim(), url: String(it?.url || '').trim() })).filter((x) => x.url),
        ];
        const next = normalizeGallery(merged);
        // 갤러리가 비어있던 경우에만 대표를 첫 번째로 맞춘다.
        if (!(Array.isArray(prev) && prev.length > 0)) {
          try { syncRepresentativeFromGallery(next); } catch (_) {}
        }
        return next;
      });

      // 생성 결과는 갤러리에 누적(대표는 첫 번째 규칙이므로, 유저가 순서로 결정)
      dispatchToast('success', '대표 이미지가 생성/적용되었습니다.');
    } catch (e) {
      console.error('[QuickMeetCharacterModal] runInlineImageGenerate failed:', e);
      const detail = e?.response?.data?.detail || e?.message || '알 수 없는 오류';
      setImageTrayError(`이미지 생성 실패: ${detail}`);
      dispatchToast('error', `이미지 생성 실패: ${detail}`);
    } finally {
      setImageTrayBusy(false);
    }
  };

  /**
   * ✅ toggleExclusiveTag
   *
   * 의도/동작:
   * - "성향/스타일"처럼 서로 배타적인 태그 그룹에서 1개만 선택되도록 강제한다.
   * - 기존 선택을 클릭하면 해제(빈 값)할 수 있지만, 생성 시 validate에서 다시 막는다.
   */
  const toggleExclusiveTag = (slug, groupSlugs) => {
    try {
      const s = String(slug || '').trim();
      const group = Array.isArray(groupSlugs) ? groupSlugs : [];
      if (!s || group.length === 0) return;
      setSelectedTagSlugs((prev) => {
        const arr = Array.isArray(prev) ? prev : [];
        const had = arr.includes(s);
        const filtered = arr.filter((x) => !group.includes(x));
        // ✅ 정책(요구사항): 필수 그룹(성향/스타일)은 "해제 불가"
        // - 이미 선택된 항목을 다시 클릭해도 해제되지 않게 한다(항상 1개 유지).
        const next = had ? [...filtered, s] : [...filtered, s];
        // 중복 방지
        return Array.from(new Set(next));
      });
    } catch (e) {
      try { console.error('[QuickMeetCharacterModal] toggleExclusiveTag failed:', e); } catch (err) { void err; }
    }
  };

  /**
   * ✅ validateRequiredMeta
   *
   * 의도/동작:
   * - 온보딩 30초 생성에서 "성향" + "이미지 스타일"을 필수로 강제한다.
   * - 초안 생성 단계/최종 저장 단계 모두에서 재사용하여 우회/상태 꼬임을 방지한다.
   */
  const validateRequiredMeta = () => {
    try {
      const slugs = Array.isArray(selectedTagSlugs) ? selectedTagSlugs : [];
      const audience = slugs.find((s) => REQUIRED_AUDIENCE_SLUGS.includes(s)) || '';
      const style = slugs.find((s) => REQUIRED_STYLE_SLUGS.includes(s)) || '';
      if (!audience) return '남성향/여성향/전체 중 하나를 선택해주세요.';
      if (!style) return '애니풍/실사풍/반실사/아트웤(디자인) 중 하나를 선택해주세요.';
      // ✅ 장르/캐릭터유형/소재 필수 검증
      if (!Array.isArray(selectedGenres) || selectedGenres.length === 0) {
        return '장르를 1개 이상 선택해주세요.';
      }
      if (!String(selectedType || '').trim()) {
        return '캐릭터 유형 중 하나를 선택해주세요.';
      }
      if (!String(selectedHook || '').trim()) {
        return '소재(훅) 중 하나를 선택해주세요.';
      }
      return '';
    } catch (e) {
      try { console.warn('[QuickMeetCharacterModal] validateRequiredMeta failed:', e); } catch (err) { void err; }
      return '필수 선택값을 확인할 수 없습니다. 다시 시도해주세요.';
    }
  };

  const validateInput = () => {
    const n = String(name || '').trim();
    const s = String(seedText || '').trim();
    if (!n) return '작품명을 입력해주세요.';
    if (n.length > PROFILE_NAME_MAX_LEN) return `작품명은 ${PROFILE_NAME_MAX_LEN}자 이내로 입력해주세요. (현재 ${n.length}자)`;
    if (!s) return '한줄 소개(또는 캐릭터 느낌)를 입력해주세요.';
    const metaMsg = validateRequiredMeta();
    if (metaMsg) return metaMsg;
    if (!imageFile && !uploadedImageUrl) return '대표 이미지를 넣어주세요.';
    return '';
  };

  const normalizeAiModel = (m) => {
    const v = String(m || '').trim().toLowerCase();
    if (v === 'gpt') return 'gpt';
    if (v === 'gemini') return 'gemini';
    // ✅ 방어: 운영/로컬 환경에서 Claude 키/권한 이슈로 500이 나면 자동생성이 전부 막힌다.
    // - 유저 설정이 애매하거나 비어있을 때는 gemini를 기본값으로 둬 가용성을 확보한다.
    return 'gemini';
  };

  const getAutoGenModeHint = (typeLabel, { isDescription = false } = {}) => {
    // typeLabel: '시뮬레이션' | '롤플레잉'
    const mode = (typeLabel === '시뮬레이션' ? 'simulator' : 'roleplay');
    return buildAutoGenModeHint({ mode, isDescription });
  };

  /**
   * ✅ 이름/한줄소개 자동생성(덮어쓰기 허용 + 경고 모달)
   *
   * 의도/원리:
   * - 자동생성 결과가 마음에 들지 않을 수 있으므로, 덮어쓰기를 허용한다.
   * - 단, 기존 입력값이 있을 때는 경고 모달을 먼저 띄워 실수로 날리는 것을 방지한다.
   */
  const handleAutoGenerateName = async ({ forceOverwrite = false } = {}) => {
    if (autoGenInFlightRef.current || autoGenLoading) return false;
    if (hasAnyText(name) && !forceOverwrite) {
      openOverwriteConfirm('name', ['작품명']);
      return false;
    }
    autoGenInFlightRef.current = true;
    setAutoGenLoading(true);
    setError('');
    try {
      /**
       * ✅ 자동생성 전 이미지 URL 준비(필수)
       *
       * 배경:
       * - 유저는 "이미지를 올린 다음" 바로 자동생성을 누른다.
       * - 그런데 업로드가 아직 끝나기 전에(=uploadedImageUrl이 비어있는 상태) 호출하면,
       *   백엔드는 이미지 분석(vision)을 못 하고 랜덤/텍스트 폴백으로 빠져 결과가 이미지와 무관해진다.
       *
       * 정책:
       * - uploadedImageUrl이 없고 imageFile이 있으면 업로드를 보장한다.
       * - 이미 background upload가 돌고 있으면 잠깐 기다린다(중복 업로드 방지).
       */
      const ensureUploadedImageUrlReady = async () => {
        try {
          const already = String(uploadedImageUrl || '').trim();
          if (already) return already;
          if (!imageFile) return '';

          // ✅ 트레이(갤러리) 업로드가 진행 중이면 그 업로드가 끝나고 대표 URL이 세팅될 때까지 기다린다.
          // - 이걸 안 하면: 업로드 중에 자동생성을 누를 때 동일 파일을 한 번 더 업로드(중복)하게 되어 매우 느려진다.
          if (imageTrayBusy) {
            const t0 = Date.now();
            while (imageTrayBusy && Date.now() - t0 < 8000) {
              await sleepMs(120);
              const u2 = String(uploadedImageUrl || '').trim();
              if (u2) return u2;
            }
            const u3 = String(uploadedImageUrl || '').trim();
            if (u3) return u3;
            // 갤러리가 생겼는데 uploadedImageUrl이 아직 비어있을 수도 있어 방어적으로 첫 번째 URL을 사용한다.
            try {
              const g0 = Array.isArray(imageTrayGallery) ? imageTrayGallery : [];
              const first = String(g0?.[0]?.url || '').trim();
              if (first) return first;
            } catch (_) {}
          }

          // background 업로드가 진행 중이면 짧게 대기
          if (autoUploadInFlightRef.current) {
            const t0 = Date.now();
            while (autoUploadInFlightRef.current && Date.now() - t0 < 8000) {
              await sleepMs(120);
              const u = String(uploadedImageUrl || '').trim();
              if (u) return u;
            }
          }

          // 아직도 없으면 여기서 직접 업로드(방어)
          const uploadRes = await filesAPI.uploadImages([imageFile]);
          const urls = Array.isArray(uploadRes?.data) ? uploadRes.data : [uploadRes?.data];
          const imgUrl = String(urls?.[0] || '').trim();
          if (imgUrl) {
            setUploadedImageUrl(imgUrl);
            return imgUrl;
          }
          return '';
        } catch (e) {
          console.error('[QuickMeetCharacterModal] ensureUploadedImageUrlReady(name) failed:', e);
          return '';
        }
      };

      const audience = selectedAudienceSlug || (REQUIRED_AUDIENCE_CHOICES[0]?.slug || '남성향');
      const style = selectedStyleSlug || (REQUIRED_STYLE_CHOICES[0]?.slug || '애니풍');
      // ✅ 위저드와 통일: quick-generate 호출의 tags는 selectedTagSlugs 전체를 전달한다.
      // - 방어: 혹시 비어있으면(상태 꼬임) 최소한 성향/스타일만 전달한다.
      const tagsForQuickGenerate = (() => {
        try {
          const arr = (Array.isArray(selectedTagSlugs) ? selectedTagSlugs : [])
            .map((x) => String(x || '').trim())
            .filter(Boolean);
          return arr.length ? arr : [audience, style];
        } catch (_) {
          return [audience, style];
        }
      })();
      const aiModel = normalizeAiModel(user?.preferred_model || 'claude');
      const typeLabel = (characterType === 'simulator' ? '시뮬레이션' : '롤플레잉');
      const chosenThemes = (profileAutoGenMode === 'select') ? getSelectedProfileThemesForCurrentMode() : [];
      const extraKeywords = (profileAutoGenMode === 'auto') ? getProfileAutoGenKeywords() : [];
      const selectedExtraTags = getSelectedExtraTagsForAutoGen();
      const fixedChips = [
        ...(Array.isArray(selectedGenres) ? selectedGenres : []),
        String(selectedType || '').trim(),
        String(selectedHook || '').trim(),
      ].filter(Boolean);
      // ✅ 요구사항: 시뮬에서는 "캐릭터 유형"이 상대(NPC)일 수도, 유저(플레이어)일 수도 있다(50:50).
      // - 모델이 알아서 가정하면 결과가 한쪽으로 쏠릴 수 있으므로, 요청마다 1회 랜덤으로 명시한다.
      const simTypeRole = (characterType === 'simulator')
        ? ((Math.random() < 0.5) ? '유저' : '상대')
        : '';
      const imgUrl = profileAutoGenUseImage ? await ensureUploadedImageUrlReady() : '';
      const prevAutoName = String(lastAutoGeneratedNameRef.current || '').trim();
      const nonce = (() => {
        try { return `${Date.now()}_${Math.random().toString(16).slice(2, 8)}`; } catch (_) { return String(Date.now()); }
      })();

      const seedBase = [
        `랜덤 시드: ${nonce}`,
        prevAutoName ? `직전 생성된 작품명(중복 금지): ${prevAutoName}` : null,
        prevAutoName ? '중요: 이번에는 위 작품명과 "절대" 같은 작품명을 쓰지 마. 완전히 다른 이름으로 새로 만들어.' : null,
        getAutoGenModeHint(typeLabel, { isDescription: false }),
        (characterType === 'simulator' && simDatingElements) ? QUICK_MEET_SIM_DATING_PRO_WRITER_LINE : null,
        '아무 입력이 없어도 캐릭터챗에 적합한 오리지널 캐릭터를 랜덤으로 만들어줘.',
        '출력은 작품명(name)만. 대사/지문/부가 문구는 절대 포함하지 마.',
        // ✅ 시뮬 vs RP: 작품명만 생성 시에도 한줄소개를 먼저 머릿속으로 구상 후 제목
        characterType === 'simulator'
          ? [
              `[생성 순서] 머릿속으로 한줄소개(세계관, 상황, 규칙, 유저 역할)를 먼저 구상한 뒤, 그것을 바탕으로 작품명을 지어라.`,
              `[작품명 역할·시뮬] 크랙/바베챗 인기 시뮬 크리에이터로서 제목을 지어라. 세계관/장소/시스템/상황이 제목에서 바로 보여야 함. 캐릭터 이름보다 "어디서/무엇을" 하는지가 핵심. 짧고 직관적, 밈/구어체 허용.`,
              `- 길이: ${PROFILE_NAME_MIN_LEN}~${PROFILE_NAME_MAX_LEN}자, 따옴표/마침표/이모지 금지`,
            ].join('\n')
          : (useSentenceStyleName
            ? [
                `[생성 순서] 머릿속으로 한줄소개(캐릭터 고유 이름, 상황, 갈등)를 먼저 구상한 뒤, 그 이름을 포함한 작품명을 지어라. 종족/직업명 대체 금지.`,
                `[작품명 역할] 너는 노벨피아/카카오페이지 베테랑 웹소설 작가다. 반전/떡밥을 밈·가십 톤으로 함축해 제목을 지어라. 필수: 반말 구어체 종결(~함, ~임, ~됨, ~해버림, ~인데, ~했음, ~음). 금지: 문학체(~하다/~이다/~지다), 명사 종결.`,
                `- 길이: ${PROFILE_NAME_MIN_LEN}~${PROFILE_NAME_MAX_LEN}자, 따옴표/마침표/이모지 금지`,
              ].join('\n')
            : [
                `[생성 순서] 머릿속으로 한줄소개(캐릭터 고유 이름, 상황, 갈등)를 먼저 구상한 뒤, 그 이름을 포함한 작품명을 지어라. 종족/직업명 대체 금지.`,
                `[작품명 역할] 너는 캐릭터챗 인기 크리에이터다. 클릭을 부르는 제목을 지어라. 캐릭터 고유 이름 포함 필수. 스타일은 65%는 짧고 강한 형태(이름+수식어/상황), 35%는 웹소설 밈 톤 문장형(반말 구어체 ~함/~됨/~인데/~해버림 종결) 중 자연스럽게 선택.`,
                `- 길이: ${PROFILE_NAME_MIN_LEN}~${PROFILE_NAME_MAX_LEN}자, 따옴표/마침표/이모지 금지`,
              ].join('\n')
          ),
        ...(chosenThemes.length > 0
          ? [
            `선택한 소재 태그(우선 반영): ${chosenThemes.join(', ')}`,
            '선택한 소재 태그 중 1~2개를 핵심 소재로 작품명에 반드시 반영하라. (나열 금지, 제목에 자연스럽게 녹여라)',
          ]
          : []),
        ...(extraKeywords.length > 0
          ? [
            `추가 키워드(가능하면 반영): ${extraKeywords.join(', ')}`,
            '추가 키워드 중 1~2개를 핵심 소재로 작품명에 반드시 반영하라. (키워드 나열 금지, 제목에 자연스럽게 녹여라)',
          ]
          : []),
        ...(selectedExtraTags.length > 0
          ? [
            `선택한 태그(소재): ${selectedExtraTags.join(', ')}`,
            '선택한 태그 중 1~2개는 작품명에 반드시 자연스럽게 녹여라. (나열 금지)',
          ]
          : []),
        ...(fixedChips.length > 0
          ? [
            ...(Array.isArray(selectedGenres) && selectedGenres.length > 0 ? [`선택한 장르(필수): ${selectedGenres.join(', ')}`] : []),
            (String(selectedType || '').trim() ? `선택한 캐릭터 유형(필수): ${String(selectedType || '').trim()}` : null),
            (String(selectedHook || '').trim() ? `선택한 훅/행동/소재(필수): ${String(selectedHook || '').trim()}` : null),
            `고정 선택(장르/유형/훅): ${fixedChips.join(', ')}`,
            '중요: 장르/캐릭터유형/훅(소재) 각 카테고리에서 최소 1개는 작품명 또는 한줄소개에 반드시 반영하라. (키워드 나열 금지)',
            '고정 선택 중 1~2개는 작품명에 반드시 자연스럽게 녹여라. (나열 금지)',
          ]
          : []),
        `성향: ${audience}`,
        `이미지 스타일: ${style}`,
        `프롬프트 타입: ${typeLabel}`,
        (simTypeRole ? `시뮬 캐릭터 유형 적용 대상(50:50): ${simTypeRole}` : null),
        (simTypeRole ? '규칙: 시뮬에서 선택한 "캐릭터 유형"은 위 적용 대상(유저/상대)의 직업/신분/종족/클래스 등을 뜻한다. 제목/한줄소개에 구체 명사로 반영해라.' : null),
        (characterType === 'simulator' ? '중요(시뮬 목표): 작품명/한줄소개에 "목표 1개"가 반드시 명확히 드러나야 한다. (예: 돈/구원/보호/생존/탈출/범인추론 등)' : null),
        `분량(진행 턴수): ${maxTurns}턴`,
      ].filter(Boolean);

      const callOnce = async (extraLine = '') => {
        const seed = buildSeedWithinLimit([...seedBase, ...(extraLine ? [extraLine] : [])], 1900);
        return await charactersAPI.quickGenerateCharacterDraft({
          name: '캐릭터',
          seed_text: seed,
          image_url: (profileAutoGenUseImage && imgUrl ? (resolveImageUrl(imgUrl) || imgUrl) : null),
          tags: tagsForQuickGenerate,
          // ✅ SSOT: 유저가 고른 모드(롤플/시뮬)를 서버에 명시 전달(quick-generate의 키워드 추정 제거)
          character_type: (String(characterType || 'roleplay').toLowerCase() === 'simulator') ? 'simulator' : 'roleplay',
          ai_model: aiModel,
        });
      };

      // ✅ 절대 slice로 자르지 않는다: 초과 시 1회 재시도 → 그래도 초과면 에러 처리
      let res = await callOnce('');
      upsertVisionChipKeywordsFromDraft(res?.data);
      const bi = res?.data?.basic_info || {};
      let next = String(bi?.name || '').trim();
      if (!next) throw new Error('name_missing');
      if (next.length < PROFILE_NAME_MIN_LEN || next.length > PROFILE_NAME_MAX_LEN) {
        // ✅ 위저드와 동일 규칙: 작품명은 SSOT 범위여야 한다.
        // - slice로 잘라서 통과시키지 않고 "재생성"으로 처리해 품질/일관성을 유지한다.
        const regenRule = `중요: 작품명(name)은 반드시 ${PROFILE_NAME_MIN_LEN}~${PROFILE_NAME_MAX_LEN}자 범위여야 한다. 이 범위를 벗어나면 다시 생성해라.`;
        res = await callOnce(regenRule);
        upsertVisionChipKeywordsFromDraft(res?.data);
        const bi2 = res?.data?.basic_info || {};
        next = String(bi2?.name || '').trim();
        if (!next) throw new Error('name_missing');
      }
      if (next.length < PROFILE_NAME_MIN_LEN) {
        throw new Error('name_too_short');
      }
      if (next.length > PROFILE_NAME_MAX_LEN) {
        throw new Error('name_too_long');
      }
      lastAutoGeneratedNameRef.current = next;
      setName(next);
      return true;
    } catch (e) {
      console.error('[QuickMeetCharacterModal] auto-generate name failed:', e);
      const detailRaw = e?.response?.data?.detail ?? e?.message ?? '알 수 없는 오류';
      const detail = stringifyApiDetail(detailRaw);
      const msg = (String(detail || '') === 'name_too_long')
        ? `작품명이 ${PROFILE_NAME_MAX_LEN}자를 초과했습니다. 다시 시도해주세요.`
        : (String(detail || '') === 'name_too_short')
          ? `작품명이 너무 짧게 생성되었습니다. (${PROFILE_NAME_MIN_LEN}~${PROFILE_NAME_MAX_LEN}자 범위로 다시 시도해주세요.)`
        : `작품명 자동생성 실패: ${detail}`;
      dispatchToast('error', msg);
      return false;
    } finally {
      autoGenInFlightRef.current = false;
      setAutoGenLoading(false);
    }
  };

  const handleAutoGenerateOneLine = async ({ forceOverwrite = false, nameOverride } = {}) => {
    if (autoGenInFlightRef.current || autoGenLoading) return false;
    if (hasAnyText(seedText) && !forceOverwrite) {
      openOverwriteConfirm('oneLine', ['한줄소개']);
      return false;
    }
    // ✅ 요구사항: 한줄소개는 "작품명"이 확정된 뒤에 생성한다.
    const nameForOneLine = hasAnyText(nameOverride) ? String(nameOverride).trim() : String(name || '').trim();
    if (!hasAnyText(nameForOneLine)) {
      dispatchToast('error', '작품명을 먼저 입력/자동생성해주세요.');
      return false;
    }
    autoGenInFlightRef.current = true;
    setAutoGenLoading(true);
    setError('');
    try {
      const ensureUploadedImageUrlReady = async () => {
        try {
          const already = String(uploadedImageUrl || '').trim();
          if (already) return already;
          if (!imageFile) return '';

          // ✅ 트레이(갤러리) 업로드가 진행 중이면 중복 업로드를 하지 말고 기다린다.
          if (imageTrayBusy) {
            const t0 = Date.now();
            while (imageTrayBusy && Date.now() - t0 < 8000) {
              await sleepMs(120);
              const u2 = String(uploadedImageUrl || '').trim();
              if (u2) return u2;
            }
            const u3 = String(uploadedImageUrl || '').trim();
            if (u3) return u3;
            try {
              const g0 = Array.isArray(imageTrayGallery) ? imageTrayGallery : [];
              const first = String(g0?.[0]?.url || '').trim();
              if (first) return first;
            } catch (_) {}
          }

          if (autoUploadInFlightRef.current) {
            const t0 = Date.now();
            while (autoUploadInFlightRef.current && Date.now() - t0 < 8000) {
              await sleepMs(120);
              const u = String(uploadedImageUrl || '').trim();
              if (u) return u;
            }
          }
          const uploadRes = await filesAPI.uploadImages([imageFile]);
          const urls = Array.isArray(uploadRes?.data) ? uploadRes.data : [uploadRes?.data];
          const imgUrl = String(urls?.[0] || '').trim();
          if (imgUrl) {
            setUploadedImageUrl(imgUrl);
            return imgUrl;
          }
          return '';
        } catch (e) {
          console.error('[QuickMeetCharacterModal] ensureUploadedImageUrlReady(oneLine) failed:', e);
          return '';
        }
      };

      const audience = selectedAudienceSlug || (REQUIRED_AUDIENCE_CHOICES[0]?.slug || '남성향');
      const style = selectedStyleSlug || (REQUIRED_STYLE_CHOICES[0]?.slug || '애니풍');
      // ✅ 위저드와 통일: quick-generate 호출의 tags는 selectedTagSlugs 전체를 전달한다.
      // - 방어: 혹시 비어있으면(상태 꼬임) 최소한 성향/스타일만 전달한다.
      const tagsForQuickGenerate = (() => {
        try {
          const arr = (Array.isArray(selectedTagSlugs) ? selectedTagSlugs : [])
            .map((x) => String(x || '').trim())
            .filter(Boolean);
          return arr.length ? arr : [audience, style];
        } catch (_) {
          return [audience, style];
        }
      })();
      const aiModel = normalizeAiModel(user?.preferred_model || 'claude');
      const typeLabel = (characterType === 'simulator' ? '시뮬레이션' : '롤플레잉');
      const chosenThemes = (profileAutoGenMode === 'select') ? getSelectedProfileThemesForCurrentMode() : [];
      const extraKeywords = (profileAutoGenMode === 'auto') ? getProfileAutoGenKeywords() : [];
      const selectedExtraTags = getSelectedExtraTagsForAutoGen();
      const fixedChips = [
        ...(Array.isArray(selectedGenres) ? selectedGenres : []),
        String(selectedType || '').trim(),
        String(selectedHook || '').trim(),
      ].filter(Boolean);
      const simTypeRole = (characterType === 'simulator')
        ? ((Math.random() < 0.5) ? '유저' : '상대')
        : '';
      const imgUrl = profileAutoGenUseImage ? await ensureUploadedImageUrlReady() : '';

      const seed = [
        `랜덤 시드: ${Date.now()}`,
        getAutoGenModeHint(typeLabel, { isDescription: true }),
        (lastAutoGeneratedOneLineRef.current && !forceOverwrite)
          ? `중복 방지(중요): 직전 한줄소개와 동일/유사한 단어/전개를 반복하지 마라. 특히 반복 금지: "${String(lastAutoGeneratedOneLineRef.current).slice(0, 120)}"`
          : null,
        `작품명(name): ${nameForOneLine}`,
        ...(chosenThemes.length > 0
          ? [
            `선택한 소재 태그(우선 반영): ${chosenThemes.join(', ')}`,
            '선택한 소재 태그 중 1~2개를 핵심 소재로 한줄소개에 반드시 반영하라. (키워드 나열 금지)',
          ]
          : []),
        ...(extraKeywords.length > 0
          ? [
            `추가 키워드(가능하면 반영): ${extraKeywords.join(', ')}`,
            '추가 키워드 중 1~2개를 핵심 소재로 한줄소개에 반드시 반영하라. (키워드 나열 금지)',
          ]
          : []),
        ...(selectedExtraTags.length > 0
          ? [
            `선택한 태그(소재): ${selectedExtraTags.join(', ')}`,
            '선택한 태그 중 1~2개는 한줄소개에 반드시 자연스럽게 녹여라. (나열 금지)',
          ]
          : []),
        ...(fixedChips.length > 0
          ? [
            ...(Array.isArray(selectedGenres) && selectedGenres.length > 0 ? [`선택한 장르(필수): ${selectedGenres.join(', ')}`] : []),
            (String(selectedType || '').trim() ? `선택한 캐릭터 유형(필수): ${String(selectedType || '').trim()}` : null),
            (String(selectedHook || '').trim() ? `선택한 훅/행동/소재(필수): ${String(selectedHook || '').trim()}` : null),
            `고정 선택(장르/유형/훅): ${fixedChips.join(', ')}`,
            '중요: 장르/캐릭터유형/훅(소재) 각 카테고리에서 최소 1개는 작품명 또는 한줄소개에 반드시 반영하라. (키워드 나열 금지)',
            '고정 선택 중 1~2개를 한줄소개에 반드시 자연스럽게 녹여라. (나열 금지)',
          ]
          : []),
        '아무 입력이 없어도 캐릭터챗에 적합한 오리지널 캐릭터를 랜덤으로 만들어줘.',
        '출력은 한줄소개(description)만. 대사/지문/첫대사/대화 시작 문구/키워드 목록은 절대 포함하지 마.',
        `한줄소개(description)는 "대사"가 아니라 소개 문장이다. 4~5문장, ${PROFILE_ONE_LINE_MIN_LEN}~${PROFILE_ONE_LINE_MAX_LEN}자, 줄바꿈 금지.`,
        '문장 끝은 마침표로 끝내라. (문장 수 검증을 위해 중요)',
        `성향: ${audience}`,
        `이미지 스타일: ${style}`,
        `프롬프트 타입: ${typeLabel}`,
        (simTypeRole ? `시뮬 캐릭터 유형 적용 대상(50:50): ${simTypeRole}` : null),
        (simTypeRole ? '규칙: 시뮬에서 선택한 "캐릭터 유형"은 위 적용 대상(유저/상대)의 직업/신분/종족/클래스 등을 뜻한다. 한줄소개에 구체 명사로 반영해라.' : null),
        (characterType === 'simulator' ? '중요(시뮬 목표): 한줄소개에는 "목표 1개"가 반드시 명확히 드러나야 한다. (예: 돈/구원/보호/생존/탈출/범인추론 등)' : null),
        `분량(진행 턴수): ${maxTurns}턴`,
      ];

      const callOnce = async (extraLine = '') => {
        const seed2 = buildSeedWithinLimit([...seed, ...(extraLine ? [extraLine] : [])], 1900);
        return await charactersAPI.quickGenerateCharacterDraft({
          name: hasAnyText(nameForOneLine) ? nameForOneLine : '캐릭터',
          seed_text: seed2,
          image_url: (profileAutoGenUseImage && imgUrl ? (resolveImageUrl(imgUrl) || imgUrl) : null),
          tags: tagsForQuickGenerate,
          // ✅ SSOT: 유저가 고른 모드(롤플/시뮬)를 서버에 명시 전달
          character_type: (String(characterType || 'roleplay').toLowerCase() === 'simulator') ? 'simulator' : 'roleplay',
          ai_model: aiModel,
        });
      };

      let res = await callOnce('');
      upsertVisionChipKeywordsFromDraft(res?.data);
      const bi = res?.data?.basic_info || {};
      let raw = String(bi?.description || '').trim();
      raw = raw.replace(/\s*\n+\s*/g, ' ').trim();
      let next = raw.length > PROFILE_ONE_LINE_MAX_LEN ? raw.slice(0, PROFILE_ONE_LINE_MAX_LEN) : raw;
      next = (characterType === 'simulator')
        ? stripBadGuidePhrasesOnly(next, { minLen: PROFILE_ONE_LINE_MIN_LEN })
        : stripMetaFromOneLine(next, { minLen: PROFILE_ONE_LINE_MIN_LEN });
      if (!next) throw new Error('one_line_missing');

      if (next.length < PROFILE_ONE_LINE_MIN_LEN) {
        // ✅ slice로 억지로 늘릴 수 없으니, 1회 재생성으로 길이/형식 강제
        const regenRule = `중요: 한줄소개(description)는 반드시 ${PROFILE_ONE_LINE_MIN_LEN}~${PROFILE_ONE_LINE_MAX_LEN}자 범위여야 한다. 4~5문장, 문장 끝은 마침표. 줄바꿈 금지. 이 범위를 벗어나면 다시 생성해라.`;
        res = await callOnce(regenRule);
        upsertVisionChipKeywordsFromDraft(res?.data);
        const bi2 = res?.data?.basic_info || {};
        raw = String(bi2?.description || '').trim().replace(/\s*\n+\s*/g, ' ').trim();
        next = raw.length > PROFILE_ONE_LINE_MAX_LEN ? raw.slice(0, PROFILE_ONE_LINE_MAX_LEN) : raw;
        next = (characterType === 'simulator')
          ? stripBadGuidePhrasesOnly(next, { minLen: PROFILE_ONE_LINE_MIN_LEN })
          : stripMetaFromOneLine(next, { minLen: PROFILE_ONE_LINE_MIN_LEN });
      }
      if (!next) throw new Error('one_line_missing');
      if (next.length < PROFILE_ONE_LINE_MIN_LEN) throw new Error('one_line_too_short');
      // ✅ 요구사항: 4~5문장 강제(1회 보정)
      const sc = (characterType === 'simulator')
        ? countSentencesRoughKo(extractSimulatorBodyForSentenceCount(next) || next)
        : countSentencesRoughKo(next);
      const wantsCta = characterType === 'simulator';
      const hasCta = wantsCta ? hasSimulatorCtaLine(next) : true;
      const hasMeta = wantsCta ? hasSimulatorBracketMetaAtStart(next) : true;
      if (sc < 4 || sc > 5 || !hasCta || !hasMeta) {
        const regenRule2 = (characterType === 'simulator')
          ? `중요: 한줄소개(description)는 시뮬레이션(게임) 소개다. 반드시 시작 부분에 대괄호 메타([ ... ]) 1개를 포함하라(진행 턴수/모드/핵심 시스템 요약). 또한 "유저가 어떤 플레이를 하게 되는지"가 바로 보이도록 시스템/안내/명령 톤 문장을 최소 1문장 포함하라(존댓말 가능). 마지막으로 서술 본문은 4~5문장(문장 끝 마침표). 같은 문장 패턴을 반복하지 말고 다양하게 작성하라. (${PROFILE_ONE_LINE_MIN_LEN}~${PROFILE_ONE_LINE_MAX_LEN}자, 줄바꿈 금지)`
          : `중요: 한줄소개(description)는 반드시 4~5문장이어야 한다. 문장 끝은 마침표로 끝내라. (${PROFILE_ONE_LINE_MIN_LEN}~${PROFILE_ONE_LINE_MAX_LEN}자, 줄바꿈 금지)`;
        const res2 = await callOnce(regenRule2);
        upsertVisionChipKeywordsFromDraft(res2?.data);
        const bi3 = res2?.data?.basic_info || {};
        let raw2 = String(bi3?.description || '').trim().replace(/\s*\n+\s*/g, ' ').trim();
        let next2 = raw2.length > PROFILE_ONE_LINE_MAX_LEN ? raw2.slice(0, PROFILE_ONE_LINE_MAX_LEN) : raw2;
        next2 = (characterType === 'simulator')
          ? stripBadGuidePhrasesOnly(next2, { minLen: PROFILE_ONE_LINE_MIN_LEN })
          : stripMetaFromOneLine(next2, { minLen: PROFILE_ONE_LINE_MIN_LEN });
        const sc2 = (characterType === 'simulator')
          ? countSentencesRoughKo(extractSimulatorBodyForSentenceCount(next2) || next2)
          : countSentencesRoughKo(next2);
        const hasCta2 = (characterType === 'simulator') ? hasSimulatorCtaLine(next2) : true;
        const hasMeta2 = (characterType === 'simulator') ? hasSimulatorBracketMetaAtStart(next2) : true;
        if (next2 && next2.length >= PROFILE_ONE_LINE_MIN_LEN && sc2 >= 4 && sc2 <= 5 && hasCta2 && hasMeta2) {
          next = next2;
        }
      }
      const finalText = (characterType === 'simulator')
        ? normalizeSimulatorDescription(next, {
          maxLen: oneLineMaxLen,
          maxTurns,
          audience,
          style,
          fixedChips,
          chosenThemes,
          extraKeywords,
        })
        : next;
      setSeedText(finalText);
      lastAutoGeneratedOneLineRef.current = finalText;
      return true;
    } catch (e) {
      console.error('[QuickMeetCharacterModal] auto-generate one-line failed:', e);
      const msg = (() => {
        const m = String(e?.message || '');
        if (m === 'one_line_too_short') return `한줄소개가 너무 짧게 생성되었습니다. (${PROFILE_ONE_LINE_MIN_LEN}~${PROFILE_ONE_LINE_MAX_LEN}자 범위로 다시 시도해주세요.)`;
        if (m === 'one_line_missing') return '한줄 소개 자동생성 결과가 비어있습니다. 잠시 후 다시 시도해주세요.';
        const detailRaw = e?.response?.data?.detail ?? e?.message ?? '알 수 없는 오류';
        return stringifyApiDetail(detailRaw);
      })();
      dispatchToast('error', `한줄 소개 자동생성 실패: ${msg}`);
      return false;
    } finally {
      autoGenInFlightRef.current = false;
      setAutoGenLoading(false);
    }
  };

  const handleAutoGenerateProfile = async ({ forceOverwrite = false } = {}) => {
    /**
     * ✅ 위저드 UX처럼 "프로필(작품명/한줄소개) 한 번에 자동생성"
     *
     * 의도/원리:
     * - 30초 생성 모달에서도 작품명/한줄소개 자동생성을 1개 버튼으로 묶어 UX를 단순화한다.
     * - 기존 구현은 내부적으로 2번 호출(작품명→한줄소개)이라 느릴 수 있다.
     * - 위저드처럼 1회 호출로 name+description을 함께 받아 왕복 횟수를 줄인다.
     *
     * 방어:
     * - 기존 입력값이 있으면 덮어쓰기 경고 모달을 선행한다(실수 방지).
     */
    try {
      if (autoGenInFlightRef.current || autoGenLoading || generating) return;
      setError('');

      // ✅ 장르/캐릭터유형/소재 필수 검증 (프로필 자동생성에도 적용)
      // - 에러 시 상단 Alert 대신 해당 패널을 열고 인라인 에러 표시
      const metaMsg = validateRequiredMeta();
      if (metaMsg) {
        setError(metaMsg);
        // 해당 패널 자동 오픈
        if (metaMsg.includes('장르')) {
          setChipPanelsOpen((prev) => ({ ...(prev || {}), genre: true }));
        } else if (metaMsg.includes('캐릭터 유형')) {
          setChipPanelsOpen((prev) => ({ ...(prev || {}), type: true }));
        } else if (metaMsg.includes('소재')) {
          setChipPanelsOpen((prev) => ({ ...(prev || {}), hook: true }));
        }
        return;
      }

      if (!forceOverwrite) {
        const targets = [];
        if (hasAnyText(name)) targets.push('작품명');
        if (hasAnyText(seedText)) targets.push('한줄소개');
        if (targets.length > 0) {
          openOverwriteConfirm('profile', targets);
          return;
        }
      }

      autoGenInFlightRef.current = true;
      setAutoGenLoading(true);
      setError('');

      /**
       * ✅ 자동생성 전 이미지 URL 준비(선택)
       *
       * - "이미지 정보 포함" 토글 ON일 때만 업로드/대기를 수행한다.
       * - 이미지가 없어도 자동생성은 동작해야 하므로 실패 시 빈 값 폴백.
       */
      const ensureUploadedImageUrlReady = async () => {
        try {
          const already = String(uploadedImageUrl || '').trim();
          if (already) return already;
          if (!imageFile) return '';

          if (imageTrayBusy) {
            const t0 = Date.now();
            while (imageTrayBusy && Date.now() - t0 < 8000) {
              await sleepMs(120);
              const u2 = String(uploadedImageUrl || '').trim();
              if (u2) return u2;
            }
            const u3 = String(uploadedImageUrl || '').trim();
            if (u3) return u3;
            try {
              const g0 = Array.isArray(imageTrayGallery) ? imageTrayGallery : [];
              const first = String(g0?.[0]?.url || '').trim();
              if (first) return first;
            } catch (_) {}
          }

          if (autoUploadInFlightRef.current) {
            const t0 = Date.now();
            while (autoUploadInFlightRef.current && Date.now() - t0 < 8000) {
              await sleepMs(120);
              const u = String(uploadedImageUrl || '').trim();
              if (u) return u;
            }
          }

          const uploadRes = await filesAPI.uploadImages([imageFile]);
          const urls = Array.isArray(uploadRes?.data) ? uploadRes.data : [uploadRes?.data];
          const imgUrl = String(urls?.[0] || '').trim();
          if (imgUrl) {
            setUploadedImageUrl(imgUrl);
            return imgUrl;
          }
          return '';
        } catch (e) {
          console.error('[QuickMeetCharacterModal] ensureUploadedImageUrlReady(profile) failed:', e);
          return '';
        }
      };

      const audience = selectedAudienceSlug || (REQUIRED_AUDIENCE_CHOICES[0]?.slug || '남성향');
      const style = selectedStyleSlug || (REQUIRED_STYLE_CHOICES[0]?.slug || '애니풍');
      // ✅ 위저드와 통일: quick-generate 호출의 tags는 selectedTagSlugs 전체를 전달한다.
      // - 방어: 혹시 비어있으면(상태 꼬임) 최소한 성향/스타일만 전달한다.
      const tagsForQuickGenerate = (() => {
        try {
          const arr = (Array.isArray(selectedTagSlugs) ? selectedTagSlugs : [])
            .map((x) => String(x || '').trim())
            .filter(Boolean);
          return arr.length ? arr : [audience, style];
        } catch (_) {
          return [audience, style];
        }
      })();
      const aiModel = normalizeAiModel(user?.preferred_model || 'claude');
      const typeLabel = (characterType === 'simulator' ? '시뮬레이션' : '롤플레잉');
      const chosenThemes = (profileAutoGenMode === 'select') ? getSelectedProfileThemesForCurrentMode() : [];
      const extraKeywords = (profileAutoGenMode === 'auto') ? getProfileAutoGenKeywords() : [];
      const selectedExtraTags = getSelectedExtraTagsForAutoGen();
      const fixedChips = [
        ...(Array.isArray(selectedGenres) ? selectedGenres : []),
        String(selectedType || '').trim(),
        String(selectedHook || '').trim(),
      ].filter(Boolean);
      const simTypeRole = (characterType === 'simulator')
        ? ((Math.random() < 0.5) ? '유저' : '상대')
        : '';
      const imgUrl = profileAutoGenUseImage ? await ensureUploadedImageUrlReady() : '';
      const prevAutoName = String(lastAutoGeneratedNameRef.current || '').trim();
      const nonce = (() => {
        try { return `${Date.now()}_${Math.random().toString(16).slice(2, 8)}`; } catch (_) { return String(Date.now()); }
      })();

      const seedBase = [
        `랜덤 시드: ${nonce}`,
        prevAutoName ? `직전 생성된 작품명(중복 금지): ${prevAutoName}` : null,
        prevAutoName ? '중요: 이번에는 위 작품명과 "절대" 같은 작품명을 쓰지 마. 완전히 다른 이름으로 새로 만들어.' : null,
        getAutoGenModeHint(typeLabel, { isDescription: true }),
        (characterType === 'simulator' && simDatingElements) ? QUICK_MEET_SIM_DATING_PRO_WRITER_LINE : null,
        '아무 입력이 없어도 캐릭터챗에 적합한 오리지널 캐릭터를 랜덤으로 만들어줘.',
        '출력은 작품명(name) + 한줄소개(description)만. 대사/지문/부가 문구는 절대 포함하지 마.',
        // ✅ 시뮬 vs RP: 생성 순서/제목 역할 분기
        characterType === 'simulator'
          ? `[생성 순서] 한줄소개(description)를 먼저 완성하라. 세계관·상황·규칙을 확정한 뒤, 그것을 바탕으로 작품명(name)을 지어라.`
          : `[생성 순서] 한줄소개(description)를 먼저 완성하라. 캐릭터 고유 이름·상황·갈등을 확정한 뒤, 그 내용을 바탕으로 작품명(name)을 지어라.`,
        `한줄소개(description)는 4~5문장, ${PROFILE_ONE_LINE_MIN_LEN}~${PROFILE_ONE_LINE_MAX_LEN}자, 줄바꿈 금지.`,
        characterType === 'simulator'
          ? `[작품명 역할·시뮬] 크랙/바베챗 인기 시뮬 크리에이터로서 제목을 지어라. 세계관/장소/시스템/상황이 제목에서 바로 보여야 함. 캐릭터 이름보다 "어디서/무엇을" 하는지가 핵심. 짧고 직관적, 밈/구어체 허용. ${PROFILE_NAME_MIN_LEN}~${PROFILE_NAME_MAX_LEN}자.`
          : `작품명(name)에는 한줄소개의 캐릭터 고유 이름이 반드시 포함. 종족/직업명 대체 금지. ${PROFILE_NAME_MIN_LEN}~${PROFILE_NAME_MAX_LEN}자.`,
        // ✅ RP 전용: 문장형 토글 분기 (시뮬은 위에서 처리됨)
        characterType !== 'simulator' ? (useSentenceStyleName
          ? `[작품명 역할] 너는 노벨피아/카카오페이지 베테랑 웹소설 작가다. 한줄소개의 반전/떡밥을 밈·가십 톤으로 함축해 제목을 지어라. 필수: 반말 구어체 종결(~함, ~임, ~됨, ~해버림, ~인데, ~했음, ~라는데, ~음). 금지: 문학체(~하다/~이다/~지다), 명사 종결.`
          : `[작품명 역할] 너는 캐릭터챗 인기 크리에이터다. 한줄소개를 요약해 클릭을 부르는 제목을 지어라. 캐릭터 고유 이름 포함 필수. 스타일은 65%는 짧고 강한 형태(이름+수식어/상황), 35%는 웹소설 밈 톤 문장형(반말 구어체 ~함/~됨/~인데/~해버림 종결) 중 자연스럽게 선택.`
        ) : null,
        ...(chosenThemes.length > 0
          ? [
            `선택한 소재 태그(우선 반영): ${chosenThemes.join(', ')}`,
            '선택한 소재 태그 중 1~2개를 핵심 소재로 작품명/한줄소개에 반드시 반영하라. (키워드 나열 금지)',
          ]
          : []),
        ...(extraKeywords.length > 0
          ? [
            `추가 키워드(가능하면 반영): ${extraKeywords.join(', ')}`,
            '추가 키워드 중 1~2개를 작품명/한줄소개에 자연스럽게 반영하라. (키워드 나열 금지)',
          ]
          : []),
        ...(selectedExtraTags.length > 0
          ? [
            `선택한 태그(소재): ${selectedExtraTags.join(', ')}`,
            '선택한 태그 중 1~2개를 작품명/한줄소개에 반드시 자연스럽게 녹여라. (나열 금지)',
          ]
          : []),
        ...(fixedChips.length > 0
          ? [
            ...(Array.isArray(selectedGenres) && selectedGenres.length > 0 ? [`선택한 장르(필수): ${selectedGenres.join(', ')}`] : []),
            (String(selectedType || '').trim() ? `선택한 캐릭터 유형(필수): ${String(selectedType || '').trim()}` : null),
            (String(selectedHook || '').trim() ? `선택한 훅/행동/소재(필수): ${String(selectedHook || '').trim()}` : null),
            `고정 선택(장르/유형/훅): ${fixedChips.join(', ')}`,
            '중요: 장르/캐릭터유형/훅(소재) 각 카테고리에서 최소 1개는 작품명 또는 한줄소개에 반드시 반영하라. (키워드 나열 금지)',
            '고정 선택 중 1~2개를 작품명/한줄소개에 반드시 자연스럽게 녹여라. (나열 금지)',
          ]
          : []),
        `성향: ${audience}`,
        `이미지 스타일: ${style}`,
        `프롬프트 타입: ${typeLabel}`,
        (simTypeRole ? `시뮬 캐릭터 유형 적용 대상(50:50): ${simTypeRole}` : null),
        (simTypeRole ? '규칙: 시뮬에서 선택한 "캐릭터 유형"은 위 적용 대상(유저/상대)의 직업/신분/종족/클래스 등을 뜻한다. 작품명/한줄소개에 구체 명사로 반영해라.' : null),
        (characterType === 'simulator' ? '중요(시뮬 목표): 작품명/한줄소개에 "목표 1개"가 반드시 명확히 드러나야 한다. (예: 돈/구원/보호/생존/탈출/범인추론 등)' : null),
        `분량(진행 턴수): ${maxTurns}턴`,
      ];

      const seed = buildSeedWithinLimit(seedBase, 1900);
      // ✅ 요구사항: 프론트 28초 하드 타임아웃 제거(서버 응답을 그대로 대기)
      const res = await charactersAPI.quickGenerateCharacterDraft({
        // 백엔드 스키마 상 필수지만 실제 생성은 seed_text로 유도됨(방어용 placeholder)
        name: '캐릭터',
        seed_text: seed,
        image_url: (profileAutoGenUseImage && imgUrl ? (resolveImageUrl(imgUrl) || imgUrl) : null),
        tags: tagsForQuickGenerate,
        // ✅ SSOT: 유저가 고른 모드(롤플/시뮬)를 서버에 명시 전달
        character_type: (String(characterType || 'roleplay').toLowerCase() === 'simulator') ? 'simulator' : 'roleplay',
        ai_model: aiModel,
      });

      upsertVisionChipKeywordsFromDraft(res?.data);
      const bi = res?.data?.basic_info || {};
      // ✅ 이름 일치 보정 로직에서 교체가 발생할 수 있으므로 let 사용(상수 재할당 런타임 크래시 방지)
      let nextName = String(bi?.name || '').trim();
      const nextDescRaw = String(bi?.description || '').trim().replace(/\s*\n+\s*/g, ' ').trim();
      let nextDesc = (characterType === 'simulator')
        ? stripBadGuidePhrasesOnly(nextDescRaw, { minLen: PROFILE_ONE_LINE_MIN_LEN })
        : stripMetaFromOneLine(nextDescRaw, { minLen: PROFILE_ONE_LINE_MIN_LEN });
      if (!nextName) throw new Error('name_missing');
      if (!nextDesc) throw new Error('one_line_missing');
      if (nextName.length < PROFILE_NAME_MIN_LEN || nextName.length > PROFILE_NAME_MAX_LEN) {
        throw new Error('name_length_invalid');
      }
      if (nextDesc.length < PROFILE_ONE_LINE_MIN_LEN || nextDesc.length > PROFILE_ONE_LINE_MAX_LEN) {
        throw new Error('one_line_length_invalid');
      }

      // ✅ 이름 일치 보정: RP 전용 (시뮬은 제목에 캐릭터 이름이 필수가 아니므로 스킵)
      // - AI가 description → name 순서로 생성하더라도 이름이 불일치하는 경우 방어
      try {
        if (characterType === 'simulator') throw new Error('skip_for_simulator');
        // 한줄소개에서 첫 번째로 나오는 한글 고유명사(2~5글자)를 추출
        const descNameMatch = nextDesc.match(/[가-힣]{2,5}(?=은|는|이|가|의|을|를|와|과|에게)/);
        if (descNameMatch) {
          const descCharName = descNameMatch[0];
          // 작품명에 해당 이름이 없으면, 작품명에 있는 다른 이름을 한줄소개 이름으로 교체
          if (!nextName.includes(descCharName)) {
            const nameCharMatch = nextName.match(/[가-힣]{2,5}/);
            if (nameCharMatch && nameCharMatch[0] !== descCharName) {
              // 작품명의 이름을 한줄소개의 이름으로 교체
              nextName = nextName.replace(nameCharMatch[0], descCharName);
              console.info(`[QuickMeetCharacterModal] 이름 불일치 보정: ${nameCharMatch[0]} → ${descCharName}`);
            }
          }
        }
      } catch (_nameFixErr) {
        // 보정 실패해도 원본 유지
        try { console.warn('[QuickMeetCharacterModal] name consistency fix failed:', _nameFixErr); } catch (_) {}
      }

      // ✅ 요구사항: 30초 모달(프로필 자동생성)에도 4~5문장 검사 + 1회 재생성 보정 적용
      // - 위저드와 동일한 품질 기준(4~5문장)을 강제해 UX/결과 일관성을 확보한다.
      const sc = (characterType === 'simulator')
        ? countSentencesRoughKo(extractSimulatorBodyForSentenceCount(nextDesc) || nextDesc)
        : countSentencesRoughKo(nextDesc);
      const wantsCta = characterType === 'simulator';
      const hasCta = wantsCta ? hasSimulatorCtaLine(nextDesc) : true;
      const hasMeta = wantsCta ? hasSimulatorBracketMetaAtStart(nextDesc) : true;
      const titleOk = wantsCta ? isGameySimulatorTitle(nextName) : true;
      if (sc < 4 || sc > 5 || !hasCta || !hasMeta || !titleOk) {
        try {
          const regenRule = (characterType === 'simulator')
            ? `중요: 시뮬레이션(게임) 스타일로 생성하라. (1) 작품명(name)은 게임 타이틀 톤(세계/장소/직업/역할/상황이 제목에서 바로 보이게). (2) 한줄소개(description)는 시작 부분에 대괄호 메타([ ... ]) 1개 포함(진행 턴수/모드/핵심 시스템 요약). (3) 유저의 플레이 경험이 보이도록 시스템/안내/명령 톤 문장 최소 1문장 포함(존댓말 가능). (4) 서술 본문은 4~5문장(문장 끝 마침표). 같은 문장 패턴을 반복하지 말고 다양하게 작성하라. (${PROFILE_ONE_LINE_MIN_LEN}~${PROFILE_ONE_LINE_MAX_LEN}자, 줄바꿈 금지)`
            : `중요: 한줄소개(description)는 반드시 4~5문장이어야 한다. 문장 끝은 마침표로 끝내라. (${PROFILE_ONE_LINE_MIN_LEN}~${PROFILE_ONE_LINE_MAX_LEN}자, 줄바꿈 금지)`;
          const seedRetryBase = [
            // ✅ 방어: seedBase(배열)를 "한 줄"로 넣으면 길이 초과로 seed_text가 빈 문자열이 되어 422가 날 수 있다.
            // - 반드시 펼쳐서(라인 배열) 같은 방식으로 길이 제한을 적용한다.
            ...seedBase,
            `작품명(name)은 이미 확정: ${nextName}. 작품명은 절대 변경하지 마.`,
            '출력은 한줄소개(description)만. 작품명(name)이나 대사/지문/부가 문구는 절대 포함하지 마.',
            regenRule,
          ].filter(Boolean);
          const seedRetry = buildSeedWithinLimit(seedRetryBase, 1900);
          const res2 = await charactersAPI.quickGenerateCharacterDraft({
            name: nextName || '캐릭터',
            seed_text: seedRetry,
            image_url: (profileAutoGenUseImage && imgUrl ? (resolveImageUrl(imgUrl) || imgUrl) : null),
            tags: tagsForQuickGenerate,
            ai_model: aiModel,
          });
          upsertVisionChipKeywordsFromDraft(res2?.data);
          const bi2 = res2?.data?.basic_info || {};
          const raw2 = String(bi2?.description || '').trim().replace(/\s*\n+\s*/g, ' ').trim();
          const cand = (characterType === 'simulator')
            ? stripBadGuidePhrasesOnly(raw2, { minLen: PROFILE_ONE_LINE_MIN_LEN })
            : stripMetaFromOneLine(raw2, { minLen: PROFILE_ONE_LINE_MIN_LEN });
          const sc2 = (characterType === 'simulator')
            ? countSentencesRoughKo(extractSimulatorBodyForSentenceCount(cand) || cand)
            : countSentencesRoughKo(cand);
          const hasCta2 = (characterType === 'simulator') ? hasSimulatorCtaLine(cand) : true;
          const hasMeta2 = (characterType === 'simulator') ? hasSimulatorBracketMetaAtStart(cand) : true;
          const titleOk2 = (characterType === 'simulator') ? isGameySimulatorTitle(String(bi2?.name || nextName || '').trim()) : true;
          if (cand && cand.length >= PROFILE_ONE_LINE_MIN_LEN && cand.length <= PROFILE_ONE_LINE_MAX_LEN && sc2 >= 4 && sc2 <= 5 && hasCta2 && hasMeta2 && titleOk2) {
            // ✅ 더 좋은 결과만 채택
            nextDesc = cand;
          }
        } catch (e2) {
          // 방어: 보정 실패 시 기존 결과 유지(사용자에게는 최종 실패가 아니므로 조용히 로깅만)
          try { console.warn('[QuickMeetCharacterModal] profile one-line sentence fix failed:', e2); } catch (_) {}
        }
      }

      // ✅ 시뮬은 "항상 성공" 보정으로 게임 포맷을 강제한다.
      const finalDesc = (characterType === 'simulator')
        ? normalizeSimulatorDescription(nextDesc, {
          maxLen: oneLineMaxLen,
          maxTurns,
          audience,
          style,
          fixedChips,
          chosenThemes,
          extraKeywords,
        })
        : nextDesc;

      // ✅ 시뮬 제목이 너무 비게임적이면, 표시용으로만 가볍게 보정(실패 금지)
      const finalName = (characterType === 'simulator' && !isGameySimulatorTitle(nextName) && !String(nextName || '').includes('시뮬'))
        ? ((String(nextName || '').length <= (PROFILE_NAME_MAX_LEN - 3)) ? `${nextName} 시뮬` : nextName)
        : nextName;

      lastAutoGeneratedNameRef.current = finalName;
      setName(finalName);
      setSeedText(finalDesc);
    } catch (e) {
      console.error('[QuickMeetCharacterModal] auto-generate profile failed:', e);
      const detailRaw = e?.response?.data?.detail ?? e?.message ?? '알 수 없는 오류';
      const detail = stringifyApiDetail(detailRaw);
      const m = String(e?.message || '');
      const msg = (m === 'name_length_invalid')
        ? `작품명 길이가 규칙(${PROFILE_NAME_MIN_LEN}~${PROFILE_NAME_MAX_LEN}자)을 벗어났습니다. 다시 시도해주세요.`
        : (m === 'one_line_length_invalid')
          ? `한줄소개 길이가 규칙(${PROFILE_ONE_LINE_MIN_LEN}~${PROFILE_ONE_LINE_MAX_LEN}자)을 벗어났습니다. 다시 시도해주세요.`
          : (m === 'name_missing')
            ? '작품명 자동생성 결과가 비어있습니다. 잠시 후 다시 시도해주세요.'
            : (m === 'one_line_missing')
              ? '한줄소개 자동생성 결과가 비어있습니다. 잠시 후 다시 시도해주세요.'
              : `자동생성 실패: ${detail}`;
      dispatchToast('error', msg);
    } finally {
      autoGenInFlightRef.current = false;
      setAutoGenLoading(false);
    }
  };

  const handleAutoGenerateProfileConcept = async ({ forceOverwrite = false } = {}) => {
    /**
     * ✅ 30초 모달: 작품컨셉 자동생성(선택)
     *
     * 의도/원리:
     * - 위저드와 동일한 `/characters/quick-generate-concept`를 사용해 품질 일관성을 유지한다.
     * - 생성 결과는 30초 생성 payload에 함께 담아 서버에서 보조 입력으로 활용한다.
     */
    if (generating || autoGenLoading || profileConceptAutoGenLoading) return;

    const n = String(name || '').trim();
    const d = String(seedText || '').trim();
    if (!n) {
      dispatchToast('error', '작품명을 먼저 입력/자동생성해주세요.');
      return;
    }
    if (!d) {
      dispatchToast('error', '한줄소개를 먼저 입력/자동생성해주세요.');
      return;
    }
    if (hasAnyText(profileConceptText) && !forceOverwrite) {
      openOverwriteConfirm('concept', ['작품컨셉']);
      return;
    }

    setProfileConceptAutoGenLoading(true);
    try {
      const audience = selectedAudienceSlug || (REQUIRED_AUDIENCE_CHOICES[0]?.slug || '남성향');
      const style = selectedStyleSlug || (REQUIRED_STYLE_CHOICES[0]?.slug || '애니풍');
      const tagsForConcept = (() => {
        try {
          const arr = (Array.isArray(selectedTagSlugs) ? selectedTagSlugs : [])
            .map((x) => String(x || '').trim())
            .filter(Boolean);
          return arr.length ? arr : [audience, style];
        } catch (_) {
          return [audience, style];
        }
      })();
      const mode = (String(characterType || 'roleplay').toLowerCase() === 'simulator') ? 'simulator' : 'roleplay';

      const res = await charactersAPI.quickGenerateConceptDraft({
        name: n,
        description: d.slice(0, 500),
        mode,
        tags: tagsForConcept,
        audience,
        max_turns: Number.isFinite(Number(maxTurns)) ? Math.max(50, Math.floor(Number(maxTurns))) : 125,
        ...(mode === 'simulator'
          ? {
              sim_variant: (simDatingElements ? 'dating' : 'scenario'),
              sim_dating_elements: !!simDatingElements,
            }
          : {}),
      });

      const concept = String(res?.data?.concept || '').trim();
      if (!concept) throw new Error('concept_empty');
      setProfileConceptText(concept.slice(0, QUICK_MEET_PROFILE_CONCEPT_MAX_LEN));
      dispatchToast('success', '작품컨셉이 자동 생성되었습니다.');
    } catch (e) {
      console.error('[QuickMeetCharacterModal] auto-generate profile concept failed:', e);
      const m = String(e?.message || '');
      const msg = (m === 'concept_empty')
        ? '작품컨셉 자동생성 결과가 비어있습니다. 잠시 후 다시 시도해주세요.'
        : '작품컨셉 자동생성에 실패했습니다. 잠시 후 다시 시도해주세요.';
      dispatchToast('error', msg);
    } finally {
      setProfileConceptAutoGenLoading(false);
    }
  };

  const handleGenerateDraft = async () => {
    // ✅ 요구사항: 글자수 초과는 "오류(Alert)"가 아니라 인라인 경고로만 안내한다.
    // - 따라서 초과 상태에서는 조용히 차단(버튼 비활성화 + 경고 문구)하고,
    //   setError로 상단 에러 UI를 띄우지 않는다.
    if (hasAnyOverLimit) return;
    const msg = validateInput();
    if (msg) {
      setError(msg);
      return;
    }
    setGenerating(true);
    setCreateStageText('생성 준비 중…');
    setError('');
    try {
      let imgUrl = uploadedImageUrl;
      if (!imgUrl) {
        setCreateStageText('대표 이미지 업로드 중…');
        const uploadRes = await filesAPI.uploadImages([imageFile]);
        const urls = Array.isArray(uploadRes.data) ? uploadRes.data : [uploadRes.data];
        imgUrl = String(urls[0] || '').trim();
        if (!imgUrl) throw new Error('image_upload_failed');
        setUploadedImageUrl(imgUrl);
      }

      // ✅ request_id: 동일 클릭/재시도 중복 생성 방지(백엔드 idempotency)
      if (!requestIdRef.current) {
        try { requestIdRef.current = `qc_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`; }
        catch (e) {
          try { console.warn('[QuickMeetCharacterModal] requestId fallback failed:', e); } catch (err) { void err; }
          requestIdRef.current = `qc_${Date.now()}`;
        }
      }

      // ✅ 백엔드가 태그를 slug로 기대하므로 selectedTagSlugs를 사용한다.
      const audience = selectedAudienceSlug || (REQUIRED_AUDIENCE_CHOICES[0]?.slug || '남성향');
      const style = selectedStyleSlug || (REQUIRED_STYLE_CHOICES[0]?.slug || '애니풍');
      const otherTags = (Array.isArray(selectedTagSlugs) ? selectedTagSlugs : [])
        .map((x) => String(x || '').trim())
        .filter((x) => x && x !== audience && x !== style);

      const mt = (() => {
        try {
          const raw = Number(maxTurns);
          const v = Number.isFinite(raw) ? Math.floor(raw) : 125;
          return v < 50 ? 50 : v;
        } catch (e) {
          try { console.warn('[QuickMeetCharacterModal] maxTurns normalize failed:', e); } catch (err) { void err; }
          return 125;
        }
      })();

      const memos = (Array.isArray(settingMemos) ? settingMemos : [])
        .map((x) => String(x || '').trim())
        .filter(Boolean)
        .slice(0, 3)
        .map((x) => x.slice(0, 200));

      const payload = {
        request_id: requestIdRef.current,
        image_url: imgUrl,
        audience_slug: audience,
        style_slug: style,
        character_type: (String(characterType || 'roleplay').toLowerCase() === 'simulator') ? 'simulator' : 'roleplay',
        max_turns: mt,
        name: String(name || '').trim(),
        // ✅ 시뮬은 박스 규제(상한)만 400으로 완화(요구사항) → 서버에도 그대로 전달
        one_line_intro: String(seedText || '').trim().slice(0, ((String(characterType || '').toLowerCase() === 'simulator') ? PROFILE_ONE_LINE_MAX_LEN_SIMULATOR : PROFILE_ONE_LINE_MAX_LEN)),
        tags: otherTags,
        setting_memos: memos,
        profile_concept: (() => {
          const t = String(profileConceptText || '').trim();
          return t ? t.slice(0, QUICK_MEET_PROFILE_CONCEPT_MAX_LEN) : undefined;
        })(),
        // ✅ 요구사항: 시뮬 내 미연시 요소 토글(OFF면 의미 없으므로 서버에 굳이 강제하지 않아도 되지만, 상태 전달은 허용)
        sim_dating_elements: (String(characterType || 'roleplay').toLowerCase() === 'simulator') ? !!simDatingElements : undefined,
      };

      setCreateStageText('AI 캐릭터 생성 요청 중…');
      const res = await charactersAPI.quickCreateCharacter30s(payload);
      const ch = res?.data || null;
      const cid = String(ch?.id || '').trim();
      if (!cid) throw new Error('created_id_missing');
      setCreateStageText('프리뷰 준비 중…');
      setCreatedCharacter(ch);
      setCreatedCharacterId(cid);
      setStep('preview');
      dispatchToast('success', '캐릭터를 생성했습니다. 프리뷰를 확인해주세요.');
    } catch (e) {
      console.error('[QuickMeetCharacterModal] quick-create-30s failed:', e);
      const detail = e?.response?.data?.detail || e?.message || '알 수 없는 오류';
      try { setCreateStageText(''); } catch (_) {}
      setError(`캐릭터 생성 실패: ${detail}`);
    } finally {
      setGenerating(false);
    }
  };

  const handleCreateAndNavigate = async (target) => {
    const createdId = String(createdCharacterId || '').trim();
    if (!createdId) return;
    try {
      // 캐시 무효화(홈/목록 반영)
      try { queryClient.invalidateQueries({ queryKey: ['characters'] }); } catch (e) { try { console.warn('[QuickMeetCharacterModal] invalidate characters failed:', e); } catch (err) { void err; } }
      try { queryClient.invalidateQueries({ queryKey: ['trending-characters-daily'] }); } catch (e) { try { console.warn('[QuickMeetCharacterModal] invalidate trending failed:', e); } catch (err) { void err; } }

      onClose?.();
      // ✅ 닫힘(onOpenChange)에서 resetAll을 수행하므로 여기선 중복 호출을 피한다.

      if (target === 'chat') {
        // ✅ opening 파라미터를 전달해야 intro(지문)가 채팅방에 저장됨
        const openingId = createdCharacter?.start_sets?.selectedId || 'set_1';
        navigate(`/ws/chat/${createdId}?new=1&opening=${encodeURIComponent(openingId)}`);
        return;
      }
      navigate(`/characters/${createdId}`);
    } catch (e) {
      console.error('[QuickMeetCharacterModal] create character failed:', e);
      const detail = e?.response?.data?.detail || e?.message || '알 수 없는 오류';
      setError(`캐릭터 생성 실패: ${detail}`);
    }
  };

  // ✅ 백필 완료 폴링: 프리뷰 상태에서 _backfill_status가 pending이면 3초 간격으로 재조회
  const isBackfillPending = createdCharacter?.start_sets?._backfill_status === 'pending';
  useEffect(() => {
    if (step !== 'preview' || !createdCharacterId || !isBackfillPending) return;
    const interval = setInterval(async () => {
      try {
        const res = await charactersAPI.getCharacter(createdCharacterId);
        const ch = res?.data;
        if (ch && ch?.start_sets?._backfill_status !== 'pending') {
          setCreatedCharacter(ch);
        }
      } catch (_) {}
    }, 3000);
    return () => clearInterval(interval);
  }, [step, createdCharacterId, isBackfillPending]);

  const previewName = String(createdCharacter?.name || name || '').trim();
  const previewDesc = String(createdCharacter?.description || '').trim();
  const previewGreeting = String(createdCharacter?.greeting || '').trim();
  // ✅ UX/안정성: 자동생성/생성 진행 중에는 입력을 잠가 레이스(덮어쓰기/불일치)를 원천 차단한다.
  const isBusy = !!(generating || autoGenLoading || profileConceptAutoGenLoading);

  /**
   * ✅ 글자수 초과 감지(에러 대신 인라인 경고용)
   *
   * 의도/원리:
   * - "초과 시 오류(Alert) 대신 빨간 경고" 요구사항을 만족시키기 위해,
   *   제출/생성 버튼을 비활성화하고 각 입력 하단에 경고 문구만 노출한다.
   * - 방어적으로 서버 호출 직전에도 검증(validateInput)을 남겨두되,
   *   정상 UX에서는 여기 플래그로 먼저 차단한다.
   */
  const nameLen = String(name ?? '').length;
  const seedLen = String(seedText ?? '').length;
  const keywordsLen = String(profileAutoGenKeywordsRaw ?? '').length;
  const memoLens = (Array.isArray(settingMemos) ? settingMemos : []).map((v) => String(v ?? '').length);
  const conceptLen = String(profileConceptText ?? '').length;

  const oneLineMaxLen = (characterType === 'simulator') ? PROFILE_ONE_LINE_MAX_LEN_SIMULATOR : PROFILE_ONE_LINE_MAX_LEN;
  const isOverName = nameLen > PROFILE_NAME_MAX_LEN;
  const isOverSeed = seedLen > oneLineMaxLen;
  const isOverKeywords = keywordsLen > QUICK_MEET_KEYWORDS_RAW_MAX_LEN;
  const isOverMemos = memoLens.some((x) => x > QUICK_MEET_SETTING_MEMO_MAX_LEN);
  const isOverConcept = conceptLen > QUICK_MEET_PROFILE_CONCEPT_MAX_LEN;

  const hasAnyOverLimit = !!(isOverName || isOverSeed || isOverKeywords || isOverMemos || isOverConcept);

  const renderBottomProgressBar = (pct) => {
    /**
     * ✅ 버튼 하단 진행바(SSOT)
     *
     * 의도:
     * - "프로필 자동생성"과 "30초 생성하기"의 진행바 UI를 완전히 동일하게 유지한다.
     */
    try {
      const p = Number(pct);
      const clamped = Number.isFinite(p) ? Math.max(0, Math.min(100, Math.floor(p))) : 0;
      return (
        <span className="absolute left-0 right-0 bottom-0 h-[3px] bg-gray-950/40">
          <span
            className="block h-full bg-gradient-to-r from-purple-500 to-indigo-400"
            style={{ width: `${clamped}%` }}
          />
        </span>
      );
    } catch (_) {
      return null;
    }
  };

  const TagChip = ({ label, active, onRemoveClick, removeLabel }) => {
    /**
     * ✅ 태그 칩(위저드 오프닝 탭 톤)
     *
     * 의도/원리:
     * - CreateCharacterPage의 오프닝 탭 칩 UI를 그대로 재사용해 일관성을 맞춘다.
     * - onRemoveClick이 있으면 × 버튼을 보여준다.
     */
    const text = String(label || '').trim();
    if (!text) return null;
    return (
      <div
        className={[
          'inline-flex items-center gap-2 h-8 sm:h-9 px-3 rounded-full border transition select-none',
          active
            ? 'bg-black/20 border-purple-500 text-white'
            : 'bg-black/20 border-white/10 text-white/80 hover:bg-white/5 hover:text-white',
        ].join(' ')}
        title={text}
      >
        <span className="text-xs sm:text-sm font-semibold max-w-[160px] truncate">{text}</span>
        {typeof onRemoveClick === 'function' ? (
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onRemoveClick();
            }}
            className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-black/30 text-gray-200 hover:bg-black/50 hover:text-white"
            aria-label={removeLabel || '태그 제거'}
            title={removeLabel || '태그 제거'}
          >
            ×
          </button>
        ) : null}
      </div>
    );
  };

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(v) => {
          if (v) return;
          // ✅ 방어: 자동생성/생성 중 닫으면, in-flight 응답이 닫힌 뒤 상태를 덮어쓰는 문제가 생길 수 있다.
          if (isBusy) {
            dispatchToast('error', '진행 중에는 닫을 수 없어요. 잠시만 기다려주세요.');
            return;
          }
          onClose?.();
          resetAll();
        }}
      >
        <DialogContent
          // ✅ Radix 경고 제거: Description을 쓰지 않는 대신 명시적으로 undefined 처리
          aria-describedby={undefined}
          className={[
            // ✅ UX: 컨텐츠가 길어질 수 있어 "상단에서 여유를 두고" 시작하는 편이 입력 흐름이 좋다.
            // ⚠️ Tailwind 유틸 충돌은 CSS 생성 순서에 따라 override가 안 먹을 수 있어,
            // 이 모달만 !important로 위치를 확정한다.
            '!top-[6vh] !-translate-y-0',
            // ⚠️ 주의: `relative`를 넣으면 DialogContent의 기본 `fixed`가 덮여서 모달이 "안 뜨는 것처럼" 보일 수 있다.
            // ✅ 기본 Close 버튼(우상단 X)은 스크롤 시 함께 내려가서 UX가 나쁘다 → 이 모달에서는 숨기고, sticky 헤더에 닫기를 제공한다.
            '[&>button.absolute]:hidden',
            // ✅ 헤더가 라운드 밖으로 "삐져나오지" 않도록, 바깥 컨테이너는 overflow-hidden으로 클리핑하고
            // 스크롤은 내부 래퍼에서만 돌린다.
            'bg-gray-900 text-white border border-gray-700 max-w-3xl rounded-2xl max-h-[90vh] overflow-hidden p-0',
          ].join(' ')}
        >
          {/* ✅ 내부 스크롤 래퍼: 헤더/바디가 같은 컨테이너에서 스크롤되며, 헤더는 sticky로 고정된다. */}
          <div
            ref={dialogContentRef}
            className={[
              // ✅ 스크롤바는 "모달 내부"에서만 보이게(다크) + 스크롤 중에만 노출
              (scrollbarActive ? 'scrollbar-dark' : 'scrollbar-hide'),
              'max-h-[90vh] overflow-y-auto',
            ].join(' ')}
          >
            {/* ✅ Sticky 헤더: 모달 최상단에 딱 붙도록(패딩/마진 없이) */}
            {/* ✅ 헤더는 불투명 배경으로 "비침/공간"이 보이지 않게 한다 */}
            <div className="sticky top-0 z-30 px-4 sm:px-6 py-3 sm:py-4 bg-gray-900 border-b border-gray-800 shadow-sm shadow-black/30">
              <div className="flex items-center justify-between gap-3">
                <DialogTitle className="text-white text-lg sm:text-xl font-semibold">30초만에 캐릭터 만나기</DialogTitle>
                <button
                  type="button"
                  onClick={() => {
                    try {
                      if (isBusy) {
                        dispatchToast('error', '진행 중에는 닫을 수 없어요. 잠시만 기다려주세요.');
                        return;
                      }
                      onClose?.();
                      resetAll();
                    } catch (e) {
                      try { console.warn('[QuickMeetCharacterModal] sticky close failed:', e); } catch (_) {}
                    }
                  }}
                  disabled={isBusy}
                  className="w-9 h-9 rounded-full bg-black/30 text-gray-200 hover:bg-black/50 hover:text-white transition flex items-center justify-center"
                  aria-label="모달 닫기"
                  title="닫기"
                >
                  ×
                </button>
              </div>
            </div>

            <div className="px-4 sm:px-6 pt-4 sm:pt-5 pb-4 sm:pb-6">
              {/* 장르/캐릭터유형/소재 에러는 각 패널 내부에 인라인으로 표시하므로 상단 Alert에서 제외 */}
              {error && !error.includes('장르') && !error.includes('캐릭터 유형') && !error.includes('소재') && (
                <Alert variant="destructive">
                  <AlertDescription style={{ whiteSpace: 'pre-line' }}>{error}</AlertDescription>
                </Alert>
              )}

              {step === 'input' && (
                <div className="space-y-4 sm:space-y-5">
                  <div className="text-xs sm:text-sm text-gray-300 leading-relaxed">
                    이미지 + 느낌을 입력하면 AI가 캐릭터 설정을 자동으로 채워줍니다. 생성된 캐릭터는 공개로 저장됩니다.
                  </div>

                  {/* 1) 필수 선택(성향/이미지 스타일) */}
                  <div className="space-y-2 sm:space-y-3">
                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-xs sm:text-sm font-medium text-gray-200">
                          성향 <span className="text-rose-400">*</span>
                        </div>
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        {REQUIRED_AUDIENCE_CHOICES.map((opt) => {
                          const selected = selectedAudienceSlug === opt.slug;
                          return (
                            <button
                              key={opt.slug}
                              type="button"
                              onClick={() => {
                                audienceTouchedRef.current = true;
                                toggleExclusiveTag(opt.slug, REQUIRED_AUDIENCE_SLUGS);
                              }}
                              disabled={isBusy}
                              aria-pressed={selected}
                              className={[
                                'h-10 sm:h-11 w-full rounded-lg sm:rounded-xl px-2 text-xs sm:text-sm font-semibold transition-all',
                                'outline-none focus-visible:ring-2 focus-visible:ring-purple-500/30',
                                selected
                                  ? 'bg-gradient-to-br from-purple-600 to-indigo-600 text-white shadow-sm ring-1 ring-purple-400/40'
                                  : 'bg-gray-800/40 text-gray-200 hover:bg-gray-800/60 ring-1 ring-gray-700/60',
                              ].join(' ')}
                            >
                              {opt.label}
                            </button>
                          );
                        })}
                      </div>
                      {/* 성향 추천 UI 제거 - 유저가 직접 선택한 성향을 존중 */}
                    </div>
                  {/* ✅ UX: 성향 다음에 모드/분량 선택이 더 자연스럽다 */}
                  <div className="space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="text-xs sm:text-sm font-semibold text-gray-200">
                      롤플레잉 / 시뮬레이터 <span className="text-rose-400">*</span>
                    </div>
                    <div className="text-[11px] sm:text-xs text-gray-400 leading-snug text-right max-w-[220px] sm:max-w-none">
                      커스텀 프롬프트는 사이드바의 캐릭터생성으로 진행해주세요.
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      className={[
                        'h-10 sm:h-11 w-full rounded-lg sm:rounded-xl border text-xs sm:text-sm px-2 font-semibold',
                        characterType === 'roleplay'
                          ? 'bg-gradient-to-br from-purple-600 to-indigo-600 text-white border-transparent'
                          : 'border-gray-700 bg-gray-800/40 text-gray-200 hover:bg-gray-800/60',
                      ].join(' ')}
                      onClick={() => setCharacterType('roleplay')}
                      disabled={isBusy}
                    >
                      롤플레잉
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      className={[
                        'h-10 sm:h-11 w-full rounded-lg sm:rounded-xl border text-xs sm:text-sm px-2 font-semibold',
                        characterType === 'simulator'
                          ? 'bg-gradient-to-br from-purple-600 to-indigo-600 text-white border-transparent'
                          : 'border-gray-700 bg-gray-800/40 text-gray-200 hover:bg-gray-800/60',
                      ].join(' ')}
                      onClick={() => setCharacterType('simulator')}
                      disabled={isBusy}
                    >
                      시뮬레이터
                    </Button>
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-xs sm:text-sm font-semibold text-gray-200">
                      분량 <span className="text-rose-400">*</span>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { v: 75, label: '50~100' },
                      { v: 125, label: '100~150' },
                      { v: 175, label: '150~200' },
                    ].map(({ v, label }) => (
                      <Button
                        key={v}
                        type="button"
                        variant="outline"
                        className={[
                          'h-10 sm:h-11 w-full rounded-lg sm:rounded-xl border text-xs sm:text-sm px-2 font-semibold',
                          Number(maxTurns) === v
                            ? 'bg-gradient-to-br from-purple-600 to-indigo-600 text-white border-transparent'
                            : 'border-gray-700 bg-gray-800/40 text-gray-200 hover:bg-gray-800/60',
                        ].join(' ')}
                        onClick={() => setMaxTurns(v)}
                        disabled={isBusy}
                      >
                        {label}
                      </Button>
                    ))}
                  </div>
                </div>
              </div>

              {/* 2) 이미지 삽입 */}
              <div className="space-y-2">
                <div className="text-xs sm:text-sm font-semibold text-gray-200">
                  대표 이미지 삽입 <span className="text-rose-400">*</span>
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  multiple
                  onChange={(e) => {
                    try {
                      const files = e.target?.files;
                      if (files && files.length) {
                        // ✅ 업로드가 느려도 "바로" 대표 슬롯에 프리뷰를 보여준다.
                        try { onPickImage(files[0]); } catch (_) {}
                        uploadImagesToGallery(files);
                      }
                      // 같은 파일을 다시 선택할 수 있게 value 리셋
                      try { e.target.value = ''; } catch (_) {}
                    } catch (err) {
                      try { console.warn('[QuickMeetCharacterModal] image input onChange failed:', err); } catch (_) {}
                    }
                  }}
                  disabled={isBusy}
                />
                <div className="flex items-start gap-3">
                  {/* ✅ 대표 이미지 슬롯: 정사각형에 object-cover로 "크롭된 것처럼" 표시 */}
                  <div
                    className="relative w-20 h-20 sm:w-24 sm:h-24 rounded-xl border border-gray-800 bg-black/30 overflow-hidden flex-shrink-0 cursor-pointer"
                    role="button"
                    tabIndex={0}
                    onClick={() => {
                      if (imageTrayGallery.length > 0) openImageCropModal(0);
                      else if (imagePreviewUrl || resolvedUploadedUrl) openImageCropModal(0, { fallbackUrl: imagePreviewUrl || resolvedUploadedUrl });
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        if (imageTrayGallery.length > 0) openImageCropModal(0);
                        else if (imagePreviewUrl || resolvedUploadedUrl) openImageCropModal(0, { fallbackUrl: imagePreviewUrl || resolvedUploadedUrl });
                      }
                    }}
                  >
                    {(imagePreviewUrl || resolvedUploadedUrl) ? (
                      <img
                        src={imagePreviewUrl || resolvedUploadedUrl}
                        alt="대표 이미지"
                        className="absolute inset-0 w-full h-full object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <div className="absolute inset-0 flex items-center justify-center text-[11px] sm:text-xs text-gray-500">
                        이미지 없음
                      </div>
                    )}
                    {/* 대표 배지 */}
                    {imageTrayGallery.length > 0 ? (
                      <div className="absolute top-1 left-1 z-10 bg-purple-600 text-white text-[10px] px-1.5 py-0.5 rounded">
                        대표
                      </div>
                    ) : null}
                    {/* 제거(X) */}
                    {(imagePreviewUrl || resolvedUploadedUrl || imageTrayGallery.length > 0) ? (
                      <button
                        type="button"
                        aria-label="대표 이미지 제거"
                        title="대표 이미지 제거"
                        disabled={isBusy}
                        onClick={(e) => {
                          try { e.stopPropagation(); } catch (_) {}
                          if (isBusy) return;
                          clearRepresentativeAndGallery();
                        }}
                        className="absolute top-1 right-1 z-10 h-7 w-7 rounded-md bg-black/60 hover:bg-black/80 text-white flex items-center justify-center disabled:opacity-50"
                      >
                        <X className="w-4 h-4" aria-hidden="true" />
                      </button>
                    ) : null}
                  </div>

                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="text-xs text-gray-400 truncate">
                      {imageTrayGallery.length > 0
                        ? `총 ${imageTrayGallery.length}장 · 첫 번째가 대표`
                        : (uploadedImageUrl ? '대표 이미지 1장 선택됨' : '선택된 이미지 없음')}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        className={[
                          'h-10 sm:h-11 rounded-lg sm:rounded-xl border text-xs sm:text-sm px-3 font-semibold inline-flex items-center gap-2',
                          imageTrayOpen
                            ? 'border-purple-500/60 bg-purple-600/15 text-white'
                            : 'border-gray-700 bg-gray-900/30 text-gray-200 hover:bg-gray-800/40',
                        ].join(' ')}
                        onClick={() => {
                          if (isBusy) return;
                          setImageTrayOpen((prev) => {
                            const next = !prev;
                            // ✅ 트레이를 닫을 때 생성 패널도 함께 닫아 UX 꼬임 방지
                            if (!next) {
                              try { setImageGenOpen(false); } catch (_) {}
                              try { setImageTrayError(''); } catch (_) {}
                            }
                            return next;
                          });
                        }}
                        disabled={isBusy}
                        aria-expanded={imageTrayOpen}
                      >
                        <ImagePlus className="w-4 h-4" aria-hidden="true" />
                        <span>이미지 삽입/생성</span>
                        {selectedStyleLabel ? (
                          <span
                            className="ml-1 inline-flex items-center h-6 px-2 rounded-full border border-gray-700/70 bg-gray-950/40 text-[11px] font-semibold text-gray-200"
                            title={`현재 이미지 스타일: ${selectedStyleLabel}`}
                          >
                            {selectedStyleLabel}
                          </span>
                        ) : (
                          <span
                            className="ml-1 inline-flex items-center h-6 px-2 rounded-full border border-gray-800 bg-gray-950/20 text-[11px] font-semibold text-gray-500"
                            title="이미지 스타일 미선택"
                          >
                            스타일
                          </span>
                        )}
                        {imageTrayOpen ? (
                          <ChevronUp className="w-4 h-4 opacity-70" aria-hidden="true" />
                        ) : (
                          <ChevronDown className="w-4 h-4 opacity-70" aria-hidden="true" />
                        )}
                      </Button>
                    </div>
                  </div>
                </div>

                {/* ✅ 인라인 이미지 트레이: 버튼 누르면 아래로 펼침 */}
                {imageTrayOpen ? (
                  <div className="mt-2 rounded-xl border border-gray-800 bg-gray-950/20 p-3 space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-xs sm:text-sm font-semibold text-gray-200">이미지 갤러리</div>
                        <div className="text-[11px] sm:text-xs text-gray-500">
                          {isCoarsePointer ? '버튼으로 순서 변경 · 첫 번째가 대표' : '드래그로 순서 변경 · 첫 번째가 대표'}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {/* ✅ 이미지 스타일: 드롭다운은 아이콘 줄에 배치(심플) */}
                        <select
                          value={String(selectedStyleSlug || '').trim() || (REQUIRED_STYLE_CHOICES?.[0]?.slug || '애니풍')}
                          onChange={(e) => toggleExclusiveTag(e.target.value, REQUIRED_STYLE_SLUGS)}
                          disabled={isBusy || imageTrayBusy}
                          className="h-9 rounded-lg bg-gray-900/40 border border-gray-800 px-2.5 text-xs sm:text-sm text-gray-100 focus-visible:ring-2 focus-visible:ring-purple-500/30"
                          aria-label="이미지 스타일 선택"
                        >
                          {REQUIRED_STYLE_CHOICES.map((opt) => (
                            <option key={`tray-style-opt-${opt.slug}`} value={opt.slug}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          aria-label="이미지 업로드"
                          title="이미지 업로드"
                          disabled={isBusy || imageTrayBusy}
                          onClick={() => {
                            // ✅ 생성 패널에서 "삽입"으로 돌아올 땐 파일픽커를 바로 띄우지 않는다.
                            // - 첫 클릭: 생성 패널 닫기(=삽입 화면으로 전환)
                            // - 삽입 화면 상태에서 다시 누르면 파일 선택(편의)
                            if (imageGenOpen) {
                              try { setImageGenOpen(false); } catch (_) {}
                              return;
                            }
                            try { fileInputRef.current?.click(); } catch (e) { try { console.warn('[QuickMeetCharacterModal] file picker open failed:', e); } catch (_) {} }
                          }}
                          className="h-9 w-9 rounded-lg border border-gray-800 bg-gray-900/30 text-gray-200 hover:bg-gray-800/40 flex items-center justify-center disabled:opacity-50"
                        >
                          <ImagePlus className="w-4 h-4" aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          aria-label="이미지 생성"
                          title="이미지 생성"
                          disabled={isBusy || imageTrayBusy}
                          onClick={() => {
                            if (isBusy) return;
                            setImageGenOpen((v) => !v);
                            // ✅ 생성 패널을 열 때 업로드 에러 문구는 치운다(시각 노이즈 방지)
                            try { setImageTrayError(''); } catch (_) {}
                          }}
                          className={[
                            'h-9 w-9 rounded-lg border flex items-center justify-center disabled:opacity-50',
                            imageGenOpen
                              ? 'border-purple-500/60 bg-purple-600/15 text-white'
                              : 'border-gray-800 bg-gray-900/30 text-gray-200 hover:bg-gray-800/40',
                          ].join(' ')}
                        >
                          <Sparkles className="w-4 h-4" aria-hidden="true" />
                        </button>
                      </div>
                    </div>

                    {imageTrayError ? (
                      <div className="text-[11px] sm:text-xs text-rose-400">{imageTrayError}</div>
                    ) : null}

                    {imageGenOpen ? (
                      <div className="space-y-2">
                        <div className="text-[11px] sm:text-xs text-gray-400">프롬프트</div>
                        <Textarea
                          value={imageGenPrompt}
                          onChange={(e) => setImageGenPrompt(e.target.value)}
                          rows={3}
                          disabled={isBusy || imageTrayBusy}
                          className="rounded-lg sm:rounded-xl bg-gray-950/30 border-gray-800 text-gray-100 placeholder:text-gray-500 focus-visible:ring-purple-500/30 focus-visible:border-purple-500/40 text-sm sm:text-base"
                          placeholder="예: 보랏빛 네온의 사이버펑크 도시, 미소 짓는 요정, 역광, 고해상도"
                        />
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          <div className="space-y-1">
                            <div className="text-[11px] sm:text-xs text-gray-400">모델</div>
                            <select
                              value={imageGenModel}
                              onChange={(e) => setImageGenModel(e.target.value)}
                              disabled={isBusy || imageTrayBusy}
                              className="w-full bg-gray-900/40 border border-gray-800 rounded-lg px-3 py-2 text-sm text-gray-100 focus-visible:ring-2 focus-visible:ring-purple-500/30"
                              aria-label="이미지 생성 모델"
                            >
                              <option value="gemini-2.5-flash-image">Nano banana</option>
                              <option value="gemini-3-pro-image-preview">Nano banana Pro</option>
                              <option value="fal-ai/z-image/turbo">Z-Image Turbo</option>
                            </select>
                          </div>
                          <div className="space-y-1">
                            <div className="text-[11px] sm:text-xs text-gray-400">비율</div>
                            <select
                              value={imageGenRatio}
                              onChange={(e) => setImageGenRatio(e.target.value)}
                              disabled={isBusy || imageTrayBusy}
                              className="w-full bg-gray-900/40 border border-gray-800 rounded-lg px-3 py-2 text-sm text-gray-100 focus-visible:ring-2 focus-visible:ring-purple-500/30"
                              aria-label="이미지 비율"
                            >
                              <option value="1:1">1:1</option>
                              <option value="3:4">3:4</option>
                              <option value="4:3">4:3</option>
                              <option value="16:9">16:9</option>
                              <option value="9:16">9:16</option>
                            </select>
                          </div>
                        </div>
                        <div className="flex items-center justify-end">
                          <button
                            type="button"
                            aria-label="이미지 생성 실행"
                            title="생성"
                            onClick={runInlineImageGenerate}
                            disabled={isBusy || imageTrayBusy}
                            className="h-9 px-3 rounded-lg bg-purple-600 hover:bg-purple-700 text-white flex items-center gap-2 text-xs sm:text-sm font-semibold disabled:opacity-50"
                          >
                            {imageTrayBusy ? (
                              <>
                                <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                                생성중…
                              </>
                            ) : (
                              <>
                                <Sparkles className="w-4 h-4" aria-hidden="true" />
                                생성
                              </>
                            )}
                          </button>
                        </div>
                      </div>
                    ) : null}

                    <div className="relative">
                      {/* PC: 좌/우 버튼(오버플로우일 때만) */}
                      {galleryCanLeft ? (
                        <button
                          type="button"
                          aria-label="왼쪽으로 스크롤"
                          title="이전"
                          className="hidden md:flex absolute left-1 top-1/2 -translate-y-1/2 z-10 h-9 w-9 rounded-xl border border-gray-800 bg-black/55 hover:bg-black/75 text-white items-center justify-center"
                          onClick={() => {
                            const el = galleryStripRef.current;
                            if (!el) return;
                            try { el.scrollBy({ left: -Math.max(200, Math.floor(el.clientWidth * 0.8)), behavior: 'smooth' }); } catch (_) {}
                          }}
                        >
                          <ChevronLeft className="w-5 h-5" aria-hidden="true" />
                        </button>
                      ) : null}
                      {galleryCanRight ? (
                        <button
                          type="button"
                          aria-label="오른쪽으로 스크롤"
                          title="다음"
                          className="hidden md:flex absolute right-1 top-1/2 -translate-y-1/2 z-10 h-9 w-9 rounded-xl border border-gray-800 bg-black/55 hover:bg-black/75 text-white items-center justify-center"
                          onClick={() => {
                            const el = galleryStripRef.current;
                            if (!el) return;
                            try { el.scrollBy({ left: Math.max(200, Math.floor(el.clientWidth * 0.8)), behavior: 'smooth' }); } catch (_) {}
                          }}
                        >
                          <ChevronRight className="w-5 h-5" aria-hidden="true" />
                        </button>
                      ) : null}

                      {/* 모바일/PC 공통: 가로 스와이프/스크롤 스트립 */}
                      <div
                        ref={galleryStripRef}
                        className="flex gap-2 overflow-x-auto scrollbar-feed snap-x snap-mandatory pr-2"
                        onScroll={updateGalleryScrollState}
                      >
                        {imageTrayGallery.length === 0 ? (
                          <button
                            type="button"
                            onClick={() => {
                              if (isBusy || imageTrayBusy) return;
                              try { fileInputRef.current?.click(); } catch (e) { try { console.warn('[QuickMeetCharacterModal] empty gallery click -> file picker failed:', e); } catch (_) {} }
                            }}
                            disabled={isBusy || imageTrayBusy}
                            className="w-full text-center text-gray-400 text-xs py-6 rounded-lg border border-dashed border-gray-800 bg-gray-950/10 hover:bg-gray-900/20 transition-colors disabled:opacity-50"
                            title="클릭해서 이미지 업로드"
                          >
                            이미지를 업로드하거나 생성해보세요.
                          </button>
                        ) : (
                          imageTrayGallery.map((g, idx) => {
                            const u = String(g?.url || '').trim();
                            if (!u) return null;
                            const resolved = resolveImageUrl(u) || u;
                            const isPrimary = idx === 0;
                            return (
                              <div
                                key={String(g?.id || u)}
                                className={[
                                  'group relative aspect-square w-20 sm:w-24 md:w-28 shrink-0 snap-start rounded-lg overflow-hidden border bg-black/20',
                                  isPrimary ? 'border-purple-500 ring-2 ring-purple-500/30' : 'border-gray-800 hover:border-gray-700',
                                ].join(' ')}
                                role="button"
                                tabIndex={0}
                                onClick={() => openImageCropModal(idx)}
                                onKeyDown={(ev) => {
                                  if (ev.key === 'Enter' || ev.key === ' ') openImageCropModal(idx);
                                }}
                                draggable={!isCoarsePointer}
                                onDragStart={() => { imageDragIndexRef.current = idx; }}
                                onDragOver={(ev) => { try { ev.preventDefault(); } catch (_) {} }}
                                onDrop={() => {
                                  const from = imageDragIndexRef.current;
                                  imageDragIndexRef.current = null;
                                  if (from === null || from === undefined) return;
                                  moveGalleryItem(from, idx);
                                }}
                                onDragEnd={() => { imageDragIndexRef.current = null; }}
                              >
                                <img src={resolved} alt={`gallery-${idx + 1}`} className="absolute inset-0 w-full h-full object-cover" loading="lazy" />
                                {!isCoarsePointer ? (
                                  <div className="absolute bottom-1 left-1 bg-black/60 text-white rounded-md px-1.5 py-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <GripVertical className="w-3.5 h-3.5" aria-hidden="true" />
                                  </div>
                                ) : null}
                                <button
                                  type="button"
                                  aria-label="이미지 삭제"
                                  title="삭제"
                                  disabled={isBusy}
                                  onClick={(ev) => {
                                    try { ev.stopPropagation(); } catch (_) {}
                                    removeGalleryItem(idx);
                                  }}
                                  className="absolute top-1 right-1 h-7 w-7 rounded-md bg-black/60 hover:bg-black/80 text-white flex items-center justify-center disabled:opacity-50"
                                >
                                  <Trash2 className="w-4 h-4" aria-hidden="true" />
                                </button>
                                {isCoarsePointer && imageTrayGallery.length > 1 ? (
                                  <div className="absolute bottom-1 left-1 right-1 flex items-center justify-between gap-1">
                                    <button
                                      type="button"
                                      aria-label="앞으로 이동"
                                      title="앞으로"
                                      disabled={isBusy || idx === 0}
                                      onClick={(ev) => {
                                        try { ev.stopPropagation(); } catch (_) {}
                                        moveGalleryItem(idx, idx - 1);
                                      }}
                                      className="h-7 w-7 rounded-md bg-black/60 hover:bg-black/80 text-white flex items-center justify-center disabled:opacity-40"
                                    >
                                      <ChevronUp className="w-4 h-4" aria-hidden="true" />
                                    </button>
                                    <button
                                      type="button"
                                      aria-label="뒤로 이동"
                                      title="뒤로"
                                      disabled={isBusy || idx === imageTrayGallery.length - 1}
                                      onClick={(ev) => {
                                        try { ev.stopPropagation(); } catch (_) {}
                                        moveGalleryItem(idx, idx + 1);
                                      }}
                                      className="h-7 w-7 rounded-md bg-black/60 hover:bg-black/80 text-white flex items-center justify-center disabled:opacity-40"
                                    >
                                      <ChevronDown className="w-4 h-4" aria-hidden="true" />
                                    </button>
                                  </div>
                                ) : null}
                                {isPrimary ? (
                                  <div className="absolute top-1 left-1 bg-purple-600 text-white text-[10px] px-1.5 py-0.5 rounded">
                                    대표
                                  </div>
                                ) : null}
                              </div>
                            );
                          })
                        )}
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>

              {/* ✅ 요구사항: 장르/캐릭터유형/소재 선택 UI를 "햄버거(아코디언)" 형태로 정리 */}
              <div className="space-y-2">
                <div className="text-xs sm:text-sm font-semibold text-gray-200">
                  장르/캐릭터유형/소재를 골라주세요.
                </div>

                <div className="rounded-xl border border-gray-800 bg-gray-950/20 overflow-hidden">
                  {/* 장르 */}
                  <button
                    type="button"
                    onClick={() => {
                      if (isBusy) return;
                      setChipPanelsOpen((prev) => ({ ...(prev || {}), genre: !Boolean(prev?.genre) }));
                    }}
                    disabled={isBusy}
                    className="w-full h-11 px-3 flex items-center justify-between gap-3 bg-gray-950/10 hover:bg-gray-900/20 border-b border-gray-800"
                    aria-expanded={!!chipPanelsOpen?.genre}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <Menu className="w-4 h-4 text-gray-400 flex-shrink-0" aria-hidden="true" />
                      <div className="text-xs sm:text-sm font-semibold text-gray-200 truncate">
                        장르<span className="text-rose-400"> *</span>
                      </div>
                      <div className="text-[11px] text-gray-500 flex-shrink-0">(최대 2)</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="text-[11px] sm:text-xs text-gray-400 max-w-[180px] truncate">
                        {(Array.isArray(selectedGenres) && selectedGenres.length > 0) ? selectedGenres.join(', ') : '미선택'}
                      </div>
                      {chipPanelsOpen?.genre
                        ? <ChevronUp className="w-4 h-4 text-gray-400" aria-hidden="true" />
                        : <ChevronDown className="w-4 h-4 text-gray-400" aria-hidden="true" />}
                    </div>
                  </button>
                  {chipPanelsOpen?.genre ? (
                    <div className="p-3 space-y-2">
                      {error && error.includes('장르') ? (
                        <div className="text-[11px] sm:text-xs text-rose-400 font-medium">{error}</div>
                      ) : (
                        <div className="text-[11px] sm:text-xs text-gray-400">장르는 최대 2개까지 선택할 수 있어요.</div>
                      )}
                      <div
                        className="flex flex-wrap gap-2"
                      >
                        {(genreExpanded ? genreDisplay : genreDisplay.slice(0, QUICK_MEET_GENRE_PREVIEW_COUNT)).map((t) => {
                          const selected = (Array.isArray(selectedGenres) ? selectedGenres : []).includes(t);
                          const atLimit = !selected && (Array.isArray(selectedGenres) ? selectedGenres.length : 0) >= 2;
                          return (
                            <button
                              key={`genre-${t}`}
                              type="button"
                              disabled={isBusy || atLimit}
                              onClick={() => toggleGenreChip(t)}
                              aria-pressed={selected}
                              className={[
                                'h-7 px-2.5 rounded-full border text-xs font-semibold transition-colors whitespace-nowrap flex-shrink-0',
                                selected
                                  ? 'border-purple-400/50 bg-purple-600/20 text-purple-100'
                                  : 'border-gray-700/60 bg-gray-900/10 text-gray-200 hover:bg-gray-800/30',
                                atLimit ? 'opacity-40 cursor-not-allowed' : '',
                              ].join(' ')}
                              title={atLimit ? '장르는 최대 2개까지 선택할 수 있어요.' : t}
                            >
                              {t}
                            </button>
                          );
                        })}

                        {/* ✅ 요구사항: 첫 줄 마지막 칩을 "더보기/접기"로(태그칩과 동일한 디자인) */}
                        <button
                          key="genre-more-toggle"
                          type="button"
                          onClick={() => { if (!isBusy) setGenreExpanded((v) => !v); }}
                          disabled={isBusy}
                          aria-label={genreExpanded ? '장르 접기' : '장르 더보기'}
                          className="h-7 px-2.5 rounded-full border text-xs font-semibold transition-colors whitespace-nowrap flex-shrink-0 border-gray-700/60 bg-gray-900/10 text-gray-200 hover:bg-gray-800/30 inline-flex items-center gap-1"
                          title={genreExpanded ? '접기' : '더보기'}
                        >
                          <span>{genreExpanded ? '접기' : '더보기'}</span>
                          {genreExpanded
                            ? <ChevronUp className="w-3.5 h-3.5 opacity-80" aria-hidden="true" />
                            : <ChevronDown className="w-3.5 h-3.5 opacity-80" aria-hidden="true" />}
                        </button>
                      </div>
                    </div>
                  ) : null}

                  {/* 캐릭터 유형 */}
                  <button
                    type="button"
                    onClick={() => {
                      if (isBusy) return;
                      setChipPanelsOpen((prev) => ({ ...(prev || {}), type: !Boolean(prev?.type) }));
                    }}
                    disabled={isBusy}
                    className="w-full h-11 px-3 flex items-center justify-between gap-3 bg-gray-950/10 hover:bg-gray-900/20 border-b border-gray-800"
                    aria-expanded={!!chipPanelsOpen?.type}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <Menu className="w-4 h-4 text-gray-400 flex-shrink-0" aria-hidden="true" />
                      <div className="text-xs sm:text-sm font-semibold text-gray-200 truncate">
                        캐릭터 유형<span className="text-rose-400"> *</span>
                      </div>
                      <div className="text-[11px] text-gray-500 flex-shrink-0">(1개)</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="text-[11px] sm:text-xs text-gray-400 max-w-[180px] truncate">
                        {String(selectedType || '').trim() ? String(selectedType || '').trim() : '미선택'}
                      </div>
                      {chipPanelsOpen?.type
                        ? <ChevronUp className="w-4 h-4 text-gray-400" aria-hidden="true" />
                        : <ChevronDown className="w-4 h-4 text-gray-400" aria-hidden="true" />}
                    </div>
                  </button>
                  {chipPanelsOpen?.type ? (
                    <div className="p-3 space-y-2">
                      <div className="flex items-center justify-between gap-3">
                        {error && error.includes('캐릭터 유형') ? (
                          <div className="text-[11px] sm:text-xs text-rose-400 font-medium">{error}</div>
                        ) : (
                          <div className="text-[11px] sm:text-xs text-gray-400">유형은 1개만 선택할 수 있어요.</div>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            const len = Array.isArray(typeDisplay) ? typeDisplay.length : 0;
                            if (len <= 0) return;
                            setTypePage((p) => ((Number(p || 0) + 1) * QUICK_MEET_TYPE_PAGE_SIZE >= len ? 0 : Number(p || 0) + 1));
                          }}
                          disabled={isBusy}
                          aria-label="캐릭터 유형 교체"
                          className="h-8 w-9 rounded-lg border border-gray-800 bg-gray-950/20 hover:bg-gray-900/30 text-gray-300 inline-flex items-center justify-center disabled:opacity-50"
                          title="교체"
                        >
                          <RefreshCw className="w-4 h-4" aria-hidden="true" />
                        </button>
                      </div>
                      <div className="flex flex-wrap gap-2 max-h-[96px] overflow-hidden">
                        {typeVisible.map((t) => {
                          const selected = String(selectedType || '') === t;
                          return (
                            <button
                              key={`type-${t}`}
                              type="button"
                              disabled={isBusy}
                              onClick={() => toggleSingleChip('type', t)}
                              aria-pressed={selected}
                              className={[
                                'h-7 px-2.5 rounded-full border text-xs font-semibold transition-colors whitespace-nowrap flex-shrink-0',
                                selected
                                  ? 'border-purple-400/50 bg-purple-600/20 text-purple-100'
                                  : 'border-gray-700/60 bg-gray-900/10 text-gray-200 hover:bg-gray-800/30',
                              ].join(' ')}
                              title={t}
                            >
                              {t}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}

                  {/* 소재(훅/행동/소재) */}
                  <button
                    type="button"
                    onClick={() => {
                      if (isBusy) return;
                      setChipPanelsOpen((prev) => ({ ...(prev || {}), hook: !Boolean(prev?.hook) }));
                    }}
                    disabled={isBusy}
                    className="w-full h-11 px-3 flex items-center justify-between gap-3 bg-gray-950/10 hover:bg-gray-900/20"
                    aria-expanded={!!chipPanelsOpen?.hook}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <Menu className="w-4 h-4 text-gray-400 flex-shrink-0" aria-hidden="true" />
                      <div className="text-xs sm:text-sm font-semibold text-gray-200 truncate">
                        소재<span className="text-rose-400"> *</span>
                      </div>
                      <div className="text-[11px] text-gray-500 flex-shrink-0">(1개)</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="text-[11px] sm:text-xs text-gray-400 max-w-[180px] truncate">
                        {String(selectedHook || '').trim() ? String(selectedHook || '').trim() : '미선택'}
                      </div>
                      {chipPanelsOpen?.hook
                        ? <ChevronUp className="w-4 h-4 text-gray-400" aria-hidden="true" />
                        : <ChevronDown className="w-4 h-4 text-gray-400" aria-hidden="true" />}
                    </div>
                  </button>
                  {chipPanelsOpen?.hook ? (
                    <div className="p-3 space-y-2">
                      <div className="flex items-center justify-between gap-3">
                        {error && error.includes('소재') ? (
                          <div className="text-[11px] sm:text-xs text-rose-400 font-medium">{error}</div>
                        ) : (
                          <div className="text-[11px] sm:text-xs text-gray-400">소재는 1개만 선택할 수 있어요.</div>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            const len = Array.isArray(hookDisplay) ? hookDisplay.length : 0;
                            if (len <= 0) return;
                            setHookPage((p) => ((Number(p || 0) + 1) * QUICK_MEET_HOOK_PAGE_SIZE >= len ? 0 : Number(p || 0) + 1));
                          }}
                          disabled={isBusy}
                          aria-label="소재 교체"
                          className="h-8 w-9 rounded-lg border border-gray-800 bg-gray-950/20 hover:bg-gray-900/30 text-gray-300 inline-flex items-center justify-center disabled:opacity-50"
                          title="교체"
                        >
                          <RefreshCw className="w-4 h-4" aria-hidden="true" />
                        </button>
                      </div>
                      <div className="flex flex-wrap gap-2 max-h-[64px] overflow-hidden">
                        {/* ✅ 방어: 중복 라벨이 들어오면 렌더 키 충돌/반복 노출이 발생할 수 있어 UI 직전에서 한 번 더 unique 처리 */}
                        {uniqStringsPreserveOrder(hookVisible).map((t) => {
                          const selected = String(selectedHook || '') === t;
                          return (
                            <button
                              key={`hook-${t}`}
                              type="button"
                              disabled={isBusy}
                              onClick={() => toggleSingleChip('hook', t)}
                              aria-pressed={selected}
                              className={[
                                'h-7 px-2.5 rounded-full border text-xs font-semibold transition-colors whitespace-nowrap flex-shrink-0',
                                selected
                                  ? 'border-purple-400/50 bg-purple-600/20 text-purple-100'
                                  : 'border-gray-700/60 bg-gray-900/10 text-gray-200 hover:bg-gray-800/30',
                              ].join(' ')}
                              title={t}
                            >
                              {t}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>

              {/* 3) 작품명 */}
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-xs sm:text-sm font-semibold text-gray-200">
                    작품명 <span className="text-rose-400">*</span>
                  </div>
                </div>
                <div className="relative">
                  <Input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="예: 검은 성의 밤"
                    className="h-10 sm:h-11 pr-16 rounded-lg sm:rounded-xl bg-gray-950/40 border-gray-700 text-gray-100 placeholder:text-gray-500 focus-visible:ring-purple-500/30 focus-visible:border-purple-500/40 text-sm sm:text-base"
                    disabled={isBusy}
                  />
                  <CharLimitCounter value={name} max={PROFILE_NAME_MAX_LEN} />
                </div>
                {isOverName ? (
                  <div className="text-[11px] sm:text-xs text-rose-400">
                    최대 {PROFILE_NAME_MAX_LEN}자까지 입력할 수 있어요. (현재 {nameLen}자)
                  </div>
                ) : null}
              </div>

              {/* 4) 한줄소개 */}
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-xs sm:text-sm font-semibold text-gray-200">
                    한줄소개 <span className="text-rose-400">*</span>
                  </div>
                </div>
                <div className="relative">
                  <Textarea
                    value={seedText}
                    onChange={(e) => setSeedText(e.target.value)}
                    placeholder={DEFAULT_SEED_PLACEHOLDER}
                    className="pr-16 pb-6 rounded-lg sm:rounded-xl bg-gray-950/30 border-gray-700 text-gray-100 placeholder:text-gray-500 focus-visible:ring-purple-500/30 focus-visible:border-purple-500/40 text-sm sm:text-base"
                    rows={3}
                    disabled={isBusy}
                  />
                  <CharLimitCounter value={seedText} max={oneLineMaxLen} />
                </div>
                {isOverSeed ? (
                  <div className="text-[11px] sm:text-xs text-rose-400">
                    최대 {oneLineMaxLen}자까지 입력할 수 있어요. (현재 {seedLen}자)
                  </div>
                ) : null}
              </div>

              {/* ✅ 위저드처럼: 프로필(작품명/한줄소개) 통합 자동생성 버튼 */}
              <div className="pt-1">
                <Button
                  type="button"
                  variant="secondary"
                  className="relative overflow-hidden w-full h-10 sm:h-11 rounded-lg sm:rounded-xl bg-gray-800 text-gray-100 hover:bg-gray-700 text-sm font-semibold"
                  onClick={() => handleAutoGenerateProfile({ forceOverwrite: false })}
                  disabled={isBusy}
                  title={(hasAnyText(name) || hasAnyText(seedText)) ? '덮어쓰기 경고 후 입력한 정보로 프로필을 자동생성합니다.' : '입력한 정보로 프로필을 자동생성합니다.'}
                >
                  <span className="relative z-10 inline-flex items-center justify-center gap-2">
                    {autoGenLoading ? (
                      <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                    ) : (
                      <Sparkles className="w-4 h-4 opacity-90" aria-hidden="true" />
                    )}
                    <span>{autoGenLoading ? '생성 중' : '입력한 정보로 프로필 자동생성'}</span>
                  </span>
                  {autoGenLoading ? renderBottomProgressBar(autoGenProgress) : null}
                </Button>
                <div className="mt-1 flex items-center justify-end gap-3">
                  {/* ✅ 요구사항: 버튼 바로 밑 우하단 "이미지 정보 포함" 토글 */}
                  {(() => {
                    const hasAnyImage = !!(
                      (Array.isArray(imageTrayGallery) && imageTrayGallery.length > 0)
                      || imageFile
                      || uploadedImageUrl
                      || imagePreviewUrl
                    );
                    const disabled = !hasAnyImage || isBusy || autoGenLoading;
                    return (
                      <div className="flex flex-col items-end gap-2 flex-shrink-0">
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] sm:text-xs text-gray-400">
                            {profileAutoGenUseImage ? '삽입한 이미지에 정확하게 생성' : '빠르고 트렌디하게 생성'}
                          </span>
                          <button
                            type="button"
                            aria-label="이미지 정보 포함"
                            title={disabled ? '이미지를 먼저 삽입하면 활성화됩니다.' : '프로필 자동생성에 이미지 정보를 포함합니다.'}
                            aria-pressed={!!profileAutoGenUseImage}
                            disabled={disabled}
                            onClick={() => {
                              if (disabled) return;
                              setProfileAutoGenUseImage((v) => !v);
                            }}
                            className={[
                              'relative inline-flex h-6 w-11 items-center rounded-full transition-colors',
                              profileAutoGenUseImage ? 'bg-purple-600' : 'bg-gray-700',
                              disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer',
                            ].join(' ')}
                          >
                            <span
                              className="inline-block h-4 w-4 rounded-full bg-white transition-transform duration-200 ease-out"
                              style={{ transform: `translateX(${profileAutoGenUseImage ? 24 : 4}px)` }}
                            />
                          </button>
                        </div>

                        {/* ✅ 문장형 제목 토글 - 시뮬은 숨김 (시뮬은 세계관/장소 중심 제목으로 고정) */}
                        {characterType !== 'simulator' && <div className="flex items-center gap-2">
                          <span className="text-[11px] sm:text-xs text-gray-400">
                            {useSentenceStyleName ? '작품명 구체적으로' : '제목 스타일 자유'}
                          </span>
                          <button
                            type="button"
                            aria-label="작품명 구체적으로"
                            title="ON이면 캐릭터 이름과 상황이 구체적으로 드러나는 제목을 생성합니다."
                            aria-pressed={!!useSentenceStyleName}
                            disabled={isBusy || autoGenLoading}
                            onClick={() => {
                              if (isBusy || autoGenLoading) return;
                              setUseSentenceStyleName((v) => !v);
                            }}
                            className={[
                              'relative inline-flex h-6 w-11 items-center rounded-full transition-colors',
                              useSentenceStyleName ? 'bg-purple-600' : 'bg-gray-700',
                              (isBusy || autoGenLoading) ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer',
                            ].join(' ')}
                          >
                            <span
                              className="inline-block h-4 w-4 rounded-full bg-white transition-transform duration-200 ease-out"
                              style={{ transform: `translateX(${useSentenceStyleName ? 24 : 4}px)` }}
                            />
                          </button>
                        </div>}

                        {/* ✅ 요구사항: 30초에도 "시뮬 내 미연시 요소" ON/OFF 토글 제공(빠르고 트렌디하게 생성 밑) */}
                        {characterType === 'simulator' ? (
                          <div className="flex items-center gap-2">
                            <span className="text-[11px] sm:text-xs text-gray-400">
                              시뮬 내 미연시 요소
                            </span>
                            <button
                              type="button"
                              aria-label="시뮬 내 미연시 요소"
                              title={(isBusy || autoGenLoading) ? '생성 중에는 변경할 수 없습니다.' : 'ON이면 공략/루트/호감도 이벤트 결이 강하게 반영됩니다.'}
                              aria-pressed={!!simDatingElements}
                              disabled={isBusy || autoGenLoading}
                              onClick={() => {
                                if (isBusy || autoGenLoading) return;
                                setSimDatingElements((v) => !v);
                              }}
                              className={[
                                'relative inline-flex h-6 w-11 items-center rounded-full transition-colors',
                                simDatingElements ? 'bg-purple-600' : 'bg-gray-700',
                                (isBusy || autoGenLoading) ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer',
                              ].join(' ')}
                            >
                              <span
                                className="inline-block h-4 w-4 rounded-full bg-white transition-transform duration-200 ease-out"
                                style={{ transform: `translateX(${simDatingElements ? 24 : 4}px)` }}
                              />
                            </button>
                          </div>
                        ) : null}
                      </div>
                    );
                  })()}
                </div>
              </div>

              {/* ✅ 키워드(선택): UI 비노출(요구사항) */}

              {/* 추가입력(접기/펼치기) */}
              <div className="pt-1">
                <button
                  type="button"
                  onClick={() => setAdvancedOpen((v) => !v)}
                  disabled={isBusy}
                  className="w-full h-10 sm:h-11 rounded-lg sm:rounded-xl border border-gray-800 bg-gray-950/30 hover:bg-gray-900/40 transition-colors flex items-center justify-between px-3"
                  aria-expanded={advancedOpen}
                >
                  <div className="flex items-center gap-2 text-xs sm:text-sm font-semibold text-gray-200">
                    <Menu className="w-4 h-4" aria-hidden="true" />
                    추가입력
                  </div>
                  {advancedOpen ? (
                    <ChevronUp className="w-4 h-4 text-gray-400" aria-hidden="true" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-gray-400" aria-hidden="true" />
                  )}
                </button>

                {advancedOpen ? (
                  <div className="mt-3 space-y-4">
                    <div className="space-y-2">
                      <div className="text-xs sm:text-sm font-semibold text-gray-200">설정메모</div>
                      <div className="grid grid-cols-1 gap-2">
                        {[0, 1, 2].map((i) => (
                          <div key={i} className="relative">
                            <Input
                              value={String(settingMemos?.[i] ?? '')}
                              onChange={(e) => {
                                const v = e.target.value;
                                setSettingMemos((prev) => {
                                  const arr = Array.isArray(prev) ? prev.slice(0) : ['', '', ''];
                                  arr[i] = v;
                                  return arr;
                                });
                              }}
                              placeholder={`설정메모 ${i + 1} (최대 ${QUICK_MEET_SETTING_MEMO_MAX_LEN}자)`}
                              className="h-10 sm:h-11 pr-16 rounded-lg sm:rounded-xl bg-gray-950/40 border-gray-700 text-gray-100 placeholder:text-gray-500 focus-visible:ring-purple-500/30 focus-visible:border-purple-500/40 text-sm sm:text-base"
                              disabled={isBusy}
                            />
                            <CharLimitCounter value={String(settingMemos?.[i] ?? '')} max={QUICK_MEET_SETTING_MEMO_MAX_LEN} />
                          </div>
                        ))}
                      </div>
                      {isOverMemos ? (
                        <div className="text-[11px] sm:text-xs text-rose-400">
                          설정메모는 각 항목당 최대 {QUICK_MEET_SETTING_MEMO_MAX_LEN}자까지 입력할 수 있어요.
                        </div>
                      ) : null}
                      <div className="text-[11px] text-gray-500">선택 입력이며, 최대 3개까지 가능합니다.</div>
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-xs sm:text-sm font-semibold text-gray-200">작품컨셉</div>
                        <Button
                          type="button"
                          variant="secondary"
                          className="h-9 sm:h-10 rounded-lg sm:rounded-xl bg-gray-800 text-gray-100 hover:bg-gray-700 px-3 text-xs sm:text-sm"
                          onClick={() => handleAutoGenerateProfileConcept({ forceOverwrite: false })}
                          disabled={isBusy}
                          title={hasAnyText(profileConceptText) ? '덮어쓰기 확인 후 작품컨셉을 자동생성합니다.' : '작품명/한줄소개를 바탕으로 작품컨셉을 자동생성합니다.'}
                        >
                          <span className="inline-flex items-center gap-2">
                            {profileConceptAutoGenLoading ? (
                              <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                            ) : (
                              <Sparkles className="w-4 h-4 opacity-90" aria-hidden="true" />
                            )}
                            <span>{profileConceptAutoGenLoading ? '생성 중' : '작품컨셉 자동생성'}</span>
                          </span>
                        </Button>
                      </div>
                      <div className="relative">
                        <Textarea
                          value={String(profileConceptText || '')}
                          onChange={(e) => setProfileConceptText(String(e?.target?.value || ''))}
                          placeholder="선택 입력: 작품의 분위기, 관계 흐름, 핵심 루프/목표 등을 자유롭게 적어주세요."
                          className="pr-16 pb-6 rounded-lg sm:rounded-xl bg-gray-950/30 border-gray-700 text-gray-100 placeholder:text-gray-500 focus-visible:ring-purple-500/30 focus-visible:border-purple-500/40 text-sm sm:text-base"
                          rows={5}
                          disabled={isBusy}
                        />
                        <CharLimitCounter value={String(profileConceptText || '')} max={QUICK_MEET_PROFILE_CONCEPT_MAX_LEN} />
                      </div>
                      {isOverConcept ? (
                        <div className="text-[11px] sm:text-xs text-rose-400">
                          작품컨셉은 최대 {QUICK_MEET_PROFILE_CONCEPT_MAX_LEN}자까지 입력할 수 있어요. (현재 {conceptLen}자)
                        </div>
                      ) : null}
                      <div className="text-[11px] text-gray-500">
                        선택 입력이며, 30초 생성 시 프롬프트/오프닝 품질 보강용으로 함께 전달됩니다.
                      </div>
                    </div>

                    {/* ✅ 요구사항: 태그선택(회색 버튼)을 "추가입력" 안으로 이동 */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-xs sm:text-sm font-semibold text-gray-200">태그 선택</div>
                        <Button
                          type="button"
                          variant="secondary"
                          className="h-9 sm:h-10 rounded-lg sm:rounded-xl bg-gray-800 text-gray-100 hover:bg-gray-700"
                          onClick={() => setTagModalOpen(true)}
                          disabled={isBusy}
                        >
                          태그 선택
                        </Button>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        {(Array.isArray(selectedTagSlugs) ? selectedTagSlugs : []).map((slug) => {
                          const s = String(slug || '').trim();
                          if (!s) return null;
                          const isReq = REQUIRED_AUDIENCE_SLUGS.includes(s) || REQUIRED_STYLE_SLUGS.includes(s);
                          return (
                            <TagChip
                              key={s}
                              label={s}
                              active={isReq}
                              onRemoveClick={() => {
                                // ✅ 필수 태그는 해제 불가: 추가 태그만 제거 가능
                                if (isReq) return;
                                removeSlug(s);
                              }}
                              removeLabel="태그 제거"
                            />
                          );
                        })}
                        {(!Array.isArray(selectedTagSlugs) || selectedTagSlugs.length === 0) ? (
                          <div className="text-xs text-gray-500">선택된 태그 없음</div>
                        ) : null}
                      </div>
                      <div className="text-[11px] text-gray-500">
                        * 성향/이미지스타일 같은 필수 태그는 여기서 해제할 수 없어요.
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="pt-2">
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="flex-1 h-11 rounded-xl border-gray-700 bg-gray-800/40 text-gray-200 hover:bg-gray-800/60 text-sm font-semibold"
                    onClick={handleMoveToRichCreate}
                    disabled={isBusy}
                  >
                    더 풍부하게 생성하기
                  </Button>
                  <div className="flex-1 flex flex-col">
                    <Button
                      type="button"
                      className="relative overflow-hidden w-full h-11 rounded-xl bg-purple-600 hover:bg-purple-700 text-white shadow-sm shadow-purple-900/30 text-sm font-semibold"
                      onClick={handleGenerateDraft}
                      disabled={isBusy || hasAnyOverLimit}
                      aria-busy={!!generating}
                      title={generating ? '캐릭터를 생성 중입니다.' : '30초 생성하기'}
                    >
                      <span className="relative z-10 inline-flex items-center justify-center gap-2">
                        {generating ? (
                          <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                        ) : (
                          <Sparkles className="w-4 h-4 opacity-90" aria-hidden="true" />
                        )}
                        <span>{generating ? '생성 중' : '30초 생성하기'}</span>
                      </span>
                      {generating ? renderBottomProgressBar(createProgress) : null}
                    </Button>
                    {generating ? (
                      <div className="mt-1 text-[11px] sm:text-xs text-gray-400 text-center">
                        {String(createStageText || '진행 중…')}
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>
          )}

          {step === 'preview' && (
            <div className="space-y-3 sm:space-y-4">
              <div className="rounded-xl border border-gray-800 bg-gray-950/20 p-3 sm:p-4">
                <div className="text-base sm:text-lg font-semibold text-white">{previewName || '캐릭터'}</div>
                <div className="text-xs sm:text-sm text-gray-300 mt-1">{previewDesc || '설명이 없습니다.'}</div>
                {!!(imagePreviewUrl || resolvedUploadedUrl) && (
                  <div className="mt-3">
                    <img
                      src={imagePreviewUrl || resolvedUploadedUrl}
                      alt="대표 이미지"
                      className="w-full max-h-[220px] sm:max-h-[260px] object-contain rounded-xl border border-gray-800 bg-black/30"
                      loading="lazy"
                    />
                  </div>
                )}
                {previewGreeting && (
                  <div className="mt-3 text-xs text-gray-300 whitespace-pre-line border-t border-gray-800 pt-3">
                    {previewGreeting}
                  </div>
                )}
              </div>

              <div className="flex items-start sm:items-center justify-between gap-2">
                <div className="text-xs sm:text-sm text-gray-300 leading-relaxed">
                  프리뷰를 확인한 후, 수정하거나 다시 생성할 수 있어요.
                </div>
                <div className="flex gap-2 shrink-0">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={isBackfillPending}
                    className="h-9 sm:h-10 rounded-lg sm:rounded-xl border-gray-700 bg-gray-800/40 text-gray-200 hover:bg-gray-800/60 text-xs sm:text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                    onClick={isBackfillPending ? undefined : async () => {
                      // ✅ 요구사항: "수정"은 입력 단계로 돌아가되, 유저가 입력했던 정보(이미지/텍스트/태그)는 유지한다.
                      setError('');
                      // ✅ 이전 생성 캐릭터 정리(고아 방지)
                      const prevId = String(createdCharacterId || '').trim();
                      if (prevId) {
                        try { await charactersAPI.deleteCharacter(prevId); } catch (_) {}
                      }
                      setCreatedCharacterId('');
                      setCreatedCharacter(null);
                      requestIdRef.current = '';
                      setStep('input');
                    }}
                  >
                    {isBackfillPending ? '마무리 중...' : '수정'}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-9 sm:h-10 rounded-lg sm:rounded-xl border-gray-700 bg-gray-800/40 text-gray-200 hover:bg-gray-800/60 text-xs sm:text-sm"
                    onClick={resetAll}
                  >
                    다시 생성하기
                  </Button>
                </div>
              </div>

              <div className="flex flex-wrap gap-2 justify-end pt-2">
                <Button
                  type="button"
                  variant="outline"
                  className="h-10 sm:h-11 rounded-lg sm:rounded-xl border-gray-700 bg-gray-800/40 text-gray-200 hover:bg-gray-800/60 text-sm"
                  onClick={() => handleCreateAndNavigate('detail')}
                >
                  상세페이지 보기
                </Button>
                <Button
                  type="button"
                  className="h-10 sm:h-11 rounded-lg sm:rounded-xl bg-purple-600 hover:bg-purple-700 text-white shadow-sm shadow-purple-900/30 text-sm"
                  onClick={() => handleCreateAndNavigate('chat')}
                >
                  대화하러 가기
                </Button>
              </div>
            </div>
          )}

          {/* ✅ body/scroll wrapper close */}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ✅ 자동생성 덮어쓰기 경고 모달 */}
      <Dialog
        open={overwriteConfirmOpen}
        onOpenChange={(v) => {
          if (v) return;
          if (isBusy) return;
          setOverwriteConfirmOpen(false);
          setOverwriteConfirmKind('');
          setOverwriteConfirmTargets([]);
        }}
      >
        <DialogContent className="bg-gray-950 text-white border border-gray-700 max-w-md rounded-2xl p-4 sm:p-6">
          <DialogHeader>
            <DialogTitle className="text-white text-base sm:text-lg font-semibold">덮어쓰기 경고</DialogTitle>
          </DialogHeader>
          <div className="text-sm text-gray-200 leading-relaxed">
            현재 입력된{' '}
            <span className="font-semibold text-white">
              {(Array.isArray(overwriteConfirmTargets) ? overwriteConfirmTargets : []).join(' / ') || '값'}
            </span>
            을(를) 자동생성 결과로 <span className="font-semibold text-white">덮어씁니다</span>. 계속할까요?
          </div>
          <div className="mt-4 flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              className="h-9 rounded-lg border-gray-700 bg-gray-800/40 text-gray-200 hover:bg-gray-800/60"
              onClick={() => {
                setOverwriteConfirmOpen(false);
                setOverwriteConfirmKind('');
                setOverwriteConfirmTargets([]);
              }}
              disabled={isBusy}
            >
              취소
            </Button>
            <Button
              type="button"
              className="h-9 rounded-lg bg-purple-600 hover:bg-purple-700 text-white"
              onClick={handleOverwriteConfirm}
              disabled={isBusy}
            >
              덮어쓰기
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <TagSelectModal
        isOpen={tagModalOpen}
        onClose={() => setTagModalOpen(false)}
        allTags={allTagsForModal}
        selectedSlugs={selectedTagSlugs}
        onSave={(slugs) => setSelectedTagSlugs(Array.isArray(slugs) ? slugs : [])}
      />

      <ImageGenerateInsertModal
        open={imgModalOpen}
        entityType="character"
        entityId={undefined}
        cropOnly={true}
        initialGallery={(Array.isArray(imgModalSeedGallery) ? imgModalSeedGallery : (Array.isArray(imageTrayGallery) ? imageTrayGallery : []))
          .map((g) => {
            const url = String(g?.url || '').trim();
            const id = g?.id ?? url;
            return { id, url };
          })
          .filter((x) => x.url)}
        // 기존 모달 결과를 받아 QuickMeet 갤러리/대표를 동기화한다.
        onClose={(result) => {
          try {
            setImgModalOpen(false);
            setImgModalInitialCropIndex(-1);
            setImgModalSeedGallery(null);
            if (!result) return;
            const gallery = Array.isArray(result?.gallery) ? result.gallery : [];
            if (gallery.length === 0) return;
            // ✅ id/url 보존(서버 크롭 폴백이 asset id를 필요로 함)
            const next = normalizeGallery(
              gallery.map((x) => ({
                id: x?.id ?? x?.url,
                url: String(x?.url || '').trim(),
              }))
            );
            if (next.length === 0) return;
            setImageTrayGallery(next);
            syncRepresentativeFromGallery(next);
          } catch (e) {
            console.error('[QuickMeetCharacterModal] ImageGenerateInsertModal onClose failed:', e);
          }
        }}
        initialCropIndex={imgModalInitialCropIndex}
      />
      <AlertDialog open={draftPromptOpen} onOpenChange={setDraftPromptOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>임시저장된 초안을 찾았어요</AlertDialogTitle>
            <AlertDialogDescription>
              이어서 불러오시겠어요? 새로 만들기를 선택하면 기존 임시저장은 삭제됩니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => moveToCreateWizard({ clearDraft: false })} disabled={isBusy}>
              불러오기
            </AlertDialogCancel>
            <AlertDialogAction onClick={() => moveToCreateWizard({ clearDraft: true })} disabled={isBusy}>
              새로 만들기
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
