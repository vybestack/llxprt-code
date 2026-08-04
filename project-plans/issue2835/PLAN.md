# Issue #2835 — Calibrated local prompt estimators for Claude Opus 5 and Claude Fable 5

## Accepted behavior

A providers-owned, model-family prompt estimator for the Claude 5 family that
plugs into the existing `ModelPromptEstimatorRegistry` (#2249) and consumes the
finalized provider projection (#2817, `projectionRevision` 3).

The estimator is **calibrated**, never exact. It does not use, ship, or claim
any Anthropic tokenizer or pre-4.7 reverse-engineered vocabulary. It uses one
stable local base counter (the already-pinned `o200k_base` BPE asset, used
purely as a *base counter*, not as "the Claude tokenizer") plus an immutable
per-model calibration layer.

### B1 — Anchored model identity

`isSanctionedClaudeOpus5Model` and `isSanctionedClaudeFable5Model` accept only
the bare alias, the `-latest` pointer, and `-YYYYMMDD` snapshots whose digits
form a real calendar date. Everything else is rejected, including the other
family's IDs, `claude-opus-50`, `claude-opus-5-mini`, `claude-opus-4-8`,
`claude-sonnet-5`, hyphenated snapshots, `-20261345`, `-20260230`, whitespace
padding, and vendor-prefixed forms. Matching is case-insensitive.

### B2 — One-pass content features

`extractClaudeContentFeatures(text)` performs exactly **one** left-to-right scan
and returns a frozen record of `codePoints`, `nonAsciiCodePoints`,
`structuralCodePoints` and `whitespaceCodePoints`.

Constraints: no regular expressions, no `split`, no intermediate arrays; one
numeric accumulator set and one frozen result per call; deterministic and
offline; counts additive across every code-point boundary, which is every
boundary a projection's segments can fall on; an unpaired surrogate is counted
as one code point rather than throwing.

### B3 — Immutable calibration format

A `ClaudeCalibration` binds canonical model, protocol, estimator version, base
counter asset revision, projection revision, coefficients, held-out metrics,
provenance, and the base-counter range the fit was measured over.

`applyClaudeCalibration` is pure and deterministic:
`round(intercept + baseCoef * baseTokens + Σ coef * feature)`, floored at the
base-counter reading, with empty input yielding exactly `0`.

### B4 — Per-model estimator activation

Registered for `anthropic-messages` and only for the providers the corpus was
measured on (`anthropic`, `claudecode`). Returns `method: 'calibrated'`, the
model's own family, estimator version, asset revision, and the request's
projection revision. Exactly one base tokenization and one feature scan of the
same projection text; tokenizer selection never depends on content.

### B5 — Activation gate, evaluated per model

A model activates only if, on **its own** held-out split, held-out MAPE improves
by at least 10% relative to the existing `AnthropicTokenizer` heuristic and p95
underestimation is not worse. The gate derives the relative improvement from the
two MAPE values rather than trusting a stored headline.

### B6 — Withholding

A model with no activatable calibration is not registered, does not resolve to
another model's coefficients, and keeps its existing path. A model that
*declares* a calibration which does not hold up throws at module load rather
than silently degrading.

## Evidence collected for this issue

`scripts/claude-estimator-collect.ts` collects live observations against
`api.anthropic.com`. `scripts/claude-estimator-corpus.ts` defines the corpus.

- 42 observations per model, collected separately for `claude-opus-5` and
  `claude-fable-5`.
- 7 content categories including astral-plane emoji and combining marks.
- 3 system/tool envelope sizes, giving a 15,756–20,594 base-token span so a
  per-request framing constant is identifiable and whole requests can be
  modelled directly.
- 29 train / 13 held-out per model; the largest size in every category is held
  out, so the held-out split tests extrapolation.
- Target is the complete provider `promptTokens` including cached prompt tokens.
- Measured through the production revision-3 projector, so no projection bridge
  is required.
- Only the first request of each run is measured: it is the envelope the
  pre-send estimate must predict, and measuring it avoids biasing acceptance
  toward the less agentic model.
- Committed corpora contain counts only — no prompt text, request body, headers
  or credentials.

Model selection is by leave-one-category-out cross-validation over training rows
only, with leave-one-envelope-out reported as a generalization check.

## Test plan

1. `claudeModelIdentity.test.ts` — B1 accept/reject table.
2. `claudeContentFeatures.test.ts` — B2 additivity at every code-point
   boundary; astral, combining, CJK, lone surrogate, empty and long inputs.
3. `claudeCalibration.test.ts` — B3 purity, rounding, floor behaviour, gate
   integrity (derived improvement, invalid metrics, duplicate features), and
   per-model asset separation.
4. `claudePromptEstimator.test.ts` — B4 provenance, single base tokenization
   and single feature scan via injected seams, content-independent tokenizer
   selection, chunk invariance, protocol/identity/provider errors, registry
   composition, and B6 withholding via a constructed spec.
5. `claudeCalibrationGate.test.ts` — B5 re-verified per model from that model's
   own sanitized corpus, plus corpus coverage, held-out integrity, the
   base-counter floor, and model independence.
6. `providerManagerRuntimeFactories.test.ts` — composition-root wiring through
   the real provider-manager tokenizer factory.

## Outcome

Both models cleared their own gate and are registered:

| | Opus 5 | Fable 5 |
| --- | --- | --- |
| Held-out MAPE | 0.386% | 0.389% |
| Heuristic baseline | 33.542% | 33.546% |
| Relative improvement | 98.85% | 98.84% |
| p95 underestimation | 0.891% vs 34.082% | 0.896% vs 34.088% |

The two independently fitted calibrations agree closely, which is reported as a
finding about Anthropic's tokenization rather than used as a shortcut.

## Non-goals

No Claude 4.6-or-earlier support, no exact-tokenizer claim, no online or
adaptive persistence, no profile settings, no request assembly changes, no
models outside Opus 5 and Fable 5.
