# Phase 37a: CLI LSP Remediation Verification

## Phase ID
`PLAN-20250212-LSP.P37a`

## Prerequisites
- Required: Phase 37 implementation done
- Verification:
  - `grep -n "PLAN-20250212-LSP.P37" packages/cli/src/config/config.test.ts`
  - `grep -n "PLAN-20250212-LSP.P37" packages/cli/src/ui/commands/lspCommand.test.ts`
  - `grep -n "normalizeServerStatus" packages/core/src/lsp/lsp-service-client.ts`

---

## GATE 0: Pre-flight Baseline

Record baseline pass counts before any P37 changes.

```bash
npx vitest run packages/cli/src/config/config.test.ts --reporter=verbose 2>&1 | tail -5
npx vitest run packages/cli/src/ui/commands/lspCommand.test.ts --reporter=verbose 2>&1 | tail -5
npx vitest run packages/core/src/lsp/__tests__/lsp-service-client.test.ts --reporter=verbose 2>&1 | tail -5
npx tsc --noEmit -p packages/cli/tsconfig.json
npx tsc --noEmit -p packages/core/tsconfig.json
```

**FAIL if:** any baseline command fails before P37 work begins.

---

## GATE 1: RED Evidence - New Tests Must Fail Before Fixes

Run new tests written in P37 Task 6 BEFORE applying Tasks 1-5 implementation.

```bash
# RED-1: state payload tests (must fail - lspCommand doesn't read state yet)
npx vitest run packages/cli/src/ui/commands/lspCommand.test.ts -t "state" --reporter=verbose

# RED-2: lsp config pass-through tests (must fail - schema/wiring doesn't exist yet)
npx vitest run packages/cli/src/config/config.test.ts -t "lsp" --reporter=verbose
```

**Expected:** At least one failure in each command.

**FAIL if:** Any new test passes before implementation (means test doesn't actually test the gap).
**FAIL if:** Any EXISTING test broke (means test code is incorrect).
**FAIL if:** RED output is missing from completion marker.

---

## GATE 2: Structural Verification - Implementation Artifacts Exist

```bash
# S-1: lsp schema entry exists in settingsSchema
grep -c "lsp" packages/cli/src/config/settingsSchema.ts

# S-2: lsp wired into Config constructor
grep -n "lsp:" packages/cli/src/config/config.ts | grep -i "effectiveSettings\|settings"

# S-3: state field handled in lspCommand before status/healthy
# Must show state appearing before status in the rawStatus computation
grep -A5 "rawStatus" packages/cli/src/ui/commands/lspCommand.ts

# S-4: core ServerStatus type includes state
grep "state" packages/core/src/lsp/types.ts

# S-5: normalizeServerStatus function exists and is EXPORTED in lsp-service-client
grep -n "export.*normalizeServerStatus\|export function normalize" packages/core/src/lsp/lsp-service-client.ts

# S-6: no raw cast remaining in status() method
grep -n "as ServerStatus\[\]" packages/core/src/lsp/lsp-service-client.ts

# S-7: LspServiceStatusLike includes state field
grep "state" packages/cli/src/ui/commands/lspCommand.ts

# S-8: normalizeStatus handles 'ok' input
grep "'ok'" packages/cli/src/ui/commands/lspCommand.ts
```

**FAIL if:** S-1 through S-5, S-7, S-8 show no matches.
**FAIL if:** S-6 matches inside `status()` method (unsafe cast still present).

---

## GATE 3: GREEN Evidence - New Tests Must Pass After Fixes

```bash
# GREEN-1: state payload tests now pass
npx vitest run packages/cli/src/ui/commands/lspCommand.test.ts -t "state" --reporter=verbose

# GREEN-2: lsp config pass-through tests now pass
npx vitest run packages/cli/src/config/config.test.ts -t "lsp" --reporter=verbose
```

**Expected:** Zero failures.

**FAIL if:** Any new test still fails.
**FAIL if:** GREEN output is missing from completion marker.

---

## GATE 4: Targeted Regression - No Existing Tests Broken

```bash
# R-1: Full CLI config test suite
npx vitest run packages/cli/src/config/config.test.ts --reporter=verbose 2>&1 | tail -5

# R-2: Full CLI config integration tests
npx vitest run packages/cli/src/config/config.integration.test.ts --reporter=verbose 2>&1 | tail -5

# R-3: Full lspCommand test suite
npx vitest run packages/cli/src/ui/commands/lspCommand.test.ts --reporter=verbose 2>&1 | tail -5

# R-4: Core config LSP integration tests
npx vitest run packages/core/src/config/config-lsp-integration.test.ts --reporter=verbose 2>&1 | tail -5

# R-5: Core LSP client tests
npx vitest run packages/core/src/lsp/__tests__/lsp-service-client.test.ts --reporter=verbose 2>&1 | tail -5

# R-6: Core LSP client integration tests
npx vitest run packages/core/src/lsp/__tests__/lsp-service-client-integration.test.ts --reporter=verbose 2>&1 | tail -5

# R-7: Core LSP system integration tests
npx vitest run packages/core/src/lsp/__tests__/system-integration.test.ts --reporter=verbose 2>&1 | tail -5

# R-8: Core LSP e2e tests
npx vitest run packages/core/src/lsp/__tests__/e2e-lsp.test.ts --reporter=verbose 2>&1 | tail -5
```

**Expected:** All pass, zero failures. Pass count >= baseline + new tests.

**FAIL if:** Any regression command shows failures.

---

## GATE 5: Type and Lint Gates

```bash
# T-1: CLI TypeScript compilation
npx tsc --noEmit -p packages/cli/tsconfig.json

# T-2: Core TypeScript compilation
npx tsc --noEmit -p packages/core/tsconfig.json

# T-3: Lint changed files
npx eslint packages/cli/src/config/config.ts packages/cli/src/config/settingsSchema.ts packages/cli/src/ui/commands/lspCommand.ts packages/core/src/lsp/types.ts packages/core/src/lsp/lsp-service-client.ts
```

**Expected:** All exit 0.

**FAIL if:** Any compile or lint error.

---

## GATE 6: Anti-BS Enforcement

```bash
# AB-1: No type escape hatches in production files
grep -rn "as any\|@ts-ignore\|@ts-expect-error" \
  packages/cli/src/config/settingsSchema.ts \
  packages/cli/src/config/config.ts \
  packages/cli/src/ui/commands/lspCommand.ts \
  packages/core/src/lsp/types.ts \
  packages/core/src/lsp/lsp-service-client.ts

# AB-2: No raw ServerStatus cast in client status method
grep -A3 "sendRequest.*lsp/status" packages/core/src/lsp/lsp-service-client.ts

# AB-3: Scope guard - only expected files changed
git diff --name-only

# AB-4: Wire-format-only test exists (fixture with state but no healthy/status)
grep -B2 -A5 "state: 'ok'" packages/cli/src/ui/commands/lspCommand.test.ts | grep -v "healthy\|status:"

# AB-5: Unknown state test exists
grep -A5 "unexpected" packages/cli/src/ui/commands/lspCommand.test.ts
```

**Expected:**
- AB-1: No matches in production code (test files may have casts)
- AB-2: Shows normalization function call, NOT `as ServerStatus[]`
- AB-3: Lists only P37 in-scope files + plan docs
- AB-4: Shows test with `state: 'ok'` and no companion `healthy`/`status` field
- AB-5: Shows test asserting unknown state maps to `unavailable`

**FAIL if:** AB-1 finds new production-code type escapes.
**FAIL if:** AB-2 shows raw cast.
**FAIL if:** AB-4 or AB-5 find no matches.

---

## GATE 7: Fraud-Prevention Hardening Verification

### FPH-V1: Mutation Test Evidence

The implementer must provide raw terminal output proving tests fail when
implementation is temporarily broken. Three mutations required:

```bash
# Mutation 1: Break state field read in lspCommand
# Temporarily change `status?.state` to `status?.xstate` in rawStatus computation
# Then run:
npx vitest run packages/cli/src/ui/commands/lspCommand.test.ts -t "state" --reporter=verbose 2>&1
# MUST show failures. Capture output. Revert change.

# Mutation 2: Remove normalization in lsp-service-client
# Temporarily replace normalizeServerStatus call with `as ServerStatus[]` cast
# Then run:
npx vitest run packages/core/src/lsp/__tests__/lsp-service-client.test.ts --reporter=verbose 2>&1
# MUST show failures if normalization tests exist. Capture output. Revert change.

# Mutation 3: Remove config wiring
# Temporarily delete `lsp: effectiveSettings.lsp` line from config.ts
# Then run:
npx vitest run packages/cli/src/config/config.test.ts -t "lsp" --reporter=verbose 2>&1
# MUST show failures. Capture output. Revert change.
```

**FAIL if:** Any mutation does NOT cause test failures (means tests don't actually
depend on the implementation). Missing evidence = automatic FAIL.

### FPH-V2: Mock Audit - No Self-Fulfilling Prophecies

```bash
# Find test cases where mock state value differs from asserted rendered value
# This proves normalization/mapping logic actually runs

echo "=== Tests where mock state differs from rendered output ==="
grep -B15 "toContain.*: active" packages/cli/src/ui/commands/lspCommand.test.ts | \
  grep "state:" | grep -v "active"

echo "=== Tests where mock state differs from rendered output (broken) ==="
grep -B15 "toContain.*: broken" packages/cli/src/ui/commands/lspCommand.test.ts | \
  grep "state:" | grep -v "broken"
```

**Expected:** At least one match per query (mock value != rendered value).
**FAIL if:** All test mocks use pre-normalized values.

### FPH-V3: Stub/Placeholder Detection

```bash
# Check for TODO/FIXME/placeholder/not-implemented in modified production files
grep -rn "TODO\|FIXME\|HACK\|placeholder\|not.implemented\|stub" \
  packages/core/src/lsp/lsp-service-client.ts \
  packages/cli/src/ui/commands/lspCommand.ts \
  packages/core/src/lsp/types.ts \
  packages/cli/src/config/settingsSchema.ts \
  packages/cli/src/config/config.ts

# Check for empty/trivial function bodies
grep -Pn '(function|=>)\s*\{(\s*|\s*return\s*(undefined|null|\[\]|\{\}|true|false);?\s*)\}' \
  packages/core/src/lsp/lsp-service-client.ts \
  packages/cli/src/ui/commands/lspCommand.ts
```

**FAIL if:** Any suspicious stub found in a function P37 was supposed to implement.

### FPH-V4: Required Test Name Verification

```bash
# These patterns MUST each have >= 1 match in the test file
for pattern in "state.*ok\|state: 'ok'" "state.*starting\|state: 'starting'" \
               "state.*broken\|state: 'broken'" "unexpected"; do
  count=$(grep -c "$pattern" packages/cli/src/ui/commands/lspCommand.test.ts)
  echo "Pattern '$pattern': $count matches"
  if [ "$count" -eq 0 ]; then
    echo "  ** MISSING REQUIRED TEST **"
  fi
done
```

**FAIL if:** Any required pattern shows 0 matches.

### FPH-V5: Cross-File Contract Consistency

```bash
echo "=== State values across codebase ==="

echo "Orchestrator emits:"
grep -oP "state: '[^']+" packages/lsp/src/service/orchestrator.ts | sort -u

echo "Core type accepts:"
grep -oP "'ok'|'broken'|'starting'" packages/core/src/lsp/types.ts | sort -u

echo "Client normalizer handles:"
grep -oP "=== 'ok'|=== 'broken'|=== 'starting'|case 'ok'|case 'broken'|case 'starting'" \
  packages/core/src/lsp/lsp-service-client.ts | sort -u

echo "CLI normalizeStatus handles:"
grep -oP "case '[^']+" packages/cli/src/ui/commands/lspCommand.ts | sort -u

echo "Test fixtures use:"
grep -oP "state: '[^']+" packages/cli/src/ui/commands/lspCommand.test.ts | sort -u
```

**Required invariant:** `ok`, `broken`, `starting` must appear in ALL five locations.

### FPH-V6: Runtime Behavioral Proof

```bash
npx tsx -e "
  const { normalizeServerStatus } = await import('./packages/core/src/lsp/lsp-service-client.js');
  const r1 = normalizeServerStatus({ serverId: 'ts', state: 'ok' });
  const r2 = normalizeServerStatus({ serverId: 'py', state: 'broken' });
  const r3 = normalizeServerStatus({ serverId: 'go', state: 'starting' });
  const r4 = normalizeServerStatus({ serverId: 'x', state: 'asdf' });
  console.log(JSON.stringify({ r1, r2, r3, r4 }));
  if (r1.healthy !== true) throw new Error('ok should be healthy');
  if (r2.healthy !== false) throw new Error('broken should be unhealthy');
  if (r3.healthy !== false) throw new Error('starting should be unhealthy');
  if (r4.healthy !== false) throw new Error('unknown should be unhealthy');
  if (r1.state !== 'ok') throw new Error('state not preserved');
  console.log('P37-RUNTIME-PROOF: PASS');
"
```

**FAIL if:** Output does not contain `P37-RUNTIME-PROOF: PASS`.
**FAIL if:** `normalizeServerStatus` is not a named export from `lsp-service-client.ts`.

### FPH-V7: No Existence-Only Assertions in New Tests

```bash
# Count weak-only assertions in new state test blocks
grep -A20 "it\('.*state\|it\('.*wire\|it\('.*contract" \
  packages/cli/src/ui/commands/lspCommand.test.ts | \
  grep -c "toBeDefined\|toBeTruthy\|toBeInstanceOf\|toHaveBeenCalled[^W]"
```

**Expected:** 0 (no existence-only assertions as sole assertion in new state tests).

### FPH-V8: Diff Size Sanity

```bash
git diff --stat HEAD -- \
  packages/core/src/lsp/types.ts \
  packages/core/src/lsp/lsp-service-client.ts \
  packages/cli/src/config/settingsSchema.ts \
  packages/cli/src/config/config.ts \
  packages/cli/src/ui/commands/lspCommand.ts \
  packages/cli/src/ui/commands/lspCommand.test.ts
```

**FAIL if:** Any in-scope file shows 0 lines changed (task was skipped).
**WARNING if:** `config.ts` shows >20 lines changed (should be ~1-3 line change).
**WARNING if:** `lspCommand.test.ts` shows <20 lines added (insufficient tests).

---

## Semantic Verification Checklist

### Config path is real
- [ ] `settingsSchema.ts` contains top-level `lsp` setting with correct type inference
- [ ] `loadCliConfig` passes `effectiveSettings.lsp` into `new Config({...})`
- [ ] Test: `lsp: false` -> `getLspConfig()` is `undefined`
- [ ] Test: `lsp: { servers: [{id:'x', command:'x'}] }` -> `getLspConfig()?.servers[0].id === 'x'`
- [ ] Test: no `lsp` key -> `getLspConfig()` returns default-enabled shape
- [ ] Test: `navigationTools: false` preserved through pass-through

### Status path is real
- [ ] `LspServiceStatusLike` type includes `state?: string`
- [ ] rawStatus computation checks `state` BEFORE `status` BEFORE `healthy`
- [ ] `normalizeStatus('ok')` returns `'active'`
- [ ] Test: wire-format `{serverId, state:'ok'}` -> renders `active`
- [ ] Test: wire-format `{serverId, state:'starting'}` -> renders `starting`
- [ ] Test: wire-format `{serverId, state:'broken'}` -> renders `broken`
- [ ] Test: unknown `{serverId, state:'xyz'}` -> renders `unavailable`
- [ ] Output remains alphabetically ordered with built-ins + configured

### Client normalization is real
- [ ] `normalizeServerStatus()` function exists and is exported in lsp-service-client.ts
- [ ] No `as ServerStatus[]` cast on raw RPC response
- [ ] `state: 'ok'` -> `healthy: true`
- [ ] `state: 'broken'` -> `healthy: false`
- [ ] `state: 'starting'` -> `healthy: false`
- [ ] `state` field preserved in output

### Type contract is real
- [ ] `ServerStatus` in types.ts includes `state?: 'ok' | 'broken' | 'starting'`
- [ ] No new `as any` / `@ts-ignore` in production files
- [ ] Both `packages/cli` and `packages/core` compile cleanly

### Evidence quality
- [ ] RED output captured before fixes
- [ ] GREEN output captured after fixes
- [ ] Mutation test outputs captured (3 mutations, 3 failures, 3 reverts)
- [ ] All 8 regression commands pass
- [ ] All 3 compile/lint commands pass
- [ ] All 6 anti-BS checks pass
- [ ] All 8 fraud-prevention checks pass

---

## Verdict
- **PASS** only if ALL gates (0-7) pass and ALL checklist items are checked.
- Any missing RED/GREEN evidence = automatic **FAIL**.
- Any missing mutation test evidence (FPH-V1) = automatic **FAIL**.
- Any self-fulfilling mock prophecy (FPH-V2) = automatic **FAIL**.
- Any remaining `as ServerStatus[]` cast = automatic **FAIL**.
- Any unknown state mapping to healthy = automatic **FAIL**.
- Any 0-diff in-scope file = automatic **FAIL**.
- Any missing `P37-RUNTIME-PROOF: PASS` = automatic **FAIL**.

## Failure Recovery
1. Return to P37 implementation.
2. Fix only failing scope.
3. Re-run P37a from GATE 3 onward (no need to re-capture RED if already captured).

## Phase Completion Marker
Create: `project-plans/issue438/.completed/P37a.md`

Required contents:
- GATE 0 baseline output
- GATE 1 RED output
- GATE 3 GREEN output
- GATE 4 regression summaries
- GATE 5 compile/lint output
- GATE 6 anti-BS output
- GATE 7 fraud-prevention outputs:
  - FPH-V1: Three mutation test failure outputs
  - FPH-V2: Mock audit showing value transformations
  - FPH-V3: Stub detection scan results
  - FPH-V4: Required test name verification
  - FPH-V5: Cross-file contract consistency table
  - FPH-V6: Runtime behavioral proof output (must contain `P37-RUNTIME-PROOF: PASS`)
  - FPH-V7: Weak assertion count (must be 0)
  - FPH-V8: Diff size summary
- Checked semantic verification checklist
- Final PASS/FAIL statement
