import { useSyncExternalStore } from 'react';

// Hash routing: works on GitHub Pages without server rewrites.

const subscribe = (cb: () => void) => {
  window.addEventListener('hashchange', cb);
  return () => window.removeEventListener('hashchange', cb);
};

const snapshot = () => window.location.hash.slice(1) || '/';

export function useRoute() {
  const path = useSyncExternalStore(subscribe, snapshot);
  const parts = path.split('/').filter(Boolean);
  return { path, parts };
}

export function navigate(to: string) {
  const go = () => {
    window.location.hash = to;
  };
  // Cross-fade between screens where the browser supports view transitions.
  const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown };
  if (doc.startViewTransition && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    doc.startViewTransition(go);
  } else {
    go();
  }
}

export const back = (fallback: string) => {
  if (window.history.length > 1) window.history.back();
  else navigate(fallback);
};
