// =============================================================================
// ACME Shop - demo web server
// -----------------------------------------------------------------------------
// This small Express server does three things:
//   1. Serves the storefront (everything in the /public folder).
//   2. Hands the browser its LaunchDarkly Client-side ID (GET /api/config).
//   3. Runs an automatic "watchdog" (/api/watchdog/...). If the new
//      recommendations carousel keeps crashing, the watchdog calls a
//      LaunchDarkly flag trigger URL, and that trigger turns the flag OFF.
//      It then confirms the flag really went off, and notices when the
//      feature comes back healthy. This is "automated remediation": no human
//      has to wake up and flip it.
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
// The watchdog (Part 1: automated remediation)
//
// It moves through three states, and the demo panel shows which one it is in:
//
//   armed       Watching. The browser reports each carousel error here. If
//               ERROR_THRESHOLD errors arrive within WINDOW_MS, it fires the
//               OFF trigger and moves to "tripped".
//   tripped     Trigger sent. Waiting for proof that it worked: the browser
//               reports the flag value LaunchDarkly is now serving. When that
//               says OFF, it moves to "remediated".
//   remediated  The flag is confirmed off and shoppers see the old page. When
//               someone turns the flag back on, it re-arms. If the carousel then
//               renders cleanly, it logs a recovery; if it still errors, the
//               cycle starts again.
//
// It fires at most once per incident, so it can never toggle a flag in a loop.
// -----------------------------------------------------------------------------
const ERROR_THRESHOLD = 5;
const WINDOW_MS = 30_000;
const CONFIRM_TIMEOUT_MS = 15_000; // warn if the flag is still on this long after firing

const watchdog = {
  state: 'armed',
  recentErrors: [], // timestamps of recent errors, only counted while armed
  firedAt: null, // when the trigger was sent
  awaitingRecovery: false, // true after a remediation, until the carousel is healthy again
};

function setState(state, message) {
  watchdog.state = state;
  console.log(`[watchdog] ${state.toUpperCase()}: ${message}`);
  return { state, message };
}

// Current state, so the page can show it.
app.get('/api/watchdog', (req, res) => {
  res.json({ enabled: Boolean(TRIGGER_URL), state: watchdog.state });
});

// The browser calls this each time the carousel throws an error.
app.post('/api/watchdog/error', async (req, res) => {
  if (watchdog.state !== 'armed') {
    // Already dealing with this incident; don't count or fire again.
    return res.json({ state: watchdog.state });
  }

  const now = Date.now();
  watchdog.recentErrors = watchdog.recentErrors.filter((t) => now - t < WINDOW_MS);
  watchdog.recentErrors.push(now);
  const count = watchdog.recentErrors.length;
  console.log(`[watchdog] carousel error reported (${count}/${ERROR_THRESHOLD} in the last ${WINDOW_MS / 1000}s)`);

  if (count < ERROR_THRESHOLD) {
    return res.json({ state: watchdog.state, count });
  }

  if (!TRIGGER_URL) {
    console.log('[watchdog] threshold reached, but no trigger URL is set in .env, so nothing was sent.');
    return res.json({ state: watchdog.state, count, message: 'Threshold reached, but no trigger URL is set' });
  }

  watchdog.recentErrors = [];
  watchdog.firedAt = now;
  const result = setState('tripped', `${count} errors in ${WINDOW_MS / 1000}s; firing the OFF trigger`);

  try {
    // A generic LaunchDarkly trigger is just an HTTP POST to a secret URL.
    // The JSON body is optional; it shows up in the flag's change history.
    const response = await fetch(TRIGGER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        eventName: 'ACME Shop watchdog: recommendations carousel error rate exceeded',
      }),
    });
    if (!response.ok) {
      return res.json(setState('armed', `trigger call failed (HTTP ${response.status}); re-armed`));
    }
    console.log(`[watchdog] LaunchDarkly accepted the trigger (HTTP ${response.status}); waiting for the flag to turn off`);
    return res.json(result);
  } catch (err) {
    return res.json(setState('armed', `could not reach the trigger URL (${err.message}); re-armed`));
  }
});

// The browser calls this whenever the carousel flag's value or health changes.
// flagOn  = the value LaunchDarkly is serving right now
// healthy = the carousel rendered without an error (only meaningful when on)
app.post('/api/watchdog/status', (req, res) => {
  const { flagOn, healthy } = req.body;

  if (watchdog.state === 'tripped' && !flagOn) {
    const seconds = ((Date.now() - watchdog.firedAt) / 1000).toFixed(1);
    watchdog.awaitingRecovery = true;
    return res.json(setState('remediated', `flag confirmed OFF ${seconds}s after the trigger fired`));
  }

  if (watchdog.state === 'tripped' && flagOn && Date.now() - watchdog.firedAt > CONFIRM_TIMEOUT_MS) {
    return res.json(setState('tripped', `trigger fired ${CONFIRM_TIMEOUT_MS / 1000}s ago but the flag is still ON; check LaunchDarkly`));
  }

  if (watchdog.state === 'remediated' && flagOn) {
    watchdog.recentErrors = [];
    if (healthy) {
      watchdog.awaitingRecovery = false;
      return res.json(setState('armed', 'RECOVERED: carousel is back on and healthy'));
    }
    return res.json(setState('armed', 'flag turned back on; watching again'));
  }

  if (watchdog.state === 'armed' && watchdog.awaitingRecovery && flagOn && healthy) {
    watchdog.awaitingRecovery = false;
    return res.json(setState('armed', 'RECOVERED: carousel is back on and healthy'));
  }

  return res.json({ state: watchdog.state });
});

app.listen(PORT, () => {
  console.log(`\nACME Shop is running at http://localhost:${PORT}`);
  console.log(`Watchdog auto-remediation: ${TRIGGER_URL ? 'ON' : 'OFF (no trigger URL in .env)'}\n`);
});
