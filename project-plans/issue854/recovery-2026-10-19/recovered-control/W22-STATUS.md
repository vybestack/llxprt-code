# W22 agents sweep status

Updated 2026-10-20T00:12:53Z. This supersedes the pending-window checkpoint at `613b3ae74`.

**The six provider fallback/hardlimit suites are committed and green. W22 remains incomplete.** Source commit: `0ed5b4e327317856fe724fe7b142ed7b5f698c01`, five test/support paths. Production and the old backend default are unchanged. Verification finished at 00:10:44Z, before the source commit and census acceptance. No further repair family was started.

## Complete collection and accepted census

All **806 inventory paths were process-attempted** in the completed collection. The accepted census is now **806 = 762 green + 39 red + five unverified**, with zero unattempted paths. These are cumulative accepted per-file source boundaries, not a final-source whole-package pass.

Verified case evidence is **6460 passes, 94 failures and zero skips**. The recorded pass aggregate is 6467. Seven XML passes from the inconsistent runner meta-suite remain unverified and excluded from verified passes and classification. Passing classifications reconcile to 6460: **179 native-history, 260 journal-selected shared/public, 27 explicit-old and 5994 classification-pending**. The separate unclassified bucket is zero. Native-history includes retaining controls; those controls are not positive bounded-memory proof.

There are 1052 retained attempt records. Only `provider-final-journal-h-a` is newly accepted after `pending-final-journal-g-a`. Its twelve final journal files match the committed test/helper source boundary. The six original red files, with 32 failures, are replaced by their actual final journal results. Diagnostic authoring runs, the retaining trap and outer-old comparison remain outside accepted package totals. The seven-test census acceptance suite was red before adding this batch, then passed with 68 assertions. Strict types, explicit no-ignore zero-warning lint and formatting passed. No completed product test or gate was rerun for accounting.

Generation: `d82e0cba-473d-4643-9ec2-b191aa05245c`. Full ledger, failure table, missing evidence and publication checksums are frozen under `tmp/854-notes/p4/w22/provider-fallback-run-h/frozen-final/`. `W22-PROVIDER-FALLBACK-PROOF.json` records source hashes, exact case/PID/gate evidence, classification, preserved assertions, controls and every unresolved path. `W22-REMAINING-FAMILIES.tsv` is the exact 44-path open list.

## Provider fallback/hardlimit proof

All 32 original failures stopped at the shared JSONL-only recorder constructor under journal selection. The fixture now uses the real recorder factory, streams the seed and waits for the async native commit. The old admission fault still rejects the original enqueue boundary. Native admission faults reject real positional writes on a real primary journal, forwarding reads and accepted writes unchanged. Every final native target case additionally compares complete public row digests with independently reopened primary and mirror row trees.

The failed-compensation diagnostic retains the exact aggregate message, both error identities/order, failed baseline state and surviving candidate blocks. Old uses its original enqueue fault; native rejects real media replacement during compensation. The owner is registered before checkpoint capture because the transaction host captures its owner then. A native writer failure was unsuitable for this diagnostic's later normal-read contract, so that intermediate failure is retained separately. No production fallback or exception broadening was added. Three assertions add zero released-row/serialized-byte ownership and the unchanged reader bound. Digest bytes describe serialized JSON row values, not physical native file size.

The paused-owner case now uses a real media owner supporting both replacement protocols. It holds an actual pre-publication snapshot row across the barrier, rejects publication, and closes the snapshot on release/rollback. Original positive ownership, bounded peak, full restoration, zero final owners, anchor and baseline assertions remain. Existing native phase suites supply candidate-side publication/acknowledgement proof without duplicating them.

All **48 original assertion expressions**, parameter domains and timeouts are preserved; checked AggregateError narrowing replaces the old cast. Three assertions were added. Original 512/8192 scales, 440-row/8 MiB limits and the oversized-row case remain unchanged.

Final matrix: **twelve files per outer backend, 65 passes each, 130 total, zero failures/skips**. The six target suites contribute 32 selected-native cases. Five reused W11 native suites contribute 31 complete-value, partial-admission/retry, queued chronology, publication, media and exact source-stage cause cases. The selected retry suite adds two. In the supplemental outer-old run, 34 cases select old and 31 remain explicitly native internally. Outer-old does not add package coverage.

The native retaining trap, PID 99689, exits one with **zero passes/four failures**, at the unchanged within-bounds predicate for reference/copy retention at both scales. It fails by assertion, with no timeout or unrelated exception. Its four failures are separate from the final matrix and census.

All ten saved source-bound gates passed: API surface, declaration build, core types, agents types, agents Bun types, touched-path types, zero-warning ESLint, Prettier, affected graph and AST test audit. No touched audit findings before or after. All seventeen matrix/helper hashes match the worktree and committed blobs. Affected-graph validation is not affected-shard execution.

## Unverified evidence stays open

Four latest files lack XML and a complete summary after their recorded outer SIGTERM: `middleout-disk-{large-request,publication-owners}` and `oneshot-disk-{large-request,publication-owners}`. Counts remain unknown. The publication logs contain first-case timeouts; the large-request logs have no completed case summary. They were attempted, not skipped or unrun.

The fifth file is `test-bun/run-bun-tests.issue3253.bun.ts`, PID 62524. Exit zero and XML/final outer summary say seven passes, but both existing parsers captured an earlier nested child's one-pass summary. It remains inconsistent-record-unverified. This cluster did not repair that parser family or rerun the suite.

Keep 22 historical missing attempts distinct from four latest missing files. Original profile-admission PID 98836 has no XML/complete summary. Later selected PID 19211 has three passes at a different source hash. Later success does not reconstruct the original missing result. Frozen evidence preserves both.

## Remaining families

Grouping labels do not establish shared root causes. The TSV gives exact paths, states, PIDs, source hashes, batches and counts. The proof JSON gives failed cases and raw references.

| Family                                          | Red files | Unverified files |
| ----------------------------------------------- | --------: | ---------------: |
| Compression attempt cursor/estimation/lifecycle |         3 |                0 |
| Compression value lifetime/recorder             |         2 |                0 |
| Density capture/lifecycle/span accounting       |         3 |                0 |
| Effective token count                           |         1 |                0 |
| High-density fallback rollback                  |         1 |                0 |
| Middle-out request/publication                  |         5 |                2 |
| One-shot request/publication                    |         5 |                2 |
| Strategy type contract                          |         1 |                0 |
| Conversation observations/model stamping        |         5 |                0 |
| Child ownership/transport                       |         3 |                0 |
| Retained growth and its controls                |         3 |                0 |
| Send snapshot count                             |         1 |                0 |
| Deferred acknowledgement                        |         1 |                0 |
| Semantic purge                                  |         2 |                0 |
| Stream request demand                           |         2 |                0 |
| Turn media rollback                             |         1 |                0 |
| Runner summary accounting                       |         0 |                1 |
| Total                                           |        39 |                5 |

Next cluster: `compression-attempt-{estimation,lifecycle,stream}.test.ts`. Inspect their recorded cursor/estimation/lifecycle failures before choosing a fix. Do not infer that they share this recorder mismatch. There is no pending package sweep to resume.

Verification driver 92247, both final matrix drivers, trap driver and all recorded children/gates are absent. Receipt: `tmp/854-notes/p4/w22/provider-fallback-run-h/final-owned-processes.log`. Old default unchanged; W23-W26 and scratch removal remain open. Review skipped per Andrew 2026-10-09. No OCR, project cleanup/deletion, generated obstruction move, `.llxprt/` edit/staging, raw recovery bulk staging, push or merge. Unrelated dirty memory and recovery artifacts remain untouched.
