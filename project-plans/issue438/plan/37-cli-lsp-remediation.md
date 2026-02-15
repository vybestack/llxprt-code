# Phase 37: CLI LSP Wiring & Status Contract Remediation

## Phase ID
`PLAN-20250212-LSP.P37`

## Prerequisites
- Required: Phase 36a completed
- Verification: `grep -r "PLAN-20250212-LSP.P36a" project-plans/issue438/.completed/`

## Why This Phase Exists

P33-P36 proved core/lsp internals and package-level tests, but there are blocker-level
end-user integration gaps that make the feature non-functional in real CLI usage:

1. **CLI settings wiring gap**
   - `packages/cli/src/config/settingsSchema.ts` has no `lsp` key.
   - `packages/cli/src/config/config.ts` does not pass `lsp` into `new Config({...})`.
   - Effect: core always receives `lsp: undefined` → defaults to `{ servers: [] }`.

2. **Status payload contract gap (3-way mismatch)**
   - Orchestrator (`packages/lsp/src/service/orchestrator.ts` L19-22):
     `{ serverId: string; state: 'ok' | 'broken' | 'starting' }`
   - Core type (`packages/core/src/lsp/types.ts` L45-49):
     `{ serverId: LspServerId; healthy: boolean; detail?: string }`
   - CLI rendering (`packages/cli/src/ui/commands/lspCommand.ts` L133-139):
     reads `status?.status` then `status?.healthy` — never reads `state`.
   - Wire flow: orchestrator returns `{state:'ok'}` → RPC passes through verbatim →
     `LspServiceClient.status()` casts to `ServerStatus[]` (drops `state` silently) →
     CLI reads `status`/`healthy` (both undefined) → falls through to `'unavailable'`.
   - Result: every healthy server shows as "unavailable" in real usage.

## Requirements Reopened
- `REQ-CFG-010`, `REQ-CFG-015`, `REQ-CFG-020`, `REQ-CFG-070`
- `REQ-STATUS-020`, `REQ-STATUS-025`, `REQ-STATUS-045`, `REQ-STATUS-050`

## Files In Scope

### Must Modify
| File | Purpose |
|------|---------|
| `packages/cli/src/config/settingsSchema.ts` | Add `lsp` schema entry |
| `packages/cli/src/config/config.ts` | Wire `lsp` into `new Config({...})` |
| `packages/cli/src/config/config.test.ts` | Pass-through integration tests |
| `packages/cli/src/ui/commands/lspCommand.ts` | Fix `state` field handling + type |
| `packages/cli/src/ui/commands/lspCommand.test.ts` | Contract tests for `state` payloads |
| `packages/core/src/lsp/types.ts` | Align `ServerStatus` with wire format |
| `packages/core/src/lsp/lsp-service-client.ts` | Replace unsafe cast with normalizer |

### Must Not Modify (unless required by compile errors introduced in this phase)
- `packages/core/src/config/config.ts`
- `packages/lsp/src/service/orchestrator.ts`
- `packages/lsp/src/channels/rpc-channel.ts`

---

## Implementation Tasks (Sequential — each blocks the next)

### Task 1: Align core `ServerStatus` type with real wire format (MANDATORY)

**File:** `packages/core/src/lsp/types.ts`

The current type is:
```typescript
export interface ServerStatus {
  serverId: LspServerId;
  healthy: boolean;
  detail?: string;
}
```

The real orchestrator wire payload is:
```typescript
{ serverId: string; state: 'ok' | 'broken' | 'starting' }
```

**Required change:**
- Add `state?: 'ok' | 'broken' | 'starting'` to `ServerStatus`.
- Keep `healthy` and `detail` for backward compatibility.
- Add `status?: string` for forward compatibility with CLI's existing field.

**Why first:** All downstream code (client normalization, CLI rendering) depends on this type
being able to represent what actually comes over the wire.

### Task 2: Replace unsafe cast in `LspServiceClient.status()` with normalization

**File:** `packages/core/src/lsp/lsp-service-client.ts` (around line 173-176)

Current code:
```typescript
return (await this.connection.sendRequest('lsp/status')) as ServerStatus[];
```

This silently discards `state` from the real orchestrator response.

**Required change:**
- Create a `normalizeServerStatus(raw: unknown): ServerStatus` function that:
  1. Reads `state` field from raw RPC payload
  2. Maps `state: 'ok'` → `healthy: true`, `state: 'broken'|'starting'` → `healthy: false`
  3. Preserves `serverId`
  4. Sets `detail` from `state` description
  5. Copies `state` field through to output
- Replace the raw cast with: `rawStatuses.map(normalizeServerStatus)`
- **The function MUST be a named export** — not private, not unexported.
  It must be importable for runtime verification (see FPH-7).

**PROHIBITION:** Direct `as ServerStatus[]` cast on raw RPC response is forbidden.
A dedicated normalization function with explicit field mapping is required.

### Task 3: Add `lsp` to CLI settings schema

**File:** `packages/cli/src/config/settingsSchema.ts`

Add top-level `lsp` entry supporting `LspConfig | false`:
- `false` disables LSP entirely
- object with: `servers`, `includeSeverities`, `maxDiagnosticsPerFile`,
  `maxProjectDiagnosticsFiles`, `diagnosticTimeout`, `firstTouchTimeout`, `navigationTools`

**Schema typing constraint:** The `default` value must be typed so that
`InferSettings<typeof SETTINGS_SCHEMA>['lsp']` resolves to a type compatible
with `LspConfig | false | undefined`. Not `{}`. Not `any`.

### Task 4: Wire `effectiveSettings.lsp` into core Config construction

**File:** `packages/cli/src/config/config.ts`

In the `new Config({...})` call (around line 1306-1410), add:
```
lsp: effectiveSettings.lsp,
```

**This is a one-line change.** But it is the critical plumbing that makes the entire
feature reachable by real users.

### Task 5: Fix `/lsp status` to read `state` field from real service payloads

**File:** `packages/cli/src/ui/commands/lspCommand.ts`

Current rawStatus computation (lines 133-139):
```typescript
const rawStatus =
  status?.status ??
  (typeof status?.healthy === 'boolean'
    ? status.healthy ? 'active' : 'broken'
    : 'unavailable');
```

This never reads `state`. The orchestrator returns `state`, not `status` or `healthy`.

**Required field precedence (MANDATORY ORDER):**
1. `state` (this is what the real orchestrator returns)
2. `status` (legacy/alternative fallback)
3. `healthy` boolean (legacy fallback)

**Required `normalizeStatus()` additions:**
- `'ok'` → `'active'` (orchestrator's "healthy" state)

**Required `LspServiceStatusLike` type update:**
- Add `state?: string` field

**Unknown state handling:** Any `state` value not in the known vocabulary
(`ok`, `active`, `starting`, `broken`, `disabled`, `unavailable`, `running`,
`healthy`, `failed`, `error`) MUST map to `'unavailable'`, NOT to `'active'`
or any healthy-implying status.

### Task 6: Add failing contract tests FIRST (RED phase)

**Files:**
- `packages/cli/src/config/config.test.ts` (or `config.integration.test.ts`)
- `packages/cli/src/ui/commands/lspCommand.test.ts`

**Write these tests BEFORE applying implementation fixes from Tasks 1-5.**

#### Config pass-through tests (must use `config.getLspConfig()` — no intermediate variable checks):
1. settings `lsp: false` → `config.getLspConfig()` returns `undefined`
2. settings `lsp: { servers: [{ id: 'x', command: 'x' }] }` → `config.getLspConfig()?.servers[0].id === 'x'`
3. settings has no `lsp` key → `config.getLspConfig()` returns default-enabled shape
4. settings `lsp: { navigationTools: false, servers: [] }` → `config.getLspConfig()?.navigationTools === false`

#### Status contract tests (MUST use wire-format-only fixtures):
1. `{ serverId: 'ts', state: 'ok' }` (no `status`, no `healthy`) → renders `ts: active`
2. `{ serverId: 'ts', state: 'starting' }` → renders `ts: starting`
3. `{ serverId: 'ts', state: 'broken' }` → renders `ts: broken`
4. `{ serverId: 'ts', state: 'unexpected_value' }` → renders `ts: unavailable` (NOT `active`)
5. Mixed payload: some entries with `state`, some with `status` → all render correctly

**CRITICAL ANTI-FRAUD RULE FOR TEST FIXTURES (FPH-10):**
The mock `status()` return MUST use values that DIFFER from the expected rendered output:
- Mock returns `state: 'ok'` → test asserts `'active'` (NOT `'ok'`)
- Mock returns `state: 'broken'` → test asserts `'broken'` (same, OK — it's canonical)
This forces the test to prove normalization logic actually runs. If mock returns
`'active'` and test asserts `'active'`, the test proves nothing.

**Run these tests immediately after writing them — they MUST FAIL (RED).**
Capture raw failure output for completion marker.

### Task 7: Apply implementation fixes and verify GREEN

Apply Tasks 1-5 implementation changes, then re-run the tests from Task 6.
They must now PASS (GREEN). Capture raw passing output for completion marker.

### Task 8: Mutation testing evidence (MANDATORY)

After GREEN phase, demonstrate tests actually depend on production code by
temporarily breaking the implementation in three specific ways:

1. **State field mutation:** In `lspCommand.ts`, temporarily change `state` field
   read to `xstate` (a non-existent field). Run status contract tests.
   They MUST fail. Capture output. Revert.

2. **Normalization bypass mutation:** In `lsp-service-client.ts`, temporarily replace
   the normalization function call with `return rawStatuses as ServerStatus[]`.
   Run normalizer tests. They MUST fail. Capture output. Revert.

3. **Config wiring deletion mutation:** In `config.ts`, temporarily remove the
   `lsp: effectiveSettings.lsp` line. Run config pass-through tests.
   They MUST fail. Capture output. Revert.

**Evidence:** Raw test failure output for each mutation MUST appear in the completion
marker under a "Mutation Testing" section. Missing any = FAIL.

---

## Anti-BS Controls (All Mandatory — Missing Any = FAIL)

### Control 1: No proxy-only evidence
Must include `loadCliConfig(...)`-based test asserting `config.getLspConfig()` outcomes.
Mock-only command context tests are insufficient.

### Control 2: No inferred pass-through claims
Must verify via `config.getLspConfig()` return values. Cannot claim pass-through
by checking intermediate variables or schema structure alone.

### Control 3: No status-shape handwaving
Must include explicit `state`-only payload tests. If contract tests include
`healthy` or `status` fields alongside `state`, they prove nothing about `state` handling.

### Control 4: No field precedence ambiguity
Implementation must evaluate `state` BEFORE `status` BEFORE `healthy`.
Verification must include a mixed-payload test proving precedence.

### Control 5: No broad "all tests pass" substitution
Must run P37a targeted commands with raw output snippets in completion marker.

### Control 6: No silent scope reduction
Cannot skip schema update, constructor wiring, status mapping, type alignment,
or client normalization. All Tasks 1-7 are blocker-level.

### Control 7: No type escape hatches in production code
No new `as any`, `as unknown as`, `@ts-ignore`, or `@ts-expect-error` in modified
production files. Test utilities may use casts when structurally necessary.

### Control 8: No unrelated file churn
Diffs must be limited to in-scope files unless compile fixes require otherwise.

### Control 9: RED/GREEN evidence required
Completion marker MUST include raw RED output (tests failing before fix)
and raw GREEN output (tests passing after fix). Missing either = FAIL.

### Control 10: No unsafe RPC cast
`LspServiceClient.status()` must NOT use `as ServerStatus[]` on raw RPC response.
Must use a dedicated normalization function with explicit field mapping.

### Control 11: Unknown state safety
A test with `state: 'unexpected_value'` must produce `'unavailable'`, not any
healthy-implying status. Silent promotion of unknown states to healthy = FAIL.

### Control 12: Wire-format-only test fixtures
At least one contract test suite must use fixtures containing ONLY `{ serverId, state }`
with no `healthy`, `status`, or `detail` fields present.

---

## Fraud-Prevention Hardening (All Mandatory — Missing Any = FAIL)

These controls address specific implementation fraud patterns observed in P03-P36.

### FPH-1: Mutation Testing Gate
See Task 8. Three mutations, three failure captures, three reverts. All mandatory.

### FPH-2: No Mock-Only Status Tests
At least ONE of these must exist:
- A unit test for `normalizeServerStatus` that imports the REAL function (no `vi.mock`, no `vi.fn`).
- An integration-style test that flows real wire payloads through `normalizeServerStatus`.

Tests that only verify mock wiring (`mock returns X, component displays X`) prove nothing.

### FPH-3: Assertion Density Minimum
Each new test case MUST contain at least one **value-specific assertion**:
- `expect(content).toContain('  ts: active')` [OK] (specific value)
- `expect(result.healthy).toBe(true)` [OK] (specific value)
- `toEqual({ serverId: 'ts', healthy: true, state: 'ok' })` [OK] (full shape)

NOT sufficient as sole assertion:
- `expect(result).toBeDefined()` [ERROR]
- `expect(result).toBeTruthy()` [ERROR]
- `expect(fn).toHaveBeenCalled()` [ERROR]

### FPH-4: Anti-Stub Detection
Before marking complete, run stub/placeholder detectors on all modified production files.
Any TODO, FIXME, "not implemented", empty function body = investigation required.

### FPH-5: Exact Output Matching
Completion marker must include EXACT full terminal output (not summaries) for
targeted test commands, including individual test names and pass/fail counts.
Fabrication detection: test description strings in output must match the actual
`it('...')` strings in the test file.

### FPH-6: Cross-File Type Consistency
Extract `state` enum values from orchestrator, core types, client normalizer,
CLI normalizeStatus, and test fixtures. `ok`, `broken`, `starting` must appear
in ALL five locations. Missing from any = broken contract.

### FPH-7: Runtime Behavioral Proof
After tests pass, run a standalone script that imports `normalizeServerStatus`
and calls it with real payloads outside the test runner. Must print
`P37-RUNTIME-PROOF: PASS`. This requires the function to be a named export.

### FPH-8: Import-Chain Verification
Verify `normalizeServerStatus` is exported, `ServerStatus.state` field exists,
`LspServiceStatusLike.state` exists, and `rawStatus` reads `state` first.

### FPH-9: Diff Size Sanity
Expected approximate ranges:
| File | Expected Added | Suspicious If |
|------|---------------|---------------|
| `types.ts` | 2-5 lines | >20 or 0 |
| `lsp-service-client.ts` | 15-40 lines | >100 or <5 |
| `settingsSchema.ts` | 15-50 lines | >150 or 0 |
| `config.ts` | 1-3 lines | >20 or 0 |
| `lspCommand.ts` | 5-15 lines | >50 or 0 |
| `lspCommand.test.ts` | 40-100 lines | <20 or >300 |

0 lines changed on ANY in-scope file = task was skipped = FAIL.

### FPH-10: No Self-Fulfilling Mock Prophecy
New state tests must use mock values that DIFFER from rendered output:
- Mock `state: 'ok'` → assert rendered `'active'` (not `'ok'`)
- This forces proof that normalization runs.

---

## Required Code Markers

```typescript
/**
 * @plan PLAN-20250212-LSP.P37
 * @requirement REQ-CFG-010
 * @requirement REQ-STATUS-020
 */
```

## Verification
Run `project-plans/issue438/plan/37a-cli-lsp-remediation-verification.md`.
Do not mark P37 complete until P37a passes.

## Failure Recovery
1. Revert only P37-related file edits.
2. Re-open P37 with failing command output.
3. Do not advance to merge/PR-ready state.

## Phase Completion Marker
Create: `project-plans/issue438/.completed/P37.md`

Required contents:
- Files changed (list)
- RED output snippet (tests failing before implementation)
- GREEN output snippet (tests passing after implementation)
- Mutation testing section (3 mutations, 3 failure outputs, 3 reverts)
- P37a command outputs
- Per-control confirmation (Controls 1-12)
- Per-FPH confirmation (FPH 1-10)
