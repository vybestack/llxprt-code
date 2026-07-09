## Summary

The credential proxy server bound a POSIX Unix-domain socket to a `.sock` filesystem path and applied POSIX-only permission calls. On Windows, Node's `net.Server.listen(path)` cannot bind an arbitrary NTFS temp path as an AF_UNIX socket, so it fails with `listen EACCES`. This PR platform-branches the transport: **Windows named pipe (`\\.\pipe\lxcp-<pid>-<nonce>`) on `win32`, Unix-domain socket on POSIX** — behind the unchanged `CredentialProxyServer` / `ProxySocketClient` API, so callers are untouched.

Fixes #2403.

## Important scope note (please read)

Issue #2403 was filed against an earlier architecture. **PR #2426** ("Minimal Node launcher: exec Bun directly, keychain-direct in non-sandbox, proxy only in sandbox", Fixes #2419) merged _after_ the issue and:

- rewrote `packages/cli/bin/llxprt.cjs` into a minimal stub that **starts no proxy** (a bare `llxprt` no longer touches the proxy at all), and
- **deleted** `packages/cli/bin/credential-proxy-host.cjs`.

Consequently the launcher-side checklist items in the issue — `isSafeProxySocketDir`, `parseProxyHostLine`, and the launcher `removeSocketDirWithRetry` cleanup — **target code that no longer exists** and are intentionally not addressed here. The credential proxy is now a **sandbox/container-only** concern; its sole remaining production caller is `sandbox-containers.ts` → `createAndStartProxy` (`sandbox-proxy-lifecycle.ts`). The still-valid, real fix is the **server-side transport**, which is what this PR delivers.

## Changes

### Production — `packages/providers/src/auth/proxy/credential-proxy-server.ts`

- Added a module-level `const isWindows = process.platform === 'win32'`.
- `buildSocketPath()` returns `\\.\pipe\lxcp-<pid>-<nonce>` on win32 (string concatenation, not `path.join`, so the `\\.\pipe\` prefix is preserved; base64url never emits a backslash so the nonce can't corrupt the pipe namespace). `socketDir` is ignored on Windows (a pipe has no directory). POSIX behavior is byte-for-byte unchanged (realpath tmpdir, uid, `lc-<uid>` dir, `<pid>-<nonce>.sock`).
- `start()` gates the POSIX-only calls: `mkdirSync({ mode: 0o700 })` and `chmodSync(0o600)` run only on POSIX. The `net.createServer` + `listen` flow is identical on both platforms.
- `stop()` gates the socket-file `unlinkSync` to POSIX; a Windows named pipe is released automatically when the server closes.
- Class JSDoc and inline comments updated to accurately describe both transports and the Windows access-control model (see Security below).

The client side already accepts a named-pipe path unchanged via `net.createConnection`.

### Tests (behavioral, real IPC — per `dev-docs/RULES.md`, no mock theater)

- **New Windows-only coverage** in `platform-matrix.test.ts` (`it.skipIf(!isWindows)`):
  1. `start()` returns a `\\.\pipe\lxcp-` endpoint (and not a `.sock`), even when a `socketDir` is passed (proving it is ignored).
  2. A **real `ProxySocketClient`** connects over the pipe and round-trips `get_token` + `list_providers`, asserting on the **returned token/provider data**, not just `ok`.
  3. A guard test **spies on `fs.mkdirSync`/`chmodSync`/`unlinkSync`** and asserts they are **never called** on Windows (the authoritative proof that no POSIX-only fs/permission call runs on win32). It deliberately does not assert `fs.existsSync` on a _live_ pipe (unreliable on Windows) and only checks it after `stop()`.
- **POSIX transport-shape assertions** (`.sock` suffix, `isSocket()`, on-disk existence, `pid+nonce` naming) are gated with `it.skipIf(isWindows)` in `credential-proxy-server.test.ts` and `integration.test.ts`, so they still run unchanged on Linux/macOS. The `0o600`/`0o700`/realpath POSIX tests are unchanged.

## Security

On Windows, Node/libuv create the named pipe with the **system default security descriptor** and do **not** apply a per-user DACL. The 128-bit cryptographic nonce in the pipe name is therefore the **primary access-control barrier** — the same unguessability defense the POSIX random-socket-filename path already relies on. Comments were corrected to state this accurately rather than implying a per-user ACL. A stronger same-user isolation model (custom security descriptor / authenticated handshake) would be a separate hardening item and is out of scope here.

## CI / where the Windows tests run

- **Gating CI** (`ci.yml`) runs the test matrix on **ubuntu + macos** only, so the new `skipIf(!isWindows)` tests are skipped there and the POSIX tests stay green.
- **Nightly** (`nightly.yml`) runs `npm run test` on **windows-latest**, so the new Windows pipe-creation + round-trip tests **actually execute there** — satisfying the issue's "wire a Windows job that does one round-trip" criterion with no new workflow.

## Verification

- `npm run typecheck` — clean.
- `npm run lint` (eslint) on changed files + `lint:eslint-guard` — clean (no eslint-disable / ts-ignore / complexity-threshold changes).
- `npm run format` (prettier) — clean.
- `npm run build` — clean.
- `providers` proxy suite — **245 passed / 6 skipped** (the platform-gated tests). Full `providers` run shows only 28 pre-existing failures in `src/auth/__tests__/` proactive-renewal/oauthManager fake-timer tests — **proven pre-existing** by re-running on a clean `git stash` of these changes (identical failures without the diff).
- Smoke test failure (`404 model gpt-5.5`) is a local profile/settings model-resolution issue, **also proven pre-existing** via clean-stash run; the CLI boots end-to-end and reaches the API call.

## Acceptance criteria mapping

- [x] On Windows, `CredentialProxyServer.start()` returns a working pipe endpoint.
- [x] Real-IPC round-trip test on Windows (server + `ProxySocketClient` over the pipe, `get_token`/`list_providers`).
- [x] POSIX behavior unchanged (socket path, `0o600`, tmpdir-child dir; existing POSIX tests still pass).
- [x] No POSIX-only fs/permission call (`chmodSync`, `mkdirSync({mode})`, `getuid`, socket-file `unlinkSync`) runs on Windows — asserted via fs spies.
- [x] `platform-matrix.test.ts` no longer skips the core transport on Windows (adds `skipIf(!isWindows)` pipe-creation + round-trip).
- [x] Windows job runs a round-trip (existing nightly windows-latest `npm test`).
- [ ] Launcher `isSafeProxySocketDir`/`parseProxyHostLine` — **N/A**: that code was removed by #2426 (see scope note).
