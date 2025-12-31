// 단일 토큰 치환 레이어
// 입력 텍스트에서 허용 토큰만 치환하고, 금지/미등록 토큰은 제거합니다.

// ✅ 허용 토큰
// - {{character}}: 사용자에게 더 직관적인 "캐릭터" 토큰 (권장)
// - {{assistant}}: 레거시 호환
// - {{user}}: 사용자/페르소나
export const ALLOWED_TOKENS = ['{{assistant}}', '{{character}}', '{{user}}'];
export const FORBIDDEN_TOKENS = ['{{system}}', '{{dev}}'];

export function replacePromptTokens(text, { assistantName = '캐릭터', userName = '나' } = {}) {
  if (!text) return '';
  let result = String(text);
  // 금지 토큰 제거
  FORBIDDEN_TOKENS.forEach(t => {
    result = result.split(t).join('');
  });
  // 허용되지 않은 커스텀 토큰 제거
  result = result.replace(/\{\{[^}]+\}\}/g, (tok) => (ALLOWED_TOKENS.includes(tok) ? tok : ''));
  // 허용 토큰 치환
  result = result
    .replaceAll('{{assistant}}', assistantName)
    .replaceAll('{{character}}', assistantName)
    .replaceAll('{{user}}', userName);
  return result;
}

/**
 * ✅ 프롬프트/설정 텍스트의 토큰을 "치환하지 않고" 안전하게 정리한다.
 *
 * 의도:
 * - DB에는 {{user}}/{{character}}(및 레거시 {{assistant}})를 원문으로 보존한다(=SSOT).
 * - 단, 금지 토큰({{system}}/{{dev}})과 미등록 토큰은 제거해 안전성을 높인다.
 */
export function sanitizePromptTokens(text) {
  if (!text) return '';
  let result = String(text);
  // 금지 토큰 제거
  FORBIDDEN_TOKENS.forEach(t => {
    result = result.split(t).join('');
  });
  // 허용되지 않은 커스텀 토큰 제거(허용 토큰은 그대로 유지)
  result = result.replace(/\{\{[^}]+\}\}/g, (tok) => (ALLOWED_TOKENS.includes(tok) ? tok : ''));
  return result;
}




