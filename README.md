# VibroScale — phone vibration weight estimator

`index.html` is the whole app: HTML + CSS + vanilla JS, no dependencies, no network requests.
It estimates the weight of small objects (roughly 20–500 g) from how much a load on the phone
damps the phone's own vibration motor, as measured by the accelerometer. Built for **Chrome on
Android** (tested with simulated sensors in Chromium), dark mode, English / Arabic (RTL).

> Estimate only — typical accuracy is about ±5–15 % after careful calibration. Not for trade,
> legal, medical or safety use.

## Open it on the phone

Motion sensors only work on a **secure page**: `https://`, `http://localhost`, or a local file.
A plain `http://192.168.x.x` address will not work.

- **GitHub Pages (easiest):** repo *Settings → Pages → Deploy from a branch*, choose the branch and
  `/ (root)`, then open `https://<user>.github.io/<repo>/` in Chrome on the phone.
- **From a PC over USB:** run `python3 -m http.server 8000` next to `index.html`, connect the phone,
  open `chrome://inspect` on the PC → *Port forwarding* → `8000 → localhost:8000`, then open
  `http://localhost:8000` on the phone.
- **Offline:** the page loads nothing from the network, so once open it needs no connection. To start
  it without a connection, copy `index.html` to the phone and open `file:///sdcard/Download/index.html`
  in Chrome (Chrome may ask for file access). A single HTML file can't register a service worker, so
  reopening a hosted copy offline relies on Chrome's cache and isn't guaranteed.

## Test it first (Help & settings tab)

1. **Sensor check → Start sensor.** Expect a sample rate around 60 Hz (Chrome's usual cap),
   `|a| ≈ 9.8 m/s²`, and low noise (≈ 0.01–0.05 m/s²) while the phone lies still.
2. **Test vibration.** It should say *detected ✓* with a ratio of ×3 or more. If not: turn on
   *Settings → Sound & vibration → Vibration & haptics*, and turn off Do Not Disturb, battery saver
   and any "flip to silence" feature.
3. If the sensor sends no data: Chrome *⋮ → Settings → Site settings → Motion sensors → Allow*.
4. Set **Start delay** (default 5 s) — the time you get to place the object after tapping.

## Calibrate (Calibrate tab)

1. Put the phone on a firm, level table — **screen down is recommended** (the camera bump makes a
   phone rock on its back). Remove the case, or always use the same one.
2. Enter `0`, tap **Measure 3×**, and don't touch anything until the beep.
3. Repeat with 4–6 known weights covering the range you care about, e.g. 20, 50, 100, 200, 300 g.
   Put each weight on the same spot every time (mark it with a small sticker).
4. The app fits linear, 1/x and exponential curves, keeps the best by R², and shows the curve and the
   typical error in grams. Re-measure any point whose spread is highlighted in amber.

Good reference weights:

- **Coins** — use the official mass from your central bank / mint and stack identical coins
  (1, 2, 4, 8…). E.g. 1 € = 7.50 g, 2 € = 8.50 g, US 5¢ = 5.00 g.
- **Sealed sugar or flour bags** (100/250/500 g) for heavier points. The printed figure is the *net*
  weight; packaging adds a few grams, so check them on a kitchen scale if you can.
- Small sealed bags of rice/sugar weighed once on a kitchen scale make a reusable set.

Recalibrate after changing the table, phone case, orientation, vibration length, Android vibration
strength or battery-saver mode. *Export* saves the calibration as JSON; *Import* restores it.

## Measure

Tap **Measure**, place the object during the countdown, let go. The app waits until the phone is
still, runs 3 vibrations, beeps, and shows the mean weight with a ≈95 % ± range (calibration
residuals + run-to-run spread). It warns when the reading is **outside the calibrated range**, when
runs disagree, when the phone moved or isn't flat, or when orientation / sensor rate / vibration
length differ from the calibration.

## How it works

- `navigator.vibrate(2000)` (2/3/4 s selectable) while recording the accelerometer at the highest
  rate the browser allows (Generic Sensor `Accelerometer`, falling back to `devicemotion`).
- Samples are resampled to a uniform grid; each axis is high-pass filtered (zero-phase 2nd-order
  Butterworth, 1 Hz) to remove gravity. Filtering each axis *before* taking the vector magnitude
  matters: |g + a| is nearly blind to in-plane vibration when the phone lies flat.
- Amplitude = RMS of the filtered vector over the vibration minus its first and last 0.3 s.
  An FFT gives the dominant frequency — at ~60 Hz sampling this is an aliased (apparent) value.
- A run counts as "vibrating" only if its RMS is > 2× the pre-vibration noise floor.
