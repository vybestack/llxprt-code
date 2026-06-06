# Core Structural Contract Constraints

Plan ID: PLAN-20260603-ISSUE1584

## Allowed Locations And Names

Core-owned runtime contracts must live under `packages/core/src/runtime/contracts/` or another P01-approved non-provider core path. Preferred files:

- `packages/core/src/runtime/contracts/RuntimeProvider.ts`
- `packages/core/src/runtime/contracts/RuntimeProviderManager.ts`
- `packages/core/src/runtime/contracts/RuntimeTokenizer.ts`
- `packages/core/src/runtime/contracts/RuntimeContentGeneratorFactory.ts`
- `packages/core/src/runtime/errors/MissingRuntimeProviderError.ts` or an existing runtime error module

## Forbidden Names And Locations

Do not create or retain new core compatibility files named:

- `packages/core/src/providers/IProvider.ts`
- `packages/core/src/providers/IProviderManager.ts`
- `packages/core/src/providers/ProviderManager.ts`
- `packages/core/src/providers/ProviderContentGenerator.ts`
- `packages/core/src/**/IProviderV2.ts`
- `packages/core/src/**/ProviderManagerCompat.ts`

## Required Checks

```bash
find packages/core/src -path '*providers*' -type f | sort
find packages/core/src -type f | rg '/(IProvider|IProviderManager|ProviderManager|ProviderContentGenerator)(V2|Compat|New|Copy)?\.ts$'
rg -n "@vybestack/llxprt-code-providers|from ['"].*/providers/" packages/core/src/runtime/contracts packages/core/src --glob '*.ts' --glob '!**/*.test.ts'
```


## Final Core Providers Directory Rule

The preferred and expected final state is zero production files under `packages/core/src/providers`. Any reclassified core-owned contracts/utilities must be moved to non-provider core paths such as `packages/core/src/runtime/contracts/`, `packages/core/src/runtime/errors/`, or a core utility path. Leaving files under `packages/core/src/providers` is allowed only for explicitly justified non-production artifacts during migration and must be eliminated before final cleanup unless P15a records an approved exception.


## Draft Interface Sketches

These are planning sketches, not final code. P03/P05 must adjust them to match actual core usage discovered in P01, but implementation must not invent broad provider abstractions beyond what core consumes.

```typescript
export interface RuntimeModel {
  id: string;
  name?: string;
  provider?: string;
  tokenLimit?: number;
}

export interface RuntimeTool {
  functionDeclarations?: unknown[];
  [key: string]: unknown;
}

export interface RuntimeProvider {
  readonly name: string;
  getCurrentModel?(): string;
  getModels?(): Promise<RuntimeModel[]>;
  setModel?(model: string): void | Promise<void>;
  generateChatCompletion?(messages: unknown[], tools?: RuntimeTool[], options?: unknown): AsyncIterable<unknown> | Promise<unknown>;
}

export interface RuntimeProviderManager {
  getActiveProvider(): RuntimeProvider | undefined;
  getProvider(name: string): RuntimeProvider | undefined;
  setActiveProvider(name: string): void | Promise<void>;
  getProviderNames?(): string[];
}

export interface RuntimeTokenizer {
  countTokens(content: unknown): number | Promise<number>;
}

export interface RuntimeTokenizerFactory {
  getTokenizer(providerName: string, model?: string): RuntimeTokenizer | undefined;
}

export interface RuntimeContentGeneratorFactory<TGenerator = unknown> {
  createContentGenerator(manager: RuntimeProviderManager): TGenerator;
}
```

Provider package public interfaces must be structurally compatible with these contracts where values cross into core. Core must not import provider package types to enforce compatibility.
