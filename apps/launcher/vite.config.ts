import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEV_CSP, PROD_CSP } from './src/config/csp.ts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function htmlCspPlugin(): Plugin {
  return {
    name: 'html-csp-transform',
    transformIndexHtml(html, ctx) {
      const isProduction = !ctx.server
      const targetCsp = isProduction ? PROD_CSP : DEV_CSP
      return html.replace(
        /http-equiv="Content-Security-Policy"\s+content="[^"]*"/i,
        `http-equiv="Content-Security-Policy" content="${targetCsp}"`,
      )
    },
  }
}

export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss(), htmlCspPlugin()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@hikat/shared': path.resolve(__dirname, '../../packages/shared/src/index.ts'),
    },
  },
  server: {
    host: '0.0.0.0',
    port: parseInt(process.env.PORT || '8443', 10),
    strictPort: true,
  },
  preview: {
    host: '0.0.0.0',
    port: parseInt(process.env.PORT || '8443', 10),
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    minify: true,
  },
})
