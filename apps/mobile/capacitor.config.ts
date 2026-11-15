import type { CapacitorConfig } from '@capacitor/cli';

// The app is a thin shell that opens the HOSTED website, so the website's same-origin /api and httpOnly refresh cookie
// keep working unchanged and updates reach users without a new store release.
// Set the real https address before building:  APP_URL=https://your-domain.example npx cap sync android
const url = process.env.APP_URL;

const config: CapacitorConfig = {
  appId: 'et.ethiotalent.app',
  appName: 'EthioTalent AI',
  webDir: 'www',
  backgroundColor: '#0b1f3a',
  server: url
    ? { url, cleartext: false, allowNavigation: [new URL(url).host] }
    : undefined, // without APP_URL the app shows the placeholder page in www/
  android: { allowMixedContent: false },
};

export default config;
