# Issue #3081 — Container sandbox mounts the global config at the legacy `~/.llxprt` path

## Problem

`buildContainerRunArgs` in `packages/cli/src/utils/sandbox-containers.ts` mounts the host
global config directory into the container at `/home/node/.llxprt`:

    const userSettingsDirOnHost = USER_SETTINGS_DIR;
    const userSettingsDirInSandbox = getContainerPath(
      `/home/node/${SETTINGS_DIRECTORY_NAME}`,
    );
    if (!fs.existsSync(userSettingsDirOnHost)) {
      fs.mkdirSync(userSettingsDirOnHost);
    }
    args.push('--volume', `${userSettingsDirOnHost}:${userSettingsDirInSandbox}`);
    if (userSettingsDirInSandbox !== userSettingsDirOnHost) {
      args.push(
        '--volume',
        `${userSettingsDirOnHost}:${getContainerPath(userSettingsDirOnHost)}`,
      );
    }

The CLI inside the container resolves its config directory through
`Storage.getGlobalConfigDir()` → `env-paths('llxprt-code').config` →
`/home/node/.config/llxprt-code`. Nothing is mounted there, so the sandboxed CLI
sees an empty configuration on every launch.

Verified against the shipped sandbox image:

    config = /home/node/.config/llxprt-code
    data   = /home/node/.local/share/llxprt-code
    mounted content is at /home/node/.llxprt
    /home/node/.config does not exist

Because `/home/node/.llxprt` exists and has content, the in-container startup migration
(`runStartupMigration`) treats it as a legacy directory and copies the whole host config
into ephemeral container paths on every start. `categorizeEntry` routes anything not
listed in `CONFIG_ENTRIES` to the **data** directory, and three entries the application
reads from the **config** directory are missing from that set:

- `welcomeConfig.json` — read from `USER_SETTINGS_DIR` (`getWelcomeConfigPath`)
- `trustedFolders.json` — read from `USER_SETTINGS_DIR` (`getTrustedFoldersPath`)
- `skills` — read from `Storage.getUserSkillsDir()` = `<configDir>/skills`
  (only `tmp/skills` is special-cased today)

So even the accidental in-container migration lands `welcomeConfig.json` in the data
directory, where the CLI never looks. Net user-visible effect: **the first-time setup
wizard runs on every sandboxed launch**, folder trust is re-prompted, and profiles /
subagents / prompts / commands / policies / hooks / global memory are all invisible.

The same `categorizeEntry` gap is a genuine host bug independent of the sandbox: a user
migrating from a legacy `~/.llxprt` loses their welcome marker, their trusted-folder
decisions and their user skills.

The macOS Seatbelt path was already corrected during the OS-standard path migration
(`buildSeatbeltArgs` passes `CONFIG_DIR` / `DATA_DIR` / `CACHE_DIR` / `LOG_DIR` resolved
through `Storage`). Only the container path was left behind.

## Scope

In scope:

1. Container mount + environment pinning for the canonical config directory.
2. Removal of the legacy `/home/node/.llxprt` destination.
3. `categorizeEntry` correctness for `welcomeConfig.json`, `trustedFolders.json`, `skills`.
4. Migration marker version bump so the categorization fix actually applies to users who
   already migrated but still have a legacy directory.
5. Docs.

Explicitly out of scope (documented, not changed):

- Mounting the **data** directory. It holds `oauth_creds.json`, `google_accounts.json`
  and `provider_accounts.json`. Bind-mounting it would push raw stored credentials
  across the sandbox boundary, which is exactly what #2946 removed and what the
  credential proxy (`LLXPRT_CREDENTIAL_SOCKET`) exists to prevent. Data, cache and log
  stay container-local, which is the behaviour that already ships today.
- Sanitising the config-directory mount. Tracked separately by #2957 (security,
  milestone 0.12.0). This change must not increase what crosses the boundary — the same
  single directory crosses, only its destination inside the container changes.

## Design

### 1. `packages/cli/src/utils/sandbox-containers.ts`

Replace the legacy mount block with a canonical, `HOME`-independent one.

- Mount the host config directory at **path parity**: `getContainerPath(hostConfigDir)`.
  Path parity is what the old code already did for its second mount, and it keeps
  host-absolute paths that appear inside settings/profiles resolvable.
- Pin the four canonical roots explicitly with environment overrides so in-container
  resolution never depends on the container `HOME` (which is `/home/node` by default and
  the host home directory under `SANDBOX_SET_UID_GID`):
  - `LLXPRT_CONFIG_HOME` = `getContainerPath(hostConfigDir)` (the mount)
  - `LLXPRT_DATA_HOME`   = `<containerHome>/.local/share/llxprt-code`
  - `LLXPRT_CACHE_HOME`  = `<containerHome>/.cache/llxprt-code`
  - `LLXPRT_LOG_HOME`    = `<containerHome>/.local/state/llxprt-code`

  All four must be set. `resolveGlobalDataDir` / `CacheDir` / `LogDir` fall back to
  `LLXPRT_CONFIG_HOME` when their own variable is absent, so setting only
  `LLXPRT_CONFIG_HOME` would redirect container-local data, cache and logs into the
  mounted host config directory. Pinning all four preserves today's container-local
  behaviour for the three unmounted categories.

  `<containerHome>` must be derived from the same value that decides the container `HOME`
  (`/home/node` normally, `os.homedir()` under `shouldUseCurrentUserInSandbox()`), so the
  two never disagree. Because `setupContainerUser` runs after `buildContainerRunArgs`,
  the home resolution needs to be a single shared helper used by both.

- Drop the `/home/node/${SETTINGS_DIRECTORY_NAME}` destination entirely. Setting
  `LLXPRT_CONFIG_HOME` also makes `runStartupMigration` return early, so the phantom
  in-container legacy migration stops on both counts.

- `fs.mkdirSync(userSettingsDirOnHost)` must become `{ recursive: true }`. The
  non-recursive form throws `ENOENT` when the platform config parent does not exist yet.

- `SETTINGS_DIRECTORY_NAME` may become unused in this file; remove the import if so.
  Note it is still used at line ~305 for the `sandbox.venv` path — check before removing.

### 2. `packages/cli/src/config/pathMigration.ts`

- Add `'welcomeConfig.json'`, `'trustedFolders.json'` and `'skills'` to `CONFIG_ENTRIES`.
- Bump `MIGRATION_MARKER_VERSION` from 1 to 2 so a user who already migrated under the
  old categorisation re-runs migration once and gets the three entries placed correctly.
  Re-running is safe: `copyEntry` publishes with hard-link / `COPYFILE_EXCL` semantics and
  never overwrites a pre-existing canonical file.
- Confirm the `tmp/skills` special case in `migrateTmpDir` still behaves correctly now
  that a top-level `skills` entry is also categorised as config; they are different
  sources (`<legacy>/skills` vs `<legacy>/tmp/skills`) writing to the same destination,
  and the no-overwrite copy semantics must keep that collision benign.

### 3. Docs

- `docs/sandbox.md`: state which host directory is mounted into the container, at which
  path, and that data / cache / logs are container-local and do not persist.

## Tests (behavioral, Bun)

`packages/cli/src/utils/sandbox-containers.test.ts` is already registered as a Bun-native
suite in `scripts/bun-test-manifest.ts` (workspace `cli`), so new cases belong there.

Drive the real `buildContainerRunArgs` output — no assertions against mocks:

1. The `--volume` operand list contains `<hostConfigDir>:<getContainerPath(hostConfigDir)>`.
2. No `--volume` operand has a destination ending in `/.llxprt`.
3. `--env LLXPRT_CONFIG_HOME=<getContainerPath(hostConfigDir)>` is present and equals the
   config mount destination.
4. `--env LLXPRT_DATA_HOME`, `LLXPRT_CACHE_HOME`, `LLXPRT_LOG_HOME` are all present, are
   pairwise distinct, and none of them is inside the mounted config directory.
5. With `LLXPRT_CONFIG_HOME` set on the host (so all four host roots collapse to one
   directory) the produced arguments contain no duplicate `--volume` destination.
6. A test that pins the regression directly: the destination the CLI would resolve inside
   the container (i.e. the value of `--env LLXPRT_CONFIG_HOME`) is covered by one of the
   emitted `--volume` destinations. This is the invariant that was violated.

For the migration categoriser, add cases to the existing bun-registered migration suite
(or a new `packages/cli/test-bun/*.bun.ts` file registered in the manifest) driving the
real `performMigration` against a temp legacy directory:

7. A legacy dir containing `welcomeConfig.json` migrates it to the **config** destination,
   not data, and `isWelcomeCompleted()` reads it back as completed.
8. Same for `trustedFolders.json`.
9. A legacy `skills/<name>/SKILL.md` lands under `<configDir>/skills/<name>/SKILL.md`.
10. A pre-existing canonical file is not overwritten when migration re-runs after the
    marker version bump.

No new test may assert on a mock's call arguments in place of real behaviour.

## Verification

    npm run test
    npm run lint
    npm run typecheck
    npm run format
    npm run build
    bun scripts/start.ts --profile-load stepfun-37 "write me a haiku and nothing else"

Manual sandbox check (docker available locally):

    LLXPRT_SANDBOX=docker llxprt   # twice; the welcome wizard must not reappear
