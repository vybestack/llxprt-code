# Plan: Remove confirmed dead code and dependencies from CLI/server/integration packages

Plan ID: PLAN-20260914-ISSUE2235-REMOVAL
Issue: #2235 (Remove confirmed dead code and dependencies from CLI/server/integration packages)
Inventory: `project-plans/issue2232-dead-code-inventory.md` (checked in via PR #3313)
Generated: 2026-09-14
Deliverable type: Pure removal / test-support removal / dependency-declaration
cleanup for the #2235 package family. No new behavior is added.

## Accepted behavior

1. Every inventory row whose candidate lives in the #2235 package family
   (packages/cli, packages/agents, packages/a2a-server, packages/ide-integration,
   packages/vscode-ide-companion, packages/test-utils) is either removed or
   explicitly retained with a written reason, after rechecking the candidate
   against current source per the inventory disposition workflow.
2. Production dead code and test-support removal stay in two separately labeled
   work streams (inventory REQ-INV-003). No test-support removal is used as
   evidence that a production path is dead.
3. Dependency declarations proven unreached by any source, dynamic, script,
   export, build, or bundle target are removed from the manifests, and both
   maintained lockfiles (`package-lock.json` via npm, `bun.lock` via bun) are
   updated.
4. Live behavioral and contract test coverage is preserved: tests are deleted
   only when no production contract remains for them; tests that merely
   consumed a removed surface are updated, not deleted.
5. The full repository verification cycle and the `stepfun-37` CLI smoke pass
   (CLI behavior and packaging are touched).

## Source recheck results (2026-09-14, branch issue2235 off main @ e5ec3a161)

Recheck method per inventory disposition workflow step 2: word-boundary source
grep across all packages/scripts/integration-tests, import-path grep, command
registration check (`BuiltinCommandLoader` imports and `'/lsp'` name search),
JSX composition check for components, export-map check, and dependency usage
grep across ts/tsx/js/cjs/mjs/yaml/toml/Makefile. Every row below was rechecked;
rows whose current-source state contradicts the inventory are marked SUPERSEDED
and retained.

### Work stream A: production dead code deletion (pure deletions)

| # | Candidate | Recheck evidence | Action |
|---|---|---|---|
| A1 | cli `src/ui/components/AuthInProgress.tsx` | only self-reference in repo (word-boundary) | delete |
| A2 | cli `src/ui/components/RawMarkdownIndicator.tsx` | only self-reference | delete |
| A3 | cli `src/ui/components/SecureKeyInput.tsx` | only self-reference | delete |
| A4 | cli `src/ui/components/StatusDisplay.tsx` | only self-reference (word-boundary; `HookStatusDisplay` and Footer hits are unrelated symbols) | delete |
| A5 | cli `src/ui/components/ProfileCreateWizard/NavigationMenu.tsx` | only self-reference; `ProfileCreateWizard/index.tsx` does not import it; wizard itself is live via `DialogManager` | delete component only |
| A6 | cli `src/ui/hooks/useSession.ts` | only self-reference | delete |
| A7 | cli `src/ui/hooks/useRefreshMemoryCommand.ts` | zero references anywhere | delete |
| A8 | cli `src/ui/hooks/useShowMemoryCommand.ts` | zero references anywhere | delete |
| A9 | cli `src/ui/constants/tips.ts` | `INFORMATIVE_TIPS` referenced nowhere else; `phrasesCollections.ts` (live via usePhraseCycler/useLoadingIndicator/schema-ui/schema-tail) is NOT part of this row and stays | delete |
| A10 | agents `src/core/messageStreamModelInfo.ts` | zero references anywhere; live sibling `src/core/modelInfoHelpers.ts` stays | delete |

Already removed since the inventory (no action, documented): cli
`CloudFreePrivacyNotice`, cli `renderLoopDetector`.

### Work stream B: test-support removal (modules + their obsolete tests; live tests updated)

| # | Candidate | Recheck evidence | Action |
|---|---|---|---|
| B1 | cli `src/config/auth.ts` + `src/config/auth.test.ts` | only export is `validateAuthMethod`; sole consumer is its own test; no import-path references | delete both |
| B2 | cli `src/ui/commands/lspCommand.ts` + `lspCommand.test.ts` | not imported by `BuiltinCommandLoader`; no `'/lsp'` registration anywhere in cli src; sole consumer is its own test | delete both |
| B3 | cli `src/utils/commentJson.ts` + `commentJson.test.ts` | local wrapper; production `src/config/settings.ts` imports npm `comment-json` directly; sole consumer is its own test | delete both |
| B5 | cli `src/ui/hooks/useKittyKeyboardProtocol.ts` + its unit test | production `InputPrompt.tsx` does not import it; 7 InputPrompt test files mock it | delete hook + unit test; drop import/mock usage from the 7 InputPrompt tests (tests stay) |
| B6 | cli `src/ui/hooks/useRewind.ts` + `useRewind.test.ts` | only self-references | delete both |
| B7 | cli `src/ui/hooks/useStableCallback.ts` + `useStableCallback.test.ts` | only self-references | delete both |
| B8 | cli `src/ui/hooks/useStaticHistoryRefresh.ts` + its unit test | production `AppContainer.tsx` does not import it; 3 AppContainer test files `vi.mock` it | delete hook + unit test; drop mock blocks from the 3 AppContainer tests (tests stay) |
| B9 | agents `src/core/bucketFailoverIntegration.ts` + `src/core/__tests__/bucketFailoverIntegration.spec.ts` | zero production consumers repo-wide; live bucket-failover production surface is `providers/src/runtime/bucketFailover.ts` (export-mapped) plus core `configBaseCore.ts` handler wiring; spec tests the dead module itself | delete both |
| B10 | agents `src/core/compression-config.ts` + `src/core/__tests__/compression-config.test.ts` | no production consumer; `compression-config.test.ts` tests the dead module. `compression.test.ts` and `compression-logic.test.ts` are LIVE tests of production `client.js#findCompressSplitPoint` that import one constant (`COMPRESSION_PRESERVE_THRESHOLD`) from the dead module | delete module + config test; update the two live tests to use a locally defined threshold constant, coverage unchanged |
| B11 | agents `src/core/contentBlockHelpers.ts` | thin re-export barrel of core `generateContentResponseUtilities.js`; sole consumer is the live `blockHelpers.characterization.test.ts` | delete barrel; repoint the characterization test imports to the core module directly (test stays) |
| B12 | agents `src/core/tokenUsageTestAssertions.ts` | production-shaped assertion helpers; sole consumer is the live `tokenUsageSwitch.test.ts` | inline the assertions into the test file and delete the module (test stays); if inlining degrades readability, fallback: retain and document |

### Work stream C: dependency declarations

| # | Candidate | Recheck evidence | Action |
|---|---|---|---|
| C1 | `gradient-string` in root `package.json` and `packages/cli/package.json` | zero source/script/bundle/config references repo-wide | remove both declarations |
| C3 | `fast-check` in `packages/ide-integration/package.json` devDependencies | no ide-integration source or test import. (auth/policy `fast-check` rows are out of the #2235 family and stay untouched.) | remove declaration |
| C4 | `npm-run-all` in `packages/vscode-ide-companion/package.json` devDependencies | `watch` script invokes `npm-run-all2`, which is neither declared nor installed (watch is broken today); `npm-run-all` itself is referenced by nothing | replace declaration with `npm-run-all2` so the existing script resolves; verify binary resolution and a short watch invocation |
| C5 | `@vybestack/llxprt-code-storage` in `packages/test-utils/package.json` dependencies | zero references in test-utils source | remove declaration |
| C6 | lockfiles | both `package-lock.json` and `bun.lock` are actively maintained (last touched together in 95044174b) | regenerate both after manifest edits: npm (root `packageManager` npm@11.6.2) and `bun install` (plain, never `--frozen-lockfile`) |

### Retained candidates (documented reasons; inventory rows superseded or ambiguous)

| Candidate | Reason retained |
|---|---|
| `@xterm/headless` in root `package.json` (former C2) | packed-CLI requirement — packages/core source ships inside the published root package and its direct @xterm/headless import resolves via the root dependency declaration in consumer installs (Node Consumer Smoke CI evidence, PR #3674). Restored root spec `5.5.0`; packages/core's own declaration was never touched. |
| cli `src/services/cliCommandApiMap.ts` | Sole consumer is the live command-map completeness CONTRACT test (`commandApiMapCompleteness.test.ts`, #2203/REQ-021 boundary map) which validates every registered command against the combined map. The contract is current (CONFIG_GATED_COMMANDS matches live commands). Not an obsolete implementation-specific test. |
| agents `src/core/chatSession-tokenSync-helpers.ts` | SUPERSEDED: production `src/core/chatSession.ts` imports `createTokenUsageLogger` from it. The inventory's test-only classification no longer holds. |
| agents `src/core/chatSession-runtime-helpers.ts` | Test factory consumed by ~10 live chatSession/ConversationManager behavioral tests. Removing it would force rewriting live behavioral tests (out-of-scope refactor). |
| agents `src/core/chatSession-thinking-helpers.ts` | Consumed by 2 live thinking-toolcalls behavioral tests. Same reasoning as above. |
| cli `src/utils/privacy/PrivacyManager.ts` + `src/ui/commands/privacyManager.test.ts` (former B4) | consumer survives: test-scripts/privacy-validation.ts (manual privacy-compliance QA script) imports and constructs it; inventory row superseded. Restore module and unit test. |
| cli `src/utils/privacy/ConversationDataRedactor.ts` | Not an inventory row; consumed by its own unit test and `test-scripts/privacy-validation.ts:15`. The two logging tests define their own mocks rather than consuming this module. |
| cli ProfileCreateWizard (minus NavigationMenu), ui/privacy notices, `ink`/`tinygradient`/`fzf`, a2a-server `src/http/server.ts`, vscode `extension.ts`/`@dqbd/tiktoken` | Inventory false positives; verified live (DialogManager render paths, direct imports, start-script/metadata entrypoints, esbuild resolution). |
| cli/agents `src/test-utils`, cli package-root `test-utils`, test preloads | Retained test infrastructure (inventory assigns to #3296). |

## Out of scope

- providers/core/tools/mcp family rows (#3293, #3294-core-part, #3296, #3298),
  including providers `retryFailoverLogic.ts` dead row.
- auth/policy `fast-check` (not in the #2235 family).
- Any new candidate not in the inventory (e.g. further ConversationDataRedactor
  triage, `phrasesCollections` consolidation).
- Any behavior change, refactor of live modules, or test rewrite beyond what
  removal requires.
- Loosening lint/typecheck/complexity rules.

## Requirements

- REQ-1: All removals in work streams A/B/C land with the evidence above
  traceable in the PR body.
- REQ-2: Live behavioral tests that consumed removed surfaces
  (InputPrompt tests, AppContainer tests, compression tests, blockHelpers
  characterization, tokenUsageSwitch) still pass after being updated; no live
  test is deleted.
- REQ-3: Obsolete implementation-specific tests (B1, B2, B3, B6, B7, B8
  unit tests, B9 spec, B10 compression-config test) are deleted together with
  their modules.
- REQ-4: Both lockfiles updated; `npm-run-all2` resolves and the vscode watch
  script starts (short-lived verification, then killed).
- REQ-5: Verification cycle green: package-level tests/lint/typecheck/build for
  touched workspaces, then repo `npm run test`, `lint`, `typecheck`, `format`,
  `build`, and `bun scripts/start.ts --profile-load stepfun-37 "write me a haiku
  and nothing else"`.

## Verification

1. Touched-workspace package checks: cli, agents, ide-integration,
   vscode-ide-companion, test-utils (test/lint/typecheck/build where defined).
2. Full repository verification cycle (REQ-5 command list).
3. CLI smoke (stepfun-37) since CLI behavior/packaging is touched.
4. Dependency evidence: post-install `node_modules/.bin/npm-run-all2` resolves;
   root/CLI `gradient-string` declarations gone from both lockfiles;
   root `@xterm/headless` restored at `5.5.0` in both lockfiles;
   `bun install` exit 0 with all workspaces resolving.
5. Formatting leaves no unrelated changes.

## Remediation evidence (2026-09-14)

PrivacyManager and its unit test were restored byte-for-byte from `e5ec3a161`.
The restored test first failed with a missing-module error before the module was
restored. Both relative imports in `test-scripts/privacy-validation.ts` now
resolve with Bun. No other deleted module is imported by that script.

### Reference-grep expectations

| Candidate | Expected references after remediation | Evidence |
|---|---|---|
| `PrivacyManager` | Nonzero; excluded from zero-reference removal checks | `test-scripts/privacy-validation.ts:16` imports it and line 265 constructs it; its unit test is retained. |
| `ConversationDataRedactor` | Nonzero; retained | Its own unit test and `test-scripts/privacy-validation.ts:15`; the logging tests define mocks. |

### Verification results

All logs below are under `tmp/issue2235/`.

- Full agents lifecycle: exit 0, declaration emission exit 0, API-surface snapshot
  matches, 409/409 test files pass, then 7/7 isolated native Bun files pass.
  Summed test summaries report 4,563 passes and zero failures
  (`agents-test-rerun.log`, `agents-test-final.exit`). A clean-base pretest
  comparison was not needed because pretest passed. An earlier run overlapping
  dependency installation had two module-resolution failures; its log is
  preserved as `agents-test-during-install.log`. The successful run started
  after both installs finished.
- Four modified agents files plus restored privacy unit test: 41 pass, 0 fail,
  668 expectations (`agents-modified-files.log`).
- Plain `bun install` refreshed the stale nested snapshots without manual edits.
  Both initial and final installs exited 0. Final checks found two target
  ide-integration records with zero stale fast-check declarations and four
  target test-utils records with zero storage dependencies
  (`lock-verification.log`).
- `npm install --package-lock-only` exited 0. Both lockfiles resolve
  `npm-run-all2` 8.0.4; the manifest requests `^8.0.4`. The npm lock records
  Node `^20.5.0 || >=22.0.0` and npm `>= 10`, with no 9.x runner remaining.
- Watch proof (`watch-rerun.log`): `npm-run-all2 -p watch:*` launched
  `watch:tsc` and `watch:esbuild`; esbuild finished and TypeScript reported
  `Found 0 errors. Watching for file changes.` No EBADENGINE occurred.
  The bounded 90-second run ended with expected timeout status 124.
- Compression comments now describe the preserved test fraction
  `2 * (1 - 0.85)` accurately. Contrary to the remediation request's premise,
  `client.ts:50-53` only re-exports the helper, with no production call there;
  `clientHelpers.ts:25-28` requires an explicit fraction. Constants and
  assertions are unchanged.
- `npm run lint:eslint-guard` exited 0. Targeted TypeScript and manifest
  formatting checks passed; `git diff --check` was clean.

- Smoke check: `bun scripts/start.ts --profile-load stepfun-37 "write me a haiku and nothing else"`
  (the documented smoke profile). Result: BLOCKED externally. The StepFun
  subscription was cancelled (2026-09-13); the run returned HTTP 400
  "you have no active step plan subscription".
  Evidence log: `tmp/issue2235/smoke.log` (gitignored, local-only).
  Disposition: no provider/profile substitution was made per house rules;
  to be re-run when a supported profile is available.

These checks supplement the earlier verification
rather than claim a new full-repository verification cycle.
