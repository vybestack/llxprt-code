# Plan: Credential Proxy for Sandbox

Plan ID: PLAN-20250214-CREDPROXY
Generated: 2025-02-14
Total Phases: 39 (P00a through P39)
Requirements: R1–R29 (from requirements.md)
Issues: #1358 (Credential proxy — Unix socket IPC), #1359 (Host-side OAuth refresh), #1360 (Host-side OAuth login for sandbox)
Epic: #1349 — Unified Credential Management, Phase B
Depends on: Phase A complete (#1351 KeyringTokenStore, #1352 Wire as Default, #1353 ProviderKeyStorage)

## Critical Reminders

Before implementing ANY phase, ensure you have:

1. Completed preflight verification (Phase 00a)
2. Defined integration contracts for multi-component features
3. Written integration tests BEFORE unit tests (vertical slice strategy)
4. Verified all dependencies and types exist as assumed
5. Read PLAN.md, PLAN-TEMPLATE.md, and RULES.md in dev-docs/

## Plan Summary

This plan implements a credential proxy for Docker/Podman sandbox mode. The proxy creates a Unix socket IPC channel between the host process and the containerized inner process. OAuth tokens are sanitized (refresh_token stripped) before crossing the trust boundary. Host-side OAuth refresh and login flows keep PKCE secrets and refresh tokens on the host.

## Component Breakdown

| # | Component | Pseudocode | Files |
|---|---|---|---|
| 1 | Framing Protocol & Socket Client | `analysis/pseudocode/001-framing-protocol.md` | `packages/core/src/auth/proxy/framing.ts`, `packages/core/src/auth/proxy/proxy-socket-client.ts` |
| 2 | Token Sanitization & Merge | `analysis/pseudocode/002-token-sanitization-merge.md` | `packages/core/src/auth/token-sanitization.ts`, `packages/core/src/auth/token-merge.ts` |
| 3 | ProxyTokenStore | `analysis/pseudocode/003-proxy-token-store.md` | `packages/core/src/auth/proxy/proxy-token-store.ts` |
| 4 | ProxyProviderKeyStorage | `analysis/pseudocode/004-proxy-provider-key-storage.md` | `packages/core/src/auth/proxy/proxy-provider-key-storage.ts` |
| 5 | CredentialProxyServer | `analysis/pseudocode/005-credential-proxy-server.md` | `packages/cli/src/auth/proxy/credential-proxy-server.ts` |
| 6 | RefreshCoordinator | `analysis/pseudocode/006-refresh-coordinator.md` | `packages/cli/src/auth/proxy/refresh-coordinator.ts` |
| 7 | ProactiveScheduler | `analysis/pseudocode/007-proactive-scheduler.md` | `packages/cli/src/auth/proxy/proactive-scheduler.ts` |
| 8 | OAuthSessionManager | `analysis/pseudocode/008-oauth-session-manager.md` | `packages/cli/src/auth/proxy/oauth-session-manager.ts` |
| 9 | ProxyOAuthAdapter | `analysis/pseudocode/009-proxy-oauth-adapter.md` | `packages/cli/src/auth/proxy/proxy-oauth-adapter.ts` |

## Phase Sequence

### Foundation (P00a–P02a)
- P00a: Preflight verification
- P01/P01a: Analysis verification
- P02/P02a: Pseudocode verification

### Core Transport (P03–P05a)
- P03/P03a: Framing Protocol stub
- P04/P04a: Framing Protocol TDD
- P05/P05a: Framing Protocol implementation

### Token Infrastructure (P06–P08a)
- P06/P06a: Token Sanitization & Merge stub
- P07/P07a: Token Sanitization & Merge TDD
- P08/P08a: Token Sanitization & Merge implementation

### Inner-Side Stores (P09–P14a)
- P09/P09a: ProxyTokenStore stub
- P10/P10a: ProxyTokenStore TDD
- P11/P11a: ProxyTokenStore implementation
- P12/P12a: ProxyProviderKeyStorage stub
- P13/P13a: ProxyProviderKeyStorage TDD
- P14/P14a: ProxyProviderKeyStorage implementation

### Host-Side Server (P15–P23a)
- P15/P15a: CredentialProxyServer stub
- P16/P16a: CredentialProxyServer TDD
- P17/P17a: CredentialProxyServer implementation
- P18/P18a: RefreshCoordinator stub
- P19/P19a: RefreshCoordinator TDD
- P20/P20a: RefreshCoordinator implementation
- P21/P21a: ProactiveScheduler stub
- P22/P22a: ProactiveScheduler TDD
- P23/P23a: ProactiveScheduler implementation

### OAuth Session Management (P24–P29a)
- P24/P24a: OAuthSessionManager stub
- P25/P25a: OAuthSessionManager TDD
- P26/P26a: OAuthSessionManager implementation
- P27/P27a: ProxyOAuthAdapter stub
- P28/P28a: ProxyOAuthAdapter TDD
- P29/P29a: ProxyOAuthAdapter implementation

### Integration, Migration, Deprecation (P30–P39a)
- P30/P30a: Integration stub (wire into existing system)
- P31/P31a: Integration TDD (end-to-end proxy tests)
- P32/P32a: Integration implementation (connect to sandbox.ts, factory functions, authCommand.ts)
- P33/P33a: Factory function + detection wiring
- P34/P34a: sandbox.ts integration
- P35/P35a: Migration (existing instantiation sites → factory functions)
- P36/P36a: Deprecation (remove direct KeyringTokenStore instantiation at consumer sites)
- P37/P37a: E2E verification (full sandbox credential flow)
- P38/P38a: Platform test matrix (Linux Docker, Linux Podman, macOS Docker Desktop, macOS Podman)
- P39/P39a: Final acceptance verification

## Integration Analysis (MANDATORY)

### Existing Code That Will USE This Feature
- `packages/cli/src/ui/commands/authCommand.ts` — Will dispatch to `ProxyOAuthAdapter` in proxy mode
- `packages/cli/src/providers/providerManagerInstance.ts` — Will use `createTokenStore()` factory
- `packages/cli/src/runtime/runtimeContextFactory.ts` — Will use `createTokenStore()` factory
- `packages/cli/src/ui/commands/profileCommand.ts` — Will use `createTokenStore()` factory
- `packages/cli/src/ui/commands/keyCommand.ts` — Will use `createProviderKeyStorage()` factory
- `packages/cli/src/utils/sandbox.ts` — Will create `CredentialProxyServer`, pass socket env var

### Existing Code to Be REPLACED
- Direct `new KeyringTokenStore()` calls at 5+ instantiation sites → replaced with `createTokenStore()`
- Direct `getProviderKeyStorage()` calls → replaced with `createProviderKeyStorage()`
- `mergeRefreshedToken()` in `oauth-manager.ts` → extracted to shared `token-merge.ts`
- `OAuthManager.scheduleProactiveRenewal()` algorithm → replicated in `ProactiveScheduler` (host-side)

### User Access Points
- CLI: `/auth login`, `/auth logout`, `/auth status` — all work transparently in sandbox
- CLI: API calls requiring OAuth tokens — transparent proxy
- CLI: `--key` flag — API key retrieval via proxy

### Migration Requirements
- All `new KeyringTokenStore()` sites → `createTokenStore()`
- All `getProviderKeyStorage()` sites → `createProviderKeyStorage()`
- `mergeRefreshedToken` exported from shared module
- `OAuthManager` check for proxy mode to skip proactive renewal

## Integration Checklist

- [x] Identified all touch points with existing system (5 instantiation sites, sandbox.ts, authCommand.ts)
- [x] Listed specific files that will import/use the feature (see above)
- [x] Identified old code to be replaced/removed (direct instantiation → factory)
- [x] Planned migration path for existing data (no data migration — env var detection)
- [x] Created integration tests that verify end-to-end flow (P31–P32)
- [x] User can actually access the feature through existing CLI (transparent proxy)
