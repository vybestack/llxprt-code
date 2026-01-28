# Phase 13: CLI Stub

## Phase ID
`PLAN-20260126-SETTINGS-SEPARATION.P13`

## Prerequisites

- Required: Phase 12 completed
- Verification: `grep -r "@plan:PLAN-20260126-SETTINGS-SEPARATION.P12" .`

## Requirements Implemented (Expanded)

### REQ-SEP-009: Alias normalization
**Full Text**: Alias normalization MUST preserve legacy keys (e.g., max-tokens → max_tokens).
**Behavior**:
- GIVEN: CLI parse path
- WHEN: parseEphemeralSettingValue called
- THEN: resolveAlias is used to normalize key
**Why This Matters**: Backward compatibility.

### REQ-SEP-013: Profile alias normalization
**Full Text**: Profile alias normalization MUST occur when loading persisted settings.
**Behavior**:
- GIVEN: profile load path exists
- WHEN: loadProfile stub updated
- THEN: resolveAlias can be introduced in impl
**Why This Matters**: Backward compatibility for saved profiles.

## Implementation Tasks

### Files to Modify

- `packages/cli/src/settings/ephemeralSettings.ts` (stub import from core registry)
- `packages/cli/src/ui/commands/setCommand.ts` (stub for generating options from registry)
- `packages/cli/src/runtime/runtimeSettings.ts` (stub for profile keys from registry)
- `packages/cli/src/runtime/profileApplication.ts` (stub for alias normalization)

Add @plan markers `PLAN-20260126-SETTINGS-SEPARATION.P13`.

## Verification Commands

```bash
npm run typecheck
```

## Phase Completion Marker

Create: `project-plans/20260126issue1176/.completed/P13.md`
