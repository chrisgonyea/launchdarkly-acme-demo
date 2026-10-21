// =============================================================================
// ABC Shop - storefront logic
// -----------------------------------------------------------------------------
// Everything LaunchDarkly-related in the browser lives in this file. Look for
// the "LD:" comments; those are the lines that talk to LaunchDarkly.
//
// Flags this page uses (create both in your LaunchDarkly project, and tick
// "SDKs using Client-side ID" under Client-side SDK availability on each one):
//
//   recommendations-carousel  (Boolean)  Part 1: release, roll back, remediate
//   homepage-promo-banner     (Boolean)  Part 2: targeting, plus the experiment
// =============================================================================

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
const RECOMMENDED = ['p5', 'p2', 'p4', 'p1'];

// --- page elements -----------------------------------------------------------
const $ = (id) => document.getElementById(id);
const personaSelect = $('persona-select');
const bugToggle = $('bug-toggle');
let cartCount = 0;
let errorLoop = null; // repeats error reports while the "bug" is live

// =============================================================================
// 1. Start the LaunchDarkly client
// =============================================================================
const { clientSideId, watchdogEnabled } = await fetch('/api/config').then((r) => r.json());
$('watchdog-status').textContent = watchdogEnabled ? 'armed' : 'off (no trigger URL)';

// LD: create the client with the Client-side ID and the starting context.
const ldClient = createClient(clientSideId, PERSONAS.anonymous.context);

// =============================================================================
// 2. The listeners (Part 1: instant release and rollback)
// -----------------------------------------------------------------------------
// LD: subscribing to "change:<flag-key>" keeps a streaming connection open to
// LaunchDarkly. When someone flips the flag in the dashboard (or a trigger
// flips it), LaunchDarkly pushes the new value here within about a second and
// we redraw just that part of the page. No reload.
// =============================================================================
ldClient.on(`change:${CAROUSEL_FLAG}`, () => {
  log(`${CAROUSEL_FLAG} changed → ${onOff(ldClient.variation(CAROUSEL_FLAG, false))}`);
  renderCarousel();
});
ldClient.on(`change:${BANNER_FLAG}`, () => {
  log(`${BANNER_FLAG} changed → ${onOff(ldClient.variation(BANNER_FLAG, false))}`);
  renderBanner();
});

// LD: start() connects to LaunchDarkly and downloads this context's flag values.
const result = await ldClient.start({ timeout: 5 });
$('sdk-status').textContent = result.status === 'complete' ? 'connected' : `not ready (${result.status})`;
log(`SDK started as "${PERSONAS.anonymous.label}"`);

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
  await ldClient.identify(persona.context);
  log(`identify → "${persona.label}"`);
  renderAll();
});

bugToggle.addEventListener('change', () => {
  log(bugToggle.checked ? 'bug simulation ON' : 'bug simulation OFF');
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
function renderCarousel() {
  const showCarousel = ldClient.variation(CAROUSEL_FLAG, false);
  $('flag-carousel').innerHTML = statusHtml(showCarousel);
  const el = $('recommendations');

  if (!showCarousel) {
    // Flag OFF: the old experience, with no carousel at all.
    el.innerHTML = '';
    stopErrorLoop();
    return;
  }

  try {
    el.innerHTML = buildCarouselHtml();
    el.querySelectorAll('button[data-product]').forEach((b) => {
      b.onclick = () => addToCart(b.dataset.product, 'carousel');
    });
    stopErrorLoop();
  } catch (err) {
    // The "bug" fired. Show a broken state and start reporting errors to the
    // server, which is what a real error tracker would do.
    el.innerHTML = `<div class="carousel broken">⚠️ Recommendations failed to load: ${err.message}</div>`;
    startErrorLoop(err);
  }
}

function buildCarouselHtml() {
  if (bugToggle.checked) {
    // Pretend the new code has a bug, e.g. the recommendations API changed shape.
    throw new Error('Cannot read properties of undefined (reading "items")');
  }
  const cards = RECOMMENDED.map((id) => productCard(PRODUCTS.find((p) => p.id === id))).join('');
  return `<div class="carousel">
      <h2>Recommended for you <span class="badge">NEW</span></h2>
      <div class="track">${cards}</div>
    </div>`;
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
  ldClient.track('add-to-cart', { productId, source }, product.price);
  log(`track("add-to-cart") ${product.name} from ${source}`);
}

// =============================================================================
// Error reporting for the watchdog (Part 1: remediation)
// =============================================================================
function startErrorLoop(err) {
  if (errorLoop) return;
  const report = async () => {
    const res = await fetch('/api/report-error', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: err.message }),
    }).then((r) => r.json()).catch(() => ({}));
    log(res.fired
      ? '🚨 watchdog fired the OFF trigger'
      : `error reported to watchdog (${res.count ?? '?'})`);
  };
  report();
  errorLoop = setInterval(report, 3000); // stands in for errors from many shoppers
}

function stopErrorLoop() {
  clearInterval(errorLoop);
  errorLoop = null;
}

// --- helpers -----------------------------------------------------------------
function onOff(v) { return v ? 'ON' : 'OFF'; }
function statusHtml(v) { return `<span class="${v ? 'on' : 'off'}">${onOff(v)}</span>`; }
function log(message) {
  const li = document.createElement('li');
  li.innerHTML = `<time>${new Date().toLocaleTimeString()}</time>${message}`;
  $('event-log').prepend(li);
}
