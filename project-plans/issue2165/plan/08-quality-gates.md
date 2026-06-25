<!-- @plan:PLAN-20260622-MCPOAUTHTRUTH.P08 @requirement:REQ-001,REQ-002,REQ-003,REQ-004,REQ-INT-001,REQ-INT-002 -->
# Phase 08 — Quality Gates (Full Suite + Scoped Mutation + Smoke)

Plan ID: PLAN-20260622-MCPOAUTHTRUTH
Phase: P08 (quality gates)

## LLxprt Code Subagent: typescriptexpert

## Purpose

Prove the whole change is production-ready: the full verification suite is green; the
behavioral-quality MUTATION gate holds on the logic-bearing files; and the CLI smoke
runs. This phase fixes survivors by STRENGTHENING behavioral tests — it NEVER relaxes
a threshold and NEVER adds a structural/mock test to chase a number.

## Background — the LOCKED mutation policy (read before triaging survivors)

Stryker AUTOMATES the RULES.md litmus ("if I delete/break the impl, does a test
fail?") and PUNISHES mock theater (mocking the unit-under-test leaves real-code
mutants alive). Apply these four rules verbatim:

- **(a) Scope:** mutate ONLY logic-bearing files with real branching/observable
  output: `packages/mcp/src/auth/oauth-status.ts` (the 4 outcomes + OR-combine +
  catch→'none') and `packages/agents/src/api/control/mcpControl.ts` (the corrected
  projection / `buildAuthStatus` / `buildServerDetail` derivation). NEVER mutate
  glue/barrels/wiring (`mcpControlWiring.ts`, `index.ts`) or pure setters.
- **(b) A surviving mutant is a REVIEW QUESTION**, not a mandate: "is there a real,
  observable behavior we forgot to assert?" If yes → add a BEHAVIORAL case to the
  owning `.behavior.test.ts`. If killing it would require a private/internal/mock-call
  assertion → LEAVE IT SURVIVED.
- **(c) Genuinely equivalent mutants** (unreachable boundary, reordered independent
  ops) may survive with a `// Stryker disable next-line <mutator>` + a written reason.
  This headroom is why the bar is 80%, not 100%.
- **(d) Behavioral honesty OVERRIDES the 80% number.** If a file cannot reach 80%
  without violating RULES.md, the threshold yields and you DOCUMENT why in this
  phase's marker.

## Deterministic gates (BLOCKING — run from repo root, capture exits WITHOUT pipe-masking)

```bash
run() { echo "== $1 =="; bash -c "$2" > "/tmp/p08_$3.log" 2>&1; echo "EXIT=$?"; tail -5 "/tmp/p08_$3.log"; }
run "typecheck" "npm run typecheck" tc
run "lint"      "npm run lint"      lint
run "format"    "npm run format"    fmt
run "build"     "npm run build"     build
run "test"      "npm run test"      test
```

- Each must be `EXIT=0`. For `npm run test`, the monorepo root oversubscribes CPU
  (proven load-contention): any failing file MUST be re-run in isolation
  (`npx vitest run <file>`); record the isolation result. A file that is RED at root
  but GREEN in isolation is a documented flake, not a defect — but you MUST show the
  isolation pass.
- Smoke: `node scripts/start.js --profile-load ollamakimi "write me a haiku and nothing else"` → prints a haiku, `EXIT=0`.

## Mutation gate — `packages/mcp` (oauth-status.ts)

```bash
cd packages/mcp
npm run test:mutation > /tmp/p08_mcp_stryker.log 2>&1; echo "STRYKER_EXIT=$?"
tail -30 /tmp/p08_mcp_stryker.log
```

- Stryker's own `break: 80` non-zero-exits under 80% — that is the PRIMARY gate (run
  under the worker's `set -e`). Additionally COMPUTE the score from the JSON report
  (there is NO precomputed `mutationScore` field):
  ```bash
  jq -r '
    [ .files[].mutants[].status ] as $all
    | ($all|map(select(.=="Killed" or .=="Timeout"))|length) as $d
    | ($all|map(select(.=="Killed" or .=="Timeout" or .=="Survived" or .=="NoCoverage"))|length) as $v
    | if $v==0 then 0 else ($d*100/$v) end
  ' reports/mutation/mutation.json | awk '{ printf "oauth-status.ts mutation=%.2f%%\n",$1; if ($1+0 < 80) { print "FAIL: <80%"; exit 1 } }'
  cd ../..
  ```
- For each SURVIVED mutant, apply policy (b)/(c): strengthen the Phase-1
  `oauth-status.behavior.test.ts` with a behavioral case, or annotate as equivalent
  with a written reason. Record the survivor list + disposition in the marker.

## Mutation gate — `packages/agents` (mcpControl.ts, scoped)

The agents Stryker config (`packages/agents/stryker.conf.json`) declares
`src/api/**/*.ts`, but per LOCKED mutation policy (a) we mutate ONLY the
logic-bearing file this phase changed — `mcpControl.ts` — via the `--mutate` CLI
override (the same scoping P06a used). This keeps Stryker's own `break: 80` a
PER-FILE gate on `mcpControl.ts`, excludes glue/barrels/wiring (`mcpControlWiring.ts`,
`index.ts`, type-only `agent.ts`) per policy (a), and avoids re-mutating ~15 unrelated
already-gated #2143 control files. The new/changed projection must hit ≥80% on
`mcpControl.ts`.

```bash
cd packages/agents
npm run test:mutation:api -- --mutate "src/api/control/mcpControl.ts" > /tmp/p08_agents_stryker.log 2>&1; echo "STRYKER_EXIT=$?"
# per-file score for the corrected projection
jq -r '
  (.files | to_entries[] | select(.key | endswith("control/mcpControl.ts")) | .value.mutants) as $m
  | ($m|map(select(.status=="Killed" or .status=="Timeout"))|length) as $d
  | ($m|map(select(.status=="Killed" or .status=="Timeout" or .status=="Survived" or .status=="NoCoverage"))|length) as $v
  | if $v==0 then 0 else ($d*100/$v) end
' reports/mutation/mutation.json | awk '{ printf "mcpControl.ts mutation=%.2f%%\n",$1; if ($1+0 < 80) { print "FAIL: mcpControl.ts <80%"; exit 1 } }'
cd ../..
```

- Survivors on `mcpControl.ts` → strengthen `mcpProjection.behavior.test.ts` /
  `mcpOAuth.behavior.test.ts` behaviorally, or annotate equivalents with reasons.
- `mcpControlWiring.ts` (glue) and `agent.ts` (type-only) are intentionally OUT of the
  mutate focus per policy (a) and are excluded by the `--mutate` override above.

## N5 comment discipline (BLOCKING)

```bash
for f in packages/mcp/src/auth/oauth-status.ts \
         packages/agents/src/api/control/mcpControl.ts \
         packages/agents/src/api/control/mcpControlWiring.ts; do
  # only @plan/@requirement/@pseudocode line-comments allowed; flag prose comments
  if grep -nE "^\s*//" "$f" | grep -vE "@plan|@requirement|@pseudocode"; then
    echo "FAIL: prose comment in $f (N5)"; exit 1
  fi
done
echo "PASS: N5 comment discipline."
```

## Deferred / placeholder scan (BLOCKING — whole production set)

```bash
if grep -RnE "TODO|FIXME|HACK|STUB|placeholder|for now" \
   packages/mcp/src/auth/oauth-status.ts \
   packages/agents/src/api/control/mcpControl.ts \
   packages/agents/src/api/control/mcpControlWiring.ts \
   packages/agents/src/api/agent.ts; then
  echo "FAIL: deferred marker in production"; exit 1
fi
echo "PASS: no deferred markers."
```

## Semantic Checklist

- [ ] All six deterministic gates EXIT=0 (test isolation documented where needed).
- [ ] Smoke prints a haiku, EXIT=0.
- [ ] `oauth-status.ts` ≥80% and `mcpControl.ts` ≥80% mutation; every survivor either
      killed by a NEW behavioral case or annotated equivalent with a written reason.
- [ ] No survivor was "killed" by adding a structural/mock/`toHaveBeenCalled` test.
- [ ] N5 + deferred scans clean.

## Completion Marker

Write `project-plans/issue2165/.completed/P08.md` containing: the six gate EXIT codes
(+ any isolation re-runs); the smoke output; the two mutation scores; the FULL
survivor list with per-survivor disposition (behavioral case added → cite the new
test name, OR equivalent → cite the `// Stryker disable` reason); and an explicit
statement that no threshold was relaxed and no mock theater was introduced.
