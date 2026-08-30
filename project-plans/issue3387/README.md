# Issue #3387 — bring `npm run lint` under 8 GB

## Problem

`npm run lint` asks Node for a 12 GB heap and exhausts it. A contributor on a
16 GB laptop cannot run the repo's own lint gate before pushing.

## Measured diagnosis

All numbers from a 128 GB darwin box, cold, no ESLint cache, measured with
`/usr/bin/time -l` and `NODE_OPTIONS=--max-old-space-size=24576` so the heap
ceiling does not distort the peak. Raw logs: `tmp/verify3387/` (gitignored).

Baseline `eslint . --max-warnings 0`: **16,586,620,928 B (15.45 GiB) peak RSS,
242.74 s**.

The issue attributes the cost to "the sum of every package's type program" and
proposes per-package invocations. Measurement does not support that model.
Per-package invocations capped at a 6 GB heap all died with
`FATAL ERROR: Reached heap limit`:

| target | status at `--max-old-space-size=6144` |
| --- | --- |
| packages/cli | OOM |
| packages/agents | OOM |
| packages/providers | OOM |
| packages/core | OOM |
| packages/mcp | OOM |
| packages/telemetry | OOM |

### Actual cause: the root tsconfig is an implicit whole-repo project

The root `tsconfig.json` declares no `include`, `files` or `exclude`, so
TypeScript's default `**/*` applies and the project spans the entire
repository.

Six package tsconfigs `exclude` individual test files that fail `tsc`
(`packages/cli` 303 entries, `providers` 247, `agents` 206, `core` 178,
`mcp` 59, `telemetry` 6). ESLint still lints those files. typescript-eslint's
`projectService` walks up from the file, finds the package project does not
contain it, and lands on the root config, which builds a whole-monorepo
program to serve it.

Single-file proof, `packages/cli/src/config/config.test.ts`, one ESLint
invocation, nothing else changed:

| tsconfig state | peak RSS | wall |
| --- | --- | --- |
| listed in `packages/cli/tsconfig.json` `exclude` | 8,769,847,296 B (8.17 GiB) | 46.96 s |
| removed from that `exclude` | 1,640,644,608 B (1.53 GiB) | 7.06 s |

Confirmation that the root config is the provider: setting the root
`include` to a nonexistent path makes ESLint report
`config.test.ts was not found by the project service`.

The cost is flat per ESLint process, not per file. Linting one orphan file
costs 8,769,847,296 B; linting six costs 8,692,482,048 B. It is the same
whole-repo program either way.

## Accepted behavior

1. `npm run lint`, with no arguments and no cache, completes under an 8 GB
   heap from cold.
2. The set of files linted by a bare `npm run lint` does not shrink.
3. The default heap in `package.json` and `scripts/run-lint.ts` states the
   real requirement.
4. Peak RSS before and after is recorded in the repository.
5. Any wall-clock regression is stated.

Out of scope, recorded as follow-up: `lint:ci` remains a single-process
`eslint .`. Routing it through the runner requires changing
`scripts/eslint-guard/config-scanner.ts`, which demands a literal `eslint`
token carrying `--max-warnings 0` in that script. Phase 1 still improves it
(13.41 GiB instead of 15.45 GiB).

## Phase 1 — remove the type-orphans

For each package whose `tsconfig.json` excludes its own source files, move
the exclusion list into a sibling `tsconfig.noemit.json` that extends it, and
point the package's `typecheck` script at that file.

- `tsc` checks exactly the same files as before, with the same options, so
  typecheck results are unchanged.
- Every `tsconfig.build.json` in these packages declares its own `exclude`,
  which replaces rather than merges with the parent's, so builds are
  unaffected.
- `tsconfig.json` retains entries that point outside the package
  (`packages/cli` excludes ~249 `../providers`, `../auth` and `../mcp` test
  files that its `include` pulls in). Those are not orphans, because
  typescript-eslint resolves a providers file to
  `packages/providers/tsconfig.json`, and keeping them preserves the shape of
  the cli program. `tsconfig.noemit.json` carries the complete original list
  so `tsc` behavior is byte-identical.
- The name `tsconfig.noemit.json` avoids `tsconfig.typecheck.json`, which
  already exists in `core`, `mcp` and `tools` with an unrelated meaning
  (`include: ["src/**/*.test-d.ts"]`) and is referenced nowhere.

Measured effect, per package, `--max-warnings 0`, all exit 0 with no new
findings:

| package | before | after |
| --- | --- | --- |
| telemetry | 7,566,065,664 B / 36.70 s | 809,730,048 B / 3.50 s |
| mcp | 6,564,397,056 B / 46.32 s | 1,236,713,472 B / 4.46 s |
| agents | 9,284,255,744 B / 45.05 s | 2,889,580,544 B / 15.08 s |
| providers | 8,070,938,624 B / 57.82 s | 3,798,482,944 B / 18.75 s |
| core | 7,914,766,336 B / 60.90 s | 3,687,792,640 B / 20.42 s |
| cli | 12,191,252,480 B / 86.67 s | 6,060,621,824 B / 37.94 s |

A single full `eslint .` in this state is 13,407,666,176 B / 139.74 s. Still
too large, because one process holds every package program at once.

## Phase 2 — partition the full run

`scripts/run-lint.ts` currently emits one root invocation for a full run.
It becomes one invocation per `packages/<pkg>` directory, plus one `.`
invocation carrying `--ignore-pattern 'packages/**'`.

The union is provably the file set of `eslint .`: the per-package targets
cover exactly the files under `packages/`, and the final target covers `.`
with those same files removed. The partition is derived from the filesystem,
so a new package is picked up without editing the runner.

`--no-error-on-unmatched-pattern` is added to the per-package groups only,
because `eslint.config.js` ignores `packages/lsp` wholesale and a target that
matches only ignored files is otherwise a hard error. Those targets are read
from the filesystem, so there is no unmatched-pattern signal to lose. Scoped
targets come from CI's affected-target selector and the rest-of-tree group is
a fixed `.`, so both keep the error: an unmatched target there is a stale or
mistyped selection that should fail loudly.

All groups share the single cache location `node_modules/.cache/eslint`,
which is the exact path `.github/workflows/ci.yml` saves and restores. This
is safe because ESLint merges into an existing cache rather than pruning
entries for files the current run did not visit, confirmed by running two
package groups against one cache file and checking both packages' entries
survived. Per-group cache files would have fallen outside the CI cache path.

Scoped runs (CI, `lint:scoped`) are partitioned the same way, one invocation
per target, so the lowered heap default is safe on that path too.

### Coverage is verified, not argued

The partition was checked against the thing it replaces by collecting
`--format json` output from `eslint .` and from every partitioned command,
then comparing the `filePath` sets:

```
eslint .          : 5386 files
partitioned union : 5386 files
files linted before but not after : 0
files linted after but not before : 0
files linted by more than one group: 0
```

Same set, no gaps, no double work. The script that produced this is
`tmp/verify3387/coverage.sh`.

Ordinary lint failures no longer stop the run: every group is linted and the
first failing exit code is returned at the end, so one broken package does
not hide findings in the other sixteen. Terminations by signal still abort
immediately.

## Result

End-to-end `npm run lint`, cold, no cache, measured with `/usr/bin/time -l`
on the same machine as the baseline:

| | peak RSS | wall |
| --- | --- | --- |
| before (`eslint .`, 12 GB heap requested) | 16,586,620,928 B (15.45 GiB) | 242.74 s |
| after (17 groups, 6 GB heap each) | 4,565,237,760 B (4.25 GiB) | 149.25 s |

Peak drops 3.6x and wall clock drops 38%, so there is no wall-clock
regression to trade against the memory win. The after-peak is lower than the
5.64 GiB `packages/cli` figure measured under a 24 GB ceiling because a 6 GB
ceiling makes V8 collect harder for the same work.

`DEFAULT_HEAP_MB` is 6144, which is the ceiling the largest group actually
needs. `packages/cli` at a 4 GB ceiling does not complete.

The issue's stretch goal of 4 GB is not reached. `packages/cli/tsconfig.json`
pulls `providers`, `auth`, `mcp`, `settings` and `ide-integration` sources
into one program; splitting that is a separate change.

## Reviewed and rejected: pinning the moved files to the root `lib`/`types`

Review raised that the ~999 moved test files previously saw the root project's
`lib: ES2023` and root `types`, and now see their package's settings (agents
is `ES2021`, telemetry `ES2021` plus `ES2022.Error`, cli adds `DOM`). A probe
showed `[1, 2].toSorted()` typed under the root project but not under the
agents project, so a `no-unnecessary-condition` diagnostic that fired before
would not fire after. The suggested fix was to keep the root `lib`/`types` for
ESLint.

Rejected, because it would rebuild the defect. A test file in
`packages/agents` is compiled and run under agents' settings; `toSorted` is
genuinely unavailable there. Linting it as though `ES2023` were available
reports on a program that does not exist. Every file in a package that was
NOT excluded already linted under its package's settings, so the change makes
the excluded files behave like their siblings rather than giving any file
weaker treatment than its neighbours.

Nothing was suppressed in the current tree either: lint is clean before and
after over the identical 5386-file set, so there was no diagnostic to lose.
The residual risk is that these files are still outside `tsc`, which is
pre-existing and recorded below.

## Follow-ups, not done here

- `lint:ci` is still a single-process `eslint .` and still asks for 12 GB.
  Phase 1 brings it from 15.45 GiB to 13.41 GiB, but it cannot be routed
  through the runner without changing
  `scripts/eslint-guard/config-scanner.ts`, which requires a literal `eslint`
  token carrying `--max-warnings 0` in that script.
  `scripts/pre-push-check.sh` and `npm run preflight` both use it.
- The ~999 test files that fail `tsc` are still excluded from typecheck. They
  are now type-aware-linted against their own package program rather than the
  root one, which is stricter and more correct, and produced no new findings.

## Tests

Behavioral tests against the real exported builder in
`scripts/run-lint.ts`, no mocks:

- a full run emits one command per package directory plus one rest command;
- the rest command carries `--ignore-pattern packages/**` and no package
  target;
- the union of a full run's targets covers every package directory present on
  disk, so coverage cannot silently shrink;
- a scoped run emits one command per resolved target;
- the heap default appears in every emitted command;
- ordinary failures accumulate and the first non-zero exit code is returned;
- a signal termination aborts the remaining groups.

Plus a guard test asserting no package `tsconfig.json` excludes a file inside
its own package, which is the invariant Phase 1 establishes and the thing
that would silently reintroduce the 7 GB program.
