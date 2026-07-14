/**
 * b3-local-partunion-decl.ts — Finding #2 adversarial FAIL fixture.
 *
 * Declares a local type alias using the banned payload name `PartUnion`.
 * Even without an import from a banned module, the local name shadows
 * the Google payload shape — a #2424 re-introduction vector.
 */

export type PartUnion = string | { text: string } | { inlineData: unknown };

export function useLocal(p: PartUnion): unknown {
  return p;
}
