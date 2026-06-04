# Issue #1569d — Finish the lint hardening that #1569 actually asked for

## Context

GitHub issue #1569 asked for strict lint/complexity rules on `packages/core` and
`packages/cli` to match `packages/lsp` and `packages/ui`. Its stated end goal
was **zero warnings** once god objects are decomposed, with rules incrementally
promoted from `warn` to `error`.

PR #1901 (branch `issue1569c`) closed the issue by promoting exactly two rules
globally to `error`:

- `vitest/prefer-strict-equal`
- `@typescript-eslint/consistent-type-imports`

Everything else on the earlier plan (`project-plans/issue1569c/PLAN.md`,
`BATCH_INVENTORY.md`, and the six rule-family docs) remained either at `warn`
globally or was only enforced inside a narrow file-scoped override for one
batch's fixed files. Post-merge the repo still carries roughly **10,463
warnings**.

This plan finishes the job. It does not re-open the closed issue; it is a
follow-through on the same stated goal.

## Non-negotiable execution rules

1. **Subagents do the work, not the coordinator.** The coordinator (this
   session) manages the todo list, freezes file lists, triggers subagents,
   aggregates status, and decides on rollback. The coordinator does not edit
   production code or write tests.
2. **Two subagent roles per batch, always.**
   - **Implementer**: `typescriptexpert` (fallback: `fallbacktypescriptcoder`).
     Receives the fixed file list, the single target rule, and the full
     behavioural prompt including verification requirements.
   - **Verifier/Reviewer**: `deepthinker`. Runs after the implementer, with
     the same fixed file list and the expected post-conditions. The verifier
     is not told how many times the batch has been reviewed. No "re-review" or
     "REVISED" framing ever.
3. **No batch exits without the full verification loop passing.** See
   "Verification" below. The verifier is responsible for certifying it, not
   the implementer.
4. **One primary rule per batch.** Promoted globally to `error` if and only if
   the verifier confirms zero warnings for that rule across the repo after the
   batch (or across an explicit scope if the rule is intentionally scoped,
   e.g. vitest rules on test files).
5. **Fixed file lists only.** Subagents do not choose files dynamically. If a
   batch turns out to need more files, the coordinator splits it before
   execution, not during.
6. **Opportunistic fixes are forbidden.** Subagents touch only the target rule
   in the target files. Unrelated warnings in those files are left alone
   unless they block the primary rule fix.
7. **Commit after every batch passes verification.** No multi-batch commits.
   Commit message format: `refactor(lint): promote <rule> to error (Fixes #1569)`
   (or `refactor(lint): pay down <rule> in <scope>` for sweeping passes that
   don't yet promote to error).
8. **Do not touch `.llxprt/`.**
9. **No time estimates anywhere.** Magnitude/LoC is fine.
10. **Never downscope without user permission.** If a rule cannot be driven
    to zero without unbounded work, stop and ask the user whether to scope
    down or defer.

## Definition of done for this plan

- [ ] Baseline warning count is documented in
      `project-plans/issue1569d/BASELINE.md` before any fix batch runs.
- [ ] Every rule listed in the "Global promotion targets" table below is at
      `'error'` globally (or at error within its intended scope, e.g. vitest
      rules on test files).
- [ ] Repo-wide `npm run lint` reports **0 warnings, 0 errors**.
- [ ] `npm run test`, `npm run typecheck`, `npm run format`, `npm run build`
      all pass.
- [ ] Synthetic smoke (`node scripts/start.js --profile-load synthetic "write
      me a haiku and nothing else"`) exits 0.
- [ ] PR opened referencing #1569 with a final warning-count delta and a
      per-rule promotion table.

## Global promotion targets

These are the rules that must end at `'error'` globally (or within their
intended scope) before the plan is done. Existing `'error'` state is noted.

### Already at `'error'` globally (from #1569c / earlier work)
- `@typescript-eslint/consistent-type-imports`
- `vitest/prefer-strict-equal`

### Must be promoted to `'error'` globally by this plan
Test discipline (scoped to test file globs):
- `vitest/require-to-throw-message`
- `vitest/expect-expect`
- `vitest/no-conditional-expect`
- `vitest/no-conditional-in-test`
- `vitest/require-top-level-describe`
- `vitest/max-nested-describe`

Type-only import / import hygiene: (done — kept here for completeness)

Readability:
- `no-else-return`
- `no-lonely-if`
- `no-unneeded-ternary`
- `@typescript-eslint/prefer-optional-chain`

Boolean / nullish correctness:
- `@typescript-eslint/switch-exhaustiveness-check`
- `@typescript-eslint/prefer-nullish-coalescing`
- `@typescript-eslint/no-unnecessary-condition`
- `@typescript-eslint/strict-boolean-expressions`
- `@typescript-eslint/no-misused-promises`

Complexity / size (these require real decomposition work):
- `complexity` (cap 15)
- `max-lines-per-function` (cap 80)
- `max-lines` (cap 800) — **currently not enabled globally at all; must be
  added as `warn` first, baseline recorded, then paid down and promoted.**
- `sonarjs/cognitive-complexity` (cap 30)

Sonar maintainability / anti-slop:
- `sonarjs/todo-tag`
- `sonarjs/no-ignored-exceptions`
- `sonarjs/regular-expr`
- `sonarjs/slow-regex`
- `sonarjs/os-command`
- `sonarjs/no-os-command-from-path`
- `sonarjs/nested-control-flow`
- `sonarjs/expression-complexity`
- `sonarjs/no-nested-conditional`
- `sonarjs/no-collapsible-if`
- `sonarjs/no-identical-functions`
- `sonarjs/no-duplicated-branches`
- `sonarjs/no-all-duplicated-branches`
- `sonarjs/no-inconsistent-returns`
- `sonarjs/too-many-break-or-continue-in-loop`

### Explicitly turned off (unchanged from #1569c policy)
- web/browser/AWS/infra SonarJS rules
- `sonarjs/no-reference-error`
- `sonarjs/declarations-in-global-scope`
- `sonarjs/variable-name`
- `sonarjs/no-undefined-assignment`
- `sonarjs/void-use`
- `sonarjs/no-nested-functions`
- `sonarjs/cyclomatic-complexity`
- `sonarjs/max-lines`
- `sonarjs/max-lines-per-function`
- `sonarjs/no-unused-vars`
- `sonarjs/no-unused-function-argument`
- `sonarjs/unused-import`
- `sonarjs/no-implicit-dependencies`
- `sonarjs/deprecation`
- CLI-misfit rules: `sonarjs/process-argv`, `sonarjs/standard-input`,
  `sonarjs/publicly-writable-directories`, `sonarjs/sockets`

Any further "turn off" decision during execution must be explicitly approved
by the user. No silent downscoping.

## Execution model

Each batch runs this workflow:

```text
coordinator
  -> freezes fixed file list and target rule
  -> launches typescriptexpert (implementer) with the full behavioural prompt
  -> waits for implementer to return
  -> launches deepthinker (verifier) with the same scope, blind to prior runs
  -> waits for verifier to return
  -> if verifier green: coordinator runs final check + commits
  -> if verifier red: coordinator decides repair vs revert, reruns the batch
```

### Implementer prompt (template)

```
You are implementing a single-rule lint cleanup batch for issue #1569d.

TARGET RULE: <rule>
TARGET FILES (do not deviate from this list):
  1. <file>
  2. <file>
  ...

TASK:
1. Drive <rule> to zero warnings in the listed files without changing
   observable behaviour.
2. Do not touch any other rule in these files. Do not touch any other file.
3. Preserve existing eslint-disable comments that are legitimately needed for
   other rules.
4. When the listed files are clean, run the full verification suite:
     npm run lint
     npm run typecheck
     npm run test
     npm run format
     npm run build
     node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"
5. Do not push. Do not commit. Do not open a PR. Report back with:
   - the exact file-level warning deltas,
   - any blockers,
   - whether the verification suite is fully green.

RULES:
- No opportunistic fixes.
- No file-list expansion.
- No .llxprt/ modifications.
- If you cannot drive the rule to zero in a listed file without unbounded
  collateral damage, stop and report it. Do not force a fix.
```

### Verifier prompt (template)

```
You are verifying a single-rule lint cleanup batch for issue #1569d.

TARGET RULE: <rule>
TARGET FILES:
  1. <file>
  2. <file>
  ...

CONTEXT:
- You have no information about previous review rounds. Treat this as a fresh
  review. Do not look for "what the implementer fixed"; verify the end state.
- Do not downscope the review.

CHECKS:
1. In the listed files, ESLint reports 0 warnings for <rule>.
2. The listed files still compile (typecheck) and their tests pass.
3. No unrelated behavioural changes were introduced. Flag any diff that is
   not strictly required to satisfy <rule>.
4. If <rule> is intended for global promotion in this batch, verify that the
   rest of the repo is also at 0 warnings for <rule>. If not, list every
   remaining offending file:line.
5. Run and report:
     npm run lint
     npm run typecheck
     npm run test
     npm run format
     npm run build
     node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"

OUTCOME:
- GREEN: all checks pass, no unrelated drift, rule at zero in scope.
- RED: any failure. List concrete remediation requirements.
```

## Verification requirements

The canonical verification suite for this plan is:

```
npm run test
npm run lint
npm run typecheck
npm run format
npm run build
node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"
```

The `tmux-harness.js` / `ollamakimi` checks referenced in #1569c are optional
for this plan and only invoked if a batch explicitly touches interactive UI
behaviour.

## Batch inventory

The canonical batch list lives in
[`BATCH_INVENTORY.md`](./BATCH_INVENTORY.md). The coordinator picks the next
open batch from that file; subagents do not pick.

## PR strategy

- Work lives on branch `issue1569d`.
- Commits land per-batch. Push after every commit.
- PR opens only after at least Phase 1 + Phase 2 + Phase 3 + Phase 4 are
  globally green (mechanical rules done). Phase 5 (god-object decomposition)
  may proceed in follow-up PRs if its scope grows, but each sub-batch must
  still meet the full verification loop before commit.
- PR title: `refactor(lint): finish #1569 lint hardening (Fixes #1569)`.
- The PR body must include the baseline warning count from
  `BASELINE.md` and the final 0-warning evidence.

## Coordination notes

- The coordinator uses `todo_write` / `todo_read` as the single source of
  truth for batch progress.
- Every subagent invocation goes through `llxprt_task` with an explicit
  `subagent_name`, `goal_prompt`, `behaviour_prompts` (if needed), and an
  `output_spec` with at least: `status` (`GREEN`/`RED`), `summary`, and
  `remediation` (empty if green).
- The coordinator never edits code that a subagent is expected to edit.
- The coordinator never lies about verification state.
