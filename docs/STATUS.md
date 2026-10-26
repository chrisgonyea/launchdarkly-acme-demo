# Project status

**As of October 26, 2026.** Both required parts of the LaunchDarkly SE exercise are built and verified against a real LaunchDarkly environment. None of the three extra-credit sections is done yet.

| Exercise section | Status | Verified against LaunchDarkly |
|---|---|---|
| Submission: setup instructions, environment assumptions, code comments | Done | n/a |
| Submission: public GitHub repo | Done (public since October 26) | n/a |
| **Part 1: Release and remediate** | **Done** | Yes, October 21–26 |
| **Part 2: Target** | **Done** | Yes, October 26 |
| Extra credit: Experimentation | Partly done: `add-to-cart` events are sent; no metric or experiment yet | No |
| Extra credit: AI Configs | Not started | No |
| Extra credit: Integrations | Not started | No |

## Part 1: Release and remediate

| Requirement | How ACME Shop meets it | Where |
|---|---|---|
| Test in production before releasing to customers | A rule on `recommendations-carousel` serves `true` only to `betaTester` contexts (Alice). Customers keep the old page. | LaunchDarkly targeting; [DEMO.md](DEMO.md) step 2 |
| Flag around a new feature; release by toggling on, roll back by toggling off | `recommendations-carousel` wraps the "Recommended for you" carousel. | `renderCarousel()` in [public/app.js](../public/app.js) |
| Listener: instant switch, no page reload | `ldClient.on('change:recommendations-carousel', …)` redraws the carousel when LaunchDarkly streams a change. | [public/app.js](../public/app.js), section 2 |
| Trigger turns off a problematic feature | A generic OFF trigger, fired with `curl`. The watchdog also fires it automatically after 5 carousel errors in 30 seconds, confirms the flag went off, health-checks the service, and fires an optional ON trigger after 3 passing checks. | [watchdog.js](../watchdog.js); README "Create the triggers" |

**Observed:** LaunchDarkly applied triggers 20–65 seconds after the call. Dashboard toggles reach the page in about a second.

## Part 2: Target

| Requirement | How ACME Shop meets it | Where |
|---|---|---|
| Flag around a specific component | `homepage-promo-banner`: old "Fall collection" banner vs. new free-shipping banner. | `renderBanner()` in [public/app.js](../public/app.js) |
| Context with attributes of your choosing | `user` contexts with `loyaltyTier`, `country`, `betaTester`, `name`, `email`. Five demo shoppers, switched with `identify()`. | `PERSONAS` in [public/app.js](../public/app.js) |
| Individual targeting | `shopper-alice` is served `true`. | LaunchDarkly targeting |
| Rule-based targeting | `loyaltyTier` is `gold` AND `country` is `US` → `true` (Bob). Carla (gold, Canada) and Dana (silver, US) don't match. Default rule: `false`. | LaunchDarkly targeting |

## Extra credit: remaining work

### Experimentation

**Done:** every "Add to cart" click calls `ldClient.track('add-to-cart', …)`, so the event a metric needs already reaches LaunchDarkly.

**Remaining:**
1. Confirm the trial account includes Experimentation.
2. Add `scripts/simulate-traffic.js`. It would use the Node server SDK with the SDK key from `.env` to send several hundred synthetic shoppers through the banner flag, with a slightly higher add-to-cart rate for the new banner. The data must be labeled synthetic in the code and the README.
3. In LaunchDarkly, create a custom conversion metric on the `add-to-cart` event.
4. Create an experiment on `homepage-promo-banner` with that metric, splitting the default-rule audience 50/50.
5. Start the experiment, run the simulator, and record the result and the decision it supports in the README.

**Estimate:** 1 to 1.5 hours.

### AI Configs

**Remaining:**
1. Add a small "shopping assistant" chat box backed by an LLM through LaunchDarkly's AI SDK, with the model and prompt coming from an AI Config.
2. Create two variations (for example, different prompts or models) and show switching between them without a code change.
3. Optional: an experiment on the variations.

**Needs:** an OpenAI or Anthropic API key. LaunchDarkly's AI SDKs are in open beta, so pin versions.

**Estimate:** 2 to 3 hours.

### Integrations

**Remaining:** connect one integration, for example Slack, so flag changes and trigger firings post to a channel. No code changes; document it in the README.

**Estimate:** about 10 minutes.

## Delivery

| Item | Status |
|---|---|
| Repository | [chrisgonyea/launchdarkly-acme-demo](https://github.com/chrisgonyea/launchdarkly-acme-demo) |
| Release | v1.0.0 not yet tagged. `package.json` is `0.1.0` until then. |
| CI | `npm test` smoke test on every pull request |
| Dependencies | `npm audit`: 0 vulnerabilities (body-parser updated October 26) |

Workflow rules (branches, pull requests, merges, releases) are in [CONTRIBUTING.md](../CONTRIBUTING.md).
