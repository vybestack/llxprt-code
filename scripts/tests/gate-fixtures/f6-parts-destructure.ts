/**
 * f6-parts-destructure.ts — Finding #3 adversarial FAIL fixture.
 *
 * Destructures `parts` from a response-shaped value (object literal with
 * role/parts — Google Content shape). This must be detected by F6.
 */

export function extractParts(): unknown {
  const response = { role: 'model', parts: [{ text: 'hi' }] };
  const { parts } = response;
  return parts;
}
