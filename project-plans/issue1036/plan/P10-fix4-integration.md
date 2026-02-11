# Phase 10: Fix 4 Integration — Wire SSH Helpers into start_sandbox

## Phase ID
`PLAN-20260211-SANDBOX1036.P10`

## Prerequisites
- Required: Phase P09 completed (SSH helpers implemented and tested)
- Verification: `grep -r "@plan:PLAN-20260211-SANDBOX1036.P09" packages/cli/src/utils/sandbox.ts`

## Requirements Implemented
- R4–R7 integration into the actual sandbox launch flow
- R7.9: Cleanup on sandbox exit (integration of cleanup handlers)
- R7.10: Idempotent cleanup under signal races

## Purpose
Replace the existing SSH agent section in `start_sandbox()` with a call to
the new `setupSshAgentForwarding()` router, and wire the tunnel cleanup into
the existing process lifecycle handlers.

## Implementation Tasks

### Files to Modify
- `packages/cli/src/utils/sandbox.ts`

### Changes to start_sandbox()

#### 1. Remove Old SSH Agent Section
The existing SSH agent code (approximately lines 670-710 in the Docker/Podman
branch) handles SSH_AUTH_SOCK directly with platform-specific checks inline.
This entire block is replaced by a single call.

**Remove**: The block from `const sshAgentSetting =` through the closing
brace of the SSH agent `if` block (approximately 40 lines).

**Replace with**:
```typescript
// @plan:PLAN-20260211-SANDBOX1036.P10
// @requirement:R4, R5, R6, R7
const sshResult = await setupSshAgentForwarding(config, args);
```

#### 2. Wire Cleanup Handlers
If `sshResult.cleanup` exists, register it alongside the existing proxy
cleanup handlers. Follow the same pattern as the proxy process cleanup
(lines ~940-984):

```typescript
if (sshResult.cleanup) {
  const stopTunnel = sshResult.cleanup;
  process.on('exit', stopTunnel);
  process.on('SIGINT', stopTunnel);
  process.on('SIGTERM', stopTunnel);

  // Also clean up when sandbox process exits
  sandboxProcess.on('close', stopTunnel);
}
```

This ensures R7.9 (cleanup on exit/signals) and R7.10 (idempotent cleanup)
are integrated into the actual sandbox lifecycle.

#### 3. Preserve sandbox-exec Path
The sandbox-exec (seatbelt) branch of `start_sandbox()` must NOT be modified.
SSH agent forwarding changes only apply to the Docker/Podman branch.

### Integration Tests
Add behavioral tests verifying the wiring between start_sandbox and the SSH
helpers, plus cleanup handler registration:

```typescript
describe('start_sandbox SSH integration @plan:PLAN-20260211-SANDBOX1036.P10', () => {
  it('old inline SSH agent code is removed from start_sandbox', () => {
    // Read sandbox.ts source
    // Verify no "Podman on macOS may not access launchd" warning string
    // (that was in the old inline code)
  });

  it('setupSshAgentForwarding is called with config and args @requirement:R4.3', () => {
    // Mock setupSshAgentForwarding to capture its arguments
    // Trigger start_sandbox with a Docker config
    // Verify setupSshAgentForwarding was called with the correct config object
    //   and the args array being constructed
  });

  it('registers cleanup handlers when setupSshAgentForwarding returns cleanup @requirement:R7.9', () => {
    // Mock setupSshAgentForwarding to return { cleanup: mockFn }
    // Mock process.on to capture registered handlers
    // Trigger start_sandbox
    // Verify process.on was called with 'exit', 'SIGINT', 'SIGTERM'
    //   using the cleanup function
  });

  it('does not register cleanup handlers when no tunnel is needed @requirement:R4.1', () => {
    // Mock setupSshAgentForwarding to return {} (no cleanup)
    // Trigger start_sandbox
    // Verify NO extra process.on calls for tunnel cleanup
  });

  it('cleanup handler is idempotent under concurrent signals @requirement:R7.10', () => {
    // Mock setupSshAgentForwarding to return { cleanup: realCleanupFn }
    // Simulate rapid exit + SIGINT + SIGTERM
    // Verify cleanup runs only once (idempotent guard)
  });
});
```

## Verification Commands
```bash
# Old inline SSH code removed
grep "Podman on macOS may not access launchd" packages/cli/src/utils/sandbox.ts
# Expected: No matches (old warning removed)

# New integration present
grep "setupSshAgentForwarding" packages/cli/src/utils/sandbox.ts | grep -v "export\|function\|import\|//"
# Expected: At least one call site in start_sandbox

# Cleanup wired
grep "sshResult.cleanup\|stopTunnel" packages/cli/src/utils/sandbox.ts
# Expected: Matches showing cleanup registration

# All tests pass
npm run test --workspace=packages/cli -- --run sandbox.test
# Expected: All pass

# Full verification cycle
npm run typecheck && npm run lint && npm run format --check && npm run build
# Expected: All pass

# No deferred work
grep -rn "TODO\|FIXME\|HACK\|STUB\|for now" packages/cli/src/utils/sandbox.ts | grep -v "upstream\|existing"
# Expected: No new matches
```

## Semantic Verification Checklist

1. **Does the code DO what the requirements say?**
   - [ ] Old inline SSH code completely removed
   - [ ] `setupSshAgentForwarding()` called in Docker/Podman branch
   - [ ] Cleanup handlers registered for tunnel process
   - [ ] sandbox-exec branch unmodified

2. **Is the feature REACHABLE by users?**
   - [ ] User runs `LLXPRT_SANDBOX=podman llxprt` → hits start_sandbox →
         calls setupSshAgentForwarding → routes to platform helper
   - [ ] The entire chain from CLI to SSH helper is connected

3. **What could go wrong?**
   - [ ] Cleanup handler order (SSH cleanup before or after proxy cleanup?)
   - [ ] Async setupSshAgentForwarding in an already-async start_sandbox
   - [ ] Error propagation from SSH helpers to start_sandbox caller

## Success Criteria
- Old inline SSH agent code completely removed from start_sandbox
- `setupSshAgentForwarding` called in its place
- Cleanup handlers wired into process lifecycle
- All tests pass (unit + integration)
- Full build passes

## Failure Recovery
```bash
git checkout -- packages/cli/src/utils/sandbox.ts
```
