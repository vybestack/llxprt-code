# Pseudocode: Consumer Migration

Plan ID: PLAN-20260608-ISSUE1586
Updated: Phase P02 (contract-first pseudocode, evidence-aligned with P00a/P01)

## Test Migration Policy

All 20 core auth tests move to packages/auth after DI refactoring — no exceptions, no relocation to owning packages. Auth-package tests use local DI test doubles; any test that currently imports from `@vybestack/llxprt-code-core` or `@vybestack/llxprt-code-providers` MUST be refactored with local DI test doubles before moving. Scan MUST fail if `packages/auth` tests import `core`, `providers`, or sibling packages. This policy is consistent with `analysis/auth-file-classification.md` and `specification.md` (REQ-TEST-001.5).

```
10: RULE: Auth-package-local tests — use DI test doubles only (ISecureStore, ISettingsService, etc.)
11: RULE: All 20 core auth tests move to packages/auth after DI refactoring (7 require DI test doubles); none are relocated to owning packages
12: RULE: Enforcement scan: rg -n "@vybestack/llxprt-code-core|@vybestack/llxprt-code-providers" packages/auth/src --glob '*.test.ts' --glob '*.spec.ts' MUST return zero matches
13: RULE: 13 auth-package-local tests have no cross-package deps and move as-is
14: RULE: 7 cross-package-dependent tests refactored with local DI test doubles:
15:       - precedence.adapter.test.ts → @vybestack/llxprt-code-providers removed, ISettingsService double
16:       - invalidateProviderCache.test.ts → SettingsService → ISettingsService double
17:       - precedence.test.ts → SettingsService → ISettingsService double
18:       - keyring-token-store.test.ts → SecureStore → ISecureStore double
19:       - keyring-token-store.integration.test.ts → SecureStore/DebugLogger → DI doubles
20:       - auth-integration.spec.ts → core symbols → DI doubles
21:       - oauth-logout-cache-invalidation.spec.ts → SettingsService → ISettingsService double
```

## C-CM-01: Core Index.ts Auth Re-exports

```
10: // BEFORE (packages/core/src/index.ts):
11: export { AuthPrecedenceResolver } from './auth/auth-precedence-resolver.js'
12: export { OAuthManager, ... } from './auth/precedence.js'
13: export type { OAuthToken, ... } from './auth/types.js'
14: export { KeyringTokenStore } from './auth/keyring-token-store.js'
15: export { OAuthError, OAuthErrorFactory } from './auth/oauth-errors.js'
16:
17: // AFTER (packages/core/src/index.ts):
18: export { AuthPrecedenceResolver, type OAuthManager, type OAuthToken, type TokenStore,
19:          KeyringTokenStore, OAuthError, OAuthErrorFactory,
20:          type OAuthTokenRequestMetadata, type AuthStatus, type BucketStats,
21:          type DeviceCodeResponse, CodexDeviceFlow, type CodexOAuthToken,
22:          flushRuntimeAuthScope, type RuntimeAuthScopeFlushResult,
23:          type RuntimeAuthScopeCacheEntrySummary } from '@vybestack/llxprt-code-auth'
24:
25: // NEW (packages/core/src/auth-factories.ts):
26: export { createKeyringTokenStore, createAuthPrecedenceResolver }
27:
28: // NOTE: Re-exports from auth package are direct main-index, not wrapper files or deep-path shims
29: // NOTE: No files remain under packages/core/src/auth/ after cleanup (P18)
30: // NOTE: auth-factories.ts is in core/src/ (NOT core/src/auth/)
31: // NOTE: Core re-export policy: direct main-index re-exports only, no wrapper/deep-path shims
```

## C-CM-02: CLI Auth Types Migration

```
10: // BEFORE (packages/cli/src/auth/types.ts):
11: import type { OAuthToken, TokenStore, ... } from '@vybestack/llxprt-code-core'
12: export { KeyringTokenStore } from '@vybestack/llxprt-code-core'
13:
14: // AFTER (packages/cli/src/auth/types.ts):
15: import type { OAuthToken, TokenStore, OAuthTokenRequestMetadata } from '@vybestack/llxprt-code-auth'
16: export type { OAuthToken, AuthStatus, TokenStore, OAuthTokenRequestMetadata } from '@vybestack/llxprt-code-auth'
17: export { KeyringTokenStore } from '@vybestack/llxprt-code-auth'
18:
19: // NOTE: CLI-specific types (OAuthProvider, BucketFailoverOAuthManagerLike) remain in this file
20: // NOTE: MessageBus, Config types still come from @vybestack/llxprt-code-core
21: // NOTE: OAuthProvider stays in CLI — it's used only by CLI adapter classes
22: // NOTE: OAuthProvider interface location: packages/cli/src/auth/types.ts (Decision C-CB-10)
```

## C-CM-03: CLI OAuth Manager Import Update

```
10: // BEFORE (packages/cli/src/auth/oauth-manager.ts):
11: import { OAuthToken, TokenStore, OAuthError, ... } from '@vybestack/llxprt-code-core'
12:
13: // AFTER (packages/cli/src/auth/oauth-manager.ts):
14: import type { OAuthToken, TokenStore } from '@vybestack/llxprt-code-auth'
15: import { OAuthError } from '@vybestack/llxprt-code-auth'
16: // Other non-auth imports remain from @vybestack/llxprt-code-core
17:
18: // NOTE: structurally implements interface OAuthManager from @vybestack/llxprt-code-auth
19: // NOTE: OAuthManager class (CLI implementation) stays in CLI (P00a: L39)
```

## C-CM-04: CLI Provider Auth Adapter Updates

```
10: // BEFORE (packages/cli/src/auth/oauth-provider-base.ts):
11: import { OAuthError, OAuthErrorFactory } from '@vybestack/llxprt-code-core'
12: import type { OAuthToken } from '@vybestack/llxprt-code-core'
13:
14: // AFTER:
15: import { OAuthError, OAuthErrorFactory } from '@vybestack/llxprt-code-auth'
16: import type { OAuthToken } from '@vybestack/llxprt-code-auth'
17:
18: // BEFORE (packages/cli/src/auth/codex-oauth-provider.ts):
19: import { CodexDeviceFlow, OAuthError } from '@vybestack/llxprt-code-core'
20:
21: // AFTER:
22: import { CodexDeviceFlow, OAuthError } from '@vybestack/llxprt-code-auth'
23:
24: // NOTE: All CLI provider adapters (anthropic, gemini, qwen, codex) follow same pattern
25: // NOTE: Non-auth core imports (DebugLogger, debugLogger, MessageBus, Config) remain from core
```

## C-CM-05: CLI Proxy File Import Updates

```
10: // BEFORE (packages/cli/src/auth/proxy/credential-store-factory.ts):
11: import { SecureStore } from '@vybestack/llxprt-code-core'
12: import { KeyringTokenStore, ProxyTokenStore } from '@vybestack/llxprt-code-core'
13:
14: // AFTER:
15: import { SecureStore } from '@vybestack/llxprt-code-core'  // SecureStore stays in core
16: import { KeyringTokenStore, ProxyTokenStore } from '@vybestack/llxprt-code-auth'
17:
18: // BEFORE (packages/cli/src/auth/proxy/credential-proxy-oauth-handler.ts):
19: import type { OAuthToken, TokenStore } from '@vybestack/llxprt-code-core'
20:
21: // AFTER:
22: import type { OAuthToken, TokenStore } from '@vybestack/llxprt-code-auth'
23:
24: // BEFORE (packages/cli/src/auth/proxy/sandbox-proxy-lifecycle.ts):
25: // imports proxy types from core
26:
27: // AFTER:
28: import { ProxySocketClient } from '@vybestack/llxprt-code-auth'
29:
30: // NOTE: SecureStore does NOT move to auth — it stays in core (ISecureStore is the DI boundary)
```

## C-CM-06: Core Auth Subpath Exports Update

```
10: // BEFORE (packages/core/package.json exports):
11: "./auth/precedence.js": "./dist/src/auth/precedence.js",
12: "./auth/types.js": "./dist/src/auth/types.js",
13:
14: // AFTER:
15: // Remove auth subpath exports entirely
16: // Consumers import from @vybestack/llxprt-code-auth directly
17: // OR core re-exports from main entry point
18:
19: // ALSO: Core StreamProcessor.ts (core/src/core/StreamProcessor.ts)
20: // currently imports flushRuntimeAuthScope from '../auth/precedence.js' (relative)
21: // After migration, import from '@vybestack/llxprt-code-auth' or core re-export
22: // NOTE: Any direct subpath imports of core/auth must be migrated
23: // NOTE: All providers package imports of core/auth/* must update to @vybestack/llxprt-code-auth
24: // NOTE: Total deep-path consumers: 2 subpath exports + 9 provider files
25: //       + 1 core file (StreamProcessor.ts) + 1 core test (StreamProcessor.unbucketed-auth-failover.test.ts)
```

## C-CM-07: Package Dependency Additions

```
10: // packages/core/package.json — add auth dependency
11: "dependencies": {
12:   "@vybestack/llxprt-code-auth": "file:../auth",
13:   // ... existing deps
14: }
15:
16: // packages/cli/package.json — add auth dependency
17: "dependencies": {
18:   "@vybestack/llxprt-code-auth": "file:../auth",
19:   "@vybestack/llxprt-code-core": "file:../core",
20:   // ... existing deps
21: }
22:
23: // packages/providers — add auth dependency AND keep core dependency
24: "dependencies": {
25:   "@vybestack/llxprt-code-auth": "file:../auth",
26:   "@vybestack/llxprt-code-core": "file:../core",  // for SettingsService, non-auth utilities
27:   // ... existing deps
28: }
29:
30: // NOTE: All three consumer packages get @vybestack/llxprt-code-auth as dependency
31: // NOTE: providers retains @vybestack/llxprt-code-core for non-auth imports (SettingsService, etc.)
32: // NOTE: Total provider consumer files needing import updates: 6 production + 3 test = 9 (preflight-derived)
33: // NOTE: AuthPrecedenceResolver constructor in BaseProvider: settingsService param passes SettingsService
34: //   directly — it satisfies ISettingsService by structural typing, no adapter needed
35: // NOTE: Dependency DAG after changes: auth→⊥, core→auth, providers→auth+core, cli→auth+core (acyclic)
```

## C-CM-08: Providers Package Auth Import Migration

```
10: // BEFORE (packages/providers/src/BaseProvider.ts):
11: import { AuthPrecedenceResolver, type AuthPrecedenceConfig, type OAuthManager }
12:   from '@vybestack/llxprt-code-core/auth/precedence.js'
13:
14: // AFTER:
15: import { AuthPrecedenceResolver, type AuthPrecedenceConfig, type OAuthManager }
16:   from '@vybestack/llxprt-code-auth'
17:
18: // BEFORE (packages/providers/src/openai-responses/OpenAIResponsesProviderBase.ts):
19: import { CodexOAuthTokenSchema } from '@vybestack/llxprt-code-core/auth/types.js'
20: import type { OAuthManager } from '@vybestack/llxprt-code-core/auth/precedence.js'
21:
22: // AFTER:
23: import { CodexOAuthTokenSchema } from '@vybestack/llxprt-code-auth'
24: import type { OAuthManager } from '@vybestack/llxprt-code-auth'
25:
26: // Same pattern for: GeminiProvider, AnthropicProvider, OpenAIProvider, OpenAIVercelProvider
27: // (all import type OAuthManager from core/auth/precedence.js → @vybestack/llxprt-code-auth)
28:
29: // BEFORE (packages/providers/src/BaseProvider.test.ts):
30: import type { OAuthManager, OAuthTokenRequestMetadata }
31:   from '@vybestack/llxprt-code-core/auth/precedence.js'
32:
33: // AFTER:
34: import type { OAuthManager, OAuthTokenRequestMetadata }
35:   from '@vybestack/llxprt-code-auth'
36:
37: // BEFORE (packages/providers/src/openai/openai-oauth.spec.ts):
38: import { flushRuntimeAuthScope } from '@vybestack/llxprt-code-core/auth/precedence.js'
39:
40: // AFTER:
41: import { flushRuntimeAuthScope } from '@vybestack/llxprt-code-auth'
42:
43: // BEFORE (packages/providers/src/openai-responses/__tests__/OpenAIResponsesProvider.promptCacheKey.test.ts):
44: import type { CodexOAuthToken } from '@vybestack/llxprt-code-core/auth/types.js'
45:
46: // AFTER:
47: import type { CodexOAuthToken } from '@vybestack/llxprt-code-auth'
48:
49: // NOTE: providers package gains @vybestack/llxprt-code-auth as dependency
50: // NOTE: providers RETAINS @vybestack/llxprt-code-core dependency (for SettingsService)
51: // NOTE: No providers code moves; only import paths change
52: // NOTE: Total provider files with auth imports: 6 production + 3 test = 9 (preflight-derived)
53: // NOTE: BaseProvider.ts:L151 constructs AuthPrecedenceResolver directly:
54: //   new AuthPrecedenceResolver(precedenceConfig, config.oauthManager, fallbackSettingsService)
55: //   SettingsService satisfies ISettingsService by structural typing — no adapter needed
```

## C-CM-09: Core Non-Auth File Auth Import Migration

```
10: // BEFORE (packages/core/src/core/StreamProcessor.ts):
11: import { flushRuntimeAuthScope } from '../auth/precedence.js'
12:
13: // AFTER:
14: import { flushRuntimeAuthScope } from '@vybestack/llxprt-code-auth'
15: // OR via core re-export:
16: import { flushRuntimeAuthScope } from '@vybestack/llxprt-code-core'
17:
18: // BEFORE (packages/core/src/core/StreamProcessor.unbucketed-auth-failover.test.ts):
19: import { flushRuntimeAuthScope } from '../auth/precedence.js'
20:
21: // AFTER:
22: import { flushRuntimeAuthScope } from '@vybestack/llxprt-code-auth'
23:
24: // NOTE: StreamProcessor.ts is a core non-auth file that imports from core/src/auth/
25: // NOTE: Its import path must change during consumer migration
26: // NOTE: P01 evidence: 1 production file + 1 test file in core non-auth use auth imports
```

## C-CM-10: Core Package Subpath Export Cleanup

```
10: // BEFORE (packages/core/package.json exports):
11: "./auth/precedence.js": "./dist/src/auth/precedence.js",
12: "./auth/types.js": "./dist/src/auth/types.js",
13:
14: // AFTER:
15: // Remove auth subpath exports entirely
16: // All consumers now import from @vybestack/llxprt-code-auth directly
17: // Core may re-export from main entry point for convenience
18:
19: // NOTE: Deep-path exports violate no-subpath-export policy
20: // NOTE: These removals happen in P15/P18
21: // NOTE: No old core/auth import specifiers may remain in repo after P18:
22: //       forbidden: @vybestack/llxprt-code-core/auth, relative paths containing core/src/auth
```
