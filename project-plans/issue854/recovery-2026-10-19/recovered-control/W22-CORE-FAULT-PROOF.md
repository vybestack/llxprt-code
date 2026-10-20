# W22 five core fault contracts

**All five requested suites are green at 3fff916f5. W22 remains incomplete.** Base 9b35908c14aff6329ee37d3fe6e5090da1244e2d was verified. Production fix: fc2515b17. Census acceptance: 572ec4341. This is implementation, not review. W22-CORE-FAULT-PROOF.json contains source/case/process/gate/checksum evidence; complete receipts and failed attempts are under `tmp/854-notes/p4/w22/core-fault-run-m/`.

## Causes and bounded changes

| Contract                                         | Cause and proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Deferred admission promise and public visibility | JSONL waitForCommitSequence is absent from native admission. The native test gates the actual trailer write after its producer completes, keeps the previous public rows visible while held, and independently reopens candidate journal bytes before/after success and failure. No polling delay or production acknowledgement wrapper. The old injector rejects once so its compensation acknowledgement can complete; the original rollback/error assertions remain.                                                                                                                              |
| Purge no-array and persisted membership          | Fixtures required the JSONL recorder despite native selection; the old synchronous observer could not invoke the native materializer. Selected recorder protocols preserve old persistence, while native transaction publication is checked through independently reopened mirror rows and complete public digests. Two old synchronous guard cases remain explicit-old and each has its distinct native guard counterpart. Original 512/8192 transaction, boundary identity, lease, rollback, immutable rows and ownership checks remain.                                                           |
| Request demand and conversion                    | A JSONL recorder and streamRawHistory override observed the wrong construction path. The fixture now selects the recorder and wraps the real journal traversal while normal snapshot preparation runs unchanged. Original exact Responses BODY, estimation, external hook input, one traversal and abort-close assertions pass. An added test proves snapshot readers acquire nothing until next(), charge only the yielded row, release on return(), and replay detached equal values without rereading history. No added production count pass/fallback/clone.                                     |
| Turn media error/cancel rollback                 | Native append rollback stopped on the first release exception, then closed its only pending reservation index. releaseDifference now attempts all references and reports failures through the existing error aggregation. Append rollback retains its pending index if release fails, so failed owners remain tracked for disposal. Prior media reservations are not retired early. Four actual release-fault tests cover addition/replacement and before/after-removal errors, preserving prior refs and disposing retained failures. The original fifteen-case lifecycle source is byte-identical. |

Test fixture journal files are under the managed scratch root to permit independent native reads. They remain retained in this no-cleanup run. This adds no production operation temporary file or repeated whole-history read.

## Final evidence

| Target under packages/agents/src/core  | Cases per backend | Native on journal | Explicit-old |
| -------------------------------------- | ----------------: | ----------------: | -----------: |
| `deferred-history-source.test.ts`      |                 7 |                 7 |            0 |
| `semantic-purge-array-seam.test.ts`    |                 4 |                 3 |            1 |
| `semantic-purge-production.test.ts`    |                 6 |                 5 |            1 |
| `stream-request-body-demand.test.ts`   |                 4 |                 4 |            0 |
| `turnMediaAdmission.lifecycle.test.ts` |                15 |                15 |            0 |

Targets contribute **36 passes per backend**. Fifteen related files contribute **109 per backend**, yielding **40 effective isolated serial processes/290 passes/zero failures/skips**. Repeated diagnostic/earlier-source runs are not added to this total. Effective results are selected by latest matching source, not by the last convenient green run. Both outer environments ran each file from its package directory.

Reused suites: history-media-failure, history-media-stream, semantic-purge.journal, borrowed-snapshot-lifecycle.journal, chronology-rollback-atomicity.journal, public-history-deferred, public-history-faults, service-tool-crash, service-tool-crash-reopen, next-request-variants, semantic-purge-request-boundary, semantic-purge-request-lifecycle, source-preflight-request, source-model-hook-no-snapshot and streamprocessor-source-http. These retain real native durable/error/cancel/media/request/transport behavior, including admission before next API exposure. They actually ran; no duplicate full service/crash/lifetime matrix was created.

Ten product gates pass: agents API surface, declaration build, core/agents/agents-Bun/touched strict types, zero-warning scoped ESLint, Prettier, affected graph and AST test audit. Five final census/API suites pass **twelve tests/150 assertions**; strict census types, explicit no-ignore lint/format, final graph/audit pass. Original failed old injector and initial lint gates remain retained. No check was suppressed. Graph validation does not establish affected-shard execution.

AST source comparison retains **all 119 original assertion expressions verbatim** and adds fourteen in target files. Original test names/domains/timeouts, 512/8192 scales, oversized row, 440-row/8 MiB ownership limits remain. Audit adds three DUP_ASSERT notices for repeated temporal invariants in the new demand test; no new MOCK_MIRROR, ALWAYS_TRUE, SELF_CONFIRMING or NO_ASSERT. Existing notices remain recorded.

## Actual RED and restored controls

The five original RED logs/JUnit/source hashes match starting source and are included in the preservation receipt. The product defect was additionally reproduced on current source before its fix. With the original ownership file restored from 9b35908c1, **PID 77227 fails all four new release-fault cases** and **PID 77270 fails the unchanged published-history settlement case**, leaving one reservation. No timeout or unrelated failure accounts for rejection. Final source is restored byte-identically; cmp=0, SHA-256 c1bb072711d11adc49ceeb646bb09587f039d6636a95208d4cc74e9ee61f98fd. Restored PIDs 77319/77377 pass 24 cases.

Census regression is actual RED before fault-layer acceptance (no selected PID), then green. Removing the exact-source coverage guard fails the wrong-source partition assertion, restores in finally with cmp=0, SHA-256 b76113b4c572f33db5db2d7fd7047b32cc8229de43b6b0273ff717fc75c80979, and passes. Missing cases, wrong-source/missing/same-old counterparts, old counterpart batches, diagnostics/unknown backends and inconsistent raw/XML summaries cannot become accepted green. No mutation remains active.

## Accepted census and remaining queue

**806 = 798 green + 7 red + 1 unverified**, zero unrun. Verified **6557 passes/11 failures/zero skips**. Recorded 6564 passes include seven inconsistent runner XML passes withheld from verified totals. Passing classifications: **388 native/344 shared-public/44 explicit-old/5781 pending**, unclassified zero.

Only five target paths changed from 793/12/1. Accepted journal batches: fault-final-journal-m-a, fault-deferred-final-journal-m-b and fault-changed-final-journal-m-c, each with exact source/case contracts. Two old materializer cases have distinct completed native counterparts. Source commit preceded census publication. Generation 7e731274-7a5a-4e2d-9976-88b64c3d0cd1 retains 1344 attempts, 26 historical missing attempts and zero latest missing files; runner inconsistency remains separate. Frozen census/full ledger hashes are in the structured proof. This is cumulative per-file evidence, not a final-source whole-package pass or full native classification.

| State      | Remaining path                                                                         |
| ---------- | -------------------------------------------------------------------------------------- |
| red        | `packages/agents/src/core/__tests__/childaccept-body.test.ts`                          |
| red        | `packages/agents/src/core/__tests__/childaccept.test.ts`                               |
| red        | `packages/agents/src/core/__tests__/journal-retained-growth-release-trap.test.ts`      |
| red        | `packages/agents/src/core/__tests__/journal-retained-growth-retaining-trap.test.ts`    |
| red        | `packages/agents/src/core/__tests__/journal-retained-growth.test.ts`                   |
| red        | `packages/agents/src/core/__tests__/send-journal-opens.test.ts`                        |
| red        | `packages/agents/src/core/__tests__/subagent-child-config-journal-integration.test.ts` |
| unverified | `packages/agents/test-bun/run-bun-tests.issue3253.bun.ts`                              |

All 113 recorded owned PIDs are absent at 2026-10-20T03:19:33.952Z. Next work may inspect the remaining child transport/config, retained-growth/trap, opens and runner paths after this commit; no new family started here. Supplemental core addbatch-value-serialization stays red outside inventory. W22/W23-W26, pending classification and scratch removal remain open; old default unchanged. Review skipped per Andrew 2026-10-09. No cleanup/deletion, generated obstruction move, .llxprt edit/staging, raw recovery bulk staging, pattern kill, skips, weaker assertions/bounds/timeouts/checks, OCR, push or merge. Unrelated memory/recovery changes remain untouched.
