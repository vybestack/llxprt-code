# Phase 06: Fix 3 Implementation — Git Config Mounts

## Phase ID
`PLAN-20260211-SANDBOX1036.P06`

## Prerequisites
- Required: Phase P05 completed (TDD tests exist and fail)
- Verification: `grep -r "@plan:PLAN-20260211-SANDBOX1036.P05" packages/cli/src/utils/sandbox.test.ts`

## Requirements Implemented
- R3.1, R3.2, R3.3, R3.4, R3.5, R3.6, R3.7

## Implementation Tasks

### Files to Modify
- `packages/cli/src/utils/sandbox.ts`

### New Exported Function: mountGitConfigFiles
**Location**: After the existing `buildSandboxEnvArgs` function (around line 85)
and before `start_sandbox`. This follows the pattern of other exported helper
functions in the file.

**Pseudocode reference**: Section C, lines 10-23

```typescript
/**
 * Mounts Git configuration files into the container.
 * Follows the dual-HOME mount pattern for consistency.
 *
 * @plan:PLAN-20260211-SANDBOX1036.P06
 * @requirement:R3.1, R3.2, R3.3, R3.4, R3.5, R3.6, R3.7
 */
export function mountGitConfigFiles(
  args: string[],
  hostHomedir: string,
  containerHomePath: string,
): void {
  // See pseudocode Section C lines 10-23
  // Define the git config files to mount (NOT .git-credentials per R3.7)
  // For each: check existence, mount at host path :ro
  // If containerHomePath differs: also mount at container home path :ro
}
```

### Integration Point
In `start_sandbox()`, after the user settings directory mount section
(around line 615) and before the tmpdir mount, call:

```typescript
mountGitConfigFiles(args, os.homedir(), '/home/node');
```

Note: The container home path `/home/node` matches the existing pattern
used for `userSettingsDirInSandbox`.

### Required Code Markers
```typescript
// @plan:PLAN-20260211-SANDBOX1036.P06
// @requirement:R3.1, R3.2, R3.3, R3.4, R3.5, R3.6, R3.7
```

## Verification Commands
```bash
# Function exists and is exported
grep "export function mountGitConfigFiles" packages/cli/src/utils/sandbox.ts
# Expected: One match

# Function is called in start_sandbox
grep "mountGitConfigFiles" packages/cli/src/utils/sandbox.ts | grep -v "export\|function\|import\|test\|//"
# Expected: At least one call site

# All tests pass
npm run test --workspace=packages/cli -- --run sandbox.test
# Expected: All pass including P05 tests

# Typecheck
npm run typecheck
# Expected: Pass

# No deferred work
grep -n "TODO\|FIXME\|HACK" packages/cli/src/utils/sandbox.ts | grep -i "git"
# Expected: No matches
```

## Semantic Verification Checklist

1. **Does the code DO what the requirement says?**
   - [ ] R3.1: ~/.gitconfig mounted when present
   - [ ] R3.2: ~/.config/git/config mounted when present
   - [ ] R3.3: ~/.gitignore_global mounted when present
   - [ ] R3.4: Both paths used when host/container HOME differ
   - [ ] R3.5: All mounts use :ro
   - [ ] R3.6: Missing files silently skipped
   - [ ] R3.7: ~/.git-credentials is NOT in the mount list (excluded by design)

2. **Is the feature INTEGRATED?**
   - [ ] `mountGitConfigFiles` is called from `start_sandbox()`
   - [ ] Call is in the Docker/Podman branch (not sandbox-exec)

3. **Are there obvious gaps?**
   - [ ] Windows path conversion via `getContainerPath()` used
   - [ ] No duplicate mounts when paths resolve identically

## Success Criteria
- All P05 tests pass (GREEN)
- All existing tests still pass
- `mountGitConfigFiles` exported and called from `start_sandbox`
- Typecheck passes

## Failure Recovery
```bash
git checkout -- packages/cli/src/utils/sandbox.ts
```
