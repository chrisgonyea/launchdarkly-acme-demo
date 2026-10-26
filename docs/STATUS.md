# Project status

**As of October 26, 2026.** Both required parts of the LaunchDarkly SE exercise and the Experimentation and Integrations extra credit are built and verified against a real LaunchDarkly environment. AI Configs is not started.

| Exercise section | Status | Verified against LaunchDarkly |
|---|---|---|
| Submission: setup instructions, environment assumptions, code comments | Done | n/a |
| Submission: public GitHub repo | Done (public since October 26) | n/a |
| **Part 1: Release and remediate** | **Done** | Yes, October 21–26 |
| **Part 2: Target** | **Done** | Yes, October 26 |
| Extra credit: Experimentation | **Done**: the new banner wins on synthetic traffic (96% probability to beat control) | Yes, October 26 |
| Extra credit: AI Configs | Not started | No |
| Extra credit: Integrations | **Done**: LaunchDarkly Slack app posts flag changes and trigger firings to a channel | Yes, October 26 |

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

## Extra credit: Experimentation

**Result: the new banner raised the add-to-cart rate from 10.9% to 13.4%, with a 96% probability of beating the old banner, so the decision is to ship it.** The traffic was synthetic (see below).

| Setting | Value |
|---|---|
| Hypothesis | If we show the new free-shipping banner, more shoppers will add a product to their cart, because free shipping removes a reason to hesitate. |
| Flag | `homepage-promo-banner`, default rule only (Alice's target and the gold + US rule stay outside the experiment) |
| Split | 50% `false` (control) / 50% `true`, randomized by `user` |
| Metric | Add to cart rate: Occurrence (Percent) on the `add-to-cart` event, higher is better |
| Method | Bayesian, 95% threshold |
| Traffic | 2,000 synthetic shoppers from `npm run simulate`, plus a few browser visits; built-in rates 10% (old) vs. 13% (new) |
| Started | October 26, 2026, 11:44 AM ET (iteration 1) |

| Variation | Shoppers | Add-to-carts | Conversion rate (credible interval) | Probability to beat control |
|---|---|---|---|---|
| `false` (old banner, control) | 1,026 | 111 | 10.89% (8.98–12.78%) | n/a |
| `true` (new banner) | 976 | 135 | 13.40% (11.49–15.44%) | **96.36%** |

Relative difference: +23.04% (credible interval −5.08% to +51.16%). Expected loss from choosing the new banner: 0.02%. LaunchDarkly marked `true` the winning variation. Results read from the experiment on October 26, 2026 at about 12:15 PM ET.

**Reading it honestly:** 96% clears the 95% threshold, but the lift's interval still crosses zero, so with real traffic I'd let it run longer before shipping. The simulator found the 3-point difference it was given, which is what this demo needs to show: hypothesis, metric, random split, result, decision.

**Decision:** ship the new banner by serving `true` on the default rule and stopping the experiment. Left running for now so the experiment can be shown live.

## Extra credit: Integrations

**Done October 26:** the LaunchDarkly Slack app is subscribed to every flag in the Test environment (`/launchdarkly subscribe -p default -e test`). Verified messages:

| Change | Slack message |
|---|---|
| Dashboard toggle | "Chris Gonyea updated the flag Recommendations carousel in Test · Turned the flag off / on" |
| `curl` OFF and ON triggers | "Turned off the flag via Generic trigger · Manual kill switch: curl from the on-call engineer was triggered" (and the ON equivalent) |
| Watchdog OFF trigger | "Turned off the flag via Generic trigger · ACME Shop watchdog: recommendations carousel error rate exceeded was triggered" |
| Watchdog ON trigger | "Turned on the flag via Generic trigger · ACME Shop watchdog: recommendations service healthy again was triggered" |

No code changes: the trigger notes come from the `eventName` the watchdog already sends. Setup is README step f.

## Extra credit: remaining work

### AI Configs

**Remaining:**
1. Add a small "shopping assistant" chat box backed by an LLM through LaunchDarkly's AI SDK, with the model and prompt coming from an AI Config.
2. Create two variations (for example, different prompts or models) and show switching between them without a code change.
3. Optional: an experiment on the variations.

**Needs:** an OpenAI or Anthropic API key. LaunchDarkly's AI SDKs are in open beta, so pin versions.

**Estimate:** 2 to 3 hours.


## Delivery

| Item | Status |
|---|---|
| Repository | [chrisgonyea/launchdarkly-acme-demo](https://github.com/chrisgonyea/launchdarkly-acme-demo) |
| Release | v1.0.0 (see [CHANGELOG.md](../CHANGELOG.md)) |
| CI | `npm test` smoke test on every pull request |
| Dependencies | `npm audit`: 0 vulnerabilities (body-parser updated October 26) |

Workflow rules (branches, pull requests, merges, releases) are in [CONTRIBUTING.md](../CONTRIBUTING.md).
