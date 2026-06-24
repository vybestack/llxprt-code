<!-- @plan:PLAN-20260622-COREAPIGAP.P04 @requirement:REQ-001 -->
# Phase 04: Approval Mode — Implementation

## Phase ID

`PLAN-20260622-COREAPIGAP.P04`

## LLxprt Code Subagent: typescriptexpert

## Prerequisites

- Required: Phase 03 completed (PASS, suite RED)
- Verification: `test -f project-plans/issue2143/.completed/P03.md`
- Pseudocode: `analysis/pseudocode/approval-mode.md` (getApprovalMode lines 1-4; setApprovalMode lines 10-17)

## Requirements Implemented (Expanded)

### REQ-001 / REQ-001.1 / REQ-001.2

Add two top-level `Agent` methods that delegate DIRECTLY to the bound Config, making all Phase 03
tests pass. The untrusted-folder throw propagates unchanged. See Phase 03 GIVEN/WHEN/THEN.

## Implementation Tasks

### Files to Modify

1. `packages/agents/src/api/agent.ts` — add the two method declarations to the `Agent` interface,
   immediately AFTER `getCurrentSequenceModel(): string | null;` (currently `agent.ts:331`) and
   BEFORE the `getRuntimeId()` doc block:

   ```typescript
     getCurrentSequenceModel(): string | null;
     /**
      * Reads the live approval mode from the bound Config (no caching).
      * @plan:PLAN-20260622-COREAPIGAP.P04
      * @requirement:REQ-001
      */
     getApprovalMode(): ApprovalMode;
     /**
      * Sets the approval mode via the bound Config. Delegates directly: the
      * untrusted-folder guard throw (config.ts:404) propagates unchanged.
      * @plan:PLAN-20260622-COREAPIGAP.P04
      * @requirement:REQ-001
      */
     setApprovalMode(mode: ApprovalMode): void;
   ```

   - `ApprovalMode` is ALREADY imported at `agent.ts:11` and re-exported `export type` at
     `agent.ts:387`. No new import needed in this file.

2. `packages/agents/src/api/agentImpl.ts` — add the two implementations directly AFTER the
   `getEphemeralSettings()` one-liner (currently ends at `agentImpl.ts:738`), mirroring that exact
   delegate-no-cache shape (`getEphemeralSetting` at `:726`):

   ```typescript
     /**
      * @plan:PLAN-20260622-COREAPIGAP.P04
      * @requirement:REQ-001
      * @pseudocode lines 1-4
      */
     getApprovalMode(): ApprovalMode {
       return this.deps.config.getApprovalMode();
     }

     /**
      * @plan:PLAN-20260622-COREAPIGAP.P04
      * @requirement:REQ-001
      * @pseudocode lines 10-17
      */
     setApprovalMode(mode: ApprovalMode): void {
       this.deps.config.setApprovalMode(mode);
     }
   ```

   - `ApprovalMode` must be a usable TYPE in `agentImpl.ts`. Check the existing imports: if
     `ApprovalMode` is not already imported there, add a type-only import from the core barrel
     `@vybestack/llxprt-code-core` (it is a VALUE enum, but only the type position is used in the
     signature, so `import { type ApprovalMode } from '@vybestack/llxprt-code-core'` or a value
     import both compile; prefer matching the file's existing import style for Config-adjacent types).
   - `this.deps.config` is the live bound `Config` (already used by `getConfig()`/ephemeral methods).

### Constraints

- Follow the pseudocode line-by-line; cite `@pseudocode lines 1-4` and `@pseudocode lines 10-17`.
- `setApprovalMode` MUST NOT wrap the call in try/catch, MUST NOT normalize/clamp `mode`, MUST NOT
  validate trust — Config owns the guard (R-APPROVAL-THROW).
- `getApprovalMode` MUST read live every call — NO instance-field cache (R-DELEGATE).
- Do NOT modify the Phase 03 tests.
- No TODO/placeholder in changed lines.

## Verification Commands

```bash
set -o pipefail
set -e
npx vitest run packages/agents/src/api/__tests__/agent.approvalMode.behavior.test.ts
npm run typecheck

# Delegation present (BLOCKING)
grep -qE "config\.getApprovalMode\(\)" packages/agents/src/api/agentImpl.ts || { echo "FAIL: getApprovalMode not delegating"; exit 1; }
grep -qE "config\.setApprovalMode\(mode\)" packages/agents/src/api/agentImpl.ts || { echo "FAIL: setApprovalMode not delegating"; exit 1; }

# No try/catch wrapping the set delegation (BLOCKING — the throw must propagate).
# Extract the setApprovalMode method body and ensure it has no try/catch.
if awk '/setApprovalMode\(mode: ApprovalMode\): void \{/{f=1} f{print} /^\s*\}/{if(f)exit}' packages/agents/src/api/agentImpl.ts | grep -qE "\btry\b|\bcatch\b"; then
  echo "FAIL: setApprovalMode wraps a try/catch — the untrusted throw must propagate unchanged"; exit 1
fi

# Pseudocode markers present (BLOCKING)
grep -q "@pseudocode lines 1-4" packages/agents/src/api/agentImpl.ts || { echo "FAIL: getApprovalMode pseudocode marker missing"; exit 1; }
grep -q "@pseudocode lines 10-17" packages/agents/src/api/agentImpl.ts || { echo "FAIL: setApprovalMode pseudocode marker missing"; exit 1; }

# Interface declarations present (BLOCKING)
grep -qE "getApprovalMode\(\): ApprovalMode;" packages/agents/src/api/agent.ts || { echo "FAIL: interface getApprovalMode missing"; exit 1; }
grep -qE "setApprovalMode\(mode: ApprovalMode\): void;" packages/agents/src/api/agent.ts || { echo "FAIL: interface setApprovalMode missing"; exit 1; }
```

### Deferred Implementation Detection (MANDATORY — scoped to CHANGED lines, MIN-3)

```bash
set -o pipefail
for FILE in packages/agents/src/api/agentImpl.ts packages/agents/src/api/agent.ts; do
  if git diff HEAD -- "$FILE" | grep -E "^\+" | grep -vE "^\+\+\+" | grep -nE "(TODO|FIXME|HACK|STUB|placeholder|for now|in a real)"; then
    echo "FAIL: deferred-implementation marker in changed lines of $FILE"; exit 1
  fi
done
echo "PASS: no deferred markers in changed lines."
```

### Semantic Verification Checklist

- [ ] All Phase 03 tests pass (T1/T2/T3 + both PROPs).
- [ ] `getApprovalMode` reads live; `setApprovalMode` delegates with NO try/catch, NO normalization.
- [ ] Pseudocode cited (`lines 1-4`, `lines 10-17`); typecheck clean.
- [ ] No new mock theater introduced anywhere.

## Success Criteria

- Approval-mode tests green; delegation in place; throw propagates; interface + impl markers present.

## Failure Recovery

- `git checkout -- packages/agents/src/api/agentImpl.ts packages/agents/src/api/agent.ts`; re-implement
  from pseudocode.

## Phase Completion Marker

Create: `project-plans/issue2143/.completed/P04.md`

Contents (REQUIRED — per `dev-docs/PLAN-TEMPLATE.md` lines 199-211; fill every field with REAL values):

```markdown
Phase: P04
Completed: YYYY-MM-DD HH:MM
Files Created: [list each new file with its line count]
Files Modified: [list each changed file with diff stats]
Tests Added: [count]
Verification: [paste the actual output of THIS phase's verification commands]
Semantic Assessment: [one-line holistic assessment]
```
