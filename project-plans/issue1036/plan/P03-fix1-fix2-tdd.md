# Phase 03: Fix 1+2 TDD — Error Message and Git Discovery

## Phase ID
`PLAN-20260211-SANDBOX1036.P03`

## Prerequisites
- Required: Phase P02 completed (pseudocode written)
- Verification: `ls project-plans/issue1036/analysis/pseudocode/sandbox-changes.md`

## Requirements Implemented (Expanded)

### R1.1: Stale Error Message
**Full Text**: When the sandbox image is missing or cannot be pulled, the
sandbox launcher shall display `https://github.com/vybestack/llxprt-code/discussions`
as the support destination in the error message.
**Behavior**:
- GIVEN: Sandbox image pull fails
- WHEN: FatalSandboxError is thrown
- THEN: Error message contains the discussions URL, NOT gemini-cli-dev@google.com

### R1.2: No Upstream Reference
**Full Text**: If the sandbox image cannot be pulled, the sandbox launcher
shall not display any reference to `gemini-cli-dev@google.com`.
**Behavior**:
- GIVEN: Any error path in sandbox image handling
- WHEN: Error is thrown
- THEN: No reference to gemini-cli-dev@google.com anywhere in the file

### R2.1: Git Discovery Env Var
**Full Text**: The sandbox launcher shall set `GIT_DISCOVERY_ACROSS_FILESYSTEM=1`
inside every Docker and Podman container, regardless of host platform or engine.
**Behavior**:
- GIVEN: A Docker or Podman sandbox is being launched
- WHEN: Container args are constructed
- THEN: Args include `--env GIT_DISCOVERY_ACROSS_FILESYSTEM=1`

## Implementation Tasks

### Files to Modify
- `packages/cli/src/utils/sandbox.test.ts`
  - ADD: Test suite for error message content (R1)
  - ADD: Test suite for GIT_DISCOVERY env var (R2)

### Test Specifications

#### R1 Tests — Error Message Branding
```typescript
describe('sandbox error message branding', () => {
  it('image-pull failure message contains discussions URL', () => {
    // Read sandbox.ts source, find the FatalSandboxError string for image pull
    // Verify it contains 'https://github.com/vybestack/llxprt-code/discussions'
  });

  it('image-pull failure message does not contain gemini-cli-dev@google.com', () => {
    // Read sandbox.ts source or grep for the old string
    // Verify it does NOT appear anywhere in the file
  });
});
```

Note: These tests verify the SOURCE CODE content since the error path requires
a real Docker/Podman daemon and is not easily unit-testable. This is a valid
behavioral test — the behavior is "what message does the user see."

#### R2 Tests — Git Discovery Env Var
Since `start_sandbox` is a complex function that spawns real containers, and
the env var addition is inside the arg construction, the most practical test
approach is to verify the behavior through exported helper functions or by
testing the constructed args array.

The implementation phase (P04) will extract a small helper or we test by
reading the source. The TDD approach here: write tests that assert the env
var is present in the constructed args. If the code isn't structured for that
yet, tests will fail (RED) and P04 makes them pass (GREEN).

```typescript
describe('container environment variables', () => {
  it('GIT_DISCOVERY_ACROSS_FILESYSTEM=1 is set for all containers', () => {
    // Verify that the sandbox.ts source contains the env var push
    // or test via an extracted buildContainerArgs helper
  });
});
```

## Verification Commands
```bash
# Tests exist and are tagged
grep -r "@plan:PLAN-20260211-SANDBOX1036.P03" packages/cli/src/utils/sandbox.test.ts
# Expected: Multiple matches

# Tests fail (RED phase — implementation not done yet)
npm run test --workspace=packages/cli -- --run sandbox.test 2>&1 | tail -20
# Expected: New tests fail, existing tests still pass

# No mock theater
grep -r "toHaveBeenCalled" packages/cli/src/utils/sandbox.test.ts
# Expected: No matches in new tests
```

## Success Criteria
- New test cases exist for R1.1, R1.2, R2.1
- New tests fail (implementation not yet changed)
- Existing tests still pass
- No mock verification patterns

## Failure Recovery
```bash
git checkout -- packages/cli/src/utils/sandbox.test.ts
```
