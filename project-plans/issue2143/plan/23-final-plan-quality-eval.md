<!-- @plan:PLAN-20260622-COREAPIGAP.P23 @requirement:REQ-001,REQ-002,REQ-003,REQ-004,REQ-005,REQ-006,REQ-007,REQ-008,REQ-009,REQ-010,REQ-INT-001,REQ-INT-002,REQ-INT-003,REQ-INT-004,REQ-INT-005 -->
# Phase 23: Final Plan-Quality & Adequacy Evaluation

## Phase ID

`PLAN-20260622-COREAPIGAP.P23`

## LLxprt Code Subagent: architect

## Prerequisites

- Required: Phase 22a completed (PASS)
- Verification: `test -f project-plans/issue2143/.completed/P22a.md`

## Purpose

Final gate. Evaluate the COMPLETED additive surface against `dev-docs/PLAN.md`'s rejection criteria
and against the core mission: is the public agents API now ADEQUATE to enable issue #1595 (CLI as a
thin UI with NO `getConfig()` escape hatches and NO deep imports)? This phase writes no production
code — it renders a defensible verdict with evidence, and (if any check fails) names the exact
phase(s) to redo.

## Evaluation — Integration-First (CHECK FIRST; if any fail, REJECT)

- [ ] Plan modifies SPECIFIC existing files (`agent.ts`, `agentImpl.ts`, `control/mcpControl.ts`,
      `control/authControl.ts`, `control/hooks.ts`, `control/toolControl.ts`, `api/index.ts`,
      `app-services/command-api-map.ts`, `docs/agent-api.md`) and adds THREE new controls under the
      EXISTING `control/` convention — not an isolated parallel surface.
- [ ] The adequacy driver (`capabilityGaps.integration.spec.ts`) CANNOT be written without the new
      public methods (proves the seams are load-bearing for #1595).
- [ ] There IS a consumer path for #1595: every one of the seven capabilities is reachable on a real
      `fromConfig`/harness-built Agent via the public root ONLY (P20/P20a).
- [ ] No capability is "reachable" only via `getConfig()` or a deep import (P20 forbids `getConfig`;
      P21 enforces the T17 no-deep-import boundary).

## Evaluation — Gap Closure (each must be YES with evidence)

| Gap | Capability | Requirement | Phases | Closed? (evidence) |
|---|---|---|---|---|
| G1 | Approval mode read/write (+ untrusted throw) | REQ-001 / REQ-INT-001 | 03,04,04a,20,20a | [ ] |
| G2 | Policy inspection (read-only, argsPattern→source) | REQ-002 / REQ-INT-002 | 05,06,06a,20,20a | [ ] |
| G3 | Async-task admin (full `/task`) | REQ-003 / REQ-INT-002 | 07,08,08a,20,20a | [ ] |
| G4 | Hooks administration (registry + enable/disable) | REQ-004 / REQ-INT-003 | 09,10,10a,20,20a | [ ] |
| G5 | Detailed OAuth state (masked) | REQ-005 / REQ-INT-003 | 11,12,12a,20,20a | [ ] |
| G6 | MCP OAuth + deep detail + refresh setTools parity | REQ-006 / REQ-INT-004 | 13,14,14a,20,20a | [ ] |
| G7 | Built-in tool-key storage (`agent.tools.keys`, masked) | REQ-007 / REQ-INT-004 | 15,16,16a,20,20a | [ ] |
| — | Barrel re-exports + `COMMAND_API_MAP` six rows | REQ-008 | 17,17a | [ ] |
| — | Non-breaking guarantee | REQ-009 | 18,18a,21,21a | [ ] |
| — | Documentation | REQ-010 | 19,19a | [ ] |
| — | No-deep-import boundary | REQ-INT-005 | 20,20a,21,21a | [ ] |

### Capability-closure acceptance (evaluate against the EXPLICIT spec interpretation)

For EACH gap G1–G7, "closed" requires ALL of:
- [ ] (a) the public method(s) exist on the documented surface (top-level for approval; sub-controller
      for policy/tasks/tool-keys; extended controller for hooks/auth/mcp) and are re-exported/typed
      from the public root where applicable (P17);
- [ ] (b) DEEP behavior is proven by the owning `.behavior.test.ts` (real Config/objects, no mock
      theater, ≥30% property), and the impl cites the pseudocode line numbers (NNa gate passed);
- [ ] (c) REACHABILITY is proven by the public-root-only adequacy driver (P20) — the method is
      callable on a real Agent with no `getConfig`/deep import;
- [ ] (d) the documented CONSTRAINTS hold: approval untrusted-throw delegated-not-caught;
      `AgentTaskInfo` omits `abortController`; policy `argsPattern` projected to `.source`; auth /
      tool-keys masked (no raw secret); MCP `refresh()` has setTools parity; undefined-safe backing
      managers.

## Evaluation — TDD/Quality Discipline

- [ ] No reverse testing (no `toThrow('NotYetImplemented')`, no `not.toThrow()`).
- [ ] No mock theater (no `toHaveBeenCalled`/`mockResolvedValue`/`mockReturnValue`/`vi.fn`/`vi.spyOn`
      in behavioral suites).
- [ ] ≥30% property-based across new behavioral suites (each ≥2 distinct cases).
- [ ] Impl phases cite pseudocode line numbers; the pseudocode-compliance gates ran (04a, 06a, 08a,
      10a, 12a, 14a, 16a).
- [ ] Mutation ≥80% over `src/api/**`, non-vacuous on each NEW control (Phase 22 evidence;
      independently re-confirmed 22a).
- [ ] Non-breaking proven by characterization + built-artifact subset (Phases 18/18a, swept again in
      21/21a).
- [ ] No V2/New/parallel files; existing files UPDATED; new controls follow the existing convention.
- [ ] Comment-discipline N5 on new production files (only @plan/@requirement/@pseudocode markers).

## Evaluation — #1595 Adequacy (the mission)

Answer explicitly with evidence:
- [ ] Can a CLI restricted to the public root read/write approval mode (incl. the untrusted-folder
      throw)? (REQ-INT-001)
- [ ] Can it inspect policy rules/defaults and drive the full `/task` surface? (REQ-INT-002)
- [ ] Can it administer hooks (registry + enable/disable) and render detailed (masked) auth status?
      (REQ-INT-003)
- [ ] Can it perform MCP OAuth (with post-auth setTools parity), read deep MCP detail, and manage
      built-in tool keys (masked)? (REQ-INT-004)
- [ ] Is there a clear, documented import boundary (public root only) so #1595 can delete its deep
      imports and `getConfig()` escapes? (REQ-INT-005, REQ-010)

## Output

Write `project-plans/issue2143/plan-evaluation.json`:

```json
{
  "compliant": true,
  "has_integration_plan": true,
  "builds_in_isolation": false,
  "gaps_closed": { "G1": true, "G2": true, "G3": true, "G4": true, "G5": true, "G6": true, "G7": true },
  "additive_only_non_breaking": true,
  "enables_1595": true,
  "public_root_only_reachable": true,
  "reverse_testing_found": false,
  "mock_theater_found": false,
  "property_ge_30": true,
  "mutation_ge_80": true,
  "docs_updated": true,
  "violations": []
}
```

If `builds_in_isolation` is true OR any gap is unclosed OR `enables_1595` is false OR
`public_root_only_reachable` is false OR `additive_only_non_breaking` is false → **REJECT** and list
the responsible phase(s) to redo in `violations`.

## Verification Commands

```bash
set -o pipefail
set -e
# All phase markers present (00..22a) — the plan actually ran end to end.
for P in 00 00a 01 01a 02 02a 03 04 04a 05 06 06a 07 08 08a 09 10 10a 11 12 12a 13 14 14a 15 16 16a 17 17a 18 18a 19 19a 20 20a 21 21a 22 22a; do
  test -f "project-plans/issue2143/.completed/P$P.md" || { echo "FAIL: missing marker P$P"; exit 1; }
done
# The evaluation artifact exists and asserts success.
test -f project-plans/issue2143/plan-evaluation.json
node -e '
  const e = require("./project-plans/issue2143/plan-evaluation.json");
  const must = ["compliant","has_integration_plan","enables_1595","public_root_only_reachable","additive_only_non_breaking","docs_updated"];
  for (const k of must) if (e[k] !== true) { console.error("FAIL: "+k+" !== true"); process.exit(1); }
  if (e.builds_in_isolation !== false) { console.error("FAIL: builds_in_isolation must be false"); process.exit(1); }
  for (const [g,v] of Object.entries(e.gaps_closed)) if (v !== true) { console.error("FAIL: gap "+g+" unclosed"); process.exit(1); }
  if (e.reverse_testing_found || e.mock_theater_found) { console.error("FAIL: discipline violation flagged"); process.exit(1); }
  if (e.violations.length) { console.error("FAIL: violations present", e.violations); process.exit(1); }
  console.log("plan-evaluation.json asserts full closure + #1595 adequacy");
'
echo "PASS: P23 final evaluation green."
```

## Success Criteria

- Verdict rendered with evidence; all seven gaps closed; additive/non-breaking; #1595 adequacy
  affirmed on the public-root-only path; no rejection triggers.

## Failure Recovery

- Reopen the specific phase(s) named in `violations`; do not mark the plan complete until the
  evaluation asserts success with evidence.

## Phase Completion Marker

Create: `project-plans/issue2143/.completed/P23.md` (include the JSON + narrative verdict).

```markdown
Phase: P23
Completed: YYYY-MM-DD HH:MM
Files Created: [plan-evaluation.json]
Files Modified: none
Tests Added: none (evaluation phase)
Verification: [paste actual output of THIS phase's verification commands]
Semantic Assessment: [one-line holistic verdict: all 7 gaps closed, additive, #1595 reachable via public root only]
```
