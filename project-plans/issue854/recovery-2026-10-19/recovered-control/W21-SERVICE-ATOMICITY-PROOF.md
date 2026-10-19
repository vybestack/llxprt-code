# W21 service replacement atomicity, 2026-10-19

This increment proves W21 defect 1 through actual HistoryService, an adopted JournalRecordingService primary, a second real recorder and RecordingIntegration. W21 remains partial for crash, actual transport, discovery and the exact replay cases listed below. This is new evidence from verified base `24895a0b32cd6f9139f1d74412b9f63a59363d24`, not recovered historical output. Production code is unchanged.

Raw evidence lives under `tmp/854-notes/p4/w21/service-atomicity/run-20261019-part8-a/`, abbreviated `run/`. Named fixture files remain under the sibling `fixtures/` directory. No raw recovery tree or ignored evidence is staged. The source and process inventories below identify the tested boundary.

## Service front doors and independent readers

The four `history-service-recorder-{atomicity,compensation,restore-failure,byte-cuts}.test.ts` files live in `packages/core/src/services/history/`. Their test-only support is `__tests__/support/service-atomicity.ts`. Both the primary and mirror are real named native recorders. The service adopts the primary through JournalResumeBoot and subscribes RecordingIntegration to the mirror. Native writer seams wrap real positional files. Successful flushes invoke the actual platform implementation from `loadFlushRecords`; injected failures happen before that platform call. No persistence, serialization, replacement or compensation algorithm is mocked.

Independent readers reopen the recorder files, walk the committed row tree, resolve the persisted owner dictionary, decode complete CRC-checked rows and inspect full row entries. Reopen proof creates a real JournalRecordingService from each file and adopts it into a fresh HistoryService. Complete public content must strictly equal independently persisted content. Expected rows are small bounded test fixtures, not production history caches.

## Contract map

| Contract | New public proof |
| --- | --- |
| Held replacement trailer | `atomicity`: real positional trailer gate; prior published version identity, independently read primary/mirror rows, token total and context range remain unchanged. Acknowledgement and operation-completion flags remain false until release. |
| Public close while replacement is admitted | `atomicity`: `history.dispose()` cannot finish before the held replacement trailer acknowledges. After release, both files contain the complete replacement. |
| Failed write before trailer | `atomicity`, records/flush/trailer cases: prior complete rows and derived state survive; the next replacement rejects with JournalWriterPoisonedError and changes neither write count nor file bytes. Both files reopen at the prior valid version. |
| Pre-ack rejection | `compensation`: producer, tokenizer, media prepare and media publish failures leave prior rows, owners, tokens, spans, chronology and reservations intact, with no new committed version. |
| Post-ack rejection | `compensation`: contentBatchAdded, tokensUpdated, onAcknowledged, afterPublication, media finalize and contextRangeChanged failures produce replacement plus restore groups. Prior complete content, owners, chronology, tokens, range and media return in live history and both files. |
| Restore publication itself fails | `restore-failure`: flush and trailer-write failures preserve the acknowledged replacement, its accounting and both ordered causes. Later mutation fails fast without changing bytes. Teardown reports the held restore error while closing every resource, and both files reopen at the replacement. |
| Every byte of the last replacement group | `byte-cuts`: service-produced primary and mirror images, memory trailer search, independent disk reader and actual recorder owner open at each cut. Every incomplete image opens the complete prior version; the full image opens the replacement. Complete row-entry equality includes every offset and field. Read-only open leaves the tail intact; owner recovery truncates exactly to the expected committed end. |
| Intact-trailer corruption | `byte-cuts`: independently corrupt a committed row and row-tree node in each file while retaining the final trailer byte-for-byte. Opening/reading must raise JournalCorruptionError without falling back to an earlier history or changing bytes. |

The compensation matrix starts with one explicitly owned media row and one unowned row. After rollback, a successful append must use chronology sequence 3 and preserve the complete prior rows in both files. Both files then close and reopen through the real service adoption route. Media reservations must be released on final history disposal.

`restore(version)` reuses the primary's complete saved row entries, including their offsets. Mirror restore is a wholesale accepted-row replacement in `journal/mirrorApply.ts`, so its rows acquire new physical offsets. The oracle requires all other entry fields unchanged and exact contiguous record boundaries in the mirror's new group. Pre-ack failures retain the mirror's original entries. Offset translation is not treated as owner or metadata loss.

The restore group is trailer-only. Its real I/O boundaries are flush and trailer write; there is no separate record write to fail. The original replacement still exercises records, flush and trailer failures separately. A poisoned writer requires reopen. These tests do not add production retries, swallow failures or create deferred spools.

## Rejecting controls and authoring failures

Deliberate controls reintroduce premature published-row state, an acknowledgement flag before trailer completion, omission of `restore(version)`, and omission of writer poisoning. They run against real service front doors. Original and mutated sources, process commands, exits and SHA-256 restoration checks are preserved. Each source is restored in finally and checked against both its saved bytes and HEAD. These are newly constructed regression controls for the original failure shapes, not restored historical mutation logs or newly observed unmutated product failures.

Development failures remain separate from the passing boundary:

- The first shell invocation used the root directory with a package-relative log destination and did not start Bun. The subsequent package-directory run is the first actual test execution.
- `restore-initial.log` treated restore as a records-plus-trailer group and tried a normal integration flush on a poisoned primary. The final test uses the actual trailer-only boundaries, explicitly joins mirror fanout, and requires teardown to report the restore failure while still closing resources.
- `compensation-offsets.log` incorrectly required unchanged physical mirror offsets. `compensation-owner-corrected.log` then incorrectly assumed rows seeded in separate groups retained a single constant offset translation. The implementation rewrites those accepted rows contiguously in a fresh mirror group. The corrected oracle preserves complete entry fields and checks the actual new record boundaries. No production change or bound relaxation follows from these authoring errors.
- The first type gate found unsupported Array.at use under the repository target and Buffer/Uint8Array assertion overload mismatch. Indexing and explicit Buffer conversion preserve exact comparisons.
- The next lint gate required strict equality and shallower control flow. Byte-cut I/O assertions were extracted unchanged into typed helpers, with no ESLint rule changes.
- The first control parser did not recognize Bun's `filtered out` banner. The underlying control had already rejected at the published-version assertion. That result remains preserved; only unrun controls were continued after fixing the parser.

No unmutated production defect or production fix is claimed in this increment. The controls establish that the tests reject the specified regressions.

## Remaining W21 contracts

Defect 1 is accounted for by this bounded service proof. Defects 2/3 remain accounted for by the service-mutations increment; defect 4 reuses W15; defect 5's 17/40/200 MiB service/recorder/close/reopen/resume route remains accounted for by the service-large-row increment. This does not close:

1. HistoryService child/SIGKILL and the stronger tool-round crash case. Byte-cut images are not child-process crash evidence.
2. Actual ChatSession/todo/IDE/directory/turn transport-next-request durability. Explicit integration flush, acknowledgement and disposal boundaries are narrower.
3. Wider unreadable-session/scans, resume identity, extensions, checkpoint/fork and janitor discovery inventory.
4. Exact reference-media resume; generated metadata/compression-size/flush-segmentation/minimum-large-text matrices; unstamped disk-row rebuild followed by equal-text append.
5. W23 send/planning-envelope refusal and 40 MiB send, plus W22-W26 and later phase requirements.

W17's named public remainder stays done. No full package, affected-shard execution, monorepo run or default flip is claimed. Historical deleted logs remain missing. Review skipped per Andrew 2026-10-09. No OCR, push, merge, cleanup/deletion command, pattern kill, `.llxprt/` edit, bulk recovery staging or weakened checks belongs to this increment.

## Final-source evidence boundary

The final matrix is `run/matrix.json`: **24 isolated serial Bun processes across 24 paths, 273 passes, zero failures and zero skips**. Every file runs alone from packages/core. Fixtures explicitly select journal; an outer backend variable is not used to relabel old-layout tests as native coverage. All 43 source hashes in `run/confirmed-source-hashes.json` match the worktree. They include the five new paths, every reused suite and the relevant production/read/fault helpers. The commit comparison is recorded separately after committing.

The matrix uses the three final-source processes from `confirmed-tests/` and the 21 unchanged-source processes from `final-tests/`. Those three tests changed only to express temporal conservation as exact Object.is/isDeepStrictEqual comparisons, Buffer.compare equality and zero write/version deltas. The earlier AST audit flagged their direct pre/post comparisons as SELF_CONFIRMING; the scanner policy remains unchanged. All four controls were rerun against the final assertions, and the audit now has zero findings on the five new paths. The superseded three passing processes remain in their original result file but are not double-counted in the final matrix. No successful heavy proof was rerun for a preferred outcome.

All eight final-source gates in `confirmed-gates/results.json` exit zero. Declaration build was rerun after final test-only adjustments. The affected graph check is graph validation, not shard execution. No full package or monorepo test run is claimed.

### Exact byte cuts

Final byte-cut fixture: `fixtures/every-byte-jK5RRr/byte-cut-results.json`, associated with the final byte-cut process below. The earlier fixture without full-entry assertions remains separate. The final test executes 104622 assertions. Its 13074 images comprise 13072 incomplete cuts and two complete endpoints. Every byte of both last replacement groups is covered, including all row/id/tree bytes and the complete 1568-byte trailer boundary. Source images are bounded; no large-row payload enters this exhaustive loop.

| File | First cut | Final cut | Incomplete cuts | Complete cuts | Observed positional writes |
| --- | ---: | ---: | ---: | ---: | --- |
| primary | 12131 | 18522 | 6391 | 1 | 12131+4823; 16954+1568 |
| mirror | 10774 | 17455 | 6681 | 1 | 10774+5113; 15887+1568 |

Four additional committed-corruption images, row and tree in each file, reject under byte-identical intact trailers. Each failed open/read leaves the corrupt bytes unchanged.

### Rejecting controls on final source

These processes are outside the positive matrix. Every rejecting control exits one for its intended assertion, not a loader failure or timeout. Detailed logs and original/mutated/restored hashes: `run/confirmed-controls/controls/`.

| Control | Pass / fail | Exit | PID |
| --- | ---: | ---: | ---: |
| premature-published-version | 0 / 1 | 1 | 72492 |
| premature-acknowledgement-flag | 0 / 1 | 1 | 72522 |
| restore-omitted | 4 / 6 | 1 | 72548 |
| writer-poison-omitted | 0 / 3 | 1 | 72605 |

Restoration checks verify exact original bytes and equality to HEAD for journalStore.ts, journalPublishDetached.ts, journalHistoryStore.ts and groupWriter.ts. The control source snapshots remain preserved. No mutation is staged.

### Gate process inventory

| Gate | Exit | PID |
| --- | ---: | ---: |
| eslint | 0 | 69328 |
| prettier | 0 | 69476 |
| build-types | 0 | 69484 |
| core-tsc | 0 | 71199 |
| core-runner-tsc | 0 | 71489 |
| touched-tsc | 0 | 71497 |
| affected-graph | 0 | 71615 |
| audit | 0 | 71711 |

The declaration-loader probe exposed generated packages/test-utils/dist/index.d.ts being selected by Bun. Only that exact directory was verified ignored, untracked and nonsymlink before moving it intact to unique held-generated paths. Both directory moves retain inode identity and are recorded in held-generated.json and held-generated-confirmed.json. The latter move follows the final declaration build. No generated data was deleted.

### Positive process inventory

Paths are relative to packages/core. Each row has exit zero, zero failures and zero skips. `run/summary.json` verifies 62 recorded child PIDs are absent. Managed supervisors are also complete. The reused lower-level crash/torn-tail/writer suites remain distinct from the new service-front-door proof.

| Path | Passes | PID | Evidence under run/ |
| --- | ---: | ---: | --- |
| src/services/history/history-service-recorder-atomicity.test.ts | 5 | 72624 | confirmed-tests/journal-01.log |
| src/services/history/history-service-recorder-compensation.test.ts | 10 | 72647 | confirmed-tests/journal-02.log |
| src/services/history/history-service-recorder-restore-failure.test.ts | 2 | 72683 | confirmed-tests/journal-03.log |
| src/services/history/history-service-recorder-byte-cuts.test.ts | 2 | 61449 | final-tests/journal-04.log |
| src/journal/groupWriter.test.ts | 24 | 62472 | final-tests/journal-05.log |
| src/journal/journalStore.crash.test.ts | 4 | 62480 | final-tests/journal-06.log |
| src/journal/journalTornTail.test.ts | 7 | 62949 | final-tests/journal-07.log |
| src/journal/journalOpen.test.ts | 13 | 63047 | final-tests/journal-08.log |
| src/journal/flushRecords.test.ts | 23 | 63059 | final-tests/journal-09.log |
| src/journal/mirrorFanout.recovery.test.ts | 5 | 63064 | final-tests/journal-10.log |
| src/journal/mirrorFanout.defects.test.ts | 5 | 63072 | final-tests/journal-11.log |
| src/services/history/journalHistoryStore.publishDetached.test.ts | 23 | 63381 | final-tests/journal-12.log |
| src/services/history/journalHistoryStore.detachedMedia.test.ts | 6 | 63437 | final-tests/journal-13.log |
| src/services/history/journalHistoryStore.fanout.test.ts | 16 | 63455 | final-tests/journal-14.log |
| src/services/history/historyRecorderFanout.compensationOrigins.test.ts | 19 | 65767 | final-tests/journal-15.log |
| src/services/history/chronology-rollback-atomicity.journal.test.ts | 19 | 65791 | final-tests/journal-16.log |
| src/services/history/journalDetachedStream.test.ts | 5 | 66119 | final-tests/journal-17.log |
| src/recording/recording-integration-native-boundary.test.ts | 14 | 66126 | final-tests/journal-18.log |
| src/recording/recording-integration-native-faults.test.ts | 6 | 66147 | final-tests/journal-19.log |
| src/recording/recording-integration-native-core.test.ts | 19 | 66165 | final-tests/journal-20.log |
| src/recording/recording-integration-native-lifecycle.test.ts | 14 | 66190 | final-tests/journal-21.log |
| src/recording/journalRecordingService.test.ts | 13 | 66210 | final-tests/journal-22.log |
| src/recording/journalResumeAdoption.test.ts | 8 | 66221 | final-tests/journal-23.log |
| src/services/history/history-resume-adoption.test.ts | 11 | 66234 | final-tests/journal-24.log |

### Tested-source hashes

| Path | SHA-256 |
| --- | --- |
| packages/core/src/services/history/history-service-recorder-atomicity.test.ts | 29ecc3414afb32abdf38e2a8eba76e795f69692414a5d2b8aed461414232d474 |
| packages/core/src/services/history/history-service-recorder-compensation.test.ts | 291c0fd900afdf03de99eb2b8298148119c99f3ca596ed4acae461dfaf7e5b03 |
| packages/core/src/services/history/history-service-recorder-restore-failure.test.ts | 0f08809137b786a6d943fb76b87b665a420596af0b9bd982a7b17f520b616abd |
| packages/core/src/services/history/history-service-recorder-byte-cuts.test.ts | 907f83f89a2681472945d08100c4c6102be84a3c5facbb407abfe914cddbc607 |
| packages/core/src/services/history/__tests__/support/service-atomicity.ts | 178ca9a1d71d962b281724772e97dd82f63c854f62dfb5bbf477216a193e4956 |
| packages/core/src/journal/groupWriter.test.ts | 1facb50089abcf94e8dcb5be94a7940f9824965cb3f3799cfd7e58fecd4358cb |
| packages/core/src/journal/journalStore.crash.test.ts | 0f64e96f1e4729484156f9477d14466d57cdd6b8ce1e906202cb4b1a68f96f05 |
| packages/core/src/journal/journalTornTail.test.ts | 1717eafa51203b16a056e055ec6c7daf727ed8165bd760495f76ddcf5b5b9f87 |
| packages/core/src/journal/journalOpen.test.ts | 964908d5daa200038293c66242233c9fd7ac416811fc65522889858325b849b6 |
| packages/core/src/journal/flushRecords.test.ts | c270baaa3e8a67643bf06f1c0e80df8916e75aeaa69d922fdab03c2e3126d65e |
| packages/core/src/journal/mirrorFanout.recovery.test.ts | 38bb64d3423c17c1bf886394438d5bfa4d3ff89159b515876d4e096563bd5a2a |
| packages/core/src/journal/mirrorFanout.defects.test.ts | 61089448a4f81dc11f053e8abc8a109932d0cfd1b4a6064ad99f138536122a47 |
| packages/core/src/services/history/journalHistoryStore.publishDetached.test.ts | d6f23f10317afb1560de2f41105d0800f6ef9825a8a036a3a0dc7da3b5a207de |
| packages/core/src/services/history/journalHistoryStore.detachedMedia.test.ts | baead400dc1f652daf6f8a4ad9325eaaa3ac9aabcc5b1afb04f428c24ccb44cb |
| packages/core/src/services/history/journalHistoryStore.fanout.test.ts | da31d296ddd49f68e22c41d1ad31274f1e6df6432576bfeaedffa0f7be305fb2 |
| packages/core/src/services/history/historyRecorderFanout.compensationOrigins.test.ts | 3666f469ac85c2671b1d0f90abd14c426f508f2d14855679e36df359ca57a147 |
| packages/core/src/services/history/chronology-rollback-atomicity.journal.test.ts | 18c82ccb7d59106b464e300ec51e29914f94fd472e6c59352a0e34c5d20d1ebf |
| packages/core/src/services/history/journalDetachedStream.test.ts | 4ab3c1cc1ac08ba606527e1eeaf7f7d8340e801ff11e1c8d462e239b52ec9c1f |
| packages/core/src/recording/recording-integration-native-boundary.test.ts | c3d2ecabcc2430c41f65eb2a18afde604aca3580c997409edf6c03bcbe45f4b6 |
| packages/core/src/recording/recording-integration-native-faults.test.ts | 71e6fb4d3874f3a3a2ceac22bd99b21af790a43b6a5090433349cc6b520c5cd0 |
| packages/core/src/recording/recording-integration-native-core.test.ts | 96dc251680d2701835f466093f38fedb3f88e1ccbeb224225a49b64e7a52188a |
| packages/core/src/recording/recording-integration-native-lifecycle.test.ts | cea706a7f9621b6be4345c89597a430f9c8621c34633e3b85da8c316f4b6fb06 |
| packages/core/src/recording/journalRecordingService.test.ts | 729cda3245a3165e974ffb4d040d03a8dfb6c922f7a99c1a92ef2d119f74b247 |
| packages/core/src/recording/journalResumeAdoption.test.ts | 56a0db427f52186c415b603fb70c6acb37691d6956a0b6d97e6ac7959bcf24e1 |
| packages/core/src/services/history/history-resume-adoption.test.ts | 3e01015b259c46b352997cfc2b9a1b1fee1b95bd030db7bb183b721bbde43da3 |
| packages/core/src/journal/groupWriter.ts | 36835bdda2978ffbb72c615b060a331cddf9d1d7a7dedac834f8dc453312ee61 |
| packages/core/src/journal/journalStore.ts | 08e8520d8d66ded2ffc16e872acb28677e66ab28006c399b5cfe166bffc26bf9 |
| packages/core/src/journal/journalReader.ts | 13c7c829e5606e5309f8c2eafdf9cbcbde1aaec2e629726d73920ea56dacaa8a |
| packages/core/src/journal/trailerSearch.ts | b63bdb364f5dc846fdd245b41c823002317b03a04576b81219688a28784a0229 |
| packages/core/src/services/history/journalHistoryStore.ts | f72775b40e8c8a3308e739019b69016d1d4ca5496b0a10df42e8067acf8cef28 |
| packages/core/src/services/history/journalDetachedPublication.ts | 2b5bd891135395147be04091c342298fe71c45d95364a736d84b7b0789751010 |
| packages/core/src/services/history/journalPublishDetached.ts | abb6249e071370af8b6145c58c3ed7b8f58931d1c41dcef2a5e6f6f660a93522 |
| packages/core/src/services/history/journalDetachedCandidate.ts | 1c64d76620756508053694416804de2a9fea40cb81d6e84fac2b3e4705e7e072 |
| packages/core/src/services/history/journalSession.ts | e571f966527b52d51213796c6b8cc5ecfa678318858222725fd8504833d6b0e8 |
| packages/core/src/services/history/HistoryService.ts | 8aba708f0fa410c75fff910f684cd263b877e6d2d6c2a8017e765b1147c1c639 |
| packages/core/src/services/history/journalMirrors.ts | bfc6dd162b7ddd9f95d5120cf7734e99ac9d1385e8186ed97081ef4978637d8d |
| packages/core/src/journal/mirrorApply.ts | 801fbfa12c53068eb061ace35c7a684dab517e50f87054dd5ce5edd7a1fcc47b |
| packages/core/src/recording/journalRecordingService.ts | ad04fe6187f0c317e95cc4195b8bb188c8d4586c28f06c325d24b682f0eb9e9b |
| packages/core/src/recording/RecordingIntegration.ts | 65d89217567194d815890b192852b81381b6e04c8d45af220b3e782b3d1ad6cd |
| packages/core/src/services/history/__tests__/support/service-recorder-mutations.ts | 47775c74f308352c6508a592e075363a7384aedfcad7361ed0b665561bf2d3d5 |
| packages/core/src/services/history/__tests__/support/detached-media-fixture.ts | 060195d6be389712eb67457f5b5d8cf0cf1c1b00c7194ed68cf17dbb14e6c475 |
| packages/core/src/journal/__tests__/support/journalFixtures.ts | 55a088b533316732aaed5fc7be19e9e7ecaa7d63fda1390f62f563e6c6d5c8c2 |
| packages/core/src/journal/__tests__/support/memoryIo.ts | afe06a7841ec6f3ebfe44d2b29be6677a9bba7083953e5154aaffa6e24a4f274 |

All 43 paths, exact process commands, final gate results, control restorations and source comparisons remain in the raw run directory. Historical deleted evidence remains missing. These results account only for defect 1 and leave the remaining W21 contracts above open.
