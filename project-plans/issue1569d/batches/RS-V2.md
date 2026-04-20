# RS-V2 — vitest/expect-expect

Baseline: 52 warnings across 15 files (post-RS-V1 lint at commit `4065a0ed4`).

## Two-part batch

### Part A — rule configuration (no code changes)

The rule `vitest/expect-expect` currently uses the default
`assertFunctionNames: ['expect']`. Property-based tests written with
`fast-check` use `fc.assert(fc.property(...))` as their assertion entry
point; the contained `fc.property(...)` predicate is a real assertion
(when it returns `false`, `fc.assert` throws with a shrunk
counter-example). These tests ARE asserting; the rule simply does not
recognise the assertion helper.

Action: widen `assertFunctionNames` to `['expect', 'fc.assert']` in the
vitest test-files block in `eslint.config.js`. Apply to both the
existing `'warn'` entry (main block) and the existing `'error'` entry
(T1D file-scoped override — which will be removed when the global rule
is promoted at end of batch).

Expected warning reduction from Part A:

| File                                                                 | Warnings |
|----------------------------------------------------------------------|----------|
| packages/cli/src/ui/commands/__tests__/continueCommand.spec.ts       | 2        |
| packages/cli/src/utils/__tests__/formatRelativeTime.spec.ts          | 7        |
| packages/core/src/core/__tests__/geminiChat-density.test.ts          | 8        |

Total Part A: -17 warnings.

### Part B — add real `expect(...)` assertions (scoped list)

Remaining 35 warnings in 12 files. These are tests whose bodies
exercise code paths but make no assertion about the outcome; many are
placeholder "just verify the dialog works without crashing" tests.
Implementer must add a real `expect(...)` call per flagged test case,
grounded in observable runtime behaviour (e.g. assert no throw via
a spy, assert a rendered frame contains expected text, assert a mock
callback was / was not called). **No `eslint-disable` comments. No
assertion-aliases that merely satisfy the rule (e.g. `expect(true).toBe(true)`
is forbidden).** Tests must fail if the behaviour they nominally
exercise regresses.

Scope (exact file list — frozen):

| # | Count | File                                                                                     | Line:Col                                                    |
|---|-------|------------------------------------------------------------------------------------------|-------------------------------------------------------------|
| 1 | 1     | packages/cli/src/ui/App.test.tsx                                                         | 1543:5                                                      |
| 2 | 3     | packages/cli/src/ui/components/Footer.test.tsx                                           | 119:5, 157:5, 234:5                                         |
| 3 | 1     | packages/cli/src/ui/components/InputPrompt.test.tsx                                      | 1809:5                                                      |
| 4 | 17    | packages/cli/src/ui/components/SettingsDialog.test.tsx                                   | 351:7, 369:5, 387:5, 422:5, 436:5, 490:5, 523:5, 542:5, 559:5, 577:5, 615:5, 649:5, 792:5, 810:5, 830:5, 930:5, 950:5 |
| 5 | 1     | packages/cli/src/ui/containers/AppContainer/hooks/useSessionInitialization.test.ts       | 151:3                                                       |
| 6 | 1     | packages/cli/src/ui/hooks/useAnimatedScrollbar.test.tsx                                  | 101:3                                                       |
| 7 | 2     | packages/cli/src/ui/hooks/useGeminiStream.test.tsx                                       | 1738:5, 1771:5                                              |
| 8 | 2     | packages/cli/src/utils/sandbox-ssh.test.ts                                               | 758:3, 799:3                                                |
| 9 | 2     | packages/core/src/providers/anthropic/AnthropicProvider.issue1150.toolresult.test.ts     | 1314:5, 1370:5                                              |
| 10| 1     | packages/core/src/scheduler/result-aggregator.test.ts                                    | 88:5                                                        |
| 11| 3     | packages/core/src/services/history/ContentConverters.test.ts                             | 19:5, 44:5, 161:5                                           |
| 12| 1     | packages/core/src/tools/ast-edit/__tests__/cross-file-analyzer.test.ts                   | 67:5                                                        |

Total Part B: 35 warnings across 12 files.

## Deliverables

1. Commit 1 (`chore(lint): widen vitest/expect-expect assertFunctionNames to include fc.assert (RS-V2 part A) (refs #1569)`) — config-only change, reduces count by 17.
2. Commit 2 (`refactor(tests): add real assertions to satisfy vitest/expect-expect (RS-V2 part B) (refs #1569)`) — test-file changes, drives the remaining 35 warnings to zero.
3. Commit 3 (`refactor(lint): promote vitest/expect-expect to error (Fixes #1569)`) — config-only: flip rule from 'warn' to 'error' at the vitest block, remove the now-redundant T1D override.

Success criteria: `npm run lint` reports 0 vitest/expect-expect messages (warn or error); full verification suite green.
