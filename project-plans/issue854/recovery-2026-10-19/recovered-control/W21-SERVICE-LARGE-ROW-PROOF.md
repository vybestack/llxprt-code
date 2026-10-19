# W21 service large-row roundtrips, 2026-10-19

The 17, 40 and 200 MiB service/recorder roundtrips pass, and the retained-row control rejects the unchanged 1 MiB predicate. This accounts for W21 defect 5's service persistence/resume requirement. W21 remains partial for the contracts listed below. W23 send/planning-envelope behavior is separate and is not established here.

This is new evidence from base `ce3165eac939ba36fb5df3f8267c994ee13d41f6`, not recovered historical output. The stopped work and raw logs remain under `tmp/854-notes/p4/w21/service-large-row/run-20261019-part7-a/`, abbreviated `run/`. Finalization evidence is under `run/finalize-20261019-a/`, abbreviated `final/`. Fixtures remain intact under `tmp/854-notes/p4/w21/service-large-row/fixtures/`. Only the six requested new test/support paths and this proof map plus the tracked LOG belong to the commit. Production code is unchanged.

## Public path and independent oracle

The four `history-service-recorder-large-row*.test.ts` files use `__tests__/support/service-large-row.ts` and `service-large-row-proof.ts`, all under `packages/core/src/services/history/`. They construct explicit journal HistoryService, actual JournalRecordingService and RecordingIntegration. The tokenizer is a deterministic test factory; persistence, serialization, CRC verification, positional I/O, flush, resume and adoption are real.

Each payload is exactly 17, 40 or 200 MiB of UTF-8 input, built from varying bounded pieces containing non-ASCII text, quotes, backslashes and newlines. The generator computes the expected SHA-256 incrementally from those pieces before public `addBatch` admission. It joins token updates and commit before returning only the byte count and digest. The input text and pieces are confined to that completed async frame, so the baseline and settled checkpoints do not include a fixture holding the input row.

Public `streamRawHistory` reads are consumed one row at a time. The independent persisted reader opens the recorder file read-only, traverses the committed row tree, resolves persisted owner dictionary entries, reads body lengths/offsets and decodes the complete row under CRC. It compares text byte count, SHA-256, speaker, full metadata and block count against the input-derived digest. It retains only scalar digests and small metadata, never a history-content array. One row may be materialized for its conversion/read. No operation spool or repeated whole-file read is introduced.

The proof closes the integration, service and recorder, calls the actual `resumeSession` front door, adopts its native boot into a fresh HistoryService and subscribes a fresh integration. Public and independent disk reads must match the original digest and owner. Path, session and project identities remain exact. A later owned append and flush must produce two rows, preserve the first row and owner, keep its original offset, and start the new row exactly at the prior durable end. The final disk view must equal the public digest view. This is service-level proof rather than a relabeled store/session test.

## Retained heap and fixture lifetime

The retained-growth allowance remains strictly below 1,048,576 bytes at every checkpoint. Positive tests also reject any delta at or below -262,144 bytes, preserving the existing baseline-validity floor. Setup and test limits remain 60,000 and 120,000 ms. The existing `medianSettledHeap` collector and its convergence rules are unchanged.

Before baseline, startup code is aged out and a separate disposable rig completes the same byte-sized roundtrip. Its helper frame returns before creating the empty measured rig and taking the settled baseline. No warm payload, decoded row, live warm service or content oracle is retained into that sample. The matched workload warms size-specific execution paths. All measured reads release their rows before settling. The four checkpoints are admission plus mirror flush, public plus independent disk read, fresh resume/adoption plus both reads, and continued durable append plus both reads.

The trap deliberately keeps one complete public-reader row reachable through every post-read sample and through the returned result. It does not change recorder work or the acceptance predicate. Its dedicated test passes only if that predicate rejects and every post-read delta exceeds 1 MiB. A separate run applies the same retention mutation to the ordinary 40 MiB positive test and must actually fail its positive assertion.

All values below are bytes relative to the empty measured-rig baseline. `final/positive/` contains the raw JSON and logs.

| Input | Admission | After public/disk read | After resume/read | After append/read | Held rows | Predicate |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| 17 MiB | 164996 | 247977 | 354556 | 417224 | 0 | accept |
| 40 MiB | 165282 | 248381 | 336888 | 409834 | 0 | accept |
| 200 MiB | -170687 | -61629 | -183629 | 356398 | 0 | accept |
| 40 MiB retained-row trap | 163930 | 77143569 | 77232010 | 77304890 | 1 | reject |

The 200 MiB deltas remain above the negative validity floor. These are retained-heap measurements, not peak-allocation or process-RSS bounds.

| Input bytes | Expected and observed SHA-256 |
| ---: | --- |
| 17825792 | 9c5e31414e184757a97c06639368316961d6184d20eea25f8912780f8053c6b3 |
| 41943040 | b2706504e1fc9d816415d006d66febd368fb88ecf1f73c88726a6f57e55d50b9 |
| 209715200 | bee7c8bb8835e990741e44eb3af13f2d98c85953d4e3ed7534a5407ff3a2c6bd |

## Stopped failures and their differing inputs

No unmutated product defect or production fix is claimed in this increment. Earlier surviving results are development evidence, not the final-source matrix.

- `run/initial.log` used a strict-greater-than oracle for an append that correctly starts exactly at the previous durable end. The final oracle requires exact equality.
- `positive-initial/` and `matched-warm/` exposed negative deltas when the 200 MiB materialization aged out code that a smaller warmup had not exercised. `per-case-ageout/` instead measured cold recompilation footprint. The earlier `matched-size/` results use different source and are not counted as final evidence.
- `cold-proof/native-200.log` timed out at 120000 ms after 18 assertions. That version added a full idle-code age-out, at least 20 seconds and potentially longer while settling, at each of four measured checkpoints. These waits were absent from the earlier matched-size input. Final setup uses a separate same-size warmup, then the unchanged settled collector without four new idle waits. No threshold, convergence rule or timeout was loosened, and negative-delta validity plus rejecting traps remain enforced.
- `run/gates/core-tsc.log` found a readonly digest array passed to a mutable Bun assertion overload. The expected array is now a shallow scalar-digest copy; strict equality is unchanged.
- `final/positive/journal-18.log` records nine failures because the unchanged JSONL durability suite built SessionRecordingService and ResumeCursorBoot but inherited the journal environment. `final/continuation/old-jsonl-18.log` runs that same suite with its required old-backend input. It is old-layout coverage, not native proof. No assertion or source test was skipped or changed.
- `final/continuation/journal-27.log` failed before suite load when Bun selected the generated test-utils declaration entry point. The exact `packages/test-utils/dist` directory was verified ignored, untracked and nonsymlink, then moved intact to `tmp/854-notes/p4/w21/held-generated/run-20261019-part7-finalize-a/test-utils-dist`. Only the two still-unrun suites were continued in `final/remaining/`. The held directory and failed log are preserved.

## Final-source process boundary

`final/matrix.json` explicitly assembles 17 successful processes from `positive/results.json`, nine from `continuation/results.json` and two from `remaining/results.json`. The two failed attempts above remain in their original results and are excluded from the passing total, rather than relabeled successful. No successful heavy proof was repeated to obtain a preferred measurement.

The completed matrix has 28 isolated serial Bun processes across 28 paths, 222 passes, zero failures and zero skips. Every file runs alone from `packages/core`. The new suites explicitly select journal regardless of the outer variable. Existing suites retain their actual backend choices; outer journal does not turn explicitly old cases into native cases.

The reused suites cover streamed frame/CRC and large-row store/session behavior, complete row-codec metadata, scalar/cursor reads, actual resume/adoption and repeated resume, pinned generations, W15 owner/fork offsets, native core/replay, the original explicitly old replay suite, and actual platform full-flush/no-fallback controls. None is copied into the new suite. Graph validation is not an affected-shard execution claim. No full package or monorepo run is claimed.

## Actual rejecting controls and restoration

These runs are separate from the passing matrix. The 16 MiB read-limit mutation is injected into the real `rowReads.ts` body reader. Each final-source suite fails while warming its actual requested-size service/recorder route, before the measured case. The logs contain the injected JournalFormatError, not a timeout or loader failure. These are deliberate regression controls, not failures of the unmutated implementation.

| Control under final/ | Pass / fail | Exit | PID |
| --- | ---: | ---: | ---: |
| read-limit/reject-17 | 0 / 1 | 1 | 96388 |
| read-limit/reject-40 | 0 / 1 | 1 | 97054 |
| read-limit/reject-200 | 0 / 1 | 1 | 97667 |
| retaining/reject-40 | 0 / 1 | 1 | 98247 |

The retaining run sets only `W21_LARGE_ROW_RETAIN=1` on the ordinary 40 MiB positive test. Its actual positive assertion receives accepted=false and fails, with admission 165104 and post-read deltas 77144745, 77233186 and 77306070 bytes, holding one row. Source bytes are unchanged.

`final/read-limit/rowReads.original.ts` and `rowReads.mutated.ts` preserve both versions. `restored.json` records `cmp` exit zero and equality with HEAD. Original and restored SHA-256 are `da4d903c3cc74a6d7bcfb36eedbf13ef7104abd5016e5002c70a1d84ea01d8e3`; the mutation SHA-256 is `0642dfacd5073d3a3e372f7c70d010f21ed925ddb09baf492b560de939f246d5`. Restoration occurs in finally before retention controls or gates. All 32 tested-source hashes still match the worktree and indexed bytes afterward. No mutated production source is staged.

## Final-source gates and identity

Every gate in `final/gates/results.json` exits zero. The declaration build is rerun after the final test-only sampling/type changes, so the earlier stopped-run build is not substituted for a final-source gate. Full-corpus AST audit has zero findings on all six new paths, including zero MOCK_MIRROR, ALWAYS_TRUE, SELF_CONFIRMING or NO_ASSERT findings. No scanner/lint policy changes are made.

| Gate | Exit | PID |
| --- | ---: | ---: |
| npm run build:types | 0 | 98947 |
| core noemit tsc | 0 | 698 |
| core runner tsc | 0 | 903 |
| explicit six-path tsc | 0 | 917 |
| six-path ESLint, zero warnings | 0 | 990 |
| six-path Prettier check | 0 | 1102 |
| affected-test graph | 0 | 1107 |
| AST test audit | 0 | 1196 |

`final/source-hashes.json` records 32 paths. `final/summary.json` verifies unchanged worktree/indexed bytes, zero touched audit findings and absent recorded children/supervisors, including the ten stopped-run children. The source snapshot predates the controls; comparisons after restoration and all gates match it. The final commit comparison is recorded in `final/commit-proof.json` after committing.

| New source, relative to packages/core/src/services/history/ | SHA-256 |
| --- | --- |
| __tests__/support/service-large-row-proof.ts | efaf7504f793bcec49c201e2f3656bab9fcebe30662e1b4ea0eabd6f71566926 |
| __tests__/support/service-large-row.ts | 4047e58eb7c9e044af74dd3477a8fd82cf6a7a63e61fbd2ffa152830ef846182 |
| history-service-recorder-large-row-200.test.ts | 0f51f53ae12727d15a19fc012fe5ca68b050027e7f11855778352f088a6808a9 |
| history-service-recorder-large-row-40.test.ts | 38137a230f4b43c6d91f2d3f2b44204cd4640c8e2fa5edfe0e1c3464eb062eda |
| history-service-recorder-large-row-retention.test.ts | 6dce104b403c639c73b9ba8d842312bd9d7efbbd085a55d15476343a60b4ac30 |
| history-service-recorder-large-row.test.ts | ae324b0898bb40f3bcb5c8cef92967b96b0d216b72bd252472550c03ca40397f |

### Isolated process inventory

Paths are relative to packages/core. All entries exit zero, with zero failures/skips. The environment column is the outer environment only; the source determines each fixture's actual backend.

| Path | Environment | Passes | PID |
| --- | --- | ---: | ---: |
| src/services/history/history-service-recorder-large-row-200.test.ts | journal | 1 | 89470 |
| src/services/history/history-service-recorder-large-row.test.ts | journal | 1 | 90459 |
| src/services/history/history-service-recorder-large-row-40.test.ts | journal | 1 | 91069 |
| src/services/history/history-service-recorder-large-row-retention.test.ts | journal | 1 | 91705 |
| src/journal/journalLargeRows.test.ts | journal | 5 | 92365 |
| src/journal/frame.stream.test.ts | journal | 5 | 92394 |
| src/journal/rowRecord.test.ts | journal | 19 | 92430 |
| src/services/history/journalHistoryStore.largeRows.test.ts | journal | 4 | 92440 |
| src/services/history/journalSession.largeRows.test.ts | journal | 5 | 92470 |
| src/services/history/journalRowCodec.test.ts | journal | 39 | 92497 |
| src/services/history/journalRowCodec.cyclic.test.ts | journal | 2 | 92500 |
| src/services/history/journalHistoryStore.scalars.test.ts | journal | 4 | 92508 |
| src/services/history/scalar-descriptors.test.ts | journal | 5 | 92516 |
| src/services/history/scalar-cursor.test.ts | journal | 7 | 92526 |
| src/services/history/scalar-journal.test.ts | journal | 5 | 92661 |
| src/services/history/scalar-range.test.ts | journal | 2 | 92779 |
| src/services/history/history-resume-adoption.test.ts | journal | 11 | 92787 |
| src/services/history/history-resume-durability.test.ts | old | 9 | 93667 |
| src/services/history/history-resume-repeat.test.ts | journal | 2 | 93694 |
| src/recording/journalResumeAdoption.test.ts | journal | 8 | 93704 |
| src/recording/journalResumeAdoption.detach.test.ts | journal | 2 | 93719 |
| src/journal/journalStore.pins.test.ts | journal | 7 | 93731 |
| src/recording/session-fork-offset-audit.test.ts | journal | 1 | 93739 |
| src/recording/session-fork-late-ownership.test.ts | journal | 1 | 93747 |
| src/recording/recording-integration-native-replay.test.ts | journal | 8 | 93765 |
| src/recording/recording-integration-native-core.test.ts | journal | 19 | 93788 |
| src/recording/RecordingIntegration.replay.test.ts | journal | 25 | 95002 |
| src/journal/flushRecords.test.ts | journal | 23 | 95052 |

## Remaining contracts

W21 remains partial. Defects 2/3 remain accounted for by the prior service-mutations increment; defect 4 reuses W15. This increment accounts only for defect 5's 17/40/200 MiB service/recorder/close/reopen/resume path. It does not establish:

1. Defect 1: every-byte service-plus-real-recorder torn-tail cut/reopen and full `restore(version)` matrix.
2. HistoryService child/SIGKILL and the stronger tool-round crash case. Lower-level store crash proof is not equivalent.
3. Actual ChatSession/todo/IDE/directory/turn transport-next-request durability. Explicit integration flush boundaries are narrower.
4. Wider unreadable-session/scans, resume identity, extensions, checkpoint/fork and janitor discovery inventory.
5. Exact reference-media resume, generated metadata/compression-size/flush-segmentation/minimum-large-text matrices, and unstamped disk-row rebuild followed by equal-text append.
6. W23 send/planning-envelope refusal and 40 MiB send behavior, plus W22-W26 and later phase requirements.

Historical deleted evidence remains missing. The old backend stays default. Review skipped per Andrew 2026-10-09. No OCR, push, merge, pattern kill, cleanup/deletion, `.llxprt/` edit, bulk recovery staging or check weakening belongs to this finalization.
