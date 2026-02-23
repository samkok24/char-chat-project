/**
 * 단발 테스트 1회: 30초 진득한 관찰
 * URL: http://localhost:5173/characters/8ca0eacf-e3b7-407d-86d9-24cd5f73d8bb
 */

const { chromium } = require('playwright');

const CHAR_URL = 'http://localhost:5173/characters/8ca0eacf-e3b7-407d-86d9-24cd5f73d8bb';

async function main() {
  const timeline = [];
  const consoleLog = [];
  const networkFails = [];

  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    page.on('console', (msg) => {
      const t = msg.type();
      if (t === 'error' || t === 'warning') {
        consoleLog.push({ type: t, text: msg.text() });
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
    const log = (sec, label, details) => {
      const s = ((Date.now() - t0) / 1000).toFixed(1);
      timeline.push({ sec: s, label, details });
    };

    // 1) 페이지 진입
    await page.goto(CHAR_URL, { waitUntil: 'networkidle', timeout: 20000 });
    log(0, '페이지 진입', '캐릭터 상세 로드 완료');

    // 2) 5초 대기
    await page.waitForTimeout(5000);
    log(5, '5초 대기 완료', '새로대화 버튼 대기');

    // 3) 새로대화 클릭
    const btn = page.locator('button:has-text("새로 대화"), button:has-text("대화 시작")').first();
    await btn.scrollIntoViewIfNeeded().catch(() => {});
    await btn.click();
    log(5, '새로대화 클릭', '채팅 페이지 전환 대기');

    await page.waitForURL(/\/ws\/chat\//, { timeout: 15000 }).catch(() => {});
    const urlAfterClick = page.url();
    const params = (() => {
      try {
        const u = new URL(urlAfterClick);
        return { new: u.searchParams.get('new'), room: u.searchParams.get('room') };
      } catch (_) {
        return { new: null, room: null };
      }
    })();
    log(5, '채팅 진입', `URL params: new=${params.new}, room=${params.room}`);

    // 4) 30초 관찰 (5초 간격 6회 체크)
    let introSeenAt = null;
    let greetingSeenAt = null;
    let hadMsgOnce = false;
    const checkpoints = [];

    for (let i = 0; i < 6; i++) {
      await page.waitForTimeout(5000);
      const elapsed = 10 + (i + 1) * 5;
      const t = (Date.now() - t0) / 1000;

      const spinner = page.locator('.animate-spin').or(page.getByText('채팅을 준비하고 있어요')).first();
      const hasSpinner = await spinner.count() > 0 && await spinner.isVisible().catch(() => false);

      const introBox = page.locator('div.flex.justify-center div.rounded-md.text-center').first();
      const hasIntro = await introBox.count() > 0 && await introBox.isVisible().catch(() => false);
      if (hasIntro && introSeenAt === null) introSeenAt = t;

      const greeting = page.locator('.cc-assistant-speech-bubble').first();
      const hasGreeting = await greeting.count() > 0 && await greeting.isVisible().catch(() => false);
      if (hasGreeting && greetingSeenAt === null) greetingSeenAt = t;
      if (hasGreeting) hadMsgOnce = true;

      const errEl = page.locator('text=오류, text=스탯, text=상태창 오류, text=연결에 실패').first();
      const hasErr = await errEl.count() > 0 && await errEl.isVisible().catch(() => false);

      const input = page.locator('textarea').first();
      const ariaDisabled = await input.getAttribute('aria-disabled').catch(() => null);
      const inputLocked = ariaDisabled === 'true';

      const cp = {
        sec: elapsed,
        spinner: hasSpinner,
        intro: hasIntro,
        greeting: hasGreeting,
        error: hasErr,
        inputLocked,
      };
      checkpoints.push(cp);

      const details = [
        cp.spinner ? '스피너 있음' : '스피너 없음',
        cp.intro ? '지문 있음' : '지문 없음',
        cp.greeting ? '첫대사 있음' : '첫대사 없음',
        cp.error ? '오류문구 있음' : '오류 없음',
        cp.inputLocked ? '입력창 잠금' : '입력창 활성',
      ].join(', ');
      log(elapsed, `${elapsed}초 체크포인트`, details);
    }

    // 메시지 사라짐: 관찰 중 한 번이라도 greeting이 사라졌다가 다시 나타났는지
    let messageDisappeared = false;
    for (let i = 1; i < checkpoints.length; i++) {
      if (checkpoints[i - 1].greeting && !checkpoints[i].greeting && checkpoints[i].intro) {
        messageDisappeared = true;
        break;
      }
    }

    const orderCorrect = introSeenAt == null || greetingSeenAt == null || introSeenAt <= greetingSeenAt;
    const problemReproduced =
      checkpoints.some((c) => c.spinner && c.sec >= 20) ||
      !orderCorrect ||
      messageDisappeared ||
      checkpoints.some((c) => c.error) ||
      checkpoints.some((c) => c.inputLocked && c.sec >= 20);

    await browser.close();

    // 출력
    console.log('\n========== 단발 테스트 1회: 30초 진득한 관찰 ==========\n');

    console.log('타임라인(초 단위):');
    timeline.forEach(({ sec, label, details }) => {
      console.log(`  ${sec}s  ${label}: ${details}`);
    });

    console.log('\n분석 요약:');
    console.log(`  - 지문 첫 노출: ${introSeenAt != null ? introSeenAt.toFixed(1) + '초' : '없음'}`);
    console.log(`  - 첫대사 첫 노출: ${greetingSeenAt != null ? greetingSeenAt.toFixed(1) + '초' : '없음'}`);
    console.log(`  - 순서 정상: ${orderCorrect ? '예' : '아니오'}`);
    console.log(`  - 메시지 사라짐: ${messageDisappeared ? '있음' : '없음'}`);
    console.log(`  - 20초 이상 스피너 잔류: ${checkpoints.some((c) => c.spinner && c.sec >= 20) ? '예' : '아니오'}`);
    console.log(`  - 오류 문구 노출: ${checkpoints.some((c) => c.error) ? '예' : '아니오'}`);
    console.log(`  - 입력창 잠금(20초 이상): ${checkpoints.some((c) => c.inputLocked && c.sec >= 20) ? '예' : '아니오'}`);

    console.log('\nURL 쿼리:', JSON.stringify(params));

    console.log('\n콘솔 요약:');
    const uniqueCon = [...new Set(consoleLog.map((c) => c.text?.slice(0, 120)))].slice(0, 5);
    console.log(uniqueCon.length ? uniqueCon.join('\n  ') : '  없음');

    console.log('\n네트워크 요약:');
    const appNet = networkFails.filter((n) => /localhost|127\.0\.0\.1|api|socket|ws/.test(n.url || ''));
    const uniqueNet = [...new Set(appNet.map((n) => `${n.error}: ${(n.url || '').slice(0, 60)}`))].slice(0, 5);
    console.log(uniqueNet.length ? uniqueNet.join('\n  ') : '  없음');

    console.log('\n결론(문제 재현 여부):', problemReproduced ? '재현됨' : '문제 없음');

    console.log('\n========================================================\n');
  } catch (err) {
    console.error('실행 오류:', err);
    if (browser) await browser.close().catch(() => {});
  }
}

main().catch(console.error);
