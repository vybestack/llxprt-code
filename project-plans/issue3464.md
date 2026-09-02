# Issue #3464 — Sandbox checkpoint history is discarded with the container

Status: complete (all suites green; see Verification below)

## Problem

Checkpointing writes its shadow Git repository under
`storage.getHistoryDir()` = `LLXPRT_DATA_HOME/history/<sha256(project root)>`.
In a container sandbox the entrypoint pins `LLXPRT_DATA_HOME` to the
container's ephemeral `$HOME`, and the sandbox runs `--rm`, so checkpoint
history — and the `/restore` metadata JSONs under
`storage.getProjectTempCheckpointsDir()` in the ephemeral `LLXPRT_LOG_HOME` —
are destroyed when the container exits. Later `/restore` operations cannot
recover anything.

Second defect: the shadow repository relies on work-tree `.gitignore` files
only. Repository-local exclude rules (`.git/info/exclude`) of the user's
project are never represented, so files the user excluded are silently
committed into checkpoint snapshots (and the copied root `.gitignore` at the
history root is inert — git never reads it there).

Third defect (found while building the real-engine evidence): even ignoring
persistence, `GitService.initialize()` FAILED outright inside containers —
`Failed to initialize checkpointing: Author identity unknown`. The
init-time simple-git instance (repo init + initial commit) ran without the
shadow `HOME` pinning, so the `.gitconfig` written into the history dir was
never read and container git could not derive an identity. Fixed by pinning
`HOME`/`XDG_CONFIG_HOME` to the history dir on that instance too (same
pinning every snapshot/restore already used).

Found while evaluating private-workspace and synchronization designs for #3450.

## Acceptance criteria (from the issue)

1. A checkpoint created in a container sandbox remains restorable after
   restarting the sandbox.
2. Checkpoint state is stored outside the ephemeral container home without
   entering the project repository.
3. Nested `.gitignore` and repository exclude rules are honored consistently.
4. Docker and Podman behavioral tests cover create, exit, restart, and restore.
5. A persistence failure is reported before relying on the checkpoint.

Task-level additions:

- Persistence must survive restarting Docker or rootless Podman (engine-owned
  storage does; tests prove survival across independent engine invocations and
  container exits — see "Engine restart coverage" below).
- Coexist with #3450 engine-owned per-run dependency volumes and #3470
  stale-run cleanup.
- Mark persistent checkpoint resources distinctly so crash recovery cannot
  delete valid checkpoint history.
- Support arbitrary selected UIDs without host-owned cleanup failures.
- Fail before reliance when persistence cannot be provided.

## Design

### Persistent engine-owned checkpoint store volume

One engine-owned named volume per (engine, project):

- Name: `sandbox-checkpoints-<projectKey>` where
  `projectKey = Storage.getProjectHistoryKey(getContainerPath(workdir))` —
  the exact sha256 the in-container CLI computes for its history dir (path
  parity on non-Windows; `getContainerPath` translation on Windows hosts).
  Deterministic name ⇒ the same volume is reused by every run of the project,
  including after daemon restart, so history accumulates.
- Labels:
  - `com.vybestack.llxprt.sandbox-managed=true`
  - `com.vybestack.llxprt.sandbox-checkpoint-store=<projectKey>`
  - `com.vybestack.llxprt.sandbox-checkpoint-persistent=true`
  - explicitly NOT `sandbox-dependency-run` and NOT `sandbox-owner`
    (per-run/process-scoped semantics must never attach to persistent state).
- Volume layout inside:
  - `history/<projectKey>/` — the shadow Git repository
  - `checkpoints/` — the `/restore` checkpoint metadata JSONs
  - `history/<projectKey>/.llxprt-checkpoint-store` — marker file proving a
    persistent store backs this exact project key.
- Mounted into the main container at the neutral path
  `/var/lib/llxprt-sandbox/checkpoints` (never inside the workspace bind or
  the container home), with `--env LLXPRT_SANDBOX_PROJECT_KEY=<key>` and
  `--env LLXPRT_SANDBOX_CHECKPOINT_STORE=<path>` (both reserved against
  `SANDBOX_ENV` override).

Why a volume and not a host bind: #3450 proved the host cannot unlink content
a foreign container uid wrote (POSIX ownership), while the engine can always
delete its own volumes — arbitrary selected UIDs therefore never cause
host-owned cleanup failures, and the store cannot leak into the project
repository.

### Entry point wiring (follows the real container `$HOME`)

`#3081` pins data/cache/log homes from the image's real `$HOME` inside the
entrypoint — a host-side mount destination cannot predict that home for
custom images. The store is therefore linked into place by a trusted
entrypoint stanza (composed after the XDG pin, before bridges/exec):

- fail fast if the two checkpoint env vars are missing or the per-project
  marker file is absent at the store path (a broken/missing mount must abort
  the sandbox before the CLI runs);
- `mkdir -p "$LLXPRT_DATA_HOME"` and
  `mkdir -p "$LLXPRT_LOG_HOME/tmp/$LLXPRT_SANDBOX_PROJECT_KEY"`;
- `ln -sfn "$LLXPRT_SANDBOX_CHECKPOINT_STORE/history"
  "$LLXPRT_DATA_HOME/history"` — the shadow repo lands in the volume;
- `ln -sfn "$LLXPRT_SANDBOX_CHECKPOINT_STORE/checkpoints"
  "$LLXPRT_LOG_HOME/tmp/$LLXPRT_SANDBOX_PROJECT_KEY/checkpoints"` — the
  `/restore` metadata JSONs land in the volume.

The stanza is added only when checkpointing is enabled, so sessions without
checkpointing keep today's fully-ephemeral behavior.

### Init container (permission normalization + marker)

A second bounded, hardened init container (uid `0:0`, `--cap-drop=ALL` with a
single `--cap-add=FOWNER` carve-out, `no-new-privileges`, `--network none`,
`--pull=never`, `--rm`, `--init`), mirroring the #3450 dependency init, runs
before the main container. FOWNER is required and sufficient: the
normalization chmods store entries owned by the PREVIOUS session's selected
uid, and chmod on non-owned files needs exactly that capability — without it
the second launch dies with "changing permissions of .../.git/objects:
Operation not permitted" (proven on Docker).

- `mkdir -p history/<key> checkpoints`;
- normalize for arbitrary-uid sharing:
  `find … -type d -exec chmod a+rwX {} +` (world-writable, NOT sticky) and
  `find … -type f -exec chmod a+rw {} +`. The sticky bit was tried first
  (the /tmp analogy) and REJECTED on real-Docker evidence: a sticky store
  made a second-uid commit fail with "Unable to write new index file" and
  "could not open COMMIT_EDITMSG: Permission denied", because git renames
  lockfiles over entries (`.git/index`, refs, `COMMIT_EDITMSG`) the previous
  uid created and the sticky bit denies that rename to any uid but the
  entry's owner. Non-sticky world-writable is safe here because only this
  project's sandbox containers can mount the volume;
- write the marker file.

Docker (rootful) chmods as root; rootless Podman presents named volumes
idmapped to the container user (the #3450 finding), so the normalization
holds on both engines. Because a fresh uid must also be able to operate on a
repo whose files a previous uid wrote, the shadow `.gitconfig` gains
`[safe] directory = *` (that config file is only ever used for the shadow
repository — `HOME`/`XDG_CONFIG_HOME` are pinned to the history dir).

### Fail before reliance

- Host side: volume create or init failure ⇒ `FatalSandboxError` before the
  main container is spawned. The checkpoint volume is NEVER deleted on any
  failure path (it may hold valid history); only the session tmpdir and the
  #3450 per-run dependency volumes are released.
- Container side: `GitService.initialize()` checks, when `SANDBOX` indicates
  a container sandbox (`SANDBOX` set and ≠ `sandbox-exec`, matching the CLI's
  existing convention), that the history dir contains the
  `.llxprt-checkpoint-store` marker; otherwise it throws a precise error
  instead of building checkpoints that die with the container (version-skew
  protection: an old host that provisions no store cannot present an
  ineffective feature).

### Coexistence with #3450 and #3470

- #3450: dependency volumes mount at `<workdir>/node_modules` (inside the
  workspace bind); the checkpoint store mounts at the neutral `/var/lib/...`
  path — disjoint destinations, independent init containers, and the
  checkpoint store is not registered with any `DependencyVolumeLifecycle`, so
  `release()` and the process-exit/SIGINT/SIGTERM cleanup paths never touch
  it. Behavioral test: a session with BOTH features leaves dependency
  volumes reaped and the checkpoint volume present with intact history.
- #3470 (open, future stale-run reclamation): the contract is the distinct
  name prefix `sandbox-checkpoints-` + the
  `sandbox-checkpoint-persistent=true` label + the absence of the
  `sandbox-dependency-run` label and owner labels. Any run-scoped reaping
  implemented for #3470 matches run labels/name prefixes only and therefore
  cannot match checkpoint stores. This plan is the documented coordination
  point: #3470's cleanup MUST NOT delete resources labeled
  `com.vybestack.llxprt.sandbox-checkpoint-persistent=true`.

### Engine restart coverage

Engine-owned named volumes live in the engine's on-disk store
(`/var/lib/docker/volumes`, rootless podman's `~/.local/share/containers`)
and survive daemon/machine restarts by engine semantics. The behavioral
suites prove the observable equivalents on a shared host where restarting
Docker Desktop or the podman machine would destroy concurrent sibling
sessions: the volume persists across container exit (`--rm`), across fully
independent engine invocations (create → inspect → new container → restore),
and retains its labels and content. The gated CLI suites prove a second full
sandbox session reuses (not recreates) the shadow repository in the store.

## Scope

Files:

- `packages/storage/src/config/storage.ts` — `static getProjectHistoryKey()`
  (single source of the history-path hash; used by the CLI planner).
- `packages/core/src/services/gitService.ts` — container-sandbox marker
  fail-fast; `.git/info/exclude` synchronization into the shadow repo (at
  setup and before every snapshot); `[safe] directory = *` in the shadow
  gitconfig; exported marker filename constant (the CLI/core contract).
- `packages/cli/src/utils/sandbox-checkpoint-storage.ts` — NEW: plan,
  volume-create/init argv builders, attach, entrypoint stanza builder.
- `packages/cli/src/utils/sandbox-entrypoint.ts` — optional stanza parameter.
- `packages/cli/src/utils/sandbox-containers.ts` — reserve the two env keys.
- `packages/cli/src/utils/sandbox-exec.ts` — plan + attach wiring, stanza
  pass-through.
- `packages/cli/test-utils/fake-dependency-engine.ts` — record `--env` on
  `run` containers (additive; needed because the checkpoint attach passes
  `--env` flags).
- Tests: `packages/core/src/services/gitServiceCheckpoints.test.ts` (NEW,
  real git, real filesystem), `packages/cli/src/utils/sandbox-checkpoint-storage.test.ts`
  (NEW, fake engine), `integration-tests/sandboxCheckpointPersistence.real.test.ts`
  (NEW, real Docker + Podman).
- Docs: `docs/checkpointing.md`, `docs/sandbox.md`.

Out of scope (documented, not implemented here): session chats/recordings
persistence (separate feature), `.git/info/exclude` edits mid-restore,
`--exclude`-style per-run overrides, #3455 dev-mode bootstrap, #3470
implementation itself.

## Boundary decisions

| Decision | Rationale |
| --- | --- |
| Engine-owned volume, not host bind | arbitrary UIDs never create host-unremovable files (#3450 F-series evidence); store stays outside repo and container home |
| Deterministic per-project name | persistence across runs/daemon restarts; per-run names would re-create the discard bug |
| Neutral mount path + entrypoint symlinks | follows the image's real `$HOME` (#3081 custom-image safety); no credential boundary crossing (#2946 — only `history/` and `checkpoints/` cross, never the data root with OAuth creds) |
| Marker file + GitService check | fail-fast inside the container for version skew/misconfiguration rather than an ineffective feature |
| Init chmod normalization each launch | cross-uid write/read sharing of a growing store must be deterministic; engine-mediated, never host-mediated || No lifecycle registration | the store must survive crashes and cleanup by design; #3470 contract documented here |
| Metadata JSONs persisted too | `/restore` after restart needs the commit hashes; without them AC1 is untestable in the real flow |

## Test plan (RED → GREEN)

1. `gitServiceCheckpoints.test.ts` (core, real git):
   - snapshots exclude `.git/info/exclude` rules (RED);
   - exclude edits between snapshots are honored (RED);
   - snapshots honor nested and root `.gitignore` (proof; expected green);
   - initialize fails in a container sandbox without the store marker (RED);
   - initialize succeeds with the marker, and with `SANDBOX=sandbox-exec`
     (seatbelt) without one (guards);
   - restore round-trip: snapshot → modify/add → snapshot → restore reverts
     content and removes files added after the snapshot (anchor).
2. `sandbox-checkpoint-storage.test.ts` (cli, fake engine):
   - plan gating (engine kind, checkpointing flag);
   - project key equals `Storage.getProjectHistoryKey(getContainerPath(workdir))`;
   - attach creates the labeled volume, runs the hardened init, mounts at the
     neutral path, passes both `--env` keys, labels the main container;
   - volume name/labels disjoint from dependency-run resources;
   - failure of volume create/init ⇒ FatalSandboxError naming the volume, and
     the volume is never removed;
   - SANDBOX_ENV override of the reserved keys is rejected;
   - stanza: present only when enabled; contains marker gate, both symlinks,
     `$HOME`-following paths.
3. `sandboxCheckpointPersistence.real.test.ts` (docker + podman):
   - engine-path suite, production argv + production stanza: create (real git
     shadow-repo commit through the exact `GIT_DIR`/`GIT_WORK_TREE`/`HOME`
     topology GitService uses) → exit (`--rm`) → volume survives with labels,
     no host-side checkpoint state, repo untouched → restart (fresh
     container + fresh init) → history still readable, new commit, restore of
     the run-1 commit reverts workspace content;
   - arbitrary-uid run (`--user 54321:54321`): reads run-1 objects, commits,
     and restores — cross-uid sharing proof;
   - #3450 coexistence: dependency volumes released, checkpoint volume intact
     with restorable history;
   - gated image-global CLI suites: `--checkpointing` agent session boots
     across two sandbox runs reusing the same store (HEAD stable), and a
     version-skew run (production argv without the store) exits nonzero with
     the persistence error.

## Verification

Focused bun suites (each in an isolated process, per the bun module-mock
rule): gitServiceCheckpoints 8 pass, sandbox-checkpoint-storage 16 pass,
gitService 16 pass, plus neighbors (launch-lifecycle 4, containers 41,
entrypoint 18, dependency-volumes 10) and storage config files (29 pass
across 3 files). `npm run typecheck` clean for storage, core, cli;
integration tsconfig shows only the pre-existing cross-package TS6307 class
(not part of the typecheck gate). `bun scripts/lint-scoped.ts --changed`:
0 errors. `npx prettier --check` clean on every touched file.
`bun scripts/test-audit/scan.ts`: 0 findings on the three new test files.
`npm run build --workspaces`: OK (lockfile/NOTICES churn restored).

Real-engine evidence (image rebuilt from this tree, `npm run build:sandbox`):

- Docker: sandboxCheckpointPersistence 6/6 pass (4 main + version-skew +
  image-global two-session store reuse; docker-run6.log).
- Podman (rootless): 6/6 pass (podman-run4.log).
- Regression: #3450 isolation suite on Docker 6/6 pass after the
  prepareContainerSandbox refactor; privilege suite 9 pass.

Smoke: `bun scripts/start.ts --profile-load stepfun-37 "write me a haiku
and nothing else"` exits 0 with a completed turn. Logs under
`tmp/verify3464/`.
