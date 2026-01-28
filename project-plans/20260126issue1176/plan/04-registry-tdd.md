# Phase 04: Settings Registry TDD

## Phase ID
`PLAN-20260126-SETTINGS-SEPARATION.P04`

## Prerequisites

- Required: Phase 03 completed
- Verification: `grep -r "@plan:PLAN-20260126-SETTINGS-SEPARATION.P03" .`
- Expected files from previous phase:
  - `packages/core/src/settings/settingsRegistry.ts`

## Requirements Implemented (Expanded)

### REQ-SEP-001: Central registry categories
**Full Text**: A central settings registry MUST exist with five categories: model-behavior, provider-config, cli-behavior, model-param, and custom-header.
**Behavior**:
- GIVEN: Settings registry exports categories
- WHEN: Tests enumerate categories
- THEN: All five categories exist
**Why This Matters**: Tests establish canonical categories.

### REQ-SEP-002: separateSettings classification
**Full Text**: separateSettings() MUST classify all known settings into the correct category and output separated buckets.
**Behavior**:
- GIVEN: Mixed settings
- WHEN: separateSettings() is called
- THEN: cliSettings/modelBehavior/modelParams/customHeaders contain expected keys
**Why This Matters**: Ensures correct classification.

### REQ-SEP-003: Unknown settings default to cli-behavior
**Full Text**: Unknown settings MUST default to cli-behavior to prevent unsafe API leakage.
**Behavior**:
- GIVEN: unknown key
- WHEN: separateSettings() runs
- THEN: key appears in cliSettings only
**Why This Matters**: Prevents leaks.

### REQ-SEP-008: Custom headers extracted correctly
**Full Text**: Custom headers MUST be extracted and merged correctly, including provider overrides.
**Behavior**:
- GIVEN: custom-headers JSON and user-agent
- WHEN: separateSettings() runs
- THEN: customHeaders contains entries with proper override behavior
**Why This Matters**: Ensures header handling.

### REQ-SEP-009: Alias normalization
**Full Text**: Alias normalization MUST preserve legacy keys (e.g., max-tokens → max_tokens).
**Behavior**:
- GIVEN: alias keys
- WHEN: resolveAlias() runs
- THEN: canonical key returned
**Why This Matters**: Backward compatibility.

### REQ-SEP-012: Reasoning object sanitization
**Full Text**: Reasoning object MUST be sanitized and internal keys stripped.
**Behavior**:
- GIVEN: reasoning object with internal keys
- WHEN: normalizeSetting() runs
- THEN: internal keys removed
**Why This Matters**: Prevents internal keys from leaking.

## Implementation Tasks

### Files to Create

- `packages/core/src/settings/__tests__/settingsRegistry.test.ts`
  - Single-assertion behavioral tests
  - MUST include `@plan:PLAN-20260126-SETTINGS-SEPARATION.P04`
  - MUST include `@requirement:REQ-SEP-00X`

### Required Code Markers

Every test MUST include:

```typescript
/**
 * @plan PLAN-20260126-SETTINGS-SEPARATION.P04
 * @requirement REQ-SEP-002
 */
```

## Test Scenarios (single assertion each)

- resolveAlias('max-tokens') returns 'max_tokens'
- resolveAlias('user-agent') returns 'user-agent'
- separateSettings puts shell-replacement into cliSettings
- separateSettings puts temperature into modelParams
- separateSettings extracts custom-headers JSON into customHeaders
- separateSettings merges provider custom-headers overriding global
- separateSettings applies provider allowlist for seed (OpenAI) and excludes for Anthropic
- normalizeSetting('reasoning', object) removes internal keys
- unknown key defaults to cliSettings

## Verification Commands

```bash
npm run test -- --grep "P04"
```

## Success Criteria

- Tests fail because stub implementation is incomplete (RED)
- No reverse testing patterns

## Phase Completion Marker

Create: `project-plans/20260126issue1176/.completed/P04.md`
