/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { Triple } from './bytes.js';
import type { Version } from './version.js';

/** Design 2.5: a trailer names its ancestors 8, 64 and 512 parent hops back. */
export const SKIP_HOPS: Triple<number> = [8, 64, 512];
/** The chain keeps the offsets of at most this many trailers, enough to reach hop 511. */
export const CHAIN_WINDOW = 512;

/**
 * The offsets of the trailers on the parent path ending at one trailer, the
 * newest `CHAIN_WINDOW` of them. The writer needs them to fill the `skip`
 * pointers of the next trailer without reading, and the window bounds the
 * memory whatever the length of the lineage. A chain never changes; `push`
 * and `truncatedTo` make new ones, so a group that fails leaves the writer's
 * chain as it was.
 */
export class LineageChain {
  /** The chain of a trailer that has no parent: nothing before the first trailer. */
  static readonly NONE = new LineageChain(-1, []);

  private constructor(
    readonly topDepth: number,
    /** `offsets[i]` is the trailer at depth `topDepth - (length - 1) + i`. */
    private readonly offsets: readonly number[],
  ) {}

  static ending(topDepth: number, offsets: readonly number[]): LineageChain {
    return new LineageChain(topDepth, offsets);
  }

  /** The offset of the ancestor at `depth` on this path, if the window holds it. */
  offsetAtDepth(depth: number): number | undefined {
    const index = depth - (this.topDepth - (this.offsets.length - 1));
    return index >= 0 && index < this.offsets.length
      ? this.offsets[index]
      : undefined;
  }

  /** The chain ending at the ancestor at `depth`, or undefined when the window does not hold it. */
  truncatedTo(depth: number): LineageChain | undefined {
    if (depth === this.topDepth) return this;
    const index = depth - (this.topDepth - (this.offsets.length - 1));
    if (index < 0 || index >= this.offsets.length) return undefined;
    return new LineageChain(depth, this.offsets.slice(0, index + 1));
  }

  /** This chain with the next trailer, one hop deeper, on the end. */
  push(offset: number): LineageChain {
    const kept = this.offsets.slice(-(CHAIN_WINDOW - 1));
    return new LineageChain(this.topDepth + 1, [...kept, offset]);
  }

  /** The `skip` pointers of a trailer that follows this chain: 0 where the lineage is too short. */
  skipsForChild(): Triple<number> {
    const childDepth = this.topDepth + 1;
    const at = (hops: number): number =>
      childDepth - hops >= 0 ? (this.offsetAtDepth(childDepth - hops) ?? 0) : 0;
    return [at(SKIP_HOPS[0]), at(SKIP_HOPS[1]), at(SKIP_HOPS[2])];
  }
}

/** Reads the version of the trailer at an offset. */
export type VersionReader = (offset: number) => Promise<Version>;

/**
 * The chain ending at `top`, read from the file by walking `parent` links.
 * It costs up to `CHAIN_WINDOW` reads, so the writer keeps its chain and
 * calls this only after an open or a pop that landed outside the window.
 */
export async function loadChain(
  readVersion: VersionReader,
  top: Version,
): Promise<LineageChain> {
  const offsets: number[] = [top.selfOffset];
  let at = top;
  while (at.parent !== 0 && offsets.length < CHAIN_WINDOW) {
    at = await readVersion(at.parent);
    offsets.push(at.selfOffset);
  }
  return LineageChain.ending(top.lineageDepth, offsets.reverse());
}

/**
 * The nearest ancestor of `start` on its lineage, `start` itself included,
 * whose row set has at most `keep` rows (design 4.3 step 2). Row counts never
 * increase going up the chain, so the skip pointers give a binary descent:
 * jump to the farthest skip that is still above `keep`, and step by `parent`
 * when none is. Undefined when the lineage start still has more rows, which is
 * the case that must rebuild.
 */
export async function nearestAncestorWithRows(
  readVersion: VersionReader,
  start: Version,
  keep: number,
): Promise<Version | undefined> {
  let at = start;
  while (at.rows > keep) {
    if (at.parent === 0) return undefined;
    at = await stepTowardKeep(readVersion, at, keep);
  }
  return at;
}

async function stepTowardKeep(
  readVersion: VersionReader,
  at: Version,
  keep: number,
): Promise<Version> {
  for (let index = at.skip.length - 1; index >= 0; index--) {
    if (at.skip[index] === 0) continue;
    const far = await readVersion(at.skip[index]);
    if (far.rows > keep) return far;
  }
  return readVersion(at.parent);
}
