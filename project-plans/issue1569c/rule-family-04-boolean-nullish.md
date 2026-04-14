# Rule Family 04: Boolean and Nullish Correctness

## Target Rules

- `@typescript-eslint/strict-boolean-expressions`
- `@typescript-eslint/no-unnecessary-condition`
- `@typescript-eslint/prefer-nullish-coalescing`
- optionally `@typescript-eslint/no-misused-promises` and `@typescript-eslint/switch-exhaustiveness-check` in nearby touched files when tightly related and low scope

## Why This Family Is High Risk

This is the family most likely to create behavioral regressions if fixed mechanically. The prior failed attempt on the earlier branch broke real runtime behavior in this class of changes. Therefore this family must be executed in small, heavily verified units.

## Severity Workflow

Promote one target rule at a time from `warn` to `error`.

Recommended order:
1. `@typescript-eslint/switch-exhaustiveness-check` (small/localized)
2. `@typescript-eslint/no-misused-promises` (often localized)
3. `@typescript-eslint/prefer-nullish-coalescing`
4. `@typescript-eslint/no-unnecessary-condition`
5. `@typescript-eslint/strict-boolean-expressions`

The last two should be treated as the highest-risk subphases.

## Fixed execution batches

Use only the batches defined in `BATCH_INVENTORY.md` for this family. Do not let the implementation subagent choose files dynamically.

Initial fixed batches:
- `BN4A`
- `BN4B`
- `BN4C`
- `BN4D`

These are the highest-risk batches in the entire plan.

Additional execution constraints:
- `BN4A`: 1-3 files max
- `BN4B`: 1-3 files max
- `BN4C`: 1-3 files max
- `BN4D`: 1-2 files max unless tests are unusually strong

Start only with files that already have strong local tests and obvious types.
Avoid historically fragile or very large files until smaller units are clean.

## deepthinker Assignment Pattern

For each unit, deepthinker should:
- review the type shapes involved before implementation starts
- identify places where `||` and `??` are not equivalent
- identify places where falsy values (`0`, `''`, `false`) are semantically meaningful
- identify conditional logic that may be redundant only because of incorrect or stale types
- review the finished patch for behavior drift

## Implementation Guidance

### Safe-ish patterns
- obvious enum switch exhaustiveness
- obvious accidental truthiness on nullable objects
- obvious `foo || defaultValue` that truly means nullish fallback

### Dangerous patterns
- config values where empty string or zero are meaningful
- CLI flags and numeric counters
- provider/model/runtime settings
- test assertions that were written against current truthiness behavior
- guard conditions inside orchestration code

## Per-File Verification

```bash
npm run lint -- <touched-file>
npm run typecheck
npm run test -- <related-area-if-supported>
node scripts/start.js --profile-load ollamakimi "write me a haiku and nothing else"
node scripts/tmux-harness.js
```

In this family, if related-area tests are available, they are mandatory before moving on.

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

- [ ] The promoted rule is zero in the targeted unit
- [ ] Related behavior tests were run and reviewed before the full suite
- [ ] No `||` -> `??` rewrite changed intended behavior
- [ ] No explicit truthiness guard was replaced without understanding the domain semantics
- [ ] Full verification loop passes
- [ ] deepthinker explicitly signs off on semantic safety
