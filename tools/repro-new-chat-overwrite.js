const { chromium } = require('playwright');
const crypto = require('crypto');

const FRONT = 'http://localhost:5173';
const API = 'http://localhost:8000';
const CHAR_ID = '4ce8007b-1785-429b-b178-8ad7d7398ca4';
const CHAR_URL = `${FRONT}/characters/${CHAR_ID}`;
const JWT_SECRET = 'your-super-secret-jwt-key-change-this-in-production';

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
    exp: Math.floor(Date.now() / 1000) + (24 * 60 * 60),
  };
  const head = b64urlJson(header);
  const body = b64urlJson(payload);
  const data = `${head}.${body}`;
  const sig = crypto
    .createHmac('sha256', JWT_SECRET)
    .update(data)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  return `${data}.${sig}`;
}

async function j(method, url, body = null, token = null) {
  const res = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch (_) {}
  return { ok: res.ok, status: res.status, data, raw: res };
}

async function createAndLoginUser() {
  const suffix = `${Date.now()}_${Math.floor(Math.random() * 10000)}`;
  const email = `autotest_${suffix}@example.com`;
  const username = `autotest_${suffix}`;
  const password = 'Test1234!';

  const vtoken = signEmailVerificationToken(email);
  const v = await j('POST', `${API}/auth/verify-email`, { token: vtoken });
  if (!v.ok) throw new Error(`verify-email failed: ${v.status} ${JSON.stringify(v.data)}`);

  const r = await j('POST', `${API}/auth/register`, { email, username, password, gender: 'male' });
  if (!r.ok) throw new Error(`register failed: ${r.status} ${JSON.stringify(r.data)}`);

  const l = await j('POST', `${API}/auth/login`, { email, password });
  if (!l.ok) throw new Error(`login failed: ${l.status} ${JSON.stringify(l.data)}`);

  return {
    email,
    username,
    password,
    accessToken: l.data?.access_token,
    refreshToken: l.data?.refresh_token,
    userId: l.data?.user_id,
  };
}

function parseRoomFromUrl(u) {
  try {
    const url = new URL(u);
    return String(url.searchParams.get('room') || '').trim();
  } catch (_) {
    return '';
  }
}

async function waitForRoomInUrl(page, timeoutMs = 15000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const rid = parseRoomFromUrl(page.url());
    if (rid) return rid;
    await page.waitForTimeout(250);
  }
  return '';
}

async function clickFirstVisible(page, selectors) {
  for (const s of selectors) {
    const loc = page.locator(s).first();
    if (await loc.count() > 0) {
      try {
        if (await loc.isVisible({ timeout: 800 })) {
          await loc.scrollIntoViewIfNeeded().catch(() => {});
          await loc.click({ timeout: 3000 });
          return s;
        }
      } catch (_) {}
    }
  }
  return null;
}

async function sendUserMessage(page, text) {
  const ta = page.locator('textarea[placeholder*="메시지"], textarea[placeholder*="!스탯"], textarea').filter({ hasNot: page.locator('[disabled]') }).first();
  await ta.waitFor({ state: 'visible', timeout: 15000 });
  await ta.fill(text);

  const sendBtn = page.locator('button[title="전송"]:visible').first();
  if (await sendBtn.count() > 0) {
    try {
      if (await sendBtn.isEnabled({ timeout: 1000 })) {
        await sendBtn.click({ timeout: 3000 });
      } else {
        await ta.press('Enter');
      }
    } catch (_) {
      await ta.press('Enter');
    }
  } else {
    await ta.press('Enter');
  }

  await page.getByText(text).first().waitFor({ state: 'visible', timeout: 15000 });
}

async function getRoomMessages(roomId, token) {
  const res = await j('GET', `${API}/chat/rooms/${roomId}/messages?tail=1&skip=0&limit=200`, null, token);
  if (!res.ok) return [];
  return Array.isArray(res.data) ? res.data : [];
}

async function waitForNewChatButton(page, timeoutMs = 15000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const b = page.locator('button:has-text("새로 대화"), button:has-text("선택한 오프닝으로 새로 대화")').first();
    if (await b.count() > 0) {
      try {
        if (await b.isVisible({ timeout: 500 })) return true;
      } catch (_) {}
    }
    await page.waitForTimeout(500);
  }
  return false;
}

(async () => {
  const report = {
    user: null,
    startedAt: new Date().toISOString(),
    firstStartButton: null,
    room1: null,
    room2: null,
    sameRoom: null,
    room1HasMsg2: null,
    room1MsgCount: null,
    room2MsgCount: null,
    startNewApiCalls: [],
    errors: [],
  };

  let browser;
  try {
    const user = await createAndLoginUser();
    report.user = { email: user.email, username: user.username, userId: user.userId };

    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();

    await context.addInitScript(({ at, rt }) => {
      localStorage.setItem('access_token', at);
      localStorage.setItem('refresh_token', rt);
    }, { at: user.accessToken, rt: user.refreshToken });

    const page = await context.newPage();

    page.on('response', async (res) => {
      try {
        const u = res.url();
        if (!u.includes('/chat/start-new')) return;
        const status = res.status();
        let body = null;
        try { body = await res.json(); } catch (_) {}
        report.startNewApiCalls.push({ status, roomId: body?.id || body?.room_id || null, url: u });
      } catch (_) {}
    });

    // 1) 상세 진입 -> 첫 대화 시작
    await page.goto(CHAR_URL, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(1500);

    const clicked = await clickFirstVisible(page, [
      'button:has-text("대화 시작")',
      'button:has-text("원작챗 시작")',
      'button:has-text("새로 대화")',
      'button:has-text("선택한 오프닝으로 새로 대화")'
    ]);
    report.firstStartButton = clicked;
    if (!clicked) throw new Error('시작 버튼을 찾지 못했습니다.');

    await page.waitForURL(/\/ws\/chat\//, { timeout: 20000 });
    const room1 = await waitForRoomInUrl(page, 15000);
    if (!room1) throw new Error('첫 채팅 roomId를 URL에서 얻지 못했습니다.');
    report.room1 = room1;

    const msg1 = `m1_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    await sendUserMessage(page, msg1);

    // 2) 상세로 복귀 -> 새로 대화 버튼 확인
    await page.goto(CHAR_URL, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(1200);

    let hasNew = await waitForNewChatButton(page, 12000);
    if (!hasNew) {
      await page.reload({ waitUntil: 'networkidle' });
      hasNew = await waitForNewChatButton(page, 8000);
    }
    if (!hasNew) throw new Error('새로 대화 버튼이 나타나지 않았습니다.');

    const clickedNew = await clickFirstVisible(page, [
      'button:has-text("새로 대화")',
      'button:has-text("선택한 오프닝으로 새로 대화")'
    ]);
    if (!clickedNew) throw new Error('새로 대화 버튼 클릭 실패');

    await page.waitForURL(/\/ws\/chat\//, { timeout: 20000 });
    const room2 = await waitForRoomInUrl(page, 15000);
    if (!room2) throw new Error('두 번째 채팅 roomId를 URL에서 얻지 못했습니다.');
    report.room2 = room2;

    const msg2 = `m2_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    await sendUserMessage(page, msg2);

    // 3) API 검증: 방 분리 + 교차오염 여부
    const room1Msgs = await getRoomMessages(room1, user.accessToken);
    const room2Msgs = await getRoomMessages(room2, user.accessToken);

    report.room1MsgCount = room1Msgs.length;
    report.room2MsgCount = room2Msgs.length;
    report.sameRoom = room1 === room2;
    report.room1HasMsg2 = room1Msgs.some((m) => String(m?.content || '').includes(msg2));

    await context.close();
    await browser.close();

    console.log(JSON.stringify(report, null, 2));
  } catch (err) {
    report.errors.push(String(err?.message || err));
    try { if (browser) await browser.close(); } catch (_) {}
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = 1;
  }
})();
