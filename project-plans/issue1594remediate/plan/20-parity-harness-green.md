<!-- @plan:PLAN-20260621-COREAPIREMED.P20 @requirement:REQ-INT-001,REQ-INT-002,REQ-INT-003,REQ-INT-004 -->
# Phase 20: Make Parity Harness Green End-to-End (Close Adequacy Gaps)

## Phase ID

`PLAN-20260621-COREAPIREMED.P20`

## LLxprt Code Subagent: typescriptexpert

## Prerequisites

- Required: Phase 19a completed (PASS) — the parity adequacy gate CANNOT be bypassed: P20 depends on
  the P19 VERIFIER (P19a), not the bare P19 worker (CRIT-1/CRIT-3).
- Verification: `test -f project-plans/issue1594remediate/.completed/P19a.md`
- CONSUMES the machine-readable P19 hand-off (CRIT-3):
  `test -f project-plans/issue1594remediate/.completed/P19-parity-status.txt` (the recorded
  `harness_result: pass|fail` + named gaps) AND
  `test -f project-plans/issue1594remediate/.completed/P19-frozen-hashes.txt` (the frozen content-hash
  snapshot). Both MUST exist or P20 cannot proceed.
- Pseudocode: `analysis/pseudocode/cli-integration-adapter.md` (lines 40–84)

## Purpose

Make EVERY P19 parity/integration scenario GREEN by closing any remaining adequacy gaps in the
public surface — WITHOUT weakening any P19 test and WITHOUT touching CLI production source (that is
#1595). Most behavior already lands in P09 (fromConfig), P12 (settings), P14 (seqmodel), P16
(contract), P18 (runtime seam); this phase resolves the residual integration wiring the harness
reveals (e.g. ensuring `agent.stream()` over an adopted Config yields a projection equivalent to the
reference `AgenticLoop` drive).

This phase is gated on, and driven by, the P19 hand-off (CRIT-3). It MUST: (a) require P19a (the
adequacy gate cannot be skipped); (b) read `P19-parity-status.txt` and `P19-frozen-hashes.txt`;
(c) NOT weaken any frozen P19 test (re-verified by the content-hash guard already present below);
(d) close ONLY production-surface gaps. If `harness_result: pass`, P20 is a NO-OP VERIFICATION
(confirm frozen hashes + a clean re-run, change nothing). If `harness_result: fail`, P20 closes the
EXACT named gaps listed in the status file by editing production code only. P20's scope is unchanged:
it never edits tests/helpers/fixtures and never touches CLI source.

## Requirements Implemented (Expanded)

### REQ-INT-001 / REQ-INT-002 / REQ-INT-003 / REQ-INT-004

All four from Phase 19 — adopt, turn-drive parity, settings normalization parity, no-deep-import
boundary — must hold against the real CLI-style Config + FakeProvider fixture. See Phase 19
GIVEN/WHEN/THEN.

## Implementation Tasks

### Files to Modify (only as the harness requires)

- `packages/agents/src/api/agentImpl.ts` / `createAgent.ts` / `fromConfig.ts` — only the minimal
  wiring needed so `agent.stream()` over an adopted Config projects equivalently to the reference
  drive (e.g. ensure the post-auth client + AgenticLoop are bound for the adopted-Config path the
  same way createAgent binds them). Follow the seam pseudocode; cite lines.
- If the parity diff reveals a projection gap (an event the reference emits but the public stream
  drops, or vice versa), fix it in the public event projection ONLY if it is a genuine adequacy
  defect — otherwise refine `projectToComparable` in the harness is NOT allowed here (tests are
  frozen). Escalate via Failure Recovery if a frozen test is wrong.

### Constraints

- Do NOT modify any P19 test, helper, or fixture.
- Do NOT modify CLI production source.
- Additive/seam wiring only; no new ProviderManager; adopt-only on fromConfig.
- Cite pseudocode lines for any seam change. Strict TS; no placeholders.

## Verification Commands

```bash
set -e
# Frozen tests must not be WEAKENED — verify by CONTENT HASH, not `git diff HEAD`. P19 recorded the
# sha256 of every parity test file + helper + fixture into .completed/P19-frozen-hashes.txt at the end
# of the RED phase. Because the plan does NOT require a commit after each phase, the test files remain
# in the working-tree git diff regardless of edits, so a `git diff HEAD` guard would mis-fire. We
# therefore re-verify the recorded hashes instead.
SNAP=project-plans/issue1594remediate/.completed/P19-frozen-hashes.txt
test -f "$SNAP" || { echo "FAIL: missing P19 frozen-hash snapshot ($SNAP) — P19 must have recorded it"; exit 1; }
# Recompute current hashes for exactly the files captured in the snapshot and compare to the snapshot.
grep -E "  packages/agents/src/api/__tests__/" "$SNAP" | while read -r EXPECTED FILE; do
  test -f "$FILE" || { echo "FAIL: frozen test file removed: $FILE"; exit 1; }
  ACTUAL=$(shasum -a 256 "$FILE" | awk '{print $1}')
  if [ "$ACTUAL" != "$EXPECTED" ]; then echo "FAIL: frozen test CONTENT changed since P19: $FILE"; exit 1; fi
done
echo "Frozen parity tests verified unchanged (content-hash match against P19 snapshot)."

# CONSUME the machine-readable P19 hand-off (CRIT-3): determine whether P20 is a no-op verification
# (harness already GREEN at P19) or must close named production-surface adequacy gaps.
PSTATUS=project-plans/issue1594remediate/.completed/P19-parity-status.txt
test -f "$PSTATUS" || { echo "FAIL: missing P19 parity-status hand-off ($PSTATUS) — P19 must have recorded it"; exit 1; }
HARNESS_RESULT=$(grep -E "^harness_result:" "$PSTATUS" | awk '{print $2}')
echo "P19 hand-off harness_result=${HARNESS_RESULT}"
if [ "$HARNESS_RESULT" = "pass" ]; then
  echo "P19 reported the parity harness already GREEN — P20 is a NO-OP VERIFICATION (close no gaps, weaken no test)."
elif [ "$HARNESS_RESULT" = "fail" ]; then
  echo "P19 reported adequacy gaps — P20 MUST close ONLY these named production-surface gaps (never by weakening tests):"
  grep -E "^gap:" "$PSTATUS" || echo "gap: (none enumerated — re-run harness below to surface failing assertions)"
else
  echo "FAIL: P19 parity-status hand-off has no recognizable harness_result (pass|fail)"; exit 1
fi

npx vitest run packages/agents/src/api/__tests__/cli-turn-parity.spec.ts
npx vitest run packages/agents/src/api/__tests__/config-injection.spec.ts
npx vitest run packages/agents/src/api/__tests__/settings-surface.spec.ts
npx vitest run packages/agents/src/api/__tests__/
npm run typecheck
```

### Deferred Implementation Detection (MANDATORY)

```bash
grep -rnE "(TODO|FIXME|HACK|STUB|placeholder|for now|in a real|in production|ideally)" packages/agents/src/api/agentImpl.ts packages/agents/src/api/createAgent.ts packages/agents/src/api/fromConfig.ts | grep -v ".test.ts" && { echo FAIL; exit 1; } || true
```

### Semantic Verification Checklist

- [ ] Path A (agent.stream over adopted Config) ≡ Path B (reference AgenticLoop drive) on the public
      projection; both end with exactly one terminal done.
- [ ] Settings parity (normalization + invalid-throw) holds against the real Config.
- [ ] Boundary scan green (no deep imports).
- [ ] No harness test/helper/fixture modified; no CLI source touched.
- [ ] All __tests__ green; typecheck clean.

## Success Criteria

- Entire parity harness GREEN; public surface proven adequate for #1595; no test weakened.

## Failure Recovery

- If a frozen P19 test is genuinely wrong, STOP and escalate (do not silently edit it); otherwise
  `git checkout -- packages/agents/src/api/agentImpl.ts packages/agents/src/api/createAgent.ts packages/agents/src/api/fromConfig.ts` and retry the wiring.

## Phase Completion Marker

Create: `project-plans/issue1594remediate/.completed/P20.md`

Contents (REQUIRED — per `dev-docs/PLAN-TEMPLATE.md` lines 199-211; the executor fills in
every field with REAL values, not placeholders):

```markdown
Phase: P20
Completed: YYYY-MM-DD HH:MM
Files Created: [list each new file with its line count]
Files Modified: [list each changed file with diff stats, e.g. +12/-3]
Tests Added: [count]
Verification: [paste the actual output of THIS phase's verification commands]
Semantic Assessment: [one-line holistic assessment of what was implemented and whether it satisfies the cited requirements]
```

