# Phase 02: Analysis & Pseudocode Finalization

## Phase ID
`PLAN-20260629-ISSUE2285.P02`

## Prerequisites
- Required: Phase 01a completed.
- Verification: `test -f project-plans/issue2285/.completed/P01a.md`.

## Purpose

Finalize the analysis and pseudocode artifacts based on preflight findings.
The pseudocode files already exist from P00; this phase corrects them against
preflight evidence and adds any missing component pseudocode (runtime factory
drift guard).

## Requirements Implemented (Expanded)

### REQ-002 (API guard pseudocode), REQ-003 (boundary checker pseudocode), REQ-005 (runtime factory pseudocode), REQ-006 (CLI session split pseudocode)

## Implementation Tasks

### Files to Modify
- `project-plans/issue2285/analysis/pseudocode/api-surface-guard.md` — correct
  against preflight (e.g. exact declaration parse approach, build-order step).
- `project-plans/issue2285/analysis/pseudocode/boundary-checker-replacement.md`
  — confirm internals subpath already forbidden by deep-import rule; finalize
  fixture test conversion list.
- `project-plans/issue2285/analysis/pseudocode/cli-session-split.md` — finalize
  module names and extraction order against actual cliSessionDispatch content.

### Files to Create
- `project-plans/issue2285/analysis/pseudocode/runtime-factory-drift.md` —
  pseudocode for the compile-time drift guard (if duplication retained) OR the
  core-ownership migration (if single-source chosen).

## Runtime factory drift pseudocode (if duplication retained)

Uses **non-distributive tuple-wrapped equality** (architect finding 4) so the
check does not distribute over unions and silently pass on optional-member
drift.

```
10: FILE packages/agents/src/api/runtimeFactoryBindings.drift.types.ts
20: // typecheck-visible (NOT a .test.ts) so tsc --noEmit includes it
30: import type { AgentRuntimeFactoryBindings as AgentsBindings } from './runtimeFactories.js'
40: import type { AgentRuntimeFactoryBindings as ProvidersBindings } from '@vybestack/llxprt-code-providers/runtime/runtimeContextFactory.js'
50: // Non-distributive tuple-wrapped equality (architect finding 4)
60: // [X] extends [Y] prevents distribution over union members so the check is exact
70: type Equal<X, Y> = [X] extends [Y] ? ([Y] extends [X] ? true : false) : false
80: // Exact key-set equality — fails if either side has extra/missing members
90: const _sameKeys: Equal<keyof AgentsBindings, keyof ProvidersBindings> = true
100: // Per-key bidirectional assignability for every shared member
110: const _prop0: Equal<AgentsBindings['agentClientFactory'], ProvidersBindings['agentClientFactory']> = true
120: // ... one assertion per known member ...
130: // If the two are structurally identical, all assertions are `true`. If either
140: // side drifts (required OR optional member), the corresponding Equal resolves
150: // to `false` which is not assignable to `true`, and tsc --noEmit fails.
160: // NAKED conditional types (X extends Y ? true : false) DISTRIBUTE over unions
170: // and would SILENTLY PASS on optional-member drift — the tuple-wrapping is
180: // mandatory (architect finding 4).
```

NOTE: if the preflight decided core-ownership, this file instead documents the
additive migration of the interface to core and the re-export from both
packages.

## Verification Commands

```bash
# All pseudocode files exist — fail-closed
test -f project-plans/issue2285/analysis/pseudocode/api-surface-guard.md || { echo "FAIL: api-surface-guard.md missing"; exit 1; }
test -f project-plans/issue2285/analysis/pseudocode/boundary-checker-replacement.md || { echo "FAIL: boundary-checker-replacement.md missing"; exit 1; }
test -f project-plans/issue2285/analysis/pseudocode/cli-session-split.md || { echo "FAIL: cli-session-split.md missing"; exit 1; }
test -f project-plans/issue2285/analysis/pseudocode/runtime-factory-drift.md || { echo "FAIL: runtime-factory-drift.md missing"; exit 1; }

# Pseudocode has numbered lines — fail-closed
LINES_API="$(grep -c '^[0-9]' project-plans/issue2285/analysis/pseudocode/api-surface-guard.md || true)"
test "$LINES_API" -ge 1 || { echo "FAIL: api-surface-guard.md has no numbered lines"; exit 1; }
LINES_BC="$(grep -c '^[0-9]' project-plans/issue2285/analysis/pseudocode/boundary-checker-replacement.md || true)"
test "$LINES_BC" -ge 1 || { echo "FAIL: boundary-checker-replacement.md has no numbered lines"; exit 1; }
LINES_CS="$(grep -c '^[0-9]' project-plans/issue2285/analysis/pseudocode/cli-session-split.md || true)"
test "$LINES_CS" -ge 1 || { echo "FAIL: cli-session-split.md has no numbered lines"; exit 1; }
LINES_RF="$(grep -c '^[0-9]' project-plans/issue2285/analysis/pseudocode/runtime-factory-drift.md || true)"
test "$LINES_RF" -ge 1 || { echo "FAIL: runtime-factory-drift.md has no numbered lines"; exit 1; }
```

## Success Criteria
- All four pseudocode files finalized against preflight evidence.
- Each has numbered lines referenced by subsequent implementation phases.

## Phase Completion Marker
Create `project-plans/issue2285/.completed/P02.md`.


The marker MUST contain structured diff evidence per the Standard Completion
Marker Template in `overview.md` (architect finding 8): files changed
(`git diff --name-only` of phase-owned files), diff stats (`git diff --stat`),
command outputs (exit status + key output), and tracker evidence (gate items
satisfied + verifier evidence).
