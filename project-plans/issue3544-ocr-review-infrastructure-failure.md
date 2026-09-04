# Issue #3544 — OCR review infrastructure failure

## Source

Auto-filed tracking issue: OCR review run classified as `infrastructure-failure`
on 2026-09-03. Run: https://github.com/vybestack/llxprt-code/actions/runs/33750459882
(PR #3543, `issue3533`).

## Diagnosis

The run has two attempts and they failed differently.

### Attempt 1 (11:34–11:46 UTC) — the attempt that produced the classification

`Record OCR outcome` ran only its `infrastructure-failure` step; every other
outcome step was skipped. That durable marker is what
`ocr-infrastructure-notifier.yml` reads, and it is why this issue exists. The
run's current (attempt 2) view records `success`, which is why the surface-level
run status disagrees with the issue body.

`Run OpenCodeReview` ran for 600.2 seconds (11:35:55.63 → 11:45:55.84) against a
single selected file (`packages/cli/src/utils/sandbox-launch-release.test.ts`)
and exited 1. The `Post OCR results` step then logged:

```
Skipping OCR output parsing because phase review already recorded exit code 1.
OCR coverage: 0% (0/1 preview files covered)
OpenCodeReview failed or produced unparsable output (exit code 1).
```

**The specific failure reason is unrecoverable.** Both sources the issue body
directs a reader to are empty for this attempt:

1. *Trusted workflow logs.* `mark_infrastructure_failure` appends
   `phase=…; reason=…` to `ocr-infrastructure-failure.txt` and emits nothing to
   the log. Every phase before `review` pairs its call with its own
   `echo "::warning::…"`, but the six review-phase classifier branches
   (`.github/workflows/ocr-review.yml` lines 2475–2487) do not. `ocr-stderr.log`
   is likewise never surfaced. Attempt 1's `Run OpenCodeReview` step therefore
   produced **zero** log output across its ten minutes.
2. *The `ocr-review-output` artifact.* `Upload OCR artifacts` (line 6367) uses
   the fixed name `ocr-review-output` with no run-attempt suffix, unlike the
   telemetry artifact (`ocr-telemetry-<run_id>-<run_attempt>`). Attempt 2
   replaced it. The single surviving `ocr-review-output`, created 11:59:22, has
   an empty `ocr-infrastructure-failure.txt`.

What is known: the failure occurred in the `review` phase, after roughly ten
minutes, with a nonzero `ocr review` exit code. Which of the six classifier
branches fired cannot be determined.

### Attempt 2 (11:50–11:59 UTC) — a separate, deterministic defect

Recorded `success`, but its annotations show:

```
Batch review post failed (3 comments), falling back to individual posting:
Unprocessable Entity: "Variable $threads of type [DraftPullRequestReviewThread]
was provided invalid value for 0.Severity (Field is not defined on
DraftPullRequestReviewThread), 1.Severity (…), 2.Severity (…)"
```

Root cause: the inline comment object built at line 4467 carries an internal
sort key alongside the GitHub-defined fields.

```js
const comment = {
  path: String(f.path),
  line: endLine,
  side: 'RIGHT',
  body: `${INLINE_MARKER}\n<!-- ocr-fp:${fingerprint} -->\n${labeledText}`,
  _severity: effectiveSeverity(f),
};
```

`_severity` exists only to drive `sortInlineComments` (line 3332). The same
objects are then passed unchanged to `github.rest.pulls.createReview` at line
4576 and again inside `regroupLineResolutionFailure` at line 3851. GitHub's
REST-to-GraphQL bridge maps `_severity` onto a `Severity` member of
`DraftPullRequestReviewThread`, which does not exist, so the request is
rejected with HTTP 422.

Consequences:

- **Every** OCR batch inline post carrying at least one comment fails and drops
  into the per-comment fallback. It has stayed invisible because the individual
  `createReviewComment` path (line 4649) selects its fields explicitly, so the
  comments still land.
- The issue #2930 line-resolution regrouping is unreachable in practice:
  `isLineResolutionFailure(batchErr)` never matches the `Severity` 422, which
  always arrives first and masks the genuine line-resolution 422 underneath.
  Attempt 2 demonstrates exactly this — the per-comment loop then hit
  `Failed to post inline comment on packages/cli/src/utils/sandbox-launch-release.test.ts:554:
  … pull_request_review_thread.line could not be resolved`.
- Reconciliation could not confirm publication, leaving
  `batchPublicationAmbiguous` set and `post_state=partial`.

## Accepted behavior

### B1 — the inline review payload contains only fields GitHub accepts

`github.rest.pulls.createReview` receives comment objects restricted to
`path`, `line`, `side`, `body`, and — only when the finding spans a line range —
`start_line` and `start_side`. No internal key (`_severity` or any future
addition) is transmitted, from either call site: the primary batch post
(line 4576) and the grouped 422 retry inside `regroupLineResolutionFailure`
(line 3851).

Severity-ordered posting is unchanged: `sortInlineComments` continues to read
`comment._severity`, so the internal field stays on the in-memory objects and is
stripped only at the transmission boundary.

Boundary cases:

- single-line finding (`start_line === endLine`) — no `start_line`/`start_side`
  in the payload;
- multi-line finding (`start_line < endLine`) — both present;
- finding whose severity is absent or `unknown` — payload identical, ordering
  preserved via the fail-safe rank;
- the regrouped retry path, which posts a filtered subset.

### B2 — a review-phase infrastructure-failure reason reaches the workflow log

Recording an infrastructure failure also emits the recorded `phase` and `reason`
as a workflow warning, so the classification survives in the trusted log even
when the artifact is later replaced by a re-run. Implemented once in the
`mark_infrastructure_failure` helper so every call site — including the six
review-phase branches that are silent today — is covered.

## Out of scope

Filed separately if wanted; not touched here.

- The ~600 s review duration and any change to `OCR_REVIEW_TIMEOUT`.
- Run-attempt-scoped artifact naming. It would additionally require changing the
  `download-artifact` step in `ocr-infrastructure-notifier.yml`, which resolves
  `ocr-review-output` by literal name; that is a second workflow and awaits
  approval.
- Any change to how `publicationState` / `post_state` feed classification.

## Tests

Behavioral, per `dev-docs/RULES.md`. The existing suites already execute the
real workflow script out of `ocr-review.yml` in a `vm` sandbox against a fake
Octokit, so the assertions inspect the payload the workflow actually sends
rather than restating it.

- **B1, grouped 422 retry** — extend
  `scripts/tests/ocr-review-422-wiring.bun.test.ts`, whose harness already
  captures `createReviewCalls`. Assert the transmitted comment key set exactly.
- **B1, primary batch post** — cover the line 4576 call site with the same kind
  of harness, extending an existing suite or adding a focused one.
- **B1, payload shaping** — direct behavioral test of the extracted payload
  helper for each boundary case above.
- **B2** — assert the helper emits the phase and reason, exercised through the
  heredoc-extracted `ocr-workflow-helpers.sh` in the style of
  `scripts/tests/ocr-failure-classification.test.ts`.

## Verification

`npm run test`, `npm run lint`, `npm run typecheck`, `npm run format`,
`npm run build`, plus the `stepfun-37` startup smoke.
