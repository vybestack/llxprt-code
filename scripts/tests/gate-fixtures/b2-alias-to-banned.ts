/**
 * b2-alias-to-banned.ts — Finding #3 adversarial FAIL fixture.
 *
 * Imports a symbol aliased TO a banned legacy name from a NON-banned module.
 * The source module is neutral, but the local alias name IS a banned Google
 * response type name. This is a source-swap bypass vector.
 */

import { someNeutralThing as GenerateContentResponse } from 'some-neutral-module';

export function useAlias(resp: GenerateContentResponse): unknown {
  return resp;
}
