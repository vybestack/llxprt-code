# Rule Family 01: Test Discipline and Highly Mechanical Test Fixes

## Target Rules

- `vitest/prefer-strict-equal`
- `vitest/require-to-throw-message`
- `vitest/expect-expect`
- `vitest/no-conditional-expect`
- `vitest/no-conditional-in-test`
- `vitest/require-top-level-describe`

## Why This Family Comes First

These rules have a strong anti-slop effect and a large portion of the work is mechanical or very localized to tests. They improve confidence for later, riskier cleanup.

## Severity Workflow

Promote one rule at a time from `warn` to `error`.

Recommended order inside this family:
1. `vitest/prefer-strict-equal`
2. `vitest/require-to-throw-message`
3. `vitest/expect-expect`
4. `vitest/require-top-level-describe`
5. `vitest/no-conditional-expect`
6. `vitest/no-conditional-in-test`

The last two are more semantic and should only be promoted after the easier rules are cleared.

## Fixed execution batches

Use only the batches defined in `BATCH_INVENTORY.md` for this family. Do not let the implementation subagent choose files dynamically.

Initial fixed batches:
- `T1A`
- `T1B`
- `T1C`
- `T1D`

Any additional batch for this family must be added to `BATCH_INVENTORY.md` before execution starts.

## deepthinker Assignment Pattern

For each logical unit:
- review the current violations
- identify purely mechanical replacements vs tests whose intent is ambiguous
- flag tests that appear structurally weak and may need behavioral redesign instead of lint-only edits
- after implementation, review whether any test behavior was accidentally weakened

## Implementation Guidance

### Safe/automatic edits
- `toEqual(...)` -> `toStrictEqual(...)` where data shape equality is intended
- add explicit message text to `toThrow(...)` / `rejects.toThrow(...)`
- wrap orphan tests in top-level `describe(...)` if the file structure is otherwise clear

### Review-required edits
- tests that conditionally call `expect(...)`
- tests that contain control flow in the test body and need restructuring
- tests with no assertions because they rely on side effects or snapshots that are not explicit

## Per-File Verification

```bash
npm run lint -- <touched-test-file>
npm run typecheck
npm run test -- <nearest-related-test-target-if-supported>
node scripts/start.js --profile-load ollamakimi "write me a haiku and nothing else"
node scripts/tmux-harness.js
```

## Full Verification After Each Logical Unit

```bash
npm run test
npm run lint
npm run typecheck
npm run format
npm run build
node scripts/start.js --profile-load ollamakimi "write me a haiku and nothing else"
node scripts/tmux-harness.js
```

## Completion Checklist

- [ ] The currently promoted Vitest rule is zero in the targeted unit
- [ ] No test behavior was weakened to satisfy the lint rule
- [ ] Full verification loop passes
- [ ] deepthinker review says the unit is acceptable before the next unit starts
