# Changelog

All notable changes to ACME Shop. Versions follow [Semantic Versioning](https://semver.org/).

## 1.0.0 (2026-10-26)

First release: the LaunchDarkly Solutions Engineer exercise.

### Part 1: Release and remediate
- `recommendations-carousel` flag around a new "Recommended for you" carousel, tested in production with internal users (`betaTester`) before release to everyone.
- Change listener: the carousel appears or disappears within about a second of a flag change, with no page reload.
- Flag triggers: a generic OFF trigger fired with `curl`, plus a watchdog (`watchdog.js`) that fires it automatically after 5 carousel errors in 30 seconds, confirms the change, health-checks the service, and can fire an ON trigger to recover.

### Part 2: Target
- `homepage-promo-banner` flag around the homepage banner.
- `user` contexts with `loyaltyTier`, `country` and `betaTester`; five demo shoppers switched with `identify()`.
- Individual targeting (Alice) and rule-based targeting (gold-tier US shoppers).

### Extra credit: Experimentation
- `add-to-cart` custom events from the page.
- `npm run simulate`: synthetic shoppers for an experiment on the banner flag, sent through the Node server SDK.

### Project
- README with environment assumptions, LaunchDarkly setup, troubleshooting; demo script (`docs/DEMO.md`); status against the exercise (`docs/STATUS.md`).
- CI smoke test on every pull request; `npm audit` clean.
