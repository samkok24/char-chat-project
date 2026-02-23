/**
 * 2차 테스트: 간헐 오류 고확률 재현
 * A) 기본 반복 6회
 * B) 새로고침 레이스 6회
 * C) 빠른 재진입 6회
 */

const { chromium } = require('playwright');

const CHAR_URL = 'http://localhost:5173/characters/8ca0eacf-e3b7-407d-86d9-24cd5f73d8bb';

async function runScenario(context, scenarioId, iterations, runFn) {
  const page = await context.newPage();
  const roundResults = [];
  const roundConsole = [];
  const roundNetwork = [];

  page.on('console', (msg) => {
    const t = msg.type();
    if (t === 'error' || t === 'warning') {
      roundConsole.push({ type: t, text: msg.text() });
    }
  });
  page.on('requestfailed', (req) => {
    roundNetwork.push({ url: req.url(), error: req.failure()?.errorText || 'unknown' });
  });
  page.on('response', (res) => {
    if (res.status() >= 400) {
      roundNetwork.push({ url: res.url(), error: `HTTP ${res.status()}` });
    }
  });

  for (let i = 0; i < iterations; i++) {
    const r = await runFn(page, i + 1, roundConsole, roundNetwork);
    r.scenario = scenarioId;
    r.round = (scenarioId === 'A' ? 0 : scenarioId === 'B' ? 6 : 12) + i + 1;
    roundResults.push(r);
    roundConsole.length = 0;
    roundNetwork.length = 0;
  }

  await page.close();
  return roundResults;
}

function parseUrlParams(url) {
  try {
    const u = new URL(url);
    return { new: u.searchParams.get('new'), room: u.searchParams.get('room') };
  } catch (_) {
    return { new: null, room: null };
  }
}

function observeSymptoms(page, observeMs) {
  return new Promise(async (resolve) => {
    const out = {
      loadingSpinnerLingering: false,
      openingOrderWrong: false,
      messageDisappeared: false,
      errorMessageShown: false,
      inputLocked: false,
      ghostLoading: false,
    };

    let introSeen = null;
    let greetingSeen = null;
    let hadMsg = false;

    for (let t = 0; t < observeMs; t += 250) {
      await page.waitForTimeout(250);

      const spinner = page.locator('.animate-spin').or(page.getByText('채팅을 준비하고 있어요')).first();
      const hasSpinner = await spinner.count() > 0 && await spinner.isVisible().catch(() => false);
      if (hasSpinner && t > observeMs * 0.6) out.loadingSpinnerLingering = true;
      if (hasSpinner && t > observeMs * 0.8) out.ghostLoading = true;

      const introBox = page.locator('div.flex.justify-center div.rounded-md.text-center').first();
      const hasIntro = await introBox.count() > 0 && await introBox.isVisible().catch(() => false);
      if (hasIntro && introSeen === null) introSeen = t / 1000;

      const greeting = page.locator('.cc-assistant-speech-bubble').first();
      const hasGreeting = await greeting.count() > 0 && await greeting.isVisible().catch(() => false);
      if (hasGreeting && greetingSeen === null) greetingSeen = t / 1000;
      if (hasGreeting) hadMsg = true;
      else if (hadMsg && t > 2000) out.messageDisappeared = true;

      const errText = page.locator('text=오류, text=스탯, text=상태창 오류, text=연결에 실패').first();
      if (await errText.count() > 0 && await errText.isVisible().catch(() => false)) out.errorMessageShown = true;

      const input = page.locator('textarea').first();
      const disabled = await input.getAttribute('aria-disabled').catch(() => null);
      if (disabled === 'true' && t > 5000) out.inputLocked = true;
    }

    if (introSeen != null && greetingSeen != null && greetingSeen < introSeen - 0.2) out.openingOrderWrong = true;
    resolve(out);
  });
}

async function scenarioA(page, iterNum, _con, _net) {
  await page.goto(CHAR_URL, { waitUntil: 'networkidle', timeout: 15000 });
  await page.waitForTimeout(1000);

  const btn = page.locator('button:has-text("새로 대화"), button:has-text("대화 시작")').first();
  await btn.scrollIntoViewIfNeeded().catch(() => {});
  await btn.click();

  await page.waitForURL(/\/ws\/chat\//, { timeout: 12000 }).catch(() => {});
  await page.waitForTimeout(500);

  const url = page.url();
  const symptoms = await observeSymptoms(page, 6000);

  const reproduced = symptoms.loadingSpinnerLingering || symptoms.openingOrderWrong ||
    symptoms.messageDisappeared || symptoms.errorMessageShown || symptoms.inputLocked;

  const symptomList = [];
  if (symptoms.loadingSpinnerLingering) symptomList.push('스피너 잔류');
  if (symptoms.openingOrderWrong) symptomList.push('지문/첫대사 순서 꼬임');
  if (symptoms.messageDisappeared) symptomList.push('메시지 사라짐');
  if (symptoms.errorMessageShown) symptomList.push('오류문구');
  if (symptoms.inputLocked) symptomList.push('입력창 잠금');
  if (symptomList.length === 0) symptomList.push('이상 없음');

  return {
    reproduced,
    symptoms: symptomList.join(', '),
    urlParams: parseUrlParams(url),
    consoleSummary: _con.slice(-3).map((c) => c.text?.slice(0, 80)).join(' | ') || '-',
    networkSummary: _net.filter((n) => /localhost|127\.0\.0\.1|api|socket|ws/.test(n.url || '')).map((n) => n.error).join(', ') || '-',
  };
}

async function scenarioB(page, iterNum, _con, _net) {
  await page.goto(CHAR_URL, { waitUntil: 'networkidle', timeout: 15000 });
  await page.waitForTimeout(800);

  const btn = page.locator('button:has-text("새로 대화"), button:has-text("대화 시작")').first();
  await btn.scrollIntoViewIfNeeded().catch(() => {});
  await btn.click();

  await page.waitForURL(/\/ws\/chat\//, { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(400 + Math.random() * 1100); // 0.4~1.5초(레이스 극대화)

  const urlBeforeRefresh = page.url();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);

  const symptoms = await observeSymptoms(page, 8000);

  const reproduced = symptoms.loadingSpinnerLingering || symptoms.openingOrderWrong ||
    symptoms.messageDisappeared || symptoms.errorMessageShown || symptoms.ghostLoading;

  const symptomList = [];
  if (symptoms.loadingSpinnerLingering) symptomList.push('스피너 잔류');
  if (symptoms.openingOrderWrong) symptomList.push('지문/첫대사 순서 꼬임');
  if (symptoms.messageDisappeared) symptomList.push('메시지 사라짐');
  if (symptoms.errorMessageShown) symptomList.push('오류문구');
  if (symptoms.ghostLoading) symptomList.push('유령 로딩');
  if (symptomList.length === 0) symptomList.push('이상 없음');

  return {
    reproduced,
    symptoms: symptomList.join(', '),
    urlParams: parseUrlParams(urlBeforeRefresh),
    consoleSummary: _con.slice(-3).map((c) => c.text?.slice(0, 80)).join(' | ') || '-',
    networkSummary: _net.filter((n) => /localhost|127\.0\.0\.1|api|socket|ws/.test(n.url || '')).map((n) => n.error).join(', ') || '-',
  };
}

async function scenarioC(page, iterNum, _con, _net) {
  await page.goto(CHAR_URL, { waitUntil: 'networkidle', timeout: 15000 });
  await page.waitForTimeout(800);

  const btn = page.locator('button:has-text("새로 대화"), button:has-text("대화 시작")').first();
  await btn.scrollIntoViewIfNeeded().catch(() => {});
  await btn.click();

  await page.waitForURL(/\/ws\/chat\//, { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(400 + Math.random() * 1100); // 0.4~1.5초(레이스 극대화)

  await page.goBack({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(150);

  await page.goto(CHAR_URL, { waitUntil: 'networkidle', timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(500);

  const btn2 = page.locator('button:has-text("새로 대화"), button:has-text("대화 시작")').first();
  await btn2.click();

  await page.waitForURL(/\/ws\/chat\//, { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(500);

  const url = page.url();
  const symptoms = await observeSymptoms(page, 6000);

  const reproduced = symptoms.loadingSpinnerLingering || symptoms.openingOrderWrong ||
    symptoms.messageDisappeared || symptoms.errorMessageShown || symptoms.inputLocked;

  const symptomList = [];
  if (symptoms.loadingSpinnerLingering) symptomList.push('스피너 잔류');
  if (symptoms.openingOrderWrong) symptomList.push('지문/첫대사 순서 꼬임');
  if (symptoms.messageDisappeared) symptomList.push('메시지 사라짐');
  if (symptoms.errorMessageShown) symptomList.push('오류문구');
  if (symptoms.inputLocked) symptomList.push('입력창 잠금');
  if (symptomList.length === 0) symptomList.push('이상 없음');

  return {
    reproduced,
    symptoms: symptomList.join(', '),
    urlParams: parseUrlParams(url),
    consoleSummary: _con.slice(-3).map((c) => c.text?.slice(0, 80)).join(' | ') || '-',
    networkSummary: _net.filter((n) => /localhost|127\.0\.0\.1|api|socket|ws/.test(n.url || '')).map((n) => n.error).join(', ') || '-',
  };
}

async function main() {
  let browser;
  const allResults = [];

  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    await context.setDefaultTimeout(20000);

    const resA = await runScenario(context, 'A', 6, scenarioA);
    allResults.push(...resA);

    const resB = await runScenario(context, 'B', 6, scenarioB);
    allResults.push(...resB);

    const resC = await runScenario(context, 'C', 6, scenarioC);
    allResults.push(...resC);

    await browser.close();
  } catch (e) {
    console.error(e);
    if (browser) await browser.close().catch(() => {});
  }

  printReport(allResults);
}

function printReport(results) {
  const total = results.length;
  const reproduced = results.filter((r) => r.reproduced);
  const n = reproduced.length;

  const firstRepro = reproduced[0];
  const byScenario = { A: [], B: [], C: [] };
  results.forEach((r) => byScenario[r.scenario].push(r));

  console.log('\n========== 2차 테스트: 간헐 오류 고확률 재현 ==========\n');

  console.log('1) 총 재현률:', n + '/' + total, n > 0 ? '(재현됨)' : '(재현 안됨)\n');

  console.log('2) 시나리오별 재현률:');
  console.log('   A) 기본 반복:', byScenario.A.filter((r) => r.reproduced).length + '/6');
  console.log('   B) 새로고침 레이스:', byScenario.B.filter((r) => r.reproduced).length + '/6');
  console.log('   C) 빠른 재진입:', byScenario.C.filter((r) => r.reproduced).length + '/6\n');

  console.log('3) 최초 재현 회차의 정확한 단계:');
  if (firstRepro) {
    console.log('   회차:', firstRepro.round);
    console.log('   시나리오:', firstRepro.scenario);
    console.log('   증상:', firstRepro.symptoms);
    console.log('   URL params:', JSON.stringify(firstRepro.urlParams));
    console.log('   콘솔:', firstRepro.consoleSummary);
    console.log('   네트워크:', firstRepro.networkSummary);
  } else {
    console.log('   없음 (미재현)\n');
  }

  console.log('\n4) 공통 패턴:');
  const symptomCounts = {};
  reproduced.forEach((r) => {
    r.symptoms.split(', ').forEach((s) => {
      if (s !== '이상 없음') symptomCounts[s] = (symptomCounts[s] || 0) + 1;
    });
  });
  if (Object.keys(symptomCounts).length > 0) {
    console.log('   ', Object.entries(symptomCounts).map(([k, v]) => `${k}: ${v}회`).join(', '));
  } else {
    console.log('   없음');
  }

  console.log('\n5) 코드 레벨 원인 후보:');
  if (n > 0) {
    if (reproduced.some((r) => r.scenario === 'B')) {
      console.log('   - SocketContext: refresh 직후 message_history/joinRoom 레이스 → desiredRoomIdRef vs 이전 room 이벤트');
      console.log('   - ChatPage: uiOpeningStage/loading 상태가 refresh 후 초기화되며 "유령 로딩" 또는 메시지 덮어쓰기');
    }
    if (reproduced.some((r) => r.scenario === 'C')) {
      console.log('   - SocketContext: 빠른 leaveRoom→joinRoom 시 이전 room의 message_history가 새 room에 섞임 (desiredRoomIdRef 갱신 타이밍)');
      console.log('   - ChatPage: loading/historyLoading이 이전 방 기준으로 잔류');
    }
  } else {
    console.log('   - 18회 미재현: 레이스/타이밍 의존 버그로 추정, 실기기/느린 네트워크 권장');
  }

  console.log('\n6) 바로 적용 가능한 최소 수정안:');
  if (n > 0) {
    if (reproduced.some((r) => r.scenario === 'B')) {
      console.log('   - ChatPage: location.reload 전 sessionStorage에 "cc:chat:reloading:v1" 플래그 저장 → 마운트 시 즉시 historyLoading=false + 오버레이 해제');
      console.log('   - SocketContext: room_joined 시 desiredRoomIdRef를 즉시 갱신하고, message_history 수신 시 roomId 불일치 시 무시(기존) + 이전 응답의 stale 방지');
    }
    if (reproduced.some((r) => r.scenario === 'C')) {
      console.log('   - SocketContext joinRoom: leaveRoom 호출 시 desiredRoomIdRef를 null로 초기화 → 새 join 시에만 설정');
      console.log('   - ChatPage: 뒤로가기 시 즉시 setMessages([]) + historyLoading 초기화로 이전 방 잔여 상태 제거');
    }
  } else {
    console.log('   - 재현률 0/18: 수정안 적용 전 추가 재현 시도 권장');
  }

  console.log('\n--- 회차별 상세 ---');
  results.forEach((r) => {
    const tag = r.reproduced ? '[Y]' : '[N]';
    console.log(`   ${r.round}회(${r.scenario}) ${tag} ${r.symptoms} | new=${r.urlParams?.new} room=${r.urlParams?.room}`);
  });

  console.log('\n========================================================\n');
}

main().catch(console.error);
