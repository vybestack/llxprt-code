# Recovered decision guidance

This is a reconstructed index, not the original complete DECISIONS file. Eleven D-ORCH append bodies are preserved verbatim under `fragments/DECISIONS/`; source timestamp, seq, command and result are indexed in `provenance.json` and `../extracts/index.json`. Other per-slice decisions survive only as quoted fragments or task reports. The recreated post-incident DECISIONS file is preserved separately.

| Decision | Current-recording command seq | Recovered substance |
|---|---:|---|
| D-ORCH-1 | 119 | Trailer-answerable reads stay synchronous. Content reads become async, without cached last rows. Counts and chronology come from aggregates. |
| D-ORCH-2 | 135 | Leave old-store internals alone. Make public methods async and delegate complete operations through the port. Fix the producer-error lifecycle blocker before the flip. |
| D-ORCH-3 | 155 | Async detached sink operations provide row-by-row backpressure without another bounded channel. |
| D-ORCH-4 | 163 | Unchanged and cut-tail publications preserve their operation semantics; append reads aggregates; batch notifications follow one explicit lifetime contract. |
| D-ORCH-5 | 227 | Preserve owners through explicit source ordinals, not object identity. Synthetic rows use the operation's named origin. |
| D-ORCH-6 | 255 | Compaction keeps commitSeq/groupTag. Every offset-based reader holds and releases a pin. |
| D-ORCH-7 | 261 | Accept wiring decisions with W26 required before final proof; measure double writes in W24 and choose from that evidence. |
| D-ORCH-8 | 305 | Delete caller-free G5 mutation methods and fallback; port tests through production APIs without weaker assertions. |
| D-ORCH-9 | 341 | Run W12/W13/W20 before W11 and recorder-fixture classification. Fix broken retention traps at their cause. |
| D-ORCH-10 | 373 | No backend-conditioned skips. Construct the old implementation explicitly for old internals and record native behavioral counterparts or an explicit old-only reason. |
| D-ORCH-11 | 411 | Detaching an adopted primary first moves the store to a streaming clone in the mutation queue, then closes the recorder. Recording off must stop writes to that session file. |

These entries summarize recovered instructions. Their full language is in `seq-<number>-append.txt`. Paired shell responses appear at the next seq except when concurrent tool results share a record; use callId in the index rather than assuming ordering alone proves execution.

D-ORCH-2's producer-error blocker was later reported fixed at `243558304`: current recording seq 452, with observed failures and 9/9 lifecycle passes on each backend. This is a transcript report, not a restored test log.

Current standing decision: never use broad or generated cleanup again. No `git clean` or `rm`. Read `RULES.md`; it overrides all historical cleanup directions, including those still preserved verbatim in the archived originals. Record notification only as established by the primary agent's current commentary. The preserved incident file's earlier notification claim is not adopted here.

## Native lifecycle part two decisions, 2026-10-19

This entry records new implementation decisions at `6bcc23386`, not recovered historical text.

- Native detachment must surface a previously unobserved mirror I/O failure while still releasing its binding. Track only whether the existing per-mirror failure was reported by flush. Continue reporting poisoned-writer failures at turn boundaries, but do not repeat an already observed failure at disposal. Existing native fault assertions remain unchanged.
- Snapshot save generations and synchronous saveJournal scheduling remain old-only because native recording writes its durable journal directly. Their public durability/failure/disable behaviors use real positional write/flush counterparts. Do not invent native snapshot saves, repair retries or persistence mocks.
- Operational events continue through debug output, with no growing journal event log. Assert both actual severity/message output and an unchanged independently read trailer.
- Distinguish media admission and history reservation identities in the ownership test. Releasing a reservation with the default history scope intentionally releases that exact history owner; use a separate admission scope when verifying ownership transfer.
- Build output that obstructs Bun is preserved, never deleted. Only packages/test-utils/dist was individually confirmed ignored and moved to the exact held-generated destination recorded in the new run. Do not generalize this to other package directories.

New proof: 24 isolated processes, 222 passes, zero failures/skips; declaration/core tsc, scoped lint/format, affected graph and audit passed. W21 stays partial. Review skipped per Andrew 2026-10-09.

## Native replay/boundary part three decisions, 2026-10-19

New commit b0ecaef63da080cd53569fc765af122c96d8ba7f changes tests/support only. Primary acknowledgement controls mutation publication, while integration turn-boundary flush joins asynchronous recorder mirrors. Explicitly test both roles; for primary clear gate its trailer-only first write, with independent trailer-size verification. A physical positional write/flush failure poisons the writer, so continuation requires real resume/reopen. Observer rejection after acknowledgement uses compensation and continues on the same writer. No production fix was justified by the test-authoring failures; their logs remain preserved and distinguished from product RED.

Keep45 original old assertions/cases; add22native service+recorder+integration cases and RUN existing committed equivalents. Map native current-version/ack behavior instead of inventing binary line counts, persisted operational event logs or native txId/begin/commit APIs. Do not close generated/reference-media/unstamped obligations with narrower related proof. Exact map and gaps: tmp/854-notes/p4/w21/replay-boundary/run-20261019-part3-a/contracts.md and remaining-contracts.md. W21 remains partial.

Conservation assertions retain equality as zero token delta from nonzero baseline and one distinct non-null file path. Final scoped audit has no findings, with scanner/check policy unchanged. Final34isolatedprocesses360passes0fail0skip; all gates passed and18source hashes match worktree/commit. No current run PID remains. Generated test-utils/dist was individually verified and moved intact, never deleted. No cleanup, .llxprt edits, recursive recovery staging, default flip, OCR, push or merge. Review skipped per Andrew2026-10-09. Historical deleted evidence remains missing.

## Native failure-family part four decisions, 2026-10-19

New commit6a42630abf2481151312816deed1ff3cbea0018f, not recovered historical text. An attached integration must have one owner for the recorder's once-only flush failure so persistJournal can produce its diagnostic report. A report reader's descriptor cleanup may not replace an earlier read error; preserve the exact ordered aggregate instead. Both fixes have observed RED-before-fix logs and public native tests.

All15original family cases remain; snapshot repair stays explicitly old, while the shared reporter/descriptor/consumer/I/O mechanisms are the same implementation native recording uses. Add21native cases and RUN related committed cases without duplication. Retain512/8192sizes and1MiB/8MiB/440controls/traps. Keep the shared undrained8192-error memory proof distinct from new native8192serial-boundary proof holding only its final report. A poisoned writer repeats the original cause and needs reopen before continued writes; no repair fallback is added.

Final44processes384pass0fail0skip across22files,28matching source hashes, all scoped gates passed, zero touched audit findings. Exact map: tmp/854-notes/p4/w21/failure-family/run-20261019-part4-a/contracts.md. The initial obstructed matrix and fixture failures remain preserved separately. Only verified ignored test-utils/dist was renamed intact into unique held-generated storage. W21 remains partial. No cleanup, .llxprt edits, recursive recovery staging, default flip, OCR, push/merge or new review. Review skipped per Andrew2026-10-09. Historical deleted evidence remains missing.

## W21-owned W17 public proof decisions, 2026-10-19

New test commit `e514188fc7f00638700e28025d3aec9976e8f25a`, from `6a42630ab`. Preserve all 32 old public cases and their assertions with explicit old fixture selection. Establish native equivalents through real public Agents, independent row-tree/state/checkpoint readers and positional file/flush fault seams. Keep JSONL markers, appendFile hooks and line ordering as old-layout tests. Do not invent native event lines or snapshot repair. No production API extension or production fix was justified by these native runs.

Native mirrors deliver asynchronously. Disk proof joins the existing public flush/stop boundary rather than racing an independent reader against fanout. This does not close the separate transport-next-request durability requirement. Two borrowed facades intentionally share one live client/history while recorder origins, files and locks stay separate; do not assert independently owned live histories. A resumed primary must detach to a streaming clone before closing its session file. The public proof checks both later history mutation and a later provider turn without changing closed-file bytes.

Failed native metadata writes poison the writer. Preserve colliding checkpoint identities/names, surface the unobserved failure at teardown, release ownership and resume through actual reopen. Do not add repair retries or a fallback. Media restore failure must unwind the first admitted snapshot reservation when the second is refused, preserve live/durable rows, allow later restore and leave no lease after live-history release. Reuse and RUN the committed lower-level contracts instead of duplicating them.

Final 42 processes/438 passes/zero failures or skips across 21 paths, 22 matching source hashes, all scoped gates passed. Exact source/process/gate proof is under `tmp/854-notes/p4/w21/agents-lifetimes/run-20261019-part5-a/`; `contracts.md` maps every original case. Audit conservation checks use exact byte/strict-row equality and zero listener deltas, with zero high-risk findings and no weakened scanner policy. The agents Bun project receives the installed Bun ambient types on its supplemental invocation; repository compiler configuration is unchanged.

W17's named public remainder is DONE; W21 remains partial. Separately observed old media-deletion blocker validation is tracked as [#3899](https://github.com/vybestack/llxprt-code/issues/3899), not repaired in this scope. Keep the old backend default. No cleanup/deletion command, .llxprt modification, recursive recovery staging, OCR, push or merge. Generated declaration obstructions were individually verified and moved intact. Review skipped per Andrew 2026-10-09. New evidence does not restore historical deleted logs.

## Native service mutation part six decisions, 2026-10-19

At e5a71cd6a570277773f73402d0d87742c2ffcc8b, self-merge derives rows by ordinal from the detached pinned source and carries numeric owners through the existing bounded append batch. Keep append semantics: two source rows announce two appended rows, not a four-row replacement. Original product RED is owner loss, 0 pass/1 fail. The final first-marker mutation separately rejects incorrect pop behavior, 0 pass/1 fail, followed by byte restoration. Real close/resume/adoption is required for A B A to A B continuation.

At 1fead98e55ebd7c3cadfb58982110932110b6c3e, sizes 3/64/65/5000 use HistoryService plus two real recorder/integration origins, public density and detached appendDerived rewrites, independent complete persisted owners/rows, one-group/actual platform-flush deltas, then zero-row clear. No standalone store mutation substitutes for service proof. The owner-loss-above-64 control passes 3/64 and fails 65/5000, 2 pass/2 fail, with byte restoration. No production density defect was found. W15 owner/fork/offset contracts are reused and rerun.

At 9b85ba7b0c096d86bc2188eb1805a001fe921e23, exact merge tokenization starts before seeding, with explicit old/native cases and exact prefix/total assertions. The finalization matrix also exposed the pop-failure fixture's native seeded-token baseline: diagnostics isolate old 0/2130/2130 versus native 1066/3196/3196. Install the intended zero-count seed tokenizer through the existing core-local fixture before admission, then keep exact/throwing action phases. All nine original pop assertion expressions remain in order; two baseline assertions are added. All nine original retaining-control assertions, 512/8192 sizes, 440-row/8 MiB bounds and timeouts remain. Handle both old contentAdded and native contentBatchAdded retaining sources; positive controls pass 4 each backend and rejecting traps fail 4 each. Retain one DUP_ASSERT for exact token totals before/after rejection, distinct lifecycle stages, without changing audit policy.

Final source proof: confirmed-source-tests/ and confirmed-source-gates/ under tmp/854-notes/p4/w21/service-mutations/run-20261019-part6-a/, 58 serial isolated processes, 454 pass/0 fail/0 skip across 29 paths; 34 hashes match worktree and committed blobs. All seven final-source gates pass; declaration build passed separately before final test-only adjustments. All 120 recorded PIDs are absent. Preserve the stopped verified-tests failure and settled-source-gates authoring type error separately. Full case/PID/gate/hash and missing-contract map: W21-SERVICE-MUTATIONS-PROOF.md. Defects 2/3 are accounted for; defects 1/5, service crash, actual transport/discovery and exact replay gaps remain. W21 partial, W17 named remainder done, old default unchanged. No next service cluster, cleanup/deletion, .llxprt edit, recursive recovery staging, OCR, push or merge. Review skipped per Andrew 2026-10-09. Historical deleted logs remain missing.

## Service atomicity part-eight decisions, 2026-10-19

Defect 1 proof uses actual HistoryService with an adopted native primary and real integration mirror. Bound the byte-cut fixture to three small human/tool rows while keeping every physical byte and transaction boundary. Validate each persisted cut through independent reader and real recorder owner open; keep lower-level store proof separate.

Physical I/O failure intentionally poisons the writer. Later mutation must fail fast without changing bytes; continuation requires actual reopen. Observer/media failures after acknowledgement require restore(version). If restore itself fails, retain the already acknowledged replacement and its derived accounting, report primary/restore causes in order, and still close both files. No retry, error swallow or spool is justified.

Primary restore reuses exact saved entries. Mirror restore intentionally rebuilds accepted rows, so require complete entry semantics plus exact contiguous new offsets instead of assuming reuse or a single constant translation from separately seeded groups. Restore is trailer-only: test its flush and trailer boundaries, not an invented record write. Preserve the failed authoring attempts and do not call them product RED.

The final 19 new cases plus reused suites yield 24 isolated processes, 273 passes, zero failures and zero skips, 43 matching hashes, all eight gates passing and zero touched audit findings. Final regression controls reject 0/1, 0/1, 4/6 and 0/3 with byte restoration. Durable source/process/cut map: W21-SERVICE-ATOMICITY-PROOF.md. Defect 1 is accounted for; W21 crash/transport/discovery/exact replay remain open and old default stays. No cleanup/.llxprt/OCR/push/merge/check weakening. Review skipped per Andrew 2026-10-09.

## W21 next-request and service crash decisions, 2026-10-19

Implementation commit `3fa3051e5781e90446c5eb5b6bf712d99718705a` joins the existing `HistoryService.waitForCommit()` in `prepareCuratedForProviderSnapshot`, before pin/snapshot construction. The observed mirror-held RED demonstrates why primary publication alone is insufficient. Use the existing primary-plus-fanout settlement boundary; do not add another queue, defensive retry or per-caller flush wrapper. Preserve `ChatSession.recordCompletedToolCalls` eagerness and id suppression.

The child transport is a local RuntimeProvider implementation called through actual ChatSession streaming, source planning and history recording. Inject positional trailer holds and observe real platform flushes; no history work is replaced. Kill only the spawned child PID before the next stream emits. Parent recovery uses `resumeJournalSession` and actual lock takeover, never manual stale deletion. Compare complete independently persisted rows and ownership on both native files, then real resumed sends. Small three-row test oracles are bounded fixtures, not production history caches.

Keep the ungated crash/reopen case independent from the held-write case. Missing flush must fail recorded flush counts even if process death leaves OS-cache bytes readable. SIGKILL does not simulate power loss. Missing eager append must fail after reopen as well as at the held boundary. Deliberate controls reject and restore original bytes; source hashes match the green commit. No writer/full-flush semantics changed.

The new five native cases do not replace unchanged old ChatSession recording regressions. Todo pause's two-group path, actual IDE/directory injection, standalone held-turn next-request and UI/client orchestration remain exact follow-ups. W24 write-amplification and measurement-based primary topology choice remain open; this run's adopted-primary fixture does not settle them. Old backend default stays.

Final proof: 25 serial isolated processes, 250 pass/0 fail/0 skip across 21 paths; nine gates pass; zero touched audit findings; 27 matching hashes; five rejecting-control processes; 75 recorded PIDs absent. Exact map and queue: `W21-SERVICE-CRASH-PROOF.md` and `W21-REMAINING-CONTRACTS.md`. Only verified ignored MCP dist obstructions moved intact, no cleanup/.llxprt/OCR/push/merge, bulk recovery staging or weaker checks. Review skipped per Andrew 2026-10-09. Historical deleted logs remain missing.

## W21 remaining caller decisions, 2026-10-19

At `170788b430eaa4c31564094879a50f909e6acd02`, all named callers exercise the existing HistoryServiceCore.prepareCuratedForProviderSnapshot join. No duplicate caller wait, fallback, retry, forced all-input persistence or production change is justified. The final 32-case fixture and 133 related regressions pass; deliberate join omission rejects all 16 mirror cases and restores byte-identically.

Todo-pause production order is a completed user/assistant group followed by eager response admission. The real scheduler supplies response blocks only. Hold each of those groups independently in actual AgenticLoop execution. Separately prove the helper branch that splits a supplied call-plus-response block list into two writes; do not relabel that synthetic completed-input shape as normal scheduler output. Preserve pending tool results and call-id suppression.

Use ChatSession.sendMessage for the standalone held commitTurnHistory contract: streaming finalization alone does not call the named function. A concurrent real client streaming request proves the next boundary. For UI/client proof, use public openClientChannel plus its completion subscriber, exactly the interface CLI useScheduler consumes, and execute real read_file. Do not claim React rendering or whole CLI bootstrap. Bind editor data through the existing infrastructure seam but run real context tracking and formatting.

Trailer gates select root aggregate row counts, avoiding metadata/write-count assumptions. Independently open both native files while provider entry two is parked, compare full rows/metadata/owners with the raw service stream and require one actual platform flush per acknowledged group. Then independently fail and cancel the next request and require unchanged durable state, with pending input present only in the request.

Recording integrations use the Agent session origin, matching production execution ownership; an arbitrary fixture origin filters loop rows from mirrors. Disable only the established forced-confirmation harness option for real noninteractive tool work. Use separate trailer and response releases to prevent an oracle race. The tool text fixture excludes NUL because real read_file correctly classifies it as binary; the synthetic helper still verifies a Unicode/NUL result. Exact structural equality across reopen phases remains, with audit policy unchanged.

Declaration output must exist for compiler resolution but obstructs Bun execution. Preserve the exact verified ignored directory, return the same inode for type gates and re-hold it afterwards. Keep all failed attempts separately. Final eight checks plus declaration build pass, 25 source hashes match committed bytes and 268 recorded PIDs are absent. W21 remains partial and W24 whole-product/write-budget/topology work is not claimed. Old backend default stays; no cleanup/.llxprt/OCR/push/merge/raw recovery staging or weaker checks. Review skipped per Andrew 2026-10-09.
