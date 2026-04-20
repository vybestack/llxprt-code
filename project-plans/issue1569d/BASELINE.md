# Issue #1569d — Lint Baseline

This file records the repo-wide lint baseline captured at the start of the
issue1569d effort. It is the reference point against which every rule
promotion will be measured.

## Run metadata

- Branch: `issue1569d`
- Commit at time of run: `78bd841fbb05ad599ae866ae06ebc2884109ad8c`
- Date: 2026-04-20
- Command: `NODE_OPTIONS=--max-old-space-size=6144 npx eslint . --ext .ts,.tsx --format json`
- ESLint exit code: 0

## Totals

| Metric | Count |
|---|---:|
| Files linted | 2345 |
| Files with at least one issue | 1204 |
| Total warnings | 10456 |
| Total errors | 0 |
| Distinct rules triggered | 87 |

Acceptance criterion (6) from issue #1569 ("baseline warning count documented")
is satisfied by this file.

## Per-rule counts (sorted by total issues, descending)

| # | Rule | Warnings | Errors |
|---|---|---:|---:|
| 1 | `@typescript-eslint/no-unnecessary-condition` | 2166 | 0 |
| 2 | `@typescript-eslint/strict-boolean-expressions` | 1979 | 0 |
| 3 | `@typescript-eslint/prefer-nullish-coalescing` | 1094 | 0 |
| 4 | `sonarjs/nested-control-flow` | 697 | 0 |
| 5 | `vitest/no-conditional-in-test` | 501 | 0 |
| 6 | `vitest/no-conditional-expect` | 437 | 0 |
| 7 | `max-lines-per-function` | 399 | 0 |
| 8 | `complexity` | 335 | 0 |
| 9 | `sonarjs/regular-expr` | 310 | 0 |
| 10 | `sonarjs/todo-tag` | 249 | 0 |
| 11 | `sonarjs/no-ignored-exceptions` | 168 | 0 |
| 12 | `sonarjs/expression-complexity` | 155 | 0 |
| 13 | `sonarjs/too-many-break-or-continue-in-loop` | 155 | 0 |
| 14 | `vitest/require-to-throw-message` | 137 | 0 |
| 15 | `sonarjs/no-nested-conditional` | 128 | 0 |
| 16 | `sonarjs/cognitive-complexity` | 122 | 0 |
| 17 | `sonarjs/different-types-comparison` | 112 | 0 |
| 18 | `max-lines` | 109 | 0 |
| 19 | `sonarjs/slow-regex` | 73 | 0 |
| 20 | `sonarjs/no-collapsible-if` | 68 | 0 |
| 21 | `sonarjs/no-undefined-argument` | 63 | 0 |
| 22 | `sonarjs/no-unused-collection` | 59 | 0 |
| 23 | `sonarjs/no-inconsistent-returns` | 56 | 0 |
| 24 | `eslint-comments/disable-enable-pair` | 55 | 0 |
| 25 | `vitest/expect-expect` | 52 | 0 |
| 26 | `@typescript-eslint/prefer-optional-chain` | 43 | 0 |
| 27 | `sonarjs/constructor-for-side-effects` | 43 | 0 |
| 28 | `@typescript-eslint/no-misused-promises` | 41 | 0 |
| 29 | `sonarjs/assertions-in-tests` | 41 | 0 |
| 30 | `@typescript-eslint/switch-exhaustiveness-check` | 41 | 0 |
| 31 | `vitest/require-top-level-describe` | 39 | 0 |
| 32 | `sonarjs/no-nested-template-literals` | 36 | 0 |
| 33 | `sonarjs/no-nested-incdec` | 34 | 0 |
| 34 | `sonarjs/destructuring-assignment-syntax` | 31 | 0 |
| 35 | `sonarjs/no-os-command-from-path` | 31 | 0 |
| 36 | `sonarjs/bool-param-default` | 28 | 0 |
| 37 | `sonarjs/no-identical-functions` | 28 | 0 |
| 38 | `sonarjs/no-misleading-array-reverse` | 25 | 0 |
| 39 | `sonarjs/no-duplicated-branches` | 21 | 0 |
| 40 | `sonarjs/generator-without-yield` | 21 | 0 |
| 41 | `sonarjs/file-permissions` | 20 | 0 |
| 42 | `sonarjs/duplicates-in-character-class` | 20 | 0 |
| 43 | `sonarjs/public-static-readonly` | 19 | 0 |
| 44 | `sonarjs/no-redundant-jump` | 17 | 0 |
| 45 | `sonarjs/concise-regex` | 16 | 0 |
| 46 | `sonarjs/os-command` | 13 | 0 |
| 47 | `sonarjs/no-dead-store` | 11 | 0 |
| 48 | `sonarjs/use-type-alias` | 10 | 0 |
| 49 | `sonarjs/updated-loop-counter` | 10 | 0 |
| 50 | `sonarjs/encryption` | 10 | 0 |
| 51 | `sonarjs/no-control-regex` | 7 | 0 |
| 52 | `sonarjs/no-redundant-assignments` | 7 | 0 |
| 53 | `sonarjs/single-char-in-character-classes` | 7 | 0 |
| 54 | `sonarjs/for-in` | 6 | 0 |
| 55 | `no-lonely-if` | 6 | 0 |
| 56 | `sonarjs/no-primitive-wrappers` | 6 | 0 |
| 57 | `sonarjs/no-function-declaration-in-block` | 5 | 0 |
| 58 | `no-restricted-imports` | 5 | 0 |
| 59 | `sonarjs/argument-type` | 5 | 0 |
| 60 | `sonarjs/no-gratuitous-expressions` | 5 | 0 |
| 61 | `sonarjs/no-async-constructor` | 4 | 0 |
| 62 | `sonarjs/no-unsafe-unzip` | 4 | 0 |
| 63 | `sonarjs/prefer-single-boolean-return` | 4 | 0 |
| 64 | `sonarjs/no-nested-assignment` | 4 | 0 |
| 65 | `sonarjs/no-redundant-optional` | 4 | 0 |
| 66 | `sonarjs/single-character-alternation` | 4 | 0 |
| 67 | `no-console` | 4 | 0 |
| 68 | `sonarjs/no-all-duplicated-branches` | 3 | 0 |
| 69 | `sonarjs/no-redundant-boolean` | 3 | 0 |
| 70 | `sonarjs/no-selector-parameter` | 3 | 0 |
| 71 | `vitest/max-nested-describe` | 3 | 0 |
| 72 | `sonarjs/regex-complexity` | 3 | 0 |
| 73 | `sonarjs/redundant-type-aliases` | 3 | 0 |
| 74 | `sonarjs/no-built-in-override` | 3 | 0 |
| 75 | `sonarjs/no-empty-test-file` | 2 | 0 |
| 76 | `sonarjs/hashing` | 2 | 0 |
| 77 | `sonarjs/no-tab` | 2 | 0 |
| 78 | `sonarjs/no-invariant-returns` | 2 | 0 |
| 79 | `import/no-duplicates` | 2 | 0 |
| 80 | `sonarjs/no-small-switch` | 2 | 0 |
| 81 | `sonarjs/no-element-overwrite` | 2 | 0 |
| 82 | `sonarjs/no-inverted-boolean-check` | 1 | 0 |
| 83 | `sonarjs/max-switch-cases` | 1 | 0 |
| 84 | `sonarjs/strings-comparison` | 1 | 0 |
| 85 | `sonarjs/no-nested-switch` | 1 | 0 |
| 86 | `sonarjs/no-hardcoded-ip` | 1 | 0 |
| 87 | `sonarjs/file-name-differ-from-class` | 1 | 0 |

## Notes

- No rule currently produces errors, only warnings. Errors will begin to
  appear as each rule is promoted to `error` globally in subsequent
  batches. The plan requires rule-by-rule promotion only after the rule has
  been driven to zero warnings repo-wide.
- `max-lines` is already enabled as a warning in at least one scope (109
  warnings reported), but not yet globally. C5-PREP will enable it globally
  as `warn` and capture the offender list separately.
- Any rule that does not appear in the table above currently produces no
  issues. Global promotion of such a rule should be a zero-risk change.
