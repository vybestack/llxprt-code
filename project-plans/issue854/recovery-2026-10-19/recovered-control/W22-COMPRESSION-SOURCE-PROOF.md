# W22 compression source cluster, 2026-10-19

Two source-failure files are repaired at **8a4f11980c7e491fcedf366e4ea7ff2c8500c7a8**. W22 remains partial. The change is test-only: two existing suites and one native source helper. Production bytes are unchanged, including the byte-restored negative-control target. Raw evidence is retained under `tmp/854-notes/p4/w22/compression-cluster-run-e/`.

## Root cause and preserved contracts

The shared suffix fixture selects its recorder/backend from the environment. Both source-failure tests then require a JSONL recorder and instrument a synchronous `DetachedHistoryJournal` checkpoint. The native checkpoint is an asynchronous row source over a pinned version. The observed red cases therefore failed during fixture construction, before testing source closure or rollback. No production defect is established by those failures.

Only those old checkpoint-specific source paths now use the existing `withCoreSuffixFixture(..., 'old')`. Truncation's mostly-retained candidate cases still select the actual outer backend. Its queued-membership case already uses the explicit-old snapshot helper. Every original complete `it` call, assertion and timeout argument is AST-identical, covering nine original expanded cases. The 512/8192 sizes, 120000/180000 ms bounds, 440-row and 8 MiB owner limits are unchanged.

Four native high-density Error/AbortError cases reuse `withNativeFallbackFixture`, real HistoryService, native checkpoints, writer and independently reopened row trees. Each starts with exactly 512 or 8192 complete tool/media/provider rows, fails at row 31, observes generator closure and released pin access, and checks exact unchanged live/durable value digests. Native tokens are established explicitly by admission, including the 37-token base and anchor 1, rather than importing the old recorder's uncomputed zero baseline. Range, scratch-directory membership, zero live owners and absent provider requests are conserved. A later real compression succeeds, changes the digest and has identical live/committed values with zero live owners and the unchanged owner bounds.

## Native case gap map

| Original contract or boundary | Executed native counterpart |
| --- | --- |
| High-density source error/cancel at both scales | Four new cases in highdensity-disk-source.test.ts: error identity, closure, pin release, full live/durable rollback, token/base/range/anchor conservation and successful retry |
| Truncation source failure at both scales | Existing truncation-value-publication.journal.test.ts: closes the failed native source, preserves all 512/8192 rows and retries truncation |
| Mostly retained truncation candidate | Two unchanged selected-backend cases in truncation-stream-lifecycle.test.ts run under each outer setting |
| Queued caller membership | Existing fallback-values-contracts.journal.test.ts pending and queued chronology through cancellation at both scales |
| Actual partial admission and cancelled held writer | Existing truncation-value-publication.journal.test.ts and fallback-values-contracts.journal.test.ts |
| Complete tool/media/provider value rollback and baseline/stage errors | Existing fallback-values.journal.test.ts and truncation-value-publication.journal.test.ts |
| Real media reservations and release | Existing fallback-values-media.journal.test.ts: acknowledged finalization rejection, durable rollback, reservation conservation and later release |
| Actual async acknowledgement, held rows and pending-window phases | Existing fallback-values-live.journal.test.ts, unchanged eight cases |

These related native cases were RUN, not copied. This cluster does not close native gaps in other red files.

## Observed controls and final execution

Before repair, high-density source had zero passes/four backend-mismatch failures. The collected truncation lifecycle file had three passes/two backend-mismatch failures. Their raw attempts remain in the census ledger. The initial repaired two-file run had 13 passes/zero failures/skips.

Omitting native checkpoint snapshot.close produced **four original old passes/four native failures**, exit one, PID **4054**. All four new cases failed because escaped.next resolved while the pin remained held. The production file restored byte-identically to SHA-256 `d4e1ca793341a2c12361b8b82a6e5e1b01d76d2a782004757492d30a28936719`. This control is an intentional break, not a discovered production defect.

The final source matrix has **114 passes, zero failures/skips in 16 isolated serial Bun processes**, from the package directory, across both outer settings. Outer-old executions are supplemental, not additional package coverage.

| File | Journal passes / PID | Old passes / PID |
| --- | ---: | ---: |
| `highdensity-disk-source.test.ts` | 8 / 4359 | 8 / 8964 |
| `truncation-stream-lifecycle.test.ts` | 5 / 5021 | 5 / 12065 |
| `truncation-value-publication.journal.test.ts` | 10 / 5215 | 10 / 12247 |
| `fallback-values-contracts.journal.test.ts` | 4 / 5490 | 4 / 12714 |
| `fallback-values-media.journal.test.ts` | 4 / 5865 | 4 / 13390 |
| `fallback-values.journal.test.ts` | 13 / 5923 | 13 / 13639 |
| `fallback-values-live.journal.test.ts` | 8 / 6968 | 8 / 15904 |
| `highdensity-disk.test.ts` | 5 / 7168 | 5 / 16893 |

All **10 scoped gates passed**: API surface, declaration build, core tsc, agents tsc, agents Bun types, touched-source tsc, zero-warning ESLint, Prettier, affected graph and AST audit. Graph validation is not shard execution. Exact commands, PIDs, source hashes, JUnit cases, exits and prior/current audit notices are in W22-COMPRESSION-SOURCE-PROOF.json. No scanner policy changed. The earlier ESLint failure (85-line helper function, 80-line limit) is retained in gates/eslint.log; extracting the local fault probe satisfied that rule, followed by complete control, matrix and gate execution on the final helper. The one full-source comparison checked 3321 prior entries, identified the two intended existing test changes plus the prior committed shared-origin change, and added the single new helper for 3322 final entries. Every matrix source hash matches the committed blob.

## Census and remaining work

Frozen generation `60ec7d10-91c1-45ff-a534-bead41890f67` at **2026-10-19T22:45:01.947Z**: **806 = 368 green + 34 red + 4 unverified + 400 unrun**. There are 406 selected files, 2909 measured passes/118 failures/0 skips. These are cumulative per-attempt boundaries, not a final-source package pass. The four latest missing XML files retain unknown counts; 22 historical missing attempts remain separate.

Machine census classifications remain {"native-history":87,"journal-selected-shared-public":258,"explicit-old":27,"classification-pending":2537,"unclassified":0}. Unmapped case names remain pending. Separate verified source-cluster accounting is four native/four explicit-old high-density cases, two selected-backend/three explicit-old truncation lifecycle cases, plus 39 reused explicit-native cases per environment. The unchanged main high-density oracle cases are not silently added to native-specific totals. New verified native accounting does not recast the entire pending corpus.

The compact before-edit file/test/seam table is retained at compression-cluster-run-e/causes-before-edit.md. Full exact remaining failed-case names and raw/XML references are in the structured proof. Next bounded repair is recorder/backend selection in pending-window-disk-helpers and its callers (addbatch-pending-window, pending-window disk contracts/noop/owner-controls/phases/route). Related AdmissionFailureRecorder mismatches remain in compression-value-recorder, provider fallback/hardlimit and high-density fallback. Keep their JSONL-specific mechanics separate from native async acknowledgement, then RUN or add missing native counterparts. Other open seams are async checkpoint lifetime in compression-value-lifetime and middleout/oneshot owner controls, historical empty-row publication, density ownership/estimation/span order, exact effective token baselines, and provider request byte ordering. The collected types-highdensity case still expects the removed MiddleOutStrategy.compress member; ConversationManager.modelStamp has two synchronous-observation failures on native import/addHistory. Those separate contracts remain open. Missing large-request/publication-owner results are unverified, not automatic retries.

Resume only the 400 pending paths, starting at package-resume-g-0250, through the existing serial collect-continue driver with 50-file boundaries and zero automatic retries. Do not overlap package source edits or gates with that sweep. Live authority remains run-20261019-a/sweep-supervisor.json and its currentFilePath. The repaired final journal matrix is accepted as g-0201, leaving the completed g-0150 collection intact.

Old remains default; W23-W26, including W26 scratch-candidate removal, remain open. History must stay out of memory, with only one row's conversion state retained, no new operation temp files and no repeated whole-file reads. No cleanup/deletion, obstruction move, .llxprt edit, raw recovery staging, weaker check, OCR, push or merge. Review skipped per Andrew 2026-10-09.
