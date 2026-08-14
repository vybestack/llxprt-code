# Issue 3216 — Image dimension preflight and Anthropic recovery

Plan ID: `PLAN-20260813-ISSUE3216`

## Intent

Prevent oversized image bytes from reaching a provider, return an actionable tool error before the bytes enter history, and recover an Anthropic request whose existing history already contains an image rejected by Anthropic's many-image dimension limit.

## Grounded findings

- `read_file` and `read_many_files` produce image `inlineData` through `processSingleFileContent` in `packages/tools/src/utils/fileUtils.ts`.
- `generate_image` is the other built-in tool that directly emits image `inlineData`.
- Image header dimensions can already be parsed without decoding the full image through `packages/tools/src/utils/imageDimensions.ts`.
- Existing `image-resize.*` ephemerals perform opt-in/configured transformation. Dimension preflight is a separate hard output budget and must still run after any configured resize. It must not silently resize by default.
- `claudecode.config` currently supplies automatic resize defaults for broad Opus/Sonnet model matching. Those defaults would make a 3000-pixel image silently pass and therefore conflict with the requested hard-error behavior.
- Anthropic requests are built from immutable `IContent[]` in `AnthropicRequestPreparation.ts` and sent in `AnthropicProvider.ts`; recovery can construct a sanitized request copy without mutating shared history.

## Requirements

### REQ-3216-001 — Configurable hard image budget

- Add positive-integer ephemeral settings `max-image-dimension` and `max-image-pixels`.
- Make both settings valid in profiles/model alias defaults and available through the existing `/set` and profile pipelines.
- No configured value means no new provider-independent hard limit.
- Configure `max-image-dimension: 2000` in the `claudecode` model defaults for Claude Opus 5, Claude Opus 4.8, and Claude Sonnet 5.
- Preserve explicit automatic resizing as a separate feature, but remove conflicting automatic resize defaults for these models so an oversized image fails unless the user explicitly opts into resizing.

### REQ-3216-002 — Preflight every built-in image-producing tool

- After any explicit resize and before returning bytes, inspect each base64 image emitted by `read_file`, `read_many_files`, or `generate_image`.
- If width, height, or total pixels exceed the active budget, omit the bytes and return a real tool error.
- The model-facing error must include the actual dimensions, the configured dimension/pixel goal that was exceeded, the image identity when available, and a direct instruction to create/read a thumbnail or downscale first.
- An image at or below every configured boundary must be returned unchanged.
- Non-image media and image formats whose dimensions cannot be parsed must retain existing behavior; do not invent a dimension.

### REQ-3216-003 — Anthropic poisoned-history recovery

- Recognize only Anthropic HTTP 400 invalid-request failures that state an image dimension exceeded the many-image maximum; unrelated 400 responses must retain existing behavior.
- Replace offending oversized base64 image blocks in a request-local immutable content copy with short text placeholders recording that the image was dropped and why.
- Retry the request exactly once with the sanitized copy. Never loop, and never use the ordinary transient retry budget for repeated recovery.
- Preserve tool-call/tool-response validity and all unaffected content.
- If no offending image can be identified and removed, rethrow the original error.
- Apply equivalent preflight sanitization to an already-poisoned history when the active configured budget identifies an oversized image, so later turns do not repeatedly send known-invalid bytes.

## Test-first execution

1. **RED — settings and alias defaults**
   - Add Bun tests proving both new keys accept positive integers, reject invalid values, persist through profile ephemerals, and propagate from model alias defaults without overriding user-set values.
   - Add an alias configuration test proving only the required Claude models receive the 2000-pixel default and that the old implicit resize defaults no longer mask the hard error.
2. **GREEN — settings registration**
   - Add the profile types, registry entries, and alias defaults needed to pass those tests.
3. **RED — image-budget utility and tool integration**
   - Add Bun behavioral tests using real image bytes for below-boundary, exact-boundary, oversized-dimension, oversized-total-pixel, post-explicit-resize, unparseable-image, and non-image cases.
   - Drive the real `read_file`, `read_many_files`, and `generate_image` result paths; mock only external image-generation transport where unavoidable, never the budget logic or tool under test.
   - Assert oversized results contain no base64 image bytes and are classified as tool errors with actionable thumbnail/downscale guidance.
4. **GREEN — shared preflight implementation**
   - Implement one pure budget parser/checker shared by all built-in image-producing tools, then wire it at their output boundaries.
5. **RED — Anthropic recovery integration**
   - Add Bun provider tests with real `IContent` media blocks and a fake transport that first returns the exact Anthropic 400 shape, then accepts the sanitized retry.
   - Prove one retry, immutable input history, placeholder insertion, unaffected media preservation, no retry for unrelated 400s, no retry when nothing can be removed, and no second recovery attempt.
   - Add a known-invalid-history test proving proactive request preparation omits the oversized bytes before transport while a later valid image remains visible.
6. **GREEN — request sanitization and bounded retry**
   - Implement immutable Anthropic content sanitization and the specific one-shot recovery path at the provider request boundary.
7. **Regression and manual verification**
   - Run focused Bun tests after each RED/GREEN step, then the complete required verification suite: `npm run test`, `npm run lint`, `npm run typecheck`, `npm run format`, and `npm run build`.
   - Run the standard smoke test: `bun scripts/start.ts --profile-load stepfun-37 "write me a haiku and nothing else"`.
   - Create real 3000-pixel and 1800-pixel image fixtures outside tracked source and run `bun scripts/start.ts --profile-load opus5` prompts that call `read_file` on each. Capture evidence that 3000 pixels returns the actionable tool error without provider rejection and 1800 pixels is delivered successfully.

## Guardrails

- Use TypeScript and `bun:test` for every new or changed test.
- Follow strict RED → GREEN → REFACTOR ordering and verify each new test fails for the intended missing behavior before production changes.
- Do not add lint/type suppressions, loosen lint or complexity thresholds, or exclude files from linting.
- Keep all transformations immutable and fail fast for invalid setting values.
- Do not silently downscale unless the existing explicit image-resize configuration requests it.
