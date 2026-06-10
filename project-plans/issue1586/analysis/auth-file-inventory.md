# Auth File Inventory

Plan ID: PLAN-20260608-ISSUE1586
Updated: Phase P01 (evidence-refreshed from actual code)

## Core Auth Production Files (15 files)

```text
packages/core/src/auth/anthropic-device-flow.ts          284 lines
packages/core/src/auth/auth-precedence-resolver.ts       688 lines
packages/core/src/auth/codex-device-flow.ts               644 lines
packages/core/src/auth/keyring-token-store.ts             534 lines
packages/core/src/auth/oauth-errors.ts                    647 lines
packages/core/src/auth/precedence.ts                      514 lines
packages/core/src/auth/proxy/framing.ts                   111 lines
packages/core/src/auth/proxy/proxy-provider-key-storage.ts  57 lines
packages/core/src/auth/proxy/proxy-socket-client.ts       278 lines
packages/core/src/auth/proxy/proxy-token-store.ts         119 lines
packages/core/src/auth/qwen-device-flow.ts                227 lines
packages/core/src/auth/token-merge.ts                      29 lines
packages/core/src/auth/token-sanitization.ts               24 lines
packages/core/src/auth/token-store.ts                     107 lines
packages/core/src/auth/types.ts                           106 lines
```

**Total lines (production): 4,369**

## Core Auth Test Files (20 files)

### Root-level test/spec files (10 files)

```text
packages/core/src/auth/precedence.test.ts                         747 lines
packages/core/src/auth/precedence.adapter.test.ts                  98 lines
packages/core/src/auth/auth-integration.spec.ts                   561 lines
packages/core/src/auth/codex-device-flow.spec.ts                  259 lines
packages/core/src/auth/oauth-errors.spec.ts                       697 lines
packages/core/src/auth/oauth-logout-cache-invalidation.spec.ts    137 lines
packages/core/src/auth/token-store.spec.ts                        454 lines
packages/core/src/auth/token-store.refresh-race.spec.ts           283 lines
packages/core/src/auth/invalidateProviderCache.test.ts            293 lines
packages/core/src/auth/qwen-device-flow.spec.ts                   975 lines
```

### __tests__ directory test files (6 files)

```text
packages/core/src/auth/__tests__/authRuntimeScope.test.ts                143 lines
packages/core/src/auth/__tests__/codex-device-flow.test.ts               440 lines
packages/core/src/auth/__tests__/keyring-token-store.integration.test.ts  751 lines
packages/core/src/auth/__tests__/keyring-token-store.test.ts            1685 lines
packages/core/src/auth/__tests__/token-merge.test.ts                     215 lines
packages/core/src/auth/__tests__/token-sanitization.test.ts              166 lines
```

### proxy/__tests__ directory test files (4 files)

```text
packages/core/src/auth/proxy/__tests__/framing.test.ts                    342 lines
packages/core/src/auth/proxy/__tests__/proxy-provider-key-storage.test.ts  356 lines
packages/core/src/auth/proxy/__tests__/proxy-socket-client.test.ts        443 lines
packages/core/src/auth/proxy/__tests__/proxy-token-store.test.ts          497 lines
```

**Total lines (test): 9,247**
**Total core auth: 15 production + 20 test = 35 .ts files (13,616 lines total)**

## CLI Auth Production Files (34 pure production + 2 test-helpers = 36 non-test .ts files)

### Pure Production Files (34 files — stay in CLI)

```text
packages/cli/src/auth/anthropic-oauth-provider.ts                  512 lines
packages/cli/src/auth/auth-flow-orchestrator.ts                    698 lines
packages/cli/src/auth/auth-status-service.ts                       451 lines
packages/cli/src/auth/auth-utils.ts                                 97 lines
packages/cli/src/auth/BucketFailoverHandlerImpl.ts                 723 lines
packages/cli/src/auth/codex-oauth-provider.ts                      539 lines
packages/cli/src/auth/codex-success-image.ts                       556 lines
packages/cli/src/auth/gemini-oauth-provider.ts                     538 lines
packages/cli/src/auth/global-oauth-ui.ts                           112 lines
packages/cli/src/auth/local-oauth-callback.ts                      291 lines
packages/cli/src/auth/migration.ts                                  81 lines
packages/cli/src/auth/MultiBucketAuthenticator.ts                  260 lines
packages/cli/src/auth/oauth-manager.ts                             492 lines
packages/cli/src/auth/oauth-provider-base.ts                       188 lines
packages/cli/src/auth/OAuthBucketManager.ts                        179 lines
packages/cli/src/auth/OnAuthErrorHandlerImpl.ts                    103 lines
packages/cli/src/auth/proactive-renewal-manager.ts                 514 lines
packages/cli/src/auth/profile-utils.ts                             123 lines
packages/cli/src/auth/provider-registry.ts                         155 lines
packages/cli/src/auth/provider-usage-info.ts                       296 lines
packages/cli/src/auth/proxy/credential-proxy-oauth-handler.ts      578 lines
packages/cli/src/auth/proxy/credential-proxy-server.ts             487 lines
packages/cli/src/auth/proxy/credential-store-factory.ts             94 lines
packages/cli/src/auth/proxy/oauth-session-manager.ts               151 lines
packages/cli/src/auth/proxy/proactive-scheduler.ts                  86 lines
packages/cli/src/auth/proxy/proxy-oauth-adapter.ts                 267 lines
packages/cli/src/auth/proxy/refresh-coordinator.ts                 158 lines
packages/cli/src/auth/proxy/sandbox-proxy-lifecycle.ts             242 lines
packages/cli/src/auth/qwen-oauth-provider.ts                       390 lines
packages/cli/src/auth/token-access-coordinator.ts                  999 lines
packages/cli/src/auth/token-bucket-failover-helper.ts              152 lines
packages/cli/src/auth/token-profile-resolver.ts                    151 lines
packages/cli/src/auth/token-refresh-helper.ts                      233 lines
packages/cli/src/auth/types.ts                                     145 lines
```

### Test-Helper Files (2 files — co-located with production, not counted as production)

```text
packages/cli/src/auth/BucketFailoverHandlerImpl.test-helpers.ts     99 lines
packages/cli/src/auth/oauth-manager.issue1468.test-helpers.ts      175 lines
```

### Test Utility Files (1 file — in __tests__/behavioral/)

```text
packages/cli/src/auth/__tests__/behavioral/test-utils.ts           (support file)
```

**Note:** The 3 test-helper/utility files are not production, not spec/test. They are:
- 2 co-located test-helpers (`BucketFailoverHandlerImpl.test-helpers.ts`, `oauth-manager.issue1468.test-helpers.ts`)
- 1 test utility in __tests__/behavioral/ (`test-utils.ts`)

## CLI Auth Test/Spec Files (129 files total)

### __tests__/ directory (45 files)

- `__tests__/` root: 21 files (unit tests + spec files)
- `__tests__/behavioral/`: 8 files (7 spec + 1 test-utils)
- `__tests__/proxy/`: (proxy tests are in `packages/cli/src/auth/proxy/__tests__/` — 15 files)

Note: The `__tests__` count includes proxy subdirectory test files at `packages/cli/src/auth/proxy/__tests__/`.

### Co-located test/spec files (84 files)

These are `*.test.ts` and `*.spec.ts` files alongside production files, including:
- 48 `BucketFailoverHandlerImpl.case-*.spec.ts` files
- 18 `oauth-manager.issue1468.case-*.spec.ts` files
- Various other provider and manager test files

**Total CLI auth: 36 non-test (34 production + 2 test-helpers) + 129 test/spec + 1 test-utils = 166 .ts files**

## Providers Package Auth-Related Imports (6 production + 3 test = 9 total)

**Confirmed by P00a preflight and P01 fresh `rg`:**

### Production Files

```text
packages/providers/src/BaseProvider.ts                                         — AuthPrecedenceResolver, AuthPrecedenceConfig, OAuthManager from core/auth/precedence
packages/providers/src/gemini/GeminiProvider.ts                                 — type OAuthManager from core/auth/precedence
packages/providers/src/anthropic/AnthropicProvider.ts                           — type OAuthManager from core/auth/precedence
packages/providers/src/openai/OpenAIProvider.ts                                 — type OAuthManager from core/auth/precedence
packages/providers/src/openai-vercel/OpenAIVercelProvider.ts                    — type OAuthManager from core/auth/precedence
packages/providers/src/openai-responses/OpenAIResponsesProviderBase.ts          — CodexOAuthTokenSchema from core/auth/types, type OAuthManager from core/auth/precedence
```

### Test Files

```text
packages/providers/src/BaseProvider.test.ts                                     — type OAuthManager, OAuthTokenRequestMetadata from core/auth/precedence
packages/providers/src/openai/openai-oauth.spec.ts                             — flushRuntimeAuthScope from core/auth/precedence
packages/providers/src/openai-responses/__tests__/OpenAIResponsesProvider.promptCacheKey.test.ts — type CodexOAuthToken from core/auth/types
```

**Count: 6 production + 3 test = 9 files. Confirmed by P01 `rg -l "from ['\"]@vybestack/llxprt-code-core/auth" packages/providers/src --glob '*.ts'`. Matches P00a preflight and plan-time expected count.**

## Coverage Summary

| Category | Files | Source |
|----------|-------|--------|
| Core auth production | 15 | P01 `find` evidence |
| Core auth test/spec | 20 | P01 `find` evidence |
| CLI auth production | 34 | P01 `find` evidence |
| CLI auth test-helpers | 2 | P01 `find` evidence |
| CLI auth test-utils | 1 | P01 `find` evidence |
| CLI auth test/spec | 129 | P01 `find` evidence (45 in __tests__ + 84 co-located) |
| Providers auth imports (production) | 6 | P01 `rg` evidence |
| Providers auth imports (test) | 3 | P01 `rg` evidence |
| **Total classified** | **210** | 100% coverage of all auth-related files |
