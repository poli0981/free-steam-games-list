import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

const repoName = "free-steam-games-list";

export default defineConfig(({ command }) => ({
  base: command === "build" ? `/${repoName}/` : "/",
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  worker: {
    format: "es",
  },
  build: {
    target: "es2020",
    sourcemap: false,
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ["react", "react-dom", "react-router-dom"],
          query: ["@tanstack/react-query"],
          table: ["@tanstack/react-table", "@tanstack/react-virtual"],
          echarts: ["echarts", "echarts-for-react"],
          openpgp: ["openpgp"],
        },
      },
    },
  },
}));
