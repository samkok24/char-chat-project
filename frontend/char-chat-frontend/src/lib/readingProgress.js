/**
 * readingProgress.js
 *
 * 의도:
 * - 과거/레거시 import 경로(`../lib/readingProgress`)를 유지하기 위한 호환 레이어입니다.
 * - 실제 구현은 `reading.js`에 있으며, 여기서는 동일 API를 re-export 합니다.
 *
 * 주의:
 * - SSOT는 `reading.js` 입니다. 로직 변경이 필요하면 `reading.js`를 수정하세요.
 */

export { getReadingProgress, setReadingProgress, getReadingProgressAt } from './reading';


