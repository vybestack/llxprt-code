# Stateless Provider v2 Migration Guide

<!-- @plan:PLAN-20251018-STATELESSPROVIDER2.P20 @requirement:REQ-SP2-005 -->

PLAN-20251018-STATELESSPROVIDER2 finalises the stateless provider architecture by introducing runtime-scoped authentication, CLI runtime registries, and migration-ready release notes. This guide walks host applications and provider authors through the upgrade.

## Overview

- Providers must accept a fully populated `ProviderRuntimeContext` (settings, config, metadata) during every invocation. Relying on global singletons is no longer supported.
- Authentication state is scoped per runtime through the auth precedence resolver. Tokens are cached by `{runtimeId, providerId, profileId}` and invalidated automatically when settings change.
- The CLI maintains a runtime registry that binds `ProviderManager`, `SettingsService`, and `OAuthManager` instances to each runtime id. Nested scopes (subagents, automation workers) reuse helpers without sharing credentials.

## Key changes

1. **Runtime identifiers are required** – Always supply a stable `runtimeId` when creating contexts. Missing identifiers fall back to `legacy-singleton`, which shares credentials across all runtimes and emits debug warnings.
2. **OAuth integration is runtime-aware** – When providers call into `OAuthManager`, the request metadata includes the runtime scope. Ensure custom providers pass the metadata through so revoke hooks can flush scoped tokens.
3. **Profiles exclude secrets by default** – `buildRuntimeProfileSnapshot()` omits runtime-only credentials. If your integration serialises profile snapshots manually, honour the `runtimeOnly` hints to avoid leaking secrets.
4. **CLI helpers are the source of truth** – Commands and extensions must use the helper bundle in `runtimeSettings.ts` (`switchActiveProvider`, `updateActiveProviderApiKey`, `activateIsolatedRuntimeContext`, etc.) to keep the runtime registry and auth cache in sync.

## Migration steps

1. **Bootstrap a runtime context during startup**

   ```ts
   import {
     createProviderRuntimeContext,
     setActiveProviderRuntimeContext,
   } from '@vybestack/llxprt-code-core';

   const runtime = createProviderRuntimeContext({
     runtimeId: 'cli-session',
     metadata: { origin: 'cli' },
   });
   setActiveProviderRuntimeContext(runtime);
   ```

   Attach the context before invoking any provider code so auth, telemetry, and diagnostics resolve the correct scope.

2. **Route provider mutations through CLI helpers**

   ```ts
   import {
     switchActiveProvider,
     updateActiveProviderApiKey,
     setActiveModel,
   } from '@vybestack/llxprt-code/src/runtime/runtimeSettings';

   await switchActiveProvider('anthropic');
   await updateActiveProviderApiKey(process.env.ANTHROPIC_KEY ?? '');
   await setActiveModel('claude-3-5-sonnet');
   ```

   These helpers update the runtime registry, refresh auth, and emit scope metadata in one place.

3. **Handle runtime disposal**

   ```ts
   import {
     clearActiveProviderRuntimeContext,
     resetCliProviderInfrastructure,
   } from '@vybestack/llxprt-code/src/runtime/runtimeSettings';

   resetCliProviderInfrastructure('cli-session');
   clearActiveProviderRuntimeContext();
   ```

   Disposing the runtime flushes scoped tokens and clears cached managers. For subagents, call this inside `finally` blocks.

4. **Audit custom providers**
   - Ensure calls to `settingsService.getProviderSetting` use the instance from the runtime, not module-level imports.
   - If your provider caches SDK clients, key the cache by `runtime.runtimeId` to maintain isolation (see `OpenAIResponsesProvider` for an example).
   - Log runtime metadata (`runtime.metadata`) to trace automation usage without exposing raw credentials.

## Verification

Run the standard lint suite and any provider-specific integration tests:

```bash
npm run lint
npm run test -- --run provider-multi-runtime
```

If you maintain additional docs or automation guides, update them to reference `stateless-provider-v2` instead of the original migration article.
