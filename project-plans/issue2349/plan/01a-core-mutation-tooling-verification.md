# Phase 01a: Core mutation tooling — Verification

## Phase ID
`PLAN-20260707-AGENTNEUTRAL.P01a`

## Prerequisites
- Required: Phase 01 completed.
- Verification: `test -f project-plans/issue2349/.completed/P01.md`

Follow `plan/verification-template.md` (semantic checklist). For a TOOLING-provisioning phase
specifically, the "behavior" being verified is that the mutation tooling is EXECUTABLE for core.

## Requirements Implemented (Expanded)

### REQ-012.4: Core mutation tooling exists and is runnable (verification)
**Full Text**: The `packages/core` package carries Stryker tooling (`@stryker-mutator/core`,
`@stryker-mutator/vitest-runner`, `stryker.conf.json`, `test:mutation` script) so P05's ≥80% mutation
gate over changed `packages/core/src/llm-types/*` files is an executable command.
**Behavior**:
- GIVEN P01 completed;
- WHEN the verifier runs `npm --prefix packages/core run test:mutation -- --mutate "src/llm-types/modelEnvelope.ts"`;
- THEN it completes and emits `packages/core/reports/mutation/mutation.json`.
**Why This Matters**: proves the P05 mutation gate is real before P05 relies on it; catches a
tooling regression before it blocks the first core slice.

## Implementation Tasks
This is a verification phase: its "tasks" are to execute the semantic verification below (inspect the
provisioned config/scripts/devDeps, run the end-to-end mutation command, confirm the JSON report is
emitted, and confirm no production `src/**` change slipped in) and record the evidence in the completion
marker. No production code is written here.

## Verification Commands
```bash
# 1. Config mirrors agents structure and is valid JSON
node -e "JSON.parse(require('fs').readFileSync('packages/core/stryker.conf.json','utf8')); console.log('valid JSON')"
diff <(node -e "console.log(Object.keys(JSON.parse(require('fs').readFileSync('packages/agents/stryker.conf.json'))).sort().join('\n'))") \
     <(node -e "console.log(Object.keys(JSON.parse(require('fs').readFileSync('packages/core/stryker.conf.json'))).sort().join('\n'))") \
  && echo "same top-level config keys as agents"

# 2. Scripts + devDeps present and pinned to agents versions
grep -n '"test:mutation"' packages/core/package.json
grep -nE '@stryker-mutator/(core|vitest-runner)"\s*:\s*"\^9\.6\.1"' packages/core/package.json   # pinned == agents

# 3. Deps resolve (requires P01's root `npm install` lockfile update to be committed)
git log -1 --name-only --pretty=format: | grep -qx 'package-lock.json' && echo "root lockfile updated in P01 commit" || echo "NOTE: confirm package-lock.json carries the stryker devDeps (npm workspaces single root lock)"
npm ls @stryker-mutator/core @stryker-mutator/vitest-runner --prefix packages/core 2>/dev/null | head

# 4. End-to-end: tooling runs and emits the JSON report the P05 gate parses
npm --prefix packages/core run test:mutation -- --mutate "src/llm-types/modelEnvelope.ts"
node -e "const r=require('./packages/core/reports/mutation/mutation.json'); console.log('files in report:', Object.keys(r.files).length)"

# 5. Tooling-only: no production src changed by P01
git log -1 --name-only --pretty=format: -- packages/core/src | grep -E '\.ts$' && echo "UNEXPECTED src change in P01 commit" || echo "no src changes (expected)"
```

## Success Criteria
- `packages/core/stryker.conf.json` is valid JSON with the same top-level keys as
  `packages/agents/stryker.conf.json`, scoped (via `mutate`) to `llm-types`.
- `test:mutation` script + both `@stryker-mutator/*` devDeps present, pinned to `^9.6.1` (== agents).
- The end-to-end run emits a parseable `reports/mutation/mutation.json` with ≥1 file.
- P01 changed NO `packages/core/src/**` production code.
- No lint/complexity loosening; no suppression directives (`npm run lint:eslint-guard`).

## Failure Recovery
FAIL → remediation subagent with the specific finding (missing config key, unpinned dep, report not
emitted, or an accidental src change). Re-run this verification. Do NOT proceed to Phase 02 on FAIL.

## Phase Completion Marker
Create `project-plans/issue2349/.completed/P01a.md` with the pasted outputs of every Verification
Command above and a PASS/FAIL verdict with reasoning (PLAN.md §7 holistic assessment: is the core
mutation gate now genuinely executable for P05?).
