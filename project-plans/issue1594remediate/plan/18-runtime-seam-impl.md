<!-- @plan:PLAN-20260621-COREAPIREMED.P18 @requirement:REQ-005,REQ-001 -->
# Phase 18: Provider-Runtime Reachability Seam — Implementation

## Phase ID

`PLAN-20260621-COREAPIREMED.P18`

## LLxprt Code Subagent: typescriptexpert

## Prerequisites

- Required: Phase 17a completed (PASS)
- Verification: `test -f project-plans/issue1594remediate/.completed/P17a.md`
- Pseudocode: `analysis/pseudocode/provider-runtime-seam.md` (lines 10–23)

## PREFLIGHT FACT (do NOT re-add the bus seam)

`IsolatedRuntimeContextOptions.messageBus?` already exists (runtimeContextFactory.ts, #1594 P19).
This phase reuses it; it adds NOTHING to the providers package.

## Requirements Implemented (Expanded)

### REQ-005 / REQ-005.1 / REQ-005.2 / REQ-001.2

Add `getRuntimeId(): string` to the public Agent interface and impl (delegating to
`this.deps.runtimeId`); confirm the providers sub-surface reflects the adopted runtime; ensure no
second ProviderManager on the `fromConfig` adopt path. See Phase 17 GIVEN/WHEN/THEN.

## Implementation Tasks

### Files to Modify

- `packages/agents/src/api/agent.ts`
  - Add to the public `Agent` interface: `getRuntimeId(): string;`
  - Markers: `@plan:PLAN-20260621-COREAPIREMED.P18`, `@requirement:REQ-005`.

- `packages/agents/src/api/agentImpl.ts`
  - Implement per pseudocode lines 10–12:
    ```
    getRuntimeId(): string {
      return this.deps.runtimeId;
    }
    ```
  - CONFIRM the deps interface (agentImpl.ts ~L130) carries `readonly runtimeId: string;`. If
    absent, ADD it and thread it from `finalizeAgent` (createAgent.ts). For createAgent:
    `runtimeId = parsed.sessionId ?? generateRuntimeId()`; for fromConfig: the runtimeId computed in
    the seam (config-injection-seam.md). Both MUST equal the runtimeId passed to
    `createIsolatedRuntimeContext`.
  - Markers + `@pseudocode lines 10-12`.

- `packages/agents/src/api/createAgent.ts` (+ `fromConfig.ts` if it builds deps separately)
  - Thread `runtimeId` into the agent deps in `finalizeAgent` so both entry points populate it from
    the SAME value used for the runtime context (REQ-005.1).

### Constraints

- Do NOT expose a raw `ProviderManager` getter at the root.
- Do NOT construct a second ProviderManager anywhere (REQ-001.2) — adopt only.
- Follow pseudocode; cite lines. No placeholder/empty-string return.
- Do NOT modify Phase 17 tests.

## Verification Commands

```bash
set -e
npx vitest run packages/agents/src/api/__tests__/runtimeSeam.behavior.test.ts
npx vitest run packages/agents/src/api/__tests__/fromConfig.behavior.test.ts
npm run typecheck
grep -q "getRuntimeId(): string;" packages/agents/src/api/agent.ts || { echo "FAIL: interface missing"; exit 1; }
grep -q "return this.deps.runtimeId;" packages/agents/src/api/agentImpl.ts || { echo "FAIL: impl missing"; exit 1; }
grep -nE "getRuntimeId\(\): string \{\s*return '';" packages/agents/src/api/agentImpl.ts && { echo "FAIL: empty-string stub"; exit 1; } || true
grep -q "@pseudocode lines 10-12" packages/agents/src/api/agentImpl.ts
# No second ProviderManager construction introduced on the adopt path
grep -n "createHeadlessProviderManager" packages/agents/src/api/fromConfig.ts && { echo "FAIL: headless manager on adopt path"; exit 1; } || true
```

### Deferred Implementation Detection (MANDATORY — scoped to CHANGED lines, MIN-3)

```bash
FILES="packages/agents/src/api/agent.ts packages/agents/src/api/agentImpl.ts"
ADDED=$(git diff HEAD -- $FILES | grep -E "^\+" | grep -v "^\+\+\+")
if echo "$ADDED" | grep -nE "(TODO|FIXME|HACK|STUB|placeholder|for now|in a real)"; then echo "FAIL: deferred marker on changed lines"; exit 1; fi
# A getRuntimeId that returns '' or null is an empty seam (REQ-005.1 requires the bound id)
if echo "$ADDED" | grep -nE "getRuntimeId\(\)[^{]*\{[^}]*return (''|null)"; then echo "FAIL: empty getRuntimeId seam"; exit 1; fi
```

### Semantic Verification Checklist

- [ ] getRuntimeId returns the bound runtimeId (== context runtimeId).
- [ ] providers.* reflect adopted runtime; no 2nd ProviderManager.
- [ ] runtimeId threaded identically for both createAgent and fromConfig.
- [ ] Pseudocode cited; typecheck clean; runtime-seam + fromConfig tests green.

## Success Criteria

- Runtime-seam tests green; getRuntimeId real; single ProviderManager preserved.

## Failure Recovery

- `git checkout -- packages/agents/src/api/agent.ts packages/agents/src/api/agentImpl.ts packages/agents/src/api/createAgent.ts packages/agents/src/api/fromConfig.ts`.

## Phase Completion Marker

Create: `project-plans/issue1594remediate/.completed/P18.md`

Contents (REQUIRED — per `dev-docs/PLAN-TEMPLATE.md` lines 199-211; the executor fills in
every field with REAL values, not placeholders):

```markdown
Phase: P18
Completed: YYYY-MM-DD HH:MM
Files Created: [list each new file with its line count]
Files Modified: [list each changed file with diff stats, e.g. +12/-3]
Tests Added: [count]
Verification: [paste the actual output of THIS phase's verification commands]
Semantic Assessment: [one-line holistic assessment of what was implemented and whether it satisfies the cited requirements]
```

