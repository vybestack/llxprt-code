# Issue #3321: Windows background shell jobs are killed with the spawner under a CI job object

## Problem

`spawnWindowsBackground` (packages/core/src/services/shellJobSpawn.ts) launches an
outer PowerShell that `Start-Process`es an inner PowerShell. It deliberately does
NOT pass `detached: true` (that option makes the command never execute on
Windows), so the outer process stays inside the spawner's job object.

GitHub Actions runners wrap the job in a job object with
`JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`. When the spawner exits, the runner tears
down the whole tree. Nightly evidence:

```
outerPid=2936 innerPid=0 elapsed=56ms status=0
stdout log: ""  stderr log: ""  spawner stdout: ""  spawner stderr: ""
```

The spawner exited in 56ms with status 0 (the unref half of the contract works),
but by assertion time the outer PID was gone and the inner had never started.

The whole `does not keep the spawner alive (production unref)` test is currently
skipped when `process.env.CI` is set, so CI loses BOTH claims the test makes,
including the unref claim, which is environment-independent and did pass.

## Decisions (answering the issue's "Worth deciding")

1. **Contract statement.** The documented contract becomes: on an ordinary
   Windows session the background tree survives the spawner's exit; on the
   GitHub Actions Windows runner it does not. It is stated as observed
   behavior, not as a guarantee, and callers are told to treat survival past
   the spawner as environment dependent. The job-object explanation is given as
   the leading hypothesis rather than as established fact: what the nightly
   evidence proves is that the outer PID was gone and no inner PID marker was
   observed, and confirming job ownership and limit flags would need
   `IsProcessInJob` / `QueryInformationJobObject`, which are native Win32 calls.
2. **Escaping the job object.** No. `CREATE_BREAKAWAY_FROM_JOB` is not reachable
   through `node:child_process.spawn` or `Bun.spawn` options, and it takes
   effect only when the containing job permits breakaway. Using it would require
   native Win32 calls. Not pursued; recorded as a rejected option in the code
   comment. Note that `detached: true` is not a substitute: on Windows it does
   not request job breakaway, and it is separately unusable here because the
   spawned PowerShell exits 0 without running the command.
3. **CI-hosted lifetime assertion.** Yes, two ways, both added:
   - Assert the tree's lifetime *while the spawner is still alive*. That claim
     is unaffected by a kill-on-close job object, so it runs in CI.
   - Split the existing fixture test so its environment-independent half
     (the spawner exits on its own) runs in CI, and only the
     survives-past-spawner half is gated.

**No runtime behavior changes.** `spawnWindowsBackground` is correct for its
supported environment; the defect is in how the contract was stated and tested.

## Acceptance criteria

### AC1: The contract is stated precisely

- The `spawnWindowsBackground` doc comment in
  `packages/core/src/services/shellJobSpawn.ts` states the survival contract as
  observed behavior with its environment caveat, distinguishes what is confirmed
  from the unconfirmed job-object explanation, says why `detached: true` is not
  used and that it is not a job breakaway, and says why
  `CREATE_BREAKAWAY_FROM_JOB` was rejected.
- `docs/tools/shell.md` → "Windows Details" states the same lifetime rule in
  user-facing terms.
- No production code (statements/expressions) changes.

### AC2: Tree lifetime is asserted in CI without depending on spawner exit

New Windows-only test in
`packages/core/src/services/shellJobWindowsSpawn.test.ts`, NOT gated on `CI`:

- Call `spawnWindowsBackground` in-process with a long-sleeping inner command
  built by `buildInnerPidMarkerCommand`.
- Assert the returned outer PID is positive and alive.
- Assert the inner PID marker is written (proving the bootstrap reached
  `Start-Process`) and that the inner PID is alive.
- Both alive at the same time, with the spawner (the test process) still
  running, so a kill-on-close job object cannot affect the result.
- Reap both PIDs and remove the directory via `reapAndRemoveWindowsTestDir`
  in a `finally`.

Boundary cases: marker never appears → `readInnerPidFromMarker` throws with its
own message (fail fast, no swallow); cleanup still runs from `finally` with
whatever PIDs are known.

### AC3: The unref claim runs in CI; only survival is gated

Split the existing `does not keep the spawner alive (production unref)` test
into two tests sharing one fixture helper:

- `does not keep the spawner alive (production unref)`, runs on Windows
  **including CI**. Asserts `result.status === 0`, which proves the spawner
  exited on its own before the `spawnSync` timeout backstop. Node sets `status`
  to `null` when the timeout kills the child, so a regressed unref fails here.
- `leaves the background tree running after the spawner exits`, gated by a
  named constant `SPAWNER_EXIT_KILLS_TREE` (currently `process.env.CI !==
  undefined`, documented as a proxy for "inside a kill-on-close job object",
  since querying the job object needs native Win32 calls). Asserts outer and
  inner PIDs are positive and alive after the spawner exited.

Both keep the existing `evidence` diagnostic string in assertion messages and
both reap via `reapAndRemoveWindowsTestDir` in a `finally`.

Boundary cases: fixture PID markers missing → PIDs stay 0, cleanup filters
non-positive PIDs; fixture throws before returning → helper still cleans up its
directory.

## Implementation

### Files

- `packages/core/src/services/shellJobSpawn.ts`, comments only (AC1).
- `docs/tools/shell.md`, Windows Details lifetime note (AC1).
- `packages/core/src/services/shellJobWindowsSpawn.test.ts`, AC2 + AC3.

### Test-file shape

```ts
/**
 * Whether the current environment tears the background tree down when the
 * spawner exits. GitHub Actions runners place the job in a job object with
 * JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE ... (see #3321). There is no way to query
 * job-object limits from Node/Bun without native Win32 calls, so CI is the
 * proxy.
 */
const SPAWNER_EXIT_KILLS_TREE = process.env.CI !== undefined;

interface UnrefFixtureRun {
  readonly status: number | null;
  readonly elapsedMs: number;
  readonly outerPid: number;
  readonly innerPid: number;
  readonly evidence: string;
}

/**
 * Run the spawner fixture once, hand the observations to `assertRun`, then
 * reap both PIDs and remove the fixture directory. The directory is removed
 * even when fixture setup throws.
 */
async function withUnrefSpawnerFixture(
  assertRun: (run: UnrefFixtureRun) => void,
): Promise<void>;
```

The fixture body is the existing test body verbatim (script generation,
`spawnSync(process.execPath, [scriptPath], ...)`, marker reads, `evidence`
assembly), with the assertions moved out to the callback.

## Verification

```bash
npm run test
npm run lint
npm run typecheck
npm run format
npm run build
bun scripts/start.ts --profile-load stepfun-37 "write me a haiku and nothing else"
```

The Windows describe block is skipped on darwin/linux, so local runs prove
compilation, lint, and non-regression only. Windows behavior is proven by CI on
the PR (AC2 and the AC3 unref half now execute there).

## Out of scope

- Any change to `spawnWindowsBackground` runtime behavior.
- Native Win32 job-object querying or breakaway.
- Changes to POSIX spawn paths, `ShellJobManager`, or other Windows tests.
