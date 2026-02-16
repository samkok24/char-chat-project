/**
 * Repro/verify: "새로 대화" 진입 후 메시지 1회 전송했을 때
 * - 오프닝/첫대사 중복 노출이 없는지
 * - 내부 규칙/체크리스트/프로토콜(예: Final check, Names:, Tone:, AND, stat id 등) 누출이 없는지
 *
 * Usage:
 *   node tools/repro-meta-leak.js
 *
 * Optional env:
 *   FRONT=http://localhost:5173
 *   API=http://localhost:8000
 *   CHAR_IDS=uuid1,uuid2,...
 *   JWT_SECRET=...
 */

const { chromium } = require('playwright');
const crypto = require('crypto');

const FRONT = process.env.FRONT || 'http://localhost:5173';
const API = process.env.API || 'http://localhost:8000';
const JWT_SECRET =
  process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-this-in-production';

// Prefer the character the user is testing; fall back to known public/dev chars.
const DEFAULT_CHAR_IDS = [
  '255833e3-35d2-4058-a128-8fac7ac39c6b',
  '4ce8007b-1785-429b-b178-8ad7d7398ca4',
  '8c0455a6-6d56-4afb-8ca5-31a14208afed',
];
const CHAR_IDS = (process.env.CHAR_IDS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const CHAR_ID_LIST = CHAR_IDS.length ? CHAR_IDS : DEFAULT_CHAR_IDS;

const META_LEAK_PATTERNS = [
  /final\s+check/i,
  /^\s*[-•*]\s*names?\s*:/i,
  /^\s*[-•*]\s*tone\s*:/i,
  /^\s*[-•*]\s*structure\s*:/i,
  /^\s*and\s*$/i,
  /\bstat\s*_?id\b/i,
  /cc_stat_delta/i,
  /situation\s*(?:-|→)\s*dialogue/i,
  /dialogue\s*(?:-|→)\s*question/i,
  /action\s*(?:-|→)\s*dialogue/i,
  /within\s+the\s+.+\s+constraints/i,
  /^\s*(?:i will|i'll)\b/i,
  /노출\s*위험/i,
];

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
  const v = await j('POST', `${API}/auth/verify-email`, { token: vtoken });
  if (!v.ok) throw new Error(`verify-email failed: ${v.status}`);

  const r = await j('POST', `${API}/auth/register`, {
    email,
    username,
    password,
    gender: 'male',
  });
  if (!r.ok) throw new Error(`register failed: ${r.status}`);

  const l = await j('POST', `${API}/auth/login`, { email, password });
  if (!l.ok) throw new Error(`login failed: ${l.status}`);

  return {
    email,
    username,
    accessToken: l.data?.access_token,
    refreshToken: l.data?.refresh_token,
    userId: l.data?.user_id,
  };
}

async function clickFirstVisible(page, selectors) {
  for (const s of selectors) {
    const loc = page.locator(s).first();
    if ((await loc.count()) > 0) {
      try {
        if (await loc.isVisible({ timeout: 800 })) {
          await loc.scrollIntoViewIfNeeded().catch(() => {});
          await loc.click({ timeout: 5000 });
          return s;
        }
      } catch (_) {}
    }
  }
  return null;
}

async function waitForWsChatUrl(page, timeoutMs = 20000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (page.url().includes('/ws/chat/')) return true;
    await page.waitForTimeout(250);
  }
  return false;
}

function normalizeText(s) {
  return String(s || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim();
}

function findMetaLeaks(lines) {
  const hits = [];
  for (const line of lines) {
    const t = normalizeText(line);
    if (!t) continue;
    for (const rx of META_LEAK_PATTERNS) {
      if (rx.test(t)) {
        hits.push({ pattern: String(rx), text: t.slice(0, 200) });
        break;
      }
    }
  }
  return hits;
}

async function collectAssistantText(page) {
  // Centered narration boxes (intro + narration blocks)
  const introBoxes = page.locator('div.flex.justify-center div.rounded-md.text-center');
  // Assistant speech bubbles
  const assistantBubbles = page.locator('.cc-assistant-speech-bubble');

  const intro = [];
  const bubbles = [];

  const introCount = await introBoxes.count();
  for (let i = 0; i < Math.min(introCount, 30); i++) {
    const t = await introBoxes.nth(i).textContent().catch(() => '');
    intro.push(normalizeText(t));
  }

  const bubbleCount = await assistantBubbles.count();
  for (let i = 0; i < Math.min(bubbleCount, 30); i++) {
    const t = await assistantBubbles.nth(i).textContent().catch(() => '');
    bubbles.push(normalizeText(t));
  }

  return { intro, bubbles, introCount, bubbleCount };
}

function hasDuplicateExact(list, target) {
  if (!target) return false;
  const n = list.filter((x) => x === target).length;
  return n >= 2;
}

async function sendUserMessage(page, text) {
  const ta = page
    .locator('textarea[placeholder*="메시지"], textarea[placeholder*="!스탯"], textarea')
    .filter({ hasNot: page.locator('[disabled]') })
    .first();
  await ta.waitFor({ state: 'visible', timeout: 20000 });
  await ta.fill(text);

  const sendBtn = page.locator('button[title="전송"]:visible').first();
  if ((await sendBtn.count()) > 0) {
    try {
      if (await sendBtn.isEnabled({ timeout: 1000 })) {
        await sendBtn.click({ timeout: 5000 });
      } else {
        await ta.press('Enter');
      }
    } catch (_) {
      await ta.press('Enter');
    }
  } else {
    await ta.press('Enter');
  }
}

async function waitForAssistantGrowth(page, before, timeoutMs = 30000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    await page.waitForTimeout(500);
    const now = await collectAssistantText(page);
    if (now.introCount > before.introCount || now.bubbleCount > before.bubbleCount) return now;
  }
  return await collectAssistantText(page);
}

async function main() {
  const report = {
    startedAt: new Date().toISOString(),
    charId: null,
    charUrl: null,
    chatUrl: null,
    startButtonSelector: null,
    openingIntro: null,
    openingFirstLine: null,
    duplicateIntro: false,
    duplicateFirstLine: false,
    metaLeaks: [],
    consoleErrors: [],
    networkErrors: [],
    userMsg: null,
    lastAssistantIntro: null,
    lastAssistantBubble: null,
    screenshotPath: null,
    error: null,
  };

  let browser;
  try {
    const user = await createAndLoginUser();

    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    await context.addInitScript(
      ({ at, rt }) => {
        localStorage.setItem('access_token', at);
        localStorage.setItem('refresh_token', rt);
      },
      { at: user.accessToken, rt: user.refreshToken }
    );
    const page = await context.newPage();

    page.on('console', (msg) => {
      if (msg.type() === 'error') report.consoleErrors.push(msg.text());
    });
    page.on('requestfailed', (req) => {
      report.networkErrors.push({
        url: req.url(),
        error: req.failure()?.errorText || 'unknown',
      });
    });
    page.on('response', (res) => {
      if (res.status() >= 400) {
        report.networkErrors.push({ url: res.url(), error: `HTTP ${res.status()}` });
      }
    });

    // 1) Pick first accessible character
    let chosen = null;
    for (const cid of CHAR_ID_LIST) {
      const url = `${FRONT}/characters/${cid}`;
      await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
      await page.waitForTimeout(1200);
      const btn = page
        .locator('button:has-text("새로 대화"), button:has-text("대화 시작"), button:has-text("선택한 오프닝으로 새로 대화")')
        .first();
      const ok = (await btn.count()) > 0 && (await btn.isVisible().catch(() => false));
      if (ok) {
        chosen = { cid, url };
        break;
      }
    }
    if (!chosen) throw new Error('No accessible character page with a start button.');

    report.charId = chosen.cid;
    report.charUrl = chosen.url;

    // 2) Start chat
    report.startButtonSelector = await clickFirstVisible(page, [
      'button:has-text("대화 시작")',
      'button:has-text("새로 대화")',
      'button:has-text("선택한 오프닝으로 새로 대화")',
    ]);
    await waitForWsChatUrl(page, 25000);
    report.chatUrl = page.url();

    // 3) Wait a bit for opening to render, then snapshot opening texts
    await page.waitForTimeout(6000);
    const before = await collectAssistantText(page);
    report.openingIntro = before.intro[0] || null;
    report.openingFirstLine = before.bubbles[0] || null;
    report.duplicateIntro = hasDuplicateExact(before.intro, report.openingIntro);
    report.duplicateFirstLine = hasDuplicateExact(before.bubbles, report.openingFirstLine);

    // 4) Send one user message, then wait for assistant to grow
    const userMsg = process.env.USER_MSG || `meta_leak_test_${Date.now()}`;
    report.userMsg = userMsg;
    await sendUserMessage(page, userMsg);
    const after = await waitForAssistantGrowth(page, before, 35000);

    const allLines = [...after.intro, ...after.bubbles];
    report.metaLeaks = findMetaLeaks(allLines);
    report.duplicateIntro = report.duplicateIntro || hasDuplicateExact(after.intro, report.openingIntro);
    report.duplicateFirstLine =
      report.duplicateFirstLine || hasDuplicateExact(after.bubbles, report.openingFirstLine);

    report.lastAssistantIntro = after.intro.length ? after.intro[after.intro.length - 1] : null;
    report.lastAssistantBubble = after.bubbles.length ? after.bubbles[after.bubbles.length - 1] : null;

    // 5) Screenshot for review
    const shot = `tools/_tmp_meta_leak_${Date.now()}.png`;
    await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
    report.screenshotPath = shot;

    await context.close();
    await browser.close();
  } catch (err) {
    report.error = String(err?.message || err);
    try {
      if (browser) await browser.close();
    } catch (_) {}
    process.exitCode = 1;
  }

  console.log(JSON.stringify(report, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
