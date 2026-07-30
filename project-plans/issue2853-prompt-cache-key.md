# Issue #2853 — prompt cache key bug again

## Summary
Subagent requests via the OpenAI **Chat Completions** transport send
`prompt_cache_key` values longer than 64 chars, producing API 400 errors:
`Invalid 'prompt_cache_key': string too long. Expected ... maximum length 64,
but got ... length 69`.

The Responses transport already sanitizes; Chat Completions does not.

## Root cause
`packages/providers/src/openai/OpenAIRequestPreparation.ts`
`applyRequestBodyOverrides()` (L169–198) does:
```ts
const requestOverrides = extractModelParamsFromOptions(options);
Object.assign(requestBody, requestOverrides);
```
`extractModelParamsFromOptions` pulls `options.invocation.modelParams` raw.
When a subagent runtime ID (e.g. `<uuid>#fallbacktypescriptcoder#a1b2c3d4`
= 69 chars) is the source of `prompt_cache_key`, it is forwarded to the
wire unchanged → 400.

A helper, `filterOpenAIRequestParams()` in `openaiRequestParams.ts`, already
sanitizes (clamps to 64, drops empty/non-string) with full unit coverage —
but it is never invoked by the Chat Completions production path.

## Acceptance matrix
| # | Behavior | Evidence |
|---|----------|----------|
| A1 | Chat Completions request body never contains a `prompt_cache_key` longer than 64 chars | Regression test in `OpenAIRequestPreparation.issue2853.test.ts`: supply a 69-char subagent-style runtimeId in `modelParams.prompt_cache_key`; assert emitted `requestBody.prompt_cache_key.length <= 64` and starts with `rk:` |
| A2 | Short, valid `prompt_cache_key` passes through unchanged | Regression test: 20-char key emitted verbatim |
| A3 | Empty / whitespace-only `prompt_cache_key` is dropped, not forwarded | Regression test |
| A4 | Non-string `prompt_cache_key` is dropped, not forwarded | Regression test |
| A5 | Other model params (temperature, max_tokens, reasoning_effort, top_p) still flow through `applyRequestBodyOverrides` unchanged | Existing `OpenAIRequestPreparation.issue1943.test.ts` still passes |
| A6 | Responses transport behavior is unchanged | Existing `OpenAIResponsesProvider.promptCacheKey.test.ts` + `sanitizePromptCacheKey.test.ts` still pass |

## Non-goals
- Do NOT modify runtime ID composition in `packages/agents` or `packages/core`.
- Do NOT introduce a new sanitizer; reuse `filterOpenAIRequestParams()` +
  `sanitizePromptCacheKey()`.
- Do NOT add a default cache key when none is supplied.
- Do NOT touch the Responses executor/transport (already correct).
- Do NOT add tests inside subagent orchestration code.

## Bounded vertical slices
1. **Test-first** — add `OpenAIRequestPreparation.issue2853.test.ts` with
   A1–A4 (RED before fix).
2. **Fix** — sanitize only `prompt_cache_key` in
   `applyRequestBodyOverrides()` (targeted, not a broad allowlist filter,
   so provider-specific extensions and canonical Chat Completions fields
   continue to pass through). Reuse `sanitizePromptCacheKey()`.
3. **Verify** — full suite + smoke test.

## Scope ledger
| File | Change type | Status |
|------|-------------|--------|
| `packages/providers/src/openai/OpenAIRequestPreparation.ts` | Production fix (targeted cache-key sanitization) | done |
| `packages/providers/src/openai/OpenAIRequestPreparation.issue2853.test.ts` | New regression test | done |

Target: 1 production file (43 insertions, 4 deletions) + 1 new test file. Well within budget.

## Design decision (post DeepThinker review)
The initial approach applied the closed allowlist `filterOpenAIRequestParams()`
to all model params. DeepThinker correctly flagged this as a Blocker: it
silently drops valid canonical Chat Completions fields (`service_tier`,
`store`, `verbosity`, `web_search_options`) and provider-specific
extensions used by OpenAI-compatible aliases. The revised approach does
**targeted sanitization of only `prompt_cache_key`** via a new
`sanitizeOverridesCacheKey()` helper, preserving all other model params
unchanged.
