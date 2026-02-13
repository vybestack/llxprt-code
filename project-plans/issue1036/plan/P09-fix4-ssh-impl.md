# Phase 09: Fix 4 SSH Implementation — Helper Functions

## Phase ID
`PLAN-20260211-SANDBOX1036.P09`

## Prerequisites
- Required: Phase P08 completed (SSH TDD tests exist and fail)
- Verification: `grep -r "@plan:PLAN-20260211-SANDBOX1036.P08" packages/cli/src/utils/sandbox.test.ts`

## Requirements Implemented
- R4.1, R4.2, R4.3, R4.4, R5.1, R5.2, R6.1, R6.2, R7.1, R7.2, R7.3, R7.4,
  R7.5, R7.6, R7.7, R7.8, R7.9, R7.10, R7.11

## Implementation Tasks

### Files to Modify
- `packages/cli/src/utils/sandbox.ts`

### Function Implementations (reference pseudocode Section D)

#### setupSshAgentForwarding (pseudocode D.1, lines 30-45)
Replace the `NotYetImplemented` stub with the platform router:
- Read SSH agent setting from env vars
- Apply existing opt-in/opt-out logic (R4.1, R4.4)
- Check SSH_AUTH_SOCK (R4.2)
- Route to platform-specific helper based on `os.platform()` and
  `config.command`
- Return `SshAgentResult`

#### setupSshAgentLinux (pseudocode D.2, lines 50-55)
- Mount host SSH_AUTH_SOCK at `/ssh-agent`
- Add `:z` SELinux flag for Podman on Linux (R5.2)
- Push `SSH_AUTH_SOCK=/ssh-agent` env var (R4.3)

#### setupSshAgentDockerMacOS (pseudocode D.3, lines 60-69)
- Check for Docker Desktop via `execSync('docker info --format ...')`
- Verify magic socket via `execSync('docker run --rm ...')`
- If both pass: mount and set env var (R6.1)
- If either fails: warn and return (R6.2)
- Wrap in try/catch — failures are warnings, not fatal

#### getPodmanMachineConnection (pseudocode D.4, lines 71-77)
- Run `podman system connection list --format json`
- Parse JSON (throw FatalSandboxError on parse failure with guidance)
- Find default connection, or sole connection if exactly one
- Throw FatalSandboxError with guidance if no viable connection
- Return { host, port, user, identityPath }

#### setupSshAgentPodmanMacOS (pseudocode D.4, lines 70-89)
- Call `getPodmanMachineConnection()`
- Remove stale socket via `podman machine ssh` (R7.3)
- Spawn SSH reverse tunnel process (R7.1)
- Poll for socket existence with timeout (R7.4)
- On timeout: kill tunnel, throw FatalSandboxError (R7.8)
- On success: push volume mount and env var (R7.5)
- Create cleanup function (R7.9, R7.10, R7.11):
  - Kill tunnel process (best-effort)
  - Remove socket from VM (best-effort, no throw)
  - Idempotent (guard against double-call)
- Return { tunnelProcess, cleanup }

### Implementation Pattern to Follow
The tunnel process management should follow the EXISTING proxy process pattern
in `start_sandbox()` (lines ~940-984):
- Spawn background process
- Install exit/SIGINT/SIGTERM handlers for cleanup
- stderr forwarding for debugging
- Wait for readiness before continuing

### Required Code Markers
```typescript
// @plan:PLAN-20260211-SANDBOX1036.P09
// @requirement:R4-R7
```

## Verification Commands
```bash
# All P08 tests pass (GREEN)
npm run test --workspace=packages/cli -- --run sandbox.test
# Expected: All pass

# No NotYetImplemented remains in SSH functions
grep "NotYetImplemented" packages/cli/src/utils/sandbox.ts
# Expected: No matches

# Typecheck passes
npm run typecheck
# Expected: Pass

# No deferred work
grep -n "TODO\|FIXME\|HACK\|STUB\|for now\|placeholder" packages/cli/src/utils/sandbox.ts | grep -iv "existing\|upstream"
# Expected: No new matches

# Lint passes
npm run lint
# Expected: Pass
```

## Semantic Verification Checklist

1. **Does the code DO what each requirement says?**
   - [ ] R4.1: Off setting disables forwarding
   - [ ] R4.2: Missing SSH_AUTH_SOCK warns and skips
   - [ ] R4.3: SSH_AUTH_SOCK=/ssh-agent set on success
   - [ ] R4.4: on/off/auto semantics preserved
   - [ ] R5.1: Linux Docker direct mount works
   - [ ] R5.2: Linux Podman :z flag applied
   - [ ] R6.1: Docker Desktop magic socket used
   - [ ] R6.2: Non-Desktop Docker warns gracefully
   - [ ] R7.1: SSH tunnel spawned for Podman macOS
   - [ ] R7.2: Connection parsing with default/fallback/error
   - [ ] R7.3: Stale socket removed before tunnel
   - [ ] R7.4: Socket existence polled with timeout
   - [ ] R7.5: VM socket mounted into container
   - [ ] R7.6: Parse failures throw FatalSandboxError with guidance
   - [ ] R7.7: Tunnel start failure throws FatalSandboxError with guidance
   - [ ] R7.8: Poll timeout kills tunnel and throws
   - [ ] R7.9: Cleanup on exit/signals
   - [ ] R7.10: Idempotent cleanup
   - [ ] R7.11: Socket removal best-effort on exit

2. **Is the feature INTEGRATED?**
   - [ ] Functions exist but are NOT YET wired into start_sandbox (that's P10)
   - [ ] All helpers are exported for testability

## Success Criteria
- All P08 tests pass
- All existing tests still pass
- No `NotYetImplemented` in SSH helper functions
- Typecheck and lint pass
- Helper functions exported but not yet integrated into start_sandbox

## Failure Recovery
```bash
git checkout -- packages/cli/src/utils/sandbox.ts
```
