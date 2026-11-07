const { chromium } = require('playwright');
const fs = require('fs'); const path = require('path');
const SP = __dirname, SIM = fs.readFileSync(path.join(SP, 'sim.js'), 'utf8');
const URL = process.env.VIBRO_URL || 'http://127.0.0.1:8765/index.html';
const OUT = path.join(__dirname, 'out'); fs.mkdirSync(OUT, { recursive: true });   // screenshots (git-ignored)
const ANDROID = 'Mozilla/5.0 (Linux; Android 15; Infinix X6870) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0.7390.96 Mobile/15E148 Safari/604.1';
const IPAD = 'Mozilla/5.0 (iPad; CPU OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0.7390.96 Mobile/15E148 Safari/604.1';
const IPAD_DESKTOP = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15';
let failures = 0; const check = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) failures++; };
async function open(browser, ua, sim, settings) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, userAgent: ua });
  await ctx.addInitScript({ content: SIM + `;window.__SIM_INIT(${JSON.stringify(sim)});` + (settings ? `localStorage.setItem('vibroscale.settings.v1', ${JSON.stringify(JSON.stringify(settings))});` : '') });
  const page = await ctx.newPage();
  page.on('pageerror', e => { console.log('[pageerror]', e.message); failures++; });
  page.on('dialog', d => d.accept());
  await page.goto(URL);
  return { ctx, page };
}
const idle = p => p.waitForFunction(() => !document.body.hasAttribute('data-busy'), null, { timeout: 120000 });
const S0 = { duration: 2000, delay: 0, source: 'auto', sound: false };
(async () => {
  const browser = await chromium.launch();

  // 1. iPad (both UA styles) → not iPhone mode
  for (const [name, ua] of [['iPad', IPAD], ['iPad desktop-UA', IPAD_DESKTOP]]) {
    const ctx = await browser.newContext({ viewport: { width: 820, height: 1180 }, hasTouch: true, userAgent: ua });
    await ctx.addInitScript({ content: SIM + `;window.__SIM_INIT({ios:true, mode:'devicemotion'});Object.defineProperty(navigator,'maxTouchPoints',{get:()=>5});` });
    const p = await ctx.newPage(); await p.goto(URL);
    const b = await p.textContent('#banners');
    check(/can’t make the phone vibrate/.test(b) && !/iPhone mode/.test(b), `${name}: no iPhone mode, clear "can't vibrate" banner`);
    await ctx.close();
  }

  // 2. hub concurrency: Start sensor, then Measure before the first reading → no leaked sensor
  {
    const { ctx, page } = await open(browser, ANDROID, { startDelay: 1200 }, S0);
    await page.click('#nav-help'); await page.click('#diagDetails summary'); await page.click('#diagBtn'); await page.waitForTimeout(150);
    await page.click('#nav-measure'); await page.click('#measureBtn');
    await page.waitForTimeout(300); await idle(page);
    const r = await page.evaluate(() => ({ active: window.__sim.activeSensors, res: !!window.VibroScale.lastResult, err: document.getElementById('measMsg').textContent }));
    check(r.res && !r.err, 'Measure started during sensor start-up completes normally' + (r.err ? ' — ' + r.err : ''));
    check(r.active === 0, `no sensor left running after the session (active: ${r.active})`);
    await ctx.close();
  }
  // 3. Stop → Start during start-up → exactly one sensor, then 0 after Stop
  {
    const { ctx, page } = await open(browser, ANDROID, { startDelay: 1000 }, S0);
    await page.click('#nav-help'); await page.click('#diagDetails summary');
    await page.click('#diagBtn'); await page.waitForTimeout(100); await page.click('#diagBtn'); await page.waitForTimeout(100); await page.click('#diagBtn');
    await page.waitForTimeout(2500);
    const a = await page.evaluate(() => ({ active: window.__sim.activeSensors, btn: document.getElementById('diagBtn').textContent, rate: document.getElementById('diagLive').textContent, err: document.getElementById('diagMsg').textContent }));
    check(a.active === 1 && /Stop sensor/.test(a.btn) && /Sample rate\s*\d/.test(a.rate) && !a.err, `Start/Stop/Start race → one live sensor (active ${a.active})${a.err ? ' err: ' + a.err : ''}`);
    await page.click('#diagBtn'); await page.waitForTimeout(300);
    check(await page.evaluate(() => window.__sim.activeSensors) === 0, 'Stop releases it');
    await ctx.close();
  }
  // 4. wake lock not leaked when cancelling during sensor start-up
  {
    const { ctx, page } = await open(browser, ANDROID, { startDelay: 800, mockWakeLock: true, wakeDelay: 400 }, Object.assign({}, S0, { delay: 3 }));
    await page.click('#measureBtn'); await page.waitForTimeout(950); await page.click('#ovCancel'); // cancel right after sensor starts
    await idle(page); await page.waitForTimeout(800);
    const w = await page.evaluate(() => ({ held: window.__sim.locksHeld, status: document.getElementById('measStatus').textContent }));
    check(w.held === 0, `no wake lock held after cancel (held ${w.held}, status "${w.status}")`);
    // and a normal session holds it during, releases after
    await page.click('#measureBtn'); await page.waitForTimeout(1500);
    const during = await page.evaluate(() => window.__sim.locksHeld);
    await page.click('#ovCancel'); await idle(page); await page.waitForTimeout(300);
    check(during === 1 && await page.evaluate(() => window.__sim.locksHeld) === 0, `wake lock held during a session (${during}) and released after`);
    await ctx.close();
  }
  // 5. Test vibration locks Measure/Calibrate
  {
    const { ctx, page } = await open(browser, ANDROID, {}, S0);
    await page.click('#nav-help'); await page.click('#diagDetails summary'); await page.click('#diagVibBtn'); await page.waitForTimeout(300);
    const st = await page.evaluate(() => ({ m: document.getElementById('measureBtn').disabled, c: document.getElementById('calMeasureBtn').disabled, seg: document.querySelector('.seg button').disabled }));
    check(st.m && st.c && st.seg, 'during Test vibration: Measure, Calibrate and settings are disabled');
    await page.waitForFunction(() => /Works|felt/.test(document.getElementById('diagLive').textContent), null, { timeout: 15000 });
    check(await page.evaluate(() => !document.getElementById('measureBtn').disabled), 'Measure re-enabled after the test');
    // 6. parseWeight
    const pw = await page.evaluate(() => ['1,000', '12,500', '12,5', '1000', '٫5', '2.5g'].map(window.VibroScale.parseWeight));
    check(JSON.stringify(pw) === JSON.stringify([null, null, 12.5, 1000, 0.5, 2.5]), 'parseWeight refuses "1,000"-style input, keeps decimals: ' + JSON.stringify(pw));
    await ctx.close();
  }
  // 7. calibration from the other excitation type → warning
  {
    const { ctx, page } = await open(browser, ANDROID, {}, S0);
    await page.evaluate(() => {
      const pts = [0, 50, 150, 300].map(w => { const m = 1.4 / (1 + w / 160); return { w, mean: m, amps: [m, m, m], sd: m * 0.01, fs: 62, orient: 'down', kind: 'generic', dur: 2000, exc: 'taps' }; });
      localStorage.setItem('vibroscale.calibration.v1', JSON.stringify({ version: 1, points: pts }));
    });
    await page.reload(); await page.evaluate(() => { window.__sim.weight = 100; });
    await page.click('#measureBtn'); await page.waitForTimeout(200); await idle(page);
    check(/made with haptic taps \(iPhone, experimental\), but this device uses motor/.test(await page.textContent('#resWarnings')), 'excitation mismatch warning shown');
    await ctx.close();
  }
  // 8. iPhone: Generic Sensor option disabled; sign normalised (z<0 with "screen down")
  {
    const { ctx, page } = await open(browser, IPHONE, { ios: true, mode: 'devicemotion' }, Object.assign({}, S0, { source: 'generic' }));
    await page.click('#nav-help');
    const seg = await page.evaluate(() => [...document.querySelectorAll('.seg[data-setting="source"] button')].map(b => [b.textContent, b.disabled, b.getAttribute('aria-checked')]));
    check(seg[1][1] === true && seg[0][2] === 'true', 'iPhone: Generic Sensor option disabled, stored "generic" falls back to Auto ' + JSON.stringify(seg));
    await page.click('#diagDetails summary'); await page.click('#diagBtn'); await page.waitForTimeout(800);
    const live = await page.textContent('#diagLive');
    check(/-9\.\d\d\s*Orientation|-9\.\d\d.*screen down/.test(live.replace(/\s+/g, ' ')) || (/\/ -9\.\d\d/.test(live) && /screen down/.test(live)), 'iPhone: z normalised (≈ −9.8 with "screen down"): ' + live.replace(/\s+/g, ' ').slice(0, 120));
    await ctx.close();
  }
  await browser.close();
  console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL FIX CHECKS PASSED');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
