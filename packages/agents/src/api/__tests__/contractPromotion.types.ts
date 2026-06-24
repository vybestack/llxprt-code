/**
 * @plan:PLAN-20260621-COREAPIREMED.P15
 * @requirement:REQ-004,REQ-006
 *
 * Compile-only type assertions for the AgentClientContract type-surface promotion.
 *
 * This file is named with a ".types.ts" suffix (no ".test" / ".spec" infix) so
 * the workspace tsconfig compiles it under tsc --noEmit. The tsconfig exclude
 * list drops only files with a ".test.ts" or ".spec.ts" suffix. It is excluded
 * from the shipped build by tsconfig.build.json (which excludes the __tests__
 * directory tree) and is not run by vitest (whose default matcher targets files
 * with a ".test." or ".spec." segment). All runtime assertions live in the
 * sibling nonBreaking.exports.test.ts file.
 *
 * The contract is imported from the curated package ROOT specifier
 * (resolved via the curated api barrel), not via a deep core or internals path.
 *
 * RED state (this phase): the curated barrel does not yet re-export
 * AgentClientContract, so the import below raises TS2305 — the legitimate
 * type-surface RED form. P16 adds the "export type" re-export, after which this
 * file compiles clean (GREEN).
 */

import type { AgentClientContract } from '@vybestack/llxprt-code-agents';

// Compile-time helpers. Each is consumed by the exported assertion below so that
// noUnusedLocals (root tsconfig) does not raise TS6196.
type Expect<T extends true> = T;
type HasKeys<T, K extends string> = K extends keyof T ? true : false;

// Structural assertion: the contract surfaced via the curated root barrel has
// every member enumerated from core clientContract.ts (lines 67-118).
// "export type" (not bare "type") is REQUIRED: a non-exported alias trips
// TS6196 "declared but never used" which would linger after P16 and keep
// typecheck RED forever.
export type _AssertContractMembers = Expect<
  HasKeys<
    AgentClientContract,
    | 'getCurrentSequenceModel'
    | 'getChat'
    | 'getHistory'
    | 'getHistoryService'
    | 'getUserTier'
    | 'dispose'
    | 'startChat'
  >
>;
