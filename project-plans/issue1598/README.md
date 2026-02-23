# Issue #1598: Bucket Failover Recovery - Implementation Plan

**Plan ID**: `PLAN-20260223-ISSUE1598`  
**Created**: 2026-02-23  
**Status**: Ready for Execution  
**Total Phases**: 38 (19 implementation + 19 verification)

---

## Quick Start

1. **Read First**:
   - `specification.md` — Functional requirements
   - `technical.md` — Technical design
   - `requirements.md` — EARS-format requirements
   - `plan/00-overview.md` — Plan structure and integration analysis

2. **Execute Preflight**:
   - `plan/00a-preflight-verification.md` — Verify all assumptions

3. **Review Analysis**:
   - `analysis/domain-model.md` — Entities, state transitions, error scenarios
   - `analysis/pseudocode/*.md` — Numbered pseudocode for each component

4. **Execute Phases Sequentially**:
   - Follow `execution-tracker.md` for progress tracking
   - Execute phases in EXACT numerical order (no skipping)
   - Complete verification phase before proceeding to next implementation phase

5. **Track Progress**:
   - Update `execution-tracker.md` after each phase
   - Create completion markers in `.completed/P##.md`

---

## Directory Structure

```
project-plans/issue1598/
├── README.md                    ← You are here
├── specification.md             ← Functional spec (copied from overview.md)
├── technical.md                 ← Technical spec
├── requirements.md              ← EARS requirements
├── analysis/
│   ├── domain-model.md          ← Entities, state machines, error scenarios
│   └── pseudocode/
│       ├── proactive-renewal.md       ← Numbered pseudocode for proactive renewal fix
│       ├── bucket-classification.md   ← Numbered pseudocode for classification logic
│       ├── failover-handler.md        ← Numbered pseudocode for tryFailover multi-pass
│       └── error-reporting.md         ← Numbered pseudocode for enriched errors
├── plan/
│   ├── 00-overview.md           ← Plan overview, phase list, integration analysis
│   ├── 00a-preflight-verification.md ← Dependency/type/call-path verification
│   ├── 01-analysis.md           ← Domain analysis phase
│   ├── 01a-analysis-verification.md
│   ├── 02-pseudocode.md         ← Pseudocode development phase
│   ├── 02a-pseudocode-verification.md
│   ├── 03-classification-stub.md
│   ├── 03a-classification-stub-verification.md
│   ├── 04-classification-tdd.md
│   ├── 04a-classification-tdd-verification.md
│   ├── 05-classification-impl.md
│   ├── 05a-classification-impl-verification.md
│   ├── ... (continues through phase 18a)
│   └── [See execution-tracker.md for complete phase list]
└── execution-tracker.md         ← Phase tracking, completion checklist

(Additional files created during execution)
.completed/                      ← Phase completion markers
  P03.md                         ← Details of Phase 03 completion
  P04.md                         ← Details of Phase 04 completion
  ...
```

---

## Phase Overview

### Stage 1: Analysis & Pseudocode (Phases 00-02a)
Understand the problem, define domain model, write numbered pseudocode for each component.

### Stage 2: Bucket Classification (Phases 03-05a)
Implement classification logic for the five failure reasons: `quota-exhausted`, `expired-refresh-failed`, `no-token`, `reauth-failed`, `skipped`.

### Stage 3: Error Reporting (Phases 06-08a)
Update `AllBucketsExhaustedError` to include `bucketFailureReasons` field, add `BucketFailureReason` type export.

### Stage 4: Foreground Reauth (Phases 09-11a)
Implement Pass 3 of failover algorithm: foreground reauth for `expired-refresh-failed` and `no-token` buckets.

### Stage 5: Proactive Renewal (Phases 12-14a)
Fix `scheduleProactiveRenewal()` bug, implement 80% lifetime scheduling with failure tracking.

### Stage 6: Integration (Phases 15-17a)
Wire RetryOrchestrator to pass `FailoverContext`, retrieve and report failure reasons, verify end-to-end scenarios.

### Stage 7: Cleanup (Phases 18-18a)
Remove legacy code, update documentation, final verification.

---

## Key Files to Modify

### Production Code
1. **`packages/cli/src/auth/BucketFailoverHandlerImpl.ts`**
   - Complete rewrite of `tryFailover()` method (~150 lines)
   - Add `getLastFailoverReasons()` method
   - Add `lastFailoverReasons` state variable

2. **`packages/core/src/providers/errors.ts`**
   - Update `AllBucketsExhaustedError` constructor (optional parameter)
   - Export `BucketFailureReason` type

3. **`packages/core/src/config/config.ts`**
   - Add `getLastFailoverReasons?()` to `BucketFailoverHandler` interface
   - Add `FailoverContext` interface
   - Import `BucketFailureReason` type

4. **`packages/core/src/providers/RetryOrchestrator.ts`**
   - Pass `FailoverContext` to `tryFailover()`
   - Retrieve reasons from `getLastFailoverReasons()`
   - Construct `AllBucketsExhaustedError` with reasons

5. **`packages/cli/src/auth/oauth-manager.ts`**
   - Fix `scheduleProactiveRenewal()` condition (~5 lines)

### Test Files
1. **`packages/cli/src/auth/BucketFailoverHandlerImpl.spec.ts`**
   - Add classification tests (5 reasons × multiple scenarios)
   - Add three-pass algorithm tests
   - Add foreground reauth tests
   - Add state management tests

2. **`packages/core/src/providers/__tests__/RetryOrchestrator.test.ts`**
   - Add FailoverContext passing tests
   - Add error reporting tests
   - Add integration tests

---

## Success Criteria

### Functional
- [ ] Multi-bucket profiles rotate through all buckets on failure
- [ ] Single-bucket profiles behave unchanged
- [ ] Foreground reauth attempted for expired/missing tokens
- [ ] Proactive renewal scheduled at 80% lifetime for tokens > 5min
- [ ] `AllBucketsExhaustedError` includes detailed failure reasons

### Quality
- [ ] All tests pass (`npm run test`)
- [ ] TypeScript compiles without errors (`npm run typecheck`)
- [ ] Linting passes (`npm run lint`)
- [ ] Code formatted (`npm run format`)
- [ ] Build succeeds (`npm run build`)
- [ ] Smoke test passes (synthetic profile haiku test)
- [ ] 100% line coverage for new/modified code
- [ ] 80%+ mutation score (Stryker)

### Process
- [ ] All 38 phases completed in numerical order
- [ ] Every code change has `@plan:PLAN-20260223-ISSUE1598.P##` marker
- [ ] Every code change has `@requirement:REQ-1598-XXXX` marker
- [ ] All verification phases passed semantic checks
- [ ] No mock theater (tests verify actual behavior)
- [ ] Pseudocode followed exactly (implementation references line numbers)

---

## Development Rules (CRITICAL)

1. **NO PHASE SKIPPING**: Phases MUST be executed in exact numerical order
2. **TDD MANDATORY**: Write tests BEFORE implementation
3. **NO MOCK THEATER**: Tests must verify actual behavior, not mock configuration
4. **FOLLOW PSEUDOCODE**: Implementation must reference pseudocode line numbers
5. **SEMANTIC VERIFICATION**: Verify features WORK, not just that files exist
6. **PLAN MARKERS**: Every function/class/test must include `@plan:PLAN-20260223-ISSUE1598.P##`
7. **REQUIREMENT TRACING**: Every function/class/test must include `@requirement:REQ-1598-XXXX`

---

## Common Mistakes to Avoid

- [ERROR] **Skipping phase numbers** (e.g., 03 → 06 → 09)
- [ERROR] **Creating files without plan markers**
- [ERROR] **Writing tests that expect NotYetImplemented**
- [ERROR] **Implementing without following pseudocode**
- [ERROR] **Verifying only structural without semantic checks**
- [ERROR] **Proceeding before verification passes**
- [ERROR] **Using `expiresAt` instead of `expiry` for token field**
- [ERROR] **Creating parallel versions (e.g., ServiceV2) instead of updating existing files**

---

## Getting Help

### Documentation
- **Plan Structure**: `../../dev-docs/PLAN.md`
- **Phase Template**: `../../dev-docs/PLAN-TEMPLATE.md`
- **Development Rules**: `../../dev-docs/RULES.md`
- **Project Memory**: `../../.llxprt/LLXPRT.md`

### Debugging
- **Preflight failures**: Re-run verification commands, update plan to match reality
- **Test failures**: Check for reverse testing, mock theater, structure-only tests
- **Implementation issues**: Verify pseudocode followed exactly, check line number references
- **Integration issues**: Trace data flow, verify contracts, add missing tests

---

## Execution Status

**Current Phase**: Phase 00a (Preflight Verification)  
**Next Phase**: Phase 01 (Domain Analysis)  
**Status**: ⬜ NOT STARTED

See `execution-tracker.md` for detailed progress.

---

## References

- **Issue**: GitHub Issue #1598
- **Functional Spec**: `specification.md`
- **Technical Spec**: `technical.md`
- **Requirements**: `requirements.md`
- **Domain Model**: `analysis/domain-model.md`
- **Execution Tracker**: `execution-tracker.md`

---

**Last Updated**: 2026-02-23  
**Plan Version**: 1.0
