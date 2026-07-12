/**
 * b-partunion-import.ts — Finding #2 adversarial FAIL fixture.
 *
 * Imports the banned Google payload symbol `PartUnion` from a banned module
 * (@google/genai). PartUnion is a Google-shaped union type for Part
 * payloads — its import signals direct structural dependency on Google
 * wire types. Must be flagged by checkB.
 */

import type { PartUnion } from '@google/genai';

export function usePartUnion(p: PartUnion): unknown {
  return p;
}
