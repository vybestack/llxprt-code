/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Pure, dependency-free image header parsing. Reads only the leading bytes
 * needed to recover width/height for PNG, GIF, JPEG, and WEBP. It never throws
 * and returns `undefined` for any unrecognised, truncated, or corrupt input.
 */

export interface ImageDimensions {
  readonly width: number;
  readonly height: number;
}

/** Bound on the number of base64 characters decoded before header parsing. */
const MAX_BASE64_HEADER_CHARS = 174_764; // ~128 KiB, covers EXIF-heavy JPEG headers

function makeDimensions(width: number, height: number): ImageDimensions {
  return { width, height };
}

function isValidDimension(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function readUint16BE(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] << 8) | bytes[offset + 1];
}

function readUint16LE(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function readUint24LE(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

function readUint32BE(bytes: Uint8Array, offset: number): number {
  // `>>> 0` keeps the result unsigned; `<< 24` alone sign-extends past 2^31.
  return (
    ((bytes[offset] << 24) |
      (bytes[offset + 1] << 16) |
      (bytes[offset + 2] << 8) |
      bytes[offset + 3]) >>>
    0
  );
}

function readUint32LE(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset] |
    (bytes[offset + 1] << 8) |
    (bytes[offset + 2] << 16) |
    (bytes[offset + 3] << 24)
  );
}

function hasBytes(bytes: Uint8Array, offset: number, count: number): boolean {
  return offset >= 0 && count >= 0 && offset + count <= bytes.length;
}

function matchesAscii(
  bytes: Uint8Array,
  offset: number,
  expected: string,
): boolean {
  if (!hasBytes(bytes, offset, expected.length)) return false;
  for (let i = 0; i < expected.length; i++) {
    if (bytes[offset + i] !== expected.charCodeAt(i)) return false;
  }
  return true;
}

function parsePngDimensions(bytes: Uint8Array): ImageDimensions | undefined {
  // PNG signature (8) + IHDR length (4) + "IHDR" (4) precede width/height.
  if (!hasBytes(bytes, 0, 24)) return undefined;
  const ihdrOffset = 12;
  if (!matchesAscii(bytes, ihdrOffset, 'IHDR')) {
    return undefined;
  }
  const width = readUint32BE(bytes, 16);
  const height = readUint32BE(bytes, 20);
  if (!isValidDimension(width) || !isValidDimension(height)) return undefined;
  return makeDimensions(width, height);
}

function parseGifDimensions(bytes: Uint8Array): ImageDimensions | undefined {
  if (!hasBytes(bytes, 0, 10)) return undefined;
  const width = readUint16LE(bytes, 6);
  const height = readUint16LE(bytes, 8);
  if (!isValidDimension(width) || !isValidDimension(height)) return undefined;
  return makeDimensions(width, height);
}

/** SOF markers that carry frame dimensions. */
function isStartOfFrameMarker(marker: number): boolean {
  // SOF markers occupy several non-contiguous ranges: C0–C3, C5–C7, C9–CB, CD–CF.
  if (marker >= 0xc0 && marker <= 0xc3) return true;
  if (marker >= 0xc5 && marker <= 0xc7) return true;
  if (marker >= 0xc9 && marker <= 0xcb) return true;
  return marker >= 0xcd && marker <= 0xcf;
}

/** Standalone markers carry no length field. */
function isStandaloneMarker(marker: number): boolean {
  if (marker === 0x01) return true;
  return marker >= 0xd0 && marker <= 0xd9;
}

function parseJpegDimensions(bytes: Uint8Array): ImageDimensions | undefined {
  // Walk JPEG segments starting after the SOI marker.
  let offset = 2;
  while (offset + 1 < bytes.length) {
    // Skip fill bytes before each marker.
    while (offset < bytes.length && bytes[offset] !== 0xff) {
      offset++;
    }
    // Collapse runs of FF fill bytes.
    while (offset < bytes.length && bytes[offset] === 0xff) {
      offset++;
    }
    if (offset >= bytes.length) return undefined;
    const marker = bytes[offset];
    offset++;
    if (marker === 0xda) return undefined; // SOS: scan data begins, no SOF seen
    if (isStandaloneMarker(marker)) continue;

    // Segment length field is big-endian uint16 and includes its own 2 bytes.
    if (offset + 2 > bytes.length) return undefined;
    const segmentLength = readUint16BE(bytes, offset);
    if (segmentLength < 2) return undefined;

    if (isStartOfFrameMarker(marker)) {
      // SOF body layout (offsets relative to the length field):
      // [len:2][precision:1][height:2][width:2][components...].
      const heightOffset = offset + 3;
      const widthOffset = offset + 5;
      if (!hasBytes(bytes, widthOffset, 2)) return undefined;
      const height = readUint16BE(bytes, heightOffset);
      const width = readUint16BE(bytes, widthOffset);
      if (!isValidDimension(width) || !isValidDimension(height)) {
        return undefined;
      }
      return makeDimensions(width, height);
    }
    offset += segmentLength;
  }
  return undefined;
}

function parseWebpDimensions(bytes: Uint8Array): ImageDimensions | undefined {
  // RIFF (4) + size (4) + WEBP (4) + chunk FourCC (4) = 16 bytes minimum.
  if (!hasBytes(bytes, 0, 16)) return undefined;
  const fourCc = String.fromCharCode(
    bytes[12],
    bytes[13],
    bytes[14],
    bytes[15],
  );

  if (fourCc === 'VP8 ') {
    if (!hasBytes(bytes, 0, 30)) return undefined;
    // The 3-byte frame tag at 20-22 is followed by the keyframe start code.
    if (bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) {
      return undefined;
    }
    const width = readUint16LE(bytes, 26) & 0x3fff;
    const height = readUint16LE(bytes, 28) & 0x3fff;
    if (!isValidDimension(width) || !isValidDimension(height)) return undefined;
    return makeDimensions(width, height);
  }
  if (fourCc === 'VP8L') {
    if (!hasBytes(bytes, 0, 25)) return undefined;
    if (bytes[20] !== 0x2f) return undefined; // VP8L signature byte
    const bits = readUint32LE(bytes, 21);
    const width = (bits & 0x3fff) + 1;
    const height = ((bits >> 14) & 0x3fff) + 1;
    if (!isValidDimension(width) || !isValidDimension(height)) return undefined;
    return makeDimensions(width, height);
  }
  if (fourCc === 'VP8X') {
    if (!hasBytes(bytes, 0, 30)) return undefined;
    const width = readUint24LE(bytes, 24) + 1;
    const height = readUint24LE(bytes, 27) + 1;
    if (!isValidDimension(width) || !isValidDimension(height)) return undefined;
    return makeDimensions(width, height);
  }
  return undefined;
}

/** PNG magic bytes: 89 50 4E 47 0D 0A 1A 0A. */
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function isPng(bytes: Uint8Array): boolean {
  if (!hasBytes(bytes, 0, PNG_SIGNATURE.length)) return false;
  for (let i = 0; i < PNG_SIGNATURE.length; i++) {
    if (bytes[i] !== PNG_SIGNATURE[i]) return false;
  }
  return true;
}

function isGif(bytes: Uint8Array): boolean {
  return matchesAscii(bytes, 0, 'GIF87a') || matchesAscii(bytes, 0, 'GIF89a');
}

function isJpeg(bytes: Uint8Array): boolean {
  return hasBytes(bytes, 0, 2) && bytes[0] === 0xff && bytes[1] === 0xd8;
}

function isWebp(bytes: Uint8Array): boolean {
  return matchesAscii(bytes, 0, 'RIFF') && matchesAscii(bytes, 8, 'WEBP');
}

/**
 * Parse width/height from raw image header bytes.
 *
 * Returns `undefined` for unrecognised, truncated, or corrupt input. It never
 * throws: all bounds are checked before reads.
 */
export function parseImageDimensions(
  bytes: Uint8Array,
): ImageDimensions | undefined {
  if (bytes.length === 0) return undefined;
  try {
    if (isPng(bytes)) return parsePngDimensions(bytes);
    if (isGif(bytes)) return parseGifDimensions(bytes);
    if (isJpeg(bytes)) return parseJpegDimensions(bytes);
    if (isWebp(bytes)) return parseWebpDimensions(bytes);
    return undefined;
  } catch {
    return undefined;
  }
}

/** Longest `data:<mime>;base64,` prefix considered when locating the payload. */
const MAX_DATA_URI_PREFIX_CHARS = 256;

/** Strip an optional `data:<mime>;base64,` prefix from a base64 string. */
function stripDataUriPrefix(value: string): string {
  const commaIndex = value.slice(0, MAX_DATA_URI_PREFIX_CHARS).indexOf(',');
  if (commaIndex >= 0 && value.slice(0, commaIndex).endsWith(';base64')) {
    return value.slice(commaIndex + 1);
  }
  return value;
}

/**
 * Parse image dimensions from a base64 payload.
 *
 * Tolerates `data:` URI prefixes and embedded whitespace. Decodes only a bounded
 * prefix (enough to cover EXIF-heavy JPEG headers) and delegates to
 * {@link parseImageDimensions}. Returns `undefined` on invalid base64 or when no
 * usable header bytes decode. It never throws.
 */
export function parseImageDimensionsFromBase64(
  base64: string,
): ImageDimensions | undefined {
  if (base64.length === 0) return undefined;
  try {
    // Read a bounded window first so a multi-megabyte payload is never scanned
    // or copied in full; the window is doubled to absorb interleaved newlines.
    const window = stripDataUriPrefix(base64).slice(
      0,
      MAX_BASE64_HEADER_CHARS * 2,
    );
    const stripped = window.replace(/\s+/g, '');
    if (stripped.length === 0) return undefined;
    const truncated =
      stripped.length > MAX_BASE64_HEADER_CHARS
        ? stripped.slice(0, MAX_BASE64_HEADER_CHARS)
        : stripped;
    const decoded = Buffer.from(truncated, 'base64');
    if (decoded.length === 0) return undefined;
    return parseImageDimensions(decoded);
  } catch {
    return undefined;
  }
}
