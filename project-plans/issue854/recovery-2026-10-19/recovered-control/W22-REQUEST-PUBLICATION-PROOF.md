# W22 middle-out and one-shot request/publication proof

This is WIP implementation finalization, not review. The production fix remains `d7e78deae3cf17a9d4d4de11e4370d1ed67fe9df`, from `31be71369f262f0c15d775b68d31aab8edab0b1b`. The two one-shot fixture changes were committed early at `6a8d4c944`. Census source and API tests are committed at `f126215be`. Raw evidence is retained under `tmp/854-notes/p4/w22/request-publication-run-k/`.

## Scope and preserved contracts

The exact target queue contains fourteen original inventory files: middleout-disk-{large-request,lifecycle,owners,publication-owners,retry,splits}.test.ts and middleout-disk.test.ts; oneshot-disk-{large-request,owners,publication-owners,request-charge,retry,splits}.test.ts and oneshot-disk.test.ts. The completed final target results have **51 passes per backend**, zero failures/skips. The separately included codec suite has forty passes per backend. The middle-out target subset contributes 29 passes and one-shot contributes 22. Supplemental files do not enlarge the frozen 806-path inventory.

`original-preservation.json` compares all fourteen targets with the starting commit. All **162 original assertion expressions** remain verbatim, with original domains, timeout literals, 512/8192 scales, 440-row/8 MiB ownership bounds and nine-MiB fixtures. The old publication and admission bodies remain reachable on old. Native execution uses actual native counterparts rather than blanket old selection. Independent array oracles and golden fixtures were not altered; exact request strings remain exact comparisons.

## Production cause and source comparison

The focused codec RED records different serialized bytes for the same row values. Historical tool content can use `speaker,metadata,blocks`; native decoding reconstructed `speaker,blocks,metadata`. That reordering breaks the existing provider-request byte contract. `codec-red.log` contains the exact expected/received order and failing assertion. The codec now records only non-default recognized content-key order in existing per-row metadata, then reconstructs that order after response invalidation. The clone boundary preserves recognized-key order while still sanitizing blocks, excluding unknown keys and supplying its existing metadata default. Default header encoding remains unchanged.

The controlled source comparison uses the actual two production files from `31be71369`, unchanged final tests and immutable final-source backups. The digest probe compares SHA-256 and byte count against the independent array oracle, so a request mismatch does not require formatting a nine-MiB assertion diff. Its receipt names original/final hashes, exact test PIDs and actual `cmp` restoration. The original large-string timeout attempts remain missing historical evidence. The prepared `large-order-control.ts` and process sampling were not executed and establish no timeout or tokenizer cause. In particular, a BPE explanation is unsupported.

No additional production change was made during this finalization. The production change does not retain a whole request/history array, add an operation file or reread a whole history file.

## Fixture causes and native proof

Native snapshots implement `close()` and `chronology()` on the prototype. Spreading the snapshot instance lost those methods in retaining wrappers. Both wrappers now forward them explicitly, preserving real snapshot ownership and retirement. No optional-close production fallback was added.

Old media publication participants use synchronous value replacement. Native publication uses reference replacement and finalization. The old gate was unreachable on native, while its test swallowed the operation rejection and waited for that gate. Native publication proof uses the existing recorder/native-writer fixture and races its gate with operation completion. It observes positive bounded owners during writer pause, zero owners after acknowledgement, complete durable/public rollback after rejected media finalization, original error identity and successful identical-request retry.

Native partial admission rejects through the actual tokenizer boundary after two successful admissions. The shared suffix seeder preserves historical zero-block rows. Seed batches are bounded rather than charging an unrelated all-at-once fixture admission against the unchanged lifetime bound. Complete durable membership, caller markers, tokens, range, anchor and retry remain asserted.

The added digest transport serializes one demanded row at a time without retaining delivered request rows. It compares hash and byte length with the original array oracle, cancels after exactly three rows, retries without capture, and covers both strategies at 512/8192 rows and with the original nine-MiB middle row. The single oversized row remains separate from the ordinary-row 8 MiB bound.

The added media suite uses real admitted references, real `HistoryMediaOwnership`, native primary/mirror readers and rejected media finalization. It requires reservations after cancellation and rejection, complete public/durable rollback, identical request retry, unchanged tokens/offset/range/anchor and released reservations on success. A physical trailer failure poisons the writer and cannot support same-writer retry. That failed fixture attempt is retained, not treated as a production regression. A pre-cancellation finalization pause also blocked rollback and was stopped by its exact recorded child PID; its incomplete result remains retained. The final fault arms only after cancellation completes.

The first media request initially used the hardcoded middle-out prompt; first-time system-prompt initialization created the prompt file, so later attempts used different bytes. The fixture now initializes the system instruction before its first request, following the existing lifecycle fixture. Passing and failing inputs were compared rather than relaxing request equality or adding retries. The intermediate three-pass/one-fail run remains retained.

## Verification and census acceptance

The original supervisor `95088` completed all four target matrices and ten scoped product gates. It then stopped at a related Bun loader failure after ten related suites passed. Only the verified ignored `packages/test-utils/dist` obstruction was moved intact to its unique held path, with all 87 file hashes and the directory inode checked. Completed matching results were reused. Continuation scripts run only missing related cases, remaining old comparisons, retaining controls and supplemental proof, serially.

The related `packages/core/src/services/history/addbatch-value-serialization.test.ts` constructs an old recorder under journal selection and fails before its behavior assertions. It is unchanged and remains red. Its old comparison and existing native cyclic-codec/checkpoint tests are separate evidence; they do not close that exact addBatch fixture gap. This supplemental core file is outside the 806-path inventory.

The census runner accepts only the two final journal target batch names. New labels require exact path/classname/name and source hash. Source-mismatched or missing case coverage remains unverified rather than turning an earlier missing result green. An explicitly old request case requires a distinct completed, source-matched journal counterpart in an allowed positive batch, with consistent XML and raw summary. Missing, failed, incomplete, wrong-backend, wrong-source, wrong-name and self-referential counterparts cannot satisfy it. Supplemental counterpart evidence does not enlarge the inventory.

Ten final census API tests cover these rules alongside the existing reconciliation contracts. Deliberately removing the request source guard or counterpart requirement rejects. Both mutations restore byte-identically with `cmp`. Strict census types, explicit no-ignore zero-warning lint and formatting remain enforced. The original seven census tests and all their assertions remain.

Final counts, effective source hashes, exact PIDs/cases, gate results, restored controls and frozen ledger checksums are recorded in `W22-REQUEST-PUBLICATION-PROOF.json` after the serial lane completes. `W22-STATUS.md` and `W22-REMAINING-FAMILIES.tsv` give the accepted partition and exact remaining names. These are cumulative per-file source boundaries, not a final-source whole-package green or fully native-tested claim.

W22/W23-W26, pending classification and scratch removal remain open; the old default stays. Review skipped per Andrew 2026-10-09. No OCR, cleanup/deletion, `.llxprt/` edit/staging, raw recovery bulk staging, assertion/bound/timeout weakening, push or merge. Unrelated dirty memory and recovery artifacts remain untouched.
