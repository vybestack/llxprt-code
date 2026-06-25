<!-- @plan:PLAN-20260622-MCPOAUTHTRUTH.P08a @requirement:REQ-001,REQ-002,REQ-003,REQ-004,REQ-INT-001,REQ-INT-002 -->
# Phase 08a — Quality Gates: Verification (BLIND GATE)

Plan ID: PLAN-20260622-MCPOAUTHTRUTH
Phase: P08a (verification)

## LLxprt Code Subagent: architect

Independent first-time review. Reproduce the gates yourself; do not trust the P08
marker's pasted numbers without re-running. Do not rubber-stamp.

## Prerequisites

- `test -f project-plans/issue2165/.completed/P08.md`.

## Re-run the deterministic gates (BLOCKING)

```bash
run() { echo "== $1 =="; bash -c "$2" > "/tmp/v08_$3.log" 2>&1; echo "EXIT=$?"; tail -5 "/tmp/v08_$3.log"; }
run "typecheck" "npm run typecheck" tc
run "lint"      "npm run lint"      lint
run "format"    "npm run format"    fmt
run "build"     "npm run build"     build
```

- All EXIT=0. Then re-run the two behavioral suites + the agents api dir in
  isolation and confirm GREEN:
  ```bash
  npx vitest run packages/agents/src/api/__tests__/mcpProjection.behavior.test.ts > /tmp/v08_proj.log 2>&1; echo "EXIT=$?"
  npx vitest run packages/agents/src/api/__tests__/mcpOAuth.behavior.test.ts > /tmp/v08_oauth.log 2>&1; echo "EXIT=$?"
  npx vitest run packages/mcp/src/auth/oauth-status.behavior.test.ts > /tmp/v08_helper.log 2>&1; echo "EXIT=$?"
  ```

## Re-run the mutation gates (BLOCKING)

```bash
# mcp helper
( cd packages/mcp && npm run test:mutation > /tmp/v08_mcp_stryker.log 2>&1; echo "STRYKER_EXIT=$?"; \
  jq -r '[ .files[].mutants[].status ] as $all | ($all|map(select(.=="Killed" or .=="Timeout"))|length) as $d | ($all|map(select(.=="Killed" or .=="Timeout" or .=="Survived" or .=="NoCoverage"))|length) as $v | if $v==0 then 0 else ($d*100/$v) end' reports/mutation/mutation.json )

# agents projection (scoped to mcpControl.ts)
( cd packages/agents && npm run test:mutation:api > /tmp/v08_agents_stryker.log 2>&1; echo "STRYKER_EXIT=$?"; \
  jq -r '(.files | to_entries[] | select(.key | endswith("control/mcpControl.ts")) | .value.mutants) as $m | ($m|map(select(.status=="Killed" or .status=="Timeout"))|length) as $d | ($m|map(select(.status=="Killed" or .status=="Timeout" or .status=="Survived" or .status=="NoCoverage"))|length) as $v | if $v==0 then 0 else ($d*100/$v) end' reports/mutation/mutation.json )
```

- Confirm `oauth-status.ts ≥80%` and `mcpControl.ts ≥80%`.

## Survivor-disposition audit (BLOCKING — the heart of this gate)

For EVERY survivor recorded in P08.md, independently verify the disposition is
HONEST:

- If P08 claims it was killed by a new behavioral case: open that test and confirm it
  asserts a REAL observable VALUE (not `toHaveBeenCalled` / spy / structural-only).
  A survivor "killed" by a mock-theater test is a FAIL.
- If P08 claims equivalence: confirm the `// Stryker disable next-line` reason is
  legitimate (genuinely unreachable / reordered-independent), not an excuse to dodge a
  real assertion gap. A bogus equivalence claim is a FAIL.
- Confirm NO threshold in either `stryker.conf.json` was lowered (git diff the configs
  vs their introduction; `break` must remain `80`).

```bash
git diff HEAD -- packages/mcp/stryker.conf.json packages/agents/stryker.conf.json | grep -E "^\+.*\"break\"\s*:\s*([0-7][0-9]|[0-9])\b" && { echo "FAIL: break threshold lowered"; exit 1; } || true
```

## N5 + deferred re-scan (BLOCKING)

Re-run the P08 N5 and deferred scans yourself and confirm clean.

## Holistic Assessment (MANDATORY — narrative)

- State each gate's reproduced EXIT and the two mutation scores you measured (not the
  ones pasted by P08).
- Assess whether the survivor dispositions uphold the LOCKED policy (behavioral-only
  kills; honest equivalences). Name any disposition you reject and why.
- Confirm behavioral honesty was NOT traded for the number (no mock theater added).
- Verdict: PASS / FAIL with evidence.

## Completion Marker

Write `project-plans/issue2165/.completed/P08a.md` with: your reproduced gate EXITs;
your measured mutation scores; your independent survivor-disposition audit (accept /
reject each); the threshold-unchanged confirmation; and the PASS/FAIL verdict.
