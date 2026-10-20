import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

// "tek" modu: tüm uygulama tek bir HTML dosyası (çift tıkla aç, internet gerekmez)
export default defineConfig(({ mode }) => ({
  base: './',
  plugins: mode === 'tek' ? [react(), viteSingleFile()] : [react()],
  build: {
    outDir: mode === 'tek' ? 'tek' : 'dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 4000,
  },
  server: { port: 5180, host: true },
}));
