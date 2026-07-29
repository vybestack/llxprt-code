# Issue 2800: Restore the Windows nightly gates

## Policy basis

The issue requests `dev-docs/workflow/ISSUE-DELIVERY.md`, but that path does not
exist on `main`, anywhere in local git history, or through the GitHub contents API.
This plan therefore applies the complete bounded-delivery requirements quoted in
the issue body as the governing policy.

## Evidence summary

Nightly run `30341228279` at
`e5a5ae1c52205f8603dbc06f4a99cee931e2dc23` exposed three failure classes:

1. Windows product defects in synchronous durable publication and LSP file-URI
   construction.
2. Tests and fixtures that assert POSIX-only permissions, signals, inherited file
   descriptors, shell behavior, or path syntax under Windows.
3. A workflow timeout defect: the native-module smoke passes but reaches its
   15-minute job timeout. The Windows Vitest workload also repeatedly triggers a
   native libuv worker crash whose causal test or path remains to be isolated.

The failures are persistent rather than isolated: the seven nightly runs from
July 22 through July 28 show the same affected Windows jobs, and each Windows CI
log contains the same three native worker crashes.

## Acceptance matrix

| ID | Accepted behavior | Behavioral evidence | Required gate |
| --- | --- | --- | --- |
| A1 | Canonical profile repair replaces exactly one eligible corrupt profile on Windows, preserves its quarantine backup, and continues to surface real I/O errors. | Existing canonical repair and outcome suites pass without broad error handling. | Settings workspace tests and Windows `windows_ci`. |
| A2 | Memory reconciliation and migration markers publish durably on Windows without weakening archive, idempotency, lock, or marker semantics. | Existing reconciliation, migration, and profile-repair suites pass. | CLI workspace tests and Windows `windows_ci`. |
| A3 | POSIX owner-only mode guarantees remain tested on POSIX, while Windows still verifies creation, content, and exclusivity behavior. | Only the two POSIX mode assertions are platform-bounded. | Settings tests on Windows and POSIX. |
| A4 | LSP accepts native absolute Windows paths and generates valid file URIs, including its default root URI. | A test fails first for default root-URI conversion; all four LSP suites use native paths and pass. | LSP package tests and Windows `windows_ci`. |
| A5 | Source guards scan the same source set on every platform without new allowlist entries. | Provider deprecation and agent provider-neutral guards pass using Node/path-normalized scanning. | Provider and agent tests and Windows `windows_ci`. |
| A6 | Hook block, allow, modify, timeout, automatic-compression, and BeforeModel behavior executes through real portable hook programs. | Existing hook integration and E2E assertions pass with documented unrelated skips only. | Windows `e2e_full` and local integration suite. |
| A7 | POSIX inherited-fd and signal semantics remain fail-fast and covered where supported; Windows continues to run ordinary proxy, timeout, launcher, process capture, and fd-3 close behavior. | Only O9/O10 (direct platform fd-forwarding requiring POSIX stdio arrays) are excluded on Windows; O11/O12 remain active since `windows-latest` includes bash. | Package tests across Windows and POSIX. |
| A8 | The complete Windows unit workspace finishes without the repeated libuv worker death and without reducing existing parallelism. | No `fs-event.c, line 72` or `ERR_IPC_CHANNEL_CLOSED`; root test exits zero. | Windows `windows_ci` with the existing two Vitest forks. |
| A9 | The Windows Bun native-module smoke exits successfully and captures its output after all native checks pass. | Four PASS lines, the explicit allowed PTY skip, and successful output capture. | `windows_bun_native_smoke`. |
| A10 | No cross-platform regression or quality-rule weakening is introduced. | Full test, lint, typecheck, format, build, smoke, and review gates pass. | Local verification and PR/nightly CI. |

## Explicit non-goals

- No broad Windows skip for a package, subsystem, or integration suite.
- No weakening of repair atomicity, backup collision safety, lock ownership,
  marker failure visibility, or capability-token fail-fast behavior.
- No unlink-before-rename or other non-atomic Windows publication workaround.
- No new public atomic-write, path, shell, or platform abstraction.
- No dependency, runtime, lockfile, runner-image, or Vitest-version change.
- No retry increase, unhandled-error suppression, lint or complexity weakening,
  TypeScript suppression, or source/test exclusion.
- No new provider/source-scanner allowlist entries.
- No reduction in Windows test parallelism unless a dedicated isolation run
  demonstrates that concurrency itself is the trigger and the performance cost
  is measured and separately approved.
- No speculative production watcher change unless a bounded investigation proves
  a product defect.
- No unrelated warning cleanup, A2A changes, MCP/PDF work, or `.llxprt/` change.

## Bounded vertical slices

### Slice 1: Durable publication

1. Run the existing affected settings and CLI tests to establish the platform
   evidence available locally.
2. Change only the three synchronous fsync descriptor openings from read-only to
   writable.
3. Bound only the two POSIX mode-bit assertions to POSIX platforms.
4. Run the complete affected settings and CLI suites.

### Slice 2: Native paths and source guards

1. Replace hard-coded POSIX expected paths with native path construction.
2. Replace shell/grep source scanning with Node filesystem scanning.
3. Normalize paths before all scanner filters and allowlist comparisons.
4. Resolve source fixture paths from module URLs rather than the process working
   directory.
5. Run complete affected provider, agent, CLI, and test-utils suites.

### Slice 3: LSP URI behavior

1. Add a failing behavioral assertion for a default root URI generated through
   native path-to-file-URL semantics.
2. Use `pathToFileURL(workspaceRoot).toString()` for the production default.
3. Convert the four existing suites to native absolute workspace/fixture paths.
4. Run the complete LSP suite without skips or timeout increases.

### Slice 4: Portable hook fixtures

1. Replace POSIX inline commands and shell scripts with real TypeScript hook
   programs executed by Bun that parse stdin and emit the same decisions.
2. Compare native/canonical paths for input overrides.
3. Find the smallest input that demonstrably triggers automatic compression and
   remains below the Windows command-line limit.
4. Run the hook integration and E2E suites.

### Slice 5: Explicit POSIX boundaries

1. Bound only tests whose accepted behavior requires inherited fd 3 or Unix
   signal delivery.
2. Keep marker validation, ordinary proxy/socket, timeout, process capture, and
   launcher behavior active on Windows.
3. Run the full affected package suites.

### Slice 6: Workflow capacity (approval required before editing)

1. Keep the existing two-fork Windows Vitest parallelism while correcting the
   proven source, path, and fixture defects.
2. Raise only the Windows Bun native smoke job timeout from 15 to 30 minutes.
3. Validate the full nightly Windows jobs. If the libuv assertion remains, stop
   and shape a dedicated test-worker isolation investigation before proposing a
   concurrency change, retry, suppression, or production watcher change.

## Expected paths

1. `.github/workflows/nightly.yml` (approval-gated)
2. `.github/workflows/ci.yml` (related micro-expansion — smoke path update)
3. `packages/settings/src/profiles/canonicalProfileRepair.ts`
4. `packages/settings/src/profiles/__tests__/profileStore.test.ts`
5. `packages/settings/src/profiles/__tests__/canonicalProfileRepair.test.ts` (new behavioral test)
6. `packages/cli/src/config/memoryReconciliation.ts`
7. `packages/cli/src/config/pathMigration.ts`
8. `packages/cli/src/config/settings.part2.test.ts`
9. `packages/cli/src/config/trustedFolders.test.ts`
10. `packages/cli/src/launcher/bun-launcher.test.ts`
11. `packages/lsp/src/service/lsp-client.ts`
12. `packages/lsp/src/service/orchestrator.ts` (related micro-expansion — `isInsideWorkspace` fix)
13. `packages/lsp/test/lsp-client-integration.test.ts`
14. `packages/lsp/test/lsp-client.test.ts`
15. `packages/lsp/test/orchestrator-integration.test.ts`
16. `packages/lsp/test/orchestrator.test.ts`
17. `packages/providers/src/runtime/__tests__/profileApplication.authclear.test.ts`
18. `packages/providers/src/auth/proxy/__tests__/deprecation-guard.test.ts`
19. `packages/providers/src/auth/proxy/__tests__/factory-detection-wiring.test.ts`
20. `packages/providers/src/auth/proxy/__tests__/integration.test.ts`
21. `packages/agents/src/core/hooks-caller-application.test.ts`
22. `packages/agents/src/core/__tests__/providerAgnosticNaming.test.ts`
23. `packages/test-utils/src/cli-args.test.ts`
24. `packages/test-utils/src/process-run.test.ts`
25. `integration-tests/hooks-system.test.ts`
26. `integration-tests/hooks/hooks-e2e.integration.test.ts`
27. `scripts/bun-native-modules-smoke.ts` (new — converted from `.mjs`)
28. `scripts/bun-native-modules-smoke.mjs` (deleted — replaced by `.ts`)
29. `scripts/no-new-js-allowlist.json` (related micro-expansion — allowlist update)
30. `project-plans/issue-2800-nightly-windows.md`
31. `tsconfig.scripts.json` (user-rule micro-expansion — typecheck include)
32. `scripts/tests/nightly-bun-native-smoke.test.js` (related micro-expansion — assertions updated to match `.ts` path and `timeout-minutes:30`)
33. `packages/core/src/recording/SessionRecordingService.ts` (A8 remediation — canonical Windows watcher path)
34. `packages/core/src/recording/SessionRecordingService.test.ts` (A8 Windows temp-root regression)
35. `packages/core/src/hooks/hookRunner.ts` (A6 remediation — preserve native exit codes through PowerShell)
36. `packages/core/src/hooks/hookRunner.test.ts` (A6 Windows exit-code regression)
37. `scripts/tests/bun-script-migration.test.ts` (current-main ancestry correction — exclude historical plan records from active stale-script scanning)

The following paths were added as approved related micro-expansions during
remediation:
- `.github/workflows/ci.yml` (smoke script reference update)
- `packages/lsp/src/service/orchestrator.ts` (`isInsideWorkspace` fix)
- `scripts/bun-native-modules-smoke.ts` (TypeScript conversion)
- `scripts/bun-native-modules-smoke.mjs` (deleted old path)
- `scripts/no-new-js-allowlist.json` (allowlist update)
- `packages/settings/src/profiles/__tests__/canonicalProfileRepair.test.ts` (new behavioral read-only test)
- `tsconfig.scripts.json` (added `scripts/bun-native-modules-smoke.ts` to include list so typecheck covers it)
- `scripts/tests/nightly-bun-native-smoke.test.js` (updated assertions to match `.ts` path and `timeout-minutes:30` — required by the workflow YAML diff)
- `packages/core/src/recording/SessionRecordingService.ts` and its test (causal A8 remediation for libuv issue 5010)
- `packages/core/src/hooks/hookRunner.ts` and its test (causal A6 remediation for PowerShell collapsing native exit code 2)
- `scripts/tests/bun-script-migration.test.ts` (current main added a historical plan that correctly references a retired script; inherited focused fix from issue 2692)

## Scope ledger

| Slice | Changed paths | Net changed lines | Status |
| --- | ---: | ---: | --- |
| Delivery plan | 1 | +294 | Complete. |
| Durable publication and mode boundary | 5 | +39 | Complete. |
| Native paths and source guards | 7 | +98 | Complete. |
| LSP URI, fixtures, and workspace boundary | 6 | +249 | Complete. |
| POSIX fd/signal boundary | 4 | +68 | Complete. |
| Portable hook fixtures | 2 | -82 | Complete. |
| Bun smoke TypeScript rename and coverage | 4 | +23 | Complete (related micro-expansion). |
| Workflow references and timeout | 2 | 0 | Complete (related micro-expansion). |
| Windows watcher remediation | 2 | +42 | Complete; authoritative Windows validation pending. |
| PowerShell hook exit-code remediation | 2 | +26 | Complete; authoritative Windows validation pending. |
| Current-main stale-script guard correction | 1 | +4 | Complete; focused migration test pending. |
| **Total** | **36 Git diff paths** | **+1939 / -1106 (net +833)** | **Within hard stop (<40 files, <2500 net).** |

### Scope review (mandatory threshold crossed at >25 paths)

The mandatory scope review threshold of 25 paths was crossed during remediation.
The following additions were reviewed and classified as approved related
micro-expansions per the user directive:

1. `packages/lsp/src/service/orchestrator.ts` — the `isInsideWorkspace` bug is
   the root cause of the LSP workspace-boundary findings; fixing the test
   assertions without fixing the production prefix-matching bug would be
   incomplete.
2. `scripts/bun-native-modules-smoke.ts` + deletion of `.mjs` — required by the
   no-new-JS directive; the smoke harness conversion is the explicit user
   request.
3. `.github/workflows/ci.yml` — updates the smoke script invocation path to
   match the renamed file.
4. `scripts/no-new-js-allowlist.json` — removes the old `.mjs` from the
   allowlist so the no-new-js check remains valid.
5. `packages/settings/src/profiles/__tests__/canonicalProfileRepair.test.ts` —
   adds behavioral read-only test required by the durability finding.
6. `tsconfig.scripts.json` — adds `scripts/bun-native-modules-smoke.ts` to the
   typecheck include list so the TypeScript conversion is covered by
   `npm run typecheck`.
7. `packages/core/src/recording/SessionRecordingService.ts` and its test — run
   `30414719240` proved A8 still failed once in each core, agents, and CLI
   workspace with `fs-event.c, line 72`. The common recording watcher used an
   8.3-short Windows temp path while `ReadDirectoryChangesW` returned its long
   spelling, matching libuv issue 5010. Canonicalizing only the existing Windows
   watch directory with `realpathSync.native` fixes the native abort without
   reducing two-fork test parallelism.
8. `packages/core/src/hooks/hookRunner.ts` and its test — the same run proved A6
   still failed because PowerShell collapsed a native hook's exit code 2. The
   runner now explicitly exits with `$LASTEXITCODE`, preserving the documented
   blocking-hook contract. The existing integration path assertion was also
   normalized without adding another path.
9. `scripts/tests/bun-script-migration.test.ts` — merging current main introduced
   a historical implementation plan that intentionally mentions retired
   `scripts/start.js`. The focused issue 2692 fix excludes `dev-docs/plans` from
   the active-surface scanner while continuing to scan active documentation.

**Hard stop check:** the remediation expands the existing 31-path diff to 36
paths. The final diff has 1,939 additions and 1,106 deletions, for net +833.
This remains below the hard stops of 40 paths and 2,500 net lines. No
dependencies, lockfiles, public abstractions, quality-tool weakening, or
`.llxprt/` changes were introduced.
`VITEST_MAX_FORKS=2` is preserved. No ESLint/TypeScript suppressions or severity
downgrades were added.

Unplanned paths and behavior include the async profile writer, trusted-folder
production code, prompt-loader production/tests, Vitest configuration,
dependencies/lockfiles, public APIs, quality rules, other workflows, retries,
source exclusions, and allowlist expansion.

## Approval request

The only planned workflow diff is:

```diff
-    timeout-minutes: 15
+    timeout-minutes: 30
```

The existing two-fork Windows Vitest setting remains unchanged. The timeout
change allows the already-passing native smoke enough job lifetime to perform
output capture and cleanup.

## Review finding ledger

Every finding will be recorded with one of these classifications:

- **Blocker-Fix:** required for accepted behavior, safety, or a required gate.
- **In-scope-Fix:** within the matrix and expected paths and improves correctness.
- **Reject:** incorrect, already satisfied, or would weaken requirements.
- **Defer:** valid but outside this matrix or scope budget; it does not authorize
  implementation in this effort.

### OCR review findings (12 findings, all classified)

| # | Finding | File | Classification | Disposition |
| --- | --- | --- | --- | --- |
| 1 | Duplicate `rig.setup()` — first call redundant | hooks-system.test.ts | **Blocker-Fix** | Fixed: merged fakeResponsesPath into first setup, write fixture between, second setup has settings only. |
| 2 | O11/O12 test spawns `bash` without win32 guard | bun-launcher.test.ts | **Reject** | Rejected: nightly evidence shows O11 passed on `windows-latest` (Git Bash is pre-installed). The cross-platform portions of O11/O12 remain active; only O9/O10 (direct platform fd-forwarding) require `skipIf(win32)`. |
| 3 | Child process has no timeout/error/cleanup | integration.test.ts | **Blocker-Fix** | Fixed: added error listener, 15s timeout with kill, stderr in failure message. |
| 4 | childStderr never included in failure | integration.test.ts | **In-scope-Fix** | Fixed: `expect(exitCode, 'child stderr: ${childStderr}')`. |
| 5 | Regex adds mandatory leading `\s` | deprecation-guard.test.ts | **Blocker-Fix** | Fixed: `/(?:^\|\s)mergeRefreshedToken\s*=/`. |
| 6 | Global test-file exclusion in walker | deprecation-guard.test.ts | **Blocker-Fix** | Fixed: removed `isTestFile` from walker; `filterMatches` handles it per-caller. |
| 7 | `r+` on read-only files causes EACCES | canonicalProfileRepair.ts | **Blocker-Fix** | Fixed: use writable creation descriptor through fsync for temp files; use `copyAndFsyncExclusive` for backup/archive. |
| 8 | Duplicate marker rejection test | factory-detection-wiring.test.ts | **In-scope-Fix** | Fixed: removed duplicate from POSIX-only AC4 block; cross-platform marker-only test retained. |
| 9 | `runMarkerOnlyChild` doesn't check result.error/stderr | factory-detection-wiring.test.ts | **Blocker-Fix** | Fixed: added `result.error` check and stderr in assertion before JSON.parse. |
| 10 | Dead shebangs in portable hook scripts | hooks-e2e.integration.test.ts | **In-scope-Fix** | Fixed: removed all shebangs, removed chmod. |
| 11 | `setInterval` keeps process alive (orphan risk) | hooks-e2e.integration.test.ts | **Blocker-Fix** | Fixed: self-expiring fixture (2s setTimeout + clearInterval). |
| 12 | Redundant `writeFileSync(..., {mode: 0o755})` + `chmodSync` | hooks-e2e.integration.test.ts | **In-scope-Fix** | Fixed: removed mode and chmod since scripts invoke via `node`. |

### User-rule remediation findings (6 findings, all classified)

The user directive added a no-new-JavaScript rule: all new scripts/fixtures
must be TypeScript run by Bun. The following findings record the dispositions
from the focused remediation pass:

| # | Finding | File | Classification | Disposition |
| --- | --- | --- | --- | --- |
| U1 | `stderr_block_hook.cjs` fixture uses Node/CJS, not Bun/TS | hooks-system.test.ts | **Blocker-Fix** | Fixed: converted to `stderr_block_hook.ts` with ESM `import process from 'node:process'`, invoked as `bun stderr_block_hook.ts`. Removed redundant double `rig.setup` — single setup configures the relative command; fixture written into `rig.testDir` after setup, before `rig.run`. |
| U2 | All e2e hook fixtures are `.cjs` invoked via `node`, not `.ts` via `bun` | hooks-e2e.integration.test.ts | **Blocker-Fix** | Fixed: converted all six issue-introduced fixtures (`block-etc-writes.ts`, `block-etc-allow-others.ts`, `sanitize-paths.ts`, `slow-hook.ts`, `content-filter.ts`, `content-filter-allow.ts`) to TypeScript with ESM imports, invoked as `bun "path"`. No `.cjs`, `require()`, shebang, or chmod remains. Malformed-input try/catch retained (fail-fast exit 1). |
| U3 | Timeout fixture runs 10s (indefinite/orphan risk) | hooks-e2e.integration.test.ts | **Blocker-Fix** | Fixed: reduced self-expiry from 10s to 2s — safely beyond the 500ms hook timeout but bounded. |
| U4 | Durability code has catch-swallow around stat/chmod and explanatory comments | canonicalProfileRepair.ts, memoryReconciliation.ts | **Blocker-Fix** | Fixed: removed all newly added explanatory comments. Removed catch-swallow around `statSync`/`chmodSync` in both files — internal local filesystem operations now fail fast. Source mode computed before copy/create; writable descriptor used through write+fsync; source mode applied afterward. Partially-created targets cleaned up consistently with existing semantics (no fallback layers). Read-only behavioral test preserved. |
| U5 | Low-value comments added to smoke harness | bun-native-modules-smoke.ts | **In-scope-Fix** | Fixed: removed newly added low-value comments (resolve-pending, kill-explanation, explicit-exit). Retained TypeScript/Bun conversion and deterministic exit/resource teardown. Added null-check for `tree` to satisfy strict typecheck. |
| U6 | `tsconfig.scripts.json` does not include the new smoke script | tsconfig.scripts.json | **In-scope-Fix** | Fixed: added `scripts/bun-native-modules-smoke.ts` to the include list so typecheck covers it. |

### Rejected OCR claims

- **O11 skip claim:** OCR suggested O11 must skip on Windows because bash is
  unavailable. **Rejected:** nightly evidence shows O11 passed on Windows with
  available bash (Git Bash is pre-installed on `windows-latest`). O11/O12
  remain fully active on all platforms; only O9/O10 (direct platform
  fd-forwarding) require `skipIf(win32)` for POSIX fd-3 semantics.
- **Broad fsync fallback:** OCR recommended catch-fallback (`r+` → `r`) for
  fsync. **Rejected:** the correct fix is to keep writable descriptors from
  creation through fsync, not layer fallbacks. The `r+` regression on read-only
  mode-preserved copies is fixed by using writable creation descriptors.

### Candidate-head remediation findings

- **A8 worker crash — Blocker-Fix:** Exact-head nightly run `30414719240`
  reproduced `Assertion failed: !_wcsnicmp(filename, dir, dirlen), file
  src\win\fs-event.c, line 72` once in each core, agents, and CLI workspace,
  followed by `ERR_IPC_CHANNEL_CLOSED`. The common real
  `SessionRecordingService` watcher was passed the 8.3-short spelling returned
  by Windows `os.tmpdir()`, while `ReadDirectoryChangesW` returned the long
  spelling. This matches https://github.com/libuv/libuv/issues/5010. Fixed by
  passing `realpathSync.native(this.chatsDir)` to `fs.watch` only on Windows
  after materialization creates the directory. Two-fork parallelism remains.
- **A6 PowerShell exit code — Blocker-Fix:** The same nightly run showed the
  portable Bun hook scripts executing but exit-code-2 block decisions becoming
  non-blocking failures. Fixed by appending `exit $LASTEXITCODE` inside the
  PowerShell command block. Added focused runner coverage and normalized the
  existing input-override path assertion. Authoritative Windows validation is
  required on the next exact-head run.

## Exact-head completion checklist

- Every acceptance-matrix row has behavioral evidence on the candidate head.
- Targeted and full local verification pass.
- Candidate-head CI, including the affected nightly Windows jobs, passes.
- DeepThinker, local OCR (maximum two), CodeRabbit, and PR OCR (maximum two) are
  complete and every finding is classified.
- Every Blocker-Fix and In-scope-Fix finding is resolved.
- The candidate commit has the intended `main` ancestry.
- The PR is conflict-free.
- The final path/line scope ledger is within the approved bounds and has no
  unplanned changes.
