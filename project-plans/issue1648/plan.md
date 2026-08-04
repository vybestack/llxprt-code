# Issue #1648 — Provider-aware image token estimation

Plan ID: `PLAN-20260803-ISSUE1648`

## 1. Problem (verified against the codebase)

| # | Claim in issue | Verified state on `main` |
|---|---|---|
| 1 | Compression strategies ignore image tokens | **TRUE.** `packages/core/src/services/history/historyTokenEstimation.ts` `blockToEstimationText()` maps `case 'media': return block.caption ?? ''`. With no caption the block contributes **0 tokens**. `CompressionHandler.ts` injects `estimateTokens: (contents) => historyService.estimateTokensForContents(contents)`, which routes through that exact function. So `HighDensityStrategy` / `TopDownTruncationStrategy` see images as free. |
| 2 | `toolOutputLimiter.ts` has no image awareness | **TRUE but not reachable.** Every call site of `estimateTokens(text: string)` (core and tools copies) receives a plain `string`; `Part[]` / `MediaBlock` / binary never reaches it. |
| 3 | `read-many-files.ts` hardcodes `85` | **TRUE.** `packages/tools/src/tools/read-many-files.ts` `addFileContent()` uses `const estimatedTokens = 85` for every non-text part (images, PDFs, audio). |

## 2. Accepted behaviour (acceptance criteria)

### AC-1 — Provider-aware image token estimator
A pure, dependency-free estimator exists and is the single source of truth for image token cost.

`estimateImageTokens({ provider?, dimensions? }): number`

Provider family resolution (case-insensitive **substring** match on the provider name,
mirroring the tokenizer matchers in `providerManagerInstance.ts` so alias providers that
wrap a backing platform — `claudecode`, `codex`, `azure-openai` — resolve to the platform
they proxy rather than falling through to the default):

| Provider name contains | Family |
|---|---|
| `anthropic`, `claude` | `anthropic` |
| `gemini`, `google` | `gemini` |
| `openai`, `codex` | `openai` |
| anything else / `undefined` | `default` |

Formulas:

- **anthropic** — downscale until both documented limits hold (never upscaling): long edge
  at most `1568` px, and total pixels at most `1092 * 1092` (Anthropic's largest accepted
  1:1 image). Then `Math.ceil(pixels / 750)`.
  Reference values from Anthropic docs: `1092x1092 -> 1590`, `200x200 -> 54`.
  The pixel ceiling means no image can be charged more than `1590` tokens, which keeps the
  known-dimension path consistent with the unknown-dimension fallback.
- **openai** (high detail) — (a) scale to fit inside `2048x2048` preserving aspect ratio; (b) scale so the shortest side is exactly `768`; (c) `tiles = ceil(w/512) * ceil(h/512)` computed on the **unrounded** scaled dimensions, with a `1e-6` tolerance so a side that lands mathematically on a tile edge does not gain a phantom tile; (d) `tokens = 170 * tiles + 85`.
  Reference values from OpenAI docs: `1024x1024 -> 765`, `2048x4096 -> 1105`.
  Boundary evidence: `4000x3000 -> 765` (exactly `1024x768`) but `4001x3000 -> 1105`
  (`~1024.26x768`, which needs a third tile column).
- **gemini** — flat `3000` regardless of dimensions (upstream `IMAGE_TOKEN_ESTIMATE`; Google publishes no client-side formula). Explicitly the behaviour named in the issue.
- **default** — flat `1000` (issue-specified: better than `85`, safer than `3000`).

Unknown dimensions (`dimensions` omitted or unparseable) resolve to a per-family documented constant:

| Family | Unknown-dimension tokens | Rationale |
|---|---|---|
| anthropic | `1590` | the cost of Anthropic's largest accepted image, i.e. the true maximum the known-dimension path can return |
| openai | `1105` | the larger of OpenAI's two published high-detail examples (`2048x4096`) |
| gemini | `3000` | same flat constant |
| default | `1000` | issue-specified fallback |

The OpenAI tile formula has **no** finite maximum because the aspect ratio is unbounded
(`4096x1024 -> 2125`), so no constant can dominate every known-dimension result. A
documented example is preferred over an arbitrarily large constant that would make
context compression fire spuriously for every URL-referenced image.

Boundary rules: non-finite, zero, or negative dimensions are treated as unknown. Results are always positive integers.

### AC-2 — Dependency-free image dimension parsing
`parseImageDimensions(bytes): { width, height } | undefined` reads dimensions from raw header bytes for **PNG**, **JPEG**, **GIF**, and **WEBP** (VP8 / VP8L / VP8X). It returns `undefined` for unrecognised, truncated, or corrupt input — it never throws.

`parseImageDimensionsFromBase64(base64): { width, height } | undefined` decodes a bounded prefix of the base64 payload (enough to cover JPEG EXIF-heavy headers) and delegates to `parseImageDimensions`. It tolerates `data:` URI prefixes and embedded whitespace, and returns `undefined` on invalid base64.

Rationale for a hand-rolled parser: `sharp` exists only in `packages/tools` and requires a full decode; header parsing is a few dozen bytes and works in every package.

### AC-3 — History / compression estimation counts images
`estimateContentTokens()` in `packages/core/src/services/history/historyTokenEstimation.ts`:

- For a `media` block whose `mimeType` starts with `image/`: token cost = tokens for `caption` (via the injected tokenizer, unchanged behaviour) **plus** `estimateImageTokens({ provider, dimensions })`.
  - `encoding === 'base64'` -> dimensions parsed from the payload.
  - `encoding === 'url'` -> dimensions unknown -> per-family unknown constant.
- For a `media` block with a non-image MIME type: behaviour is **unchanged** (caption only). Audio/PDF estimation is out of scope for this issue.
- The active provider reaches the estimator through the existing `TokenizerProvider` abstraction (`HistoryService` already tracks `activeTokenizationProvider`). No new public subsystem.

Consequence proven by test: `HistoryService.estimateTokensForContents()` — the exact function `CompressionHandler` injects as `CompressionContext.estimateTokens` — returns a materially larger number for history containing images, and the number varies by active provider. A strategy-level test drives `TopDownTruncationStrategy` with that real estimator and shows an image changes the truncation outcome.

The load-balancer estimator (`loadBalancerTokenEstimator.ts`) shares this estimation path and previously discarded the selected subprofile's provider name; it now propagates it on both the tokenizer and generic paths so load-balanced requests get the same provider-aware image accounting.

### AC-4 — `read-many-files` no longer hardcodes 85
`addFileContent()` estimates non-text parts as:

- `image/*` -> `estimateImageTokens({ dimensions: parseImageDimensionsFromBase64(data) })`. The tool layer has no provider handle (`IToolHost` exposes none), so the `default` family applies. This is exactly the issue's stated minimum ("at minimum raise it to 1000+ as a safer default") while routing through the shared estimator instead of a second magic number.
- non-image non-text (PDF, audio, video) -> the same exported `default` constant.

The literal `85` is removed.

### AC-5 — `toolOutputLimiter` — no change, with evidence
Every call site passes a `string`; no `Part[]`/media path exists. Changing it would be speculative. Recorded here as a deliberate no-op finding.

## 3. Out of scope (explicitly not doing)

- Server-side `countTokens` calls for Gemini.
- Dimension-aware Gemini estimation (issue specifies the flat constant).
- Audio / PDF / video token estimation.
- Adding a provider accessor to `IToolHost` (public abstraction change; would need approval).
- Unifying the separate `loadBalancerTokenEstimator` media heuristic.
- Any change to lint/complexity configuration.

## 4. Placement and dependency boundary

`packages/core` **must not** import `packages/providers`. Dependency edges that already exist: `core -> tools`, and `tools -> (nothing)`.

Therefore the estimator lives in the leaf package next to the existing `imageResize.ts`:

- `packages/tools/src/utils/imageDimensions.ts`
- `packages/tools/src/utils/imageTokenEstimation.ts`

Both get subpath entries in `packages/tools/package.json` `exports` (mirroring the existing `./utils/*.js` entries) plus barrel re-exports in `packages/tools/index.ts`. `packages/core` imports them by subpath so the history hot path does not pull the whole tools barrel.

## 5. Test-first plan (behavioural, no mock theatre)

Order: every test below is written and observed failing before the corresponding production code.

### T1 — `packages/tools/test-bun/imageDimensions.bun.ts` (bun, registered in `scripts/bun-test-manifest.ts` under the `tools` workspace)
- PNG built from a real IHDR header -> exact `{width, height}`.
- JPEG with a baseline SOF0 -> exact dimensions.
- JPEG with a large APP1/EXIF segment before SOF -> exact dimensions (proves marker walking).
- GIF87a / GIF89a -> exact dimensions (little-endian).
- WEBP lossy (`VP8 `), lossless (`VP8L`), extended (`VP8X`) -> exact dimensions.
- Truncated PNG / random bytes / empty input -> `undefined`, no throw.
- Base64 variant: `data:image/png;base64,...` prefix, whitespace-wrapped base64, invalid base64 -> correct value / `undefined`.

### T2 — `packages/tools/test-bun/imageTokenEstimation.bun.ts` (bun, registered in the manifest)
- Anthropic reference values `1092x1092 -> 1590`, `200x200 -> 54`.
- Anthropic long-edge clamp: `3136x1568` collapses to the `1568`-capped result; a small image is never upscaled.
- OpenAI reference values `1024x1024 -> 765`, `2048x4096 -> 1105`.
- OpenAI tile boundary: shortest-side normalisation to `768` and `512`-tile rounding.
- Gemini flat `3000` for several sizes and for unknown dimensions.
- Unknown provider -> `1000`.
- Unknown dimensions per family -> the documented constants.
- Provider name case-insensitivity and alias handling (`Claude`, `GOOGLE`).
- Degenerate dimensions (`0`, negative, `NaN`, `Infinity`) -> treated as unknown.

### T3 — `packages/core/src/services/history/historyTokenEstimation.imageTokens.test.ts` (bun; core auto-discovers)
- `IContent` with a base64 PNG `media` block and provider `anthropic` -> total equals caption tokens + the Anthropic formula for the embedded dimensions.
- Same content with provider `openai` and with `gemini` -> different, provider-specific totals (proves provider awareness, not a constant).
- `media` block with `encoding: 'url'` -> the unknown-dimension constant for that family.
- `media` block with `mimeType: 'audio/mpeg'` -> unchanged caption-only behaviour.
- Mixed text + image content -> text tokens and image tokens both present and additive.
- Unknown/absent provider -> `1000` default.

### T4 — compression-facing evidence (bun, core)
Through a real `HistoryService` (`setActiveTokenizationTarget`, then `estimateTokensForContents`) — the exact call `CompressionHandler` injects into `CompressionContext.estimateTokens`:
- history containing an image returns materially more tokens than the same history with the image removed;
- the delta matches the estimator for the configured provider.

### T5 — `read-many-files` non-text accounting
Extend the existing `packages/tools/src/__tests__/read-many-files-filtering-behavior.test.ts` (no new vitest file):
- reading an image whose estimate exceeds `tool-output-max-tokens` is skipped with the existing "would exceed token limit (non-text content)" reason, at a budget that would have passed under the old `85`;
- the reported total token count reflects the new estimate.

## 6. Verification gates

`npm run test`, `npm run lint`, `npm run typecheck`, `npm run format`, `npm run build`, and
`bun scripts/start.ts --profile-load stepfun-37 "write me a haiku and nothing else"`.

No `eslint-disable`, no TS suppression directives, no complexity-threshold changes.
