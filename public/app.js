// =============================================================================
// ACME Shop - storefront logic
// -----------------------------------------------------------------------------
// Everything LaunchDarkly-related in the browser lives in this file. Every line
// that talks to LaunchDarkly has an "LD:" comment, so searching for "LD:"
// gives a guided tour of the SDK: import, createClient, on, start, variation,
// identify and track.
//
// Flags this page uses (create both in your LaunchDarkly project, and tick
// "SDKs using Client-side ID" under Client-side SDK availability on each one):
//
//   recommendations-carousel  (Boolean)  Part 1: release, roll back, remediate
//   homepage-promo-banner     (Boolean)  Part 2: targeting, plus the experiment
// =============================================================================

// LD: the LaunchDarkly JavaScript client-side SDK (served by server.js).
import { createClient } from './vendor/launchdarkly.js';

const CAROUSEL_FLAG = 'recommendations-carousel';
const BANNER_FLAG = 'homepage-promo-banner';

// -----------------------------------------------------------------------------
// Demo shoppers (Part 2: Context attributes)
// A "context" is how we describe the person using the app to LaunchDarkly.
// LaunchDarkly targeting rules match against these attributes.
// In a real store these values would come from the logged-in account.
// -----------------------------------------------------------------------------
const PERSONAS = {
  anonymous: {
    label: 'Anonymous visitor',
    context: { kind: 'user', key: `visitor-${crypto.randomUUID()}`, anonymous: true },
  },
  alice: {
    label: 'Alice (beta tester, bronze, US)',
    // Part 2 INDIVIDUAL targeting: add the key "shopper-alice" to the
    // homepage-promo-banner flag's individual targets so she sees the new banner.
    context: {
      kind: 'user', key: 'shopper-alice', name: 'Alice Nguyen', email: 'alice@example.com',
      loyaltyTier: 'bronze', country: 'US', betaTester: true,
    },
  },
  bob: {
    label: 'Bob (gold, US)',
    // Part 2 RULE-BASED targeting: matches the rule
    // "loyaltyTier is gold AND country is US".
    context: {
      kind: 'user', key: 'shopper-bob', name: 'Bob Martin', email: 'bob@example.com',
      loyaltyTier: 'gold', country: 'US', betaTester: false,
    },
  },
  carla: {
    label: 'Carla (gold, Canada)',
    // Gold, but in Canada, so the rule does NOT match: she gets the default.
    context: {
      kind: 'user', key: 'shopper-carla', name: 'Carla Roy', email: 'carla@example.com',
      loyaltyTier: 'gold', country: 'CA', betaTester: false,
    },
  },
  dana: {
    label: 'Dana (silver, US)',
    // Matches nothing: she gets the default.
    context: {
      kind: 'user', key: 'shopper-dana', name: 'Dana Smith', email: 'dana@example.com',
      loyaltyTier: 'silver', country: 'US', betaTester: false,
    },
  },
};

const PRODUCTS = [
  { id: 'p1', name: 'Canvas Weekender', price: 89, emoji: '👜', color: '#f6e7d8' },
  { id: 'p2', name: 'Trail Runner Shoes', price: 120, emoji: '👟', color: '#e1f0ea' },
  { id: 'p3', name: 'Wool Beanie', price: 28, emoji: '🧢', color: '#e6e9fb' },
  { id: 'p4', name: 'Ceramic Pour-Over', price: 42, emoji: '☕', color: '#f9e3e3' },
  { id: 'p5', name: 'Noise-Cancel Headphones', price: 199, emoji: '🎧', color: '#e9e5f7' },
  { id: 'p6', name: 'Desk Plant', price: 24, emoji: '🪴', color: '#e3f2df' },
];

// --- page elements -----------------------------------------------------------
const $ = (id) => document.getElementById(id);
const personaSelect = $('persona-select');
const bugToggle = $('bug-toggle');
let cartCount = 0;
let retryTimer = null; // while the carousel is failing, it retries every few seconds
let carouselRun = 0; // ignores slow responses from an earlier render
let lastWatchdogState = null;
let quiet = true; // true while the page itself is loading flag values (start, shopper switch)
let lastCarouselStatus = null; // last carousel status sent to the watchdog

// =============================================================================
// 1. Start the LaunchDarkly client
// =============================================================================
const { clientSideId, watchdogEnabled } = await fetch('/api/config').then((r) => r.json());
if (watchdogEnabled) {
  await refreshWatchdog();
  setInterval(refreshWatchdog, 2000); // keep the demo panel current
} else {
  $('watchdog-status').textContent = 'off (no trigger URL)';
}
bugToggle.checked = (await fetch('/api/simulate-bug').then((r) => r.json())).broken;

// LD: create the client with the Client-side ID and the starting context.
const ldClient = createClient(clientSideId, PERSONAS.anonymous.context);

// =============================================================================
// 2. The listeners (Part 1: instant release and rollback)
// -----------------------------------------------------------------------------
// LD: subscribing to "change:<flag-key>" keeps a streaming connection open to
// LaunchDarkly. When someone flips the flag in the dashboard (or a trigger
// flips it), LaunchDarkly pushes the new value here within about a second and
// we redraw just that part of the page. No reload.
// (While the page is loading values itself, we redraw but don't log a
// "change", because nobody changed anything in LaunchDarkly.)
// =============================================================================
// LD: listen for changes to the carousel flag.
ldClient.on(`change:${CAROUSEL_FLAG}`, () => {
  if (!quiet) log(`${CAROUSEL_FLAG} changed → ${onOff(ldClient.variation(CAROUSEL_FLAG, false))}`);
  renderCarousel();
});
// LD: listen for changes to the banner flag.
ldClient.on(`change:${BANNER_FLAG}`, () => {
  if (!quiet) log(`${BANNER_FLAG} changed → ${onOff(ldClient.variation(BANNER_FLAG, false))}`);
  renderBanner();
});

// LD: start() connects to LaunchDarkly and downloads this context's flag values.
// If LaunchDarkly can't be reached within 5 seconds, the page still works:
// every variation() call returns its fallback value (false = the old page).
const result = await ldClient.start({ timeout: 5 });
$('sdk-status').textContent = result.status === 'complete' ? 'connected' : `not ready (${result.status})`;
log(`SDK started as "${PERSONAS.anonymous.label}"`);
quiet = false;

// =============================================================================
// 3. Switching shoppers (Part 2: targeting)
// LD: identify() tells LaunchDarkly "the user is now this person". It fetches
// that person's flag values, so the page can show what THEY should see.
// =============================================================================
for (const [id, p] of Object.entries(PERSONAS)) {
  personaSelect.add(new Option(p.label, id));
}
personaSelect.addEventListener('change', async () => {
  const persona = PERSONAS[personaSelect.value];
  quiet = true;
  await ldClient.identify(persona.context); // LD: switch to this shopper's context
  quiet = false;
  log(`identify → "${persona.label}"`);
  renderAll();
});

// Demo control: break or fix the recommendations service on the server.
bugToggle.addEventListener('change', async () => {
  await postJson('/api/simulate-bug', { broken: bugToggle.checked });
  log(bugToggle.checked ? 'recommendations service BROKEN (simulated)' : 'recommendations service fixed');
  renderCarousel();
});

renderProducts();
renderAll();

// =============================================================================
// Rendering
// =============================================================================
function renderAll() {
  renderBanner();
  renderCarousel();
}

// Part 2: the banner component behind homepage-promo-banner.
function renderBanner() {
  // LD: variation() returns this context's value for the flag. The second
  // argument (false) is the fallback if LaunchDarkly can't be reached.
  const showNew = ldClient.variation(BANNER_FLAG, false);
  $('flag-banner').innerHTML = statusHtml(showNew);

  const banner = $('banner');
  if (showNew) {
    banner.className = 'banner new';
    banner.innerHTML = `
      <span class="pill">New</span>
      <h1>Free shipping on everything, this week only</h1>
      <p>No minimum order. Gear up for fall.</p>
      <button data-product="p5">Shop headphones</button>`;
  } else {
    banner.className = 'banner old';
    banner.innerHTML = `
      <h1>Fall collection</h1>
      <p>Fresh picks for cooler days.</p>
      <button data-product="p5">Shop headphones</button>`;
  }
  banner.querySelector('button').onclick = () => addToCart('p5', 'banner');
}

// Part 1: the new feature behind recommendations-carousel.
// The carousel loads its products from the recommendations service. If that
// call fails, the carousel shows an error, reports it to the watchdog, and
// tries again in 3 seconds (standing in for many shoppers hitting the bug).
async function renderCarousel() {
  const run = ++carouselRun;
  clearTimeout(retryTimer);
  const showCarousel = ldClient.variation(CAROUSEL_FLAG, false); // LD: on or off for this shopper?
  $('flag-carousel').innerHTML = statusHtml(showCarousel);
  const el = $('recommendations');

  if (!showCarousel) {
    // Flag OFF: the old experience, with no carousel at all.
    el.innerHTML = '';
    reportCarouselStatus(false, true);
    return;
  }

  try {
    const res = await fetch('/api/recommendations');
    if (!res.ok) throw new Error((await res.json()).error ?? `HTTP ${res.status}`);
    const { items } = await res.json();
    if (run !== carouselRun) return; // a newer render has started; let it win

    const cards = items.map((id) => productCard(PRODUCTS.find((p) => p.id === id))).join('');
    el.innerHTML = `<div class="carousel">
        <h2>Recommended for you <span class="badge">NEW</span></h2>
        <div class="track">${cards}</div>
      </div>`;
    el.querySelectorAll('button[data-product]').forEach((b) => {
      b.onclick = () => addToCart(b.dataset.product, 'carousel');
    });
    reportCarouselStatus(true, true);
  } catch (err) {
    if (run !== carouselRun) return;
    el.innerHTML = `<div class="carousel broken">⚠️ Recommendations failed to load: ${err.message}</div>`;
    reportCarouselStatus(true, false);
    reportError(err);
    retryTimer = setTimeout(renderCarousel, 3000);
  }
}

function renderProducts() {
  const grid = $('product-grid');
  grid.innerHTML = PRODUCTS.map(productCard).join('');
  grid.querySelectorAll('button[data-product]').forEach((b) => {
    b.onclick = () => addToCart(b.dataset.product, 'grid');
  });
}

function productCard(p) {
  return `<article class="product">
      <div class="art" style="background:${p.color}">${p.emoji}</div>
      <h4>${p.name}</h4>
      <div class="price">$${p.price}</div>
      <button data-product="${p.id}">Add to cart</button>
    </article>`;
}

// =============================================================================
// Metrics (Extra credit: Experimentation)
// LD: track() sends a custom event. A LaunchDarkly metric with the event key
// "add-to-cart" counts these, so an experiment can compare banner versions.
// =============================================================================
function addToCart(productId, source) {
  cartCount += 1;
  $('cart-count').textContent = cartCount;
  const product = PRODUCTS.find((p) => p.id === productId);
  ldClient.track('add-to-cart', { productId, source }, product.price); // LD: send the custom event
  log(`track("add-to-cart") ${product.name} from ${source}`);
}

// =============================================================================
// Talking to the watchdog (Part 1: automated remediation)
// The page tells the server two things:
//   - every carousel error (POST /api/watchdog/error)
//   - the carousel's current state: is the flag on, and did it render cleanly?
//     (POST /api/watchdog/status). This is how the watchdog confirms a
//     trigger really changed the flag, and sees the recovery.
// It also polls GET /api/watchdog to show the watchdog's state in the panel.
// =============================================================================
async function reportError(err) {
  const res = await postJson('/api/watchdog/error', { message: err.message });
  if (res.message) log(`watchdog: ${res.message}`);
  else if (res.count) log(`error reported to watchdog (${res.count})`);
  refreshWatchdog();
}

async function reportCarouselStatus(flagOn, healthy) {
  const status = `${flagOn}/${healthy}`;
  if (status === lastCarouselStatus) return; // only report changes
  lastCarouselStatus = status;
  const res = await postJson('/api/watchdog/status', { flagOn, healthy });
  if (res.message) log(`watchdog: ${res.message}`);
  refreshWatchdog();
}

// Reads the watchdog's state and shows it in the demo panel. The health checks
// run on the server, so polling is how the page sees their progress.
async function refreshWatchdog() {
  const wd = await fetch('/api/watchdog').then((r) => r.json()).catch(() => null);
  if (!wd) return;
  const labels = {
    armed: '<span class="on">armed</span>',
    tripped: `<span class="off">tripped: waiting for LaunchDarkly (${wd.waitingSeconds}s)</span>`,
    remediated: wd.waitingForHuman
      ? '<span class="warn">remediated: healthy, waiting for a person</span>'
      : `<span class="warn">remediated: health checks ${wd.healthyChecks}/${wd.healthyChecksNeeded}</span>`,
    recovering: `<span class="warn">recovering: waiting for LaunchDarkly (${wd.waitingSeconds}s)</span>`,
  };
  $('watchdog-status').innerHTML = labels[wd.state] ?? wd.state;

  if (lastWatchdogState === 'remediated' && wd.state === 'recovering') {
    log(`watchdog: ${wd.healthyChecksNeeded} health checks passed; ON trigger fired`);
  }
  lastWatchdogState = wd.state;
}

async function postJson(url, body) {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then((r) => r.json()).catch(() => ({}));
}

// --- helpers -----------------------------------------------------------------
function onOff(v) { return v ? 'ON' : 'OFF'; }
function statusHtml(v) { return `<span class="${v ? 'on' : 'off'}">${onOff(v)}</span>`; }
function log(message) {
  const li = document.createElement('li');
  li.innerHTML = `<time>${new Date().toLocaleTimeString()}</time>${message}`;
  $('event-log').prepend(li);
}
