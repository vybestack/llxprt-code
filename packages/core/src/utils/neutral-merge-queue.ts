/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */

/** Ordered set of (uint18 rank, uint32 byte offset), using 13 radix digits.
 * Fixed-depth insertion/removal gives linear total work for BPE's O(n) events.
 * Equal ranks are always removed leftmost, including newly discovered pairs.
 */
export class NeutralMergeQueue {
  private readonly levels = Array.from(
    { length: 13 },
    () => new Map<number, number>(),
  );
  private minimum: number | undefined;

  add(rank: number, position: number): void {
    const key = rank * 0x1_0000_0000 + position;
    if (this.minimum === undefined || key < this.minimum) this.minimum = key;
    let child = key;
    for (let depth = 12; depth >= 0; depth--) {
      const parent = Math.floor(child / 16);
      const bit = 1 << child % 16;
      const level = this.levels[depth];
      const mask = level.get(parent) ?? 0;
      if ((mask & bit) !== 0) return;
      level.set(parent, mask | bit);
      if (mask !== 0) return;
      child = parent;
    }
  }

  take(): number | undefined {
    const key = this.minimum;
    if (key === undefined) return undefined;
    this.minimum = undefined;
    let child = key;
    for (let depth = 12; depth >= 0; depth--) {
      const parent = Math.floor(child / 16);
      const level = this.levels[depth];
      const mask = (level.get(parent) ?? 0) & ~(1 << child % 16);
      if (mask !== 0) {
        level.set(parent, mask);
        let next = parent * 16 + (31 - Math.clz32(mask & -mask));
        for (let below = depth + 1; below < 13; below++) {
          const children = this.levels[below].get(next) ?? 0;
          next = next * 16 + (31 - Math.clz32(children & -children));
        }
        this.minimum = next;
        break;
      }
      level.delete(parent);
      child = parent;
    }
    return key;
  }
}
