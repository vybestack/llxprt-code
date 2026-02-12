# Phase 04: Fix 1+2 Implementation — Error Message and Git Discovery

## Phase ID
`PLAN-20260211-SANDBOX1036.P04`

## Prerequisites
- Required: Phase P03 completed (TDD tests exist and fail)
- Verification: `grep -r "@plan:PLAN-20260211-SANDBOX1036.P03" packages/cli/src/utils/sandbox.test.ts`

## Requirements Implemented
- R1.1, R1.2 (error message branding)
- R2.1 (GIT_DISCOVERY_ACROSS_FILESYSTEM=1)

## Implementation Tasks

### Files to Modify
- `packages/cli/src/utils/sandbox.ts`

### Fix 1: Error Message (pseudocode Section A)
**Location**: Line ~526 in `start_sandbox()`, inside the `ensureSandboxImageIsPresent` failure path.

**Current**:
```typescript
: 'Please check the image name, your network connection, or notify gemini-cli-dev@google.com if the issue persists.';
```

**Replace with**:
```typescript
: 'Please check the image name, your network connection, or visit https://github.com/vybestack/llxprt-code/discussions if the issue persists.';
```

### Fix 2: Git Discovery Env Var (pseudocode Section B)
**Location**: After the existing env var pushes (around line 740, near the
GEMINI_API_KEY, TERM, COLORTERM pushes), add:

```typescript
// Enable Git to discover repositories across container filesystem boundaries
args.push('--env', 'GIT_DISCOVERY_ACROSS_FILESYSTEM=1');
```

This goes in the Docker/Podman branch of `start_sandbox()` (NOT in the
sandbox-exec branch), after the passthrough env vars and before the
VIRTUAL_ENV handling.

### Required Code Markers
```typescript
// @plan:PLAN-20260211-SANDBOX1036.P04
// @requirement:R1.1, R1.2, R2.1
```

## Verification Commands
```bash
# Fix 1: Old string gone
grep "gemini-cli-dev@google.com" packages/cli/src/utils/sandbox.ts
# Expected: No matches

# Fix 1: New string present
grep "vybestack/llxprt-code/discussions" packages/cli/src/utils/sandbox.ts
# Expected: One match

# Fix 2: Env var present
grep "GIT_DISCOVERY_ACROSS_FILESYSTEM" packages/cli/src/utils/sandbox.ts
# Expected: One match

# All tests pass (P03 tests now GREEN)
npm run test --workspace=packages/cli -- --run sandbox.test
# Expected: All pass

# Full verification cycle
npm run typecheck && npm run lint && npm run format --check
# Expected: All pass

# No deferred work
grep -n "TODO\|FIXME\|HACK\|STUB" packages/cli/src/utils/sandbox.ts
# Expected: No new matches (existing ones are fine)
```

## Semantic Verification Checklist

1. **Does the code DO what the requirement says?**
   - [ ] R1.1: Error message now shows discussions URL
   - [ ] R1.2: No reference to gemini-cli-dev@google.com remains
   - [ ] R2.1: GIT_DISCOVERY env var pushed into every container's args

2. **Is this REAL implementation, not placeholder?**
   - [ ] Actual string replacement done (not TODO)
   - [ ] Actual args.push() call added (not commented out)

3. **Would the tests FAIL if implementation was removed?**
   - [ ] R1 tests check for specific string content
   - [ ] R2 tests verify env var presence

## Success Criteria
- All P03 tests pass
- All existing tests still pass
- `gemini-cli-dev@google.com` does not appear in sandbox.ts
- `GIT_DISCOVERY_ACROSS_FILESYSTEM=1` appears in sandbox.ts

## Failure Recovery
```bash
git checkout -- packages/cli/src/utils/sandbox.ts
```
