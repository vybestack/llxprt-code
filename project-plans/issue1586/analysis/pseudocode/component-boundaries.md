# Pseudocode: Component Boundaries

Plan ID: PLAN-20260608-ISSUE1586
Updated: Phase P02 (contract-first pseudocode, evidence-aligned with P00a/P01)

## C-CB-01: ISecureStore DI Interface

```
10: INTERFACE ISecureStore
11:   METHOD get(key: string): Promise<string | null>
12:   METHOD set(key: string, value: string): Promise<void>
13:   METHOD delete(key: string): Promise<boolean>
14:   METHOD list(): Promise<string[]>
15:   METHOD has(key: string): Promise<boolean>
16: END INTERFACE
17:
18: TYPE SecureStoreErrorCode =
19:   'UNAVAILABLE' | 'LOCKED' | 'DENIED' | 'CORRUPT' | 'TIMEOUT' | 'NOT_FOUND'
20:
21: TYPE ISecureStoreError extends Error {
22:   code: SecureStoreErrorCode
23:   message: string
24:   remediation: string
25: }
26:
27: NOTE: KeyringTokenStore constructor accepts { secureStore: ISecureStore, logger?: IDebugLogger }
28: NOTE: Core implements ISecureStore using @napi-rs/keyring SecureStore class
29: NOTE: If secureStore not provided, KeyringTokenStore throws at construction time
30: NOTE: ISecureStore is an INTERIM instance contract; will migrate to packages/storage when created.
31:       KeyringTokenStore retains Node fs/path/os builtins for file-lock/fallback — accepted as interim.
32:       @napi-rs/keyring and core SecureStore/KeyringAdapter stay in core.
33: NOTE: list() used by keyring-token-store.ts listProviders() (L414) and listBuckets() (L437)
34: NOTE: has() confirmed present on SecureStore (P00a: L657 async has(key)) — included for interface completeness
35: NOTE: get/set/delete are the primary CRUD operations used by saveToken/getToken/removeToken
36: NOTE: SecureStoreError caught via instanceof in keyring-token-store.ts (L349):
37:       catch (error) { if (error instanceof SecureStoreError && error.code === 'CORRUPT') ... }
38: NOTE: SecureStoreErrorCode values match core secure-store.ts (L30): UNAVAILABLE, LOCKED, DENIED, CORRUPT, TIMEOUT, NOT_FOUND
39: NOTE: ISecureStoreError includes remediation field (core SecureStoreError has code, message, remediation)
40: NOTE: packages/storage absence documented as accepted deviation from issue #1586 (see external-dependencies.md)
```

## C-CB-02: ISettingsService DI Interface

```
10: INTERFACE ISettingsService
11:   METHOD get(key: string): unknown
12:   METHOD getProviderSettings(providerName: string): Record<string, unknown>
13:   METHOD on(event: string, handler: Function): void
14:   METHOD off(event: string, handler: Function): void
15: END INTERFACE
16:
17: NOTE: AuthPrecedenceResolver constructor accepts settingsService: ISettingsService
18: NOTE: Core's SettingsService structurally satisfies ISettingsService
19: NOTE: Must capture enough for cache invalidation subscriptions (on/off)
20: NOTE: precedence.ts (L152-154) accesses getCurrentProfileName via dynamic cast:
21:       (settingsService as { getCurrentProfileName?: () => string | null }).getCurrentProfileName
22:       This is a dynamic property access, NOT a direct ISettingsService method.
23:       ISettingsService does NOT include getCurrentProfileName — auth code accesses it via get('currentProfile')
24:       as a fallback (precedence.ts L163-166). The dynamic cast pattern can be replaced by a
25:       dedicated injected function if needed, but ISettingsService surface stays minimal at 4 methods.
26: NOTE: P01 evidence: SettingsService.get(key) at L57, getProviderSettings(provider) at L99,
27:       on/off via EventEmitter + manual impl at L246-251
```

## C-CB-03: IProviderKeyStorage DI Interface

```
10: INTERFACE IProviderKeyStorage
11:   METHOD getKey(provider: string): Promise<string | null>
12:   METHOD listKeys(): Promise<string[]>
13:   METHOD hasKey(provider: string): Promise<boolean>
14: END INTERFACE
15:
16: NOTE: AuthPrecedenceResolver uses this to check auth-key/keyfile
17: NOTE: Core's getProviderKeyStorage() returns an object satisfying this interface (L133)
18: NOTE: IProviderKeyStorage is an INTERIM instance contract; getProviderKeyStorage() is a core factory function
19:       that returns an object satisfying this contract — the factory stays in core, the interface lives in auth.
20:       Will migrate to packages/storage when created.
21: NOTE: P01 evidence: ProviderKeyStorage has getKey, listKeys, hasKey (plus saveKey/deleteKey not in interface)
22: NOTE: Factory getProviderKeyStorage() stays in core — auth receives instance via DI
```

## C-CB-04: IDebugLogger DI Interface

```
10: INTERFACE IDebugLogger
11:   METHOD debug(message: string, ...args: unknown[]): void
12:   METHOD error(message: string, ...args: unknown[]): void
13:   METHOD warn(message: string, ...args: unknown[]): void
14:   METHOD log(message: string, ...args: unknown[]): void
15: END INTERFACE
16:
17: TYPE DebugLoggerFactory = (namespace: string) => IDebugLogger
18:
19: NOTE: P00a evidence confirms ALL 4 methods used in auth-relevant files:
20:       Core auth: debug, warn (precedence.ts, auth-precedence-resolver.ts);
21:                  debug, error, warn (keyring-token-store.ts instance)
22:       CLI auth: debug, error, warn, log (codex/gemini/qwen/anthropic oauth providers,
23:                 auth-flow-orchestrator, BucketFailoverHandlerImpl, token-access-coordinator,
24:                 token-refresh-helper)
25: NOTE: IDebugLogger is an INSTANCE contract; the debugLogger module-level singleton and
26:       DebugLogger class constructor are core factory concerns. Auth receives IDebugLogger instances
27:       via DI injection — neither the singleton nor the constructor moves to auth.
28: NOTE: Multiple auth files use DebugLogger: keyring-token-store, precedence,
29:       auth-precedence-resolver, codex-device-flow
30: NOTE: Core's DebugLogger structurally satisfies IDebugLogger
```

## C-CB-05: IProviderRuntimeContext DI Interface

```
10: INTERFACE IProviderRuntimeContext
11:   FIELD settingsService: ISettingsService
12:   FIELD config?: unknown
13:   FIELD runtimeId?: string
14:   FIELD metadata?: Record<string, unknown>
15: END INTERFACE
16:
17: TYPE GetActiveRuntimeContext = (() => IProviderRuntimeContext | null) | undefined
18:
19: NOTE: precedence.ts currently has a type-only import of ProviderRuntimeContext
20:       that MUST be replaced with IProviderRuntimeContext when moving to auth.
21: NOTE: auth-precedence-resolver.ts uses injected getActiveRuntimeContext function
22: NOTE: Must accept injection via getActiveRuntimeContext?: () => IProviderRuntimeContext | null
23: NOTE: getActiveRuntimeContext is NOT a method on IProviderRuntimeContext; it is a separate injected function
24: NOTE: metadata field is used by auth-precedence-resolver.ts (L375) for runtime scope metadata
25: NOTE: P01 evidence: ProviderRuntimeContext in providerRuntimeContext.ts has
26:       settingsService, config?, runtimeId?, metadata? (all 4 fields confirmed)
```

## C-CB-06: AuthPrecedenceResolver DI Refactoring

```
10: CLASS AuthPrecedenceResolver
11:   // Migration shape (options-object constructor — matches C-CB-09 factory contract):
12:   CONSTRUCTOR(config: AuthPrecedenceConfig, options?: {
13:     oauthManager?: OAuthManager,
14:     settingsService?: ISettingsService,
15:     providerKeyStorage?: IProviderKeyStorage,
16:     logger?: IDebugLogger,
17:     getActiveRuntimeContext?: GetActiveRuntimeContext
18:   })
19:
20:   // DI injection points (all explicitly listed in constructor above):
21:   FIELD settingsService → ISettingsService (from options.settingsService)
22:   FIELD providerKeyStorage → IProviderKeyStorage (from options.providerKeyStorage)
23:   FIELD logger → IDebugLogger (from options.logger)
24:   FIELD getActiveRuntimeContext → GetActiveRuntimeContext (from options.getActiveRuntimeContext)
25:
26:   METHOD resolveAuth(provider, config):
27:     CHECK auth-key via settingsService.getProviderSettings
28:     CHECK API key from config
29:     CHECK environment variables
30:     CHECK OAuth via injected OAuthManager
31:     RETURN resolved credentials
32:   END METHOD
33:
34:   NOTE: Constructor uses options-object pattern for DI injection points, preserving
35:         backward compatibility: positional args (config, oauthManager?, settingsService?)
36:         from P00a evidence (auth-precedence-resolver.ts:L71) migrate to
37:         (config, { oauthManager?, settingsService?, providerKeyStorage?, logger?,
38:         getActiveRuntimeContext? }). The options-object shape matches C-CB-09
39:         createAuthPrecedenceResolver factory contract exactly.
40:   NOTE: All four DI-injected dependencies (ISettingsService, IProviderKeyStorage,
41:         IDebugLogger, GetActiveRuntimeContext) are explicitly listed as constructor
42:         injection points — no hidden or implicit dependencies.
43:   NOTE: No direct imports from core submodules after DI refactoring
44:   NOTE: All core access via injected interfaces
45:   NOTE: OAuthManager interface already defined in precedence.ts
46:   NOTE: precedence.ts refactored to eliminate core imports:
47:         SettingsService → ISettingsService, ProviderRuntimeContext → IProviderRuntimeContext,
48:         debugLogger → injected IDebugLogger boundary
```

## C-CB-07: KeyringTokenStore DI Refactoring

```
10: CLASS KeyringTokenStore implements TokenStore
11:   CONSTRUCTOR(options: {
12:     secureStore: ISecureStore,
13:     logger?: IDebugLogger,
14:     keySuffix?: string
15:   })
16:
17:   // Helper: derive a single storage key from provider + optional bucket
18:   // (ISecureStore uses single-key methods per C-CB-01)
19:   PRIVATE METHOD buildStorageKey(provider, bucket?): string
20:     IF bucket IS provided:
21:       RETURN `llxprt:auth:${provider}:${bucket}`
22:     ELSE:
23:       RETURN `llxprt:auth:${provider}`
24:   END METHOD
25:
26:   METHOD saveToken(provider, token, bucket?):
27:     CONST key = buildStorageKey(provider, bucket)
28:     CONST serializedToken = JSON.stringify(token)
29:     CALL secureStore.set(key, serializedToken)
30:     ON ISecureStoreError with code NOT_FOUND → create new entry
31:     ON other ISecureStoreError → throw
32:   END METHOD
33:
34:   METHOD getToken(provider, bucket?):
35:     CONST key = buildStorageKey(provider, bucket)
36:     CONST raw = CALL secureStore.get(key)
37:     IF raw IS null RETURN null
38:     PARSE raw as JSON → OAuthToken
39:     RETURN token or null
40:   END METHOD
41:
42:   METHOD removeToken(provider, bucket?):
43:     CONST key = buildStorageKey(provider, bucket)
44:     CALL secureStore.delete(key)
45:   END METHOD
46:
47:   METHOD listProviders():
48:     CONST allKeys = CALL secureStore.list()
49:     FILTER keys matching "llxprt:auth:" prefix
50:     EXTRACT unique provider names from keys
51:     RETURN provider name list
52:   END METHOD
53:
54:   METHOD listBuckets(provider):
55:     CONST allKeys = CALL secureStore.list()
56:     FILTER keys matching "llxprt:auth:{provider}:" prefix
57:     EXTRACT bucket names from keys
58:     RETURN bucket name list
59:   END METHOD
60:
61:   NOTE: ISecureStore uses single-key methods per C-CB-01: get(key), set(key, value),
62:         delete(key), list(), has(key). The provider+bucket composite is encoded into a
63:         single storage key string via buildStorageKey() BEFORE calling ISecureStore.
64:   NOTE: list() used for provider/bucket enumeration (listProviders, listBuckets)
65:         per P00a evidence (keyring-token-store.ts L414 listProviders, L437 listBuckets)
66:   NOTE: No import of ../storage/secure-store.js
67:   NOTE: No import of ../debug/index.js
68:   NOTE: All external access via injected ISecureStore + IDebugLogger
69:   NOTE: Retains node:fs/promises, node:path, node:os for file-lock/fallback — accepted interim
```

## C-CB-08: CodexDeviceFlow DI Refactoring

```
10: CLASS CodexDeviceFlow
11:   CONSTRUCTOR(options?: {
12:     logger?: IDebugLogger
13:   })
14:
15:   METHOD initiateAuth():
16:     CALL codex token endpoint
17:     CALL logger.debug('Codex device flow initiated') IF logger present
18:   END METHOD
19:
20:   NOTE: Replace import of ../debug/index.js with optional IDebugLogger injection
21:   NOTE: Logger is optional; uses no-op if not provided
```

## C-CB-09: Core DI Factory Functions

```
10: FUNCTION createKeyringTokenStore(): KeyringTokenStore
11:   CONST secureStore = new SecureStore()  // core's @napi-rs/keyring impl
12:   CONST logger = new DebugLogger('llxprt:auth:keyring')
13:   RETURN new KeyringTokenStore({ secureStore, logger })
14: END FUNCTION
15:
16: FUNCTION createAuthPrecedenceResolver(config: AuthPrecedenceConfig, settingsService: ISettingsService, oauthManager?: OAuthManager, getActiveRuntimeContext?: GetActiveRuntimeContext): AuthPrecedenceResolver
17:   CONST providerKeyStorage = getProviderKeyStorage() // core's impl
18:   CONST logger = new DebugLogger('llxprt:auth:precedence')
19:   RETURN new AuthPrecedenceResolver(config, {
20:     oauthManager,
21:     settingsService,
22:     providerKeyStorage,
23:     logger,
24:     getActiveRuntimeContext: getActiveRuntimeContext
25:   })
26: END FUNCTION
27:
28: NOTE: Factory functions live in packages/core/src/auth-factories.ts (NOT in core/src/auth/)
29: NOTE: Exported from packages/core/src/index.ts
30: NOTE: These factories are the ergonomic entry point for consumers who use core
31: NOTE: Factory functions are deferred to P17 (not implemented in P05-P11)
32: NOTE: createAuthPrecedenceResolver signature declares config: AuthPrecedenceConfig
33:       as its first parameter, consistent with C-CB-06 constructor contract
34:       CONSTRUCTOR(config: AuthPrecedenceConfig, options?: {...}). The factory passes
35:       config through to the constructor and supplies the options object
36:       { oauthManager, settingsService, providerKeyStorage, logger, getActiveRuntimeContext }.
37: NOTE: oauthManager is caller-supplied and forwarded to the AuthPrecedenceResolver
38:       options-object constructor. Core does NOT create or inject oauthManager —
39:       it is passed through from CLI/providers. Core internally supplies
40:       providerKeyStorage (via getProviderKeyStorage()) and logger (via new DebugLogger).
41: NOTE: getSecureStore()/ISecureStore is NOT used in createAuthPrecedenceResolver —
42:       it belongs exclusively to createKeyringTokenStore/KeyringTokenStore path.
```

## C-CB-10: CLI OAuth Provider Adapter Registration

```
10: // In packages/cli/src/auth/provider-registry.ts (stays in CLI)
11: CLASS ProviderRegistry
12:   METHOD registerProvider(name: string, provider: OAuthProvider): void
13:   METHOD getProvider(name: string): OAuthProvider | undefined
14: END CLASS
15:
16: // In packages/cli — composition root
17: CONST registry = new ProviderRegistry()
18: registry.registerProvider('anthropic', new AnthropicOAuthProvider(...))
19: registry.registerProvider('gemini', new GeminiOAuthProvider(...))
20: registry.registerProvider('qwen', new QwenOAuthProvider(...))
21: registry.registerProvider('codex', new CodexOAuthProvider(...))
22:
23: CONST oauthManager = new OAuthManager({ registry, ... })
24: // oauthManager structurally implements interface OAuthManager from @vybestack/llxprt-code-auth
25:
26: NOTE: AuthPrecedenceResolver does not hard-code provider names
27: NOTE: New providers require only CLI changes, not auth package changes
28: NOTE: OAuthProvider interface stays in CLI (used only by CLI adapters)
```

## C-CB-11: Proxy Auth Infrastructure Split

```
10: // packages/auth/src/proxy/ — infrastructure layer (moves from core/src/auth/proxy/)
11: EXPORT encodeFrame, FrameDecoder from framing.ts
12: EXPORT ProxySocketClient from proxy-socket-client.ts
13: EXPORT ProxyTokenStore (implements TokenStore) from proxy-token-store.ts
14: EXPORT ProxyProviderKeyStorage (implements IProviderKeyStorage) from proxy-provider-key-storage.ts
15:
16: // packages/cli/src/auth/proxy/ — orchestration layer (stays in CLI)
17: IMPORT { ProxyTokenStore, ProxySocketClient } from '@vybestack/llxprt-code-auth'
18: CLASS CredentialProxyServer uses ProxySocketClient
19: CLASS SandboxProxyLifecycle manages proxy start/stop
20: CLASS CredentialStoreFactory selects KeyringTokenStore vs ProxyTokenStore
21:
22: NOTE: Auth package provides building blocks (transport infrastructure)
23: NOTE: CLI composes them into a running system (orchestration)
24: NOTE: Clean separation: transport in auth, lifecycle in CLI
25: NOTE: proxy-token-store.ts and proxy-provider-key-storage.ts have zero external imports
26:       (P01 dependency audit confirms: only internal auth imports)
```
