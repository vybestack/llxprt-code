# Issue 3256: Stabilize the save-memory nightly eval

Plan ID: `PLAN-20260828-ISSUE3256`

## Failure evidence

The reported runs fail in `save_memory.eval.ts` after `save_memory` succeeds with the exact fact `My favorite color is blue`. Available artifacts show that the model also uses `todo_write`, then sometimes appends task-status prose after producing `$blue$`. The strict output assertion correctly rejects that extra text. For example, run 33070289550 attempt 2 returned `$blue$Task completed.` while its `save_memory` call succeeded with the expected fact.

The same input passes when the provider does not add the extra task-status response. The August 28 nightly run passed all three attempts, but five of the previous nine nightly runs failed this same assertion. This is a recurring eval-isolation problem rather than missing provider configuration, report collection, or a broken `save_memory` call.

## Accepted behavior

### AC-1: Isolate the eval from todo bookkeeping

Given the `save_memory` behavioral eval, when its CLI test settings are created, then `todo_read`, `todo_write`, and `todo_pause` are excluded while `save_memory` remains available.

This keeps an unrelated task-management loop from adding model turns to an eval that measures memory persistence and an exact response.

### AC-2: Preserve the existing memory contract

Given a model tool call, when the eval validates it, then only a successful `save_memory` call whose normalized `fact` is exactly `My favorite color is blue` passes.

Paraphrases, negations, malformed arguments, missing facts, and wrong colors continue to fail.

### AC-3: Preserve the existing response contract

Given the extracted CLI response, when the eval validates it, then only `$blue$`, allowing case changes and outer whitespace, passes.

Empty output, missing delimiters, wrong colors, multiple answers, and surrounding prose continue to fail. The fix must not weaken this assertion or treat model assertion failures as successful workflow results.

## Inputs and boundaries

- Relevant tools: `save_memory` and the todo tool family observed in failed artifacts.
- Relevant provider behavior: a provider may attempt task bookkeeping even for this focused prompt.
- Out of scope: changing the todo subsystem, changing system prompts or agent memory, changing workflow failure semantics, adding retries or pass-rate thresholds, changing providers, and relaxing exact-value assertions.
- Infrastructure failures, missing reports, malformed reports, and genuine model assertion failures must continue to fail as they do now.

## Test-first implementation

1. Add a failing Bun test that reads the eval declaration and proves all three todo tools are excluded while `save_memory` remains available.
2. Run the focused test and record the expected RED failure.
3. Add only the eval settings needed to exclude the three todo tools.
4. Run the focused test and existing deterministic assertion tests. Confirm the tests that reject wrong facts and extra response prose still pass.
5. Run the full verification cycle and the `stepfun-37` smoke test.
6. Review the final diff for issue scope, then run local Open Code Review.

## Behavioral evidence required for completion

- The new focused test fails before the eval settings change and passes after it.
- Existing exact fact and exact response tests pass unchanged.
- The full local verification cycle passes.
- Candidate-head CI passes.
- Reviews are complete, every finding is classified as Blocker-Fix, In-scope-Fix, Reject, or Defer, and every Blocker-Fix or In-scope-Fix item is resolved.
- The pull request is conflict-free and based on the current `main` ancestry.

## TDD evidence

- RED: the two new tool-isolation tests were run against an isolated `origin/main` snapshot. The existing 42 assertion tests passed, while both isolation tests failed because `excludeTools` was absent. The command exited 1 as expected. Evidence: `tmp/issue3256/red-snapshot/red-focused-test.log`.
- GREEN: after the focused settings change, the complete assertion and isolation file passed with 44 tests and 50 expectations. Evidence: `tmp/issue3256/remediation/focused-test.log`.
- The exact fact and exact response assertions were not modified.

## Review findings and dispositions

### Independent compliance review

The initial `deepthinker` review found that the first standalone regression test was not included in the script TypeScript project. This was classified **In-scope-Fix**. The coverage moved into the existing, typechecked `evals-save-memory-assertion.test.ts`; no TypeScript configuration changed. The follow-up review passed with no unresolved findings.

### Local Open Code Review round 1

1. **Blocker-Fix:** nested `tools.exclude` denied execution but left todo tools in the advertised registry. Resolved by using operative flat `excludeTools`.
2. **In-scope-Fix:** the first test asserted inert `tools.core` configuration. Resolved by removing that setting and assertion; `save_memory` remains registered by default because it is not excluded.
3. **Reject:** make the AST locator support multiple eval declarations and compare tool names without order sensitivity. The file has one focused eval, and the test intentionally checks its exact settings declaration. Multi-case support would be speculative.
4. **In-scope-Fix:** the standalone test lacked script-project typecheck coverage. Resolved together with the compliance finding by moving coverage into the existing typechecked test file.

### Local Open Code Review round 2

The final follow-up confirmed that flat `excludeTools` removes the three todo tools from the registry and policy while leaving `save_memory` registered, and that both changed files are typechecked. It reported three test-maintenance suggestions:

1. **Reject:** change the AST locator to validate every future eval case. This repeats the speculative multi-case suggestion rejected in round 1. The accepted behavior covers the one existing eval case.
2. **Reject:** parse the small source file once in `beforeAll`. The repeated parse is negligible, changes no accepted behavior, and is optional test cleanup.
3. **Reject:** combine the explicit `save_memory` reachability assertion with the exact exclusion-list assertion. The second assertion maps directly to AC-1 and gives that requirement a named test, even though exact array equality also implies it.

No Blocker-Fix or In-scope-Fix findings remain.

## Local verification

- `npm run test`: passed on the final remediated candidate (`tmp/verify3256/full-test-remediation-rerun.log`). The first post-lint-remediation attempt hit an unrelated timing failure in `turn.watchdog.test.ts`; that file passed immediately in isolation before the complete suite rerun passed.
- Focused assertion and isolation tests: 44 passed, 0 failed.
- `npm run lint`: passed (`tmp/verify3256/full-lint-remediation-rerun.log`).
- `npm run typecheck`: passed (`tmp/verify3256/full-typecheck-remediation-rerun.log`).
- `npm run format`: passed (`tmp/verify3256/full-format-remediation-rerun.log`).
- `npm run build`: passed (`tmp/verify3256/full-build-remediation-rerun.log`).
- Required `stepfun-37` smoke test: passed and returned a haiku (`tmp/verify3256/full-smoke-remediation-rerun.log`).
- Test audit: no finding for the touched test and no parse failures.

## PR stage

- **Candidate-head CI lint (In-scope-Fix):** the candidate-head `eslint . --max-warnings 0` run reported `sonarjs/todo-tag` at `scripts/tests/evals-save-memory-assertion.test.ts` lines 448 and 450 because prose comments used the ordinary word `todo` while describing the tool family. The comment phrases were rewritten to `task bookkeeping` and `task-management`; the tool identifiers `todo_read`, `todo_write`, and `todo_pause` are unchanged. No assertion, behavior, suppression, or config changed.
- **PR OCR - future multiple evalTest cases (Reject):** the suggestion to make the AST locator validate every future eval case is speculative. The accepted behavior covers the one existing eval case and does not define multi-case support, which is not part of this issue.
- **PR OCR - order-insensitive comparison / DRY (Reject):** exact ordered declaration comparison is intentional, since the test checks the exact `excludeTools` declaration, and extracting a helper is optional cleanup rather than an accepted behavior change.
- **CodeRabbit - docstring coverage (Reject):** adding docstrings to the small local test AST helpers is unrelated cleanup, and CodeRabbit generated no actionable comments.
