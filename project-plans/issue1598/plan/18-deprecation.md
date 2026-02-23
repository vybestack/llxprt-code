# Phase 18: Deprecation

## Phase ID

`PLAN-20260223-ISSUE1598.P18`

## Prerequisites

- Phase 17a completed
- All implementation and integration complete

## Purpose

Handle any backward-compatible deprecation of old patterns. For this feature, there are no legacy behaviors to deprecate — all changes are additive (optional parameters, optional methods).

## Implementation Tasks

### Documentation Updates

- `project-plans/issue1598/README.md` (CREATE)
  - Summary of implementation
  - All phases completed
  - Requirements fulfilled
  - Known limitations
  - Usage examples
  - MUST include: `@plan:PLAN-20260223-ISSUE1598.P18`

### Verification

- Verify no breaking changes introduced
- Verify backward compatibility maintained
- Verify all optional parameters/methods work as expected

## Verification Commands

```bash
# Run full test suite
npm test
# Expected: All pass

# TypeScript compilation
npm run typecheck
# Expected: No errors

# Build project
npm run build
# Expected: Success

# Smoke test
node scripts/start.js --profile-load synthetic --keyfile ~/.llxprt/keys/.synthetic2_key "write me a haiku and nothing else"
# Expected: Success

# Check all phase markers present
for i in {01..18}; do
  grep -r "@plan:PLAN-20260223-ISSUE1598.P$i" packages/
done
# Expected: All phases have markers
```

### Structural Verification Checklist

- [ ] All 38 phases (01-18, a-variants) completed
- [ ] All .completed markers exist (P01 through P18a)
- [ ] All plan markers present in code
- [ ] All requirement markers present
- [ ] All pseudocode references present

### Semantic Verification Checklist

1. **All requirements implemented**:
   - [ ] REQ-1598-PR01-PR06: Proactive renewal (6 requirements)
   - [ ] REQ-1598-CL01-CL09: Classification (9 requirements)
   - [ ] REQ-1598-FL01-FL18: Failover logic (18 requirements)
   - [ ] REQ-1598-FR01-FR05: Foreground reauth (5 requirements)
   - [ ] REQ-1598-ER01-ER04: Error reporting (4 requirements)
   - [ ] REQ-1598-IC01-IC11: Interface changes (11 requirements)
   - [ ] REQ-1598-SM01-SM10: State management (10 requirements)
   - [ ] Total: 63 requirements

2. **Feature works end-to-end**:
   - [ ] Single-bucket profile: No failover attempted (existing behavior preserved)
   - [ ] Multi-bucket 429: Rotates to next bucket automatically
   - [ ] Expired tokens: Refresh attempted, reauth if needed
   - [ ] Missing tokens: Reauth attempted
   - [ ] Proactive renewal: Scheduled correctly, doesn't schedule for expired tokens
   - [ ] Error reporting: AllBucketsExhaustedError includes detailed reasons

3. **Backward compatibility verified**:
   - [ ] AllBucketsExhaustedError(3 params) still works
   - [ ] BucketFailoverHandler without getLastFailoverReasons() still works
   - [ ] Existing call sites compile without changes

4. **Documentation complete**:
   - [ ] README.md created with summary
   - [ ] Known limitations documented
   - [ ] Usage examples provided

## Success Criteria

- All 38 phases completed
- All 63 requirements implemented
- Full test suite passes (100+ tests)
- TypeScript compiles without errors
- Project builds successfully
- Smoke test passes
- Documentation complete
- No breaking changes

## Failure Recovery

If any verification fails:

1. Identify failing requirement or phase
2. Return to that phase
3. Fix issue
4. Re-run verification
5. Do NOT mark as complete until all checks pass

## Phase Completion Marker

Create: `project-plans/issue1598/.completed/P18.md`

```markdown
Phase: P18
Completed: [timestamp]
All Phases: 38/38 complete
All Requirements: 63/63 implemented
Test Suite: PASS (XXX tests)
TypeScript: OK
Build: OK
Smoke Test: OK
Documentation: Complete
Breaking Changes: None
Backward Compatible: YES
```

## Final Completion Marker

Create: `project-plans/issue1598/.completed/FINAL.md`

```markdown
# PLAN-20260223-ISSUE1598 COMPLETE

Completion Date: [timestamp]
Total Phases: 38
Total Requirements: 63
Total Tests: XXX+

## Implementation Summary

- Bucket classification: COMPLETE (Pass 1)
- Candidate search: COMPLETE (Pass 2)
- Foreground reauth: COMPLETE (Pass 3)
- Error reporting: COMPLETE
- Proactive renewal: COMPLETE (BUG FIXED)
- RetryOrchestrator integration: COMPLETE

## Verification Status

- Unit tests: PASS (classification, error reporting, proactive renewal)
- Integration tests: PASS (end-to-end failover scenarios)
- TypeScript compilation: PASS
- Project build: PASS
- Smoke test: PASS

## Known Limitations

1. No abort support for foreground reauth (5-minute timeout enforced by RetryOrchestrator)
2. Token-store read errors classified as no-token (pragmatic recovery)
3. setSessionBucket failures logged but do not abort failover

## Migration Notes

No migration required — all changes are backward compatible:
- Optional parameters default to empty values
- Optional methods can be omitted
- Existing call sites continue to work
```
