// vite.config.js
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Standaardconfiguratie voor React + Vite + Netlify
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist', // Vite output folder
    sourcemap: false, // optioneel: zet op true als je debug wil
  },
  server: {
    port: 5173, // lokale ontwikkelpoort
    open: true
  }
});
