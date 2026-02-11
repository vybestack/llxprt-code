# Phase 08: Fix 4 SSH TDD — Platform-Aware SSH Agent Tests

## Phase ID
`PLAN-20260211-SANDBOX1036.P08`

## Prerequisites
- Required: Phase P07 completed (SSH stubs exist and compile)
- Verification: `grep -r "@plan:PLAN-20260211-SANDBOX1036.P07" packages/cli/src/utils/sandbox.ts`

## Requirements Implemented (Expanded)

### R4.1: SSH Agent Off Disables Forwarding
**Behavior**: GIVEN LLXPRT_SANDBOX_SSH_AGENT=off, WHEN setupSshAgentForwarding called, THEN returns empty result, args unchanged.

### R4.2: Missing SSH_AUTH_SOCK Warns and Skips
**Behavior**: GIVEN SSH_AUTH_SOCK not set and not explicitly disabled, WHEN setupSshAgentForwarding called, THEN warns and returns empty result.

### R4.3: SSH_AUTH_SOCK Set in Container
**Behavior**: GIVEN SSH forwarding succeeds, WHEN args inspected, THEN contains `--env SSH_AUTH_SOCK=/ssh-agent`.

### R4.4: Existing Opt-In/Opt-Out Preserved
**Behavior**: GIVEN LLXPRT_SANDBOX_SSH_AGENT=on, WHEN SSH_AUTH_SOCK not set, THEN still attempts forwarding. GIVEN =off, THEN skips.

### R5.1: Linux Docker Direct Mount
**Behavior**: GIVEN linux + docker, WHEN setupSshAgentLinux called, THEN args contain `--volume /path/to/sock:/ssh-agent`.

### R5.2: Linux Podman SELinux Flag
**Behavior**: GIVEN linux + podman, WHEN setupSshAgentLinux called, THEN mount spec ends with `:z`.

### R6.1: Docker Desktop macOS Magic Socket
**Behavior**: GIVEN darwin + docker + Desktop detected + socket exists, WHEN setupSshAgentDockerMacOS called, THEN args contain `/run/host-services/ssh-auth.sock:/ssh-agent`.

### R6.2: Non-Desktop Docker macOS Warns
**Behavior**: GIVEN darwin + docker + NOT Desktop, WHEN setupSshAgentDockerMacOS called, THEN warns, args unchanged.

### R7.2: Podman Connection Parsing
**Behavior**: GIVEN valid JSON from `podman system connection list`, WHEN getPodmanMachineConnection called, THEN returns parsed host/port/user/identity.

### R7.2 fallback: Single non-default connection
**Behavior**: GIVEN one connection not marked default, WHEN getPodmanMachineConnection called, THEN uses that connection.

### R7.2 error: No connections
**Behavior**: GIVEN empty connection list, WHEN getPodmanMachineConnection called, THEN throws FatalSandboxError with remediation guidance.

### R7.1: SSH Reverse Tunnel Establishment
**Behavior**: GIVEN darwin + podman + SSH_AUTH_SOCK set, WHEN setupSshAgentPodmanMacOS is called, THEN it spawns an ssh process with `-R` reverse tunnel arguments mapping the host SSH_AUTH_SOCK to a socket inside the VM.

### R7.3: Remove Stale Socket Before Tunnel
**Behavior**: GIVEN a Podman macOS setup, WHEN setupSshAgentPodmanMacOS is called, THEN it executes a podman machine ssh rm command to remove any stale socket BEFORE spawning the tunnel process.

### R7.4: Poll for Socket with Timeout
**Behavior**: GIVEN the SSH tunnel has been spawned, WHEN waiting for the forwarded socket, THEN setupSshAgentPodmanMacOS polls for socket existence with a timeout rather than using a fixed sleep.

### R7.5: Mount VM Socket on Success
**Behavior**: GIVEN the SSH tunnel is established and socket is detected, WHEN args are inspected, THEN args contain `--volume` for the VM socket and `--env SSH_AUTH_SOCK=/ssh-agent`.

### R7.6: Malformed JSON
**Behavior**: GIVEN invalid JSON from podman, WHEN getPodmanMachineConnection called, THEN throws FatalSandboxError with remediation guidance.

### R7.7: Tunnel Start Failure
**Behavior**: GIVEN the SSH tunnel process fails to start (spawn error), WHEN setupSshAgentPodmanMacOS is called, THEN it throws FatalSandboxError with actionable remediation text.

### R7.8: Poll Timeout Kills Tunnel
**Behavior**: GIVEN the forwarded socket never appears within the polling timeout, WHEN setupSshAgentPodmanMacOS is called, THEN it kills the tunnel process and throws FatalSandboxError with remediation guidance.

### R7.9: Cleanup Kills Tunnel Process
**Behavior**: GIVEN a tunnel was established, WHEN the cleanup function is called, THEN it kills the SSH tunnel process.

### R7.10: Idempotent Cleanup
**Behavior**: GIVEN the cleanup function has already been called once, WHEN it is called again, THEN it does not throw or cause errors.

### R7.11: Cleanup Removes Socket Best-Effort
**Behavior**: GIVEN a tunnel was established and cleanup is invoked, WHEN the cleanup function runs, THEN it attempts to remove the socket from the VM without throwing on failure.

## Implementation Tasks

### Files to Modify
- `packages/cli/src/utils/sandbox.test.ts`
  - ADD: Comprehensive test suites for all SSH helper functions

### Test Strategy

Tests will need to mock:
- `process.env` (for SSH_AUTH_SOCK, LLXPRT_SANDBOX_SSH_AGENT)
- `os.platform()` (for linux/darwin branching)
- `fs.existsSync()` (for socket file checks)
- `child_process.execSync` (for docker info, podman connection list, podman machine ssh)
- `child_process.spawn` (for SSH tunnel process in setupSshAgentPodmanMacOS)

These are INFRASTRUCTURE mocks (controlling the environment), not BEHAVIOR
mocks (verifying call patterns). The tests verify OUTPUTS (args array content,
return values, thrown errors) not mock interactions.

### Test Suites to Create

```typescript
describe('setupSshAgentForwarding @plan:PLAN-20260211-SANDBOX1036.P08', () => {
  // R4.1: Off disables
  // R4.2: Missing sock warns
  // R4.3: SSH_AUTH_SOCK set in container
  // R4.4: Opt-in/opt-out preserved
  // Platform routing (linux → setupSshAgentLinux, darwin+docker → DockerMacOS, etc.)
});

describe('setupSshAgentLinux @plan:PLAN-20260211-SANDBOX1036.P08', () => {
  // R5.1: Direct mount for docker
  // R5.2: :z flag for podman on linux
  // Verify --env SSH_AUTH_SOCK=/ssh-agent
});

describe('setupSshAgentDockerMacOS @plan:PLAN-20260211-SANDBOX1036.P08', () => {
  // R6.1: Magic socket mounted when Desktop detected
  // R6.2: Warning when not Desktop
  // Verify --env SSH_AUTH_SOCK=/ssh-agent on success
});

describe('getPodmanMachineConnection @plan:PLAN-20260211-SANDBOX1036.P08', () => {
  // R7.2: Parses default connection
  // R7.2: Falls back to sole connection
  // R7.2: Throws on no connections
  // R7.2: Throws on multiple non-default connections
  // R7.6: Throws on malformed JSON
  // All errors include remediation guidance
});

describe('setupSshAgentPodmanMacOS @plan:PLAN-20260211-SANDBOX1036.P08', () => {
  // R7.1: SSH reverse tunnel establishment
  it('establishes SSH reverse tunnel from host SSH_AUTH_SOCK to VM socket @requirement:R7.1', () => {
    // Mock getPodmanMachineConnection to return valid connection
    // Mock spawn
    // Mock poll to succeed
    // Call setupSshAgentPodmanMacOS(args, '/tmp/host-auth.sock')
    // Verify spawn was called with ssh -R arguments
    // Verify the -R argument maps VM_SOCKET_PATH to host SSH_AUTH_SOCK
  });

  // R7.3: Stale socket removal before tunnel
  it('removes stale socket before spawning tunnel @requirement:R7.3', () => {
    // Mock execSync for podman machine ssh rm command
    // Mock spawn for tunnel process
    // Mock poll to succeed immediately
    // Verify execSync rm call occurs before spawn call
  });

  // R7.4: Polling with timeout
  it('polls for socket existence with timeout rather than fixed sleep @requirement:R7.4', () => {
    // Mock spawn to succeed
    // Mock podman machine ssh "test -S" to fail N times then succeed
    // Verify polling loop behavior (multiple calls to test -S)
  });

  // R7.5: Mount VM socket on success
  it('mounts VM socket and sets SSH_AUTH_SOCK on success @requirement:R7.5', () => {
    // Mock spawn to succeed, poll to succeed
    // Call setupSshAgentPodmanMacOS(args, '/tmp/auth.sock')
    // Verify args contain --volume with VM socket path
    // Verify args contain --env SSH_AUTH_SOCK=/ssh-agent
  });

  // R7.7: Tunnel start failure
  it('throws FatalSandboxError when tunnel process fails to start @requirement:R7.7', () => {
    // Mock spawn to emit 'error' event
    // Verify FatalSandboxError is thrown with remediation text
  });

  // R7.8: Poll timeout
  it('kills tunnel and throws FatalSandboxError on poll timeout @requirement:R7.8', () => {
    // Mock spawn to succeed
    // Mock poll to never succeed (always fail)
    // Verify tunnel process is killed
    // Verify FatalSandboxError is thrown with remediation text
  });

  // R7.9: Cleanup kills tunnel
  it('returns cleanup function that kills tunnel process @requirement:R7.9', () => {
    // Mock spawn/poll to succeed (setup completes)
    // Get the returned SshAgentResult
    // Call result.cleanup()
    // Verify the tunnel process's kill() method was called
  });

  // R7.10: Idempotent cleanup
  it('cleanup is idempotent - multiple calls do not throw @requirement:R7.10', () => {
    // Mock spawn/poll to succeed (setup completes)
    // Get the returned SshAgentResult
    // Call result.cleanup() twice
    // Verify no error is thrown on either call
  });

  // R7.11: Cleanup socket removal
  it('attempts socket removal on cleanup without throwing @requirement:R7.11', () => {
    // Mock spawn/poll to succeed (setup completes)
    // Call the returned cleanup function
    // Verify podman machine ssh rm is called (best-effort)
    // Mock rm to throw — verify cleanup does NOT throw
  });
});
```

## Verification Commands
```bash
# Tests exist
grep -c "@plan:PLAN-20260211-SANDBOX1036.P08" packages/cli/src/utils/sandbox.test.ts
# Expected: 20+ matches

# Tests fail (stubs throw NotYetImplemented)
npm run test --workspace=packages/cli -- --run sandbox.test 2>&1 | grep "FAIL\|Error"
# Expected: New tests fail

# No mock theater (no toHaveBeenCalled on business logic)
grep "toHaveBeenCalled" packages/cli/src/utils/sandbox.test.ts | grep -v "execSync\|existsSync\|warn\|error"
# Expected: No matches

# Behavioral assertions present
grep -c "toEqual\|toBe\|toContain\|toThrow\|toMatch" packages/cli/src/utils/sandbox.test.ts
# Expected: 20+ matches
```

## Success Criteria
- 20+ behavioral tests covering R4–R7 (including setupSshAgentPodmanMacOS)
- Tests fail because stubs throw NotYetImplemented
- Existing tests still pass
- No mock theater patterns

## Failure Recovery
```bash
git checkout -- packages/cli/src/utils/sandbox.test.ts
```
