/**
 * Content Security Policy (CSP) Definitions for HiKAT Launcher Electron Main
 */

const DEV_CSP =
  "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob: https: http://localhost:* http://127.0.0.1:*; connect-src 'self' https: wss://api.hikat.org http://localhost:* ws://localhost:* http://127.0.0.1:* ws://127.0.0.1:*; frame-src 'self' https://www.youtube.com https://www.youtube-nocookie.com; media-src 'self' blob: https: http://localhost:* http://127.0.0.1:*; object-src 'none'; base-uri 'self';"

const PROD_CSP =
  "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob: https:; connect-src 'self' https://api.hikat.org wss://api.hikat.org https://auth.hikat.org http://127.0.0.1:47821; frame-src 'self' https://www.youtube.com https://www.youtube-nocookie.com; media-src 'self' blob: https:; object-src 'none'; base-uri 'self';"

function getCSP(isProduction) {
  return isProduction ? PROD_CSP : DEV_CSP
}

module.exports = {
  DEV_CSP,
  PROD_CSP,
  getCSP,
}
