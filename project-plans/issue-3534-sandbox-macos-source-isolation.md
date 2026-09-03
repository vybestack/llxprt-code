# Plan: macOS Podman socket paths and source dependency isolation

Plan ID: PLAN-20260903-ISSUE3534
Generated: 2026-09-03
Issue: #3534

## Purpose

Fix two independent sandbox startup failures on macOS Podman. The host credential proxy must use a Unix socket path that fits Darwin's encoded `sun_path` limit even when the user's normal temporary directory is long. A source-development launch must execute checked-out TypeScript in Linux while all Linux dependencies live in private engine-owned volumes rather than the host checkout's macOS `node_modules` trees.

## Requirements

### REQ-3534-1: Short private credential socket runtime

**Full text:** A macOS Podman launch must create its host credential proxy socket in a private mode-0700 runtime directory whose resulting socket path is shorter than Darwin's 104-byte `sun_path` field. Startup must fail before OpenSSH if that invariant cannot be guaranteed.

**Behavior:**

- GIVEN the normal macOS temporary root is longer than the socket limit permits
- WHEN the Podman credential bridge starts
- THEN the credential proxy receives a short runtime directory independent of that normal temporary root
- AND the runtime directory has mode 0700
- AND the concrete socket path is at most 103 encoded bytes, leaving one byte for the terminator
- AND both the normal session directory and short socket directory are removed on success and failure

### REQ-3534-2: Actionable bounded OpenSSH diagnostics

**Full text:** If OpenSSH exits while a tunnel is stabilizing, the launch error must contain bounded stderr from that process and cleanup must not leave the process alive.

**Behavior:**

- GIVEN OpenSSH writes a concrete startup error and exits
- WHEN the tunnel startup wait observes the exit
- THEN the resulting `FatalSandboxError` includes the normalized stderr
- AND no more than the configured diagnostic bound is retained
- AND the failed child is terminated if still alive

### REQ-3534-3: Source-development dependency isolation

**Full text:** A checked-out LLxprt TypeScript source launch must continue to run inside Linux but may neither read nor mutate host-platform `node_modules`. Linux dependencies must be prepared deterministically from repository package metadata and the committed Bun lockfile in private engine-owned storage.

**Behavior:**

- GIVEN `NODE_ENV=development` and a positively identified LLxprt source checkout
- WHEN a Docker or Podman sandbox is prepared
- THEN every declared `node_modules` destination is overlaid by a fresh engine-owned volume
- AND the installed-mode host wrong-platform preflight is not applied to source mode
- AND the trusted entrypoint verifies `package.json` and `bun.lock`, runs `bun install --no-save` inside the isolated mounts, and only then executes `bun ./packages/cli/index.ts`
- AND installer failure stops before checked-out CLI execution with a source-specific message
- AND arbitrary projects and installed mode retain their existing command selection and preflight behavior

### REQ-3534-4: Real Podman proof and lifecycle cleanup

**Full text:** Real non-interactive Podman coverage must prove the branch launcher works with the default macOS temporary directory, Linux source dependencies do not affect host dependency files or `.bin` links, and success plus induced failure leave no issue-owned container, volume, temporary directory, or reverse SSH process.

## Preflight findings

- Branch `issue3534` starts clean at `7561710acc800d1c8cb4368ea07dff8fcbbd267b`.
- `prepareContainerImageAndArgs` creates the general session directory beneath `os.tmpdir()` and passes it to `setupCredentialProxy`.
- `CredentialProxyServer` generates `<pid>-<22 byte base64url nonce>.sock`, so a five-digit PID needs a 33-byte basename. Darwin permits 103 pathname bytes plus a terminator in `sun_path[104]`.
- `spawnAndWaitForTunnel` currently pipes stderr but discards it when the child exits during startup.
- `isSourceDevelopmentWorkdir` currently disables `planPrivateDependencyMounts`, while the same predicate chooses `bun ./packages/cli/index.ts`. This exposes host dependencies to Linux.
- The existing engine-owned volume lifecycle already handles creation, permissions, labels, attachment order, signal cleanup, and failure cleanup. Source mode should use that mechanism rather than introduce a second storage system.
- The root repository declares Bun metadata in `package.json` and commits `bun.lock`. Focused and real Podman RED evidence showed that plain `bun install` rewrites the host-mounted lockfile even when dependencies are isolated. Source preparation therefore uses `bun install --no-save`. `--frozen-lockfile` remains unusable for this monorepo because Bun attempts to normalize the committed lockfile and then rejects the change.
- Installed-mode wrong-platform preflight is implemented by `preflightProtectedTree` and must remain unchanged.
- Existing co-located Bun suites cover SSH tunnels, credential proxy lifecycle, source command selection, dependency mounts, and real engine isolation.

## Integration contracts

1. `prepareContainerSandbox` plans workspaces and dependency destinations before engine side effects.
2. `planPrivateDependencyMounts` identifies source mode with the shared source-development predicate, returns enabled private destinations, and skips host dependency preflight only when those host trees will be hidden.
3. `addPrivateDependencyMounts` creates and mounts fresh engine-owned volumes for both source and installed mode. Existing lifecycle ownership remains unchanged.
4. `entrypoint` uses the same source-development predicate. For source mode it inserts a trusted dependency preparation stanza before the final source CLI exec. Installed mode gets no preparation stanza.
5. `setupCredentialProxy` selects a short socket runtime only for Darwin Podman. Docker and non-Darwin paths remain unchanged.
6. The composed credential cleanup owns the bridge, capability file, normal session directory, and short socket directory.
7. `setupCredentialProxyPodmanMacOS` validates the concrete path before constructing `ssh -R`. Tunnel startup errors surface bounded child stderr.

## Numbered pseudocode

### Short socket runtime

1. IF platform is Darwin AND engine is Podman
2. SELECT the fixed short lexical runtime root `/tmp`, independent of `os.tmpdir()`
3. CREATE a unique `lx-` directory beneath that root
4. CHMOD the directory to 0700
5. CALCULATE the longest concrete credential socket pathname using the current PID and fixed nonce suffix width
6. IF encoded byte length exceeds 103, REMOVE the directory and THROW `FatalSandboxError`
7. RETURN socket runtime path plus idempotent removal callback
8. OTHERWISE use the existing session directory and no additional callback
9. START credential proxy with the selected runtime path
10. READ the concrete socket path
11. VALIDATE its encoded length before bridge setup
12. ON every failure, stop the proxy and run all directory cleanups
13. ON success, compose short runtime cleanup with existing cleanup ownership

### Bounded tunnel diagnostics

14. SPAWN OpenSSH with stdout and stderr pipes
15. DRAIN both streams for the full child lifetime while retaining at most 4096 encoded bytes from each
16. RACE the stabilization interval and readiness polling against process error, exit, and close
17. IF readiness or the child fails, abort polling, terminate the child, and await reaping with bounded SIGTERM and SIGKILL stages
18. BUILD failure detail from nonempty stderr, then stdout
19. THROW `FatalSandboxError` containing the existing guidance, exit state, and bounded detail
20. REMOVE data listeners only when the child closes

### Source dependency isolation

21. IDENTIFY source mode with `isSourceDevelopmentWorkdir`
22. RESOLVE the same protected dependency destinations used by installed mode
23. FOR installed mode, run the existing host wrong-platform preflight
24. FOR source mode, do not inspect host dependency contents because those trees will be hidden
25. RETURN an enabled private dependency plan for both modes
26. CREATE, initialize, label, mount, and lifecycle-own fresh volumes through the existing engine adapter
27. FOR source-development entrypoint, verify root `package.json`, root `bun.lock`, and Bun are present
28. RUN `bun install --no-save` in the mounted checkout before the source CLI
29. IF install fails, print a source-specific isolation error and exit without invoking the CLI
30. EXECUTE checked-out TypeScript only after preparation succeeds
31. FOR installed mode, retain the image-global `llxprt` command and no source installer

## Strict TDD phases

### Phase 1: Credential runtime RED

Extend `packages/cli/src/utils/sandbox-credential.test.ts` with behavioral cases that use a long simulated normal temporary root and the real filesystem. Assert the proxy receives a distinct short directory, that it is mode 0700, that the modeled concrete socket path fits 103 bytes, and that success and bridge failure remove both runtime directories. Run the file and save output to `tmp/issue3534/red-credential-runtime.log`. The new tests must fail before production edits.

### Phase 2: Credential runtime GREEN

Implement only the runtime selection, invariant validation, and cleanup ownership needed by Phase 1. Run the same file and save output to `tmp/issue3534/green-credential-runtime.log`.

### Phase 3: SSH diagnostics RED

Extend `packages/cli/src/utils/sandbox-ssh.test.ts` with a real child-process-style event stream that exits after writing OpenSSH stderr. Assert the error includes the concrete message, excludes data beyond the 4096-byte bound, and does not leave the child active. Add a direct over-limit socket path case that fails before `ssh -R`. Save failing output to `tmp/issue3534/red-ssh-diagnostics.log`.

### Phase 4: SSH diagnostics GREEN

Implement concrete socket path validation and bounded process output collection in `sandbox-podman.ts`. Preserve the existing successful tunnel and polling behavior. Save passing output to `tmp/issue3534/green-ssh-diagnostics.log`.

### Phase 5: Source isolation RED

Update `sandbox-source-development.test.ts`, `sandbox-node-modules.test.ts`, and `sandbox-entrypoint.test.ts`. Assert source mode receives real private engine volumes, host dependency trees remain untouched, source mode skips installed preflight, the generated shell prepares from `package.json` and `bun.lock` before invoking source, preparation failure prevents CLI invocation, and production or arbitrary repository behavior remains unchanged. Save failing output to `tmp/issue3534/red-source-isolation.log`.

### Phase 6: Source isolation GREEN

Remove the source bypass in dependency planning and add source preparation to the trusted entrypoint selected by the shared source predicate. Use `bun install --no-save` because focused RED evidence showed that plain install mutates the host-mounted lockfile and this repository's Bun lock cannot support frozen mode. Do not copy or bind host dependencies. Save passing output to `tmp/issue3534/green-source-isolation.log`.

### Phase 7: Real Podman integration

Extend `integration-tests/sandboxNodeModulesIsolation.real.test.ts` or the closest existing real sandbox suite. Use the production planner and branch launcher. Prove Linux/arm64, `/run/.containerenv`, source path selection, isolated native dependency loading, a dependency mutation in root and `.bin`, byte-identical host snapshots, and cleanup of named volumes and containers. Add induced preparation failure cleanup. Run with the exact available nightly image and save output under `tmp/issue3534/`.

### Phase 8: Audit and verification

Run the test-audit scanner against the clean main commit in an isolated worktree and against `issue3534`, write both outputs under `tmp/issue3534/`, diff findings, and inspect all new findings. Then run focused Bun tests and real Podman checks. Finally run, in order, `npm run test`, `npm run lint`, `npm run typecheck`, `npm run format`, `npm run build`, and the `stepfun-37` smoke prompt. Store logs under `tmp/issue3534/verification/`. If formatting changes files, rerun affected checks.

## Verification checklist

- [x] Every production edit has an observed failing behavioral test first.
- [x] No test verifies mock calls as its behavioral claim.
- [x] Long macOS temporary roots no longer determine the Podman credential socket path.
- [x] Socket directory is private and every OpenSSH Unix path fits Darwin's encoded limit.
- [x] Bounded SSH stderr appears in startup failures.
- [x] Source TypeScript runs in Linux using private Linux dependencies.
- [x] Host `node_modules` files and `.bin` links remain byte-identical.
- [x] Installed-mode contamination preflight still rejects a controlled wrong-platform fixture.
- [x] Success and induced failure leave no issue-owned process, container, volume, or temp directory.
- [x] Main-to-branch test-audit diff has no unexplained new finding.
- [x] All six required verification commands pass in order.
- [x] Working tree remains uncommitted.

## Review finding completion

1. Late OpenSSH exits are monitored through bridge readiness. Both output streams remain drained, diagnostics retain exactly 4096 encoded bytes without splitting UTF-8, and failed children are terminated and reaped. The real-process proof is `tmp/issue3534/remediation/green/32-podman-diagnostics-exact-bound.log`.
2. The three collateral suites now describe source-mode private dependency mounts and use tunnel doubles with piped output. Final passing evidence is in `tmp/issue3534/remediation/green/27-launch-release-final.log`, `28-proxy-integration-final.log`, and `29-venv-final.log`.
3. The real Podman source-preparation failure test waits until the container, dependency volumes, session runtime, short socket runtime, and reverse tunnel exist. It then proves the induced installer failure prevents source execution and releases each acquired resource. Final evidence is `tmp/issue3534/remediation/real-source-preparation-failure-final.log`.
4. Credential cleanup attempts the short socket runtime and normal session removal independently, preserving cleanup errors after all attempts. RED and GREEN evidence is in `tmp/issue3534/remediation/red/02-independent-session-cleanup.log` and `tmp/issue3534/remediation/green/03-independent-session-cleanup.log`.
5. Boundary coverage accepts an exact 103-byte Darwin socket path, rejects an exact 104-byte path before Podman or OpenSSH starts, and retains exactly 4096 diagnostic bytes. RED evidence is `tmp/issue3534/remediation/red/01-late-ssh-and-path-boundaries.log`; final GREEN evidence is `tmp/issue3534/remediation/green/32-podman-diagnostics-exact-bound.log`.

## Evidence summary

- Initial source-isolation RED and GREEN logs: `tmp/issue3534/red-source-isolation.log`, `tmp/issue3534/red-source-lock-preservation.log`, `tmp/issue3534/green-source-isolation.log`, and `tmp/issue3534/green-source-lock-preservation.log`.
- Final focused source and entrypoint suites: `tmp/issue3534/remediation/green/30-entrypoint-final.log` and `tmp/issue3534/remediation/green/31-source-isolation-final.log`.
- Final inherited-default-`TMPDIR` source success: `tmp/issue3534/remediation/source-success-final.log`. Its before/after comparison is `source-success-final-cleanup-summary.json`; every host and engine restoration field is true.
- Final post-acquisition source preparation failure and cleanup: `tmp/issue3534/remediation/real-source-preparation-failure-final.log`, with 21 passing real-engine tests and no failures.
- Final installed-mode identity: `tmp/issue3534/remediation/installed-mode-identity-final.log`. It reports the image-global `/usr/local/share/npm-global/bin/llxprt`, version `0.11.0-nightly.260902.1975fbab6`, Linux arm64, and `/run/.containerenv`. Its before/after comparison is `installed-mode-identity-final-cleanup-summary.json`; every restoration field is true.
- Final scanner output: `tmp/issue3534/remediation/test-audit-final-tree.log`. The normalized main-to-branch findings diff, `test-audit-final-tree-normalized.diff`, is empty.
- Ordered verification logs: `tmp/issue3534/remediation/verification/01-npm-test-final.log`, `02-npm-lint-final.log`, `03-npm-typecheck-final.log`, `04-npm-format-final.log`, `05-npm-build-final.log`, and `06-stepfun-smoke-final.log`. Every corresponding exit marker is `0`.
- The post-audit, post-Podman-proof build is `tmp/issue3534/remediation/verification/08-npm-build-after-proofs.log`. The repository-standard bundle smoke is `09-bundle-version.log` and reports exactly `0.11.0`. Both exit markers are `0`.
- Formatting changed three issue test files. Their reruns and the required lint and typecheck reruns are recorded under `tmp/issue3534/remediation/verification/04-format-*.log`, all with exit `0`.

## Failure recovery

Do not revert unrelated work. If a phase fails, retain its log, correct only the phase's tests or implementation, and rerun that phase before continuing. Engine resources created by interrupted real checks must be identified by issue-specific names or dependency labels and removed through their normal lifecycle. Record any cleanup failure in the proof log rather than hiding it.
