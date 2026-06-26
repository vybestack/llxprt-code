<!-- @plan:PLAN-20260622-MCPOAUTHTRUTH.P09 @requirement:REQ-001,REQ-002,REQ-003,REQ-004,REQ-005,REQ-INT-001,REQ-INT-002 -->
# Phase 09 — Final Plan Quality Evaluation

Plan ID: PLAN-20260622-MCPOAUTHTRUTH
Phase: P09 (final evaluation)

## LLxprt Code Subagent: architect

Final independent gate against `dev-docs/PLAN.md` rejection criteria and the #1595
adequacy goal. Reproduce against source. Do not rubber-stamp. Emit a machine-readable
verdict.

## Prerequisites

- All prior markers exist:
  `for p in P00a P01 P01a P02 P02a P03 P04 P04a P05 P06 P06a P07 P07a P08 P08a; do
   test -f project-plans/issue2165/.completed/$p.md || { echo "MISSING $p"; exit 1; }; done`

## Evaluation — Integration-First (CHECK THESE FIRST; any failure ⇒ REJECT)

1. **Public-root reachability** — `getMcpServerOAuthStatus` / `McpOAuthStatus` reachable
   from `@vybestack/llxprt-code-core`; the corrected `authenticated`/`requiresAuth` +
   new `oauthStatus`/`sessionAuthenticated` reachable from
   `@vybestack/llxprt-code-agents` — WITHOUT any deep import or `agent.getConfig()`.
2. **No re-derivation** — agents calls the engine helper; it does NOT re-read the
   token store or recompute expiry (R-NO-REDERIVE).
3. **Behavioral proof exists** — `oauth-status.behavior.test.ts` +
   `mcpProjection.behavior.test.ts` drive REAL seams (MockTokenStorage/setTokenStore;
   `new McpControl(deps)` with controllable closures), no mock theater, ≥30% property.
4. **Additive / non-breaking** — no existing export/field removed or reshaped; guards
   prove it.

If any of 1–4 fails, the plan is REJECTED regardless of the rest.

## Gap-Closure Table (each must be YES with evidence)

| Defect | Closed? | Evidence (file:line / test) |
| --- | --- | --- |
| D1 `authenticated` = in-session only | | `authenticated = (oauthStatus==='authenticated')` mcpControl.ts:___; T20/T21 + PROP-A |
| D2 `requiresAuth` hardcoded `true` | | real per-server in `buildAuthStatus`/`buildServerDetail` + wiring `getRequiresAuth`; T23/PROP-B; no `requiresAuth: true` remains |
| D3 no persisted/session/expired distinction | | quad-state `oauthStatus` + distinct `sessionAuthenticated`; T22 (independence) + PROP-C parity |

## Capability-Closure Acceptance (a–d for the whole change)

- **a) Surface exists + re-exported** — helper + type from core barrel; new fields +
  type-only `McpOAuthStatus` from agents barrel.
- **b) DEEP behavior proven** — each requirement proven by a `.behavior.test.ts` with
  no mock theater, ≥30% property, pseudocode-cited; NOT merely "method is defined".
- **c) Reachability** — every new capability reachable from the public root alone.
- **d) Constraints hold** — masked (enum/booleans only, no token/cred/expiry crosses
  the boundary); undefined-safe (absent closures/store ⇒ `'not-required'`/`'none'`/
  `false`, never throws); delegate-not-cache; `performOAuth` rejection propagates;
  no Promise leaks into a detail field.

## TDD-Discipline Checklist

- [ ] Tests written BEFORE impl (P03/P05 markers precede P04/P06).
- [ ] No reverse tests, no mock theater, no `any`, ≥30% property / MIN-2 each suite.
- [ ] Mutation ≥80% on the two logic-bearing files; survivors triaged per the LOCKED
      policy (behavioral kills or documented equivalents); no threshold relaxed.
- [ ] Non-breaking guard + docs additive; production untouched in P07.

## #1595-Adequacy Statement (explicit, with evidence)

State plainly whether a CLI (#1595) can now render the full `/mcp` OAuth UX —
authenticated / expired / none / not-required, plus the in-session distinction and the
real `requiresAuth` — using ONLY the public Agent/Core API, with NO `agent.getConfig()`
escape hatch for OAuth status. Cite the public symbols + the parity tests that prove
it. If any residual escape hatch remains, name it (this would be a REJECT).

## Output — `project-plans/issue2165/plan-evaluation.json`

Write EXACTLY this schema (booleans reflect your reproduced findings):

```json
{
  "plan_id": "PLAN-20260622-MCPOAUTHTRUTH",
  "issue": 2165,
  "compliant": true,
  "has_integration_plan": true,
  "builds_in_isolation": false,
  "gaps_closed": { "D1": true, "D2": true, "D3": true },
  "additive_only_non_breaking": true,
  "enables_1595": true,
  "public_root_only_reachable": true,
  "no_rederivation_engine_truth": true,
  "reverse_testing_found": false,
  "mock_theater_found": false,
  "property_ge_30": true,
  "mutation_ge_80": true,
  "docs_updated": true,
  "violations": []
}
```

`builds_in_isolation` is `false` by design (this is a feature within the monorepo,
not a standalone package). Any real violation goes in `violations` and flips
`compliant` to `false`.

## Verification (BLOCKING)

```bash
set -o pipefail
set -e
for p in P00a P01 P01a P02 P02a P03 P04 P04a P05 P06 P06a P07 P07a P08 P08a; do
  test -f "project-plans/issue2165/.completed/$p.md" || { echo "FAIL: missing marker $p"; exit 1; }
done
test -f project-plans/issue2165/plan-evaluation.json || { echo "FAIL: no plan-evaluation.json"; exit 1; }

node -e '
  const e = require("./project-plans/issue2165/plan-evaluation.json");
  const mustTrue = ["compliant","has_integration_plan","additive_only_non_breaking","enables_1595","public_root_only_reachable","no_rederivation_engine_truth","property_ge_30","mutation_ge_80","docs_updated"];
  for (const k of mustTrue) if (e[k] !== true) { console.error("FAIL: "+k+" !== true"); process.exit(1); }
  if (e.builds_in_isolation !== false) { console.error("FAIL: builds_in_isolation must be false"); process.exit(1); }
  if (e.reverse_testing_found !== false || e.mock_theater_found !== false) { console.error("FAIL: discipline violation flagged"); process.exit(1); }
  for (const d of ["D1","D2","D3"]) if (e.gaps_closed[d] !== true) { console.error("FAIL: gap "+d+" not closed"); process.exit(1); }
  if (!Array.isArray(e.violations) || e.violations.length !== 0) { console.error("FAIL: non-empty violations"); process.exit(1); }
  console.log("PASS: plan-evaluation.json schema + verdict consistent.");
'
echo "PASS: P09 final evaluation green."
```

## Completion Marker

Write `project-plans/issue2165/.completed/P09.md` containing: the filled Gap-Closure
table; the a–d acceptance findings with file:line; the #1595-adequacy statement; the
final `plan-evaluation.json` contents; and the narrative PASS/FAIL verdict.
