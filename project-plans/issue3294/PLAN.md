# Plan: Remove confirmed dead core and agents migration leftovers

Plan ID: PLAN-20260914-ISSUE3294
Generated: 2026-09-14
Issue: #3294 (Parent: #2232)
Work streams: two separately labeled streams, kept separate in commits and the PR:

1. **WS1 — Production deletion**: confirmed duplicate or unreferenced core and
   agents modules.
2. **WS2 — Test-support removal**: production-shaped helpers and services whose
   only consumers are tests, split into (a) obsolete implementation-specific
   tests deleted with their module, and (b) retained behavior tests preserved by
   redirecting imports to the authoritative source or relocating load-bearing
   fixtures into the test tree.

Inventory source: `project-plans/issue2232-dead-code-inventory.md` rows assigned
to #3294. Per that inventory's disposition workflow step 2, every row was
rechecked against current source on 2026-09-14 before acceptance. Three rows are
stale and are documented below as verified non-removals.

## Phase 0.5 — Preflight verification (completed 2026-09-14)

### Current-source recheck evidence

| Candidate | Inventory claim | Current-source recheck | Disposition |
|---|---|---|---|
| `packages/agents/src/core/messageStreamModelInfo.ts` | definitely dead | exists; zero importers in `packages/` (repo-wide grep finds only historical `project-plans/` docs); `modelInfoHelpers.ts` is the survivor imported by `client.ts` and `MessageStreamOrchestrator.ts` | REMOVE (WS1) |
| `packages/core/src/utils/gitLineChanges.ts` | definitely dead | exists; zero importers anywhere; tools-owned `packages/tools/src/utils/gitLineChanges.ts` is imported by `tools/src/tools/read-file.ts` and `read_line_range.ts` | REMOVE (WS1) |
| `packages/core/src/utils/llm-edit-fixer.ts` | definitely dead | file absent — already deleted in #2627; zero references remain under `packages/` (comment in `clientContract.ts` and allowlist string both already gone) | NO ACTION; document as completed by #2627 |
| `packages/core/src/code_assist/oauth-credential-storage.ts`, `setup.ts` | test-only | files absent — already removed elsewhere | NO ACTION |
| `packages/core/src/storage/SessionPersistenceService.ts` | test-only | **STALE**: now has production consumers — `core/src/config/configBaseCore.ts`, `core/src/recording/RecordingIntegration.ts`, `core/src/storage/session-media-service-factories.ts`, `core/src/storage/session-persistence-helpers.ts` | RETAIN; documented drift |
| `packages/agents/src/core/bucketFailoverIntegration.ts` | test-only | zero production importers; only consumer is `agents/src/core/__tests__/bucketFailoverIntegration.spec.ts`, which tests this module itself. Production bucket failover is a different implementation: `providers/src/auth/token-bucket-failover-helper.ts` + `auth-flow-orchestrator.ts` register a `BucketFailoverHandler` via `config.setBucketFailoverHandler`, consumed by `agents/src/core/StreamProcessor._handleBucketFailover`. Nothing registers the agents-module implementation | REMOVE module + obsolete spec (WS2) |
| `packages/agents/src/core/compression-config.ts` | test-only | zero production importers. Production `findCompressSplitPoint` (`agents/src/core/clientHelpers.ts`, re-exported by `client.ts`) takes `fraction` as a parameter; production compression config lives in `agents/src/compression/`. Consumers: `__tests__/compression-config.test.ts` (tests the module itself — obsolete) and `__tests__/compression.test.ts` + `__tests__/compression-logic.test.ts` (living behavior tests of `findCompressSplitPoint`). Note: the deleted constant evaluated to `2 * (1 - 0.85)` ≈ 0.3, not 0.5; the surviving tests use 0.5 as their selected sample fraction (their assertions are bounds-based, and both fractions yield the same split index) | REMOVE module + obsolete test; redirect the two living tests to an explicit local 0.5 sample fraction (WS2) |
| `packages/agents/src/core/contentBlockHelpers.ts` | test-only | zero production importers; a pure re-export shim over `@vybestack/llxprt-code-core/utils/generateContentResponseUtilities.js`. Sole consumer `__tests__/blockHelpers.characterization.test.ts` is a living characterization test | REMOVE shim; redirect test import to core (WS2) |
| `packages/agents/src/core/chatSession-tokenSync-helpers.ts` | test-only | **PARTIALLY STALE**: `createTokenUsageLogger` is production (imported by `chatSession.ts:9`, called at `chatSession.ts:294`). Remaining exports (`createTokenSyncTestFixture`, `MockContentGenerator`, `TokenSyncTestFixture`, `providerRuntime` re-export) are test-only, consumed by 4 living tests. No test imports anything besides `createTokenSyncTestFixture`; production imports only `createTokenUsageLogger`. Side effect of current shape: production `chatSession.ts` transitively imports `bun:test` and `core/test-utils/runtime.js` through this module | SPLIT: move production factory into `TokenUsageLogger.ts`, relocate fixture to `__tests__/helpers/`, delete module (WS2) |
| `packages/agents/src/core/tokenUsageTestAssertions.ts` | test-only | zero production importers; sole consumer `agents/src/core/tokenUsageSwitch.test.ts` is a living behavior test of token-usage log switching | RELOCATE to `__tests__/helpers/` (WS2) |
| `packages/agents/src/core/chatSession-runtime-helpers.ts`, `chatSession-thinking-helpers.ts` | test-only | **STALE as removal targets**: consumed only by tests, but those are living ChatSession behavior tests (`chatSession.runtime.streaming/history/timeout.test.ts`, `chatSession.thinking-toolcalls.test.ts`, `directMessage.characterization.test.ts`, etc. — 12+ files). Issue WS2 authorizes removal only for support consumed by obsolete implementation-specific tests | RETAIN; documented drift |

### Reachability checks (all candidates)

- No `packages/*/package.json` export map references any candidate
  (`agents` has 4 export entries, none relevant; `core`/`tools` maps checked).
- No barrel (`agents/src/index.ts`, `internals.ts`) re-exports any candidate.
- Repo-wide grep finds no script, bundle, or integration-test references;
  remaining hits are historical `project-plans/` analysis documents and one
  tracked historical test-run log
  (`packages/core/src/hooks/__tests__/test-run.log:311` mentions the old
  `bucketFailoverIntegration.spec.ts` name). Neither is an importer or build
  input; both are left untouched.
- `TokenUsageLogger.ts` is internal to `agents` (not exported, not referenced
  outside the package), so adding the relocated factory there changes no public
  surface.
- `__tests__/helpers/` is an established test-only location in
  `agents/src/core/__tests__/` (existing `directMessageObservers.ts`); bun's
  runner does not treat non-`.test.`/`.spec.` files there as tests.

## Accepted behavior (acceptance criteria)

Pure-deletion slices preserve existing behavior tests as their behavioral
evidence, per inventory disposition rule 3. No new production behavior is added.

### WS1 — Production deletion

- **AC-1** GIVEN `packages/agents/src/core/messageStreamModelInfo.ts` has zero
  importers, WHEN it is deleted, THEN `packages/agents` typecheck/lint/tests
  pass and `MessageStreamOrchestrator.modelinfo.test.ts` (which covers the
  surviving `modelInfoHelpers.ts` used by `client.ts` and
  `MessageStreamOrchestrator.ts`) still passes, and
  `grep -rn "messageStreamModelInfo" packages/` returns zero hits.
- **AC-2** GIVEN `packages/core/src/utils/gitLineChanges.ts` has zero importers
  and the tools-owned implementation is the one used by `read-file.ts` and
  `read_line_range.ts`, WHEN the core copy is deleted, THEN `packages/core` and
  `packages/tools` typecheck/tests pass. Existing git-change marker/legend
  rendering coverage lives in
  `tools/src/tools/line-range-tools-issue3036.bun.test.ts` (the direct-API test
  does not enable `showGitChanges`), and
  `grep -rn "gitLineChanges" packages/core/src` returns zero hits.
- **AC-3** `llm-edit-fixer.ts` removal (inventory row) is verified already
  complete via #2627: file absent, zero references under `packages/`. No code
  change; documented here and in the PR.

### WS2 — Test-support removal

- **AC-4** GIVEN `bucketFailoverIntegration.ts` implements a provider-failover
  path that no production code registers (production failover is the providers'
  token-bucket handler wired through `config.setBucketFailoverHandler`), WHEN
  the module and its implementation-specific spec
  `__tests__/bucketFailoverIntegration.spec.ts` are deleted, THEN agents
  typecheck/tests pass and no executable-source or configuration references
  remain under `packages/` (a tracked historical test-run log mentioning the
  old spec name is not a reference of consequence and stays untouched).
- **AC-5** GIVEN `compression-config.ts` is a test-only constants module whose
  own test is obsolete, WHEN module and `__tests__/compression-config.test.ts`
  are deleted, THEN the living tests `__tests__/compression.test.ts` and
  `__tests__/compression-logic.test.ts` are preserved with an explicit local
  `COMPRESSION_PRESERVE_THRESHOLD = 0.5` sample fraction (the deleted constant
  evaluated to ≈0.3; the surviving assertions are bounds-based and pass under
  either fraction), and both still pass.
- **AC-6** GIVEN `contentBlockHelpers.ts` is a pure re-export shim over core
  utilities, WHEN it is deleted, THEN
  `__tests__/blockHelpers.characterization.test.ts` imports
  `getToolCallBlocks`, `getResponseTextFromBlocks`, and
  `analyzeResponseOutcome` directly from
  `@vybestack/llxprt-code-core/utils/generateContentResponseUtilities.js` and
  still passes.
- **AC-7** GIVEN `chatSession-tokenSync-helpers.ts` mixes one production
  factory with test fixtures, WHEN it is deleted, THEN:
  - `createTokenUsageLogger` lives in `agents/src/core/TokenUsageLogger.ts`
    (verbatim logic), `chatSession.ts` imports it from there, and no
    `bun:test` / `core/test-utils` import is reachable from the production
    `chatSession.ts` module graph;
  - the fixture (`createTokenSyncTestFixture` + its types) lives in
    `agents/src/core/__tests__/helpers/tokenSyncTestFixture.ts` with behavior
    unchanged;
  - the four consuming tests (`chatSession.tokenSync.test.ts`,
    `chatSession.tokenSync.nonstream.test.ts`,
    `TokenUsageLogger.integration.test.ts`,
    `TokenUsageLogger.rawTiming.test.ts`) are updated and pass.
- **AC-8** GIVEN `tokenUsageTestAssertions.ts` is test support with a single
  living consumer, WHEN it is relocated to
  `agents/src/core/__tests__/helpers/tokenUsageTestAssertions.ts`, THEN
  `tokenUsageSwitch.test.ts` is updated and passes, and no production-shaped
  module remains at the old path.
- **AC-9** Verified non-removals (documented drift, no code change):
  `SessionPersistenceService.ts` (production consumers listed above),
  `chatSession-runtime-helpers.ts`, `chatSession-thinking-helpers.ts` (retained
  test support for living behavior tests; boundary forbids removing retained
  test support, and their consumers are not obsolete).
  Out-of-scope observation only: `subagent-test-helpers.ts`,
  `client-test-helpers.ts`, `chatSession-density-helpers.ts` (in `__tests__/`),
  `streamPipeline-characterization-helpers.ts`,
  `subagentOrchestrator-test-helpers.ts`, and
  `compression/MiddleOutStrategy-test-helpers.ts` are not inventory-confirmed
  for #3294 and are untouched.

### Global

- **AC-10** Two separately labeled work streams in commits and the PR body;
  test-support evidence is never cited as proof a production path is dead.
- **AC-11** Full repository verification cycle passes: `npm run test`,
  `npm run lint`, `npm run typecheck`, `npm run format`, `npm run build`, and
  `bun scripts/start.ts --profile-load stepfun-37 "write me a haiku and nothing else"`.
  External limitation recorded 2026-09-14: the smoke run boots the CLI through
  profile load, session construction, and request dispatch, but the provider
  rejects the call with HTTP 400 (inactive step plan subscription), so
  successful generation could not be established locally; startup health and
  the full local suite stand as the behavioral evidence.
- **AC-12** No package export-map targets, public interfaces, active
  model-info helpers, or the tools-owned git-line implementation are touched.
  No new `eslint-disable*`, `@ts-ignore`, `@ts-expect-error`, `@ts-nocheck`, or
  severity/threshold changes. No new `.js` files, no vitest/node tests.

## Implementation phases

Deletion phases are pure deletions or relocations; behavioral evidence is the
preserved/updated test suite, so no failing-test-first step applies (inventory
disposition rule 4 exempts pure deletions that remove no behavior).

- **P1 (WS1)**: delete `packages/agents/src/core/messageStreamModelInfo.ts`.
- **P2 (WS1)**: delete `packages/core/src/utils/gitLineChanges.ts`.
- **P3 (WS2)**: delete `bucketFailoverIntegration.ts` +
  `__tests__/bucketFailoverIntegration.spec.ts`.
- **P4 (WS2)**: delete `compression-config.ts` +
  `__tests__/compression-config.test.ts`; inline the 0.5 fraction in
  `__tests__/compression.test.ts` and `__tests__/compression-logic.test.ts`.
- **P5 (WS2)**: delete `contentBlockHelpers.ts`; redirect
  `__tests__/blockHelpers.characterization.test.ts` imports to core.
- **P6 (WS2)**: split `chatSession-tokenSync-helpers.ts` — move
  `createTokenUsageLogger` into `TokenUsageLogger.ts`; create
  `__tests__/helpers/tokenSyncTestFixture.ts` for the fixture; update
  `chatSession.ts` + 4 test imports; delete the original module.
- **P7 (WS2)**: relocate `tokenUsageTestAssertions.ts` to
  `__tests__/helpers/`; update `tokenUsageSwitch.test.ts`.
- **P8**: verification cycle (AC-11) and per-AC greps.

## Per-phase verification greps

- P1: `grep -rn "messageStreamModelInfo" packages/` → 0 hits.
- P2: `grep -rn "gitLineChanges" packages/core/src` → 0 hits; tools tests green.
- P3: `grep -rn "bucketFailoverIntegration" packages/` → 0 hits in executable
  source and configuration (the tracked historical `test-run.log` mention is
  the documented exception).
- P4: `grep -rn "compression-config" packages/agents/src` → 0 hits; both living
  compression tests green.
- P5: `grep -rn "contentBlockHelpers" packages/` → 0 hits.
- P6: `grep -rn "chatSession-tokenSync-helpers" packages/` → 0 hits;
  `grep -n "bun:test\|test-utils" packages/agents/src/core/TokenUsageLogger.ts`
  → 0 hits; tokenSync tests green.
- P7: `test ! -f packages/agents/src/core/tokenUsageTestAssertions.ts`;
  `tokenUsageSwitch.test.ts` green.

## Review policy

- Subagent review (deepthinker) with at most 2 rounds total (initial + 1
  remediation); findings classified Blocker-Fix / In-scope-Fix / Reject / Defer.
- OCR is not run for this effort (disabled until further notice per maintainer
  instruction); CI plus the subagent review cycle carry the review load.

## Failure recovery

`git checkout -- packages/ project-plans/issue3294/` on the issue branch; no
shared-state changes exist outside the working tree.
