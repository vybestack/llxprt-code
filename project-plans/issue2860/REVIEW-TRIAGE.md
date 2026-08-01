# Issue #2860 — Review finding triage

Every finding from the independent design/correctness review, classified.

## Blocker-Fix

**B1 — Checkbox-reset event is not authenticated.**
`.github/workflows/ocr-review.yml`, `auto-review-gate` / `Decide auto-review limit`.
The `issue_comment.edited` path admits the event on `COMMENT_USER_TYPE === 'Bot'`
plus marker text only. The event comment's login and id are never checked, so an
unrelated bot that edits its own marker-bearing comment can reset the counter on
the genuine canonical marker and force a manual OCR run. Directly violates the
acceptance criterion that unrelated-bot comments cannot become trusted state,
and the criterion naming the checkbox reset as a canonical-predicate site.
Fix: pass the event comment login and id into the script, require
`isTrustedMarkerComment` on the event comment, and require its id to equal the
canonical trusted marker id before resetting.

**B2 — Suspension reconciliation deletes newer duplicates before merging state.**
`post-suspension` / `Post OCR suspension message`.
Newer trusted duplicates are deleted first; the surviving body is then built only
from the oldest comment. A checkpoint present only on the newer duplicate is
destroyed. Violates "reconciled deterministically without discarding the newest
valid checkpoint or state".
Fix: derive merged state (max count, newest usable checkpoint) from all trusted
markers, update the canonical comment successfully, and only then delete
siblings.

**B3 — Results-poster reconciliation deletes before persisting and can return a
deleted comment.**
`code-review` / `Post OCR results`, `reconcileMarkerComment` /
`createOrUpdateMarkerComment`.
Duplicates are deleted before the canonical update, so an update failure loses
state. After a successful create, post-create reconciliation may delete the
just-created comment when a concurrent lower-id marker exists, yet the function
returns the created comment; the later checkpoint advancement then updates a
deleted id.
Fix: separate selection from deletion, update before deleting, and after
post-create reconciliation return and update the surviving canonical comment.

**B4 — The required behavioral tests do not execute the real production paths.**
`scripts/tests/ocr-trusted-marker-workflow.test.ts`.
AM7 manually increments local variables and fabricates the body. AM8 inspects
helper ordering and infers what production would delete. AM9 feeds the range
resolver a synthetic checkpoint rather than the checkpoint reader's own output.
AM11 and the results-poster AM2 case invoke only a helper, not the real
functions. These would still pass if the production wiring were removed, which
violates the acceptance criterion that behavioral tests exercise the real
workflow scripts, and `dev-docs/RULES.md`.
Fix: execute the real function bodies extracted from the workflow against an
in-memory paginated comment API, carry state across a real gate/poster/gate
sequence, and wire the real checkpoint-reader outputs into the real range
resolution glue.

## In-scope-Fix

**I1 — Comment-id and count coercion.** `.github/scripts/ocr-trusted-marker.cjs`.
`Number(null)` and `Number('  ')` are `0`, which `Number.isInteger` accepts, so a
malformed id can become canonical and be passed to `deleteComment`. Duplicate ids
can cause the canonical comment to be deleted as its own duplicate. A very long
digit run makes `parseHiddenAutoCount` return `Infinity`, permanently suspending
reviews. GitHub payloads are external input, so validation belongs here.
Fix: accept only ids satisfying `Number.isSafeInteger(id) && id > 0`; never
delete an id equal to the canonical id; clamp the parsed count to a non-negative
safe integer.

**I2 — "Newest valid checkpoint" only means "decodes to some object".**
`code-review` / `Read OCR checkpoint`.
`{}` counts as valid and is selected over an older, structurally complete
checkpoint, so `CHECKPOINT_VALID` is reported true while range resolution
rejects it and falls back to a full review.
Fix: prefer the newest trusted marker whose checkpoint is structurally usable
(schema 1, complete, 40-hex head and base SHAs), then the newest marker carrying
any checkpoint, then the canonical marker. `CHECKPOINT_FOUND` and
`CHECKPOINT_VALID` semantics must be unchanged for the single-marker case.

**I3 — The written auto-review count can regress.**
`code-review` / `Post OCR results`.
If the pre-fetch `listComments` fails, the resolved count is 0 and an automatic
run writes 1 over an existing 2. That is exactly the "count stuck / reset"
symptom this issue exists to remove.
Fix: at write time, never write a count lower than the count already present in
the comment being updated (plus the automatic increment).

**I4 — Stale comments and dead code.** The `OCR_BOT_LOGIN` comment still calls it
a fallback although it is now an additive trust source; the pre-fetch comment
claims the list is reused for reconciliation although no call site passes it.
Fix: correct the wording and remove the unused parameter.

**I5 — Lost coverage in an existing test.**
`scripts/tests/ocr-auto-review-limit.test.ts` write-failure case: the fixture
marker has no `user`, so it is now untrusted, `updateComment` is never called,
and the test passes without exercising the failure it was written for.
Fix: give the fixture a trusted author so the scenario runs again.

**I6 — Pagination is never exercised.** The fake `paginate` calls `listComments`
once, so nothing proves a marker on page 2 is discovered.
Fix: make the fake paginate over multiple pages in at least one discovery test.

## Reject

None. The reviewer explicitly rejected nothing, and on re-examination the two
candidates hold up: the defensive guards in the canonical module cover genuinely
external GitHub API payloads, which the project's fail-fast preference exempts;
and the verbatim-embedding equality check is sound under the deliberate no-
checkout constraint, catching partial or reformatted copies.

## Defer

**D1 — `listComments` failure is treated as empty state in the gate and creates a
duplicate in the suspension and results paths.**
Real, but a deliberate availability tradeoff that predates this issue and is not
the production root cause (the identity mismatch was). Failing closed would block
reviews on transient API errors; refusing to post would drop the summary
entirely. The AC-relevant half of this finding — a regressing counter — is fixed
under I3. The remaining duplicate-on-list-failure behavior is deferred.

**D2 — All workflows using the ordinary `GITHUB_TOKEN` share the
`github-actions[bot]` identity, so comment authorship cannot prove workflow
provenance.**
Correct, and no fork contributor or unrelated App can impersonate that identity
directly; no marker-echo gadget exists in the current workflows. Fixing it means
a dedicated App identity or HMAC-signed hidden state, which is a new subsystem
and a scope expansion beyond this issue. File as follow-up.

**D3 — Checkpoint model/rules/policy hash compatibility checks are skipped when
the checkpoint field is empty.**
Pre-existing behavior in `Resolve review range`, unrelated to marker ownership.
Follow-up.
