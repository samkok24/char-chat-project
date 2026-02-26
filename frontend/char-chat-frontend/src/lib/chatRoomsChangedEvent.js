const CHAT_ROOMS_CHANGED_EVENT = 'chat:roomsChanged';
const KIND_ACTIVITY = 'activity';
const KIND_STRUCTURE = 'structure';

function normalizeKind(value) {
  return String(value || '').trim().toLowerCase();
}

export function emitChatRoomsChanged({
  kind = 'structure',
  reason = '',
  roomId = '',
  updatedAt = '',
  snippet = '',
  characterId = '',
} = {}) {
  try {
    const detail = { kind: normalizeKind(kind) || 'structure' };
    const safeReason = String(reason || '').trim();
    const safeRoomId = String(roomId || '').trim();
    const safeUpdatedAt = String(updatedAt || '').trim();
    const safeSnippet = String(snippet || '').trim();
    const safeCharacterId = String(characterId || '').trim();
    if (safeReason) detail.reason = safeReason;
    if (safeRoomId) detail.roomId = safeRoomId;
    if (safeUpdatedAt) detail.updatedAt = safeUpdatedAt;
    if (safeSnippet) detail.snippet = safeSnippet;
    if (safeCharacterId) detail.characterId = safeCharacterId;
    window.dispatchEvent(new CustomEvent(CHAT_ROOMS_CHANGED_EVENT, { detail }));
  } catch (_) {
    // Fallback for environments where CustomEvent construction fails
    try { window.dispatchEvent(new Event(CHAT_ROOMS_CHANGED_EVENT)); } catch (_) {}
  }
}

export function shouldRefetchForRoomsChanged(eventLike) {
  const kind = normalizeKind(eventLike?.detail?.kind);
  // Legacy emitters (plain Event) should keep current behavior.
  if (!kind) return true;
  return kind !== KIND_ACTIVITY;
}

export function getRoomsChangedActivity(eventLike) {
  const detail = eventLike?.detail || null;
  const kind = normalizeKind(detail?.kind);
  if (kind !== KIND_ACTIVITY) return null;
  const roomId = String(detail?.roomId || '').trim();
  if (!roomId) return null;
  const snippet = String(detail?.snippet || '').trim();
  const updatedAt = String(detail?.updatedAt || '').trim() || new Date().toISOString();
  const characterId = String(detail?.characterId || '').trim();
  return {
    kind: KIND_ACTIVITY,
    roomId,
    snippet,
    updatedAt,
    characterId: characterId || null,
    reason: String(detail?.reason || '').trim() || 'message',
  };
}

export const CHAT_ROOMS_CHANGED_KIND = {
  activity: KIND_ACTIVITY,
  structure: KIND_STRUCTURE,
};
