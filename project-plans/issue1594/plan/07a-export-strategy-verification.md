# Phase 07a: Export Strategy Verification

## Phase ID

`PLAN-20260617-COREAPI.P07a`

## LLxprt Code Subagent: typescriptreviewer

## Prerequisites

- Required: Phase 07 completed
- Verification: `grep -c "@plan:PLAN-20260617-COREAPI.P07" packages/agents/src/internals.ts`

## Verification Commands

```bash
node -e "const p=require('./packages/agents/package.json'); console.log(Object.keys(p.exports))"
npm run typecheck
npm run build
# Root entry must remain non-breaking and add the public API
missing=0
grep -q "createAgent" packages/agents/src/index.ts || { echo "FAIL no createAgent export"; missing=1; }
grep -q "listProviders" packages/agents/src/index.ts || { echo "FAIL no listProviders export"; missing=1; }
for sym in AgentClient AgenticLoop CoreToolScheduler; do
  grep -q "$sym" packages/agents/src/index.ts || { echo "FAIL root lost legacy low-level export $sym"; missing=1; }
  grep -q "$sym" packages/agents/src/internals.ts || { echo "FAIL internals missing low-level export $sym"; missing=1; }
done
node - <<'NODE'
const p = require('./packages/agents/package.json');
if (!p.exports['.']) throw new Error('missing root export');
if (!p.exports['./internals.js']) throw new Error('missing internals export');
NODE
exit $missing
```

## Semantic Verification Checklist (MANDATORY)

1. Does the root `.` entry keep existing low-level exports and add the public Agent surface?
2. Are low-level symbols also reachable via `./internals.js` for future/power-user migration?
3. Does the whole monorepo still build/typecheck (consumers not broken)?
4. Is final top-level curation/removal deferred to #1595, with `core/index.ts` untouched here?

### Holistic Functionality Assessment (completion marker)

- Confirm import boundary is import-safe and matches REQ-018/REQ-019 intent.
- Verdict PASS/FAIL.

## Success Criteria

- PASS only if build/typecheck clean, root entry remains non-breaking, and `./internals.js` works.

## Failure Recovery

- Return to Phase 07.

## Phase Completion Marker

Create: `project-plans/issue1594/.completed/P07a.md`
