# Feature Specification: Extract packages/auth

Plan ID: PLAN-20260608-ISSUE1586

## Purpose

Extract the entire authentication system from `packages/core/src/auth/` and the auth domain interfaces/types from `packages/cli/src/auth/` into a dedicated `packages/auth` workspace package. This reduces core's surface area and package responsibilities per parent issue #1568, establishes a clean dependency boundary, and enables auth to be consumed independently by future package extractions (storage, settings, debug).

## Architectural Decisions

- **Pattern**: Package-boundary refactoring with contract-first dependency injection. Auth components accept injected interfaces for external concerns (storage, settings, logging, runtime context) so `packages/auth` never imports core/cli/providers/tools.
- **Technology Stack**: TypeScript strict mode, Node.js >=20, npm workspaces, Vitest, Zod schemas, existing `scripts/build_package.js` build.
- **Data Flow**: CLI constructs auth components (KeyringTokenStore, AuthPrecedenceResolver) by injecting core implementations of ISecureStore, ISettingsService, IProviderKeyStorage, IDebugLogger. AuthPrecedenceResolver is the public entry point; provider-specific auth adapters are registered, not hard-coded. **Note:** `IProviderKeyStorage` is an instance contract (getKey, listKeys, hasKey); `getProviderKeyStorage()` is a core factory/injection concern that returns an object satisfying this interface — the factory stays in core, the interface lives in auth. `IDebugLogger` is an instance contract (debug, error, warn); the module-level `debugLogger` singleton and `DebugLogger` class constructor are core factory concerns that produce instances satisfying this interface — auth receives logger instances via DI injection, neither the singleton nor the constructor moves to auth. The `IDebugLogger` interface and factory type are defined from actual logger usage preflight (see P00a).
- **Dependency Direction (acyclic DAG)**: `packages/auth` production `dependencies` contain only `zod` and Node builtins — zero `@vybestack/*` packages. `packages/auth` `devDependencies` also contain zero `@vybestack/*` packages; auth tests use local DI test doubles defined within `packages/auth` (see Test Migration Policy in `analysis/auth-file-classification.md`), never importing from sibling packages. `packages/core` depends on `@vybestack/llxprt-code-auth`. `packages/cli` depends on both `@vybestack/llxprt-code-auth` and `@vybestack/llxprt-code-core`. `packages/providers` depends on `@vybestack/llxprt-code-auth` AND `@vybestack/llxprt-code-core`. The dependency graph is strictly acyclic: auth ⊥ all; core → auth; providers → auth, providers → core; cli → auth, cli → core. Providers does NOT transitively depend on core's auth re-exports — providers imports auth symbols directly from `@vybestack/llxprt-code-auth` while importing `SettingsService` and other non-auth utilities from `@vybestack/llxprt-code-core`.
- **OAuthProvider Ownership**: `OAuthProvider` interface stays in `packages/cli/src/auth/types.ts`. Used only by CLI adapter classes; `AuthPrecedenceResolver` uses `OAuthManager` interface instead. Can move to auth later if cross-package need arises. This decision is consistent across all plan artifacts.
- **packages/storage Absence**: `packages/storage` does not exist in the current repository. `ISecureStore` and `IProviderKeyStorage` are DI interfaces defined in `packages/auth/src/interfaces/` as the intentional interim design. They are authored locally in auth (not imported from a missing package) because auth owns the contract for what it needs from storage. When `packages/storage` is extracted, these interfaces can migrate there without changing auth's public behavior. **Interim design note (Blocker 6):** `KeyringTokenStore` in auth continues to use `node:fs/promises`, `node:path`, and `node:os` for file-lock/fallback logic in the existing `KeyringTokenStore` code. These Node builtins are production dependencies of auth's `KeyringTokenStore`, not DI boundary violations — `ISecureStore` defines the abstract storage contract, but `KeyringTokenStore` itself has legitimate file-lock coordination logic using Node builtins. Core's `SecureStore` (`@napi-rs/keyring` native module) is NOT imported into auth — it stays in core and is injected via `ISecureStore`. Neither `@napi-rs/keyring` nor core's `SecureStore`/`KeyringAdapter` moves into auth.
- **CLI OAuthManager Scope**: Issue #1586 says oauth-manager.ts and CLI-specific auth logic should move. The plan interprets this as: the **interface** moves to auth (making auth domain independent), while the CLI **implementation** (preflight-verified line count of CLI-specific orchestration) stays in CLI. Moving the implementation would create a cycle (auth depends on CLI types). Full decomposition of OAuthManager into smaller domain objects is deferred as a potential follow-up issue.

## Project Structure

```text
project-plans/issue1586/
  specification.md
  execution-tracker.md
  analysis/
    domain-model.md
    dependency-audit.md
    auth-file-inventory.md
    auth-file-classification.md
    auth-move-map.md
    external-dependencies.md
    integration-contract.md
    final-architecture.md
    anti-shim-policy.md
    package-metadata-constraints.md
    phase-verification-matrix.md
    preflight-results-template.md
    pseudocode/
      component-boundaries.md
      consumer-migration.md
      auth-domain-split.md
  plan/
    00-overview.md
    00a-preflight-verification.md
    01-analysis.md
    01a-analysis-verification.md
    02-pseudocode.md
    02a-pseudocode-verification.md
    02b-integration-contract.md
    02c-integration-contract-verification.md
    03-package-scaffold-stub.md
    03a-package-scaffold-stub-verification.md
    04-package-scaffold-tdd.md
    04a-package-scaffold-tdd-verification.md
    05-package-scaffold-impl.md
    05a-package-scaffold-impl-verification.md
    06-interfaces-stub.md
    06a-interfaces-stub-verification.md
    07-interfaces-tdd.md
    07a-interfaces-tdd-verification.md
    08-interfaces-impl.md
    08a-interfaces-impl-verification.md
    09-auth-move-stub.md
    09a-auth-move-stub-verification.md
    10-auth-move-tdd.md
    10a-auth-move-tdd-verification.md
    11-auth-move-impl.md
    11a-auth-move-impl-verification.md
    12-oauth-split-stub.md
    12a-oauth-split-stub-verification.md
    13-oauth-split-tdd-contract-tests.md
    13a-oauth-split-contract-verification.md
    14-oauth-split-impl.md
    14a-oauth-split-impl-verification.md
    15-consumer-migration-stub.md
    15a-consumer-migration-stub-verification.md
    16-consumer-migration-tdd.md
    16a-consumer-migration-tdd-verification.md
    17-consumer-migration-impl.md
    17a-consumer-migration-impl-verification.md
    18-deprecation-cleanup.md
    18a-deprecation-cleanup-verification.md
    19-full-verification.md
    19a-full-verification-review.md
  scripts/
    verify-auth-extraction-gate.js
```

**Note on file naming:** The artifacts use consistent naming across the plan. Specifically:
- `auth-file-inventory.md` (not `.txt`) — inventory of all auth TS files
- `auth-move-map.md` (not `auth-move-map-detailed.md`) — source→destination move map
- `external-dependencies.md` (not `auth-external-dependencies.md`) — external dependency audit

## Technical Environment

- **Type**: TypeScript monorepo CLI/library refactoring.
- **Runtime**: Node.js >=20.
- **Package Manager**: npm workspaces. Mandatory executable gate in P00a/P03 verifies CI/lockfile consistency before any install commands. If inconsistent, the gate exits non-zero and the phase stops for a strategy decision — never allow mixed npm/pnpm paths.
- **Build**: `node ../../scripts/build_package.js` inside packages.
- **Testing**: Vitest via package scripts.
- **Existing Packages**: core (0.10.0), cli (0.10.0), providers (0.10.0), a2a-server, test-utils, vscode-ide-companion, lsp.
- **Absent Packages**: `packages/storage` does not exist; DI interfaces are interim design.

## Integration Points

### Existing Code That Will Use The Extracted Package

- `packages/cli/src/auth/oauth-manager.ts` — implements `OAuthManager` interface; will implement interface from `@vybestack/llxprt-code-auth`.
- `packages/cli/src/auth/types.ts` — re-exports auth types from core; will re-export from `@vybestack/llxprt-code-auth`. `OAuthProvider` stays in this file.
- `packages/cli/src/auth/oauth-provider-base.ts` — imports `OAuthError`, `OAuthToken` from core.
- `packages/cli/src/auth/auth-flow-orchestrator.ts` — imports `OAuthError`, token types from core.
- `packages/cli/src/auth/proxy/*.ts` — imports token stores, `DebugLogger`, `SecureStore` from core.
- `packages/core/src/auth/keyring-token-store.ts` — imports `SecureStore`, `DebugLogger` from core sub-modules.
- `packages/core/src/auth/precedence.ts` — imports `SettingsService`, `ProviderRuntimeContext`, `debugLogger`.
- `packages/core/src/auth/auth-precedence-resolver.ts` — imports `SettingsService`, `ProviderRuntimeContext`, `DebugLogger`, `ProviderKeyStorage`, `debugLogger`.
- `packages/core/src/auth/codex-device-flow.ts` — imports `DebugLogger`.
- `packages/cli/src/auth/proxy/credential-store-factory.ts` — imports `SecureStore`, `KeyringTokenStore`, `ProxyTokenStore` from core.
- `packages/cli/src/auth/proxy/credential-proxy-server.ts` — imports proxy types and `DebugLogger`.
- `packages/providers/src/BaseProvider.ts` — imports `AuthPrecedenceResolver`, `AuthPrecedenceConfig`, `OAuthManager` from `@vybestack/llxprt-code-core/auth/precedence.js`.
- `packages/providers/src/*/Provider.ts` (4 files: GeminiProvider, AnthropicProvider, OpenAIProvider, OpenAIVercelProvider) — imports `OAuthManager` from `@vybestack/llxprt-code-core/auth/precedence.js`.
- `packages/providers/src/openai-responses/OpenAIResponsesProviderBase.ts` — imports `CodexOAuthTokenSchema` from `@vybestack/llxprt-code-core/auth/types.js`.
- `packages/providers/src/openai/openai-oauth.spec.ts` — imports `flushRuntimeAuthScope` from `@vybestack/llxprt-code-core/auth/precedence.js`.
- `packages/providers/src/openai-responses/__tests__/OpenAIResponsesProvider.promptCacheKey.test.ts` — imports `type CodexOAuthToken` from `@vybestack/llxprt-code-core/auth/types.js`.

### Existing Code To Be Replaced Or Removed

- `packages/core/src/auth/**` — all 15 production + 20 test files move to `packages/auth/src/`.
- `packages/core/src/core/StreamProcessor.ts` — imports `flushRuntimeAuthScope` from `../auth/precedence.js`; must update to `@vybestack/llxprt-code-auth` (or core re-export).
- Re-exports in `packages/core/src/index.ts` for auth types: `OAuthToken`, `TokenStore`, `KeyringTokenStore`, `AuthPrecedenceResolver`, `OAuthManager`, `OAuthError`, `OAuthErrorFactory`, `OAuthTokenRequestMetadata`, `flushRuntimeAuthScope`, `RuntimeAuthScopeFlushResult` etc.
- `packages/core/package.json` exports field has `./auth/precedence.js` and `./auth/types.js` subpath exports which must be removed after migration.
- `packages/cli/src/auth/types.ts` re-exports from core → must re-export from `@vybestack/llxprt-code-auth`.
- `packages/providers/src/*` imports from `@vybestack/llxprt-code-core/auth/` → must import from `@vybestack/llxprt-code-auth`.

### User Access Points

- CLI startup through `node scripts/start.js ...`.
- Auth commands (`/login`, `/logout`, `/auth-status`, `/key`).
- Provider authentication precedence resolution during provider construction.
- Credential proxy system for sandbox mode.
- `flushRuntimeAuthScope` for runtime-scoped credential flushing (used by StreamProcessor, provider tests).

### Migration Requirements

- No user data format migration.
- Core must provide DI factory functions that inject core's `SecureStore`/`DebugLogger`/`SettingsService`/`ProviderKeyStorage` into auth package constructors.
- Core `index.ts` replaces direct auth re-exports with re-exports from `@vybestack/llxprt-code-auth`.
- CLI auth proxy files remain in CLI; they import types from `@vybestack/llxprt-code-auth`.
- Providers auth imports change from `@vybestack/llxprt-code-core/auth/*` to `@vybestack/llxprt-code-auth`.
- `flushRuntimeAuthScope` is exported from `@vybestack/llxprt-code-auth` main entry (REQ-API-001).

### Symbol-Level Migration Table for Deep-Path Consumers

The current `@vybestack/llxprt-code-core` package exposes `./auth/precedence.js` and `./auth/types.js` subpath exports. After migration, these are removed. Every symbol currently imported via those paths must be available from `@vybestack/llxprt-code-auth` main entry:

#### `@vybestack/llxprt-code-core/auth/precedence.js` → `@vybestack/llxprt-code-auth`

| Symbol | Type | Consumers | Migration |
|--------|------|-----------|-----------|
| `AuthPrecedenceResolver` | class | `providers/BaseProvider.ts` | Main-entry export |
| `AuthPrecedenceConfig` | type | `providers/BaseProvider.ts` | Main-entry export |
| `OAuthManager` | interface | 6 provider files (BaseProvider.ts, GeminiProvider.ts, AnthropicProvider.ts, OpenAIProvider.ts, OpenAIVercelProvider.ts, OpenAIResponsesProviderBase.ts) | Main-entry export |
| `OAuthTokenRequestMetadata` | type | `providers/BaseProvider.test.ts` | Main-entry export |
| `flushRuntimeAuthScope` | function | `providers/openai/openai-oauth.spec.ts`, `core/StreamProcessor.ts` | Main-entry export (REQ-API-001) |
| `RuntimeAuthScopeFlushResult` | type | `cli/runtime/` | Main-entry export |
| `RuntimeAuthScopeCacheEntrySummary` | type | (via core index) | Main-entry export |
| `RuntimeScopedState` / `runtimeScopedStates` | internal | `auth-precedence-resolver.ts` | Internal |
| `buildCacheKey` … `resolveProfileId` | internal | `auth-precedence-resolver.ts` | Internal |

#### `@vybestack/llxprt-code-core/auth/types.js` → `@vybestack/llxprt-code-auth`

| Symbol | Type | Consumers | Migration |
|--------|------|-----------|-----------|
| `CodexOAuthTokenSchema` | Zod schema | `providers/OpenAIResponsesProviderBase.ts` | Main-entry export |
| `CodexOAuthToken` | type | `providers/__tests__/OpenAIResponsesProvider.promptCacheKey.test.ts` | Main-entry export |
| `OAuthToken`, `OAuthTokenSchema` | type/schema | (via main index) | Main-entry export |
| `AuthStatus`, `BucketStats`, etc. | types/schemas | (via main index) | Main-entry export |

## Formal Requirements

[REQ-AUTH-001] Auth Package Boundary
  [REQ-AUTH-001.1] All auth production code currently in `packages/core/src/auth/` MUST live under `packages/auth/src/` after migration.
  [REQ-AUTH-001.2] `packages/auth` MUST follow existing workspace package conventions for package metadata, TypeScript build, Vitest config, and source entry points.
  [REQ-AUTH-001.3] `packages/auth` MUST expose a clean public API through `@vybestack/llxprt-code-auth`.
  [REQ-AUTH-001.4] `AuthPrecedenceResolver` MUST be the primary public entry point.

[REQ-DEP-001] Dependency Direction
  [REQ-DEP-001.1] Production package dependencies MUST NOT form a cycle between auth, core, cli, providers, or tools.
  [REQ-DEP-001.2] `packages/auth` production code MUST NOT import from `@vybestack/llxprt-code-core`, `@vybestack/llxprt-code`, `@vybestack/llxprt-code-providers`, `@vybestack/llxprt-code-cli`, or any `@vybestack/llxprt-code-tools`. This includes both `dependencies` and the import specifier content of `.ts`/`.tsx`/`.js` source files (excluding `*.test.ts` and `*.spec.ts`). Verification MUST use canonical import/export specifier parsing (matching `from '...'`, `from "..."`, `require('...')`, `require("...")`, `import('...')`, and `export ... from '...'` patterns), not raw substring scanning, to avoid false positives from comments, documentation, or test fixture strings.
  [REQ-DEP-001.3] `packages/auth` production `dependencies` depends only on `zod` and Node builtins. `devDependencies` MAY contain `typescript`, `vitest`, `eslint`, `prettier`, `@types/node`, and other development-only tooling packages, but MUST NOT contain any `@vybestack/*` package (which would create a development-time cycle).
  [REQ-DEP-001.4] `packages/core` depends on `@vybestack/llxprt-code-auth`.
  [REQ-DEP-001.5] `packages/cli` depends on both `@vybestack/llxprt-code-core` and `@vybestack/llxprt-code-auth`.
  [REQ-DEP-001.6] `packages/providers` depends on `@vybestack/llxprt-code-auth` (for `AuthPrecedenceResolver`, `OAuthManager`, token types) AND on `@vybestack/llxprt-code-core` (for `SettingsService`, non-auth utilities). This is an acyclic dependency — providers consumes auth symbols directly from `@vybestack/llxprt-code-auth` and non-auth symbols from `@vybestack/llxprt-code-core`.

[REQ-INTF-001] Dependency Injection Interfaces
  [REQ-INTF-001.1] `packages/auth` MUST define `ISecureStore` interface for token persistence with methods: `get`, `set`, `delete`, `list`, `has`. `packages/auth` MUST also define `ISecureStoreError` (with `code: SecureStoreErrorCode`, `message: string`, `remediation: string`) and `SecureStoreErrorCode` union type (`'UNAVAILABLE' | 'LOCKED' | 'DENIED' | 'CORRUPT' | 'TIMEOUT' | 'NOT_FOUND'`).
  [REQ-INTF-001.2] `packages/auth` MUST define `ISettingsService` interface for settings access.
  [REQ-INTF-001.3] `packages/auth` MUST define `IProviderKeyStorage` interface for provider key access. `IProviderKeyStorage` is an instance contract (getKey, listKeys, hasKey); `getProviderKeyStorage()` is a core factory/injection concern that returns an object satisfying this interface — the factory stays in core, the interface lives in auth.
  [REQ-INTF-001.4] `packages/auth` MUST define `IDebugLogger` interface for logging. The interface method shape MUST be derived from an actual preflight grep of logger usages in auth-relevant files (see P00a IDebugLogger Contract Preflight Check). The `debugLogger` module-level singleton and `DebugLogger` class constructor are core factory concerns — auth receives an `IDebugLogger` instance via DI injection, not the factory.
  [REQ-INTF-001.5] `packages/auth` MUST define `IProviderRuntimeContext` interface for runtime context.

[REQ-OAUTH-001] OAuth Manager Split
  [REQ-OAUTH-001.1] The `OAuthManager` interface MUST move to `packages/auth`.
  [REQ-OAUTH-001.2] The CLI `OAuthManager` implementation MUST remain in `packages/cli/src/auth/` and implement the interface from `packages/auth`.
  [REQ-OAUTH-001.3] Provider-specific auth adapters (anthropic, gemini, qwen, codex) MUST remain in `packages/cli/src/auth/` as registered adapters, not hard-coded.

[REQ-PROXY-001] Direct vs Proxy Auth Split
  [REQ-PROXY-001.1] Core proxy auth infrastructure (framing, ProxySocketClient, ProxyTokenStore, ProxyProviderKeyStorage) MUST move to `packages/auth/src/proxy/`.
  [REQ-PROXY-001.2] CLI proxy orchestration (credential-proxy-server, sandbox-proxy-lifecycle, credential-proxy-oauth-handler, etc.) MUST remain in `packages/cli/src/auth/proxy/`.

[REQ-API-001] Public API and Consumer Migration
  [REQ-API-001.1a] Core MAY re-export select auth types from `@vybestack/llxprt-code-auth` for consumer convenience, but these MUST be through explicit re-exports, not wrapper/shim files. Re-exports are direct main-index passthroughs (`export { X } from '@vybestack/llxprt-code-auth'`); deep-path subpath exports are forbidden.
  [REQ-API-001.2] CLI and other consumers MUST import auth types directly from `@vybestack/llxprt-code-auth`.
  [REQ-API-001.3] Existing auth behavior MUST remain reachable through CLI commands and startup flows.
  [REQ-API-001.4] `flushRuntimeAuthScope` MUST be exported from `@vybestack/llxprt-code-auth` as a main-entry symbol. Core MAY re-export for convenience.

[REQ-TEST-001] Behavioral Refactoring Verification
  [REQ-TEST-001.1] Integration tests MUST be written BEFORE implementation for multi-component boundaries.
  [REQ-TEST-001.2] TDD is mandatory: write failing behavioral tests before production code.
  [REQ-TEST-001.3] Tests MUST prove auth precedence, token store, OAuth flows, and proxy auth still work.
  [REQ-TEST-001.4] No reverse testing, mock theater, or structure-only tests.
  [REQ-TEST-001.5] Auth-package tests MUST use local DI test doubles only — no import specifiers referencing `@vybestack/llxprt-code-core` or `@vybestack/llxprt-code-providers` in `packages/auth` test files (`*.test.ts`, `*.spec.ts`). An enforcement scan MUST fail if auth tests import from core or providers. Verification MUST use canonical import/export specifier parsing (not raw substring matching) to avoid false positives. Use the shared verifier script (`project-plans/issue1586/scripts/verify-auth-extraction-gate.js`) for this enforcement. The shared verifier's test-code scan specifically targets `*.test.ts` and `*.spec.ts` files for forbidden `@vybestack/llxprt-code-core` and `@vybestack/llxprt-code-providers` import specifiers.

[REQ-CLEAN-001] Cleanup And No Shims
  [REQ-CLEAN-001.1] Old auth source files MUST be removed from `packages/core/src/auth` after migration. No `@vybestack/llxprt-code-core/auth`-style import specifiers (canonical import/export specifiers matching `from '...'`, `from "..."`, `require('...')`, `require("...")`, `import('...')`, and `export ... from '...'` patterns) may remain in any consumer package (cli, providers, core). Raw substring mentions in comments, documentation, or test fixture strings are not violations — only actual import/export specifiers are enforced.
  [REQ-CLEAN-001.2] No `V2`, `New`, compatibility wrapper, or parallel implementation files.
  [REQ-CLEAN-001.3] Full verification suite per project memory MUST pass.

[REQ-ADAPTER-001] Registered Provider Auth Adapters
  [REQ-ADAPTER-001.1] `AuthPrecedenceResolver` MUST NOT hard-code provider-specific OAuth logic.
  [REQ-ADAPTER-001.2] Provider-specific auth adapters must be registered/injected.

## Data Schemas

No new runtime data schemas. Package metadata follows existing conventions:

```json
{
  "name": "@vybestack/llxprt-code-auth",
  "version": "0.10.0",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "dependencies": {
    "zod": "^3.25.76"
  },
  "devDependencies": {
    "typescript": "^5.x",
    "vitest": "^3.x",
    "eslint": "^9.x",
    "prettier": "^3.x",
    "@types/node": "^22.x"
  }
}
```

**Production `dependencies`** contains only `zod` (REQ-DEP-001.3). No `@vybestack/*` package may appear in `dependencies`. **`devDependencies`** contains development tooling only — no `@vybestack/*` package may appear here either, since that would create a development-time cycle risk. The shared verifier script enforces both constraints.

**Note:** "auth depends only on zod and Node builtins" means **production `dependencies` only**. The `devDependencies` list above is representative — exact versions should match those used by existing packages (`packages/core`, `packages/cli`). Two distinct constraints apply:

1. **Production dependency constraint (REQ-DEP-001.3):** `packages/auth/package.json` `dependencies` MAY contain only `zod` and MAY NOT contain any `@vybestack/*` package. This is enforced by the shared verifier script and inline verification commands throughout the plan. Production code in `packages/auth/src/` (excluding `*.test.ts` and `*.spec.ts`) MUST NOT contain import/export specifiers referencing any `@vybestack/*` package. Verification uses canonical import/export specifier parsing (not raw substring scanning) to avoid false positives.

2. **Dev/test dependency constraint:** `packages/auth/package.json` `devDependencies` MAY contain `typescript`, `vitest`, `eslint`, `prettier`, `@types/node`, and other development-only tooling packages. No `@vybestack/*` package MAY appear in `devDependencies` either — this would create a development-time cycle risk even if not a production dependency. Auth-package test files (`*.test.ts`, `*.spec.ts`) MUST use local DI test doubles and MUST NOT import from `@vybestack/llxprt-code-core` or `@vybestack/llxprt-code-providers`. This is enforced by the shared verifier script's test-code import scan, which uses canonical specifier parsing on `*.test.ts` and `*.spec.ts` files.

3. **Cycle verification constraint:** The dependency DAG must be acyclic in both `dependencies` and `devDependencies`. Specifically: `@vybestack/llxprt-code-auth` MUST NOT appear in either `dependencies` or `devDependencies` of `packages/auth/package.json`. The shared verifier script checks both `dependencies` and `devDependencies` for `@vybestack/*` packages in auth's `package.json`, and the auth-test import specifier scan checks `devDependencies` cycle risk (test-code import enforcement).

## Example Data

```json
{
  "oldImport": "@vybestack/llxprt-code-core/auth/precedence.js",
  "newImport": "@vybestack/llxprt-code-auth",
  "forbiddenAuthImport": "import { SecureStore } from '../storage/secure-store.js'",
  "canonicalSpecifierExample": "from '@vybestack/llxprt-code-core'",
  "requiredDIInterface": "ISecureStore",
  "smokeCommand": "node scripts/start.js --profile-load ollamaglm51 \"write me a haiku and nothing else\""
}
```

## Constraints

- Refactor: no intentional behavior changes.
- No backward compatibility shims from auth package to core.
- No backward-compatible deep-path subpath exports (`@vybestack/llxprt-code-core/auth/*`) after migration.
- Direct main-index re-exports for consumer convenience are allowed; wrapper/deep-path compatibility shims are forbidden.
- No package dependency cycles.
- `packages/auth` production code depends only on `zod` and Node builtins. Dev/test dependencies (vitest, eslint, prettier, typescript, etc.) are allowed but must not introduce production-level coupling to sibling packages.
- TDD mandatory.
- Integration tests before unit tests for boundaries.
- `.llxprt/` contents must not be modified.
- `packages/storage` is absent; DI interfaces are interim design. Accepted criteria: DI interfaces (`ISecureStore`, `IProviderKeyStorage`) are the interim storage boundary until `packages/storage` exists. **Explicit acceptance (Blocker 6):** `KeyringTokenStore` retains Node filesystem persistence (`node:fs/promises`, `node:path`, `node:os`) for file-lock/fallback logic. `@napi-rs/keyring` and core's `SecureStore`/`KeyringAdapter` do NOT move into auth — they stay in core and are injected via `ISecureStore`. This interim design is explicitly accepted.
- `flushRuntimeAuthScope` moves to `packages/auth` (auth-domain logic defined in `precedence.ts`). Core may re-export for convenience.
- Core re-export policy: direct main-index re-exports for convenience are allowed; wrapper/deep-path compatibility shims are forbidden.
- `OAuthProvider` interface stays in CLI (consistent ownership decision).
- `auth-factories.ts` goes in `packages/core/src/` (NOT in `packages/core/src/auth/`).
- **AuthPrecedenceResolver Constructor Migration for Providers:** `BaseProvider.ts` currently constructs `AuthPrecedenceResolver` directly with `(precedenceConfig, oauthManager, settingsService)` where `settingsService` is `SettingsService` from core. After DI refactoring, `AuthPrecedenceResolver` constructor signature becomes: `constructor(config: AuthPrecedenceConfig, oauthManager?: OAuthManager, settingsService?: ISettingsService)`. Because `ISettingsService` is a strict subset of `SettingsService`'s public API (`get`, `getProviderSettings`, `on`, `off`), `SettingsService` satisfies `ISettingsService` by TypeScript structural typing. Providers pass their existing `SettingsService` instance directly — no adapter or factory function needed at the providers layer. Providers also calls `authResolver.setSettingsService(settingsService)` — same structural typing applies. This is verified by compile-time type compatibility. No DI factory or wrapper is required for providers' AuthPrecedenceResolver construction.
- **`precedence.ts` vs `auth-precedence-resolver.ts` responsibility split:** `precedence.ts` currently imports `SettingsService` (type-only), `ProviderRuntimeContext` (type-only), and `debugLogger` (value import) from core submodules. When moving to `packages/auth`, `precedence.ts` MUST be refactored to eliminate these core dependencies: (1) type-only imports of `SettingsService` and `ProviderRuntimeContext` are replaced with auth-owned structural type definitions or the `ISettingsService`/`IProviderRuntimeContext` interfaces already defined in `packages/auth/src/interfaces/`; (2) the `debugLogger` value import from `../utils/debugLogger.js` is replaced with an injected `IDebugLogger` boundary (passed via module-level setter or constructor injection), ensuring no runtime dependency on core remains. After refactoring, `precedence.ts` has zero DI dependencies — self-contained types, cache logic, and `OAuthManager` interface only. `auth-precedence-resolver.ts` defines the `AuthPrecedenceResolver` class that composes those primitives with injected DI interfaces (`ISettingsService`, `IProviderKeyStorage`, `IDebugLogger`, `IProviderRuntimeContext`). Both files move to `packages/auth`. The class depends on the interface/cache layer, not vice versa.
- **`AuthPrecedenceResolver` public entry path:** `AuthPrecedenceResolver` is the primary public entry point of `packages/auth` (REQ-AUTH-001.4). It is defined in `auth-precedence-resolver.ts` and MUST be exported from `packages/auth/src/index.ts` as a main-entry re-export. Consumers import `AuthPrecedenceResolver` from `@vybestack/llxprt-code-auth` (the main entry), not from `@vybestack/llxprt-code-auth/auth-precedence-resolver.js`. Old consumers importing from `@vybestack/llxprt-code-core/auth/precedence.js` must migrate to the auth package main entry. `flushRuntimeAuthScope` is also exported from the auth package main entry via `index.ts` re-export.
- **README/public API documentation out of scope (cross-reference):** Updating `packages/auth/README.md` or root-level documentation to reflect the new auth package is declared **out of scope** for this plan. A README task should be tracked as a separate follow-up issue once the auth package is stabilized. See `plan/00-overview.md` Design Decision #17.
- **Build order and workspace registration:** `packages/auth` MUST appear before `packages/core` in root `package.json` workspaces so `npm run build --workspaces` builds auth first. Consumer tsconfigs MUST include path aliases for `@vybestack/llxprt-code-auth`. `npm install` MUST run after workspace/dependency changes to update `package-lock.json`. Fresh checkout test must pass.
- **Test migration policy:** Core auth tests that import `@vybestack/llxprt-code-core` or `@vybestack/llxprt-code-providers` must be refactored to use local DI test doubles before moving to `packages/auth`. All 20 test files have `packages/auth` as their final destination — none are relocated to owning packages. By P18, zero files remain under `core/src/auth/`. P10 tests must not assert on `NotYetImplemented`; expected-to-fail stub tests should exercise observable behavior and be marked as expected-to-fail rather than asserting on the `NotYetImplemented` error message itself.
- **BaseTokenStore reconciliation:** Issue #1586 mentions `BaseTokenStore` as a candidate for auth package extraction. **Preflight evidence:** `BaseTokenStore` in `packages/core/src/mcp/token-store.ts` is an MCP base class, not an auth domain class. Its consumers are all MCP files. **No move required.** The auth package already captures the token store contract via `TokenStore` interface and `KeyringTokenStore`/`ProxyTokenStore` implementations.
- **Package manager gate (P00a/P03):** The root `package.json` declares `"packageManager": "pnpm@10.17.0+sha512..."` while both `package-lock.json` and `pnpm-lock.yaml` exist. All project scripts and CI use npm commands. P00a and P03 Step 0 include a mandatory **executable** package manager verification gate that inspects CI workflow files and exits non-zero on inconsistency. **If CI/lockfile strategy is inconsistent, the gate must STOP the phase — do not allow both npm and pnpm paths to execute.** If CI uses npm, `npm install`/`package-lock.json` is authoritative. If CI uses pnpm, all plan commands use pnpm equivalents. **Do NOT remove `package-lock.json`** if CI uses pnpm — instead, stop and require a package-manager strategy update decision. Lockfile removal is out of scope and potentially destructive.
- **P03 verification scope:** P03 creates an empty/minimal auth package. P03 verification is narrowed to auth-package typecheck + build + metadata checks. A full `npm run build --workspaces` is deferred to P05a (scaffold impl) when auth has more content, and then verified comprehensively in P19 (full verification) when auth has its complete public API.
- **P19 verification script:** `node -e "..."` inline node commands in the original P19 full-verification.md had syntax errors (newline splits in string literals). These are replaced by the shared verifier script at `scripts/verify-auth-extraction-gate.js`, which is the canonical enforcement mechanism referenced from P09, P11, P15, P17, P18, and P19. The shared verifier uses canonical import/export specifier parsing (matching `from '...'`, `from "..."`, `require('...')`, `require("...")`, `import('...')`, and `export ... from '...'` patterns) instead of raw substring scans, eliminating false positives from comments, strings, or other non-import occurrences. When inline verification commands in phase files duplicate checks covered by the shared verifier, the shared verifier is authoritative.
- **`npm run format` caution:** `npm run format` is destructive. Review any resulting diffs before committing. Format changes can alter whitespace in ways that affect reviewability. If diffs are clean and expected, commit them; if unexpected, investigate before proceeding.
- **Provider counts:** Provider auth import counts (6 production + 3 test = 9 files) are labeled as plan-time/preflight-authoritative. The actual count must be confirmed at preflight (P00a/P01) by running `rg -l "from ['\"]@vybestack/llxprt-code-core/auth" packages/providers/src --glob '*.ts'`.

  All 20 tests move to `packages/auth`. Seven tests (#1, #2, #3, #6, #9, #13, #14) require DI test-double refactoring before the move. No tests are relocated to owning packages. Total final count in `packages/auth`: 20 test files.

  | # | Test File | Final Destination | Rationale |
  |---|-----------|-------------------|-----------|
  | 1 | `precedence.test.ts` | `packages/auth/src/__tests__/precedence.test.ts` | Refactored with `ISettingsService` DI test double |
  | 2 | `precedence.adapter.test.ts` | `packages/auth/src/__tests__/precedence.adapter.test.ts` | Refactored: replace `@vybestack/llxprt-code-providers` import with local DI test double |
  | 3 | `auth-integration.spec.ts` | `packages/auth/src/__tests__/auth-integration.spec.ts` | Integration test — refactor with DI test doubles |
  | 4 | `codex-device-flow.spec.ts` | `packages/auth/src/__tests__/codex-device-flow.spec.ts` | No cross-package deps; moves as-is |
  | 5 | `oauth-errors.spec.ts` | `packages/auth/src/__tests__/oauth-errors.spec.ts` | No cross-package deps; moves as-is |
  | 6 | `oauth-logout-cache-invalidation.spec.ts` | `packages/auth/src/__tests__/oauth-logout-cache-invalidation.spec.ts` | Refactor with `ISettingsService` DI test double |
  | 7 | `token-store.spec.ts` | `packages/auth/src/__tests__/token-store.spec.ts` | No cross-package deps; moves as-is |
  | 8 | `token-store.refresh-race.spec.ts` | `packages/auth/src/__tests__/token-store.refresh-race.spec.ts` | No cross-package deps; moves as-is |
  | 9 | `invalidateProviderCache.test.ts` | `packages/auth/src/__tests__/invalidateProviderCache.test.ts` | Refactor with `ISettingsService` DI test double |
  | 10 | `qwen-device-flow.spec.ts` | `packages/auth/src/__tests__/qwen-device-flow.spec.ts` | No cross-package deps; moves as-is |
  | 11 | `__tests__/authRuntimeScope.test.ts` | `packages/auth/src/__tests__/authRuntimeScope.test.ts` | No cross-package deps; moves as-is |
  | 12 | `__tests__/codex-device-flow.test.ts` | `packages/auth/src/__tests__/codex-device-flow.test.ts` | No cross-package deps; moves as-is |
  | 13 | `__tests__/keyring-token-store.integration.test.ts` | `packages/auth/src/__tests__/keyring-token-store.integration.test.ts` | Refactored with `ISecureStore` DI test double |
  | 14 | `__tests__/keyring-token-store.test.ts` | `packages/auth/src/__tests__/keyring-token-store.test.ts` | Refactored with `ISecureStore` DI test double |
  | 15 | `__tests__/token-merge.test.ts` | `packages/auth/src/__tests__/token-merge.test.ts` | No cross-package deps; moves as-is |
  | 16 | `__tests__/token-sanitization.test.ts` | `packages/auth/src/__tests__/token-sanitization.test.ts` | No cross-package deps; moves as-is |
  | 17 | `proxy/__tests__/framing.test.ts` | `packages/auth/src/proxy/__tests__/framing.test.ts` | No cross-package deps; moves as-is |
  | 18 | `proxy/__tests__/proxy-provider-key-storage.test.ts` | `packages/auth/src/proxy/__tests__/proxy-provider-key-storage.test.ts` | No cross-package deps; moves as-is |
  | 19 | `proxy/__tests__/proxy-socket-client.test.ts` | `packages/auth/src/proxy/__tests__/proxy-socket-client.test.ts` | No cross-package deps; moves as-is |
  | 20 | `proxy/__tests__/proxy-token-store.test.ts` | `packages/auth/src/proxy/__tests__/proxy-token-store.test.ts` | No cross-package deps; moves as-is |

## Performance Requirements

- Auth package extraction must not add measurable startup overhead.
- Existing auth tests must not become materially slower.
- Build order must remain deterministic.