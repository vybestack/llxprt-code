# Issue #3440 — Capability token env dirs (`~/.llxprt-code-cap-*`) accumulate in `$HOME` with no reclamation

Branch: `issue3440`. Milestone 0.11.0. Labels: Code Quality / Modularization,
sandboxing, security.

## Accepted behavior (test-first restatement of the issue ACs)

AC1 — No production or test code path creates `.llxprt-code-cap-*` entries in
`$HOME`. Proven by:

- Placement tests: the capability dir produced by
  `createHostOnlyCapabilityEnvFile()` resolves under a platform runtime root
  (never `os.homedir()`), for every platform branch (see resolver below).
- A suite-level guard in `sandbox-entrypoint.test.ts`: snapshot the count of
  `.llxprt-code-cap-*` entries in the REAL `os.homedir()` in `beforeAll`,
  assert the count is unchanged in `afterAll` (on CI this is 0 → 0, satisfying
  "leaves zero").

AC2 — The token never lands inside any path mounted into the sandbox container
(#1954 AC1), and 0700/0600 modes are preserved wherever a file transport
remains. Proven by:

- Mount narrowing: the container tmpdir mount is a session-specific
  `mkdtemp` subdirectory of `resolvedTmpdir`; the capability dir is created
  outside it (sibling under the runtime root, or in XDG_RUNTIME_DIR /
  LOCALAPPDATA which are never mounted).
- A behavioral attacker test: a probe listing the (narrowed) mounted dir finds
  no capability artifact.
- Mode assertions (0700 dir / 0600 file) stay in the placement test;
  `fs.mkdtempSync` guarantees 0700 on POSIX.

AC3 — A session killed with SIGKILL still has its directory reclaimed by a
later CLI startup within the configured threshold. Implemented per the issue's
allowed alternative ("or immediately before creating a new capability dir"):
`reclaimOrphanCapabilityDirs(maxAgeMs)` runs at the top of
`createHostOnlyCapabilityEnvFile()`. Proven by behavioral tests that seed
orphan dirs with backdated mtimes in a redirected runtime root and in a mocked
legacy-home root, invoke the producer, and observe removal; fresh (young) dirs
are never removed.

AC4 — CI proves the test suite leaves zero `.llxprt-code-cap-*` directories in
the real `$HOME` and touches nothing in the real config. The suite-level
before/after guard (AC1) runs in CI via `npm run test`. Every test that invokes
the real producer redirects BOTH the runtime root and `os.homedir()` to temp
dirs, so the sweep embedded in the producer never scans the real home and no
capability dir is ever created in the real home or real config.

## Design decisions

1. Runtime root resolver (`sandbox-capability.ts`), evaluated per call (never
   cached, so tests can redirect it):
   - Linux: `XDG_RUNTIME_DIR` when set and non-empty; else `os.tmpdir()`.
   - macOS: `os.tmpdir()` (per-user `DARWIN_USER_TEMP_DIR`).
   - Windows: `<LOCALAPPDATA>/llxprt-code` (created if needed); else
     `os.tmpdir()`.
   Capability dir: `fs.mkdtempSync(path.join(root, 'llxprt-code-cap-'))`
   (0700 on POSIX, no pid in the name — age-based reclamation makes the pid
   useless and pid reuse makes it misleading).
2. Mount narrowing (`sandbox-exec.ts`): keep
   `resolvedTmpdir = fs.realpathSync(os.tmpdir())`; create
   `sessionTmpdir = fs.mkdtempSync(path.join(resolvedTmpdir, 'llxprt-sandbox-'))`;
   pass `sessionTmpdir` to `buildContainerRunArgs()` (mount at path parity, so
   socket path parity is preserved) and to `setupCredentialProxy()` as the
   proxy socket dir. The session dir is removed best-effort on the existing
   exit paths by composing its cleanup into `credentialProxyBridgeCleanup`.
3. Bounded lifetime: `reclaimOrphanCapabilityDirs(maxAgeMs = 24h)` scans (a)
   the runtime root for `llxprt-code-cap-*` and (b) `os.homedir()` for legacy
   `.llxprt-code-cap-*` (this is what eventually reclaims the ~3,013 dirs that
   already accumulated). Directories only (never symlinks), exact prefix match,
   mtime older than the threshold, best-effort removal that can never fail the
   session startup. 24h default is safe because docker/podman read `--env-file`
   at container spawn; the file is dead weight minutes later, and concurrent
   sessions' fresh dirs are always under the threshold. Age is the criterion;
   no pid-liveness checks (pid reuse).
4. File transport stays. macOS Keychain/no-file transport was evaluated and
   rejected for this change: `--env-file` requires a host-readable file, and
   the alternative (`--env` with the raw token) is banned by #1954 tests
   because it exposes the token in argv/inspect output. Recorded here as a
   possible future option, not implemented.
5. Naming: new dirs use the prefix `llxprt-code-cap-` (mkdtemp). The legacy
   hidden prefix `.llxprt-code-cap-` is matched only by the sweep, never
   created again.

## Scope guard (do NOT do)

- No changes outside `packages/cli/src/utils/` sandbox files, their tests, and
  this plan.
- No new env-var knobs, no new public modules; `reclaimOrphanCapabilityDirs`
  is exported from `sandbox-capability.ts` for testability, that is the only
  new export.
- No seatbelt-path changes (it never creates capability env files).
- No CI workflow changes; the in-suite guard satisfies AC4 because it runs in
  CI.

## Files to touch

- `packages/cli/src/utils/sandbox-capability.ts` — resolver, mkdtemp
  placement, sweep.
- `packages/cli/src/utils/sandbox-exec.ts` — session tmpdir narrowing + return
  it; thread to `setupCredentialProxy`.
- `packages/cli/src/utils/sandbox-containers.ts` — rename param to
  `sessionTmpdir` in `buildContainerRunArgs`/`setupCredentialProxy`; compose
  session-dir cleanup.
- `packages/cli/src/utils/sandbox-entrypoint.test.ts` — placement/platform
  tests, reclamation tests, attacker test rework, AC10 rework, real-home
  before/after guard, runtime-root redirection in every producer-touching
  describe.
- `packages/cli/src/utils/sandbox-capability.test.ts` — capability placement,
  reclamation, and mount-containment behavior split from the entrypoint suite
  to keep `sandbox-entrypoint.test.ts` within the 800-line lint limit.
- `packages/cli/src/utils/sandbox-credential.test.ts` — redirect runtime root
  (spy `os.tmpdir`, unset/restore `XDG_RUNTIME_DIR`); artifact assertions cover
  the redirected root.
- `packages/cli/src/utils/sandbox-proxy-integration.test.ts` — update R3.4
  source-structure assertions (realpath retained; narrowed mount; socket in
  session dir).

## Verification

Full cycle per the issue-workflow skill: `npm run test`, `npm run lint`,
`npm run typecheck`, `npm run format`, `npm run build`, and the smoke test
`bun scripts/start.ts --profile-load stepfun-37 "write me a haiku and nothing
else"`. Plus `bun scripts/test-audit/scan.ts` diffed against main for the
touched test files (no new MOCK_MIRROR / ALWAYS_TRUE / SELF_CONFIRMING /
NO_ASSERT findings).

## Known follow-ups

- Windows named-pipe socket parity for the credential proxy remains a
  pre-existing platform gap. This change does not regress it.
- Orphan reclamation uses the issue's stated 24-hour age criterion. PID
  liveness was rejected because PID reuse makes it unreliable. A live session
  older than 24 hours may have its already-consumed capability env directory
  reclaimed; this is harmless because Docker and Podman consume the env file
  when the container starts.
