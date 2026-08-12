import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      // Same-origin in the browser; no CORS, no secrets in the client bundle.
      "/api": {
        target: "http://127.0.0.1:4021",
        changeOrigin: true,
      },
    },
  },
});
