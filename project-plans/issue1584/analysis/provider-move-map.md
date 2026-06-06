# Provider Move Map

Plan ID: PLAN-20260603-ISSUE1584

## Directory Move Rules

| Source | Destination | Notes |
|--------|-------------|-------|
| `packages/core/src/providers/anthropic/` | `packages/providers/src/anthropic/` | Move all implementation, tests, fixtures. |
| `packages/core/src/providers/gemini/` | `packages/providers/src/gemini/` | Move all provider implementation code. |
| `packages/core/src/providers/openai/` | `packages/providers/src/openai/` | Move all implementation, tests, fixtures. |
| `packages/core/src/providers/openai-responses/` | `packages/providers/src/openai-responses/` | Move all implementation, tests, fixtures. |
| `packages/core/src/providers/openai-vercel/` | `packages/providers/src/openai-vercel/` | Move all implementation, tests, fixtures. |
| `packages/core/src/providers/fake/` | `packages/providers/src/fake/` | Move fake provider and tests. |
| `packages/core/src/providers/tokenizers/` | `packages/providers/src/tokenizers/` | Concrete tokenizers move; core uses injection contract. |
| `packages/core/src/providers/logging/` | `packages/providers/src/logging/` | Move provider logging support. |
| `packages/core/src/providers/reasoning/` | `packages/providers/src/reasoning/` | Move provider reasoning support unless P01 finds core-owned exceptions. |
| `packages/core/src/providers/types/` | `packages/providers/src/types/` | Move provider public API types. |
| Provider top-level implementation files | `packages/providers/src/` | Move according to public API needs. |

## Explicit Exception Rules

- Shared tool normalization used by core remains/moves to a core utility path and is imported by providers from core.
- Runtime missing-provider errors used by core remain/move to core runtime error module.
- Core internal structural contracts do not live under `packages/core/src/providers` and must not be named as provider compatibility shims.

## P09/P11 Required Validation

```bash
find packages/core/src/providers -type f | sort > before-provider-files.txt
find packages/providers/src -type f | sort > after-provider-files.txt
rg -n "ProviderManager|ProviderContentGenerator|OpenAIProvider|AnthropicProvider|GeminiProvider|FakeProvider" packages/core/src --glob '*.ts' --glob '!**/*.test.ts' --glob '!**/*.spec.ts'
```

After cleanup, the final command must not show production core imports or exports of concrete provider implementation names.
