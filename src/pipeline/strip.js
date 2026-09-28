'use strict';

// JPEG segments removed: APP1 (EXIF, XMP), APP13 (IPTC), COM (comments).
const JPEG_DROP = new Set([0xe1, 0xed, 0xfe]);
// PNG chunks removed: EXIF, text metadata, modification time.
const PNG_DROP = new Set(['eXIf', 'tEXt', 'zTXt', 'iTXt', 'tIME']);
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function stripJpeg(buf) {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  const parts = [buf.subarray(0, 2)];
  let i = 2;
  while (i + 4 <= buf.length) {
    if (buf[i] !== 0xff) return null;
    const marker = buf[i + 1];
    if (marker === 0xff) { i += 1; continue; } // fill byte
    if (marker === 0xda || marker === 0xd9) {
      // Start of scan (or end of image): the rest is image data, copied verbatim.
      parts.push(buf.subarray(i));
      return Buffer.concat(parts);
    }
    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      parts.push(buf.subarray(i, i + 2));
      i += 2;
      continue;
    }
    const length = buf.readUInt16BE(i + 2);
    if (length < 2 || i + 2 + length > buf.length) return null;
    if (!JPEG_DROP.has(marker)) parts.push(buf.subarray(i, i + 2 + length));
    i += 2 + length;
  }
  return null;
}

function stripPng(buf) {
  if (buf.length < 8 || !buf.subarray(0, 8).equals(PNG_SIGNATURE)) return null;
  const parts = [buf.subarray(0, 8)];
  let i = 8;
  while (i + 12 <= buf.length) {
    const length = buf.readUInt32BE(i);
    const type = buf.toString('latin1', i + 4, i + 8);
    const end = i + 12 + length;
    if (end > buf.length) return null;
    if (!PNG_DROP.has(type)) parts.push(buf.subarray(i, end));
    i = end;
    if (type === 'IEND') return Buffer.concat(parts);
  }
  return null;
}

/** Remove metadata (EXIF, GPS, comments) from JPEG/PNG. Anything else is returned unchanged. */
function stripMetadata(buf) {
  return stripJpeg(buf) || stripPng(buf) || buf;
}

module.exports = { stripMetadata };
