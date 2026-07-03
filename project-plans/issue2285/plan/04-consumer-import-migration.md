# Phase 04: Consumer Import Migration (public-factory-first, BEFORE depollution)

## Phase ID
`PLAN-20260629-ISSUE2285.P04`

## Prerequisites
- Required: Phase 03a completed.
- Verification: `test -f project-plans/issue2285/.completed/P03a.md`.

## Purpose

Architect finding 1: the prior revision sequenced depollution (old P04)
before consumer migration (old P05), leaving the full repo broken between
phases. This phase reverses that order: consumers are migrated FIRST, while
the root STILL exports internals. Since the root still leaks internals during
this phase, the migrated imports (to public factories or the internals
subpath) are valid, and the unmigrated imports (still hitting internals from
root) are also valid. The repo stays GREEN at every boundary.

After this phase, no consumer imports internals-only names from the root.
P05 (depollution) can then safely remove `export * from './internals.js'`
without breaking anything.

## Requirements Implemented (Expanded)

### REQ-004.2/.3: Production Consumer Internals Gate (A2A + test migration BEFORE depollution)

**Full Text**: A2A server internals-only imports must be migrated away from
root-leaked internals (public factory first; per-use exception records for
retained internals subpath). CLI test compile-breakers must be migrated to
internals subpath (not root). Legitimate internals subpath consumers resolve
under typecheck and Vitest.

**Behavior**:
- GIVEN: the agents root STILL re-exports internals
  (`export * from './internals.js'` is present). A2A and CLI tests currently
  import `AgentClient`/`CoreToolScheduler` from the root.
- WHEN: each consumer is migrated to the public factory or the explicit
  internals subpath — while the root STILL exports internals, so both old and
  new imports resolve.
- THEN: typecheck and Vitest pass. No consumer imports internals-only names
  from the root. P05 (depollution) can proceed safely.

**Why This Matters**: migrating consumers first means depollution (P05) is a
pure removal with no cross-package breakage. Every phase boundary is GREEN.
This satisfies the no-deferred-debt rule — the repo is never left broken.

## Test-First Sequencing (architect finding 3)

This phase establishes test-first sequencing for the migration:

1. **Write/update A2A behavior tests FIRST** (proving current A2A
   config/task runtime behavior works with the CURRENT root imports). These
   tests pin the behavior that the migration must preserve.
2. **Migrate the imports** (production + test consumers) to public factories
   or the internals subpath.
3. **Re-run the behavior tests** — they MUST remain GREEN (the migration is
   behavior-preserving: same factories, different import path).

The behavior tests are written/updated against current behavior BEFORE the
import migration, establishing the contract the migration must not break.

## Migration Strategy (public-factory-first)

For each consumer, the worker attempts public factory migration first. Only
if the public API is insufficient does it fall back to the internals subpath,
recording a per-use exception.

### A2A production consumers

#### `packages/a2a-server/src/config/config.ts`
- `new AgentClient(config, runtimeState)` → `createAgentClient(config, runtimeState)`
  (public factory from root).
- `new CoreToolScheduler(options)` → `createToolScheduler(options)` (public
  factory from root).
- `createTaskToolRegistration()` → KEEP (curated root export, decision in P05).
- **Exception record**: NONE needed if all three migrate to public factories.

#### `packages/a2a-server/src/agent/task.ts`
- `new AgentClient(config, runtimeState)` → `createAgentClient(config, runtimeState)`.
- Field type `agentClient: AgentClient` → `AgentClientContract` (from
  `@vybestack/llxprt-code-core` root import) OR keep as the concrete type via
  internals subpath.
- **Decision**: prefer `AgentClientContract` type from the **core root**
  (`import type { AgentClientContract } from '@vybestack/llxprt-code-core'`).
  Core's root barrel exports it (confirmed in preflight P01). Do NOT use the
  deep path `@vybestack/llxprt-code-core/core/clientContract.js` — the root is
  the public surface. Only fall back to the deep path if preflight proves the
  root re-export is unavailable.

#### `packages/a2a-server/src/agent/task-runtime-helpers.ts`
- `import type { AgentClient }` → `import type { AgentClientContract }` from
  the **core root** (`@vybestack/llxprt-code-core`), OR internals subpath type
  import.
- **Decision**: prefer `AgentClientContract` from the core root.

#### `packages/a2a-server/src/utils/testing_utils.ts`
- `import type { CoreToolScheduler }` → `import type { ToolSchedulerContract }`
  from the **core root** (`@vybestack/llxprt-code-core`), OR internals subpath
  type import.
- **Decision**: prefer `ToolSchedulerContract` from the core root.

### CLI test consumers (migrate to internals subpath — tests MAY use internals)

Tests are permitted to use internals via the explicit subpath. They must NOT
import internals-only names from the root (which will no longer export them
after P05).

#### `packages/cli/src/integration-tests/test-utils.ts`
- `AgentClient`, `CoreToolScheduler`, `createTaskToolRegistration` from root →
  `AgentClient`, `CoreToolScheduler` from
  `@vybestack/llxprt-code-agents/internals.js`;
  `createTaskToolRegistration` stays from root (curated).

#### `packages/cli/src/integration-tests/todo-continuation.integration.test.ts`
- `AgentClient`, type `Turn` from root → internals subpath.

#### `packages/cli/src/ui/hooks/useTodoContinuation.spec.ts`
- `AgentClient as AgentClientClass` from root → internals subpath.

#### `packages/cli/src/ui/hooks/useToolScheduler.test.ts` + part2-5
- `type CoreToolScheduler` from root → internals subpath OR
  `ToolSchedulerContract` from the **core root** (`@vybestack/llxprt-code-core`)
  (prefer the latter if only the type shape is needed).

#### `packages/cli/src/ui/hooks/geminiStream/__tests__/useAgenticLoop.test.tsx`
- `CoreToolScheduler` (value, constructed in test) from root → internals
  subpath.

#### Verify App.*.test.tsx
- Preflight confirmed these import `AgentClient` from
  `@vybestack/llxprt-code-core`, NOT agents root. Confirm no change needed
  unless core re-exports break (they should not — core's own barrel is
  independent of agents root depollution). Run typecheck to confirm.

### A2A behavior verification (architect finding 8 + revision 2 — precise, anti-mock-theater)

The factory migration (`new AgentClient(...)` → `createAgentClient(...)`,
`new CoreToolScheduler(...)` → `createToolScheduler(...)`) MUST be proven to
preserve A2A runtime behavior, not just compile. This phase MUST add or update
EXPLICIT, NAMED tests with exact file paths, APIs, fixtures, and observable
assertions. Mock theater (asserting `vi.fn()` was called instead of observing
real behavior) is FORBIDDEN.

**Architect review findings 1 + 2 (colocated test layout + actual APIs):**
the A2A package uses COLOCATED test files (e.g. `config.test.ts`,
`task.test.ts`, `testing_utils.test.ts`), NOT `__tests__/` directories. The
behavior test files added in this phase MUST follow the colocated convention
(placed alongside the source file under test) unless P01 explicitly records a
justification for introducing a `__tests__/` directory. The assertions below
are tightened to the ACTUAL A2A codebase APIs recorded by P01: the `Task`
class has a **private constructor** (instances are created via the async
`Task.create(...)` static factory), the real dispatch method is
`agentClient.sendMessageStream(...)` (an async generator), the scheduler is
obtained via `config.getOrCreateScheduler(...)` and dispatched via
`scheduler.schedule(...)`, and task events are published via
`this.eventBus?.publish(...)`. The plan MUST NOT reference a nonexistent
`.sendMessage` method, direct `new Task(...)` construction, or
"representative dispatch" in ways that do not map to these real APIs.

#### Exact test files, APIs, fixtures, and assertions

1. **Config factory construction behavior**:
   - **Test file**: `packages/a2a-server/src/config/config.factory-migration.test.ts`
     (NEW — COLOCATED next to `config.ts`, matching the existing
     `config.test.ts` convention; architect review finding 1.
     `@plan:PLAN-20260629-ISSUE2285.P04`, `@requirement:REQ-004`).
   - **API under test**: the `agentClientFactory` and `toolSchedulerFactory`
     lambdas in `createBaseConfigParameters(...)` within
     `packages/a2a-server/src/config/config.ts`. Today these construct
     `new AgentClient(config, runtimeState)` and
     `new CoreToolScheduler(options)`. After migration they invoke
     `createAgentClient(config, runtimeState)` and
     `createToolScheduler(options)` from `@vybestack/llxprt-code-agents`.
   - **Fixture (revision 3 findings 11 + architect review finding 7: evidence
     is in `preflight-results.md`, NOT `import-inventory.md`)**: a minimal real
     `AgentConfig`/`Config` constructed using the EXACT builder/API recorded by
     preflight (P01) in `analysis/preflight-results.md` (section 3 — A2A
     consumers — records the exact import path and function name for
     constructing a `Config` as used in A2A today, plus the exact
     `runtimeState` construction API and the exact dispatch method name).
     `preflight-results.md` is AUTHORITATIVE for P04 fixture details (the exact
     builder, stub seam, and dispatch method). The fixture MUST be a value that
     exercises the real constructor path (e.g. a config built via the recorded
     builder with a real model provider stub that returns a fixed response —
     NOT a mock of `AgentClient` itself, and NOT a `{} as AgentConfig` cast).
     If P01 could not record a builder, this phase BLOCKS and returns to P01 to
     record one before proceeding.
   - **Observable assertions (revision 3 finding 10 — PUBLIC behavioral
     equivalence, NOT brittle own-enumerable-key identity)** (NOT
     `toHaveBeenCalledWith`):
     - The factory-produced client's `sendMessageStream` method (the ACTUAL
       dispatch method A2A calls, as recorded by P01) is a real function
       (typeof `'function'`), proving the factory produced a real client, not
       a mock. The plan MUST NOT reference a `.sendMessage` method (which does
       not exist); use `sendMessageStream` (the real async-generator dispatch
       API).
     - The factory-produced scheduler's `.schedule` method (the ACTUAL method
       the A2A `Task` calls on the scheduler obtained via
       `config.getOrCreateScheduler(...)`) is a real function.
     - **PUBLIC behavioral equivalence (NOT own-enumerable-key identity)**:
       calling `sendMessageStream(...)` on the factory-produced client with the
       stub model provider yields an async iterable whose events include a
       non-empty content field matching the stub model reply. Do NOT assert
       that the factory-produced and constructor-produced objects share the
       same set of own enumerable property keys — that is brittle and breaks
       on legitimate private/lazy field differences. Assert instead that both
       paths expose the SAME public methods A2A calls (`sendMessageStream`,
       `schedule`) and that those methods produce equivalent observable
       results.

2. **A2A config → task → runtime behavior preserved**:
   - **Test file**: `packages/a2a-server/src/agent/task.factory-migration.integration.test.ts`
     (NEW — COLOCATED next to `task.ts`, matching the existing `task.test.ts`
     convention; architect review finding 1.
     `@plan:PLAN-20260629-ISSUE2285.P04`, `@requirement:REQ-004`).
   - **API under test**: the A2A task path
     (`packages/a2a-server/src/agent/task.ts`). The `Task` class has a
     **private constructor** — instances are created via the async
     `Task.create(id, contextId, config, eventBus?, autoExecute?)` static
     factory, which internally constructs `new AgentClient(config,
     runtimeState)`. The test MUST construct a `Task` via `Task.create(...)`,
     NOT via direct `new Task(...)` (which the private constructor forbids).
     The migrated code path constructs the `AgentClient` via
     `createAgentClient(...)` inside the same `Task` lifecycle.
   - **Fixture**: a real task request (the same shape A2A accepts over its
     API) with a stub model provider returning a deterministic fixed reply
     (e.g. "OK"). The stub is at the model-provider seam — NOT a mock of
     `AgentClient` or `CoreToolScheduler`.
   - **Observable assertions** (real end-to-end behavior, NOT mock-call
     assertions):
     - `Task.create(...)` produces a `Task` instance whose `agentClient` field
       exposes a working `sendMessageStream(...)` async generator (the ACTUAL
       dispatch method — NOT a nonexistent `.sendMessage`). Driving
       `acceptUserMessage(...)` (or `sendCompletedToolsToLlm(...)`, both of
       which call `agentClient.sendMessageStream(...)`) with the fixture
       produces an async iterable of `ServerGeminiStreamEvent` events whose
       content matches the stub's fixed reply.
     - The tool-scheduling path is exercised: when the fixture task includes a
       tool call, `scheduler.schedule(...)` (the ACTUAL method the `Task`
       calls) produces scheduled-tool records observed via the `eventBus`
       publish channel (`this.eventBus?.publish(...)` — observable task event
       publication). The test observes PUBLISHED EVENTS (real objects on the
       event bus), NOT `vi.fn()` return values.
     - Turn handling: the published task-status events include the expected
       `taskState` transitions A2A relies on (e.g. `submitted` → `working` →
       `completed`).

If such tests already exist (under different names), they MUST be identified
by exact path and run/updated against the migrated code; the assertion list
above is the minimum bar. If they do not exist, they MUST be added in this
phase with the exact names above. The tests MUST be GREEN against the migrated
factories — a failure means the migration changed behavior (investigate, do
NOT suppress).

## Implementation Tasks

### Files to Modify

A2A production:
- `packages/a2a-server/src/config/config.ts` — migrate to public factories.
- `packages/a2a-server/src/agent/task.ts` — migrate to `createAgentClient` +
  `AgentClientContract` type.
- `packages/a2a-server/src/agent/task-runtime-helpers.ts` — migrate type import.
- `packages/a2a-server/src/utils/testing_utils.ts` — migrate type import.

CLI tests:
- `packages/cli/src/integration-tests/test-utils.ts` — internals subpath.
- `packages/cli/src/integration-tests/todo-continuation.integration.test.ts` — internals subpath.
- `packages/cli/src/ui/hooks/useTodoContinuation.spec.ts` — internals subpath.
- `packages/cli/src/ui/hooks/useToolScheduler.test.ts` — internals subpath or core contract.
- `packages/cli/src/ui/hooks/useToolScheduler.part2.test.ts` — same.
- `packages/cli/src/ui/hooks/useToolScheduler.part3.test.ts` — same.
- `packages/cli/src/ui/hooks/useToolScheduler.part4.test.ts` — same.
- `packages/cli/src/ui/hooks/useToolScheduler.part5.test.ts` — same.
- `packages/cli/src/ui/hooks/geminiStream/__tests__/useAgenticLoop.test.tsx` — internals subpath.

### Files to Create
- `packages/a2a-server/src/config/config.factory-migration.test.ts`
  (NEW — **revision 4 architect finding 4 + architect review finding 1**:
  COLOCATED next to `config.ts` matching the existing `config.test.ts`
  convention, NOT under a `__tests__/` directory.
  `@plan:PLAN-20260629-ISSUE2285.P04`, `@requirement:REQ-004`). See "A2A
  behavior verification" above for the exact APIs, fixtures, and observable
  assertions.
- `packages/a2a-server/src/agent/task.factory-migration.integration.test.ts`
  (NEW — **revision 4 architect finding 4 + architect review finding 1**:
  COLOCATED next to `task.ts` matching the existing `task.test.ts` convention,
  NOT under a `__tests__/` directory.
  `@plan:PLAN-20260629-ISSUE2285.P04`, `@requirement:REQ-004`). See "A2A
  behavior verification" above for the exact APIs, fixtures, and observable
  assertions.
- `project-plans/issue2285/analysis/a2a-exception-records.md` — per-use
  exception record for ANY retained internals subpath in A2A production code.
  If none, document "no exceptions — all migrated to public factories".

### Files NOT to Modify
- `packages/agents/src/index.ts` — the root STILL exports internals during this
  phase. Depollution is P05.
- `scripts/check-cli-import-boundary.mjs` — boundary checker replacement is P06/P07.

### Marker Discipline (architect finding 5 + architect review finding 5)

Markers (`@plan`/`@requirement`) are RESTRICTED to test files and plan
artifacts. Do NOT add NEW `@plan:PLAN-20260629-ISSUE2285` marker comment blocks
to production source files (`config.ts`, `task.ts`, `task-runtime-helpers.ts`,
`testing_utils.ts`) — update only the imports. The exception-records analysis
document is a plan artifact and may carry the marker.

**Pre-existing marker debt (architect review finding 5):** production source
files such as `packages/a2a-server/src/config/config.ts` ALREADY contain
`@plan PLAN-20260610-ISSUE1592` and `@requirement REQ-INV-*` markers from a
PRIOR issue. These PRE-EXISTING markers are NOT to be removed or modified by
this issue unless the line they annotate is itself changed for issue #2285
scope. The policy prohibits only NEW issue2285 markers in production source /
executable scripts — it does NOT imply a sweep to remove existing markers from
other issues.

## Reachability

A2A `config.ts` is reached by the A2A server startup path. `task.ts` constructs
the `AgentClient` used per task. CLI tests are reached by `npm run test`. All
migrations touch real code paths, not isolated features.

## Verification Commands

**Architect review finding 3 (test command reliability):** the root
`npm run test` script runs `npm run test --workspaces --if-present`, which runs
ALL workspace tests — root-level path arguments do NOT reliably filter to a
single workspace. The commands below use `npm run test --workspace <name>` (or
`npm run test --workspace <name> -- <pattern>`) which is the proven workspace
Vitest invocation. **P01 MUST record the exact working test commands** (the
specific `--workspace` filter and Vitest name patterns that run the A2A and CLI
affected tests) in `analysis/preflight-results.md`; P04/P04a rely on those
recorded commands. If P01 records that a particular filter does not work, the
phase uses the recorded fallback.

```bash
# No A2A production file imports internals-only names from agents ROOT (fail-closed)
NONPUBLIC_A2A="$(grep -rn "AgentClient\|CoreToolScheduler" packages/a2a-server/src --include="*.ts" | grep "llxprt-code-agents'" || true)"
test -z "$NONPUBLIC_A2A" || { echo "FAIL: A2A production still imports AgentClient/CoreToolScheduler from agents root:"; echo "$NONPUBLIC_A2A"; exit 1; }

# A2A typecheck (workspace-scoped — proven invocation per architect review finding 3)
npm run typecheck --workspace @vybestack/llxprt-code-a2a-server
test $? -eq 0 || { echo "FAIL: A2A typecheck"; exit 1; }

# A2A tests (workspace-scoped — proven invocation per architect review finding 3)
npm run test --workspace @vybestack/llxprt-code-a2a-server
test $? -eq 0 || { echo "FAIL: A2A tests"; exit 1; }

# CLI tests that were broken now pass (workspace-scoped + Vitest name filter)
npm run test --workspace @vybestack/llxprt-code -- useToolScheduler useTodoContinuation useAgenticLoop
test $? -eq 0 || { echo "FAIL: affected CLI tests"; exit 1; }

# Full typecheck (fail-closed)
npm run typecheck
test $? -eq 0 || { echo "FAIL: full typecheck"; exit 1; }

# Exception records (fail-closed)
test -f project-plans/issue2285/analysis/a2a-exception-records.md || { echo "FAIL: a2a-exception-records.md missing"; exit 1; }

# Revision 4 architect finding 4 + architect review finding 1: the two REQUIRED
# A2A behavior test files MUST exist (COLOCATED, not __tests__), have markers,
# and contain observable assertions (NOT mock theater).
# config.factory-migration.test.ts (COLOCATED next to config.ts)
test -f packages/a2a-server/src/config/config.factory-migration.test.ts || { echo "FAIL: config.factory-migration.test.ts missing (architect finding 4 — P04 mandates it; colocated per review finding 1)"; exit 1; }
grep -q "@plan:PLAN-20260629-ISSUE2285.P04" packages/a2a-server/src/config/config.factory-migration.test.ts || { echo "FAIL: config.factory-migration.test.ts missing @plan marker"; exit 1; }
grep -q "@requirement:REQ-004" packages/a2a-server/src/config/config.factory-migration.test.ts || { echo "FAIL: config.factory-migration.test.ts missing @requirement marker"; exit 1; }
# Must contain a real factory assertion (createAgentClient or createToolScheduler), NOT mock theater.
grep -q "createAgentClient\|createToolScheduler" packages/a2a-server/src/config/config.factory-migration.test.ts || { echo "FAIL: config.factory-migration.test.ts has no public-factory assertion"; exit 1; }
# Must reference the REAL dispatch method (sendMessageStream), NOT the nonexistent .sendMessage (architect review finding 2).
grep -q "sendMessageStream" packages/a2a-server/src/config/config.factory-migration.test.ts || echo "WARN: config test does not reference sendMessageStream — confirm P01 recorded a different dispatch method"
# Must NOT be pure mock theater.
grep -q "toHaveBeenCalledWith" packages/a2a-server/src/config/config.factory-migration.test.ts && { echo "FAIL: config.factory-migration.test.ts uses mock theater"; exit 1; } || true
echo "OK: config.factory-migration.test.ts exists (colocated) with markers and observable assertions"

# task.factory-migration.integration.test.ts (COLOCATED next to task.ts)
test -f packages/a2a-server/src/agent/task.factory-migration.integration.test.ts || { echo "FAIL: task.factory-migration.integration.test.ts missing (architect finding 4 — P04 mandates it; colocated per review finding 1)"; exit 1; }
grep -q "@plan:PLAN-20260629-ISSUE2285.P04" packages/a2a-server/src/agent/task.factory-migration.integration.test.ts || { echo "FAIL: task.factory-migration.integration.test.ts missing @plan marker"; exit 1; }
grep -q "@requirement:REQ-004" packages/a2a-server/src/agent/task.factory-migration.integration.test.ts || { echo "FAIL: task.factory-migration.integration.test.ts missing @requirement marker"; exit 1; }
# Must reference the REAL APIs: Task.create (not direct construction) + sendMessageStream (architect review finding 2).
grep -qE "Task\.create|sendMessageStream|schedule|publish" packages/a2a-server/src/agent/task.factory-migration.integration.test.ts || { echo "FAIL: task.factory-migration.integration.test.ts has no observable result assertion referencing real APIs"; exit 1; }
# Must NOT reference the nonexistent .sendMessage method or direct new Task(...) (architect review finding 2).
grep -qE "\.sendMessage[^S]|new Task\(" packages/a2a-server/src/agent/task.factory-migration.integration.test.ts && { echo "FAIL: task test references nonexistent .sendMessage or direct new Task (private constructor)"; exit 1; } || true
grep -q "toHaveBeenCalledWith" packages/a2a-server/src/agent/task.factory-migration.integration.test.ts && { echo "FAIL: task.factory-migration.integration.test.ts uses mock theater"; exit 1; } || true
echo "OK: task.factory-migration.integration.test.ts exists (colocated) with markers and observable assertions"

# Run the A2A behavior tests (workspace-scoped Vitest name filter — architect review finding 3)
npm run test --workspace @vybestack/llxprt-code-a2a-server -- config.factory-migration task.factory-migration
test $? -eq 0 || { echo "FAIL: A2A behavior tests did not pass (architect finding 4)"; exit 1; }

# Root STILL exports internals (not yet depolluted — P05) — fail-closed
test "$(grep -c "export \* from './internals.js'" packages/agents/src/index.ts)" -eq 1 || { echo "FAIL: root internals re-export count != 1 (depollution is P05)"; exit 1; }
```

## Deferred Implementation Detection (revision 3 — finding 4: scoped to phase-owned A2A files; architect review finding 6: pre-phase baseline)

**Architect review finding 6 (pre-existing debt baseline):** deferred-language
scans that grep whole issue-owned files can FAIL on pre-existing debt (e.g.
prior TODO/FIXME/STUB markers in A2A source). To avoid false failures, this
phase takes a PRE-PHASE BASELINE of deferred-language hits before making any
changes, then scans the ADDED/MODIFIED hunks (or compares post-phase to the
baseline) so only NEWLY INTRODUCED TODO/FIXME/HACK/STUB/TEMPORARY/placeholder/
for-now debt causes a failure.

```bash
# Architect review finding 6: capture the pre-phase baseline of existing
# deferred-language hits in the A2A files this phase will modify. Run this
# BEFORE any edits. The baseline is recorded in the completion marker.
A2A_PHASE_FILES="packages/a2a-server/src/config/config.ts packages/a2a-server/src/agent/task.ts packages/a2a-server/src/agent/task-runtime-helpers.ts packages/a2a-server/src/utils/testing_utils.ts"
BASELINE_FILE="$(mktemp)"
grep -rn -E "(TODO|FIXME|HACK|STUB|TEMPORARY|placeholder|for now)" $A2A_PHASE_FILES > "$BASELINE_FILE" 2>/dev/null || true

# ... (phase edits happen here) ...

# Post-phase scan: fail ONLY on newly introduced deferred language (diff
# against baseline — architect review finding 6). Pre-existing hits are
# tolerated; newly introduced hits FAIL.
POST_FILE="$(mktemp)"
grep -rn -E "(TODO|FIXME|HACK|STUB|TEMPORARY|placeholder|for now)" $A2A_PHASE_FILES > "$POST_FILE" 2>/dev/null || true
NEW_DEFERRED="$(diff "$BASELINE_FILE" "$POST_FILE" | grep '^>' || true)"
test -z "$NEW_DEFERRED" || { echo "FAIL: newly introduced deferred language in A2A source:"; echo "$NEW_DEFERRED"; rm -f "$BASELINE_FILE" "$POST_FILE"; exit 1; }
rm -f "$BASELINE_FILE" "$POST_FILE"
echo "OK: no newly introduced deferred language (pre-existing baseline tolerated)"
```

## Success Criteria
- All A2A production consumers migrated (public factory first; exception
  records for any retained internals subpath).
- All CLI test consumers migrated to internals subpath (or core root contract
  types — NOT deep core paths).
- A2A behavior verification tests present and GREEN — factory migration proven
  to preserve runtime behavior, not just compile.
- `npm run typecheck` passes.
- Affected tests pass.
- No deferred language, no lint loosening.
- Root STILL exports internals (depollution is P05 — repo stays GREEN).

## Failure Recovery

This phase does NOT use `git checkout` rollback for failure recovery. Instead:
- If a migration breaks typecheck/tests: fix the specific import in place
  (e.g. wrong factory name, wrong type). Re-run the affected check.
- If A2A behavior tests fail: the factory migration changed behavior —
  investigate whether the factory produces a different object shape and fix
  the migration to preserve behavior. Do NOT suppress the test.
- Report any blocking issue to the coordinator.

## Phase Completion Marker
Create `project-plans/issue2285/.completed/P04.md`.


The marker MUST contain structured diff evidence per the Standard Completion
Marker Template in `overview.md` (architect finding 8): files changed
(`git diff --name-only` of phase-owned files), diff stats (`git diff --stat`),
command outputs (exit status + key output), and tracker evidence (gate items
satisfied + verifier evidence).
