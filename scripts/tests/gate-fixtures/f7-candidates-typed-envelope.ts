/**
 * f7-candidates-typed-envelope.ts — Finding #3 adversarial FAIL fixture.
 *
 * Declares a variable explicitly typed with a candidates-bearing response
 * envelope type annotation, where the initializer is a function call
 * (not an inline object literal). This must be detected by F7.
 */

declare function getResponse(): { candidates: unknown[] };

export function useResponse(): unknown {
  const x: { candidates: unknown[] } = getResponse();
  return x.candidates;
}
