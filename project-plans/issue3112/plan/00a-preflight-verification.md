# Phase 0.5: Preflight Verification

Plan ID: `PLAN-20260807-ISSUE3112`
Verified: 2026-08-07

## Dependencies verified

- `node:process`, `node:os`, and `node:v8` are built-in modules already used by
  the affected production files.
- `bun:test` is the workspace's required test API and is discovered by
  `packages/cli/run-bun-tests.ts`.
- `packages/cli/src/test-utils/bunTest.ts` already provides the CLI's Bun module
  mocking compatibility facade.
- No new dependency is required.

## Types and runtime detection verified

- `process.versions.bun` is declared by the installed runtime types and is
  already the CLI launcher's Bun detection mechanism.
- The established condition requires a non-empty string.
- `NodeJS.MemoryUsage` already supplies `heapUsed`, `rss`, `external`, and
  `arrayBuffers` to the footer formatter.
- Core has a private-package runtime helper, but it is not exported through the
  package root. Expanding the core public surface is unnecessary and outside the
  accepted scope.

## Call paths verified

- `cliBootstrap.maybeRelaunchForMemory` calls
  `shouldRelaunchForMemory`; an empty array bypasses the relaunch path.
- `cliSandbox.computeSandboxMemoryArgsFromEnv` calls
  `computeSandboxMemoryArgs`; `maybeHopIntoSandbox` passes the returned array
  directly to `start_sandbox`, so `[]` is an existing valid contract.
- `Footer` reaches `ResponsiveMemoryDisplay` whenever
  `showMemoryUsage` is enabled and refreshes through its existing two-second
  interval.

## Existing behavior to replace

- `Footer.tsx` memoizes and displays `heap_size_limit` as a denominator for all
  runtimes.
- `bootstrap.ts` calculates and returns `--max-old-space-size` arguments without
  checking whether the runtime honors them.
- No separate migration, registration, or user access wiring is needed.

## Test infrastructure verified

- `packages/cli/src/ui/components/Footer.test.tsx` renders the actual footer and
  already mocks only surrounding infrastructure.
- `packages/cli/src/utils/bootstrap.test.ts` exercises the actual exported
  bootstrap functions and already covers Node calculations.
- The CLI runner discovers both test files and executes each in an isolated Bun
  process.
- Touched suites can migrate their test API imports to `bun:test` while retaining
  `vi` from the existing compatibility facade.

## Remaining heap-flag audit

| Location | Classification | Decision |
|---|---|---|
| `packages/cli/src/utils/bootstrap.ts` | Bun-fronted production policy | Fix with runtime-aware empty result |
| `packages/cli/src/cliBootstrap.tsx` | Caller of corrected policy | Leave API/call path unchanged |
| `packages/cli/src/cliSandbox.ts` | Caller of corrected policy | Leave API/call path unchanged |
| `packages/cli/src/utils/relaunch.ts` | Generic argument transport | Leave unchanged |
| CLI test literals/mocks | Test data for transport and wiring | Leave except accepted suites |
| root `package.json` test/lint `NODE_OPTIONS` | Real Node process | Leave unchanged |
| `scripts/run-lint.ts` and its tests | Real Node eslint child | Leave unchanged |
| CI workflow `NODE_OPTIONS` | Real Node process | Leave unchanged |

## Blocking issues found

None. The accepted behavior can be implemented by modifying the existing footer
and bootstrap decisions plus their existing tests. No public abstraction,
dependency, workflow, or unrelated refactor is needed.

## Verification gate

- [x] Dependencies verified
- [x] Types and runtime detection verified
- [x] Call paths verified
- [x] Test infrastructure ready
- [x] Remaining uses classified
- [x] No blocking issue found
