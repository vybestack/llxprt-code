/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */

export const MIB = 1024 * 1024;

/** A held cut of a larger string may retain at most this much (heap noise stays far below it). */
export const RETAINED_BOUND = 4 * MIB;

/** Text of `bytes` characters built from distinct pieces so it is a real allocation. */
export function bigText(bytes: number): string {
  const pieces: string[] = [];
  for (let at = 0, index = 0; at < bytes; at += MIB, index++) {
    pieces.push(
      index
        .toString(36)
        .padStart(6, '0')
        .repeat(MIB / 6),
    );
  }
  return pieces.join('').slice(0, bytes);
}
