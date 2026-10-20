# W22 agents sweep status

Updated 2026-10-20 after the density/accounting matrix completed at 01:27:55Z. This supersedes the attempt/value checkpoint of 767 green, 34 red and five unverified.

**The six density/accounting targets are green and committed. W22 remains incomplete.** Production fix: `051b9df521ae50b08ae66bcd99ed61525c32efa4`. Fixture and census source: `12705c2bd`, eight explicit paths committed before census publication and documentation. This is WIP finalization, not review. No middle-out or one-shot repair began.

## Accepted census

All **806 inventory paths were process-attempted**. Accepted state is **806 = 773 green + 28 red + five unverified**, with zero unattempted. This increment changes exactly six red files to green. These are cumulative accepted per-file source boundaries, not a final-source whole-package pass.

Verified cases are **6495 passes, 64 failures and zero skips**. The recorded aggregate is 6502 passes; seven inconsistent runner XML passes remain unverified and excluded from classifications. Passing classifications reconcile to 6495: **277 native-history, 311 shared/public, 42 explicit-old and 5865 classification-pending**. The separate unclassified bucket is zero. Native labels include retaining controls; those controls are not positive bounded-memory proof.

There are **1162 retained attempts**. Newly accepted batches are only `density-core-b-final-journal-j-a` and `density-final-journal-j-a`, in that order. Nineteen distinct inventory paths have current density evidence; six supplemental core paths do not enlarge the inventory. Later lifecycle evidence supersedes its earlier five-case source. Diagnostics, traps and outer-old comparisons remain outside accepted totals. Relative to the preceding checkpoint, verified passes increase by 21 and failures decrease by 16.

Generation: `7ff32ea1-af78-41a5-a87a-c4d1da7b17ef`. Full ledger, failure table, missing evidence and publication checksums are frozen under `tmp/854-notes/p4/w22/density-run-j/frozen-final/`. Compact source/PID/case/gate/control evidence: `W22-DENSITY-ACCOUNTING-PROOF.json`. Exact open queue: `W22-REMAINING-FAMILIES.tsv`, **33 paths**.

## Root causes and native proof

The initial six-file run had **35 passes/16 failures**, with complete XML and matching summaries. Three failures exposed production differences fixed at `051b9df52`:

- The native density transform did not charge the decoded original while resolving its addressed decision. Capture test PID 43094 observed zero owned rows. The transform now tracks and releases each original through the existing ownership mechanism.
- Candidate token estimation omitted the old path's transient retry contract. Lifecycle PID 43105 propagated the first 503 instead of completing over its pinned source. Native estimation now uses the existing compression retry policy, retaining its attempts and delays.
- Equal-position span merge gave replacement spans precedence over removals. Span-order PID 43378 observed a replacement covering 2..3 instead of replacement 2 plus removal 3. Removal spans now precede replacements before the stable sort/merge.

The remaining failures were fixture/API assumptions. Identical row digests at both scales show old seed totals of zero and native admitted totals of 795/12743. Effective accounting must retain those tokens plus the requested offset. No-read acquisitions are measured relative to fixture entry. Explicit context room preserves both original compression-decision assertions; a one-token infrastructure tokenizer and larger thoughts make the unchanged zero clamp assertion meaningful.

High-density fallback constructed an old-only recorder and assumed its zero admission baseline. The selected real recorder fixture, awaited addBatch and native admitted no-op/failure cases now exercise the current protocol. The original zero-baseline cases remain explicitly old. The type suite checks the current `compressDisk` public entrypoint; absence-of-optimize assertions remain through the strategy interface.

The six final targets pass **56 cases per outer backend**, zero failures/skips. Selected-journal classification is **20 native, 31 shared/public and five explicit-old**. Native density lifecycle adds partial admission/rollback/retry at 512/8192 rows and rejected publication with restored chronology. It checks complete public rows against independently reopened primary and mirror row trees, token/offset/anchor/range restoration, original failure identity and released owners. Existing native fallback value, cancellation, queued publication, source lifetime, media and publication-shape suites actually ran. Native coverage is not inferred from pinned old cases.

Original assertion count is not reduced: **109 of 112 expressions remain verbatim**. Three expressions account for admitted tokens, relative acquisitions or the renamed public API. All original parameter domains, timeouts, 512/8192 scales, 440-row/8 MiB bounds and nine-MiB surviving row remain. The AST preservation receipt records every difference and its reason.

## Matrices, controls and gates

Four retained phase batches contain **56 isolated processes, 370 passes, two failures and zero skips**. Three paths repeat per outer setting. After taking the latest source once per path, the effective matrix is **25 files per backend**: journal **177 passes/two failures**, old **179 passes/zero failures**, zero skips. The two journal failures are the unchanged middleout-disk cases, with the exact prior source hash, case statuses and counts. Outer-old passes those cases. They are not repaired or relabeled green. The original broad verifier stopped on that known red; the completion driver separately validated it and finished the existing old matrix.

Effective journal classifications are 115 native/45 shared-public/17 old. Effective outer-old classifications are 74 internally native/45 shared-public/60 old. Supplemental and repeated executions are separate from the 806-path census.

The retaining trap, test PID **51671**, exits one with **zero passes/four failures** at the unchanged 440-row predicate. Both reference and complete-copy retention fail at 512/8192 rows, without timeout or unrelated error. Those failures remain outside positive and accepted totals.

All ten saved final product gates pass: API surface, declarations, core types, agents types, agents Bun types, touched-path types, zero-warning no-ignore ESLint, Prettier, affected graph and AST audit. **All 37 effective source hashes**, including two census paths, match worktree and committed blobs. Earlier lifecycle hashes remain historical, not current proof. No successful heavy gate or matrix was rerun for finalization. Graph validation does not establish shard-test execution.

The audit retains its pre-existing structure-only API notice and five new SELF_CONFIRMING notices. The latter compare pre-attempt token/offset/durable state with independent post-rollback observations across real rejected compression. They are conservation assertions, not echo assertions. Exact equality and scanner policy remain unchanged; no suppression was added.

## Census oracle integrity

Acceptance initially failed at stale PID 130 instead of density PID 180. The final layer selects only the two final journal batches. Density labels require exact path/classname/name, accepted journal batch and matching source hash. Old, unknown and diagnostic attempts do not inherit these labels; source mismatch remains pending. Existing missing/inconsistent evidence rules are unchanged.

Removing only the density source-hash guard produced the expected native-versus-pending failure. Final-source restoration passed actual `cmp` with exit zero, then **seven tests/92 assertions**, strict types, explicit no-ignore zero-warning lint and explicit formatting passed. An earlier control was byte-restored before its acceptance-reference path changed; the final control covers the exact committed boundary. A standalone type invocation initially omitted the required `.ts` import option; its corrected invocation passed without source changes. Both logs remain retained.

## Missing evidence and remaining families

Four latest missing-XML files remain unknown: middleout-disk-{large-request,publication-owners} and oneshot-disk-{large-request,publication-owners}. Their outer terminations and incomplete summaries are not zero-count measurements. Keep these four files separate from **22 historical missing attempts**.

The fifth unverified file is `test-bun/run-bun-tests.issue3253.bun.ts`, PID 62524. XML/final outer summary report seven passes, while the parser captured a nested child's one-pass summary. It stays inconsistent-record-unverified. Original admission PID 98836 remains missing at its original source; later PID 19211 has three passes at a different source hash. Later success does not reconstruct missing original evidence.

| Family                                   | Red files | Unverified files |
| ---------------------------------------- | --------: | ---------------: |
| Middle-out request/publication           |         5 |                2 |
| One-shot request/publication             |         5 |                2 |
| Conversation observations/model stamping |         5 |                0 |
| Child ownership/transport                |         3 |                0 |
| Retained growth and its controls         |         3 |                0 |
| Send snapshot count                      |         1 |                0 |
| Deferred acknowledgement                 |         1 |                0 |
| Semantic purge                           |         2 |                0 |
| Stream request demand                    |         2 |                0 |
| Turn media rollback                      |         1 |                0 |
| Runner summary accounting                |         0 |                1 |
| Total                                    |        28 |                5 |

Next candidate family is middle-out request/publication, including its two missing-evidence files, in a subsequent task. No diagnosis or implementation for that family or one-shot began here. Other families remain separate; grouping does not prove a shared cause. There is no pending package sweep to resume.

Owned completion driver **70429**, serial driver **70431** and every recorded matrix/gate child are absent. Receipt: `density-run-j/final-owned-processes.json`. W22 and W23-W26, pending classifications and scratch removal remain open; old default unchanged. Review skipped per Andrew 2026-10-09. No OCR, cleanup/deletion, obstruction move, `.llxprt/` edit/staging, raw recovery bulk staging, push, merge, skip or weakened enforcement. Unrelated dirty memory and recovery artifacts remain untouched.
