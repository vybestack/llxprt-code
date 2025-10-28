# Phase 11a: Integration & Migration Verification

## Phase ID
`PLAN-20251027-STATELESS5.P11a`

## Prerequisites
- Required: Phase 11 completed.
- Verification: `rg "@plan:PLAN-20251027-STATELESS5.P11" packages/core packages/cli`
- Expected files: `.completed/P11.md`, updated documentation and tests.

## Verification Tasks
- Execute full workspace suite to ensure no regressions.
- Review documentation updates for clarity/accuracy.
- Confirm runtime isolation integration tests cover targeted scenarios.

## Verification Commands
```bash
pnpm lint
pnpm typecheck
pnpm format:check
pnpm build
pnpm test --workspace packages/core --runInBand
pnpm test --workspace packages/cli --runInBand
pnpm test --workspace integration-tests --runInBand
pnpm test --filter "runtime isolation" --runInBand || true
git status --short
```

## Manual Verification Checklist
- [ ] All updated docs align with actual behavior.
- [ ] Test evidence confirms migration success.
- [ ] No stray Config references remain for provider/model/auth outside UI display logic.

## Success Criteria
- Integration complete and validated; only cleanup remains.

## Failure Recovery
1. Address failing commands/tests.
2. Re-run verification commands.

## Phase Completion Marker
Create `project-plans/20251027-stateless5/.completed/P11a.md` consolidating verification logs and reviewer comments.
