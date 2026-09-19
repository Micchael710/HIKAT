/**
 * Content Security Policy (CSP) Definitions for HiKAT Launcher
 *
 * Distinct policies for Development and Production:
 * - Development: permits local Vite dev server, local backend, and websocket HMR.
 * - Production: strictly eliminates development localhost/127.0.0.1 origins (except OAuth loopback port),
 *   allowing only authoritative HiKAT production endpoints (api.hikat.org, auth.hikat.org) and external media.
 */

export const DEV_CSP =
  "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob: https: http://localhost:* http://127.0.0.1:*; connect-src 'self' https: wss://api.hikat.org http://localhost:* ws://localhost:* http://127.0.0.1:* ws://127.0.0.1:*; frame-src 'self' https://www.youtube.com https://www.youtube-nocookie.com; media-src 'self' blob: https: http://localhost:* http://127.0.0.1:*; object-src 'none'; base-uri 'self';"

export const PROD_CSP =
  "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob: https:; connect-src 'self' https://api.hikat.org wss://api.hikat.org https://auth.hikat.org http://127.0.0.1:47821; frame-src 'self' https://www.youtube.com https://www.youtube-nocookie.com; media-src 'self' blob: https:; object-src 'none'; base-uri 'self';"

export function getCSP(isProduction: boolean): string {
  return isProduction ? PROD_CSP : DEV_CSP
}
