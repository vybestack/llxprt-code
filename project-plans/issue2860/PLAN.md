# Issue #2860 — Canonical trusted marker ownership for OCR sticky state

## Problem

The OCR workflow cannot rediscover the trusted marker comment it previously
wrote. Five stages use three different, mutually inconsistent author rules:

| Site | Workflow location (main @ b40c5f8f5) | Current author rule |
| --- | --- | --- |
| Auto-review gate marker lookup (`fetchMarkerComment`) | `auto-review-gate` / `Decide auto-review limit` | **none** — any author |
| Checkbox reset | same step | inherits the "any author" rule |
| Suspension upsert + duplicate reconciliation | `post-suspension` / `Post OCR suspension message` | **none** — any author |
| Checkpoint reader | `code-review` / `Read OCR checkpoint` | `type === 'Bot' && botLogin !== '' && login === botLogin` |
| Count parser, comment upsert, duplicate reconciliation | `code-review` / `Post OCR results` | `type === 'Bot' && botLogin !== '' && login === botLogin` |
| Inline review-comment dedup | `code-review` / `Post OCR results` | `type === 'Bot' && botLogin !== '' && login === botLogin` |

`botLogin` is resolved from `github.rest.users.getAuthenticated()`, which in
production returns 403 ("Resource not accessible by integration") for the
workflow token. The `OCR_BOT_LOGIN` repository variable is unset, so
`botLogin` collapses to `''` and every exact-login predicate matches nothing —
even though the comments really are authored by `github-actions[bot]`.

Consequences (see issue for production evidence on PRs 2823/2839/2757):
duplicate sticky comments, the hidden automatic-review count stuck at 1,
checkpoints never rediscovered, and repeated full merge-base-to-head reviews
that exhausted the OCR job timeout.

The "any author" sites have the mirror-image defect: a human or an unrelated
bot can post a comment containing the marker and have it adopted as trusted
workflow state — including being *updated* or having siblings *deleted*.

## Decision

Introduce one canonical trusted-marker ownership rule, defined exactly once,
and use it at every site.

Trust is **additive and allowlist-based**, never dependent on the
authenticated-user endpoint:

1. `user.type === 'Bot'` is mandatory. A `User` author is never trusted.
2. The login must be in the trusted set, compared case-insensitively:
   - the built-in default `github-actions[bot]`, always trusted;
   - any login supplied by `OCR_BOT_LOGIN` (comma/whitespace separated list);
   - the login returned by `getAuthenticated()` when that call succeeds.
3. An empty/failed `getAuthenticated()` result narrows nothing — the defaults
   still apply. This is the specific production regression being fixed.

Because trust is an allowlist, unrelated bots (`coderabbitai[bot]`,
`dependabot[bot]`, …) remain untrusted.

### Deterministic selection over trusted markers

Duplicates must reconcile without losing state:

- **Canonical comment** (the one to update; the one whose siblings are
  deleted) = the *oldest* trusted marker by comment id. Stable across runs.
- **Hidden auto-review count** = the *maximum* count parsed across all trusted
  markers. Prevents a duplicate with a stale `0` from resetting progress.
- **Checkpoint** = the checkpoint from the *newest* trusted marker that
  carries one. Prevents discarding the freshest checkpoint when an older
  duplicate is retained as canonical.

### Reuse mechanism

The canonical rule lives in `.github/scripts/ocr-trusted-marker.cjs`, between
sentinel comments that delimit a self-contained, dependency-free snippet. Each
of the four `actions/github-script` blocks embeds that snippet verbatim, and a
behavioral test asserts byte-for-byte equality between the module's snippet
region and the text embedded at each site.

Rejected alternative: `require()`-ing the module at runtime. It would force an
`actions/checkout` into `auto-review-gate` (which deliberately has no
checkout) and introduces a module-resolution failure mode that cannot be
verified before production. The workflow is uniformly inline-script based; the
verbatim-embedding check gives one editable definition with mechanical
enforcement and no new runtime failure mode.

## Acceptance matrix

Every row must have behavioral evidence.

| ID | Accepted behavior | Evidence |
| --- | --- | --- |
| AM1 | The canonical snippet is defined once and embedded verbatim in the auto-review gate, suspension poster, checkpoint reader, and results poster | Embedding-equality test over the parsed workflow |
| AM2 | `getAuthenticated()` rejects (403) and `OCR_BOT_LOGIN` is unset ⇒ an existing `github-actions[bot]` marker is still discovered by gate, checkpoint reader, and results poster | Behavioral VM execution of each real script |
| AM3 | `getAuthenticated()` succeeds but returns a login that does not author the comments ⇒ the `github-actions[bot]` marker is still discovered | Behavioral VM execution |
| AM4 | `OCR_BOT_LOGIN` configured (single login and comma-separated list) adds trust without removing the defaults; surrounding whitespace and letter case are tolerated | Module unit tests |
| AM5 | A `User`-authored comment containing the marker is never trusted at any site (not read, not updated, not deleted, not counted) | Module unit tests + behavioral VM execution |
| AM6 | An unrelated bot (`coderabbitai[bot]`) comment containing the marker is never trusted at any site | Module unit tests + behavioral VM execution |
| AM7 | Two successive automatic runs progress the hidden count 1 ⇒ 2 against one canonical marker rather than resetting to 1 | Behavioral VM execution of gate + results poster |
| AM8 | Duplicate trusted markers reconcile deterministically: the oldest is retained and updated, newer duplicates are deleted, the maximum count and the newest valid checkpoint survive | Behavioral VM execution |
| AM9 | A checkpoint embedded in the canonical marker is found on the next `synchronize` and yields checkpoint-to-head range selection instead of `checkpoint-missing` | Behavioral VM execution of the real checkpoint reader wired to the real `resolveReviewRange` |
| AM10 | The checkbox-reset path resets the count on the canonical trusted marker only | Behavioral VM execution |
| AM11 | Inline review-comment dedup keys off the same canonical author rule, so dedup still functions when `getAuthenticated()` fails | Behavioral VM execution |

## Non-goals

- No change to OCR review content, routing, coverage, telemetry, manifest,
  concurrency, or failure classification.
- No runtime `require()` of repository modules from `github-script`; no new
  `actions/checkout` in `auto-review-gate`.
- No new npm scripts, CI jobs, lint rules, dependencies, or repository
  variables. `OCR_BOT_LOGIN` stays optional.
- No change to auto-review limit semantics (#2666) beyond how the current
  count is discovered.
- No migration of other duplicated inline helpers (`deserializeCheckpoint`,
  `serializeCheckpoint`, …) into the canonical module.
- No retroactive cleanup of marker comments already duplicated on open PRs.

## Slices

1. **S1 — Canonical module.** `.github/scripts/ocr-trusted-marker.cjs` plus
   unit tests covering AM4, AM5, AM6 and the selection helpers.
2. **S2 — Embedding and wiring.** Embed the snippet in the four scripts and
   replace each ad-hoc author rule and selection with the canonical helpers
   (AM1 wiring; behavior for AM2, AM3, AM7–AM11).
3. **S3 — Behavioral workflow tests.** VM execution of the real scripts for
   AM1, AM2, AM3, AM7, AM8, AM9, AM10, AM11.

## Expected paths

- `.github/scripts/ocr-trusted-marker.cjs` (new)
- `.github/workflows/ocr-review.yml` (modified)
- `scripts/tests/ocr-trusted-marker.test.ts` (new)
- `scripts/tests/ocr-trusted-marker-workflow.test.ts` (new)
- existing `scripts/tests/ocr-*.test.ts` (only where an assertion encodes the
  old author rule)
- `project-plans/issue2860/PLAN.md` (this file)

## Stop-for-approval triggers

Stop and ask before: adding a subsystem or public abstraction beyond the
canonical module; changing CI, agent memory, quality tooling, or dependencies;
pulling an unrelated refactor or test move into scope; implementing behavior
outside the acceptance matrix; or exceeding the hard scope budget.

## Scope ledger

| Change | Reason | Matrix row |
| --- | --- | --- |
| New `.github/scripts/ocr-trusted-marker.cjs` | Single canonical definition required by the issue | AM1 |
| Rewrite author rule at 4 github-script sites | Core defect | AM2, AM3, AM5, AM6 |
| Deterministic count/checkpoint/canonical selection | Required so reconciliation preserves state | AM7, AM8, AM9 |
| Inline review-comment dedup uses the same rule | Same `botLogin === ''` defect, same predicate | AM11 |
| New behavioral tests | Required evidence | all |

Budget: target ≤ 25 files / 1,500 net changed lines; mandatory scope review
above either threshold; hard stop at 40 files / 2,500 net changed lines.
