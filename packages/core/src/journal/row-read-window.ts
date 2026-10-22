/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { PositionalReader } from './positionalFile.js';

export const ROW_READ_WINDOW_BYTES = 16 * 1024;
export const ROW_READ_WINDOW_COUNT = 2;

interface Window {
  readonly offset: number;
  readonly bytes: Uint8Array;
}

export interface RowReadWindowStats {
  readonly retainedBytes: number;
  readonly peakRetainedBytes: number;
  readonly peakTransientBytes: number;
}

export interface RowReadWindow extends PositionalReader {
  readonly stats: RowReadWindowStats;
}

export function rowReadWindow(
  reader: PositionalReader,
  durableEnd: number,
): RowReadWindow {
  let windows: readonly Window[] = [];
  let peakRetainedBytes = 0;
  let peakTransientBytes = 0;
  const retained = (): number =>
    windows.reduce((sum, window) => sum + window.bytes.byteLength, 0);
  return {
    stats: {
      get retainedBytes(): number {
        return retained();
      },
      get peakRetainedBytes(): number {
        return peakRetainedBytes;
      },
      get peakTransientBytes(): number {
        return peakTransientBytes;
      },
    },
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
      peakTransientBytes = Math.max(
        peakTransientBytes,
        retained() + bytes.byteLength,
      );
      windows = [
        { offset: position, bytes },
        ...windows.slice(0, ROW_READ_WINDOW_COUNT - 1),
      ];
      peakRetainedBytes = Math.max(peakRetainedBytes, retained());
      return bytes.slice(0, length);
    },
  };
}
