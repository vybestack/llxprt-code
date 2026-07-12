/**
 * b2-alias-to-partunion.ts — Finding #2 adversarial FAIL fixture.
 *
 * Imports a symbol aliased TO the banned payload name `PartUnion` from a
 * non-banned module. The source module is neutral, but the local alias name
 * IS a banned Google payload name. Source-swap bypass vector.
 */

import { someNeutralThing as PartUnion } from 'some-neutral-module';

export function useAlias(p: PartUnion): unknown {
  return p;
}
