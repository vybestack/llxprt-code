# W22 agents sweep status

Updated 2026-10-20 after verification completed at 00:49:09Z. This supersedes the provider-fallback checkpoint at `f622ef692`.

**The five attempt/value suites are green and committed. W22 remains incomplete.** Source commit: `ca62b6bc22b8e66e62cf889d7944998746fa407a`, five test/support paths. Production and the old backend default are unchanged. Source was committed before census acceptance and documentation. This is WIP finalization, not review; no unrelated repair family was started.

## Complete collection and accepted census

All **806 inventory paths were process-attempted**. The accepted census is **806 = 767 green + 34 red + five unverified**, with zero unattempted paths. These are cumulative accepted per-file source boundaries, not a final-source whole-package pass.

Verified case evidence is **6474 passes, 80 failures and zero skips**. The recorded pass aggregate is 6481. Seven XML passes from the inconsistent runner meta-suite remain unverified and excluded from verified passes and classification. Passing classifications reconcile to 6474: **229 native-history, 268 journal-selected shared/public, 31 explicit-old and 5946 classification-pending**. The separate unclassified bucket is zero. Native-history includes retaining controls; those controls are not positive bounded-memory proof.

There are **1101 retained attempt records**. Only `attempt-final-journal-i-a` is newly accepted after `provider-final-journal-h-a`. Seventeen of its twenty files belong to the original inventory; the new retaining suite and two core suites are supplemental. The five original red files, with eight passes/fourteen failures, are replaced by twenty-two final selected-native passes. Diagnostics, the retention trap and outer-old comparison remain outside accepted package totals. No completed product gate or matrix was rerun for accounting.

Generation: `b530937c-8556-4416-9711-9945af11692e`, published at 00:49:43Z. Full ledger, failure table, missing evidence and publication checksums are frozen under `tmp/854-notes/p4/w22/attempt-value-run-i/frozen-final/`. `W22-ATTEMPT-VALUE-PROOF.json` records source hashes, exact case/PID/gate evidence, classifications, preserved assertions, controls and all unresolved paths. `W22-REMAINING-FAMILIES.tsv` is the exact **39-path** open list.

## Attempt/value proof

The hook-only fixtures originally seeded the old recorder without estimating tokens. Native addBatch seeding estimated tokens and inadvertently entered strategy execution after the hook. That caused unexpected compression and rejected historical zero-block rows. The shared hook fixture now restores its original zero scalar token baseline through the public service API. Actual cursor traversal, complete-value digest checks and hook token estimation remain active; no runtime threshold changes.

The value-lifetime wrapper lost native snapshot prototype methods through object spread. It now forwards rows, chronology and close explicitly. Its old indexed media participant is replaced by real HistoryMediaOwnership supporting both protocols. Published rows are counted through the real public stream at acknowledgment. The original weak-reference release, live lock, callback failure identity, rollback, anchor and retry assertions remain.

The selected-recorder fixture replaces direct JSONL-only construction. It streams seeds, awaits commits and uses real journal positional-write barriers. Native durable assertions independently reopen both the primary and recorder mirror and compare their complete row digests with public history. The old enqueue admission fault is preserved. Native partial admission rejects the third candidate row at the real tokenizer boundary after two successful admissions. A physical writer failure poisons subsequent I/O and cannot establish this test's normal retry contract; that intermediate diagnostic remains separate. No production recovery wrapper or exception broadening was added.

All **67 original assertion expressions**, parameter domains and timeouts remain, with selected-backend durable/failure fixture-name normalization only. The 512/8192 scales, 440-row/8 MiB bounds, hook row over eight MiB and nine-MiB value row remain unchanged. The three attempt test files themselves are byte-unchanged from the parent.

Final matrix: **twenty files per outer backend, 96 passes each, 192 total, zero failures/skips**. Journal classifications: 84 native-history, eight shared/public, four explicit-old. Outer-old has 52 explicit-old and 44 explicitly native cases. The five targets contribute twenty-two native cases covering public pinned membership, cancellation/close, estimation, source/stream ownership, acknowledgment failure, complete persisted rows, compensation and retry. Reused native value-contract, publication/media and borrowed-snapshot suites supply additional behavior rather than blanket old selection. Accepted inventory files contribute 54 native, eight shared/public and four explicit-old passes; supplemental files do not enlarge the 806-path inventory.

The retaining trap, test PID **37921**, exits one with **zero passes/four failures**, at the unchanged within-bounds predicate for complete reference/copy retention at both scales. It fails by assertion, with no timeout or unrelated exception. The trap is separate from the green matrices and census.

All ten saved source-bound gates passed: API surface, declaration build, core types, agents types, agents Bun types, touched-path types, explicit zero-warning ESLint, Prettier, affected graph and AST test audit. No touched audit findings before or after. All **24 matrix/helper hashes** match the worktree and committed blobs. Affected-graph validation does not establish affected-shard execution.

## Census oracle integrity

The initial census acceptance test failed because it selected provider PID 100 rather than attempt PID 130. The new acceptance layer selects only the final journal batch. Its new classifications require the exact path/classname/name and recorded test source hash. Matching case names from outer-old, unknown-backend and diagnostic attempts do not inherit this cluster's native labels. A mismatched classification source hash stays pending. Earlier classification contracts retain their earlier scope.

A source-guard mutation actually removed the hash requirement. The census test then failed with native-history where classification-pending was required. The runner was restored in finally and compared byte-identically with cmp, followed by a passing test. Explicit final formatting followed; the final formatted boundary passes **seven tests/82 assertions**, strict types, no-ignore zero-warning lint and explicit formatting checks. No existing oracle assertion was removed or relaxed.

## Unverified evidence stays open

Four latest files lack XML and a complete summary after their recorded outer SIGTERM: `middleout-disk-{large-request,publication-owners}` and `oneshot-disk-{large-request,publication-owners}`. Counts remain unknown. The publication logs contain first-case timeouts; large-request logs have no completed case summary. They were attempted, not skipped or unrun.

The fifth file is `test-bun/run-bun-tests.issue3253.bun.ts`, PID 62524. Exit zero and XML/final outer summary say seven passes, but the parsers captured an earlier nested child's one-pass summary. It remains inconsistent-record-unverified. This cluster did not repair that parser family or rerun the suite.

Keep **22 historical missing attempts** distinct from **four latest missing files**. Original profile-admission PID 98836 has no XML/complete summary. Later selected PID 19211 has three passes at a different source hash. Later success does not reconstruct the original missing result. Frozen evidence preserves both.

## Remaining families

Grouping labels do not establish shared root causes. The TSV gives exact paths, states, PIDs, hashes, batches and counts. The proof JSON includes failed cases and raw references.

| Family                                    | Red files | Unverified files |
| ----------------------------------------- | --------: | ---------------: |
| Density capture/lifecycle/span accounting |         3 |                0 |
| Effective token count                     |         1 |                0 |
| High-density fallback rollback            |         1 |                0 |
| Middle-out request/publication            |         5 |                2 |
| One-shot request/publication              |         5 |                2 |
| Strategy type contract                    |         1 |                0 |
| Conversation observations/model stamping  |         5 |                0 |
| Child ownership/transport                 |         3 |                0 |
| Retained growth and its controls          |         3 |                0 |
| Send snapshot count                       |         1 |                0 |
| Deferred acknowledgement                  |         1 |                0 |
| Semantic purge                            |         2 |                0 |
| Stream request demand                     |         2 |                0 |
| Turn media rollback                       |         1 |                0 |
| Runner summary accounting                 |         0 |                1 |
| Total                                     |        34 |                5 |

Next cluster: density-disk capture owners, lifecycle and span order, after reading their individual failure inputs. Effective-token counting and high-density fallback remain separate candidates; do not assume they share a cause. Middle-out and one-shot request/publication contracts, including their missing evidence, remain open. There is no pending package sweep to resume.

Verification driver **22627**, supervisor **22625**, bash **22626**, both final matrix drivers, trap driver and all recorded children/gates are absent. Receipt: `tmp/854-notes/p4/w22/attempt-value-run-i/final-owned-processes.log`. W23-W26 and scratch removal remain open; the old default is unchanged. Review skipped per Andrew 2026-10-09. No OCR, project cleanup/deletion, obstruction move, `.llxprt/` edit/staging, raw recovery bulk staging, push or merge. Unrelated dirty memory and recovery artifacts remain untouched.
