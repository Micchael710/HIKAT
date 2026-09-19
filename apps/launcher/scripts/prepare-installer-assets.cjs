/**
 * Converts existing HiKAT launcher branding assets into NSIS-compatible formats.
 * Source assets:
 * - apps/launcher/src/assets/branding/logo-black.png -> installer/resources/hikat-logo.bmp
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

// 1. Generate hikat-logo.bmp from logo-black.png
const logoBlackPath = path.join(BRANDING_DIR, "logo-black.png")
if (fs.existsSync(logoBlackPath)) {
  const src = decode(fs.readFileSync(logoBlackPath))
  const targetW = 212
  const targetH = 80
  const rgbBuf = Buffer.alloc(targetW * targetH * 3)

  for (let y = 0; y < targetH; y++) {
    for (let x = 0; x < targetW; x++) {
      const gx = (x / targetW) * (src.width - 1)
      const gy = (y / targetH) * (src.height - 1)
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

      // Composite over pure white background (#FFFFFF)
      rgbBuf[(y * targetW + x) * 3] = Math.round(r * a + 255 * (1 - a))
      rgbBuf[(y * targetW + x) * 3 + 1] = Math.round(g * a + 255 * (1 - a))
      rgbBuf[(y * targetW + x) * 3 + 2] = Math.round(b * a + 255 * (1 - a))
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

  fs.writeFileSync(path.join(OUT_DIR, "hikat-logo.bmp"), bmpBuf)
  console.log("Generated hikat-logo.bmp (" + targetW + "x" + targetH + ")")
}

// 2. Generate icon.ico from logo-windows.png
const logoWindowsPath = path.join(BRANDING_DIR, "logo-windows.png")
if (fs.existsSync(logoWindowsPath)) {
  const pngBuf = fs.readFileSync(logoWindowsPath)
  const icoHeader = Buffer.alloc(22)
  icoHeader.writeUInt16LE(0, 0) // reserved
  icoHeader.writeUInt16LE(1, 2) // icon type
  icoHeader.writeUInt16LE(1, 4) // 1 image
  icoHeader.writeUInt8(180, 6)  // width
  icoHeader.writeUInt8(180, 7)  // height
  icoHeader.writeUInt8(0, 8)    // colors
  icoHeader.writeUInt8(0, 9)    // reserved
  icoHeader.writeUInt16LE(1, 10) // planes
  icoHeader.writeUInt16LE(32, 12) // bpp
  icoHeader.writeUInt32LE(pngBuf.length, 14) // data size
  icoHeader.writeUInt32LE(22, 18) // offset

  const icoBuf = Buffer.concat([icoHeader, pngBuf])
  fs.writeFileSync(path.join(OUT_DIR, "icon.ico"), icoBuf)
  console.log("Generated icon.ico from logo-windows.png")
}
