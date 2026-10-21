// =============================================================================
// ACME Shop - demo web server
// -----------------------------------------------------------------------------
// This small Express server does four things:
//   1. Serves the storefront (everything in the /public folder).
//   2. Hands the browser its LaunchDarkly Client-side ID (GET /api/config).
//   3. Runs the "recommendations service" the new carousel loads its products
//      from (GET /api/recommendations). The demo's "Simulate a bug" switch
//      breaks this service, the way a real backend outage would.
//   4. Runs an automatic "watchdog". If the carousel keeps failing, it calls a
//      LaunchDarkly trigger that turns the flag OFF, confirms the flag really
//      went off, then health-checks the service. Once the service is healthy
//      again it can call a second trigger that turns the flag back ON.
//      This is automated remediation: nobody has to wake up and flip a switch.
//
// All LaunchDarkly feature-flag evaluation happens in the BROWSER, using the
// LaunchDarkly JavaScript client-side SDK (see public/app.js). The server only
// calls LaunchDarkly's trigger URLs.
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
// OPTIONAL: trigger URLs for the recommendations-carousel flag.
// Create them in LaunchDarkly: open the flag > the "..." menu next to your
// environment > "Configuration in environment" > Triggers > "+ Add trigger" >
// Generic trigger. Make one with the action "Turn the flag off" and, for
// automatic recovery, one with "Turn the flag on". LaunchDarkly shows each URL
// only once, so copy it into .env straight away. Treat them like passwords:
// anyone with the URL can flip the flag.
//
//   OFF URL blank -> the watchdog only logs; fire the trigger by hand with curl.
//   ON URL blank  -> after an incident, a person turns the flag back on.
// -----------------------------------------------------------------------------
const OFF_TRIGGER_URL = process.env.LD_CAROUSEL_OFF_TRIGGER_URL;
const ON_TRIGGER_URL = process.env.LD_CAROUSEL_ON_TRIGGER_URL;

if (!CLIENT_SIDE_ID) {
  console.error('\nMissing LD_CLIENT_SIDE_ID. Copy .env.example to .env and fill it in.\n');
  process.exit(1);
}

// The browser asks for this when the page loads, so the ID lives only in .env.
app.get('/api/config', (req, res) => {
  res.json({ clientSideId: CLIENT_SIDE_ID, watchdogEnabled: Boolean(OFF_TRIGGER_URL) });
});

// =============================================================================
// The recommendations service (what the new carousel depends on)
// =============================================================================
const RECOMMENDED_PRODUCT_IDS = ['p5', 'p2', 'p4', 'p1'];
let serviceBroken = false; // flipped by the demo's "Simulate a bug" switch

app.get('/api/recommendations', (req, res) => {
  if (serviceBroken) {
    return res.status(503).json({ error: 'Recommendations service unavailable' });
  }
  res.json({ items: RECOMMENDED_PRODUCT_IDS });
});

// Demo control only: break or fix the recommendations service.
app.get('/api/simulate-bug', (req, res) => res.json({ broken: serviceBroken }));
app.post('/api/simulate-bug', (req, res) => {
  serviceBroken = Boolean(req.body.broken);
  console.log(`[demo] recommendations service is now ${serviceBroken ? 'BROKEN' : 'healthy'}`);
  res.json({ broken: serviceBroken });
});

// =============================================================================
// The watchdog (Part 1: automated remediation)
// -----------------------------------------------------------------------------
// It moves through four states, and the demo panel shows which one it is in:
//
//   armed       Watching. The browser reports each carousel error. If
//               ERROR_THRESHOLD errors arrive within WINDOW_MS, it fires the
//               OFF trigger and moves to "tripped".
//   tripped     OFF trigger sent. Waits for proof it worked: the browser
//               reports the value LaunchDarkly now serves. When that is OFF, it
//               moves to "remediated".
//   remediated  Flag confirmed off; shoppers see the old page. The watchdog now
//               health-checks the recommendations service every PROBE_EVERY_MS.
//               After HEALTHY_CHECKS_NEEDED passes in a row it fires the ON
//               trigger (if one is set) and moves to "recovering". Without an
//               ON trigger it logs that a person can turn the flag back on.
//   recovering  ON trigger sent. When the browser reports the flag ON and the
//               carousel rendering cleanly, it logs RECOVERED and re-arms.
//
// It fires each trigger at most once per incident, so it can never toggle a
// flag in a loop. If someone turns the flag back on by hand while the service
// is still broken, it simply re-arms and the next errors start a new incident.
// =============================================================================
const ERROR_THRESHOLD = 5;
const WINDOW_MS = 30_000;
const CONFIRM_TIMEOUT_MS = 15_000; // warn if LaunchDarkly hasn't confirmed a trigger by then
const PROBE_EVERY_MS = 5_000;
const HEALTHY_CHECKS_NEEDED = 3;

const watchdog = {
  state: 'armed',
  recentErrors: [], // timestamps of recent errors, only counted while armed
  triggeredAt: null, // when the latest trigger was sent
  healthyChecks: 0, // passing health checks in a row, while remediated
  probeTimer: null,
  toldHumanToRecover: false,
};

function setState(state, message) {
  watchdog.state = state;
  console.log(`[watchdog] ${state.toUpperCase()}: ${message}`);
  if (state === 'remediated') startHealthChecks();
  else stopHealthChecks();
  return { state, message };
}

// A generic LaunchDarkly trigger is just an HTTP POST to a secret URL.
// The JSON body is optional; its eventName shows up in the flag's change history.
async function fireTrigger(url, eventName) {
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ eventName }),
    });
    return response.ok ? null : `HTTP ${response.status}`;
  } catch (err) {
    return err.message;
  }
}

// --- health checks while remediated ------------------------------------------
function startHealthChecks() {
  stopHealthChecks();
  watchdog.healthyChecks = 0;
  watchdog.toldHumanToRecover = false;
  watchdog.probeTimer = setInterval(runHealthCheck, PROBE_EVERY_MS);
}

function stopHealthChecks() {
  clearInterval(watchdog.probeTimer);
  watchdog.probeTimer = null;
}

async function runHealthCheck() {
  // Call the service exactly the way the carousel does.
  let healthy = false;
  try {
    const res = await fetch(`http://localhost:${PORT}/api/recommendations`);
    healthy = res.ok;
  } catch {
    healthy = false;
  }
  if (watchdog.state !== 'remediated') return; // something else moved us on meanwhile

  watchdog.healthyChecks = healthy ? watchdog.healthyChecks + 1 : 0;
  console.log(`[watchdog] health check: ${healthy ? 'pass' : 'fail'} (${watchdog.healthyChecks}/${HEALTHY_CHECKS_NEEDED} in a row)`);
  if (watchdog.healthyChecks < HEALTHY_CHECKS_NEEDED) return;

  if (!ON_TRIGGER_URL) {
    if (!watchdog.toldHumanToRecover) {
      watchdog.toldHumanToRecover = true;
      console.log('[watchdog] service is healthy again; no ON trigger set, so a person can turn the flag back on');
    }
    return;
  }

  watchdog.triggeredAt = Date.now();
  setState('recovering', `${HEALTHY_CHECKS_NEEDED} health checks passed; firing the ON trigger`);
  const problem = await fireTrigger(ON_TRIGGER_URL, 'ACME Shop watchdog: recommendations service healthy again');
  if (problem) setState('remediated', `ON trigger failed (${problem}); still health-checking`);
}

// --- what the page shows -------------------------------------------------------
app.get('/api/watchdog', (req, res) => {
  res.json({
    enabled: Boolean(OFF_TRIGGER_URL),
    autoRecover: Boolean(ON_TRIGGER_URL),
    state: watchdog.state,
    healthyChecks: watchdog.healthyChecks,
    healthyChecksNeeded: HEALTHY_CHECKS_NEEDED,
    waitingForHuman: watchdog.toldHumanToRecover,
  });
});

// --- the browser reports each carousel error ----------------------------------
app.post('/api/watchdog/error', async (req, res) => {
  if (watchdog.state !== 'armed') {
    // Already handling this incident; don't count or fire again.
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

  if (!OFF_TRIGGER_URL) {
    console.log('[watchdog] threshold reached, but no OFF trigger URL is set in .env, so nothing was sent.');
    return res.json({ state: watchdog.state, count, message: 'Threshold reached, but no trigger URL is set' });
  }

  watchdog.recentErrors = [];
  watchdog.triggeredAt = now;
  const result = setState('tripped', `${count} errors in ${WINDOW_MS / 1000}s; firing the OFF trigger`);
  const problem = await fireTrigger(OFF_TRIGGER_URL, 'ACME Shop watchdog: recommendations carousel error rate exceeded');
  if (problem) {
    return res.json(setState('armed', `OFF trigger failed (${problem}); re-armed`));
  }
  return res.json(result);
});

// --- the browser reports the carousel's state whenever it changes -------------
// flagOn  = the value LaunchDarkly is serving right now
// healthy = the carousel rendered without an error (only meaningful when on)
app.post('/api/watchdog/status', (req, res) => {
  const { flagOn, healthy } = req.body;
  const { state } = watchdog;
  const secondsSinceTrigger = () => ((Date.now() - watchdog.triggeredAt) / 1000).toFixed(1);
  const overdue = () => Date.now() - watchdog.triggeredAt > CONFIRM_TIMEOUT_MS;

  if (state === 'tripped') {
    if (!flagOn) return res.json(setState('remediated', `flag confirmed OFF ${secondsSinceTrigger()}s after the trigger fired`));
    if (overdue()) return res.json({ state, message: 'OFF trigger fired but the flag is still ON; check LaunchDarkly' });
  }

  if (state === 'remediated' && flagOn) {
    // A person turned the flag back on by hand.
    watchdog.recentErrors = [];
    return res.json(healthy
      ? setState('armed', 'RECOVERED: flag turned back on by hand and the carousel is healthy')
      : setState('armed', 'flag turned back on, but the carousel is still failing; watching for a new incident'));
  }

  if (state === 'recovering' && flagOn) {
    watchdog.recentErrors = [];
    return res.json(healthy
      ? setState('armed', `RECOVERED: flag confirmed ON ${secondsSinceTrigger()}s after the ON trigger, carousel healthy`)
      : setState('armed', 'flag back on, but the carousel is failing again; watching for a new incident'));
  }

  if (state === 'recovering' && !flagOn && overdue()) {
    return res.json({ state, message: 'ON trigger fired but the flag is still OFF; check LaunchDarkly' });
  }

  return res.json({ state });
});

app.listen(PORT, () => {
  console.log(`\nACME Shop is running at http://localhost:${PORT}`);
  console.log(`Watchdog auto-remediation (OFF trigger): ${OFF_TRIGGER_URL ? 'ON' : 'OFF (no URL in .env)'}`);
  console.log(`Watchdog auto-recovery (ON trigger):     ${ON_TRIGGER_URL ? 'ON' : 'OFF (a person turns the flag back on)'}\n`);
});
