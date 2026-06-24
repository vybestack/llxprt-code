<!-- @plan:PLAN-20260621-COREAPIREMED.P24 @requirement:REQ-001,REQ-002,REQ-003,REQ-004,REQ-005,REQ-006,REQ-007,REQ-INT-001,REQ-INT-002,REQ-INT-003,REQ-INT-004 -->
# Phase 24: Final Plan-Quality & Adequacy Evaluation

## Phase ID

`PLAN-20260621-COREAPIREMED.P24`

## LLxprt Code Subagent: architect

## Prerequisites

- Required: Phase 23a completed (PASS)
- Verification: `test -f project-plans/issue1594remediate/.completed/P23a.md`

## Purpose

Final gate. Evaluate the COMPLETED remediation against PLAN.md's rejection criteria and against the
core mission: is the public agents API now ADEQUATE to enable issue #1595 (CLI as a thin UI with no
deep imports)? This phase does not write production code — it renders a defensible verdict with
evidence.

## Evaluation — Integration-First (CHECK FIRST; if any fail, REJECT)

- [ ] Plan modifies SPECIFIC existing files (createAgent.ts, agentImpl.ts, agent.ts, api/index.ts,
      and the providers `runtimeContextFactory.ts` providerManager? seam) — not an isolated parallel
      surface.
- [ ] The parity harness CANNOT be written without the new seams (proves the seams are load-bearing).
- [ ] There IS a consumer path for #1595: `fromConfig(existing Config)` + public settings/runtime/
      client surface + turn-drive parity with the CLI's real `AgenticLoop` drive.
- [ ] No seam can be fully exercised in isolation (each is proven against a REAL Config/FakeProvider).

## Evaluation — Gap Closure (each must be YES with evidence)

| Gap | Requirement | Phases | Closed? (evidence) |
|---|---|---|---|
| (CRIT-1) providers providerManager? adoption seam | REQ-005 / REQ-001.2 | 03,04,05,05a | [ ] |
| C1 Config-injection seam (`fromConfig`) | REQ-001 / REQ-INT-001 | 06,07,08,08a,09,09a,19,20 | [ ] |
| C2 Agent settings/config surface | REQ-002 / REQ-INT-003 | 10,11,11a,12,12a,19 | [ ] |
| C3 turn-drive via public API | REQ-INT-002 | 07,07a,09,09a,19,20,20a | [ ] |
| H1 client-contract promotion | REQ-004 / REQ-006 | 15,15a,16,16a | [ ] |
| H2 provider-runtime reachability | REQ-005 / REQ-001.2 | 03,04,05,09,17,17a,18,18a | [ ] |
| H3 getCurrentSequenceModel real impl | REQ-003 | 13,13a,14,14a | [ ] |

### H1 closure acceptance (CRIT-5) — evaluate against the EXPLICIT spec interpretation

H1 names BOTH `AgentClient` and `AgentClientContract`. Per `specification.md` REQ-004 → "H1
Acceptance Interpretation (CRIT-5)", H1 is CLOSED iff ALL THREE hold (do NOT mark H1 closed unless
each is evidenced):
- [ ] (a) TYPE-ONLY `AgentClientContract` is reachable from the CURATED API barrel
      `@vybestack/llxprt-code-agents` (`packages/agents/src/api/index.ts`) — the load-bearing #1595
      deliverable (evidence: P16/P16a; `export type` form per REQ-004.2).
- [ ] (b) The concrete `AgentClient` CLASS remains exported from `./internals.js`
      (`packages/agents/src/internals.ts:38`) AND stays transitively reachable from the package root
      (`packages/agents/src/index.ts:26` `export * from './internals.js'`) — non-breaking, no
      regression (evidence: P21/P21a export diff).
- [ ] (c) The concrete `AgentClient` CLASS is DELIBERATELY ABSENT from the curated API barrel
      (curated boundary stays contract-only; not coupled to the trimmable internals re-export). This
      narrowing is INTENTIONAL and justified, NOT a silent gap — confirm the spec records the
      rationale and the curated barrel exposes only the contract.
This makes the H1 verdict unambiguous: contract on the curated API + class still reachable via
internals/root + class intentionally not on the curated barrel.

## Evaluation — TDD/Quality Discipline

- [ ] No reverse testing (no `toThrow('NotYetImplemented')`, no `not.toThrow()`).
- [ ] No mock theater (no `toHaveBeenCalled`/`mockResolvedValue` in behavioral suites).
- [ ] ≥30% property-based across new behavioral suites.
- [ ] Impl phases cite pseudocode line numbers; pseudocode-compliance gates ran
      (05a/09a/12a/14a/16a/18a).
- [ ] Mutation ≥80% on changed production files (Phase 23 evidence; independently re-confirmed 23a).
- [ ] Non-breaking proven by characterization + export diff (Phase 21/21a).
- [ ] No V2/New/parallel files; existing files UPDATED.

## Evaluation — #1595 Adequacy (the mission)

Answer explicitly with evidence:
- [ ] Can the CLI hand its existing fully-loaded `Config` to the agent? (REQ-INT-001)
- [ ] Can the CLI read/write the settings it needs through the agent, with identical normalization?
      (REQ-INT-003)
- [ ] Can a turn be driven through the public API with parity to today's `AgenticLoop` drive?
      (REQ-INT-002)
- [ ] Can the CLI reach provider/runtime/model identity + the client contract via public imports
      only? (REQ-004, REQ-005, REQ-INT-004)
- [ ] Is there a clear, documented import boundary so #1595 can delete its deep imports? (REQ-007,
      REQ-INT-004)

## Output

Write `project-plans/issue1594remediate/plan-evaluation.json`:

```json
{
  "compliant": true,
  "has_integration_plan": true,
  "builds_in_isolation": false,
  "gaps_closed": { "C1": true, "C2": true, "C3": true, "H1": true, "H2": true, "H3": true },
  "enables_1595": true,
  "reverse_testing_found": false,
  "mock_theater_found": false,
  "non_breaking": true,
  "mutation_ge_80": true,
  "property_ge_30": true,
  "violations": []
}
```

If `builds_in_isolation` is true OR any gap is unclosed OR `enables_1595` is false → **REJECT** and
list the responsible phase(s) to redo.

## Success Criteria

- Verdict rendered with evidence; all gaps closed; #1595 adequacy affirmed; no rejection triggers.

## Failure Recovery

- Reopen the specific phase(s) named in `violations`; do not mark the plan complete.

## Phase Completion Marker

Create: `project-plans/issue1594remediate/.completed/P24.md` (include the JSON + narrative verdict).

Contents (REQUIRED — per `dev-docs/PLAN-TEMPLATE.md` lines 199-211; the executor fills in
every field with REAL values, not placeholders):

```markdown
Phase: P24
Completed: YYYY-MM-DD HH:MM
Files Created: [list each new file with its line count]
Files Modified: [list each changed file with diff stats, e.g. +12/-3]
Tests Added: [count]
Verification: [paste the actual output of THIS phase's verification commands]
Semantic Assessment: [one-line holistic assessment of what was implemented and whether it satisfies the cited requirements]
```

