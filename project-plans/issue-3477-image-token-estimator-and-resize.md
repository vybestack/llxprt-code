# Plan: GPT-5.2+ image token estimator and capability-neutral resize defaults

Plan ID: PLAN-20260901-ISSUE3477

Tracking issue: https://github.com/vybestack/llxprt-code/issues/3477

Generated: 2026-09-01

## Objective

Close two gaps in the OpenAI image path:

1. The local image token estimator uses the legacy GPT-4o tile formula for all OpenAI-family models. GPT-5.2+ models use a patch-based formula that charges significantly more tokens for large images, causing a 10.8x underestimate that prevents context compression from firing at the right time.

2. OpenAI and Codex provider aliases lack the capability-neutral image resize defaults that the anthropic/claudecode aliases already set. Without resize defaults, full-resolution images are sent to the backend, burning quota on token counts that far exceed what the local estimator predicts.

## Problem

### Baseline data (before metrics)

A 4000x2500 PNG (362,220 bytes) was fed to gpt-5.6-sol (high reasoning) via the codex provider:

| Metric | Turn 1 (no image) | Turn 2 (after read_file) | Delta |
| --- | --- | --- | --- |
| actual_prompt_tokens | 7,873 | 19,803 | +11,930 |
| cached_tokens | 0 | 7,680 | +7,680 |
| output_tokens | 51 | 141 | +90 |
| total_tokens | 7,924 | 19,944 | +12,020 |

The provider charged ~11,930 image tokens. The patch formula predicts ceil(1.2 x ceil(4000/32) x ceil(2500/32)) = ceil(1.2 x 125 x 79) = 11,850 tokens (uncapped), confirming the backend charges the full patch count with no 1536-patch cap. The local estimator said 1,105 (legacy tile formula), a 10.8x underestimate.

After a 2000px long-edge resize, the image becomes 2000x1250. Expected patch tokens: ceil(1.2 x ceil(2000/32) x ceil(1250/32)) = ceil(1.2 x 63 x 40) = 3024 if uncapped, or 1844 if capped. Either way a large reduction from 11,930, plus the base64 payload shrinks from ~483 KB to roughly 30-60 KB.

References:
- openai/codex#19806 (patch formula + 12k original-detail cap)
- openai/codex#41338 (image byte/token asymmetry burning Codex quota)
- https://developers.openai.com/api/docs/guides/images-vision

## Root cause: image-resize defaults never reached the resize pipeline

The alias modelDefaults were written correctly at startup (a runtime hook
confirmed `image-resize.maxLongEdge=2000`, `maxShortEdge=2000`, and
`maxPixels=1572864` written through both `ConfigBase.setEphemeralSetting` and
`SettingsService.set`), yet read_file still sent the original 4000x2500
bytes (media object sha256 8d8434a8..., 362,220 B). The settings shapes on
the write and read sides disagree:

- Write side: `SettingsService.set('image-resize.maxLongEdge', 2000)` stores
  the value NESTED, as `global['image-resize'].maxLongEdge`.
- Read side: read-file.ts/read-many-files.ts call
  `host.getEphemeralSettings()` -> `ConfigBase.getEphemeralSettings()` ->
  `SettingsService.getAllGlobalSettings()`, which returns the nested object
  under the key `'image-resize'`.
- `resolveImageResizePolicy` then indexed the FLAT key
  `settings['image-resize.maxLongEdge']`, got `undefined`, and returned no
  policy, so `resizeImageIfNeeded` was a no-op.

Probe evidence: after `new SettingsService().set('image-resize.maxLongEdge',
2000)`, `getAllGlobalSettings()['image-resize.maxLongEdge'] === undefined`
while `getAllGlobalSettings()['image-resize']` holds the nested object.
Undotted keys (such as `max-image-dimension`) round-trip fine, which is why
the anthropic budget path never hit this. This also means the pre-existing
`^gpt-` 2048px rule has never worked at runtime.

Scoped fix (packages/tools only; SettingsService and ConfigBase behavior is
unchanged): new helper `readSettingFlatOrNested(settings, 'a.b')` in
`packages/tools/src/utils/flatOrNestedSetting.ts` checks the flat dotted key
first, then walks the nested object tree. `resolveImageResizePolicy` now
reads `image-resize.enabled`, `maxLongEdge`, `maxShortEdge`, and `maxPixels`
through it. An audit of packages/tools found no other dotted-key reads of
the plural ephemeral map (`imageDimensionBudget.ts` uses undotted keys).
Regression tests in `packages/tools/test-bun/imageResizePolicySettings.bun.ts`
write through a real SettingsService and pin that the policy resolves from
both the flat and the nested shape, plus an end-to-end resize with a policy
resolved from SettingsService output.

### Follow-on root cause: model-facing skip_image_resize defeated the defaults

After the settings-shape fix, resize could still be bypassed. read_file
exposed a `skip_image_resize` boolean in its model-facing schema, and
gpt-5.6-sol set it to true nondeterministically when reading images
(2 of 3 identical runs), silently disabling the resize policy for that
call. The opt-out bought no model-visible fidelity: OpenAI GPT-5.2+
caps images at 1536 patches server-side at standard detail (the client
never sends detail:"original"), and Anthropic resizes to 1568px
server-side. Skipping resize only inflated request bytes. Fix: remove
the parameter from the read_file schema, the params interface, and the
policy resolver, so resize behavior comes solely from settings.

## Approach

### GAP 1: Model-aware estimator

Extend `ImageTokenEstimateInput` and `estimateNonTextPartTokens` with an optional `model` field. When the provider resolves to the OpenAI family and the model is GPT-5.2-or-newer, use the patch formula:

```
image_tokens = ceil(1.2 x min(ceil(w/32) x ceil(h/32), 1536))
```

Maximum 1,844 tokens at standard detail.

Model matching:
- Match: gpt-5.2, gpt-5.3, gpt-5.4, gpt-5.5, gpt-5.6 and named variants (gpt-5.6-sol, gpt-5.6-terra, gpt-5.6-luna), and any gpt-6+
- Do NOT match: gpt-4o, gpt-4.1, gpt-5.0, gpt-5.1, o1, o3, o4-mini
- Unknown model string in the openai family: use patch formula (conservative-high)

Update `OPENAI_UNKNOWN_DIMENSIONS_TOKENS` for the patch-formula path to 1844. Legacy path keeps 1105.

Thread the `model` field from existing call sites:
- `historyTokenEstimation.ts` (estimateMediaBlockImageTokens and estimateContentTokens): pass modelName through
- `read-many-files-content.ts` (addFileContent/estimateNonTextPartTokens): no provider/model available at the tool layer, so no change needed there

### GAP 2: Image resize defaults for openai/codex aliases

The existing openai, openai-responses, openai-vercel, and codex alias configs already set `image-resize.maxLongEdge: 2048, image-resize.maxShortEdge: 2048, image-resize.maxPixels: 1572864` for all `^gpt-` models. The issue asks for 2000px defaults (no maxPixels) for GPT-5.2+ models. Following the established pattern (later rules override earlier ones), add a more specific rule for GPT-5.2+ models that sets `image-resize.maxLongEdge: 2000, image-resize.maxShortEdge: 2000` and removes maxPixels by setting it to undefined (the merge mechanism only sets keys present in ephemeralSettings, so we cannot "unset" maxPixels from the earlier rule this way).

The simplest approach consistent with the existing rule structure: add a later rule matching GPT-5.2+ models that overrides `maxLongEdge` and `maxShortEdge` to `2000`. The `maxPixels: 1,572,864` from the broad `^gpt-` rule remains via key merge and is the binding constraint for near-square images: a 2000x1250 image (2.5M pixels) still exceeds 1.57M pixels, so a 4000x2500 source lands at approximately 1586x991 (scale 0.3966 from the pixel limit, below the 0.5 edge scale). This is intentional: 1,572,864 pixels is the 1536-patch budget (1536 x 32 x 32), so the resized image sits at or just under the patch cap and the backend charge lands at the 1,844-token ceiling (ceil(1.2 x 1536)) instead of the uncapped 11,850 the BEFORE run measured.

Update existing assertions in `providerAliases.modelDefaults.test.ts` that expect `expectNoImageResizeDefaults('o4-mini', ...)` to reflect the new state (o4-mini still matches `^gpt-` so it gets the 2048 defaults; GPT-5.2+ models get the 2000 override). Keep anthropic/gemini expectations untouched.

Add a propagation test proving gpt-5.6-sol under the codex alias ends up with `image-resize.maxLongEdge: 2000` in ephemeral settings, following the pattern in `provider-alias-defaults.propagation.test.ts`.

## Risk analysis

### Capability impact of 2000px cap

- Text/UI legibility at 2000px: preserved. A 2000px long edge is sufficient for reading text in screenshots, code editors, and UI captures. The anthropic alias already uses 1568px for older Claude models and 2000px hard cap for Claude 5 targets.
- Images arrive as PNG re-encode: the resize pipeline re-encodes to the source format (PNG in the test case), so quality loss is minimal for screenshots with flat colors.
- maxPixels remains the binding constraint: the 1,572,864-pixel limit from the broad `^gpt-` rule (1536 patches x 32 x 32) binds before the 2000px edges for typical aspect ratios (4000x2500 -> ~1586x991 via maxPixels); the 2000px edges bind for elongated images. Either way the resized image sits at or under the 1536-patch budget, so the backend charge lands at or below the 1,844-token ceiling.
- User overridability: all image-resize settings are overridable by user ephemeral settings, as with the anthropic defaults. The model-facing `skip_image_resize` parameter was removed (see root cause 2); the only opt-out is the settings-level `image-resize.enabled=false`.

## Test plan

### Estimator tests (imageTokenEstimation.bun.ts)

- Patch formula for GPT-5.2+ model: 1920x1080 -> ceil(1.2 x 60 x 34) = 2448 -> capped at 1844
- Patch formula for GPT-5.2+ model: 1000x800 -> ceil(1.2 x 32 x 25) = 960
- Patch formula for GPT-5.2+ model: 4000x2500 -> 1844 (capped)
- Legacy formula still used for gpt-4o: 1024x1024 -> 765
- Legacy formula still used for o4-mini: 1024x1024 -> 765
- gpt-5.1 not matched: uses legacy formula
- gpt-5.6-sol matched: uses patch formula
- Unknown openai model: uses patch formula (conservative-high)
- Unknown dimensions with model GPT-5.2+: 1844
- Unknown dimensions with legacy model: 1105
- estimateNonTextPartTokens threads model field

### Provider alias tests (providerAliases.modelDefaults.test.ts)

- GPT-5.2+ models under openai/codex get maxLongEdge 2000, maxShortEdge 2000
- o4-mini under openai/codex still gets 2048/2048/1572864 (from broad `^gpt-` rule)
- anthropic/gemini expectations unchanged

### Propagation test (provider-alias-defaults.propagation.test.ts)

- gpt-5.6-sol under codex alias: ephemeral settings contain image-resize.maxLongEdge 2000

## BEFORE/AFTER metrics

Test: `bun scripts/start.ts --profile-load gpt56solhigh "Use the read_file tool on tmp/verify3477/big.png, then describe exactly what you see in the image in one sentence."` on the same 4000x2500 source PNG. AFTER rows are two independent runs on the fix branch (sessions 8f619984, 3ab7e7c3); both resized deterministically (media object e852504a, content-addressed, identical both runs).

| Metric | BEFORE (dev/0.12.0) | AFTER run 1 | AFTER run 2 |
| --- | --- | --- | --- |
| Image dimensions sent | 4000x2500 | 1586x991 | 1586x991 |
| PNG bytes | 362,220 | 172,240 (-52.5%) | 172,240 |
| Base64 wire bytes | 482,960 | 229,654 (-52.4%) | 229,654 |
| Turn-1 actual_prompt_tokens (no image) | 7,873 | 7,843 | 7,843 |
| Turn-2 actual_prompt_tokens (image turn) | 19,803 | 9,789 | 9,777 |
| Image-turn input-token delta | +11,930 | +1,946 (-83.7%) | +1,934 |
| cached_tokens (turn 2) | 7,680 | 7,680 | 7,680 |
| output_tokens (turn 2) | 141 | 101 | 134 |
| Local estimator (with model threaded) | 1,105 (legacy, wrong family formula) | 1,844 | 1,844 |
| Model description accurate | yes | yes | yes |

Turn-1 actual dropped 30 tokens (7,873 -> 7,843) after removing the `skip_image_resize` schema property and its description from the tool payload, which corroborates the param removal.

### Empirical findings and caveats

1. **gpt-5.6-sol charged UNCAPPED patch tokens.** The BEFORE delta (11,930) matches `ceil(1.2 x 125 x 79) = 11,850` uncapped, not the 1,844 documented 1536-patch cap for gpt-5.2/5.5. So the estimator's `min(patches, 1536)` cap is optimistic for gpt-5.6-sol when images above the patch budget are actually sent. This is moot in practice once resize fires (resized images sit at or under 1536 patches, so capped and uncapped agree at 1,844), and resize is the mechanism doing the real quota protection. The estimator follows the published gpt-5.2+ formula; the backend evidently changed under it.
2. **Runtime `estimated_tokens` anomaly (follow-up filed).** The estimator functions verify correct in isolation (probe: 1,844 for 1586x991 with the model threaded), yet the persisted turn-2 `estimated_tokens` is ~16.4k, a ~7.9k delta over turn-1, matching neither 1,844 (patch), 1,105 (legacy), nor 11,850 (uncapped full-res). The runtime history-estimation path appears to over-count image tool turns by ~4x versus actuals (16.4k est vs 9.8k actual), which risks premature context compression. Filed as #3481; not in scope here.
3. **Determinism.** Before the fix, the same prompt skipped resize in 2 of 3 runs (model-set `skip_image_resize`); after removing the param, both runs resized identically. The resize decision is now fully client-controlled.

## Acceptance criteria

- Patch formula estimator produces correct values for GPT-5.2+ models
- Legacy tile formula preserved for gpt-4o/o4-mini/gpt-5.0/gpt-5.1
- Unknown openai model defaults to patch formula
- openai and codex alias configs include 2000px resize defaults for GPT-5.2+
- Propagation test proves gpt-5.6-sol under codex gets 2000px long edge
- Full test suite, lint, typecheck, format, and build pass
- Smoke run shows reduced image token delta and accurate model description