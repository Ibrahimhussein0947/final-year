import { defineConfig, minimal2023Preset } from '@vite-pwa/assets-generator/config';

// Generates the install icons (PNG) from the logo: `npm run pwa:icons -w @ethiotalent/web`.
// The generated files are committed in public/, so a normal build does not need this step.
const navy = '#0b1f3a';

export default defineConfig({
  headLinkOptions: { preset: '2023' },
  preset: {
    ...minimal2023Preset,
    // Maskable and Apple icons are drawn full-bleed on the brand colour, because the operating system crops them to its own shape.
    maskable: { sizes: [512], padding: 0.22, resizeOptions: { background: navy, fit: 'contain' } },
    apple: { sizes: [180], padding: 0.18, resizeOptions: { background: navy, fit: 'contain' } },
  },
  images: ['public/favicon.svg'],
});
