/**
 * c-contract-partunion.ts — Finding #2 adversarial FAIL fixture.
 *
 * Imports the Contract* payload alias `ContractPartUnion` from a banned
 * module (geminiContent barrel). This is a #2424 aliasing bypass for the
 * PartUnion Google payload shape.
 */

import type { ContractPartUnion } from 'some-lib/geminiContent';

export function useContractPartUnion(p: ContractPartUnion): unknown {
  return p;
}
