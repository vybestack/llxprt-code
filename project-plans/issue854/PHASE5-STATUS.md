# Phase 5 Mistral observe-tail checkpoint, 2026-10-20

Implementation commit `7ae2cf1ec7432ae3802278d38afd9a8c8660876d`, starting HEAD `2be851cc38e0f38795b787a3785ec07806efe99c`. This checkpoint implements request-only **observe-phase** Mistral mappings on the existing `IndexedJournalRequestSnapshot`. It does not complete lazy conversion-time fallback mapping. Provider sends still use the complete old converter and the backend default is unchanged. [PHASE5-MISTRAL-TAIL-PROOF.json](PHASE5-MISTRAL-TAIL-PROOF.json) binds the tested source and receipts.

## Mapping policy

`mistralMapping(rawId, slot)` and `withMistral(slot, consume)` require explicit activation of slot 0, 1 or 2. Native mappings retain raw-ID ownership validation. New nonempty pending calls continue namespace 3 with a pending-ID-only overlay. Calls follow emitted part/unit/block order, including reconstructed calls, unnamed calls and non-AI calls. Repeated raw IDs reuse mappings; name changes do not matter. Nine-character alphanumeric IDs pass through even when already used, matching the current tools mapper.

These facts describe the **complete pinned normalized request**. They are not a mapping cache for arbitrary selections. Removing the first collision holder changes the fresh converter from salt 1 to salt 0; the selection test demonstrates that difference. Persistent middle insertion and removal continue to use native rebuild.

A pending call targeting an earlier journal R1 unit reuses that unit's already observed native mapping. The existing journal tool response was reconstructed before the pending call existed. Adding later-labelled pending occurrences cannot move a journal ID's first emitted call earlier. A new tail response can introduce a reconstructed call before later pending call blocks; shared emitted-row metadata determines that order. An absent mapping in an earlier journal unit fails rather than silently assigning against the wrong used set. This checkpoint neither implements a general insertion refill nor writes pending input into history.

## Verification

Final acceptance covers 12 files in 24 isolated serial Bun test processes, both outer backends, with explicit `--timeout 180000`: **90 passes, zero failures/skips and 64,302 assertions**. The old full normalizer and actual tools Mistral mapper recompute expectations for all 5000 unchanged frozen inputs on each backend. This checks observe mappings, not conversion-time fallback order or provider-wire integration.

Seven scoped gates pass: core declarations, strict core and provider types, zero-warning ESLint, Prettier, affected-shard graph and AST audit. Graph validation is not execution of all affected shards. Three touched `DUP_ASSERT` findings span pin mutation, separate read counters and before/after input immutability. No prohibited touched finding is accepted.

| Rows | Calls | Preparation | Tail mapping | Duplicate mapping | Selected native mapping |
|---|---:|---:|---:|---:|---:|
| 40 | 40 | 22 | 7 | 2 | 3 |
| 4000 | 4000 | 36 | 8 | 2 | 4 |
| 100000 | 4000 | 46 | 8 | 2 | 4 |

Both backends produce these metadata-head counts, with zero journal block/body reads. Bounds remain `<120` for preparation and `<150` per query. Retaining an all-history used set fails at 18,154 reads. Wrong pending/native collision ownership, wrong raw ownership and omitted native read-drain controls also fail, then restore with cmp and SHA-256. These are read-budget checks, not retained-heap proof. The prior Kimi 100000-call construction timeout remains open; the 100000-row fixture contains 4000 calls and establishes no 100000-call construction capacity.

The frozen differential exposed an existing native duplicate-read defect: `readGroup(nextOffset)` included buffered records beyond the physical file end. Draining before reading an existing mapping makes that bound readable. Removing the drain reproduces the EOF failure. Initial missing-API RED, measurement-support dependency, syntax/lint and control-log recognizer failures remain in `tmp/854-notes/p5/mistral-tail-run-k/`.

The unchanged codec [#3917](https://github.com/vybestack/llxprt-code/issues/3917) remains RED at seed `609796497`: 39 passes, one failure and 536 assertions. Its own `__proto__` loss was not suppressed, skipped or retried for green.

## Remaining work

Mistral lazy empty/unobserved-response fallback mapping and actual conversion-order proof remain open. Prior Kimi request last-eligible/name/ordinal/count support remains recorded in [PHASE5-KIMI-TAIL-PROOF.json](PHASE5-KIMI-TAIL-PROOF.json); Kimi stateful fallback, consumed versus written digit/rank arithmetic and holder remeasurement are still open.

Format/settings keys and generations, summary/LENS, whole-record range CRC, full 10k/100k/1M retained-heap acceptance, Stage A, W26 scratch, W23's eight planning/header cases and W25/default dependencies remain open. No placeholder length is claimed. The 293 unrelated declarations, recovery material, frozen fixtures and `.llxprt` remain preserved and excluded from staging. No cleanup, obstruction move, OCR, push or merge. Review skipped per Andrew 2026-10-09.
