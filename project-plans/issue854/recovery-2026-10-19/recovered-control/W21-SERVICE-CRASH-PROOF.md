# W21 ChatSession tool-round crash and next-request durability, 2026-10-19

This is new evidence from verified base `745077f68788fcaebc244adb224052d0b7046f34`. Historical deleted logs remain missing. W21 remains partial.

## Delivered behavior

`packages/agents/src/core/service-tool-crash.test.ts` drives a real ChatSession, HistoryService, locked native primary recorder, second locked native recorder and RecordingIntegration. Its child uses a local provider at the production RuntimeProvider boundary. No history, recording, serialization, pinning, mirror or resume algorithm is mocked. The first real send commits the user row and assistant tool call with an explicit owner. `ChatSession.recordCompletedToolCalls` then admits the tool result, which this production path writes unowned. The next streaming send receives that result as pending input, exercising the existing recorded-id suppression.

The child holds the primary or mirror positional trailer write. The parent observes a next-send attempt, one completed full platform flush on the held file, unchanged acknowledged version and unchanged independent committed rows, and no second provider invocation. A later parent probe confirms the request is still blocked. After release, the provider invocation records both files' flush counts and acknowledged commit sequences before reading its request. Each has advanced exactly one group and one flush. The request contains the original tool call and result exactly once.

Two cases kill only their own recorded child PID with SIGKILL while the next provider invocation is parked before emitting any response. Independent readers see three complete rows on both files. The parent invokes `resumeJournalSession`, which discovers the native session and takes over its dead owner's lock through the normal protocol. There is no manual stale-lock override. Fresh HistoryService adoption preserves complete rows, metadata and owners; a resumed real ChatSession request carries the result once with its original id and bytes. A competing lock acquisition must fail with SessionLockedError, and normal disposal releases the new lock.

Two further cases release the response and shut down cleanly, verifying one tool-result row and released locks. Fixtures, recorder files, child stdout/stderr, event timelines, process records and proof JSON remain under unique `tmp/854-notes/p4/w21/service-crash/fixtures/` directories.

`packages/agents/src/core/service-tool-crash-reopen.test.ts` supplies a separate ungated crash case. It kills at the same provider-entry barrier without an explicit test flush after the eager tool result, then independently reads and resumes both files. This separates the crash-reopen oracle from the held-trailer oracle.

## Observed production RED and scoped fix

`tmp/854-notes/p4/w21/service-crash/run-20261019-part9-a/config-fixture.log` records 2 passes and 2 failures before the fix. Both mirror cases reached the second provider invocation while the mirror trailer was held. Primary cases passed. The cause is `HistoryServiceCore.prepareCuratedForProviderSnapshot`: its primary row read waits for primary persistence but does not join mirror delivery. The existing `waitForCommit()` boundary already joins both primary durability and mirror fanout. Provider snapshot preparation now awaits that boundary before creating its request snapshot.

The production change is confined to that method. Tool-result eagerness, call-id suppression, pending-input policy, group coalescing, backend default and writer flush semantics remain unchanged. No new history array, spool, retry, whole-file read or backpressure bypass is introduced.

## Green increment boundary

The final-source new suites passed in two isolated serial Bun processes: four held-trailer/crash/clean cases and one ungated crash/reopen case, zero failures and zero skips. Declaration build, core and core-runner types, agents types, explicit touched-file types, scoped zero-warning ESLint, Prettier, affected-graph validation and AST audit pass in `run-20261019-part9-a/final-gates/`. The audit has no findings on the eight touched source paths. The affected-graph result is not shard execution.

The green implementation was committed before final proof accounting. The completed wider serial matrix and deliberate regression controls are recorded in the final-source inventory below; they do not expand the remaining-contract closure.

## Exact remaining scope

This closes the bounded W21 HistoryService/ChatSession eager-tool-result crash route and its actual next-provider-request boundary with primary and mirror holds. The first ordinary turn's addBatch commit is exercised as setup, but a held first-turn commit followed by a request is not separately proved here. Remaining transport variants are `recordCompletedToolHistory` on todo pause, `_injectIdeContext`, `client.addDirectoryContext`, and a standalone held `commitTurnHistory` next-request matrix. UI/client orchestration outside the real ChatSession recording front door is not claimed.

W21 wider discovery, unreadable/scans/resume-identity/extensions/checkpoint/fork/janitor inventory and exact reference-media/generated metadata/compression-size/flush-segmentation/minimum-large-text/unstamped-rebuild/equal-text replay remain. W17's named public remainder and W21 defects 1 through 5 retain their previously accounted status. W23 send/planning refusal and 40 MiB send remain separate.

W24 still requires whole-product proof and primary-plus-mirror write-amplification measurement, including the measurement-based primary/adopted-recorder decision. This bounded adopted-primary fixture and correctness proof supply no such measurement or topology decision. W22-W26 and later phases remain; the old backend stays the default. No full package, affected-shard execution or monorepo closure is claimed. Review skipped per Andrew 2026-10-09. No OCR, push, merge, cleanup, broad staging or `.llxprt/` modification belongs to this increment.

## Final-source proof inventory

Implementation commit: `3fa3051e5781e90446c5eb5b6bf712d99718705a`. The wider matrix is complete: **25 serial isolated Bun processes across 21 paths, 250 passes, zero failures and zero skips**. All 27 source hashes below match worktree and commit. Every gate exits zero. All 75 recorded test, gate, control and fixture PIDs are absent; managed supervisors are complete. Exact commands, output logs and liveness checks remain under `run-20261019-part9-a/`.

### Positive matrix

Paths are relative to their package. Each process has exit zero, zero failures and zero skips. Outer environments describe configuration, not a substitute for a native fixture.

| Package/path | Classification | Passes | PID | Log under final-tests/ |
| --- | --- | ---: | ---: | --- |
| agents/src/core/service-tool-crash.test.ts | native explicit | 4 | 3196 | 01-agents.log |
| agents/src/core/service-tool-crash-reopen.test.ts | native explicit | 1 | 3330 | 02-agents.log |
| agents/src/core/chatSession.runtime.history.test.ts | old outer | 8 | 3378 | 03-agents.log |
| agents/src/core/chatSession.issue3048.discardRestart.test.ts | old outer | 11 | 3414 | 04-agents.log |
| core/src/services/history/provider-request-snapshot.test.ts | old outer | 17 | 3629 | 05-core.log |
| core/src/services/history/provider-request-snapshot.test.ts | journal outer | 17 | 3684 | 06-core.log |
| core/src/services/history/HistoryService.curated-stream.test.ts | old outer | 5 | 3817 | 07-core.log |
| core/src/services/history/HistoryService.curated-stream.test.ts | journal outer | 5 | 3863 | 08-core.log |
| core/src/services/history/provider-curated-lifecycle.test.ts | old outer | 12 | 3923 | 09-core.log |
| core/src/services/history/provider-curated-lifecycle.test.ts | journal outer | 12 | 3992 | 10-core.log |
| core/src/services/history/provider-curated-faults.test.ts | old outer | 3 | 4061 | 11-core.log |
| core/src/services/history/provider-curated-faults.test.ts | journal outer | 3 | 4070 | 12-core.log |
| core/src/services/history/historyRecorderFanout.durability.test.ts | native explicit | 3 | 4078 | 13-core.log |
| core/src/services/history/history-service-recorder-atomicity.test.ts | native explicit | 5 | 4100 | 14-core.log |
| core/src/services/history/history-service-recorder-compensation.test.ts | native explicit | 10 | 4111 | 15-core.log |
| core/src/services/history/history-service-recorder-restore-failure.test.ts | native explicit | 2 | 4156 | 16-core.log |
| core/src/recording/recording-integration-native-boundary.test.ts | native explicit | 14 | 4172 | 17-core.log |
| core/src/recording/recording-integration-native-faults.test.ts | native explicit | 6 | 4200 | 18-core.log |
| core/src/recording/recording-integration-native-core.test.ts | native explicit | 19 | 4210 | 19-core.log |
| core/src/recording/recording-integration-native-lifecycle.test.ts | native explicit | 14 | 4227 | 20-core.log |
| core/src/services/history/history-resume-adoption.test.ts | native explicit | 11 | 4247 | 21-core.log |
| core/src/recording/journalResumeAdoption.test.ts | native explicit | 8 | 4269 | 22-core.log |
| core/src/recording/journalRecordingService.test.ts | native explicit | 13 | 4293 | 23-core.log |
| core/src/journal/groupWriter.test.ts | native format | 24 | 4303 | 24-core.log |
| core/src/journal/flushRecords.test.ts | native format | 23 | 4307 | 25-core.log |

### Rejecting controls

Each control exits one for its intended assertion. Sources restore byte-identically; original, mutated and restored SHA-256 values are in controls/results.json. Missing flush rejects at exact platform-flush counts even though process death preserves OS-cache-visible data. The eager-result control independently fails after crash/reopen because only two rows remain. These are process-crash and flush-order proofs, not a power-loss simulation.

| Mutation / suite | Pass / fail | PID |
| --- | ---: | ---: |
| mirror-wait-omitted / service-tool-crash.test.ts | 2 / 2 | 5952 |
| flush-omitted / service-tool-crash.test.ts | 0 / 4 | 6064 |
| flush-omitted / service-tool-crash-reopen.test.ts | 0 / 1 | 6229 |
| eager-result-deferred / service-tool-crash.test.ts | 0 / 4 | 6329 |
| eager-result-deferred / service-tool-crash-reopen.test.ts | 0 / 1 | 6460 |

### Gates

| Gate | Exit | PID |
| --- | ---: | ---: |
| build-types | 0 | 155 |
| core-tsc | 0 | 1667 |
| core-runner-tsc | 0 | 1753 |
| agents-tsc | 0 | 1759 |
| touched-tsc | 0 | 1965 |
| eslint | 0 | 2088 |
| prettier | 0 | 2236 |
| affected-graph | 0 | 2240 |
| audit | 0 | 2285 |

### Source hashes

| Path | SHA-256 |
| --- | --- |
| packages/core/src/services/history/HistoryServiceCore.ts | 19a9457c74e66b982bfd88d3384e16d110c31f6ffdce5cbc0039b89767510bcd |
| packages/agents/src/core/service-tool-crash.test.ts | 5ad53ba205dd31322b6a2ea9d31b6ad3fe9c4ad0d6dd3929026db8e5b1cb2487 |
| packages/agents/src/core/service-tool-crash-reopen.test.ts | 85dbdcac9ac07bfa706db2529705290d9244e438843ff32817bedadebf7e81b4 |
| packages/agents/src/core/__tests__/support/service-tool-runtime.ts | 5ad11b21b1cec8b49ffdbfc78340ed0f31600748b512ea1248a625800aebbb46 |
| packages/agents/src/core/__tests__/support/service-tool-recorders.ts | d7fdf3fbb935276ec3c26f3e454cf13959da01798462b4d33c6203df4a8c52ba |
| packages/agents/src/core/__tests__/support/service-tool-crash-driver.ts | 0de53cb14f39801b37ca2826f8884c490e2117bf7b1a828f02a6055a56bccf33 |
| packages/agents/src/core/__tests__/support/service-tool-child.ts | d7a3bddac9318f0bba8c9158dc02dc0e131ad13834e1a4854b4d6ba7d35b4237 |
| packages/agents/src/core/__tests__/support/service-tool-resume.ts | 8f0c2cdcd1dbf34e292a1d0b90f81ee53e5401d8c0e258beee54f1c1c0cd3e09 |
| packages/agents/src/core/chatSession.runtime.history.test.ts | 40da94bc43803f3057419718cb6f1adbd17e5e55dd045d0324a7bcf6d1f30e85 |
| packages/agents/src/core/chatSession.issue3048.discardRestart.test.ts | c2e609185884c8cb0665e8fb769cd92df224748386c31e9ee0088e55be8cfbd7 |
| packages/core/src/services/history/provider-request-snapshot.test.ts | bb7ed803ac3ce7ecf0847a45bf4b0d91485a83e2dc71bbd943122621949722a2 |
| packages/core/src/services/history/HistoryService.curated-stream.test.ts | 797df5ed8846c76632e569122576a70c5f3ef55f52fb6ba542d5c7c903b6fc2e |
| packages/core/src/services/history/provider-curated-lifecycle.test.ts | 76c8cb280c3cc7450ae278c5ee00852f6279a7b4ae3b2de914d8bd6a863adb8f |
| packages/core/src/services/history/provider-curated-faults.test.ts | 482aded6f7761573b86e1f3eabd10889347bed9f5b2946cda2e7b69567f7de78 |
| packages/core/src/services/history/historyRecorderFanout.durability.test.ts | 5849ef4ce99a7ea95628a4ef0d7b4f9d46e135f1fd80fbe13be118a4c497639c |
| packages/core/src/services/history/history-service-recorder-atomicity.test.ts | 29ecc3414afb32abdf38e2a8eba76e795f69692414a5d2b8aed461414232d474 |
| packages/core/src/services/history/history-service-recorder-compensation.test.ts | 291c0fd900afdf03de99eb2b8298148119c99f3ca596ed4acae461dfaf7e5b03 |
| packages/core/src/services/history/history-service-recorder-restore-failure.test.ts | 0f08809137b786a6d943fb76b87b665a420596af0b9bd982a7b17f520b616abd |
| packages/core/src/recording/recording-integration-native-boundary.test.ts | c3d2ecabcc2430c41f65eb2a18afde604aca3580c997409edf6c03bcbe45f4b6 |
| packages/core/src/recording/recording-integration-native-faults.test.ts | 71e6fb4d3874f3a3a2ceac22bd99b21af790a43b6a5090433349cc6b520c5cd0 |
| packages/core/src/recording/recording-integration-native-core.test.ts | 96dc251680d2701835f466093f38fedb3f88e1ccbeb224225a49b64e7a52188a |
| packages/core/src/recording/recording-integration-native-lifecycle.test.ts | cea706a7f9621b6be4345c89597a430f9c8621c34633e3b85da8c316f4b6fb06 |
| packages/core/src/services/history/history-resume-adoption.test.ts | 3e01015b259c46b352997cfc2b9a1b1fee1b95bd030db7bb183b721bbde43da3 |
| packages/core/src/recording/journalResumeAdoption.test.ts | 56a0db427f52186c415b603fb70c6acb37691d6956a0b6d97e6ac7959bcf24e1 |
| packages/core/src/recording/journalRecordingService.test.ts | 729cda3245a3165e974ffb4d040d03a8dfb6c922f7a99c1a92ef2d119f74b247 |
| packages/core/src/journal/groupWriter.test.ts | 1facb50089abcf94e8dcb5be94a7940f9824965cb3f3799cfd7e58fecd4358cb |
| packages/core/src/journal/flushRecords.test.ts | c270baaa3e8a67643bf06f1c0e80df8916e75aeaa69d922fdab03c2e3126d65e |

### Child-process evidence

The five final positive fixture children are primary-crash PID 3219, primary-clean PID 3251, mirror-crash PID 3280, mirror-clean PID 3309 and ungated-crash PID 3348. Their exact directories and commands are in summary.json. Each has process.json, events.jsonl, stdout/stderr and proof.json under the retained fixture directory. No fixture cleanup is performed. Both resumed recording files preserve the tool id hist_w21_original_001 and the Unicode/NUL/byte-list result. Fresh request facts count one call and one result.

Development failures remain distinct: initial import failed on generated MCP declaration resolution, then the missing live Config fixture failed before first send. The corrected fixture exposed the actual mirror RED. Initial type checks found nonexistent Bun spawnargs and readonly/unknown assertion overloads; exact command capture, readonly fixture copying and schema validation corrected them. Lint required flatter helper structure and direct assertions in registered callbacks. No production assertion, gate, bound or timeout was weakened. The audit reports zero findings on touched paths.

Declaration build regenerated the same MCP loader obstruction. It was again individually verified ignored, untracked and nonsymlink, then renamed intact to service-crash/held-mcp-bdS9tx/dist with inode 396533575. The original held copy is separately recorded in run-20261019-part9-a/held-mcp.json. Both remain; nothing was deleted.

The exact remaining caller variants and W23/W24 distinction are maintained in W21-REMAINING-CONTRACTS.md. Historical deleted logs remain missing. Review skipped per Andrew 2026-10-09.
