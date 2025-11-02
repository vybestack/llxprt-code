# Phase P07: Unit TDD – SubAgentScope

## Phase ID
`PLAN-20251028-STATELESS6.P07`

## Prerequisites
- P06/P06a complete

## Objectives
- Write failing unit tests enforcing runtime view usage and prohibiting Config mutation.

## Tasks
1. Add new test suite `packages/core/src/core/subagent.stateless.test.ts` covering (pseudocode step 007 prerequisites):
   - No invocation of `config.setModel` (spy-based check) – relates to REQ-STAT6-001.1 & REQ-STAT6-003.1.
   - Runtime view immutability expectation (REQ-STAT6-001.3).
   - Runtime view history isolation (unique object reference per scope).
2. Tag tests with `@plan PLAN-20251028-STATELESS6.P07` and matching requirement IDs.
3. Confirm test suite fails for expected reasons (mutation detected / runtime view missing).

## Completion Criteria
- Test run fails (red) with messages linked to missing runtime view behaviour.
- Failure reasons documented for P07a.
