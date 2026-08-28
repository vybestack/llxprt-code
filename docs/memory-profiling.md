# Memory Profiling

LLxprt Code ships with opt-in tooling to investigate long-running session memory growth. It records JavaScriptCore (JSC) heap samples while a session runs and can analyze full heap snapshots — all through a portable file-based channel that works on macOS, Linux, and Windows without signals, TCP ports, or shell commands.

The tooling is Bun-only. An installed `llxprt` command uses its packaged Bun runtime. A source-checkout command uses the current Bun executable (`process.execPath`). Both preload the same probe implementation.

## Profile an installed command

Use the ordinary installed command with an exact profile activation flag:

```bash
llxprt --memprofile [llxprt args...]
llxprt --memprofile=15000 [llxprt args...]
llxprt --memprofile --memprofile-dir <run-dir> [llxprt args...]
llxprt --memprofile --memprofile-snapshots --memprofile-max-heap-mb 256 [llxprt args...]
```

`--memprofile=<interval-ms>` sets the sampling interval. The other profile controls select a run directory, arm snapshots, and set the snapshot heap guard. They are consumed only when the arguments contain the exact `--memprofile` or `--memprofile=<interval-ms>` activation. Similar names such as `--memprofiled`, and profile-control arguments without activation, remain ordinary LLxprt arguments. Non-profile LLxprt arguments retain their original order. Installed profile activation and controls are recognized only before the first user `--`; that boundary and every following argument are passed literally to LLxprt.

Installed runs write under the platform application-data directory's `memprofile/` child by default. `LLXPRT_DATA_HOME` overrides the application-data directory, and `LLXPRT_CONFIG_HOME` remains its backward-compatible fallback. An explicit `--memprofile-dir` selects the complete run directory instead. The launcher prints the selected path when it starts.

The installed utilities use the same packaged profiler implementation:

```bash
llxprt memprofile request [--heap] [--dir <run>] [--wait]
llxprt memprofile report [<samples-path-or-run-dir>]
llxprt memprofile analyze <snapshot> [--top <n>] [--min-mb <n>]
```

The published Node shim preserves normal argument handling, inherited stdio, signals, child exit status, and the sandbox capability descriptor while adding the profiler supervisor. A missing profiler bundle is treated as a corrupt installation and fails with the launcher failure status instead of falling back to repository scripts.

## Start a source-checkout profiled session

```bash
npm run mem:profile -- [memprofile options] -- [llxprt args...]
```

This is `scripts/start.ts` plus a `--preload scripts/memory/probe-preload.ts`. LLxprt runs exactly as in normal development; the probe samples the JSC heap alongside it. Options:

| Option              | Default                   | Description                                                             |
| ------------------- | ------------------------- | ----------------------------------------------------------------------- |
| `--snapshots`       | off                       | Arm heap snapshots (see the safety warning below)                       |
| `--interval <ms>`   | `15000`                   | Periodic sampling interval (positive integer)                           |
| `--max-heap-mb <n>` | `256`                     | Conservative snapshot guard (heap ceiling before a snapshot is refused) |
| `--dir <path>`      | `.memprofile/<timestamp>` | Run directory                                                           |
| `-h`, `--help`      |                           | Print usage                                                             |

**Argument boundary:** `--` separates memprofile options from LLxprt arguments. Everything before `--` must be a recognized option (an unknown `--flag` fails fast with an error); everything after `--` is passed to LLxprt untouched. For example:

```bash
npm run mem:profile -- --snapshots -- --profile-load <profile>
#                    ^^^^^^^^^ memprofile  ^ LLxprt args (after the second --)
```

(With `npm run`, the first `--` is consumed by npm itself; the second one is memprofile's boundary.)

Option values are validated: a missing, flag-shaped, nonpositive, non-integer, nonfinite, or above-upper-bound `--interval`/`--max-heap-mb` value is rejected with a clear error rather than silently falling back to a default. The launcher also strips any inherited `--localstorage-file` variants from `NODE_OPTIONS` before adding exactly one launcher-owned value, so a parent shell cannot redirect the dev local-storage file twice.

When the session exits, a growth report prints automatically (report-rendering failures print an error but never replace the child's own exit status). Each run writes to a timestamped directory under `.memprofile/`, and `.memprofile/latest` is published atomically (same-directory temp file + rename) to point at the most recent run. If the profiled session is terminated by a signal, the launcher exits nonzero so scripts and CI observe the abnormal termination.

A custom `--dir` outside `.memprofile/` is allowed for legitimate external locations, but the launcher prints a prominent warning: run artifacts can contain sensitive data, and `.memprofile/`, `*.heapsnapshot`, and `*.heapsnapshot.tmp` are git-ignored by default — an external directory is your responsibility to exclude.

Run directory layout:

```text
.memprofile/<timestamp>/
  samples.jsonl   # newline-delimited JSC heap samples
  probe.log       # probe diagnostics and snapshot/refusal notices
  probe.lease     # liveness lease of the owning probe (see below)
  requests/       # queued sample/snapshot request files
  requests/done/  # completion markers for processed request ids
  snapshots/      # .heapsnapshot files (only when snapshots are armed)
  pid             # child pid, for information only
```

On POSIX systems the run directory is created with `0700` permissions and the probe's files (`samples.jsonl`, `probe.log`, snapshots) with `0600` (owner-only), because these artifacts can contain sensitive data. Directories and files **reused from an earlier run are tightened** to those modes as well, not merely created with them; a path that cannot be tightened fails fast rather than staying world-readable. On Windows, mode bits are not part of the security model and are not applied. Partial snapshot temporaries (`*.heapsnapshot.tmp`) are also git-ignored.

## Run a profiled tmux workload

The tmux harness accepts an arbitrary `startCommand`, including the source profiler launcher. `${bun}` resolves to the harness's Bun executable, and `LLXPRT_TMUX_ARTIFACT_DIR` gives the launched command an isolated artifact directory. See `scripts/tmux-script.issue3386-memory-retention.fake.json` for a complete no-network example with fixed terminal dimensions, manual forced-GC checkpoints, `/clear`, and a clean exit.

Run that scenario with:

```bash
bun scripts/tmux-harness.ts \
  --script scripts/tmux-script.issue3386-memory-retention.fake.json \
  --out-dir tmp/memory-profile-run \
  --assert
bun scripts/memory/report.ts tmp/memory-profile-run/memprofile
```

The example uses the fake provider and writes beneath the selected harness output directory. Use a unique ignored directory for each comparison, and keep the scenario unchanged between baseline and candidate runs.

## Request a sample or snapshot from another terminal

```bash
npm run mem:request                  # queue a sample
npm run mem:request -- --heap        # queue a heap snapshot (requires --snapshots)
npm run mem:request -- --dir <run>   # target a specific run directory
npm run mem:request -- --wait        # wait for durable processing
```

This writes a JSON request file into the run's `requests/` directory. The probe's poller picks it up within its poll interval. By default, the command returns after queueing and reports where to inspect the probe log. `--wait` waits up to 30 seconds for the durable completion marker for that request. A marker can mean the probe processed a policy refusal, such as a snapshot request when snapshots are disabled, so inspect `probe.log` for the result. Unknown options and missing or invalid values fail fast with an error.

**Only live runs accept requests.** The request CLI checks the run directory's lease: if no probe holds a fresh lease (the session exited, crashed, or never started), queueing is refused with an actionable error instead of silently writing a request that nothing will ever process.

### Probe lease (liveness ownership)

Each probe owns a `probe.lease` file in its run directory: a small JSON record (owner token, pid, heartbeat timestamp) refreshed on every poll tick and released on normal exit. The lease is what makes request routing portable — no signals, `process.kill`, `pgrep`, sockets, or shell commands are involved, only atomic file operations:

- A second probe cannot take over a run directory whose lease is fresh, so a live probe's in-flight claims are never treated as orphaned by a competitor.
- A lease whose heartbeat is more than ten minutes old is stale (the threshold deliberately exceeds any single synchronous snapshot), after which a new probe may recover the directory and its orphaned requests.
- The request CLI refuses to queue into runs whose lease is missing, stale, or malformed.

### Exactly-once processing across restarts

Request processing is durable and effectively exactly-once: if the profiled process dies mid-request, the surviving claim file is recovered on the next startup. Side effects are keyed by request ID and idempotent, so re-running them after an interruption is safe:

- **Samples** requested via `mem:request` carry the request ID in `samples.jsonl`; recovery detects an already-published sample by request ID and acknowledges it instead of duplicating it.
- **Snapshots** are written to a per-attempt temporary file (request key + pid + timestamp, so two attempts never collide) and atomically published as `snap-<request-id>.heapsnapshot` — a partial snapshot is never mistaken for completion, and a request whose final file already exists is acknowledged rather than re-written. A crashed attempt's stale temp is removed on retry.
- A completion marker (`requests/done/<id>`) records finished requests; recovery removes orphaned claims without doubling side effects.

Claim deletion follows durability rules: a claim is removed only when the request is invalid or **durably completed**. After an operational failure (dispatch, publish, or done-marker write), the `.claimed` file is kept so a restarted process retries it — work is neither duplicated nor silently lost. Recovery of an already-claimed request validates its shape but not staleness: it was accepted when claimed, so an old claim is re-run rather than dropped. Pending (unclaimed) requests still enforce staleness so leftover files cannot loop forever.

## View a growth report

```bash
npm run mem:report                  # most recent run
npm run mem:report -- <path|dir>    # a specific samples.jsonl or run directory
```

The report shows the heap/RSS trend over the session and lists object classes whose counts grew. The per-class delta is the diagnostic signal: a class that climbs turn over turn is a retention candidate to investigate. The report presents observed growth only — it does **not** attribute any single class to a specific owner, because the same histogram entry can be retained by unrelated code. When no comparable type increased, the report states exactly that measured fact; it never claims the object graph is "flat".

Each sample retains only the top 25 object types, so a type absent from the histogram is **inconclusive**, not evidence of zero growth: the report says so explicitly rather than reporting growth from an unknown baseline. `heapSize` and `extraMemorySize` are reported separately and never summed, because `extraMemorySize` already overlaps `heapSize` for natively-held data; likewise `protectedObjectCount` is a neutral counter of natively protected references, not an ownership claim. CLI usage errors print usage and exit 2; runtime errors (a missing samples file, an unreadable path) print a one-line error and exit 1. Corrupt JSONL lines are skipped rather than aborting the report.

## Analyze a heap snapshot

```bash
npm run mem:analyze -- <file.heapsnapshot> [--top 25] [--min-mb 1]
```

The analyzer reports what is in the heap (aggregate `self_size` by type/name) and who is holding it: for each large object it builds a retainer path over strong edges from the snapshot root by breadth-first search, so the path shown is the shortest strong retainer chain regardless of edge order. Cycles terminate correctly. Weak edges are excluded, because a weak reference does not keep an object alive — reachability through a weak edge alone is not proof of retention.

Every retainer path carries an explicit proof status:

- **proven** — the breadth-first search reached the snapshot root; the emitted chain is a genuine root-to-object path.
- **truncated** — the path was cut by the depth budget before reaching the root; it shows the closest proven fragment and never implies full proof.
- **unreachable** — no strong retainer was found at all (a GC root itself, or held only through weak edges).

Snapshot structure is validated strictly before analysis (node/edge counts against array lengths and strides, edge offsets, type enum and string-table bounds); a malformed file is rejected with an actionable `SnapshotFormatError` rather than producing misleading numbers. Invalid arguments (unknown options, nonpositive/non-integer `--top`, nonpositive `--min-mb`) fail fast with usage and exit 2; runtime errors exit 1.

**Important limitations:**

- The analyzer reports `self_size`, **not retained size**. A container (array, closure, map) has a small `self_size` while retaining far more memory, so the retainer chains matter more than the size table.
- Each object shows one strong retainer path (the shortest), not the full set of retainers.
- The analyzer is general-purpose and makes no assumption about the host application's object graph.

## Snapshot safety

Heap snapshots are **synchronous**: `writeHeapSnapshot` blocks the target process and can consume substantially more transient memory than the live heap. The default guard refuses a snapshot unless the live JSC heap is under `--max-heap-mb` (256 MiB by default, uniform across platforms).

- **Do not snapshot a process that has already blown out.** A snapshot of a multi-gigabyte heap can demand many times that in transient memory.
- Leave snapshots off for day-to-day tracking. Periodic sampling plus the per-class delta is usually enough.
- The 256 MiB default is conservative. The transient cost of `writeHeapSnapshot` varies by platform; raise the guard only when you have confirmed you have the headroom.

Snapshots are strictly opt-in. The launcher always writes an explicit `LLXPRT_MEM_SNAPSHOT` value (`1` only with `--snapshots`, otherwise `0`), so a value inherited from a parent environment cannot re-arm them behind your back.

## Privacy and security

Samples, reports, and `.heapsnapshot` files can capture **source code, full prompts, prior input, tool output, provider data, and credentials**.

- **Never commit or upload** these artifacts. Source-checkout `.memprofile/`, `*.heapsnapshot`, and snapshot temporaries (`*.heapsnapshot.tmp`) are in `.gitignore`. Installed runs default to the platform application-data directory, outside the repository. If you select a custom directory, protect it deliberately and exclude it from version control yourself; the launcher warns about custom paths.
- On POSIX, the tooling creates its directories `0700` and files `0600` (owner-only), and **tightens reused directories/files to those modes**, to limit local exposure.
- The tooling **never inspects or uploads** captures automatically. Heap snapshots are analyzed locally and only when you explicitly point `mem:analyze` at a file.
