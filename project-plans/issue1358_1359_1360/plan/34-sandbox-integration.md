# Phase 34: sandbox.ts Integration

## Phase ID
`PLAN-20250214-CREDPROXY.P34`

## Prerequisites
- Required: Phase 33a completed
- Verification: `grep -r "@plan:PLAN-20250214-CREDPROXY.P33" packages/cli/src/`
- Expected: Factory functions wired, all consumer sites updated

## Requirements Implemented (Expanded)

### R25.1: Proxy Server Created Before Container
**Full Text**: When `start_sandbox()` is called, the `CredentialProxyServer` shall be created and begin listening BEFORE the container is spawned.
**Behavior**:
- GIVEN: User starts a Docker/Podman sandbox session
- WHEN: `start_sandbox()` runs in `sandbox.ts`
- THEN: `createAndStartProxy()` is called first, socket is bound and listening, THEN the container is spawned
**Why This Matters**: Inner process must connect to proxy immediately; if proxy isn't ready, startup fails.

### R25.1a: Proxy Creation Failure Aborts
**Full Text**: If `CredentialProxyServer` fails to create or bind the socket, `start_sandbox()` shall abort with an actionable error before spawning the container.
**Behavior**:
- GIVEN: Socket creation fails (permissions, path too long)
- WHEN: `start_sandbox()` calls `createAndStartProxy()`
- THEN: An actionable error is thrown and no container is spawned
**Why This Matters**: Prevents container from starting without credential access.

### R3.4: macOS Realpath for Socket
**Full Text**: On macOS, the socket path shall use `fs.realpathSync(os.tmpdir())`. The tmpdir volume mount in `sandbox.ts` shall also use the resolved path on both sides.
**Behavior**:
- GIVEN: Running on macOS where `/var` → `/private/var`
- WHEN: Socket path and volume mount are generated
- THEN: Both use the resolved realpath, ensuring the socket is accessible inside the container
**Why This Matters**: Without realpath, the socket path inside the container won't match the host path.

### R3.5: Socket in tmpdir (No Extra Mount)
**Full Text**: The socket file shall live within `os.tmpdir()`, which is already volume-mounted into containers. No additional volume mount shall be needed.
**Behavior**:
- GIVEN: `sandbox.ts` already mounts `os.tmpdir()` into the container
- WHEN: Socket is created in `{tmpdir}/llxprt-cred-{uid}/`
- THEN: Socket is accessible from inside the container without additional mounts
**Why This Matters**: Simplifies deployment — no new mount configuration required.

### R3.6: Env Var Passed to Container
**Full Text**: `LLXPRT_CREDENTIAL_SOCKET` shall be passed to the container via `--env` in docker/podman args.
**Behavior**:
- GIVEN: Proxy is started and socket path is known
- WHEN: Container args are constructed in `sandbox.ts`
- THEN: `--env LLXPRT_CREDENTIAL_SOCKET={socketPath}` is included
**Why This Matters**: Inner process uses this env var to detect proxy mode.

### R25.2–R25.3: Cleanup on Exit
**Full Text**: When the sandbox exits (normally, SIGINT, SIGTERM), the proxy shall be stopped and socket removed.
**Behavior**:
- GIVEN: Sandbox is running with proxy
- WHEN: Container exits or signal received
- THEN: `stopProxy()` is called, socket file removed, timers cancelled
**Why This Matters**: Prevents stale sockets and resource leaks.

### R26.2: Seatbelt Unaffected
**Full Text**: Seatbelt mode shall NOT set `LLXPRT_CREDENTIAL_SOCKET`. It runs on host with full keyring access.
**Behavior**:
- GIVEN: Running in seatbelt mode (macOS `sandbox-exec`)
- WHEN: Seatbelt sandbox starts
- THEN: No proxy is created, no env var is set, keyring access is direct
**Why This Matters**: Seatbelt doesn't need proxy — it has host access.

## Implementation Tasks

### Files to Modify (UPDATE existing files)
- `packages/cli/src/utils/sandbox.ts`
  - In `start_sandbox()` (Docker/Podman paths):
    - Call `createAndStartProxy(config)` BEFORE spawning the container
    - Add `--env LLXPRT_CREDENTIAL_SOCKET={socketPath}` to container args
    - Verify tmpdir volume mount uses realpath (R3.4) — may already be correct
    - Add cleanup: call `stopProxy()` in exit/signal handlers
  - In seatbelt path: do NOT create proxy or set env var (R26.2)
  - MUST include: `@plan:PLAN-20250214-CREDPROXY.P34`

### Files to Create
- `packages/cli/src/utils/__tests__/sandbox-proxy-integration.test.ts`
  - MUST include: `@plan:PLAN-20250214-CREDPROXY.P34`
  - Tests:
    - **Proxy started before container spawn**: verify `createAndStartProxy` called before docker/podman exec
    - **Socket path in env args**: verify `--env LLXPRT_CREDENTIAL_SOCKET=...` in container args
    - **Socket path uses realpath**: verify no `/var/` vs `/private/var/` mismatch on macOS
    - **Proxy creation failure aborts**: verify error thrown before container spawn attempt
    - **Cleanup on exit**: verify `stopProxy()` called on container exit
    - **Seatbelt mode — no proxy**: verify proxy NOT created for seatbelt mode
    - **Socket in tmpdir — no extra mount**: verify no new volume mount added for socket

### Required Code Markers
```typescript
/**
 * @plan PLAN-20250214-CREDPROXY.P34
 * @requirement R3.4, R3.5, R3.6, R25.1, R25.1a, R25.2, R25.3, R26.2
 */
```

## Verification Commands

```bash
# Verify sandbox.ts imports proxy lifecycle
grep -n "createAndStartProxy\|stopProxy" packages/cli/src/utils/sandbox.ts
# Expected: matches present

# Verify env var injection
grep -n "LLXPRT_CREDENTIAL_SOCKET" packages/cli/src/utils/sandbox.ts
# Expected: match in container args section

# Verify seatbelt is unaffected
# Seatbelt code path should NOT reference proxy lifecycle

npm test -- packages/cli/src/utils/__tests__/sandbox-proxy-integration.test.ts
npm run typecheck
```

### Deferred Implementation Detection
```bash
grep -rn -E "(TODO|FIXME|HACK|STUB|XXX|TEMPORARY)" packages/cli/src/utils/sandbox.ts | grep -v ".test.ts"
```

## Success Criteria
- `sandbox.ts` creates proxy before container spawn
- `LLXPRT_CREDENTIAL_SOCKET` env var passed to container
- Socket path uses realpath on macOS
- Cleanup happens on all exit paths
- Seatbelt mode completely unaffected
- All tests pass
- TypeScript compiles cleanly

## Failure Recovery
1. `git checkout -- packages/cli/src/utils/sandbox.ts`
2. Re-read overview.md §3 (Credential Lifecycle — Startup) and requirements R3, R25

## Phase Completion Marker
Create: `project-plans/issue1358_1359_1360/.completed/P34.md`
