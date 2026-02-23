/* eslint-disable no-console */
/**
 * Repro: safety/refusal loop reports (API-only, no Playwright)
 *
 * Usage:
 *   node tools/repro-safety-refusal-api.js
 *
 * What it does:
 *   1) Creates a throwaway user (email verify -> register -> login)
 *   2) Starts a new chat room for the given character
 *   3) Sends a few short messages and prints the raw AI response + metadata
 *
 * Notes:
 * - Intentionally does NOT print tokens.
 * - Use this to determine whether the model/backend is actually refusing,
 *   vs the frontend only "display-rewriting" a normal response.
 */

const crypto = require('crypto');

const API = process.env.API_BASE_URL || 'http://localhost:8000';
const CHAR_ID = process.env.CHAR_ID || 'a6182254-a7be-432c-b714-6f24dd891b35';
const JWT_SECRET_KEY =
  process.env.JWT_SECRET_KEY || 'your-super-secret-jwt-key-change-this-in-production';

function b64urlJson(obj) {
  return Buffer.from(JSON.stringify(obj), 'utf8')
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function signEmailVerificationToken(email) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = {
    email,
    type: 'email_verification',
    exp: Math.floor(Date.now() / 1000) + 24 * 60 * 60,
  };
  const head = b64urlJson(header);
  const body = b64urlJson(payload);
  const data = `${head}.${body}`;
  const sig = crypto
    .createHmac('sha256', JWT_SECRET_KEY)
    .update(data)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  return `${data}.${sig}`;
}

async function j(method, path, body = null, token = null) {
  const url = `${API}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try {
    data = await res.json();
  } catch (_) {}
  return { ok: res.ok, status: res.status, data };
}

async function createAndLoginUser() {
  const suffix = `${Date.now()}_${Math.floor(Math.random() * 10000)}`;
  const email = `autotest_${suffix}@example.com`;
  const username = `autotest_${suffix}`;
  const password = 'Test1234!';

  const vtoken = signEmailVerificationToken(email);
  const v = await j('POST', '/auth/verify-email', { token: vtoken });
  if (!v.ok) throw new Error(`verify-email failed: ${v.status} ${JSON.stringify(v.data)}`);

  const r = await j('POST', '/auth/register', { email, username, password, gender: 'male' });
  if (!r.ok) throw new Error(`register failed: ${r.status} ${JSON.stringify(r.data)}`);

  const l = await j('POST', '/auth/login', { email, password });
  if (!l.ok) throw new Error(`login failed: ${l.status} ${JSON.stringify(l.data)}`);

  const accessToken = l.data?.access_token;
  if (!accessToken) throw new Error('login returned no access_token');

  return { email, username, accessToken };
}

function pickAiMsg(sendResp) {
  try {
    const m = sendResp?.data?.ai_message || null;
    if (!m) return null;
    return {
      id: String(m.id || ''),
      content: String(m.content || ''),
      md: m.message_metadata || null,
    };
  } catch (_) {
    return null;
  }
}

function summarizeText(s) {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  if (t.length <= 240) return t;
  return `${t.slice(0, 220)} ... (${t.length} chars)`;
}

(async () => {
  const user = await createAndLoginUser();
  console.log('[user]', { email: user.email, username: user.username });

  const start = await j('POST', '/chat/start-new', { character_id: CHAR_ID }, user.accessToken);
  if (!start.ok) throw new Error(`start-new failed: ${start.status} ${JSON.stringify(start.data)}`);
  const roomId = String(start.data?.id || '').trim();
  if (!roomId) throw new Error('start-new returned no room id');
  console.log('[room]', roomId);

  const probe = (() => {
    const raw = String(process.env.PROBE || '').trim();
    if (raw) {
      return raw
        .split('|')
        .map((x) => String(x || '').trim())
        .filter(Boolean)
        .slice(0, 12);
    }
    return [
      '원소리야 그게',
      '뭐라는거야',
      '그냥 상황 설명해줘. 숨을까? 정면돌파할까?',
    ];
  })();

  for (const text of probe) {
    const resp = await j(
      'POST',
      '/chat/message',
      { room_id: roomId, character_id: CHAR_ID, content: text },
      user.accessToken,
    );
    if (!resp.ok) {
      console.log('[send FAIL]', { status: resp.status, text });
      console.log('  body:', resp.data);
      continue;
    }
    const ai = pickAiMsg(resp);
    console.log('\n[user]', text);
    console.log('[ai ]', summarizeText(ai?.content || ''));
    console.log('[md ]', ai?.md || null);
  }
})().catch((e) => {
  console.error('[repro] error:', e?.stack || e?.message || String(e));
  process.exitCode = 1;
});
