const zlib = require("zlib");

/**
 * Generates a valid PNG image buffer representing a captured evidence frame.
 * Includes optional visual bounding box outline.
 *
 * @param {number} width Image width (default 640)
 * @param {number} height Image height (default 360)
 * @param {Array<number>} [bbox] Normalized bounding box [x1, y1, x2, y2]
 * @param {string} [label] Optional label indicator
 * @returns {Buffer} Valid PNG file buffer
 */
function generateEvidenceImage(width = 640, height = 360, bbox = null, label = "VIOLATION") {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  // 1. IHDR Chunk
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData.writeUInt8(8, 8); // 8-bit depth
  ihdrData.writeUInt8(2, 9); // Color type 2 (RGB Truecolor)
  ihdrData.writeUInt8(0, 10); // Compression method (deflate)
  ihdrData.writeUInt8(0, 11); // Filter method (standard)
  ihdrData.writeUInt8(0, 12); // Interlace method (none)

  function makeChunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const typeBuf = Buffer.from(type, "ascii");
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(Buffer.concat([typeBuf, data])), 0);
    return Buffer.concat([len, typeBuf, data, crc]);
  }

  const ihdr = makeChunk("IHDR", ihdrData);

  // 2. Pixel scanlines (RGB)
  const bytesPerPixel = 3;
  const scanlineLength = 1 + width * bytesPerPixel;
  const rawData = Buffer.alloc(scanlineLength * height);

  // Compute bounding box pixel boundaries if provided
  let bx1 = -1, by1 = -1, bx2 = -1, by2 = -1;
  if (Array.isArray(bbox) && bbox.length >= 4) {
    bx1 = Math.floor(Math.max(0, Math.min(1, bbox[0])) * width);
    by1 = Math.floor(Math.max(0, Math.min(1, bbox[1])) * height);
    bx2 = Math.floor(Math.max(0, Math.min(1, bbox[2])) * width);
    by2 = Math.floor(Math.max(0, Math.min(1, bbox[3])) * height);
    if (bx1 > bx2) [bx1, bx2] = [bx2, bx1];
    if (by1 > by2) [by1, by2] = [by2, by1];
  }

  const borderThickness = 4;

  for (let y = 0; y < height; y++) {
    const rowOffset = y * scanlineLength;
    rawData[rowOffset] = 0; // Filter type 0 (None)

    for (let x = 0; x < width; x++) {
      const pIdx = rowOffset + 1 + x * bytesPerPixel;

      // Check if pixel is on bbox border
      const isBboxBorder =
        bx1 !== -1 &&
        x >= bx1 &&
        x <= bx2 &&
        y >= by1 &&
        y <= by2 &&
        (x < bx1 + borderThickness ||
          x > bx2 - borderThickness ||
          y < by1 + borderThickness ||
          y > by2 - borderThickness);

      if (isBboxBorder) {
        // Red/Orange violation box (RGB: 235, 50, 35)
        rawData[pIdx] = 235;
        rawData[pIdx + 1] = 50;
        rawData[pIdx + 2] = 35;
      } else {
        // Subtle industrial surveillance gradient (slate/dark gray)
        const bgShade = 35 + Math.floor((y / height) * 25);
        rawData[pIdx] = bgShade;
        rawData[pIdx + 1] = bgShade + 5;
        rawData[pIdx + 2] = bgShade + 12;
      }
    }
  }

  // 3. IDAT & IEND Chunks
  const compressed = zlib.deflateSync(rawData);
  const idat = makeChunk("IDAT", compressed);
  const iend = makeChunk("IEND", Buffer.alloc(0));

  return Buffer.concat([signature, ihdr, idat, iend]);
}

module.exports = { generateEvidenceImage, };