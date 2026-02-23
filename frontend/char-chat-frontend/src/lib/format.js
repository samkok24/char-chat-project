// 공용 숫자 카운트 포맷터
// 규칙:
// - 1,000 미만: 원본 숫자
// - 1,000 ~ 9,999: 천 단위 정수로 'Nk' (예: 8,123 -> '8k')
// - 10,000 ~ 999,999: 소수 1자리 'X.Xk' (불필요한 .0 제거)
// - 1,000,000 이상: 소수 1자리 'X.XM' (불필요한 .0 제거)
export const formatCount = (value) => {
  const n = Number(value) || 0;
  if (n < 1000) return `${n}`;
  if (n < 10000) return `${Math.floor(n / 1000)}k`;
  if (n < 1000000) {
    const v = n / 1000;
    const str = v.toFixed(1);
    return `${str.endsWith('.0') ? str.slice(0, -2) : str}k`;
  }
  const m = n / 1000000;
  const str = m.toFixed(1);
  return `${str.endsWith('.0') ? str.slice(0, -2) : str}M`;
};

export default formatCount;



