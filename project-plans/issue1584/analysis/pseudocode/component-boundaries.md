# Pseudocode: Component Boundary Details

Plan ID: PLAN-20260603-ISSUE1584.P02

## Dependency Direction Rule

All component boundaries below enforce: `providers → core` (deep modules), `cli → providers`, `cli → core`. No `core → providers` production dependency. This is per `analysis/final-architecture.md`, `analysis/package-metadata-constraints.md`, and `analysis/anti-shim-policy.md`.

## Interface Contracts

**Inputs:** P01 blocker analysis (`analysis/core-import-remediation.md` Blockers 1–11), core structural contract locations (`analysis/core-structural-contracts.md`), provider file classification (`analysis/provider-file-classification.md`), final architecture (`analysis/final-architecture.md`), package metadata constraints (`analysis/package-metadata-constraints.md`), anti-shim policy (`analysis/anti-shim-policy.md`).

**Outputs:** explicit per-blocker contracts defining boundary ownership, dependency direction, and structural contract names for all 11 P01 blockers; no core → providers production dependency.

**Dependencies:** TypeScript compiler conventions, core-owned structural contract path conventions (`packages/core/src/runtime/contracts/`, `packages/core/src/runtime/errors/`), provider package public API.

**Contracts:**
- **C-CB-01 (Blocker 1 — HistoryService Tokenizer Injection):** Core owns `RuntimeTokenizer` and `RuntimeTokenizerFactory` contracts in `packages/core/src/runtime/contracts/`. `HistoryService` accepts `RuntimeTokenizer` via constructor/options injection; never imports or constructs `OpenAITokenizer`, `AnthropicTokenizer`, or provider `ITokenizer`. CLI/providers runtime supplies concrete tokenizer through `RuntimeTokenizerFactory`. Dependency direction: providers → core.
- **C-CB-02 (Blocker 2 — Tool ID Normalization):** Core owns `toolIdNormalization.ts` at a non-provider core path (e.g., `packages/core/src/tools/toolIdNormalization.ts`). Core `ToolIdStrategy.ts` imports from core-owned path. Provider code imports same core utility when needed. Dependency direction: providers → core (providers imports core utility, not vice versa).
- **C-CB-03 (Blocker 3 — ProviderContentGenerator Boundary):** Core owns `RuntimeContentGeneratorFactory` contract in `packages/core/src/runtime/contracts/`. Core `contentGenerator.ts` receives structural `ContentGenerator` via factory instead of importing/constructing `ProviderContentGenerator`. CLI/providers constructs `ProviderContentGenerator` from providers package and injects it. Dependency direction: providers → core.
- **C-CB-04 (Blocker 4 — Runtime Provider Errors):** Core owns `MissingRuntimeProviderError` in `packages/core/src/runtime/errors/`. Provider-specific errors (`AuthError`, `RateLimitError`, `ProviderConfigurationError`, etc.) remain in providers package. If providers need to throw a runtime error, they construct from a core contract type or use a generic error that runtime maps. Dependency direction: providers → core.
- **C-CB-05 (Blocker 5 — Config Type Contracts):** Core owns `BucketFailureReason` (enum or string union) and `RuntimeProviderManager` structural contract in `packages/core/src/runtime/contracts/` or `packages/core/src/config/types.ts`. Config modules (`configTypes.ts`, `configBaseCore.ts`, `configConstructor.ts`) import from core contracts only. Concrete `ProviderManager` moves to providers package. Dependency direction: providers → core.
- **C-CB-06 (Blocker 6 — Model Hydration Contracts):** Core owns `RuntimeModel` structural contract in `packages/core/src/runtime/contracts/` with fields: `id`, `name`, `provider`, `capabilities`, `contextWindow`. Core model modules (`hydration.ts`, `provider-integration.ts`) import `RuntimeModel` instead of provider `IModel`. Provider `IModel` remains in providers package and is structurally compatible without importing core contract. Dependency direction: providers → core.
- **C-CB-07 (Blocker 7 — Telemetry Contracts):** Core owns `TelemetryContext` structural contract in `packages/core/src/telemetry/types.ts` with fields: `providerName`, `modelId`, `tokenUsage`, `latencyMs`, `timestamp`. Core telemetry uses `TelemetryContext` instead of `ProviderTelemetryContext`. Provider package maps `ProviderTelemetryContext` → core `TelemetryContext`. Dependency direction: providers → core.
- **C-CB-08 (Blocker 8 — ReasoningOutput Contract):** Core owns `ReasoningOutput` structural contract with fields: `text`, `reasoningText`, `signature`, etc. Core `CompressionHandler.ts` receives `ReasoningOutput` from provider through `RuntimeProvider` core-owned structural contract, not by importing provider `reasoningUtils`. Provider package owns extraction and converts to core `ReasoningOutput`. Dependency direction: providers → core.
- **C-CB-09 (Blocker 9 — MediaBlock Contract):** Core owns `MediaBlock` and `MediaBlockType` structural contracts. Core compression `utils.ts` receives already-classified `MediaBlock` objects, not by importing `classifyMediaBlock`. Provider package owns `classifyMediaBlock` and converts to core `MediaBlock`. Dependency direction: providers → core.
- **C-CB-10 (Blocker 10 — Core Index Export Removal):** Core `index.ts` exports only core-owned contracts, utilities, runtime types, and core-owned structural contracts. No provider re-exports remain. Provider package `index.ts` exports its own complete public API. CLI imports provider classes from `@vybestack/llxprt-code-providers`. Dependency direction: cli → providers, cli → core; no core → providers.
- **C-CB-11 (Blocker 11 — Test-utils Isolation):** Core `test-utils/` files importing provider types are excluded from production builds (tsconfig exclude, package.json `files` field). No production code imports from `test-utils/`. During P14, shared test utilities may be extracted or redirected. Dependency direction: providers → core (production only; test-utils are test-only).

## HistoryService Tokenizer Injection (Blocker 1)

10: DEFINE `RuntimeTokenizer` and `RuntimeTokenizerFactory` contracts in `packages/core/src/runtime/contracts/` with token-count behavior used by `HistoryService` — per `core-structural-contracts.md` draft interfaces.
11: UPDATE `HistoryService` constructor/options to accept `RuntimeTokenizer` or `RuntimeTokenizerFactory` through existing config/runtime path.
12: REMOVE direct imports of `OpenAITokenizer`, `AnthropicTokenizer`, and provider `ITokenizer` from `HistoryService`.
13: MOVE concrete provider tokenizers (`OpenAITokenizer.ts`, `AnthropicTokenizer.ts`, `ITokenizer.ts`) to `packages/providers/src/tokenizers/` — per P01 classification Rule 11.
14: WIRE CLI/providers runtime setup to supply provider tokenizer implementation where current behavior requires provider-specific token accounting.
15: TEST history token accounting with deterministic injected tokenizer and provider tokenizer behavior in providers package.

## Tool ID Normalization (Blocker 2)

20: MOVE `normalizeToOpenAIToolId` from `providers/utils/toolIdNormalization.ts` to core-owned utility path (e.g., `packages/core/src/tools/toolIdNormalization.ts`) — per P01 explicit exception table (core-owned shared tool utility).
21: MOVE `toolIdNormalization.test.ts` with the utility to core test path.
22: UPDATE core `ToolIdStrategy.ts` to import the core-owned utility.
23: UPDATE provider code (e.g., `OpenAIRequestBuilder.ts`, `buildResponsesInputFromContent.ts`, `OpenAIStreamProcessor.ts`) to import the core-owned utility when needed.
24: TEST normalization behavior in core and provider request conversion.

## ProviderContentGenerator Boundary (Blocker 3)

30: DEFINE `RuntimeContentGeneratorFactory` structural contract in `packages/core/src/runtime/contracts/` for what core needs to request generated content — per `core-structural-contracts.md` draft interface.
31: MOVE concrete `ProviderContentGenerator.ts` to `packages/providers/src/ProviderContentGenerator.ts` — per P01 classification Rule 8.
32: CHANGE core `contentGenerator.ts` to receive a factory/structural generator instead of constructing provider package class.
33: WIRE CLI/provider manager setup to create provider-backed content generator.
34: TEST FakeProvider + ProviderContentGenerator through CLI/runtime path and scan core production code for no provider imports.

## Runtime Provider Errors (Blocker 4)

40: MOVE `MissingProviderRuntimeError` to core-owned runtime error module (e.g., `packages/core/src/runtime/errors/MissingRuntimeProviderError.ts`) — per `final-architecture.md` contract ownership.
41: UPDATE `runtime/providerRuntimeContext.ts` to import from core runtime error module.
42: KEEP provider-specific errors (`AuthError`, `RateLimitError`, `ProviderConfigurationError`, etc.) in providers package — per P01 classification Rule 7.
43: IF providers need to throw a runtime error: construct from a core contract type or use a generic error that runtime maps.
44: TEST runtime context error construction without importing provider package.

## Config Type Contracts (Blocker 5)

50: DEFINE core-owned `BucketFailureReason` as enum or string union in `packages/core/src/config/types.ts` or `packages/core/src/types/`.
51: REPLACE config imports of `ProviderManager`/`IProviderManager` with `RuntimeProviderManager` structural contract providing only methods config needs (`getAvailableModels()`, `getActiveProvider()`, `getActiveProviderName()`).
52: UPDATE `configTypes.ts`, `configBaseCore.ts`, `configConstructor.ts` to import from core contracts only.
53: MOVE concrete `ProviderManager` to `packages/providers/src/ProviderManager.ts` — per P01 classification Rule 8.
54: TEST config bucket/provider settings using fake `RuntimeProviderManager` that does not import providers.

## Model Hydration Contracts (Blocker 6)

60: DEFINE `RuntimeModel` structural contract in `packages/core/src/runtime/contracts/` with fields needed by core: `id`, `name`, `provider`, `capabilities`, `contextWindow`, etc. — per `core-structural-contracts.md` draft interface.
61: UPDATE `hydration.ts` and `provider-integration.ts` to import `RuntimeModel` instead of provider `IModel`.
62: ENSURE provider `IModel` remains in provider package and is structurally compatible with `RuntimeModel` without importing core contract.
63: TEST model hydration with plain `RuntimeModel` objects.

## Telemetry Contracts (Blocker 7)

70: DEFINE core-owned `TelemetryContext` structural contract in `packages/core/src/telemetry/types.ts` with fields: `providerName`, `modelId`, `tokenUsage`, `latencyMs`, `timestamp`, etc.
71: UPDATE core telemetry types to use `TelemetryContext` instead of `ProviderTelemetryContext`.
72: MAP `ProviderTelemetryContext` → core `TelemetryContext` when provider package emits telemetry events.
73: VERIFY core telemetry types compile in isolation without any provider package dependency.

## Compression Contracts (Blockers 8–9)

80: DEFINE `ReasoningOutput` structural contract in core with fields: `text`, `reasoningText`, `signature`, etc. — per `core-import-remediation.md` Blocker 8.
81: DEFINE `MediaBlock` and `MediaBlockType` structural contracts in core — per `core-import-remediation.md` Blocker 9.
82: UPDATE `CompressionHandler.ts` to receive `ReasoningOutput` from provider through `RuntimeProvider` core-owned structural contract (defined in `packages/core/src/runtime/contracts/`), not by importing provider `reasoningUtils` or referencing provider-owned `IProvider`.
83: UPDATE compression `utils.ts` to receive already-classified `MediaBlock` objects, not by importing `classifyMediaBlock`.
84: MOVE `reasoningUtils` extraction and `classifyMediaBlock` to providers package as implementation — per P01 classification Rules 10, 13.
85: TEST compression with fake `ReasoningOutput` and explicitly typed `MediaBlock` objects.

## Core Index Export Removal (Blocker 10)

90: REMOVE all provider re-exports from `packages/core/src/index.ts` including: `IProvider`, `ITool`, `IModel`, `IProviderManager`, `ContentGeneratorRole`, `ProviderContentGenerator`, `ProviderManager`, `OpenAIProvider`, `AnthropicProvider`, `GeminiProvider`, `FakeProvider`, `LoadBalancingProvider`, provider errors, tokenizers, usage info, `apiKeyQuotaResolver`, and provider utilities — per `core-import-remediation.md` Blocker 10.
91: ENSURE core `index.ts` exports only core contracts, utilities, runtime types, and core-owned structural contracts.
92: ENSURE provider package `index.ts` exports its own complete public API — per `package-boundary.md` C-PB-01 and `specification.md` REQ-API-001.1.
93: SCAN `packages/core/src/index.ts` for any remaining provider symbol re-exports — per `anti-shim-policy.md`.
94: VERIFY core `index.ts` compiles without any provider imports after removal.

## Test-utils Isolation (Blocker 11)

100: VERIFY `packages/core/src/test-utils/` files are excluded from production builds (check tsconfig exclude, package.json `files` field).
101: ENSURE no production code imports from `test-utils/` files.
102: PLAN test-utils extraction or provider-package import redirection for P14 consumer migration phase.
103: MONITOR test-utils for provider type imports that could leak into production builds.

## CLI Provider Wiring

110: ADD `@vybestack/llxprt-code-providers` as CLI dependency in `packages/cli/package.json` — per `package-metadata-constraints.md`.
111: UPDATE `providerManagerInstance.ts`, provider command files, and alias provider factory to import concrete providers/manager/config types from `@vybestack/llxprt-code-providers`.
112: KEEP CLI imports from core for core runtime/settings only.
113: PASS concrete provider manager/generator/tokenizer values into core through runtime structural contracts — per C-CM-01, C-CM-03.
114: TEST CLI provider manager creation, provider switching, and smoke startup — per REQ-TEST-001.1, C-V-05.

## Dependency Direction Enforcement

120: VERIFY `packages/core/package.json` has no `@vybestack/llxprt-code-providers` dependency — per C-PB-03.
121: VERIFY `packages/core/tsconfig.json` has no providers reference — per C-PB-03.
122: VERIFY `packages/providers/package.json` has `@vybestack/llxprt-code-core` dependency — per `package-metadata-constraints.md`.
123: VERIFY `packages/cli/package.json` has both core and providers dependencies — per `package-metadata-constraints.md`.
124: VERIFY root `package.json` workspaces includes `packages/providers` — per `package-metadata-constraints.md`.
125: RUN forbidden import scans from `anti-shim-policy.md` after each major migration step.
