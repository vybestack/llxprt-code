# Phase 11: Providers TDD

## Phase ID
`PLAN-20260126-SETTINGS-SEPARATION.P11`

## Prerequisites

- Required: Phase 10 completed
- Verification: `grep -r "@plan:PLAN-20260126-SETTINGS-SEPARATION.P10" .`

## Requirements Implemented (Expanded)

### REQ-SEP-005: Providers read from pre-separated modelParams
**Full Text**: Providers MUST read from pre-separated modelParams instead of filtering raw ephemerals.
**Behavior**:
- GIVEN: invocation.modelParams
- WHEN: provider builds request
- THEN: modelParams are used directly
**Why This Matters**: Eliminates per-provider filtering.

### REQ-SEP-006: CLI settings never appear in API requests
**Full Text**: CLI-only settings MUST never appear in provider API requests.
**Behavior**:
- GIVEN: cliSettings
- WHEN: provider builds request
- THEN: cliSettings keys are absent
**Why This Matters**: Prevents leaks.

### REQ-SEP-007: Model params pass through unchanged
**Full Text**: Model params MUST pass through unchanged when valid for the provider.
**Behavior**:
- GIVEN: temperature/max_tokens
- WHEN: provider builds request
- THEN: params appear unchanged
**Why This Matters**: Preserves model param behavior.

### REQ-SEP-008: Custom headers extracted correctly
**Full Text**: Custom headers MUST be extracted and merged correctly, including provider overrides.
**Behavior**:
- GIVEN: customHeaders in invocation
- WHEN: provider builds request headers
- THEN: headers include overrides
**Why This Matters**: Correct header behavior.

### REQ-SEP-011: Provider-config keys filtered
**Full Text**: Provider-config keys MUST be filtered from API requests.
**Behavior**:
- GIVEN: provider config keys
- WHEN: provider builds request
- THEN: keys not present
**Why This Matters**: Prevents infra config leakage.

## Implementation Tasks

### Files to Create/Modify

- Provider-specific test files under `packages/core/src/providers/**/__tests__` or existing provider test suites
- Tests must include `@plan:PLAN-20260126-SETTINGS-SEPARATION.P11`
- Single assertion per test
- MSW-based interception if making HTTP requests

## Verification Commands

```bash
npm run test -- --grep "P11"
```

## Success Criteria

- Tests fail due to stubbed provider implementations (RED)
- No reverse testing

## Phase Completion Marker

Create: `project-plans/20260126issue1176/.completed/P11.md`
