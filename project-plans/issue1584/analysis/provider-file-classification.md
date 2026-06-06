# Provider File Classification

Plan ID: PLAN-20260603-ISSUE1584.P01
Phase: 01 — Dependency and contract classification analysis

## Inventory Source

Generated from current working tree via:

```bash
find packages/core/src/providers -type f | sort > project-plans/issue1584/analysis/provider-file-inventory.txt
```

**Result:** 251 files total. 140 `.test.ts` files, 2 `.spec.ts` files, 1 `.pdf` fixture, 4 `.md` docs, and **106 production (non-test) TypeScript files**.

| Metric | Value |
|--------|-------|
| Total files | 251 |
| Test files (.test.ts) | 140 |
| Spec files (.spec.ts) | 2 |
| Documentation (.md) | 4 |
| Fixture (.pdf) | 1 |
| Production files (.ts, non-test) | 106 |

## Deterministic Directory Classification Rules

Every file under `packages/core/src/providers` is classified by the first matching rule below. The rules are ordered from most specific to least specific. Any file not matched by a rule is listed in the **Explicit Exceptions** table.

### Rule 1: `__tests__/` directories
**Pattern:** Any file inside a `__tests__/` directory anywhere under `providers/`.  
**Classification:** `provider test` — cross-provider or provider-specific unit tests.  
**Rationale:** These directories are reserved for test files and move with the code they exercise.  
**Coverage:** 17 files. All files inside `providers/__tests__/` and `providers/<provider>/__tests__/`.

### Rule 2: `test-utils/` directories
**Pattern:** Any file inside a `test-utils/` directory.  
**Classification:** `provider test support` — shared test helpers.  
**Rationale:** Test utilities exist solely to support provider package tests.  
**Coverage:** 2 files (`anthropic/test-utils/anthropicTestUtils.ts`, `test-utils/providerTestConfig.ts`).

### Rule 3: `__fixtures__/` directories
**Pattern:** Any file inside a `__fixtures__/` directory.  
**Classification:** `test fixture` — binary or static test data.  
**Rationale:** Fixtures move with their corresponding tests.  
**Coverage:** 1 file (`gemini/__fixtures__/test.pdf`).

### Rule 4: Named provider implementation directories
**Pattern:** Any file inside one of the following concrete provider directories:  
`anthropic/`, `gemini/`, `openai/`, `openai-responses/`, `openai-vercel/`, `fake/`, `chutes/`, `kimi/`, `synthetic/`, `zai/`.  
**Classification:** `provider implementation` — concrete SDK wrappers, request builders, parsers, stream processors, usage info, and provider-specific tests.  
**Rationale:** Each directory is self-contained provider logic that will become a submodule of the providers package.  
**Coverage:** ~193 files (all files inside named provider directories, including `.test.ts` and `.spec.ts` files inside those directories).

### Rule 5: `integration/` directory
**Pattern:** Any file inside `providers/integration/`.  
**Classification:** `provider integration test` — multi-provider cross-cutting tests.  
**Rationale:** Integration tests exercise provider orchestration and belong in the provider package.  
**Coverage:** 2 files (`multi-provider.integration.test.ts`, `TEST_INSTRUCTIONS.md`).

### Rule 6: `docs/` directories
**Pattern:** Any file inside `providers/**/docs/`.  
**Classification:** `provider documentation` — internal design docs for provider implementations.  
**Rationale:** Documentation moves with the implementation it describes.  
**Coverage:** 4 files (`openai/docs/*.md`).

### Rule 7: Top-level public contract files
**Pattern:** Any file directly under `providers/` whose basename matches one of the following:  
`IProvider.ts`, `IProviderManager.ts`, `ITool.ts`, `IModel.ts`, `types.ts`, `ContentGeneratorRole.ts`, `errors.ts`, `providerConfigKeys.ts`, `providerInterface.compat.test.ts`, `providerManager.context.test.ts`.  
**Classification:** `provider public API` — interfaces, types, errors, and top-level contracts that the provider package will expose.  
**Rationale:** Issue #1584 explicitly moves these public contracts.  
**Coverage:** 10 files.

### Rule 8: Top-level orchestration files
**Pattern:** Any file directly under `providers/` whose basename matches one of the following:  
`BaseProvider.ts`, `BaseProvider.test.ts`, `BaseProviderNormalization.ts`, `ProviderManager.ts`, `ProviderManager.test.ts`, `ProviderManager.gemini-switch.test.ts`, `LoadBalancingProvider.ts`, `LoggingProviderWrapper.ts`, `ProviderContentGenerator.ts`, `RetryOrchestrator.ts`, `apiKeyQuotaResolver.ts`, `apiKeyQuotaResolver.test.ts`, `customHeaders.ts`.  
**Classification:** `provider implementation/orchestration` — core provider framework, orchestration, and shared support.  
**Rationale:** These are the provider framework itself, not public contracts. They move to the providers package as implementation details.  
**Coverage:** 13 files.

### Rule 9: `logging/` directory
**Pattern:** Any file inside `providers/logging/`.  
**Classification:** `provider implementation support` — telemetry/content extraction wrappers.  
**Rationale:** Logging wrappers are provider-specific instrumentation.  
**Coverage:** 3 files.

### Rule 10: `reasoning/` directory
**Pattern:** Any file inside `providers/reasoning/`.  
**Classification:** `provider implementation support` — reasoning utilities.  
**Rationale:** Reasoning extraction is a provider concern.  
**Coverage:** 2 files.

### Rule 11: `tokenizers/` directory
**Pattern:** Any file inside `providers/tokenizers/`.  
**Classification:** `provider implementation` — concrete tokenizer implementations.  
**Rationale:** Concrete tokenizers (OpenAITokenizer, AnthropicTokenizer) move with providers; the structural contract (`ITokenizer`) remains as a provider-public type. Core must receive tokenizer injection rather than construct them.  
**Coverage:** 3 files.

### Rule 12: `types/` directory
**Pattern:** Any file inside `providers/types/`.  
**Classification:** `provider public API` — runtime config and provider runtime type contracts.  
**Rationale:** `IProviderConfig.ts` and `providerRuntime.ts` are consumed by CLI and runtime. They become part of the provider package public API.  
**Coverage:** 2 files.

### Rule 13: `utils/` directory — default
**Pattern:** Any file inside `providers/utils/` **except** files listed in the Explicit Exceptions table.  
**Classification:** `provider implementation support` — provider-only helpers (media, retry, auth, preview, dump, tool response, etc.).  
**Rationale:** The vast majority of utilities are provider-internal.  
**Coverage:** 23 files.

## Explicit Exceptions Table

Files that override the default `utils/` rule (Rule 13):

| Current Path | Classification Override | Rationale | Blocker / Consumer |
|--------------|-------------------------|-----------|-------------------|
| `providers/utils/toolIdNormalization.ts` | `core-owned shared tool utility` | Core `ToolIdStrategy.ts` imports `normalizeToOpenAIToolId`. This is a cross-cutting tool ID format concern, not provider-specific. | `packages/core/src/tools/ToolIdStrategy.ts` |
| `providers/utils/toolIdNormalization.test.ts` | `core-owned shared tool utility test` | Tests the core-owned utility. Must stay with the utility. | `packages/core/src/tools/ToolIdStrategy.ts` |

## Classification Summary by Category

| Classification | Count | Notes |
|----------------|-------|-------|
| provider implementation | ~193 | Concrete provider directories (anthropic, gemini, openai, openai-responses, openai-vercel, fake, chutes, kimi, synthetic, zai) plus docs, fixtures, test-utils |
| provider test | ~17 | `__tests__/` directories |
| provider integration test | 2 | `integration/` directory |
| provider public API | 12 | Top-level contracts + `types/` directory |
| provider implementation/orchestration | 13 | BaseProvider, ProviderManager, LoadBalancingProvider, etc. |
| provider implementation support | 28 | `logging/`, `reasoning/`, `utils/` (default), `tokenizers/` |
| core-owned shared tool utility | 2 | `toolIdNormalization.ts` + test — explicit exception |
| test fixture | 1 | `gemini/__fixtures__/test.pdf` |
| provider documentation | 4 | `openai/docs/*.md` |

## Coverage Verification

Total classified: 251 / 251 = 100% coverage. Every file from `find packages/core/src/providers -type f | sort` is covered by either a deterministic directory rule or the explicit exceptions table.

## Hard Gate Before P03

P03 MUST NOT begin until P01a verifies this classification against a fresh `find` run and confirms that no file has been added or removed without being covered by an existing rule or explicit exception.
