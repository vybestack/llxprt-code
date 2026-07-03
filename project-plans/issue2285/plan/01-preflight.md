# Phase 01: Preflight Verification

## Phase ID
`PLAN-20260629-ISSUE2285.P01`

## Prerequisites
- Required: Phase 00a completed.
- Verification: `test -f project-plans/issue2285/.completed/P00a.md`.

## Purpose

Verify ALL assumptions before writing any code. This phase covers every preflight
item required by the issue and the planning rules:

1. Generated artifact policy.
2. Agents import inventory.
3. A2A consumers.
4. CLI test compile-breakers.
5. app-service subpath non-scope check.
6. Type/export-map resolution for internals subpath.
7. API guard mechanism decision.
8. Runtime factory dependency/ownership decision.
9. Current cliSessionDispatch behavior and safe test seams.

## Requirements Implemented (Expanded)

### REQ-001.1/.2/.3/.4 + REQ-002 + REQ-003 + REQ-004 + REQ-005 + REQ-006 (preflight evidence)

The preflight phase does NOT implement code. It records evidence that makes the
implementation phases grounded. Each finding below must be confirmed by the
worker against the actual source tree and recorded in
`project-plans/issue2285/analysis/preflight-results.md` (created in this phase).

## Implementation Tasks

### Files to Create
- `project-plans/issue2285/analysis/preflight-results.md` — the completed
  preflight checklist with real command output pasted as evidence.
- `project-plans/issue2285/analysis/runtime-factory-contract-decision.md` —
  the RUNTIME FACTORY DECISION RECORD (architect review finding 1: created in
  P01, NOT P09). This record is REQUIRED before P08/P08a, which read it. It
  MUST contain:
  - a machine-greppable `decision: single-source` OR
    `decision: retained-duplication` line (colon-prefixed, exact format so
    downstream phases grep it reliably).
  - for `retained-duplication`: an optional `drift-guard-path: <path>` line
    naming the drift-guard `.types.ts` file (P08 adds the final path when the
    guard is created; P01 records the intended path).
  - the dependency-direction evidence, core-ownership evaluation, and the
    CONCRETE BLOCKER (if retained-duplication) or feasibility proof (if
    single-source).
  P08/P08a/P09/P09a/P13/P13a ALL read this record via the `decision:` and
  `drift-guard-path:` lines. P09 FINALIZES the record with the applied
  outcome; it does not CREATE it.

### Files to Modify
- `project-plans/issue2285/analysis/import-inventory.md` — correct any
  inaccuracies discovered during preflight (e.g. if grep reveals a consumer the
  inventory missed).

## Preflight Checks (worker MUST run each and record evidence)

### 1. Generated artifact policy

```bash
# Confirm dist is gitignored and untracked
grep -n 'dist' .gitignore
git ls-files packages/agents/dist | head -5
# Expected: .gitignore contains 'dist'; ls-files returns nothing.
# Revision 3 finding 20: build also emits .tsbuildinfo side effects.
git ls-files packages/agents | grep -E '\.tsbuildinfo$' | head -5
ls packages/agents/*.tsbuildinfo packages/agents/tsconfig.tsbuildinfo 2>/dev/null || echo "no tracked .tsbuildinfo"
```

Record the output. Policy decision: `dist` is an untracked build artifact;
ignore during source inventory; regenerate with `npm run build`. Any API guard
reading declarations runs against freshly generated output. **Revision 3
finding 20:** running `npm run build`/`tsc --build` also emits `.tsbuildinfo`
files (incremental build cache) as a side effect. These are NOT source
artifacts; they are build cache. The API guard's isolated temp-tsconfig build
(see `analysis/api-guard-mechanism.md` B1) overrides `tsBuildInfoFile` to a
temp path so no `.tsbuildinfo` is written into the package directory. If the
guard ever falls back to a shared-dist build, the worker MUST confirm no
`.tsbuildinfo` is committed (it is gitignored or untracked) and clean it if
present.

### 2. Agents import inventory

```bash
# All bare-root agents imports across the repo (production + tests)
grep -rn "from '@vybestack/llxprt-code-agents'" packages/ --include="*.ts" --include="*.tsx" | grep -v node_modules | grep -v dist

# All internals subpath imports
grep -rn "llxprt-code-agents/internals.js" packages/ --include="*.ts" --include="*.tsx" | grep -v node_modules | grep -v dist

# All deep agents source path imports
grep -rn "llxprt-code-agents/" packages/ --include="*.ts" --include="*.tsx" | grep -v node_modules | grep -v dist | grep -v "llxprt-code-agents'"
```

Classify each hit by category: production CLI, production A2A, other production,
intra-agents, tests, scripts. Compare against
`analysis/import-inventory.md` and correct discrepancies.

### 3. A2A consumers

Confirm the four known A2A compile-breakers and check for any others:

```bash
grep -rn "from '@vybestack/llxprt-code-agents'" packages/a2a-server/src --include="*.ts"
# Expected: config/config.ts (AgentClient, CoreToolScheduler, createTaskToolRegistration),
#           agent/task.ts (AgentClient),
#           agent/task-runtime-helpers.ts (type AgentClient),
#           utils/testing_utils.ts (type CoreToolScheduler)
```

For each, decide migration target:
- `config/config.ts`: `new AgentClient(...)` → `createAgentClient(...)`;
  `new CoreToolScheduler(...)` → `createToolScheduler(...)`;
  `createTaskToolRegistration()` → keep (curated root) OR `createTaskRegistration()`.
- `task.ts`: `new AgentClient(...)` → `createAgentClient(...)`; field type
  `AgentClient` → `AgentClientContract` (core) or internals subpath.
- `task-runtime-helpers.ts`: type `AgentClient` → `AgentClientContract` or
  internals subpath type import.
- `testing_utils.ts`: type `CoreToolScheduler` → `ToolSchedulerContract` or
  internals subpath type import.

For each retained internals subpath use, write a per-use exception record into
`preflight-results.md` explaining why the public factory/type path is
insufficient.

**Revision 3 (architect finding 11 — record exact AgentConfig builders/APIs
for the P04 A2A behavior fixture):** preflight MUST identify and record the
EXACT builder/API for constructing a real `AgentConfig` (not a cast) that the
P04 `config.factory-migration.test.ts` fixture will use. Record in
`preflight-results.md`:
- the exact import path and function name for building a minimal real
  `AgentConfig` (e.g. a config builder in `@vybestack/llxprt-code-core` or a
  test-fixture helper in `@vybestack/llxprt-code-test-utils`),
- the exact stub model-provider seam the fixture will use (the provider
  interface name and how to construct a deterministic fixed-reply stub at that
  seam — NOT a mock of `AgentClient`),
- the exact dispatch method name A2A calls on the constructed client.
If no real builder exists, preflight MUST record that finding so P04 uses the
closest available real construction path (and document the gap). P04's fixture
requirements reference these recorded builders/APIs.

**Architect review finding 1 (A2A test convention):** preflight MUST record
that the A2A package uses COLOCATED test files (e.g. `config.test.ts`,
`task.test.ts`, `testing_utils.test.ts` — all alongside their source, NOT in
`__tests__/` subdirectories). P04 behavior tests will be colocated
(`config.factory-migration.test.ts`, `task.factory-migration.integration.test.ts`).
Record this in `preflight-results.md` section 3 so P04 does not introduce
`__tests__/` subdirectories.

**Architect review finding 2 (record real A2A APIs):** preflight MUST record
the EXACT real A2A APIs that P04 behavior tests will reference. Specifically:
- `agentClient.sendMessageStream(...)` is the dispatch method (async generator),
  NOT a nonexistent `.sendMessage`.
- `Task` has a PRIVATE constructor — instances are created via
  `Task.create(...)` (async static factory), NOT `new Task(...)`.
- Scheduler is obtained via `config.getOrCreateScheduler(...)` and dispatched
  via `scheduler.schedule(...)`.
- Task events are published via `this.eventBus?.publish(...)`.
Record these in `preflight-results.md` section 3 so P04 tests do not reference
nonexistent or incorrect APIs.

**Architect review finding 3 (record exact working test commands):** preflight
MUST record the EXACT working test commands for the A2A and CLI workspaces.
Root `npm run test` runs ALL workspaces (`npm run test --workspaces --if-present`);
root path arguments do NOT reliably filter. Record in `preflight-results.md`
section 3:
- the exact workspace-scoped A2A test command (e.g.
  `npm run test --workspace @vybestack/llxprt-code-a2a-server -- <pattern>`),
- the exact workspace-scoped CLI test command (e.g.
  `npm run test --workspace @vybestack/llxprt-code -- <pattern>`),
- confirmation that root `npm run test -- packages/a2a-server` does NOT
  reliably filter (it runs all workspace tests).
P04/P04a commands MUST use these recorded workspace-scoped commands.

### 4. CLI test compile-breakers

Confirm the known CLI test compile-breakers:

```bash
# CLI tests importing internals-only names from agents root
grep -rn "AgentClient\|CoreToolScheduler\|AgenticLoop" packages/cli/src --include="*.test.ts" --include="*.test.tsx" --include="*.spec.ts" --include="*.spec.tsx" | grep "llxprt-code-agents"
```

Verify each listed file in `import-inventory.md` section 2.3. Confirm whether
`App.*.test.tsx` files import `AgentClient` from `@vybestack/llxprt-code-core`
(NOT agents root) — if so, they do NOT break from agents depollution:

```bash
grep -n "AgentClient" packages/cli/src/ui/App.behavior.test.tsx packages/cli/src/ui/App.test.tsx | head
# Check the import source line specifically
```

### 5. app-service subpath non-scope check

```bash
# Confirm app-service.js is a declared export
grep -A3 '"./app-service.js"' packages/agents/package.json
# Confirm consumers
grep -rn "app-service.js" packages/ --include="*.ts" --include="*.tsx" | grep -v node_modules | grep -v dist | grep -v "packages/agents/src/app-service"
```

Decision: `./app-service.js` is orthogonal to the root internals leak. Do NOT
modify it unless a direct requirement is identified. Record the decision.

### 6. Type/export-map resolution for internals subpath

```bash
# Confirm internals.js is a declared export
grep -A3 '"./internals.js"' packages/agents/package.json
# Expected: types ./dist/src/internals.d.ts, import ./dist/src/internals.js
```

Verify the internals subpath resolves under typecheck and Vitest for legitimate
consumers (tests). After depollution, tests importing
`@vybestack/llxprt-code-agents/internals.js` must still resolve. Confirm by
checking existing test imports of the subpath resolve today:

```bash
grep -rn "llxprt-code-agents/internals.js" packages/ --include="*.ts" --include="*.tsx" | grep -v node_modules | grep -v dist
```

### 7. API guard mechanism decision

Confirm the decision in `analysis/api-guard-mechanism.md` (Option B: parse
freshly emitted declarations — revision 4 architect finding 3: the build
mechanism is an ISOLATED TEMP TSCONFIG that extends the SOURCE-path
`packages/agents/tsconfig.json` — NOT `tsconfig.build.json` — overriding
`outDir` and `tsBuildInfoFile` to a temp directory, invoked via
`tsc -p <temp-tsconfig>`, NOT via `scripts/build_package.js` which has no
outDir override). The source-path `tsconfig.json` resolves dependencies to
SOURCE (`../core/index.ts`), NOT to `../core/dist/index.d.ts`, so the guard
does NOT require dependency `dist/` and is clean-CI safe. Verify that a temp
tsconfig build produces `index.d.ts`:

```bash
# Revision 4 architect finding 10: EXACT executable proof — no <repo-root>
# placeholder. Uses pwd-derived absolute paths and specifies every tsconfig
# field. Extends the SOURCE-path tsconfig.json (not tsconfig.build.json) so
# dependency SOURCE resolves without dependency dist/ (finding 3).
REPO_ROOT="$(pwd)"
TMPDIR_BUILD="$(mktemp -d)"
# Write the temp tsconfig with exact fields.
node -e "
const fs = require('fs');
const path = require('path');
const repoRoot = process.argv[1];
const tmpdir = process.argv[2];
const config = {
  extends: path.join(repoRoot, 'packages/agents/tsconfig.json'),
  compilerOptions: {
    rootDir: path.join(repoRoot, 'packages/agents'),
    outDir: tmpdir,
    tsBuildInfoFile: path.join(tmpdir, '.api-surface.tsbuildinfo'),
    declaration: true,
    noEmit: false,
    composite: false,
  },
  include: [
    path.join(repoRoot, 'packages/agents/index.ts'),
    path.join(repoRoot, 'packages/agents/src/**/*.ts'),
    path.join(repoRoot, 'packages/agents/src/**/*.json'),
  ],
  exclude: [
    'node_modules',
    'dist',
    '**/*.test.ts',
    '**/*.spec.ts',
    path.join(repoRoot, 'packages/agents/src/api/__tests__/fixtures/**'),
  ],
};
fs.writeFileSync(path.join(tmpdir, 'tsconfig.api-surface.json'),
  JSON.stringify(config, null, 2));
" "$REPO_ROOT" "$TMPDIR_BUILD"
# Build declarations into the temp dir.
# Revision 6 architect finding 2: capture BOTH stdout AND stderr to one log —
# TypeScript diagnostics may appear on either stream. The prior revision
# redirected only stderr, so stdout diagnostics were lost.
npx tsc -p "$TMPDIR_BUILD/tsconfig.api-surface.json" > "$TMPDIR_BUILD/tsc-combined.log" 2>&1
TSC_EXIT=$?
# Revision 6 architect finding 1: use a MECHANISM variable and if/else so the
# B1 success branch is skipped when B1a already succeeded. The prior revision
# removed TMPDIR_BUILD inside the B1a block but fell through to the B1 branch,
# which then checked the deleted/wrong index.d.ts path.
MECHANISM=""
# Check for TS6059 or rootDir errors in the COMBINED log (finding 2).
if grep -q 'TS6059\|not under.*rootDir\|rootDir' "$TMPDIR_BUILD/tsc-combined.log" 2>/dev/null; then
  echo "WARN: TS6059/rootDir error detected in B1 temp-tsconfig build."
  echo "Falling back to B1a (rootDir at workspace root) per revision 5 finding 3."
  # B1a: expand rootDir to workspace root
  node -e "
const fs = require('fs');
const path = require('path');
const configPath = path.join(process.argv[1], 'tsconfig.api-surface.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
config.compilerOptions.rootDir = process.argv[2];
fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
" "$TMPDIR_BUILD" "$REPO_ROOT"
  # Finding 2: capture stdout+stderr combined for B1a as well.
  npx tsc -p "$TMPDIR_BUILD/tsconfig.api-surface.json" > "$TMPDIR_BUILD/tsc-combined-b1a.log" 2>&1
  TSC_EXIT_B1A=$?
  if grep -q 'TS6059\|not under.*rootDir' "$TMPDIR_BUILD/tsc-combined-b1a.log" 2>/dev/null; then
    echo "FAIL: B1a (workspace root rootDir) also failed with rootDir error."
    cat "$TMPDIR_BUILD/tsc-combined-b1a.log"
    rm -rf "$TMPDIR_BUILD"
    echo "Record B2 (fresh shared dist) as the fallback mechanism."
    exit 1
  fi
  # B1a: index.d.ts is now at a nested path since rootDir is the workspace root.
  test -f "$TMPDIR_BUILD/packages/agents/index.d.ts" || { echo "FAIL: B1a build did not produce index.d.ts at nested path"; rm -rf "$TMPDIR_BUILD"; exit 1; }
  echo "OK: B1a (workspace root rootDir) produces index.d.ts"
  echo "Record mechanism B1a in api-guard-mechanism.md section 1."
  MECHANISM="B1a"
else
  # No TS6059 error: verify B1 produced index.d.ts at temp-dir root (finding 1:
  # only reached when B1a was NOT taken, so TMPDIR_BUILD is still intact).
  if [ $TSC_EXIT -eq 0 ]; then
    test -f "$TMPDIR_BUILD/index.d.ts" || { echo "FAIL: temp build did not produce index.d.ts at temp-dir root"; rm -rf "$TMPDIR_BUILD"; exit 1; }
    echo "OK: B1 temp build produces index.d.ts"
    echo "Record mechanism B1 in api-guard-mechanism.md section 1."
    MECHANISM="B1"
  else
    echo "FAIL: B1 temp build failed (exit $TSC_EXIT) without TS6059 — investigate:"
    cat "$TMPDIR_BUILD/tsc-combined.log"
    rm -rf "$TMPDIR_BUILD"
    exit 1
  fi
fi
echo "Resolved mechanism: $MECHANISM"
rm -rf "$TMPDIR_BUILD"
```

Confirm the declaration file contains both value and type export declarations
that a parser can extract. Record the mechanism decision (B1 source-path
temp-tsconfig) as confirmed, OR record that B1 is blocked and the fallback is
mechanism B2 (fresh shared `dist` build via
`npm run build --workspace @vybestack/llxprt-code-agents`, wired in CI to run
AFTER `npm run build`) with recorded side-effect tradeoffs (finding 20) and
the CI ordering constraint (finding 3: B2 must run post-build, not in the
pre-build lint job).

**Revision 5 architect finding 3 (rootDir/outside-rootDir proof):** the B1
temp tsconfig sets `rootDir` to `packages/agents` while the source-path
`tsconfig.json` maps dependency packages to SOURCE files outside
`packages/agents` (e.g. `../core/index.ts`). When `declaration: true` and
emission is active, TypeScript may error with
`TS6059: File '...' is not under 'rootDir'`. The preflight MUST prove the
exact config works by running it (the script above) AND checking for `TS6059`
or any rootDir-related error. If the B1 config above fails with a rootDir
error, the preflight MUST try the concrete fallbacks (B1a: expanded rootDir at
workspace root; B1b: same with emitDeclarationOnly; B2: fresh shared dist) and
record which one succeeds. The proof script above captures both `stdout` and
`stderr` so any `TS6059` error is visible. If B1 fails, update the proof to
use `rootDir: repoRoot` (B1a) and check for `index.d.ts` at the nested path
`<tmp>/packages/agents/index.d.ts`. Record the successful mechanism in
`analysis/api-guard-mechanism.md` section 1 as authoritative — P03/P03a/P13/P13a
all read the recorded mechanism.

**Revision 6 architect finding 1 (B1a-fallback control-flow bug):** the prior
revision's script used `grep ... && { ... }` for the B1a fallback, which after
a successful B1a removed `TMPDIR_BUILD` but then fell through into the B1
success branch (`if [ $TSC_EXIT -eq 0 ]`), checking `$TMPDIR_BUILD/index.d.ts`
in the deleted temp dir. The revised script uses a `MECHANISM` variable and an
`if/else` so the B1 branch is only reached when B1a was NOT taken, making the
control flow unambiguous. **Revision 6 architect finding 2 (stdout capture):**
the prior script redirected only `stderr` (`2> tsc-stderr.log`) while
TypeScript diagnostics may appear on `stdout`. The revised script redirects
both streams to a combined log (`> tsc-combined.log 2>&1`) and greps that,
ensuring no diagnostic is missed.

### 8. Runtime factory dependency/ownership decision

Confirm the duplicated `AgentRuntimeFactoryBindings`:

```bash
grep -n "interface AgentRuntimeFactoryBindings" packages/agents/src/api/runtimeFactories.ts
grep -n "interface AgentRuntimeFactoryBindings" packages/providers/src/runtime/runtimeContextFactory.ts
# Confirm dependency direction
grep '"@vybestack/llxprt-code-providers"' packages/agents/package.json
grep '"@vybestack/llxprt-code-agents"' packages/providers/package.json || echo "providers does NOT depend on agents"
```

Evaluate whether core can own the contract (core already owns
`AgentClientFactory`, `ToolSchedulerFactory`, `TaskToolRegistration`):

```bash
grep -rn "AgentClientFactory\|ToolSchedulerFactory\|TaskToolRegistration" packages/core/src --include="*.ts" | grep -v node_modules | grep -v dist | head
```

Record the decision: single-source in core (preferred) OR retained duplication
with compile-time drift guard. Name the exact tsconfig/package command that
would include the drift guard. **Revision 3 finding 12 + architect review
finding 1 (decision record created in P01, NOT P09):** this decision is
AUTHORITATIVE and is CREATED in P01 as
`runtime-factory-contract-decision.md` (listed in "Files to Create" above).
The record MUST contain a machine-greppable `decision:` line
(`decision: single-source` or `decision: retained-duplication`). For
retained-duplication, the record MUST also name the exact drift-guard file
path via a `drift-guard-path:` line (P01 records the intended path; P08
confirms/finalizes it). P08/P08a read this record and branch on it — so it
MUST exist before P08. P09 FINALIZES the record with the applied outcome but
does NOT create it. P09/P13 verification branch on the decision record
(`runtime-factory-contract-decision.md`, created in P01). If single-source is
chosen, P09/P13 do NOT assert core imports unconditionally against a
retained-duplication fallback. If retained-duplication is chosen, the decision
record MUST also name the exact drift-guard file path (a `drift-guard-path:`
line) so P13a reads it rather than hard-coding the guard location (finding 14).

### 9. Current cliSessionDispatch behavior and safe test seams

Read `packages/cli/src/cliSessionDispatch.tsx` and enumerate:
- Exported names (the six cli.tsx imports).
- Internal helper functions.
- Side effects: process.on, process.exit, process.stdout/stderr writes,
  enableMouseEvents/disableMouseEvents, Ink render, appendFileSync.
- Candidate split seams (per `analysis/pseudocode/cli-session-split.md`).

Confirm `validateDnsResolutionOrder` is imported from `cliBootstrap` in
`cli.tsx`, NOT from `cliSessionDispatch`:

```bash
grep -n "validateDnsResolutionOrder" packages/cli/src/cli.tsx
grep -n "validateDnsResolutionOrder" packages/cli/src/cliSessionDispatch.tsx || echo "not in cliSessionDispatch (correct)"
```

Record the safe test seams (replace stdout/stderr, process.exit sentinel, Ink
render recording fake, FS temp sink, mouse/terminal captured spies). Record
that mocking the session-dispatch module itself is FORBIDDEN.

## Verification Gate

ALL preflight checks must pass before ANY implementation phase. If any check
reveals a plan assumption is wrong, update `analysis/import-inventory.md` and
`analysis/api-guard-mechanism.md` FIRST.

## Phase Completion Marker
Create `project-plans/issue2285/.completed/P01.md` with the preflight-results


The marker MUST contain structured diff evidence per the Standard Completion
Marker Template in `overview.md` (architect finding 8): files changed
(`git diff --name-only` of phase-owned files), diff stats (`git diff --stat`),
command outputs (exit status + key output), and tracker evidence (gate items
satisfied + verifier evidence).
summary.
