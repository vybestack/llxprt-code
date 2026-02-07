# PR Checklist (20260129gmerge)

Use this checklist at PR creation time to ensure the final submission is branch-wide and reviewer-ready.

## Scope and messaging

- [ ] PR title reflects full branch sync/reconciliation scope, not only latest shell fix.
- [ ] PR summary explicitly states this lands the complete `20260129gmerge` branch outcome.
- [ ] PR includes both:
  - upstream reconciliation context
  - interactive shell delivery + follow-up fixes

## Required references

- [ ] Tracking issue linked: `#1304`
- [ ] Planning/audit docs referenced:
  - `project-plans/20260129gmerge/PLAN.md`
  - `project-plans/20260129gmerge/CHERRIES.md`
  - `project-plans/20260129gmerge/AUDIT.md`
  - `project-plans/20260129gmerge/NOTES.md`
  - `project-plans/20260129gmerge/PROGRESS.md`

## Verification reporting

- [ ] Include full-run status:
  - lint pass
  - typecheck pass
  - build pass
  - full test suite not fully green (baseline unrelated failures)
- [ ] Include passing targeted tests for touched areas:
  - `src/ui/hooks/shellCommandProcessor.test.ts`
  - `src/ui/hooks/useGeminiStream.dedup.test.tsx`
  - `src/ui/components/AnsiOutput.test.tsx`
- [ ] Mention baseline failing suites observed in full test run:
  - `src/debug/FileOutput.test.ts`
  - `src/services/shellExecutionService.raceCondition.test.ts`
  - `src/config/settings.test.ts` transform error (`settings` redeclared)

## Code cleanliness

- [ ] No temporary investigation logging left in source files.
- [ ] No temporary cursor-debug scripts present in workspace.
- [ ] Commit includes finalization docs prepared during blocker period.

## Post-PR

- [ ] Start CI watcher:
  - `gh pr checks PR_NUMBER --repo vybestack/llxprt-code --watch --interval 300`
