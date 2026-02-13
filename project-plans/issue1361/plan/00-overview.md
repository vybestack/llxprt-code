# Plan: Session Recording Service

Plan ID: PLAN-20260211-SESSIONRECORDING
Generated: 2026-02-11
Total Phases: 28 (including analysis, pseudocode, and verification phases)
Requirements: REQ-REC-001 through REQ-REC-008, REQ-RPL-001 through REQ-RPL-008, REQ-INT-001 through REQ-INT-007, REQ-RSM-001 through REQ-RSM-006, REQ-MGT-001 through REQ-MGT-004, REQ-CON-001 through REQ-CON-006, REQ-CLN-001 through REQ-CLN-004, REQ-DEL-001 through REQ-DEL-007

## Critical Reminders

Before implementing ANY phase, ensure you have:

1. Completed preflight verification (Phase 00a)
2. Defined integration contracts for multi-component features
3. Written integration tests BEFORE unit tests
4. Verified all dependencies and types exist as assumed

## Dependency Graph

```
#1362 (Core types + writer) ─── FOUNDATION, no deps
   ├── #1363 (Replay engine) ← depends on #1362
   ├── #1367 (Concurrency + lifecycle) ← depends on #1362
   ├── #1364 (Recording integration) ← depends on #1362
   │
   ├── #1369 (Cleanup adaptation) ← depends on #1367
   │
   ├── #1365 (Resume flow) ← depends on #1362 + #1363 + #1367
   │     └── #1366 (List/delete) ← depends on #1362 + #1365 + #1367
   │
   └── #1368 (Remove old system) ← depends on #1364 + #1365 + #1369 (LAST)
```

## Phase List

| Phase | ID | Title | Issue | Type |
|-------|-----|-------|-------|------|
| 00a | P00a | Preflight Verification | — | Verification |
| 01 | P01 | Domain Analysis | — | Analysis |
| 01a | P01a | Analysis Verification | — | Verification |
| 02 | P02 | Pseudocode Development | — | Pseudocode |
| 02a | P02a | Pseudocode Verification | — | Verification |
| 03 | P03 | Core Types + Writer Stub | #1362 | Stub |
| 03a | P03a | Core Types + Writer Stub Verification | #1362 | Verification |
| 04 | P04 | Core Types + Writer TDD | #1362 | TDD |
| 04a | P04a | Core Types + Writer TDD Verification | #1362 | Verification |
| 05 | P05 | Core Types + Writer Implementation | #1362 | Implementation |
| 05a | P05a | Core Types + Writer Impl Verification | #1362 | Verification |
| 06 | P06 | Replay Engine Stub | #1363 | Stub |
| 06a | P06a | Replay Engine Stub Verification | #1363 | Verification |
| 07 | P07 | Replay Engine TDD | #1363 | TDD |
| 07a | P07a | Replay Engine TDD Verification | #1363 | Verification |
| 08 | P08 | Replay Engine Implementation | #1363 | Implementation |
| 08a | P08a | Replay Engine Impl Verification | #1363 | Verification |
| 09 | P09 | Concurrency + Lifecycle Stub | #1367 | Stub |
| 09a | P09a | Concurrency + Lifecycle Stub Verification | #1367 | Verification |
| 10 | P10 | Concurrency + Lifecycle TDD | #1367 | TDD |
| 10a | P10a | Concurrency + Lifecycle TDD Verification | #1367 | Verification |
| 11 | P11 | Concurrency + Lifecycle Implementation | #1367 | Implementation |
| 11a | P11a | Concurrency + Lifecycle Impl Verification | #1367 | Verification |
| 12 | P12 | Recording Integration Stub | #1364 | Stub |
| 12a | P12a | Recording Integration Stub Verification | #1364 | Verification |
| 13 | P13 | Recording Integration TDD | #1364 | TDD |
| 13a | P13a | Recording Integration TDD Verification | #1364 | Verification |
| 14 | P14 | Recording Integration Implementation | #1364 | Implementation |
| 14a | P14a | Recording Integration Impl Verification | #1364 | Verification |
| 15 | P15 | Session Cleanup Stub | #1369 | Stub |
| 15a | P15a | Session Cleanup Stub Verification | #1369 | Verification |
| 16 | P16 | Session Cleanup TDD | #1369 | TDD |
| 16a | P16a | Session Cleanup TDD Verification | #1369 | Verification |
| 17 | P17 | Session Cleanup Implementation | #1369 | Implementation |
| 17a | P17a | Session Cleanup Impl Verification | #1369 | Verification |
| 18 | P18 | Resume Flow Stub | #1365 | Stub |
| 18a | P18a | Resume Flow Stub Verification | #1365 | Verification |
| 19 | P19 | Resume Flow TDD | #1365 | TDD |
| 19a | P19a | Resume Flow TDD Verification | #1365 | Verification |
| 20 | P20 | Resume Flow Implementation | #1365 | Implementation |
| 20a | P20a | Resume Flow Impl Verification | #1365 | Verification |
| 21 | P21 | Session Management Stub | #1366 | Stub |
| 21a | P21a | Session Management Stub Verification | #1366 | Verification |
| 22 | P22 | Session Management TDD | #1366 | TDD |
| 22a | P22a | Session Management TDD Verification | #1366 | Verification |
| 23 | P23 | Session Management Implementation | #1366 | Implementation |
| 23a | P23a | Session Management Impl Verification | #1366 | Verification |
| 24 | P24 | System Integration Stub | — | Stub |
| 24a | P24a | System Integration Stub Verification | — | Verification |
| 25 | P25 | System Integration TDD | — | TDD |
| 25a | P25a | System Integration TDD Verification | — | Verification |
| 26 | P26 | System Integration Implementation | — | Implementation |
| 26a | P26a | System Integration Impl Verification | — | Verification |
| 27 | P27 | Old System Removal | #1368 | Removal |
| 27a | P27a | Old System Removal Verification | #1368 | Verification |
| 28 | P28 | Final Verification | — | Verification |

## Execution Rules

1. **Sequential**: Execute P00a → P01 → P01a → P02 → ... → P28 in exact order
2. **Never skip**: Every phase must complete before the next begins
3. **Verify before proceeding**: Each verification phase must pass before implementation continues
4. **Code markers**: Every function/class/test must include `@plan:PLAN-20260211-SESSIONRECORDING.PNN`
5. **Pseudocode traceability**: Implementation phases must reference pseudocode line numbers

## Integration Checklist (MUST be verified before implementation starts)

- [x] Identified all touch points with existing system (gemini.tsx, AppContainer, useGeminiStream, sessionCleanup, cleanup.ts, config.ts)
- [x] Listed specific files that will import/use the feature
- [x] Identified old code to be replaced/removed (SessionPersistenceService, PersistedSession types, restoration useEffects)
- [x] Old system fully replaced — no migration, old .json cleanup handled by preexisting code
- [x] Integration tests planned that verify end-to-end flow (Phase 25)
- [x] User can access the feature through existing CLI (--continue, --list-sessions, --delete-session)
