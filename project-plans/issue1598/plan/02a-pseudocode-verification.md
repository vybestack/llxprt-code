# Phase 02a: Pseudocode Verification

## Phase ID

`PLAN-20260223-ISSUE1598.P02a`

## Prerequisites

- Required: Phase 02 completed
- Verification: `grep -r "@plan:PLAN-20260223-ISSUE1598.P02" project-plans/issue1598/analysis/pseudocode/`
- Expected files: All 4 pseudocode files in `analysis/pseudocode/`

## Purpose

Verify pseudocode completeness, correctness, and readiness for implementation.

## Verification Commands

### Automated Checks

```bash
# Check phase 02 markers in all files
grep -r "@plan:PLAN-20260223-ISSUE1598.P02" project-plans/issue1598/analysis/pseudocode/ | wc -l
# Expected: 4 occurrences

# Verify completion marker
cat project-plans/issue1598/.completed/P02.md
# Expected: Completion details

# Check line numbering in all files
for file in project-plans/issue1598/analysis/pseudocode/*.md; do
  echo "=== $file ==="
  grep -E "^[0-9]+\s+" "$file" | wc -l
done
# Expected: Each file has 40+ numbered lines
```

### Structural Verification Checklist

- [ ] Phase 02 completion marker exists
- [ ] All 4 files present and substantial
- [ ] Plan markers in all files
- [ ] Line numbers in all algorithms
- [ ] Requirements traceability tables present

### Semantic Verification Checklist

**Algorithm Correctness**:

1. **bucket-classification.md**:
   - [ ] Read entire algorithm (lines 1-51)
   - [ ] Verified early return on refresh success (line 36)
   - [ ] Verified token-store error handling (line 16-19)
   - [ ] Verified all 5 classification reasons can be produced
   - [ ] Verified no unreachable code

2. **failover-handler.md**:
   - [ ] Read entire algorithm (lines 1-172)
   - [ ] Verified Pass 1 integration with classification
   - [ ] Verified Pass 2 profile-order iteration (line 64)
   - [ ] Verified Pass 3 single-candidate selection (line 128-136)
   - [ ] Verified setSessionBucket error handling in all 3 passes
   - [ ] Verified state management (lastFailoverReasons, triedBucketsThisSession)

3. **error-reporting.md**:
   - [ ] Read class definition (lines 1-40)
   - [ ] Verified optional parameter (line 19)
   - [ ] Verified default empty record (line 33)
   - [ ] Read usage pseudocode (RetryOrchestrator)
   - [ ] Verified optional chaining (line 12 in usage)

4. **proactive-renewal.md**:
   - [ ] Read scheduleProactiveRenewal (lines 1-50)
   - [ ] Verified FIX on line 27 (remainingSec > 0 check)
   - [ ] Read handleProactiveRenewal (lines 51-91)
   - [ ] Verified failure counter logic (lines 76, 84)
   - [ ] Read reset() (lines 92-104)
   - [ ] Verified timer cancellation (lines 94-98)

5. **Requirements Coverage**:
   - [ ] Cross-referenced requirements.md
   - [ ] All REQ-1598-CL* mapped (9 requirements)
   - [ ] All REQ-1598-FL* mapped (18 requirements)
   - [ ] All REQ-1598-ER* mapped (4 requirements)
   - [ ] All REQ-1598-PR* mapped (6 requirements)
   - [ ] Total: 37+ requirements covered

6. **Implementation Readiness**:
   - [ ] No ambiguous steps ("decide later", "TBD")
   - [ ] All conditionals have clear predicates
   - [ ] All error paths defined
   - [ ] All state mutations explicit

## Success Criteria

- All structural checks pass
- All semantic checks pass
- All 37+ requirements mapped to pseudocode lines
- Pseudocode is implementation-ready
- No blocking ambiguities

## Blocking Issues Found

(List any issues that prevent proceeding to Phase 03)

- None / [describe issues]

## Failure Recovery

If verification fails:

1. Identify specific gaps or ambiguities in pseudocode
2. Return to Phase 02
3. Update pseudocode files to address gaps
4. Re-run Phase 02a verification

## Phase Completion Marker

Create: `project-plans/issue1598/.completed/P02a.md`

Contents:

```markdown
Phase: P02a
Completed: [timestamp]
Verification Status: PASS / FAIL
Structural Checks: PASS / FAIL
Semantic Checks: PASS / FAIL
Requirements Mapped: XX/37+
Blocking Issues: None / [list]
Ready for Phase 03: YES / NO
```
