# W21 current remaining contracts, 2026-10-19

This is a new status map after the service-crash increment at `3fa3051e5781e90446c5eb5b6bf712d99718705a`. It supersedes earlier queue entries only where the contract below is explicitly accounted for. Historical deleted evidence remains missing.

## Accounted contracts

W21 service defects 1 through 5 retain the completed scope documented in `W21-SERVICE-ATOMICITY-PROOF.md`, `W21-SERVICE-MUTATIONS-PROOF.md` and `W21-SERVICE-LARGE-ROW-PROOF.md`. W17's three named public session/owner/lifetime suites remain done. These are bounded contract completions, not full-package or cumulative full-inventory closure.

The new `packages/agents/src/core/service-tool-crash.test.ts` and `service-tool-crash-reopen.test.ts` account for actual ChatSession eager-tool-result commit, next streaming provider invocation, independent native primary/mirror reads, three child SIGKILL cases, lock takeover through `resumeJournalSession`, fresh HistoryService adoption, resumed sends without duplicate results, and two clean shutdown cases. Four held-trailer cases prove the next invocation cannot begin before primary or mirror acknowledgement. The default remains old; both new suites explicitly construct native history and locked native recorders.

The original `packages/agents/src/core/chatSession.runtime.history.test.ts` and `chatSession.issue3048.discardRestart.test.ts` are unchanged and run under the old outer environment. Their 8 and 11 cases remain regression proof of the existing recording/pending-input behavior, not native counterparts. The shared request-snapshot and curated-stream suites run in both outer environments; their classification is recorded per process rather than relabeling every assertion as native evidence. Actual native service and recorder suites are listed separately in `W21-SERVICE-CRASH-PROOF.md`.

## Remaining next-request variants

| Production boundary | Remaining proof |
| --- | --- |
| `packages/agents/src/core/agenticLoop/loopHelpers.ts` `recordCompletedToolHistory`, reached from `agenticLoop/AgenticLoop.ts` todo pause | Drive the actual pause/resume orchestration and both history groups. Hold each required native acknowledgement, observe the subsequent real request, then verify fresh readers. The ordinary ChatSession tool round writes one group and does not close this two-group contract. |
| `packages/agents/src/core/MessageStreamOrchestrator.ts` `_injectIdeContext` | Drive actual IDE injection, hold its primary/mirror acknowledgement and observe the following provider invocation. Core snapshot waiting is the shared fix, but this caller has not been proved here. |
| `packages/agents/src/core/client.ts` `addDirectoryContext` | Drive actual directory-context admission and its next request with the same independent native oracle. RecordingIntegration metadata tests are narrower. |
| `packages/agents/src/core/turnHistoryCommit.ts` `commitTurnHistory` | Independently hold a completed turn's addBatch acknowledgement and begin the next real send. The new first-turn fixture exercises the function, but explicitly settles setup before the tool round, so it is not this held-turn proof. |
| UI/client tool orchestration outside `ChatSession.recordCompletedToolCalls` | The new child invokes the real ChatSession recording front door. It does not run UI scheduling, the client tool-control facade, or actual tool execution. Preserve that boundary in follow-up accounting. |

## Other W21 remainder

The wider unreadable-session/directory-scan/resume-identity/extension/checkpoint/fork/janitor inventory remains open beyond the previously delivered bounded cases. The exact reference-media resume, generated metadata/compression-size/flush-segmentation/minimum-large-text matrices and unstamped disk-row rebuild followed by equal-text append remain open. Do not infer closure from the deterministic replay, service-scale, native owner or crash cases.

W23's send/planning-envelope refusal and 40 MiB send are separate from W21's 17/40/200 MiB service persistence and resume proof. W24 still owns whole-product proof and primary-plus-mirror write-amplification measurement, including a measurement-based decision on adopting the attached recorder as primary. This run's adopted-primary correctness fixture supplies neither a write-budget measurement nor that topology decision. W22-W26 and later phase requirements remain; W25's default flip is not authorized by these results.

No full package, affected-shard execution or monorepo run is claimed. Review skipped per Andrew 2026-10-09. No OCR, push, merge, cleanup, broad recovery staging, `.llxprt/` change or weaker check is part of this increment.
