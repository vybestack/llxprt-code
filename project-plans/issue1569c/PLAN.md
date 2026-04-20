# Issue #1569c: Rule-by-Rule Lint Cleanup Plan

## Overview

Raise core/cli lint quality to a TypeScript-first, Node/CLI-appropriate standard before the Bun migration by fixing warnings rule-by-rule instead of repeating the failed "fix everything at once" approach.

This plan is intentionally structured around **small, fixed, preselected batches**:

1. Temporarily promote one target rule from `warn` to `error`
2. Use a fixed file list chosen in advance
3. Assign `deepthinker` to analyze and review that fixed file list
4. Keep the repo running after each touched file
5. Run the full verification loop before moving to the next batch

This is not a plan to hide bad code by weakening rules. Rules may only be turned off if they are:
- wrong for TypeScript,
- wrong for Node/CLI/ESM,
- or redundant with a stronger existing rule.

## Goals

- Preserve and enforce the explicit complexity/size pressure already added:
  - `complexity`
  - `max-lines`
  - `max-lines-per-function`
  - `sonarjs/cognitive-complexity`
- Keep strict TypeScript linting as the primary quality engine
- Keep `sonarjs/todo-tag`
- Keep anti-slop pressure on tests and maintainability
- Ensure every cleanup phase leaves the repository in a runnable state
- Verify each phase both non-interactively and via the tmux harness
- Prevent another giant unreviewable branch by hard-limiting scope and rollback boundaries

## Batch Safety Rules

These rules are mandatory for execution.

1. Only **one primary lint rule** may be promoted from `warn` to `error` in a batch.
2. A batch may touch at most:
   - **8 production files**, or
   - **12 test-only files**.
3. A batch must stay inside one package or one tightly-coupled subsystem.
4. Implementation subagents may **not** choose files dynamically.
5. Every batch must use:
   - a fixed file list recorded in advance, and
   - the [batch template](./BATCH_TEMPLATE.md).
6. If a batch wants more files, the coordinator must split it into multiple batches before execution.
7. If full verification fails and the issue is not obviously local, revert only that batch and redesign it smaller.
8. Do not stack multiple unverified batches.
9. Do not opportunistically fix a second rule just because the file is open.

## Fixed-File Execution Model

The execution unit is:

```text
one rule
  + one fixed file list
  + one batch rollback boundary
  + full verification
```

Not:
- one package-wide sweep
- one whole rule family across the repo
- one broad codemod across dozens or hundreds of files

The roadmap may be organized by rule family, but **execution is always batch-based**.

## Planning Artifacts

- Overall roadmap: this file
- Fixed-file batch inventory: [BATCH_INVENTORY.md](./BATCH_INVENTORY.md)
- Reusable execution sheet: [BATCH_TEMPLATE.md](./BATCH_TEMPLATE.md)
- Rule-family strategy docs:
  - [rule-family-01-test-discipline.md](./rule-family-01-test-discipline.md)
  - [rule-family-02-type-imports.md](./rule-family-02-type-imports.md)
  - [rule-family-03-readability.md](./rule-family-03-readability.md)
  - [rule-family-04-boolean-nullish.md](./rule-family-04-boolean-nullish.md)
  - [rule-family-05-complexity.md](./rule-family-05-complexity.md)
  - [rule-family-06-sonar-maintainability.md](./rule-family-06-sonar-maintainability.md)

## Rule Policy

### Keep and fix

These are aligned with the project goals and should remain active:

- `complexity`
- `max-lines`
- `max-lines-per-function`
- `sonarjs/cognitive-complexity`
- `sonarjs/nested-control-flow`
- `sonarjs/expression-complexity`
- `sonarjs/no-nested-conditional`
- `sonarjs/no-collapsible-if`
- `sonarjs/no-identical-functions`
- `sonarjs/no-duplicated-branches`
- `sonarjs/no-all-duplicated-branches`
- `sonarjs/no-inconsistent-returns`
- `sonarjs/too-many-break-or-continue-in-loop`
- `@typescript-eslint/no-misused-promises`
- `@typescript-eslint/strict-boolean-expressions`
- `@typescript-eslint/switch-exhaustiveness-check`
- `@typescript-eslint/no-unnecessary-condition`
- `@typescript-eslint/prefer-nullish-coalescing`
- `@typescript-eslint/prefer-optional-chain`
- `@typescript-eslint/consistent-type-imports`
- `vitest/expect-expect`
- `vitest/no-conditional-expect`
- `vitest/no-conditional-in-test`
- `vitest/require-to-throw-message`
- `vitest/prefer-strict-equal`
- `vitest/require-top-level-describe`
- `sonarjs/todo-tag`
- `sonarjs/no-ignored-exceptions`
- CLI-appropriate regex/shell correctness rules such as `sonarjs/regular-expr`, `sonarjs/slow-regex`, `sonarjs/os-command`, and `sonarjs/no-os-command-from-path`

### Turn off only when misfit is proven

These are already identified as wrong-fit or redundant:

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
- CLI-misfit rules such as `sonarjs/process-argv`, `sonarjs/standard-input`, `sonarjs/publicly-writable-directories`, and `sonarjs/sockets`

## Execution Model

Each execution batch follows:

```text
coordinator selects a batch from BATCH_INVENTORY.md
  -> copies BATCH_TEMPLATE.md into a concrete batch sheet if needed
  -> promotes one target rule warn -> error
  -> deepthinker analyzes the fixed file list only
  -> implementation subagent fixes only that rule in only those files
  -> per-file verification loop after each touched file
  -> full batch verification loop
  -> deepthinker review
  -> either complete batch, or revert only that batch and redesign it smaller
```

### Required subagent workflow

For each batch:

1. **Analyzer / reviewer**: `deepthinker`
   - analyze only the fixed file list
   - identify safe/mechanical edits vs behavior-sensitive edits
   - reject scope expansion outside the fixed list
   - review the result after verification

2. **Implementation**: typically `typescriptexpert`
   - fix only the currently targeted rule in the assigned batch
   - do not opportunistically refactor outside scope
   - keep the code running after each file

## Verification Requirements

### Per-file verification loop

After each touched file or tiny cluster:

```bash
npm run lint -- <touched-file-or-files>
npm run typecheck
npm run test -- <related-test-or-package-if-supported>
node scripts/start.js --profile-load ollamakimi "write me a haiku and nothing else"
node scripts/tmux-harness.js
```

### Full verification loop after each batch

```bash
npm run test
npm run lint
npm run typecheck
npm run format
npm run build
node scripts/start.js --profile-load ollamakimi "write me a haiku and nothing else"
node scripts/tmux-harness.js
```

Do not advance to the next batch until the full verification loop passes.

## Execution Order

Use the rule-family docs as roadmap and `BATCH_INVENTORY.md` as the actual execution queue.

Recommended family order:
1. test discipline and highly mechanical test fixes
2. type-only imports and import hygiene
3. low-risk readability simplifications
4. boolean/nullish correctness
5. complexity, size, and decomposition hotspots
6. Sonar maintainability and anti-slop rules

Within each family, execute only one fixed batch at a time.

## Acceptance Criteria

- [ ] Every implementation pass uses a fixed file list recorded in advance
- [ ] No implementation pass allows the execution subagent to choose its own files dynamically
- [ ] Every batch has a clear rollback boundary
- [ ] No batch exceeds the file-count cap
- [ ] After each file, the repo remains runnable
- [ ] After each batch, the full verification loop passes
- [ ] No rule is disabled merely because the current code violates it heavily
- [ ] Complexity/size rules remain active and are progressively paid down
- [ ] `sonarjs/todo-tag` remains active
- [ ] The non-interactive `ollamakimi` smoke test passes after each batch
- [ ] The tmux harness interactive smoke test passes after each batch

## Coordination Notes

This plan is designed for controlled subagent-based execution:

1. **deepthinker** — fixed-file batch analysis, risk analysis, post-fix review
2. **typescriptexpert** — implementation of the targeted batch
3. **coordinator** — severity changes, file-list freezing, verification, rollback decisions, and sequencing

The roadmap documents are intentionally broader than the execution units. If there is any conflict between a rule-family document and the batch safety rules in this file, **the batch safety rules win**.
