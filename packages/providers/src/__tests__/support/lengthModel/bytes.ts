/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */

/**
 * Issue #854 phase 0: byte arithmetic shared by the OpenAI chat and Responses
 * length models. Test-side code.
 */

export function utf8Bytes(text: string): number {
  return Buffer.byteLength(text);
}

/** Bytes of `JSON.stringify(value)`; the converters' own objects are measured. */
export function jsonBytes(value: unknown): number {
  return utf8Bytes(JSON.stringify(value));
}

/** The sum of the decimal digit counts of `0 .. count - 1` (zero has one). */
export function sumDigits(count: number): number {
  let total = 0;
  let low = 0;
  for (let width = 1; low < count; width += 1) {
    const high = Math.min(count, 10 ** width);
    total += (high - low) * width;
    low = high;
  }
  return total;
}

export function digitCount(value: number): number {
  return String(value).length;
}

export function lcg(seed: number): () => number {
  const start = seed >>> 0;
  let state = start === 0 ? 1 : start;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}
