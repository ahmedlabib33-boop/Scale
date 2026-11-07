# VibroScale tests

Automated browser tests for `index.html`. They run in headless Chromium with **simulated sensors**
(`sim.js`): a fake accelerometer whose vibration strength drops as a simulated weight goes up,
`A0 / (1 + w / M)`, plus a fake vibration motor (or iPhone haptic taps). They check the app's logic
and screens, not real-phone accuracy.

Run everything from the repository root:

```sh
npx playwright install chromium   # once, if Playwright isn't installed yet
tests/run.sh
```

| Suite | What it covers |
|---|---|
| `test.js` | Curve fitting maths, sensor check, calibration, weighing, warnings, cancel, Arabic/RTL, layout overflow, DeviceMotion fallback, missing-API messages |
| `test_ios.js` | iPhone mode: haptic taps, iOS permission and sign handling, iOS-specific messages, iOS 17 blocking |
| `test_fixes.js` | Sensor start races, wake-lock leak, test-vibration lock, `1,000` parsing, calibration type mismatch, iPad handling |
| `test_auto.js` | Automatic set-up on the first weigh (quick → basic levels), phone-weight setting |
| `test_harden.js` | Countdown with delay "None", unsteady empty check, bad-calibration fallback, focus handling, no-storage banner, unexpected-error recovery |

Screenshots go to `tests/out/` and logs to `tests/out-*.log` (both git-ignored). Set `VIBRO_URL`
to test another copy, e.g. the live site.
