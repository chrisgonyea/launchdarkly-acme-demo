// =============================================================================
// ABC Shop - demo web server
// -----------------------------------------------------------------------------
// This small Express server does three things:
//   1. Serves the storefront (everything in the /public folder).
//   2. Hands the browser its LaunchDarkly Client-side ID (GET /api/config).
//   3. Runs an automatic "watchdog" (POST /api/report-error). If the new
//      recommendations carousel keeps crashing, the watchdog calls a
//      LaunchDarkly flag trigger URL, and that trigger turns the flag OFF.
//      This is "automated remediation": no human has to wake up and flip it.
//
// All LaunchDarkly feature-flag evaluation happens in the BROWSER, using the
// LaunchDarkly JavaScript client-side SDK (see public/app.js).
// =============================================================================

import 'dotenv/config'; // loads the values from your .env file into process.env
import express from 'express';

const app = express();
app.use(express.json());
app.use(express.static('public'));

// The LaunchDarkly browser SDK ships as one ready-to-use file, so we serve it
// straight from node_modules. No bundler or CDN needed.
app.get('/vendor/launchdarkly.js', (req, res) => {
  res.sendFile('node_modules/@launchdarkly/js-client-sdk/dist/index.js', { root: '.' });
});

const PORT = process.env.PORT || 3000;

// -----------------------------------------------------------------------------
// REPLACE ME: put your own LaunchDarkly Client-side ID in the .env file.
// In LaunchDarkly: Project settings > Environments > (your environment) > "Client-side ID".
// Note: this is the Client-side ID, NOT the SDK key. The Client-side ID is
// safe to send to a browser; the SDK key is a secret and must never be.
// -----------------------------------------------------------------------------
const CLIENT_SIDE_ID = process.env.LD_CLIENT_SIDE_ID;

// -----------------------------------------------------------------------------
// OPTIONAL: the "Turn the flag OFF" trigger URL for the recommendations-carousel
// flag. Create it in LaunchDarkly: open the flag > Settings tab > Triggers >
// "Add trigger" > Generic trigger > action "Turn the flag off". LaunchDarkly
// shows the URL only once, so copy it into .env straight away.
// If this is blank, the watchdog only logs and you can trigger the URL by hand.
// -----------------------------------------------------------------------------
const TRIGGER_URL = process.env.LD_CAROUSEL_OFF_TRIGGER_URL;

if (!CLIENT_SIDE_ID) {
  console.error('\nMissing LD_CLIENT_SIDE_ID. Copy .env.example to .env and fill it in.\n');
  process.exit(1);
}

// The browser asks for this when the page loads, so the ID lives only in .env.
app.get('/api/config', (req, res) => {
  res.json({ clientSideId: CLIENT_SIDE_ID, watchdogEnabled: Boolean(TRIGGER_URL) });
});

// -----------------------------------------------------------------------------
// The watchdog
// The browser POSTs here each time the carousel throws an error. If we see
// ERROR_THRESHOLD errors inside WINDOW_MS, we fire the trigger once, then wait
// COOLDOWN_MS before we are allowed to fire again.
// -----------------------------------------------------------------------------
const ERROR_THRESHOLD = 5;
const WINDOW_MS = 30_000;
const COOLDOWN_MS = 60_000;

let recentErrors = []; // timestamps of recent errors
let lastFiredAt = 0;

app.post('/api/report-error', async (req, res) => {
  const now = Date.now();
  recentErrors = recentErrors.filter((t) => now - t < WINDOW_MS);
  recentErrors.push(now);

  const count = recentErrors.length;
  console.log(`[watchdog] carousel error reported (${count}/${ERROR_THRESHOLD} in the last ${WINDOW_MS / 1000}s)`);

  const overThreshold = count >= ERROR_THRESHOLD;
  const coolingDown = now - lastFiredAt < COOLDOWN_MS;

  if (!overThreshold || coolingDown) {
    return res.json({ fired: false, count });
  }

  if (!TRIGGER_URL) {
    console.log('[watchdog] threshold reached, but no trigger URL is set in .env, so nothing was sent.');
    return res.json({ fired: false, count, reason: 'no-trigger-url' });
  }

  lastFiredAt = now;
  recentErrors = [];

  try {
    // A generic LaunchDarkly trigger is just an HTTP POST to a secret URL.
    // The JSON body is optional; it shows up in the flag's change history.
    const response = await fetch(TRIGGER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        eventName: 'ABC Shop watchdog: recommendations carousel error rate exceeded',
      }),
    });
    console.log(`[watchdog] trigger fired, LaunchDarkly answered HTTP ${response.status}`);
    return res.json({ fired: true, status: response.status });
  } catch (err) {
    console.error('[watchdog] could not reach the trigger URL:', err.message);
    return res.status(502).json({ fired: false, error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`\nABC Shop is running at http://localhost:${PORT}`);
  console.log(`Watchdog auto-remediation: ${TRIGGER_URL ? 'ON' : 'OFF (no trigger URL in .env)'}\n`);
});
