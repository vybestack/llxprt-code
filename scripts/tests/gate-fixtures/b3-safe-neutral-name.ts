/**
 * b3-safe-neutral-name.ts — Finding #3 false-positive guard.
 *
 * Declares local variables with NEUTRAL names (not banned response names).
 * Must NOT be flagged.
 */

export const NeutralResponse = { blocks: [{ type: 'text', text: 'ok' }] };

export class NeutralContent {
  blocks: unknown[] = [];
}

export function processContent(): unknown {
  return NeutralResponse;
}
