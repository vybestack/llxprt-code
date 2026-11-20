/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */

const UTF8_ENCODER = new TextEncoder();
const UTF8_DECODER = new TextDecoder();

/**
 * A string that owns its characters (issue #854).
 *
 * JavaScriptCore's `slice`, `substring`, `substr`, `trim`, `split` and regular
 * expression captures return a view on the characters of the string they were
 * cut from. A short piece kept in a long-lived field then keeps the whole parent
 * alive: a 200-character preview of a 40 MiB row retained the row. Pass a piece
 * through this function at the point it is stored, not where it is cut.
 *
 * The copy goes through UTF-8, so a lone surrogate becomes U+FFFD, which is what
 * any later UTF-8 encoding of the text does anyway. Do not use it for text whose
 * exact UTF-16 units matter.
 *
 * Byte views (`subarray`, `Buffer.slice`) share the same way and are copied with
 * `Buffer.from(view)` where they are stored.
 */
export function ownedString(piece: string): string {
  return UTF8_DECODER.decode(UTF8_ENCODER.encode(piece));
}
