import type { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { WorkspaceTrustControlPort } from '@vybestack/llxprt-code-core';

import { RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';
import { ProviderManager } from '../ProviderManager.js';

/**
 * @plan:PLAN-20270110-ISSUE2378.P04
 * @requirement:REQ-2378-004
 *
 * Public providers-runtime helper that OWNS the pre-Config CLI provider-runtime
 * assembly (#2378).
 *
 * The CLI profile bootstrap previously constructed the session MessageBus
 * itself (core's `createSessionMessageBus`) and threaded it into
 * provider construction and process-wide registration. That is
 * runtime assembly the providers package must own: the CLI supplies declarative
 * context (settingsService, optional pre-Config `config`, runtimeId, metadata,
 * an oauth-settings adapter) and this helper performs the ordered assembly:
 *
 *   1. create or adopt a per-bootstrap handle without registering its label.
 *   2. build a session MessageBus from the Config policy when available.
 *   3. construct the ProviderManager + OAuthManager on that bus.
 *   4. bind the selected manager and file lifecycle to the exact owner Config.
 *
 * Failed assembly restores the handle and Config to their previous ownership.
 */

import {
  type Config,
  type MessageBus,
  type ProviderRuntimeContext,
  type RuntimeProviderManager,
} from '@vybestack/llxprt-code-core';
import type { SettingsService } from '@vybestack/llxprt-code-settings';
import type { IOAuthSettingsProvider } from '@vybestack/llxprt-code-auth';
import {
  createProviderManager,
  configureProviderRuntimeFactories,
} from '../composition/index.js';
import { NodeFileSystem } from '../composition/IFileSystem.js';
import type { ProviderContributionRegistry } from '../composition/runtimePlugins/types.js';
import {
  createFileOAuthSettingsProvider,
  type OAuthManager,
} from '../auth/index.js';
import {
  beginCliRuntimeRegistration,
  type CliRuntimeRegistrationHandle,
} from './cliForegroundRuntime.js';

import { resolveRuntimeKind } from './runtimeKind.js';

/**
 * Declarative context the CLI supplies to the provider-runtime assembly. No
 * MessageBus is accepted — bus ownership lives inside this helper.
 */
export interface AssembleCliProviderRuntimeInput {
  readonly settingsOwner?: SessionSettingsOwner;
  readonly trustPort?: WorkspaceTrustControlPort;
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
  /** Runtime metadata threaded onto this bootstrap's provider context. */
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
  /**
   * The provider contribution registry produced by loading the configured
   * runtime plugins once at CLI startup. Forwarded to the composition seam so
   * alias construction dispatches through it. Omitted by callers that load no
   * runtime plugins, which then get the built-ins-only registry.
   */
  readonly providerContributions?: ProviderContributionRegistry;
  readonly registration?: CliRuntimeRegistrationHandle;
  readonly oauthManager?: OAuthManager;
}

/**
 * The assembled provider runtime. Mirrors the shape the CLI profile bootstrap
 * returned, with the session bus now owned by this helper.
 */
export interface AssembledCliProviderRuntime {
  readonly runtime: ProviderRuntimeContext;
  readonly runtimeMessageBus: MessageBus;
  readonly policyOwner?: RuntimePolicyOwner;
  readonly providerManager: RuntimeProviderManager;
  readonly oauthManager?: OAuthManager;
  readonly registration: CliRuntimeRegistrationHandle;
}

function resolveCliOAuthSettings(
  oauthSettings: IOAuthSettingsProvider | null | undefined,
): IOAuthSettingsProvider | undefined {
  return oauthSettings === undefined
    ? createFileOAuthSettingsProvider()
    : (oauthSettings ?? undefined);
}

/**
 * Performs the ordered pre-Config CLI provider-runtime assembly, owning the
 * session MessageBus internally.
 */
export function assembleCliProviderRuntime(
  input: AssembleCliProviderRuntimeInput,
): AssembledCliProviderRuntime {
  const {
    settingsService,
    config,
    runtimeId,
    metadata,
    oauthSettings,
    providerContributions,
  } = input;
  if (
    input.registration &&
    (input.registration.runtimeId !== runtimeId ||
      input.registration.settingsService !== settingsService)
  ) {
    throw new Error('CLI registration does not belong to this runtime');
  }
  const registration =
    input.registration ??
    beginCliRuntimeRegistration(settingsService, config, { runtimeId });
  let undoAdoption: (() => void) | undefined;
  let policyOwner: RuntimePolicyOwner | undefined;

  try {
    if (input.registration && config) undoAdoption = registration.adopt(config);
    if (config !== undefined) input.settingsOwner?.bindTelemetry(config);
    const runtime = {
      sessionSettings: input.settingsOwner,
      settingsService,
      config,
      runtimeId,
      runtimeKind: resolveRuntimeKind(undefined, metadata, 'cli-interactive'),
      metadata,
      providerFileLifecycle: registration.providerFileLifecycle,
    } as ProviderRuntimeContext;

    const runtimeMessageBus = registration.messageBus;
    if (
      input.oauthManager !== undefined &&
      input.oauthManager.runtimeMessageBus !== runtimeMessageBus
    )
      throw new Error(
        'Supplied OAuth manager belongs to a different runtime message bus',
      );
    policyOwner = bindCliPolicy(config, input.trustPort, registration);

    // Resolve the OAuth-settings surface. Bus/OAuth ownership lives in the
    // providers package (#2378), so the fallback also lives here: when the
    // caller passes no adapter we construct the file-backed provider so the
    // assembled OAuth manager honors `oauthEnabledProviders`. An explicit
    // `null` opts out entirely (settings-less manager). This closes the
    // post-Config recomposition gap where the CLI re-seed omitted the adapter
    // and silently disabled every configured OAuth provider.
    const resolvedOAuthSettings = resolveCliOAuthSettings(oauthSettings);

    // 3. Construct the ProviderManager + OAuthManager on that bus.
    const borrowedManager = input.registration?.providerManager;
    const { manager: providerManager, oauthManager } =
      borrowedManager === undefined
        ? createProviderManager(runtime, {
            fileSystem: new NodeFileSystem(),
            config: runtime.config,
            runtimeMessageBus,
            ...(resolvedOAuthSettings !== undefined
              ? { oauthSettings: resolvedOAuthSettings }
              : {}),
            ...(providerContributions !== undefined
              ? { providerContributions }
              : {}),
          })
        : { manager: borrowedManager, oauthManager: input.oauthManager };
    if (borrowedManager !== undefined && config !== undefined)
      bindFinalProviderOwner(providerManager, config, runtime);

    registration.expectManager(providerManager);

    return {
      runtime,
      runtimeMessageBus,
      policyOwner,
      providerManager,
      oauthManager,
      registration,
    };
  } catch (error) {
    void policyOwner?.dispose();
    undoAdoption?.();
    if (!input.registration) registration.rollback();
    throw error;
  }
}

function bindCliPolicy(
  config: Config | undefined,
  trust: WorkspaceTrustControlPort | undefined,
  registration: CliRuntimeRegistrationHandle,
): RuntimePolicyOwner | undefined {
  if (config === undefined) return undefined;
  const owner = new RuntimePolicyOwner(
    config,
    trust,
    undefined,
    registration.messageBus,
  );
  const decisions = owner.session.decisions;
  registration.bindPolicyEvaluation((name, args, server) =>
    decisions.evaluate(name, args, server),
  );
  return owner;
}

function bindFinalProviderOwner(
  manager: RuntimeProviderManager,
  config: Config,
  runtime: ProviderRuntimeContext,
): void {
  if (!(manager instanceof ProviderManager))
    throw new Error('CLI provider runtime requires a ProviderManager owner');
  const selected =
    runtime.settingsService.get('activeProvider') ?? config.getProvider();
  if (selected !== undefined) {
    if (typeof selected !== 'string')
      throw new TypeError('Active provider must be a string');
    try {
      manager.setActiveProvider(selected);
    } catch (error) {
      throw new Error(
        `Could not activate explicitly-configured provider '${selected}': ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
  }
  manager.setRuntimeContext(runtime);
  manager.setConfig(config);
  configureProviderRuntimeFactories(config, manager);
}
