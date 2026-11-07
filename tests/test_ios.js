const { chromium } = require('playwright');
const fs = require('fs'); const path = require('path');
const SP = __dirname, SIM = fs.readFileSync(path.join(SP, 'sim.js'), 'utf8');
const URL = process.env.VIBRO_URL || 'http://127.0.0.1:8765/index.html';
const OUT = path.join(__dirname, 'out'); fs.mkdirSync(OUT, { recursive: true });   // screenshots (git-ignored)
const IPHONE = v => `Mozilla/5.0 (iPhone; CPU iPhone OS ${v} like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0.7390.96 Mobile/15E148 Safari/604.1`;
let failures = 0; const check = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) failures++; };
async function open(browser, ua, sim) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, userAgent: ua });
  await ctx.addInitScript({ content: SIM + `;window.__SIM_INIT(${JSON.stringify(sim)});` });
  const page = await ctx.newPage();
  page.on('pageerror', e => { console.log('[pageerror]', e.message); failures++; });
  page.on('dialog', d => d.accept());
  await page.goto(URL);
  return { ctx, page };
}
const idle = p => p.waitForFunction(() => !document.body.hasAttribute('data-busy'), null, { timeout: 120000 });
(async () => {
  const browser = await chromium.launch();
  const { ctx, page } = await open(browser, IPHONE('18_5'), { mode: 'devicemotion', ios: true });
  check(await page.evaluate(() => typeof navigator.vibrate === 'undefined' && !('Accelerometer' in window)), 'iPhone sim: no Vibration API, no Generic Sensor');
  check(/iPhone mode \(experimental\)/.test(await page.textContent('#banners')), 'iPhone banner shown');
  await page.click('#nav-help');
  check(/haptic taps \(iPhone, experimental\)/.test(await page.textContent('#diagCaps')), 'diagnostics shows haptic-tap mode');
  check(await page.evaluate(() => JSON.parse(localStorage.getItem('vibroscale.settings.v1') || 'null') === null), 'no settings saved yet');
  check(/aria-checked="true">4 s</.test(await page.innerHTML('.seg[data-setting="duration"]')), 'iPhone default vibration length is 4 s');
  await page.click('#setDetails summary'); await page.click('.seg[data-setting="delay"] button:has-text("None")');
  await page.click('#diagDetails summary');
  await page.click('#diagVibBtn');
  await page.waitForFunction(() => /Works|felt/.test(document.getElementById('diagLive').textContent), null, { timeout: 15000 });
  const vt = await page.textContent('#diagLive');
  check(/✓ Works/.test(vt), 'tap test works: ' + (vt.match(/Result(.*)/) || [])[1]);
  check(await page.evaluate(() => window.__sim.taps !== undefined), 'taps hooked');
  await page.click('#nav-cal');
  for (const w of [0, 50, 150, 300]) {
    await page.evaluate(w => { window.__sim.weight = w; }, w);
    await page.fill('#calWeight', String(w)); await page.click('#calMeasureBtn'); await page.waitForTimeout(200); await idle(page);
    const m = await page.textContent('#calMsg'); if (!/Saved/.test(m)) console.log('  cal:', m);
  }
  const fit = await page.evaluate(() => window.VibroScale.fit);
  console.log(`  fit: ${fit.model} R² ${fit.r2.toFixed(4)} typical error ±${fit.rmseW.toFixed(1)} g`);
  check(fit.ok, 'iPhone calibration fitted');
  await page.click('#nav-measure');
  await page.evaluate(() => { window.__sim.weight = 100; });
  await page.click('#measureBtn'); await page.waitForTimeout(200); await idle(page);
  const r = await page.evaluate(() => window.VibroScale.lastResult);
  console.log(`  true 100 g → ${r.est.w.toFixed(1)} ± ${r.est.err.toFixed(1)} g (spread ${(r.cv * 100).toFixed(1)}%), warnings: ${r.warnings.map(w => w.k).join(',') || '-'}`);
  check(Math.abs(r.est.w - 100) < Math.max(3 * r.est.err, 15), '100 g estimated within tolerance in iPhone mode');
  check(r.orient === 'down', `iOS inverted axis handled: screen-down detected (got ${r.orient})`);
  check(!r.warnings.some(w => w.k === 'wOrient'), 'no false orientation warning');
  await page.screenshot({ path: path.join(OUT, 'ios-measure.png'), fullPage: true });
  await page.evaluate(() => { window.__sim.works = false; });
  await page.click('#measureBtn'); await page.waitForTimeout(200); await idle(page);
  check(/No haptic taps were felt/.test(await page.textContent('#measMsg')), 'no taps → iPhone-specific message');
  await page.click('#langBtn');
  check(/وضع الآيفون/.test(await page.textContent('#banners')), 'Arabic iPhone banner');
  await ctx.close();

  // silent DeviceMotion on iPhone → iOS-specific permission hint
  {
    const { ctx, page } = await open(browser, IPHONE('18_5'), { mode: 'devicemotion', ios: true, silent: true });
    await page.click('#nav-help'); await page.click('#setDetails summary'); await page.click('.seg[data-setting="delay"] button:has-text("None")'); await page.click('#nav-measure');
    await page.click('#measureBtn'); await page.waitForTimeout(200); await idle(page);
    check(/Tap “Allow” when asked for motion/.test(await page.textContent('#measMsg')), 'iPhone no-motion-data → Allow hint');
    await ctx.close();
  }
  // old iOS
  {
    const { ctx, page } = await open(browser, IPHONE('17_4'), { mode: 'devicemotion', ios: true });
    check(/needs iOS 18 or newer \(this phone has iOS 17\)/.test(await page.textContent('#banners')), 'iOS 17 → update-iOS banner');
    await page.click('#measureBtn');
    check(/needs iOS 18/.test(await page.textContent('#measMsg')), 'iOS 17 → Measure blocked with explanation');
    await ctx.close();
  }
  await browser.close();
  console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL iPHONE CHECKS PASSED');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
