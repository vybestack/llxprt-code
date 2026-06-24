# Phase 08a: Quality Gate Setup Verification

## Phase ID

`PLAN-20260617-COREAPI.P08a`

## LLxprt Code Subagent: typescriptreviewer

## Prerequisites

- Required: Phase 08 completed
- Verification: `grep -rc "@plan:PLAN-20260617-COREAPI.P08" packages/agents/src/api packages/agents/src/api/__tests__/`

## Verification Commands

```bash
missing=0
node -e "const p=require('./packages/agents/package.json'); const d={...(p.devDependencies||{}),...(p.dependencies||{})}; for (const x of ['@stryker-mutator/core','@stryker-mutator/vitest-runner']) if(!d[x]) { console.error('MISSING '+x); process.exitCode=1; }" || missing=1
test -f packages/agents/stryker.conf.json || { echo "MISSING stryker config"; missing=1; }
test -f packages/agents/src/api/quality-gate-smoke.ts || { echo "MISSING stryker mutate target"; missing=1; }
test -f packages/agents/scripts/verify-api-property-ratio.js -o -f scripts/verify-agent-api-property-ratio.js || { echo "MISSING property ratio script"; missing=1; }
npm test -- --testNamePattern "@plan:.*P08" || missing=1
npm exec --workspace @vybestack/llxprt-code-agents -- stryker run stryker.conf.json --mutate "src/api/quality-gate-smoke.ts" || { echo "FAIL stryker viability"; missing=1; }
exit $missing
```

## Semantic Verification Checklist (MANDATORY)

1. Does Stryker run in `packages/agents` before the harness phases against the real `src/api/quality-gate-smoke.ts` target created in P08?
2. Is the config scoped to `src/api/**` so it will measure the Agent API, not unrelated code?
3. Does the property-ratio script define the denominator/numerator exactly as the plan requires?
4. Is P29 now a pure consumer of reports rather than the place where tooling is installed?

### Holistic Functionality Assessment (completion marker)

Explain why mutation/property gates are now executable early and what command output proves viability.

## Success Criteria

- PASS only if the Stryker smoke run and property script verification succeed.

## Failure Recovery

- Return to Phase 08.

## Phase Completion Marker

Create: `project-plans/issue1594/.completed/P08a.md`
