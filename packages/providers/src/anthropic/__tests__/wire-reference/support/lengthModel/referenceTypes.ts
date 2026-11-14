/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */

import { selectLastCacheableBlockIndex } from '../../../../AnthropicRequestBuilder.js';
import type { AnthropicMessageBlock } from '../../../../AnthropicMessageNormalizer.js';
import type { AtomFact, BlockFact } from './unitFacts.js';

/** A history the model does not cover; the reference machine refuses it. */
export class OutOfDomain extends Error {}

export interface Origin {
  readonly unit: number;
  readonly atom: number;
  readonly idx: number;
}

export interface OBlock {
  f: BlockFact;
  /** The block as the reference machine holds it now (cache_control may be added). */
  obj: AnthropicMessageBlock;
  origin?: Origin;
  anchored: boolean;
}

export interface OMsg {
  id: number;
  role: 'U' | 'A';
  text?: string;
  anchorText?: boolean;
  /** Media purge boundary identity carried by a string-content message. */
  purgeText?: object;
  blocks: OBlock[];
  ordered?: boolean;
  /** Atoms of units that make up this message, in order. */
  atoms: Array<{ unit: number; atom: number }>;
}

export interface Policy {
  reasoningEnabled: boolean;
  includeInContext?: boolean;
  strip?: 'none' | 'all' | 'allButLast';
}

/**
 * What the validators decided, per unit: blocks dropped, messages that
 * vanished and results inserted after an assistant message. In the product
 * these facts come from the converted-id occurrence index.
 */
export interface Overlay {
  drop: Set<string>;
  vanish: Set<number>;
  after: Map<number, AtomFact>;
}

export const emptyOverlay = (): Overlay => ({
  drop: new Set(),
  vanish: new Set(),
  after: new Map(),
});

export const dropKey = (atom: number, idx: number): string => `${atom}:${idx}`;

export function cacheable(obj: AnthropicMessageBlock): boolean {
  return selectLastCacheableBlockIndex([obj]) === 0;
}

export interface Assembled {
  msgs: OMsg[];
  nextId: number;
  /** Per unit: true when the unit was merged into a thinking chain. */
  chainContext: boolean[];
  /** Per unit: the redact flag its group used. */
  redacted: boolean[];
  dropped: boolean[];
}
