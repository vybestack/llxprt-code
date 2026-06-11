# Phase 01a: Contracts + Inversion Verification

## Phase ID

`PLAN-20260610-ISSUE1592.P01A`

## Checks

1. Run the full verification battery (00-overview) and paste outputs.
2. Read the diff (`git diff main --stat` + targeted file reads). Confirm:
   - No logic changes beyond the specified seams (factories, contract types, type-import swaps).
   - Contract member lists match actual call-site usage (spot-check 5 call sites each for client and scheduler).
   - `AgentClient implements AgentClientContract` and `CoreToolScheduler implements ToolSchedulerContract` (or structural assignment tests exist).
   - History handoff flow in `initializeContentGeneratorConfig` byte-for-byte equivalent except construction line.
   - Scheduler singleton invariant test exercises REAL factory path (not mock theater).
   - TaskTool gating preserved: compare old/new `getTaskToolMissingReason` semantics.
3. Fraud scans:
   ```bash
   grep -rn -E "(TODO|FIXME|HACK|STUB)" packages/core/src packages/cli/src --include="*.ts" | grep -v test | grep "1592"
   grep -rn "toHaveBeenCalled" <new test files>   # flag mock-theater-only tests
   ```
4. Behavioral questions (answer in writing): Would the new tests fail if factory wiring was dropped? Is every Config construction site updated? Can the CLI still run without agents-specific wiring changes (it must at this phase)?

## Holistic Functionality Assessment

Required: written assessment per PLAN.md §7 (what was implemented, does it satisfy REQ-INV-001..003, data flow trace of one chat turn from CLI through factory-created client, what could go wrong, verdict).

## Verdict

PASS/FAIL in `.completed/P01A.md`. FAIL blocks P02.
