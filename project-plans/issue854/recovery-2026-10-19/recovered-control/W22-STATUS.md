# W22 agents sweep status

**Six core observation/request targets are green and committed at 9ad76c8a5. W22 remains incomplete.** Base ba4c3e8ca was verified; production and the old backend default are unchanged. This supersedes the request/publication finalization checkpoint for current counts only.

## Completed subset

ConversationManager model stamping, direct-message characterization, structural and stream-structural characterization, chatSession runtime and streamRequestHelpers pass **59 cases per backend**. Eight reused related suites add **67 per backend**: **28 serial isolated processes/252 passes/zero failures/skips** at final source. Related native transport, hook demand, semantic-purge boundary/lifecycle and runtime cases actually ran rather than being duplicated.

Observers await the existing commit boundary; all callers use explicit async signatures. Historical request inputs carry deterministic chronology, preserving the exact byte oracle rather than stripping metadata. All **156 original assertions** remain (153 verbatim, three await/curation-equivalent); two block assertions were added. Original property domains/timeouts/ownership bounds are unchanged. No production fix, whole-history materialization, extra counting pass or lazy request behavior change was made.

Ten scoped product gates passed, including declaration build, core/agents/agents-Bun/touched types, API surface, lint/format/graph/audit. Eleven census/API tests plus strict types, explicit zero-warning lint and ignore-free formatting passed. Final graph/audit passed; scoped audit has no new findings. Graph validation is not shard execution. Initial type and preservation-tool errors remain retained.

Actual original RED is source/hash-matched to the starting commit. The census acceptance test also failed before its new layer and now rejects mismatched sources/cases and inconsistent raw/JUnit evidence. No mutation was started; no restoration remains pending.

## Accepted census

**806 = 793 green + 12 red + 1 unverified**, zero unrun. Verified cases: **6543 passes/22 failures/zero skips**. Recorded 6550 passes include seven inconsistent runner XML passes withheld from verified totals.

Passing classifications: **354 native/344 shared-public/42 explicit-old/5803 pending**. Separate unclassified zero.

Only six red paths changed state from 787/18/1. Generation `067cf012-0657-40d0-b056-f493ee86a7f8` retains 1280 attempts, 26 historical missing attempts, 0 latest missing files and the distinct runner inconsistency. This is cumulative per-file evidence, not a final-source package green/native proof.

## Exact remaining queue

| State      | Remaining path under packages/agents/                                  |
| ---------- | ---------------------------------------------------------------------- |
| red        | `src/core/__tests__/childaccept-body.test.ts`                          |
| red        | `src/core/__tests__/childaccept.test.ts`                               |
| red        | `src/core/__tests__/journal-retained-growth-release-trap.test.ts`      |
| red        | `src/core/__tests__/journal-retained-growth-retaining-trap.test.ts`    |
| red        | `src/core/__tests__/journal-retained-growth.test.ts`                   |
| red        | `src/core/__tests__/send-journal-opens.test.ts`                        |
| red        | `src/core/__tests__/subagent-child-config-journal-integration.test.ts` |
| red        | `src/core/deferred-history-source.test.ts`                             |
| red        | `src/core/semantic-purge-array-seam.test.ts`                           |
| red        | `src/core/semantic-purge-production.test.ts`                           |
| red        | `src/core/stream-request-body-demand.test.ts`                          |
| red        | `src/core/turnMediaAdmission.lifecycle.test.ts`                        |
| unverified | `test-bun/run-bun-tests.issue3253.bun.ts`                              |

Five requested targets remain red: deferred acknowledgement, both semantic-purge suites, request BODY demand and turn-media lifecycle. Their exact original failed cases and diagnosed fixture boundaries are enumerated in W22-CORE-OBSERVATION-PROOF.md/.json. The native no-array snapshot and media error-finalizer requirements remain open; unrelated native regressions do not close them. The supplemental core addBatch fixture remains red outside this inventory.

## Evidence and process closure

New raw evidence: `tmp/854-notes/p4/w22/core-observation-run-l/`. W22-CORE-OBSERVATION-PROOF.json binds final matrices/gates/source hashes, all eleven original RED case sets, classifications, assertion preservation and frozen ledger checksums. All sixteen package source hashes match committed bytes/worktree. W22-REMAINING-FAMILIES.tsv is the exact thirteen-path queue.

All 84 recorded owned PIDs are absent at 2026-10-20T02:49:17.269Z; no live test/gate/supervisor or mutation remains. W22/W23-W26, pending classification and scratch removal stay open. Review skipped per Andrew 2026-10-09. No cleanup/deletion, obstruction move, .llxprt edit/staging, raw recovery bulk staging, pattern kill, assertion/bound/timeout/check weakening, default flip, OCR, push or merge. Unrelated dirty memory/recovery artifacts remain untouched.
