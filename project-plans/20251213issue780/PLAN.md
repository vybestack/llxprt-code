# Qwen OAuth for OpenAIVercelProvider (Issue #781) — Test-First Plan

**Date**: 2025-12-13  
**Branch**: `issue780`  
**Upstream Issue**: `vybestack/llxprt-code#781`  

## Goal

Enable Qwen OAuth to work with `OpenAIVercelProvider` (Vercel AI SDK) using the existing OAuth plumbing (`AuthPrecedenceResolver` → `OAuthManager.getToken('qwen')`) and the existing user surface (`/auth qwen`).

## Constraints / Non-goals

- Do not enable OAuth for non-Qwen OpenAI endpoints by default.
- Do not break existing `qwen` provider behavior.
- Do not attempt to plumb Qwen `resource_url` into provider base URLs in this change (follow-up).

## Current State (Code Cross-Reference)

- Core hard-disables OAuth for `OpenAIVercelProvider`:
  - `packages/core/src/providers/openai-vercel/OpenAIVercelProvider.ts`
    - `isOAuthEnabled: false`
    - `oauthProvider: undefined`
    - `supportsOAuth(): false`
- CLI does not pass the shared `oauthManager` when constructing `OpenAIVercelProvider`:
  - `packages/cli/src/providers/providerManagerInstance.ts`
- CLI currently registers `qwen` via a bespoke `getQwenProvider()` hack:
  - `packages/cli/src/providers/providerManagerInstance.ts`

## Implementation Strategy

Use test-first (RED → GREEN → REFACTOR) and implement the smallest set of changes that:

1. Makes `OpenAIVercelProvider` behave like `OpenAIProvider` for Qwen OAuth detection (base URL + `forceQwenOAuth`).
2. Wires the CLI so `OpenAIVercelProvider` receives the shared `oauthManager`.
3. Provides a stable selection mechanism for the Vercel implementation with Qwen OAuth, without requiring ad-hoc hacks.

## PHASE 1 — RED: Update/Add Tests (must fail first)

### 1A) Core: Update existing OAuth support test (preferred)

**Modify** `packages/core/src/providers/openai-vercel/OpenAIVercelProvider.test.ts`

- Replace the current “should not support OAuth” assertion with expectations for Qwen:
  - `supportsOAuth()` is `true` when:
    - `baseURL` is a Qwen endpoint (e.g. `https://portal.qwen.ai/v1`), OR
    - `providerConfig.forceQwenOAuth === true`
  - `supportsOAuth()` remains `false` for non-Qwen base URLs without `forceQwenOAuth`.

This should fail immediately because `OpenAIVercelProvider` currently returns `false`.

### 1B) Core: Add a behavioral test that expects OAuth token to be used

**Add** a new test (or extend an existing one) under:
- `packages/core/src/providers/openai-vercel/nonStreaming.test.ts` (preferred because it already mocks `@ai-sdk/openai`)

Test expectation (new behavior):
- With:
  - no constructor API key,
  - Qwen base URL,
  - `forceQwenOAuth: true`,
  - a mock `oauthManager.getToken('qwen') → 'oauth-token'`,
- The provider should successfully start a generation and call:
  - `createOpenAI({ apiKey: 'oauth-token', baseURL: 'https://portal.qwen.ai/v1', ... })`

This should fail before implementation because OAuth is disabled in the provider config and auth resolution won’t call the OAuth manager.

### 1C) CLI: Add a wiring test (constructor args)

**Add** a test in `packages/cli/src/providers/providerManagerInstance.oauthRegistration.test.ts` (or a new adjacent test file) that:

- Mocks `@vybestack/llxprt-code-core`’s `OpenAIVercelProvider` constructor.
- Calls `getProviderManager()` or `createProviderManager()`.
- Asserts `OpenAIVercelProvider` is constructed with the shared `oauthManager` argument.

This should fail before implementation because the CLI currently constructs `OpenAIVercelProvider` with only `(apiKey, baseURL)`.

## PHASE 2 — GREEN: Implement the Behavior

### 2A) Core: Enable Qwen OAuth in `OpenAIVercelProvider`

**Edit** `packages/core/src/providers/openai-vercel/OpenAIVercelProvider.ts`

- Add Qwen endpoint detection (match `OpenAIProvider` style) and include `portal.qwen.ai`/`dashscope.aliyuncs.com`.
- Read `forceQwenOAuth` from provider config.
- Pass to `super(...)`:
  - `isOAuthEnabled: (isQwenEndpoint || forceQwenOAuth) && !!oauthManager`
  - `oauthProvider: (isQwenEndpoint || forceQwenOAuth) ? 'qwen' : undefined`
- Implement `supportsOAuth()` to return `true` for Qwen endpoints or when `forceQwenOAuth` is set.

### 2B) CLI: Wire `oauthManager` into `OpenAIVercelProvider`

**Edit** `packages/cli/src/providers/providerManagerInstance.ts`

- Construct `OpenAIVercelProvider` with `(openaiApiKey, openaiBaseUrl, openaiProviderConfig, oauthManager)` (mirrors `OpenAIProvider` wiring).

### 2C) CLI: Replace the bespoke qwen provider hack with built-in aliases

**Add** built-in alias configs:
- `packages/cli/src/providers/aliases/qwen.config`
- `packages/cli/src/providers/aliases/qwenvercel.config`

And **extend** alias registration to support `baseProvider: 'openaivercel'` so `qwenvercel` can be an alias backed by `OpenAIVercelProvider`.

Then **remove** `getQwenProvider()` and its registration call from:
- `packages/cli/src/providers/providerManagerInstance.ts`

## PHASE 3 — Verification + PR

### Local Verification (targeted)

- Core targeted tests (fast iteration):
  - `npm run test --workspace @vybestack/llxprt-code-core -- src/providers/openai-vercel/OpenAIVercelProvider.test.ts`
  - `npm run test --workspace @vybestack/llxprt-code-core -- src/providers/openai-vercel/nonStreaming.test.ts`
- CLI targeted tests:
  - `npm run test --workspace @vybestack/llxprt-code -- src/providers/providerManagerInstance.oauthRegistration.test.ts`

### Completion Checklist (repo root, required before finishing)

Run in order:
1. `npm run format`
2. `npm run lint`
3. `npm run typecheck`
4. `npm run test`
5. `npm run build`
6. `node scripts/start.js --profile-load synthetic --prompt "write me a haiku"`

### Git + PR

- `git add -A`
- `git commit -m "Fix: Qwen OAuth for OpenAIVercelProvider"`
- `git push -u origin issue780`
- `gh pr create --fill --repo vybestack/llxprt-code`

---

# Addendum — Qwen Vercel Provider Fix: "developer" Role Rejection

## Problem

When using the Vercel-based provider against Qwen (e.g. `/provider qwenvercel`), Qwen rejects the OpenAI Chat Completions request if any message has `role: "developer"`:

- Error: `developer is not one of ['system', 'assistant', 'user', 'tool', 'function'] - 'messages.[0].role'`

Root cause: `@ai-sdk/openai` maps system prompts to the OpenAI `"developer"` role when the model id is not a known `gpt-*`/`chatgpt-*` prefix; Qwen’s OpenAI-compatible endpoint rejects that role.

## PHASE 4 — RED → GREEN: Rewrite developer→system for Qwen endpoints

### 4A) RED: Add an integration test that fails before the fix

**Modify** `packages/core/src/providers/openai-vercel/OpenAIVercelProvider.test.ts`

- Add a test that stubs `global.fetch` and returns a Qwen-style 400 error whenever it sees any `messages[].role === 'developer'`.
- Run `generateChatCompletion` using:
  - `baseURL: https://portal.qwen.ai/v1`
  - `model: qwen3-coder-plus`
- Assert the request uses `role: 'system'` (and never `'developer'`).

This should fail pre-fix because the underlying AI SDK emits a `"developer"` role.

### 4B) GREEN: Implement a fetch wrapper in `OpenAIVercelProvider`

**Edit** `packages/core/src/providers/openai-vercel/OpenAIVercelProvider.ts`

- Add a request-middleware fetch wrapper that:
  - Parses the JSON request body
  - Rewrites `messages[].role === 'developer'` → `'system'`
  - Preserves all other request fields
- Enable the wrapper only for:
  - Qwen endpoints (detected from `baseURL`), OR
  - `forceQwenOAuth: true` in provider config

### 4C) Verify (targeted)

- `npm run test --workspace @vybestack/llxprt-code-core -- src/providers/openai-vercel/OpenAIVercelProvider.test.ts`
