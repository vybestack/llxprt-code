# W23 proof map

## Provider selected subset, 2026-10-20T05:35Z

The sendPeak collection has finished all fourteen files with 29 passes and no failures/skips; the refreshed checkpoint replaces the active snapshot below. No memory input was repeated. The selected subset runs 22 histories on seven routes through native HistoryService curation snapshots and the existing provider builders. Its independent expected side uses old eager curation, not the native snapshot. All 154 byte/length comparisons, seven frozen text-only checks, and two rejecting controls pass in each outer environment. Selection read/close and decoded-row ownership checks run in the shared fixture. These are explicitly journal sources even under the old outer environment.

Serial final subset logs: `provider-parity-run-b/first-final/000..003`, 956 passes total including unchanged 315-case wire suites in both environments. Gates: `first-gates-fixed/000..005`, all green, touched audit findings zero. The earlier `first-gates/002` lint failure and correction remain recorded. No production code changed; dump/retry/continuation/seeded native proof remains open at this checkpoint. Raw output root: `tmp/854-notes/p4/w23/`.

## Active sendPeak checkpoint

First cluster source commit: `2f20ada0c50e65e127b89c07957872e26e72b18f`. `W23-SEND-PEAK-CHECKPOINT.json` binds the two completed OpenAI chat measurements, four passes and zero failures/skips, at 2026-10-20T05:23:55Z. Complete bytes/Content-Length and unchanged heap/ArrayBuffer/retained predicates pass. This is separate from frozen corpus parity: the existing sendPeak oracle is computed outside measurement, and its source is disk rows rather than HistoryService.

Driver 88231 is running the fourteen-file serial manifest; current test at the snapshot is PID 89482, Anthropic text-only. Twelve paths remain including that active file. Current state/results, not this dated note, are the live authority. STATUS contains exact paths and managed job ID. Dedicated trap suites are pending; actual positive-assertion failures under trap environments are not yet run. No source edits or overlapping heavy gates occur during this collection.

Native remainder paths and hashes were persisted before any further execution. Prior W21 curated lifecycle/fault test hashes and logs still exist, but the HistoryServiceCore dependency hash differs; these are candidates for targeted execution rather than current-source native passes. Repeated-turn retention reuse additionally has no intervening production source delta: the package diff from `888461db4` to the first-cluster commit names only three tests.

## First bounded cluster, 2026-10-20

The native bootstrap fixture and raw-history provider wire corpus are green. W23 remains open. Starting HEAD is `f092ca898ede471f1cf6265e59dd402ed45f6b02`; no production code or backend default changed.

The pre-test inventory contains 223 exact paths/source hashes. It was written under `tmp/854-notes/p4/w23/run-a/` before the nineteen-file batch. Initial results: eighteen green files, one red file, 706 passes/four failures/zero skips. `W23-FIRST-CLUSTER-PROOF.json` binds commands, source hashes, PIDs, raw logs and JUnit receipts. Initial source hashes come from the pre-test inventory; accepted repair runs record hashes at execution.

| Boundary | Executed proof | Native scope and limits |
| --- | --- | --- |
| Existing provider wire golden | `packages/providers/src/__tests__/wireBodyGolden.test.ts`, 315 passes | Both input modes are array-backed. Retained as unchanged frozen comparison and controls, not native-source evidence. |
| Existing equivalence | `packages/providers/src/__tests__/providerBodyEquivalence.p05b4.test.ts`, five passes | Independent eager reference/retry bytes pass. Native seeded equivalence/retry source remains unmapped. |
| Existing request dumps | `chatDumpGolden.test.ts`, 141 passes; `anthropicDumpGolden.test.ts`, 148 passes | Arrays feed the provider. Native dump-source counterparts remain open. |
| Native raw-history wire bytes | `packages/providers/src/__tests__/journal-wire-body-golden.test.ts`, 155 passes in each outer environment | Explicit journal HistoryService, actual committed disk rows, materialization guard, real normalizers/builders/transports, 22 histories across seven routes and one changed-row rejection. Complete body digest/length and Content-Length match the frozen stream oracle. This does not establish all curated request-selection/retry/dump boundaries. |
| CLI actual bootstrap/HTTP/profile/resume/cleanup | `packages/cli/src/session-client-bootstrap.behavior.test.ts`, fourteen passes in each outer environment | Seven original behaviors run on both explicit backends. Independent native disk decoding and actual local HTTP bodies prove ownership, recording and duplicate-free resumed next request. Original old JSONL parser/assertions remain. |
| CLI resume/chat service frontdoors | `performResume.spec.ts` nine; `performResume.journal.test.ts` three; `restoreResumeBoot.journal.test.ts` one; `chatCommand.backends.test.ts` eight; `chatCommand.test.ts` seventeen; `cliSessionBootstrap.recording.test.ts` two | Original spec is explicitly old JSONL; journal suites and dual-backend chat suite provide their bounded counterparts. No full CLI sweep claim. |
| zed | `zedIntegration.loadSession.test.ts` nine; `zedIntegration.streamHistory.test.ts` three; `zed-session-loader.test.ts` eight; `zed-history-stream.test.ts` four | Load-session orchestration uses stub agents. The mixed-row 512/8192 replay proof uses selected real HistoryService, independently derived update digest and lifecycle/ownership checks. Full native session/tool frontdoor mapping remains open. |
| a2a | `agent/task.test.ts` seven; `agent/task-ports.behavior.test.ts` two; `agent/task.provider-neutral.test.ts` three; `commands/restore.test.ts` eighteen | Task-port case creates the actual task Agent and streams a fake-provider response. Other task/restore cases include stubs and are not all native history proofs. Native tool-turn/history protocol coverage remains open. |

## Observed failures and corrections

Initial bootstrap PID 77601 failed four original cases. One called the JSONL-only recorder API against a journal recorder. Three parsed the native `LLXJRNL` file as JSONL. The repair preserves the old branch and adds journal recording through the real attached HistoryService plus `JournalSession.rows()` disk decoding. A first repair also exposed the missing commit barrier: `add()` admits a ticket synchronously; it must be followed by `waitForCommit()` before inspecting the recording. This was fixed in the test, not hidden by retries or a timeout change.

The first native corpus execution had 147 passes/eight failures. Seven were historical blockless rows passed through new-row admission, which correctly rejects them. The existing suffix fixture's historical seeder now supplies them. The eighth was missing Anthropic cache-anchor bytes because disk encoding intentionally drops request-local purge identities. The existing purge coordinator recreates the request-local tag from the native source. No codec, builder, fixture or byte assertion changed. The final changed-row control still rejects a committed history perturbation.

The final matrix has 338 passes, zero failures/skips: 169 per outer environment. The native wire suite explicitly uses journal in both; it is not old-backend coverage. The CLI suite explicitly exercises both inside each process. Twenty frozen wire/chat-send/Anthropic-send fixture files match the starting commit byte-for-byte. Their aggregate digest is in the JSON proof.

## Gates and reused proof

Eight final scoped gates pass: touched provider and CLI declaration builds; both package noemit/test type sets with Node, Bun and Bun test-global ambient declarations; zero-warning ESLint; Prettier; affected dependency-graph validation; AST audit. Touched-file audit findings are zero. Graph validation is not affected-shard execution. Earlier type/lint authoring failures remain in `gates-a/`: missing nullable-history narrowing, omitted Bun globals in the command, and a dynamic describe title. No exclusion, assertion, threshold or enforcement rule changed.

`W22-RETAINED-READ-COST-PROOF.json` already supplies repeated-turn native retention and its retaining/release traps. Reuse is verified against twenty source hashes, six raw measurement hashes and nine source/log/JUnit hashes, thirty-five checks with zero mismatch. Exact receipt: `run-a/reuse-retention.json`. The journal normal worker sent 845 requests; traps sent 850. No memory worker was duplicated, and no new W23 worker execution is claimed.

All 52 recorded first-cluster driver/test/gate PIDs are absent at proof publication. No active mutation, restoration or test handoff remains. Raw failed and accepted receipts are preserved in `tmp/854-notes/p4/w23/run-a/`.

## Remaining requirements

Next targets are sendPeak positive/trap files, source-bound suffix/provider-curated/borrowed snapshot reuse or execution, native selected/dump/retry body parity, remaining CLI/zed/a2a native tool/history contracts, and planning-time over-limit refusal plus 40 MiB send. Service-level 40 MiB persistence alone does not prove send behavior. Provider per-send spooling remains intermediate and must still be removed later.

W24 whole-product/write amplification, W25 default selection, W26 scratch/seam removal and phases 5-9 remain open. No cleanup/deletion, `.llxprt` edit/staging, raw recovery bulk staging, weaker check, OCR, push or merge. Review skipped per Andrew 2026-10-09.
