# Domain Model: Auth Package Extraction

Plan ID: PLAN-20260608-ISSUE1586

## Entities

### Auth Token
OAuth token data: access_token, refresh_token, expiry, scope, token_type. Defined by Zod schemas in `types.ts`. Immutable once issued; refreshable.

### Token Store
Interface for multi-provider, multi-bucket token persistence. Implementations: `KeyringTokenStore` (via ISecureStore), `ProxyTokenStore` (via ProxySocketClient).

### AuthPrecedenceResolver
Central auth resolution engine. Implements the chain: auth-key → API key → env → OAuth. Depends on ISettingsService, IProviderRuntimeContext, IProviderKeyStorage, IDebugLogger. Public entry point of `packages/auth`. **Responsibility split with `precedence.ts`:** `precedence.ts` provides low-level cache primitives, types, `OAuthManager` interface, and `flushRuntimeAuthScope` — after refactoring (replace SettingsService/ProviderRuntimeContext type imports with ISettingsService/IProviderRuntimeContext; replace debugLogger value import with injected IDebugLogger boundary), it has zero core imports and is self-contained. `auth-precedence-resolver.ts` composes those primitives with DI to resolve precedence. The class depends on `precedence.ts`, not vice versa.

### OAuthManager Interface
Contract: `getToken(provider, metadata) → string|null`, `isAuthenticated(provider) → boolean`, `getOAuthToken?(provider, metadata) → OAuthToken|null`. Defined in `precedence.ts`. CLI's `OAuthManager` class implements this.

### OAuthProvider Interface (CLI-owned)
Contract: `initiateAuth() → OAuthToken`, `getToken() → OAuthToken|null`, `refreshToken(currentToken) → OAuthToken|null`. Defined in `packages/cli/src/auth/types.ts`. Used only by CLI provider adapter classes. May move to auth package in future if cross-package need arises.

### OAuth Device Flow
Provider-specific device code flows: Anthropic, Codex (ChatGPT), Qwen. State machines: REQUEST → USER_VERIFY → POLL → COMPLETE. Depend only on `types.ts`, crypto, and HTTP.

### OAuth Errors
Hierarchical error system: `OAuthError` base, `OAuthErrorFactory`, specific subtypes. No external dependencies.

### Token Utilities
`mergeRefreshedToken(old, new) → merged`: merges expiry/refresh fields. `sanitizeTokenForProxy(token) → sanitized`: strips sensitive fields. Pure functions on OAuthToken.

### Proxy Auth Infrastructure
Framing protocol (encode/decode frames), `ProxySocketClient` (Unix socket IPC), `ProxyTokenStore` (TokenStore over socket), `ProxyProviderKeyStorage` (key storage over socket). Transport layer for sandboxed credential access.

### CLI OAuth Composition (CLI-owned)
`OAuthManager` implementation (preflight-verified line count), auth orchestrator, bucket management, proactive renewal, provider adapters (anthropic/gemini/qwen/codex), proxy server lifecycle, credential store factory. Uses auth domain types + UI/composition logic.

### DI Interfaces
`ISecureStore`, `ISettingsService`, `IProviderKeyStorage`, `IDebugLogger`, `IProviderRuntimeContext`. Minimal contracts for external dependencies that `packages/auth` cannot import directly.

### packages/storage (Deferred)
`packages/storage` does not exist in the current repository. `ISecureStore` and `IProviderKeyStorage` are defined locally in `packages/auth/src/interfaces/` as interim DI interfaces. They are authored in auth (not imported from a missing package) because auth owns the contract for what it needs from storage. Core implements and injects them. When `packages/storage` is eventually extracted, these interfaces can migrate there from auth without changing auth's public behavior. This is a deferred dependency, not a conflict with #1586.

**Acceptance Criteria Note:** DI interfaces (`ISecureStore`, `IProviderKeyStorage`) are the interim storage boundary until `packages/storage` exists. The key point: "storage absent" means the *package* doesn't exist yet, not that storage concepts are absent — they are captured locally as DI interfaces in auth.

**Accepted Deviation from Issue #1586:** Issue #1586 references `packages/storage` as a future dependency. Since the package does not exist, DI interfaces are the interim design. Explicit repository-reality decision. Preflight evidence: `ls packages/storage` returns "not found". Out-of-scope: creating `packages/storage` is a separate extraction issue. Migration path: when storage is extracted, interfaces migrate from auth to storage with no auth public API changes.

## Business Rules

1. Refactor: observable auth behavior must remain unchanged.
2. AuthPrecedenceResolver is the public entry point.
3. Provider-specific auth adapters are registered, not hard-coded in auth package.
4. Auth package depends only on `zod` and Node builtins.
5. OAuth manager splits: interface+domain in auth, implementation+UI in CLI.
6. OAuthProvider interface stays in CLI (used only by CLI adapter classes).
7. Direct auth and proxy auth are cleanly separated.
8. Tests prove behavior and package boundaries, not just file structure.

## State Transitions

1. Current: auth implementation lives in `packages/core/src/auth/`; CLI auth lives in `packages/cli/src/auth/`.
2. DI interfaces created: auth-owned interfaces that core implements and injects.
3. Package scaffold: `packages/auth` exists and builds.
4. Core auth moves: types, token store, precedence, device flows, errors, token utils, proxy infra (15 production + 20 test files) move to `packages/auth/src/`.
5. OAuth split: `OAuthManager` interface moves to auth; CLI implementation stays. `OAuthProvider` stays in CLI.
6. Consumer migration: core, CLI, and providers import from `@vybestack/llxprt-code-auth`.
7. Cleanup: old `packages/core/src/auth/` removed; no shims.

## Edge Cases

- AuthPrecedenceResolver depends on SettingsService shape — DI interface must capture exactly what is used.
- KeyringTokenStore depends on SecureStore error types — DI interface must include error hierarchy or accept error as plain values.
- ProxyTokenStore/ProxyProviderKeyStorage have no external dependencies beyond ProxySocketClient.
- CLI OAuth providers import `OAuthError`/`OAuthErrorFactory` — must come from auth package after migration.
- Device flows import only `types.ts` and `crypto` — straightforward move.
- `codex-device-flow.ts` imports `DebugLogger` from `../debug/index.js` — must accept `IDebugLogger`.
- Cache invalidation coupling between settings and auth precedence — ISettingsService must expose `on`/`off` event methods.
- Providers package imports `AuthPrecedenceResolver`, `OAuthManager`, `CodexOAuthTokenSchema` from core/auth — must update to auth package.
- `OAuthProvider` interface is referenced by multiple CLI files but not by auth domain logic — stays in CLI.