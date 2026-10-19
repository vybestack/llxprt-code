# Recovery chronology, reconstructed

This is a dated restart log compiled from preserved transcript records. It is not the deleted complete `tmp/854-notes/p4/LOG.md`. Partial original LOG output remains under `fragments/stdout/`; provenance records the source timestamp and seq for each excerpt. Task reports and prompts are decoded under `../extracts/reports/` and `../extracts/prompts/`.

The phase-four planner reported its S00-S16 plan at current recording seq 100 on 2026-10-16. The later wiring planner reported W1-W25 at seq 260 on 2026-10-17. D-ORCH-7 added W26 and clarified W24 measurement requirements at seq 261. The snapshot preserved from persisted history[83] gives a detailed intermediate restart state. Its W11 progress count is earlier than the final closure report.

Later recorded task reports establish these work states:

| Seq | Recorded result |
|---:|---|
| 432 | W15 owner/fork/offset proofs reported complete at `a5d715d29` |
| 434 | W16 child session wiring reported complete at `c165a80e4` |
| 436 | W17 production wiring committed; wider lifecycle/fault proofs remain partial |
| 446 | W18 package and slash-command gaps reported closed |
| 448 | W19 snapshot/media scan work committed at `b647d7dc1` |
| 452 | Producer-error blocker reported fixed at `243558304`, with 512/8192 cases on both backends |
| 506 | W11 original92/original37 closure reported at `b0f58ec58`; exact tables later lost |
| 510 | W21 part one committed at `7411cff7b`; worker reports ignored-file cleanup incident and W21 partial |
| 512 | Direct read records the existing incident document and repository state |
| 514 | Docwriter reports three placeholder recovery documents, without complete extraction |
| 517 | Recovery task directs structured payload extraction and corrects source path/presence claims |

Exact source timestamps are in `../extracts/index.json`. The current recording is `session-2026-10-16T15-54-19-3851f0a8-d63.jsonl` in the manifest's chats directory. Seq numbers refer only to that recording, not persisted history indices.

On 2026-10-19 this recovery pass extracted complete historical rules, the user-supplied snapshot, decision append bodies, planning/closure reports and partial stdout. It preserved the docwriter placeholders before replacing their current claims. It copied the recreated W21 notes and final-delivery inventory without changing their originals.

The incident record exists and is preserved verbatim, including its unsupported earlier-notification claim and obsolete cleanup advice. Current reporting relies on the primary agent's present notification, not that historical wording. `RULES.md` overrides all cleanup commands. No implementation, dependency operation, build, cleanup, review, Git mutation or W21 continuation was performed in that recovery-only pass.

## W21 native lifecycle part two, new run 2026-10-19

Primary authorization permitted implementation after recovery. Commit `6bcc23386` contains the five-file lifecycle cluster. All 22 old lifecycle cases and assertions are preserved and pinned old. Added 14 native lifecycle and 2 native ownership cases; reused the existing 19 native-core and 6 writer/owner cases without duplication.

Corrected production RED: 7 pass, 3 fail in `tmp/854-notes/p4/w21/lifecycle/run-20261019-part2-a/red-native-corrected.log`. Mirror detachment discarded unobserved positional write/flush failures; replacement attachment exposed a later poisoned-writer error. Fixed detachment to report unobserved failure after unlinking and to release recorder registration in finally. Boundary-observed failures preserve the existing disposal behavior. No production history-sized state or operation files added.

Final GREEN: 24 processes, 222 passes, zero failures/skips across 12 paths, each isolated in both outer backend environments. Exact exits, PIDs, source hashes and logs: `tmp/854-notes/p4/w21/lifecycle/run-20261019-part2-a/after-test-utils-move/`. Gates passed: declaration build, core no-emit tsc, scoped zero-warning ESLint/Prettier, affected graph, AST audit with no new high-risk touched-file findings against base `7411cff7b`. Two media DUP_ASSERT notices compare before/after distinct lifetime events; the original promise identity SELF_CONFIRMING notice is unchanged. The graph check is not an affected-shard test run.

The initial RED log includes two test-author API mistakes; the corrected RED excludes them. A media fixture initially released the same owner identity it meant to preserve; a separate admission reservation scope corrected that input without changing assertions or production. Initial shell-matrix summaries were all green but its wrapper status was nonzero; an explicit diagnostic of the final Bun command returned zero. The final structured matrix records each process exit directly. A declaration-build obstruction then failed before test load because Bun executed test-utils/dist/index.d.ts. Only that individually verified ignored directory was moved intact to `tmp/854-notes/p4/w21/held-generated/run-20261019-part2-a/test-utils-dist`; no deletion occurred.

W21 remains partial. The lifecycle map and exact next clusters are in the run's `contracts.md` and `tmp/854-notes/p4/w21/remaining-contracts.md`. No replay/compression/replacement/failure-family/agents closure, no full package or monorepo claim, no default flip, no push or merge. Review skipped per Andrew 2026-10-09. Historical deleted evidence remains missing; these are new proofs.

## W21 replay/boundary part three, new proof 2026-10-19

Commit b0ecaef63da080cd53569fc765af122c96d8ba7f preserves all45 original old replay/compressionBoundary/replaceInterleave cases and assertions with explicit old construction. Six test/support files add22native cases over real service+recorder+integration. Native resume/adoption covers title tri-state, session/project/start/name/checkpoint/lock/path identity, full rapid/large/random rows, inline media, changed-turn/equal-text rebuild and resumed compression. Native boundary cases cover primary/mirror held trailers for clear/replacement, FIFO additions, metadata interleaving, populated handover, publication compensation and records/trailer/flush failures followed by real reopen.

Final source proof: tmp/854-notes/p4/w21/replay-boundary/run-20261019-part3-a/after-audit/,34isolated serial processes360pass0fail0skip across17paths in both outer environments.18source hashes match commit/worktree. Declaration build, final coretsc including touched files, scoped zero-warning lint/format, affected graph and audit passed; no touched audit finding. Existing native adoption/pin/publication/core/lifecycle/fault/ownership suites are mapped and RUN, not duplicated. Exact45-case map and non-equivalent generated/reference-media/unstamped cases: contracts.md. W21 remains partial; no full package/affected-shard/monorepo claim.

There is no production change or confirmed product RED in this increment. Preserved failures are fixture/oracle errors itemized in contracts.md, including primary clear's zero-record trailer gate and writer-poison versus reopen distinction. All earlier matrices/logs are retained. Only the individually verified ignored test-utils/dist obstruction was moved intact to the unique part3 held-generated directory, temporarily returned for tsc and re-held; no deletion. No .llxprt modification, cleanup, recursive recovery staging, default flip, OCR, push or merge. All recorded run PIDs absent. Review skipped per Andrew2026-10-09. Historical deleted evidence remains missing.

## W21 native failure family part four, new proof 2026-10-19

Commit6a42630abf2481151312816deed1ff3cbea0018f from verified baseb0ecaef63 contains nine explicit source/test paths. All15expanded cases in six original failure-family suites remain, with only the integration snapshot constructor explicitly old and two new memory cases added beside the originals. Four original shared report suites are byte-identical. Added21native cases cover512/8192report generations and actual reopen/adoption, prequeued errors, terminal reporting storage, cause projections, consumer/scratch cleanup,32concurrent boundary/disposal transfer, partial/no-progress/torn-record/torn-trailer writes, read/flush/close and primary+cleanup identity ordering.

Actual RED1 initial-native.log6pass1fail: competing once-only recorder.flush calls caused prequeued failures to bypass reports; attached persistJournal now owns the recorder flush. RED2 red-diagnostic-read-close.log0pass1fail: finally-close masked primary read error; closeDescriptor now preserves both in order. Native I/O tests exercise read-only, close-only and combined failures. Fixture-only initial errors and the narrower added native memory lifetime are explicitly separated in contracts.md. Shared undrained512/8192report+trap proof and1MiB/8MiB/440controls are unchanged.

Final verified-tests/matrix.json:44isolated serial Bun processes384pass0fail0skip across22paths, both outer environments;28source hashes match worktree. All gates passed: declaration/coretsc/scoped-child types, nine-path zero-warning lint/format, affected graph rerun after staging, audit with zero touched findings. Every recorded run PID absent. Exact15-case map and proof boundaries: tmp/854-notes/p4/w21/failure-family/run-20261019-part4-a/contracts.md. Graph validation is not affected-shard execution; no full package/monorepo claim.

The initial matrix's generated declaration obstruction is preserved, and only verified ignored/untracked/nonsymlink packages/test-utils/dist moved intact to the unique w21/held-generated/run-20261019-part4-a/test-utils-dist. No cleanup/deletion, .llxprt edit, recursive recovery staging, default flip, OCR, push/merge, check weakening or new review. Review skipped per Andrew2026-10-09. W21 stays partial with exact current gaps in remaining-contracts.md. Historical lost logs remain missing; this is new evidence.

## W21-owned W17 agents remainder, new proof 2026-10-19

Commit `e514188fc7f00638700e28025d3aec9976e8f25a` closes W17's named wider public lifecycle/fault remainder from verified base `6a42630abf2481151312816deed1ff3cbea0018f`. The exact suites are `packages/agents/src/api/__tests__/session.spec.ts`, `session-owner-restore-checkpoint.behavior.test.ts` and `recording-owner-lifetime.behavior.test.ts`. All 32 original expanded cases remain explicitly old; their ten original describe blocks are AST-identical to base. Added 24 native public cases and two explicit old/native media-reservation-failure cases, with one test-only native file/backend fixture. Production code is unchanged.

New native proof covers public checkpoint/fork/clear/name/collision/rollback, captured media, atomic reservation failure, startup/subscription faults, admitted positional-write disposal, adopted identity and detached-primary stop, a later detached provider turn, two borrowed facades and public shutdown admission. Independent disk readers inspect native rows, facts and checkpoint descriptors. Write/flush failure injection wraps real positional files and retains the actual platform flush on successful paths. Existing 25 native core/fault cases, lifecycle/ownership/boundary/replay/writer/adoption/fork cases and all six W17 part-one suites are mapped and RUN rather than duplicated.

Final `tmp/854-notes/p4/w21/agents-lifetimes/run-20261019-part5-a/after-audit-tests/matrix.json`: 42 isolated serial Bun processes, 438 passes, zero failures/skips across 21 paths in both outer environments. Each file runs alone from its package directory. All 22 source hashes match worktree and commit; recorded run PIDs are absent. Gates passed: declaration build, core tsc, agents noemit, agents Bun test types with installed Bun ambient declarations, explicit touched-file tsc, zero-warning scoped ESLint/Prettier, staged affected graph and AST audit. The graph gate is not affected-shard execution. Audit has zero touched high-risk findings; its nine duplicate-assert notices compare distinct lifecycle stages, including two unchanged originals.

No confirmed product RED was found in the bounded native contracts. Initial loaded-suite failures were test-oracle/fixture errors itemized in `contracts.md`, including missing native flush joins and shared-facade history assumptions. Before/after equality remains exact through byte comparison, strict row comparison and listener-count deltas; no assertion or check was weakened. The stale test-only `.parts` fallback was removed to typecheck the current IContent API. An exploratory old JSONL media-deletion validation failure was filed separately as [#3899](https://github.com/vybestack/llxprt-code/issues/3899); native live-checkpoint deletion refusal is expected and was not changed.

Only individually verified ignored, untracked, nonsymlink `packages/mcp/dist` and `packages/test-utils/dist` declaration obstructions were moved intact into unique `w21/held-generated/run-20261019-part5-a/` paths. The first pre-load matrix output names were reused once; those overwritten files are not claimed preserved. Subsequent evidence paths are distinct. No cleanup/deletion command, .llxprt edit, recursive recovery staging, default flip, OCR, push or merge. Review skipped per Andrew 2026-10-09.

W17 is DONE for its named public remainder. W21 stays partial: the generated/reference-media/unstamped replay cases, service every-byte cut/reopen/restore, repeat-sequence pop, service-plus-two-recorder fanout, service large-row/crash/transport boundaries and wider discovery inventory remain as listed in `tmp/854-notes/p4/w21/remaining-contracts.md`. No full package/shard/monorepo or historical-log recovery claim is made.
