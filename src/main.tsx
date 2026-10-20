import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { useStore } from './store/store';
import { useRta } from './audio/engine';
import './styles/app.css';

// test ve hata ayıklama için (konsoldan: __sahnecad.getState())
(window as unknown as { __sahnecad: typeof useStore }).__sahnecad = useStore;
(window as unknown as { __sahnecadRta: typeof useRta }).__sahnecadRta = useRta;

// Web'den (https) açıldığında: ana ekrana eklenebilir uygulama + çevrimdışı önbellek.
// Tek dosya (file://) ve önizleme sayfalarında atlanır.
if (location.protocol === 'https:' || location.hostname === 'localhost') {
  const link = (rel: string, href: string) => {
    const l = document.createElement('link');
    l.rel = rel;
    l.href = href;
    document.head.appendChild(l);
  };
  if (!/claude\.ai|claudeusercontent/.test(location.hostname)) {
    link('manifest', 'manifest.webmanifest');
    link('apple-touch-icon', 'icon-180.png');
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => undefined);
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
