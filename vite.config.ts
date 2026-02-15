import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import wasm from "vite-plugin-wasm";
import topLevelAwait from "vite-plugin-top-level-await";

export default defineConfig({
  plugins: [
    react(),
  ],
  optimizeDeps: {
    // Exclude opencascade.js from optimization to avoid issues with WASM loading if it's a direct dependency
    exclude: ['opencascade.js']
  },
  server: {
    headers: {
      // Essential for SharedArrayBuffer support in browsers
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Opener-Policy': 'same-origin',
    },
  },
  build: {
    target: 'esnext' // WASM often requires modern targets
  },
  assetsInclude: ['**/*.wasm']
});
