export const getReadingProgress = (workId) => {
  if (!workId) return 0;
  try {
    const v = localStorage.getItem(`reader_progress:${workId}`);
    return v ? parseInt(v, 10) : 0;
  } catch {
    return 0;
  }
};

export const setReadingProgress = (workId, chapterNumber) => {
  if (!workId) return;
  try {
    localStorage.setItem(`reader_progress:${workId}`, String(chapterNumber));
    // 최근 읽은 시각도 함께 기록하여 사이드패널 정렬에 활용
    localStorage.setItem(`reader_progress_at:${workId}`, String(Date.now()));
  } catch {}
};

export const getReadingProgressAt = (workId) => {
  if (!workId) return 0;
  try {
    const v = localStorage.getItem(`reader_progress_at:${workId}`);
    return v ? parseInt(v, 10) : 0;
  } catch {
    return 0;
  }
};


