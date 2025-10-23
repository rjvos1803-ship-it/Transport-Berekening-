// vite.config.js
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// ✅ Vite-configuratie voor React + Tailwind
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist'
  },
  server: {
    port: 5173
  }
})
