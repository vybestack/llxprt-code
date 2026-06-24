<!-- @plan:PLAN-20260621-COREAPIREMED.P16a @requirement:REQ-004,REQ-006 -->
# Phase 16a: Contract Promotion Implementation Verification (Pseudocode-Compliance Gate)

## Phase ID

`PLAN-20260621-COREAPIREMED.P16a`

## LLxprt Code Subagent: architect

## Prerequisites

- Required: Phase 16 completed
- Verification: `test -f project-plans/issue1594remediate/.completed/P16.md`

## Pseudocode-Compliance Verification (MANDATORY)

Compare the CURATED API barrel `api/index.ts` (and `internals.ts`) changes against
`analysis/pseudocode/client-contract-promotion.md` lines 10–21.

```bash
set -e
# CCF-6: `contractPromotion.types.ts` (NO `.test` suffix) is compile-only — its assertions are
# validated by `npm run typecheck` below, NOT by vitest (vitest's default matcher is `*.{test,spec}.*`
# and would silently skip it). Do NOT add a `vitest run …/contractPromotion.types.ts` line — it would
# report "No test files found" and is not how this file is checked.
npx vitest run packages/agents/src/api/__tests__/nonBreaking.exports.test.ts
npx vitest run packages/agents/src/api/__tests__/
npm run typecheck
npm run lint
# CRIT-3: AgentClientContract is promoted TYPE-ONLY from the CURATED API barrel (api/index.ts),
# re-exporting the core-owned contract — NOT redefined and NOT placed only at the root. (BLOCKING)
grep -qE "export type \{[^}]*AgentClientContract[^}]*\}" packages/agents/src/api/index.ts \
  || { echo "FAIL: AgentClientContract not type-exported from curated api/index.ts"; exit 1; }
# It must be RE-EXPORTED from core, not redefined in agents (BLOCKING)
grep -qE "from ['"]@vybestack/llxprt-code-core/core/clientContract\.js['"]" packages/agents/src/api/index.ts \
  || { echo "FAIL: AgentClientContract not re-exported from core clientContract.js"; exit 1; }
if grep -nE "interface AgentClientContract" packages/agents/src/api/index.ts; then
  echo "FAIL: AgentClientContract redefined in agents (must re-export core)"; exit 1
fi
# REQ-004.2: type-only (erasable) — no runtime `export {` value named AgentClientContract (BLOCKING)
if grep -nE "export \{[^}]*AgentClientContract" packages/agents/src/api/index.ts; then
  echo "FAIL: AgentClientContract exported as a runtime value (must be export type)"; exit 1
fi
# REQ-004.1: concrete AgentClient class stays on ./internals.js, NOT newly added to the curated barrel.
if grep -nE "export \{[^}]*\bAgentClient\b[^C]" packages/agents/src/api/index.ts; then
  echo "FAIL: AgentClient class added to curated api/index.ts (must stay on internals)"; exit 1
fi
grep -q "export { AgentClient, PostTurnAction } from './core/client.js'" packages/agents/src/internals.ts \
  || { echo "FAIL: internals AgentClient export changed/removed"; exit 1; }
# Transitive reachability from the root (root already does `export * from './api/index.js'`).
grep -qE "export \* from ['"]\./api/index\.js['"]" packages/agents/src/index.ts \
  || { echo "FAIL: root no longer re-exports the curated api barrel"; exit 1; }
```

### Line-by-Line Compliance Table

| Pseudocode lines | Implemented at | Matches? |
|---|---|---|
| 10–13 type-only re-export from curated API barrel (from core clientContract.js) | api/index.ts | [ ] |
| 14–15 no class / no runtime value on barrel (type-only, erasable) | api/index.ts | [ ] |
| 20–21 internals AgentClient class unchanged | internals.ts | [ ] |
| 30–31 root re-exports both barrels (transitive reachability, no edit) | index.ts | [ ] |

### Semantic Verification Checklist

- [ ] Contract importable as type from root; structurally correct.
- [ ] Class still internals-only; nothing removed (non-breaking snapshot green).
- [ ] lint + typecheck clean.

## Holistic Functionality Assessment (MANDATORY — into marker)

### What was implemented? ### Satisfies REQ-004/.1/REQ-006? ### Risk (runtime vs type export) ### Verdict

## Success Criteria

- Compliance table complete; assessment written; suites green.

## Failure Recovery

- Return to Phase 16; do not proceed to Phase 17.

## Phase Completion Marker

Create: `project-plans/issue1594remediate/.completed/P16a.md` (include assessment).

Contents (REQUIRED — per `dev-docs/PLAN-TEMPLATE.md` lines 199-211; the executor fills in
every field with REAL values, not placeholders):

```markdown
Phase: P16a
Completed: YYYY-MM-DD HH:MM
Files Created: [list each new file with its line count]
Files Modified: [list each changed file with diff stats, e.g. +12/-3]
Tests Added: [count]
Verification: [paste the actual output of THIS phase's verification commands]
Semantic Assessment: [one-line verdict — PASS/FAIL with the key evidence that grounded it]
```
