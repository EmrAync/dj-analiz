import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { useStore } from './store/store';
import './styles/app.css';

// test ve hata ayıklama için (konsoldan: __sahnecad.getState())
(window as unknown as { __sahnecad: typeof useStore }).__sahnecad = useStore;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
