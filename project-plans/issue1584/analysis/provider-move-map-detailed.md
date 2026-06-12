# Detailed Provider Move Map with Import Rewrite Categories

Plan ID: PLAN-20260603-ISSUE1584.P09
Generated: 2026-06-03

This document is the deterministic, per-file source-to-destination move map for Phase 11 (P11) file migration, augmented with import-rewrite categories from core-import-remediation.md. Every file in the current `packages/core/src/providers/` inventory is covered with exactly one move rule. No files are moved in P09 — this is a planning artifact for P11.

## Directory Structure Move Rules

The path transformation for every file is deterministic:

```
packages/core/src/providers/{relative_path}
  → packages/providers/src/{relative_path}
```

That is, strip `packages/core/src/providers/` and prepend `packages/providers/src/`.

### Subdirectory Classification (from P01 analysis)

| Subdirectory | Rule | Classification |
|-------------|------|---------------|
| `__tests__/` | Rule 1 | Top-level shared provider tests → move to `packages/providers/src/__tests__/` |
| `anthropic/test-utils/` | Rule 2 | Per-provider test support → move to `packages/providers/src/anthropic/test-utils/` |
| `gemini/__fixtures__/` | Rule 3 | Test fixtures → move to `packages/providers/src/gemini/__fixtures__/` |
| `openai/__tests__/`, `openai-responses/__tests__/`, `openai-vercel/__tests__/`, `gemini/__tests__/` | Rule 1 | Per-provider tests → move to `packages/providers/src/{provider}/__tests__/` |
| `anthropic/` (all other files) | Rule 4 | Named provider directory → move to `packages/providers/src/anthropic/` |
| `chutes/`, `fake/`, `gemini/` (impl), `kimi/`, `openai/` (all), `openai-responses/` (all), `openai-vercel/` (all), `synthetic/`, `zai/` | Rule 4 | Named provider directories |
| `integration/` | Rule 5 | Provider integration tests → move to `packages/providers/src/integration/` |
| `test-utils/` | Rule 6 | Shared provider test utilities → move to `packages/providers/src/test-utils/` |
| `IModel.ts`, `IProvider.ts`, `IProviderManager.ts`, `ITool.ts`, `ContentGeneratorRole.ts`, `errors.ts` | Rule 7 | Public API type files → move to `packages/providers/src/` |
| `BaseProvider.ts`, `BaseProviderNormalization.ts`, `apiKeyQuotaResolver.ts`, `customHeaders.ts`, `LoadBalancingProvider.ts`, `LoggingProviderWrapper.ts`, `ProviderContentGenerator.ts`, `ProviderManager.ts`, `RetryOrchestrator.ts`, `providerConfigKeys.ts`, `types.ts` (+ their test/spec files) | Rule 8 | Top-level orchestration files → move to `packages/providers/src/` |
| `logging/` | Rule 9 | Provider logging support → move to `packages/providers/src/logging/` |
| `reasoning/` | Rule 10 | Provider reasoning support → move to `packages/providers/src/reasoning/` |
| `tokenizers/` | Rule 11 | Provider tokenizers → move to `packages/providers/src/tokenizers/` |
| `types/` | Sub-rule of Rule 7 | Provider type files → move to `packages/providers/src/types/` |
| `utils/` (most files) | Rule 13 | Provider utility support → move to `packages/providers/src/utils/` |
| `utils/toolIdNormalization.ts` + `.test.ts` | Explicit exception | Core-owned shared tool utility. Moves to providers, but core's `ToolIdStrategy.ts` must import from providers → core dependency inversion. See Import Rewrite Category E. |

## Complete Per-File Move Map

Each entry includes: source path, destination path, classification rule, and import rewrite category.

### __tests__/ (Rule 1 — top-level shared tests)

| # | Source Path | Destination Path | Rule | Import Rewrite Category |
|---|------------|------------------|------|------------------------|
| 1 | `packages/core/src/providers/__tests__/BaseProvider.guard.test.ts` | `packages/providers/src/__tests__/BaseProvider.guard.test.ts` | Rule 1 | B (ProviderManager) |
| 2 | `packages/core/src/providers/__tests__/baseProvider.stateless.test.ts` | `packages/providers/src/__tests__/baseProvider.stateless.test.ts` | Rule 1 | B |
| 3 | `packages/core/src/providers/__tests__/errors.test.ts` | `packages/providers/src/__tests__/errors.test.ts` | Rule 1 | F (Provider errors) |
| 4 | `packages/core/src/providers/__tests__/LoadBalancingProvider.circuitbreaker.test.ts` | `packages/providers/src/__tests__/LoadBalancingProvider.circuitbreaker.test.ts` | Rule 1 | B |
| 5 | `packages/core/src/providers/__tests__/LoadBalancingProvider.failover.test.ts` | `packages/providers/src/__tests__/LoadBalancingProvider.failover.test.ts` | Rule 1 | B |
| 6 | `packages/core/src/providers/__tests__/LoadBalancingProvider.metrics.test.ts` | `packages/providers/src/__tests__/LoadBalancingProvider.metrics.test.ts` | Rule 1 | B |
| 7 | `packages/core/src/providers/__tests__/LoadBalancingProvider.test.ts` | `packages/providers/src/__tests__/LoadBalancingProvider.test.ts` | Rule 1 | B |
| 8 | `packages/core/src/providers/__tests__/LoadBalancingProvider.timeout.test.ts` | `packages/providers/src/__tests__/LoadBalancingProvider.timeout.test.ts` | Rule 1 | B |
| 9 | `packages/core/src/providers/__tests__/LoadBalancingProvider.tpm.test.ts` | `packages/providers/src/__tests__/LoadBalancingProvider.tpm.test.ts` | Rule 1 | B |
| 10 | `packages/core/src/providers/__tests__/LoadBalancingProvider.types.test.ts` | `packages/providers/src/__tests__/LoadBalancingProvider.types.test.ts` | Rule 1 | B |
| 11 | `packages/core/src/providers/__tests__/LoggingProviderWrapper.apiTelemetry.test.ts` | `packages/providers/src/__tests__/LoggingProviderWrapper.apiTelemetry.test.ts` | Rule 1 | B |
| 12 | `packages/core/src/providers/__tests__/LoggingProviderWrapper.stateless.test.ts` | `packages/providers/src/__tests__/LoggingProviderWrapper.stateless.test.ts` | Rule 1 | B |
| 13 | `packages/core/src/providers/__tests__/ProviderManager.guard.test.ts` | `packages/providers/src/__tests__/ProviderManager.guard.test.ts` | Rule 1 | B |
| 14 | `packages/core/src/providers/__tests__/ProviderManager.sandboxBaseUrl.test.ts` | `packages/providers/src/__tests__/ProviderManager.sandboxBaseUrl.test.ts` | Rule 1 | B |
| 15 | `packages/core/src/providers/__tests__/ProviderManager.settingsSeparation.test.ts` | `packages/providers/src/__tests__/ProviderManager.settingsSeparation.test.ts` | Rule 1 | B |
| 16 | `packages/core/src/providers/__tests__/RetryOrchestrator.onAuthError.test.ts` | `packages/providers/src/__tests__/RetryOrchestrator.onAuthError.test.ts` | Rule 1 | B |
| 17 | `packages/core/src/providers/__tests__/RetryOrchestrator.test.ts` | `packages/providers/src/__tests__/RetryOrchestrator.test.ts` | Rule 1 | B |

### Top-level provider files (Rule 7/8 — public API + orchestration)

| # | Source Path | Destination Path | Rule | Import Rewrite Category |
|---|------------|------------------|------|------------------------|
| 18 | `packages/core/src/providers/ContentGeneratorRole.ts` | `packages/providers/src/ContentGeneratorRole.ts` | Rule 7 | C (ProviderContentGenerator) |
| 19 | `packages/core/src/providers/IModel.ts` | `packages/providers/src/IModel.ts` | Rule 7 | A (Contract type) |
| 20 | `packages/core/src/providers/IProvider.ts` | `packages/providers/src/IProvider.ts` | Rule 7 | A |
| 21 | `packages/core/src/providers/IProviderManager.ts` | `packages/providers/src/IProviderManager.ts` | Rule 7 | A |
| 22 | `packages/core/src/providers/ITool.ts` | `packages/providers/src/ITool.ts` | Rule 7 | A |
| 23 | `packages/core/src/providers/errors.ts` | `packages/providers/src/errors.ts` | Rule 7 | F (Provider errors — split: MissingProviderRuntimeError → core-owned, rest → providers) |
| 24 | `packages/core/src/providers/apiKeyQuotaResolver.ts` | `packages/providers/src/apiKeyQuotaResolver.ts` | Rule 8 | B (orchestration) |
| 25 | `packages/core/src/providers/apiKeyQuotaResolver.test.ts` | `packages/providers/src/apiKeyQuotaResolver.test.ts` | Rule 8 | B |
| 26 | `packages/core/src/providers/BaseProvider.ts` | `packages/providers/src/BaseProvider.ts` | Rule 8 | B |
| 27 | `packages/core/src/providers/BaseProvider.test.ts` | `packages/providers/src/BaseProvider.test.ts` | Rule 8 | B |
| 28 | `packages/core/src/providers/BaseProviderNormalization.ts` | `packages/providers/src/BaseProviderNormalization.ts` | Rule 8 | B |
| 29 | `packages/core/src/providers/customHeaders.ts` | `packages/providers/src/customHeaders.ts` | Rule 8 | B |
| 30 | `packages/core/src/providers/LoadBalancingProvider.ts` | `packages/providers/src/LoadBalancingProvider.ts` | Rule 8 | B |
| 31 | `packages/core/src/providers/LoggingProviderWrapper.ts` | `packages/providers/src/LoggingProviderWrapper.ts` | Rule 8 | B |
| 32 | `packages/core/src/providers/ProviderContentGenerator.ts` | `packages/providers/src/ProviderContentGenerator.ts` | Rule 8 | C |
| 33 | `packages/core/src/providers/ProviderManager.ts` | `packages/providers/src/ProviderManager.ts` | Rule 8 | B |
| 34 | `packages/core/src/providers/ProviderManager.test.ts` | `packages/providers/src/ProviderManager.test.ts` | Rule 8 | B |
| 35 | `packages/core/src/providers/ProviderManager.gemini-switch.test.ts` | `packages/providers/src/ProviderManager.gemini-switch.test.ts` | Rule 8 | B |
| 36 | `packages/core/src/providers/providerManager.context.test.ts` | `packages/providers/src/providerManager.context.test.ts` | Rule 8 | B |
| 37 | `packages/core/src/providers/providerConfigKeys.ts` | `packages/providers/src/providerConfigKeys.ts` | Rule 8 | H (config types) |
| 38 | `packages/core/src/providers/RetryOrchestrator.ts` | `packages/providers/src/RetryOrchestrator.ts` | Rule 8 | B |
| 39 | `packages/core/src/providers/types.ts` | `packages/providers/src/types.ts` | Rule 7 | A/H/G (mixed public types) |
| 40 | `packages/core/src/providers/errors.spec.ts` | `packages/providers/src/errors.spec.ts` | Rule 8 | F |
| 41 | `packages/core/src/providers/providerInterface.compat.test.ts` | `packages/providers/src/providerInterface.contract.test.ts` | Rule 8 | B |

### types/ (sub-directory of Rule 7)

| # | Source Path | Destination Path | Rule | Import Rewrite Category |
|---|------------|------------------|------|------------------------|
| 42 | `packages/core/src/providers/types/IProviderConfig.ts` | `packages/providers/src/types/IProviderConfig.ts` | Rule 7 sub | H (config types) |
| 43 | `packages/core/src/providers/types/providerRuntime.ts` | `packages/providers/src/types/providerRuntime.ts` | Rule 7 sub | G (telemetry context) |

### tokenizers/ (Rule 11)

| # | Source Path | Destination Path | Rule | Import Rewrite Category |
|---|------------|------------------|------|------------------------|
| 44 | `packages/core/src/providers/tokenizers/ITokenizer.ts` | `packages/providers/src/tokenizers/ITokenizer.ts` | Rule 11 | D (Tokenizer injection) |
| 45 | `packages/core/src/providers/tokenizers/OpenAITokenizer.ts` | `packages/providers/src/tokenizers/OpenAITokenizer.ts` | Rule 11 | D |
| 46 | `packages/core/src/providers/tokenizers/AnthropicTokenizer.ts` | `packages/providers/src/tokenizers/AnthropicTokenizer.ts` | Rule 11 | D |

### logging/ (Rule 9)

| # | Source Path | Destination Path | Rule | Import Rewrite Category |
|---|------------|------------------|------|------------------------|
| 47 | `packages/core/src/providers/logging/ProviderContentExtractor.ts` | `packages/providers/src/logging/ProviderContentExtractor.ts` | Rule 9 | B |
| 48 | `packages/core/src/providers/logging/ProviderPerformanceTracker.ts` | `packages/providers/src/logging/ProviderPerformanceTracker.ts` | Rule 9 | B |
| 49 | `packages/core/src/providers/logging/ProviderPerformanceTracker.test.ts` | `packages/providers/src/logging/ProviderPerformanceTracker.test.ts` | Rule 9 | B |

### reasoning/ (Rule 10)

| # | Source Path | Destination Path | Rule | Import Rewrite Category |
|---|------------|------------------|------|------------------------|
| 50 | `packages/core/src/providers/reasoning/reasoningUtils.ts` | `packages/providers/src/reasoning/reasoningUtils.ts` | Rule 10 | J (reasoning utilities — CompressionHandler imports) |
| 51 | `packages/core/src/providers/reasoning/reasoningUtils.test.ts` | `packages/providers/src/reasoning/reasoningUtils.test.ts` | Rule 10 | J |

### integration/ (Rule 5)

| # | Source Path | Destination Path | Rule | Import Rewrite Category |
|---|------------|------------------|------|------------------------|
| 52 | `packages/core/src/providers/integration/multi-provider.integration.test.ts` | `packages/providers/src/integration/multi-provider.integration.test.ts` | Rule 5 | B |
| 53 | `packages/core/src/providers/integration/TEST_INSTRUCTIONS.md` | `packages/providers/src/integration/TEST_INSTRUCTIONS.md` | Rule 5 | N/A (documentation) |

### test-utils/ (Rule 6)

| # | Source Path | Destination Path | Rule | Import Rewrite Category |
|---|------------|------------------|------|------------------------|
| 54 | `packages/core/src/providers/test-utils/providerTestConfig.ts` | `packages/providers/src/test-utils/providerTestConfig.ts` | Rule 6 | L (test utilities) |

### anthropic/ (Rule 4)

| # | Source Path | Destination Path | Rule | Import Rewrite Category |
|---|------------|------------------|------|------------------------|
| 55 | `packages/core/src/providers/anthropic/AnthropicApiExecution.ts` | `packages/providers/src/anthropic/AnthropicApiExecution.ts` | Rule 4 | B |
| 56 | `packages/core/src/providers/anthropic/AnthropicMessageNormalizer.ts` | `packages/providers/src/anthropic/AnthropicMessageNormalizer.ts` | Rule 4 | B |
| 57 | `packages/core/src/providers/anthropic/AnthropicMessageValidator.ts` | `packages/providers/src/anthropic/AnthropicMessageValidator.ts` | Rule 4 | B |
| 58 | `packages/core/src/providers/anthropic/AnthropicModelData.ts` | `packages/providers/src/anthropic/AnthropicModelData.ts` | Rule 4 | B |
| 59 | `packages/core/src/providers/anthropic/AnthropicProvider.ts` | `packages/providers/src/anthropic/AnthropicProvider.ts` | Rule 4 | B |
| 60 | `packages/core/src/providers/anthropic/AnthropicProvider.dumpContext.test.ts` | `packages/providers/src/anthropic/AnthropicProvider.dumpContext.test.ts` | Rule 4 | B |
| 61 | `packages/core/src/providers/anthropic/AnthropicProvider.issue1150-repro.test.ts` | `packages/providers/src/anthropic/AnthropicProvider.issue1150-repro.test.ts` | Rule 4 | B |
| 62 | `packages/core/src/providers/anthropic/AnthropicProvider.issue1150.redacted.test.ts` | `packages/providers/src/anthropic/AnthropicProvider.issue1150.redacted.test.ts` | Rule 4 | B |
| 63 | `packages/core/src/providers/anthropic/AnthropicProvider.issue1150.shape.test.ts` | `packages/providers/src/anthropic/AnthropicProvider.issue1150.shape.test.ts` | Rule 4 | B |
| 64 | `packages/core/src/providers/anthropic/AnthropicProvider.issue1150.streaming.test.ts` | `packages/providers/src/anthropic/AnthropicProvider.issue1150.streaming.test.ts` | Rule 4 | B |
| 65 | `packages/core/src/providers/anthropic/AnthropicProvider.issue1150.test.ts` | `packages/providers/src/anthropic/AnthropicProvider.issue1150.test.ts` | Rule 4 | B |
| 66 | `packages/core/src/providers/anthropic/AnthropicProvider.issue1150.toolresult.test.ts` | `packages/providers/src/anthropic/AnthropicProvider.issue1150.toolresult.test.ts` | Rule 4 | B |
| 67 | `packages/core/src/providers/anthropic/AnthropicProvider.issue1494.test.ts` | `packages/providers/src/anthropic/AnthropicProvider.issue1494.test.ts` | Rule 4 | B |
| 68 | `packages/core/src/providers/anthropic/AnthropicProvider.mediaBlock.test.ts` | `packages/providers/src/anthropic/AnthropicProvider.mediaBlock.test.ts` | Rule 4 | B |
| 69 | `packages/core/src/providers/anthropic/AnthropicProvider.modelParams.test.ts` | `packages/providers/src/anthropic/AnthropicProvider.modelParams.test.ts` | Rule 4 | B |
| 70 | `packages/core/src/providers/anthropic/AnthropicProvider.stateless.test.ts` | `packages/providers/src/anthropic/AnthropicProvider.stateless.test.ts` | Rule 4 | B |
| 71 | `packages/core/src/providers/anthropic/AnthropicProvider.test.ts` | `packages/providers/src/anthropic/AnthropicProvider.test.ts` | Rule 4 | B |
| 72 | `packages/core/src/providers/anthropic/AnthropicProvider.thinking.test.ts` | `packages/providers/src/anthropic/AnthropicProvider.thinking.test.ts` | Rule 4 | B |
| 73 | `packages/core/src/providers/anthropic/AnthropicProvider.toolFormatDetection.test.ts` | `packages/providers/src/anthropic/AnthropicProvider.toolFormatDetection.test.ts` | Rule 4 | B |
| 74 | `packages/core/src/providers/anthropic/AnthropicRateLimitHandler.ts` | `packages/providers/src/anthropic/AnthropicRateLimitHandler.ts` | Rule 4 | B |
| 75 | `packages/core/src/providers/anthropic/AnthropicRateLimitHandler.test.ts` | `packages/providers/src/anthropic/AnthropicRateLimitHandler.test.ts` | Rule 4 | B |
| 76 | `packages/core/src/providers/anthropic/AnthropicRequestBuilder.ts` | `packages/providers/src/anthropic/AnthropicRequestBuilder.ts` | Rule 4 | B |
| 77 | `packages/core/src/providers/anthropic/AnthropicRequestPreparation.ts` | `packages/providers/src/anthropic/AnthropicRequestPreparation.ts` | Rule 4 | B |
| 78 | `packages/core/src/providers/anthropic/AnthropicResponseParser.ts` | `packages/providers/src/anthropic/AnthropicResponseParser.ts` | Rule 4 | B |
| 79 | `packages/core/src/providers/anthropic/AnthropicResponseParser.issue1844.test.ts` | `packages/providers/src/anthropic/AnthropicResponseParser.issue1844.test.ts` | Rule 4 | B |
| 80 | `packages/core/src/providers/anthropic/AnthropicStreamProcessor.ts` | `packages/providers/src/anthropic/AnthropicStreamProcessor.ts` | Rule 4 | B |
| 81 | `packages/core/src/providers/anthropic/schemaConverter.ts` | `packages/providers/src/anthropic/schemaConverter.ts` | Rule 4 | B |
| 82 | `packages/core/src/providers/anthropic/usageInfo.ts` | `packages/providers/src/anthropic/usageInfo.ts` | Rule 4 | B |
| 83 | `packages/core/src/providers/anthropic/usageInfo.test.ts` | `packages/providers/src/anthropic/usageInfo.test.ts` | Rule 4 | B |
| 84 | `packages/core/src/providers/anthropic/test-utils/anthropicTestUtils.ts` | `packages/providers/src/anthropic/test-utils/anthropicTestUtils.ts` | Rule 2 | B |

### chutes/ (Rule 4)

| # | Source Path | Destination Path | Rule | Import Rewrite Category |
|---|------------|------------------|------|------------------------|
| 85 | `packages/core/src/providers/chutes/usageInfo.ts` | `packages/providers/src/chutes/usageInfo.ts` | Rule 4 | B |
| 86 | `packages/core/src/providers/chutes/usageInfo.test.ts` | `packages/providers/src/chutes/usageInfo.test.ts` | Rule 4 | B |

### fake/ (Rule 4)

| # | Source Path | Destination Path | Rule | Import Rewrite Category |
|---|------------|------------------|------|------------------------|
| 87 | `packages/core/src/providers/fake/FakeProvider.ts` | `packages/providers/src/fake/FakeProvider.ts` | Rule 4 | B |
| 88 | `packages/core/src/providers/fake/FakeProvider.test.ts` | `packages/providers/src/fake/FakeProvider.test.ts` | Rule 4 | B |

### gemini/ (Rule 4 + Rule 1 + Rule 3)

| # | Source Path | Destination Path | Rule | Import Rewrite Category |
|---|------------|------------------|------|------------------------|
| 89 | `packages/core/src/providers/gemini/GeminiProvider.ts` | `packages/providers/src/gemini/GeminiProvider.ts` | Rule 4 | B |
| 90 | `packages/core/src/providers/gemini/GeminiProvider.test.ts` | `packages/providers/src/gemini/GeminiProvider.test.ts` | Rule 4 | B |
| 91 | `packages/core/src/providers/gemini/GeminiProvider.e2e.test.ts` | `packages/providers/src/gemini/GeminiProvider.e2e.test.ts` | Rule 4 | B |
| 92 | `packages/core/src/providers/gemini/GeminiProvider.mediaBlock.test.ts` | `packages/providers/src/gemini/GeminiProvider.mediaBlock.test.ts` | Rule 4 | B |
| 93 | `packages/core/src/providers/gemini/thoughtSignatures.ts` | `packages/providers/src/gemini/thoughtSignatures.ts` | Rule 4 | B |
| 94 | `packages/core/src/providers/gemini/usageInfo.ts` | `packages/providers/src/gemini/usageInfo.ts` | Rule 4 | B |
| 95 | `packages/core/src/providers/gemini/__tests__/gemini.stateless.test.ts` | `packages/providers/src/gemini/__tests__/gemini.stateless.test.ts` | Rule 1 | B |
| 96 | `packages/core/src/providers/gemini/__tests__/gemini.thinkingLevel.test.ts` | `packages/providers/src/gemini/__tests__/gemini.thinkingLevel.test.ts` | Rule 1 | B |
| 97 | `packages/core/src/providers/gemini/__tests__/gemini.thoughtSignature.test.ts` | `packages/providers/src/gemini/__tests__/gemini.thoughtSignature.test.ts` | Rule 1 | B |
| 98 | `packages/core/src/providers/gemini/__tests__/gemini.userMemory.test.ts` | `packages/providers/src/gemini/__tests__/gemini.userMemory.test.ts` | Rule 1 | B |
| 99 | `packages/core/src/providers/gemini/__fixtures__/test.pdf` | `packages/providers/src/gemini/__fixtures__/test.pdf` | Rule 3 | N/A (binary fixture) |

### kimi/ (Rule 4)

| # | Source Path | Destination Path | Rule | Import Rewrite Category |
|---|------------|------------------|------|------------------------|
| 100 | `packages/core/src/providers/kimi/usageInfo.ts` | `packages/providers/src/kimi/usageInfo.ts` | Rule 4 | B |
| 101 | `packages/core/src/providers/kimi/usageInfo.test.ts` | `packages/providers/src/kimi/usageInfo.test.ts` | Rule 4 | B |

### openai/ (Rule 4 + Rule 1)

| # | Source Path | Destination Path | Rule | Import Rewrite Category |
|---|------------|------------------|------|------------------------|
| 102 | `packages/core/src/providers/openai/OpenAIProvider.ts` | `packages/providers/src/openai/OpenAIProvider.ts` | Rule 4 | B |
| 103 | `packages/core/src/providers/openai/OpenAIApiExecution.ts` | `packages/providers/src/openai/OpenAIApiExecution.ts` | Rule 4 | B |
| 104 | `packages/core/src/providers/openai/OpenAIClientFactory.ts` | `packages/providers/src/openai/OpenAIClientFactory.ts` | Rule 4 | B |
| 105 | `packages/core/src/providers/openai/OpenAIClientFactory.test.ts` | `packages/providers/src/openai/OpenAIClientFactory.test.ts` | Rule 4 | B |
| 106 | `packages/core/src/providers/openai/OpenAINonStreamHandler.ts` | `packages/providers/src/openai/OpenAINonStreamHandler.ts` | Rule 4 | B |
| 107 | `packages/core/src/providers/openai/OpenAIRequestBuilder.ts` | `packages/providers/src/openai/OpenAIRequestBuilder.ts` | Rule 4 | B |
| 108 | `packages/core/src/providers/openai/OpenAIRequestBuilder.test.ts` | `packages/providers/src/openai/OpenAIRequestBuilder.test.ts` | Rule 4 | B |
| 109 | `packages/core/src/providers/openai/OpenAIRequestPreparation.ts` | `packages/providers/src/openai/OpenAIRequestPreparation.ts` | Rule 4 | B |
| 110 | `packages/core/src/providers/openai/OpenAIResponseParser.ts` | `packages/providers/src/openai/OpenAIResponseParser.ts` | Rule 4 | B |
| 111 | `packages/core/src/providers/openai/OpenAIResponseParser.test.ts` | `packages/providers/src/openai/OpenAIResponseParser.test.ts` | Rule 4 | B |
| 112 | `packages/core/src/providers/openai/OpenAIStreamProcessor.ts` | `packages/providers/src/openai/OpenAIStreamProcessor.ts` | Rule 4 | B |
| 113 | `packages/core/src/providers/openai/OpenAIStreamProcessorState.ts` | `packages/providers/src/openai/OpenAIStreamProcessorState.ts` | Rule 4 | B |
| 114 | `packages/core/src/providers/openai/OpenAIStreamProcessor.stopReason.test.ts` | `packages/agents/src/core/MessageConverter.stopReason.test.ts` | Agent-owned override | B |
| 115 | `packages/core/src/providers/openai/ConversationCache.ts` | `packages/providers/src/openai/ConversationCache.ts` | Rule 4 | B |
| 116 | `packages/core/src/providers/openai/ConversationCache.accumTokens.test.ts` | `packages/providers/src/openai/ConversationCache.accumTokens.test.ts` | Rule 4 | B |
| 117 | `packages/core/src/providers/openai/IChatGenerateParams.ts` | `packages/providers/src/openai/IChatGenerateParams.ts` | Rule 4 | B |
| 118 | `packages/core/src/providers/openai/RESPONSES_API_MODELS.ts` | `packages/providers/src/openai/RESPONSES_API_MODELS.ts` | Rule 4 | B |
| 119 | `packages/core/src/providers/openai/ToolCallCollector.ts` | `packages/providers/src/openai/ToolCallCollector.ts` | Rule 4 | B |
| 120 | `packages/core/src/providers/openai/ToolCallCollector.test.ts` | `packages/providers/src/openai/ToolCallCollector.test.ts` | Rule 4 | B |
| 121 | `packages/core/src/providers/openai/ToolCallNormalizer.ts` | `packages/providers/src/openai/ToolCallNormalizer.ts` | Rule 4 | B |
| 122 | `packages/core/src/providers/openai/ToolCallNormalizer.test.ts` | `packages/providers/src/openai/ToolCallNormalizer.test.ts` | Rule 4 | B |
| 123 | `packages/core/src/providers/openai/ToolCallPipeline.ts` | `packages/providers/src/openai/ToolCallPipeline.ts` | Rule 4 | B |
| 124 | `packages/core/src/providers/openai/ToolCallPipeline.test.ts` | `packages/providers/src/openai/ToolCallPipeline.test.ts` | Rule 4 | B |
| 125 | `packages/core/src/providers/openai/ToolCallPipeline.integration.test.ts` | `packages/providers/src/openai/ToolCallPipeline.integration.test.ts` | Rule 4 | B |
| 126 | `packages/core/src/providers/openai/ToolCallPipeline.toolCallId.test.ts` | `packages/providers/src/openai/ToolCallPipeline.toolCallId.test.ts` | Rule 4 | B |
| 127 | `packages/core/src/providers/openai/ToolNameValidator.ts` | `packages/providers/src/openai/ToolNameValidator.ts` | Rule 4 | B |
| 128 | `packages/core/src/providers/openai/buildResponsesRequest.ts` | `packages/providers/src/openai/buildResponsesRequest.ts` | Rule 4 | B |
| 129 | `packages/core/src/providers/openai/buildResponsesRequest.test.ts` | `packages/providers/src/openai/buildResponsesRequest.test.ts` | Rule 4 | B |
| 130 | `packages/core/src/providers/openai/buildResponsesRequest.stripToolCalls.test.ts` | `packages/providers/src/openai/buildResponsesRequest.stripToolCalls.test.ts` | Rule 4 | B |
| 131 | `packages/core/src/providers/openai/buildResponsesRequest.toolIdNormalization.test.ts` | `packages/providers/src/openai/buildResponsesRequest.toolIdNormalization.test.ts` | Rule 4 | B |
| 132 | `packages/core/src/providers/openai/buildResponsesRequest.undefined.test.ts` | `packages/providers/src/openai/buildResponsesRequest.undefined.test.ts` | Rule 4 | B |
| 133 | `packages/core/src/providers/openai/codexUsageInfo.ts` | `packages/providers/src/openai/codexUsageInfo.ts` | Rule 4 | B |
| 134 | `packages/core/src/providers/openai/codexUsageInfo.test.ts` | `packages/providers/src/openai/codexUsageInfo.test.ts` | Rule 4 | B |
| 135 | `packages/core/src/providers/openai/estimateRemoteTokens.ts` | `packages/providers/src/openai/estimateRemoteTokens.ts` | Rule 4 | B |
| 136 | `packages/core/src/providers/openai/estimateRemoteTokens.test.ts` | `packages/providers/src/openai/estimateRemoteTokens.test.ts` | Rule 4 | B |
| 137 | `packages/core/src/providers/openai/finishReasonMapping.ts` | `packages/providers/src/openai/finishReasonMapping.ts` | Rule 4 | B |
| 138 | `packages/core/src/providers/openai/getOpenAIProviderInfo.ts` | `packages/providers/src/openai/getOpenAIProviderInfo.ts` | Rule 4 | B |
| 139 | `packages/core/src/providers/openai/getOpenAIProviderInfo.context.test.ts` | `packages/providers/src/openai/getOpenAIProviderInfo.context.test.ts` | Rule 4 | B |
| 140 | `packages/core/src/providers/openai/openaiRequestParams.ts` | `packages/providers/src/openai/openaiRequestParams.ts` | Rule 4 | B |
| 141 | `packages/core/src/providers/openai/openaiRequestParams.test.ts` | `packages/providers/src/openai/openaiRequestParams.test.ts` | Rule 4 | B |
| 142 | `packages/core/src/providers/openai/parseResponsesStream.ts` | `packages/providers/src/openai/parseResponsesStream.ts` | Rule 4 | B |
| 143 | `packages/core/src/providers/openai/parseResponsesStream.test.ts` | `packages/providers/src/openai/parseResponsesStream.test.ts` | Rule 4 | B |
| 144 | `packages/core/src/providers/openai/parseResponsesStream.issue1844.test.ts` | `packages/providers/src/openai/parseResponsesStream.issue1844.test.ts` | Rule 4 | B |
| 145 | `packages/core/src/providers/openai/parseResponsesStream.reasoning.test.ts` | `packages/providers/src/openai/parseResponsesStream.reasoning.test.ts` | Rule 4 | B |
| 146 | `packages/core/src/providers/openai/parseResponsesStream.responsesToolCalls.test.ts` | `packages/providers/src/openai/parseResponsesStream.responsesToolCalls.test.ts` | Rule 4 | B |
| 147 | `packages/core/src/providers/openai/schemaConverter.ts` | `packages/providers/src/openai/schemaConverter.ts` | Rule 4 | B |
| 148 | `packages/core/src/providers/openai/schemaConverter.issue1844.test.ts` | `packages/providers/src/openai/schemaConverter.issue1844.test.ts` | Rule 4 | B |
| 149 | `packages/core/src/providers/openai/syntheticToolResponses.ts` | `packages/providers/src/openai/syntheticToolResponses.ts` | Rule 4 | B |
| 150 | `packages/core/src/providers/openai/test-types.ts` | `packages/providers/src/openai/test-types.ts` | Rule 4 | B |
| 151 | `packages/core/src/providers/openai/toolNameUtils.ts` | `packages/providers/src/openai/toolNameUtils.ts` | Rule 4 | B |
| 152 | `packages/core/src/providers/openai/toolNameUtils.test.ts` | `packages/providers/src/openai/toolNameUtils.test.ts` | Rule 4 | B |
| 153 | `packages/core/src/providers/openai/OpenAIProvider.caching.test.ts` | `packages/providers/src/openai/OpenAIProvider.caching.test.ts` | Rule 4 | B |
| 154 | `packages/core/src/providers/openai/OpenAIProvider.deepseekReasoning.test.ts` | `packages/providers/src/openai/OpenAIProvider.deepseekReasoning.test.ts` | Rule 4 | B |
| 155 | `packages/core/src/providers/openai/OpenAIProvider.emptyResponseRetry.test.ts` | `packages/providers/src/openai/OpenAIProvider.emptyResponseRetry.test.ts` | Rule 4 | B |
| 156 | `packages/core/src/providers/openai/OpenAIProvider.integration.test.ts` | `packages/providers/src/openai/OpenAIProvider.integration.test.ts` | Rule 4 | B |
| 157 | `packages/core/src/providers/openai/OpenAIProvider.mediaBlock.test.ts` | `packages/providers/src/openai/OpenAIProvider.mediaBlock.test.ts` | Rule 4 | B |
| 158 | `packages/core/src/providers/openai/OpenAIProvider.mistralCompatibility.test.ts` | `packages/providers/src/openai/OpenAIProvider.mistralPayload.test.ts` | Rule 4 | B |
| 159 | `packages/core/src/providers/openai/OpenAIProvider.modelParamsAndHeaders.test.ts` | `packages/providers/src/openai/OpenAIProvider.modelParamsAndHeaders.test.ts` | Rule 4 | B |
| 160 | `packages/core/src/providers/openai/OpenAIProvider.reasoning.test.ts` | `packages/providers/src/openai/OpenAIProvider.reasoning.test.ts` | Rule 4 | B |
| 161 | `packages/core/src/providers/openai/OpenAIProvider.setModel.test.ts` | `packages/providers/src/openai/OpenAIProvider.setModel.test.ts` | Rule 4 | B |
| 162 | `packages/core/src/providers/openai/OpenAIProvider.shouldRetry.test.ts` | `packages/providers/src/openai/OpenAIProvider.shouldRetry.test.ts` | Rule 4 | B |
| 163 | `packages/core/src/providers/openai/OpenAIProvider.toolFormatDetection.test.ts` | `packages/providers/src/openai/OpenAIProvider.toolFormatDetection.test.ts` | Rule 4 | B |
| 164 | `packages/core/src/providers/openai/OpenAIProvider.toolNameErrors.test.ts` | `packages/providers/src/openai/OpenAIProvider.toolNameErrors.test.ts` | Rule 4 | B |
| 165 | `packages/core/src/providers/openai/OpenAIProviders.issue1844.test.ts` | `packages/providers/src/openai/OpenAIProviders.issue1844.test.ts` | Rule 4 | B |
| 166 | `packages/core/src/providers/openai/openai-oauth.spec.ts` | `packages/providers/src/openai/openai-oauth.spec.ts` | Rule 4 | B |
| 167 | `packages/core/src/providers/openai/__tests__/formatArrayResponse.test.ts` | `packages/providers/src/openai/__tests__/formatArrayResponse.test.ts` | Rule 1 | B |
| 168 | `packages/core/src/providers/openai/__tests__/openai.localEndpoint.test.ts` | `packages/providers/src/openai/__tests__/openai.localEndpoint.test.ts` | Rule 1 | B |
| 169 | `packages/core/src/providers/openai/__tests__/openai.requiresAuth.test.ts` | `packages/providers/src/openai/__tests__/openai.requiresAuth.test.ts` | Rule 1 | B |
| 170 | `packages/core/src/providers/openai/__tests__/openai.stateless.test.ts` | `packages/providers/src/openai/__tests__/openai.stateless.test.ts` | Rule 1 | B |
| 171 | `packages/core/src/providers/openai/__tests__/OpenAIProvider.e2e.test.ts` | `packages/providers/src/openai/__tests__/OpenAIProvider.e2e.test.ts` | Rule 1 | B |
| 172 | `packages/core/src/providers/openai/__tests__/OpenAIProvider.thinkTags.test.ts` | `packages/providers/src/openai/__tests__/OpenAIProvider.thinkTags.test.ts` | Rule 1 | B |
| 173 | `packages/core/src/providers/openai/__tests__/schemaConverter.parameterFallback.test.ts` | `packages/providers/src/openai/__tests__/schemaConverter.parameterFallback.test.ts` | Rule 1 | B |
| 174 | `packages/core/src/providers/openai/__tests__/ToolNameValidator.test.ts` | `packages/providers/src/openai/__tests__/ToolNameValidator.test.ts` | Rule 1 | B |
| 175 | `packages/core/src/providers/openai/docs/accessing-provider-info.md` | `packages/providers/src/openai/docs/accessing-provider-info.md` | Rule 4 | N/A (documentation) |
| 176 | `packages/core/src/providers/openai/docs/params-mapping.md` | `packages/providers/src/openai/docs/params-mapping.md` | Rule 4 | N/A (documentation) |
| 177 | `packages/core/src/providers/openai/docs/responses-api-tool-calls.md` | `packages/providers/src/openai/docs/responses-api-tool-calls.md` | Rule 4 | N/A (documentation) |

### openai-responses/ (Rule 4 + Rule 1)

| # | Source Path | Destination Path | Rule | Import Rewrite Category |
|---|------------|------------------|------|------------------------|
| 178 | `packages/core/src/providers/openai-responses/OpenAIResponsesProvider.ts` | `packages/providers/src/openai-responses/OpenAIResponsesProvider.ts` | Rule 4 | B |
| 179 | `packages/core/src/providers/openai-responses/OpenAIResponsesProviderBase.ts` | `packages/providers/src/openai-responses/OpenAIResponsesProviderBase.ts` | Rule 4 | B |
| 180 | `packages/core/src/providers/openai-responses/OpenAIResponsesProviderCore.ts` | `packages/providers/src/openai-responses/OpenAIResponsesProviderCore.ts` | Rule 4 | B |
| 181 | `packages/core/src/providers/openai-responses/OpenAIResponsesInputBuilder.ts` | `packages/providers/src/openai-responses/OpenAIResponsesInputBuilder.ts` | Rule 4 | B |
| 182 | `packages/core/src/providers/openai-responses/OpenAIResponsesTypes.ts` | `packages/providers/src/openai-responses/OpenAIResponsesTypes.ts` | Rule 4 | B |
| 183 | `packages/core/src/providers/openai-responses/CODEX_MODELS.ts` | `packages/providers/src/openai-responses/CODEX_MODELS.ts` | Rule 4 | B |
| 184 | `packages/core/src/providers/openai-responses/buildResponsesInputFromContent.ts` | `packages/providers/src/openai-responses/buildResponsesInputFromContent.ts` | Rule 4 | B |
| 185 | `packages/core/src/providers/openai-responses/buildResponsesInputFromContent.mediaBlock.test.ts` | `packages/providers/src/openai-responses/buildResponsesInputFromContent.mediaBlock.test.ts` | Rule 4 | B |
| 186 | `packages/core/src/providers/openai-responses/OpenAIResponsesProvider.headers.test.ts` | `packages/providers/src/openai-responses/OpenAIResponsesProvider.headers.test.ts` | Rule 4 | B |
| 187 | `packages/core/src/providers/openai-responses/schemaConverter.ts` | `packages/providers/src/openai-responses/schemaConverter.ts` | Rule 4 | B |
| 188 | `packages/core/src/providers/openai-responses/index.ts` | `packages/providers/src/openai-responses/index.ts` | Rule 4 | B (barrel export) |
| 189 | `packages/core/src/providers/openai-responses/__tests__/openaiResponses.stateless.test.ts` | `packages/providers/src/openai-responses/__tests__/openaiResponses.stateless.test.ts` | Rule 1 | B |
| 190 | `packages/core/src/providers/openai-responses/__tests__/OpenAIResponsesProvider.codex.malformedCallId.test.ts` | `packages/providers/src/openai-responses/__tests__/OpenAIResponsesProvider.codex.malformedCallId.test.ts` | Rule 1 | B |
| 191 | `packages/core/src/providers/openai-responses/__tests__/OpenAIResponsesProvider.ephemerals.toolOutput.test.ts` | `packages/providers/src/openai-responses/__tests__/OpenAIResponsesProvider.ephemerals.toolOutput.test.ts` | Rule 1 | B |
| 192 | `packages/core/src/providers/openai-responses/__tests__/OpenAIResponsesProvider.models.test.ts` | `packages/providers/src/openai-responses/__tests__/OpenAIResponsesProvider.models.test.ts` | Rule 1 | B |
| 193 | `packages/core/src/providers/openai-responses/__tests__/OpenAIResponsesProvider.promptCacheKey.test.ts` | `packages/providers/src/openai-responses/__tests__/OpenAIResponsesProvider.promptCacheKey.test.ts` | Rule 1 | B |
| 194 | `packages/core/src/providers/openai-responses/__tests__/OpenAIResponsesProvider.reasoningEffort.test.ts` | `packages/providers/src/openai-responses/__tests__/OpenAIResponsesProvider.reasoningEffort.test.ts` | Rule 1 | B |
| 195 | `packages/core/src/providers/openai-responses/__tests__/OpenAIResponsesProvider.reasoningInclude.test.ts` | `packages/providers/src/openai-responses/__tests__/OpenAIResponsesProvider.reasoningInclude.test.ts` | Rule 1 | B |
| 196 | `packages/core/src/providers/openai-responses/__tests__/OpenAIResponsesProvider.reasoningSummary.test.ts` | `packages/providers/src/openai-responses/__tests__/OpenAIResponsesProvider.reasoningSummary.test.ts` | Rule 1 | B |
| 197 | `packages/core/src/providers/openai-responses/__tests__/OpenAIResponsesProvider.textVerbosity.test.ts` | `packages/providers/src/openai-responses/__tests__/OpenAIResponsesProvider.textVerbosity.test.ts` | Rule 1 | B |
| 198 | `packages/core/src/providers/openai-responses/__tests__/OpenAIResponsesProvider.toolIdNormalization.test.ts` | `packages/providers/src/openai-responses/__tests__/OpenAIResponsesProvider.toolIdNormalization.test.ts` | Rule 1 | B |

### openai-vercel/ (Rule 4 + Rule 1)

| # | Source Path | Destination Path | Rule | Import Rewrite Category |
|---|------------|------------------|------|------------------------|
| 199 | `packages/core/src/providers/openai-vercel/OpenAIVercelProvider.ts` | `packages/providers/src/openai-vercel/OpenAIVercelProvider.ts` | Rule 4 | B |
| 200 | `packages/core/src/providers/openai-vercel/errors.ts` | `packages/providers/src/openai-vercel/errors.ts` | Rule 4 | B |
| 201 | `packages/core/src/providers/openai-vercel/index.ts` | `packages/providers/src/openai-vercel/index.ts` | Rule 4 | B (barrel export) |
| 202 | `packages/core/src/providers/openai-vercel/messageConversion.ts` | `packages/providers/src/openai-vercel/messageConversion.ts` | Rule 4 | B |
| 203 | `packages/core/src/providers/openai-vercel/schemaConverter.ts` | `packages/providers/src/openai-vercel/schemaConverter.ts` | Rule 4 | B |
| 204 | `packages/core/src/providers/openai-vercel/toolIdUtils.ts` | `packages/tools/src/formatters/toolIdNormalization.ts` | Rule 4 | B |
| 205 | `packages/core/src/providers/openai-vercel/errorHandling.test.ts` | `packages/providers/src/openai-vercel/errorHandling.test.ts` | Rule 4 | B |
| 206 | `packages/core/src/providers/openai-vercel/messageConversion.test.ts` | `packages/providers/src/openai-vercel/messageConversion.test.ts` | Rule 4 | B |
| 207 | `packages/core/src/providers/openai-vercel/modelListing.test.ts` | `packages/providers/src/openai-vercel/modelListing.test.ts` | Rule 4 | B |
| 208 | `packages/core/src/providers/openai-vercel/nonStreaming.test.ts` | `packages/providers/src/openai-vercel/nonStreaming.test.ts` | Rule 4 | B |
| 209 | `packages/core/src/providers/openai-vercel/OpenAIVercelProvider.caching.test.ts` | `packages/providers/src/openai-vercel/OpenAIVercelProvider.caching.test.ts` | Rule 4 | B |
| 210 | `packages/core/src/providers/openai-vercel/OpenAIVercelProvider.reasoning.test.ts` | `packages/providers/src/openai-vercel/OpenAIVercelProvider.reasoning.test.ts` | Rule 4 | B |
| 211 | `packages/core/src/providers/openai-vercel/OpenAIVercelProvider.shouldRetry.test.ts` | `packages/providers/src/openai-vercel/OpenAIVercelProvider.shouldRetry.test.ts` | Rule 4 | B |
| 212 | `packages/core/src/providers/openai-vercel/OpenAIVercelProvider.test.ts` | `packages/providers/src/openai-vercel/OpenAIVercelProvider.test.ts` | Rule 4 | B |
| 213 | `packages/core/src/providers/openai-vercel/providerRegistry.test.ts` | `packages/providers/src/openai-vercel/providerRegistry.test.ts` | Rule 4 | B |
| 214 | `packages/core/src/providers/openai-vercel/schemaConverter.issue1844.test.ts` | `packages/providers/src/openai-vercel/schemaConverter.issue1844.test.ts` | Rule 4 | B |
| 215 | `packages/core/src/providers/openai-vercel/streaming.test.ts` | `packages/providers/src/openai-vercel/streaming.test.ts` | Rule 4 | B |
| 216 | `packages/core/src/providers/openai-vercel/toolIdUtils.test.ts` | `packages/core/src/runtime/contracts/toolIdNormalization-contract.test.ts` | Rule 4 | B |
| 217 | `packages/core/src/providers/openai-vercel/__tests__/schemaConverter.parameterFallback.test.ts` | `packages/providers/src/openai-vercel/__tests__/schemaConverter.parameterFallback.test.ts` | Rule 1 | B |

### synthetic/ (Rule 4)

| # | Source Path | Destination Path | Rule | Import Rewrite Category |
|---|------------|------------------|------|------------------------|
| 218 | `packages/core/src/providers/synthetic/usageInfo.ts` | `packages/providers/src/synthetic/usageInfo.ts` | Rule 4 | B |
| 219 | `packages/core/src/providers/synthetic/usageInfo.test.ts` | `packages/providers/src/synthetic/usageInfo.test.ts` | Rule 4 | B |

### zai/ (Rule 4)

| # | Source Path | Destination Path | Rule | Import Rewrite Category |
|---|------------|------------------|------|------------------------|
| 220 | `packages/core/src/providers/zai/usageInfo.ts` | `packages/providers/src/zai/usageInfo.ts` | Rule 4 | B |
| 221 | `packages/core/src/providers/zai/usageInfo.test.ts` | `packages/providers/src/zai/usageInfo.test.ts` | Rule 4 | B |

### utils/ (Rule 13 — default, with explicit exceptions)

| # | Source Path | Destination Path | Rule | Import Rewrite Category |
|---|------------|------------------|------|------------------------|
| 222 | `packages/core/src/providers/utils/authToken.ts` | `packages/providers/src/utils/authToken.ts` | Rule 13 | B |
| 223 | `packages/core/src/providers/utils/cacheMetricsExtractor.ts` | `packages/providers/src/utils/cacheMetricsExtractor.ts` | Rule 13 | B |
| 224 | `packages/core/src/providers/utils/cacheMetricsExtractor.test.ts` | `packages/providers/src/utils/cacheMetricsExtractor.test.ts` | Rule 13 | B |
| 225 | `packages/core/src/providers/utils/containerSandbox.ts` | `packages/providers/src/utils/containerSandbox.ts` | Rule 13 | B |
| 226 | `packages/core/src/providers/utils/containerSandbox.test.ts` | `packages/providers/src/utils/containerSandbox.test.ts` | Rule 13 | B |
| 227 | `packages/core/src/providers/utils/contentPreview.ts` | `packages/providers/src/utils/contentPreview.ts` | Rule 13 | B |
| 228 | `packages/core/src/providers/utils/contentPreview.test.ts` | `packages/providers/src/utils/contentPreview.test.ts` | Rule 13 | B |
| 229 | `packages/core/src/providers/utils/dumpContext.ts` | `packages/providers/src/utils/dumpContext.ts` | Rule 13 | B |
| 230 | `packages/core/src/providers/utils/dumpContext.test.ts` | `packages/providers/src/utils/dumpContext.test.ts` | Rule 13 | B |
| 231 | `packages/core/src/providers/utils/dumpSDKContext.ts` | `packages/providers/src/utils/dumpSDKContext.ts` | Rule 13 | B |
| 232 | `packages/core/src/providers/utils/localEndpoint.ts` | `packages/providers/src/utils/localEndpoint.ts` | Rule 13 | B |
| 233 | `packages/core/src/providers/utils/mediaUtils.ts` | `packages/providers/src/utils/mediaUtils.ts` | Rule 13 | I (media utilities — classifyMediaBlock imported by core compression) |
| 234 | `packages/core/src/providers/utils/mediaUtils.test.ts` | `packages/providers/src/utils/mediaUtils.test.ts` | Rule 13 | I |
| 235 | `packages/core/src/providers/utils/qwenEndpoint.ts` | `packages/providers/src/utils/qwenEndpoint.ts` | Rule 13 | B |
| 236 | `packages/core/src/providers/utils/qwenEndpoint.test.ts` | `packages/providers/src/utils/qwenEndpoint.test.ts` | Rule 13 | B |
| 237 | `packages/core/src/providers/utils/retryStrategy.ts` | `packages/providers/src/utils/retryStrategy.ts` | Rule 13 | B |
| 238 | `packages/core/src/providers/utils/retryStrategy.test.ts` | `packages/providers/src/utils/retryStrategy.test.ts` | Rule 13 | B |
| 239 | `packages/core/src/providers/utils/textSanitizer.ts` | `packages/providers/src/utils/textSanitizer.ts` | Rule 13 | B |
| 240 | `packages/core/src/providers/utils/textSanitizer.test.ts` | `packages/providers/src/utils/textSanitizer.test.ts` | Rule 13 | B |
| 241 | `packages/core/src/providers/utils/thinkingExtraction.ts` | `packages/providers/src/utils/thinkingExtraction.ts` | Rule 13 | B |
| 242 | `packages/core/src/providers/utils/thinkingExtraction.test.ts` | `packages/providers/src/utils/thinkingExtraction.test.ts` | Rule 13 | B |
| 243 | `packages/core/src/providers/utils/toolFormatDetection.ts` | `packages/providers/src/utils/toolFormatDetection.ts` | Rule 13 | B |
| 244 | `packages/core/src/providers/utils/toolFormatDetection.test.ts` | `packages/providers/src/utils/toolFormatDetection.test.ts` | Rule 13 | B |
| 245 | `packages/core/src/providers/utils/toolIdNormalization.ts` | `packages/tools/src/formatters/toolIdNormalization.ts` | Rule 13 (EXPLICIT EXCEPTION) | E (Core-owned — currently imported by `core/src/tools/ToolIdStrategy.ts`. Must move to providers, then core imports from providers or copies to core utility) |
| 246 | `packages/core/src/providers/utils/toolIdNormalization.test.ts` | `packages/core/src/runtime/contracts/toolIdNormalization-contract.test.ts` | Rule 13 (EXPLICIT EXCEPTION) | E |
| 247 | `packages/core/src/providers/utils/toolNameNormalization.ts` | `packages/providers/src/utils/toolNameNormalization.ts` | Rule 13 | B |
| 248 | `packages/core/src/providers/utils/toolNameNormalization.test.ts` | `packages/providers/src/utils/toolNameNormalization.test.ts` | Rule 13 | B |
| 249 | `packages/core/src/providers/utils/toolResponsePayload.ts` | `packages/providers/src/utils/toolResponsePayload.ts` | Rule 13 | B |
| 250 | `packages/core/src/providers/utils/toolResponsePayload.test.ts` | `packages/providers/src/utils/toolResponsePayload.test.ts` | Rule 13 | B |
| 251 | `packages/core/src/providers/utils/userMemory.ts` | `packages/providers/src/utils/userMemory.ts` | Rule 13 | B |

**Total: 251 files (matches inventory count)**

## Import Rewrite Categories Summary

| Category | Description | Core Files Affected | Remediation |
|----------|-------------|---------------------|-------------|
| **A** | Provider contract types (`IProvider`, `IProviderManager`, `IModel`, `ITool`, `GenerateChatOptions`) | 10 core production files | Core defines structural contracts; provider package implements adapters. P03-P05 create core-owned contract interfaces. |
| **B** | Provider orchestration (`ProviderManager`, concrete providers) | 4 core files | Core uses `IProviderManager` structural interface only. CLI/runtime constructs concrete `ProviderManager`. |
| **C** | Provider content generation (`ProviderContentGenerator`) | 1 core file | Core defines `ContentGenerator` interface; provider package exports implementation. CLI injects. |
| **D** | Provider tokenizers | 1 core file (`HistoryService`) | Core defines `RuntimeTokenizer` contract; provider package implements concrete tokenizers. CLI injects. |
| **E** | Tool ID normalization (core-owned, currently in providers) | 1 core file (`ToolIdStrategy`) | Issue1585 follow-up decision: shared tool ID normalization now lives in `packages/tools/src/formatters/toolIdNormalization.ts` so providers and core consume the lower-level tools package instead of keeping this utility in core or importing providers from core. |
| **F** | Provider runtime errors (`MissingProviderRuntimeError` and others) | 1 core file (`providerRuntimeContext`) | Split: `MissingProviderRuntimeError` → core-owned runtime error. Provider-specific errors → providers package. |
| **G** | Provider telemetry types (`ProviderTelemetryContext`) | 1 core file (`telemetry/types.ts`) | Core defines `TelemetryContext` structural type. Provider package maps to it. |
| **H** | Provider config types (`IProviderConfig`, `BucketFailureReason`, `providerConfigKeys`) | 3 core config files | Core defines serializable config shapes. Provider package owns `IProviderConfig`. |
| **I** | Media utilities (`classifyMediaBlock`) | 1 core file (`compression/utils.ts`) | Core defines `MediaBlock` contract. Provider package owns implementation. Provider passes classified blocks. |
| **J** | Reasoning utilities | 1 core file (`compression/CompressionHandler.ts`) | Core defines `ReasoningOutput` contract. Provider package owns extraction. |
| **K** | Core `index.ts` mass re-exports | 1 file (`core/src/index.ts` ~40 lines) | Core stops re-exporting provider internals in P15. Provider package creates its own public API. |
| **L** | Test utilities (`providerCallOptions`, `runtime` test helpers) | 2 test-only files | Acceptable as test-only; verify excluded from production builds. |

## Core Import Remediation: Detailed Per-Consumer Plan

### Core Production Files That Import From Providers (28 files, 70 import sites)

Each file below has at least one `from '../providers/...'` or `'../../providers/...'` import. After P11, these must be updated.

| Core File | Import Category | Imported From | Remediation |
|-----------|-----------------|---------------|-------------|
| `core/src/runtime/runtimeAdapters.ts` | A, B | `ProviderManager`, `IProviderManager`, `IProvider` | Use core structural contracts |
| `core/src/runtime/AgentRuntimeContext.ts` | A | `IProvider` | Use core structural `RuntimeProvider` |
| `core/src/runtime/AgentRuntimeLoader.ts` | A, B | `ProviderManager`, `IProviderManager` | Use core structural contracts |
| `core/src/runtime/RuntimeInvocationContext.ts` | G | `ProviderTelemetryContext` | Use core `TelemetryContext` |
| `core/src/services/history/HistoryService.ts` | D | `ITokenizer`, `OpenAITokenizer`, `AnthropicTokenizer` | Use `RuntimeTokenizer` injection |
| `core/src/models/hydration.ts` | A | `IModel` | Use core `RuntimeModel` |
| `core/src/models/provider-integration.ts` | A | `IModel` | Use core `RuntimeModel` |
| `core/src/config/configTypes.ts` | B, F | `ProviderManager`, `BucketFailureReason` | Use structural interface + core-owned error |
| `core/src/config/configConstructor.ts` | A | `IProviderManager` | Use core structural interface |
| `core/src/config/configBaseCore.ts` | A | `IProviderManager` | Use core structural interface |
| `core/src/telemetry/types.ts` | G | `ProviderTelemetryContext`, `types` | Use core telemetry structural types |
| `core/src/tools/IToolFormatter.ts` | A | `ITool` | Use core structural `RuntimeTool` |
| `core/src/tools/ToolFormatter.ts` | A | `ITool` | Use core structural `RuntimeTool` |
| `core/src/tools/ToolIdStrategy.ts` | E | `normalizeToOpenAIToolId` | Move utility to core or import from providers |
| `core/src/core/StreamProcessor.ts` | A | `IProvider`, `GenerateChatOptions` | Use core structural contracts |
| `core/src/core/DirectMessageProcessor.ts` | A | `IProvider`, `GenerateChatOptions` | Use core structural contracts |
| `core/src/core/geminiChat.ts` | A | `IProvider` | Use core structural contract |
| `core/src/core/TurnProcessor.ts` | A | `IProvider`, `GenerateChatOptions` | Use core structural contracts |
| `core/src/core/contentGenerator.ts` | B, C | `IProviderManager`, `ProviderContentGenerator` | Use factory injection |
| `core/src/core/bucketFailoverIntegration.ts` | A | `IProvider`, `GenerateChatOptions` | Use core structural contracts |
| `core/src/core/compression/utils.ts` | A, I | `IProvider`, `classifyMediaBlock` | Use core contracts + provider passes classified media |
| `core/src/core/compression/types.ts` | A | `IProvider` | Use core structural contract |
| `core/src/core/compression/CompressionHandler.ts` | A, J | `IProvider`, reasoning utils | Use core contracts + `ReasoningOutput` |
| `core/src/core/compression/OneShotStrategy.ts` | A | `IProvider` | Use core structural contract |
| `core/src/core/compression/compressionBudgeting.ts` | A | `IProvider` | Use core structural contract |
| `core/src/core/compression/MiddleOutStrategy.ts` | A | `IProvider` | Use core structural contract |
| `core/src/index.ts` | K | ~40 re-exports | Remove all provider re-exports in P15 |
| `core/src/test-utils/runtime.ts` | L | `IProvider`, `ProviderManager` | Test-only; move to providers test-utils or import from providers |
| `core/src/test-utils/providerCallOptions.ts` | L | `PROVIDER_CONFIG_KEYS`, `GenerateChatOptions`, `ProviderToolset` | Test-only; import from providers after migration |

### CLI Deep Imports From Core Providers (3 sites, post-P14 remediation)

| CLI File | Imported From | Remediation |
|----------|---------------|-------------|
| `cli/src/providers/aliasProviderFactory.ts` | `@vybestack/llxprt-code-core/providers/types/IProviderConfig` | Import from `@vybestack/llxprt-code-providers/types/IProviderConfig` |
| `cli/src/providers/providerManagerInstance.ts` | `@vybestack/llxprt-code-core/providers/types/IProviderConfig` | Import from `@vybestack/llxprt-code-providers/types/IProviderConfig` |
| `cli/src/ui/commands/providerCommand.ts` | `@vybestack/llxprt-code-core/providers/IProvider` | Import from `@vybestack/llxprt-code-providers` |

## P11 Execution Order

The move map above will be executed in P11 in the following order:

1. **Create directories** in `packages/providers/src/` matching all subdirectories
2. **Copy files** from core to providers (NOT move — keep originals in core during migration)
3. **Update internal imports** within moved files (relative path adjustments)
4. **Verify providers package typecheck + build** after each batch
5. **P14**: Update core and CLI consumers to import from providers
6. **P15**: Remove originals from core, clean up core index.ts re-exports

## Completeness Verification

```bash
# Every file in the inventory must appear exactly once in this move map
find packages/core/src/providers -type f | sort | wc -l  # Must equal 251
# After P11, verify all files exist at destination
find packages/providers/src -type f -not -name 'index.ts' -not -name 'package-boundary.test.ts' | sort | wc -l  # Must equal 251
# Verify no files were actually REMOVED from core during P09
find packages/core/src/providers -type f | sort | wc -l  # Must still equal 251
```