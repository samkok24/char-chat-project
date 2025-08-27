export const avatarPlaceholder = (
  width = 120,
  height = 160,
  label = 'No Image',
  background = '#2a2f35',
  foreground = '#ffffff'
) => {
  try {
    const fontSize = Math.floor(Math.min(width, height) / 6);
    const svg = `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns='http://www.w3.org/2000/svg' width='${width}' height='${height}' viewBox='0 0 ${width} ${height}'>\n  <rect width='100%' height='100%' fill='${background}'/>\n  <text x='50%' y='50%' dominant-baseline='middle' text-anchor='middle' fill='${foreground}' font-family='system-ui, Arial, sans-serif' font-size='${fontSize}'>${label}</text>\n</svg>`;
    return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
  } catch {
    return '';
  }
};

export const DEFAULT_AVATAR_URI = avatarPlaceholder(90, 114, '이미지');
export const DEFAULT_SQUARE_URI = avatarPlaceholder(400, 400, '이미지');


