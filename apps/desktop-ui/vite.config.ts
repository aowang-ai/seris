import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Tauri uses native connection IPC in dev and production. The proxy is for
// browser-only development against an explicitly authorized loopback gateway.
const GATEWAY_DEV_URL = process.env.SERIS_GATEWAY_URL ?? 'http://127.0.0.1:3789';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // Tauri devUrl is http://localhost:5173 — bind to localhost exactly.
    // (Vite's default parsing/hostname resolution makes `localhost` and
    // `127.0.0.1` diverge on macOS when ipv6_first is on; WKWebView + the
    // shell's dev server then disagree about which address actually serves
    // the HMR websocket and the page, and every reload errors with
    // "WebSocket connection to ws://localhost:5173/ failed / could not
    // connect".)
    host: 'localhost',
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': { target: GATEWAY_DEV_URL, changeOrigin: true },
      '/healthz': { target: GATEWAY_DEV_URL, changeOrigin: true },
    },
  },
  clearScreen: false,
});
