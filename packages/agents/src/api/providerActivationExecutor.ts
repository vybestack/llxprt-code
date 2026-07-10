/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Consolidated provider-activation / authentication executor (#2374, part of
 * #1595). Reproduces EXACTLY the imperative sequences that previously lived in
 * the CLI bootstrap (`activateConfiguredProvider`) and the Zed integration
 * (`authenticateWithProviderOrFallback` + `applyRuntimeProviderOverrides` +
 * `applyProfileModelParams`), so frontends can express provider selection +
 * auth intent as DATA (ProviderActivationIntent) and let agent construction
 * execute it internally.
 *
 * CONSUMER CONTRACT (#2374 round-3 Fix 3): the PRIMARY consumers of this
 * executor are fromConfig() and createAgent() via the `activation` intent on
 * FromConfigOptions / AgentConfig — new code should pass the intent to agent
 * construction rather than calling executeProviderActivation directly. Direct
 * invocation is RESERVED for pre-agent bootstrap phases that run before any
 * Agent exists:
 *   1. cliBootstrap.tsx `activateConfiguredProvider` — the sandbox-hop /
 *      fatal-exit decision needs the auth outcome BEFORE the interactive Agent
 *      is constructed.
 *   2. config/postConfigRuntime.ts step 13 — config finalization runs before
 *      agent construction.
 *   3. Zed integration (zedIntegration.ts autoAuthenticate +
 *      zed-provider-auth.ts) — the Zed ACP runtime does not construct an Agent
 *      yet, pending the separate Zed-on-Agent-API migration issue.
 *
 * Source-of-truth behaviors mirrored (read these CLI files before changing):
 * - packages/cli/src/cliBootstrap.tsx `activateConfiguredProvider`
 * - packages/cli/src/zed-integration/zed-provider-auth.ts
 *   `authenticateWithProviderOrFallback` / `applyRuntimeProviderOverrides` /
 *   `applyProfileModelParams`
 */

import * as fs from 'node:fs/promises';
import os from 'node:os';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { RuntimeProviderManager } from '@vybestack/llxprt-code-core';
import {
  switchActiveProvider,
  setActiveModel,
  setActiveModelParam,
  clearActiveModelParam,
  getActiveModelParams,
  applyCliArgumentOverrides,
  setProviderApiKey,
  setProviderBaseUrl,
} from '@vybestack/llxprt-code-providers/runtime.js';
import { configureProviderRuntimeFactories } from '@vybestack/llxprt-code-providers/composition.js';
import type { ProviderActivationIntent } from './config-types.js';
import {
  hasProfileAuthEphemerals,
  reapplyProfileAuthEphemerals,
  snapshotProfileAuthEphemerals,
} from './profileAuthEphemerals.js';
import { PLACEHOLDER_MODEL } from './constants.js';

/**
 * Outcome of executing a {@link ProviderActivationIntent}. Mirrors the boolean
 * the CLI's `activateConfiguredProvider` returns (`authFailed`) plus the
 * resolved active provider and any info messages from the underlying switch.
 */
export interface ProviderActivationResult {
  /** True when the provider-case auth sequence threw (CLI maps this to fatal). */
  readonly authFailed: boolean;
  /** The provider name active after execution, when known. */
  readonly activeProvider?: string;
  /** Info messages surfaced by the underlying provider switch. */
  readonly infoMessages: readonly string[];
  /**
   * The error from switching to an explicitly-requested provider, when the
   * switch failed. Populated in all authModes so callers that treat a provider
   * switch as best-effort (postConfigRuntime step 13, authMode 'none') can
   * surface the failure the way HEAD's logger.warn did (#2374 finding 6).
   */
  readonly switchError?: string;
  /**
   * The underlying auth error when authFailed is true, so callers (fromConfig)
   * can include it in the thrown AgentBootstrapError (#2374 finding 3).
   */
  readonly authError?: unknown;
}

/**
 * Executes a declarative provider-activation / auth intent against a live
 * Config. Does NOT throw on auth failure — mirrors the CLI's boolean return so
 * callers (fromConfig, direct invocations) can observe fatal auth failure via
 * `result.authFailed`.
 *
 * Behavior by authMode:
 * - 'none': skip auth refresh entirely (external auth / --use-external-auth).
 * - 'provider-or-oauth': the Zed fallback — refreshAuth('provider') when the
 *   manager has an active provider, else refreshAuth('oauth'); applies runtime
 *   provider overrides (auth-key/auth-keyfile/base-url) and profile model
 *   params before auth.
 * - 'auto' (default): the CLI path — no-provider falls back to defaultProvider
 *   and swallows auth errors; provider-case applies CLI overrides, switches
 *   (preserving profile auth ephemerals), refreshes auth, then resolves model
 *   + model params.
 */
export async function executeProviderActivation(
  config: Config,
  intent: ProviderActivationIntent,
): Promise<ProviderActivationResult> {
  const authMode = intent.authMode ?? 'auto';
  if (authMode === 'none') {
    return executeNoAuth(config, intent);
  }
  if (authMode === 'provider-or-oauth') {
    return executeProviderOrOauth(config, intent);
  }
  return executeAuto(config, intent);
}

// ─── authMode: 'none' ───────────────────────────────────────────────────────

/**
 * Skips auth refresh entirely. Still applies runtime credential overrides
 * (auth-key/auth-keyfile/base-url ephemerals) and resolves the model + model
 * params so the intent's declarative fields take effect even when auth is
 * external. Provider activation (when intent.provider is set) is best-effort.
 */
async function executeNoAuth(
  config: Config,
  intent: ProviderActivationIntent,
): Promise<ProviderActivationResult> {
  let switchError: string | undefined;
  if (intent.provider !== undefined) {
    switchError = await safeActivateProvider(intent.provider);
  }
  const keyfileWarning = await applyRuntimeProviderOverrides(config);
  const infoMessages: string[] = [];
  if (keyfileWarning !== undefined) {
    infoMessages.push(keyfileWarning);
  }
  // Guard: skip model/param application when no provider is active (the
  // switch may have failed or no provider was requested). setActiveModel/
  // setActiveModelParam require an active provider and would throw.
  if (resolveActiveProviderName(config) !== undefined) {
    await applyModelAndParams(config, intent);
  }
  const activeName = resolveActiveProviderName(config);
  return {
    authFailed: false,
    ...(activeName !== undefined ? { activeProvider: activeName } : {}),
    infoMessages,
    ...(switchError !== undefined ? { switchError } : {}),
  };
}

// ─── authMode: 'provider-or-oauth' (Zed fallback) ───────────────────────────

/**
 * Reproduces the Zed integration's `authenticateWithProviderOrFallback` +
 * `applyRuntimeProviderOverrides` + `applyProfileModelParams`. When the manager
 * has an active provider: configure runtime factories, set config on the gemini
 * serverToolsProvider, refreshAuth('provider'), attach providerManager to the
 * content generator config. Else refreshAuth('oauth').
 */
async function executeProviderOrOauth(
  config: Config,
  intent: ProviderActivationIntent,
): Promise<ProviderActivationResult> {
  let switchError: string | undefined;
  if (intent.provider !== undefined) {
    // Snapshot profile-auth ephemerals BEFORE the switch — switchActiveProvider
    // clears ephemerals, so a profile-loaded auth-key/auth-keyfile/base-url
    // would be lost across the switch without reapply. This mirrors the auto
    // path's profileAuthEphemerals cycle and is strictly-better than HEAD zed
    // (#2374 finding 5).
    const profileAuthEphemerals = snapshotProfileAuthEphemerals(config);
    switchError = await safeActivateProvider(intent.provider);
    if (
      switchError === undefined &&
      hasProfileAuthEphemerals(profileAuthEphemerals)
    ) {
      reapplyProfileAuthEphemerals(config, profileAuthEphemerals);
    }
  }
  const keyfileWarning = await applyRuntimeProviderOverrides(config);
  // Guard: skip model/param application when no provider is active (the
  // switch may have failed). setActiveModel/setActiveModelParam require an
  // active provider and would throw.
  if (resolveActiveProviderName(config) !== undefined) {
    await applyModelAndParams(config, intent);
  }
  // Re-read the manager's active-provider state AFTER the switch so the
  // provider-vs-oauth branch reflects the switch result. A configured provider
  // that was successfully switched must take the provider branch (#2374
  // finding 2). Mirrors HEAD zed's activateProviderFromConfig returning
  // hasActiveProvider reflecting the switch.
  const managerAfterSwitch = config.getProviderManager();
  const activeManager = resolveActiveManager(managerAfterSwitch);
  const infoMessages: string[] = [];
  if (keyfileWarning !== undefined) {
    infoMessages.push(keyfileWarning);
  }
  if (activeManager !== undefined) {
    await ensureProviderManagerOnConfig(config, activeManager);
    await config.refreshAuth('provider');
    attachProviderManagerToContentConfig(config, activeManager);
  } else {
    await config.refreshAuth('oauth');
  }
  const activeName = resolveActiveProviderName(config);
  return {
    authFailed: false,
    ...(activeName !== undefined ? { activeProvider: activeName } : {}),
    infoMessages,
    ...(switchError !== undefined ? { switchError } : {}),
  };
}

/**
 * Mirrors the Zed `applyRuntimeProviderOverrides`: auth-key → setProviderApiKey;
 * auth-keyfile → read file (resolve leading ~), setProviderApiKey + normalize
 * the ephemeral to the resolved path; base-url → setProviderBaseUrl.
 */
async function applyRuntimeProviderOverrides(
  config: Config,
): Promise<string | undefined> {
  const authKey = config.getEphemeralSetting('auth-key') as string | undefined;
  const authKeyfile = config.getEphemeralSetting('auth-keyfile') as
    | string
    | undefined;
  const baseUrl = config.getEphemeralSetting('base-url') as string | undefined;
  let keyfileWarning: string | undefined;

  if (authKey && authKey.trim() !== '') {
    await setProviderApiKey(authKey);
  } else if (authKeyfile) {
    try {
      const resolvedPath = authKeyfile.replace(/^~/, os.homedir());
      const keyFromFile = (await fs.readFile(resolvedPath, 'utf-8')).trim();
      if (keyFromFile) {
        await setProviderApiKey(keyFromFile);
        config.setEphemeralSetting('auth-keyfile', resolvedPath);
      }
    } catch (error) {
      // Best-effort: the auth-keyfile could not be read. Surface the error
      // via the result's infoMessages so callers can warn the user (the
      // executor does not own a logger to emit directly).
      keyfileWarning =
        error instanceof Error
          ? `Failed to load keyfile ${authKeyfile}: ${error.message}`
          : `Failed to load keyfile ${authKeyfile}: ${String(error)}`;
    }
  }

  if (baseUrl !== undefined) {
    await setProviderBaseUrl(baseUrl);
  }
  return keyfileWarning;
}

/**
 * Mirrors the Zed `ensureProviderManagerOnConfig`: configure runtime factories
 * on the config and set the config on the gemini serverToolsProvider when
 * present.
 */
async function ensureProviderManagerOnConfig(
  config: Config,
  manager: RuntimeProviderManager,
): Promise<void> {
  configureProviderRuntimeFactories(config, manager);
  const serverToolsProvider = manager.getServerToolsProvider();
  if (
    serverToolsProvider &&
    serverToolsProvider.name === 'gemini' &&
    'setConfig' in serverToolsProvider &&
    typeof serverToolsProvider.setConfig === 'function'
  ) {
    serverToolsProvider.setConfig(config);
  }
}

/**
 * Mirrors the Zed fallback's content-generator-config attachment: when the
 * content generator config exists and lacks a providerManager, attach the
 * active manager so provider-routed generation resolves.
 */
function attachProviderManagerToContentConfig(
  config: Config,
  manager: RuntimeProviderManager,
): void {
  const contentGenConfig = config.getContentGeneratorConfig();
  if (contentGenConfig && !contentGenConfig.providerManager) {
    contentGenConfig.providerManager = manager;
  }
}

// ─── authMode: 'auto' (CLI path) ────────────────────────────────────────────

/**
 * Reproduces the CLI's `activateConfiguredProvider`. The no-provider branch
 * switches to defaultProvider and swallows auth errors (NOT fatal). The
 * provider branch applies CLI overrides, switches (preserving profile auth
 * ephemerals), refreshes auth, and resolves model + params; any thrown error is
 * fatal (authFailed true).
 */
async function executeAuto(
  config: Config,
  intent: ProviderActivationIntent,
): Promise<ProviderActivationResult> {
  const configProvider = intent.provider ?? config.getProvider();
  if (configProvider === undefined) {
    return executeAutoNoProvider(config, intent);
  }
  return executeAutoProvider(config, intent, configProvider);
}

/**
 * No-provider branch: switch to the manager's active provider or the intent's
 * defaultProvider, refreshAuth(), swallow errors. NOT a fatal failure.
 */
async function executeAutoNoProvider(
  config: Config,
  intent: ProviderActivationIntent,
): Promise<ProviderActivationResult> {
  const manager = config.getProviderManager();
  const fallbackDefault =
    intent.defaultProvider ?? manager?.getActiveProviderName() ?? 'gemini';
  try {
    await switchActiveProvider(fallbackDefault);
    await config.refreshAuth();
  } catch {
    // Log but don't fail — auth will be triggered lazily on the first API call.
  }
  // Guard: if the fallback switch failed and no provider is active, skip
  // model/param application to avoid throwing from setActiveModelParam/
  // clearActiveModelParam (which require an active provider). Mirrors the
  // original CLI bootstrap which returned false without touching model params.
  if (resolveActiveProviderName(config) !== undefined) {
    await applyModelAndParams(config, intent);
  }
  const activeName = resolveActiveProviderName(config);
  return {
    authFailed: false,
    ...(activeName !== undefined ? { activeProvider: activeName } : {}),
    infoMessages: [],
  };
}

/**
 * Provider branch: apply CLI overrides BEFORE the switch, snapshot profile auth
 * ephemerals, switch (reapplying ephemerals) only when needed, refresh auth,
 * then resolve model + params. Any thrown error is fatal (authFailed true).
 */
async function executeAutoProvider(
  config: Config,
  intent: ProviderActivationIntent,
  provider: string,
): Promise<ProviderActivationResult> {
  try {
    const manager = config.getProviderManager();
    const alreadyActive = manager?.getActiveProviderName() === provider;
    if (isPureAlreadyActiveRefresh(intent, alreadyActive)) {
      await config.refreshAuth();
      const activeName = resolveActiveProviderName(config);
      return {
        authFailed: false,
        ...(activeName !== undefined ? { activeProvider: activeName } : {}),
        infoMessages: [],
      };
    }

    await applyCliArgumentOverrides(
      toArgvShape(intent),
      toBootstrapArgsShape(intent),
    );

    const profileAuthEphemerals = snapshotProfileAuthEphemerals(config);
    let infoMessages: readonly string[] = [];
    if (!alreadyActive) {
      const switchResult = await switchActiveProvider(provider, {
        skipModelDefaults: true,
        preserveEphemerals: [
          'auth-key',
          'auth-keyfile',
          'auth-key-name',
          'base-url',
        ],
      });
      infoMessages = switchResult.infoMessages;
      if (hasProfileAuthEphemerals(profileAuthEphemerals)) {
        reapplyProfileAuthEphemerals(config, profileAuthEphemerals);
      }
    }
    // Always refresh auth in the 'auto' path. The non-interactive flow runs
    // postConfigRuntime step 13 with authMode 'none' (which skips refreshAuth)
    // and step 14 (applyCliArgumentOverrides, which sets the key but does NOT
    // call refreshAuth) before fromConfig calls this executor with authMode
    // 'auto'. Skipping refreshAuth here would leave the provider with a key
    // set but auth uninitialized, causing all API calls to time out (#2374
    // E2E regression). refreshAuth is idempotent — it re-derives auth from the
    // current ephemeral settings — so calling it when the interactive path
    // already refreshed (via activateConfiguredProvider) is harmless.
    await config.refreshAuth();

    await applyModelAndParams(config, intent);
    const activeName = resolveActiveProviderName(config);
    return {
      authFailed: false,
      ...(activeName !== undefined ? { activeProvider: activeName } : {}),
      infoMessages,
    };
  } catch (error) {
    // The CLI maps a provider-case failure to FATAL_AUTHENTICATION_ERROR.
    // Carry the underlying error so fromConfig can include it in the thrown
    // AgentBootstrapError (#2374 finding 3).
    return { authFailed: true, infoMessages: [], authError: error };
  }
}

/**
 * Applies the intent's model + model params. Model resolution: intent model
 * override (trimmed, non-empty) wins, else config.getModel(), else provider
 * default; skipped when falsy or the placeholder. Model params: set every entry
 * of intent.modelParams, then clear pre-existing active params not present.
 */
async function applyModelAndParams(
  config: Config,
  intent: ProviderActivationIntent,
): Promise<void> {
  // When the intent declares no model and no model params, leave the active
  // provider's model/params untouched. This keeps authMode 'none' callers
  // (e.g. postConfigRuntime step 13) a pure provider switch.
  if (intent.model === undefined && intent.modelParams === undefined) {
    return;
  }
  const modelOverride =
    typeof intent.model === 'string' && intent.model.trim().length > 0
      ? intent.model.trim()
      : undefined;
  const activeProvider = config.getProviderManager()?.getActiveProvider();
  const resolvedModel =
    modelOverride ??
    resolveFallbackModel(config, activeProvider?.getDefaultModel?.());
  if (resolvedModel !== undefined) {
    await setActiveModel(resolvedModel);
  }

  // Only clear stale params when the caller explicitly provided modelParams.
  // Without this guard, a model-only activation (modelParams undefined) would
  // clear all existing params — wiping profile defaults (#2374 CodeRabbit).
  if (intent.modelParams !== undefined) {
    const desiredParams = intent.modelParams;
    const existingParams = getActiveModelParams();
    for (const [key, value] of Object.entries(desiredParams)) {
      setActiveModelParam(key, value);
    }
    for (const key of Object.keys(existingParams)) {
      if (!(key in desiredParams)) {
        clearActiveModelParam(key);
      }
    }
  }

  // Mirror the Zed integration's applyProfileModelParams: when an ephemeral
  // base-url is set (and not the literal 'none' opt-out), push it onto the
  // active provider instance so provider-routed generation honors it.
  applyEphemeralBaseUrlToProvider(config, activeProvider);
}

/**
 * Pushes the ephemeral base-url onto the active provider instance when present
 * and not the literal 'none' opt-out. Mirrors the Zed integration's
 * applyProfileModelParams base-url handling so the consolidated executor does
 * not regress Zed's provider-side base URL.
 */
function applyEphemeralBaseUrlToProvider(
  config: Config,
  activeProvider: ReturnType<RuntimeProviderManager['getActiveProvider']>,
): void {
  if (activeProvider === undefined) {
    return;
  }
  const ephemeralBaseUrl = config.getEphemeralSetting('base-url') as
    | string
    | undefined;
  if (
    ephemeralBaseUrl &&
    ephemeralBaseUrl !== 'none' &&
    'setBaseUrl' in activeProvider &&
    typeof (activeProvider as { setBaseUrl?: (url: string) => void })
      .setBaseUrl === 'function'
  ) {
    (activeProvider as { setBaseUrl: (url: string) => void }).setBaseUrl(
      ephemeralBaseUrl,
    );
  }
}

/**
 * Resolves the fallback model: config.getModel() unless it is empty or the
 * placeholder, then the provider default, then undefined.
 */
function resolveFallbackModel(
  config: Config,
  providerDefault: string | undefined,
): string | undefined {
  const configModel = config.getModel();
  if (configModel && configModel !== PLACEHOLDER_MODEL) {
    return configModel;
  }
  return providerDefault;
}

// ─── intent → CLI argument shape adapters ───────────────────────────────────

/**
 * Adapts the intent's cliOverrides into the `argv` shape the providers runtime
 * `applyCliArgumentOverrides` expects.
 */
function toArgvShape(intent: ProviderActivationIntent): {
  key?: string;
  keyfile?: string;
  baseurl?: string;
  set?: string[];
} {
  const o = intent.cliOverrides;
  if (o === undefined) {
    return {};
  }
  return {
    ...(o.key !== undefined ? { key: o.key } : {}),
    ...(o.keyfile !== undefined ? { keyfile: o.keyfile } : {}),
    ...(o.baseUrl !== undefined ? { baseurl: o.baseUrl } : {}),
    ...(o.set !== undefined ? { set: [...o.set] } : {}),
  };
}

/**
 * Adapts the intent's cliOverrides into the `bootstrapArgs` shape the providers
 * runtime `applyCliArgumentOverrides` expects (CLI bootstrap pre-parses these
 * separately from argv). The CLI's applyCliArgumentOverrides prefers
 * bootstrapArgs overrides over argv.
 */
function toBootstrapArgsShape(intent: ProviderActivationIntent): {
  keyOverride?: string | null;
  keyNameOverride?: string | null;
  keyfileOverride?: string | null;
  baseurlOverride?: string | null;
  setOverrides?: string[] | null;
} {
  const o = intent.cliOverrides;
  if (o === undefined) {
    return {};
  }
  return {
    ...(o.key !== undefined ? { keyOverride: o.key } : {}),
    ...(o.keyName !== undefined ? { keyNameOverride: o.keyName } : {}),
    ...(o.keyfile !== undefined ? { keyfileOverride: o.keyfile } : {}),
    ...(o.baseUrl !== undefined ? { baseurlOverride: o.baseUrl } : {}),
    ...(o.set !== undefined ? { setOverrides: [...o.set] } : {}),
  };
}

// ─── small helpers ──────────────────────────────────────────────────────────

/**
 * Returns the active provider name off the Config's manager (undefined when no
 * manager or no active provider).
 */
/**
 * Fast path for adopted CLI Configs whose provider is already active and whose
 * activation intent only asks for auth initialization. This mirrors main's
 * fromConfig behavior (`config.refreshAuth(undefined)`) exactly: no provider
 * switch, no CLI-override re-resolution, no model/param mutation. The E2E
 * non-interactive path relies on postConfigRuntime having already applied
 * provider/key/base-url state before fromConfig adopts the Config.
 */
function isPureAlreadyActiveRefresh(
  intent: ProviderActivationIntent,
  alreadyActive: boolean,
): boolean {
  return (
    alreadyActive &&
    intent.cliOverrides === undefined &&
    intent.model === undefined &&
    intent.modelParams === undefined
  );
}

function resolveActiveProviderName(config: Config): string | undefined {
  return config.getProviderManager()?.getActiveProviderName();
}

/**
 * Attempts a provider switch, capturing any error message. Returns the error
 * string when the switch failed, undefined on success. Used by the
 * provider-or-oauth and none branches where the switch is best-effort and the
 * caller (postConfigRuntime, autoAuthenticate) surfaces the failure via
 * result.switchError.
 */
async function safeActivateProvider(
  provider: string,
): Promise<string | undefined> {
  try {
    await switchActiveProvider(provider, {
      skipModelDefaults: true,
      preserveEphemerals: [
        'auth-key',
        'auth-keyfile',
        'auth-key-name',
        'base-url',
      ],
    });
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/**
 * Returns the manager when it has an active provider, otherwise undefined.
 * Centralizes the active-manager resolution so the provider-or-oauth branch
 * reads cleanly and satisfies the optional-chain lint rule.
 */
function resolveActiveManager(
  manager: ReturnType<Config['getProviderManager']>,
): NonNullable<ReturnType<Config['getProviderManager']>> | undefined {
  if (manager === undefined) {
    return undefined;
  }
  return manager.hasActiveProvider() ? manager : undefined;
}
