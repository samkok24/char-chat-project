// 단일 토큰 치환 레이어
// 입력 텍스트에서 허용 토큰만 치환하고, 금지/미등록 토큰은 제거합니다.

export const ALLOWED_TOKENS = ['{{assistant}}', '{{user}}'];
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
    .replaceAll('{{user}}', userName);
  return result;
}




