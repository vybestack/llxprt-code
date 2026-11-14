# Issue #4115: refusal review retries a rewrite that drops literals

Follow-up to #4036. A session on `claude-opus-5-5` was refused three times and
sent to review. The reviewer reworded `Casters/SSAO` as "casters and SSAO", the
literal guard rejected the answer, and recovery stopped without a rewrite.

## Causes

1. `protectedLiterals.ts` protects any `word/word` token through the relative
   POSIX path pattern, so prose such as `Casters/SSAO`, `read/write` or
   `client/server` counts as a path.
2. `RefusalRecoveryCoordinator.afterReview` retries only after `rewritten`.
   Every other outcome stops, so `refusal.max-rewrites` never buys a second
   review.

## Decisions

These were decided against the issue's goal; none needs a product call.

### Path pattern

A relative path match is protected only when it looks like a path:

- any segment contains a `.` (`src/a.ts`, `../x`), or
- it has three or more segments (`packages/agents/src`), or
- it ends with `/` (`packages/agents/`), or
- its first segment starts with `@` (`@vybestack/llxprt-code`).

A bare two-segment `Word/Word` match with none of these is prose and is not
protected. Sentence punctuation is trimmed before this path-shape predicate
runs, so `Casters/SSAO.` remains prose while `src/a.ts.` remains a path.
Absolute paths (`/usr/bin`), `~/` and `./` paths, Windows paths, URLs and
anything inside a code span or fence keep their protection, because other
patterns cover them. Losing protection for a bare `src/core` is accepted: the
same shape is far more often prose, and the issue asks for this narrowing.

### Second review after dropped literals

- `refusal.max-rewrites` already means "review rounds per request"
  (`RefusalPolicy.maxRewrites`). A review whose rewrite is rejected only for
  dropped literals spends one round. When a round remains, the coordinator
  starts another review at once (no identical retries, since the context did
  not change) and tells the reviewer which literals each entry must keep. When
  no round remains, recovery stops with the existing "gave an unusable answer"
  notice. The default stays `1`; with the default the narrowed pattern is what
  fixes the reported session, and raising the setting now buys real retries.
- Only rejections caused by dropped literals are retried. Malformed JSON,
  contract violations, refusals, failures and other rejections still stop.
  The feedback is specific to the dropped-literal case, and the other
  failures do not get better by asking again with the same input.
- Trusted feedback is host-authored text sent after the review prompt and
  before `<session_data>`. It names only host-generated entry ids and points
  to `previousAnswerRejected.entries` in the untrusted JSON. The exact literal
  values stay in that JSON as `mustKeepExactly`, so they receive the same
  encoding as the session entries and count toward the data budget.
- The verdict check reports dropped literals for every rewritten entry, not
  only the first failing one, so one retry can fix all of them.
- `ReviewInProgress.complete()` may resolve to another `ReviewInProgress`.
  `settleRefusal` and `announceRefusalSettlement` already handle a chained
  review, so the user sees "asking again" before the second call is awaited.

## Tests (bun, behavioural, per dev-docs/RULES.md)

- `protectedLiterals.test.ts`: "Casters/SSAO" reworded as "casters and SSAO"
  is accepted. `src/a.ts`, `packages/agents/src`, `packages/agents/`,
  `@vybestack/llxprt-code`, `/usr/bin` and a code span holding `Casters/SSAO`
  stay protected.
- `reviewVerdict.test.ts`: a reply with two rewrites that each drop a literal
  reports both entries and their literals.
- `refusalReviewer.test.ts`: a review with feedback keeps literal values out
  of trusted text and sends them in the escaped data block.
- `refusalReview.behavior.test.ts`: after a real dropped-literal rejection, a
  tool-result fence with instruction-like content and a `</session_data>` code
  literal stays out of trusted feedback and round-trips in the structured data.
- `refusalRecovery.test.ts`: with `maxRewrites` 2, a dropped-literal review
  followed by a valid one ends in a rewrite and a retry, and the second review
  receives the literals. With `maxRewrites` 1 the same first answer stops with
  the unusable-answer notice. Other invalid replies still stop with rounds
  left.
- An API-level behaviour test through the refusal review harness covering the
  rejected-then-valid sequence.

## Docs

`docs/reference/ephemerals.md`: `refusal.max-rewrites` and the review section
describe the second review and the narrowed path rule.
