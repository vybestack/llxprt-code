# Pseudocode: Auth Domain vs CLI OAuth Split

Plan ID: PLAN-20260608-ISSUE1586
Updated: Phase P02 (contract-first pseudocode, evidence-aligned with P00a/P01)

## Split Strategy

The CLI oauth-manager.ts (preflight-verified 492 lines, packages/cli/src/auth/oauth-manager.ts) is a composition class, not auth domain logic. The split is:

### Auth Domain (packages/auth) — What Moves

```
10: // packages/auth/src/precedence.ts
11: EXPORT interface OAuthManager {
12:   getToken(provider: string, metadata?: OAuthTokenRequestMetadata): Promise<string | null>
13:   isAuthenticated(provider: string): Promise<boolean>
14:   getOAuthToken?(provider: string, metadata?: OAuthTokenRequestMetadata): Promise<OAuthToken | null>
15: }
16:
17: EXPORT interface AuthPrecedenceConfig { ... }
18: EXPORT interface OAuthTokenRequestMetadata { ... }
19: EXPORT interface RuntimeScopedState { ... }
20:
21: // precedence resolution logic (pure auth domain)
22: EXPORT FUNCTION resolveAuthWithPrecedence(settings, config, oauthManager?): ResolvedAuth
23: EXPORT cache management functions: buildCacheKey, ensureRuntimeState, etc.
24: EXPORT FUNCTION flushRuntimeAuthScope(...): RuntimeAuthScopeFlushResult
25:
26: // packages/auth/src/auth-precedence-resolver.ts (canonical source)
27: EXPORT CLASS AuthPrecedenceResolver
28:   CONSTRUCTOR(config: AuthPrecedenceConfig, options?: {
29:     oauthManager?: OAuthManager,
30:     settingsService?: ISettingsService,
31:     providerKeyStorage?: IProviderKeyStorage,
32:     logger?: IDebugLogger,
33:     getActiveRuntimeContext?: GetActiveRuntimeContext
34:   })
35:
36: NOTE: AuthPrecedenceResolver class uses precedence functions internally
37: NOTE: AuthPrecedenceResolver defined ONLY in auth-precedence-resolver.ts (not precedence.ts)
38: NOTE: precedence.ts contains OAuthManager interface + cache/flow primitives — NOT the class
39: NOTE: No CLI-specific imports (no LoadedSettings, no MessageBus, no ProviderRegistry)
40: NOTE: Constructor options-object matches C-CB-06 and C-CB-09 factory contract exactly
```

### CLI Composition (packages/cli) — What Stays

```
10: // packages/cli/src/auth/oauth-manager.ts (stays in CLI)
11: CLASS OAuthManager implements interface_OAuthManager_from_auth_package {
12:   CONSTRUCTOR(deps: {
13:     settings: LoadedSettings,
14:     registry: ProviderRegistry,
15:     bucketManager: OAuthBucketManager,
16:     tokenAccess: TokenAccessCoordinator,
17:     authFlowOrchestrator: AuthFlowOrchestrator,
18:     authStatus: AuthStatusService,
19:     ...
20:   })
21:
22:   METHOD getToken(provider, metadata):
23:     DELEGATE to tokenAccessCoordinator
24:   METHOD isAuthenticated(provider):
25:     CHECK registry + settings
26:   METHOD getOAuthToken(provider, metadata):
27:     DELEGATE to appropriate store
28: END CLASS
29:
30: NOTE: This class is preflight-verified 492 lines of orchestration
31: NOTE: It composes many sub-components that are all CLI-specific
32: NOTE: implements interface from auth package (structural typing)
33: NOTE: CLI OAuthManager implementation stays in CLI despite issue #1586 text
34: NOTE: OAuthManager class at packages/cli/src/auth/oauth-manager.ts:L39
```

### OAuth Provider Interface Location Decision

```
10: // DECISION: OAuthProvider interface stays in packages/cli/src/auth/types.ts
11: //
12: // REASON:
13: //   1. OAuthProvider is used ONLY by CLI adapter classes:
14: //      - AnthropicOAuthProvider, CodexOAuthProvider, GeminiOAuthProvider, QwenOAuthProvider
15: //   2. AuthPrecedenceResolver does NOT reference OAuthProvider
16: //   3. AuthPrecedenceResolver uses OAuthManager interface (in precedence.ts → auth)
17: //   4. No current consumer outside CLI needs OAuthProvider
18: //   5. Can be moved to packages/auth in a follow-up if cross-package need arises
19: //
20: // CONSISTENT WITH:
21: //   - analysis/auth-file-classification.md: OAuthProvider → CLI
22: //   - preflight-results.md: OAuthProvider stays in CLI (L37 of types.ts)
23: //   - plan/12-oauth-split-stub.md: OAuthProvider stays in CLI types.ts
24:
25: // packages/cli/src/auth/types.ts (stays here)
26: EXPORT interface OAuthProvider {
27:   name: string
28:   initiateAuth(): Promise<OAuthToken>
29:   getToken(): Promise<OAuthToken | null>
30:   refreshToken(currentToken: OAuthToken): Promise<OAuthToken | null>
31: }
```

### Justification: CLI Auth Scope vs Issue #1586

```
10: // Issue #1586 says oauth-manager.ts and CLI-specific auth logic should move.
11: // This plan interprets that as:
12: //
13: // MOVES TO AUTH:
14: //   - OAuthManager interface (the contract AuthPrecedenceResolver depends on)
15: //   - Auth domain types, token store, precedence logic, device flows, errors
16: //   - All 15 production + 20 test files from core/src/auth/
17: //
18: // STAYS IN CLI:
19: //   - OAuthManager IMPLEMENTATION (preflight-verified 492 lines of CLI-specific orchestration)
20: //   - CLI-specific composition classes that USE auth domain types
21: //   - Provider adapters (implement OAuthProvider from CLI types.ts)
22: //   - Proxy orchestration (server lifecycle, credential factory)
23: //
24: // WHY: Moving CLI implementation would force packages/auth to depend on
25: // CLI types (LoadedSettings, MessageBus, ProviderRegistry), creating a cycle.
26: // The interface moving to auth achieves the goal of making auth domain
27: // independent. CLI composition remains in CLI and implements the interface.
28: //
29: // ALTERNATIVE CONSIDERED: Decompose OAuthManager into smaller domain objects
30: // that could move to auth. REJECTED as scope creep beyond #1586.
31: // Can be done in a follow-up issue without changing the package boundary.
32: //
33: // OWNER-ACCEPTANCE: CLI OAuthManager implementation stays in CLI per
34: // design decision — documented for integration-contract.md IC-09
```

### packages/storage Absence Documentation

```
10: // packages/storage does NOT exist in the current repository (P00a confirmed).
11: // Issue #1586 references packages/storage as a dependency, but that package
12: // has not been extracted.
13: //
14: // INTERIM DESIGN:
15: //   - Auth defines ISecureStore and IProviderKeyStorage DI interfaces locally
16: //     in packages/auth/src/interfaces/
17: //   - Core implements these interfaces and injects concrete instances via DI
18: //   - When packages/storage is extracted, interfaces migrate from auth to storage
19: //     without changing auth public API
20: //   - KeyringTokenStore retains node:fs/path/os for file-lock/fallback — accepted interim
21: //
22: // This is documented as an accepted deviation from issue #1586.
```

### Auth Flow Result

```
10: // Auth domain defines what it needs from OAuth:
11: //   - Can you get a token for this provider? (OAuthManager interface)
12: //   - Is OAuth enabled for this provider? (OAuthManager.isAuthenticated)
13:
14: // CLI defines HOW OAuth works:
15: //   - Device flow orchestration (AuthFlowOrchestrator)
16: //   - Bucket management (OAuthBucketManager)
17: //   - Proactive renewal (ProactiveRenewalManager)
18: //   - Token access coordination (TokenAccessCoordinator)
19: //   - Provider-specific flows (anthropic/gemini/qwen/codex providers)
20:
21: CLEAN SPLIT: Auth domain has zero knowledge of CLI internals
22:              CLI implements auth domain interfaces
23:              No circular dependency possible
24:
25: DEPENDENCY DAG: auth → ⊥ (zero @vybestack deps)
26:                 core → auth (re-exports + DI factories)
27:                 providers → auth + core
28:                 cli → auth + core
29:                 Acyclic — verified in external-dependencies.md
```
