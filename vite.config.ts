import path from "path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// API proxy target — set API_URL in your .env file (see .env.example)
const apiTarget = process.env.API_URL || 'http://localhost:8000';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    proxy: {
      '/api': {
        target: apiTarget,
        changeOrigin: true,
        secure: false,
      }
    }
  },
  preview: {
    proxy: {
      '/api': {
        target: apiTarget,
        changeOrigin: true,
        secure: false,
      }
    }
  }
});