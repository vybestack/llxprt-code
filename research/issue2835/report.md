# Issue #2835 — Calibrated local prompt estimators for Claude Opus 5 and Claude Fable 5

Anthropic does not publish the tokenizer for Claude 4.7 and later. Nothing here
claims exact tokenization, and no pre-4.7 Claude vocabulary (neither the legacy
`@anthropic-ai/tokenizer` nor the reverse-engineered `ctoc` vocabulary) is used
or presented as the Opus 5 or Fable 5 tokenizer.

Each model gets one stable local **base counter** — the pinned `o200k_base` BPE
asset already shipped for GPT-5.6 — plus its own immutable calibration layer
fitted against live provider `promptTokens`. Results always report
`method: 'calibrated'`.

## Corpus

Collected live for this issue by `scripts/claude-estimator-collect.ts` against
`api.anthropic.com` over the OAuth-backed `claudecode` provider.

- **84 observations**: 42 for `claude-opus-5` and 42 for `claude-fable-5`,
  collected independently.
- **7 content categories**: prose, code, JSON/tool-like, CJK and other
  non-Latin scripts, astral-plane emoji (including ZWJ sequences, regional
  indicator flags and variation selectors), combining marks (decomposed Latin,
  Devanagari, Hebrew), and mixed Markdown.
- **3 system/tool envelope sizes**: no tools, a small allow-list, and the full
  tool schema. Base-counter readings span 15,756–20,594 tokens as a result.
- **Split**: 29 training and 13 held-out observations per model. The largest
  size in every category is held out, so the held-out set tests extrapolation
  rather than interpolation, and three categories are held out entirely within
  each non-default envelope.
- **Target**: the complete provider `promptTokens`, which llxprt computes as
  `input_tokens + cache_read_input_tokens + cache_creation_input_tokens`, so
  cached prompt tokens are included by construction. The recorded cached total
  is 0 for every row.
- **Projection**: measured through the production
  `projectAnthropicPromptEnvelope` at revision 3. The corpus is natively
  revision 3; nothing is bridged from an older projection.

Only the **first** request of each run is measured. That is the finalized
prompt envelope the pre-send estimate has to predict, and the only turn whose
content is fully determined by the corpus item. This also avoids biasing
acceptance toward the less agentic model: Fable 5 frequently treats a
code-shaped prompt as an agentic task and takes further turns, which Opus 5
usually does not.

The committed corpora contain **counts only** — base-counter reading, one-pass
content features, the legacy heuristic's count, and provider token totals. No
prompt text, request body, header or credential is retained.

## Why whole requests, and why the envelope varies

Issue #2253 could only measure a marginal content rate, because it held the
system/tool envelope fixed and differenced within categories, which cancels any
per-request framing constant. Varying the envelope here makes the framing
constant identifiable, so the calibration models a whole finalized request
directly rather than an increment.

## Model selection

Candidate feature sets are compared by leave-one-category-out cross-validation
**over training rows only**. Letting a held-out row influence which feature set
is chosen would make the held-out metrics that justify activation
self-fulfilling. Leave-one-envelope-out is reported alongside as a check on
generalizing to an unseen envelope size.

Claude Opus 5:

| Feature set | Leave-one-category-out MAPE (%) | Leave-one-envelope-out MAPE (%) |
| --- | --- | --- |
| base counter only | 0.387 | 1.093 |
| base + codePoints | 0.310 | 1.074 |
| **base + codePoints + nonAsciiCodePoints (shipped)** | **0.287** | 1.126 |
| base + codePoints + structuralCodePoints | 0.432 | 1.111 |
| base + codePoints + whitespaceCodePoints | 0.356 | 1.051 |
| base + codePoints + nonAscii + structural | 0.412 | 1.135 |
| base + all four features | 0.566 | 1.014 |

Claude Fable 5 selects the same feature set from its own data (0.289 versus
0.313 for the next best), independently.

Adding the Unicode feature helps here where it did not on the #2253 corpus,
because the emoji and combining-mark categories provide the variation needed to
identify it. Structural and whitespace counts still degrade generalization and
are still rejected.

## Shipped calibrations

Both are `round(intercept + baseCoef * baseTokens + Σ featureCoef * feature)`,
floored at the base-counter reading.

| | Claude Opus 5 | Claude Fable 5 |
| --- | --- | --- |
| intercept | −1649.098251 | −1658.009406 |
| baseTokens | 0.657456 | 0.655462 |
| codePoints | 0.231236 | 0.231865 |
| nonAsciiCodePoints | 0.251193 | 0.251442 |

The fitted intercept is negative. That is correct inside the measured range but
would extrapolate absurdly below it, so the result is floored at the
base-counter reading. Every one of the 84 observations had a provider count
above its base-counter reading (minimum ratio 1.4825), which makes that reading
a measured lower bound rather than an invented guard. The floor never binds
inside the validated range, and a test asserts exactly that.

Each calibration records the base-counter range it was measured over
(15,756–20,594) so the extrapolation boundary is explicit rather than implied.

## Held-out results

Metrics are computed through the same runtime function that ships, including
its per-estimate rounding, so they describe the shipped estimator rather than
raw regression output.

### Claude Opus 5 (13 held-out observations)

| | Calibrated | `AnthropicTokenizer` heuristic |
| --- | --- | --- |
| MAPE (%) | **0.386** | 33.542 |
| RMSE | 124.89 | 8854.36 |
| p95 underestimation (%) | 0.891 | 34.082 |

Relative MAPE improvement **98.85%**.

### Claude Fable 5 (13 held-out observations)

| | Calibrated | `AnthropicTokenizer` heuristic |
| --- | --- | --- |
| MAPE (%) | **0.389** | 33.546 |
| RMSE | 125.93 | 8856.10 |
| p95 underestimation (%) | 0.896 | 34.088 |

Relative MAPE improvement **98.84%**.

Both models clear the 10% relative-improvement threshold by a wide margin,
improve p95 underestimation rather than worsening it, and beat the heuristic on
*every* held-out observation rather than only on average. Both therefore
activate.

## Finding: the two models tokenize almost identically

28 of the 42 paired observations produced byte-identical provider prompt-token
counts for Opus 5 and Fable 5, and the two independently fitted calibrations
land within 0.3% of each other. Cross-applying one model's coefficients to the
other's held-out set still yields under 2% MAPE.

This is reported as a *finding*, not as a shortcut. Issue #2835 is explicit that
Fable 5 may not inherit Opus coefficients merely because both are Claude
5-family models, and it does not: the two corpora were collected separately,
fitted separately, selected separately and gated separately. The observation
that they agree is only trustworthy *because* they were measured independently
— had Fable 5 simply been handed Opus 5's numbers, the two situations would be
indistinguishable.

## Provider applicability

These coefficients were measured against `api.anthropic.com`. They apply only
when the active provider is a first-party Anthropic provider (`anthropic` or
`claudecode`). An Anthropic-compatible third-party endpoint frames requests
differently, so a Claude 5 model served through such an endpoint is left
unclaimed and keeps its existing estimation path rather than silently receiving
another endpoint's calibration.

## Limitations

- The calibration is validated over base-counter readings of 15,756–20,594
  tokens, which is the range llxprt actually produces given its system prompt.
  Outside that range the model extrapolates and only the base-counter floor
  protects it.
- Envelope size is varied across three levels, not continuously.
- The corpus is synthetic in content, generated by committed code, so it
  measures tokenization behaviour rather than real user traffic.
- Both corpora recorded zero cached prompt tokens, so the cached-token path is
  included by construction but not exercised with a non-zero value.

## Provenance

- Corpus: `2026-08-04-v1`, `research/issue2835/claude5-live-results.jsonl`.
- Sanitized per-model corpora:
  `packages/providers/src/tokenizers/claude/fixtures/claude-opus-5-provider-usage-v1.json`
  and `claude-fable-5-provider-usage-v1.json`.
- Fitted coefficients and full candidate tables:
  `research/issue2835/claude5-calibration.json`.
- Base counter asset: `o200k_base`, SHA-256
  `446a9538cb6c348e3516120d7c08b09f57c36495e2acfffe59a5bf8b0cfb1a2d`, via
  `@dqbd/tiktoken@1.0.22`.
- Finalized projection revision 3 (#2817). Each calibration records this
  revision and the estimator refuses to apply it to any other revision.
- Reproduce with `bun scripts/claude-estimator-calibration.ts`, which is
  deterministic and offline. Re-collection requires Anthropic credentials:
  `bun scripts/claude-estimator-collect.ts --results <path> --artifacts <dir>`.
