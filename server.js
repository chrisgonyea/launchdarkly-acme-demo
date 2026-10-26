// =============================================================================
// ACME Shop - demo web server
// -----------------------------------------------------------------------------
// This small Express server:
//   1. Serves the storefront (everything in the /public folder).
//   2. Hands the browser its LaunchDarkly Client-side ID (GET /api/config).
//   3. Runs the "recommendations service" that the new carousel loads its
//      products from (GET /api/recommendations). The demo's "Simulate a bug"
//      switch breaks this service, the way a real backend outage would.
//   4. Mounts the watchdog (watchdog.js), which uses LaunchDarkly triggers to
//      turn the carousel off when it keeps failing, and back on once healthy.
//
// All feature-flag evaluation happens in the BROWSER, with the LaunchDarkly
// JavaScript client-side SDK (see public/app.js). The server never evaluates
// flags; it only calls LaunchDarkly's trigger URLs.
// =============================================================================

import 'dotenv/config'; // loads the values from your .env file into process.env
import express from 'express';
import { createWatchdog } from './watchdog.js';

const PORT = process.env.PORT || 3000;

// -----------------------------------------------------------------------------
// REPLACE ME: put your own LaunchDarkly Client-side ID in the .env file.
// In LaunchDarkly: Project settings > Environments > your environment >
// "Client-side ID". This is NOT the SDK key: the Client-side ID is safe to
// send to a browser, while the SDK key is a secret.
// -----------------------------------------------------------------------------
const CLIENT_SIDE_ID = process.env.LD_CLIENT_SIDE_ID;

// -----------------------------------------------------------------------------
// OPTIONAL: trigger URLs for the recommendations-carousel flag (see README,
// "Create the triggers"). Treat them like passwords: anyone with the URL can
// flip the flag.
//   OFF URL blank -> the watchdog only logs; fire the trigger by hand with curl.
//   ON URL blank  -> after an incident, a person turns the flag back on.
// -----------------------------------------------------------------------------
const OFF_TRIGGER_URL = process.env.LD_CAROUSEL_OFF_TRIGGER_URL;
const ON_TRIGGER_URL = process.env.LD_CAROUSEL_ON_TRIGGER_URL;

if (!CLIENT_SIDE_ID) {
  console.error('\nMissing LD_CLIENT_SIDE_ID. Copy .env.example to .env and fill it in.\n');
  process.exit(1);
}

const app = express();
app.use(express.json());
app.use(express.static('public'));

// The LaunchDarkly browser SDK ships as one self-contained file, so we serve it
// straight from node_modules. No bundler or CDN needed.
app.get('/vendor/launchdarkly.js', (req, res) => {
  res.sendFile('node_modules/@launchdarkly/js-client-sdk/dist/index.js', { root: '.' });
});

// The browser asks for its Client-side ID here, so the ID lives only in .env.
app.get('/api/config', (req, res) => {
  res.json({ clientSideId: CLIENT_SIDE_ID, watchdogEnabled: Boolean(OFF_TRIGGER_URL) });
});

// --- The recommendations service (what the new carousel depends on) ----------
let serviceBroken = false; // flipped by the demo's "Simulate a bug" switch

app.get('/api/recommendations', (req, res) => {
  if (serviceBroken) {
    return res.status(503).json({ error: 'Recommendations service unavailable' });
  }
  res.json({ items: ['p5', 'p2', 'p4', 'p1'] }); // product ids, see PRODUCTS in app.js
});

// Demo control only: read, break or fix the recommendations service.
app.get('/api/simulate-bug', (req, res) => res.json({ broken: serviceBroken }));
app.post('/api/simulate-bug', (req, res) => {
  serviceBroken = Boolean(req.body.broken);
  console.log(`[demo] recommendations service is now ${serviceBroken ? 'BROKEN' : 'healthy'}`);
  res.json({ broken: serviceBroken });
});

// --- The watchdog (watchdog.js) ----------------------------------------------
app.use('/api/watchdog', createWatchdog({
  offTriggerUrl: OFF_TRIGGER_URL,
  onTriggerUrl: ON_TRIGGER_URL,
  healthCheckUrl: `http://localhost:${PORT}/api/recommendations`,
}));

app.listen(PORT, () => {
  console.log(`\nACME Shop is running at http://localhost:${PORT}`);
  console.log(`Watchdog auto-remediation (OFF trigger): ${OFF_TRIGGER_URL ? 'ON' : 'OFF (no URL in .env)'}`);
  console.log(`Watchdog auto-recovery (ON trigger):     ${ON_TRIGGER_URL ? 'ON' : 'OFF (a person turns the flag back on)'}\n`);
});
