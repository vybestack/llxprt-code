# W22 agents sweep status

## W22 five core fault contracts, 2026-10-20T03:19:33.952Z

**All five requested core suites are green and committed at 3fff916f5; W22 remains incomplete.** Production fix fc2515b17 follows actual RED: native rollback stopped at the first media-release error and discarded the append owner index. It now attempts every release, reports errors and retains failed reservation bookkeeping until disposal. Original lifecycle test unchanged. Test/support source committed before census acceptance 572ec4341.

Final effective matrix: **twenty files per backend, 145 passes each, 290 total/zero failures/skips**, isolated serial Bun processes. Five targets provide 36 cases per backend. Fifteen reused W21/native service/public-crash/lifetime/request/purge suites actually ran; no duplicate full matrix. Ten scoped product gates and five census/API suites (twelve cases), strict census types/lint/explicit formatting/final graph/audit pass. Audit adds three DUP_ASSERT notices for deliberate before/after demand/ownership checks; no new MOCK_MIRROR/ALWAYS_TRUE/SELF_CONFIRMING/NO_ASSERT. Graph validation is not shard execution.

All **119 original target assertion expressions remain verbatim**, with fourteen additions; original domains/timeouts/bounds unchanged. Native deferred acknowledgement gates the real trailer write after producer exhaustion and independently reopens durable bytes. Purge fixtures select the recorder protocol, keep old synchronous guards explicit-old and exercise distinct native guards plus durable row digests. BODY observes the actual journal traversal without a history override, preserves exact bytes/estimation/hooks/abort, and proves cold replay readers release on cancellation. No production request read, count pass, full-history clone or backend-default change.

Original-production control PIDs 77227/77270 fail exactly four media regressions plus the unchanged lifecycle case; fixed source restores with cmp zero and PIDs 77319/77377 pass 24 cases. Source-hash census guard removal fails, restores byte-identically/cmp zero and passes. Earlier original RED, diagnostic/old-injector and lint failures remain retained, not retried into acceptance.

**806 = 798 green + 7 red + 1 unverified**, zero unrun. Verified **6557 passes/11 failures/zero skips**; recorded 6564 passes include seven inconsistent runner XML passes withheld. Classifications: **388 native/344 shared-public/44 explicit-old/5781 pending**; separate unclassified zero. Only five target paths change state from 793/12/1. Generation 7e731274-7a5a-4e2d-9976-88b64c3d0cd1 keeps 1344 attempts, 26 historical missing attempts, zero latest missing files and the separate runner inconsistency. Exact source/case/native-counterpart acceptance excludes old/diagnostic/unknown/control results. Cumulative per-file evidence is not full-package final-source/native proof.

Details and checksums: W22-CORE-FAULT-PROOF.md/.json; raw tmp/854-notes/p4/w22/core-fault-run-m/. All 113 recorded owned PIDs are absent; no active mutation or restoration. Eight exact remaining paths are in W22-REMAINING-FAMILIES.tsv. Next candidates: childaccept transport/config, retained-growth/traps, send-journal opens and the runner inconsistency; none started. Supplemental core addBatch red stays outside census. W22/W23-W26/classification/scratch remain open. Review skipped per Andrew 2026-10-09. No cleanup/deletion, obstruction move, .llxprt edit/staging, raw recovery bulk staging, pattern kill, weakened check/timeout/bound, default flip, OCR, push or merge. One transient index lock blocked census staging; after verified absence a normal authorized retry committed, without lock alteration.

## Exact remaining queue

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
