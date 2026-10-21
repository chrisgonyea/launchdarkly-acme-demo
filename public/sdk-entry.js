// This file only re-exports the LaunchDarkly browser SDK.
// `npm start` bundles it into public/vendor/launchdarkly.js (see package.json),
// so the browser can load the SDK without a CDN or a full build tool.
export { createClient } from '@launchdarkly/js-client-sdk';
