// Injected before the app: fakes navigator.vibrate + Accelerometer (or DeviceMotion) with a
// physically-motivated amplitude A(w) = A0 / (1 + w / M) that the app has to recover.
window.__SIM_INIT = (opts) => {
  const S = window.__sim = Object.assign({
    weight: 0, vibStart: -1, vibEnd: -1, works: true, rate: 60, noise: 0.012, f: 7.3,
    calls: [], down: true, mode: 'generic', A0: 1.4, M: 160, jitter: 0.02, silent: false, ios: false, taps: [], tapA0: 3, startDelay: 0, activeSensors: 0, mockWakeLock: false, wakeDelay: 300, locksHeld: 0,
  }, opts || {});
  const randn = () => { let u = 0; while (!u) u = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * Math.random()); };
  S.amp = w => S.A0 / (1 + w / S.M);
  if (S.ios) {
    delete Navigator.prototype.vibrate;
    const origClick = HTMLElement.prototype.click;
    HTMLElement.prototype.click = function () {
      if (this.tagName === 'LABEL' && this.querySelector('input[switch]') && S.works) S.taps.push(performance.now());
      return origClick.call(this);
    };
  } else Object.defineProperty(Navigator.prototype, 'vibrate', {
    configurable: true,
    value: function (p) {
      const ms = Array.isArray(p) ? (p[0] || 0) : +p, now = performance.now();
      S.calls.push(ms);
      if (ms > 0 && S.works) { S.vibStart = now + 30; S.vibEnd = now + ms; S.runMul = 1 + (S.runJitter || 0) * randn(); } else S.vibEnd = now;
      return true;
    },
  });
  if (S.mockWakeLock) Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request: () => new Promise(r => setTimeout(() => {
    S.locksHeld++; const l = new EventTarget(); let rel = false;
    l.release = () => { if (!rel) { rel = true; S.locksHeld--; l.dispatchEvent(new Event('release')); } return Promise.resolve(); };
    r(l); }, S.wakeDelay)) } });
  const sample = () => {
    const now = performance.now(), vib = now >= S.vibStart && now < S.vibEnd;
    let x = S.noise * randn(), y = S.noise * randn(), z = 9.81 * (S.down ? -1 : 1) * (S.ios ? -1 : 1) + S.noise * randn();
    if (S.ios) {  // each haptic tap: ~180 Hz damped jolt (tau 8 ms), amplitude falls with load
      while (S.taps.length && now - S.taps[0] > 80) S.taps.shift();
      for (const t0 of S.taps) { const dt = now - t0; if (dt >= 0) { const A = S.tapA0 / (1 + S.weight / S.M) * Math.exp(-dt / 8); x += A * 0.8 * Math.sin(2 * Math.PI * 0.18 * dt); y += A * 0.5 * Math.cos(2 * Math.PI * 0.18 * dt); } }
    }
    if (vib) {
      const A = S.amp(S.weight) * (S.runMul || 1) * (1 + S.jitter * randn()), ph = 2 * Math.PI * S.f * now / 1000;
      x += A * Math.SQRT2 * 0.85 * Math.sin(ph); y += A * Math.SQRT2 * 0.5 * Math.cos(ph); z += A * 0.2 * randn();
    }
    return { now, x, y, z };
  };
  if (S.mode === 'generic') {
    class FakeAccelerometer extends EventTarget {
      constructor(o = {}) { super(); this.frequency = Math.min(o.frequency || 60, S.rate); this.x = null; this.y = null; this.z = null; this.timestamp = null; }
      start() {
        if (this._running || S.silent) return;
        this._running = true; S.activeSensors++;
        this._t = setTimeout(() => { this._id = setInterval(() => { const s = sample(); this.x = s.x; this.y = s.y; this.z = s.z; this.timestamp = s.now; this.dispatchEvent(new Event('reading')); }, 1000 / this.frequency); }, S.startDelay);
      }
      stop() { if (!this._running) return; this._running = false; S.activeSensors--; clearTimeout(this._t); clearInterval(this._id); this._id = null; }
    }
    window.Accelerometer = FakeAccelerometer;
  } else {
    delete window.Accelerometer;
    try { delete Window.prototype.Accelerometer; } catch (_) {}
    window.Accelerometer = undefined; delete window.Accelerometer;
    if (!S.silent) setInterval(() => {
      const s = sample();
      window.dispatchEvent(new DeviceMotionEvent('devicemotion', { accelerationIncludingGravity: { x: s.x, y: s.y, z: s.z }, interval: 1000 / S.rate }));
    }, 1000 / S.rate);
  }
};
