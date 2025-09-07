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
  } catch {}
};


