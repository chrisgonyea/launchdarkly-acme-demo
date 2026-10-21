# ABC Shop: a LaunchDarkly feature flag demo

A small e-commerce storefront that shows how LaunchDarkly lets a team release features safely, roll them back instantly, and target them to specific shoppers.

> **Status:** work in progress. Full setup instructions, LaunchDarkly configuration steps, and a demo walkthrough arrive before the v1.0.0 release.

## Quick start (draft)
Requires Node.js 20 or later and a LaunchDarkly account.

```bash
git clone https://github.com/chrisgonyea/launchdarkly-acme-demo.git
cd launchdarkly-acme-demo
npm install
cp .env.example .env   # then paste your Client-side ID into .env
npm start              # open http://localhost:3000
```

## What it demonstrates
| Part | Flag | What to look for |
|---|---|---|
| Release and remediate | `recommendations-carousel` | The carousel appears and disappears live when the flag changes, with no page reload. A trigger (fired by `curl` or by the built-in watchdog) turns it off. |
| Target | `homepage-promo-banner` | The "Viewing as" menu switches between demo shoppers. Individual and rule-based targeting decide who sees the new banner. |
| Experiment (extra credit) | `homepage-promo-banner` | "Add to cart" clicks are sent as the `add-to-cart` metric. |

See [CONTRIBUTING.md](CONTRIBUTING.md) for how changes are made and released.
