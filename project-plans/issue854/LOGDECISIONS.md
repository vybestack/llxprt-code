# Issue 854 decision log, 2026-10-20

## Phase 5 normalized pending-input queries

Extend `IndexedJournalRequestSnapshot`, rather than introducing another unit adapter. The request uses the same pinned `VersionSnapshot`, `JournalTailSource`, affected-row overlay, count and `readAt` coordinates. Namespace 1/2 queries now expose counts, one-based occurrence selection, last-at-or-after, strict successor and streamed half-open unit ranges. `withNormalized` prepares one selected-ID view for several queries under one callback hold.

Reuse `RowOccurrences` for both persisted and virtual emission. Inject the source-fact reader and pure normalizer; do not import provider implementations. Recompute only each affected journal row and tail row from ID metadata, discard its temporary current-row lists, and retain only the selected normalized ID's replacement positions. The existing raw-ID overlay still contains only IDs present in pending input. No prefix enumeration, whole-history map, payload decode or operation file is introduced.

Replace an affected row's persisted occurrence contribution completely, rather than mixing old local positions with updated units. Locate its old list interval by binary search. Keep untouched list intervals in the persisted trie. Project every selected position through the same affected-row count deltas and part offsets that unit selection uses. This covers a tail AI call creating an earlier human-target response and shifting later journal ordinals. Duplicate blocks retain multiplicity, including empty IDs and normalized prefix collisions. Range bounds use projected request unit indices, so responses before a stateful cursor do not answer calls after it.

Callbacks and occurrence iterators take their own hold on the current pin. Closing the opener or request object cannot release a suspended consumer's pin. Release failures remain observable when no primary failure exists; preparation, callback and abort failures retain their original identity when final release also fails.

The oracle recomputes complete old-normalizer output for every unchanged 5000-case input with its request-only tail. It checks counts, selection, last, strict successor and ranges at every unit boundary, as well as unchanged pending membership and first-output ordinals. Named cases cover tail best/tie behavior, cross-speaker shifts, R1 duplicates, empty/prefix collisions, split parts and stateful duplicate calls. Wrong tail precedence, omitted coordinate shifts and retained history copying must fail actual assertions and restore with cmp before acceptance. Read budgets at 40/4000/100000 rows do not establish retained heap.

Keep the broader verification failure visible. The unchanged codec property test generated an own `__proto__` key and failed because `sanitizeParams` assigns entries into `{}`, losing that key. Seed `609796497` and the minimized payload reproduce the loss deterministically; codec, sanitizer and property-test hashes match starting HEAD. Recorded as [#3917](https://github.com/vybestack/llxprt-code/issues/3917), with no fix in this query group. Continue only previously unexecuted files under the same source inventory. Do not retry the failing test, narrow its input domain, skip it or call the broader matrix green.

This increment is not full tail Kimi. Tail duplicates do not yet override native Kimi mappings through this view, and Mistral tail used-ID continuation is not wired. Its later implementation must use persisted namespace 3 plus a tail-bounded overlay, never a used-ID map over history or process-global state. Provider sends and the backend default remain unchanged. Full format/settings generations, summaries/LENS, holder remeasurement, complete fallback digit ranks, range CRC, 10k/100k/1M heap and W26/W23/W25 dependencies remain open.

Review skipped per Andrew 2026-10-09. No cleanup, obstruction move, .llxprt edit/staging, unrelated declaration/recovery staging, OCR, push or merge.

## Phase 5 Kimi correction facts

Implement the persisted mapping boundary before request-tail and summary integration. The first green group is `4d88b25211a7d1b4ac5999afaf88797dbafc05f3`. The production native writer owns emitted positions, counts, last-eligible pointers and exception admission under the existing acknowledgement/poison contract.

Keep namespace-0 and the original namespace-4 occurrence fields source-based. Use separately encoded namespace-4 emitted fields and the existing namespace-5 sparse list. Raw identities remain distinct even when OpenAI/Anthropic normalized IDs collide. Keep the existing bounded batch/cache and no per-operation file or history-wide retained map.

Reject format 5 rather than interpreting its Kimi activation marker as proof that emitted mapping facts exist. Format 6 introduces those persisted semantics without a migration or shim. Keep mapping activation separate from format/settings registration.

Store source block references for last-eligible names, then read one block and own the returned name string. Preserve exact UTF-16 code units when copying. This avoids retaining the parsed block's JSON backing storage and avoids changing lone surrogates through UTF-8 conversion.

Count mapping eligibility across all speakers, but distinguish consumed fallback uses from written IDs. The actual converter drops a response to an unnamed call when its new fallback ID differs from the preceding call ID. Versioned global AI-call count also handles the first-AI-call transition for earlier human-target responses without scanning those rows.

Expose mapped digit corrections and raw-ID holder streams now. Keep request-only tail continuation, complete unmapped digit ranks/dropped-use subtraction, row-prefix unmapped aggregates, format-dependent name bytes/tokens and stored holder remeasurement open. Do not call the mapped correction term a full byte/token measurement. No settings/LENS or provider/default cutover is included.

The actual converter and old mapper supply independent expectations. Controls reject wrong last eligible/name/ordinal, wrong written uses and retaining all IDs. Read-budget rejection is not a retained-heap result. Preserve frozen inputs and all initial failure receipts. See [PHASE5-KIMI-DECISIONS.md](PHASE5-KIMI-DECISIONS.md) for field layouts and lifecycle behavior.

Review skipped per Andrew 2026-10-09. No cleanup, .llxprt edit/staging, unrelated declaration/recovery staging, OCR, push or merge.
