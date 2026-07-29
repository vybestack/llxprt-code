# Issue #2253 — Real Runtime Token-Estimator Divergence

## Authority and problem statement

Issue #2253 has a placeholder body. Parent issue #2249 Phase 0b requires measured current-versus-adaptive token-estimator accuracy per target, an 80/20 validation split, and a gate requiring the fitted estimator to be no worse than current.

An initial fresh-process probe produced `estimated_tokens=8` versus 18,166 provider prompt tokens. Source tracing showed these cover different objects: the estimate covers pending content while provider usage covers the complete finalized request. That cold-start accounting defect is tracked separately by bug #2817.

## Decision summary

- Measure the actual runtime estimator against provider tokenization of equivalent incremental controlled content.
- Use the smallest request in each category as a matched control. Subtract it from larger same-category requests so fixed system, tool, framing, and first-request accounting costs are controlled for under validated fixed-component invariants.
- Fit a bounded adaptive correction on size-2 through size-4 deltas and evaluate size-5 held-out deltas.
- Keep OpenAI Responses/Codex finalized-request dump parity for reproducibility.
- Commit only sanitized numeric observations, hashes, and reports. Raw requests and model output remain local.

## Acceptance matrix

| ID  | Accepted behavior                                                                   | Evidence                              |
| --- | ----------------------------------------------------------------------------------- | ------------------------------------- |
| A1  | Preserve existing pending-only `estimated_tokens`; no production accounting change. | Logger behavior + collector fixture.  |
| A2  | Responses/Codex dump finalized request at pre-HTTP/WebSocket seam.                  | Executor tests cover both transports. |
| A3  | Collector pairs one request, one usage row, one JSON result. Mismatches reject.     | Temp-file behavioral tests.           |
| A4  | Fixed corpus: 5 categories × 5 sizes. IDs 1–20 train, 21–25 held out.               | Corpus test.                          |
| A5  | Per target/category, size 1 is control. Deltas for sizes 2–5; nonpositive rejects.  | Differential report test.             |
| A6  | 15 train deltas fit OLS; 5 held-out deltas isolated.                                | Synthetic test.                       |
| A7  | Held-out reports current/fitted MAPE/RMSE, signed error, deltas.                    | Report test + committed report.       |
| A8  | Gate passes only when fitted MAPE and RMSE both ≤ current.                          | Gate tests.                           |
| A9  | Exactly 25 observations per target, exact metadata/provenance.                      | 125-row JSONL + validation.           |
| A10 | Report identifies actual runtime estimator per model.                               | Source tracing + report.              |
| A11 | Fixed-component caveats explicit; no raw content committed.                         | Hash/count analysis + privacy scan.   |
| A12 | Gates, reviews, scope/privacy audit pass without suppressions.                      | Verification ledger.                  |

## Metrics

`MAPE = mean(abs(ŷ - y) / y) * 100`; `RMSE = sqrt(mean((ŷ - y)^2))`. Rows with nonfinite or nonpositive deltas reject. Ground truth is `actual_prompt_tokens` (not cache-subtracted).

## Explicit non-goals

- No first-request accounting fix (#2817), no adaptive-estimator activation.
- No provider tokenizer redesign, alias abstraction, or estimator-label cleanup.
- No claim that the earlier cold-start full-total comparison measured tokenizer accuracy.
- No raw prompt/system/tool/dump/response/credential/cache in Git.
- No generic benchmark subsystem, public API, dependency, workflow, quality-tool, memory, lint, complexity, or CI policy change.

## Measurement methodology

Target matrix: `opusthinking-claudecode`/`claude-opus-5`/Anthropic, `gpt56solhigh`/`gpt-5.6-sol`/Responses, z.ai/`glm-5.2`/Anthropic, Ollama/`glm-5.2`/Chat, Ollama/`minimax-m3`/Chat.

Within each target/category: `provider_delta = treatment.actual - control.actual`, `estimator_delta = treatment.estimated - control.estimated`. Fifteen size-2–4 deltas train OLS; five size-5 deltas held out. Train and held-out deltas share each category's size-1 control. Fixed components are controlled for under validated fixed-component invariants.

## Expected path and scope ledger

| Path                                                                        | Purpose                                    |
| --------------------------------------------------------------------------- | ------------------------------------------ |
| This plan                                                                   | Acceptance, methodology, scope, evidence.  |
| `packages/providers/src/openai-responses/openAIResponsesExecutor.ts` + test | Dump parity.                               |
| `scripts/token-divergence*.ts`                                              | Corpus, collector, parsing, stats, report. |
| `scripts/tests/token-divergence.test.ts`                                    | Behavioral tests.                          |
| `tsconfig.scripts.json`                                                     | Script/test includes.                      |
| `research/issue2253/{live-results.jsonl,analysis.json,report.md}`           | Sanitized artifacts.                       |

Hard cap: 20 paths / 3,000 net lines.

| Scope entry                | Classification | Status      |
| -------------------------- | -------------- | ----------- |
| Incremental measurement    | Blocker-Fix    | Tested      |
| Responses dump parity      | In-scope-Fix   | Tested      |
| 5×25 observations          | In scope       | Collected   |
| Differential report + gate | Blocker-Fix    | Implemented |
| First-request context      | Defer          | Bug #2817   |
| Cold-start totals as error | Reject         | Removed     |
| Raw content in Git         | Reject         | Excluded    |

## Verification

- `npm run test`, `npm run lint`, `npm run typecheck`, `npm run format`, `npm run build`.
- `bun scripts/start.ts --profile-load ollamakimi "write me a haiku and nothing else"`.
- Scope audit, ancestry/conflict checks, exact-head green CI, resolved review threads.
