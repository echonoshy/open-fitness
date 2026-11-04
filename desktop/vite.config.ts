import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { coachApi } from "./web/api";
export default defineConfig({
  define: {
    __APP_BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  plugins: [
    react(),
    {
      name: "web-coach-api",
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          void coachApi(req, res, next).catch(next);
        });
      },
      configurePreviewServer(server) {
        server.middlewares.use((req, res, next) => {
          void coachApi(req, res, next).catch(next);
        });
      },
    },
    {
      name: "dev-csp",
      apply: "serve",
      transformIndexHtml: (html) =>
        html.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'"),
    },
  ],
  base: "./",
  server: { port: 5178, strictPort: true },
  build: { target: "es2022" },
});
