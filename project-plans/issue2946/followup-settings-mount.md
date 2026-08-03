Split out from #2946, which removed the dedicated `GEMINI_API_KEY` / `GOOGLE_API_KEY` env forwarding and the gcloud / `GOOGLE_APPLICATION_CREDENTIALS` mounts. A separate, pre-existing crossing remains.

## What crosses the boundary

`buildContainerRunArgs` in `packages/cli/src/utils/sandbox-containers.ts` unconditionally bind-mounts `USER_SETTINGS_DIR` read-write into the container:

    args.push('--volume', userSettingsDirOnHost + ':' + userSettingsDirInSandbox);

`USER_SETTINGS_DIR` is `path.dirname(Storage.getGlobalSettingsPath())` (`packages/cli/src/config/paths.ts`), which resolves to `Storage.getGlobalConfigDir()` — the same directory that holds:

- `profiles/*.json`, which `ProfileManager` persists with raw inline credentials. `ProfileManager.ts` writes `ephemeralSettings['auth-key']` and `providerSettings['auth-key']` verbatim; the round-trip is asserted in `packages/settings/src/profiles/__tests__/ProfileManager.test.ts`.
- a global `.env`, a supported location per `packages/cli/src/config/environmentLoader.ts`.

Any process inside the container can read those files directly, independently of whether the inner CLI ever loads them. The mount is read-write, so they can also be modified.

## Why it matters

This is the same class of defect #2946 addressed: material that the credential proxy exists to keep on the host still reaches the container. A user who saves a key inline in a profile (rather than via `/key save`) still hands that raw key to anything running in the sandbox.

## Why it was not fixed in #2946

#2946 was scoped to the Google-specific env forwarding and the gcloud/ADC mounts. Fixing this one requires a sanitized per-session config view — deciding which settings and profile fields the container legitimately needs, and projecting only those — which is a new subsystem rather than a deletion.

## Suggested resolution

Stop mounting the host global config directory wholesale. Generate a per-session sanitized view containing only the non-secret settings and profile metadata the sandboxed CLI actually needs, excluding `.env`, inline `auth-key`, `auth-keyfile` paths, and any other credential-bearing content. Consider whether the mount needs to be read-write at all.

## Acceptance criteria

- A profile containing an inline `auth-key` on the host is not readable from inside the container.
- A global `.env` on the host is not readable from inside the container.
- The sandboxed CLI still loads the settings and profile metadata it needs to run.
- A behavioral test drives the full `buildContainerRunArgs` output and proves no default mount exposes host credential files.
- `docs/sandbox.md` is updated; it currently has to hedge its isolation claims because of this mount.
