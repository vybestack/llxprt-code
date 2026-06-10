# External Dependencies: Auth Package

Plan ID: PLAN-20260608-ISSUE1586
Updated: Phase P01 (evidence-refreshed from actual code)

## packages/auth External Dependencies

### npm Dependencies

| Dependency | Version | Used By | Type |
|-----------|---------|---------|------|
| `zod` | `^3.25.76` | `types.ts` (OAuthTokenSchema, ProviderOAuthConfigSchema, DeviceCodeResponseSchema, TokenResponseSchema, AuthStatusSchema, CodexOAuthTokenSchema, CodexTokenResponseSchema, BucketStatsSchema), `codex-device-flow.ts` (CodexTokenResponseSchema parsing) | Production |

**Only npm production dependency: `zod`.** All other external dependencies are Node built-ins or DI interfaces.

### npm Dev/Test Dependencies (allowed, not production coupling)

| Dependency | Used By | Type |
|-----------|---------|------|
| `typescript` | Build | Dev |
| `vitest` | Test runner | Dev |
| `eslint` | Linting | Dev |
| `prettier` | Formatting | Dev |
| `@types/node` | Type definitions | Dev |
| `fast-check` | Property-based testing | Dev (used by keyring-token-store tests) |

**Constraint:** No `@vybestack/*` package may appear in `packages/auth/package.json` `dependencies` or `devDependencies`.

### Node Built-in Dependencies

| Module | Used By | Purpose | DI Impact |
|--------|---------|---------|-----------|
| `node:fs/promises` | `keyring-token-store.ts` (file locking), `auth-precedence-resolver.ts` (keyfile reads) | File system access for token storage fallbacks | `keyring-token-store.ts` retains for lock file management (accepted interim). `auth-precedence-resolver.ts` may eliminate if keyfile reads move to IProviderKeyStorage impl (verify P11). |
| `node:path` | `keyring-token-store.ts`, `auth-precedence-resolver.ts` | Path construction | Same as above — verify at P11 for `auth-precedence-resolver.ts` |
| `node:os` | `keyring-token-store.ts` (homedir fallback), `auth-precedence-resolver.ts` (homedir expansion) | Home directory resolution | Same as above — verify at P11 for `auth-precedence-resolver.ts` |
| `node:net` | `proxy/proxy-socket-client.ts` | Unix socket connection | Retained |
| `node:crypto` | `proxy/proxy-socket-client.ts`, `anthropic-device-flow.ts`, `codex-device-flow.ts`, `qwen-device-flow.ts` | Random bytes, hashing | Retained |
| `node:url` | `anthropic-device-flow.ts` | URL construction | Retained |
| `crypto` | `anthropic-device-flow.ts`, `codex-device-flow.ts`, `qwen-device-flow.ts` | Random bytes, hashing (non-`node:` prefix) | Retained |

**Accepted interim design:** `KeyringTokenStore` retains `node:fs`, `node:path`, `node:os` for file-lock coordination. Neither `@napi-rs/keyring` nor core's `SecureStore`/`KeyringAdapter` moves into auth.

## packages/storage Status and ISecureStore as Interim

`packages/storage` does **not** exist (confirmed by P01: `ls packages/storage` → "No such file or directory").

**Interim design:**
- Auth defines `ISecureStore` and `IProviderKeyStorage` DI interfaces locally in `packages/auth/src/interfaces/`.
- Core implements these interfaces and injects concrete instances via DI factory functions.
- When `packages/storage` is extracted, interfaces migrate from auth to storage without changing auth public API.
- `KeyringTokenStore` retains Node filesystem builtins for file-lock/fallback logic — accepted interim.

**ISecureStore contract (from P01 evidence of `this.secureStore.*` usage in keyring-token-store.ts):**
```typescript
interface ISecureStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<boolean>;
  list(): Promise<string[]>;
  has?(key: string): Promise<boolean>;  // available but not directly called via this.secureStore.has
}
```

**ISecureStoreError types (from P01 evidence of SecureStoreError usage):**
```typescript
type SecureStoreErrorCode = 'UNAVAILABLE' | 'LOCKED' | 'DENIED' | 'CORRUPT' | 'TIMEOUT' | 'NOT_FOUND';
interface ISecureStoreError extends Error {
  code: SecureStoreErrorCode;
  remediation: string;
}
```

**IProviderKeyStorage contract (from P01 evidence):**
```typescript
interface IProviderKeyStorage {
  getKey(provider: string): Promise<string | null>;
  listKeys(): Promise<string[]>;
  hasKey(provider: string): Promise<boolean>;
}
```

Note: Factory `getProviderKeyStorage()` is a core concern, not an auth interface. Auth receives the instance via DI.

## packages/auth External Interface Requirements

### ISettingsService (replaces `../settings/SettingsService.js`)

Used by: `precedence.ts` (type-only), `auth-precedence-resolver.ts` (constructor)

```typescript
interface ISettingsService {
  get(key: string): unknown;
  getProviderSettings(providerName: string): Record<string, unknown>;
  on(event: string, handler: Function): void;
  off(event: string, handler: Function): void;
}
```

### IDebugLogger (replaces `DebugLogger` from `../debug/index.js`, `debugLogger` from `../utils/debugLogger.js`)

Used by: `auth-precedence-resolver.ts`, `precedence.ts`, `keyring-token-store.ts`, `codex-device-flow.ts`

```typescript
interface IDebugLogger {
  debug(...args: unknown[]): void;
  error(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  log(...args: unknown[]): void;
}
```

**P00a evidence confirms all 4 methods** are used across core and CLI auth files. Module-level singleton `debugLogger` and class constructor `new DebugLogger(namespace)` are core factory concerns — they do NOT move to auth.

### IProviderRuntimeContext (replaces `../runtime/providerRuntimeContext.js`)

Used by: `precedence.ts` (type-only), `auth-precedence-resolver.ts` (type + function call)

```typescript
interface IProviderRuntimeContext {
  settingsService: ISettingsService;
  config?: unknown;
  runtimeId?: string;
  metadata?: Record<string, unknown>;
}
```

Injected function: `getActiveRuntimeContext?: () => IProviderRuntimeContext | null` replaces static `getActiveProviderRuntimeContext()`.

## Packages That Will Depend on packages/auth

| Package | Dependency Direction | What They Import |
|---------|---------------------|-----------------|
| `packages/core` | core → auth | Re-exports auth types via index; provides DI factories (`createKeyringTokenStore`, `createAuthPrecedenceResolver`) |
| `packages/cli` | cli → auth + cli → core | Auth types + non-auth core types (DebugLogger, MessageBus, Config, ProfileManager) |
| `packages/providers` | providers → auth + providers → core | `AuthPrecedenceResolver`, `AuthPrecedenceConfig`, `OAuthManager`, `CodexOAuthTokenSchema`, `flushRuntimeAuthScope` from auth; `SettingsService` and other utilities from core |

## Forbidden Dependencies

`packages/auth` MUST NOT depend on:
- `@vybestack/llxprt-code-core`
- `@vybestack/llxprt-code` (CLI)
- `@vybestack/llxprt-code-providers`
- `@vybestack/llxprt-code-tools`
- `@napi-rs/keyring` (handled by ISecureStore implementation in core)
- `openai`, `@anthropic-ai/sdk`, `@google/genai`

## Dependency DAG (Post-Extraction)

```
auth → ⊥ (zero @vybestack deps; depends only on zod + node builtins + DI interfaces)
core → auth (re-exports + DI factories)
providers → auth + core
cli → auth + core
```

**Acyclic.** Auth has no `@vybestack/*` dependencies. All other packages can depend on auth.
