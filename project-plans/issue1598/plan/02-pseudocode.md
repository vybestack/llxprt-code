# Phase 02: Pseudocode Development

## Phase ID

`PLAN-20260223-ISSUE1598.P02`

## Prerequisites

- Required: Phase 01a completed
- Verification: `grep -r "@plan:PLAN-20260223-ISSUE1598.P01a" project-plans/issue1598/.completed/`
- Expected files: `analysis/domain-model.md` complete and verified

## Requirements Implemented (Expanded)

This phase creates detailed pseudocode for all algorithms. No code requirements are implemented — this is algorithm design.

### Pseudocode Scope

**What This Phase Delivers**:
- `analysis/pseudocode/bucket-classification.md` — Pass 1 classification algorithm (NUMBERED LINES)
- `analysis/pseudocode/failover-handler.md` — Full three-pass tryFailover() (NUMBERED LINES)
- `analysis/pseudocode/error-reporting.md` — AllBucketsExhaustedError enhancement (NUMBERED LINES)
- `analysis/pseudocode/proactive-renewal.md` — scheduleProactiveRenewal fix (NUMBERED LINES)

**Why This Matters**: Pseudocode serves as executable specification. Every implementation phase MUST reference pseudocode line numbers to ensure algorithm correctness.

## Implementation Tasks

### Files to Create

- `project-plans/issue1598/analysis/pseudocode/bucket-classification.md`
  - MUST include: `@plan:PLAN-20260223-ISSUE1598.P02`
  - MUST have: Numbered lines (1-50+)
  - Algorithm: classifyTriggeringBucket()
  - Requirements: REQ-1598-CL01 through CL09

- `project-plans/issue1598/analysis/pseudocode/failover-handler.md`
  - MUST include: `@plan:PLAN-20260223-ISSUE1598.P02`
  - MUST have: Numbered lines (1-172+)
  - Algorithm: tryFailover() with Pass 1, Pass 2, Pass 3
  - Requirements: REQ-1598-FL01 through FL18

- `project-plans/issue1598/analysis/pseudocode/error-reporting.md`
  - MUST include: `@plan:PLAN-20260223-ISSUE1598.P02`
  - MUST have: Numbered lines (1-40+)
  - Modified class: AllBucketsExhaustedError
  - Usage: RetryOrchestrator integration
  - Requirements: REQ-1598-ER01 through ER04, IC05

- `project-plans/issue1598/analysis/pseudocode/proactive-renewal.md`
  - MUST include: `@plan:PLAN-20260223-ISSUE1598.P02`
  - MUST have: Numbered lines (1-104+)
  - Algorithm: scheduleProactiveRenewal() fix
  - Algorithm: handleProactiveRenewal() callback
  - Algorithm: reset() timer cancellation
  - Requirements: REQ-1598-PR01 through PR06

### Required Documentation Markers

Every pseudocode file MUST include:

```markdown
<!-- @plan PLAN-20260223-ISSUE1598.P02 -->
```

## Verification Commands

### Automated Checks (Structural)

```bash
# Check plan marker exists in all 4 files
grep -r "@plan:PLAN-20260223-ISSUE1598.P02" project-plans/issue1598/analysis/pseudocode/ | wc -l
# Expected: 4 occurrences

# Check all files exist
ls -la project-plans/issue1598/analysis/pseudocode/
# Expected: 4 .md files

# Check line numbering present
grep -E "^[0-9]+\s+" project-plans/issue1598/analysis/pseudocode/bucket-classification.md | wc -l
# Expected: 50+ numbered lines
```

### Structural Verification Checklist

- [ ] Phase 01a completion marker exists
- [ ] All 4 pseudocode files created:
  - [ ] bucket-classification.md
  - [ ] failover-handler.md
  - [ ] error-reporting.md
  - [ ] proactive-renewal.md
- [ ] Plan marker in all files
- [ ] Line numbers present in all algorithms
- [ ] Requirements traceability tables in each file

### Deferred Implementation Detection

Not applicable — this is pseudocode, not implementation.

### Semantic Verification Checklist

**Pseudocode Quality Questions**:

1. **Is bucket-classification.md complete?**
   - [ ] Line 8-10: 429 detection logic
   - [ ] Line 16-19: Token-store error handling
   - [ ] Line 22-24: Null token handling
   - [ ] Line 30-42: Expired token refresh attempt
   - [ ] Line 36: Immediate success signal (null return)
   - [ ] Line 44-49: Fallback classification

2. **Is failover-handler.md complete?**
   - [ ] Line 4: lastFailoverReasons cleared
   - [ ] Lines 10-58: Pass 1 complete
   - [ ] Lines 60-121: Pass 2 complete with profile-order iteration
   - [ ] Lines 123-166: Pass 3 complete with single reauth candidate
   - [ ] Lines 95-100, 113-118, 152-157: setSessionBucket error handling
   - [ ] Line 169-170: Return false at end

3. **Is error-reporting.md complete?**
   - [ ] Lines 3-8: BucketFailureReason type definition
   - [ ] Line 19: Optional bucketFailureReasons parameter
   - [ ] Line 33: Default empty record
   - [ ] Lines 22-26: Message construction
   - [ ] Usage pseudocode shows RetryOrchestrator integration

4. **Is proactive-renewal.md complete?**
   - [ ] Line 27: Double-check for positive lifetime (THE FIX)
   - [ ] Lines 29-30: Renewal delay calculation
   - [ ] Lines 34-38: Clear existing timer
   - [ ] Lines 41-45: Set new timer
   - [ ] Lines 51-90: handleProactiveRenewal() callback
   - [ ] Lines 62-70: Success path with reschedule
   - [ ] Lines 75-79: Failure path with counter increment
   - [ ] Lines 92-104: reset() timer cancellation

5. **Are algorithms traceable to requirements?**
   - [ ] Each file has Requirements Traceability table
   - [ ] All REQ-1598-* IDs mapped to line numbers
   - [ ] No requirements orphaned (unmapped)

6. **What's MISSING?**
   - [ ] (list any gaps discovered)

## Success Criteria

- All 4 pseudocode files exist
- All algorithms have numbered lines
- All requirements mapped to line numbers
- Algorithms are implementation-ready
- No ambiguities or "TBD" markers

## Failure Recovery

If this phase fails:

1. Review domain-model.md for algorithm details
2. Review requirements.md for behavioral specifications
3. Review technical.md for implementation notes
4. Update pseudocode files to address gaps
5. Re-run verification checklist

## Phase Completion Marker

Create: `project-plans/issue1598/.completed/P02.md`

Contents:

```markdown
Phase: P02
Completed: [timestamp]
Files Created:
  - analysis/pseudocode/bucket-classification.md (XXX lines)
  - analysis/pseudocode/failover-handler.md (XXX lines)
  - analysis/pseudocode/error-reporting.md (XXX lines)
  - analysis/pseudocode/proactive-renewal.md (XXX lines)
Verification:
  - Plan markers: 4/4 present
  - Line numbering: YES
  - Requirements mapped: XX/XX
  - Algorithms complete: YES
```
