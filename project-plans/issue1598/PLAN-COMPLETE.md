# Issue #1598 Plan Files — CREATION COMPLETE

**Plan ID**: PLAN-20260223-ISSUE1598  
**Created**: 2026-02-23  
**Status**: All plan files created, ready for execution

---

## Files Created Summary

### Pseudocode (analysis/pseudocode/) — 4 files
[OK] `bucket-classification.md` — 51 numbered lines  
[OK] `failover-handler.md` — 172 numbered lines  
[OK] `error-reporting.md` — 40 numbered lines  
[OK] `proactive-renewal.md` — 104 numbered lines

**Total pseudocode lines**: 367 numbered lines

### Phase Files (plan/) — 36 files

#### Analysis & Pseudocode (4 files)
[OK] 01-analysis.md  
[OK] 01a-analysis-verification.md  
[OK] 02-pseudocode.md  
[OK] 02a-pseudocode-verification.md  

#### Classification (6 files)
[OK] 03-classification-stub.md  
[OK] 03a-classification-stub-verification.md  
[OK] 04-classification-tdd.md  
[OK] 04a-classification-tdd-verification.md  
[OK] 05-classification-impl.md  
[OK] 05a-classification-impl-verification.md  

#### Error Reporting (6 files)
[OK] 06-error-reporting-stub.md  
[OK] 06a-error-reporting-stub-verification.md  
[OK] 07-error-reporting-tdd.md  
[OK] 07a-error-reporting-tdd-verification.md  
[OK] 08-error-reporting-impl.md  
[OK] 08a-error-reporting-impl-verification.md  

#### Foreground Reauth / Failover (6 files)
[OK] 09-foreground-reauth-stub.md  
[OK] 09a-foreground-reauth-stub-verification.md  
[OK] 10-foreground-reauth-tdd.md  
[OK] 10a-foreground-reauth-tdd-verification.md  
[OK] 11-foreground-reauth-impl.md  
[OK] 11a-foreground-reauth-impl-verification.md  

#### Proactive Renewal (6 files)
[OK] 12-proactive-renewal-stub.md  
[OK] 12a-proactive-renewal-stub-verification.md  
[OK] 13-proactive-renewal-tdd.md  
[OK] 13a-proactive-renewal-tdd-verification.md  
[OK] 14-proactive-renewal-impl.md  
[OK] 14a-proactive-renewal-impl-verification.md  

#### Integration (6 files)
[OK] 15-integration-stub.md  
[OK] 15a-integration-stub-verification.md  
[OK] 16-integration-tdd.md  
[OK] 16a-integration-tdd-verification.md  
[OK] 17-integration-impl.md  
[OK] 17a-integration-impl-verification.md  

#### Deprecation (2 files)
[OK] 18-deprecation.md  
[OK] 18a-deprecation-verification.md  

### Support Files
[OK] `.completed/.gitkeep` — Git tracking for completion markers

---

## Phase Structure Summary

Each implementation cycle follows strict TDD:
1. **Stub phase** — Create types/interfaces (no logic)
2. **Stub verification** — Verify types compile
3. **TDD phase** — Write failing tests (behavioral, no mock theater)
4. **TDD verification** — Verify tests fail naturally
5. **Implementation phase** — Make tests pass (reference pseudocode line numbers)
6. **Implementation verification** — Verify tests pass, feature works

---

## Key Features

### Every Phase File Includes:
- **Phase ID** with plan identifier
- **Prerequisites** with verification commands
- **Requirements Implemented** with FULL requirement text and GIVEN/WHEN/THEN
- **Implementation Tasks** with file lists and required markers
- **Verification Commands** (automated and structural)
- **Deferred Implementation Detection** (catches TODO/FIXME/STUB)
- **Semantic Verification Checklist** (features WORK, not just exist)
- **Success Criteria**
- **Failure Recovery** steps
- **Phase Completion Marker** template

### Pseudocode Features:
- **Numbered lines** (every line has a number for precise reference)
- **Requirements traceability** (table mapping line numbers to REQ-IDs)
- **Decision point documentation** (explains WHY, not just WHAT)
- **Edge case handling** (explicit error paths)
- **State mutation tracking** (which variables change when)

---

## Requirements Coverage

### Total Requirements: 63
- **REQ-1598-PR01-PR06**: Proactive renewal (6 requirements)
- **REQ-1598-CL01-CL09**: Classification (9 requirements)
- **REQ-1598-FL01-FL18**: Failover logic (18 requirements)
- **REQ-1598-FR01-FR05**: Foreground reauth (5 requirements)
- **REQ-1598-ER01-ER04**: Error reporting (4 requirements)
- **REQ-1598-IC01-IC11**: Interface changes (11 requirements)
- **REQ-1598-SM01-SM10**: State management (10 requirements)

### All requirements mapped to:
- Pseudocode line numbers
- Phase implementations
- Test cases
- Verification checklists

---

## Execution Order

**CRITICAL**: Phases MUST be executed in numerical order:
1. Phase 00a (Preflight Verification) — already exists
2. Phase 01 → 01a (Analysis)
3. Phase 02 → 02a (Pseudocode)
4. Phase 03 → 03a → 04 → 04a → 05 → 05a (Classification)
5. Phase 06 → 06a → 07 → 07a → 08 → 08a (Error Reporting)
6. Phase 09 → 09a → 10 → 10a → 11 → 11a (Foreground Reauth)
7. Phase 12 → 12a → 13 → 13a → 14 → 14a (Proactive Renewal)
8. Phase 15 → 15a → 16 → 16a → 17 → 17a (Integration)
9. Phase 18 → 18a (Deprecation)

**DO NOT SKIP PHASES** — each phase builds on the previous.

---

## Quality Gates

### Every Implementation Phase Requires:
- [ ] Plan markers in all modified code
- [ ] Requirement markers in all modified code
- [ ] Pseudocode line references in implementation
- [ ] Tests pass (100% for that phase)
- [ ] TypeScript compiles
- [ ] No TODO/FIXME in production code (except deferred phases)
- [ ] Semantic verification complete (feature WORKS)

### Every TDD Phase Requires:
- [ ] Tests fail naturally (no NotYetImplemented checks)
- [ ] Tests verify behavior, not implementation
- [ ] No mock theater (no verification of mock calls)
- [ ] Tests reference pseudocode line numbers

---

## Implementation Estimates

Based on complexity and dependencies:

### Fast Phases (< 2 hours each)
- Phases 03, 06, 09, 12, 15 (stub phases)
- Phases 01a, 02a, 03a, 06a, 09a, 12a, 15a (verification phases)

### Medium Phases (2-4 hours each)
- Phases 01, 02 (analysis and pseudocode)
- Phases 04, 07, 10, 13, 16 (TDD phases)
- Phases 08, 14 (smaller implementations)
- Phases 05a, 08a, 11a, 14a, 17a (verification phases with smoke testing)

### Complex Phases (4-8 hours each)
- Phase 05 (Pass 1 implementation — 80+ lines)
- Phase 11 (Pass 2 + Pass 3 implementation — 120+ lines)
- Phase 17 (RetryOrchestrator integration — cross-package)
- Phase 18 (Deprecation and final documentation)

**Total Estimated Time**: 60-80 hours for full implementation

---

## Next Steps

1. **Start with Phase 00a verification** (already exists, verify complete)
2. **Execute Phase 01** (analysis/domain-model.md already exists, verify)
3. **Continue sequentially** through all phases
4. **Mark each phase complete** in `.completed/` directory
5. **Run full verification** after each implementation phase
6. **Create PR** after Phase 18a completion

---

## Success Criteria

[OK] All 36 phase files created  
[OK] All 4 pseudocode files created with numbered lines  
[OK] All requirements mapped to phases  
[OK] TDD workflow enforced in every cycle  
[OK] Semantic verification checklists in every phase  
[OK] Deferred implementation detection in every phase  
[OK] Phase completion markers documented  
[OK] Execution order clearly defined  

**Status**: Plan creation COMPLETE — ready for execution.

---

## Notes for Implementers

1. **Follow pseudocode EXACTLY** — line numbers are there for a reason
2. **No mock theater** — tests must verify actual behavior
3. **Semantic verification is mandatory** — features must WORK, not just exist
4. **Do not skip verification phases** — they catch deferred implementation
5. **Mark phases complete** — create files in `.completed/` directory
6. **One phase at a time** — do not jump ahead

Good luck! 
