import { defineConfig } from "vite"

import react from "@vitejs/plugin-react"

import tailwindcss from "@tailwindcss/vite"

import path from "node:path"

import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  base: "./",

  plugins: [react(), tailwindcss()],

  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },

  server: {
    host: "0.0.0.0",

    port: parseInt(process.env.PORT || "8443", 10),

    strictPort: true,
  },

  preview: {
    host: "0.0.0.0",

    port: parseInt(process.env.PORT || "8443", 10),
  },

  build: {
    outDir: "dist",

    sourcemap: false,

    minify: true,
  },
})
