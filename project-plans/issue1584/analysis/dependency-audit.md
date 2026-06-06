# Dependency Audit: Provider Package Extraction

Plan ID: PLAN-20260603-ISSUE1584

## Evidence Collected

### Provider Tree Size

- `packages/core/src/providers` contains 251 files.
- 246 are TypeScript/TSX files.
- 140 are test/spec files.

### Production Provider Imports From Core Subsystems

Command used:

```bash
rg -n "from ['\"]\.\./\.\./(auth|config|core|debug|models|parsers|prompt-config|runtime|services|settings|telemetry|tools|types|utils)/" packages/core/src/providers --glob '*.ts' --glob '!**/*.test.ts' --glob '!**/*.spec.ts' | sed -E "s#.*from ['\"]../../([^/'\"]+).*#\1#" | sort | uniq -c | sort -rn
```

Observed subsystem counts:

```text
42 debug
32 services
22 tools
20 utils
7 config
6 auth
5 prompt-config
5 core
3 parsers
1 settings
1 runtime
```

Interpretation: providers cannot be extracted as a fully independent package in issue #1584 without also extracting several future packages. The safe short-term direction is `providers -> core` deep imports, while forbidding `core -> providers`.

### Production Core Imports From Providers

Representative production imports that must be removed or reclassified before final success:

- `packages/core/src/runtime/runtimeAdapters.ts`
- `packages/core/src/runtime/RuntimeInvocationContext.ts`
- `packages/core/src/runtime/providerRuntimeContext.ts`
- `packages/core/src/runtime/AgentRuntimeContext.ts`
- `packages/core/src/runtime/AgentRuntimeLoader.ts`
- `packages/core/src/config/configTypes.ts`
- `packages/core/src/config/configConstructor.ts`
- `packages/core/src/config/configBaseCore.ts`
- `packages/core/src/models/hydration.ts`
- `packages/core/src/models/provider-integration.ts`
- `packages/core/src/telemetry/types.ts`
- `packages/core/src/services/history/HistoryService.ts`
- `packages/core/src/tools/ToolIdStrategy.ts`
- `packages/core/src/tools/IToolFormatter.ts`
- `packages/core/src/tools/ToolFormatter.ts`
- `packages/core/src/core/TurnProcessor.ts`
- `packages/core/src/core/DirectMessageProcessor.ts`
- `packages/core/src/core/bucketFailoverIntegration.ts`
- `packages/core/src/core/StreamProcessor.ts`
- `packages/core/src/core/geminiChat.ts`
- `packages/core/src/core/contentGenerator.ts`
- `packages/core/src/core/compression/*`

### Representative Hard Blockers

- `HistoryService.ts` imports provider tokenizers. Tokenizer placement must be resolved before final dependency checks.
- `ToolIdStrategy.ts` imports `normalizeToOpenAIToolId` from provider utilities. Tool ID normalization is shared tool infrastructure, not provider implementation ownership.
- `contentGenerator.ts` imports `ProviderContentGenerator`. This is generation-provider adapter code and should either move to providers or be inverted behind a core-owned factory contract.
- `runtime/providerRuntimeContext.ts` imports `MissingProviderRuntimeError`. Runtime context must not depend on provider implementation package for error construction.

## Package Build Constraints

- Existing workspace packages have no `exports` field.
- `scripts/build_package.js` runs `tsc --build --clean`, then `tsc --build`, then copies markdown/json files.
- Deep imports are already used in CLI path mappings, so deep imports from providers to core are consistent with current repository mechanics until later extraction issues address package boundaries.

## Plan Consequence

Implementation must first classify and re-home shared contracts/utilities. A raw folder move is invalid because it creates a circular dependency or strands production core imports.


## Resolution Decisions

See `analysis/final-architecture.md` for the accepted cycle-free architecture. The short version is: provider public contracts and implementations move to providers, while core uses internal structural runtime contracts and injected factories where needed. This avoids `core -> providers` while satisfying the issue's no-shim requirement.

Concrete blocker resolutions are expanded in `analysis/core-import-remediation.md`.


## Review-03 Precision Addendum

Before executing this phase, read and apply:

- `analysis/provider-external-dependencies.md`
- `analysis/core-deep-import-policy.md`
- `analysis/package-metadata-constraints.md`
- `analysis/core-structural-contracts.md`
- `analysis/pseudocode/component-boundaries.md`
- `analysis/provider-file-classification-complete.md`

These artifacts define direct dependency declarations, allowed core deep imports, package dependency direction, core contract names/locations, component-specific pseudocode, and complete provider file inventory/classification baseline.
