import type { CapacitorConfig } from '@capacitor/cli';

// STAGE 3 DEVICE TEST ONLY. Capacitor server.url is not for production release.
// Keep the existing Cloudflare same-origin cookie/OAuth flow during first APK verification.
// Production release must bundle web assets and implement a supported API/auth transport.
const config: CapacitorConfig = {
  appId: 'com.ravirgo.flowad',
  appName: 'Flowad',
  webDir: 'www',
  server: {
    url: 'https://ravirgo.com/flowad/',
    cleartext: false
  },
  android: {
    allowMixedContent: false
  }
};
export default config;
