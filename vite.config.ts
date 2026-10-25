import { defineConfig } from "vite";

// Preact JSX through Vite's built-in Oxc transform: no Babel, no framework plugin.
// In `bun run dev`, /api and /ws go to `wrangler dev` on :8787.
export default defineConfig({
  root: "app",
  oxc: { jsx: { runtime: "automatic", importSource: "preact" } },
  server: {
    proxy: {
      "/api": "http://localhost:8787",
      "/ws": { target: "ws://localhost:8787", ws: true },
    },
  },
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    target: "es2022",
    modulePreload: { polyfill: false },
    // three.js is most of the bundle (~160 kB gzipped) and the game needs it up front.
    chunkSizeWarningLimit: 700,
  },
});
