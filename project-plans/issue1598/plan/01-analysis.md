# Phase 01: Domain Analysis

## Phase ID

`PLAN-20260223-ISSUE1598.P01`

## Prerequisites

- Required: Phase 00a (Preflight Verification) completed
- Verification: `grep -r "@plan:PLAN-20260223-ISSUE1598.P00a" .`
- Expected files: `project-plans/issue1598/plan/00a-preflight-verification.md` completed

## Requirements Implemented (Expanded)

This phase creates the domain model document that serves as foundation for all subsequent phases. No code requirements are implemented — this is pure analysis.

### Analysis Scope

**What This Phase Delivers**:
- Complete domain model in `analysis/domain-model.md`
- Entity definitions with properties and states
- State transition diagrams
- Error scenario catalog
- Business rules documentation

**Why This Matters**: Without a clear domain model, implementation phases will lack shared understanding of entities, states, and transitions, leading to inconsistent behavior and missed edge cases.

## Implementation Tasks

### Files to Create

- `project-plans/issue1598/analysis/domain-model.md`
  - MUST include: `@plan:PLAN-20260223-ISSUE1598.P01`
  - Content sections:
    - Core Entities (Bucket, BucketFailureReason, FailoverContext, BucketFailoverHandler, OAuthToken)
    - State Transitions (Bucket Lifecycle, Failover State Machine)
    - Error Scenarios (8+ scenarios with Given/When/Then)
    - Business Rules (BR-1 through BR-8 minimum)
    - Data Flow Diagrams
    - Edge Cases
    - Invariants

### Required Documentation Markers

Every major section MUST include:

```markdown
<!-- @plan PLAN-20260223-ISSUE1598.P01 -->
```

## Verification Commands

### Automated Checks (Structural)

```bash
# Check plan marker exists
grep -r "@plan:PLAN-20260223-ISSUE1598.P01" project-plans/issue1598/analysis/ | wc -l
# Expected: 1+ occurrences

# Check file exists
ls -la project-plans/issue1598/analysis/domain-model.md
# Expected: File exists

# Check file size (should be substantial)
wc -l project-plans/issue1598/analysis/domain-model.md
# Expected: 500+ lines
```

### Structural Verification Checklist

- [ ] Phase 00a markers present in 00a-preflight-verification.md
- [ ] domain-model.md file created
- [ ] Plan marker added to domain-model.md
- [ ] All required sections present:
  - [ ] Core Entities (5+ entities defined)
  - [ ] State Transitions (2+ diagrams)
  - [ ] Error Scenarios (8+ scenarios)
  - [ ] Business Rules (8+ rules)
  - [ ] Data Flow Diagrams
  - [ ] Edge Cases (6+ cases)
  - [ ] Invariants (5+ invariants)

### Deferred Implementation Detection

Not applicable — this is a documentation phase with no code.

### Semantic Verification Checklist

**Domain Model Quality Questions**:

1. **Are all entities from requirements.md represented?**
   - [ ] Bucket entity defined with all states
   - [ ] BucketFailureReason type documented
   - [ ] FailoverContext interface specified
   - [ ] BucketFailoverHandler interface complete
   - [ ] OAuthToken structure defined

2. **Do state transitions cover all scenarios?**
   - [ ] Normal flow: AVAILABLE → EXPIRED_REFRESHABLE → AVAILABLE
   - [ ] Failure flow: EXPIRED_REFRESHABLE → EXPIRED_UNREFFRESHABLE → REAUTH_FAILED
   - [ ] Quota exhaustion flow: AVAILABLE → QUOTA_EXHAUSTED
   - [ ] Missing token flow: (no token) → MISSING_TOKEN → (reauth) → AVAILABLE

3. **Are business rules testable?**
   - [ ] BR-1: Profile order can be verified by checking array iteration
   - [ ] BR-2: Session isolation can be verified by checking reset timing
   - [ ] BR-3: Single reauth can be verified by counting authenticate() calls
   - [ ] BR-4: Classification finality can be verified by checking lastFailoverReasons immutability
   - [ ] BR-5: Immediate success can be verified by checking early return
   - [ ] BR-6: Near-expiry acceptance can be verified with 29-second token
   - [ ] BR-7: Proactive renewal can be verified with fake timers
   - [ ] BR-8: Failure threshold can be verified with 3 consecutive failures

4. **Do error scenarios match requirements.md?**
   - [ ] Cross-referenced all REQ-1598-* requirements
   - [ ] Every scenario has Given/When/Then
   - [ ] Every scenario traceable to at least one requirement

5. **What's MISSING?**
   - [ ] (list any gaps discovered during analysis)

## Success Criteria

- Domain model document exists with 500+ lines
- All entities, states, and transitions documented
- 8+ error scenarios cataloged
- 8+ business rules defined
- 6+ edge cases identified
- 5+ invariants specified
- Document passes structural verification

## Failure Recovery

If this phase fails:

1. Review requirements.md and technical.md for missing concepts
2. Review overview.md for additional context
3. Update domain-model.md with missing elements
4. Re-run verification checklist

## Phase Completion Marker

Create: `project-plans/issue1598/.completed/P01.md`

Contents:

```markdown
Phase: P01
Completed: [timestamp]
Files Created: 
  - project-plans/issue1598/analysis/domain-model.md (XXX lines)
Verification: 
  - Plan marker present: YES
  - All sections complete: YES
  - Entities documented: 5
  - State transitions: 2
  - Error scenarios: 8+
  - Business rules: 8+
  - Edge cases: 6+
  - Invariants: 5+
```
