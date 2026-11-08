const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

function getHtmlForSize(size) {
  // Proportions relative to 512
  const scale = size / 512;
  const containerSize = Math.round(468 * scale);
  const radius = Math.round(104 * scale);
  const svgSize = Math.round(340 * scale);
  const borderWidth = Math.max(1, Math.round(2 * scale));

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      width: ${size}px;
      height: ${size}px;
      background: transparent;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
    }
    .icon-container {
      position: relative;
      width: ${containerSize}px;
      height: ${containerSize}px;
      border-radius: ${radius}px;
      overflow: hidden;
      background: linear-gradient(135deg, #1e3a8a 0%, #2563eb 50%, #4f46e5 100%);
      border: ${borderWidth}px solid rgba(255, 255, 255, 0.28);
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .glossy-sheen {
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      height: 52%;
      background: linear-gradient(180deg, rgba(255, 255, 255, 0.45) 0%, rgba(255, 255, 255, 0.08) 60%, transparent 100%);
      pointer-events: none;
      border-top-left-radius: ${radius - 1}px;
      border-top-right-radius: ${radius - 1}px;
    }
    svg {
      width: ${svgSize}px;
      height: ${svgSize}px;
      ${size >= 64 ? 'filter: drop-shadow(0 4px 8px rgba(15, 23, 42, 0.35));' : ''}
    }
  </style>
</head>
<body>
  <div class="icon-container">
    <div class="glossy-sheen"></div>
    <svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="muttahidaGrad1" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#ffffff" />
          <stop offset="100%" stop-color="#93c5fd" />
        </linearGradient>
        <linearGradient id="muttahidaGrad2" x1="100%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="#38bdf8" />
          <stop offset="100%" stop-color="#60a5fa" />
        </linearGradient>
        <linearGradient id="muttahidaGold" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#fef08a" />
          <stop offset="100%" stop-color="#f59e0b" />
        </linearGradient>
      </defs>

      <!-- Left Wing / Pillar of Unity -->
      <path
        d="M 22 74 C 22 74, 20 42, 36 28 C 42 22, 49 26, 49 35 C 49 46, 38 52, 34 68 C 32 75, 25 76, 22 74 Z"
        fill="url(#muttahidaGrad1)"
      />

      <!-- Right Wing / Pillar of Unity -->
      <path
        d="M 78 74 C 78 74, 80 42, 64 28 C 58 22, 51 26, 51 35 C 51 46, 62 52, 66 68 C 68 75, 75 76, 78 74 Z"
        fill="url(#muttahidaGrad2)"
      />

      <!-- Central Keystone / Arch uniting both sides (Letter M / Shield Arch) -->
      <path
        d="M 33 67 L 50 42 L 67 67 C 62 72, 38 72, 33 67 Z"
        fill="#ffffff"
        opacity="0.96"
      />

      <!-- Central Golden Diamond Apex (Excellence & Prosperity) -->
      <polygon
        points="50,16 57,25 50,34 43,25"
        fill="url(#muttahidaGold)"
      />

      <!-- Bottom Foundation Line -->
      <rect
        x="32"
        y="76"
        width="36"
        height="5"
        rx="2.5"
        fill="#ffffff"
        opacity="0.9"
      />
    </svg>
  </div>
</body>
</html>
  `;
}

function packIco(pngEntries) {
  // pngEntries: Array of { width, height, buffer }
  const count = pngEntries.length;
  const headerSize = 6;
  const dirEntrySize = 16;
  let offset = headerSize + count * dirEntrySize;

  const header = Buffer.alloc(headerSize);
  header.writeUInt16LE(0, 0); // Reserved
  header.writeUInt16LE(1, 2); // 1 = ICO
  header.writeUInt16LE(count, 4); // Count

  const dirEntries = [];
  for (const item of pngEntries) {
    const entry = Buffer.alloc(dirEntrySize);
    entry.writeUInt8(item.width >= 256 ? 0 : item.width, 0);
    entry.writeUInt8(item.height >= 256 ? 0 : item.height, 1);
    entry.writeUInt8(0, 2); // palette colors
    entry.writeUInt8(0, 3); // reserved
    entry.writeUInt16LE(1, 4); // planes
    entry.writeUInt16LE(32, 6); // bpp
    entry.writeUInt32LE(item.buffer.length, 8); // size
    entry.writeUInt32LE(offset, 12); // offset
    offset += item.buffer.length;
    dirEntries.push(entry);
  }

  return Buffer.concat([header, ...dirEntries, ...pngEntries.map((p) => p.buffer)]);
}

async function main() {
  const saasDir = path.resolve(__dirname, '..');
  const buildDir = path.join(saasDir, 'build');
  const iconsDir = path.join(buildDir, 'icons');
  const electronDir = path.join(saasDir, 'electron');
  const publicDir = path.join(saasDir, 'public');

  if (!fs.existsSync(buildDir)) fs.mkdirSync(buildDir, { recursive: true });
  if (!fs.existsSync(iconsDir)) fs.mkdirSync(iconsDir, { recursive: true });

  const browser = await chromium.launch({ channel: 'msedge', headless: true });

  const sizes = [512, 256, 128, 64, 48, 32, 16];
  const pngMap = {};

  for (const size of sizes) {
    const page = await browser.newPage({ viewport: { width: size, height: size } });
    await page.setContent(getHtmlForSize(size));
    const buf = await page.screenshot({ omitBackground: true });
    pngMap[size] = buf;
    await page.close();
    console.log(`Rendered ${size}x${size} PNG`);
  }

  await browser.close();

  // Save 512x512
  fs.writeFileSync(path.join(buildDir, 'icon.png'), pngMap[512]);
  console.log('Saved build/icon.png (512x512)');

  // Save 256x256
  fs.writeFileSync(path.join(iconsDir, '256x256.png'), pngMap[256]);
  fs.writeFileSync(path.join(electronDir, 'icon.png'), pngMap[256]);
  fs.writeFileSync(path.join(publicDir, 'icon.png'), pngMap[256]);
  console.log('Saved electron/icon.png and public/icon.png (256x256)');

  // Build ICO containing 256, 128, 64, 48, 32, 16
  const icoSizes = [256, 128, 64, 48, 32, 16];
  const entries = icoSizes.map((s) => ({
    width: s,
    height: s,
    buffer: pngMap[s],
  }));

  const icoBuffer = packIco(entries);
  fs.writeFileSync(path.join(buildDir, 'icon.ico'), icoBuffer);
  fs.writeFileSync(path.join(electronDir, 'icon.ico'), icoBuffer);
  fs.writeFileSync(path.join(publicDir, 'favicon.ico'), icoBuffer);
  console.log('Saved build/icon.ico, electron/icon.ico, and public/favicon.ico');
  console.log(`ICO file size: ${icoBuffer.length} bytes`);
}

main().catch((err) => {
  console.error('Error in create-all-icons:', err);
  process.exit(1);
});

