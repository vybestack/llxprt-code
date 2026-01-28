# Phase 15: CLI Implementation

## Phase ID
`PLAN-20260126-SETTINGS-SEPARATION.P15`

## Prerequisites

- Required: Phase 14 completed
- Verification: `grep -r "@plan:PLAN-20260126-SETTINGS-SEPARATION.P14" .`

## Requirements Implemented (Expanded)

### REQ-SEP-009: Alias normalization
**Full Text**: Alias normalization MUST preserve legacy keys (e.g., max-tokens → max_tokens).
**Behavior**:
- GIVEN: /set command with alias
- WHEN: parseEphemeralSettingValue runs
- THEN: canonical key is used for validation and storage
**Why This Matters**: Backward compatibility.

### REQ-SEP-013: Profile alias normalization
**Full Text**: Profile alias normalization MUST occur when loading persisted settings.
**Behavior**:
- GIVEN: profile file with alias keys
- WHEN: profile load runs
- THEN: settings stored under canonical keys
**Why This Matters**: Existing profiles continue to work.

## Implementation Tasks

### Files to Modify

- `packages/cli/src/settings/ephemeralSettings.ts`
  - Use registry resolveAlias/parseSetting/validateSetting
- `packages/cli/src/ui/commands/setCommand.ts`
  - Generate completion options from registry
- `packages/cli/src/runtime/runtimeSettings.ts`
  - Replace static profile keys with getProfilePersistableKeys
- `packages/cli/src/runtime/profileApplication.ts`
  - Normalize keys on profile load using resolveAlias

Add @plan markers with pseudocode references.

## Verification Commands

```bash
npm run test -- --grep "P14"
```

## Phase Completion Marker

Create: `project-plans/20260126issue1176/.completed/P15.md`
