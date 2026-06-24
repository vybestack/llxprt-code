# Phase 08: Quality Gate Setup — Mutation + Property Infrastructure

## Phase ID

`PLAN-20260617-COREAPI.P08`

## LLxprt Code Subagent: typescriptexpert

## Prerequisites

- Required: Phase 07a completed (PASS)
- Verification: `test -f project-plans/issue1594/.completed/P07a.md`

## Requirements Implemented (Expanded)

### REQ-019: Enforceable quality gates before harness/implementation

**Full Text**: The plan's mutation-testing and property-based-testing requirements are executable quality gates, not final checkboxes. Stryker setup must exist before the harness and implementation phases, and the final evaluation consumes already-proven reports rather than installing tooling.

**Behavior**:
- GIVEN: the API implementation/harness phases have not yet run
- WHEN: this setup phase executes
- THEN: mutation-testing tooling is installed/configured for `packages/agents/src/api/**`, a tiny viability target proves Stryker can run in this package, and a property-ratio script exists for later harness phases

**Why This Matters**: PLAN.md requires mutation score ≥80% and property-based tests ≥30% as enforceable gates. Discovering that the tooling cannot run only at the final review would make the plan non-executable.

## Implementation Tasks

### Files to Create

- `packages/agents/stryker.conf.json` — Stryker config scoped to the new public API:
  - mutate `src/api/**/*.ts`
  - exclude specs and harness helpers
  - `thresholds.break = 80`
  - JSON report at `reports/mutation/mutation.json`
- `packages/agents/src/api/quality-gate-smoke.ts` — tiny pure production function used only to prove Stryker/Vitest wiring before the main API implementation exists (for example, classify a string as empty/non-empty without mutation or side effects).
  - MUST include: `@plan:PLAN-20260617-COREAPI.P08`
  - MUST include: `@requirement:REQ-019`
- `packages/agents/src/api/__tests__/quality-gate-smoke.spec.ts` — tiny, real behavioral test target for `quality-gate-smoke.ts`.
  - MUST include: `@plan:PLAN-20260617-COREAPI.P08`
  - MUST include: `@requirement:REQ-019`
- `scripts/verify-agent-api-property-ratio.js` or `packages/agents/scripts/verify-api-property-ratio.js` — computes denominator = test cases tagged `@plan:PLAN-20260617-COREAPI`, numerator = cases using `fc.assert`, `test.prop`, or `it.prop`, exits non-zero below 30%.

### Files to Modify

- `packages/agents/package.json`
  - Add dev dependencies if absent: `@stryker-mutator/core`, `@stryker-mutator/vitest-runner`.
  - Add package script if useful: `test:mutation:api`.

### Required Code Markers

Every test created in this phase MUST include:

```typescript
/**
 * @plan PLAN-20260617-COREAPI.P08
 * @requirement REQ-019
 */
```

## Verification Commands

```bash
missing=0
node -e "const p=require('./packages/agents/package.json'); const d={...(p.devDependencies||{}),...(p.dependencies||{})}; for (const x of ['@stryker-mutator/core','@stryker-mutator/vitest-runner']) if(!d[x]) { console.error('MISSING '+x); process.exitCode=1; }"
test -f packages/agents/stryker.conf.json || { echo "MISSING stryker config"; missing=1; }
test -f packages/agents/src/api/quality-gate-smoke.ts || { echo "MISSING stryker mutate target"; missing=1; }
test -f packages/agents/scripts/verify-api-property-ratio.js -o -f scripts/verify-agent-api-property-ratio.js || { echo "MISSING property ratio script"; missing=1; }
npm test -- --testNamePattern "@plan:.*P08"
# Prove Stryker can execute in this package against the tiny smoke target. This is a viability check, not the final 80% gate.
npm exec --workspace @vybestack/llxprt-code-agents -- stryker run stryker.conf.json --mutate "src/api/quality-gate-smoke.ts" || { echo "FAIL stryker viability"; missing=1; }
exit $missing
```

### Structural Verification Checklist

- [ ] Stryker dependencies configured before harness phases
- [ ] Stryker config scoped to the Agent API
- [ ] Stryker viability command ran successfully on a tiny target
- [ ] Property-ratio script exists and exits non-zero below 30%
- [ ] No final-phase-only mutation setup remains

### Semantic Verification Checklist

1. **Does this enforce the quality gate early?**
   - [ ] Tooling viability is proven before tests/implementation depend on it
   - [ ] P29 can consume reports instead of installing dependencies
2. **Would it fail if mutation tooling cannot run?**
   - [ ] Yes, the viability command exits non-zero in P08/P08a
3. **Does it avoid mock theater?**
   - [ ] The smoke test exercises a real tiny function in the package, not a mock

## Success Criteria

- Mutation/property infrastructure exists before harness phases.
- Stryker viability is proven.
- P29 is a pure evaluator that consumes reports.

## Failure Recovery

- `git checkout -- packages/agents/package.json packages/agents/stryker.conf.json packages/agents/src/api/quality-gate-smoke.ts packages/agents/src/api/__tests__/quality-gate-smoke.spec.ts packages/agents/scripts/verify-api-property-ratio.js scripts/verify-agent-api-property-ratio.js`
- Re-run Phase 08 with corrected tooling.

## Phase Completion Marker

Create: `project-plans/issue1594/.completed/P08.md`
Contents include verification command output and dependency versions.
