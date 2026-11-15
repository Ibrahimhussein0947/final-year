// Stand-in for the virtual module that vite-plugin-pwa provides in a real build (tests do not run a service worker).
export function registerSW(): (reload?: boolean) => Promise<void> {
  return async () => undefined;
}
