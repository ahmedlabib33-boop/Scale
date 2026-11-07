const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const SP = __dirname;
const SIM = fs.readFileSync(path.join(SP, 'sim.js'), 'utf8');
const URL = process.env.VIBRO_URL || 'http://127.0.0.1:8765/index.html';
const OUT = path.join(__dirname, 'out'); fs.mkdirSync(OUT, { recursive: true });   // screenshots (git-ignored)
const UA = 'Mozilla/5.0 (Linux; Android 15; Infinix X6870) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36';

let failures = 0;
const check = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) failures++; };

async function newPage(browser, simOpts, extra = {}) {
  const ctx = await browser.newContext({ viewport: { width: 393, height: 851 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, userAgent: UA, ...extra });
  await ctx.addInitScript({ content: SIM + `;window.__SIM_INIT(${JSON.stringify(simOpts || {})});` });
  const page = await ctx.newPage();
  page.on('pageerror', e => { console.log('[pageerror]', e.message); failures++; });
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') console.log('[console.' + m.type() + ']', m.text()); });
  page.on('dialog', d => d.accept());
  await page.goto(URL);
  return { ctx, page };
}
const idle = page => page.waitForFunction(() => !document.body.hasAttribute('data-busy'), null, { timeout: 60000 });

(async () => {
  const browser = await chromium.launch();

  /* ---------- math unit checks ---------- */
  {
    const { ctx, page } = await newPage(browser, {});
    const r = await page.evaluate(() => {
      const V = window.VibroScale, out = {};
      const mk = (f, ws) => ws.map(w => ({ w, mean: f(w), sd: 0 }));
      const ws = [0, 20, 50, 100, 200, 300];
      out.lin = V.fitCalibration(mk(w => 2 - 0.004 * w, ws));
      out.inv = V.fitCalibration(mk(w => 1 / (0.7 + 0.0045 * w), ws));
      out.exp = V.fitCalibration(mk(w => 1.5 * Math.exp(-0.004 * w), ws));
      out.need = V.fitCalibration(mk(w => 1, [10, 20]));
      out.flat2 = V.fitCalibration(mk(w => 1, [0, 10]));
      out.quick = V.fitCalibration(mk(w => 1.4 / (1 + w / 193), [0]), 193);
      out.quickEst = V.estimateWeight(out.quick, 1.4 / (1 + 100 / 193), 0);
      out.basic = V.fitCalibration(mk(w => 1.4 / (1 + w / 150), [0, 50]), 193);
      out.basicEst = V.estimateWeight(out.basic, 1.4 / (1 + 100 / 150), 0);
      out.flat = V.fitCalibration(mk(w => 1, [0, 10, 20]));
      out.estInv = V.estimateWeight(out.inv, 1 / (0.7 + 0.0045 * 75), 0);
      out.parse = ['12.5', '١٢٫٥', '12,5', ' 50 g', '7جم', '-3', 'abc', ''].map(V.parseWeight);
      return JSON.parse(JSON.stringify(out));
    });
    check(r.lin.ok && r.lin.model === 'linear' && r.lin.r2 > 0.999999, `linear data → linear model (got ${r.lin.model}, R² ${r.lin.r2})`);
    check(r.inv.ok && r.inv.model === 'inverse' && r.inv.r2 > 0.999999, `1/x data → inverse model (got ${r.inv.model}, R² ${r.inv.r2})`);
    check(r.exp.ok && r.exp.model === 'exponential' && r.exp.r2 > 0.999999, `exp data → exponential model (got ${r.exp.model}, R² ${r.exp.r2})`);
    check(!r.need.ok && r.need.reason === 'fitNeed', 'two weights without an empty reading → needs more points');
    check(r.flat2.ok && r.flat2.level === 'quick' && r.flat2.problem === 'fitFlat', 'empty + 1 bad weight → falls back to quick model, problem reported');
    check(r.quick.ok && r.quick.level === 'quick' && Math.abs(r.quickEst.w - 100) < 1e-6 && Math.abs(r.quickEst.err - 30) < 1e-6, `quick set-up (empty only, physics model) → 100 g ±30 (got ${r.quickEst.w} ±${r.quickEst.err})`);
    check(r.basic.ok && r.basic.level === 'basic' && Math.abs(r.basicEst.w - 100) < 1e-6 && Math.abs(r.basicEst.err - 15) < 1e-6, `basic set-up (empty + 1 weight) learns the real curve → 100 g ±15 (got ${r.basicEst.w} ±${r.basicEst.err})`);
    check(r.flat.ok && r.flat.level === 'quick' && r.flat.problem === 'fitFlat', 'flat calibration → quick fallback with fitFlat problem');
    check(Math.abs(r.estInv.w - 75) < 1e-6, `inverse estimate recovers 75 g (got ${r.estInv.w})`);
    check(JSON.stringify(r.parse) === JSON.stringify([12.5, 12.5, 12.5, 50, 7, null, null, null]), 'weight parsing (ASCII, Arabic digits, comma, units) ' + JSON.stringify(r.parse));
    await ctx.close();
  }

  /* ---------- full flow with simulated sensor ---------- */
  const { ctx, page } = await newPage(browser, { mode: 'generic' });
  await page.screenshot({ path: path.join(OUT, '01-measure-uncal-en.png') });

  // Settings: delay "None" so tests run fast
  await page.click('#nav-help');
  await page.click('#setDetails summary'); await page.click('.seg[data-setting="delay"] button:has-text("None")');
  check(await page.evaluate(() => JSON.parse(localStorage.getItem('vibroscale.settings.v1')).delay === 0), 'delay setting persisted');

  // Diagnostics
  await page.click('#diagDetails summary');
  await page.click('#diagBtn');
  await page.waitForTimeout(1600);
  const diagText = await page.textContent('#diagLive');
  console.log('diag:', diagText.replace(/\s+/g, ' '));
  check(/Sample rate\s*(5\d|6\d)/.test(diagText), 'diagnostics shows ~60 Hz sample rate');
  await page.click('#diagVibBtn');
  await page.waitForFunction(() => /Works|felt/.test(document.getElementById('diagLive').textContent), null, { timeout: 10000 });
  const vibText = await page.textContent('#diagLive');
  check(/✓ Works/.test(vibText), 'vibration test works: ' + vibText.match(/Result(.*)/)[1]);
  await page.screenshot({ path: path.join(OUT, '02-help-diag-en.png'), fullPage: true });
  await page.click('#diagBtn'); // stop

  // Calibration
  await page.click('#nav-cal');
  const weights = [0, 20, 50, 100, 200, 300];
  for (const w of weights) {
    await page.evaluate(w => { window.__sim.weight = w; }, w);
    await page.fill('#calWeight', String(w));
    await page.click('#calMeasureBtn');
    await page.waitForTimeout(200);
    await idle(page);
    const msg = await page.textContent('#calMsg');
    if (!/Saved/.test(msg)) console.log('cal msg:', msg);
  }
  const fit = await page.evaluate(() => window.VibroScale.fit);
  console.log('fit:', fit.model, 'R2', fit.r2.toFixed(5), 'rmseW', fit.rmseW.toFixed(2), 'sA', fit.sA.toFixed(4));
  check(fit.ok && fit.distinct === 6, 'calibration with 6 points fitted');
  check(fit.model === 'inverse', `best model for 1/(1+w/M) data is inverse (got ${fit.model})`);
  await page.screenshot({ path: path.join(OUT, '03-cal-en.png'), fullPage: true });

  // Measure
  await page.click('#nav-measure');
  for (const w of [75, 150, 250]) {
    await page.evaluate(w => { window.__sim.weight = w; }, w);
    await page.click('#measureBtn');
    await page.waitForTimeout(200);
    await idle(page);
    const r = await page.evaluate(() => window.VibroScale.lastResult);
    const err = Math.abs(r.est.w - w);
    console.log(`  true ${w} g → ${r.est.w.toFixed(1)} ± ${r.est.err.toFixed(1)} g, runs ${r.runW.map(x => x.toFixed(1)).join(', ')}, warnings ${r.warnings.map(x => x.k).join(',') || '-'}`);
    check(err < Math.max(3 * r.est.err, 0.1 * w), `${w} g estimate within tolerance`);
    check(!r.est.outOfRange, `${w} g is within calibrated range`);
  }
  await page.screenshot({ path: path.join(OUT, '04-measure-result-en.png'), fullPage: true });

  // Out of range
  await page.evaluate(() => { window.__sim.weight = 700; });
  await page.click('#measureBtn'); await page.waitForTimeout(200); await idle(page);
  let warnTxt = await page.textContent('#resWarnings');
  check(/outside the weights you calibrated \(0–300 g\)/.test(warnTxt), 'out-of-range warning shown: ' + warnTxt.slice(0, 60));
  check((await page.textContent('#resValue')).startsWith('~'), 'out-of-range value is marked with ~');
  await page.screenshot({ path: path.join(OUT, '05-measure-outofrange-en.png'), fullPage: true });

  // Orientation mismatch (calibrated screen-down, now screen-up)
  await page.evaluate(() => { window.__sim.weight = 100; window.__sim.down = false; });
  await page.click('#measureBtn'); await page.waitForTimeout(200); await idle(page);
  warnTxt = await page.textContent('#resWarnings');
  check(/but you calibrated it/.test(warnTxt), 'orientation mismatch warning');
  await page.evaluate(() => { window.__sim.down = true; });

  // No vibration
  await page.evaluate(() => { window.__sim.works = false; });
  await page.click('#measureBtn'); await page.waitForTimeout(200); await idle(page);
  const errTxt = await page.textContent('#measMsg');
  check(/didn’t vibrate/.test(errTxt), 'no-vibration error shown');
  await page.screenshot({ path: path.join(OUT, '06-novib-en.png') });
  await page.evaluate(() => { window.__sim.works = true; });

  // Cancel mid-run
  await page.click('#measureBtn');
  await page.waitForTimeout(1500);
  check(await page.evaluate(() => document.body.hasAttribute('data-busy')), 'busy during measurement');
  check(await page.evaluate(() => !document.getElementById('overlay').hidden && /Measuring|Hands off|Getting ready/.test(document.getElementById('ovTitle').textContent)), 'step-by-step guide is shown while measuring');
  await page.screenshot({ path: path.join(OUT, '07-measuring-en.png') });
  await page.click('#ovCancel');
  await idle(page);
  check(/Cancelled/.test(await page.textContent('#measStatus')), 'cancel works');
  const lastCall = await page.evaluate(() => window.__sim.calls.at(-1));
  check(lastCall === 0, 'vibration stopped (vibrate(0)) after cancel');

  // Arabic
  await page.click('#langBtn');
  check(await page.evaluate(() => document.documentElement.dir === 'rtl' && document.documentElement.lang === 'ar'), 'Arabic switches to RTL');
  await page.evaluate(() => { window.__sim.weight = 120; });
  await page.click('#measureBtn'); await page.waitForTimeout(200); await idle(page);
  await page.screenshot({ path: path.join(OUT, '08-measure-ar.png'), fullPage: true });
  await page.click('#nav-cal');
  await page.screenshot({ path: path.join(OUT, '09-cal-ar.png'), fullPage: true });
  await page.click('#nav-help');
  await page.screenshot({ path: path.join(OUT, '10-help-ar.png'), fullPage: true });

  // persistence across reload
  await page.reload();
  check(await page.evaluate(() => document.documentElement.dir === 'rtl'), 'language persisted');
  check(await page.evaluate(() => window.VibroScale.fit && window.VibroScale.fit.ok && window.VibroScale.calibration.points.length === 6), 'calibration persisted in localStorage');

  // horizontal overflow check on all tabs, both languages
  for (const l of ['ar', 'en']) {
    for (const tab of ['measure', 'cal', 'help']) {
      await page.click('#nav-' + tab);
      const ov = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      check(ov <= 0, `no horizontal overflow (${l}/${tab}): ${ov}`);
    }
    await page.click('#langBtn');
  }
  // narrow phone width
  await page.setViewportSize({ width: 360, height: 780 });
  for (const tab of ['measure', 'cal', 'help']) {
    await page.click('#nav-' + tab);
    const ov = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check(ov <= 0, `no horizontal overflow at 360px (${tab}): ${ov}`);
  }

  // Reset
  await page.click('#nav-cal');
  await page.click('#calAdvanced summary');
  await page.click('#resetBtn');
  check(await page.evaluate(() => window.VibroScale.calibration.points.length === 0 && !window.VibroScale.fit.ok), 'reset clears calibration');
  await ctx.close();

  /* ---------- DeviceMotion fallback ---------- */
  {
    const { ctx, page } = await newPage(browser, { mode: 'devicemotion' });
    check(await page.evaluate(() => !('Accelerometer' in window)), 'Accelerometer removed for fallback test');
    await page.click('#nav-help');
    await page.click('#setDetails summary'); await page.click('.seg[data-setting="delay"] button:has-text("None")');
    await page.click('#nav-measure');
    await page.click('#measureBtn'); await page.waitForTimeout(200); await idle(page);
    const r = await page.evaluate(() => window.VibroScale.lastResult);
    check(r && r.kind === 'devicemotion' && r.mean > 1, `DeviceMotion fallback works (amp ${r && r.mean.toFixed(3)})`);
    await ctx.close();
  }

  /* ---------- silent sensor → noData ---------- */
  {
    const { ctx, page } = await newPage(browser, { mode: 'devicemotion', silent: true });
    await page.click('#nav-help');
    await page.click('#setDetails summary'); await page.click('.seg[data-setting="delay"] button:has-text("None")');
    await page.click('#nav-measure');
    await page.click('#measureBtn'); await page.waitForTimeout(200); await idle(page);
    check(/sends no data/.test(await page.textContent('#measMsg')), 'no sensor data → clear message');
    await ctx.close();
  }

  /* ---------- no vibrate API ---------- */
  {
    const ctx2 = await browser.newContext({ viewport: { width: 393, height: 851 }, userAgent: UA });
    await ctx2.addInitScript({ content: SIM + `;window.__SIM_INIT({});delete Navigator.prototype.vibrate;` });
    const page = await ctx2.newPage();
    await page.goto(URL);
    check(/can’t make the phone vibrate/.test(await page.textContent('#banners')), 'missing Vibration API → banner');
    await page.click('#measureBtn');
    check(/can’t make the phone vibrate/.test(await page.textContent('#measMsg')), 'missing Vibration API → error on Measure');
    await ctx2.close();
  }

  await browser.close();
  console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL CHECKS PASSED');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
