/**
 * b3-local-banned-decl.ts — Finding #3 adversarial FAIL fixture.
 *
 * Declares a local variable using a banned legacy response name. Even though
 * there is no import from a banned module, the local name shadows the banned
 * Google type — a #2424 re-introduction vector.
 */

export const GenerateContentResponse = (candidates: unknown[]): unknown => ({
  candidates,
});
