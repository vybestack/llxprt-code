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

A wider serial matrix and deliberate regression controls are recorded separately when complete. This green increment does not claim their completion.

## Exact remaining scope

This closes the bounded W21 HistoryService/ChatSession eager-tool-result crash route and its actual next-provider-request boundary with primary and mirror holds. The first ordinary turn's addBatch commit is exercised as setup, but a held first-turn commit followed by a request is not separately proved here. Remaining transport variants are `recordCompletedToolHistory` on todo pause, `_injectIdeContext`, `client.addDirectoryContext`, and a standalone held `commitTurnHistory` next-request matrix. UI/client orchestration outside the real ChatSession recording front door is not claimed.

W21 wider discovery, unreadable/scans/resume-identity/extensions/checkpoint/fork/janitor inventory and exact reference-media/generated metadata/compression-size/flush-segmentation/minimum-large-text/unstamped-rebuild/equal-text replay remain. W17's named public remainder and W21 defects 1 through 5 retain their previously accounted status. W23 send/planning refusal and 40 MiB send remain separate.

W24 still requires whole-product proof and primary-plus-mirror write-amplification measurement, including the measurement-based primary/adopted-recorder decision. This bounded adopted-primary fixture and correctness proof supply no such measurement or topology decision. W22-W26 and later phases remain; the old backend stays the default. No full package, affected-shard execution or monorepo closure is claimed. Review skipped per Andrew 2026-10-09. No OCR, push, merge, cleanup, broad staging or `.llxprt/` modification belongs to this increment.
