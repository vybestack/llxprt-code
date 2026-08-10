# Issue #2254 — Evidence-gated bounded adaptive reconciliation: no-go report

## Decision

**No scoped key passes the preregistered B1–B3 evidence gate. No runtime
adaptive subsystem, decorator, schema, storage, shadow-correlation seam, or
public abstraction is added. The six registered immutable estimator paths
remain the only runtime paths. This is the accepted no-go outcome.**

## Preregistered evidence gate

An adaptive decorator may be added for a canonical key only if **all three**
conditions hold:

- **B1 — Canonical evidence key.** Every observation belongs to exactly one
  immutable runtime identity: canonical model family and model, active
  provider, wire protocol, immutable estimator version, tokenizer/base-counter
  asset revision, and finalized request projection revision. Observations from
  different models, providers, protocols, estimator versions, assets, or
  projection revisions are never pooled.
- **B2 — Valid evidence.** A candidate key needs at least 100 valid
  provider-grounded observations with a preregistered independent holdout. The
  target is the provider's complete `promptTokens` including cache-read and
  cache-creation prompt tokens. Evidence used to fit the immutable estimator is
  not independent post-migration residual evidence for an adaptive overlay.
  Pre-migration observations cannot be relabeled as observations of a later
  estimator version or projection revision.
- **B3 — Deterministic activation decision.** For one eligible key, compare the
  registered immutable estimator with the candidate correction on the untouched
  holdout. Activation requires both:
  1. candidate held-out MAPE improves by at least 10% relative to the immutable
     baseline; and
  2. candidate p95 underestimation is no worse than the immutable baseline.
  A zero-MAPE baseline cannot pass by claiming a relative improvement. The
  decision is per key; no global/default/profile precedence and no
  cross-model learning.

A key that fails any of B1, B2, or B3 is unadjusted. GPT-5.6 is explicitly
unadjusted absent new passing independent evidence (B6).

## Evidence inventory

### Source artifacts inspected

| Artifact | Location | Provenance |
| --- | --- | --- |
| Issue #2253 live results | `research/issue2253/live-results.jsonl` | 125 observations, corpus `2026-07-28-v1`, commit `2bec7cb6a466`, projection `responses-fields-v1` |
| Issue #2253 analysis | `research/issue2253/analysis.json` | Within-category incremental OLS, pre-migration |
| Issue #2253 report | `research/issue2253/report.md` | Fitted-vs-current gate (not the #2254 activation gate) |
| Issue #2835 live results | `research/issue2835/claude5-live-results.jsonl` | 84 observations, corpus `2026-08-04-v1`, commit `8f5201115c75`, projection revision 3 |
| Issue #2835 calibration | `research/issue2835/claude5-calibration.json` | Fitted coefficients and held-out metrics |
| Issue #2835 report | `research/issue2835/report.md` | Claude Opus 5 and Fable 5 calibration |
| Claude Opus 5 fixture | `packages/providers/src/tokenizers/claude/fixtures/claude-opus-5-provider-usage-v1.json` | 42 observations (29 train, 13 held-out) |
| Claude Fable 5 fixture | `packages/providers/src/tokenizers/claude/fixtures/claude-fable-5-provider-usage-v1.json` | 42 observations (29 train, 13 held-out) |
| GPT-5.6 parity fixture | `packages/providers/src/tokenizers/fixtures/gpt56-provider-usage-v1.json` | 5 observations (increment deltas only) |
| Kimi K3 manifest | `packages/providers/src/tokenizers/official/assets/kimi-k3/manifest.json` | Pinned asset, SHA-256 `b6c497a7469b33ced9c38afb1ad6e47f03f5e5dc05f15930799210ec050c5103` |
| GLM 5.2 manifest | `packages/providers/src/tokenizers/official/assets/glm-5.2/manifest.json` | Pinned asset, SHA-256 `d2a312b6d9fa24fc27bdea3387e65477c427214e2fb2372e5f3ae980ffaa3e1d` |
| MiniMax M3 manifest | `packages/providers/src/tokenizers/official/assets/minimax-m3/manifest.json` | Pinned asset, SHA-256 `9b423908eab5445f88a72b26a283d848da80884fde9e0b8e5e7a4fe495313f1e` |
| Estimator registry | `packages/providers/src/tokenizers/ModelPromptEstimatorRegistry.ts` | GPT-5.6 registration |
| Claude registrations | `packages/providers/src/tokenizers/claude/claudePromptEstimator.ts` + `claudeCalibrationAssets.ts` | Opus 5 and Fable 5 calibrations |
| Official registrations | `packages/providers/src/tokenizers/official/officialPromptEstimators.ts` | Kimi K3, GLM 5.2, MiniMax M3 |
| Composition root | `packages/providers/src/composition/providerManagerInstance.ts` | `createRuntimeTokenizerFactory` composes all registrations |
| GPT-5.6 estimator | `packages/providers/src/tokenizers/Gpt56O200kPromptEstimator.ts` | `estimatorVersion: 'gpt-5.6-o200k-v1'` |
| Claude calibration | `packages/providers/src/tokenizers/claude/claudeCalibration.ts` | Activation gate re-verified at module load |
| Base counter | `packages/providers/src/tokenizers/o200kBaseCounter.ts` | `O200K_BASE_ASSET_REVISION = o200k_base:446a9538cb6c348e3516120d7c08b09f57c36495e2acfffe59a5bf8b0cfb1a2d:@dqbd/tiktoken@1.0.22` |
| Projection revision | `packages/providers/src/runtime/promptEnvelopeProjections.ts` | `PROJECTION_REVISION = 3` |

### Current registered immutable estimators (six families)

| Family | Estimator version | Asset revision | Projection revision | Method |
| --- | --- | --- | --- | --- |
| `openai-gpt-5.6` | `gpt-5.6-o200k-v1` | `o200k_base:446a9538cb6c348e3516120d7c08b09f57c36495e2acfffe59a5bf8b0cfb1a2d:@dqbd/tiktoken@1.0.22` | 3 | exact |
| `anthropic-claude-opus-5` | `claude-opus-5-o200k-calibrated-2026-08-04-v1` | `o200k_base:446a9538cb6c348e3516120d7c08b09f57c36495e2acfffe59a5bf8b0cfb1a2d:@dqbd/tiktoken@1.0.22+calibration:claude-opus-5-o200k-calibrated-2026-08-04-v1` | 3 | calibrated |
| `anthropic-claude-fable-5` | `claude-fable-5-o200k-calibrated-2026-08-04-v1` | `o200k_base:446a9538cb6c348e3516120d7c08b09f57c36495e2acfffe59a5bf8b0cfb1a2d:@dqbd/tiktoken@1.0.22+calibration:claude-fable-5-o200k-calibrated-2026-08-04-v1` | 3 | calibrated |
| `moonshot-kimi-k3` | `kimi-k3-tiktoken-v1` | `kimi-k3:b6c497a7469b33ced9c38afb1ad6e47f03f5e5dc05f15930799210ec050c5103:huggingface.co/moonshotai/Kimi-K3@9f62e4e9fffbd0a83ddd60e1c209d828994b3569` | 3 | exact |
| `zai-glm-5.2` | `glm-5.2-tiktoken-v1` | `glm-5.2:d2a312b6d9fa24fc27bdea3387e65477c427214e2fb2372e5f3ae980ffaa3e1d:huggingface.co/zai-org/GLM-5.2@b4734de4facf877f85769a911abafc5283eab3d9` | 3 | exact |
| `minimax-m3` | `minimax-m3-tiktoken-v1` | `minimax-m3:9b423908eab5445f88a72b26a283d848da80884fde9e0b8e5e7a4fe495313f1e:huggingface.co/MiniMaxAI/MiniMax-M3@f0e1c1e04d40177e4673a22097036854f536e9c0` | 3 | exact |

## Per-key evidence evaluation

The gate is evaluated per exact canonical key: (model family, model,
active provider, protocol, estimator version, asset revision, projection
revision). Total historical observations are distinguished from qualifying
post-migration residual observations.

Evidence schema and provenance (fail-closed). The canonical runtime evidence
key requires `activeProvider` as a committed field. The #2253 sanitized rows
store `target`, `profile`, `endpointHost`, `model`, and `protocol`, but **not
`activeProvider`**. The collection manifest `scripts/token-divergence-collect.ts`
(`TARGETS`) likewise records `profile`/`endpoint`/`model`/`protocol` and does
not commit an `activeProvider`. Therefore the #2253 rows **cannot satisfy B1**
for any canonical runtime evidence key: an observation whose identity is
missing the active-provider field has no committed evidence key, and B1 fails
closed. `activeProvider` is **not** inferred from profile names, endpoint hosts,
current local or global profile files, or task instructions — profile names are
not identity, and malformed or incomplete evidence fails closed. In the exact-key
display below, the four #2253-only observation sets (GPT-5.6, GLM z.ai, GLM
Ollama, MiniMax) show `activeProvider missing in evidence`. The headings may
informally describe the endpoint/target (e.g. "z.ai", "Ollama") believed to have
produced the observations, but that belief is not part of the committed
canonical evidence key and cannot be used to construct one. By contrast, the
#2835 Claude rows directly include `activeProvider: "claudecode"` in the
committed data, so the Claude keys have a complete evidence key field set.

### Key 1: GPT-5.6 (gpt-5.6-sol, openai-responses)

| Field | Value |
| --- | --- |
| Canonical model | `gpt-5.6-sol` |
| Active provider | **`activeProvider missing in evidence`** — the #2253 rows omit `activeProvider` |
| Protocol | `openai-responses` |
| Estimator version | `gpt-5.6-o200k-v1` |
| Asset revision | `o200k_base:446a9538cb6c348e3516120d7c08b09f57c36495e2acfffe59a5bf8b0cfb1a2d:@dqbd/tiktoken@1.0.22` |
| Projection revision | 3 (current) |
| Registered method | exact |
| Structural estimator identity (current) | The current immutable registration defines a structurally valid key family (`gpt-5.6-sol`, `gpt-5.6-o200k-v1`, projection revision 3), but its active-provider field is a registration/default, not a committed observation identity. |
| Issue #2253 observations | 25 total (20 train, 5 held-out), target `gpt56solhigh`, projection `responses-fields-v1` |
| Issue #2253 projection | `responses-fields-v1` — pre-migration, does not match current projection revision 3 |
| Issue #2253 estimator at time | OpenAITokenizer o200k tiktoken fallback (pre-registry) |
| Post-migration residual observations | 0 — the #2253 corpus predates the finalized projection and the current immutable estimator registration |
| GPT-5.6 parity fixture | 5 observations in `gpt56-provider-usage-v1.json` — these are matched-increment (control vs held-out delta) parity checks proving exactness of the projected-text increment, not residual-correction evidence |
| **B1** | FAIL — the #2253 rows omit `activeProvider`; the incomplete historical observation identity cannot be elevated to a committed canonical evidence key. Profile/target/endpoint mapping is not identity and fails closed. |
| **B2** | FAIL (independent) — 0 qualifying post-migration residual observations (well below 100). The #2253 corpus is pre-migration (`responses-fields-v1` ≠ projection revision 3). The parity fixture validated the immutable estimator's matched increments, not independent residual evidence. |
| **B3** | N/A — B1 and B2 fail. The matched-incremental parity shows zero error for the tested projection/content, but this is not a complete provider prompt-total zero-MAPE guarantee; with no qualifying evidence and no demonstrated residual, B3 is not reached. |
| **Decision** | **UNADJUSTED** — GPT-5.6 remains explicitly unadjusted (B6). |

### Key 2: Claude Opus 5 (claude-opus-5, claudecode, anthropic-messages)

| Field | Value |
| --- | --- |
| Canonical model | `claude-opus-5` |
| Active provider | `claudecode` (endpoint `api.anthropic.com`). The #2835 rows directly commit `activeProvider: "claudecode"`, so the evidence key is complete (not inferred or ambiguous). The calibration is registered for both `claudecode` and `anthropic` first-party providers (`CLAUDE_5_CALIBRATED_PROVIDERS`). |
| Protocol | `anthropic-messages` |
| Estimator version | `claude-opus-5-o200k-calibrated-2026-08-04-v1` |
| Asset revision | `o200k_base:446a9538cb6c348e3516120d7c08b09f57c36495e2acfffe59a5bf8b0cfb1a2d:@dqbd/tiktoken@1.0.22+calibration:claude-opus-5-o200k-calibrated-2026-08-04-v1` |
| Projection revision | 3 (current, matches corpus) |
| Registered method | calibrated |
| Issue #2835 observations | 42 total (29 train, 13 held-out), projection revision 3 |
| Issue #2253 observations | 25 total, target `opusthinking`, projection `responses-fields-v1` — pre-migration, different projection revision |
| Post-migration residual observations | 0 — the #2835 corpus was used to fit the immutable calibrated estimator (29 training rows) and gate it (13 held-out rows). Evidence used to fit the immutable estimator is not independent post-migration residual evidence for an adaptive overlay (B2). The #2253 corpus is pre-migration and cannot be rebound. |
| **B1** | PASS — exact key is well-defined |
| **B2** | FAIL — 0 qualifying post-migration residual observations. The #2835 corpus was consumed by the immutable estimator's own fitting and gating. No independent post-migration residual corpus exists. Well below 100. |
| **B3** | N/A — B2 fails |
| **Decision** | **UNADJUSTED** |

### Key 3: Claude Fable 5 (claude-fable-5, claudecode, anthropic-messages)

| Field | Value |
| --- | --- |
| Canonical model | `claude-fable-5` |
| Active provider | `claudecode` (endpoint `api.anthropic.com`). The #2835 rows directly commit `activeProvider: "claudecode"`, so the evidence key is complete (not inferred or ambiguous). The calibration is registered for both `claudecode` and `anthropic` first-party providers (`CLAUDE_5_CALIBRATED_PROVIDERS`). |
| Protocol | `anthropic-messages` |
| Estimator version | `claude-fable-5-o200k-calibrated-2026-08-04-v1` |
| Asset revision | `o200k_base:446a9538cb6c348e3516120d7c08b09f57c36495e2acfffe59a5bf8b0cfb1a2d:@dqbd/tiktoken@1.0.22+calibration:claude-fable-5-o200k-calibrated-2026-08-04-v1` |
| Projection revision | 3 (current, matches corpus) |
| Registered method | calibrated |
| Issue #2835 observations | 42 total (29 train, 13 held-out), projection revision 3 |
| Post-migration residual observations | 0 — same reasoning as Opus 5: the #2835 corpus fitted and gated the immutable estimator. No independent residual corpus exists. Opus 5 and Fable 5 are independent and cannot be combined. |
| **B1** | PASS — exact key is well-defined |
| **B2** | FAIL — 0 qualifying post-migration residual observations. Well below 100. |
| **B3** | N/A — B2 fails |
| **Decision** | **UNADJUSTED** |

### Key 4: Kimi K3 (kimi-k3, openai-chat) — no matching observation set

| Field | Value |
| --- | --- |
| Canonical model | `kimi-k3` |
| Active provider | **No observed canonical provider.** No observation set matches `kimi-k3`; the only #2253 OpenAI-chat-over-Ollama target (`ollamakimi`) recorded model `minimax-m3`, not `kimi-k3`. A provider is therefore not assigned (no provider is fabricated). |
| Protocol | `openai-chat` |
| Estimator version | `kimi-k3-tiktoken-v1` |
| Asset revision | `kimi-k3:b6c497a7469b33ced9c38afb1ad6e47f03f5e5dc05f15930799210ec050c5103:huggingface.co/moonshotai/Kimi-K3@9f62e4e9fffbd0a83ddd60e1c209d828994b3569` |
| Projection revision | 3 (current) |
| Registered method | exact |
| Issue #2253 observations | 0 matching — the `ollamakimi` target recorded model `minimax-m3`, not `kimi-k3`; its projection `responses-fields-v1` is also pre-migration |
| Post-migration residual observations | 0 — no corpus matches the exact key (kimi-k3, openai-chat, `kimi-k3-tiktoken-v1`, projection revision 3). No observed fully keyed evidence set exists. |
| **B1** | NOT EVALUABLE for an observation key — the immutable estimator registration defines a structurally valid hypothetical key (kimi-k3, openai-chat, `kimi-k3-tiktoken-v1`, projection revision 3), but no observation set matches it, so no observed canonical provider key and no pooled observation identity exist. |
| **B2** | FAIL — 0 qualifying post-migration residual observations. Well below 100. |
| **B3** | N/A — B2 fails. The estimator is exact for counting finalized projected text with the pinned BPE codec, but server-side chat-template overhead is absent from the projection, so a provider framing residual is possible but unmeasured. No relative-improvement comparison is performed. |
| **Decision** | **UNADJUSTED** |

### Key 5: GLM 5.2 — z.ai (glm-5.2, anthropic-messages)

| Field | Value |
| --- | --- |
| Canonical model | `glm-5.2` |
| Active provider | **`activeProvider missing in evidence`** — the #2253 rows omit `activeProvider` |
| Protocol | `anthropic-messages` |
| Estimator version | `glm-5.2-tiktoken-v1` |
| Asset revision | `glm-5.2:d2a312b6d9fa24fc27bdea3387e65477c427214e2fb2372e5f3ae980ffaa3e1d:huggingface.co/zai-org/GLM-5.2@b4734de4facf877f85769a911abafc5283eab3d9` |
| Projection revision | 3 (current) |
| Registered method | exact |
| Structural estimator identity (current) | The current immutable registration defines a structurally valid key family (`glm-5.2`, `glm-5.2-tiktoken-v1`, projection revision 3), but its active-provider field is a registration/default, not a committed observation identity. The `zai` target (endpoint `api.z.ai`) is the deployment believed to have produced the observations, but that belief is not part of the committed evidence key. |
| Issue #2253 observations | 25 total (target `zai`), projection `responses-fields-v1` — pre-migration |
| Post-migration residual observations | 0 — the #2253 corpus predates the finalized projection and the current immutable estimator registration. The runtime estimator at collection time was `HistoryService generic max(words*1.3, chars/4)`, not the current official tokenizer. |
| **B1** | FAIL — the #2253 rows omit `activeProvider`; the incomplete historical observation identity cannot be elevated to a committed canonical evidence key. Profile/target/endpoint mapping is not identity and fails closed. |
| **B2** | FAIL (independent) — 0 qualifying post-migration residual observations. Well below 100. |
| **B3** | N/A — B1 and B2 fail. The estimator is exact for counting finalized projected text with the pinned BPE codec, but server-side chat-template overhead is absent from the projection, so a provider framing residual is possible but unmeasured. |
| **Decision** | **UNADJUSTED** |

### Key 6: GLM 5.2 — Ollama (glm-5.2, openai-chat)

| Field | Value |
| --- | --- |
| Canonical model | `glm-5.2` |
| Active provider | **`activeProvider missing in evidence`** — the #2253 rows omit `activeProvider` |
| Protocol | `openai-chat` |
| Estimator version | `glm-5.2-tiktoken-v1` |
| Asset revision | `glm-5.2:d2a312b6d9fa24fc27bdea3387e65477c427214e2fb2372e5f3ae980ffaa3e1d:huggingface.co/zai-org/GLM-5.2@b4734de4facf877f85769a911abafc5283eab3d9` |
| Projection revision | 3 (current) |
| Registered method | exact |
| Structural estimator identity (current) | The current immutable registration defines a structurally valid key family (`glm-5.2`, `glm-5.2-tiktoken-v1`, projection revision 3), but its active-provider field is a registration/default, not a committed observation identity. The `ollamaglm51` target (endpoint `ollama.com`) is the deployment believed to have produced the observations, but that belief is not part of the committed evidence key. |
| Issue #2253 observations | 25 total (target `ollamaglm51`), projection `responses-fields-v1` — pre-migration |
| Post-migration residual observations | 0 — distinct key from z.ai (different protocol). Cannot be combined. Pre-migration. |
| **B1** | FAIL — the #2253 rows omit `activeProvider`; the incomplete historical observation identity cannot be elevated to a committed canonical evidence key. Profile/target/endpoint mapping is not identity and fails closed. |
| **B2** | FAIL (independent) — 0 qualifying post-migration residual observations. Well below 100. |
| **B3** | N/A — B1 and B2 fail |
| **Decision** | **UNADJUSTED** |

### Key 7: MiniMax M3 (minimax-m3, openai-chat)

| Field | Value |
| --- | --- |
| Canonical model | `minimax-m3` |
| Active provider | **`activeProvider missing in evidence`** — the #2253 rows omit `activeProvider` |
| Protocol | `openai-chat` |
| Estimator version | `minimax-m3-tiktoken-v1` |
| Asset revision | `minimax-m3:9b423908eab5445f88a72b26a283d848da80884fde9e0b8e5e7a4fe495313f1e:huggingface.co/MiniMaxAI/MiniMax-M3@f0e1c1e04d40177e4673a22097036854f536e9c0` |
| Projection revision | 3 (current) |
| Registered method | exact |
| Structural estimator identity (current) | The current immutable registration defines a structurally valid key family (`minimax-m3`, `minimax-m3-tiktoken-v1`, projection revision 3), but its active-provider field is a registration/default, not a committed observation identity. The `ollamakimi` target (endpoint `ollama.com`, model `minimax-m3`) is the deployment believed to have produced the observations, but that belief is not part of the committed evidence key. |
| Issue #2253 observations | 25 total (target `ollamakimi`, model `minimax-m3`), projection `responses-fields-v1` — pre-migration |
| Post-migration residual observations | 0 — the #2253 corpus predates the finalized projection and the current immutable estimator registration. The runtime estimator at collection time was `HistoryService generic max(words*1.3, chars/4)`. |
| **B1** | FAIL — the #2253 rows omit `activeProvider`; the incomplete historical observation identity cannot be elevated to a committed canonical evidence key. Profile/target/endpoint mapping is not identity and fails closed. |
| **B2** | FAIL (independent) — 0 qualifying post-migration residual observations. Well below 100. |
| **B3** | N/A — B1 and B2 fail. The estimator is exact for counting finalized projected text with the pinned BPE codec, but server-side chat-template overhead is absent from the projection, so a provider framing residual is possible but unmeasured. |
| **Decision** | **UNADJUSTED** |

## Deterministic decision table

The per-key section immediately above records each candidate runtime identity
and whether the committed evidence supplies every canonical key field. The Key
column below repeats the non-truncated identity fields and links to that section
for the full asset revision; `activeProvider missing in evidence` is an explicit
B1 failure, not a completed exact key.

| # | Candidate/evidence identity (model / active provider / protocol / estimator / projection) — full asset revision in Key N above | Historical source observations (derived fixtures excluded) | Post-migration residual obs. | B1 | B2 (≥100) | B3 (≥10% MAPE, p95) | Decision |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | gpt-5.6-sol / activeProvider missing in evidence / openai-responses / gpt-5.6-o200k-v1 / rev 3 | 25 pre-migration; the 5 parity deltas are derived from these rows | 0 | FAIL (activeProvider missing in #2253 rows) | FAIL | N/A (B1 & B2 fail; matched-incremental parity exact for tested content) | UNADJUSTED |
| 2 | claude-opus-5 / claudecode / anthropic-messages / claude-opus-5-o200k-calibrated-2026-08-04-v1 / rev 3 | 67 across non-poolable sets: 25 pre-migration + 42 fitted immutable | 0 | PASS (activeProvider committed in #2835 rows) | FAIL | N/A (B2 fails) | UNADJUSTED |
| 3 | claude-fable-5 / claudecode / anthropic-messages / claude-fable-5-o200k-calibrated-2026-08-04-v1 / rev 3 | 42 fitted immutable | 0 | PASS (activeProvider committed in #2835 rows) | FAIL | N/A (B2 fails) | UNADJUSTED |
| 4 | kimi-k3 / (no observation set) / openai-chat / kimi-k3-tiktoken-v1 / rev 3 | 0 matching | 0 | NOT EVALUABLE (no observed fully keyed evidence set) | FAIL | N/A (B2 fails) | UNADJUSTED |
| 5 | glm-5.2 / activeProvider missing in evidence / anthropic-messages / glm-5.2-tiktoken-v1 / rev 3 | 25 pre-migration | 0 | FAIL (activeProvider missing in #2253 rows) | FAIL | N/A (B1 & B2 fail) | UNADJUSTED |
| 6 | glm-5.2 / activeProvider missing in evidence / openai-chat / glm-5.2-tiktoken-v1 / rev 3 | 25 pre-migration | 0 | FAIL (activeProvider missing in #2253 rows) | FAIL | N/A (B1 & B2 fail) | UNADJUSTED |
| 7 | minimax-m3 / activeProvider missing in evidence / openai-chat / minimax-m3-tiktoken-v1 / rev 3 | 25 pre-migration | 0 | FAIL (activeProvider missing in #2253 rows) | FAIL | N/A (B1 & B2 fail) | UNADJUSTED |

**No key passes. No adaptive subsystem is added.**

## Boundary reasoning

### Why issue #2253 evidence does not qualify

The #2253 corpus (125 observations, 25 per target) was collected against
projection `responses-fields-v1`, which predates the finalized projection
revision 3 that the current immutable estimators are registered against. The
runtime estimators at collection time were the pre-migration heuristics
(`AnthropicTokenizer` character heuristic, `HistoryService generic
max(words*1.3, chars/4)`, `OpenAITokenizer` o200k fallback) — not the
registered immutable estimators now in the codebase. Pre-migration evidence
cannot be relabeled as observations of a later estimator version or projection
revision (B2). Additionally, 25 observations per target is far below the 100
minimum even if the projection matched.

The #2253 corpus also fails **B1 independently**: the sanitized rows store
`target`, `profile`, `endpointHost`, `model`, and `protocol`, but not
`activeProvider`. The collection manifest `scripts/token-divergence-collect.ts`
(`TARGETS`) likewise records `profile`/`endpoint`/`model`/`protocol` and does
not commit `activeProvider`. An observation whose committed identity is missing
the active-provider field has no canonical runtime evidence key, so B1 fails
closed for every #2253-derived observation set (GPT-5.6, GLM z.ai, GLM Ollama,
MiniMax). `activeProvider` is not inferred from profile names, endpoint hosts,
current local or global profile files, or task instructions — profile names are
not identity, and malformed or incomplete evidence fails closed. The
structurally defined current estimator identity (model family, estimator
version, asset revision, projection revision) is a registration/default, not a
committed historical observation identity; it cannot elevate the incomplete
historical observations into a passing evidence key. B1 and B2 each fail on
their own, so the unadjusted decision is doubly grounded.

The #2253 report's "PASS" gate is a different, weaker gate: it checks that a
fitted correction is "no worse than" the pre-migration runtime estimator. It is
not the #2254 activation gate, which requires ≥100 post-migration independent
residual observations and ≥10% relative MAPE improvement over the *immutable*
baseline. The #2253 fitted corrections are corrections to pre-migration
heuristics, not to the current immutable estimators.

### Why issue #2835 evidence does not qualify

The #2835 corpus (84 observations, 42 per Claude model) was collected against
projection revision 3 and is natively at the current projection. However, this
corpus was used to fit and gate the immutable calibrated estimators themselves:
29 training rows fitted the calibration coefficients, and 13 held-out rows
gated them. Evidence used to fit the immutable estimator is not independent
post-migration residual evidence for an adaptive overlay (B2). The entire
corpus was consumed by the immutable estimator's own activation. No independent
post-migration residual corpus exists for either Claude model.

Opus 5 and Fable 5 are independent and cannot be combined despite similar
results. Even if they could, 42 < 100 per model.

### Why official tokenizer families (Kimi K3, GLM 5.2, MiniMax M3) do not qualify

These three families have immutable estimators built from official pinned BPE
assets. They are exact for counting the finalized projected text with the
pinned BPE codec — the projection is the raw request body, not a rendered chat
template, so server-side template overhead is not represented in the count
(`officialPromptEstimators.ts` states this explicitly). They are therefore
*not* proven zero-MAPE against provider `promptTokens`, because the provider
total includes chat-template framing that the projection omits; a provider
framing residual is possible but unmeasured. The gate fails these families at
**B1**: the #2253 rows omit `activeProvider`, so no committed canonical
evidence key exists and B1 fails closed (profile/target/endpoint mapping is not
identity). It also fails at **B2** independently: the #2253 corpus for these
models was pre-migration (projection `responses-fields-v1`, runtime estimator
`HistoryService generic`), so there are 0 qualifying post-migration residual
observations (well below 100). Kimi K3 additionally has no matching observation
set at all (its only candidate target recorded `minimax-m3`, not `kimi-k3`),
leaving B1 NOT EVALUABLE for it. Because B1 and B2 fail, B3 is never reached
and no relative-improvement comparison is performed.

Official tokenizer fixtures prove local codec semantics (BPE correctness over
the projected text), not provider residuals or server-side template overhead.
They are not residual-correction evidence.

### Why GPT-5.6 specifically remains unadjusted (B6)

Issue #2253 measured zero **matched incremental error** for GPT-5.6: every
held-out provider *delta* (held-out minus control, within category) was matched
exactly by the estimator (matched-incremental MAPE 0.00%, RMSE 0.00). This is a
zero-error result for the tested projection/content increments, not a claim of
zero MAPE against the complete provider `promptTokens` total under every
request — server-side chat-template framing is absent from the projection, as
it is for the other estimators built on it. The GPT-5.6 parity fixture
(`gpt56-provider-usage-v1.json`) holds 5 observations that the
`Gpt56ProviderUsageParity.test.ts` suite re-verifies as exact matched
increments. GPT-5.6 fails the gate at **B1**: the #2253 rows omit
`activeProvider`, so the incomplete historical observation identity cannot be
elevated to a committed canonical evidence key (profile/target/endpoint mapping
is not identity, and the structurally defined current estimator identity is a
registration, not a committed observation identity). It also fails at **B2**
independently: the #2253 corpus is pre-migration (`responses-fields-v1` ≠
projection revision 3), and the parity fixture validated the immutable
estimator's matched increments rather than serving as independent residual
evidence, so there are 0 qualifying post-migration residual observations. With
B1 and B2 failing and no demonstrated residual, B3 is never reached and no
adjustment is made. GPT-5.6 can only become eligible if a new independent,
correctly keyed (including a committed `activeProvider`) post-migration data
set satisfies B1–B3; no such data set exists.

## Why no runtime code is changed

Since no key passes the gate:

- No adaptive coefficients or state are generated.
- No observation/coefficient persistence schema is added.
- No estimator registry, agent estimate-to-actual seam, provider actual usage,
  or history synchronization code changes.
- The six registered immutable estimator paths remain the only runtime paths.

Adding a decorator, public abstraction, storage subsystem, profile setting,
tokenizer factory, request projection, or accounting change without a passing
key is outside the accepted behavior (B4). The no-go outcome is successful
completion of the issue, not a partial implementation (B5).

## Source verification: no adaptive path exists

A source search of `packages/` for `adaptiveEstimator`, `adaptiveState`,
`adaptiveOverlay`, `adaptiveCoefficients`, `adaptiveObservation`,
`adaptiveStore`, `adaptiveDecorator`, `evidenceGate`, `residualCorrection`,
`shadowCorrelation`, and `promptEstimatorDecorator` returns zero matches. No
prompt-estimator adaptive decorator or state path exists in the codebase.
Broader `adaptive` matches are unrelated uses such as Anthropic thinking
configuration (`adaptiveThinking`) and adaptive terminal-UI layout.

## Behavioral proof

Because the accepted no-go behavior changes no runtime code, behavioral proof
reuses the existing Bun suites that execute the real registry and estimators:

1. `packages/providers/src/tokenizers/Gpt56ProviderUsageParity.test.ts` —
   proves GPT-5.6's matched held-out increments remain exact.
2. `packages/providers/src/tokenizers/official/officialTokenizers.test.ts` and
   `providerFramingSeparation.test.ts` — prove the three official model codecs
   and registry paths remain exact and immutable.
3. `packages/providers/src/tokenizers/claude/claudeCalibrationGate.test.ts`
   and `claudePromptEstimator.test.ts` — prove Opus 5 and Fable 5 use their
   separate, deterministic immutable calibrations.
4. `packages/providers/src/runtime/providerManagerRuntimeFactories.test.ts` —
   proves runtime-factory injection and the two Claude composition paths. The
   family-specific suites plus inspection of the registration arrays composed
   in `providerManagerInstance.ts` prove all six immutable families remain
   registered.
5. A source search finds no prompt-estimator adaptive decorator/state path
   (confirmed above).
6. Full repository verification and the standard live smoke test must pass.

## Reproducible commands

### Evidence inventory

```bash
# Audit all issue 2253 rows: 125 rows, 20/5 split per target, one provenance
# tuple, and activeProvider absent from every committed row.
jq -s '{
  count: length,
  activeProviderFields: (
    map(has("activeProvider")) | group_by(.) |
    map({present: .[0], count: length})
  ),
  provenance: (map({commitSha, corpusVersion, projectionVersion}) | unique),
  targets: (
    sort_by(.target, .split) | group_by(.target) |
    map({
      target: .[0].target,
      total: length,
      splits: (
        sort_by(.split) | group_by(.split) |
        map({split: .[0].split, count: length})
      )
    })
  )
}' research/issue2253/live-results.jsonl

# Audit all issue 2835 rows: 84 rows, 29/13 split per model, one provenance
# tuple, and activeProvider=claudecode on every committed row.
jq -s '{
  count: length,
  activeProviders: (map(.activeProvider) | unique),
  provenance: (
    map({commitSha, corpusVersion, projectionRevision, protocol}) | unique
  ),
  models: (
    sort_by(.model, .split) | group_by(.model) |
    map({
      model: .[0].model,
      total: length,
      splits: (
        sort_by(.split) | group_by(.split) |
        map({split: .[0].split, count: length})
      )
    })
  )
}' research/issue2835/claude5-live-results.jsonl

# Show that GPT-5.6's five parity deltas are derived from issue 2253 control
# and held-out IDs rather than five additional independent observations.
jq '{source, observations: [.observations[] | {controlId, heldoutId}]}' \
  packages/providers/src/tokenizers/fixtures/gpt56-provider-usage-v1.json

# Prove the per-model immutable Claude fixtures are normalized copies of the
# same 42 rows in issue 2835, not independent adaptive residual corpora.
python3 - <<'PY'
import json
from pathlib import Path

rows = [
    json.loads(line)
    for line in Path("research/issue2835/claude5-live-results.jsonl")
    .read_text()
    .splitlines()
]
fields = (
    "split", "category", "envelope", "projectionBaseTokens", "codePoints",
    "nonAsciiCodePoints", "structuralCodePoints", "whitespaceCodePoints",
    "heuristicTokens", "providerPromptTokens", "cachedPromptTokens",
)
for model in ("claude-opus-5", "claude-fable-5"):
    fixture_path = Path(
        f"packages/providers/src/tokenizers/claude/fixtures/"
        f"{model}-provider-usage-v1.json"
    )
    fixture = json.loads(fixture_path.read_text())
    normalized = [
        dict(id=row["corpusId"], **{field: row[field] for field in fields})
        for row in rows
        if row["model"] == model
    ]
    assert normalized == fixture["observations"]
    print(model, len(normalized), "rows match fixture")
PY
```

### Source search for adaptive paths

```bash
# Confirm no adaptive estimator path exists
rg -t ts 'adaptiveEstimator|adaptiveState|adaptiveOverlay|adaptiveCoefficients|\
adaptiveObservation|adaptiveStore|adaptiveDecorator|evidenceGate|\
residualCorrection|shadowCorrelation|promptEstimatorDecorator' packages/
# Expected: no matches
```

### Focused Bun suites

```bash
bun test packages/providers/src/tokenizers/Gpt56ProviderUsageParity.test.ts
bun test packages/providers/src/tokenizers/official/officialTokenizers.test.ts
bun test packages/providers/src/tokenizers/official/providerFramingSeparation.test.ts
bun test packages/providers/src/tokenizers/claude/claudeCalibrationGate.test.ts
bun test packages/providers/src/tokenizers/claude/claudePromptEstimator.test.ts
bun test packages/providers/src/runtime/providerManagerRuntimeFactories.test.ts
```

### Full verification

```bash
npm run test
npm run lint
npm run typecheck
npm run format
npm run build
bun scripts/start.ts --profile-load stepfun-37 "write me a haiku and nothing else"
```

## License

Copyright 2026 Vybestack LLC. SPDX-License-Identifier: Apache-2.0.