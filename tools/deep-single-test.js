/**
 * 단발 테스트 1회 - 진득하게 관찰 (30초)
 * URL: http://localhost:5173/characters/8ca0eacf-e3b7-407d-86d9-24cd5f73d8bb
 */

const { chromium } = require('playwright');

const CHAR_URL = 'http://localhost:5173/characters/8ca0eacf-e3b7-407d-86d9-24cd5f73d8bb';
const OBSERVE_MS = 30000;
const CHECK_INTERVAL_MS = 5000;

async function main() {
  const timeline = [];
  const consoleLog = [];
  const networkFails = [];
  let introFirst = null;
  let greetingFirst = null;
  let msgDisappeared = false;
  let params = { new: null, room: null };

  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

    page.on('console', (msg) => {
      const t = msg.type();
      const text = msg.text();
      if (t === 'error' || t === 'warning') {
        consoleLog.push({ type: t, text, at: Date.now() });
      }
    });
    page.on('requestfailed', (req) => {
      networkFails.push({ url: req.url(), error: req.failure()?.errorText || 'unknown' });
    });
    page.on('response', (res) => {
      if (res.status() >= 400) {
        networkFails.push({ url: res.url(), error: `HTTP ${res.status()}` });
      }
    });

    const t0 = Date.now();

    // 1) 페이지 진입
    await page.goto(CHAR_URL, { waitUntil: 'networkidle', timeout: 20000 });
    timeline.push({ t: (Date.now() - t0) / 1000, note: '캐릭터 상세 페이지 진입' });

    // 2) 5초 대기
    await page.waitForTimeout(5000);
    timeline.push({ t: 5, note: '5초 대기 완료' });

    // 3) 새로대화 클릭
    const btn = page.locator('button:has-text("새로 대화"), button:has-text("대화 시작")').first();
    await btn.scrollIntoViewIfNeeded().catch(() => {});
    await btn.click();
    const tClick = Date.now();

    await page.waitForURL(/\/ws\/chat\//, { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(500);

    const url = page.url();
    try {
      const u = new URL(url);
      params = { new: u.searchParams.get('new'), room: u.searchParams.get('room') };
    } catch (_) {}

    timeline.push({ t: (Date.now() - t0) / 1000, note: `채팅 진입 (new=${params.new}, room=${params.room})` });

    // 4) 30초 관찰 (5초 간격 체크)
    let lastHadMsg = false;
    for (let elapsed = 0; elapsed < OBSERVE_MS; elapsed += CHECK_INTERVAL_MS) {
      await page.waitForTimeout(CHECK_INTERVAL_MS);
      const t = (Date.now() - t0) / 1000;

      const spinner = page.locator('.animate-spin').or(page.getByText('채팅을 준비하고 있어요')).first();
      const hasSpinner = await spinner.count() > 0 && await spinner.isVisible().catch(() => false);

      const introBox = page.locator('div.flex.justify-center div.rounded-md.text-center').first();
      const hasIntro = await introBox.count() > 0 && await introBox.isVisible().catch(() => false);
      if (hasIntro && introFirst === null) introFirst = t;

      const greeting = page.locator('.cc-assistant-speech-bubble').first();
      const hasGreeting = await greeting.count() > 0 && await greeting.isVisible().catch(() => false);
      if (hasGreeting && greetingFirst === null) greetingFirst = t;
      if (hasGreeting) lastHadMsg = true;
      else if (lastHadMsg) msgDisappeared = true;

      const errEl = page.locator('text=오류, text=연결에 실패, text=스탯, text=상태창').first();
      const hasErr = await errEl.count() > 0 && await errEl.isVisible().catch(() => false);

      const input = page.locator('textarea').first();
      const inputDisabled = await input.getAttribute('aria-disabled').catch(() => null) === 'true';

      const checkpoint = {
        t: Math.round(t * 10) / 10,
        spinner: hasSpinner,
        intro: hasIntro,
        greeting: hasGreeting,
        msgDisappeared,
        inputDisabled,
        error: hasErr,
      };

      timeline.push({
        t: checkpoint.t,
        note: [
          checkpoint.spinner ? '스피너' : '-',
          checkpoint.intro ? '지문' : '-',
          checkpoint.greeting ? '첫대사' : '-',
          checkpoint.msgDisappeared ? '메시지사라짐' : '-',
          checkpoint.inputDisabled ? '입력잠금' : '-',
          checkpoint.error ? '오류문구' : '-',
        ].join(' | '),
      });
    }

    await browser.close();
  } catch (err) {
    timeline.push({ t: -1, note: `예외: ${err.message}` });
    if (browser) await browser.close().catch(() => {});
  }

  printReport(timeline, introFirst, greetingFirst, msgDisappeared, params, consoleLog, networkFails);
}

function printReport(timeline, introFirst, greetingFirst, msgDisappeared, params, consoleLog, networkFails) {
  const appNet = networkFails.filter((n) => /localhost|127\.0\.0\.1|api|socket|ws/.test(n.url || ''));

  console.log('\n========== 단발 테스트 1회 (30초 관찰) ==========\n');

  console.log('■ 타임라인(초 단위)');
  timeline.forEach((e) => {
    const ts = e.t >= 0 ? `${e.t.toFixed(1)}초` : '예외';
    console.log(`  ${ts}: ${e.note}`);
  });

  console.log('\n■ 콘솔 요약');
  if (consoleLog.length > 0) {
    const unique = [...new Set(consoleLog.map((c) => c.text?.slice(0, 120)))];
    unique.slice(0, 5).forEach((t) => console.log('  ', t));
  } else {
    console.log('  없음');
  }

  console.log('\n■ 네트워크 요약');
  if (appNet.length > 0) {
    appNet.slice(0, 5).forEach((n) => console.log(`  ${n.error}: ${n.url?.slice(0, 80)}`));
  } else {
    console.log('  없음 (앱 관련)');
  }
  if (networkFails.length > 0 && appNet.length === 0) {
    console.log('  (외부 실패', networkFails.length, '건)');
  }

  console.log('\n■ 관찰 정리');
  console.log('  - 지문 첫 노출:', introFirst != null ? introFirst.toFixed(1) + '초' : '없음');
  console.log('  - 첫대사 첫 노출:', greetingFirst != null ? greetingFirst.toFixed(1) + '초' : '없음');
  console.log('  - 순서:', introFirst != null && greetingFirst != null && greetingFirst >= introFirst ? '지문→첫대사' : '확인필요');
  console.log('  - 메시지 사라짐:', msgDisappeared ? '있음' : '없음');
  console.log('  - URL params:', `new=${params.new}, room=${params.room}`);

  const hasIssue = timeline.some((e) => e.note?.includes('스피너') && parseFloat(e.t) > 10) ||
    msgDisappeared ||
    timeline.some((e) => e.note?.includes('오류문구'));

  console.log('\n■ 결론');
  console.log('  문제 재현:', hasIssue ? '재현됨' : '재현 안됨 (정상)');
  console.log('\n================================================\n');
}

main().catch(console.error);
