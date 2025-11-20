# 20251119gmerge Cherry-pick Plan

## Goal
Bring llxprt-code up to parity with google-gemini/gemini-cli through tag `v0.7.0`, applying all commits marked "pick" in `project-plans/20251119gmerge/upstream-v0.6.1-to-v0.7.0-cherrypicks.md` (including message-bus prerequisites) while preserving llxprt customizations.

## Source Material
- Canonical pick/skip list: `project-plans/20251119gmerge/upstream-v0.6.1-to-v0.7.0-cherrypicks.md`
- Message bus prerequisites (from upstream main):
  - `ba85aa49c` – Message bus foundation
  - `b8df8b2ab` – ASK_USER UI wiring
  - `bf80263bd` – Message bus + policy engine integration
  - `b188a51c3` – Tool execution confirmation hook
  - `064edc52f` – Config-based policy engine (TOML)
  - `ffc5e4d04` – Policy engine into core package
  - `f5bd474e5` – Prevent server name spoofing
  - `c81a02f8d` – Discovered tools integrate with policy engine

## High-level Workflow
1. **Branch creation**: work from `20251119gmerge` (create/check out when permissions allow).
   2. **Batching strategy**:
      - Standard batches contain *exactly five* chronologically ordered "pick" commits.
      - Any commit marked "Risk", "Reimplementation required", or expected to conflict heavily (e.g., message-bus series, policy engine moves, CLI bootstrap refactor) is isolated into its own batch.
      - Message-bus prerequisite commits form their own dedicated batch sequence before dependent commits.
   3. **For each batch**:
      1. Cherry-pick commits (oldest to newest within the batch), resolving conflicts immediately.
      2. Run the full verification suite:
         ```bash
         npm run lint
         npm run build
         npm run typecheck
         npm run test
         npm run format
         node scripts/start.js --profile-load synthetic --prompt "write me a haiku"
         ```
         - Re-run any failing step after applying fixes until everything passes.
      3. Update `project-plans/20251119gmerge/upstream-v0.6.1-to-v0.7.0-cherrypicks.md` to mark the batch items as "landed" (e.g., checkmarks or status column).
      4. Document the batch in the table below (commit hashes, conflicts, fixes, verification results).
      5. Commit with a message like `chore: cherry-pick batch N (commits...)`.
4. **Post-batch maintenance**:
   - After every commit that required manual fixups, ensure relevant tests or docs are expanded as needed.
   - Keep `project-plans/20251119gmerge/odc.md` in sync if decisions change.

## Special Handling
- **Message bus & policy engine**: apply prerequisite commits individually in chronological order so subsequent tool integration is clean.
- **CLI bootstrap refactors (e.g., deferred initialization)**: isolate and test carefully because they touch startup, sandboxing, and multi-provider runtime.
- **Docs/branding updates**: adapt wording to llxprt (OpenAI/Anthropic references, etc.) before running format.

### Deferred Initialization Sequencing
Claude flagged that upstream implemented deferred initialization around commit #150, and commit #171 (`ce92ed3f`) fixes a sandbox bug that depends on it. Follow this order:
1. Cherry-pick batches covering commits #1–#149.
2. Pause the gmerge, execute `project-plans/20251119gmerge/cli-deferred-init.md` (review upstream commit `7e170527`, adjust prompts in `packages/core/src/prompt-config/defaults/service-defaults.ts` if bootstrap UX changes, and land the llxprt reimplementation).
3. Re-run the verification stack and document results.
4. Resume cherry-picking with commit #150 onward, **skipping** upstream commit `7e170527` (already reimplemented) but **picking** dependent fixes such as #171 (`ce92ed3f`).
5. When commit #171 is reached, cherry-pick it normally since our runtime now mirrors the upstream expectations.

### Batch Breakdown
To remove guesswork, the 59 “pick” commits from `upstream-v0.6.1-to-v0.7.0-cherrypicks.md` are pre-sliced into 13 batches. Work them in order; every entry shows the upstream numbering/hash and a short note is available in the pick list file.

**Pre–deferred-init batches**
- **Batch 01:** #1 `d2b8ff5d`, #3 `13a65ad9`, #5 `d54cdd88`, #6 `6756a8b8`, #13 `d746eb7b`
- **Batch 02:** #17 `2d406ffc`, #31 `853ae56e`, #33 `2c754d71`, #34 `92c99d78`, #36 `db5b49b2`
- **Batch 03:** #37 `899b6f72`, #38 `a34e3751`, #39 `1f31443e`, #41 `ec0acc48`, #44 `22b7d865`
- **Batch 04:** #73 `e48f61bd`, #93 `2c4f61ec`, #95 `fa8cea17`, #96 `dd91b0a6`, #103 `3bf8fec2`
- **Batch 05:** #104 `c8ad8310`, #106 `5be2a9d5`, #108 `532497b3`, #109 `c564464e`, #110 `37c53973`
- **Batch 06:** #111 `0152759d`, #113 `44691a4c`, #115 `468db873`, #116 `2216856e`, #117 `375b8522`
- **Batch 07:** #119 `a1dc7a8f`, #121 `b4455af3`, #122 `8fdb61aa`, #123 `d9828e25`, #124 `6869dbe6`
- **Batch 08:** #126 `81d03cb5`, #128 `9abb165f`, #130 `34c14b7d`, #133 `6c559e23`, #136 `710e00e0`
- **Batch 09:** #140 `9c4d1594`, #141 `525ced29`, #142 `d7a0dbc6`, #144 `4cdf9207`, #145 `570b0086`
- **Batch 10:** #146 `47948e37`, #147 `712dc245`, #149 `40db0298` (only three commits; still run the full verification suite)

**Post–deferred-init batches**
- **Batch 11:** #151 `52183238`, #152 `c93eed63`, #155 `5151bedf`, #156 `d8393a06`, #160 `31c609da`
- **Batch 12:** #169 `38e053b7`, #170 `c6f8ecc2`, #171 `ce92ed3f` *(sandbox fix that depends on our deferred-init work)*, #173 `2fbfeb39`, #174 `89aba7cb`
- **Batch 13:** #176 `d39cd045` (solo batch; isolates the Zed integration fix and keeps 5-commit discipline intact)

### High-risk / Single-commit Micro-batches
Some picks touch surfaces where llxprt diverges significantly from upstream. Run these as their own micro-batches (cherry-pick + verification) even though they appear inside the lists above:
- **#133 `6c559e23` (permissions command)** – rewires trust settings UX, so confirm it respects llxprt’s multi-provider trust model before touching surrounding commits.
- **#145 `570b0086` (extensions consent refactor)** – edits CLI consent prompts, GitHub release handling, and trusted folder UX; conflicts likely with our existing consent patches.
- **#155 `5151bedf` (/model command)** – intersects our provider-switching logic; expect to adapt the command to llxprt’s multi-provider selection flow.
- **#173 `2fbfeb39` (AbortSignal tool execution)** – modifies the tool runner pipeline and retry logic; verify compatibility with our tool batching before proceeding to #174+.

## Tracking Table
Update after each batch.

| Batch | Commits | Status | Verification Notes | Follow-ups |
|-------|---------|--------|--------------------|------------|
| 1 | _TBD_ | ☐ Not Started |  |  |
| 2 | _TBD_ | ☐ Not Started |  |  |
| ... |  |  |  |  |

(Add rows as needed. Mark each batch with ✅ once merged locally.)

## Commands Reference
- Cherry-pick single commit: `git cherry-pick -x <hash>`
- Resolve conflicts, then `git add ...` and `git cherry-pick --continue`
- Abort batch if needed: `git cherry-pick --abort`
- Record progress: update this file and `odc.md`, then `git add project-plans/20251119gmerge/*.md`

> **Note:** `project-plans/20251119gmerge/odc.md` mirrors the filtered pick/skip table from `project-plans/20251119gmerge/upstream-v0.6.1-to-v0.7.0-cherrypicks.md`. That document already excludes commits we intentionally skipped for telemetry or release/workflow automation, so the ODC file is not the full upstream log.

### Follow-up: CLI Deferred Initialization
- Upstream commit `7e170527` cannot be cherry-picked verbatim because their bootstrap pipeline is Gemini-only.
- Action: file a dedicated plan (e.g., `project-plans/cli-deferred-init/plan.md`) to re-implement deferred initialization in llxprt, following `dev-docs/RULES.md` (test-first, minimal config touching before relaunch).
- Link this gmerge plan to that future plan once created.
