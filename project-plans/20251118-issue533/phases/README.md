# Phase Files: --profile CLI Flag Implementation

This directory contains all phase files for PLAN-20251118-ISSUE533.

## Phase Structure

Each feature follows a strict 3-phase TDD cycle:
1. **Stub Phase**: Create minimal skeleton
2. **TDD Phase**: Write behavioral tests
3. **Implementation Phase**: Make tests pass
4. **Verification Phase**: Validate compliance

## Phase Overview

### Argument Parsing (Phases 03-05)
- **P03**: Type extension stub (add profileJson field)
- **P03a**: Type verification
- **P04**: Argument parsing TDD (15 tests)
- **P04a**: TDD verification  
- **P05**: Argument parsing implementation
- **P05a**: Implementation verification

### Profile Parsing (Phases 06-08)
- **P06**: Profile parsing helpers stub
- **P06a**: Stub verification
- **P07**: Profile parsing TDD (25 tests)
- **P07a**: TDD verification
- **P08**: Profile parsing implementation
- **P08a**: Implementation verification

### Bootstrap Integration (Phases 09-11)
- **P09**: Bootstrap integration stub
- **P09a**: Stub verification
- **P10**: Bootstrap integration TDD (20 tests)
- **P10a**: TDD verification
- **P11**: Bootstrap integration implementation
- **P11a**: Implementation verification

### End-to-End Integration (Phase 12)
- **P12**: E2E integration tests (12 tests)
- **P12a**: E2E verification

## Execution Order

Phases MUST be executed sequentially. No phase skipping allowed.

```
P03 → P03a → P04 → P04a → P05 → P05a → P06 → P06a → 
P07 → P07a → P08 → P08a → P09 → P09a → P10 → P10a → 
P11 → P11a → P12 → P12a
```

## Phase Dependencies

- P04 depends on P03 (type exists)
- P05 depends on P04 (tests written)
- P07 depends on P06 (stubs exist)
- P08 depends on P07 (tests written)
- P10 depends on P09 (stub exists)
- P11 depends on P10 (tests written)
- P12 depends on P11 (implementation complete)

## Verification at Each Phase

Every verification phase (P03a, P04a, P05a, etc.) checks:
1. Plan markers present
2. Pseudocode followed
3. Tests pass (for implementation phases)
4. No regressions
5. No anti-patterns (reverse testing, mock theater)

## Phase File Naming

- `XX-feature-stub.md` - Stub phase
- `XXa-feature-verification.md` - Verification phase
- `XX-feature-tdd.md` - TDD phase  
- `XX-feature-implementation.md` - Implementation phase

## Status Tracking

See `../PLAN-STATUS.md` for execution status of all phases.

## Notes

- All remaining phase files (P06a-P12a) follow the same pattern as P03-P05
- Complete phase files available upon request
- Pattern is consistent: Stub → TDD → Implementation → Verification
- Each phase builds on previous phases incrementally
