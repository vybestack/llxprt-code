/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */

/** Deterministic generator for property-style tests: the same seed gives the same draws. */
export class SeededRandom {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /** Uniform float in [0, 1) (mulberry32). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Integer in [0, exclusiveMax). */
  int(exclusiveMax: number): number {
    return Math.floor(this.next() * exclusiveMax);
  }

  /** Integer with `bits` random bits, `bits` at most 53. */
  bits(bits: number): number {
    if (bits <= 32) return Math.floor(this.next() * 2 ** bits);
    const high = this.bits(bits - 32);
    return high * 2 ** 32 + Math.floor(this.next() * 2 ** 32);
  }

  /** Random bigint below 2^bits. */
  bigBits(bits: number): bigint {
    let value = 0n;
    for (let done = 0; done < bits; done += 16) {
      value = (value << 16n) | BigInt(this.int(65536));
    }
    return value & ((1n << BigInt(bits)) - 1n);
  }

  bytes(length: number): Uint8Array {
    const out = new Uint8Array(length);
    for (let index = 0; index < length; index++) out[index] = this.int(256);
    return out;
  }

  /** Integer that is small most of the time and sits on a boundary now and then. */
  mixed(maxExclusive: number): number {
    const roll = this.int(8);
    if (roll === 0) return 0;
    if (roll === 1) return maxExclusive - 1;
    return this.int(maxExclusive);
  }
}
