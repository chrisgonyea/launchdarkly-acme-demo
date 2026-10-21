// =============================================================================
// ACME Shop - the watchdog (Part 1: automated remediation)
// -----------------------------------------------------------------------------
// The homework asks for a trigger that can turn off a problematic feature, for
// example with curl. This file goes one step further and automates it: no
// person has to notice the problem or flip a switch.
//
// The browser reports carousel errors and the carousel's state to the routes
// below. The watchdog moves through four states (the demo panel shows which):
//
//   armed       Watching. If ERROR_THRESHOLD errors arrive within WINDOW_MS,
//               it fires the OFF trigger and moves to "tripped".
//   tripped     OFF trigger sent. Waits for proof it worked: the browser
//               reports the value LaunchDarkly now serves. When that is OFF,
//               it moves to "remediated".
//   remediated  Flag confirmed off; shoppers see the old page. The watchdog
//               health-checks the recommendations service every PROBE_EVERY_MS.
//               After HEALTHY_CHECKS_NEEDED passes in a row it fires the ON
//               trigger (if one is set) and moves to "recovering". Without an
//               ON trigger, it waits for a person to turn the flag back on.
//   recovering  ON trigger sent. When the browser reports the flag ON and the
//               carousel healthy, it logs RECOVERED and goes back to "armed".
//
// It fires each trigger at most once per incident, so it can never toggle a
// flag in a loop. If someone turns the flag back on by hand while the service
// is still broken, it re-arms and the next errors start a new incident.
//
// Note: LaunchDarkly applies a trigger asynchronously. In testing, the flag
// changed 20 to 65 seconds after the trigger call (a dashboard toggle streams
// to the page in about a second). The watchdog therefore waits up to
// CONFIRM_TIMEOUT_MS for confirmation before warning.
// =============================================================================

import express from 'express';

const ERROR_THRESHOLD = 5;
const WINDOW_MS = 30_000;
const CONFIRM_TIMEOUT_MS = 120_000;
const PROBE_EVERY_MS = 5_000;
const HEALTHY_CHECKS_NEEDED = 3;

/**
 * Creates the watchdog's routes.
 * @param {object} options
 * @param {string} [options.offTriggerUrl]  LaunchDarkly "turn flag off" trigger URL
 * @param {string} [options.onTriggerUrl]   LaunchDarkly "turn flag on" trigger URL
 * @param {string} options.healthCheckUrl   the service the carousel depends on
 */
export function createWatchdog({ offTriggerUrl, onTriggerUrl, healthCheckUrl }) {
  const router = express.Router();

  const wd = {
    state: 'armed',
    recentErrors: [], // timestamps of recent errors, only counted while armed
    triggeredAt: null, // when the latest trigger was sent
    confirmTimer: null, // warns if LaunchDarkly hasn't applied the trigger in time
    healthyChecks: 0, // passing health checks in a row, while remediated
    probeTimer: null,
    waitingForHuman: false,
  };

  function setState(state, message) {
    wd.state = state;
    console.log(`[watchdog] ${state.toUpperCase()}: ${message}`);
    clearTimeout(wd.confirmTimer);
    if (state === 'remediated') startHealthChecks();
    else stopHealthChecks();
    return { state, message };
  }

  // A generic LaunchDarkly trigger is just an HTTP POST to a secret URL. The
  // JSON body is optional; its eventName shows up in the flag's change history.
  // Returns null on success, or a short description of what went wrong.
  async function fireTrigger(url, eventName) {
    wd.triggeredAt = Date.now();
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventName }),
      });
      if (!response.ok) return `HTTP ${response.status}`;
    } catch (err) {
      return err.message;
    }
    // Accepted. Warn if LaunchDarkly hasn't applied it within CONFIRM_TIMEOUT_MS.
    const stateWhenFired = wd.state;
    wd.confirmTimer = setTimeout(() => {
      if (wd.state === stateWhenFired) {
        console.log(`[watchdog] WARNING: trigger sent ${CONFIRM_TIMEOUT_MS / 1000}s ago and the flag still hasn't changed; check LaunchDarkly`);
      }
    }, CONFIRM_TIMEOUT_MS);
    return null;
  }

  const secondsSinceTrigger = () => Math.round((Date.now() - wd.triggeredAt) / 1000);

  // --- health checks while remediated ----------------------------------------
  function startHealthChecks() {
    stopHealthChecks();
    wd.healthyChecks = 0;
    wd.waitingForHuman = false;
    wd.probeTimer = setInterval(runHealthCheck, PROBE_EVERY_MS);
  }

  function stopHealthChecks() {
    clearInterval(wd.probeTimer);
    wd.probeTimer = null;
  }

  async function runHealthCheck() {
    // Call the service exactly the way the carousel does.
    const healthy = await fetch(healthCheckUrl).then((r) => r.ok).catch(() => false);
    if (wd.state !== 'remediated') return; // something else moved us on meanwhile

    wd.healthyChecks = healthy ? wd.healthyChecks + 1 : 0;
    console.log(`[watchdog] health check: ${healthy ? 'pass' : 'fail'} (${wd.healthyChecks}/${HEALTHY_CHECKS_NEEDED} in a row)`);
    if (wd.healthyChecks < HEALTHY_CHECKS_NEEDED) return;

    if (!onTriggerUrl) {
      if (!wd.waitingForHuman) {
        wd.waitingForHuman = true;
        console.log('[watchdog] service is healthy again; no ON trigger set, so a person can turn the flag back on');
      }
      return;
    }

    setState('recovering', `${HEALTHY_CHECKS_NEEDED} health checks passed; firing the ON trigger`);
    const problem = await fireTrigger(onTriggerUrl, 'ACME Shop watchdog: recommendations service healthy again');
    if (problem) setState('remediated', `ON trigger failed (${problem}); still health-checking`);
  }

  // --- GET /api/watchdog: current state, for the demo panel -------------------
  router.get('/', (req, res) => {
    const waiting = wd.state === 'tripped' || wd.state === 'recovering';
    res.json({
      enabled: Boolean(offTriggerUrl),
      autoRecover: Boolean(onTriggerUrl),
      state: wd.state,
      waitingSeconds: waiting ? secondsSinceTrigger() : null,
      healthyChecks: wd.healthyChecks,
      healthyChecksNeeded: HEALTHY_CHECKS_NEEDED,
      waitingForHuman: wd.waitingForHuman,
    });
  });

  // --- POST /api/watchdog/error: the browser reports each carousel error ------
  router.post('/error', async (req, res) => {
    if (wd.state !== 'armed') {
      return res.json({ state: wd.state }); // already handling this incident
    }

    const now = Date.now();
    wd.recentErrors = wd.recentErrors.filter((t) => now - t < WINDOW_MS);
    wd.recentErrors.push(now);
    const count = wd.recentErrors.length;
    console.log(`[watchdog] carousel error reported (${count}/${ERROR_THRESHOLD} in the last ${WINDOW_MS / 1000}s)`);

    if (count < ERROR_THRESHOLD) return res.json({ state: wd.state, count });

    if (!offTriggerUrl) {
      console.log('[watchdog] threshold reached, but no OFF trigger URL is set in .env, so nothing was sent.');
      return res.json({ state: wd.state, count, message: 'Threshold reached, but no trigger URL is set' });
    }

    wd.recentErrors = [];
    const result = setState('tripped', `${count} errors in ${WINDOW_MS / 1000}s; firing the OFF trigger`);
    const problem = await fireTrigger(offTriggerUrl, 'ACME Shop watchdog: recommendations carousel error rate exceeded');
    res.json(problem ? setState('armed', `OFF trigger failed (${problem}); re-armed`) : result);
  });

  // --- POST /api/watchdog/status: the carousel's state, whenever it changes ---
  // flagOn  = the value LaunchDarkly is serving right now
  // healthy = the carousel rendered without an error (only meaningful when on)
  router.post('/status', (req, res) => {
    const { flagOn, healthy } = req.body;

    if (wd.state === 'tripped' && !flagOn) {
      return res.json(setState('remediated', `flag confirmed OFF ${secondsSinceTrigger()}s after the trigger fired`));
    }

    if ((wd.state === 'remediated' || wd.state === 'recovering') && flagOn) {
      const how = wd.state === 'recovering'
        ? `flag confirmed ON ${secondsSinceTrigger()}s after the ON trigger`
        : 'flag turned back on by hand';
      wd.recentErrors = [];
      return res.json(healthy
        ? setState('armed', `RECOVERED: ${how}, carousel healthy`)
        : setState('armed', `${how}, but the carousel is still failing; watching for a new incident`));
    }

    res.json({ state: wd.state });
  });

  return router;
}
