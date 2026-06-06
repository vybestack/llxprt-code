# Feature Specification: Extract Provider Package

## Purpose

Refactor provider implementations out of `packages/core/src/providers` into a dedicated `packages/providers` workspace package for issue #1584. The purpose is architectural modularization for parent issue #1568: reduce core's public surface and package responsibilities while preserving current runtime behavior. This is a refactoring plan, not a user-visible feature addition.

## Architectural Decisions

- **Pattern**: package-boundary refactoring with contract-first migration and integration-first verification.
- **Technology Stack**: TypeScript strict mode, Node.js >=20, npm workspaces as currently configured, Vitest for tests, existing `scripts/build_package.js` TypeScript build process.
- **Data Flow**: CLI creates/configures provider managers and providers; core runtime/generation paths consume provider contracts; provider implementations call core-adjacent services such as auth/settings/debug/history until those packages are extracted by later issues.
- **Dependency Direction**: The final accepted state for this issue MUST NOT contain a package cycle. The target dependency direction is `packages/providers -> packages/core` temporarily, `packages/cli -> packages/providers`, and no production dependency from `packages/core -> packages/providers`.
- **No Compatibility Shims**: `packages/core/src/index.ts` must stop exporting provider implementations and provider package APIs. Callers must import from `@vybestack/llxprt-code-providers` directly.

## Project Structure

```text
project-plans/issue1584/
  specification.md
  execution-tracker.md
  analysis/
    domain-model.md
    integration-contract.md
    dependency-audit.md
    pseudocode/
      package-boundary.md
      consumer-migration.md
      verification.md
  plan/
    00-overview.md
    00a-preflight-verification.md
    01-analysis.md
    01a-analysis-verification.md
    02-pseudocode.md
    02a-pseudocode-verification.md
    02b-integration-contract.md
    02c-integration-contract-verification.md
    03-contracts-stub.md
    03a-contracts-stub-verification.md
    04-contracts-tdd.md
    04a-contracts-tdd-verification.md
    05-contracts-impl.md
    05a-contracts-impl-verification.md
    06-package-scaffold-stub.md
    06a-package-scaffold-stub-verification.md
    07-package-scaffold-tdd.md
    07a-package-scaffold-tdd-verification.md
    08-package-scaffold-impl.md
    08a-package-scaffold-impl-verification.md
    09-provider-move-stub.md
    09a-provider-move-stub-verification.md
    10-provider-move-tdd.md
    10a-provider-move-tdd-verification.md
    11-provider-move-impl.md
    11a-provider-move-impl-verification.md
    12-consumer-migration-stub.md
    12a-consumer-migration-stub-verification.md
    13-consumer-migration-tdd.md
    13a-consumer-migration-tdd-verification.md
    14-consumer-migration-impl.md
    14a-consumer-migration-impl-verification.md
    15-deprecation-cleanup.md
    15a-deprecation-cleanup-verification.md
    16-full-verification.md
    16a-full-verification-review.md
```

## Technical Environment

- **Type**: TypeScript monorepo CLI/library refactoring.
- **Runtime**: Node.js >=20.
- **Package Manager**: npm workspaces in repository scripts; root package metadata currently declares pnpm but verification commands in project memory use npm.
- **Build**: `node ../../scripts/build_package.js` inside packages.
- **Testing**: Vitest via package scripts and root workspace scripts.
- **Existing Packages**: `core`, `cli`, `a2a-server`, `test-utils`, `vscode-ide-companion`, `lsp`.

## Integration Points

### Existing Code That Will Use The Extracted Package

- `packages/cli/src/providers/providerManagerInstance.ts` - creates provider manager and concrete providers.
- `packages/cli/src/providers/aliasProviderFactory.ts` - imports provider config types.
- `packages/cli/src/ui/commands/providerCommand.ts` - imports provider interface types.
- `packages/core/src/core/contentGenerator.ts` - currently constructs `ProviderContentGenerator`; must be decoupled or moved to avoid core-to-providers package dependency.
- `packages/core/src/services/history/HistoryService.ts` - currently imports provider tokenizers; must be decoupled to avoid core-to-providers package dependency.
- `packages/core/src/tools/ToolIdStrategy.ts` - currently imports provider tool ID normalization; must be decoupled by moving the shared utility out of provider implementation code or keeping it core-owned.
- `packages/core/src/runtime/providerRuntimeContext.ts` - currently imports `MissingProviderRuntimeError`; must use a core-owned runtime error or shared contract.
- `packages/core/src/runtime/*`, `packages/core/src/config/*`, `packages/core/src/models/*`, `packages/core/src/telemetry/types.ts`, `packages/core/src/core/*`, and compression modules - currently import provider contracts and must be made independent of provider implementation package.

### Existing Code To Be Replaced Or Removed

- `packages/core/src/providers/**` - provider implementation home to remove after migration.
- Provider export block in `packages/core/src/index.ts` around provider types/classes/tokenizers/errors/utilities.
- CLI deep imports from `@vybestack/llxprt-code-core/providers/...`.
- Core production imports from `../providers/...` or `../../providers/...` by replacing them with core-owned contracts/utilities or by moving relevant implementation into `packages/providers`.

### User Access Points

This refactor should preserve all existing access points:

- CLI startup through `node scripts/start.js ...`.
- Provider switching commands and provider alias flows.
- Existing settings/profile driven provider selection.
- Existing OpenAI, Anthropic, Gemini, OpenAI Responses, OpenAI Vercel, Fake, and load-balancing provider behavior.

### Migration Requirements

- No user data format migration is expected.
- Package metadata and lockfile/workspace links must be updated.
- Imports throughout source and tests must be migrated.
- Core public exports must intentionally stop exposing providers; no backward compatibility re-export shims.

## Formal Requirements

[REQ-PKG-001] Provider Package Boundary
  [REQ-PKG-001.1] All provider implementations currently in `packages/core/src/providers` MUST live under `packages/providers/src` after migration.
  [REQ-PKG-001.2] `packages/providers` MUST follow existing workspace package conventions for package metadata, TypeScript build, Vitest config, and source entry points.
  [REQ-PKG-001.3] `packages/providers` MUST expose a clean public API through `@vybestack/llxprt-code-providers`.

[REQ-DEP-001] Dependency Direction
  [REQ-DEP-001.1] Production package dependencies MUST NOT form a `core <-> providers` cycle.
  [REQ-DEP-001.2] `packages/core` production code MUST NOT import from `@vybestack/llxprt-code-providers` after this issue unless the plan is explicitly updated with a cycle-free shared package design.
  [REQ-DEP-001.3] Temporary provider imports from core deep modules are allowed only where they reflect later extraction issues for auth/settings/tools/etc.

[REQ-API-001] Public API Migration
  [REQ-API-001.1] `packages/core/src/index.ts` MUST remove provider implementation exports and MUST NOT re-export providers from the new package.
  [REQ-API-001.2] CLI and other consumers MUST import provider APIs directly from `@vybestack/llxprt-code-providers`.
  [REQ-API-001.3] Existing provider runtime behavior MUST remain reachable through current CLI commands and startup flows.

[REQ-TEST-001] Behavioral Refactoring Verification
  [REQ-TEST-001.1] Tests MUST prove provider selection, provider switching, and representative provider generation behavior still work through existing paths.
  [REQ-TEST-001.2] Tests MUST prove the package boundary by detecting forbidden core-to-provider imports and forbidden core provider re-exports.
  [REQ-TEST-001.3] Tests MUST avoid reverse testing, mock theater, and tests that only validate structure.

[REQ-CLEAN-001] Cleanup And No Shims
  [REQ-CLEAN-001.1] Old provider source files MUST be removed from `packages/core/src/providers` after migration, except files deliberately reclassified as core-owned contracts/utilities by the analysis phase.
  [REQ-CLEAN-001.2] No `V2`, `New`, compatibility wrapper, or parallel provider implementation files may be introduced.
  [REQ-CLEAN-001.3] Full verification suite required by project memory MUST pass before PR.

## Data Schemas

No new runtime data schema is introduced. Package metadata must follow existing package structure:

```json
{
  "name": "@vybestack/llxprt-code-providers",
  "version": "0.10.0",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "node ../../scripts/build_package.js",
    "lint": "eslint . --ext .ts,.tsx",
    "format": "prettier --write .",
    "test": "vitest run",
    "test:ci": "vitest run",
    "typecheck": "tsc --noEmit"
  }
}
```

## Example Data

```json
{
  "oldImport": "@vybestack/llxprt-code-core/providers/IProvider.js",
  "newImport": "@vybestack/llxprt-code-providers",
  "forbiddenCoreExport": "export { OpenAIProvider } from './providers/openai/OpenAIProvider.js'",
  "requiredSmokeCommand": "node scripts/start.js --profile-load ollamakimi \"write me a haiku and nothing else\""
}
```

## Constraints

- This is a refactor: no intentional behavior changes.
- No backward compatibility shims from core to providers.
- No package dependency cycles.
- Do not broaden into extracting auth/tools/settings packages unless preflight proves it is necessary and the plan is updated first.
- TDD is mandatory for production changes: write failing integration/behavior tests before implementation.
- Integration tests must be defined before unit tests for multi-component boundaries.
- Existing `.llxprt/` contents must not be modified.

## Performance Requirements

- Provider package extraction must not add measurable startup overhead through duplicate initialization.
- Existing provider tests must not become materially slower due to package-boundary changes.
- Build order must remain deterministic under `npm run build --workspaces` and root `npm run build`.


## Cycle-Free Architecture Addendum

The implementation MUST follow `analysis/final-architecture.md`. Provider public APIs move to `packages/providers`; core may retain or create only internal structural runtime contracts such as `RuntimeProvider`, `RuntimeProviderManager`, `RuntimeTokenizer`, and `RuntimeContentGeneratorFactory`. These contracts are allowed only if they do not import or re-export provider package symbols. Concrete `ProviderManager`, concrete tokenizers, provider public errors, and `ProviderContentGenerator` move to `packages/providers`.

Tokenizer resolution is by injection/factory: core `HistoryService` must not construct `OpenAITokenizer` or `AnthropicTokenizer` after migration. Provider-specific tokenizer implementations live in providers and are supplied through CLI/runtime/provider wiring.

Provider-backed content generation construction moves out of core or is inverted behind a core-owned structural factory. Core `contentGenerator.ts` must not import `ProviderContentGenerator` after migration.

Anti-shim enforcement is defined in `analysis/anti-shim-policy.md`; behavioral regression coverage is defined in `analysis/behavioral-regression-matrix.md`.


## Review-03 Precision Addendum

Before executing this phase, read and apply:

- `analysis/provider-external-dependencies.md`
- `analysis/core-deep-import-policy.md`
- `analysis/package-metadata-constraints.md`
- `analysis/core-structural-contracts.md`
- `analysis/pseudocode/component-boundaries.md`
- `analysis/provider-file-classification-complete.md`

These artifacts define direct dependency declarations, allowed core deep imports, package dependency direction, core contract names/locations, component-specific pseudocode, and complete provider file inventory/classification baseline.


## Package Naming Decision

The new package name is `@vybestack/llxprt-code-providers`. This is intentional and follows the existing workspace naming convention (`@vybestack/llxprt-code-core`, `@vybestack/llxprt-code`, `@vybestack/llxprt-code-test-utils`). Any shorter name such as `@vybestack/llxprt-providers` in parent planning discussions is treated as illustrative, not the implementation name for this repository.


## Final Core Providers Directory Rule

The preferred and expected final state is zero production files under `packages/core/src/providers`. Any reclassified core-owned contracts/utilities must be moved to non-provider core paths such as `packages/core/src/runtime/contracts/`, `packages/core/src/runtime/errors/`, or a core utility path. Leaving files under `packages/core/src/providers` is allowed only for explicitly justified non-production artifacts during migration and must be eliminated before final cleanup unless P15a records an approved exception.
