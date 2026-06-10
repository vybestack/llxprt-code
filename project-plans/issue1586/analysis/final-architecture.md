# Final Architecture Decision: Auth Package Extraction

Plan ID: PLAN-20260608-ISSUE1586

## Decision

Issue #1586 requires extracting auth implementation, types, and interfaces from `packages/core/src/auth/` into a dedicated `packages/auth`. The final dependency architecture is a **strictly acyclic DAG** (final state, not transitional):

```text
packages/auth       ⊥  (zero sibling package dependencies)
packages/core       →  packages/auth
packages/providers  →  packages/auth, packages/core
packages/cli        →  packages/auth, packages/core
```

Auth has no sibling package dependencies. Core depends on auth. Providers depends on auth and core. CLI depends on auth and core. The graph contains no cycles.

**Acyclic verification:** auth has zero `@vybestack/*` dependencies. Core depends on auth but not vice versa. Providers depends on auth AND core but neither depends on providers. CLI depends on auth and core but neither depends on CLI. The graph contains no cycles.

**Why providers→auth is NOT providers→core→auth (transitive):** Providers imports `AuthPrecedenceResolver`, `OAuthManager`, `CodexOAuthTokenSchema`, and `flushRuntimeAuthScope` **directly** from `@vybestack/llxprt-code-auth`, not via core re-exports. Providers also imports `SettingsService` and other non-auth utilities from `@vybestack/llxprt-code-core`. Both edges are direct; the auth→core path does not exist in reverse. This is a DAG, not a cycle.

**Why providers depends on both auth and core (not just core):** Issue #1586 establishes that `packages/auth` should depend on `packages/storage` (per the issue), and `packages/providers` should depend on `packages/auth` directly for auth symbols. Since `packages/storage` is absent from the repository, `packages/auth` defines DI interfaces (`ISecureStore`, `IProviderKeyStorage`) locally as an accepted deviation from issue #1586. This preserves the intent: auth owns the contract for storage it needs, and when `packages/storage` is extracted, these interfaces migrate there, and `packages/auth` would then depend on `@vybestack/llxprt-code-storage` as issue #1586 intended. Until then, auth owns the contracts it needs from storage.

`packages/auth` depends ONLY on `zod` and Node builtins (production). All core subsystem access (storage, debug, settings, runtime) is via DI interfaces defined in `packages/auth/src/interfaces/`. Issue #1586 states that `packages/auth` should depend on `packages/storage`, but since `packages/storage` does not exist in the repository, auth defines DI interfaces locally as an accepted deviation. When `packages/storage` is extracted, these interfaces migrate there and auth would depend on `@vybestack/llxprt-code-storage` as issue #1586 intended.

## packages/storage Absence and Interim DI Design

`packages/storage` does **not** exist in the current repository. Issue #1586 references `packages/storage` as a future dependency, but since it has not been extracted, auth defines `ISecureStore` and `IProviderKeyStorage` DI interfaces locally in `packages/auth/src/interfaces/`. These are not imported from a missing package — they are authored in auth because auth owns the contract for what it needs. Core provides concrete implementations and injects them via factory functions. When `packages/storage` is created, these interfaces can migrate there from auth without changing auth's public behavior (already injected, not imported). This is a deferred dependency, not a conflict.

**Accepted Deviation from Issue #1586:** Issue #1586 states `packages/auth` should depend on `packages/storage`. Since `packages/storage` does not exist in the repository, the plan uses local DI interfaces (`ISecureStore`, `IProviderKeyStorage`) defined in `packages/auth/src/interfaces/` as the interim storage boundary. This is an explicit repository-reality decision, not a design omission. **Preflight evidence:** `ls packages/storage` returns "not found" (verified at preflight). **Out-of-scope rationale:** Creating `packages/storage` is a separate extraction issue and would expand scope beyond auth package extraction. **Migration path:** When `packages/storage` is extracted, `ISecureStore` and `IProviderKeyStorage` migrate from auth to storage, and auth imports them from storage. No auth public API changes required (already injected).

**Acceptance Criteria Note:** DI interfaces (`ISecureStore`, `IProviderKeyStorage`) are the **interim storage boundary** until `packages/storage` exists. The key point: "storage absent" means the *package* doesn't exist yet, not that storage concepts are absent from the design — they are captured locally as DI interfaces in auth.
**Explicit acceptance of Node filesystem persistence in auth (Blocker 6):** `KeyringTokenStore` in auth uses `node:fs/promises`, `node:path`, and `node:os` for file-lock/fallback logic (concurrent keyring access, homedir resolution fallbacks). These Node builtins are production dependencies of auth's `KeyringTokenStore`, not DI boundary violations — `ISecureStore` defines the abstract storage contract, but `KeyringTokenStore` itself has legitimate file-based coordination logic using Node builtins. Core's `SecureStore` (`@napi-rs/keyring` native module) is NOT imported into auth — it stays in core and is injected via `ISecureStore`. Neither `@napi-rs/keyring` nor core's `SecureStore`/`KeyringAdapter` moves into auth. This interim design is explicitly accepted.


## Out-of-Scope Cross-Reference

Creating `packages/storage` or updating `packages/auth/README.md` and root-level documentation is declared **out of scope** for this plan. A README task should be tracked as a separate follow-up issue once the auth package is stabilized. See design decision #17 in `plan/00-overview.md`.

## Contract Ownership

| Concern | Final Owner | Why This Does Not Violate #1586 |
|---------|-------------|----------------------------------|
| `OAuthToken`, Zod schemas, `TokenStore` interface, `AuthStatus`, `BucketStats`, device flow types | `packages/auth` | These are auth domain types and move out of core. |
| `AuthPrecedenceResolver`, precedence logic | `packages/auth` | Central auth engine; public entry point of the package. **Responsibility split with `precedence.ts`:** `precedence.ts` currently imports `SettingsService` (type-only), `ProviderRuntimeContext` (type-only), and `debugLogger` (value import) from core — these MUST be refactored when moving to auth. Type-only imports are replaced with auth-owned `ISettingsService`/`IProviderRuntimeContext` interfaces; the `debugLogger` value import is replaced with an injected `IDebugLogger` boundary. After refactoring, `precedence.ts` will have zero core imports — self-contained types, cache logic, and `OAuthManager` interface only. **`AuthPrecedenceResolver` is defined in `auth-precedence-resolver.ts` (the canonical source file for the class), not in `precedence.ts`.** `precedence.ts` contains low-level cache primitives and the `OAuthManager` interface. Both files move to `packages/auth`. The class depends on `precedence.ts`, not vice versa. |
| `KeyringTokenStore` | `packages/auth` | Accepts `ISecureStore` + `IDebugLogger` via DI; no core dependency. |
| `OAuthManager` interface | `packages/auth` (in precedence.ts) | Interface required by AuthPrecedenceResolver; CLI implementation stays in CLI. |
| `OAuthProvider` interface | `packages/cli/src/auth/types.ts` | CLI-specific; only used by CLI adapter classes. AuthPrecedenceResolver uses `OAuthManager`, not `OAuthProvider`. Can move to auth later if cross-package need arises. |
| OAuth device flows (Anthropic, Codex, Qwen) | `packages/auth/src/flows/` | Pure auth domain; depend only on types + crypto. |
| `OAuthError`, `OAuthErrorFactory` | `packages/auth` | Error hierarchy; no external deps. |
| Token utilities (merge, sanitization) | `packages/auth` | Pure functions on OAuthToken. |
| Proxy infrastructure (framing, socket client, proxy token store, proxy key storage) | `packages/auth/src/proxy/` | Transport layer for sandbox credentials. |
| DI interfaces (ISecureStore, ISettingsService, etc.) | `packages/auth/src/interfaces/` | Owned by auth because auth defines what it needs. Core implements them. |
| CLI `OAuthManager` implementation (preflight-verified line count) | `packages/cli/src/auth/oauth-manager.ts` | UI/composition; implements `OAuthManager` from auth. Issue #1586 says oauth-manager.ts and CLI-specific auth logic move — the **interface** moves to auth; the **implementation** stays in CLI per the domain/auth split. CLI `OAuthManager` structurally implements auth's `OAuthManager` interface. This is consistent: the auth domain owns the contract; CLI owns the composition. |
| CLI OAuth providers (anthropic, gemini, qwen, codex) | `packages/cli/src/auth/` | Provider-specific adapters; registered, not hard-coded. These are CLI-specific composition classes implementing `OAuthProvider` (CLI-owned interface). |
| CLI proxy orchestration | `packages/cli/src/auth/proxy/` | Uses auth proxy infrastructure but adds server UI/lifecycle. |
| Core DI factories | `packages/core/src/auth-factories.ts` | Inject core's SecureStore/DebugLogger/SettingsService into auth constructors. New file, not a migrated auth file. |
| Core auth re-exports | `packages/core/src/index.ts` | Re-export selected auth types from `@vybestack/llxprt-code-auth`. Direct main-index re-exports only; no deep-path shims. |
| `flushRuntimeAuthScope` | `packages/auth/src/precedence.ts` | Auth-domain function flushing runtime-scoped credentials. Moves with `precedence.ts`. Core may re-export for convenience. |
| `RuntimeAuthScopeFlushResult` | `packages/auth/src/precedence.ts` | Return type of `flushRuntimeAuthScope`. Moves with `precedence.ts`. |

## Justification: CLI Auth Movement Scope vs Issue #1586

Issue #1586 states that `oauth-manager.ts` and CLI-specific auth logic should move. The plan interprets this as:

1. **Auth domain contracts move to `packages/auth`**: The `OAuthManager` interface, `OAuthProvider` could move but stays in CLI (no cross-package need yet), auth types, token store interfaces, precedence logic, device flows, errors, and proxy infrastructure all move to the auth package.
2. **CLI auth composition stays in CLI**: The `OAuthManager` implementation (preflight-verified line count), provider adapters (`*OAuthProvider` classes), `AuthFlowOrchestrator`, bucket management, proactive renewal, global-oauth-ui, and proxy orchestration are all CLI-specific composition that USES auth domain types but IS NOT auth domain logic.

This split is justified because:
- The `OAuthManager` class in CLI is a composition class with a preflight-verified number of lines of orchestration, dependencies on `LoadedSettings`, `MessageBus`, `ProviderRegistry`, `OAuthBucketManager`, `TokenAccessCoordinator`, etc. — all CLI-specific concepts.
- Moving the implementation would force `packages/auth` to depend on CLI types, creating a cycle.
- The **interface** moving to `packages/auth` achieves the goal of making auth domain independent, while CLI composition remains in CLI.
- All CLI auth files will update imports from `@vybestack/llxprt-code-core` auth paths to `@vybestack/llxprt-code-auth`.

An alternative full decomposition (splitting `OAuthManager` into smaller domain objects that move to auth) was considered but rejected as scope creep beyond #1586's intent. This can be done in a follow-up issue without changing the package boundary.

## Forbidden Implementations

- `packages/auth` importing from `@vybestack/llxprt-code-core`, `@vybestack/llxprt-code`, `@vybestack/llxprt-code-providers`.
- `packages/core/src/auth/` containing wrapper files that forward to auth package.
- Core preserving deep-path auth subpath exports (`./auth/precedence.js`, `./auth/types.js`) in `exports` field after migration.
- `KeyringTokenStoreV2`, `AuthPrecedenceResolverCompat`, or any compatibility types.
- `packages/auth/package.json` depending on core/cli/providers/tools.

## Allowed Implementations

- Core re-exporting auth types via `export { ... } from '@vybestack/llxprt-code-auth'` in core `index.ts`. **Direct main-index re-exports for convenience are allowed; wrapper/deep-path compatibility shims are forbidden.**
- Core DI factories that construct auth components with core implementations.
- CLI implementing `OAuthManager` interface from auth package.
- CLI importing auth domain types directly from `@vybestack/llxprt-code-auth`.
- Providers importing auth types from `@vybestack/llxprt-code-auth`.

## Responsibility Split: `precedence.ts` vs `auth-precedence-resolver.ts`

Both files move to `packages/auth`. Their responsibilities are distinct:

| File | Responsibility | Key Exports | DI Dependencies |
|------|---------------|-------------|-----------------|
| `precedence.ts` | Low-level cache primitives, types, `OAuthManager` interface, `flushRuntimeAuthScope` | `OAuthManager`, `AuthPrecedenceConfig`, `OAuthTokenRequestMetadata`, `RuntimeScopedState`, `flushRuntimeAuthScope`, `buildCacheKey`, `ensureRuntimeState`, cache record functions, `invalidateEntry`, etc. | Refactored: type-only imports of `SettingsService`/`ProviderRuntimeContext` replaced with `ISettingsService`/`IProviderRuntimeContext`; `debugLogger` value import replaced with injected `IDebugLogger` boundary. After refactoring, zero core imports remain. |
| `auth-precedence-resolver.ts` | High-level auth precedence composition class | `AuthPrecedenceResolver` class — composes cache primitives with injected DI interfaces to resolve auth precedence | `ISettingsService`, `IProviderKeyStorage`, `IDebugLogger`, `IProviderRuntimeContext` (all injected) |

The class (`auth-precedence-resolver.ts`) depends on the interface and cache layer (`precedence.ts`), not vice versa. Both are auth domain and both move. After DI refactoring, `auth-precedence-resolver.ts` no longer imports core submodules directly. `precedence.ts` is refactored to eliminate its type-only imports of `SettingsService`/`ProviderRuntimeContext` (replaced with `ISettingsService`/`IProviderRuntimeContext`) and its value import of `debugLogger` (replaced with an injected `IDebugLogger` boundary), yielding zero core imports.

## AuthPrecedenceResolver Constructor Migration for Providers

`packages/providers/src/BaseProvider.ts` currently constructs `AuthPrecedenceResolver` directly:

```typescript
// CURRENT (in BaseProvider.ts):
this.authResolver = new AuthPrecedenceResolver(
  precedenceConfig,       // AuthPrecedenceConfig
  config.oauthManager,    // OAuthManager | undefined
  fallbackSettingsService // SettingsService (from @vybestack/llxprt-code-core)
);
// Also calls:
this.authResolver.setSettingsService(settingsService);
```

After DI refactoring, `AuthPrecedenceResolver` constructor signature becomes:

### Pre-DI (current, in core)

```typescript
constructor(
  config: AuthPrecedenceConfig,
  oauthManager?: OAuthManager,
  settingsService?: SettingsService  // concrete core class
)
setSettingsService(settingsService: SettingsService | null | undefined): void
```

### Post-DI (in packages/auth) — Options-Object Constructor

```typescript
constructor(
  config: AuthPrecedenceConfig,
  options?: {
    oauthManager?: OAuthManager,
    settingsService?: ISettingsService,
    providerKeyStorage?: IProviderKeyStorage,
    logger?: IDebugLogger,
    getActiveRuntimeContext?: GetActiveRuntimeContext
  }
)
setSettingsService(settingsService: ISettingsService | null | undefined): void
```

The options-object constructor is the **canonical post-DI contract**, unified with C-CB-06 (pseudocode) and C-CB-09 (factory). All DI injection points are explicitly listed; no hidden or implicit dependencies.

### Migration Impact

| Consumer | Current Constructor Call | Post-DI Call | Adapter Needed? |
|----------|------------------------|--------------|-----------------|
| `providers/BaseProvider.ts` | `new AuthPrecedenceResolver(config, oauthMgr, settingsSvc)` | `new AuthPrecedenceResolver(config, { oauthManager: oauthMgr, settingsService: settingsSvc })` — `SettingsService` structurally satisfies `ISettingsService` | No |
| `core/auth-factories.ts` | N/A (factory created post-DI) | `new AuthPrecedenceResolver(config, { oauthManager, settingsService, providerKeyStorage, logger, getActiveRuntimeContext })` — core factory injects all DI points; `oauthManager` forwarded from caller | No |
| `core/core/StreamProcessor.ts` | Does not construct directly | N/A | No |

### Factory Function API (core → auth)

```typescript
// packages/core/src/auth-factories.ts
import { AuthPrecedenceResolver } from '@vybestack/llxprt-code-auth';
import type { AuthPrecedenceConfig, OAuthManager } from '@vybestack/llxprt-code-auth';

export function createAuthPrecedenceResolver(
  config: AuthPrecedenceConfig,
  settingsService?: ISettingsService,
  oauthManager?: OAuthManager,
  getActiveRuntimeContext?: GetActiveRuntimeContext
): AuthPrecedenceResolver {
  const providerKeyStorage = getProviderKeyStorage(); // core's impl
  const logger = new DebugLogger('llxprt:auth:precedence');
  return new AuthPrecedenceResolver(config, {
    oauthManager,
    settingsService,
    providerKeyStorage,
    logger,
    getActiveRuntimeContext
  });
  // SettingsService satisfies ISettingsService by structural typing
  // oauthManager is forwarded from caller to AuthPrecedenceResolver constructor options
}
```

**Key insight:** `ISettingsService` is designed as a strict subset of `SettingsService`'s public API (`get`, `getProviderSettings`, `on`, `off`). `SettingsService` satisfies `ISettingsService` by TypeScript structural typing — no adapter, wrapper, or factory function is needed at the providers layer. BaseProvider passes its existing `SettingsService` instance directly. This is verified by compile-time type compatibility (`tsc --noEmit`). The `oauthManager` parameter is optional and forwarded directly to the `AuthPrecedenceResolver` options-object constructor. Core does NOT inject `oauthManager` — it is caller-supplied (passed through from CLI/providers). Core supplies `providerKeyStorage` and `logger` internally.

**Migration steps for BaseProvider.ts:**
1. Change `AuthPrecedenceResolver` import from `@vybestack/llxprt-code-core/auth/precedence.js` → `@vybestack/llxprt-code-auth`.
2. Keep `SettingsService` import from `@vybestack/llxprt-code-core` (non-auth dependency).
3. Update constructor call from positional `new AuthPrecedenceResolver(config, oauthManager, settingsService)` to options-object form `new AuthPrecedenceResolver(config, { oauthManager, settingsService })`. `SettingsService` structurally satisfies `ISettingsService`.
4. `setSettingsService()` call remains identical — same structural typing.
5. No changes to `AuthPrecedenceConfig` or `OAuthManager` usage.

**Verification:** Compile-time test confirming `SettingsService` satisfies `ISettingsService`:
```typescript
// In packages/providers structural compat test:
import type { ISettingsService } from '@vybestack/llxprt-code-auth';
import { SettingsService } from '@vybestack/llxprt-code-core/settings/SettingsService.js';
const _compat: ISettingsService = new SettingsService(); // must compile
```

## AuthPrecedenceResolver Constructor API Specification

Each DI interface captures exactly what auth code uses from the core subsystem, no more:

| Interface | Replaces Core Import | Minimal Methods |
|-----------|----------------------|-----------------|
| `ISecureStore` | `SecureStore` from `../storage/secure-store.js` | `get`, `set`, `delete`, `list`, `has` |
| `ISecureStoreError` | `SecureStoreError` from `../storage/secure-store.js` | `code: SecureStoreErrorCode`, `message: string`, `remediation: string` |
| `SecureStoreErrorCode` | `SecureStoreErrorCode` from `../storage/secure-store.js` | Union type: `'UNAVAILABLE' \| 'LOCKED' \| 'DENIED' \| 'CORRUPT' \| 'TIMEOUT' \| 'NOT_FOUND'` |
| `ISettingsService` | `SettingsService` from `../settings/SettingsService.js` | `get`, `getProviderSettings`, `on`, `off` |
| `IProviderKeyStorage` | `getProviderKeyStorage()` from `../storage/provider-key-storage.js` | `getKey`, `listKeys`, `hasKey` |

**Note on `IProviderKeyStorage` vs `getProviderKeyStorage()` (Blocker 4):** `IProviderKeyStorage` is an **instance contract** defining the shape of a provider key storage object (`getKey`, `listKeys`, `hasKey`). The core function `getProviderKeyStorage()` is a **factory/injection concern** that returns an object satisfying this interface — it stays in core, the interface lives in auth. Auth's `AuthPrecedenceResolver` constructor accepts an `IProviderKeyStorage` instance; core's DI factory (`createAuthPrecedenceResolver` in `auth-factories.ts`) calls `getProviderKeyStorage()` to produce and inject that instance.
| `IDebugLogger` | `DebugLogger` from `../debug/index.js`, `debugLogger` from `../utils/debugLogger.js` | `debug`, `error`, `warn` + factory type |

**Note on `IDebugLogger` contract (Blocker 5):** The `IDebugLogger` interface method shape MUST be defined from actual auth code usage found by P00a preflight grep, not from assumptions. The `IDebugLogger` instance contract defines `debug`, `error`, `warn`. The `debugLogger` module-level singleton (`../utils/debugLogger.js`) and `DebugLogger` class constructor (`../debug/index.js`) are core-level factory concerns — auth receives an `IDebugLogger` instance via DI injection, not the factory.
| `IProviderRuntimeContext` | `ProviderRuntimeContext` from `../runtime/providerRuntimeContext.js` | `settingsService`, `config?`, `runtimeId?` |

**ISecureStore method evidence:** `keyring-token-store.ts` uses `secureStore.set()` (L330), `secureStore.get()` (L347), `secureStore.delete()` (L395), `secureStore.list()` (L414, L437), and catches `SecureStoreError` with `error.code` (L349) and `error.remediation` (accessible on error instances). `SecureStore` in core also exposes `has()` (L657). The `list()` method is used by `listProviders()` and `listBuckets()` in `keyring-token-store.ts`. The `has()` method is not used by auth code but is included for interface completeness and future use. Error types are used in catch/instanceof checks: `error instanceof SecureStoreError && error.code === 'CORRUPT'` (L349).

**ISecureStoreError and SecureStoreErrorCode:** `SecureStoreError` is a class with `code: SecureStoreErrorCode`, `message: string`, and `remediation: string`. `SecureStoreErrorCode` is a union type `'UNAVAILABLE' | 'LOCKED' | 'DENIED' | 'CORRUPT' | 'TIMEOUT' | 'NOT_FOUND'`. Auth code catches `SecureStoreError` by instanceof and switches on `code`. These types must be reflected in `ISecureStoreError` so that auth error handling logic can test `error instanceof ISecureStoreError` or match on error codes. Since `ISecureStoreError` is an interface (not a class), the instanceof check requires that injected `ISecureStore` implementations throw errors that are either `SecureStoreError` instances or satisfy the `ISecureStoreError` interface. In practice, core's `SecureStore` already throws `SecureStoreError` instances that satisfy the interface, so no adapter is needed.

## OAuth Manager Split Strategy

1. `OAuthManager` interface (3 methods: `getToken`, `isAuthenticated`, `getOAuthToken?`) already defined in `precedence.ts` — moves with that file to `packages/auth`.
2. CLI `OAuthManager` class (preflight-verified line count) stays in `packages/cli/src/auth/oauth-manager.ts`.
3. CLI `OAuthManager` structurally implements the auth package interface (TypeScript structural typing).
4. `OAuthProvider` interface stays in `packages/cli/src/auth/types.ts` — used only by CLI adapter classes, not referenced by `AuthPrecedenceResolver`. Can move to auth later if cross-package need arises.

## Direct vs Proxy Auth Split

**Auth package owns** (infrastructure):
- `proxy/framing.ts` — frame protocol (encode, decode)
- `proxy/proxy-socket-client.ts` — Unix socket client
- `proxy/proxy-token-store.ts` — TokenStore over socket
- `proxy/proxy-provider-key-storage.ts` — key storage over socket

**CLI owns** (orchestration):
- `proxy/credential-proxy-server.ts` — server that listens and dispatches
- `proxy/credential-store-factory.ts` — selects KeyringTokenStore vs ProxyTokenStore
- `proxy/sandbox-proxy-lifecycle.ts` — starts/stops proxy
- `proxy/credential-proxy-oauth-handler.ts` — OAuth flow over proxy
- `proxy/oauth-session-manager.ts`
- `proxy/proactive-scheduler.ts`
- `proxy/proxy-oauth-adapter.ts`
- `proxy/refresh-coordinator.ts`

This split ensures auth provides building blocks while CLI composes the runtime.