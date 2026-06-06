# Provider External Dependency Inventory

Plan ID: PLAN-20260603-ISSUE1584

Generated from current provider imports. P08/P11 must verify and update `packages/providers/package.json` so every direct runtime import from moved provider production code is declared in `dependencies`, and every direct test-only import is declared in `devDependencies`. Do not rely on transitive dependencies through core or CLI.

## Direct Import Inventory

| Package | Import Count | Expected providers package section | Example Provider Files |
|---------|--------------|------------------------------------|------------------------|
| `vitest` | 140 | devDependencies | `packages/core/src/providers/BaseProvider.test.ts`, `packages/core/src/providers/ProviderManager.gemini-switch.test.ts`, `packages/core/src/providers/ProviderManager.test.ts`, `packages/core/src/providers/__tests__/BaseProvider.guard.test.ts`, `packages/core/src/providers/__tests__/LoadBalancingProvider.circuitbreaker.test.ts` |
| `ai` | 59 | dependencies | `packages/core/src/providers/openai-vercel/OpenAIVercelProvider.caching.test.ts`, `packages/core/src/providers/openai-vercel/OpenAIVercelProvider.caching.test.ts`, `packages/core/src/providers/openai-vercel/OpenAIVercelProvider.caching.test.ts`, `packages/core/src/providers/openai-vercel/OpenAIVercelProvider.caching.test.ts`, `packages/core/src/providers/openai-vercel/OpenAIVercelProvider.caching.test.ts` |
| `openai` | 25 | dependencies | `packages/core/src/providers/openai/OpenAIApiExecution.ts`, `packages/core/src/providers/openai/OpenAIClientFactory.ts`, `packages/core/src/providers/openai/OpenAINonStreamHandler.ts`, `packages/core/src/providers/openai/OpenAIProvider.caching.test.ts`, `packages/core/src/providers/openai/OpenAIProvider.mistralCompatibility.test.ts` |
| `@google/genai` | 9 | dependencies | `packages/core/src/providers/ProviderContentGenerator.ts`, `packages/core/src/providers/ProviderContentGenerator.ts`, `packages/core/src/providers/fake/FakeProvider.ts`, `packages/core/src/providers/gemini/GeminiProvider.test.ts`, `packages/core/src/providers/gemini/GeminiProvider.ts` |
| `@anthropic-ai/sdk` | 8 | dependencies | `packages/core/src/providers/anthropic/AnthropicApiExecution.ts`, `packages/core/src/providers/anthropic/AnthropicProvider.stateless.test.ts`, `packages/core/src/providers/anthropic/AnthropicProvider.ts`, `packages/core/src/providers/anthropic/AnthropicProvider.ts`, `packages/core/src/providers/anthropic/AnthropicResponseParser.issue1844.test.ts` |
| `zod` | 7 | dependencies | `packages/core/src/providers/anthropic/usageInfo.ts`, `packages/core/src/providers/chutes/usageInfo.ts`, `packages/core/src/providers/gemini/usageInfo.ts`, `packages/core/src/providers/kimi/usageInfo.ts`, `packages/core/src/providers/openai/codexUsageInfo.ts` |
| `node:fs` | 4 | dependencies | `packages/core/src/providers/fake/FakeProvider.test.ts`, `packages/core/src/providers/fake/FakeProvider.ts`, `packages/core/src/providers/utils/dumpContext.test.ts`, `packages/core/src/providers/utils/dumpContext.ts` |
| `node:os` | 3 | dependencies | `packages/core/src/providers/fake/FakeProvider.test.ts`, `packages/core/src/providers/utils/dumpContext.test.ts`, `packages/core/src/providers/utils/dumpContext.ts` |
| `node:path` | 3 | dependencies | `packages/core/src/providers/fake/FakeProvider.test.ts`, `packages/core/src/providers/utils/dumpContext.test.ts`, `packages/core/src/providers/utils/dumpContext.ts` |
| `node:crypto` | 2 | dependencies | `packages/core/src/providers/gemini/GeminiProvider.ts`, `packages/core/src/providers/openai-vercel/OpenAIVercelProvider.ts` |
| `http` | 2 | dependencies | `packages/core/src/providers/openai/OpenAIClientFactory.test.ts`, `packages/core/src/providers/openai/OpenAIClientFactory.ts` |
| `https` | 2 | dependencies | `packages/core/src/providers/openai/OpenAIClientFactory.test.ts`, `packages/core/src/providers/openai/OpenAIClientFactory.ts` |
| `@ai-sdk/openai` | 2 | dependencies | `packages/core/src/providers/openai-vercel/OpenAIVercelProvider.ts`, `packages/core/src/providers/openai-vercel/nonStreaming.test.ts` |
| `node:async_hooks` | 1 | dependencies | `packages/core/src/providers/BaseProvider.ts` |
| `@vybestack/llxprt-code-core` | 1 | dependencies | `packages/core/src/providers/anthropic/AnthropicProvider.modelParams.test.ts` |
| `net` | 1 | dependencies | `packages/core/src/providers/openai/OpenAIClientFactory.ts` |
| `@ai-sdk/provider-utils` | 1 | dependencies | `packages/core/src/providers/openai-vercel/messageConversion.test.ts` |
| `@dqbd/tiktoken` | 1 | dependencies | `packages/core/src/providers/tokenizers/OpenAITokenizer.ts` |

## Required Package Checks

```bash
node -e "const p=require('./packages/providers/package.json'); const d=p.dependencies||{}; for (const n of ['@vybestack/llxprt-code-core','openai','@anthropic-ai/sdk','@google/genai','@dqbd/tiktoken']) if (!d[n]) { console.error('missing dependency', n); process.exit(1); }"
npm ls openai @anthropic-ai/sdk @google/genai @dqbd/tiktoken
```

P08 may start with the critical set above. P11 must re-run import inventory after file movement and reconcile all direct imports.


## Direct Dependency Declaration Rule

`packages/providers` must declare every direct production import from moved provider production files in its own `dependencies` and every direct test-only import in its own `devDependencies`. It must not rely on transitive dependencies from `packages/core` or `packages/cli`. Re-run the import inventory after P11 and reconcile `packages/providers/package.json` before verification.


## Node Built-Ins

Do not add Node built-in modules to packages/providers/package.json. Imports such as node:fs, node:os, node:path, node:crypto, node:http, node:https, and legacy built-in specifiers such as http, https, and net are provided by Node.js >=20. If the generated direct import inventory lists them, classify them as runtime built-ins, not dependencies.

The dependency reconciliation rule applies only to external packages and internal workspace packages.
