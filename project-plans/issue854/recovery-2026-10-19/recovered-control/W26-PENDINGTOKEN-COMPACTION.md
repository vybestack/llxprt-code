# 8192 pending-token parity passes with live journal readers

The separate pinned lane passes at all 8192 original rows: two replacements,
projected tokens 869676, exact independent-array and explicit-old disk result,
full live histories, token totals, context ranges, durable native digest and old
durable rows, immutable input and unchanged ownership bounds. The unchanged
`operationFileCreates(action, true)` denies creating APIs across roots and
reports no files or directories. It is not a zero-all-creates claim about an
unpinned journal. The original mixed contracts test remains enabled and RED.

## Exact denied artifact

The once-only reproduction at the inherited source boundary records
`/var/folders/qd/962lhrjj0232rjykgg3lgmrw0000gn/T/native-compression-values-q2mDrp/session-2026-10-22T00-08-26-0c718285-d642-4092-b662-cd025ddc6e31-suffix-test.llxj.compact`
opened with `wx+`. The caller is `writeCompactionCandidate`, through
`compactionCopy -> withNewFile -> createJournal`, using the existing recorder's
journal open seam. That store had no pins or queued groups. Its durable end was
129206218 bytes, above the unchanged 103980812-byte design-4.11 threshold:
`2 * (5738374 + 0 + 8192 * 1550) + 64 * 1024 * 1024`.

The separate nameless history primary was already due at 165390535 bytes with
five pins and deferred its own compaction. Native ranking holds its snapshot
through both awaited publications and token updates. No premature native-plan
release was found. The persistent recorder is another store, so holding only
the primary does not hold the recorder's compaction. The denied artifact is a
persistent storage replacement, not the old per-operation ranking spool.
`HistoryService.journalPath()` may return its first recorder's path for a
nameless primary; that API result does not identify the actual primary store.

The pinned proof holds an existing compression-input request snapshot and a
snapshot of `requireJournalRecorder(recording).session().store` while the
selected operation and durable acknowledgement run. These retain version/read
metadata, not a history array. They close outside the denial interval, allowing
normal deferred compaction. No production behavior, compaction policy, guard,
original test, threshold or timeout changed.

## Evidence boundary

Raw root: `tmp/p5/w26-pending-compaction-run-ar/`. The original repro is
`root-repro-8192`, PID 45578, RED after 144.19 seconds. Diagnostic-only path and
pin logging was restored byte-exact; `diagnostic-restoration.json` records both
hashes. `root-artifact.json` extracts exact paths, caller, version and threshold.
`paired-pinned`, PID 56325, is one pass, zero failures, 18 assertions, 158.02
seconds. The log's `primary` field is the public `journalPath()` result, not a
claim that the nameless primary and recorder are the same store.

Independent unpinned compaction, fact-copy controls and final scoped gates are
not claimed by this checkpoint. W26/Phase 5 remain open. Public
ProviderNormalizationDisk/ChatSession RED, #3917 and two explicit-old durable
capture REDs remain separate and are not retried or suppressed. Ranking
pending/stale capacity, structural refill/accounting, Phase 6 spools, whole heap,
aggregate cache/pin capacity, W23/W25/cutover and Phase 9 remain open. All 1204
preservation hashes and inherited memory match; 306 declarations remain
unstaged. Review skipped per Andrew 2026-10-09.
