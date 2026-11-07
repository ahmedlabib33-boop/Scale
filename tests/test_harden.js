const { chromium } = require('playwright');
const fs = require('fs'); const path = require('path');
const SIM = fs.readFileSync(path.join(__dirname, 'sim.js'), 'utf8');
const URL = process.env.VIBRO_URL || 'http://127.0.0.1:8765/index.html';
const OUT = path.join(__dirname, 'out'); fs.mkdirSync(OUT, { recursive: true });   // screenshots (git-ignored)
const UA = 'Mozilla/5.0 (Linux; Android 15; Infinix X6870) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36';
let failures = 0; const check = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) failures++; };
async function open(b, sim, settings, extra = '') {
  const ctx = await b.newContext({ viewport: { width: 393, height: 851 }, isMobile: true, hasTouch: true, userAgent: UA });
  await ctx.addInitScript({ content: SIM + `;window.__SIM_INIT(${JSON.stringify(sim || {})});try{if(!localStorage.getItem('vibroscale.settings.v1'))localStorage.setItem('vibroscale.settings.v1', ${JSON.stringify(JSON.stringify(Object.assign({ duration: 2000, delay: 0, source: 'auto', sound: false, phoneMass: 193 }, settings)))});}catch(_){}` + extra });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.accept());
  await p.goto(URL); p.errs = errs; return { ctx, p };
}
const idle = p => p.waitForFunction(() => !document.body.hasAttribute('data-busy'), null, { timeout: 90000 });
const seed = (p, pts) => p.evaluate(pts => { localStorage.setItem('vibroscale.calibration.v1', JSON.stringify({ version: 1, points: pts })); }, pts);
const pt = (w, mean, extra) => Object.assign({ w, mean, amps: [mean, mean, mean], sd: mean * 0.01, fs: 62, orient: 'down', kind: 'generic', dur: 2000, exc: 'motor' }, extra);
(async () => {
  const b = await chromium.launch();
  // 1. first weigh with delay "None" still gives a countdown before the object step
  {
    const { ctx, p } = await open(b, { M: 193 });
    await p.click('#measureBtn');
    await p.waitForFunction(() => /Step 2 of 2/.test(document.getElementById('ovStep').textContent), null, { timeout: 40000 });
    const big = await p.textContent('#ovBig'), title = await p.textContent('#ovTitle');
    await p.evaluate(() => { window.__sim.weight = 100; });
    check(/Put the object/.test(title) && /^[1-3]$/.test(big), `step 2 has a countdown even with delay None (shows "${big}")`);
    await idle(p);
    const r = await p.evaluate(() => window.VibroScale.lastResult);
    check(r && r.est && Math.abs(r.est.w - 100) <= r.est.err, `object measured, not the empty phone (${r && r.est && r.est.w.toFixed(1)} g)`);
    // 6. no stray "Saved 0 g" note on the Calibrate tab
    check((await p.textContent('#calMsg')).trim() === '', 'auto step leaves no note on the Calibrate tab');
    // 8. focus returns to Weigh; background was inert during the guide
    check(await p.evaluate(() => document.activeElement && document.activeElement.id === 'measureBtn'), 'focus returns to the Weigh button after measuring');
    // 7. phone weight change re-estimates the shown quick result
    const before = await p.textContent('#resValue');
    await p.click('#nav-help'); await p.click('#setDetails summary');
    await p.fill('#setMass', '250'); await p.press('#setMass', 'Tab');
    const after = await p.evaluate(() => window.VibroScale.lastResult.est.w);
    check(Math.abs(after - 100 * 250 / 193) < 15 && (await p.textContent('#resValue')) !== before, `result updates when phone weight changes (${before} → ${Math.round(after)} g)`);
    // 2. stronger-than-empty vibration → right message, not "heavier"
    await p.fill('#setMass', '193'); await p.press('#setMass', 'Tab');
    await p.click('#nav-measure'); await p.evaluate(() => { window.__sim.weight = 0; window.__sim.A0 = 1.9; });
    await p.click('#measureBtn'); await p.waitForTimeout(200);
    check(await p.evaluate(() => document.querySelector('main').inert && document.querySelector('nav').inert), 'page behind the guide is inert while measuring');
    await idle(p);
    const w = await p.textContent('#resWarnings');
    check(/vibrated more than when it was empty/.test(w) && !/Heavier/.test(w), 'stronger-than-empty reading explained correctly');
    console.log('  page errors:', p.errs); if (p.errs.length) failures++;
    await ctx.close();
  }
  // 3/4. bad known weight → still grams (quick), problem explained on both tabs
  {
    const { ctx, p } = await open(b, { M: 193 });
    await seed(p, [pt(0, 1.4), pt(5, 1.45)]); await p.reload();
    const f = await p.evaluate(() => window.VibroScale.fit);
    check(f.ok && f.level === 'quick' && f.problem === 'fitFlat', 'empty + bad 5 g point → quick fallback');
    check(/Calibration problem/.test(await p.textContent('#calChip')), 'Weigh tab chip reports the calibration problem');
    await p.evaluate(() => { window.__sim.weight = 100; });
    await p.click('#measureBtn'); await idle(p);
    const r = await p.evaluate(() => window.VibroScale.lastResult);
    check(r.est && /didn’t make a usable curve/.test(await p.textContent('#resWarnings')), 'Weigh still gives grams and says why');
    await p.click('#nav-cal');
    check(/doesn’t change with weight/.test(await p.textContent('#calGuide')), 'Calibrate tab guide shows the real problem');
    await ctx.close();
  }
  // 5. unsteady empty-phone check is not saved
  {
    const { ctx, p } = await open(b, { M: 193, runJitter: 0.3 });
    await p.click('#measureBtn'); await idle(p);
    const st = await p.evaluate(() => ({ pts: window.VibroScale.calibration.points.length, msg: document.getElementById('measMsg').textContent }));
    check(st.pts === 0 && /empty-phone check wasn’t steady/.test(st.msg), 'unsteady empty reading rejected, nothing saved');
    await ctx.close();
  }
  // 11. storage that refuses writes → banner
  {
    const { ctx, p } = await open(b, {}, {}, `;Storage.prototype.setItem = function () { throw new DOMException('quota', 'QuotaExceededError'); };`);
    check(/isn’t saving data/.test(await p.textContent('#banners')), 'banner when the browser cannot save');
    await ctx.close();
  }
  // 12. unexpected error during a measurement ends it instead of freezing
  {
    const { ctx, p } = await open(b, { M: 193 }, { delay: 3 });
    await p.click('#measureBtn'); await p.waitForTimeout(600);
    await p.evaluate(() => setTimeout(() => { throw new Error('boom'); }, 0));
    await idle(p);
    check(/unexpected error/.test(await p.textContent('#measMsg')) && await p.evaluate(() => document.getElementById('overlay').hidden), 'unexpected error closes the guide with a message');
    await ctx.close();
  }
  await b.close();
  console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL HARDENING CHECKS PASSED');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
