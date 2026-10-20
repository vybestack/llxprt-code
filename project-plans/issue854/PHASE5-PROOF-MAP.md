# Phase 5 first-slice proof map

Implementation: `f2175804658f1e02a1b573e905df14be5b114bab`, from `f99a23fc9e58a6b04b3d876d67497dd5e0828387`. This is production source-fact wiring and a partial orphan-only stream, not phase 5 completion. Field-by-field limits and remaining W26/W23 dependencies are in [PHASE5-STATUS.md](PHASE5-STATUS.md). Machine-readable source, case, gate, control and process receipts are in [PHASE5-PROOF.json](PHASE5-PROOF.json).

## Accepted boundary

Twenty-one isolated serial Bun files pass **172 tests and 31,285 assertions**, with zero failures/skips. The final receipt for `journal-orphan-units.test.ts` supersedes its earlier input-conservation test receipt; all other accepted receipts are the final serial run. Logs/JUnit live under `tmp/854-notes/p5/facts-run-a/accept-final-*` and `accept-supplement-01.*`. The proof validates log hashes, JUnit failures/skips, current test hashes and all 24 committed implementation paths. The old normalizer's two source files remain byte-identical to the starting commit.

| Behavior | Accepted tests and classification |
| --- | --- |
| Real native source facts | `journal-normalization-facts.test.ts`: empty tuples; split call/response coordinates on append, fill and a real density rebuild; C versus Ca; human-row result; highest-score duplicate; excluded-row rejection; normalized capability refusal; owner/content conservation. These use JournalSession production dependencies. |
| Indexed orphan units | `journal-orphan-units.test.ts`: five literal differential cases, same-pin behavior after a later response append, R7 stripping/input conservation and explicit real-response refusal. The cross-speaker case creates its orphan at later Ca and attaches it to earlier C. |
| Immutable units | `normalization-unit-oracle.test.ts`: all 5000 old reference cases equal frozen input/output/count/pending records. The indexed API matches 1436 admitted response-free/no-tail cases. The other 3564 cases are not indexed coverage. Twelve structural families vary data and placement; this is not 5000 independently randomized structures. |
| No operation files/cache bound | `journal-orphan-resources.test.ts`: 4000 native IDs, 8000 emitted units consumed without collecting output; zero filesystem creation attempts; fixed 65,536-byte caches. The same observer detects a positive creation. Not generator heap-flatness. |
| Native regressions | Original row codec/cyclic, session/row-read, repair, mutations, detached owner/media, journal commit/pins/pop and Mistral version-copy files pass. Existing old-normalizer curated stream/structure contracts also pass. |
| Library normalized facts | Existing `idFactIndex`, `idFactMistral` and `idFactBatch.spill` tests pass with explicitly normalized dependencies. Their normalized mappings/collision/ordinal proof is not production normalized-unit coverage. |

The frozen fixture contains 5000 lines and has SHA-256 `4699c502e99b67ea231f47884bdc2109400c4138803a16a3e5ac7418e0fa8d9e`. Its exclusive-create generator refuses replacement. No existing wire corpus was regenerated.

## RED and rejecting controls

`root-red-corrected.log` records the source-fact failures against unchanged production after correcting an initial test label assumption. The initial root logs are retained. Later capability/unit/pin RED receipts remain beside them. The original strict row-codec expectation omitted the newly preserved empty tuple; the final expectation now checks that tuple rather than weakening the array assertion. Launcher PATH, unsupported target-library `.at`, lint and audit authoring failures remain separate from behavioral controls.

Final-source controls ran serially under driver **93996**, with children **93997, 94008, 94016 and 94067**. `control-final/controls.json` binds their exact mutations, test commands, exits and restored hashes; all four shell `cmp` checks returned zero.

| Mutation | Rejection |
| --- | --- |
| Require Ca to be the current part | Cross-speaker unit hash/count fails instead of dropping the synthetic response unnoticed. |
| Omit empty call tuple | Real ROW tuple shape assertion fails. |
| Remove query-cache eviction | Cache charges 579844 bytes against the unchanged 65536-byte cap. |
| Create a per-operation file | Creation observer reports one instead of zero. |

All four controls exit one at the intended behavior/resource assertion and restore byte-identically. No thresholds, timeouts, assertions, compiler/lint rules or scanner exemptions were weakened. The final acceptance follows restoration. Original output sources and immutable fixture also match after the controls.

## Gates and limitations

Six scoped gates pass: core declaration-only build, strict test-inclusive core noemit types, zero-warning touched ESLint, Prettier, affected-shard graph and AST audit. The declaration build uses the normal local executable PATH; no generated obstruction move was needed. Existing 293 untracked agent declarations remain unstaged. Audit reports zero touched findings after replacing a digest-based conservation comparison with a separate structured input snapshot. Graph validation is not affected-shard execution; no whole-repository test/build claim is made.

`PHASE5-PROOF.json` verifies **79 recorded acceptance/control/gate PIDs absent**. These are the enumerated completed lanes, not a claim about unrelated machine processes. Final implementation source hashes equal both the worktree and the implementation commit. Raw receipts are not staged.

Still required: R1 reconstruction; empty-response continuity; full response/media R2/R4/R5/R6; normalized occurrence lists and contribution recomputation; tail/pending and unit random access/counts; full Stage A and stage-key claims; 10k/100k/1M generator heap-flatness with per-ID retention control; typed format settings/every-field keys; provider filters/spool deletion and zero-decode planning. Ordinary native `mappedRef` and derived entry contribution fields are not filled. W26, W23 and W25/default remain open. Review skipped per Andrew 2026-10-09. No cleanup, .llxprt change/staging, raw recovery/declaration bulk staging, OCR, push or merge.
