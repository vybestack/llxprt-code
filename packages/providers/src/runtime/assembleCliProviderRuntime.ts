/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20270110-ISSUE2378.P04
 * @requirement:REQ-2378-004
 *
 * Public providers-runtime helper that OWNS the pre-Config CLI provider-runtime
 * assembly (#2378).
 *
 * The CLI profile bootstrap previously constructed the session MessageBus
 * itself (core's `createSessionMessageBus`) and threaded it into
 * `createProviderManager` + `registerCliProviderInfrastructure`. That is
 * runtime assembly the providers package must own: the CLI supplies declarative
 * context (settingsService, optional pre-Config `config`, runtimeId, metadata,
 * an oauth-settings adapter) and this helper performs the ordered assembly:
 *
 *   1. bind the CLI runtime identity via `setCliRuntimeContext` FIRST so
 *      resolution is deterministic before any infrastructure reads ambient
 *      state (issue #2300).
 *   2. build the ONE session MessageBus internally — from the Config's policy
 *      engine + debug mode when a Config already exists, else a default bus
 *      (Config is created later in loadCliConfig; this pre-Config bus is
 *      re-seeded after Config construction by the post-config phase).
 *   3. construct the ProviderManager + OAuthManager on that bus via the
 *      composition seam.
 *   4. register the CLI provider infrastructure on the SAME bus.
 *
 * On any failure the CLI runtime is disposed so a half-assembled runtime is
 * never left registered.
 */

import {
  type Config,
  type MessageBus,
  createSessionMessageBus,
  type ProviderRuntimeContext,
  type RuntimeProviderManager,
  DebugLogger,
} from '@vybestack/llxprt-code-core';
import type { SettingsService } from '@vybestack/llxprt-code-settings';
import type { IOAuthSettingsProvider } from '@vybestack/llxprt-code-auth';
import { createProviderManager } from '../composition/index.js';
import {
  createFileOAuthSettingsProvider,
  type OAuthManager,
} from '../auth/index.js';
import {
  registerCliProviderInfrastructure,
  setCliRuntimeContext,
} from './runtimeLifecycle.js';
import { disposeCliRuntime } from './runtimeRegistry.js';

const logger = new DebugLogger('llxprt:runtime:assemble');

/**
 * Declarative context the CLI supplies to the provider-runtime assembly. No
 * MessageBus is accepted — bus ownership lives inside this helper.
 */
export interface AssembleCliProviderRuntimeInput {
  /** The runtime SettingsService (resolved by the caller). */
  readonly settingsService: SettingsService;
  /**
   * The resolved Config, when it already exists. During early CLI bootstrap the
   * Config is created later (loadCliConfig), so this is `undefined` and the
   * session bus is built from defaults.
   */
  readonly config: Config | undefined;
  /** The foreground CLI runtime id (issue #2300 — the caller resolves it). */
  readonly runtimeId: string;
  /** Runtime metadata threaded onto the context/registry entries. */
  readonly metadata?: Record<string, unknown>;
  /**
   * OAuth-settings surface forwarded to the composition seam so the assembled
   * {@link OAuthManager} can read `oauthEnabledProviders` (and therefore honor
   * configured OAuth providers). When the caller omits it, this helper OWNS the
   * fallback and constructs the providers-package file-backed provider
   * ({@link createFileOAuthSettingsProvider}) itself — every recomposition of
   * the CLI runtime (pre-Config bootstrap AND post-Config re-seed) must yield an
   * OAuth manager whose `isOAuthEnabled(...)` reflects the user's settings, not
   * a settings-less manager that always returns `false` (Issue #2378, mirrors
   * the isolated-runtime fix for Issue #2410). Pass an explicit adapter to
   * override (e.g. the CLI's comment-preserving `LoadedSettings` adapter); pass
   * `null` to force NO settings provider.
   */
  readonly oauthSettings?: IOAuthSettingsProvider | null;
}

/**
 * The assembled provider runtime. Mirrors the shape the CLI profile bootstrap
 * returned, with the session bus now owned by this helper.
 */
export interface AssembledCliProviderRuntime {
  readonly runtime: ProviderRuntimeContext;
  readonly runtimeMessageBus: MessageBus;
  readonly providerManager: RuntimeProviderManager;
  readonly oauthManager?: OAuthManager;
}

/**
 * Performs the ordered pre-Config CLI provider-runtime assembly, owning the
 * session MessageBus internally.
 */
export function assembleCliProviderRuntime(
  input: AssembleCliProviderRuntimeInput,
): AssembledCliProviderRuntime {
  const { settingsService, config, runtimeId, metadata, oauthSettings } = input;

  try {
    // 1. Bind identity BEFORE creating/registering infrastructure (issue #2300).
    setCliRuntimeContext(settingsService, config, {
      runtimeId,
      metadata,
    });

    const runtime = {
      settingsService,
      config,
      runtimeId,
      metadata,
    } as ProviderRuntimeContext;

    // 2. Build the ONE session MessageBus internally.
    const runtimeMessageBus = config
      ? createSessionMessageBus(config.getPolicyEngine(), config.getDebugMode())
      : createSessionMessageBus();

    // Resolve the OAuth-settings surface. Bus/OAuth ownership lives in the
    // providers package (#2378), so the fallback also lives here: when the
    // caller passes no adapter we construct the file-backed provider so the
    // assembled OAuth manager honors `oauthEnabledProviders`. An explicit
    // `null` opts out entirely (settings-less manager). This closes the
    // post-Config recomposition gap where the CLI re-seed omitted the adapter
    // and silently disabled every configured OAuth provider.
    const resolvedOAuthSettings =
      oauthSettings === undefined
        ? createFileOAuthSettingsProvider()
        : (oauthSettings ?? undefined);

    // 3. Construct the ProviderManager + OAuthManager on that bus.
    const { manager: providerManager, oauthManager } = createProviderManager(
      runtime,
      {
        config: runtime.config,
        runtimeMessageBus,
        ...(resolvedOAuthSettings !== undefined
          ? { oauthSettings: resolvedOAuthSettings }
          : {}),
      },
    );

    // 4. Register the CLI provider infrastructure on the SAME bus.
    registerCliProviderInfrastructure(providerManager, oauthManager, {
      messageBus: runtimeMessageBus,
      runtimeId,
      metadata,
    });

    return {
      runtime,
      runtimeMessageBus,
      providerManager,
      oauthManager,
    };
  } catch (error) {
    try {
      disposeCliRuntime(runtimeId);
    } catch (cleanupError) {
      // Preserve the original assembly failure; cleanup errors are secondary.
      logger.debug(
        () =>
          `[assembleCliProviderRuntime] disposeCliRuntime('${runtimeId}') failed during error recovery: ${
            cleanupError instanceof Error
              ? cleanupError.message
              : String(cleanupError)
          }`,
      );
    }
    throw error;
  }
}
