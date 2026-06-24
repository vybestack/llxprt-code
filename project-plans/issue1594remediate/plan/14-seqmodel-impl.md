<!-- @plan:PLAN-20260621-COREAPIREMED.P14 @requirement:REQ-003 -->
# Phase 14: getCurrentSequenceModel — Implementation

## Phase ID

`PLAN-20260621-COREAPIREMED.P14`

## LLxprt Code Subagent: typescriptexpert

## Prerequisites

- Required: Phase 13a completed (PASS)
- Verification: `test -f project-plans/issue1594remediate/.completed/P13a.md`
- Pseudocode: `analysis/pseudocode/get-current-sequence-model.md` (lines 10–15)

## Requirements Implemented (Expanded)

### REQ-003 / REQ-003.1 / REQ-003.2

Replace the stub at `agentImpl.ts:668-670` with real delegation, making ALL Phase 13 positive tests
pass while keeping the null contract intact. See Phase 13 GIVEN/WHEN/THEN.

## Implementation Tasks

### Files to Modify

- `packages/agents/src/api/agentImpl.ts`
  - Replace:
    ```
    getCurrentSequenceModel(): string | null {
      return null;
    }
    ```
    with the pseudocode lines 10–15 implementation:
    - Line 11: `const client = this.deps.resolveClient();`
    - Line 12–13: if no client → `return null;`
    - Line 14: `return client.getCurrentSequenceModel();`
    (A null-safe one-liner `return this.deps.resolveClient()?.getCurrentSequenceModel() ?? null;`
     is acceptable IF `resolveClient` may return undefined; match the actual declared return type
     `() => AgentClientContract` at agentImpl.ts:132 — if it is non-optional, guard is still
     defensive and harmless. Confirm the declared type and implement accordingly.)
  - Markers: `@plan:PLAN-20260621-COREAPIREMED.P14`, `@requirement:REQ-003`,
    `@pseudocode lines 10-15`. (Replace the old P20/REQ-004 marker block context appropriately —
    keep file-level markers; add this method's markers.)

### Constraints

- Do NOT modify Phase 13 tests.
- Follow pseudocode line-by-line; cite lines.
- Never cache the client (R-CLIENT); resolve fresh each call.
- No TODO/placeholder.

## Verification Commands

```bash
set -e
npx vitest run packages/agents/src/api/__tests__/agent.sequenceModel.behavior.test.ts
npm run typecheck
# Stub removed
grep -nA2 "getCurrentSequenceModel(): string | null" packages/agents/src/api/agentImpl.ts
grep -nA2 "getCurrentSequenceModel(): string | null" packages/agents/src/api/agentImpl.ts | grep -q "return null;$" && { echo "FAIL: bare stub still present"; exit 1; } || true
grep -q "resolveClient().getCurrentSequenceModel\|resolveClient()?.getCurrentSequenceModel" packages/agents/src/api/agentImpl.ts || { echo "FAIL: not delegating"; exit 1; }
grep -q "@pseudocode lines 10-15" packages/agents/src/api/agentImpl.ts
```

### Deferred Implementation Detection (MANDATORY — scoped to CHANGED lines, MIN-3)

```bash
if git diff HEAD -- packages/agents/src/api/agentImpl.ts | grep -E "^\+" | grep -vE "^\+\+\+" | grep -nE "(TODO|FIXME|HACK|STUB|placeholder|for now|in a real)"; then
  echo "FAIL: deferred-implementation marker in changed lines"; exit 1
fi
```

### Semantic Verification Checklist

- [ ] All Phase 13 positive tests pass; null cases pass.
- [ ] Delegates to bound client via resolveClient(); no cache.
- [ ] Bare `return null;` stub removed.
- [ ] Pseudocode cited; typecheck clean.

## Success Criteria

- Sequence-model tests green; stub gone; delegation in place.

## Failure Recovery

- `git checkout -- packages/agents/src/api/agentImpl.ts`; re-implement from pseudocode.

## Phase Completion Marker

Create: `project-plans/issue1594remediate/.completed/P14.md`

Contents (REQUIRED — per `dev-docs/PLAN-TEMPLATE.md` lines 199-211; the executor fills in
every field with REAL values, not placeholders):

```markdown
Phase: P14
Completed: YYYY-MM-DD HH:MM
Files Created: [list each new file with its line count]
Files Modified: [list each changed file with diff stats, e.g. +12/-3]
Tests Added: [count]
Verification: [paste the actual output of THIS phase's verification commands]
Semantic Assessment: [one-line holistic assessment of what was implemented and whether it satisfies the cited requirements]
```

