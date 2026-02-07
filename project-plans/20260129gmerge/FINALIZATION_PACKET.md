# Finalization Packet (20260129gmerge)

This single document consolidates everything needed to finish branch wrap-up once shell execution is restored.

## Current blocker

Required `git` and `gh` commands cannot run in the current environment due to:

- `posix_spawnp failed`

Until that is fixed, commit/push/PR creation cannot be executed from the agent.

## Tracking issue

- `#1304`

## Commit message draft

Suggested commit title:

- `feat(sync): finalize v0.15.4 to v0.16.0 branch reconciliation and interactive shell UX`

Suggested body:

- Complete the 20260129gmerge branch scope by landing upstream reconciliation, interactive PTY shell integration, and follow-up reliability fixes discovered during validation.
- Highlights:
  - finalize interactive shell rendering/input flow across core and CLI layers
  - fix `!` shell visual lag by preserving cursor-line rendering and resolving pending-tool overlap behavior in live UI state
  - align `!` shell PTY dimensions with configured PTY terminal sizing
  - keep LLM shell and `!` shell behavior consistent while preserving backward-compatible targeting
  - add regression coverage for ANSI cursor-only line rendering and pending tool-group dedupe
  - retain branch planning/audit documentation for full v0.15.4 to v0.16.0 traceability
- Verification:
  - lint pass
  - typecheck pass
  - build pass
  - targeted shell/UI tests pass
  - full test run includes pre-existing unrelated baseline failures
- Refs: `#1304`

Canonical source:

- `project-plans/20260129gmerge/COMMIT_MESSAGE_DRAFT.md`

## PR title and body

Suggested PR title:

- `feat(sync): finalize 20260129gmerge v0.15.4 to v0.16.0 reconciliation and interactive shell delivery`

PR body source:

- `project-plans/20260129gmerge/PR_BODY_DRAFT.md`

The draft explicitly states branch-wide scope and includes:

- upstream reconciliation/reimplementation context
- interactive shell feature delivery
- follow-up fixes from validation
- verification results with baseline-failure disclosure
- issue linkage (`Closes #1304`)

## Verification summary to include

From `project-plans/20260129gmerge/VERIFICATION_SUMMARY.md`:

- Full run:
  - `npm run lint` pass
  - `npm run typecheck` pass
  - `npm run build` pass
  - `npm run test` not fully green
- Baseline unrelated failures observed in full run:
  - `src/debug/FileOutput.test.ts`
  - `src/services/shellExecutionService.raceCondition.test.ts` (multiple)
  - `src/config/settings.test.ts` transform failure (`settings` redeclared)
- Passing targeted touched-area tests:
  - `src/ui/hooks/shellCommandProcessor.test.ts`
  - `src/ui/hooks/useGeminiStream.dedup.test.tsx`
  - `src/ui/components/AnsiOutput.test.tsx`

## Code-level summary reference

Use this in PR discussion for concrete deltas:

- `project-plans/20260129gmerge/CHANGES_SUMMARY.md`

## Cleanup evidence

Workspace checks and cleanup notes:

- `project-plans/20260129gmerge/CLEANUP_CHECKLIST.md`

## Exact command sequence once environment is fixed

1) Sanity check

- `echo shell-ok`
- `git status`

2) Pre-commit review

- `git status`
- `git diff HEAD`
- `git log -n 3`

3) Optional verification rerun

- `npm run lint`
- `npm run typecheck`
- `npm run build`
- `npm test` (optional; known baseline unrelated failures may remain)

4) Commit

- `git add -A`
- `git commit -F project-plans/20260129gmerge/COMMIT_MESSAGE_DRAFT.md`
- `git status`

5) Push

- `git push -u origin 20260129gmerge`

6) Create PR

- `gh pr create --repo vybestack/llxprt-code --base main --head 20260129gmerge --title "feat(sync): finalize 20260129gmerge v0.15.4 to v0.16.0 reconciliation and interactive shell delivery" --body-file project-plans/20260129gmerge/PR_BODY_DRAFT.md`

7) Watch checks

- `gh pr checks PR_NUMBER --repo vybestack/llxprt-code --watch --interval 300`

## Reviewer-facing checklist

- `project-plans/20260129gmerge/PR_CHECKLIST.md`
