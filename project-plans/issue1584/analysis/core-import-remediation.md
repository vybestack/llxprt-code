# Core Import Remediation Plan

Plan ID: PLAN-20260603-ISSUE1584.P01
Phase: 01 — Dependency and contract classification analysis

## Executive Summary

Core production code currently imports from `providers/` in 49 sites across 18 files. This analysis enumerates every import category, identifies concrete blockers, and specifies the remediation path for each so that no core → providers package dependency remains after P15.

## Import Category Summary

| Category | Importing Core Files | Provider Source(s) | Remediation Strategy |
|----------|---------------------|---------------------|----------------------|
| A. Provider contract types (IProvider, IProviderManager, IModel, ITool, GenerateChatOptions) | 10 core files | `IProvider.ts`, `IProviderManager.ts`, `IModel.ts`, `ITool.ts` | Core creates structural/serializable contracts (e.g., `RuntimeProvider`, `RuntimeModel`). Provider package implements provider-side adapters. |
| B. Provider orchestration (ProviderManager, concrete manager) | 4 core files | `ProviderManager.ts`, `IProviderManager.ts` | Core uses `IProviderManager` structural interface only. CLI/provider package constructs concrete `ProviderManager`. |
| C. Provider content generation | 1 core file | `ProviderContentGenerator.ts` | Core defines `ContentGenerator` interface; provider package exports `ProviderContentGenerator` implementation. Core injects via factory/config. |
| D. Provider tokenizers | 1 core file | `ITokenizer.ts`, `OpenAITokenizer.ts`, `AnthropicTokenizer.ts` | Core defines `RuntimeTokenizer` contract. CLI/runtime injects tokenizer instance. HistoryService never constructs provider tokenizers. |
| E. Tool ID normalization | 1 core file | `utils/toolIdNormalization.ts` | **Core owns this utility.** Move to `packages/core/src/tools/toolIdNormalization.ts` (or `packages/core/src/utils/`). Providers import from core if needed. |
| F. Provider runtime errors | 1 core file | `errors.ts` | Split: `MissingProviderRuntimeError` → core-owned runtime error. Provider-specific errors (`AuthError`, `RateLimitError`, etc.) → provider package. |
| G. Provider telemetry types | 1 core file | `types/providerRuntime.ts` | Core defines telemetry event shapes independent of provider package. Provider package imports core telemetry types or maps to them. |
| H. Provider config types | 1 core file | `types.ts` | Core uses serializable config shapes. Provider package owns `IProviderConfig` and runtime config mapping. |
| I. Provider media utilities | 1 core file | `utils/mediaUtils.ts` | Core defines `MediaBlock` structural contract. Provider package owns `classifyMediaBlock` implementation. Core does not import media utils. |
| J. Provider reasoning utilities | 1 core file | `reasoning/reasoningUtils.ts` | Core defines `ReasoningOutput` structural contract. Provider package owns extraction utilities. |
| K. Index.ts re-exports | 1 core file | `index.ts` (massive re-export) | `index.ts` stops re-exporting provider internals. Public API shrinks to core-only exports. Provider package exports its own public API. |
| L. Test utils (not production) | 2 core files | `IProvider.ts`, `ProviderManager.ts`, `providerConfigKeys.ts` | These are in `test-utils/` — acceptable as test-only, but must be reviewed to ensure they do not leak into production builds. |

## Detailed Blocker Analysis

### Blocker 1: HistoryService tokenizers (Category D)

**Files:**
- `packages/core/src/services/history/HistoryService.ts` (lines 27–29)

**Current import:**
```typescript
import { type ITokenizer } from '../../providers/tokenizers/ITokenizer.js';
import { OpenAITokenizer } from '../../providers/tokenizers/OpenAITokenizer.js';
import { AnthropicTokenizer } from '../../providers/tokenizers/AnthropicTokenizer.js';
```

**Problem:** HistoryService directly constructs `OpenAITokenizer` and `AnthropicTokenizer` based on provider name strings. This is a concrete provider dependency inside core.

**Remediation:**
1. Core defines a minimal `RuntimeTokenizer` interface (structural contract) with `countTokens(text: string, model: string): Promise<number>`.
2. Core `HistoryService` receives `tokenizer: RuntimeTokenizer` via constructor/factory injection.
3. Concrete `OpenAITokenizer` and `AnthropicTokenizer` move to `packages/providers/src/tokenizers/` and implement `RuntimeTokenizer` (or adapt to it).
4. CLI/runtime startup constructs the correct tokenizer and injects it into `HistoryService`.
5. **Test:** HistoryService tests use a fake `RuntimeTokenizer` (e.g., `fakeTokenizer = { countTokens: async () => 42 }`) and never import provider tokenizers.

### Blocker 2: ToolIdStrategy normalization (Category E)

**Files:**
- `packages/core/src/tools/ToolIdStrategy.ts` (line 24)

**Current import:**
```typescript
import { normalizeToOpenAIToolId } from '../providers/utils/toolIdNormalization.js';
```

**Problem:** A core tool strategy imports a utility from `providers/utils/`. This creates a reverse dependency risk (core depends on providers).

**Remediation:**
1. **Core owns `toolIdNormalization.ts`.** Move it to `packages/core/src/tools/toolIdNormalization.ts` (or `packages/core/src/utils/toolIdNormalization.ts`).
2. Update `ToolIdStrategy.ts` to import from the new core location.
3. Provider package files that use `normalizeToOpenAIToolId` (e.g., `OpenAIRequestBuilder.ts`, `buildResponsesInputFromContent.ts`, `OpenAIStreamProcessor.ts`, etc.) import from core utility instead.
4. This is a **shared utility** that lives in core because both core history and providers need it.
5. **Test:** Existing `toolIdNormalization.test.ts` moves with the file to core. Provider conversion tests still verify tool ID behavior after move.

### Blocker 3: ProviderContentGenerator boundary (Category C)

**Files:**
- `packages/core/src/core/contentGenerator.ts` (lines 20–21)

**Current import:**
```typescript
import type { IProviderManager as ProviderManager } from '../providers/IProviderManager.js';
import { ProviderContentGenerator } from '../providers/ProviderContentGenerator.js';
```

**Problem:** Core content generator directly imports and constructs the provider-backed implementation.

**Remediation:**
1. Core keeps `ContentGenerator` interface (structural contract).
2. Provider package exports `ProviderContentGenerator` (implementation).
3. Core `contentGenerator.ts` receives a factory function or config object that returns `ContentGenerator`. The factory is provided by CLI/runtime, not constructed by core.
4. CLI startup path constructs `ProviderContentGenerator` using the provider package and injects it.
5. **Test:** Core content generator tests use a fake `ContentGenerator` (structural). Provider package tests verify `ProviderContentGenerator` with `FakeProvider`.

### Blocker 4: providerRuntimeContext error (Category F)

**Files:**
- `packages/core/src/runtime/providerRuntimeContext.ts` (line 15)

**Current import:**
```typescript
import { MissingProviderRuntimeError } from '../providers/errors.js';
```

**Problem:** Runtime imports a provider-specific error class. This creates bidirectional coupling (runtime ↔ providers).

**Remediation:**
1. Core owns `MissingProviderRuntimeError` — move it to `packages/core/src/runtime/errors.ts` (or `packages/core/src/errors/`).
2. Provider package keeps provider-specific errors (`AuthError`, `RateLimitError`, `ProviderConfigurationError`, etc.) and does not import core runtime errors.
3. If providers need to throw a runtime error, they construct it from a core contract type or use a generic error that runtime maps.
4. **Test:** Runtime context tests verify `MissingProviderRuntimeError` is thrown without importing provider package.

### Blocker 5: Config types referencing provider internals (Categories G, H)

**Files:**
- `packages/core/src/config/configTypes.ts` (lines 14, 24)
- `packages/core/src/config/configBaseCore.ts` (line 37)
- `packages/core/src/config/configConstructor.ts` (line 67)

**Current imports:**
```typescript
import type { BucketFailureReason } from '../providers/errors.js';
import type { ProviderManager } from '../providers/ProviderManager.js';
import type { IProviderManager as ProviderManager } from '../providers/IProviderManager.js';
```

**Problem:** Config knows about concrete provider manager and provider-specific failure reasons.

**Remediation:**
1. Core defines `BucketFailureReason` as a core-owned enum (or plain string union) in `packages/core/src/config/types.ts` or `packages/core/src/types/`.
2. Core config uses a structural `IProviderManager` interface (or a minimal `ProviderManagerLike` with only the methods config needs: `getAvailableModels()`, `getActiveProvider()`, `getActiveProviderName()`, etc.).
3. Concrete `ProviderManager` moves to provider package. Config never imports it.
4. **Test:** Config tests verify bucket/provider settings using a fake `ProviderManagerLike` that does not import providers.

### Blocker 6: Model hydration importing IModel (Category A)

**Files:**
- `packages/core/src/models/hydration.ts` (line 14)
- `packages/core/src/models/provider-integration.ts` (line 14)

**Current import:**
```typescript
import type { IModel } from '../providers/IModel.js';
```

**Problem:** Model layer imports provider contract.

**Remediation:**
1. Core defines `RuntimeModel` (structural contract) with fields needed by core: `id`, `name`, `provider`, `capabilities`, `contextWindow`, etc.
2. Provider `IModel` remains in provider package and may extend `RuntimeModel` or provide an adapter.
3. Core model hydration works with `RuntimeModel` only.
4. **Test:** Model hydration tests use plain `RuntimeModel` objects.

### Blocker 7: Telemetry types importing provider runtime (Category G)

**Files:**
- `packages/core/src/telemetry/types.ts` (line 20)

**Current import:**
```typescript
import { ProviderTelemetryContext } from '../providers/types/providerRuntime.js';
```

**Problem:** Telemetry types depend on provider runtime types.

**Remediation:**
1. Core defines `TelemetryContext` (structural) with fields: `providerName`, `modelId`, `tokenUsage`, `latencyMs`, `timestamp`, etc.
2. Provider package maps `ProviderTelemetryContext` → core `TelemetryContext` when emitting telemetry events.
3. Core telemetry types compile without any provider package dependency.
4. **Test:** Telemetry type usage compiles in isolation.

### Blocker 8: Core compression importing provider reasoning utils (Category J)

**Files:**
- `packages/core/src/core/compression/CompressionHandler.ts` (line 26)

**Current import:**
```typescript
import { ... } from '../../providers/reasoning/reasoningUtils.js';
```

**Problem:** Compression logic imports provider-specific reasoning utilities.

**Remediation:**
1. Core defines `ReasoningOutput` structural contract (text, reasoningText, signature, etc.).
2. Provider package owns reasoning extraction and converts to core `ReasoningOutput`.
3. Core compression receives `ReasoningOutput` from the provider through the `IProvider` interface, not by importing provider utilities.
4. **Test:** Compression tests use fake `ReasoningOutput` objects.

### Blocker 9: Core compression importing mediaUtils (Category I)

**Files:**
- `packages/core/src/core/compression/utils.ts` (line 25)

**Current import:**
```typescript
import { classifyMediaBlock } from '../../providers/utils/mediaUtils.js';
```

**Problem:** Compression utilities import provider media classification.

**Remediation:**
1. Core defines `MediaBlock` and `MediaBlockType` structural contracts.
2. Provider package owns `classifyMediaBlock` implementation. Core never imports it.
3. Provider content generator passes already-classified media blocks to core.
4. **Test:** Compression tests use plain `MediaBlock` objects with explicit types.

### Blocker 10: Index.ts massive re-exports (Category K)

**Files:**
- `packages/core/src/index.ts` (lines 304–357)

**Current imports:** Re-exports of `IProvider`, `ITool`, `IModel`, `IProviderManager`, `ContentGeneratorRole`, `ProviderContentGenerator`, `ProviderManager`, `OpenAIProvider`, `AnthropicProvider`, `GeminiProvider`, `FakeProvider`, `LoadBalancingProvider`, `errors`, `tokenizers`, `usageInfo`, `apiKeyQuotaResolver`, `utils`, etc.

**Problem:** `index.ts` is the primary public API of core, and it currently re-exports provider internals. This makes the core package tightly coupled to provider implementations.

**Remediation:**
1. Core `index.ts` stops re-exporting provider internals. It exports only core contracts, utilities, and runtime types.
2. Provider package creates its own `index.ts` exporting `IProvider`, `ITool`, `IModel`, `IProviderManager`, `ProviderManager`, `OpenAIProvider`, `AnthropicProvider`, `GeminiProvider`, `FakeProvider`, tokenizers, errors, etc.
3. CLI imports provider classes from `@vybestack/llxprt-code-providers` (or path mapping during transition).
4. Core test-utils that need provider types must import from the provider package, not from core internals.
5. **Test:** After split, core `index.ts` compiles without any provider imports. Provider package `index.ts` compiles with all provider exports.

### Blocker 11: Test-utils importing provider types (Category L)

**Files:**
- `packages/core/src/test-utils/providerCallOptions.ts` (lines 8–10)
- `packages/core/src/test-utils/runtime.ts` (lines 8–9)

**Current imports:**
```typescript
import { PROVIDER_CONFIG_KEYS } from '../providers/providerConfigKeys.js';
import type { GenerateChatOptions } from '../providers/IProvider.js';
import type { ProviderToolset } from '../providers/IProvider.js';
import type { IProvider } from '../providers/IProvider.js';
import type { ProviderManager } from '../providers/ProviderManager.js';
```

**Problem:** Test utilities live in core but import provider contracts. This is acceptable as test-only code, but must be monitored to prevent leaking into production.

**Remediation:**
1. Keep test-utils importing provider types for now, but verify they are excluded from production builds (tsconfig exclude, package.json `files` field, or bundler config).
2. During P14 (consumer migration), if test-utils are used by both core and provider tests, consider extracting shared test utilities into a `test-utils` workspace or importing from provider package.
3. **Test:** No production code imports from `test-utils/` files.

## Forbidden Import Scan Commands

The following commands must be run after P14/P15 to verify zero core → provider imports in production code:

```bash
# Core production code must not import from providers
rg -n "from ['\"].*providers/|from ['\"]@vybestack/llxprt-code-core/providers" packages/core/src --glob '*.ts' --glob '!**/*.test.ts' --glob '!**/*.spec.ts'

# CLI must not deep-import into core providers
rg -n "from ['\"].*core/src/providers/|from ['\"]@vybestack/llxprt-code-core/providers" packages/cli/src --glob '*.ts' --glob '!**/*.test.ts' --glob '!**/*.spec.ts'

# No phantom reference to non-existent providers package
rg -n "@vybestack/llxprt-code-providers" packages/core/src packages/cli/src --glob '*.ts' --glob '!**/*.test.ts' --glob '!**/*.spec.ts'
```

Expected result after P15: **zero matches** in all three commands.

## Package/Dependency Direction Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Core → Providers cycle after move | High | Core owns all structural contracts; providers import core contracts. Core never imports providers. |
| CLI deep-imports into core providers | Medium | CLI path mapping for `IProviderConfig` is temporary. CLI imports provider types from `@vybestack/llxprt-code-providers` after P14. |
| Test-only code leaking into production | Low | Verify tsconfig excludes `**/*.test.ts` and `test-utils/` are not in production bundles. |
| Tokenizer injection complexity | Medium | HistoryService must receive tokenizer via constructor; no default instantiation. |
| Index.ts public API breakage | Medium | Incremental migration: keep re-exports during transition, remove in P15. |

## Pre-existing Issues Noted

1. `LoadBalancingProvider.tpm.test.ts` — 25 pre-existing failures due to `MissingProviderRuntimeError`. Not caused by this issue. Tracked in preflight results.
2. `geminiChat.hook-control.test.ts` — single phantom `@vybestack/llxprt-code-providers` import. Must be fixed during P14 consumer migration.

## Summary

Phase 01 identified **11 concrete blockers** across **49 import sites** in **18 core files**. Every blocker has a specific remediation path that results in core owning structural contracts and providers owning concrete implementations. No package cycle will remain after P15 if these remediations are followed.

## Verification

- [x] All 251 provider files classified by deterministic rule or explicit exception.
- [x] All 49 core production import sites from providers categorized.
- [x] Every blocker has a concrete remediation plan with required test strategy.
- [x] No `packages/**` files were modified during Phase 01.
