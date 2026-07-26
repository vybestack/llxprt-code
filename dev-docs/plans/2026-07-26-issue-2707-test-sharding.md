# Issue #2707 — Shard workspace test execution into parallel CI jobs

Part of umbrella #2702 (CI 10-minute target). Follows the bounded
issue-delivery policy (decision-complete acceptance matrix, explicit
non-goals, bounded vertical slices, scope ledger).

## Problem

`npm run test` (`npm run test --workspaces --if-present`) visits all 16
workspaces sequentially, so the test job's wall-clock is the **sum** of
every package's test time (~1356s / 22.6 min). Four packages are ~89% of
the total. Additionally `npm run test:scripts` (120 files, ~4.5 min) is
appended serially to every matrix leg.

## Goal

Make the test job's critical path `max(shard)` rather than `sum(pkg)`,
**without silently dropping a workspace** and without losing JUnit /
coverage aggregation. Keep one canonical local command.

## Acceptance matrix

| #   | Accepted behavior                                                                                                      | Behavioral evidence (how we prove it)                                                                                                                                                 |
| --- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | Each workspace is assigned to exactly one shard; the union of shard assignments equals the set of declared workspaces. | `scripts/check-test-shards.ts` exits 0; unit tests assert it fails when a workspace is added/removed/duplicated.                                                                      |
| A2  | A workspace missing from the shard map fails CI.                                                                       | The completeness guard runs as a CI step and fails (exit 1) on a missing/duplicate/unknown workspace; unit test covers each failure mode.                                             |
| A3  | `scripts/test.ts --shard <name>` runs exactly that shard's workspaces.                                                 | Unit tests assert the shard→workspace expansion and that `--shard` filters `orchestrateTests` to the right set.                                                                       |
| A4  | `npm run test` (local canonical command) still runs **every** workspace + scripts.                                     | Local run of `npm run test` exercises all 16 workspaces; `scripts/test.ts` default path unchanged.                                                                                    |
| A5  | CI runs workspace tests as parallel jobs (one job per shard × os), plus a separate scripts job.                        | `ci.yml` matrix includes a `shard` dimension; each leg invokes `bun scripts/test.ts --shard <name>`.                                                                                  |
| A6  | JUnit reports aggregate across shards without loss.                                                                    | Each shard uploads a uniquely-named `junit-<shard>-<os>` artifact; a single dorny report step per os reads the merged glob.                                                           |
| A7  | Coverage artifacts aggregate across shards.                                                                            | Each shard uploads `coverage-<shard>-<os>`; `post_coverage_comment` downloads the cli/core shard artifacts (those are the only packages with coverage summaries the action consumes). |
| A8  | Before/after wall-clock recorded.                                                                                      | This plan records the expected `max()` vs `sum()` math; PR body records measured values from the CI run.                                                                              |

## Non-goals (explicitly out of scope)

- **Reducing per-package cost** (the cli/agents/providers cost reductions).
  This issue only changes _scheduling_. The issue text states this and
  pairs it with a separate cli issue. Touching package vitest configs is
  out of scope.
- **Sharing the build artifact across shards** (build-once, upload `dist/`,
  download per shard). The issue says "measure both." The per-shard build
  duplication is ~1.3 min; the artifact-upload/download dance adds
  complexity and a new failure surface. **Decision: keep per-shard build**
  in this PR (simplest correct change); revisit build-sharing as a separate
  optimization once sharding lands. This avoids exceeding the scope budget.
- **Changing branch-protection required checks.** The repo uses a single
  `Lint` virtual job pattern; we will add a parallel `test` virtual job
  that aggregates all shards so the _required check name does not change_
  (it remains `Test`). This sidesteps the ruleset-coordination step in the
  issue. (See "Branch protection" below.)
- **Rewriting `npm run test:ci`** (the `NODE_OPTIONS` workspace variant).
  CI does not use `test:ci`; it uses `npm run test` + `npm run
test:scripts`. We only touch what CI uses.
- **Sharding the nightly/luther workflows.** They invoke `npm run test`
  locally-style and are unaffected by the CI job split.

## Bounded vertical slices

1. **Shard source-of-truth + guard** (scripts only; no CI change yet).
   `scripts/test-shards.ts` exports the shard map + helpers.
   `scripts/check-test-shards.ts` is the completeness guard.
   Unit tests for both. This slice is independently shippable and tested.
2. **Orchestrator `--shard` support** (scripts/test.ts). New `--shard`
   flag that expands to the shard's workspaces and delegates to the
   existing `--workspace`-style filtering. Unit tests.
3. **CI matrix conversion** (.github/workflows/ci.yml). Convert the `test`
   job to a `shard` matrix; split `test:scripts` into its own job; add a
   `test` virtual aggregator job; fix artifact names + the
   `post_coverage_comment` `needs`/downloads.
4. **Docs** — record the local command and before/after in this plan +
   PR body.

## Branch protection (decision)

The repo already gates downstream jobs behind a virtual `lint` job that
simply waits on the real linters. We mirror that: a virtual `test` job
`needs` every shard leg and only succeeds when all of them do. The
required check name becomes `Test` (previously `Test (ubuntu-latest)` /
`Test (macos-latest)` from the matrix). **Branch protection rules must be
updated** to require `Test` instead of the old per-os names. This is a
repo-settings change (not a code change); the PR body calls it out as a
post-merge coordination step. Using a single virtual `Test` check is
simpler than registering 12 per-shard-per-os checks.

The existing `post_coverage_comment` job currently `needs: ['test']` and
gates on `needs.test.result == 'success'`. With the virtual `test` job,
this still works: it waits for the aggregator, which only succeeds when
all shards succeed.

## Files to edit (scope ledger)

| File                                                    | Change                                                                     | New/edited lines (est.) |
| ------------------------------------------------------- | -------------------------------------------------------------------------- | ----------------------- |
| `scripts/test-shards.ts`                                | NEW — shard map + `expandShard`/`getAllShardNames`/`validateShardCoverage` | ~120                    |
| `scripts/check-test-shards.ts`                          | NEW — completeness guard CLI (models check-lockfile.ts)                    | ~90                     |
| `scripts/tests/test-shards.test.ts`                     | NEW — unit tests for shard map + guard                                     | ~180                    |
| `scripts/test.ts`                                       | Add `--shard` arg + shard expansion in `orchestrateTests`/`main`           | ~40                     |
| `scripts/tests/test-orchestrator.test.ts`               | Add `--shard` cases                                                        | ~60                     |
| `package.json`                                          | Add `lint:test-shards` script                                              | ~1                      |
| `tsconfig.scripts.json`                                 | Include the 3 new scripts/\*.ts + the new test (so typecheck covers them)  | ~4                      |
| `.github/workflows/ci.yml`                              | shard matrix, scripts job, virtual `test` job, artifact rename, guard step | ~120 (net, mostly add)  |
| `dev-docs/plans/2026-07-26-issue-2707-test-sharding.md` | this doc                                                                   | —                       |

**Estimated total: ~9 files, ~600 net new lines** (well under the 25-file /
1500-line soft cap and the 40-file / 2500-line hard cap).

## Expected paths

- Local full suite: `npm run test` (unchanged) → all 16 workspaces + scripts.
- Local one shard: `bun scripts/test.ts --shard cli`.
- CI: matrix over `shard ∈ {cli, agents, providers, core, rest, scripts}`
  × `os ∈ {ubuntu-latest, macos-latest}`, each leg runs
  `bun scripts/test.ts --shard ${{ matrix.shard }}` (the `scripts` shard
  runs `npm run test:scripts`).
- Completeness guard: `bun scripts/check-test-shards.ts` runs in CI before
  the matrix and locally via `npm run lint:test-shards`.

## Scope ledger

| Entry                                                    | Status                                                                                                                                                         |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shard map + guard + tests                                | In scope (slice 1)                                                                                                                                             |
| `--shard` orchestrator flag + tests                      | In scope (slice 2)                                                                                                                                             |
| CI matrix + scripts split + virtual test job + artifacts | In scope (slice 3)                                                                                                                                             |
| Build-once artifact sharing                              | **Deferred** (non-goal; revisit separately)                                                                                                                    |
| Per-package cost reduction                               | **Out of scope** (separate issues)                                                                                                                             |
| Branch-protection ruleset change                         | **Required** — update required checks from per-os `Test (…)` names to the single virtual `Test` check (post-merge repo settings change, called out in PR body) |
| nightly.yml / luther.yml changes                         | **Out of scope** (unaffected)                                                                                                                                  |

Stop-and-ask triggers (per policy): adding a new subsystem/public
abstraction beyond the shard map; changing a workflow other than ci.yml;
touching package vitest configs; exceeding 25 files or 1500 net lines.

## Local command ergonomics (A4)

The canonical local command remains **`npm run test`** — it is unchanged
(`npm run test --workspaces --if-present`) and still runs every workspace
sequentially plus the script harness. The `--shard` flag is a CI-only
entry point; it does not alter the default path.

For local shard-specific runs:

- `bun scripts/test.ts --shard cli` — only the cli workspace.
- `bun scripts/test.ts --shard scripts` — only the script harness.
- `bun scripts/test.ts --shard rest` — the 12 small packages.

The completeness guard is runnable locally via
`npm run lint:test-shards`.

## Verification plan

- `bun scripts/test.ts --shard cli` runs only the cli workspace.
- `bun scripts/check-test-shards.ts` passes; temporarily removing a
  workspace from the map makes it fail (covered by unit test).
- `npm run lint` / `typecheck` / `format` / `build` pass.
- On the PR: sum of `Test Files` across all shards ≈ pre-change total
  (~1819); no workspace missing.
- ocr (≤2 local + ≤2 PR runs per the policy).

## Before/after wall-clock (plan)

- **Before (sequential, per os):** ~1356s (sum of all workspaces) +
  ~270s (test:scripts) ≈ **1626s ≈ 27 min**.
- **After (sharded, per os):** critical path = `max(cli≈703s, agents≈289s,
providers≈185s, core≈130s, rest≈55s)` + per-shard build (~78s) ≈ **~781s
  ≈ 13 min**, with `scripts` (~270s) running in parallel as its own job.
  The cli shard dominates; pairing with the cli cost-reduction issue
  (separate) brings the critical path to `agents≈289s` ≈ ~5 min + build.
