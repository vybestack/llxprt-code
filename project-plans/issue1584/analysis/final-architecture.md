# Final Architecture Decision: Cycle-Free Provider Extraction

Plan ID: PLAN-20260603-ISSUE1584

## Decision

Issue #1584 requires provider implementations, provider public interfaces/types, tokenizers, ProviderManager, provider utilities/errors, and ProviderContentGenerator to move to `packages/providers`. Parent issue #1568 requires no backward compatibility shims and clean package boundaries. The final implementation architecture for this plan is therefore:

```text
packages/providers  ->  packages/core deep modules as interim infrastructure imports
packages/cli        ->  packages/providers
packages/cli        ->  packages/core
packages/core       -X-> packages/providers
```

Core must not import from `@vybestack/llxprt-code-providers` in production. To make this possible while still moving provider public contracts to providers, core will own only internal structural runtime contracts that describe what core needs at runtime. These are not provider compatibility shims and must not re-export provider package APIs.

## Contract Ownership

| Concern | Final Owner | Why This Does Not Violate #1584 |
|---------|-------------|----------------------------------|
| Public `IProvider`, `IProviderManager`, provider config/types, provider errors | `packages/providers` | These are provider package APIs and move out of core. |
| Core runtime structural contracts such as `RuntimeProvider`, `RuntimeProviderManager`, `RuntimeTokenizer`, `RuntimeContentGeneratorFactory` | `packages/core` internal modules | These describe core's runtime needs without importing provider package. They are not public provider APIs and must not be re-exported as provider compatibility shims. |
| Concrete `ProviderManager` | `packages/providers` | CLI/providers construct it and pass structural values into core. |
| Concrete tokenizers (`OpenAITokenizer`, `AnthropicTokenizer`) | `packages/providers` | Core receives tokenizer behavior via injection/structural contracts instead of constructing provider tokenizers. |
| `ProviderContentGenerator` | `packages/providers` | Provider-backed content generation construction moves to CLI/providers or is injected via core-owned factory contract. |
| Tool ID normalization used by core tools and providers | Core-owned shared utility unless P01 proves it is provider-only | Core tools must not import provider package. Providers may import the core utility. |
| Runtime missing-provider errors | `packages/core` runtime | Runtime context cannot import provider package. |

## Forbidden Implementations

- `packages/core/src/index.ts` re-exporting any provider package API.
- `packages/core/src/providers/**` containing wrapper files that forward to `@vybestack/llxprt-code-providers`.
- `packages/core/package.json` depending on `@vybestack/llxprt-code-providers` while providers depends on core.
- `IProviderV2`, `NewProviderManager`, copied provider implementations, or compatibility adapters preserving old import paths.

## Allowed Implementations

- Core internal structural interfaces that are named for runtime use, not provider package compatibility.
- Provider package types that are structurally compatible with core runtime contracts.
- Providers importing temporary core deep modules for auth/settings/debug/tools/history until later extraction issues split those packages.


## Review-03 Precision Addendum

Before executing this phase, read and apply:

- `analysis/provider-external-dependencies.md`
- `analysis/core-deep-import-policy.md`
- `analysis/package-metadata-constraints.md`
- `analysis/core-structural-contracts.md`
- `analysis/pseudocode/component-boundaries.md`
- `analysis/provider-file-classification-complete.md`

These artifacts define direct dependency declarations, allowed core deep imports, package dependency direction, core contract names/locations, component-specific pseudocode, and complete provider file inventory/classification baseline.
