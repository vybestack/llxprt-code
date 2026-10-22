# Both 8192 pending-token parity lanes pass; the original denial case stays RED

The strict pinned lane and the unpinned persistent-compaction lane each compare
all 8192 original rows against the independent array oracle and explicit-old
disk path. Both produce two replacements and projected tokens 869676. Full live
histories, token totals, context ranges, native durable values, old durable rows,
immutable input and unchanged ownership bounds pass. The original enabled mixed
contracts test and its creating detector remain byte-unchanged. Its 8192 case
remains RED and is excluded from passing totals.

Early commit `ddef55c15` records the first green pinned proof. The final
[receipt](W26-SOURCE-BOUND-PENDINGTOKEN-COMPACTION-PROOF.json) binds 94 passes,
zero failures/skips and 2367 assertions across 18 complete serial files, ten
scoped gates and four restored assertion controls. Source digest:
`b530eaef2862b6a23865587e05d07028b931f3ced83d5fcbfd12eedd89eb8ff8`.

## The denied file belongs to persistent recorder maintenance

The once-only original 8192 reproduction identifies this exact path:

```text
/var/folders/qd/962lhrjj0232rjykgg3lgmrw0000gn/T/native-compression-values-q2mDrp/session-2026-10-22T00-08-26-0c718285-d642-4092-b662-cd025ddc6e31-suffix-test.llxj.compact
```

It was opened with `wx+` through `journalRecordingService.ts:486`,
`createJournal`, `versionCopy.withNewFile`, `writeCompactionCandidate` and
`JournalStore.compactOnce`. The recorder had pins=0, queued=0, commitSeq=5,
groupTag=8949566287641802, durableEnd=129206218, rows=8192, liveBytes=5738374 and
ckptBytes=0. The unchanged design-4.11 threshold was 103980812 bytes:
`2 * (5738374 + 0 + 8192 * 1550) + 64 * 1024 * 1024`.

The separate nameless history primary was already due at 165390535 bytes with
five pins and deferred its own compaction. The ranking loop retains its source
snapshot through awaited publications and token updates. Committed fanout groups
hold their own readers through mirror delivery. No premature source dependency
release was found, so this proof does not change the production pin lifecycle.
The denied artifact is a persistent journal replacement, not the removed
per-operation ranking spool.

`HistoryService.journalPath()` can return the first recorder's path for a
nameless primary. Its value alone does not establish primary-store identity.
Earlier authoring logs use the field name `primary` for this public path; final
logs use `historyPath` to avoid that inference.

## Lane A: strict denial with real request and recorder versions

`pending-token-compaction-pinned.test.ts` opens the existing history compression
request input and the snapshot of
`requireJournalRecorder(recording).session().store`. Both stay live across the
selected operation and `history.waitForCommit()`. They retain version and
reader metadata, not decoded-history arrays. The input/oracle arrays belong only
to the test comparison.

The unchanged `operationFileCreates(action, true)` denies every intercepted
creating API across roots. The exact result is no files and no directories. The
operation result is observed as an explicit settled value so a failure preserves
the denied-creation cause in the assertion output. Both readers close outside
the denial interval, allowing normal deferred compaction. The final file reports
one pass and 18 assertions at all 8192 rows.

## Lane B: actual compaction without extra store pins

`pending-token-compaction-live.test.ts` adds no observer store pin. It opens an
independent read-only descriptor, which POSIX rename leaves bound to the old
inode. The original all-roots creating matcher runs unchanged in observation
mode. It must report exactly `[compactionCandidatePath(recording.path)]` and no
directories. At the real filesystem rename seam, source and destination must
equal the actual recorder candidate and target, and `compactionDue` must hold.
No substring or path-wide allowance exists.

The real copy shrinks 129206218 bytes to 20421065. The copied file has a new
fileId, unchanged commitSeq/groupTag/rootAggregate, and an equal committed row
count. The old descriptor continues to produce exactly its complete
pre-operation values after the swap. Full semantic/token/durable parity follows,
then an actual native ranking query returns count 8190 and top ordinal 8189 with
the expected large score. The final file reports one pass and 28 assertions.
The operation-window claim is specific to the recorded persistent candidate,
not zero creations across the store's entire lifetime or subsequent maintenance.

## Direct copy proof and falsification

`tool-ranking-compaction.test.ts` queries the copied persistent and pending
ranking trees without requesting a fill. It compares every rank value, 65
summary ranges, row owners, source labels and complete rows. The retained
checkpoint keeps its rows and commit sequence, and its relocated row/id roots
match the corresponding copied roots. Ranking scalars store labels and tree
IDs, not file offsets. This test verifies existing copy support instead of
adding a format family or assuming every namespace is supported.

Current compaction preserves commitSeq/groupTag, as required by D-ORCH-6 and the
existing identity suite. The old design paragraph describing a new groupTag
predates that contract. Four accepted controls fail one assertion each:

| Mutation | Observed failure |
| --- | --- |
| Reintroduce old pending-disk ranking | Pinned no-file result matcher includes the unchanged denied-creation error |
| Zero copied 16-byte ranking scalars | Complete copied ranking values differ |
| Zero copied eight-byte summary count | Copied summary ranges differ |
| Generate a new compaction groupTag | Commit identity differs |

All production mutations restore by `cmp` and SHA-256. Original #3919
readerLifetime and readerCleanup pass unchanged at 11/29 and 3/20
tests/assertions. Existing refusal, rearm, poison, retained-version, unlinked,
copy and identity tests also pass without production edits.

## Source and process evidence

Raw root: `tmp/p5/w26-pending-compaction-run-ar/`. The original diagnostic
`root-repro-8192`, PID 45578, reports one failure and nine assertions. Its
`sourceChanged` flag stays visible: an unused recording property was added to
the fixture during the diagnostic. Production and original test semantics were
unchanged apart from logging. Diagnostic logging and the creation detector were
restored byte-exact; `diagnostic-restoration.json` records the hashes, and
`root-artifact.json` extracts paths, callers, version state and thresholds.

Final pinned/live PIDs are 87401 and 91060. The fresh direct-copy proof PID is
22085. The only reused-file inventory difference is the independent core test's
required present-version type narrowing; that file and all ten final gates ran
fresh. Reused production, executed tests and imported helper bytes match. The
receipt lists every bridge rather than claiming a whole-inventory match.
Authoring type/config failures and the earlier control whose rejection output
hid its cause remain in raw logs, outside accepted totals. The final audit has
no findings on the new compaction proofs or changed fixture. Graph consistency
does not establish affected-shard execution. All 68 recorded task PIDs are absent.

Finalization rechecks all 33 accepted test, gate, control and diagnostic log
hashes, current mutation targets against their original backups with `cmp`, and
the full tested-source digest. The frozen empty-ID, no-op, owner, original mixed
contract, creating guard and reader/identity test files match `ab0ba098f79`.
The completed #3919 readerLifetime/readerCleanup receipts remain passing at
11 tests/29 assertions and 3 tests/20 assertions; no rerun is claimed. The
`finalization` receipt records these checks and the 306-declaration inventory
digest. No new test lane was needed because the accepted executed-test,
production and helper bytes match their recorded boundaries.

All 1204 preservation hashes and inherited dirty memory match; 306 declarations
and raw recovery remain untouched and unstaged. No fixture shrink, original
assertion change, threshold/timeout increase, guard weakening, production
fallback or compaction disable was used. No cleanup, OCR, push, merge or default
flip occurred. Review skipped per Andrew 2026-10-09.

## Remaining acceptance

The separate 8192 comparisons are closed. The original all-creation-denial
contract, W26 and Phase 5 are not closed. Public ProviderNormalizationDisk and
ChatSession remain RED. #3917 is not rerun, retried or suppressed. The two
explicit-old durable replay failures at 512/8192, before native comparison,
remain recorded separately. Full cold structural ranking refill and
pending/stale capacity/accounting, native-capable explicit disk contracts,
Phase 6 normalization/header/request/body/key/message/tokenizer spools and
guards, global LENS/live bytes, whole heap and aggregate cache/pin capacity,
Phase 8 reservations, W23/W25/cutover, cold Mistral and Phase 9 remain open.
