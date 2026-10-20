# W22 child ownership and transport

**The three child suites are green and committed; W22 remains incomplete.** Verified base: `e8319c76657c34fa59bf4b1f3e0ae92da1495f0c`. Source: `77fa25a02346870fb7e1323c24a3ff642212a6fa`. Census acceptance: `38e0696f0d552d16b19ab6694aef1285c99198b6`. This is implementation, not review. Production and backend default are unchanged.

Structured case/process/hash/gate evidence: W22-CHILD-OWNERSHIP-PROOF.json. Raw logs, valid supplemental XML, assertion preservation, final request/reference copies and frozen census/ledger: `tmp/854-notes/p4/w22/childownership-run-n/`.

## Causes and preserved behavior

| Suite                                               | Cause and change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Final cases per outer environment |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------: |
| `childaccept-body.test.ts`                          | The parent fixture used SessionRecordingService with native selection, and ResumeCursorBoot interpreted a native file as JSONL. Use the selected real recorder; native resume reads recorded facts, opens the actual recorder and uses JournalResumeBoot plus its committed resume point. Preserve the old boot and JSONL mutation-record checks. Independently reopen native rows after each mutation, compare complete live/disk values and independent eager-fold speaker/blocks, and keep the original byte oracle. |                                 4 |
| `childaccept.test.ts`                               | Filename/header assertions assumed JSONL. Select the real suffix; preserve original old byte assertions and require native committed identity, subagent ancestry, provider/model, workspace, row count and exact child-only content. The real orchestrator, scope, runtime, provider and local HTTP still execute.                                                                                                                                                                                                      |                                 3 |
| `subagent-child-config-journal-integration.test.ts` | The disposal observer searched only for JSONL. Observe the actual selected child path, held child lock and isolated Config at first disposal, with independently read native facts. Restore the original disposal method immediately so a second idempotent dispose does not reassert existence after deletion. Preserve exact scope-failure identity, listener conservation and final artifact removal.                                                                                                                |                                 2 |

No production defect was demonstrated by these failures. Initial authoring produced one Config observer error on its second invocation; it was fixed in instrumentation, not hidden by changing production disposal. The initial final-source lint gate rejected nested helpers; extraction satisfied the existing rules without suppression. All failed attempts remain separate from final evidence.

All **28 original assertion expressions are retained**, with thirteen additions in the target test ASTs. Case names, seeds 854/11259375, retry attempts 1/2, scope outcomes and original timeouts remain. No role/order expectation changed. The eager-fold and transport support files are byte-identical to the starting commit. Recomputed receipts match **130 actual HTTP bodies**: 120 mutation request/reference pairs, six live/resumed marker requests and four refusal/retry requests across the two backend environments. Copies and SHA-256 receipts are workspace-local. Production receives streamed history; no whole-history array, operation spool or repeated whole-file read was added.

## Reused contracts and verification

W16 `c165a80e4` already supplies selected-backend child construction and lifecycle behavior. The existing suites actually ran instead of duplicating that matrix:

- `subagentOrchestratorFsSafeIds.p05c` and `subagentOrchestrator-runtime`: allocated IDs, parallel/nested separation, actual child configuration/provider isolation, failure/cancel/timeout and disposal ownership. Their internal old/native selection remains unchanged.
- Core `child-session-backend`, `journalChildSession`, `childHistoryFacade.p05c`, `childJournalLifecycle.p05c`, `childSessionIds.p05c`, `session-fork-late-ownership` and `session-fork-offset-audit`: child/parent persistence separation, independent locks, late attachment, explicit old-layout lifecycle and native equivalents, fork owners and offsets.
- `session-client-child-owner.behavior`, `session-media-owner-closure.behavior`, `stream-request-body-demand` and `streamprocessor-source-http`: child/parent owner lifetimes, media release/isolation, bounded demand/cancellation and actual source-backed HTTP. These do not establish an exhaustive child crash/fanout matrix.

Final effective matrix: **sixteen files per backend, 96 passes each; 32 isolated serial processes, 192 passes, zero failures/skips**. Three targets supply nine cases per backend; thirteen related files supply 87. Each file ran from its package directory. Outer backend labels do not relabel internally pinned old/native cases. All eighteen captured source hashes match the worktree and source commit.

Nine scoped product gates pass: agents API surface, declaration build, agents and agents-Bun types, touched-file strict types, zero-warning ESLint, Prettier, affected graph and AST test audit. No touched audit findings remain. Five census suites pass **thirteen cases/166 expectations**, followed by strict census types, explicit no-ignore lint/format, final graph and audit. Graph validation is not affected-shard execution. No full-package or monorepo pass is claimed.

## RED and census controls

The starting-source native run reproduced **3 passes/6 failures**: body PID 86339 (1/3), launch 86345 (2/1), Config 86373 (0/2). Their hashes match the base; logs and XML are retained. Earlier recorded failures at PIDs 25704/25736/26229 remain historical and are not substituted for this run.

The added child census case failed before its acceptance layer existed. Removing the exact-source guard then produced **0 passes/2 assertion failures**, PID 95935, because wrong-source evidence became green. Finally restoration is byte-exact, cmp zero, runner SHA-256 `fd9998a7333a1ab7142c0b7f536177155cda5dc9add77003511beddf1df9e13c`. The wrapper mistakenly expected `Expected:` rather than Bun's `- Expected`, so it reported a detector error after the intended assertion failures; that failed wrapper log is retained. The subsequent complete census suite run passes on restored source. No mutation remains active.

Acceptance requires the final journal batch `child-final-journal-n-e`, exact source hash and complete case contract. Old, diagnostic and unknown-backend results cannot become native green. Missing/wrong-source/same-old native counterparts and inconsistent raw/XML counts remain rejected. This batch's nine accepted cases classify as eight native and one shared-public directory-creation case; its old-layout branches are also exercised by the separate old run.

## Accepted census and remainder

Generation `eba480af-ae61-40cd-8982-dcdf305a0285`: **806 = 801 green + 4 red + 1 unverified**, zero unrun. Verified **6563 passes/5 failures/zero skips**. Recorded 6570 passes still include seven inconsistent runner XML passes withheld from verified totals. Passing classifications: **396 native/345 shared-public/44 explicit-old/5778 pending**, separate unclassified zero. Only the three target paths change from 798/7/1. There are 1413 retained attempts, 26 historical missing attempts and zero latest missing files; runner inconsistency remains separate. The frozen full ledger and census hashes are in the structured proof. This is cumulative per-file evidence, not final-source whole-package/native closure.

Remaining exact paths:

| State      | Path under packages/agents                                          |
| ---------- | ------------------------------------------------------------------- |
| red        | `src/core/__tests__/journal-retained-growth-release-trap.test.ts`   |
| red        | `src/core/__tests__/journal-retained-growth-retaining-trap.test.ts` |
| red        | `src/core/__tests__/journal-retained-growth.test.ts`                |
| red        | `src/core/__tests__/send-journal-opens.test.ts`                     |
| unverified | `test-bun/run-bun-tests.issue3253.bun.ts`                           |

All **85 recorded owned PIDs are absent** at 2026-10-20T03:47:22.276Z. No live PID or pending restoration is handed off. No retained-growth or opens repair started. Supplemental core addBatch red remains outside census. W22/W23-W26, pending classification and scratch removal remain open; old default stays. Review skipped per Andrew 2026-10-09. No cleanup/deletion, obstruction move, .llxprt edit/staging, raw recovery bulk staging, pattern kill, skips, weaker assertions/bounds/timeouts/checks, OCR, push or merge. Unrelated memory/recovery changes remain untouched.
