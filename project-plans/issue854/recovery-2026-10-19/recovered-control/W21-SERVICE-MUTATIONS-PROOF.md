# W21 service mutation proof, 2026-10-19

W21 remains partial. This increment establishes the real-service repeat-sequence pop and two-recorder rewrite contracts, and fixes owner loss during native self-merge. It does not establish the remaining byte-cut/restore, large-row, crash, transport, discovery or replay requirements below. W17's named public remainder remains done.

This is new evidence from `35fcb01351d6fd5135e4b5d013cfc3672a9e55db`, not recovered historical output. Raw evidence is workspace-local under `tmp/854-notes/p4/w21/service-mutations/run-20261019-part6-a/`, abbreviated `run/` here. This tracked map retains the results and source boundary without staging the unrelated recovery tree or raw logs.

## Source commits and scope

- `e5a71cd6a570277773f73402d0d87742c2ffcc8b`: owner-preserving native self-merge append, real-recorder pop/resume test and test-only recorder/independent-reader support.
- `1fead98e55ebd7c3cadfb58982110932110b6c3e`: four native service/two-recorder rewrite cases and retaining-control fixture migration.
- The final fixture commit and final-source results are recorded below. No additional production change belongs to this finalization.

The old backend stays default. Review skipped per Andrew 2026-10-09 and this task. No OCR, push, merge, cleanup/deletion, pattern kill, `.llxprt/` edit, recursive recovery staging, skipped source test or assertion/bound/timeout/check weakening was performed in finalization. The pre-existing `.llxprt/LLXPRT.md` change and unrelated untracked recovery files are excluded from commits. No next service-proof cluster was opened.

## Defect 2: owner-preserving self-merge, pop and real resume

`packages/core/src/services/history/history-service-recorder-pop.test.ts` constructs real native HistoryService, RecordingIntegration and JournalRecordingService. The independent reader opens the recorder file read-only, traverses its committed row tree, decodes complete content and resolves persisted owner dictionary entries. It does not use the live history as the disk oracle.

The test seeds owned A and unowned B, requires chronology sequences `[1, 2]`, and checks their complete blocks and owner identities. Public self-merge must produce A B A B with unchanged chronology, metadata and owners. The batch notification must announce only two appended rows. Public pop must leave A B A in live history and independently reopened disk rows. The test then closes the original integration/history/recorder, calls real `resumeSession`, adopts the native boot into a new HistoryService and subscribes a new integration. Live and independently reopened rows must still be A B A. A second public pop must leave A B in both places.

### Root cause and fail-first evidence

`run/pop-initial.log` records product RED: 0 pass / 1 fail. The duplicated A lost its recorded owner. Self-merge decoded content into an originless append; `applyAppendDrafts` replaced draft owners with the operation's unowned owner. Chronology survived, so content-only comparisons could miss the defect.

The committed fix reads the detached operation's pinned source and calls `appendDerived` with each source ordinal. Candidate/publication plumbing carries the inherited numeric owner through the existing byte-bounded append batch into the group builder. Relevant locations at the source boundary are `journalMerge.ts:19-43`, `journalDetachedCandidate.ts:97-101`, `journalDetachedPublication.ts:145-185` and `journalOps.ts:103-120`, all under `packages/core/src/services/history/`. Numeric owner zero is preserved. The existing 4 MiB append payload bound remains; no history-wide content buffer, operation temporary file or repeated whole-history read was introduced. Cross-service merge semantics remain unchanged.

An intermediate general replacement attempt announced four rows rather than two. `run/pop-append-notification-red.log` records 0 pass / 1 fail for that development regression. It was not committed; the final fix retains append semantics.

The required first-marker mutation deliberately rewinds to the first matching chronology sequence instead of removing one tail row. `run/corrected-controls/pop-first-marker.log` records 0 pass / 1 fail at the independent disk assertion after the first pop. The original source, process exit and restored SHA/byte comparison are preserved beside it. This rejects the mutation; it is not an observed failure of the unmutated pop implementation. The earlier control filename was reused before the notification assertion was added, so only the final surviving control output is claimed.

## Defect 3: two real recorders at 3 / 64 / 65 / 5000 rows

`packages/core/src/services/history/history-service-recorder-rewrite.test.ts` attaches two real integrations/recorders under distinct origin objects. Public grouped seed batches produce rows from each origin plus unowned rows. A bounded test-only array retains complete content, chronology and owner expectations.

For each required size, public `applyDensityResult` replaces every row through the `appendReplacement` route. A subsequent `history.detachedValues.transform` rewrites every row through `appendDerived`. After each operation:

- The complete primary rows equal the full owner-aware oracle.
- Each independently reopened recorder contains exactly its currently owned rows plus unowned rows, with no excluded origin or stale payload.
- The primary and each independently read recorder commit sequence advance exactly once.
- Each recorder calls the actual platform full-flush exactly once more.

Public clear then leaves the live service and both independently reopened files empty, with exactly one further primary/recorder group and recorder flush. These are service front doors, not standalone JournalHistoryStore mutation proofs. Primary-store access is observational only.

`run/corrected-controls/owner-loss.log` deliberately discards replacement owners only above 64 pinned source rows. It records 2 pass / 2 fail: 3 and 64 pass, 65 and 5000 fail at the complete primary owner comparison. The source is restored byte-identically. No unmutated density/replacement defect or production density fix is claimed. `run/rewrite-initial.log` used `history.length` as a property instead of a method; that failure is a test-author error, not product RED. The 5000-row size and 180000 ms bound remain unchanged.

## Existing retention and token fixtures

The first related matrix passed all four old retaining controls but failed all four under journal because native merge emits `contentBatchAdded`, while the fixture retained only `contentAdded`. The fixture now handles both events and joins the native row consumer before its original assertions. A batch-only attempt failed to retain old-layout rows; its unexpected-green rejecting run survives in `run/final-controls/old-retention-trap.log` and is not claimed as a valid trap.

The final six controls are in `run/corrected-controls/`. Positive evidence passes four cases per backend. Rejecting retaining traps fail all four per backend at the unchanged 440-row bound, retaining actual 512/8192 rows in borrowed and distinct-copy modes. Exact live/peak/release assertions and the 8 MiB bound remain. TypeScript AST extraction compares every original retention assertion expression with base `35fcb0135`.

The second matrix found both native 512/8192 merge totals exceeded the original expected count by the same 533 tokens. Old fixture seeding writes directly to the recorder and initially contributes zero live tokens; native fixture seeding uses service admission before the exact tokenizer was installed. The final fixture change installs the exact tokenizer in the constructor factory before seeding and explicitly runs old and journal cases. Old keeps exact `size * 4`; native first requires a four-token prefix and then exact `prefix + size * 4`. Complete source/target digests and 440-row/8 MiB/zero-live-row predicates remain. The self-merge and valid nine MiB cases also remain. This corrects fixture input ordering; it does not modify production token accounting or relax a total.

The stopped supervisor's `run/verified-tests/` matrix then reached the native `pop-token-accounting-settlement.test.ts` failure case: 1 pass / 1 fail, expected 2130 tokens and received 3196. A single diagnostic per backend compared the exact inputs and outputs. Old seed/pre-pop/post-failure tokens were 0/2130/2130; journal values were 1066/3196/3196. Both removed one row, reported `pop accounting failed`, left two rows and released all borrowed rows. Logs are `run/pop-fixture-diagnostic-{old,journal}.log`. The difference came from native seed admission before the action's tokenizer installation, not the self-merge fix or failed-pop state transition.

Only that existing test's seed fixture was corrected: its constructor installs a zero-count tokenizer before seeding, making the intended zero-token prefix explicit on either backend. The action still installs its exact text-length tokenizer before adding the final row, then installs the throwing tokenizer. Every original assertion remains verbatim and in order, including exact 2130 after rejection, two remaining rows and zero live ownership. Added assertions require zero initial tokens and exact 2130 before pop. No production change, assertion removal, weaker bound, backend skip or retry is involved. Adding a constructor factory to the cross-package helper exposed distinct source/declaration private types at core tsc; `run/settled-source-gates/core-tsc.log` preserves that authoring failure, before any new matrix ran. The test now uses the established core-local suffix helper to keep the constructor and options in the same type graph, without casts or compiler changes. The failed `verified-tests/` matrix remains distinct; `confirmed-source-tests/` is the final-source matrix after this input correction.

Verification logs use one opened descriptor for stdout/stderr. An earlier driver passed one Bun.file twice, allowing output overwrite at independent offsets. Earlier surviving files remain development evidence; the final matrix uses fresh paths and a single descriptor. No result is inferred from a missing banner or pre-load failure.

## Reused proof and gate boundaries

W15 `session-fork-late-ownership.test.ts` and `session-fork-offset-audit.test.ts` are run again under both outer environments, rather than duplicated. They establish service owner reassignment, late recorder admission, checkpoint/fork provenance, offset independence and pin retirement. Native core/lifecycle/boundary/replay/fault/ownership/writer/adoption, store detached/fanout and real platform full-flush suites are also included. Every file runs alone, serially from `packages/core`; an outer environment is not a claim that explicitly selected old tests are native.

Final-source gate evidence is `run/confirmed-source-gates/`: core noemit, runner and touched-source typechecks; ten-path zero-warning ESLint/Prettier; affected-graph validation; full-corpus AST audit. The successful declaration build is separately recorded in `run/after-token-fixture-gates/gates.json` before final test-fixture adjustments. That earlier directory's later lint failure is not a passing gate set. Final type/lint/format/graph/audit outcomes come only from `confirmed-source-gates/`. Repository compiler/scanner configuration is unchanged.

Preserved type/fixture development failures include the broad lint-owned project before dependency builds, an unnecessarily concrete recorder parameter instead of SessionRecordingPort, supplemental rootDir/composite configuration, and conditional `expect` calls in the token fixture. The final fixture computes the prefix first and asserts unconditionally; the lint rule remains enforced. None is relabeled as product RED. Graph validation does not establish affected-shard test execution. No full package or monorepo run is claimed.

## Exact outstanding W21 contracts

1. Defect 1: full service-plus-real-recorder every-byte torn-tail cut/reopen and `restore(version)` matrix. Part-three held replacement/clear acknowledgement, listener compensation and records/trailer/flush failure with real reopen remain narrower completed proof.
2. Defect 5: 17/40/200 MiB HistoryService-plus-real-recorder/reopen contracts. Existing store/session large-row tests remain lower-level. W23 send/planning-envelope and 40 MiB send behavior are separate requirements.
3. Crash: HistoryService child/SIGKILL proof, including the stronger tool-round case. `recorderAckChild` constructs JournalHistoryStore and does not close this route.
4. Durable before the next request: actual ChatSession/todo/IDE/directory/turn transport entry points. Explicit integration flush/stop/turn-boundary observations do not close these entry points.
5. Refusal/discovery: wider unreadable-session and whole-directory scan behavior, resume identity, extensions, checkpoint/fork and janitor inventory. Small recorder/scanner or public-agent counterparts do not close the entire inventory.
6. Replay: exact reference-media resume; generated metadata, compression-size, flush-segmentation and minimum-large-text matrices; unstamped disk-row rebuild followed by equal-text append. Related deterministic/inline-media/summary proof is not relabeled equivalent.

Defects 2 and 3 are accounted for by this increment. Defect 4 reuses and reruns W15. Existing real platform full-flush/no-fallback controls are run; injected no-op flushes are not promoted to platform proof. W21 stays partial; W22-W26 and later phases remain. No new service-proof cluster is started by this handoff. Historical deleted evidence remains missing.

## Final verified source

Fixture commit: `9b85ba7b0c096d86bc2188eb1805a001fe921e23` (two explicit test paths). The final matrix is `run/confirmed-source-tests/matrix.json`: 58 isolated serial Bun processes across 29 paths, 454 passes, zero failures and zero skips. All 34 SHA-256 entries match both worktree and committed blobs. The earlier failed matrices are not included in these totals. Every recorded process checked in `run/summary.json` is absent; `run/commit-proof.json` records the commit comparison.

All seven final-source gates exit zero. The prior declaration build also exits zero, before the final test-only fixture changes. AST comparison preserves 9 original retaining-control assertion expressions and all 9 original pop assertion expressions, with 2 additional pop baseline assertions. Audit has zero touched high-risk findings and one DUP_ASSERT notice: identical exact-token assertions before and after rejected pop cover separate lifecycle stages and are retained. Scanner/lint/check policy is unchanged.

### Isolated process inventory

Paths below are relative to packages/core. Every entry has exit zero, zero failures and zero skips; columns name the outer environment. Explicit fixture backend selection remains as recorded in the source.

| Path | Old passes / PID | Journal passes / PID |
| --- | ---: | ---: |
| src/services/history/history-service-recorder-pop.test.ts | 1 / 36508 | 1 / 41161 |
| src/services/history/history-service-recorder-rewrite.test.ts | 4 / 36549 | 4 / 41179 |
| src/services/history/HistoryService.commitBoundary.test.ts | 10 / 36858 | 10 / 41469 |
| src/services/history/history-merge-admission.test.ts | 2 / 36877 | 2 / 41499 |
| src/services/history/history-merge-faults.test.ts | 4 / 36886 | 4 / 41527 |
| src/services/history/history-merge-owner-controls.test.ts | 4 / 36899 | 4 / 41544 |
| src/services/history/history-merge-pending.test.ts | 4 / 37203 | 4 / 42579 |
| src/services/history/history-merge-scale-faults.test.ts | 3 / 37352 | 3 / 42699 |
| src/services/history/history-merge-stream.test.ts | 6 / 37419 | 6 / 42780 |
| src/services/history/journalHistoryStore.merge.test.ts | 3 / 38363 | 3 / 43485 |
| src/services/history/pop-token-accounting-settlement.test.ts | 2 / 38413 | 2 / 43503 |
| src/services/history/journalHistoryStore.fanout.test.ts | 16 / 38470 | 16 / 43516 |
| src/services/history/journalHistoryStore.publishDetached.test.ts | 23 / 40749 | 23 / 45734 |
| src/services/history/journalHistoryStore.detachedOwners.test.ts | 13 / 40805 | 13 / 45786 |
| src/services/history/journalDetachedStream.test.ts | 5 / 40925 | 5 / 45903 |
| src/services/history/historyRecorderFanout.origins.test.ts | 2 / 40928 | 2 / 45908 |
| src/services/history/historyRecorderFanout.durability.test.ts | 3 / 40943 | 3 / 45921 |
| src/services/history/historyRecorderFanout.compensationOrigins.test.ts | 19 / 40964 | 19 / 45943 |
| src/recording/recording-integration-native-core.test.ts | 19 / 40990 | 19 / 45964 |
| src/recording/recording-integration-native-faults.test.ts | 6 / 41013 | 6 / 45984 |
| src/recording/recording-integration-native-lifecycle.test.ts | 14 / 41028 | 14 / 45994 |
| src/recording/recording-integration-native-ownership.test.ts | 2 / 41048 | 2 / 46019 |
| src/recording/recording-integration-native-boundary.test.ts | 14 / 41063 | 14 / 46031 |
| src/recording/recording-integration-native-replay.test.ts | 8 / 41091 | 8 / 46048 |
| src/recording/journalRecordingService.test.ts | 13 / 41114 | 13 / 46077 |
| src/recording/journalResumeAdoption.detach.test.ts | 2 / 41122 | 2 / 46088 |
| src/recording/session-fork-late-ownership.test.ts | 1 / 41132 | 1 / 46101 |
| src/recording/session-fork-offset-audit.test.ts | 1 / 41141 | 1 / 46118 |
| src/journal/flushRecords.test.ts | 23 / 41158 | 23 / 46128 |

### Required controls

These processes are separate from the positive matrix. Rejecting controls must exit one.

| Control log under corrected-controls/ | Pass / fail | Exit / PID |
| --- | ---: | ---: |
| pop-first-marker | 0 / 1 | 1 / 3114 |
| owner-loss | 2 / 2 | 1 / 3133 |
| old-retention-positive | 4 / 0 | 0 / 3375 |
| native-retention-positive | 4 / 0 | 0 / 3633 |
| old-retention-trap | 0 / 4 | 1 / 4763 |
| journal-retention-trap | 0 / 4 | 1 / 5036 |

Restored source bytes equal their preserved originals and committed blobs:

| Source | SHA-256 |
| --- | --- |
| packages/core/src/services/history/journalMediaMutations.ts | f1f8820f059287ead1b1523a0de25c0ccfcc746b23447e634afb9626e7b67ed3 |
| packages/core/src/services/history/journalDetachedCandidate.ts | 1c64d76620756508053694416804de2a9fea40cb81d6e84fac2b3e4705e7e072 |

### Gate processes

| Gate | Exit / PID |
| --- | ---: |
| Declaration build before final test-fixture adjustments | 0 / 18741 |
| core-tsc | 0 / 35307 |
| core-runner-tsc | 0 / 35389 |
| touched-tsc | 0 / 35404 |
| eslint | 0 / 35542 |
| prettier | 0 / 35905 |
| affected-graph | 0 / 35921 |
| audit | 0 / 36230 |

### Final-source hash map

| Source | SHA-256 |
| --- | --- |
| packages/core/src/services/history/history-service-recorder-pop.test.ts | ff26c8433b884e8a3f1a37cc28023592214de7903db164a2141001c8c7712931 |
| packages/core/src/services/history/history-service-recorder-rewrite.test.ts | e9994871f98930bf4d61d7a312d32a9a800997ca93eac839f43dbb5daa5c97cb |
| packages/core/src/services/history/HistoryService.commitBoundary.test.ts | 1fb63dc47659aaf4d437e6d7ad00c0b642ab684c32accd73239cc0031c5227bc |
| packages/core/src/services/history/history-merge-admission.test.ts | a2e3205fcb2245d403823135e8116f05e22287e4952447751f63d0a99351a5dc |
| packages/core/src/services/history/history-merge-faults.test.ts | 416ac97ad6693a66941e642f3b30ee1c73c171e497344fdee2ef951b2b10a71e |
| packages/core/src/services/history/history-merge-owner-controls.test.ts | 9328b2dc5a8bc597a74016a379724fb06b2b8fd16eb662b44dc6dfb2271282f9 |
| packages/core/src/services/history/history-merge-pending.test.ts | b301bae1a3d0c5b36011405fcec5398bdd0c41d04925dc802edadfd663810d13 |
| packages/core/src/services/history/history-merge-scale-faults.test.ts | 44b91d642c848c7e5f6f34a541cce4a445a04e4cee191708d4ad2aba84e4c3f9 |
| packages/core/src/services/history/history-merge-stream.test.ts | 044f5c877026971f1cc6cd4eb83e694c2654bf4a9ddc2d69c92d36434555b59f |
| packages/core/src/services/history/journalHistoryStore.merge.test.ts | d55ec501e35a7f62a8d9e2bfbacaf7662c1e6417ef50671c0b4502bb808ea6ae |
| packages/core/src/services/history/pop-token-accounting-settlement.test.ts | 1344f3316fd0309ca5edffcbcec247fd697fd85919406efd91626965acb6b71d |
| packages/core/src/services/history/journalHistoryStore.fanout.test.ts | da31d296ddd49f68e22c41d1ad31274f1e6df6432576bfeaedffa0f7be305fb2 |
| packages/core/src/services/history/journalHistoryStore.publishDetached.test.ts | d6f23f10317afb1560de2f41105d0800f6ef9825a8a036a3a0dc7da3b5a207de |
| packages/core/src/services/history/journalHistoryStore.detachedOwners.test.ts | 1d005a8caf5ae4aab5976c4d320550c090b6a5732254cf5cdcae9b9d4d6f9ca9 |
| packages/core/src/services/history/journalDetachedStream.test.ts | 4ab3c1cc1ac08ba606527e1eeaf7f7d8340e801ff11e1c8d462e239b52ec9c1f |
| packages/core/src/services/history/historyRecorderFanout.origins.test.ts | bbfb4e1b07494885c7ddd1e028dc4b5f39df0c829a78ce84cfb4f27191e8734c |
| packages/core/src/services/history/historyRecorderFanout.durability.test.ts | 5849ef4ce99a7ea95628a4ef0d7b4f9d46e135f1fd80fbe13be118a4c497639c |
| packages/core/src/services/history/historyRecorderFanout.compensationOrigins.test.ts | 3666f469ac85c2671b1d0f90abd14c426f508f2d14855679e36df359ca57a147 |
| packages/core/src/recording/recording-integration-native-core.test.ts | 96dc251680d2701835f466093f38fedb3f88e1ccbeb224225a49b64e7a52188a |
| packages/core/src/recording/recording-integration-native-faults.test.ts | 71e6fb4d3874f3a3a2ceac22bd99b21af790a43b6a5090433349cc6b520c5cd0 |
| packages/core/src/recording/recording-integration-native-lifecycle.test.ts | cea706a7f9621b6be4345c89597a430f9c8621c34633e3b85da8c316f4b6fb06 |
| packages/core/src/recording/recording-integration-native-ownership.test.ts | 5e24f0db0eabd5942476ed8aee477408732fdc30f2a7c8d50d9eb034cc224647 |
| packages/core/src/recording/recording-integration-native-boundary.test.ts | c3d2ecabcc2430c41f65eb2a18afde604aca3580c997409edf6c03bcbe45f4b6 |
| packages/core/src/recording/recording-integration-native-replay.test.ts | bcb0ff9fd4945f7377fe029bd30d8302abe6f8379f459c79110d19fae081188c |
| packages/core/src/recording/journalRecordingService.test.ts | 729cda3245a3165e974ffb4d040d03a8dfb6c922f7a99c1a92ef2d119f74b247 |
| packages/core/src/recording/journalResumeAdoption.detach.test.ts | 1201b734c6de370df0ad6d8754493d453fd15ea0545614224aace3979e62ee39 |
| packages/core/src/recording/session-fork-late-ownership.test.ts | fc5be3b1fd981b6476ea9d1e527e339c8803b4c1259612dc49ebfd2203b66878 |
| packages/core/src/recording/session-fork-offset-audit.test.ts | d6a4aa47b7c5a7d3c086ed00bddd3ffa9db3c13cbd23926bdab476ad1a67528d |
| packages/core/src/journal/flushRecords.test.ts | c270baaa3e8a67643bf06f1c0e80df8916e75aeaa69d922fdab03c2e3126d65e |
| packages/core/src/services/history/journalMerge.ts | 786fd74a7e4d9e7bc8daa308971865e7ac42061d526d98d8751972ad8db39178 |
| packages/core/src/services/history/journalOps.ts | c36e753f2e48c83133f8a9abdeaf20083a5b878396bfc630e28aa4af919bc1ad |
| packages/core/src/services/history/journalDetachedCandidate.ts | 1c64d76620756508053694416804de2a9fea40cb81d6e84fac2b3e4705e7e072 |
| packages/core/src/services/history/journalDetachedPublication.ts | 2b5bd891135395147be04091c342298fe71c45d95364a736d84b7b0789751010 |
| packages/core/src/services/history/__tests__/support/service-recorder-mutations.ts | 47775c74f308352c6508a592e075363a7384aedfcad7361ed0b665561bf2d3d5 |

This completes only the service-mutations increment. W21 remains partial with the six outstanding contract groups above. Historical deleted logs remain missing. No next service-proof cluster, backend default flip, OCR, cleanup, push or merge was performed.
