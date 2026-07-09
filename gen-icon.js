const fs = require('fs');

// Create a valid PNG file programmatically
function createPNG(width, height) {
  const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  
  function crc32(buf) {
    let crc = 0xFFFFFFFF;
    const table = [];
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      table[i] = c;
    }
    for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }
  
  function chunk(type, data) {
    const typeBuffer = Buffer.from(type);
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const crcBuffer = Buffer.alloc(4);
    const crcData = Buffer.concat([typeBuffer, data]);
    crcBuffer.writeUInt32BE(crc32(crcData));
    return Buffer.concat([len, typeBuffer, data, crcBuffer]);
  }
  
  // IHDR
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 2;  // color type RGB
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  
  // Image data - simple colored square
  const zlib = require('zlib');
  const raw = [];
  for (let y = 0; y < height; y++) {
    raw.push(0); // filter type
    for (let x = 0; x < width; x++) {
      const cx = x - width/2, cy = y - height/2;
      const r = Math.sqrt(cx*cx + cy*cy);
      const radius = width * 0.45;
      const corner = Math.min(width, height) * 0.15;
      
      // Simple blue background
      let R = 0x1a, G = 0x3c, B = 0x5e;
      
      // Gold circle in center
      if (r < radius * 0.4) {
        R = 0xc8; G = 0xa8; B = 0x4b;
      }
      
      raw.push(R, G, B);
    }
  }
  
  const rawBuf = Buffer.from(raw);
  const compressed = zlib.deflateSync(rawBuf);
  
  return Buffer.concat([
    PNG_SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', compressed),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

const png192 = createPNG(192, 192);
const png512 = createPNG(512, 512);

fs.writeFileSync('icon-192.png', png192);
fs.writeFileSync('icon-512.png', png512);
console.log('✅ icon-192.png and icon-512.png created!');
