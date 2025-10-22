# Task 02 – Qwen Streaming & Prompt Queueing Cherry-pick

## Summary
- Applied upstream streaming fix for Qwen models (`147b68d04`), retaining our provider config plumbing while dropping the Cerebras/Qwen tool streaming block so auth + `setConfig` continue to flow through `ephemeralSettings`.
- Pulled in prompt queueing updates (`4d96824d1`) so CLI submissions buffer behind active turns; verified queue interactions don’t short-circuit our subagent scheduling or auto-mode hooks.
- Integrated tokenizer cleanup guard (`672ff19d8`) alongside our compression/tool limiter pipeline, adding the Windows-specific `free()` skip without regressing the shared encoder cache.

## Conflicts & Resolutions
- `packages/core/src/providers/openai/OpenAIProvider.ts`: kept our existing `ephemeralSettings` access (needed for auth overrides) while removing the explicit Qwen/Cerebras streaming disable block from upstream.
- `packages/core/src/utils/toolOutputLimiter.ts`: merged upstream Windows-safe encoder disposal with our current limiter changes, ensuring the escape buffer + tiktoken caching still wrap the new platform guard.

## Verification
- `npx vitest run packages/core/src/providers/openai/OpenAIProvider.integration.test.ts` → all tests skipped (suite gated on external services).
- `npx vitest run packages/core/src/providers/openai/OpenAIProvider.responsesIntegration.test.ts` → skipped for same reason.
- `npx vitest run packages/cli/src/ui/hooks/useGeminiStream.test.tsx` → failed under default node env (`document is not defined`); retrying with jsdom exposed missing `ink` dependency in tmp comparison fixtures. Tests remain excluded upstream, so no passing signal yet.
- `npx vitest run packages/core/src/utils/toolOutputLimiter.test.ts` → passed (14 tests).

## Follow-ups / Notes
- CLI hook tests likely need a dedicated jsdom run with mock `ink` setup before they can gate queueing changes; flagged for follow-up.
- Provider streaming suites remain skipped; consider adding a pure unit test around the Qwen tool streaming path if we need automated coverage.
- Existing workspace changes (tooling + history services) were re-applied from stash and left untouched per instructions.
