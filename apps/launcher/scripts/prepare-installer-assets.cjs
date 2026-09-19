/**
 * Converts existing HiKAT launcher branding assets into NSIS-compatible formats.
 * Source assets:
 * - apps/launcher/src/assets/branding/logo-black.png -> installer/resources/installerHeader.bmp (150x57)
 * - apps/launcher/src/assets/branding/hikat-logo.png -> installer/resources/installerSidebar.bmp (164x314)
 * - apps/launcher/src/assets/branding/logo-windows.png -> installer/resources/icon.ico
 */

const fs = require("fs")
const path = require("path")
const { decode } = require("fast-png")

const ROOT = path.resolve(__dirname, "..")
const BRANDING_DIR = path.join(ROOT, "src", "assets", "branding")
const OUT_DIR = path.join(ROOT, "installer", "resources")

if (!fs.existsSync(OUT_DIR)) {
  fs.mkdirSync(OUT_DIR, { recursive: true })
}

// 1. Generate installerHeader.bmp (150x57) from logo-black.png
const logoBlackPath = path.join(BRANDING_DIR, "logo-black.png")
if (fs.existsSync(logoBlackPath)) {
  const src = decode(fs.readFileSync(logoBlackPath))
  const targetW = 150
  const targetH = 57

  const padX = 4
  const padY = 2
  const availW = targetW - padX * 2
  const availH = targetH - padY * 2
  const scale = Math.min(availW / src.width, availH / src.height)
  const drawW = Math.round(src.width * scale)
  const drawH = Math.round(src.height * scale)
  const offsetX = Math.floor((targetW - drawW) / 2)
  const offsetY = Math.floor((targetH - drawH) / 2)

  const rgbBuf = Buffer.alloc(targetW * targetH * 3, 255) // Pure white background (#FFFFFF)

  for (let y = 0; y < drawH; y++) {
    for (let x = 0; x < drawW; x++) {
      const gx = (x / (drawW - 1)) * (src.width - 1)
      const gy = (y / (drawH - 1)) * (src.height - 1)
      const gxi = Math.floor(gx)
      const gyi = Math.floor(gy)
      const c00 = (gyi * src.width + gxi) * 4
      const c10 = (gyi * src.width + Math.min(gxi + 1, src.width - 1)) * 4
      const c01 = (Math.min(gyi + 1, src.height - 1) * src.width + gxi) * 4
      const c11 = (Math.min(gyi + 1, src.height - 1) * src.width + Math.min(gxi + 1, src.width - 1)) * 4

      const fx = gx - gxi
      const fy = gy - gyi

      function interp(offset) {
        const top = src.data[c00 + offset] * (1 - fx) + src.data[c10 + offset] * fx
        const bottom = src.data[c01 + offset] * (1 - fx) + src.data[c11 + offset] * fx
        return top * (1 - fy) + bottom * fy
      }

      const r = interp(0)
      const g = interp(1)
      const b = interp(2)
      const a = interp(3) / 255

      const destX = offsetX + x
      const destY = offsetY + y
      const idx = (destY * targetW + destX) * 3

      // Composite over white background
      rgbBuf[idx] = Math.round(r * a + 255 * (1 - a))
      rgbBuf[idx + 1] = Math.round(g * a + 255 * (1 - a))
      rgbBuf[idx + 2] = Math.round(b * a + 255 * (1 - a))
    }
  }

  // 24-bit Windows Bitmap format
  const rowSize = Math.floor((24 * targetW + 31) / 32) * 4
  const imageSize = rowSize * targetH
  const fileSize = 54 + imageSize
  const bmpBuf = Buffer.alloc(fileSize)

  bmpBuf.write("BM", 0)
  bmpBuf.writeUInt32LE(fileSize, 2)
  bmpBuf.writeUInt32LE(54, 10)
  bmpBuf.writeUInt32LE(40, 14)
  bmpBuf.writeInt32LE(targetW, 18)
  bmpBuf.writeInt32LE(targetH, 22)
  bmpBuf.writeUInt16LE(1, 26)
  bmpBuf.writeUInt16LE(24, 28)
  bmpBuf.writeUInt32LE(0, 30)
  bmpBuf.writeUInt32LE(imageSize, 34)

  for (let y = 0; y < targetH; y++) {
    const srcY = targetH - 1 - y
    const rowOffset = 54 + y * rowSize
    for (let x = 0; x < targetW; x++) {
      const srcIdx = (srcY * targetW + x) * 3
      bmpBuf[rowOffset + x * 3] = rgbBuf[srcIdx + 2]     // B
      bmpBuf[rowOffset + x * 3 + 1] = rgbBuf[srcIdx + 1] // G
      bmpBuf[rowOffset + x * 3 + 2] = rgbBuf[srcIdx]     // R
    }
  }

  fs.writeFileSync(path.join(OUT_DIR, "installerHeader.bmp"), bmpBuf)
  console.log("Generated installerHeader.bmp (" + targetW + "x" + targetH + ")")
}

// 2. Generate installerSidebar.bmp (164x314) from hikat-logo.png
const hikatLogoPath = path.join(BRANDING_DIR, "hikat-logo.png")
if (fs.existsSync(hikatLogoPath)) {
  const src = decode(fs.readFileSync(hikatLogoPath))
  const targetW = 164
  const targetH = 314

  // Dark gradient background: Top #0B0F19 (11, 15, 25) -> Bottom #1A1836 (26, 24, 54)
  const rgbBuf = Buffer.alloc(targetW * targetH * 3)
  for (let y = 0; y < targetH; y++) {
    const t = y / (targetH - 1)
    const rBg = Math.round(11 * (1 - t) + 26 * t)
    const gBg = Math.round(15 * (1 - t) + 24 * t)
    const bBg = Math.round(25 * (1 - t) + 54 * t)

    for (let x = 0; x < targetW; x++) {
      const idx = (y * targetW + x) * 3
      rgbBuf[idx] = rBg
      rgbBuf[idx + 1] = gBg
      rgbBuf[idx + 2] = bBg
    }
  }

  // Scale hikat-logo to fit width 132px, centered
  const logoW = 132
  const scale = logoW / src.width
  const logoH = Math.round(src.height * scale)
  const offsetX = Math.floor((targetW - logoW) / 2)
  const offsetY = Math.floor((targetH - logoH) / 2) - 10

  for (let y = 0; y < logoH; y++) {
    for (let x = 0; x < logoW; x++) {
      const gx = (x / (logoW - 1)) * (src.width - 1)
      const gy = (y / (logoH - 1)) * (src.height - 1)
      const gxi = Math.floor(gx)
      const gyi = Math.floor(gy)
      const c00 = (gyi * src.width + gxi) * 4
      const c10 = (gyi * src.width + Math.min(gxi + 1, src.width - 1)) * 4
      const c01 = (Math.min(gyi + 1, src.height - 1) * src.width + gxi) * 4
      const c11 = (Math.min(gyi + 1, src.height - 1) * src.width + Math.min(gxi + 1, src.width - 1)) * 4

      const fx = gx - gxi
      const fy = gy - gyi

      function interp(offset) {
        const top = src.data[c00 + offset] * (1 - fx) + src.data[c10 + offset] * fx
        const bottom = src.data[c01 + offset] * (1 - fx) + src.data[c11 + offset] * fx
        return top * (1 - fy) + bottom * fy
      }

      const r = interp(0)
      const g = interp(1)
      const b = interp(2)
      const a = interp(3) / 255

      const destX = offsetX + x
      const destY = offsetY + y
      const idx = (destY * targetW + destX) * 3

      const rBg = rgbBuf[idx]
      const gBg = rgbBuf[idx + 1]
      const bBg = rgbBuf[idx + 2]

      rgbBuf[idx] = Math.round(r * a + rBg * (1 - a))
      rgbBuf[idx + 1] = Math.round(g * a + gBg * (1 - a))
      rgbBuf[idx + 2] = Math.round(b * a + bBg * (1 - a))
    }
  }

  // 24-bit Windows Bitmap format
  const rowSize = Math.floor((24 * targetW + 31) / 32) * 4
  const imageSize = rowSize * targetH
  const fileSize = 54 + imageSize
  const bmpBuf = Buffer.alloc(fileSize)

  bmpBuf.write("BM", 0)
  bmpBuf.writeUInt32LE(fileSize, 2)
  bmpBuf.writeUInt32LE(54, 10)
  bmpBuf.writeUInt32LE(40, 14)
  bmpBuf.writeInt32LE(targetW, 18)
  bmpBuf.writeInt32LE(targetH, 22)
  bmpBuf.writeUInt16LE(1, 26)
  bmpBuf.writeUInt16LE(24, 28)
  bmpBuf.writeUInt32LE(0, 30)
  bmpBuf.writeUInt32LE(imageSize, 34)

  for (let y = 0; y < targetH; y++) {
    const srcY = targetH - 1 - y
    const rowOffset = 54 + y * rowSize
    for (let x = 0; x < targetW; x++) {
      const srcIdx = (srcY * targetW + x) * 3
      bmpBuf[rowOffset + x * 3] = rgbBuf[srcIdx + 2]     // B
      bmpBuf[rowOffset + x * 3 + 1] = rgbBuf[srcIdx + 1] // G
      bmpBuf[rowOffset + x * 3 + 2] = rgbBuf[srcIdx]     // R
    }
  }

  fs.writeFileSync(path.join(OUT_DIR, "installerSidebar.bmp"), bmpBuf)
  console.log("Generated installerSidebar.bmp (" + targetW + "x" + targetH + ")")
}

// 3. Generate icon.png (512x512) from logo-windows.png for electron-builder canonical Windows icon
const logoWindowsPath = path.join(BRANDING_DIR, "logo-windows.png")
if (fs.existsSync(logoWindowsPath)) {
  const src = decode(fs.readFileSync(logoWindowsPath))
  const targetW = 512
  const targetH = 512
  const dstData = Buffer.alloc(targetW * targetH * 4)

  for (let y = 0; y < targetH; y++) {
    for (let x = 0; x < targetW; x++) {
      const gx = (x / (targetW - 1)) * (src.width - 1)
      const gy = (y / (targetH - 1)) * (src.height - 1)
      const gxi = Math.floor(gx)
      const gyi = Math.floor(gy)
      const c00 = (gyi * src.width + gxi) * 4
      const c10 = (gyi * src.width + Math.min(gxi + 1, src.width - 1)) * 4
      const c01 = (Math.min(gyi + 1, src.height - 1) * src.width + gxi) * 4
      const c11 = (Math.min(gyi + 1, src.height - 1) * src.width + Math.min(gxi + 1, src.width - 1)) * 4

      const fx = gx - gxi
      const fy = gy - gyi

      function interp(offset) {
        const top = src.data[c00 + offset] * (1 - fx) + src.data[c10 + offset] * fx
        const bottom = src.data[c01 + offset] * (1 - fx) + src.data[c11 + offset] * fx
        return top * (1 - fy) + bottom * fy
      }

      const idx = (y * targetW + x) * 4
      dstData[idx] = Math.round(interp(0))
      dstData[idx + 1] = Math.round(interp(1))
      dstData[idx + 2] = Math.round(interp(2))
      dstData[idx + 3] = Math.round(interp(3))
    }
  }

  const { encode } = require("fast-png")
  const outPng = encode({ width: targetW, height: targetH, data: dstData })
  fs.writeFileSync(path.join(OUT_DIR, "icon.png"), outPng)
  console.log("Generated icon.png (" + targetW + "x" + targetH + ") from logo-windows.png")

  // Remove obsolete manual 180x180 icon.ico if present
  const obsoleteIco = path.join(OUT_DIR, "icon.ico")
  if (fs.existsSync(obsoleteIco)) {
    fs.unlinkSync(obsoleteIco)
  }
}

