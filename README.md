# ACME Shop: a LaunchDarkly feature flag demo

ACME Shop is a small e-commerce storefront that shows how LaunchDarkly lets a team ship features faster without adding risk: test a feature in production with internal users, release it to everyone with one click, roll it back instantly, and switch it off automatically when it breaks.

It is a sample app for the LaunchDarkly Solutions Engineer exercise, written as if for a prospective customer. It uses the **LaunchDarkly JavaScript client-side SDK** in the browser and a small Node.js server.

## What it demonstrates

| Exercise | LaunchDarkly feature | What you see in ACME Shop |
|---|---|---|
| **Part 1: Release and remediate** | Feature flag `recommendations-carousel` | A new "Recommended for you" carousel, first shown only to internal testers, then released to everyone. |
| | Flag change listener | The carousel appears or disappears within about a second of a flag change, with no page reload. |
| | Flag triggers | A `curl` call to a trigger URL turns the carousel off. A built-in watchdog does the same automatically when the carousel keeps failing, and can turn it back on once the problem is fixed. |
| **Part 2: Target** | Feature flag `homepage-promo-banner`, contexts, individual and rule-based targeting | A "Viewing as" menu switches between demo shoppers with different attributes. Targeting decides who sees the new free-shipping banner. |
| **Extra credit: Experimentation** | Custom events (`track`), a metric, an experiment | Every "Add to cart" click is sent as the `add-to-cart` event. An experiment on the banner flag measures whether the new banner raises the add-to-cart rate, using synthetic traffic from `npm run simulate`. |

A step-by-step demo script is in [docs/DEMO.md](docs/DEMO.md). What's done and what's left for each part of the exercise is in [docs/STATUS.md](docs/STATUS.md).

## How it works

```
 Browser (public/app.js)                        Node server (server.js)
 ┌──────────────────────────────┐              ┌───────────────────────────────┐
 │ LaunchDarkly JS SDK          │  GET config  │ /api/config        Client ID  │
 │  - evaluates both flags      │ ───────────▶ │ /api/recommendations          │
 │  - streams flag changes      │  products    │   (breakable "service")       │
 │  - sends add-to-cart events  │ ───────────▶ │ /api/watchdog/*   watchdog.js │
 │ Reports carousel errors and  │  errors,     │   counts errors, fires        │
 │ state to the watchdog        │  state       │   LaunchDarkly trigger URLs   │
 └──────────────┬───────────────┘ ───────────▶ └───────────────┬───────────────┘
                │ streaming flag updates                       │ POST trigger URL
                ▼                                              ▼
         ┌────────────────────────── LaunchDarkly ──────────────────────────┐
         └──────────────────────────────────────────────────────────────────┘
```

- **All flag evaluation happens in the browser.** The server never evaluates flags; it only calls LaunchDarkly's trigger URLs.
- **The watchdog** ([watchdog.js](watchdog.js)) is the automated version of the Part 1 trigger. It is optional: without trigger URLs in `.env`, the app works and you fire the trigger by hand.

| File | What's in it |
|---|---|
| [public/app.js](public/app.js) | All LaunchDarkly SDK code. Search for `LD:` to step through every SDK call. |
| [public/index.html](public/index.html), [public/styles.css](public/styles.css) | The storefront and the demo panel. |
| [server.js](server.js) | Serves the page, the Client-side ID, and the recommendations service. |
| [watchdog.js](watchdog.js) | Automated remediation with LaunchDarkly triggers. |
| [scripts/simulate-traffic.js](scripts/simulate-traffic.js) | `npm run simulate`: synthetic shoppers for the experiment, using the Node server SDK. |
| [scripts/smoke-test.sh](scripts/smoke-test.sh) | `npm test`: starts the server and checks it responds. Runs in CI. |

## What you need

- **macOS or Linux.** On Windows, use WSL.
- **Node.js 20 or later** and npm. Check with `node -v`. On a Mac, `brew install node` installs it.
- **git.**
- **A LaunchDarkly account.** A free trial works: [launchdarkly.com/start-trial](https://launchdarkly.com/start-trial/).
- **A modern browser** (Chrome, Safari, Firefox or Edge).
- **Port 3000 free**, or set `PORT` in `.env`.
- **Outbound HTTPS to LaunchDarkly**, which the browser uses for flags and events, and the server uses for triggers.

## Setup

### 1. Get the code

```bash
git clone https://github.com/chrisgonyea/launchdarkly-acme-demo.git
cd launchdarkly-acme-demo
npm install
cp .env.example .env
```

### 2. Set up LaunchDarkly

Use one environment for everything. These steps use **Test**.

**Important:** after any change on a flag's page, click **Review and save**, then **Save changes**. Until you do, nothing changes.

#### a. Copy your Client-side ID

In LaunchDarkly, go to **Project settings > Environments > Test** and copy the **Client-side ID**. Paste it into `.env`:

```
LD_CLIENT_SIDE_ID=your-client-side-id
```

This is not the SDK key. The Client-side ID is designed to be visible in a browser.

#### b. Create the carousel flag (Part 1)

**Flags > Create flag**:

| Setting | Value |
|---|---|
| Name | `Recommendations carousel` |
| Key | `recommendations-carousel` (must match exactly) |
| Variations | Boolean (`true` / `false`) |
| SDK availability | Tick **Client-side SDKs**. Without this, the browser can't see the flag. |
| Temporary / permanent | Temporary (a release flag) |

Leave it **Off**.

#### c. Create the triggers (optional: automated remediation)

Open the carousel flag, click **⋯** next to the Test environment, choose **Configuration in environment**, then **Triggers > + Add trigger**.

1. **Generic trigger**, action **Turn the flag off**. Save, then copy the URL right away, because LaunchDarkly shows it only once.
2. Optionally, a second **Generic trigger** with action **Turn the flag on**, for automatic recovery.

Add them to `.env`:

```
LD_CAROUSEL_OFF_TRIGGER_URL=paste-the-off-trigger-url-here
LD_CAROUSEL_ON_TRIGGER_URL=paste-the-on-trigger-url-here
```

Treat trigger URLs like passwords: anyone who has one can flip the flag.

#### d. Create the banner flag and its targeting (Part 2)

**Flags > Create flag**: name `Homepage promo banner`, key `homepage-promo-banner`, Boolean, **Client-side SDKs** ticked.

Then, on its **Targeting** tab in **Test**:

| Setting | Value | Who it catches |
|---|---|---|
| Individual targets | Serve `true` to context key `shopper-alice` | Alice |
| Rule | `loyaltyTier` **is one of** `gold` **AND** `country` **is one of** `US` → serve `true` | Bob |
| Default rule | Serve `false` | Everyone else |

Turn the flag **On** and save.

The demo shoppers and their attributes are defined at the top of [public/app.js](public/app.js), in `PERSONAS`. Picking each one once in the "Viewing as" menu lets LaunchDarkly suggest the attribute names when you build the rule.

#### e. Set up the experiment (optional: extra credit)

The experiment asks one question: **does the new banner make shoppers more likely to add to cart?** It needs your account to include Experimentation.

1. **Send the event once.** With the app running (step 3), click **Add to cart** a couple of times so LaunchDarkly has seen the `add-to-cart` event.
2. **Create the metric:** **Data > Metrics > Create metric**.

   | Setting | Value |
   |---|---|
   | Source | LaunchDarkly hosted |
   | Event kind | Custom |
   | Event key | `add-to-cart` |
   | Metric definition | Occurrence (Percent) |
   | Analysis unit | user |
   | Success criteria | Higher is better |
   | Name | `Add to cart rate` |

3. **Create the experiment:** **Create > Experiment**. Name `Homepage promo banner: add-to-cart`, with a hypothesis. On the **Design** tab:

   | Setting | Value |
   |---|---|
   | Assignment method | LaunchDarkly flag or config |
   | Flag | `homepage-promo-banner` |
   | Targeting rule | Default rule. Alice's individual target and the gold + US rule stay outside the experiment. |
   | Randomize by | user |
   | Variation served outside the experiment | `false` |
   | Audience | 100% of the default rule |
   | Variations split | 50% / 50%, control: `false` |
   | Metric | `Add to cart rate` |
   | Statistical approach | Bayesian |

   Click **Save**, make sure the flag is **On**, then click **Start**.

4. **Add your SDK key** to `.env`. It's under **Project settings > Environments > Test > SDK key**, and it is a secret:
   ```
   LD_SDK_KEY=your-sdk-key
   ```
5. **Send synthetic traffic** (after the experiment has started):
   ```bash
   npm run simulate                     # 2,000 shoppers
   npm run simulate -- --shoppers 5000  # or any number
   ```
   Results appear on the experiment within a few minutes.

**About the data:** the simulator's shoppers are synthetic, marked `synthetic: true`, and convert at a built-in 10% (old banner) vs. 13% (new banner). The experiment shows the workflow and that LaunchDarkly detects a real difference; it says nothing about real shoppers. In production, real traffic would run for a week or more.

### 3. Run it

```bash
npm start
```

Open **http://localhost:3000**. The demo panel on the right should say **SDK: connected**.

The terminal shows what the server and watchdog are doing. Leave it visible during a demo.

## Try it

- **Release and roll back:** turn `recommendations-carousel` On and Off in LaunchDarkly. The carousel appears and disappears with no reload.
- **Kill switch with curl:**
  ```bash
  curl -X POST 'YOUR-OFF-TRIGGER-URL'
  ```
- **Automated remediation:** with the flag On, tick **Simulate a bug**. The watchdog fires the OFF trigger after 5 errors, then confirms the flag went off. Untick it, and after 3 passing health checks it fires the ON trigger.
- **Targeting:** switch shoppers in **Viewing as**. Alice and Bob see the new banner. Carla, Dana and the anonymous visitor see the old one, unless the experiment is running: then the default rule splits them 50/50.
- **Experiment:** with the experiment started, run `npm run simulate` and open the experiment's results in LaunchDarkly.

The full talk track, including testing in production before release, is in [docs/DEMO.md](docs/DEMO.md).

## Good to know

- **Triggers are not instant.** In testing, LaunchDarkly applied a trigger 20 to 65 seconds after the call. A dashboard toggle reaches the page in about a second. The demo panel shows "waiting for LaunchDarkly (Ns)" while the watchdog waits.
- **Use one browser tab while demoing the watchdog.** Every open tab reports errors to the same watchdog, which is realistic (many shoppers) but makes the counts jump.
- **"Simulate a bug" breaks a pretend backend service on the server**, not the page itself. That lets the watchdog health-check it even while the flag is off.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Server exits with "Missing LD_CLIENT_SIDE_ID" | `.env` is missing or empty. Run `cp .env.example .env` and fill it in. |
| Demo panel says **SDK: not ready (timeout)** | Wrong Client-side ID, or LaunchDarkly is blocked by your network. Check that the ID is from the same environment you're editing. |
| SDK connected, but a flag never turns on | **Client-side SDKs** isn't ticked on that flag, the change wasn't saved (**Review and save**), or it was changed in a different environment. |
| Watchdog says **off (no trigger URL)** | `LD_CAROUSEL_OFF_TRIGGER_URL` isn't set. Restart `npm start` after editing `.env`. |
| Watchdog stuck on "waiting for LaunchDarkly" | Normal for up to about a minute. After 2 minutes the server logs a warning. Check the flag's history in LaunchDarkly. |
| `EADDRINUSE` on start | Something else uses port 3000. Set `PORT=3001` in `.env`. |

## Development

```bash
npm test   # starts the server with a placeholder ID and checks every endpoint
```

CI runs the same test on every pull request. See [CONTRIBUTING.md](CONTRIBUTING.md) for branches, pull requests and releases.
