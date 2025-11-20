# Phase 03: BootstrapProfileArgs Type Extension (Stub)

## Phase ID
`PLAN-20251118-ISSUE533.P03`

## Prerequisites
- None (first implementation phase)
- Project must compile with TypeScript strict mode

## Implementation Tasks

### Files to Modify

#### `packages/cli/src/config/profileBootstrap.ts`
**Location**: Line ~34 (BootstrapProfileArgs interface)
**Change**: Add `profileJson` field

**Current Code** (approximate):
```typescript
export interface BootstrapProfileArgs {
  profileName: string | null;
  providerOverride: string | null;
  modelOverride: string | null;
  keyOverride: string | null;
  keyfileOverride: string | null;
  baseurlOverride: string | null;
  setOverrides: string[] | null;
}
```

**Modified Code**:
```typescript
export interface BootstrapProfileArgs {
  profileName: string | null;
  profileJson: string | null;  // @plan:PLAN-20251118-ISSUE533.P03 @requirement:REQ-PROF-001.1
  providerOverride: string | null;
  modelOverride: string | null;
  keyOverride: string | null;
  keyfileOverride: string | null;
  baseurlOverride: string | null;
  setOverrides: string[] | null;
}
```

**Rationale**: Add field to store inline JSON profile string from `--profile` flag.

### Required Code Markers

All changes in this phase MUST include:
```typescript
// @plan:PLAN-20251118-ISSUE533.P03
// @requirement:REQ-PROF-001.1
```

## Verification Commands

### Automated Checks

```bash
# Check plan markers exist
grep -r "@plan:PLAN-20251118-ISSUE533.P03" packages/cli/src/config/profileBootstrap.ts
# Expected: 1 occurrence (in interface comment)

# Check TypeScript compiles
npm run typecheck
# Expected: 0 errors

# Verify field exists
grep "profileJson: string | null" packages/cli/src/config/profileBootstrap.ts
# Expected: 1 occurrence
```

### Manual Verification Checklist

- [ ] `profileJson` field added to `BootstrapProfileArgs` interface
- [ ] Field type is `string | null`
- [ ] Field positioned after `profileName` (for logical grouping)
- [ ] Plan marker comment added
- [ ] Requirement marker comment added
- [ ] TypeScript compiles with no errors
- [ ] No other code changes in this file
- [ ] No test files modified

## Success Criteria

- TypeScript compiles successfully
- `profileJson` field accessible in interface
- No runtime behavior changes (type-only change)
- Plan markers present and greppable

## Implementation Notes

This is a pure type extension phase. No runtime code changes are required.

**Why stub phase?**: While this is just a type change, we follow the plan structure for consistency. This ensures the type exists before Phase 04 writes tests using it.

**No tests yet**: Phase 04 will write tests that use this field.

## Pseudocode Reference

**File**: `analysis/pseudocode/parse-bootstrap-args.md`
**Line**: 005 - `profileJson: null`

This line in the pseudocode initializes the field. This phase creates the type definition.

## Phase Completion Marker

After completing this phase, create: `project-plans/20251118-issue533/.completed/P03.md`

```markdown
Phase: P03
Completed: [YYYY-MM-DD HH:MM]
Files Modified:
  - packages/cli/src/config/profileBootstrap.ts (1 line added)
Changes:
  - Added profileJson field to BootstrapProfileArgs interface
Verification:
  - TypeScript compiles: [OK]
  - Plan markers present: [OK]
  - No runtime changes: [OK]
```
