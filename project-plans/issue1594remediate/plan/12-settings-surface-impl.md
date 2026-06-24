<!-- @plan:PLAN-20260621-COREAPIREMED.P12 @requirement:REQ-002,REQ-INT-003 -->
# Phase 12: Agent Settings/Config Surface — Implementation

## Phase ID

`PLAN-20260621-COREAPIREMED.P12`

## LLxprt Code Subagent: typescriptexpert

## Prerequisites

- Required: Phase 11a completed (PASS)
- Verification: `test -f project-plans/issue1594remediate/.completed/P11a.md`
- Pseudocode: `analysis/pseudocode/settings-surface.md` (lines 10–42)

## Requirements Implemented (Expanded)

### REQ-002 / REQ-002.1 / REQ-002.2 / REQ-002.3 / REQ-INT-003

Implement the THREE ephemeral settings methods on `agentImpl.ts` as pure delegation to
`this.deps.config`, making ALL Phase 11 tests pass. See Phase 11 GIVEN/WHEN/THEN. `getConfig()`
(REQ-002.2 identity) is DECLARED on the interface in P06 and IMPLEMENTED at P09 (CRIT-2); it is NOT
re-declared or re-implemented here.

## Implementation Tasks

### Files to Modify

- `packages/agents/src/api/agentImpl.ts`
  - Implement per pseudocode lines 20–42 (the ephemeral methods):
    - Line 20–22: `getEphemeralSetting(key) { return this.deps.config.getEphemeralSetting(key); }`
    - Line 30–33: `setEphemeralSetting(key, value) { this.deps.config.setEphemeralSetting(key, value); }`
      (NO try/catch; NO local normalization)
    - Line 40–42: `getEphemeralSettings() { return this.deps.config.getEphemeralSettings(); }`
  - `getConfig(): Config { return this.deps.config; }` already exists — DECLARED on the interface in
    P06, IMPLEMENTED at P09 (settings-surface.md lines 10–12 reference it as a precondition, NOT a P12
    task) — DO NOT re-add or duplicate it (CRIT-2). REQ-002.2 identity is satisfied by that existing
    member; P11's T3 verifies it.
  - Markers: `@plan:PLAN-20260621-COREAPIREMED.P12`, `@requirement:REQ-002`,
    `@pseudocode lines 20-42`.

### Constraints

- Do NOT modify Phase 11 tests.
- Follow pseudocode line-by-line.
- NO parallel store; NO re-normalization; NO error swallowing.
- No TODO/placeholder; no `console.*`.

## Verification Commands

```bash
set -e
npx vitest run packages/agents/src/api/__tests__/agent.settings.behavior.test.ts
npm run typecheck
grep -q "@pseudocode" packages/agents/src/api/agentImpl.ts
# Delegation, not a parallel store (BLOCKING — REQ-002.3 forbids a parallel ephemeral store)
if grep -nE "this\.ephemeral\s*[=:]|private ephemeral|new Map<[^>]*>\(\)\s*;?\s*//?\s*ephemeral" packages/agents/src/api/agentImpl.ts; then
  echo "FAIL: parallel ephemeral store detected (must delegate to Config)"; exit 1
fi
# No swallow around setEphemeralSetting
grep -n "this.deps.config.setEphemeralSetting" packages/agents/src/api/agentImpl.ts || { echo "FAIL: not delegating set"; exit 1; }
# CRIT-2: getConfig must remain a SINGLE impl (implemented at P09) — P12 must not duplicate it.
if [ "$(grep -cE "getConfig\s*\(\s*\)\s*:\s*Config\s*\{" packages/agents/src/api/agentImpl.ts)" -ne 1 ]; then echo "FAIL: getConfig must have exactly one impl (from P09); P12 must not re-add it"; exit 1; fi
```

### Deferred Implementation Detection (MANDATORY — scoped to CHANGED lines, MIN-3)

```bash
if git diff HEAD -- packages/agents/src/api/agentImpl.ts | grep -E "^\+" | grep -vE "^\+\+\+" | grep -nE "(TODO|FIXME|HACK|STUB|XXX|placeholder|for now|in a real)"; then
  echo "FAIL: deferred-implementation marker in changed lines"; exit 1
fi
```

### Semantic Verification Checklist

- [ ] All Phase 11 tests pass.
- [ ] get/set/getAll ephemeral methods delegate to Config; `getConfig` (implemented at P09) untouched and not duplicated.
- [ ] No parallel store; errors propagate; no re-normalization.
- [ ] Pseudocode cited; typecheck clean.

## Success Criteria

- Settings tests green; typecheck clean; pure delegation confirmed.

## Failure Recovery

- `git checkout -- packages/agents/src/api/agentImpl.ts`; re-implement from pseudocode.

## Phase Completion Marker

Create: `project-plans/issue1594remediate/.completed/P12.md`

Contents (REQUIRED — per `dev-docs/PLAN-TEMPLATE.md` lines 199-211; the executor fills in
every field with REAL values, not placeholders):

```markdown
Phase: P12
Completed: YYYY-MM-DD HH:MM
Files Created: [list each new file with its line count]
Files Modified: [list each changed file with diff stats, e.g. +12/-3]
Tests Added: [count]
Verification: [paste the actual output of THIS phase's verification commands]
Semantic Assessment: [one-line holistic assessment of what was implemented and whether it satisfies the cited requirements]
```

