/**
 * f6-safe-domain-destructure.ts — Finding #3 false-positive guard.
 *
 * Destructures `parts` from a NON-Google-shaped domain object. Must NOT be
 * flagged because the source value has no Google Content provenance.
 */

export function countWheels(): number {
  const domain = { parts: ['wheel', 'tire'] };
  const { parts } = domain;
  return parts.length;
}
