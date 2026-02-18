# Phase 38: Platform Test Matrix

## Phase ID
`PLAN-20250214-CREDPROXY.P38`

## Prerequisites
- Required: Phase 37a completed
- Verification: `grep -r "@plan:PLAN-20250214-CREDPROXY.P37" packages/cli/src/auth/proxy/__tests__/`
- Expected: All E2E tests passing, full feature integrated

## Requirements Implemented (Expanded)

### R27.1: Docker and Podman Support
**Full Text**: The credential proxy shall work with both Docker and Podman sandbox modes.
**Behavior**:
- GIVEN: User starts sandbox with Docker
- WHEN: Credential proxy is created
- THEN: Socket works correctly inside Docker container
- AND: Same behavior with Podman
**Why This Matters**: Both container runtimes must be supported for user flexibility.

### R27.2: macOS Docker Desktop UDS Verification
**Full Text**: Unix domain sockets mounted across Docker Desktop macOS VM boundary (VirtioFS) shall be tested before merge. If UDS does not traverse the boundary, a fallback transport shall be designed.
**Behavior**:
- GIVEN: macOS with Docker Desktop using VirtioFS
- WHEN: Unix socket is volume-mounted into container
- THEN: Socket communication works across the VM boundary
- OR: A documented fallback is implemented
**Why This Matters**: Decision gate — macOS Docker Desktop is a primary user platform.

### R27.3: Full Platform Matrix
**Full Text**: The proxy shall work on Linux (Docker, Podman) and macOS (Docker Desktop, Podman machine).
**Behavior**:
- GIVEN: The platform test matrix defined in issue #1358
- WHEN: Tests are run on each platform
- THEN: All must pass or have documented fallbacks
**Why This Matters**: Users run on diverse platforms; all must work.

### R4.1–R4.3: Peer Credential Verification per Platform
**Behavior**:
- GIVEN: Linux — `SO_PEERCRED` available
- THEN: Peer UID verified as security gate
- GIVEN: macOS — `LOCAL_PEERPID` available
- THEN: Peer PID verified as best-effort logging
- GIVEN: Neither available
- THEN: Warning logged, socket perms + nonce are primary defense

## Implementation Tasks

### Platform Test Matrix

| Platform | Container Runtime | UDS Status | Gate | Test |
|---|---|---|---|---|
| Linux | Docker | Native UDS | Must pass | CI + manual |
| Linux | Podman | Native UDS | Must pass | CI + manual |
| macOS | Docker Desktop (VirtioFS) | UDS across VM boundary | Must pass OR fallback | Manual |
| macOS | Podman (podman machine) | UDS across VM boundary | Must pass OR fallback | Manual |

### Files to Create
- `packages/cli/src/auth/proxy/__tests__/platform-matrix.test.ts`
  - MUST include: `@plan:PLAN-20250214-CREDPROXY.P38`
  - Platform-conditional tests:
    - **Unix socket creation**: socket created with correct permissions (`0o600`)
    - **Subdirectory permissions**: per-user dir created with `0o700`
    - **Realpath resolution**: macOS `/var` → `/private/var` resolved correctly
    - **Peer credential verification — Linux**: `SO_PEERCRED` returns correct UID
    - **Peer credential verification — macOS**: `LOCAL_PEERPID` returns PID (best-effort)
    - **Peer credential verification — fallback**: warning logged when neither available
    - **Socket path length**: path fits within platform socket path limits (~104 chars on macOS)
    - **Stale socket cleanup**: existing socket at path removed before binding
    - **Concurrent socket operations**: multiple requests over single socket handled

- `packages/cli/src/auth/proxy/__tests__/platform-uds-probe.test.ts`
  - MUST include: `@plan:PLAN-20250214-CREDPROXY.P38`
  - Probe tests for Docker Desktop macOS UDS behavior:
    - **UDS round-trip through tmpdir**: create socket in tmpdir, connect, send/receive frame
    - **UDS cross-container simulation**: if running in CI with Docker, create socket on host, connect from subprocess
    - **Socket accessible after realpath**: socket created at realpath, accessible at both symlink and realpath

### Manual Test Protocol (documented, not automated)
Document manual test steps for each platform combination:

1. **Linux Docker**: `npm run test:e2e` inside Docker container, verify socket communication
2. **Linux Podman**: same with Podman
3. **macOS Docker Desktop**: start sandbox, verify `/auth login` works, verify `getToken` returns sanitized token
4. **macOS Podman**: same with Podman machine

### Required Code Markers
```typescript
/**
 * @plan PLAN-20250214-CREDPROXY.P38
 * @requirement R4.1, R4.2, R4.3, R27.1, R27.2, R27.3
 */
```

## Verification Commands

```bash
npm test -- packages/cli/src/auth/proxy/__tests__/platform-matrix.test.ts
npm test -- packages/cli/src/auth/proxy/__tests__/platform-uds-probe.test.ts
npm run typecheck
```

### Platform-Specific Checks
```bash
# Check platform capabilities
node -e "console.log('platform:', process.platform, 'uid:', process.getuid?.())"

# Verify socket path length on macOS (limit ~104 chars)
node -e "const os = require('os'); const fs = require('fs'); const p = fs.realpathSync(os.tmpdir()) + '/llxprt-cred-' + process.getuid() + '/llxprt-cred-99999-deadbeef.sock'; console.log('path length:', p.length, 'ok:', p.length < 104)"
```

## Success Criteria
- Platform-conditional tests pass on current platform
- Socket permissions verified (`0o600` file, `0o700` directory)
- Realpath resolution works on macOS
- Peer credential checks work (or fallback documented)
- Socket path length within limits
- UDS probe tests pass in tmpdir
- Manual test protocol documented for all 4 platform combinations

## Decision Gate
**Before merge, the following must be confirmed:**
- [ ] Linux Docker: UDS works natively → PASS
- [ ] Linux Podman: UDS works natively → PASS
- [ ] macOS Docker Desktop: UDS works across VirtioFS → PASS or FALLBACK designed
- [ ] macOS Podman: UDS works across VM → PASS or FALLBACK designed

If macOS UDS fails, document the fallback option chosen (TCP localhost with TLS, or SSH-style socket forwarding).

## Failure Recovery
1. `git checkout -- packages/cli/src/auth/proxy/__tests__/platform-*.test.ts`
2. If macOS UDS fails: create `39-fallback-transport.md` for fallback implementation

## Phase Completion Marker
Create: `project-plans/issue1358_1359_1360/.completed/P38.md`
