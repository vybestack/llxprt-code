# Phase P09: Integration TDD – Ephemerals & Telemetry

## Phase ID
`PLAN-20251028-STATELESS6.P09`

## Prerequisites
- P08/P08a completed

## Objectives
- Add failing integration tests proving isolated runtime views for foreground vs synthetic subagent.

## Tasks
1. Create `packages/core/src/integration-tests/geminiChat-isolation.integration.test.ts` containing scenarios from test strategy (pseudocode step 009). |
   - Foreground view (Config adapter) + subagent view (manual snapshot).
   - Assert histories remain independent.
   - Assert telemetry events contain distinct runtime IDs.
   - Confirm provider/model isolation (foreground model unchanged).
2. Tag tests with `@plan PLAN-20251028-STATELESS6.P09` and relevant requirements.
3. Ensure test suite fails under current implementation.

## Completion Criteria
- Integration test fails for expected reasons (missing runtime view support for ephemerals/telemetry).
- Failure output saved for P09a.
