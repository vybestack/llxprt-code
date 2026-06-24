<!-- @plan:PLAN-20260621-COREAPIREMED.P14a @requirement:REQ-003 -->
# Phase 14a: getCurrentSequenceModel Implementation Verification (Pseudocode-Compliance Gate)

## Phase ID

`PLAN-20260621-COREAPIREMED.P14a`

## LLxprt Code Subagent: architect

## Prerequisites

- Required: Phase 14 completed
- Verification: `test -f project-plans/issue1594remediate/.completed/P14.md`

## Pseudocode-Compliance Verification (MANDATORY)

Compare the new `getCurrentSequenceModel` against
`analysis/pseudocode/get-current-sequence-model.md` lines 10–15.

```bash
set -e
npx vitest run packages/agents/src/api/__tests__/agent.sequenceModel.behavior.test.ts
npx vitest run packages/agents/src/api/__tests__/
npm run typecheck
npm run lint
# Delegation present (BLOCKING)
grep -qE "resolveClient\(\)\??\.getCurrentSequenceModel" packages/agents/src/api/agentImpl.ts || { echo "FAIL: not delegating to resolved client"; exit 1; }
# Bare stub removed (BLOCKING): the method body must not be a single unconditional `return null;`.
if grep -nA2 "getCurrentSequenceModel(): string | null" packages/agents/src/api/agentImpl.ts | grep -qE "getCurrentSequenceModel\(\): string \| null \{\s*return null;"; then
  echo "FAIL: bare stub (unconditional return null) still present"; exit 1
fi
# Deferred-implementation scan, scoped to CHANGED lines only (MIN-3), BLOCKING.
DIFF=$(git diff HEAD -- packages/agents/src/api/agentImpl.ts | grep -E "^\+" | grep -vE "^\+\+\+")
if printf '%s\n' "$DIFF" | grep -nE "(TODO|FIXME|HACK|STUB|XXX|placeholder|for now|in a real)"; then
  echo "FAIL: deferred-implementation marker in changed lines"; exit 1
fi
```

> NOTE: a GUARDED `return null` (the genuine no-active-model branch) is allowed; only the
> unconditional bare-stub form is rejected above.

### Line-by-Line Compliance Table

| Pseudocode lines | Implemented at | Matches? |
|---|---|---|
| 11 resolve fresh client | | [ ] |
| 12–13 null guard (no throw) | | [ ] |
| 14 delegate to client | | [ ] |

### Semantic Verification Checklist

- [ ] Behavioral decision table holds (gpt-4o→gpt-4o; null→null; switch→new value).
- [ ] No client caching (R-CLIENT); resolves fresh each call.
- [ ] Bare stub removed.
- [ ] lint + typecheck clean; full agents suite green.

## Holistic Functionality Assessment (MANDATORY — into marker)

### What was implemented? ### Satisfies REQ-003/.1/.2? ### Data flow (resolveClient→client→value) ### Risks ### Verdict

## Success Criteria

- Compliance table complete; assessment written; suites green.

## Failure Recovery

- Return to Phase 14; do not proceed to Phase 15.

## Phase Completion Marker

Create: `project-plans/issue1594remediate/.completed/P14a.md` (include assessment).

Contents (REQUIRED — per `dev-docs/PLAN-TEMPLATE.md` lines 199-211; the executor fills in
every field with REAL values, not placeholders):

```markdown
Phase: P14a
Completed: YYYY-MM-DD HH:MM
Files Created: [list each new file with its line count]
Files Modified: [list each changed file with diff stats, e.g. +12/-3]
Tests Added: [count]
Verification: [paste the actual output of THIS phase's verification commands]
Semantic Assessment: [one-line verdict — PASS/FAIL with the key evidence that grounded it]
```
