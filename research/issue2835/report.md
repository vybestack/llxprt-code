# Issue #2835 — Calibrated local prompt estimators for Claude Opus 5 and Claude Fable 5

Anthropic does not publish the tokenizer for Claude 4.7 and later. Nothing in
this work claims exact tokenization, and no pre-4.7 Claude vocabulary (neither
the legacy `@anthropic-ai/tokenizer` nor the reverse-engineered `ctoc`
vocabulary) is used or presented as the Opus 5 or Fable 5 tokenizer.

Instead each model gets one stable local **base counter** — the pinned
`o200k_base` BPE asset already shipped for GPT-5.6 — plus its own immutable
calibration layer fitted against live provider `promptTokens`. Results are
always reported with `method: 'calibrated'`.

## Method

Ground truth is the 25 live `claude-opus-5` observations recorded in
`research/issue2253/live-results.jsonl` against `api.anthropic.com` over
`anthropic-messages`. The target is the complete provider `promptTokens`,
including cached prompt tokens; the recorded cached total is 0 for every row,
so no cache subtraction was applied or needed.

The controlled prompts are regenerated deterministically from
`scripts/token-divergence-corpus.ts`. `scripts/claude-estimator-calibration.ts`
re-derives them, re-counts them with the local base counter, and **fails the
run** unless every recomputed base-counter delta reproduces the delta recorded
live. All 20 deltas reproduce exactly, so the corpus is verified rather than
assumed.

Analysis is within-category incremental: the smallest item in each category is
the control, and each larger item contributes its delta from that control.
Subtracting the control cancels the fixed system/tool envelope, which is what
makes a marginal content rate identifiable from this corpus at all. The split
matches #2253: controls 1–5, training deltas 6–20, held-out deltas 21–25.

Model selection is by leave-one-category-out (LOCO) cross-validation rather
than by the held-out split alone, because with five synthetic categories a
richer feature set can memorise the category slopes and still look excellent on
a held-out split drawn from the same generators. **LOCO runs over the training
deltas only.** Letting a held-out observation influence which feature set is
chosen would make the held-out metrics that justify activation
self-fulfilling.

### Projection provenance

The corpus was recorded under the `responses-fields-v1` projection, while the
calibration is declared against finalized projection revision 3. That pairing is
not assumed: `claudeProjectionBridge.test.ts` proves that both projections
serialize byte-identical prompt text for every corpus observation and for
media-free `anthropic-messages` bodies generally, and it also pins the one case
where they differ (revision 3 replaces base64 media payloads, which the
media-free corpus never contains). The fitting script rejects any source row
whose projection version, protocol, endpoint, corpus version or commit does not
match the rest of the corpus.

## Why the provider rate varies by content

Provider tokens per base-counter token are extremely stable inside a category
and clearly different between categories:

| Category | provider tokens per base token |
| --- | --- |
| prose | 1.818 |
| unicode | 1.667 |
| code | 1.514 |
| mixed | 1.396 |
| json | 1.382 |

A single global ratio therefore cannot fit all content. The ratio of code
points to base tokens is the density signal that separates these regimes, which
is why one content feature — the one-pass code-point count — recovers most of
the gap.

## Candidate feature sets

LOCO MAPE is the selection criterion and is computed on training deltas only.
The held-out column is shown for context and did not participate in selection.

| Feature set | LOCO MAPE (%) — selection | Held-out MAPE (%) |
| --- | --- | --- |
| base counter only | 10.92 | 9.06 |
| **base + codePoints (shipped)** | **9.73** | 5.80 |
| base + codePoints + nonAsciiCodePoints | 11.43 | 1.36 |
| base + codePoints + structuralCodePoints | 12.98 | 4.47 |
| base + codePoints + whitespaceCodePoints | 15.10 | 4.77 |
| base + codePoints + nonAscii + structural | 31.17 | 1.32 |
| base + all four features | 230.97 | 0.03 |

The richer sets look best on the held-out split and collapse under LOCO — the
four-feature model is more than 20× worse than the base counter alone on unseen
content. That is textbook overfitting to five synthetic categories, and it is
exactly why selection must not read the held-out split.

## Shipped Opus 5 calibration

    predicted = round(0.944299 * baseTokens + 0.153947 * codePoints)

The intercept is **0**. Within-category deltas cancel any per-request constant,
so no framing constant is identifiable from this corpus; publishing one would
be a fabricated number.

Reported metrics are computed through the same runtime function that ships,
including its per-estimate rounding, so they describe the shipped estimator
rather than the raw regression output.

| Held-out (5 deltas) | Calibrated | `AnthropicTokenizer` heuristic |
| --- | --- | --- |
| MAPE (%) | 5.82 | 38.25 |
| RMSE | 38.08 | 271.46 |
| p95 underestimation (%) | 17.27 | 58.20 |

Relative MAPE improvement: **84.78%**, far above the 10% activation
threshold. p95 underestimation improves rather than worsens, and the calibrated
estimate is closer than the heuristic on *every* held-out category, not only on
average. The gate therefore passes and Opus 5 is registered.

### Whole-request behaviour

The calibration is fitted on deltas but is applied to whole finalized
projections. Evaluated against all 25 whole-request observations (using each
row's recorded projection character count as a code-point proxy, since the
fixed envelope text is not retained in the sanitized corpus), the calibrated
estimate lands between **+4.0% and +4.5%** of the provider count on every row
— a small, stable *over*estimate, so it never under-reports the context a
request will consume. The current generic path underestimates the same requests
by roughly 33%.

This proxy-based whole-request figure is reported as supporting evidence only.
The committed gate test asserts the incremental held-out metrics, which are
derived entirely from retained data.

## Claude Fable 5 — registration withheld

There are **zero** trustworthy `claude-fable-5` provider observations. Fable 5
is a distinct model with its own framing and tokenization rate, and issue #2835
is explicit that it may not inherit Opus coefficients merely because both are
Claude 5-family models.

Accordingly:

- Fable 5 has **no** calibration asset and **no** registration.
- Its family spec records the withholding reason instead of coefficients, and
  the registry is built by filtering specs on an activatable calibration, so
  the absence is enforced by the same mechanism that activates Opus 5.
- Fable 5 keeps its pre-existing generic estimation path unchanged.
- A behavioral test asserts that Fable 5 is unclaimed, is not given Opus 5's
  family, version or count, and that estimating directly from the Fable spec
  fails with the recorded withholding reason.

Activating Fable 5 requires its own provider-ground-truth corpus, collected
live against `api.anthropic.com`, and a passing gate on that corpus. Until
then, withholding is the correct outcome, not a gap to be papered over.

### Provider applicability

These coefficients were measured against `api.anthropic.com`. They are applied
only when the active provider is a first-party Anthropic provider
(`anthropic` or `claudecode`). An Anthropic-compatible third-party endpoint
frames requests differently, so `claude-opus-5` served through such an endpoint
is left unclaimed and keeps its existing estimation path rather than silently
receiving another endpoint's calibration.

## Corpus coverage and limitations

The corpus covers prose, code, JSON/tool-like content, CJK, Korean, Cyrillic,
Greek and Arabic text, and mixed Markdown with tool-like tags. Its limitations
are recorded honestly:

- It contains no astral-plane characters (emoji) and no combining marks, so the
  calibration is not validated on those. The one-pass extractor handles them
  correctly and is tested on them directly, but no provider ground truth exists
  for them yet.
- The system/tool envelope is constant across all 25 rows, so envelope-size
  effects are cancelled by the incremental method rather than modelled.
- Five categories give five independent directions, which is why the model was
  kept to two terms.

Closing these gaps requires additional live collection against
`api.anthropic.com` and is the natural next increment for both models. Until
that collection happens, acceptance criterion 4 is met for prose, code,
JSON/tool-like content, CJK and other non-Latin scripts, and mixed Markdown,
and is **not** met for emoji/combining marks or varying system/tool envelope
sizes.

## Provenance

- Corpus: `2026-07-28-v1`, collected at commit `2bec7cb6a466` (#2253).
- Sanitized corpus:
  `packages/providers/src/tokenizers/claude/fixtures/claude-opus-5-provider-usage-v1.json`.
- Fitted coefficients: `research/issue2835/opus5-calibration.json`.
- Base counter asset: `o200k_base`, SHA-256
  `446a9538cb6c348e3516120d7c08b09f57c36495e2acfffe59a5bf8b0cfb1a2d`, via
  `@dqbd/tiktoken@1.0.22`.
- Finalized projection revision: 3 (#2817). The calibration records this
  revision and the estimator refuses to apply it to any other revision.
- No raw prompts, credentials, headers or request dumps are committed. The
  corpus prompts are synthetic and generated by committed code.
