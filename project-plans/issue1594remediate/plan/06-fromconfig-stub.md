<!-- @plan:PLAN-20260621-COREAPIREMED.P06 @requirement:REQ-001,REQ-INT-001 -->
# Phase 06: Config-Injection Seam — Stub (`fromConfig`)

## Phase ID

`PLAN-20260621-COREAPIREMED.P06`

## LLxprt Code Subagent: typescriptexpert

## Prerequisites

- Required: Phase 05a completed (PASS)
- Verification: `test -f project-plans/issue1594remediate/.completed/P05a.md`
- Preflight (P00a) MUST be complete.
- The providers-package `providerManager?` adoption seam (P03–P05) MUST be merged first, so
  `fromConfig` can pass the adopted manager into `createIsolatedRuntimeContext` (REQ-005.2).

## Requirements Implemented (Expanded)

### REQ-001: Config-injection seam (`fromConfig`)

**Full Text**: The agents public API MUST provide a way to construct an `Agent` from an
already-built core `Config` (and its already-assembled provider runtime), WITHOUT
re-constructing `Config` internally and WITHOUT breaking the existing
`createAgent(AgentConfig)` path. The seam is exposed as a new public function
`fromConfig(options: FromConfigOptions)` returning `Promise<Agent>`.

**Behavior**:
- GIVEN: a caller holds a fully-loaded `Config`
- WHEN: they call `fromConfig({ config })`
- THEN: an `Agent` is returned whose `getConfig()` is the SAME `Config` instance (no new Config)

**Why This Matters**: The CLI (#1595) already builds a `Config` via `loadCliConfig`; without this
seam there is no way to hand it to the public API, so the CLI cannot become a thin UI.

### REQ-INT-001: CLI Config adoption (integration)

**Full Text**: `fromConfig` MUST adopt the supplied `Config` such that the agent's settings,
provider runtime, and message bus operate on the SAME instances the caller already wired.

**Behavior**:
- GIVEN: a caller-built `Config` with a known `SettingsService`
- WHEN: `fromConfig({ config })` returns an `Agent`
- THEN: `agent.getConfig().getSettingsService()` is identical to the caller's instance

## Implementation Tasks

### Files to Create

> **Reconciliation with the "UPDATE existing files" mandate (CRIT-4).** `fromConfig` is a NET-NEW
> public entrypoint — NOT a V2/parallel reimplementation of `createAgent`. The "do NOT create
> parallel versions" rule forbids `createAgentV2.ts` / duplicate-of-an-existing-function files; it
> does NOT forbid a genuinely new public function getting its own small module. To keep exactly ONE
> createAgent-assembly/finalize code path, `fromConfig` MUST reuse the SAME shared finalize helper
> `createAgent` uses — `finalizeAgent(...)` (currently in `createAgent.ts`; it performs runtime-state
> build → post-auth client bind → `rebuildLoop` → `assembleFacade` → SessionStart, steps 105–166).
> The P09 impl extracts/shares `finalizeAgent` (export it from `createAgent.ts` or a shared module
> both import) and `fromConfig` calls it; assembly/finalize logic is NEVER copy-pasted into
> `fromConfig.ts`. P09 verification asserts this (both call `finalizeAgent`; no duplicated finalize).

- `packages/agents/src/api/fromConfig.ts`
  - Export `async function fromConfig(options: FromConfigOptions): Promise<Agent>`
  - STUB body: `throw new Error('NotYetImplemented')` (do NOT implement logic yet)
  - The eventual impl (P09) DELEGATES to the shared `finalizeAgent(...)` helper (see reconciliation
    note above) — it does NOT reimplement `createAgent`'s assembly/finalize sequence.
  - MUST include marker block: `@plan:PLAN-20260621-COREAPIREMED.P06`, `@requirement:REQ-001`

### Files to Modify

- `packages/agents/src/api/config-types.ts` (CANONICAL — do NOT create a parallel `fromConfig-types.ts`/V2 file; per `specification.md` the `fromConfig` types live in the existing `config-types.ts`)
  - ADD `import type { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';`
  - Export `interface FromConfigOptions { readonly config: Config; readonly messageBus?: MessageBus; readonly onApproval?: ApprovalHandler; readonly onOAuthPrompt?: OAuthPromptHandler; readonly editorCallbacks?: EditorCallbacks; readonly toolSchedulerFactory?: AgentSchedulerFactory; readonly sessionId?: string; }`
    - The OPTIONAL `messageBus?: MessageBus` field (CRIT-2) is how the caller (#1595) hands the
      SHARED session bus to `fromConfig`. `Config` exposes NO `getMessageBus()` accessor (verified),
      so the bus CANNOT be read back off the Config — it MUST be passed in here and forwarded into
      the EXISTING `createIsolatedRuntimeContext({ messageBus })` seam.
  - Export Zod `FromConfigValidatableSchema` (validates `{ sessionId?: string }` only — `config`
    and `messageBus` are runtime objects, not schema-validated)
  - MUST include marker block.

- `packages/agents/src/api/index.ts`
  - ADD `export { fromConfig } from './fromConfig.js';`
  - ADD `export type { FromConfigOptions } from './config-types.js';`
  - ADD marker comment `@plan:PLAN-20260621-COREAPIREMED.P06`

- `packages/agents/src/api/agent.ts` (CRIT-2: `getConfig()` TYPE SURFACE is intrinsic to the Config-adoption seam)
  - ADD `getConfig(): Config;` to the public `Agent` interface. Import the `Config` type if not
    already imported. Declaring an interface member is TYPE SURFACE (allowed in a stub phase) — it is
    NOT behavior; the behavior is deferred to P09 (CRIT-2).
  - WHY HERE (not the settings surface): `getConfig()` identity is the load-bearing assertion of the
    EARLY parity slice (P07/EP1: `agent.getConfig() === config`) and the fromConfig TDD (P08/T1). The
    slice cannot COMPILE — and P09 cannot turn it GREEN — unless `getConfig` is on the `Agent` type
    BEFORE P07. It is shared by C1 (identity of the ADOPTED Config) and C2 (settings projection); the
    settings surface (P10–P12) REFERENCES this same `getConfig`, it does NOT re-declare it. The
    SINGLE-DECLARATION invariant holds: `getConfig` is declared EXACTLY ONCE on the interface, HERE
    at P06; only its IMPLEMENTATION moves to P09.

- `packages/agents/src/api/agentImpl.ts` (CRIT-2: `getConfig` is a NotYetImplemented STUB here — the REAL impl lands at P09)
  - ADD `getConfig(): Config { throw new Error('NotYetImplemented'); }` — a throwing stub that
    SATISFIES the interface type (so the P07 spec COMPILES) but exhibits NO behavior. Per strict TDD,
    the real `return this.deps.config` identity behavior is load-bearing for C1 (adopted-Config
    identity) and C2 (settings projection), so it MUST be written in response to a RED test (P07/P08),
    NOT in this stub phase. The real impl is added at P09 (the GREEN phase). Until then BOTH the
    `fromConfig` stub AND this `getConfig` stub throw `NotYetImplemented`, making P07/EP1 and P08/T1
    RED for a BEHAVIORAL reason.
  - This stub phase implements NO real behavior; `fromConfig` and `getConfig` are both
    NotYetImplemented stubs. Do NOT add `getEphemeralSetting`/`setEphemeralSetting`/
    `getEphemeralSettings` here — those belong to the settings surface (P10–P12).
  - Markers: `@plan:PLAN-20260621-COREAPIREMED.P06`, `@requirement:REQ-001` (cross-ref REQ-002).

### Constraints (RULES.md)

- Strict TS: NO `any`, NO assertions, explicit return types.
- UPDATE existing files; do NOT create `createAgentV2`/parallel versions.
- Stub may throw `NotYetImplemented`; tests MUST NOT assert that (no reverse testing).
- Marker blocks only; no explanatory prose comments.

## Verification Commands

```bash
set -e
test -f packages/agents/src/api/fromConfig.ts || { echo "MISSING fromConfig.ts"; exit 1; }
grep -q "export async function fromConfig" packages/agents/src/api/fromConfig.ts || { echo "MISSING export"; exit 1; }
# FromConfigOptions lives in the CANONICAL config-types.ts (no parallel V2 file) — MIN-2
grep -q "FromConfigOptions" packages/agents/src/api/config-types.ts || { echo "MISSING FromConfigOptions in config-types.ts"; exit 1; }
# No parallel/V2 types file may be introduced
if [ -f packages/agents/src/api/fromConfig-types.ts ]; then echo "FAIL: parallel fromConfig-types.ts created — use config-types.ts"; exit 1; fi
# CRIT-2: caller-supplied MessageBus field is declared on FromConfigOptions
grep -qE "messageBus\?: MessageBus" packages/agents/src/api/config-types.ts || { echo "FAIL: FromConfigOptions missing messageBus?: MessageBus"; exit 1; }
grep -q "fromConfig" packages/agents/src/api/index.ts || { echo "NOT exported from index"; exit 1; }
# CRIT-2: getConfig() is DECLARED on the Agent interface HERE (type surface, allowed in a stub
# phase), so the P07 early parity slice + P08 TDD can COMPILE and reference identity. Its IMPL is a
# NotYetImplemented STUB here — the REAL `return this.deps.config` behavior is deferred to P09 (GREEN)
# per strict TDD. SINGLE-DECLARATION invariant: declared exactly once, at P06.
grep -q "getConfig(): Config" packages/agents/src/api/agent.ts || { echo "FAIL: getConfig() not declared on the Agent interface (CRIT-2)"; exit 1; }
# Single-declaration invariant: getConfig is declared EXACTLY ONCE on the interface (P06).
DECL=$(grep -cE "getConfig\(\)\s*:\s*Config\s*;" packages/agents/src/api/agent.ts)
if [ "$DECL" -ne 1 ]; then echo "FAIL: getConfig must be declared exactly once on the Agent interface (CRIT-2); found $DECL"; exit 1; fi
# The agentImpl getConfig body MUST be a NotYetImplemented stub (NO real behavior in the stub phase).
# MIN-4 (formatting-tolerant): Prettier formats the stub body across MULTIPLE lines
# (`getConfig(): Config {\n    throw new Error('NotYetImplemented');\n  }`), so a line-based grep with
# `[^}]*` (which cannot span a newline) would FALSELY FAIL on the correctly-formatted file. Normalize
# ALL whitespace (incl. newlines) to single spaces FIRST, then match — identical technique to the
# adoption-`??` gate (P05a) and the property-gate portability fix (CCF-1).
IMPL_NORM=$(tr -s '[:space:]' ' ' < packages/agents/src/api/agentImpl.ts)
printf '%s' "$IMPL_NORM" | grep -qE "getConfig\(\)\s*:\s*Config\s*\{[^}]*NotYetImplemented" || { echo "FAIL: getConfig must be a NotYetImplemented stub in P06 (real impl is deferred to P09 — CRIT-2)"; exit 1; }
# The getConfig stub must NOT yet return this.deps.config — that real behavior is added at P09.
# (Also whitespace-normalized so the negative guard still catches a multi-line real impl.)
if printf '%s' "$IMPL_NORM" | grep -qE "getConfig\(\)\s*:\s*Config\s*\{\s*return this\.deps\.config"; then echo "FAIL: getConfig must NOT return this.deps.config in the stub phase — real impl is deferred to P09 (CRIT-2)"; exit 1; fi
grep -rq "@plan:PLAN-20260621-COREAPIREMED.P06" packages/agents/src/api/ || { echo "MISSING plan marker"; exit 1; }
# No `any` / unsafe assertions in the new stub (BLOCKING; `as const` is allowed)
if grep -nE ": any\b" packages/agents/src/api/fromConfig.ts; then echo "FAIL: any in fromConfig.ts"; exit 1; fi
if grep -nE "\bas [A-Z][A-Za-z0-9_]*" packages/agents/src/api/fromConfig.ts | grep -vE "as const"; then echo "FAIL: type assertion in fromConfig.ts"; exit 1; fi
npm run typecheck
echo "OK"
```

### Reverse-Testing Guard (stub phase)

```bash
# This phase writes NO tests. SCOPE the reverse-test scan to the files this phase would add/modify
# (the fromConfig spec files) — NOT all of __tests__/, which carries pre-existing #1594 RED tests
# whose NotYetImplemented/throw assertions are out of scope here (MIN-2).
FROMCONFIG_SPECS=$(git ls-files 'packages/agents/src/api/__tests__/*fromConfig*' 'packages/agents/src/api/__tests__/*from-config*' 2>/dev/null)
if [ -n "$FROMCONFIG_SPECS" ]; then
  grep -nE "toThrow\(['"]NotYetImplemented|NotYetImplemented" $FROMCONFIG_SPECS && { echo "FAIL: reverse test in new fromConfig spec"; exit 1; } || true
else
  echo "OK: no fromConfig spec files added by this stub phase (none expected)."
fi
```

### Semantic Verification Checklist

- [ ] `fromConfig` exists, is exported from the public root, compiles.
- [ ] `FromConfigOptions` typed with `readonly config: Config` and optional handlers.
- [ ] `getConfig(): Config` DECLARED on the `Agent` interface (exactly once); agentImpl body is a
      NotYetImplemented STUB (real impl deferred to P09 — CRIT-2).
- [ ] No logic implemented (both `fromConfig` and `getConfig` stubs throw NotYetImplemented).
- [ ] `npm run typecheck` clean.

## Success Criteria

- New public `fromConfig` symbol compiles and is reachable from `@vybestack/llxprt-code-agents`.

## Failure Recovery

- `git checkout -- packages/agents/src/api/`; recreate stub.

## Deferred Implementation Detection (MANDATORY — scoped)

Scoped to the source file(s) THIS stub creates/modifies (NOT an unscoped `__tests__/` global scan
that would trip on pre-existing #1594 matches). A stub may contain the SINGLE allowed
`NotYetImplemented` throw and nothing else deferred.

```bash
set -e
# scoped target file(s): packages/agents/src/api/fromConfig.ts, packages/agents/src/api/fromConfig-types.ts, packages/agents/src/api/agent.ts, packages/agents/src/api/agentImpl.ts
for F in "packages/agents/src/api/fromConfig.ts" "packages/agents/src/api/fromConfig-types.ts" "packages/agents/src/api/agent.ts" "packages/agents/src/api/agentImpl.ts"; do
  test -f "$F" || continue
  # No deferred-impl placeholder language on lines THIS phase added (diff-scoped).
  if git diff HEAD -- "$F" | grep -E "^\\+" | grep -nE "(TODO|FIXME|HACK|XXX|TEMPORARY|WIP|placeholder|for now|in a real|coming soon)"; then
    echo "FAIL: deferred-implementation marker on changed lines in $F"; exit 1
  fi
  # No `return null/undefined/{{}}/[]` stand-in masquerading as behavior beyond the allowed throw.
  # (Stub bodies must throw NotYetImplemented, not silently return fake values.)
  if grep -nE "throw new Error\\('Not implemented'\\)|throw new Error\\(\"Not implemented\"\\)" "$F"; then
    echo "FAIL: generic 'Not implemented' throw — use the canonical NotYetImplemented marker in $F"; exit 1
  fi
done
echo "PASS: no deferred-implementation markers beyond the allowed NotYetImplemented throw."
```

## Phase Completion Marker

Create: `project-plans/issue1594remediate/.completed/P06.md`

Contents (REQUIRED — per `dev-docs/PLAN-TEMPLATE.md` lines 199-211; the executor fills in
every field with REAL values, not placeholders):

```markdown
Phase: P06
Completed: YYYY-MM-DD HH:MM
Files Created: [list each new file with its line count]
Files Modified: [list each changed file with diff stats, e.g. +12/-3]
Tests Added: [count]
Verification: [paste the actual output of THIS phase's verification commands]
Semantic Assessment: [one-line holistic assessment of what was implemented and whether it satisfies the cited requirements]
```

