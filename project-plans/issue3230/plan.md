# Plan: JSC Memory Profiling & Heap Snapshot Diagnostics

Issue: #3230
Branch: `feat/history-memory-accounting`

## Scope

Deliver cross-platform, Bun-only memory diagnostics tooling that runs alongside an LLxprt session and can attribute growth via periodic samples and, when explicitly armed, a guarded heap snapshot. The tooling is portable across macOS, Linux, and Windows with no dependency on signals, TCP ports, `pgrep`, PowerShell, or platform shell commands.

This builds on two existing feature commits already on the branch:

- `439b8b8` — Source `heapUsed` from JavaScriptCore under Bun (`jscMemorySampler`).
- `a3fc5b5` — `/perf memory` content-size attribution.

Both are preserved and integrated; this plan adds the external profiling/diagnostics surface that observes them.

## Delivered behavior

### Portable file request channel

- A request command atomically writes a unique versioned JSON request (`temp` + `rename`) into the run's `requests/` directory. Request IDs follow a strict bounded grammar (hyphen-separated alphanumeric segments including the producer's pid, capped in length) that excludes every path-significant character, so all derived paths — request, claimed, done marker, snapshot — provably remain inside their intended directories.
- The preloaded probe polls that directory with an unref'd timer, atomically claims each request once (rename to `.claimed`), validates it, processes it once, then removes it — so repeated polls never repeat work and a malformed request cannot loop forever.
- Claim deletion is durable: a claim is removed only when the request is invalid or durably completed (done marker written). After an operational failure the `.claimed` file is kept and retried by a restarted process; recovery validates shape but not staleness, so an already-claimed old request is re-run, never stale-rejected. Side effects are idempotent by request ID (samples deduplicated via their recorded request ID; snapshots publish to a request-keyed final name via a per-attempt temp).
- Stale request temp files are cleaned using an injected clock; non-ENOENT claimed-read failures restore the request for retry instead of deleting it.
- No `process.kill`, `SIGUSR1/2`, `pgrep`, PowerShell, TCP port, or platform shell command is required.

### Probe lease (liveness ownership)

- Each run directory carries a `probe.lease` file (owner token, pid, heartbeat) refreshed on every poll tick and released on normal exit, using atomic temp+rename writes and owner-checked updates.
- A second probe refuses to take over a directory whose lease is fresh; a lease stale beyond ten minutes (longer than any single synchronous snapshot) may be recovered.
- The request CLI resolves runs only through a live lease: missing, stale, malformed, or unreadable leases produce actionable errors instead of queueing into dead runs.

### Request schema

- Versioned (`version`), unique `id`, `createdAt` timestamp, and `kind` of `sample` or `snapshot`.
- Malformed and stale (and implausibly future-dated) requests are rejected and removed.

### sample request

- Forces `bun:jsc` `gcAndSweep`, writes a tagged sample, and logs completion with the request id.

### snapshot request

- Requires explicit snapshot arming; otherwise refuses safely.
- Forces `gcAndSweep`, then checks the current JSC heap against a configurable limit.
- Refuses when unarmed or over the limit; otherwise writes a V8-format `.heapsnapshot` via `node:v8` under Bun, logs success/refusal with the request id, and writes a post-snapshot sample.
- Never terminates LLxprt intentionally.

### Snapshot guard

- Default maximum is conservative at **256 MiB** for all platforms, until Windows transient private-commit behavior is measured. No macOS "22x" multiplier is applied or hardcoded.
- Docs explain that snapshot creation is synchronous, blocks the target, can consume substantially more transient memory than the live heap, and should not be used after a process has already blown out.

### Probe samples

- Records JSONL samples: timestamp, tag, pid, process RSS, JSC heap size/capacity/extra memory, object/protected-object counts, and top object-type counts.
- Periodic sampling uses an unref'd timer and never keeps the target alive. Terminal output is quiet by default because Ink owns the terminal.

### Launcher

- Creates a portable timestamped `.memprofile/<run>` directory (or explicit `--dir`, allowed outside `.memprofile/` with a prominent sensitivity/git warning), updates `.memprofile/latest` atomically, records the child pid for information only, launches `packages/cli/index.ts` with `--preload scripts/memory/probe-preload.ts` using the current Bun executable, preserves CLI arguments and inherited stdio, and renders a report at normal child exit (report errors are reported without replacing the child's exit status). Snapshot arming is opt-in; the preload entry is a separate module so importing the probe (launcher, tests) never installs it.
- `NODE_OPTIONS` handling strips inherited `--localstorage-file` variants (shared library extracted from `scripts/start.ts`) before adding exactly one launcher-owned value. Positive-integer options enforce upper bounds consistent with the probe's env parsing.

### Request CLI

- Resolves the latest run or an explicit run directory through the active-lease gate and queues a sample by default or a snapshot with `--heap`. Reports where the request was queued and where to inspect the probe log, without pretending completion already occurred. Dead or unowned runs are refused with actionable errors.

### Reporter

- Resolves an explicit samples file, run directory, or latest run, parses JSONL (skipping corrupt lines), and reports trends and object-class growth. Presents observed growth neutrally and does not attribute any single class to a specific owner; when no comparable type increased it reports exactly that measured fact (never "flat"), with an explicit inconclusive caveat when histograms are truncated. `heapSize`/`extraMemorySize` are never summed. CLI usage errors exit 2 with usage; runtime errors exit 1.

### Heap analyzer

- Parses Bun/JSC's V8-format snapshots with strict structural validation (count/stride/edge-offset/enum/string-table consistency; malformed files raise an actionable `SnapshotFormatError`), reports aggregate self_size by type/name and large individual objects, and prints strong-edge root-to-object retainer paths with explicit proof status — proven, truncated (depth-limited, never implying proof), or unreachable. Weak edges are ignored. Clearly states that `self_size` is not retained size. General-purpose — not hardcoded to the host application's object graph. CLI arg errors exit 2 with usage; runtime errors exit 1.

### Artifact security

- Snapshot files and reports may contain full prompts, provider payloads, tool output, source, and credentials. Docs state never to commit/upload them, and `.memprofile/`, `*.heapsnapshot`, and `*.heapsnapshot.tmp` are git-ignored. On POSIX, directories are `0700` and files `0600`, and **reused** directories/files are tightened to those modes rather than merely being created with them; Windows is a no-op where mode bits do not apply. The tooling never inspects or uploads captures automatically.

## Files

- Tooling: `scripts/memory/{sample,request,lease,paths,perms,probe,probe-preload,report,heapanalyze,launcher,request-cli}.ts`, `scripts/lib/node-options.ts`
- Tests: `scripts/tests/memory/*.test.ts` (Bun, `bun:test`), `packages/core/src/services/history/contentSize.behavior.test.ts`
- Docs: `docs/memory-profiling.md` (linked from `docs/index.md`)
- npm scripts: `mem:profile`, `mem:request`, `mem:report`, `mem:analyze`
- `.gitignore`: `.memprofile/`, `*.heapsnapshot`, `*.heapsnapshot.tmp`

## Test coverage

Atomic unique request creation with bounded-grammar IDs and path containment; exactly-once claim/processing with durable claim retention and retry across operational failures; idempotent sample/snapshot recovery covering crashes after claim, after sample append, after snapshot temp write/publish, and before/at done-marker write; malformed request rejection; stale PENDING rejection with claimed recovery exempt; unarmed snapshot refusal (including on recovery); over-guard refusal after forced GC; per-attempt snapshot temp naming and stale-temp cleanup; lease acquire/renew/release/check with injected clocks, competing probes, and stale takeovers; request-CLI live/dead run gating through real child processes; latest/explicit/active run path resolution with Windows path semantics and external-fs `RunResolutionError` conversion; launcher parsing bounds, `--` boundary hint, and exactly-one `--localstorage-file` NODE_OPTIONS construction; sample parsing with corrupt/torn-line rejection and cutoff clamping; report parsing/rendering including protectedObjectCount doubling, never-summed counters, and truncation honesty; analyzer structural validation rejections, proof statuses (proven/truncated/unreachable), weak-edge exclusion, permuted meta layouts, and CLI boundaries; retained-history accounting through the real HistoryService (item metadata, all block fields, shared item/blocks/block identity, null runtime strings, bounded top-N ranking). Tests exercise real production functions against temp directories / synthetic fixtures — no mock-call theater.

## Verification

`tsc --project tsconfig.scripts.json`, the new Bun test files, `npm run lint:changed`, and `npm run format` on the implementation. Full `test`/`build` left to the coordinator.
