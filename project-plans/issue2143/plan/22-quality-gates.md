<!-- @plan:PLAN-20260622-COREAPIGAP.P22 @requirement:REQ-001,REQ-002,REQ-003,REQ-004,REQ-005,REQ-006,REQ-007,REQ-008,REQ-009,REQ-010,REQ-INT-001,REQ-INT-002,REQ-INT-003,REQ-INT-004,REQ-INT-005 -->
# Phase 22: Full Verification Suite + Mutation Gate

## Phase ID

`PLAN-20260622-COREAPIGAP.P22`

## LLxprt Code Subagent: typescriptexpert

## Prerequisites

- Required: Phase 21a completed (PASS)
- Verification: `test -f project-plans/issue2143/.completed/P21a.md`

## Purpose

Run the project's full verification suite and the mutation gate over the new/changed production files
to certify the additive API surface is production-quality and ready for PR. This is the last gate
before the final adequacy evaluation.

## Background — verified facts

- The agents Stryker config (`packages/agents/stryker.conf.json`) already mutates
  `src/api/**/*.ts` (excluding `__tests__`/`*.spec.ts`/`*.test.ts`) with `break: 80`. So the THREE
  NEW control files (`control/policyControl.ts`, `control/tasksControl.ts`,
  `control/toolKeysControl.ts`) and the EXTENDED control files (`control/mcpControl.ts`,
  `control/authControl.ts`, `control/hooks.ts`, `control/toolControl.ts`) plus `agentImpl.ts` are
  AUTOMATICALLY in the mutate set. No config change is required; the `test:mutation:api` script runs
  the whole `src/api/**` mutate scope and fails under 80%.
- Root `npm run test` oversubscribes CPU and can produce timing/property flakiness; failing files
  MUST be re-run in isolation (`npx vitest run <file>`) to confirm they are load-contention flakes,
  not real defects (CI runs packages separately and does not hit this).

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

> If `npm run test` reports failures, re-run EACH failing file in isolation:
> `npx vitest run <path-to-failing-file>`. If it passes in isolation, it is a root-orchestrator
> load-contention flake (documented behavior on this monorepo), not a code defect — record the
> isolated-green evidence in the marker. If it STILL fails in isolation, it is a real defect: fix it
> at its source phase (do not weaken the test).

### Mutation Testing (≥80% on the new/changed API surface)

The agents Stryker config already scopes `src/api/**`. Run it and assert ≥80%:

```bash
cd packages/agents
# Stryker's own break:80 already fails this run (non-zero exit) if the overall
# mutation score < 80%, so under set -e the run itself is the primary gate.
npm run test:mutation:api
M=reports/mutation/mutation.json
test -f "$M" || { echo "FAIL: no mutation report"; exit 1; }
# Stryker JSON schemaVersion 1.0 stores raw mutants[].status (Killed/Timeout/
# Survived/NoCoverage) — there is NO precomputed .mutationScore field. Compute
# the score the way Stryker does: detected=(Killed+Timeout),
# valid=(detected+Survived+NoCoverage), score=detected/valid*100.
SCORE=$(jq -r '
  [ .files[].mutants[].status ] as $all
  | ($all | map(select(. == "Killed" or . == "Timeout")) | length) as $detected
  | ($all | map(select(. == "Killed" or . == "Timeout" or . == "Survived" or . == "NoCoverage")) | length) as $valid
  | if $valid == 0 then 0 else ($detected * 100 / $valid) end
' "$M")
echo "agents api mutation score: $SCORE"
awk -v s="$SCORE" 'BEGIN{ if (s+0 < 80) { print "FAIL: agents api mutation < 80%"; exit 1 } }'
cd ../..
```

> Stryker MUST already be present. `@stryker-mutator/core` (`^9.6.1`) and
> `@stryker-mutator/vitest-runner` (`^9.6.1`) are declared devDependencies of `packages/agents`
> (verified). If absent, this is a BLOCKING regression — FAIL and point back to dependency
> remediation; do NOT install it at the gate:
>
> ```bash
> ( cd packages/agents && npm ls @stryker-mutator/core ) || { echo "FAIL: @stryker-mutator/core MISSING — BLOCKING regression; do NOT install at the gate."; exit 1; }
> ```

> Per-file focus (if the whole-`src/api/**` run is slow): the NEW files carry the most un-killed
> mutants. After the full run, inspect the per-file scores in `reports/mutation/mutation.json` and
> ensure EACH new control file (`policyControl.ts`, `tasksControl.ts`, `toolKeysControl.ts`) and each
> extended control's NEW methods are individually ≥80%. Add behavioral cases to the owning
> `.behavior.test.ts` (NOT to a separate file) to kill survivors; never relax the threshold.

### Deferred Implementation Detection (whole new production set, BLOCKING)

```bash
if grep -rnE "(TODO|FIXME|HACK|STUB|XXX|TEMPORARY|WIP)" packages/agents/src/api --include="*.ts" | grep -vE "/__tests__/"; then
  echo "FAIL: deferred-implementation marker in production code"; exit 1
fi
if grep -rnE "(in a real|in production|ideally|for now|placeholder|not yet implemented|coming soon)" packages/agents/src/api --include="*.ts" | grep -vE "/__tests__/"; then
  echo "FAIL: deferred-implementation prose in production code"; exit 1
fi
echo "no deferred-implementation patterns"
```

### Comment-discipline (N5) on new production files (BLOCKING)

```bash
# New production control files carry ONLY @plan/@requirement/@pseudocode markers — no prose comments.
for C in policyControl tasksControl toolKeysControl; do
  P="packages/agents/src/api/control/$C.ts"
  # Any // comment that is not a marker line is a violation.
  if grep -nE "^\s*//" "$P" | grep -vE "@plan:|@requirement:|@pseudocode"; then
    echo "FAIL: non-marker prose comment in $P (N5)"; exit 1
  fi
done
echo "N5 comment discipline OK on new controls"
```

### Semantic Verification Checklist

- [ ] All six core commands pass (test/lint/typecheck/format/build + smoke haiku).
- [ ] Mutation score ≥80% over `src/api/**`; each NEW control file individually ≥80%.
- [ ] No deferred-implementation patterns / non-marker prose comments in new production code.
- [ ] Any `npm run test` flake reproduced-green in isolation and documented.

## Success Criteria

- Entire suite green; mutation ≥80%; no deferred work; smoke test prints a haiku.

## Failure Recovery

- Fix the failing gate at its source phase (do not weaken tests); re-run suite. For mutation
  survivors, strengthen the owning `.behavior.test.ts` with real behavioral cases.

## Phase Completion Marker

Create: `project-plans/issue2143/.completed/P22.md` (paste suite + mutation outputs + any isolated
re-run evidence).

```markdown
Phase: P22
Completed: YYYY-MM-DD HH:MM
Files Created: none (or any test cases added to existing .behavior.test.ts — list them)
Files Modified: [list with diff stats]
Tests Added: [count]
Verification: [paste actual output of suite + mutation score]
Semantic Assessment: [one-line: suite green, mutation >=80%, smoke haiku printed]
```
