# Feature Specification: Depollute Agents Public Barrel and Finish CLI Session Boundary Refactor

Plan ID: PLAN-20260629-ISSUE2285
Issue: https://github.com/vybestack/llxprt-code/issues/2285

## Purpose

Finish the architectural boundary cleanup started by issue #2204 and PR #2265.
The previous work moved CLI runtime behavior toward public factories and made the
existing boundary check pass, but deliberately preserved a non-breaking agents
package root export shape (root still re-exports `./internals.js`). This issue
removes that deliberate debt so the architecture itself — not a manually
maintained symbol allowlist — enforces the intended boundary.

## Architectural Decisions

- **Mechanical guard over convention**: package shape, export maps, and a
  declaration-aware API-surface guard replace the hand-maintained
  `PUBLIC_AGENT_SYMBOLS` allowlist in `scripts/check-cli-import-boundary.mjs`.
- **Curated root + explicit internals subpath**: `@vybestack/llxprt-code-agents`
  exposes only the public Agent API at the root; low-level internals, if
  retained, are reachable only through `@vybestack/llxprt-code-agents/internals.js`.
  Production CLI may not import the internals subpath.
- **Type/declaration-aware API guard**: the agents public API-surface guard must
  cover emitted declaration/type surface as well as runtime value exports so
  type-only internal leakage cannot bypass it. A runtime `Object.keys()` check
  alone is insufficient. The guard's parser must recursively resolve `export *`
  re-exports and normalize `.js` specifiers to `.d.ts` declaration files
  (revision 6 finding 3 — the actual package root uses
  `export * from './src/index.js'`, so the parser resolves `.js` to `.d.ts`
  during declaration traversal). CI job placement is mechanism-conditional
  (revision 6 finding 7: B1/B1a/B1b source-path temp tsconfig runs pre-build;
  B2 fresh-shared-dist runs post-build only).
- **Stable CLI session ownership**: `cliSessionDispatch.tsx` is split along
  stable responsibility seams after behavior-preserving characterization tests
  are written and observed against the current implementation.
- **No lint/complexity loosening**: no `eslint-disable`, `ts-ignore`,
  `ts-expect-error`, `ts-nocheck`, lint severity downgrade, complexity
  threshold increase, or ignore expansion is permitted.

## Integration Points (MANDATORY)

### Existing Code That Will Use This Feature

- `packages/cli/src/*` production source — imports `@vybestack/llxprt-code-agents`
  from the curated root only after depollution.
- `packages/a2a-server/src/config/config.ts` — currently imports `AgentClient`,
  `CoreToolScheduler`, `createTaskToolRegistration` from the agents root; must
  migrate to public factories or the explicit internals subpath.
- `packages/a2a-server/src/agent/task.ts` — imports `AgentClient` (value) from
  root.
- `packages/a2a-server/src/agent/task-runtime-helpers.ts` — imports `AgentClient`
  (type) from root.
- `packages/a2a-server/src/utils/testing_utils.ts` — imports `CoreToolScheduler`
  (type) from root.
- `packages/cli/src/cli.tsx` — imports six names from `./cliSessionDispatch.js`
  and re-exports them; the refactor must preserve these through stable
  replacement modules.
- `scripts/check-cli-import-boundary.mjs` — boundary enforcement moves from
  symbol allowlist to package/specifier contracts.
- `scripts/tests/cli-import-boundary.test.js` — synthetic `CLI_BOUNDARY_ROOT`
  fixture tests must be updated to the new checker rules.

### Existing Code To Be Replaced

- `PUBLIC_AGENT_SYMBOLS` constant and its root-symbol checking logic in
  `scripts/check-cli-import-boundary.mjs`.
- `export * from './internals.js'` in `packages/agents/src/index.ts`.
- The `cliSessionDispatch.tsx` temporary quarantine module — split into stable
  ownership modules.
- Identity assertions (`root.AgentClient === internals.AgentClient`) and
  root-internals-leak assertions in
  `packages/agents/src/api/__tests__/publicSurface.nonbreaking.test.ts` and
  `nonBreaking.exports.test.ts`.

### User Access Points

- CLI: `node scripts/start.js ...` — interactive and non-interactive paths.
- A2A server: imports agents for task runtime construction.
- Library consumers: `@vybestack/llxprt-code-agents` public root API.

### Migration Requirements

- CLI test files importing internals-only names from the root must migrate to
  the internals subpath (tests may use internals; they may not import
  internals-only names from the root after depollution because typecheck and
  Vitest will fail).
- A2A production consumers must attempt public factory migration first, with a
  per-use exception record for any retained internals subpath.
- **A2A test convention (architect review finding 1)**: the A2A package uses
  COLOCATED test files (e.g. `config.test.ts`, `task.test.ts`), NOT `__tests__/`
  subdirectories. A2A factory-migration behavior tests MUST be colocated
  (`config.factory-migration.test.ts`, `task.factory-migration.integration.test.ts`).
  Introducing `__tests__/` would deviate from the established convention.
- **A2A behavior test APIs (architect review finding 2)**: A2A behavior tests
  MUST reference the REAL A2A APIs recorded by P01 preflight:
  `agentClient.sendMessageStream(...)` (async generator, NOT `.sendMessage`),
  `Task.create(...)` (private constructor, async factory — NOT `new Task(...)`),
  `config.getOrCreateScheduler(...)` + `scheduler.schedule(...)`,
  `this.eventBus?.publish(...)`. Tests MUST NOT reference nonexistent APIs.
- **Test command reliability (architect review finding 3)**: root
  `npm run test` runs ALL workspaces. Workspace-scoped test commands
  (`npm run test --workspace <name> -- <pattern>`) MUST be used. P01 preflight
  records exact working commands.

## Formal Requirements

[REQ-001] Agents Root Barrel Depollution
  [REQ-001.1] `packages/agents/src/index.ts` must NOT contain
    `export * from './internals.js'`.
  [REQ-001.2] Internal names (`AgentClient`, `CoreToolScheduler`, concrete
    `AgenticLoop` class/value) must not reappear through the root unnoticed.
  [REQ-001.3] Intentional curated loop API (`createAgenticLoop`,
    `AgenticLoopRunner`, `AgenticLoopEvent`, `AgenticLoopMessage`) must be
    preserved if inventory confirms they remain public.
  [REQ-001.4] The guard must cover emitted declaration/type surface AND runtime
    value exports.

[REQ-002] API-Surface Guard
  [REQ-002.1] A focused agents public API-surface guard must be implemented
    (export snapshot or API-report style).
  [REQ-002.2] The guard must fail closed on unknown root-surface changes.
  [REQ-002.3] The guard must independently assert absence of known internals
    from the root (at minimum `AgentClient`, `CoreToolScheduler`, concrete
    `AgenticLoop`).
  [REQ-002.4] Snapshot update must be an intentional reviewable change, not
    automatic re-blessing.
  [REQ-002.5] If the guard reads `dist`, build ordering must guarantee fresh
    declarations.

[REQ-003] Boundary Checker Replacement
  [REQ-003.1] `PUBLIC_AGENT_SYMBOLS` and its root-symbol checking logic must be
    removed from `scripts/check-cli-import-boundary.mjs`.
  [REQ-003.2] Replacement rules based on import specifiers and package/subpath
    contracts: bare agents root allowed; `.../internals.js` forbidden in
    production CLI; deep runtime imports remain forbidden except narrowly
    justified seams.
  [REQ-003.3] Stale allowlist pruning, getConfig escape-hatch scan, non-literal
    `vi.mock` detection, thin-entry checks, and scoped public subpath logic
    must continue to work.
  [REQ-003.4] Existing `CLI_BOUNDARY_ROOT` fixture tests must be updated.

[REQ-004] Production Consumer Internals Gate
  [REQ-004.1] Production CLI source under `packages/cli/src` must not import
    agents internals via root leaked symbols, internals subpath, or deep agents
    source paths.
  [REQ-004.2] A2A server internals-only imports must be migrated away from
    root-leaked internals (public factory first; per-use exception records for
    retained internals subpath).
  [REQ-004.3] Tests may use internals via the explicit subpath, not from the
    root.

[REQ-005] Runtime Factory Contract
  [REQ-005.1] Duplicated `AgentRuntimeFactoryBindings` must be replaced by one
    source of truth if dependency direction allows.
  [REQ-005.2] Retained duplication is acceptable only with a documented
    no-cycle decision record, comments at both declarations, and a compile-time
    drift guard that participates in `npm run typecheck`.

[REQ-006] CLI Session Ownership
  [REQ-006.1] `cliSessionDispatch.tsx` must stop being a large temporary
    quarantine — split along stable responsibility seams.
  [REQ-006.2] Characterization tests must be written and observed against
    current behavior BEFORE splitting, in a separate numbered phase.
  [REQ-006.3] The refactor must preserve every exported name `cli.tsx` depends
    on (six names from `cliSessionDispatch.js`) plus `validateDnsResolutionOrder`
    from `cliBootstrap` (not part of the split).
  [REQ-006.4] No temporary/quarantine language in completed modules.

[REQ-INT-001] Integration Requirements
  [REQ-INT-001.1] Every implementation phase reachable through existing
    package/API/CLI/A2A code paths — no isolated features.
  [REQ-INT-001.2] Full verification suite passes: `npm run test`, `npm run lint`,
    `npm run lint:eslint-guard`, `npm run lint:cli-boundary`,
    `npm run lint:agents-api-surface`, `npm run typecheck`,
    `npm run format`, `npm run build`, and the smoke test.

## Constraints

- No `eslint-disable`, `ts-ignore`, `ts-expect-error`, `ts-nocheck`, lint rule
  loosening, severity downgrade, complexity threshold increase, or ignore
  expansion.
- No deferred implementation language (TODO, FIXME, HACK, STUB, TEMPORARY,
  placeholder, for-now) in completed implementation code. **(Architect review
  finding 6: deferred-language scans use pre-phase baselines or git-diff
  added-lines so only NEWLY INTRODUCED debt fails — pre-existing debt from
  prior issues is tolerated.)**
- Characterization tests for `cliSessionDispatch` may isolate infrastructure
  boundaries (process, TTY, Ink render, filesystem) but must NOT mock the
  session-dispatch module or assert only that mocks were called.
- Generated `dist` trees must not be used as authoritative source inventory.
  `dist` is gitignored (untracked build artifact); regenerate with
  `npm run build`.
- **Marker policy (architect review finding 5)**: `@plan:PLAN-20260629-ISSUE2285`
  and `@requirement:REQ-` markers are restricted to test files and plan
  artifacts only. Pre-existing markers from other issues are NOT to be removed
  unless the line they annotate is changed for issue #2285 scope.
- **Escape-hatch gate (architect review finding 9)**: `LLXPRT_API_SURFACE_SKIP`
  MUST be unset during final verification (P13/P13a) so the API-surface guard
  runs in full fail-closed mode.
- **Verdict C downstream sequencing (architect review finding 10)**: if the CLI
  session seam audit (P10) returns Verdict C, the `P10a.revised-plan.md` marker
  is NOT a bypass — it is a re-planning artifact that MUST reference P11/P12/P13
  downstream changes, and those phases MUST be re-reviewed before continuing.

## Non-Deferral Gates (blocking — see execution-tracker.md)

1. Agents Root Barrel Gate (REQ-001)
2. Manual Symbol Allowlist Gate (REQ-003)
3. Production Consumer Internals Gate (REQ-004)
4. Public API Contract Gate (REQ-002)
5. Runtime Factory Contract Gate (REQ-005)
6. CLI Session Ownership Gate (REQ-006)
7. Verification Gate (REQ-INT-001.2)
