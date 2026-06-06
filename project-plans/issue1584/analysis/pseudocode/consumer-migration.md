# Pseudocode: Consumer Migration

Plan ID: PLAN-20260603-ISSUE1584.P02

## Interface Contracts

**Inputs:** import graph after provider package build; core-import-remediation.md Blockers 1–11; core-structural-contracts.md contract locations; integration-contract.md boundary rules; anti-shim-policy.md forbidden patterns.

**Outputs:** consumers import provider APIs directly from `@vybestack/llxprt-code-providers` or use core-owned contracts; no core production file imports from providers; core `index.ts` exports only core contracts/utilities.

**Dependencies:** CLI provider wiring, core runtime/generation paths, package manager workspace links, npm install.

**Contracts:**
- **C-CM-01 (HistoryService tokenizer injection):** `HistoryService` accepts `RuntimeTokenizer` via constructor/options injection; never constructs `OpenAITokenizer` or `AnthropicTokenizer`. CLI/providers runtime supplies concrete tokenizer through `RuntimeTokenizerFactory` — per Blocker 1 and `core-structural-contracts.md` `RuntimeTokenizer`/`RuntimeTokenizerFactory` drafts.
- **C-CM-02 (ToolIdStrategy utility relocation):** `normalizeToOpenAIToolId` moves from `providers/utils/toolIdNormalization.ts` to a core-owned utility path (e.g., `packages/core/src/tools/toolIdNormalization.ts`). Core `ToolIdStrategy.ts` imports the relocated core utility. Provider code imports the same core utility when needed — per Blocker 2 and P01 explicit exception table.
- **C-CM-03 (ProviderContentGenerator factory inversion):** Core `contentGenerator.ts` receives a structural `ContentGenerator` created via `RuntimeContentGeneratorFactory` instead of directly importing/constructing `ProviderContentGenerator`. CLI/provider wiring constructs `ProviderContentGenerator` from providers package and injects it — per Blocker 3 and `core-structural-contracts.md` `RuntimeContentGeneratorFactory` draft.
- **C-CM-04 (Runtime provider errors/contracts):** `MissingProviderRuntimeError` moves to core-owned runtime error module (e.g., `packages/core/src/runtime/errors/MissingRuntimeProviderError.ts`). Provider-specific errors (`AuthError`, `RateLimitError`, `ProviderConfigurationError`) remain in providers package — per Blocker 4 and `analysis/final-architecture.md` contract ownership.
- **C-CM-05 (Config/model/telemetry/compression contracts):** Core config, models, telemetry, and compression modules replace provider imports with core-owned structural contracts or provider-agnostic types: `BucketFailureReason` → core-owned enum/union; `IModel` → `RuntimeModel`; `ProviderTelemetryContext` → core `TelemetryContext`; `reasoningUtils`/`mediaUtils` → core structural contracts (`ReasoningOutput`, `MediaBlock`/`MediaBlockType`) with provider supplying implementations — per Blockers 5–9.
- **C-CM-06 (CLI import migration):** CLI files (`providerManagerInstance.ts`, `aliasProviderFactory.ts`, `providerCommand.ts`, etc.) replace deep imports into `@vybestack/llxprt-code-core/providers/...` with imports from `@vybestack/llxprt-code-providers` public API or subpaths — per `integration-contract.md` CLI boundary rules and Blocker 10.
- **C-CM-07 (Core index export removal):** `packages/core/src/index.ts` removes all provider re-exports (`IProvider`, `ITool`, `IModel`, `IProviderManager`, `ContentGeneratorRole`, `ProviderContentGenerator`, `ProviderManager`, concrete provider classes, errors, tokenizers, usage info, apiKeyQuotaResolver, provider utilities). Only core contracts, utilities, and runtime types are exported — per Blocker 10 and `anti-shim-policy.md`.
- **C-CM-08 (Test-utils isolation):** Core `test-utils/` files that import provider types are reviewed to ensure they do not leak into production builds (tsconfig exclude, package.json `files` field). During P14, shared test utilities may be extracted or redirected to import from providers package — per Blocker 11.

## Numbered Pseudocode

10: FIND all CLI imports matching deep core provider paths: `from ['\"].*core/src/providers/|from ['\"]@vybestack/llxprt-code-core/providers` — per `integration-contract.md` CLI boundary rules.

11: FOR each CLI import of provider implementation or provider config type (e.g., `providerManagerInstance.ts`, `aliasProviderFactory.ts`, `providerCommand.ts`): REPLACE with `@vybestack/llxprt-code-providers` public API or package subpath — per C-CM-06.

12: FOR core production import of `OpenAITokenizer`/`AnthropicTokenizer`/`ITokenizer` in `HistoryService.ts`: INJECT `RuntimeTokenizer` via constructor/options; REMOVE provider tokenizer imports; CONSTRUCT provider tokenizers in CLI/providers runtime setup only — per C-CM-01.

13: FOR core production import of `normalizeToOpenAIToolId` in `ToolIdStrategy.ts`: MOVE `toolIdNormalization.ts` (and its test) from `providers/utils/` to core-owned utility path; UPDATE `ToolIdStrategy.ts` import to core path; UPDATE provider code to import same core utility — per C-CM-02.

14: FOR core production import of `ProviderContentGenerator` and `IProviderManager` in `contentGenerator.ts`: REPLACE construction with `RuntimeContentGeneratorFactory` structural contract; MOVE `ProviderContentGenerator` to providers package; WIRE CLI/provider manager setup to create and inject provider-backed generator — per C-CM-03.

15: FOR core production import of `MissingProviderRuntimeError` in `runtime/providerRuntimeContext.ts`: MOVE error to core runtime error module; UPDATE runtime import to core path; KEEP provider-specific errors in providers package — per C-CM-04.

16: FOR core config imports of `BucketFailureReason`, `ProviderManager`, `IProviderManager` in `configTypes.ts`, `configBaseCore.ts`, `configConstructor.ts`: REPLACE with core-owned `BucketFailureReason` enum/union and `RuntimeProviderManager` structural contract — per C-CM-05 (config).

17: FOR core model imports of `IModel` in `hydration.ts`, `provider-integration.ts`: REPLACE with `RuntimeModel` structural contract defined in `packages/core/src/runtime/contracts/` — per C-CM-05 (models).

18: FOR core telemetry import of `ProviderTelemetryContext` in `types.ts`: REPLACE with core-owned `TelemetryContext` structural contract — per C-CM-05 (telemetry).

19: FOR core compression imports of `reasoningUtils` in `CompressionHandler.ts` and `mediaUtils/classifyMediaBlock` in `utils.ts`: REPLACE with core structural contracts `ReasoningOutput` and `MediaBlock`/`MediaBlockType`; provider package supplies extraction/classification implementations that convert to core contracts — per C-CM-05 (compression).

20: FOR core `index.ts` re-exports of provider internals (lines 304–357 currently): REMOVE all provider re-exports; core `index.ts` exports only core contracts, utilities, runtime types, and core-owned structural contracts — per C-CM-07.

21: REVIEW core `test-utils/` files importing provider types (`providerCallOptions.ts`, `runtime.ts`): VERIFY they are excluded from production builds; PLAN extraction or provider-package import redirection for P14 — per C-CM-08.

22: ADD `@vybestack/llxprt-code-providers` as CLI dependency in `packages/cli/package.json`; RUN `npm install` to update workspace links and `package-lock.json` — per `package-metadata-constraints.md`.

23: DO NOT add `@vybestack/llxprt-code-providers` as a production dependency of `packages/core` in `packages/core/package.json` — enforced by C-PB-03 and `package-metadata-constraints.md`.

24: RUN targeted integration tests: provider manager creation, provider switching, content generation through CLI/runtime path — per REQ-TEST-001.1.

25: SCAN for forbidden imports using commands from `anti-shim-policy.md`:
    - `rg -n "from ['\"].*providers/|from ['\"]@vybestack/llxprt-code-core/providers" packages/core/src --glob '*.ts' --glob '!**/*.test.ts' --glob '!**/*.spec.ts'`
    - `rg -n "from ['\"].*core/src/providers/|from ['\"]@vybestack/llxprt-code-core/providers" packages/cli/src --glob '*.ts' --glob '!**/*.test.ts' --glob '!**/*.spec.ts'`
    - `rg -n "@vybestack/llxprt-code-providers" packages/core/src --glob '*.ts' --glob '!**/*.test.ts' --glob '!**/*.spec.ts'`
    — per `anti-shim-policy.md` required scans.

26: FAIL if forbidden imports remain — per C-PB-02, C-PB-03.

## Integration Points

- Line 11 covers `providerManagerInstance.ts`, `aliasProviderFactory.ts`, `providerCommand.ts`, and any other CLI file deep-importing core providers.
- Lines 12–19 cover each of the 10 substantive core production blockers identified in `core-import-remediation.md` with specific remediation per blocker.
- Line 20 covers Blocker 10 (index.ts massive re-exports) — largest single removal surface.
- Line 21 covers Blocker 11 (test-utils) — monitored but not fully migrated until P14.
- Lines 22–23 enforce dependency direction through package metadata, not just import scans.
- Lines 24–26 verify behavior preservation and enforce boundary through import pattern enforcement.

## Anti-Pattern Warnings

[ERROR] DO NOT: update tests to import mocks instead of real package APIs.
[ERROR] DO NOT: leave CLI importing providers through core deep paths or index re-exports.
[ERROR] DO NOT: add core re-export shims to preserve old import paths.
[ERROR] DO NOT: broaden HistoryService tokenizer injection into a general provider abstraction beyond what core actually consumes.
[OK] DO: verify provider switching through existing CLI/runtime paths.
[OK] DO: inject provider implementations through core-owned structural contracts.
[OK] DO: remove all provider re-exports from core index.ts in one batch during P15.
