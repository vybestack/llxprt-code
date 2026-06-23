<!-- @plan:PLAN-20260621-COREAPIREMED.P23 @requirement:REQ-001,REQ-002,REQ-003,REQ-004,REQ-005,REQ-006,REQ-INT-001,REQ-INT-002,REQ-INT-003,REQ-INT-004 -->
# Phase 23: Full Verification Suite + Mutation Gate

## Phase ID

`PLAN-20260621-COREAPIREMED.P23`

## LLxprt Code Subagent: typescriptexpert

## Prerequisites

- Required: Phase 22a completed (PASS)
- Verification: `test -f project-plans/issue1594remediate/.completed/P22a.md`

## Purpose

Run the project's full verification suite and the mutation gate over the changed files to certify the
remediation is production-quality and ready for PR.

## Implementation Tasks

### Commands to Run (all must pass)

```bash
set -e
npm run test
npm run lint
npm run typecheck
npm run format
npm run build
node scripts/start.js --profile-load ollamakimi "write me a haiku and nothing else"
```

### Mutation Testing (≥80% on changed production files)

Run Stryker scoped to the files this plan changed:

- `packages/agents/src/api/createAgent.ts` (fromConfig + finalizeAgent extraction)
- `packages/agents/src/api/agentImpl.ts` (settings surface, getCurrentSequenceModel, getRuntimeId)
- `packages/agents/src/api/agent.ts` (interface additions — type-level; mutation focuses on impl)
- `packages/agents/src/api/index.ts` (contract promotion export — covered by characterization)
- `packages/providers/src/runtime/runtimeContextFactory.ts` (MIN-1: P03–P05 change production
  behavior here — the `providerManager?` adoption seam — so the ≥80% mutation gate MUST cover it)

```bash
# Agents-package changed production files
npx stryker run --mutate "packages/agents/src/api/createAgent.ts,packages/agents/src/api/agentImpl.ts"
SCORE=$(jq -r '.metrics.mutationScore' .stryker-tmp/reports/mutation-report.json 2>/dev/null || jq -r '.metrics.mutationScore' reports/mutation/mutation.json)
echo "agents mutation score: $SCORE"
awk -v s="$SCORE" 'BEGIN{ if (s+0 < 80) { print "FAIL: agents mutation < 80%"; exit 1 } }'

# MIN-1: providers-package changed production file (the providerManager? adoption seam). Run an
# equivalent providers-scoped Stryker pass so the seam is mutation-covered to the same ≥80% bar.
npx stryker run --mutate "packages/providers/src/runtime/runtimeContextFactory.ts" || { echo "FAIL: providers Stryker run failed"; exit 1; }
PSCORE=$(jq -r '.metrics.mutationScore' .stryker-tmp/reports/mutation-report.json 2>/dev/null || jq -r '.metrics.mutationScore' reports/mutation/mutation.json)
echo "providers mutation score: $PSCORE"
awk -v s="$PSCORE" 'BEGIN{ if (s+0 < 80) { print "FAIL: providers runtimeContextFactory mutation < 80%"; exit 1 } }'
```

> Stryker MUST already be present (MIN-2). Per `plan/00a-preflight-verification.md` (~L27-30) and
> `specification.md` (~L182-184), `@stryker-mutator/core` is a declared devDependency of
> `packages/agents` (`^9.6.1`) and its absence is a BLOCKING regression — NOT an expected state to
> silently remediate at the final gate. If it is absent here, FAIL and point back to preflight /
> dependency remediation; do NOT install it at this gate:
>
> ```bash
> npm ls @stryker-mutator/core || { echo "FAIL: @stryker-mutator/core MISSING — this is a BLOCKING regression per P00a/specification.md; do NOT install at the gate. Return to preflight (P00a) and restore the devDependency before re-running P23."; exit 1; }
> ```

### Deferred Implementation Detection (whole changed set, BLOCKING)

# CCF-11: scope strictly to PRODUCTION code. Exclude the ENTIRE `__tests__/`
# tree (not just `*.test.ts`/`*.spec.ts`) — test support files like
# `contractPromotion.types.ts` (CCF-6 compile-only type assertions) and
# `helpers/*.ts` live under `__tests__/` WITHOUT a `.test`/`.spec` suffix, so a
# suffix-only filter mis-scans them as "production". Also tighten the deferred
# PROSE pattern: the bare `not yet` matched legitimate runtime-STATE JSDoc
# ("the field is not yet populated" before initialize(); "the new client's chat
# is not yet initialized" after a rebind) — those describe real implemented
# behavior, NOT deferred work. The genuine deferred signal is "not yet
# implemented"; match that instead. (Do NOT mangle accurate production JSDoc to
# satisfy a blunt regex.)
```bash
if grep -rnE "(TODO|FIXME|HACK|STUB|XXX|TEMPORARY|WIP)" packages/agents/src/api --include="*.ts" | grep -vE "/__tests__/"; then
  echo "FAIL: deferred-implementation marker in production code"; exit 1
fi
if grep -rnE "(in a real|in production|ideally|for now|placeholder|not yet implemented)" packages/agents/src/api --include="*.ts" | grep -vE "/__tests__/"; then
  echo "FAIL: deferred-implementation prose in production code"; exit 1
fi
echo "no deferred-implementation patterns"
```

### Semantic Verification Checklist

- [ ] All six core commands pass (test/lint/typecheck/format/build + smoke haiku).
- [ ] Mutation score ≥80% on changed production files.
- [ ] No deferred-implementation patterns remain in production code.
- [ ] The full agents `__tests__` parity harness passes.

## Success Criteria

- Entire suite green; mutation ≥80%; no deferred work; smoke test prints a haiku.

## Failure Recovery

- Fix the failing gate at its source phase (do not weaken tests); re-run suite.

## Phase Completion Marker

Create: `project-plans/issue1594remediate/.completed/P23.md` (paste suite + mutation outputs).

Contents (REQUIRED — per `dev-docs/PLAN-TEMPLATE.md` lines 199-211; the executor fills in
every field with REAL values, not placeholders):

```markdown
Phase: P23
Completed: YYYY-MM-DD HH:MM
Files Created: [list each new file with its line count]
Files Modified: [list each changed file with diff stats, e.g. +12/-3]
Tests Added: [count]
Verification: [paste the actual output of THIS phase's verification commands]
Semantic Assessment: [one-line holistic assessment of what was implemented and whether it satisfies the cited requirements]
```

