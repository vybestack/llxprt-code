# P01 implementation evidence

## Red tests before implementation

Command: `bun test packages/agent-core/src/definition.test.ts scripts/tests/agent-core-import-boundary.test.ts`

Result: 26 passed, 11 failed. Failures reproduced: unresolved import edge; import-equals Node import; computed/global process access; inert/shadowed `process` and `console` false positive; external helper barrel traversal; descriptor-safe definition and JSON validation; authority allow combined with missing structure; undefined usage overwrite; cache subset in `validateUsageReport`; URL userinfo/query credentials and opaque identities; empty shell argv argument; and abort handling in fake ports. Replay/accounting MemorySessionStore round-trip passed.

Red test names included `rejects every unresolved import edge`, `rejects import-equals syntax for Node builtins`, `rejects Node global aliases including computed process access`, `does not flag inert capability property names or shadowed identifiers`, `rejects helper barrels and unapproved external runtime exports`, `rejects executable, accessor-backed, symbol-keyed, hidden, cyclic, and non-finite data without invoking getters`, `reports authority allow with independent structural definition errors`, `keeps measured usage when a later counter is explicitly undefined and enforces cache subsets`, `validates credential-bearing URL components while preserving opaque identities`, `accepts an empty non-command argument in validated shell facts`, and `exercises fake port state transitions and abort handling`.

## Finding-to-test coverage

1. Import traversal fails closed for unresolved edges and disallowed runtime/workspace imports. Red cases cover unresolved relative and import-equals edges, Node import-equals, CommonJS require, dynamic import, unapproved installed packages, helper barrels, and path aliases.
2. Capability analysis catches direct and computed `global` process access and `globalThis`, while accepting inert property names and locally bound `process` or `console`. Each added boundary case has an individual test in `scripts/tests/agent-core-import-boundary.test.ts`.
3. Definition and JSON replay validation reject executable values, accessors without invoking them, symbols, non-enumerable properties, cycles, and non-finite numbers. Replay and recovery validators also reject executable payloads.
4. `reports authority allow with independent structural definition errors` checks that authority errors are returned alongside unrelated schema errors.
5. Accessor-safe plain-data checks apply to both definitions and replay/recovery data. Tests include getter call counts and public replay/recovery validation.
6. `keeps measured usage when a later partial report omits` checks partial usage merging does not erase measurements.
7. `rejects full usage when cache counters exceed input tokens` and the cache-subset cases check `validateUsage` and report validation.
8. `validates credential-bearing URL components while preserving opaque identities` checks URL userinfo, query and fragment credentials, and opaque principal/connection identifiers.
9. `accepts an empty non-command argument in validated shell facts` allows empty later argv values while requiring a non-empty command.
10. Coverage includes `round-trips replay and accounting records through MemorySessionStore`, behavioral fake-port routing/revocation/state/abort tests, `rejects invalid budgets, compaction ratios, and output cap relationships`, and negative compile fixtures for an added `AfterTurnView` callback and executable recovery data. The `STRUCTURE_ONLY` test was removed. Test-audit reports no findings for the agent-core test files.
11. `valid-content-unions.ts` provides positive image and audio extraction fixtures; `ContentPart` retains separate image and audio members.
12. `ToolPattern` and `ToolCall` are exported named types and used by their contracts. Unused `UnsubscribeCatalog` and `ClockPort` aliases were removed.

## Green verification before follow-up review fixes

- Focused agent-core and boundary suite: `bun test packages/agent-core/src/*.test.ts scripts/tests/agent-core-import-boundary.test.ts` passed, 52 tests and 700 expectations.
- Boundary suite after the import-scanner lint refactor: `bun test scripts/tests/agent-core-import-boundary.test.ts` passed, 21 tests and 25 expectations.
- `npm run build`: passed.
- `npm run typecheck`: passed after the final import-scanner changes.
- `npm run lint`: passed after splitting complex scanner predicates.
- Prettier check on changed TypeScript and fixture files: passed.
- `npm run build:types && npm run check:runtime-boundary`: passed.
- `npm run lint:agent-core-boundary`, `npm run lint:runtime-deps`, `npm run lint:test-shards`, and `npm run lint:affected-shards`: passed.
- All agent-core tests: passed. Release-process tests: 181 passed across 6 files.
- `bun scripts/test-audit/scan.ts /Volumes/XS1000/acoliver/projects/llxprt/branch-2/llxprt-code/tmp/p01/tmp/review/test-audit2`: completed with zero errors. The resulting findings file has no entries for `packages/agent-core/src` tests.
- `npm run test:scripts` ran under `nohup`, with 364 of 365 isolated Bun test files passing. The single failure was the unrelated `bun-script-migration.test.ts` filesystem scan exceeding its existing 15-second timeout under the full-run workload. The same full test file passed standalone, 139 tests in 2.16 seconds, and the scan itself completed in 1.13 seconds. No timeout or assertion was changed.
- `npx prettier --check` on all changed source, test, fixture, and evidence files: passed. `git diff --check HEAD`: passed.

## Follow-up review findings 1, 2, 8, and 10

### Red tests before these fixes

- **Finding 1:** The pure-ESM/CommonJS-Zod fixture failed because `import z = require('zod')` passed without finding the CommonJS entry's `node:fs` require.
- **Finding 2:** The `declare const process` fixture failed because the scanner accepted the ambient declaration as a runtime local binding.
- **Finding 8:** Query and fragment URLs containing `accessToken=abc` failed credential validation by being accepted.
- **Finding 10:** The reviewer's in-memory `AfterTurnView.callback` mutation removed the callback's TS2353, while the old file-wide code checks remained true.

### Fix verification

- `bun test scripts/tests/agent-core-import-boundary.test.ts`: 24 passed, 0 failed. Includes the CommonJS condition, ambient declaration, real local bindings, inert properties, and individually asserted boundary fixtures.
- `bun test packages/agent-core/src/definition.test.ts`: 29 passed, 0 failed. Includes query and fragment `accessToken`, separator and case variants, and opaque identities.
- `bun test packages/agent-core/src/fake-ports.test.ts`: 2 passed, 0 failed.
- `bun run tmp/diagnostic-mutation.ts`: the in-memory addition of optional `callback` removed the expected callback TS2353. The marker-specific diagnostic count was 0, so the revised assertion fails as intended.

The type fixture's repeated imports were merged. Each of its four expected diagnostics is tied to a distinct inline marker and diagnostic code. The boundary import fixture checks each source file and expected violation kind independently.

### Reviewer probes

- `tmp/review2/follow-up-probes.ts`: import-equals alias, global aliases, ambient `declare const process`, and Zod `require`-condition variants reject. The Zod violation points to `node_modules/zod/io.cjs` and its `node:fs` import.
- `tmp/review2/regression-compare.ts`: the Zod require-condition result changes from accepted to rejected. Both `accessToken` query and fragment cases reject. Runtime confirmation reports a function for the CommonJS entry. Opaque principal `secretary-1` remains accepted in `tmp/review2/probe.ts`.
- The reviewer diagnostic probe shows that adding optional `callback` removes its TS2353. The marker-specific in-memory mutation independently confirms that the revised test detects the missing error.

Final probe logs are in `tmp/follow-up-final.log` and `tmp/regression-compare-final.log`.

### Final checks

- `npm run build`: passed.
- `npm run typecheck`: passed.
- `npm run lint`: passed.
- Prettier check on the five changed TypeScript files: passed.
- `npm run lint:agent-core-boundary`: passed.
- `npm run build:types && npm run check:runtime-boundary`: passed.
- `git diff --check`: passed.
