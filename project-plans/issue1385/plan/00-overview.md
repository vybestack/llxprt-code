# Plan: Session Browser & /continue Command

## Phase ID

PLAN-20260214-SESSIONBROWSER.P00

## Prerequisites

- [ ] Phase 00a preflight verification completed and recorded.
- [ ] Baseline branch is clean and synced before downstream phase execution.
- [ ] Team confirms strict sequential execution: P00a → P01 → ... → P33.
- [ ] Integration touch points are explicitly acknowledged before implementation phases begin.

Concrete checks/commands:

- `git status --short`
- `git rev-parse --abbrev-ref HEAD`
- `test -f project-plans/issue1385/plan/00-overview.md`
- `grep -n "PLAN-20260214-SESSIONBROWSER.P00" project-plans/issue1385/plan/00-overview.md`

## Requirements Implemented (Expanded)

This overview phase defines planning scope, dependency ordering, and requirement-to-phase traceability for the full implementation.

Plan metadata retained:

- Plan ID: PLAN-20260214-SESSIONBROWSER
- Generated: 2026-02-14
- Total Phases: 48 (including analysis, pseudocode, and verification phases)
- Requirements: REQ-SB-001 through REQ-SB-026, REQ-PV-001 through REQ-PV-010, REQ-SR-001 through REQ-SR-014, REQ-SO-001 through REQ-SO-007, REQ-PG-001 through REQ-PG-005, REQ-KN-001 through REQ-KN-007, REQ-SD-001 through REQ-SD-003, REQ-RS-001 through REQ-RS-014, REQ-DL-001 through REQ-DL-014, REQ-EP-001 through REQ-EP-004, REQ-MP-001 through REQ-MP-004, REQ-LK-001 through REQ-LK-006, REQ-RC-001 through REQ-RC-013, REQ-SW-001 through REQ-SW-008, REQ-CV-001 through REQ-CV-002, REQ-ST-001 through REQ-ST-006, REQ-RR-001 through REQ-RR-008, REQ-RW-001 through REQ-RW-007, REQ-RN-001 through REQ-RN-013, REQ-RT-001 through REQ-RT-004, REQ-EH-001 through REQ-EH-005, REQ-DI-001 through REQ-DI-006, REQ-EN-001 through REQ-EN-006, REQ-SM-001 through REQ-SM-003, REQ-PR-001 through REQ-PR-005

Critical reminders retained:

1. Completed preflight verification (Phase 00a)
2. Defined integration contracts for multi-component features
3. Written integration tests BEFORE unit tests
4. Verified all dependencies and types exist as assumed

## Implementation Tasks

- [ ] Preserve and publish the dependency graph for execution ordering.
- [ ] Preserve and publish full phase list (P00a through P33, including verification phases).
- [ ] Preserve and publish requirements-to-phase mapping table.
- [ ] Preserve and publish execution rules and integration checklist.
- [ ] Confirm plan marker format expectation for all implementation phases (`@plan PLAN-20260214-SESSIONBROWSER.PNN`).
- [ ] Ensure this overview phase contains all required PLAN-TEMPLATE sections with actionable checks.

## Verification Commands

Run from repository root:

- `test -f project-plans/issue1385/plan/00-overview.md`
- `grep -n "^## Phase ID$" project-plans/issue1385/plan/00-overview.md`
- `grep -n "^## Prerequisites$" project-plans/issue1385/plan/00-overview.md`
- `grep -n "^## Requirements Implemented (Expanded)$" project-plans/issue1385/plan/00-overview.md`
- `grep -n "^## Implementation Tasks$" project-plans/issue1385/plan/00-overview.md`
- `grep -n "^## Verification Commands$" project-plans/issue1385/plan/00-overview.md`
- `grep -n "^## Deferred Implementation Detection$" project-plans/issue1385/plan/00-overview.md`
- `grep -n "^## Feature Actually Works$" project-plans/issue1385/plan/00-overview.md`
- `grep -n "^## Integration Points Verified$" project-plans/issue1385/plan/00-overview.md`
- `grep -n "^## Success Criteria$" project-plans/issue1385/plan/00-overview.md`
- `grep -n "^## Failure Recovery$" project-plans/issue1385/plan/00-overview.md`
- `grep -n "^## Phase Completion Marker$" project-plans/issue1385/plan/00-overview.md`
- `grep -n "PLAN-20260214-SESSIONBROWSER.P00" project-plans/issue1385/plan/00-overview.md`

## Deferred Implementation Detection

This is an overview-only phase; code changes are intentionally deferred to later phases.

Checklist:

- [ ] No source implementation files modified in P00.
- [ ] No test implementation added in P00.
- [ ] Any discovered ambiguity is captured for P01 (Domain Analysis) instead of being implemented ad hoc.
- [ ] New requirements discovered during planning are appended to mapping before phase execution proceeds.

Detection commands:

- `git diff --name-only -- project-plans/issue1385/plan/00-overview.md`
- `git diff --name-only | grep -v "project-plans/issue1385/plan/00-overview.md" || true`

## Feature Actually Works

Overview-phase “works” definition is planning integrity, not runtime behavior.

- [ ] Dependency graph supports executable ordering with no circular planning dependencies.
- [ ] Every requirement group has mapped primary phase(s).
- [ ] Phase sequence includes analysis, pseudocode, stub, TDD, implementation, and verification checkpoints.
- [ ] Integration-first testing expectation is explicitly documented.

## Integration Points Verified

Planning-level integration points retained and confirmed:

- [ ] DialogManager
- [ ] UIState
- [ ] UIActions
- [ ] slashCommandProcessor
- [ ] BuiltinCommandLoader
- [ ] statsCommand
- [ ] config.ts
- [ ] sessionUtils.ts
- [ ] AppContainer
- [ ] gemini.tsx

Additional integration planning checks:

- [ ] Files importing/using each integration point are identified before implementation phases begin.
- [ ] --resume flag and related legacy paths are tracked for replacement/removal phases.
- [ ] Existing JSONL session compatibility remains explicit (no migration required).

## Success Criteria

- [ ] All required PLAN-TEMPLATE headings exist in this file.
- [ ] Existing plan content (metadata, dependency graph, phase list, mapping, rules, checklist) is retained.
- [ ] Overview phase identifier is explicit and searchable.
- [ ] Commands in this file allow deterministic structural verification.
- [ ] P00 is ready to hand off to P00a/P01 without missing planning context.

## Failure Recovery

If structural or content checks fail:

1. Re-open this file and restore missing required heading(s).
2. Re-run all verification commands in this phase.
3. If existing plan content was accidentally dropped, restore from git:
   - `git show HEAD:project-plans/issue1385/plan/00-overview.md`
4. Re-apply template sections while preserving original planning payload.
5. Do not proceed to P01 until all P00 verification checks pass.

## Phase Completion Marker

- Marker: `@plan PLAN-20260214-SESSIONBROWSER.P00`
- Completion checklist:
  - [ ] Phase headings complete
  - [ ] Verification commands executed
  - [ ] Marker present and exact
  - [ ] File saved

## Dependency Graph

```
Relative Time Formatter ──── FOUNDATION, no deps on new code
   │
Session Discovery Extensions ──── FOUNDATION, extends core, no deps on new code
   │
performResume() ← depends on SessionDiscovery, resumeSession (existing core)
   │
useSessionBrowser Hook ← depends on SessionDiscovery extensions, performResume
   │
SessionBrowserDialog Component ← depends on useSessionBrowser hook
   │
/continue Command ← depends on performResume, SessionBrowserDialog
   │
Integration Wiring ← depends on /continue Command, SessionBrowserDialog, DialogManager
   │
/stats Session Section ← depends on Integration Wiring (SessionRecordingMetadata)
   │
--resume Flag Removal ← independent, no deps on new code
   │
End-to-End Integration ← depends on ALL above
   │
Final Verification ← depends on ALL above
```

## Phase List

| Phase | ID | Title | Type |
|-------|-----|-------|------|
| 00a | P00a | Preflight Verification | Verification |
| 01 | P01 | Domain Analysis | Analysis |
| 01a | P01a | Analysis Verification | Verification |
| 02 | P02 | Pseudocode Development | Pseudocode |
| 02a | P02a | Pseudocode Verification | Verification |
| 03 | P03 | Relative Time Formatter Stub | Stub |
| 03a | P03a | Relative Time Formatter Stub Verification | Verification |
| 04 | P04 | Relative Time Formatter TDD | TDD |
| 04a | P04a | Relative Time Formatter TDD Verification | Verification |
| 05 | P05 | Relative Time Formatter Implementation | Implementation |
| 05a | P05a | Relative Time Formatter Impl Verification | Verification |
| 06 | P06 | Session Discovery Extensions Stub | Stub |
| 06a | P06a | Session Discovery Extensions Stub Verification | Verification |
| 07 | P07 | Session Discovery Extensions TDD | TDD |
| 07a | P07a | Session Discovery Extensions TDD Verification | Verification |
| 08 | P08 | Session Discovery Extensions Implementation | Implementation |
| 08a | P08a | Session Discovery Extensions Impl Verification | Verification |
| 09 | P09 | performResume Stub | Stub |
| 09a | P09a | performResume Stub Verification | Verification |
| 10 | P10 | performResume TDD | TDD |
| 10a | P10a | performResume TDD Verification | Verification |
| 11 | P11 | performResume Implementation | Implementation |
| 11a | P11a | performResume Impl Verification | Verification |
| 12 | P12 | useSessionBrowser Hook Stub | Stub |
| 12a | P12a | useSessionBrowser Hook Stub Verification | Verification |
| 13 | P13 | useSessionBrowser Hook TDD | TDD |
| 13a | P13a | useSessionBrowser Hook TDD Verification | Verification |
| 14 | P14 | useSessionBrowser Hook Implementation | Implementation |
| 14a | P14a | useSessionBrowser Hook Impl Verification | Verification |
| 15 | P15 | SessionBrowserDialog Stub | Stub |
| 15a | P15a | SessionBrowserDialog Stub Verification | Verification |
| 16 | P16 | SessionBrowserDialog TDD | TDD |
| 16a | P16a | SessionBrowserDialog TDD Verification | Verification |
| 17 | P17 | SessionBrowserDialog Implementation | Implementation |
| 17a | P17a | SessionBrowserDialog Impl Verification | Verification |
| 18 | P18 | /continue Command Stub | Stub |
| 18a | P18a | /continue Command Stub Verification | Verification |
| 19 | P19 | /continue Command TDD | TDD |
| 19a | P19a | /continue Command TDD Verification | Verification |
| 20 | P20 | /continue Command Implementation | Implementation |
| 20a | P20a | /continue Command Impl Verification | Verification |
| 21 | P21 | Integration Wiring Stub | Stub |
| 21a | P21a | Integration Wiring Stub Verification | Verification |
| 22 | P22 | Integration Wiring TDD | TDD |
| 22a | P22a | Integration Wiring TDD Verification | Verification |
| 23 | P23 | Integration Wiring Implementation | Implementation |
| 23a | P23a | Integration Wiring Impl Verification | Verification |
| 24 | P24 | /stats Session Section Stub | Stub |
| 24a | P24a | /stats Session Section Stub Verification | Verification |
| 25 | P25 | /stats Session Section TDD | TDD |
| 25a | P25a | /stats Session Section TDD Verification | Verification |
| 26 | P26 | /stats Session Section Implementation | Implementation |
| 26a | P26a | /stats Session Section Impl Verification | Verification |
| 27 | P27 | --resume Flag Removal Stub | Stub |
| 27a | P27a | --resume Flag Removal Stub Verification | Verification |
| 28 | P28 | --resume Flag Removal TDD | TDD |
| 28a | P28a | --resume Flag Removal TDD Verification | Verification |
| 29 | P29 | --resume Flag Removal Implementation | Implementation |
| 29a | P29a | --resume Flag Removal Impl Verification | Verification |
| 30 | P30 | End-to-End Integration Stub | Stub |
| 30a | P30a | End-to-End Integration Stub Verification | Verification |
| 31 | P31 | End-to-End Integration TDD | TDD |
| 31a | P31a | End-to-End Integration TDD Verification | Verification |
| 32 | P32 | End-to-End Integration Implementation | Implementation |
| 32a | P32a | End-to-End Integration Impl Verification | Verification |
| 33 | P33 | Final Verification | Verification |

## Requirements → Phase Mapping

| Requirement Group | Requirements | Primary Phase(s) |
|-------------------|-------------|-------------------|
| Session Browser — Listing & Display | REQ-SB-001 to REQ-SB-026 | P15-P17 (Dialog), P12-P14 (Hook) |
| Preview Loading | REQ-PV-001 to REQ-PV-010 | P06-P08 (Discovery), P12-P14 (Hook) |
| Search | REQ-SR-001 to REQ-SR-014 | P12-P14 (Hook), P15-P17 (Dialog) |
| Sort | REQ-SO-001 to REQ-SO-007 | P12-P14 (Hook), P15-P17 (Dialog) |
| Pagination | REQ-PG-001 to REQ-PG-005 | P12-P14 (Hook), P15-P17 (Dialog) |
| Keyboard Navigation | REQ-KN-001 to REQ-KN-007 | P12-P14 (Hook) |
| Selection & Detail | REQ-SD-001 to REQ-SD-003 | P12-P14 (Hook), P15-P17 (Dialog) |
| Resume Flow | REQ-RS-001 to REQ-RS-014 | P09-P11 (performResume), P12-P14 (Hook) |
| Delete Flow | REQ-DL-001 to REQ-DL-014 | P12-P14 (Hook), P15-P17 (Dialog) |
| Escape Precedence | REQ-EP-001 to REQ-EP-004 | P12-P14 (Hook) |
| Modal Priority | REQ-MP-001 to REQ-MP-004 | P12-P14 (Hook), P18-P20 (Command) |
| Lock Status | REQ-LK-001 to REQ-LK-006 | P12-P14 (Hook) |
| /continue Command | REQ-RC-001 to REQ-RC-013 | P18-P20 (Command) |
| Recording Swap | REQ-SW-001 to REQ-SW-008 | P09-P11 (performResume), P30-P32 (E2E) |
| IContent Conversion | REQ-CV-001 to REQ-CV-002 | P18-P20 (Command), P30-P32 (E2E) |
| /stats Session | REQ-ST-001 to REQ-ST-006 | P24-P26 (Stats) |
| --resume Removal | REQ-RR-001 to REQ-RR-008 | P27-P29 (Removal) |
| Wide Mode | REQ-RW-001 to REQ-RW-007 | P15-P17 (Dialog) |
| Narrow Mode | REQ-RN-001 to REQ-RN-013 | P15-P17 (Dialog) |
| Relative Time | REQ-RT-001 to REQ-RT-004 | P03-P05 (Formatter) |
| Error Handling | REQ-EH-001 to REQ-EH-005 | P12-P14 (Hook), P09-P11 (performResume) |
| Dialog Integration | REQ-DI-001 to REQ-DI-006 | P21-P23 (Integration Wiring) |
| Entry Points | REQ-EN-001 to REQ-EN-006 | P18-P20 (Command), P21-P23 (Integration) |
| Session Metadata | REQ-SM-001 to REQ-SM-003 | P21-P23 (Integration Wiring) |
| performResume | REQ-PR-001 to REQ-PR-005 | P09-P11 (performResume) |

## Execution Rules

1. **Sequential**: Execute P00a → P01 → P01a → P02 → ... → P33 in exact order
2. **Never skip**: Every phase must complete before the next begins
3. **Verify before proceeding**: Each verification phase must pass before implementation continues
4. **Code markers**: Every function/class/test must include `@plan PLAN-20260214-SESSIONBROWSER.PNN`
5. **Pseudocode traceability**: Implementation phases must reference pseudocode line numbers

## Integration Checklist (MUST be verified before implementation starts)

- [ ] Identified all touch points with existing system (DialogManager, UIState, UIActions, slashCommandProcessor, BuiltinCommandLoader, statsCommand, config.ts, sessionUtils.ts, AppContainer, gemini.tsx)
- [ ] Listed specific files that will import/use the feature
- [ ] Identified old code to be replaced/removed (--resume flag, RESUME_LATEST, SessionSelector)
- [ ] Planned migration path: no data migration needed, existing JSONL sessions are used as-is
- [ ] Integration tests planned that verify end-to-end flow (Phase 30-32)
- [ ] User can access the feature through existing CLI (/continue command, --continue unchanged)
