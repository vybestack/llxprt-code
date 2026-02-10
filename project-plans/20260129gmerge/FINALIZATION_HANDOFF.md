# 20260129gmerge Finalization Handoff

Use this checklist once shell command execution is restored.

## 1) Sanity check shell/tooling

Run:

- `echo shell-ok`
- `git status`

If shell commands still fail with `posix_spawnp failed`, stop and fix environment first.

## 2) Review branch state before commit

Run:

- `git status`
- `git diff HEAD`
- `git log -n 3`

## 3) Optional verification rerun

If you want to rerun verification before commit:

- `npm run lint`
- `npm run typecheck`
- `npm run build`
- `npm test` (optional; known baseline unrelated failures may remain)

## 4) Commit using prepared full-branch message

Draft message is in:

- `project-plans/20260129gmerge/COMMIT_MESSAGE_DRAFT.md`

Commit flow:

- `git add -A`
- `git commit -F project-plans/20260129gmerge/COMMIT_MESSAGE_DRAFT.md`
- `git status`

## 5) Push branch

- `git push -u origin 20260129gmerge`

## 6) Create PR (full branch scope, not last-fix-only)

PR body draft is in:

- `project-plans/20260129gmerge/PR_BODY_DRAFT.md`

Create PR:

- `gh pr create --repo vybestack/llxprt-code --base main --head 20260129gmerge --title "feat(sync): finalize 20260129gmerge v0.15.4 to v0.16.0 reconciliation and interactive shell delivery" --body-file project-plans/20260129gmerge/PR_BODY_DRAFT.md`

## 7) Monitor CI checks

After PR creation, watch checks:

- `gh pr checks PR_NUMBER --repo vybestack/llxprt-code --watch --interval 300`

Replace `PR_NUMBER` with the created PR number.

## Validation context to mention in PR/commit

- Full verification run results:
  - lint: pass
  - typecheck: pass
  - build: pass
  - test: not fully green due to branch-baseline unrelated failures
- Targeted touched-area tests pass:
  - `src/ui/hooks/shellCommandProcessor.test.ts`
  - `src/ui/hooks/useGeminiStream.dedup.test.tsx`
  - `src/ui/components/AnsiOutput.test.tsx`
- Tracking issue:
  - `#1304`
