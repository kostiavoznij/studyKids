import '@fontsource-variable/manrope';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import { App } from './App';
import { useData } from './data/store';
import { startSync } from './data/sync';
import './styles/themes.css';
import './styles/base.css';
import './styles/ui.css';
import './styles/charts.css';
import './styles/calendar.css';
import './styles/screens.css';

useData.getState().init();

// Top up lessons from weekly slots when the app comes back to the foreground on a new day.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') useData.getState().ensureSchedule();
});

// Another tab or window of the app changed the data: pick it up instead of overwriting it later.
window.addEventListener('storage', (e) => {
  if (e.key === 'uroky-data') useData.persist.rehydrate();
});

startSync();

registerSW({ immediate: true });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
