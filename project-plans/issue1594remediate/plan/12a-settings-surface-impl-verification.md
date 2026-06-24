<!-- @plan:PLAN-20260621-COREAPIREMED.P12a @requirement:REQ-002,REQ-INT-003 -->
# Phase 12a: Settings Surface Implementation Verification (Pseudocode-Compliance Gate)

## Phase ID

`PLAN-20260621-COREAPIREMED.P12a`

## LLxprt Code Subagent: architect

## Prerequisites

- Required: Phase 12 completed
- Verification: `test -f project-plans/issue1594remediate/.completed/P12.md`

## Pseudocode-Compliance Verification (MANDATORY)

Compare `agentImpl.ts` EPHEMERAL settings methods against `analysis/pseudocode/settings-surface.md`
lines 20–42 line by line. (CRIT-2: `getConfig` per lines 10–12 is a PRECONDITION — declared on the
interface in P06 and implemented at P09, not a P12 task — verify it still exists exactly once and was
not re-added/duplicated here.)

```bash
set -e
npx vitest run packages/agents/src/api/__tests__/agent.settings.behavior.test.ts
npx vitest run packages/agents/src/api/__tests__/
npm run typecheck
npm run lint
grep -q "@pseudocode" packages/agents/src/api/agentImpl.ts
# CRIT-2: getConfig must remain a SINGLE impl (implemented at P09) — P12 must not duplicate it.
if [ "$(grep -cE "getConfig\s*\(\s*\)\s*:\s*Config\s*\{" packages/agents/src/api/agentImpl.ts)" -ne 1 ]; then echo "FAIL: getConfig must have exactly one impl (from P09); P12 must not re-add it"; exit 1; fi
# Parallel-store guard (BLOCKING): a settings-scoped Map/ephemeral field on the impl is a violation.
if grep -nE "this\.ephemeral(Settings)?\s*[:=]|private +ephemeral|new Map<[^>]*>\(\)\s*;?\s*//?\s*ephemeral" packages/agents/src/api/agentImpl.ts; then
  echo "FAIL: parallel settings store detected (must delegate to bound Config)"; exit 1
fi
# Deferred-implementation scan, scoped to CHANGED lines only (MIN-3), BLOCKING.
DIFF=$(git diff HEAD -- packages/agents/src/api/agentImpl.ts | grep -E "^\+" | grep -vE "^\+\+\+")
if printf '%s\n' "$DIFF" | grep -nE "(TODO|FIXME|HACK|STUB|XXX|placeholder|for now|in a real|in production|ideally)"; then
  echo "FAIL: deferred-implementation marker in changed lines"; exit 1
fi
```

### Line-by-Line Compliance Table

| Pseudocode lines | Implemented at | Matches? |
|---|---|---|
| 10–12 getConfig identity (PRECONDITION — declared P06, implemented P09 — exists once, not re-added) | | [ ] |
| 20–22 getEphemeralSetting delegate | | [ ] |
| 30–33 setEphemeralSetting delegate (no catch) | | [ ] |
| 40–42 getEphemeralSettings delegate | | [ ] |

### Semantic Verification Checklist

- [ ] All Phase 11 tests pass; full agents api suite green.
- [ ] Pure delegation; no parallel store; no re-normalization; errors propagate.
- [ ] lint + typecheck clean; no deferred-implementation patterns.

## Holistic Functionality Assessment (MANDATORY — into marker)

### What was implemented? ### Satisfies REQ-002/.1/.2/.3/INT-003? ### Data flow ### Risks ### Verdict

## Success Criteria

- Compliance table complete; assessment written; suites green.

## Failure Recovery

- Return to Phase 12 with deviations; do not proceed to Phase 13.

## Phase Completion Marker

Create: `project-plans/issue1594remediate/.completed/P12a.md` (include assessment).

Contents (REQUIRED — per `dev-docs/PLAN-TEMPLATE.md` lines 199-211; the executor fills in
every field with REAL values, not placeholders):

```markdown
Phase: P12a
Completed: YYYY-MM-DD HH:MM
Files Created: [list each new file with its line count]
Files Modified: [list each changed file with diff stats, e.g. +12/-3]
Tests Added: [count]
Verification: [paste the actual output of THIS phase's verification commands]
Semantic Assessment: [one-line verdict — PASS/FAIL with the key evidence that grounded it]
```
