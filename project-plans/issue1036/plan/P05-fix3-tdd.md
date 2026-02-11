# Phase 05: Fix 3 TDD — Git Config Mounts

## Phase ID
`PLAN-20260211-SANDBOX1036.P05`

## Prerequisites
- Required: Phase P04 completed (Fix 1+2 implemented and passing)
- Verification: `grep -r "@plan:PLAN-20260211-SANDBOX1036.P04" packages/cli/src/utils/sandbox.ts`

## Requirements Implemented (Expanded)

### R3.1: Mount ~/.gitconfig
**Full Text**: When `~/.gitconfig` exists on the host, the sandbox launcher
shall mount it read-only into the container following the dual-HOME pattern.
**Behavior**:
- GIVEN: `~/.gitconfig` exists on host
- WHEN: `mountGitConfigFiles()` is called
- THEN: args contain `--volume /home/user/.gitconfig:/home/user/.gitconfig:ro`

### R3.2: Mount ~/.config/git/config
**Full Text**: When `~/.config/git/config` exists, mount read-only with
dual-HOME pattern.

### R3.3: Mount ~/.gitignore_global
**Full Text**: When `~/.gitignore_global` exists, mount read-only with
dual-HOME pattern.

### R3.4: Dual-HOME Mounting
**Full Text**: When container HOME differs from host HOME, mount each Git
config file at both paths.
**Behavior**:
- GIVEN: Host HOME is `/Users/alice`, container HOME is `/home/node`
- WHEN: `~/.gitconfig` exists and `mountGitConfigFiles()` is called
- THEN: args contain mounts at BOTH `/Users/alice/.gitconfig` AND
  `/home/node/.gitconfig`

### R3.5: Read-Only
**Full Text**: All Git config mounts shall use `:ro` mode.

### R3.6: Missing Files Don't Fail
**Full Text**: If optional Git config files don't exist, continue without failure.
**Behavior**:
- GIVEN: `~/.gitconfig` does NOT exist
- WHEN: `mountGitConfigFiles()` is called
- THEN: No mount added for that file, no error thrown

### R3.7: Exclude ~/.git-credentials
**Full Text**: If `~/.git-credentials` exists on the host, the sandbox launcher
shall not mount it into the container automatically.
**Behavior**:
- GIVEN: `~/.git-credentials` exists on host (along with other git config files)
- WHEN: `mountGitConfigFiles()` is called
- THEN: args do NOT contain any volume mount referencing `.git-credentials`

## Implementation Tasks

### Files to Modify
- `packages/cli/src/utils/sandbox.test.ts`
  - ADD: Test suite for `mountGitConfigFiles` helper function

### Test Specifications

The implementation (P06) will create an exported `mountGitConfigFiles` function.
Tests verify its behavior with controlled inputs.

```typescript
describe('mountGitConfigFiles @plan:PLAN-20260211-SANDBOX1036.P05', () => {
  // R3.1: Mounts ~/.gitconfig when it exists
  it('adds --volume for ~/.gitconfig when file exists @requirement:R3.1', () => {
    // Mock fs.existsSync to return true for ~/.gitconfig
    // Call mountGitConfigFiles(args, '/Users/alice', '/home/node')
    // Assert args contains '--volume', '/Users/alice/.gitconfig:<path>:ro'
  });

  // R3.2: Mounts ~/.config/git/config when it exists
  it('adds --volume for ~/.config/git/config when file exists @requirement:R3.2', () => {
    // Similar pattern
  });

  // R3.3: Mounts ~/.gitignore_global when it exists
  it('adds --volume for ~/.gitignore_global when file exists @requirement:R3.3', () => {
    // Similar pattern
  });

  // R3.4: Dual-HOME pattern
  it('mounts at both host and container home paths when they differ @requirement:R3.4', () => {
    // Mock fs.existsSync to return true for ~/.gitconfig
    // Call mountGitConfigFiles(args, '/Users/alice', '/home/node')
    // Assert TWO --volume entries: one at /Users/alice/.gitconfig, one at /home/node/.gitconfig
  });

  // R3.4 inverse: No duplicate when homes are same
  it('does not duplicate mount when host and container home are identical @requirement:R3.4', () => {
    // Call mountGitConfigFiles(args, '/home/node', '/home/node')
    // Assert only ONE --volume entry
  });

  // R3.5: Read-only
  it('all mounts use :ro mode @requirement:R3.5', () => {
    // Assert every --volume value ends with ':ro'
  });

  // R3.6: Missing files
  it('skips mount for files that do not exist @requirement:R3.6', () => {
    // Mock fs.existsSync to return false
    // Assert args array is unchanged
  });

  // R3.6: Partial existence
  it('mounts only files that exist, skips missing ones @requirement:R3.6', () => {
    // Mock: .gitconfig exists, .config/git/config does not, .gitignore_global exists
    // Assert: two mount entries, not three
  });

  // R3.7: Exclude ~/.git-credentials
  it('does not mount ~/.git-credentials even when it exists @requirement:R3.7', () => {
    // Mock fs.existsSync to return true for ALL files including .git-credentials
    // Call mountGitConfigFiles(args, '/Users/alice', '/home/node')
    // Assert args do NOT contain any volume mount referencing .git-credentials
  });
});
```

## Verification Commands
```bash
# Tests exist
grep -c "@plan:PLAN-20260211-SANDBOX1036.P05" packages/cli/src/utils/sandbox.test.ts
# Expected: 9+ matches

# Tests fail (mountGitConfigFiles not yet implemented)
npm run test --workspace=packages/cli -- --run sandbox.test 2>&1 | tail -20
# Expected: New tests fail

# No mock theater
grep "toHaveBeenCalled\b" packages/cli/src/utils/sandbox.test.ts | grep -v "existsSync"
# Expected: No matches (fs.existsSync mocking is acceptable)
```

## Success Criteria
- 9+ behavioral tests for R3.1–R3.7
- Tests fail because `mountGitConfigFiles` doesn't exist yet
- Existing tests still pass
- No mock theater patterns

## Failure Recovery
```bash
git checkout -- packages/cli/src/utils/sandbox.test.ts
```
