# History JSON export and old-history summary streaming

## Scope and API changes

This slice removes two direct `HistoryService.materializeHistory()` calls. The
starting receipt is
`tmp/verify854/p05d/tool-repair-disk-20261002-sol/receipt-completion.json`.
Before this slice, the three direct calls belonged to `getAll()`,
`summarizeOldHistoryInternal()`, and `toJSON()`. After this slice, only `getAll()`
remains. `HistoryServiceCore` is unchanged.

`HistoryService.toJSON(): string` is removed. Its replacement is
`writeJSON(write: HistoryJsonSink, signal?: AbortSignal): Promise<void>`, backed
by `streamJSON(signal?: AbortSignal): AsyncGenerator<string, void, unknown>`.
The sink must await its write before returning. The writer does not close a
caller-owned sink and cannot undo bytes the sink has already accepted. File
consumers requiring atomic visibility should write a temporary file and rename
it after successful completion. Export failure, cancellation, and iterator
return close the source cursor. A stalled sink receives the signal, and the
writer stops awaiting it on abort. Already-started external writes may finish;
no further writes are scheduled.

This is an explicit public API break, including the automatic `JSON.stringify`
`toJSON` hook. Repository-wide TypeScript/TSX inventory found no executable
production export consumers. The only old history export call was in
`HistoryService.management.test.ts`, which now hashes streamed chunks against
an independent legacy oracle. `fromJSON(string)` is unchanged and remains an
eager import surface. No compatibility shim or full-document accumulator was
added to the export implementation.

The summary callback changes from `(IContent[]) => Promise<IContent>` to
`HistorySummaryCallback`, whose first argument is a scoped
`HistorySummarySource`: `Iterable<IContent>` with a readonly `length`. It can be
iterated again within the callback, including by provider retry paths. It
cannot be used after callback completion. Active, abandoned iterators are
closed on return, rejection, timeout, or cancellation. The optional second
callback argument is the supplied `AbortSignal`. Use `AbortSignal.timeout()`
for a deadline. Cancellation races the external callback promise; a late
callback result cannot publish history.

The implementation captures disk-backed mutation rows, stores the candidate on
disk, and uses the existing atomic commit and compensation path. Token
estimation completes before publication. Summary validity is checked before
candidate construction. Retained rows preserve chronology and payload values;
pending retained rows preserve object and marker identity. Existing markers
are reconciled before minting a summary marker, with counter restoration on
failure. Queued appends run after success or rollback. Media replacement uses
the existing transactional owner participant.

Serialization holds one row and its serialized representation, not the complete
document. The independent byte oracle is `JSON.stringify(originalRows, null,
2)`, including array-index `toJSON` keys, dates, omitted values and non-finite
numbers. Rows larger than 8 MiB remain valid. Such a row exceeds a fixed
serialized-byte ownership budget by itself; its validity is tested separately
from bounded small-row scale cases.

## Complete pre-change caller inventory

The initial full text inventory is in the new evidence directory under
`before/callers.txt`. The exact history-service callers are:

| Surface | Caller | Migration |
| --- | --- | --- |
| `toJSON()` | `HistoryService.management.test.ts:173` | Await `writeJSON` into a hash sink; import uses the independent legacy oracle. |
| `summarizeOldHistory()` | `HistoryService.management.test.ts:145` | Callback annotation changes to `HistorySummarySource`; reads its length. |
| `summarizeOldHistory()` | `HistoryService.chronology.test.ts:315` | Callback ignores its source; remains type-compatible. |
| `summarizeOldHistory()` | `historyFacade.test.ts:360` | Callback annotation changes to `HistorySummarySource`; reads its length. |
| `summarizeOldHistory()` | `history-persistence-owner.test.ts:237` | Callback ignores its source; remains type-compatible. |
| `summarizeOldHistory()` | `history-detachment.test.ts:279` | Callback ignores its source; remains type-compatible. |
| `summarizeOldHistory()` | `history-detachment.test.ts:323` | Callback ignores its source; remains type-compatible. |
| Internal summary helper | `HistoryService.ts:847` | Removed array helper and its sole import from `historyContextWindow.ts`. |

There are six external summary test call sites, not seven. The internal helper
call is separate. Neither API has an executable production caller outside
`HistoryService` itself. The production summary helpers in `packages/agents`
use other disk-backed compression routes and are unchanged.

Other inventory matches are unrelated JSON hooks in snapshot, frozen-batch,
provider transport and pretty-JSON tests; pretty-JSON/body serializers; workflow
expression strings; and a comment in tool-result retention. They are not
history export consumers. New public types are exported from the existing
`HistoryService` module subpath. No package export or production mock declares
the old callback type.

## Verification and remaining work

Evidence is written only to the new ignored directory:
`tmp/verify854/p05d/export-summary-stream-20261002-sol/`.

Tests use real journals at 512 and 8192 mixed text/tool/media rows. Export bytes
are compared to an independently assembled legacy document. Summary BODY tests
invoke real Anthropic, OpenAI Responses and Gemini converters through the
callback, with caching off/on and transport retry, and compare model prompt
and post-publication bodies to independently built array inputs. Network
responses alone are fixtures. Pending-owner and retaining controls must fail
when their trap environment variables claim a small-row bound.

Scoped gates include the original 31 chronology/rollback tests, neighboring
callers, forced 800-line/80-function lint, formatting, TypeScript and test-audit
zero-new-findings comparison. Structural scanner failures are retained as
remaining-work evidence rather than weakened. Full suite and heap lanes are
deferred on this shared busy host.

This slice does not claim complete issue854 acceptance. `getAll()` remains an
eager public surface, and inherited Core materializations remain for a later
migration. Paused pending writers retain caller identities and therefore still
have history-sized ownership. Their charges are reported and deliberately fail
the fixed bound in trap lanes. No protected sources, enforcement, previous
receipts, GitHub state or git history are changed.
