# Issue #2777 — Complete PR walkthrough parse-reliability handling

## Policy basis

`dev-docs/workflow/ISSUE-DELIVERY.md` is absent from current `origin/main`, the
GitHub contents API, and local repository history. This plan therefore applies
the bounded issue-delivery policy supplied with the issue request directly.
`dev-docs/RULES.md` governs test-first development and behavioral evidence.

## Problem statement

The walkthrough parser correctly rejects syntactically valid JSON values that
are not objects, but `isParseError()` does not recognize the parser's actual
multiword and hyphenated error prefixes. Those failures therefore bypass the
existing parse retry and diagnostic path. Diagram and related-item synthesis
also call the model and parser directly, bypassing that path. Separately, the
workflow overrides the helper's documented 256000 context default with 200000.

The issue's `.mjs` and `.js` paths are stale after the TypeScript migration. The
accepted implementation uses the corresponding `.ts` files on current main.

## Decision-complete acceptance matrix

| ID | Accepted behavior | Behavioral evidence required |
| --- | --- | --- |
| A1 | Direct JSON arrays, strings, numbers, booleans, and null are classified as parse/response-shape failures. | Focused helper tests feed the real `parseMapResponse()` into `runLlxprtPromptWithParse()`, prove each direct non-object value is retried, and prove a later object response succeeds. |
| A2 | Fenced and balanced-object non-object responses receive the same classification, without broadly classifying unrelated errors. | Focused `isParseError()` cases cover the exact `Fenced JSON parse:` and `Balanced-object parse:` prefixes; existing and added negative cases remain false. |
| A3 | Non-object failures use the existing bounded parse retry count; this issue does not change the count. | A helper test exhausts the existing configured count and observes the exact number of real parser attempts. |
| A4 | Final exhaustion saves the final raw response and phase metadata. | A helper test uses a real temporary directory and `saveParseFailureArtifact()`, then asserts the raw artifact contents and metadata phase/prompt length. |
| A5 | Diagram and related stages both use bounded parse retry and distinct diagnostics phases. | A subprocess behavioral test runs the real private walkthrough pipeline with a temporary review workspace and a fake external `llxprt` executable. It returns non-object output for all diagram and related attempts and asserts three attempts for each plus `diagram` and `related` diagnostic artifacts. |
| A6 | Exhausted optional stages omit only their optional content and do not reject the walkthrough pipeline. | The same subprocess test asserts exit zero, generated walkthrough/comment files, no sequence diagram, and the existing empty-related rendering after both optional stages exhaust. |
| A7 | Required-stage fallback behavior from issue #2742 remains unchanged. | Existing required-phase and graceful-degradation tests pass unchanged; the implementation does not alter map, group, synthesis, or pre-merge fallback branches. |
| A8 | The workflow defaults `LLXPRT_CONTEXT_LIMIT` to 256000 when the repository variable is unset, while an explicit repository variable still wins. | The parsed-workflow test asserts the expression still references `vars.LLXPRT_CONTEXT_LIMIT`, contains the 256000 fallback, and no longer contains the 200000 fallback. |
| A9 | Every accepted behavior has focused behavioral evidence without mock-verification theater or a new public test API. | Focused helper, real-artifact, private-pipeline subprocess, and parsed-workflow tests all pass. The external CLI executable is infrastructure substituted at the process boundary. |
| A10 | Test, lint, typecheck, format, build, and smoke gates pass without suppressions or weakened rules. | Exact-head command results and CI checks are recorded below before completion. |

## Explicit non-goals

- No general malformed-JSON repair, tolerant parser, continuation prompt, or new
  parsing dependency.
- No provider-specific response-format feature.
- No prompt, model-selection, review-scope, review-policy, or reviewer check
  semantics changes.
- No workflow change except the accepted context-default value.
- No retry-count, backoff, required-phase fallback, or artifact-retention change.
- No new subsystem, production module, public export, public abstraction, or
  test-only production dependency-injection surface.
- No changes to `extractJsonObject()`, parser labels, prompt builders, artifact
  readers, rendering behavior, or unrelated tests/refactors.
- No dependency or lockfile change; no agent-memory or quality-tool change.
- No lint/type suppressions, severity downgrades, ignore entries, complexity or
  source-size threshold increases, or other weakened gate.
- No optional cleanup or hardening after accepted behavior and gates are
  complete.

## Bounded vertical slices

### Slice 1 — classify and route non-object responses

1. RED: add direct, fenced, and balanced-object classification/retry tests,
   including exhaustive direct JSON value shapes and an unrelated-error guard.
2. RED: add final-exhaustion evidence using the real parser and real diagnostic
   artifact writer.
3. GREEN: replace the broad single-word regex with exact parser-prefix matching
   in `isParseError()`; leave the retry helper and parser unchanged.
4. Run the focused helper suite.

### Slice 2 — optional-stage retry, diagnostics, and degradation

1. RED: add a subprocess test that creates genuine review artifacts, places a
   deterministic fake `llxprt` executable on `PATH`, and runs the real script.
   Required phases return valid object responses; diagram and related each
   return non-object JSON for all three existing parse attempts.
2. Assert distinct diagram/related retry counts and artifact metadata, zero exit,
   and successful output with only the optional sections omitted.
3. GREEN: thread the existing `reviewDir` into the private synthesis tail and
   route the private optional stage through `runLlxprtPromptWithParse()` plus
   `saveParseFailureArtifact()`. Preserve the private function, existing model
   call, missing-key empty-string behavior, and exhausted-stage catch.
4. Run the focused walkthrough suite.

### Slice 3 — workflow context default

1. RED: strengthen the parsed-workflow test to assert the variable override and
   256000 fallback expression.
2. GREEN: change only the workflow fallback literal from 200000 to 256000.
3. Run the focused workflow suite.

### Slice 4 — exact-head gates and delivery

1. Run script tests and the full repository verification suite.
2. Run the configured CLI smoke test.
3. Reconcile the scope ledger, ancestry, and diff.
4. Complete no more than the permitted review cycles, classify every finding,
   resolve all accepted findings, then push and monitor PR CI/reviews on the
   candidate head.

## Expected paths

Only these paths are approved without further user authorization:

1. `project-plans/issue2777/plan.md` — this acceptance/scope record.
2. `scripts/pr-review-llm-helpers.ts` — exact parse-prefix classification.
3. `scripts/tests/pr-review-llm-helpers.test.ts` — classification, retry, and
   final diagnostic evidence.
4. `scripts/pr-review-walkthrough.ts` — private optional-stage retry wiring and
   review-directory threading.
5. `scripts/tests/pr-review-walkthrough.test.ts` — real private-pipeline
   subprocess behavior through a fake external CLI boundary.
6. `scripts/tests/pr-review-walkthrough-workflow.test.ts` — parsed workflow
   default/override evidence.
7. `.github/workflows/pr-review.yml` — one accepted context-default literal.

`script/pr-review-walkthrough-parse.ts` is research context only and is not an
approved edit path.

## Scope ledger

| Path | Planned change | Status | Net lines |
| --- | --- | --- | ---: |
| `project-plans/issue2777/plan.md` | Acceptance matrix, bounds, and delivery evidence | Implemented; review/CI pending | Preliminary +182/-0 |
| `scripts/pr-review-llm-helpers.ts` | Exact parser-prefix classification | Implemented | +7/-1 |
| `scripts/tests/pr-review-llm-helpers.test.ts` | Non-object retry and diagnostic tests | Implemented | +126/-2 |
| `scripts/pr-review-walkthrough.ts` | Optional-stage retry/diagnostic wiring | Implemented | +23/-5 |
| `scripts/tests/pr-review-walkthrough.test.ts` | Private-pipeline subprocess test | Implemented | +268/-0 |
| `scripts/tests/pr-review-walkthrough-workflow.test.ts` | Context expression test | Implemented | +7/-0 |
| `.github/workflows/pr-review.yml` | 256000 fallback literal | Implemented | +1/-1 |

- Approved target: **7 files**, no more than **1,500 net changed lines**.
- Mandatory review threshold: above **25 files** or **1,500 net changed lines**.
- Hard stop without approval: above **40 files** or **2,500 net changed lines**.
- Any path not listed above requires a scope-ledger update and user approval if
  it creates an unplanned subsystem/public abstraction or otherwise crosses a
  policy stop condition.

## Review finding classification

Every DeepThinker, OCR, CI, and PR-review finding is recorded as one of:

- **Blocker-Fix** — accepted behavior, correctness, safety, architecture, or a
  required gate cannot complete without the fix.
- **In-scope-Fix** — valid and directly within A1–A10 and the approved paths.
- **Reject** — factually incorrect, already satisfied, or conflicts with the
  acceptance matrix/architecture.
- **Defer** — valid but outside A1–A10 or requiring an unapproved scope change.

Reviewer suggestions never expand scope on their own.

## Verification evidence

Preliminary implementation evidence:

- RED baseline in an isolated temporary tree: focused Vitest ran the new tests
  against `HEAD` production/workflow files and failed with 14 issue-specific
  failures (exact prefixes, real-parser retries/exhaustion/artifact, optional
  diagnostics, and workflow fallback).
- Focused Vitest: 3 files, 177 tests passed.
- Changed-file ESLint with zero warnings: passed.
- Scripts TypeScript check: passed.
- `npm run format`: passed.
- `npm run test` and `npm run lint`: externally terminated by signal 15 before
  completion; the complete scripts suite independently reached 4,886 passing
  tests and one unrelated pre-existing failure.
- `npm run test:scripts`, `npm run typecheck`, and `npm run build`: blocked by
  pre-existing `packages/tools/src/utils/imageResize.ts:45-46` strict-index
  errors; the scripts suite's only failed test was the API-surface guard that
  encountered those same errors.
- Requested `node scripts/start.js ...`: blocked because that path is absent;
  the repository's `bun scripts/start.ts ...` entrypoint ran but the ollamakimi
  provider returned its external weekly-usage 429 limit.
- External review and CI remain pending.

This is not a visual/TUI change, so tmux validation is not applicable.

## Exact-head completion contract

Completion may be declared only when A1–A10 each have behavioral evidence on the
candidate head; required local verification and CI pass; permitted reviews are
complete and triaged; all Blocker-Fix and In-scope-Fix items are resolved;
`origin/main` is an ancestor of the candidate head; the PR is conflict-free; and
the final path/line counts reconcile to this scope ledger. Stop successfully at
that point without optional cleanup or hardening.
