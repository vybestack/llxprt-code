# PLAN-20260802-ISSUE2962 — Stop orphaning the running runtime

Issue: #2962 — "false positives are disabling authentication"

## Symptom

Sessions spontaneously report lost `claudecode` / `codex` auth. Attempting to
re-authenticate fails with the replaced-runtime message ("credential access is
disabled to avoid a password-prompt storm"), which cannot be cleared without
restarting the session.

## Root cause (verified against the OS, not inferred)

Credentials live in the legacy file-based keychain (`login.keychain-db`, class
`genp`). Access is gated twice, and BOTH gates require securityd to resolve the
calling process's code identity:

    entry: authorizations: decrypt derive export_clear export_wrapped mac sign
           applications (2):
             0: .../node_modules/bun/bin/bun.exe
                requirement: identifier bun and anchor apple generic
                             and ... certificate leaf[subject.OU] = "7FRXF46ZSN"
             1: /opt/homebrew/Cellar/node/25.2.1/bin/node
                requirement: cdhash H"27b8a71d..."
    entry: authorizations: partition_id
           description: cdhash:27b8a71d..., teamid:7FRXF46ZSN

Findings:

1. Relaxing the trusted-application list is NOT a fix. An item created with
   `security add-generic-password -A` has `applications: <null>` (allow-all) and
   still prompted when read from a binary outside its partition, because the
   `partition_id` ACL entry is the binding gate. There is no item configuration
   that removes the identity requirement.
2. Both gates are path-independent. Bun matches by designated requirement
   (`identifier bun ... OU=7FRXF46ZSN`), the partition matches by `teamid`.
   Observed corroboration: agents running bun from
   `~/Library/Caches/jefe/package-versions/...` and from a project
   `node_modules/bun/bin/bun.exe` read the keychain without prompts.
   Upgrading, moving, or replacing the binary is therefore harmless.
3. The only condition that breaks access is the running executable's vnode being
   **unlinked**, which makes identity unresolvable and drops securityd into
   login-password prompts on every protected operation. The `nlink === 0`
   detection added for #2926 is sound; it is not producing false positives.
4. The unlink is self-inflicted by packaging. `bun` is an ordinary dependency
   (`packages/cli/package.json`: `"bun": "1.3.14"`) installed NESTED inside our
   package and not hoisted. A global upgrade removes and re-extracts the whole
   package directory, nested dependencies included:

       llxprt pkg dir   birth = Aug  2 21:50:06
       bun.exe          birth = Aug  2 21:50:08   ino=502354626 (new inode)

   Bun's version did not change (1.3.14 -> 1.3.14) and the file was still
   destroyed and recreated. Every llxprt release unlinks the executable of every
   running session. The same happens via package-cache GC, `npx` cache pruning,
   and `bun install` in a dev workspace.
5. The failure is then mis-reported. `keyring-token-store.ts` correctly rethrows
   the terminal error, but `packages/providers/src/auth/token-access-coordinator.ts`
   catches everything and returns `null` (lines 204-209, 444-456, 752-758). Null
   reaches `AnthropicProvider.ts:252` and renders as "No authentication
   available ... re-authenticate". A store outage is reported as a logout.

## Platform scope

macOS only. Linux `libsecret` and Windows Credential Manager/DPAPI are
user-scoped with no code-identity gate, and Windows will not delete a running
`.exe` at all. Runtime relocation is therefore darwin-gated; the packaging and
auth-layer fixes are cross-platform.

## Decisions

- **Runtime home:** `Storage.getGlobalDataDir()/runtime/bun-<version>/`.
  - macOS `~/Library/Application Support/llxprt-code/runtime/bun-<version>/`
  - Linux `~/.local/share/llxprt-code/runtime/<...>`
  - Windows `%LOCALAPPDATA%\llxprt-code\Data\runtime\<...>`
  - **Cache is explicitly rejected.** XDG purity would put a materialized
    runtime in cache, but macOS purges `~/Library/Caches` under disk pressure and
    every cleaner tool targets it. Purging it would unlink the running executable
    and reproduce this exact bug. The sole requirement of this directory is that
    nothing else deletes from it.
- **Materialization happens at launch time, never at install time.** npm v12
  defaults `allowScripts` to off (GitHub changelog 2026-06-09, RFC 0054), so no
  fix may depend on an install lifecycle script.
- **Fail fast retained.** The replaced-runtime condition stops being a
  process-wide terminal kill-switch, but it is not replaced with layered
  defensive guards; it becomes one accurate, non-terminal diagnostic.

## npm v12 exposure (discovered while investigating)

`bun`'s own manifest is `"scripts": { "postinstall": "node install.js" }` with
`@oven/bun-<platform>` optional dependencies. `bin/bun.exe` exists only because
that postinstall ran — `@oven/bun-darwin-aarch64/bin/` is empty on disk after
install because `install.js` moved the binary out of it. Under npm v12 the
postinstall is blocked by default, `bin/bun.exe` never materializes, and the
launcher exits 43 with "bundled Bun runtime was not found".

The `@oven` tarball ships the binary directly (`package/bin/bun`,
`package/package.json`, `package/README.md`) with no scripts, and `bun.lock`
already resolves every platform variant. Adding the platform packages as
explicit optional dependencies and teaching the launcher to fall back to
`@oven/bun-<platform>/bin/bun` removes the dependency on bun's postinstall.

## Work items

| # | Item | Files |
|---|------|-------|
| 3 | Explicit `@oven/bun-<platform>` optional deps; launcher falls back to them | `packages/cli/package.json`, `packages/cli/bin/llxprt` |
| 4 | Audit our own lifecycle scripts against npm v12 default-deny | `scripts/postinstall.cjs`, `packages/cli/scripts/install-native-launchers.cjs` |
| 5 | Launcher materializes and execs a stable, version-keyed runtime copy | `packages/cli/bin/llxprt` |
| 6 | Store outages must not render as logouts | `packages/providers/src/auth/token-access-coordinator.ts` |
| 7 | Demote `RUNTIME_REPLACED` to a non-terminal diagnostic | `packages/storage/src/secure-store/` |
| 8 | Eager-load lazily imported native modules | `packages/storage/src/secure-store/default-keyring-adapter.ts` |

### Item 5 requirements

- Darwin only; other platforms exec the resolved binary directly as today.
- Copy with `clonefile` semantics where available (`cp -c` on APFS is
  effectively free), falling back to a plain copy.
- Write to a temporary name in the destination directory, then `rename` into
  place, so concurrent first-runs cannot observe a partial binary.
- Version-keyed directory; reuse when already present and executable.
- Verify the materialized binary before exec using the existing Mach-O magic
  check, and fall back to the in-tree binary if materialization fails for any
  reason. Materialization must never be able to prevent startup.
- The launcher is POSIX `sh` and cannot call Node or Bun to resolve the data
  directory, so it must reproduce the
  `LLXPRT_DATA_HOME -> LLXPRT_CONFIG_HOME -> platform default` precedence from
  `packages/storage/src/config/path-resolver.ts`. A test must assert the shell
  and TypeScript resolvers agree so they cannot drift.
- Retire superseded `runtime/bun-*` directories that are not the current
  version, best-effort, never fatal.

## Behavioral tests (no mock theater, per dev-docs/RULES.md)

1. **Unlink survival (darwin).** Materialize the runtime, exec a process from it,
   delete the source package tree, and assert `fstat(fd).nlink` on the running
   executable is still >= 1 — i.e. the session is no longer orphanable.
2. **Directory agreement.** The shell resolver and `Storage.getGlobalDataDir()`
   produce the same path across default, `LLXPRT_DATA_HOME`, and
   `LLXPRT_CONFIG_HOME` cases.
3. **Atomic materialization.** Concurrent launcher invocations against an empty
   runtime home all exec a complete, valid binary; no invocation observes a
   partial file.
4. **Fallback.** With the runtime home unwritable, the launcher still starts
   using the in-tree binary.
5. **npm v12 shape.** With `bun/bin/bun.exe` absent (postinstall blocked) and
   `@oven/bun-<platform>/bin/bun` present, the launcher resolves and starts.
6. **Outage is not a logout.** A token read that fails with a
   `RUNTIME_REPLACED` store error propagates as a store error through
   `token-access-coordinator`; it does not become `null`, and the user-facing
   text does not tell the user to re-authenticate.
7. **Non-terminal diagnostic.** After the replaced condition is observed, the
   process continues to operate and reports the condition once, rather than
   failing every subsequent credential call for the lifetime of the process.

## Constraints

- No new `eslint-disable`, `ts-ignore`, `ts-expect-error`, or `ts-nocheck`; no
  loosening of complexity or size thresholds. Fix causes, not symptoms.
- New tests are Bun tests in TypeScript. No new `.js` files, no new vitest tests.
- Verification before push: `npm run test`, `npm run lint`, `npm run typecheck`,
  `npm run format`, `npm run build`, and
  `bun scripts/start.ts --profile-load stepfun-37 "write me a haiku and nothing else"`.
