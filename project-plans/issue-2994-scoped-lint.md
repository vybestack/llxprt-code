# Issue #2994 — Surface the existing scoped-target lint mode for local use

## Problem

`npm run lint` runs one type-aware ESLint pass over the whole monorepo. That is
slow (~9 min) and memory-hungry (~10 GB peak, against the 12 GB cap that
`scripts/run-lint.ts` already sets). The mechanism to run a narrower lint
already exists — `scripts/run-lint.ts` accepts `--targets '<json array>'` or
`LLXPRT_LINT_TARGETS`, and `scripts/affected-lint-targets.ts` already maps
changed files to package targets — but both are wired only into
`.github/workflows/ci.yml` and are undocumented for developers.

Secondary complaint: when the ESLint child is killed (harness watchdog, OOM
killer) the runner exits with a bare non-zero status and no explanation, which
reads like a lint failure with a swallowed report.

## Accepted behavior (acceptance criteria)

### AC1 — Documented scoped entry point

`npm run lint:scoped -- <target> [<target> ...]` lints only the named targets
by delegating to the existing `--targets` path of `scripts/run-lint.ts`.

- Targets are forwarded as a JSON array on `--targets`; the runner's existing
  behavior (always adding `integration-tests`, dedupe, sort) is unchanged and
  is not reimplemented.
- Trailing slashes on targets are normalized (`packages/cli/` → `packages/cli`)
  so shell tab-completion output works.
- `--fix` and `--cache` are accepted and forwarded.
- No `--max-warnings 0` is injected: `lint:scoped` is `npm run lint`, scoped.
- Unknown flags, a `--base` without `--changed`, `--changed` combined with
  explicit targets, and an invocation with neither targets nor `--changed`
  all fail fast with usage text and exit code 2. No silent fallback to a
  full-tree run.
- `--dry-run` prints the resolved plan and exits 0 without spawning ESLint.
- `--help` / `-h` prints usage and exits 0.

### AC2 — Changed-files mode

`npm run lint:changed [-- --base <ref>]` lints only what differs from the merge
base, reusing `selectLintTargets` from `scripts/affected-lint-targets.ts`.

- Base ref resolution: explicit `--base` wins; otherwise the first of
  `origin/main`, `main` that `git rev-parse --verify` resolves.
- Changed paths = `git diff --name-only <merge-base>` (covers committed,
  staged and unstaged work) unioned with untracked files from
  `git ls-files --others --exclude-standard`, so newly added files are linted.
- If the base ref or merge base cannot be resolved, fail fast with a clear
  message and exit 2. It must not silently degrade into a full-tree run.
- Empty changed set: print an explicit "nothing to lint" message and exit 0.
- The selector's fail-closed decisions are honored: when `selectLintTargets`
  reports `fullRun` (shared inputs, `scripts/**`, `.github/**`,
  `integration-tests/**`, unknown paths), a full-tree lint is run and the
  reason is printed.

### AC3 — Opt-in local ESLint cache

The runner already supports `--cache` / `LLXPRT_LINT_CACHE=true` and never
enables caching implicitly. `lint:scoped` / `lint:changed` accept `--cache` and
forward it; the behavior stays opt-in and is documented. No change to the
runner's cache defaults.

### AC4 — Loud interruption

When the ESLint child is terminated by a signal, `scripts/run-lint.ts` prints an
explicit stderr diagnostic naming the signal and stating that this is an
interruption/kill rather than a lint failure, before exiting with `128 + signum`.
Exit-code propagation for ordinary lint failures is unchanged.

### AC5 — Documentation

`dev-docs/LINTING.md` documents:

- the scoped and changed-files entry points and their flags,
- the fail-closed cases in changed-files mode,
- the opt-in cache,
- that the full-tree run requires the 12 GB heap that `npm run lint` sets, and
  that a bare `npx eslint .` dies with a V8 heap OOM (exit 134) which is not a
  lint failure,
- the meaning of the new signal-termination diagnostic.

## Explicitly out of scope

- Issue item 4 ("consider per-package invocations"). Splitting the type-aware
  program per package changes lint semantics for cross-package type-aware rules
  and would multiply program construction cost for the full run. It is phrased
  as "consider" in the issue and is deferred rather than implemented here.
- Any change to CI lint wiring, to the selector's classification rules, or to
  the runner's full-run/scoped-run command shape.

## Boundary cases to prove

| Case | Expected |
| --- | --- |
| `lint:scoped -- packages/cli` | `--targets ["packages/cli"]` reaches the runner; runner emits one ESLint call with `packages/cli` and `integration-tests`, no `.` |
| `lint:scoped -- packages/cli/ packages/core/` | trailing slashes normalized, both targets present |
| `lint:scoped -- packages/cli --fix --cache` | `--fix` forwarded to ESLint, cache flags added by the runner |
| `lint:scoped` (no args) | exit 2 + usage |
| `lint:scoped -- --bogus` | exit 2 + usage |
| `lint:scoped -- --changed packages/cli` | exit 2 (mutually exclusive) |
| `lint:scoped -- --base main` | exit 2 (`--base` requires `--changed`) |
| `lint:changed` with only `packages/core/src/x.ts` changed | scoped targets = owner + reverse closure + `integration-tests` |
| `lint:changed` with a `scripts/**` change | full-tree run, reason printed |
| `lint:changed` with no changes | "nothing to lint", exit 0 |
| `lint:changed --base <nonexistent>` | exit 2, clear message |
| runner child killed by SIGKILL | stderr diagnostic naming SIGKILL, exit 137 |

## Test plan (behavioral, Bun + `bun:test`)

New file `scripts/tests/issue-2994-lint-scoped.bun.test.ts`:

1. **Argument parsing** — real exported parser, real argv arrays, asserting the
   resolved options or the thrown usage error for every boundary row above.
2. **Runner argv composition** — the composed argv is fed through the REAL
   `stripRunnerArgs` and `buildLintCommands` exported by `scripts/run-lint.ts`,
   asserting the concrete ESLint command that would be spawned. This proves the
   two modules actually compose; no mocked runner.
3. **Changed-files selection** — a real temporary git repository is created with
   fixture files, commits and a branch; `scripts/lint-scoped.ts --changed
   --dry-run` is spawned in it and its printed plan asserted for the scoped,
   full-run-fallback, empty-diff, untracked-file and bad-base cases.
4. **Signal diagnostic** — the exported failure classifier from
   `scripts/run-lint.ts` is called with real error shapes (`exitCode`,
   `signalCode`) and the returned exit code and message asserted.
5. **Wiring** — `package.json` defines `lint:scoped` and `lint:changed` and both
   invoke `bun scripts/lint-scoped.ts`; `dev-docs/LINTING.md` documents them.

No mock theater: no stubbing of git, of ESLint, or of the runner. Everything is
either a pure exported function called with real inputs or a real child process
in a real temporary repository.

## Files

- `scripts/lint-scoped.ts` (new)
- `scripts/run-lint.ts` (exported failure classifier + signal diagnostic)
- `scripts/tests/issue-2994-lint-scoped.bun.test.ts` (new)
- `scripts/bun-test-manifest.ts` (register the new Bun test)
- `tsconfig.scripts.json` (include the new files)
- `package.json` (`lint:scoped`, `lint:changed`)
- `dev-docs/LINTING.md`
