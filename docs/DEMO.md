# ACME Shop demo script

A 10 to 12 minute walkthrough for a live audience. Each step says what to **do**, what the audience **sees**, and what to **say**. Setup steps are in the [README](../README.md).

## Before you start (5 minutes ahead)

- [ ] `npm start` running, terminal visible, with both trigger URLs in `.env` (it prints auto-remediation **ON** and auto-recovery **ON**)
- [ ] One browser tab on http://localhost:3000, side by side with LaunchDarkly
- [ ] In the store: **Viewing as: Anonymous visitor**, **Simulate a bug** unticked
- [ ] `recommendations-carousel`: **Off**. No rules, default rule serves `true`
- [ ] `homepage-promo-banner`: **On**, with Alice's individual target, the gold + US rule, default `false`
- [ ] Terminal tab ready with `curl -X POST '<OFF trigger URL>'`
- [ ] Reminder: every flag change needs **Review and save**, then **Save changes**

## The story

ACME Shop's competitors are catching up, and leadership wants features out faster. ACME's reputation is quality, so faster can't mean riskier. The new feature is a **"Recommended for you" carousel**. It's already deployed to production, but switched off.

---

## Part 1: Release and remediate

### 1. Deployed is not released (about 1 minute)

- **Do:** show the store. Point at the demo panel: `recommendations-carousel` **OFF**.
- **Say:** "The carousel code is live in production right now, but nobody sees it. With a feature flag, deploying code and releasing a feature are separate decisions."

### 2. Test in production with internal users first (about 2 minutes)

This answers the scenario's ask: *"a safe way to test your code in production before releasing to your customers."*

- **Do:** on `recommendations-carousel` > **Targeting** (Test):
  - Add a rule: `betaTester` **is one of** `true`, serve `true`
  - Set the **default rule** to serve `false`
  - Turn the flag **On**. Review and save.
- **Sees:** as the anonymous visitor, nothing changes. Switch **Viewing as** to **Alice (beta tester)**: the carousel appears. Switch back: gone.
- **Say:** "The flag is on, but only for our internal testers. Alice is testing the real feature on real production infrastructure, while every customer still sees the old page. If something is wrong, only the team sees it."

### 3. Release to everyone, with no deploy (about 1 minute)

- **Do:** change the **default rule** to serve `true`. Review and save. Set **Viewing as** back to the anonymous visitor.
- **Sees:** the carousel appears within about a second, with no reload. The panel logs `recommendations-carousel changed → ON`.
- **Say:** "That's the release: one click, no deploy, no restart. A listener in the page got the change over a streaming connection and redrew just the carousel."
- **Show the code** (optional): `ldClient.on('change:recommendations-carousel', …)` in [public/app.js](../public/app.js).

### 4. Instant rollback (about 30 seconds)

- **Do:** turn the flag **Off**, save. Then turn it **On** again, save.
- **Sees:** the carousel disappears, then comes back, each within about a second.
- **Say:** "If the business changes its mind, or support reports something odd, rollback is the same one click. Nobody waits for a revert and redeploy."

### 5. Kill switch with a trigger (about 1.5 minutes)

- **Do:** in the terminal tab, run the `curl` command.
- **Sees:** after a short wait (see the note below), the carousel disappears. In LaunchDarkly, the flag's history shows a **trigger** turned it off, not a person.
- **Say:** "A trigger is a secret URL that does one thing to one flag. Anything that can make a web request can call it: a monitoring alert, an incident tool, an on-call engineer from their phone. Nobody needs to log in to LaunchDarkly at 3 a.m."
- **Do:** turn the flag back **On** before the next step.

### 6. Automated remediation and recovery (about 3 minutes)

- **Do:** tick **Simulate a bug**.
- **Sees:**
  1. The carousel shows an error and retries every 3 seconds. The panel counts errors reported to the watchdog.
  2. At 5 errors: **tripped: waiting for LaunchDarkly (Ns)**. The OFF trigger was fired.
  3. The carousel disappears. The panel shows **remediated** and logs how long LaunchDarkly took to confirm.
- **Say:** "Here nobody calls the trigger. The app's own error reporting crosses a threshold, and a watchdog fires the trigger. Shoppers fall back to the old page instead of seeing an error."
- **Do:** untick **Simulate a bug**: "the team shipped a fix to the recommendations service."
- **Sees:** the panel counts **health checks 1/3, 2/3, 3/3**. The ON trigger fires, the carousel returns, and the log says **RECOVERED**.
- **Say:** "Once the service passes three health checks in a row, the watchdog turns the feature back on. Many teams prefer a person to make that call, so the ON trigger is optional. Without it, the watchdog reports the service is healthy and waits."

> **Trigger timing.** LaunchDarkly applies triggers asynchronously. In testing they took 20 to 65 seconds, while dashboard toggles arrive in about a second. Fill the wait with the talk track, and point at the panel's live counter. If asked: "For an instant kill switch, a person flips the flag, or the app checks a local kill switch. Triggers are the hands-off path."

---

## Part 2: Target

The landing page gets about 40,000 visitors a day, so the new banner goes to safe groups first.

### 7. Same page, different shoppers (about 2 minutes)

- **Do:** switch **Viewing as** through each shopper.

| Shopper | Attributes | Banner | Why |
|---|---|---|---|
| Anonymous visitor | none | Old | Default rule |
| Alice | bronze, US, beta tester | **New** | Individual target |
| Bob | gold, US | **New** | Rule: gold AND US |
| Carla | gold, Canada | Old | Gold, but not in the US |
| Dana | silver, US | Old | Matches nothing |

- **Say:** "The page tells LaunchDarkly who the shopper is: a context with attributes like loyalty tier and country. Alice is targeted individually, as a named tester. Bob matches a rule, so every gold-tier US shopper gets it automatically. Carla is the interesting one: she's gold, but in Canada, so the rule doesn't match."
- **Show the code** (optional): `PERSONAS` and `ldClient.identify(...)` in [public/app.js](../public/app.js).

### 8. Change the audience live (about 1 minute)

- **Do:** with **Viewing as: Carla**, edit the rule's country to `US, CA`. Save.
- **Sees:** Carla's banner switches to the new one with no reload.
- **Say:** "Widening a release is a targeting change, not a code change. Next could be a percentage rollout: 10% of everyone, then 50%, then 100%."

---

## Questions to be ready for

- **Why evaluate in the browser and not on the server?** The feature is UI-only, and the client SDK streams changes directly to the page. A server-rendered app would use a server SDK the same way.
- **Is the Client-side ID a secret?** No. It's meant to be visible in a browser, and the browser only receives values for the current context. The SDK key and trigger URLs are the secrets; they stay in `.env`.
- **What if LaunchDarkly is down?** A page that's already running keeps the last values it received. A page that can't reach LaunchDarkly when it starts gets each `variation()` call's fallback, which here is `false`: the old, safe page.
- **Why does the watchdog fire at most once per incident?** So it can never flap a flag on and off in a loop.
