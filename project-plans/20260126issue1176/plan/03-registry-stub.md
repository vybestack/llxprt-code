# Phase 03: Settings Registry Stub

## Phase ID
`PLAN-20260126-SETTINGS-SEPARATION.P03`

## Prerequisites

- Required: Phase 02 completed
- Verification: `grep -r "@plan:PLAN-20260126-SETTINGS-SEPARATION.P02" .`
- Expected files from previous phase:
  - `project-plans/20260126issue1176/plan/02-pseudocode.md`
- Preflight verification: Phase 0.5 MUST be completed

## Requirements Implemented (Expanded)

### REQ-SEP-001: Central registry with five categories
**Full Text**: A central settings registry MUST exist with five categories: model-behavior, provider-config, cli-behavior, model-param, and custom-header.
**Behavior**:
- GIVEN: The registry module exists
- WHEN: Types and constants are stubbed
- THEN: Category enum and registry structure compile
**Why This Matters**: Enables downstream tests to target registry behavior.

### REQ-SEP-002: separateSettings classification
**Full Text**: separateSettings() MUST classify all known settings into the correct category and output separated buckets.
**Behavior**:
- GIVEN: A stub function exists
- WHEN: Tests are written
- THEN: Function signature is ready for TDD
**Why This Matters**: Establishes the API contract for later phases.

### REQ-SEP-009: Alias normalization
**Full Text**: Alias normalization MUST preserve legacy keys (e.g., max-tokens → max_tokens).
**Behavior**:
- GIVEN: resolveAlias() stub exists
- WHEN: Tests are created later
- THEN: Behavior can be enforced by TDD
**Why This Matters**: Avoids breaking existing profiles.

### REQ-SEP-012: Reasoning object sanitization
**Full Text**: Reasoning object MUST be sanitized and internal keys stripped.
**Behavior**:
- GIVEN: normalizeSetting() stub exists
- WHEN: Tests are created later
- THEN: Behavior can be enforced by TDD
**Why This Matters**: Prevents internal keys from leaking.

## Implementation Tasks

### Files to Create

- `packages/core/src/settings/settingsRegistry.ts`
  - Export SettingCategory type, SettingSpec interface, SETTINGS_REGISTRY array (stub)
  - Export resolveAlias(), normalizeSetting(), separateSettings(), getSettingSpec()
  - MUST include `@plan:PLAN-20260126-SETTINGS-SEPARATION.P03`

- `packages/core/src/settings/index.ts`
  - Re-export registry functions
  - MUST include `@plan:PLAN-20260126-SETTINGS-SEPARATION.P03`

### Required Code Markers

Every function created in this phase MUST include:

```typescript
/**
 * @plan PLAN-20260126-SETTINGS-SEPARATION.P03
 * @requirement REQ-SEP-001
 */
```

## Verification Commands

```bash
npm run typecheck
```

## Success Criteria

- Registry files compile with strict TypeScript
- Functions exist with correct signatures for TDD

## Failure Recovery

- `git checkout -- packages/core/src/settings/settingsRegistry.ts packages/core/src/settings/index.ts`

## Phase Completion Marker

Create: `project-plans/20260126issue1176/.completed/P03.md`
