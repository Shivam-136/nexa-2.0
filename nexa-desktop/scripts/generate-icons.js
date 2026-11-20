const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// Standard CRC32 table
const crcTable = [];
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    if (c & 1) {
      c = 0xedb88320 ^ (c >>> 1);
    } else {
      c = c >>> 1;
    }
  }
  crcTable[n] = c;
}

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = crcTable[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function createChunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const len = data.length;
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(len, 0);

  const body = Buffer.concat([typeBuf, data]);
  const crcVal = crc32(body);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crcVal, 0);

  return Buffer.concat([lenBuf, body, crcBuf]);
}

function generatePng(width, height, pixelFn) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.writeUInt8(8, 8); // 8 bits per channel
  ihdr.writeUInt8(6, 9); // RGBA
  ihdr.writeUInt8(0, 10); // compression
  ihdr.writeUInt8(0, 11); // filter
  ihdr.writeUInt8(0, 12); // interlace
  const ihdrChunk = createChunk('IHDR', ihdr);

  // Scanlines
  const rawData = [];
  for (let y = 0; y < height; y++) {
    rawData.push(0); // filter type 0: None
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = pixelFn(x, y, width, height);
      rawData.push(r, g, b, a);
    }
  }

  const compressed = zlib.deflateSync(Buffer.from(rawData));
  const idatChunk = createChunk('IDAT', compressed);
  const iendChunk = createChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

// 32x32 App Icon with NEXA theme (Dark Slate background with Cyan/Blue gradient emblem)
const appIconBuffer = generatePng(32, 32, (x, y, w, h) => {
  const dx = x - w / 2;
  const dy = y - h / 2;
  const dist = Math.sqrt(dx * dx + dy * dy);

  // Rounded rectangle icon background
  const inBorder = (x >= 2 && x < w - 2 && y >= 2 && y < h - 2);
  const isCorner = (x < 5 || x >= w - 5) && (y < 5 || y >= h - 5);
  const cornerDist = Math.hypot(
    x < 5 ? 5 - x : x >= w - 5 ? x - (w - 6) : 0,
    y < 5 ? 5 - y : y >= h - 5 ? y - (h - 6) : 0
  );

  if (cornerDist > 3.5) {
    return [0, 0, 0, 0]; // Transparent outside rounded corner
  }

  // Double 'N' NEXA stylized lettermark
  const isLeftStem = (x >= 8 && x <= 10 && y >= 8 && y <= 23);
  const isDiag1 = (x >= 10 && x <= 16 && Math.abs((y - 8) - (x - 10) * 1.5) <= 1.2);
  const isMidStem = (x >= 15 && x <= 17 && y >= 8 && y <= 23);
  const isDiag2 = (x >= 17 && x <= 23 && Math.abs((y - 8) - (x - 17) * 1.5) <= 1.2);
  const isRightStem = (x >= 22 && x <= 24 && y >= 8 && y <= 23);

  if (isLeftStem || isDiag1 || isMidStem || isDiag2 || isRightStem) {
    // Cyan to Electric Blue gradient
    const t = y / h;
    const r = Math.round(56 * (1 - t) + 37 * t);
    const g = Math.round(189 * (1 - t) + 99 * t);
    const b = Math.round(248 * (1 - t) + 235 * t);
    return [r, g, b, 255];
  }

  // Dark slate background: #0c111d
  return [12, 17, 29, 255];
});

// 16x16 Tray Icon (crisp monochrome / cyan indicator for Windows notification area)
const trayIconBuffer = generatePng(16, 16, (x, y, w, h) => {
  // Stylized 'N' in 16x16
  const isLeft = (x >= 3 && x <= 4 && y >= 3 && y <= 12);
  const isDiag = (Math.abs((y - 3) - (x - 4) * 1.3) <= 1.0 && x >= 4 && x <= 11);
  const isRight = (x >= 11 && x <= 12 && y >= 3 && y <= 12);

  if (isLeft || isDiag || isRight) {
    // Bright cyan #38bdf8
    return [56, 189, 248, 255];
  }

  return [0, 0, 0, 0]; // Transparent background for tray
});

const assetsDir = path.join(__dirname, '..', 'assets');
if (!fs.existsSync(assetsDir)) {
  fs.mkdirSync(assetsDir, { recursive: true });
}

fs.writeFileSync(path.join(assetsDir, 'icon.png'), appIconBuffer);
fs.writeFileSync(path.join(assetsDir, 'tray-icon.png'), trayIconBuffer);

console.log('NEXA 2.0 icons generated successfully:');
console.log(' - assets/icon.png (32x32)');
console.log(' - assets/tray-icon.png (16x16)');
