import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.tsx';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

/**
 * Register the service worker so the app installs and works with no network
 * (spec §11, Phase 4). Only in a production build: in development it would sit
 * in front of the dev server and serve stale modules.
 *
 * A failure here is not worth telling anyone about — it costs the offline
 * install, and nothing else.
 */
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => undefined);
  });
}
