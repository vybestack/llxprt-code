# Issue #1569c Batch Template

Use this template before executing any lint-cleanup batch.

## Batch Metadata

- **Batch ID**:
- **Primary rule**:
- **Severity change**: `warn -> error`
- **Package / subsystem**:
- **Risk level**: low / medium / high
- **Expected file count**:
- **Rollback boundary**: this batch only

## Fixed File List

Do not let the implementation subagent choose files dynamically.

1.
2.
3.
4.
5.
6.
7.
8.

## Why these files belong together

- Same rule shape:
- Same subsystem semantics:
- Similar test coverage:
- Why this batch is small enough to revert safely:

## Pre-flight checks

- [ ] The file list is verified to exist in the repo
- [ ] The primary rule is the only rule being promoted to error in this batch
- [ ] Batch touches at most 8 production files or 12 test files
- [ ] Batch stays within one package or one tightly-coupled subsystem
- [ ] Related tests for this subsystem are identified before edits begin

## deepthinker pre-analysis prompt requirements

Ask deepthinker to:
- analyze only this fixed file list
- identify safe/mechanical edits vs behavior-sensitive edits
- call out any places where this rule is dangerous to fix blindly
- reject scope expansion outside the fixed file list

## Per-file verification loop

After each touched file:

```bash
npm run lint -- <touched-file>
npm run typecheck
npm run test -- <related-area-if-supported>
node scripts/start.js --profile-load ollamakimi "write me a haiku and nothing else"
node scripts/tmux-harness.js
```

## Full batch verification loop

```bash
npm run test
npm run lint
npm run typecheck
npm run format
npm run build
node scripts/start.js --profile-load ollamakimi "write me a haiku and nothing else"
node scripts/tmux-harness.js
```

## Stop / revert rules

Stop immediately if any of these happen:
- verification fails in a way not obviously local to the last small edit
- the implementation wants to add new files beyond the fixed file list
- the implementation wants to fix a second rule opportunistically
- the batch grows beyond its file cap
- behavior becomes unclear and tests do not pin it down

If stopped, revert only this batch and redesign a smaller batch.

## Completion checklist

- [ ] Primary rule is zero in the fixed file list
- [ ] No new files were added to scope mid-batch
- [ ] Full verification loop passes
- [ ] deepthinker signs off
- [ ] Result is safe to commit or proceed from
