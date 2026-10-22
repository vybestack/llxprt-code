/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { PositionalReader } from './positionalFile.js';

export const ROW_READ_WINDOW_BYTES = 16 * 1024;
export const ROW_READ_WINDOW_COUNT = 2;

interface Window {
  readonly offset: number;
  readonly bytes: Uint8Array;
}

export function rowReadWindow(
  reader: PositionalReader,
  durableEnd: number,
): PositionalReader {
  let windows: readonly Window[] = [];
  return {
    async readAt(position, length) {
      if (length > ROW_READ_WINDOW_BYTES)
        return reader.readAt(position, length);
      const cached = windows.find(
        (window) =>
          position >= window.offset &&
          position + length <= window.offset + window.bytes.length,
      );
      if (cached !== undefined)
        return cached.bytes.slice(
          position - cached.offset,
          position - cached.offset + length,
        );
      const bytes = await reader.readAt(
        position,
        Math.min(ROW_READ_WINDOW_BYTES, durableEnd - position),
      );
      windows = [
        { offset: position, bytes },
        ...windows.slice(0, ROW_READ_WINDOW_COUNT - 1),
      ];
      return bytes.slice(0, length);
    },
  };
}
