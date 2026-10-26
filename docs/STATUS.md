# Project status

**As of October 26, 2026.** Both required parts of the LaunchDarkly SE exercise are built and verified against a real LaunchDarkly environment. None of the three extra-credit sections is done yet.

| Exercise section | Status | Verified against LaunchDarkly |
|---|---|---|
| Submission: setup instructions, environment assumptions, code comments | Done | n/a |
| Submission: public GitHub repo | Done (public since October 26) | n/a |
| **Part 1: Release and remediate** | **Done** | Yes, October 21–26 |
| **Part 2: Target** | **Done** | Yes, October 26 |
| Extra credit: Experimentation | Code done (events and `npm run simulate`); metric and experiment being set up in LaunchDarkly | Not yet |
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

**Done:**
- Every "Add to cart" click calls `ldClient.track('add-to-cart', …)`.
- The trial account includes Experimentation (confirmed October 26).
- `scripts/simulate-traffic.js` (`npm run simulate`) sends synthetic shoppers through the banner flag with the Node server SDK. They're marked `synthetic: true` and convert at 10% (old banner) vs. 13% (new).
- README section "Set up the experiment" and demo script step 9.

**Remaining:**
1. In LaunchDarkly, create the `Add to cart rate` metric (Occurrence (Percent) on `add-to-cart`).
2. Design the experiment on `homepage-promo-banner`: default rule, 50/50, Bayesian; start it.
3. Add `LD_SDK_KEY` to `.env`, run `npm run simulate`, and record the result and the decision it supports here.

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
