/**
 * b-safe-neutral-blocks-union.ts — Finding #2 false-positive guard.
 *
 * Uses NEUTRAL names (ContentBlock[], not PartUnion). Must NOT be flagged.
 * This proves the gate keys on the banned Google name, not on any
 * "union" suffix.
 */

export type MyBlockUnion = string | { type: 'text'; text: string };

export function useBlocks(blocks: MyBlockUnion[]): unknown {
  return blocks;
}
