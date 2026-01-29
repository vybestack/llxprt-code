# Phase 14: CLI TDD

## Phase ID
`PLAN-20260126-SETTINGS-SEPARATION.P14`

## Prerequisites

- Required: Phase 13 completed
- Verification: `grep -r "@plan:PLAN-20260126-SETTINGS-SEPARATION.P13" .`

## Requirements Implemented (Expanded)

### REQ-SEP-009: Alias normalization
**Full Text**: Alias normalization MUST preserve legacy keys (e.g., max-tokens → max_tokens).
**Behavior**:
- GIVEN: /set command with alias
- WHEN: parseEphemeralSettingValue runs
- THEN: key is normalized to canonical
**Why This Matters**: Backward compatibility with existing CLI usage.

### REQ-SEP-013: Profile alias normalization
**Full Text**: Profile alias normalization MUST occur when loading persisted settings.
**Behavior**:
- GIVEN: profile file with alias key
- WHEN: loadProfile runs
- THEN: setting is stored under canonical key
**Why This Matters**: Old profiles still work.

## Implementation Tasks

### Files to Create/Modify

- CLI test files in `packages/cli/src/**/__tests__`
- Tests must include `@plan:PLAN-20260126-SETTINGS-SEPARATION.P14`
- Single assertion per test

## Test Scenarios (single assertion each)

- /set max-tokens 1000 stores max_tokens
- /set response-format stores response_format
- profile load with max-tokens normalizes to max_tokens
- profile save excludes reasoning object from persisted keys

## Verification Commands

```bash
npm run test -- --grep "P14"
```

## Phase Completion Marker

Create: `project-plans/20260126issue1176/.completed/P14.md`
