# W21 current remaining contracts, 2026-10-19

This status map follows the next-request caller increment from verified base `5465856fe4dbceda6d0f4b54b227cd779ef869e4`. It supersedes earlier queue entries only where the contract below is explicitly accounted for. Historical deleted evidence remains missing.

## Accounted contracts

W21 service defects 1 through 5 retain the completed scope documented in `W21-SERVICE-ATOMICITY-PROOF.md`, `W21-SERVICE-MUTATIONS-PROOF.md` and `W21-SERVICE-LARGE-ROW-PROOF.md`. W17's three named public session/owner/lifetime suites remain done. These are bounded contract completions, not full-package or cumulative full-inventory closure.

The ChatSession eager-tool-result and crash/reopen contracts remain accounted for by `service-tool-crash.test.ts` and `service-tool-crash-reopen.test.ts`. The new `packages/agents/src/core/next-request-variants.test.ts` supplies independent caller evidence through a real public Agent/client runtime, real HistoryService, two locked native recorders and RecordingIntegration. No production wait or history-publication mock was added. The shared request snapshot join remains the fix at `3fa3051e5`. Final caller code is `170788b430eaa4c31564094879a50f909e6acd02`: 32 new cases plus 133 related regressions pass across 17 serial processes, with all scoped gates passing.

## Accounted next-request caller variants

| Production boundary | Bounded proof |
| --- | --- |
| `AgentImpl.stream` → `AgenticLoop.run` / `buildNextMessage` → `recordCompletedToolHistory` | Actual FakeProvider tool request, real scheduler and `todo_pause`, loop termination and a new client request. Hold separately the completed user/assistant batch and the eager tool-result batch, each on primary and mirror. The scheduler supplies response blocks only, so the helper writes one result group after the completed turn. Both groups are tested in that production order. |
| `recordCompletedToolHistory`'s conditional role split | Separate `two-group` cases supply both call and response blocks through the real helper and client admission. Hold each of its two writes independently. This proves the helper's conditional branch; it is not relabeled as the normal scheduler output. |
| `MessageStreamOrchestrator._injectIdeContext` | Bind editor infrastructure data through the existing `AgentClient.bindIdeContext` seam. Real context tracking, formatting, injection and client streaming run; hold the resulting row trailer on primary or mirror before the following provider entry. |
| `AgentImpl.addDirectoryContext` → `AgentClient.addDirectoryContext` | Use the live workspace directory reader and real directory-message construction/admission. Hold the resulting row trailer on either recorder before the next client request. |
| `ChatSession.sendMessage` → `TurnProcessor._commitSendResult` → `commitTurnHistory` | A standalone non-streaming first turn holds its actual `addBatch` trailer while the next real client streaming send starts. This is distinct from the streaming finalization batch also exercised by the other variants. |
| Client tool orchestration outside ChatSession | Real child process drives `Agent.tools.openClientChannel`, its scheduler, a real `read_file`, the completion subscriber and `ToolControl.recordCompletedToolCalls`. This is the client execution channel used by CLI `useScheduler`; no React rendering or entire CLI bootstrap is claimed. The next client request carries the already-recorded tool result as pending input without duplication. |

Each variant exercises a failed and a cancelled next request. Parent-owned independent disk readers compare complete native rows, metadata and owners on both files with the live service and with the post-failure, post-cancellation and closed states. Pending next-input text must appear in the provider request but not in persisted rows. No synthetic API-error row may be added. Trailer gates select semantic row counts, so unrelated metadata groups are not mistaken for the target acknowledgement. Real full-platform-flush counts are observed.

The final-source inventory, rejecting join-removal control and exact process/gate results are appended to `W21-SERVICE-CRASH-PROOF.md`. Raw new evidence is retained under `tmp/854-notes/p4/w21/next-request-variants/run-20261019-a/` and unique sibling fixture directories. The original old ChatSession recording and pending-input suites remain separate regression proof, not native counterparts.

## Other W21 remainder

The wider unreadable-session/directory-scan/resume-identity/extension/checkpoint/fork/janitor inventory remains open beyond the previously delivered bounded cases. The exact reference-media resume, generated metadata/compression-size/flush-segmentation/minimum-large-text matrices and unstamped disk-row rebuild followed by equal-text append remain open. Do not infer closure from deterministic replay, service-scale, native owner, crash or caller cases.

W23's send/planning-envelope refusal and 40 MiB send are separate from W21's 17/40/200 MiB service persistence and resume proof. W24 still owns whole-product proof and primary-plus-mirror write-amplification measurement, including a measurement-based decision on adopting the attached recorder as primary. The correctness fixtures supply neither a write-budget measurement nor that topology decision. W22-W26 and later phase requirements remain; W25's default flip is not authorized by these results.

No full package, affected-shard execution or monorepo run is claimed. Review skipped per Andrew 2026-10-09. No OCR, push, merge, cleanup, broad recovery staging, `.llxprt/` change or weaker check is part of this increment.
