// =============================================================================
// ACME Shop - synthetic traffic for the experiment (Extra credit: Experimentation)
// -----------------------------------------------------------------------------
// SYNTHETIC DATA. An experiment needs hundreds of shoppers, and a demo has
// only the person clicking. This script stands in for real traffic so the
// whole experiment workflow (metric, split, results, decision) can be shown.
// Its results say nothing about real shoppers.
//
// For each synthetic shopper it:
//   1. asks LaunchDarkly which banner this shopper gets (homepage-promo-banner),
//   2. "adds to cart" with a set probability that depends on the banner,
//   3. sends the same add-to-cart event the real page sends.
//
// LaunchDarkly does the 50/50 split, not this script; the script only decides
// how likely each group is to convert (the "true" effect the experiment should
// find). Run it AFTER the experiment has been started, or the events won't
// count toward the experiment.
//
//   npm run simulate                     2,000 shoppers (the default)
//   npm run simulate -- --shoppers 5000  any number of shoppers
//
// REPLACE ME: this uses the server-side SDK, so it needs LD_SDK_KEY in .env
// (Project settings > Environments > your environment > SDK key). The SDK key
// is a secret: keep it in .env, never in code or in the browser.
// =============================================================================

import 'dotenv/config';
import { init } from '@launchdarkly/node-server-sdk';

const BANNER_FLAG = 'homepage-promo-banner';
const METRIC_EVENT = 'add-to-cart'; // must match the event key of the metric

// The made-up "truth" the experiment should uncover.
const ADD_TO_CART_RATE = { oldBanner: 0.10, newBanner: 0.13 };

// Shoppers are bronze or silver, so they fall through to the flag's default
// rule, which is the rule the experiment runs on. (Gold US shoppers match the
// Part 2 targeting rule instead and would never enter the experiment.)
const TIERS = ['bronze', 'bronze', 'silver'];
const COUNTRIES = ['US', 'US', 'CA'];
const PRICES = [24, 28, 42, 89, 120, 199];

const pick = (list) => list[Math.floor(Math.random() * list.length)];

function syntheticShopper(runId, n) {
  return {
    kind: 'user',
    key: `sim-${runId}-${n}`,
    name: `Synthetic shopper ${n}`,
    loyaltyTier: pick(TIERS),
    country: pick(COUNTRIES),
    betaTester: false,
    synthetic: true, // marks this traffic as simulated in LaunchDarkly
  };
}

/**
 * Sends `shoppers` synthetic visits through the banner flag.
 * Exported so it can be tested without a LaunchDarkly account.
 */
export async function simulate(ldClient, { shoppers, log = console.log }) {
  const runId = Date.now().toString(36);
  const tally = { oldBanner: { shoppers: 0, carts: 0 }, newBanner: { shoppers: 0, carts: 0 } };

  for (let n = 1; n <= shoppers; n++) {
    const context = syntheticShopper(runId, n);

    // LD: which banner does LaunchDarkly serve this shopper? (Same call as the page.)
    const showNew = await ldClient.variation(BANNER_FLAG, context, false);
    const group = showNew ? 'newBanner' : 'oldBanner';
    tally[group].shoppers += 1;

    if (Math.random() < ADD_TO_CART_RATE[group]) {
      // LD: send the conversion event, exactly as the page's Add to cart button does.
      ldClient.track(METRIC_EVENT, context, { source: 'simulator' }, pick(PRICES));
      tally[group].carts += 1;
    }

    if (n % 500 === 0) {
      await ldClient.flush(); // LD: send queued events in batches
      log(`  ${n} / ${shoppers} shoppers sent`);
    }
  }
  await ldClient.flush();
  return tally;
}

// --- Run from the command line ----------------------------------------------
if (import.meta.url === `file://${process.argv[1]}`) {
  const sdkKey = process.env.LD_SDK_KEY;
  if (!sdkKey) {
    console.error('\nMissing LD_SDK_KEY. Add your server-side SDK key to .env (see README, "Set up the experiment").\n');
    process.exit(1);
  }
  const argIndex = process.argv.indexOf('--shoppers');
  const shoppers = argIndex > -1 ? Number(process.argv[argIndex + 1]) : 2000;
  if (!Number.isInteger(shoppers) || shoppers < 1) {
    console.error('\n--shoppers must be a positive whole number.\n');
    process.exit(1);
  }

  // LD: the server-side SDK, initialized with the SDK key.
  const ldClient = init(sdkKey);
  try {
    await ldClient.waitForInitialization({ timeout: 10 });
  } catch {
    console.error('\nCould not connect to LaunchDarkly. Check LD_SDK_KEY is the SDK key for the right environment.\n');
    process.exit(1);
  }

  console.log(`\nSending ${shoppers} SYNTHETIC shoppers through "${BANNER_FLAG}"...`);
  const tally = await simulate(ldClient, { shoppers });
  ldClient.close();

  console.log('\nSent (synthetic data):');
  for (const [group, { shoppers: s, carts }] of Object.entries(tally)) {
    const rate = s ? ((carts / s) * 100).toFixed(1) : '0.0';
    console.log(`  ${group.padEnd(9)} ${String(s).padStart(5)} shoppers, ${String(carts).padStart(4)} add-to-carts (${rate}%)`);
  }
  console.log('\nResults appear on the experiment in LaunchDarkly within a few minutes.\n');
}
