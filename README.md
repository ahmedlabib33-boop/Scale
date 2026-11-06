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

Live: **https://vibroscale.vercel.app**

## iPhone (Chrome or Safari) — experimental

Every iPhone browser, Chrome included, runs on Apple's WebKit engine, which has **no Vibration API**,
so no web page can run the motor continuously. On **iOS 18+** the app instead fires a rapid series of
short haptic taps (the tap iOS plays when a switch-style checkbox toggles) and measures how strongly
they shake the phone. Calibration and measuring work the same way; vibration length defaults to 4 s.

- Tap **Allow** when asked for motion & orientation access. If you tapped *Don't Allow*, close the
  tab completely and reopen the page.
- Turn on *Settings → Sounds & Haptics → System Haptics* and turn off Low Power Mode.
- Run *Help → Phone check → Test vibration* first: you should feel one tap immediately, and the
  result should say *✓ Works*. If it says *✗ No taps felt*, this iPhone/iOS version doesn't pass web
  haptics through strongly enough — a native iOS app (Core Haptics + Core Motion) would be needed.
- Expect a wider ± range than on Android (taps are brief, and the sensor only samples ~60 times/s).

## Using it — 3 steps

The app guides you through each step with one big instruction at a time, a countdown, and a beep
when it's done.

1. **Set up once (Calibrate tab).** Lay the phone on a firm, level table — **screen down is best**
   (the camera bump makes a phone rock on its back). The app asks for three known weights, one at a
   time: first *Empty*, then it suggests 50 g and 200 g. Tap a weight button (Empty, 5, 10, 20, 50,
   100, 200, 250, 500 g) or type another weight, tap **Measure**, put the weight on the phone during
   the countdown and take your hand away. After the third weight it says *The scale is ready*.
2. **Weigh (Weigh tab).** Tap **Weigh**, put the object on the phone, take your hand away.
3. **Read the result:** the weight, a ± range (≈95 %), and a plain label — *Good accuracy*,
   *Fair accuracy*, *Rough estimate* or *Outside the weights you calibrated*. Any problem (phone
   moved, readings disagree, not flat…) is explained in one sentence underneath.

Everything technical is tucked away: *Measurement details* (graph, readings, sensor) on the Weigh
tab, *Curve, backup and reset* on the Calibrate tab, and *Phone check* / *Settings* / *How it works*
on the Help tab. More weights (5–6 spread over your range) make the scale more accurate; a weight
marked *⚠ unsteady* should be measured again.

Good reference weights:

- **Coins** — use the official mass from your central bank / mint and stack identical coins
  (1, 2, 4, 8…). E.g. 1 € = 7.50 g, 2 € = 8.50 g, US 5¢ = 5.00 g.
- **Sealed sugar or flour bags** (100/250/500 g) for heavier points. The printed figure is the *net*
  weight; packaging adds a few grams, so check them on a kitchen scale if you can.
- Small sealed bags of rice/sugar weighed once on a kitchen scale make a reusable set.

Recalibrate after changing the table, phone case, orientation, vibration length, Android vibration
strength or battery-saver mode. *Export* saves the calibration as JSON; *Import* restores it.

## If something doesn't work (Help tab → Phone check)

- **Test vibration** should say *✓ Works*. If not: turn on *Settings → Sound & vibration →
  Vibration & haptics*, and turn off Do Not Disturb, battery saver and any "flip to silence" feature.
- **Live sensor** should show about 60 Hz and `|a| ≈ 9.8 m/s²` while the phone lies still.
- If the sensor sends no data: Chrome *⋮ → Settings → Site settings → Motion sensors → Allow*.
- *Settings* lets you change the time you get to place the object (default 5 s) and the vibration
  length; keep them the same for calibrating and weighing.

## How it works

- `navigator.vibrate(2000)` (2/3/4 s selectable) while recording the accelerometer at the highest
  rate the browser allows (Generic Sensor `Accelerometer`, falling back to `devicemotion`).
- Samples are resampled to a uniform grid; each axis is high-pass filtered (zero-phase 2nd-order
  Butterworth, 1 Hz) to remove gravity. Filtering each axis *before* taking the vector magnitude
  matters: |g + a| is nearly blind to in-plane vibration when the phone lies flat.
- Amplitude = RMS of the filtered vector over the vibration minus its first and last 0.3 s.
  An FFT gives the dominant frequency — at ~60 Hz sampling this is an aliased (apparent) value.
- A run counts as "vibrating" only if its RMS is > 2× the pre-vibration noise floor.
