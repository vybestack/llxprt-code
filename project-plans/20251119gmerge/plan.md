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
