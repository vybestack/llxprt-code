# Issue #2253 — Runtime Token Estimator Divergence

Corpus version: 2026-07-28-v1
Analysis method: within-category incremental

## Per-target results

### opusthinking (claude-opus-5)
- Protocol: anthropic-messages
- Endpoint host: api.anthropic.com
- Runtime estimator: AnthropicTokenizer character heuristic
- Samples: 5 controls, 15 train deltas, 5 held-out deltas
- OLS fit: actualDelta = 1.405828 * estimatedDelta + 54.32
- Current mean signed error: -41.35%
- Delta from current: fitted MAPE -26.09 points; fitted RMSE -196.35 tokens
- Cached-token summary: 0 tokens across 0 rows
- Rejected attempts: 1
- Provenance: commit 2bec7cb6a466; projection responses-fields-v1; corpus 2026-07-28-v1

| Predictor | Held-out MAPE (%) | Held-out RMSE |
| --- | --- | --- |
| current runtime estimator | 41.35 | 307.61 |
| fitted correction | 15.25 | 111.26 |

- Gate: PASS — Fitted no worse (MAPE 15.25, RMSE 111.26)

#### Held-out errors

| ID | Category | Provider delta | Current delta | Current error | Current error (%) | Fitted delta | Fitted error |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 21 | prose | 720 | 549 | -171.00 | -23.75 | 826.12 | +106.12 |
| 22 | code | 848 | 558 | -290.00 | -34.20 | 838.77 | -9.23 |
| 23 | json | 940 | 505 | -435.00 | -46.28 | 764.26 | -175.74 |
| 24 | unicode | 360 | 130 | -230.00 | -63.89 | 237.08 | -122.92 |
| 25 | mixed | 888 | 545 | -343.00 | -38.63 | 820.50 | -67.50 |

### gpt56solhigh (gpt-5.6-sol)
- Protocol: openai-responses
- Endpoint host: chatgpt.com
- Runtime estimator: OpenAITokenizer o200k tiktoken fallback
- Samples: 5 controls, 15 train deltas, 5 held-out deltas
- OLS fit: actualDelta = 1.000000 * estimatedDelta + 0.00
- Current mean signed error: +0.00%
- Delta from current: fitted MAPE +0.00 points; fitted RMSE +0.00 tokens
- Cached-token summary: 0 tokens across 0 rows
- Rejected attempts: 1
- Provenance: commit 2bec7cb6a466; projection responses-fields-v1; corpus 2026-07-28-v1

| Predictor | Held-out MAPE (%) | Held-out RMSE |
| --- | --- | --- |
| current runtime estimator | 0.00 | 0.00 |
| fitted correction | 0.00 | 0.00 |

- Gate: PASS — Fitted no worse (MAPE 0.00, RMSE 0.00)

#### Held-out errors

| ID | Category | Provider delta | Current delta | Current error | Current error (%) | Fitted delta | Fitted error |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 21 | prose | 396 | 396 | +0.00 | +0.00 | 396.00 | +0.00 |
| 22 | code | 560 | 560 | +0.00 | +0.00 | 560.00 | +0.00 |
| 23 | json | 600 | 600 | +0.00 | +0.00 | 600.00 | +0.00 |
| 24 | unicode | 216 | 216 | +0.00 | +0.00 | 216.00 | +0.00 |
| 25 | mixed | 612 | 612 | +0.00 | +0.00 | 612.00 | +0.00 |

### zai (glm-5.2)
- Protocol: anthropic-messages
- Endpoint host: api.z.ai
- Runtime estimator: HistoryService generic max(words*1.3, chars/4)
- Samples: 5 controls, 15 train deltas, 5 held-out deltas
- OLS fit: actualDelta = 0.925992 * estimatedDelta + 44.07
- Current mean signed error: -12.53%
- Delta from current: fitted MAPE -3.77 points; fitted RMSE -9.43 tokens
- Cached-token summary: 0 tokens across 0 rows
- Rejected attempts: 1
- Provenance: commit 2bec7cb6a466; projection responses-fields-v1; corpus 2026-07-28-v1

| Predictor | Held-out MAPE (%) | Held-out RMSE |
| --- | --- | --- |
| current runtime estimator | 27.98 | 121.20 |
| fitted correction | 24.22 | 111.77 |

- Gate: PASS — Fitted no worse (MAPE 24.22, RMSE 111.77)

#### Held-out errors

| ID | Category | Provider delta | Current delta | Current error | Current error (%) | Fitted delta | Fitted error |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 21 | prose | 396 | 549 | +153.00 | +38.64 | 552.44 | +156.44 |
| 22 | code | 560 | 488 | -72.00 | -12.86 | 495.95 | -64.05 |
| 23 | json | 580 | 441 | -139.00 | -23.97 | 452.43 | -127.57 |
| 24 | unicode | 232 | 130 | -102.00 | -43.97 | 164.45 | -67.55 |
| 25 | mixed | 600 | 477 | -123.00 | -20.50 | 485.77 | -114.23 |

### ollamaglm51 (glm-5.2)
- Protocol: openai-chat
- Endpoint host: ollama.com
- Runtime estimator: HistoryService generic max(words*1.3, chars/4)
- Samples: 5 controls, 15 train deltas, 5 held-out deltas
- OLS fit: actualDelta = 0.925992 * estimatedDelta + 44.07
- Current mean signed error: -12.53%
- Delta from current: fitted MAPE -3.77 points; fitted RMSE -9.43 tokens
- Cached-token summary: 0 tokens across 0 rows
- Rejected attempts: 1
- Provenance: commit 2bec7cb6a466; projection responses-fields-v1; corpus 2026-07-28-v1

| Predictor | Held-out MAPE (%) | Held-out RMSE |
| --- | --- | --- |
| current runtime estimator | 27.98 | 121.20 |
| fitted correction | 24.22 | 111.77 |

- Gate: PASS — Fitted no worse (MAPE 24.22, RMSE 111.77)

#### Held-out errors

| ID | Category | Provider delta | Current delta | Current error | Current error (%) | Fitted delta | Fitted error |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 21 | prose | 396 | 549 | +153.00 | +38.64 | 552.44 | +156.44 |
| 22 | code | 560 | 488 | -72.00 | -12.86 | 495.95 | -64.05 |
| 23 | json | 580 | 441 | -139.00 | -23.97 | 452.43 | -127.57 |
| 24 | unicode | 232 | 130 | -102.00 | -43.97 | 164.45 | -67.55 |
| 25 | mixed | 600 | 477 | -123.00 | -20.50 | 485.77 | -114.23 |

### ollamakimi (minimax-m3)
- Protocol: openai-chat
- Endpoint host: ollama.com
- Runtime estimator: HistoryService generic max(words*1.3, chars/4)
- Samples: 5 controls, 15 train deltas, 5 held-out deltas
- OLS fit: actualDelta = 0.895809 * estimatedDelta + 50.75
- Current mean signed error: -13.04%
- Delta from current: fitted MAPE -3.44 points; fitted RMSE -9.68 tokens
- Cached-token summary: 0 tokens across 0 rows
- Rejected attempts: 7
- Provenance: commit 2bec7cb6a466; projection responses-fields-v1; corpus 2026-07-28-v1

| Predictor | Held-out MAPE (%) | Held-out RMSE |
| --- | --- | --- |
| current runtime estimator | 28.49 | 121.46 |
| fitted correction | 25.06 | 111.78 |

- Gate: PASS — Fitted no worse (MAPE 25.06, RMSE 111.78)

#### Held-out errors

| ID | Category | Provider delta | Current delta | Current error | Current error (%) | Fitted delta | Fitted error |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 21 | prose | 396 | 549 | +153.00 | +38.64 | 542.55 | +146.55 |
| 22 | code | 560 | 488 | -72.00 | -12.86 | 487.91 | -72.09 |
| 23 | json | 560 | 441 | -119.00 | -21.25 | 445.80 | -114.20 |
| 24 | unicode | 256 | 130 | -126.00 | -49.22 | 167.21 | -88.79 |
| 25 | mixed | 600 | 477 | -123.00 | -20.50 | 478.05 | -121.95 |

## Methodology

For each target and content category, the smallest observation is the control. The analysis subtracts that control from each larger observation, comparing the incremental llxprt pending-content estimate with the incremental provider prompt/input usage. This within-category incremental subtraction controls for the fixed first-request system/tool/request accounting gap under validated fixed-component invariants tracked separately in issue 2817.

Fifteen size-2 through size-4 deltas train OLS actualDelta = m * estimatedDelta + b. Five size-5 deltas are held out. The gate passes only when fitted held-out MAPE and RMSE are both no worse than the current runtime estimator. Train and held-out deltas share each category's size-1 control.

## Validity caveats

- Tool hashes were stable for every target. Projected request length after removing the controlled prompt was stable, except a two-character variation for one Ollama GLM run.
- System payload hashes changed for four targets because each fresh CLI process included dynamic context, but system payload character counts and local o200k token counts were invariant within each target. Provider totals progressed deterministically with corpus size.
- These results measure incremental estimator behavior, not first-turn full-request accounting, context-window synchronization, or TPM.
- Cached tokens are reported but are not subtracted from provider ground truth.
- Raw request dumps, prompts, model responses, credentials, and headers are excluded from committed results.
