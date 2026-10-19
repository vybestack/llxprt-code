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
