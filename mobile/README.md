# Flowad Stage 3 — Capacitor Android starter

This folder is an **initial, development-only Android scaffold**, not a completed APK or a release-ready integration.

## Prerequisites
- Node.js >=22 (Capacitor 8 requirement)
- Android Studio >=2025.2.1 and Android SDK (official Capacitor 8 requirements)
- Android emulator or physical device

## Initialize and build

```bash
cd mobile
npm install
npm run android:init
npm run android:sync
npm run android:open
# Or with Android SDK installed:
npm run android:run
```

To build a debug APK (Linux/macOS):

```bash
cd mobile/android
./gradlew assembleDebug
```

On Windows: `cd mobile/android && gradlew.bat assembleDebug`.

## Test app versus production app

This initial config uses `server.url=https://ravirgo.com/flowad/` **for developer testing only**.
The web app is served by the existing Cloudflare Worker; this keeps its same-origin API, cookies and Tesla OAuth flow as a starting point. The checked-in `www/index.html` is a placeholder rather than the production UI.

**Important limitation:** the hosted `dist/app.js` currently does not import and invoke `FlowadNavigation`; the custom plugin won't run from UI until Stage 3 adds a bundled web entrypoint and bridges the verified route action. Do not claim that native route dispatch works merely because the Android plugin compiles.

Production completion requires:
1. Bundling the actual `dist/` web UI as offline-capable local assets and removing `server.url`.
2. Aligning authenticated API calls, cookie/CSRF behavior and Tesla OAuth redirects for the local Capacitor origin (do not assume cross-origin cookies or remote OAuth callbacks work in WebView).
3. Loading `@capacitor/core` in the built UI, wiring the selected-course verification result into `FlowadNavigation.prepareVerifiedRoute`, and verifying full round trip on Android.
4. App lifecycle, Android location permission, network error, rotation and back-navigation tests.
5. Debug/release builds on a real SDK, not just TypeScript lint.

## Security model of the starter native bridge

Java plugin `FlowadNavigationPlugin` calls **the production** `POST /flowad/api/navigation/resolve` endpoint with the supplied HMAC ticket. It refuses every route except `ROAD_ROUTED` and validates point order/coordinates. This is only a verified-route handoff for future Pleos integration, **not a vehicle navigation command**. The ticket must first be issued by `POST /flowad/api/navigation/verify`. The plugin never embeds HMAC secrets, Tesla credentials, or device access.

The production Worker is **not** modified by this starter. Stage 4 implements Pleos calls, not this stage.
