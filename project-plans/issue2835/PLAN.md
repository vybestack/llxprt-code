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

`isSanctionedClaudeOpus5Model` and `isSanctionedClaudeFable5Model` accept only:

- `claude-opus-5` / `claude-fable-5`
- `claude-opus-5-latest` / `claude-fable-5-latest`
- `claude-opus-5-YYYYMMDD` / `claude-fable-5-YYYYMMDD` where `YYYYMMDD` is a
  real calendar date (leap years honoured)

and reject everything else, including: the other family's IDs, `claude-opus-50`,
`claude-fable-50`, `claude-opus-5-mini`, `claude-opus-4-8`, `claude-opus-4-7`,
`claude-sonnet-5`, `claude-opus-5-2026-01-01` (hyphenated snapshot form),
`claude-opus-5-20261345` and `claude-opus-5-20260230` (impossible dates),
leading/trailing whitespace, and vendor-prefixed forms.

Matching is case-insensitive, consistent with `AnthropicModelData`.

### B2 — One-pass content features

`extractClaudeContentFeatures(text)` performs exactly **one** left-to-right scan
of the text, decoding code points (surrogate pairs consumed as one code point),
and returns a frozen record:

- `codePoints`
- `nonAsciiCodePoints`
- `structuralCodePoints` (ASCII code/JSON punctuation)
- `whitespaceCodePoints`

Constraints:

- No regular expressions, no `split`, no intermediate arrays or substrings; one
  numeric accumulator set and one frozen result object per call.
- Deterministic and offline.
- Chunk-boundary invariant: features of `a + b` equal the component-wise sum of
  features of `a` and `b` at **every code-point boundary**, which is every
  boundary a projection's segments can actually fall on. An unpaired surrogate
  is counted as one code point rather than crashing.

### B3 — Immutable calibration format

A `ClaudeCalibration` record binds:

- `canonicalModelFamily`, `protocol` (`anthropic-messages`)
- `estimatorVersion`, `assetRevision`, `projectionRevision` (3)
- `baseCounter` identifier
- `baseTokenCoefficient`, `featureCoefficients` (named feature → coefficient),
  `intercept`
- `heldOut` metrics and `provenance`

`applyClaudeCalibration(baseTokens, features, calibration)` is pure and
deterministic: `round(intercept + baseTokenCoefficient * baseTokens + Σ
coefficient_f * features[f])`, clamped to a non-negative integer. Empty input
yields exactly `0`.

Assets are deep-frozen module constants; mutation attempts throw in strict mode.

### B4 — Opus 5 estimator activation

Registered for `anthropic-messages` only. Returns `method: 'calibrated'`, the
Claude family name, estimator version, asset revision, and the request's
projection revision. It performs exactly one base tokenization of
`projection.promptText` and one feature scan of the same string; tokenizer
selection never depends on content.

Unsupported protocol and unresolved-identity requests raise the existing typed
`ModelPromptEstimatorError` codes, matching the GPT-5.6 registration contract.

### B5 — Activation gate

The Opus 5 calibration ships only because it passes, on the held-out split:

- held-out MAPE improves by **≥ 10% relative** to the existing Claude heuristic
  (`AnthropicTokenizer`), and
- p95 underestimation is **not worse** than that heuristic.

Recorded held-out metrics live in the calibration asset and are re-verified by a
behavioral test that runs the real estimator over the sanitized corpus.

### B6 — Fable 5 withheld

There are zero trustworthy `claude-fable-5` provider observations. Fable 5
therefore has **no** calibrated registration: it is not registered, does not
resolve to Opus coefficients, and falls through to the existing legacy path. A
committed status artifact records the reason. `resolveClaudeCalibration` returns
an explicit "unavailable" outcome for Fable 5.

## Inputs and boundary cases

| Input | Expected |
| --- | --- |
| empty `promptText` | `0` |
| pure ASCII prose | calibrated count |
| CJK / Cyrillic / Greek / Arabic | calibrated count; no tokenizer switch |
| emoji / astral code points | one code point per astral char |
| lone surrogate | counted as one code point, no crash |
| JSON / tool-like text | calibrated count; no tokenizer switch |
| `openai-chat` / `openai-responses` protocol | `unsupported-protocol` error |
| `claude-opus-5-mini` | `unresolved-model-identity` error |
| `claude-fable-5` | not claimed; legacy path, `family: 'legacy-unregistered'` |
| malformed projection | `tokenization-failed` / `projection-unavailable` |

## Ground truth

`research/issue2253/live-results.jsonl` contains 25 live `claude-opus-5`
observations against `api.anthropic.com` (`anthropic-messages`), each with the
complete provider `promptTokens` (cached prompt tokens included; the recorded
cached total is 0 for every row). The controlled prompts are deterministically
regenerated by `scripts/token-divergence-corpus.ts`; recomputing the `o200k`
deltas of the JSON-embedded prompts reproduces the recorded deltas exactly for
all 20 deltas, so the corpus is fully reconstructible and can be re-derived
rather than trusted blindly.

Analysis is within-category incremental (control = smallest item per category),
which cancels the fixed system/tool envelope. Split: controls 1–5, train deltas
6–20, held-out deltas 21–25 — the same split used by #2253.

Model selection is by leave-one-category-out cross-validation, which rejects
richer feature sets that merely memorise the five synthetic categories.

## Test plan (RED first)

1. `claudeModelIdentity.test.ts` — B1 accept/reject table, cross-family
   rejection, invalid calendar snapshots, case-insensitivity.
2. `claudeContentFeatures.test.ts` — B2 additivity across every code-point
   boundary; astral, combining-mark, CJK, lone-surrogate, empty and long
   inputs; frozen result.
3. `claudeCalibration.test.ts` — B3 purity, determinism, clamping, empty input,
   deep-frozen assets, projection-revision binding.
4. `ClaudePromptEstimator.test.ts` — B4 provenance (`calibrated`, never
   `exact`), single base tokenization and single feature scan per estimate
   (observed via an injected counting base counter), identical asset revision
   for Unicode-heavy versus code-heavy content, protocol and identity errors,
   registry composition, and Fable 5 falling through to the legacy path with
   no Opus coefficients (B6).
5. `ClaudeOpus5CalibrationGate.test.ts` — B5 gate re-verified end-to-end from
   the sanitized corpus fixture through the real extractor, real base counter
   and real calibration; asserts the recorded held-out metrics and the ≥10%
   relative MAPE improvement plus non-worse p95 underestimation versus
   `AnthropicTokenizer`.

## Deliverables

- `packages/providers/src/tokenizers/claude/` — identity, features,
  calibration format, calibration assets, estimator, registrations, fixtures.
- `packages/providers/src/tokenizers/o200kBaseCounter.ts` — the shared pinned
  base counter, extracted so GPT-5.6 and Claude share one WASM encoder instance
  (allocation-conscious, AC7).
- Registry composition updated to include the Claude registration.
- `scripts/claude-estimator-calibration.ts` — deterministic offline fit,
  candidate model selection, and report generation.
- `research/issue2835/` — sanitized report, fitted coefficients, Fable 5 status.

## Non-goals

No Claude 4.6-or-earlier support, no exact-tokenizer claim, no online or
adaptive persistence, no profile settings, no request assembly changes, no
models outside Opus 5 and Fable 5.
