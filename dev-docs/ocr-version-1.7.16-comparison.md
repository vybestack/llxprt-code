# OCR 1.7.16 upgrade and upstream composite-action comparison

This document records the version bump from OpenCodeReview (OCR) `1.7.9` to
`1.7.16` and the comparison with the upstream
`alibaba/open-code-review` composite action (`action.yml`) that informs future
feature adoption.

It is the durable record referenced by issue #2667 (acceptance criterion 4).

## Scope of this change

- **In scope (this issue/PR):** version bump in `.github/workflows/ocr-review.yml`.
- **Out of scope (separate issues):** all upstream feature adoptions listed
  below. Each is tracked as a candidate for a bounded follow-up issue.

## Version delta (1.7.9 → 1.7.16)

Seven releases shipped between our previous pin and the new one. The notable
changes are grouped below.

### Bug fixes (security and correctness)

| Version | Change                                                                         | Why it matters to us                                                                                                                    |
| ------- | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| 1.7.15  | `fix(llmloop): drain per-file comment work without racing pool submissions`    | Race in concurrent file review could cause incomplete reviews or deadlocks. We set `OCR_CONCURRENCY: '2'`, so we are directly affected. |
| 1.7.15  | `fix(diff): review merge commits against their first parent`                   | Corrects merge-commit diff computation.                                                                                                 |
| 1.7.15  | `fix(diff): anchor binary marker and count +/- lines by hunk state`            | Improves diff accuracy.                                                                                                                 |
| 1.7.15  | `fix(config): preserve hand-edited timeout_sec across config round-trips`      | Relevant if we later make timeout configurable.                                                                                         |
| 1.7.15  | `fix(llmloop): scope async memory compression to each RunPerFile conversation` | Prevents cross-file context bleed across concurrently reviewed files.                                                                   |
| 1.7.14  | `fix(llmloop): guard nil tool-call arguments map to prevent panic`             | Prevents a crash during review.                                                                                                         |
| 1.7.16  | `fix: remove hardcoded 180s timeout from REVIEW_FILTER_TASK`                   | A hidden timeout could truncate reviews.                                                                                                |
| 1.7.16  | `fix(agent): count only dispatchable files reviewed`                           | Fixes review counting that could under-report coverage (directly relevant to the observed preview-vs-reviewed discrepancy in #2649).    |
| 1.7.16  | `fix(vscode): bound brace-expansion resolution`                                | Security fix.                                                                                                                           |
| 1.7.16  | `fix(deps): upgrade grpc-go for GHSA-hrxh-6v49-42gf`                           | Security advisory.                                                                                                                      |

### Features

| Version | Change                                             |
| ------- | -------------------------------------------------- |
| 1.7.16  | `feat(llm): iFlytek Spark as built-in provider`    |
| 1.7.16  | `feat(allowlist): GraphQL (.graphql/.gql) support` |
| 1.7.14  | `feat: add pot code review rules`                  |

## Upstream composite-action comparison

We use a custom workflow (`ocr-review.yml`) rather than the upstream composite
action. The upstream `action.yml` includes several features our workflow lacks.
They are documented here for future reference; **none are adopted in this
PR** (see Non-goals).

### 1. `--background` flag for business context

Upstream: `ocr review --background "business context here"` gives the LLM
context about the PR's intent, improving review quality. Our workflow does not
pass `--background`.

- **Adoption note:** Add an optional `OCR_BACKGROUND` repository variable and
  thread it into the `ocr review` invocation. Low-risk, additive.

### 2. `llm_extra_body` with thinking disabled by default

Upstream sets `ocr config set llm.extra_body '{"thinking": {"type": "disabled"}}'`
to disable reasoning mode by default, saving tokens and latency. Our workflow
does not configure `llm.extra_body`.

- **Adoption note:** Write this via `ocr config set` in the "Configure OCR
  review rules" step. Requires care: some models/providers may not accept the
  `thinking` field.

### 3. Incremental comment posting

Upstream supports `incremental: true`, which only appends inline comments whose
(path, line range) does not overlap an existing bot review comment. This is
non-destructive — history is never deleted. Our workflow already implements a
weaker, per-head exact-key deduplication in the inline-posting step, but not
overlap-based incremental posting.

- **Adoption note:** This is the core of #2649 and complements the auto-review
  limit in #2666. It is the highest-value follow-up but also the most complex;
  it should be its own bounded issue.

### 4. Configurable LLM timeout

Upstream supports `llm_timeout` as an input and an `OCR_LLM_TIMEOUT` env var.
We hardcode `--timeout 30` (minutes) in the `ocr review` invocation.

- **Adoption note:** Make the timeout configurable via a repository variable
  (`OCR_LLM_TIMEOUT_MINUTES`) and default to `30`. Trivial and additive.

### 5. Structured outputs

Upstream exposes structured outputs: `comments_total`, `comments_inline`,
`comments_skipped`, `comments_failed`, `summary_comment_url`. Our workflow only
exposes `infrastructure_failure` and `policy_failure` job outputs.

- **Adoption note:** Surface additional step/job outputs for observability.
  Pure additive change to the posting step.

### 6. Dedicated post-review-comments helper module

Upstream ships `scripts/github-actions/post-review-comments.js` as a separate,
testable JavaScript module. Our workflow has approximately 200 lines of inline
JavaScript in the `Post OCR results` `github-script` step, which is harder to
test and maintain.

- **Adoption note:** Extract the inline comment-posting logic into a testable
  helper module under `scripts/`. This is a maintainability refactor and should
  be a separate issue so it can be properly tested (it touches a fork-safety-
  sensitive code path).

## Non-goals (deferred to separate issues)

The following are explicitly out of scope for the version bump and are tracked
as candidate follow-up issues:

1. `llm_extra_body` with thinking disabled (token savings)
2. `--background` support (review quality)
3. Incremental comment posting (reduce duplicates) — overlaps #2649 and #2666
4. Extract inline JS to a testable helper module (maintainability)
5. Configurable LLM timeout
6. Structured outputs for observability

## Acceptance criteria for this change

1. `OCR_VERSION` is updated to `1.7.16` in `.github/workflows/ocr-review.yml`.
2. OCR runs successfully on at least one PR after the bump (the PR's own OCR
   workflow run serves as the smoke test).
3. No regression in review output format or comment posting.
4. This upstream feature comparison is committed for future reference.
