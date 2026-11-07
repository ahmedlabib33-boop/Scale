// End-to-end: a brand-new user taps Weigh without calibrating anything.
const { chromium } = require('playwright');
const fs = require('fs'); const path = require('path');
const SIM = fs.readFileSync(path.join(__dirname, 'sim.js'), 'utf8');
const URL = process.env.VIBRO_URL || 'http://127.0.0.1:8765/index.html';
const OUT = path.join(__dirname, 'out'); fs.mkdirSync(OUT, { recursive: true });   // screenshots (git-ignored)
const UA = 'Mozilla/5.0 (Linux; Android 15; Infinix X6870) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36';
let failures = 0; const check = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) failures++; };
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 393, height: 851 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: UA });
  // simulated phone behaves like a 193 g phone (the app's default) — real phones won't match exactly
  await ctx.addInitScript({ content: SIM + `;window.__SIM_INIT({M:193});if(!localStorage.getItem('vibroscale.settings.v1'))localStorage.setItem('vibroscale.settings.v1', JSON.stringify({duration:2000,delay:3,source:'auto',sound:false,phoneMass:193}));` });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.accept());
  await p.goto(URL);
  const idle = () => p.waitForFunction(() => !document.body.hasAttribute('data-busy'), null, { timeout: 90000 });
  const motorRuns = () => p.evaluate(() => window.__sim.calls.filter(ms => ms > 0).length);
  check(/First time\? The app checks the empty phone/.test(await p.textContent('#measHint')), 'first-time hint explains the automatic set-up');
  check(/Weigh/.test(await p.textContent('#measureBtn')) && await p.isVisible('#measureBtn'), 'Weigh is available right away (no set-up needed)');
  await p.screenshot({ path: path.join(OUT, 'auto-01-first-open.png') });

  // first weigh: step 1 (empty) then step 2 (object)
  await p.click('#measureBtn');
  await p.waitForFunction(() => /Step 1 of 2/.test(document.getElementById('ovStep').textContent) && /Take everything off/.test(document.getElementById('ovTitle').textContent), null, { timeout: 8000 });
  await p.screenshot({ path: path.join(OUT, 'auto-02-step1.png') });
  check(true, 'step 1 of 2 asks to take everything off the phone');
  await p.waitForFunction(() => /Step 2 of 2/.test(document.getElementById('ovStep').textContent), null, { timeout: 40000 });
  await p.evaluate(() => { window.__sim.weight = 100; });        // user puts the object on during the countdown
  check(/Put the object on the phone/.test(await p.textContent('#ovTitle')), 'step 2 of 2 asks for the object');
  await p.screenshot({ path: path.join(OUT, 'auto-03-step2.png') });
  await idle(); await p.waitForTimeout(300);
  const r = await p.evaluate(() => ({ res: window.VibroScale.lastResult, fit: window.VibroScale.fit, pts: window.VibroScale.calibration.points.map(x => x.w) }));
  console.log(`  true 100 g → ${r.res.est.w.toFixed(1)} ± ${r.res.est.err.toFixed(1)} g (${r.fit.level}), saved points: ${r.pts}`);
  check(r.fit.level === 'quick' && JSON.stringify(r.pts) === '[0]', 'empty-phone reading saved; quick set-up active');
  check(Math.abs(r.res.est.w - 100) <= r.res.est.err, 'estimate is within its own ± range');
  check(await motorRuns() === 6, `first weigh vibrated 6 times (3 empty + 3 object), got ${await motorRuns()}`);
  const shown = await p.evaluate(() => ({ badge: document.getElementById('resBadge').textContent, warn: document.getElementById('resWarnings').textContent, chip: document.getElementById('calChip').textContent }));
  check(/Rough estimate/.test(shown.badge) && /Quick set-up: the app assumes your phone weighs 193 g/.test(shown.warn) && /Quick set-up \(rough\)/.test(shown.chip), 'result is honestly labelled as a quick, rough estimate');
  await p.screenshot({ path: path.join(OUT, 'auto-04-result.png') });

  // second weigh: single step
  await p.evaluate(() => { window.__sim.calls.length = 0; window.__sim.weight = 60; });
  await p.click('#measureBtn'); await p.waitForTimeout(300);
  check(!/Step 1 of 2/.test(await p.textContent('#ovStep')), 'second weigh skips the empty-phone step');
  await idle();
  check(await motorRuns() === 3, 'second weigh vibrates only 3 times');

  // add one known weight → basic level
  await p.click('#nav-cal');
  check(/already works roughly/.test(await p.textContent('#calGuide')), 'Calibrate tab says the scale already works and invites a known weight');
  await p.evaluate(() => { window.__sim.weight = 50; });
  await p.fill('#calWeight', '50'); await p.click('#calMeasureBtn'); await p.waitForTimeout(300); await idle();
  check(await p.evaluate(() => window.VibroScale.fit.level) === 'basic', 'one known weight → basic set-up');
  await p.click('#nav-measure'); await p.evaluate(() => { window.__sim.weight = 40; });
  await p.click('#measureBtn'); await p.waitForTimeout(300); await idle();
  const r2 = await p.evaluate(() => window.VibroScale.lastResult);
  console.log(`  true 40 g → ${r2.est.w.toFixed(1)} ± ${r2.est.err.toFixed(1)} g (basic)`);
  check(Math.abs(r2.est.w - 40) <= r2.est.err && /Calibrated with only 1 known weight/.test(await p.textContent('#resWarnings')), 'basic estimate within range and labelled');

  // phone weight setting changes the quick model
  await p.click('#nav-help'); await p.click('#setDetails summary');
  check(await p.inputValue('#setMass') === '193', 'Settings shows phone weight 193 g by default');
  // Arabic first-time hint
  await p.evaluate(() => { localStorage.clear(); });
  await p.reload(); await p.click('#langBtn');
  check(/أول مرة؟ يفحص التطبيق الهاتف فارغًا بنفسه/.test(await p.textContent('#measHint')), 'Arabic first-time hint');
  await p.screenshot({ path: path.join(OUT, 'auto-05-first-open-ar.png') });
  console.log('page errors:', errs);
  if (errs.length) failures++;
  await b.close();
  console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL AUTO-SETUP CHECKS PASSED');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
