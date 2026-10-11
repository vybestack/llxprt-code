/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  type WorkspaceTrustControlPort,
  SessionSettingsOwner,
  type WorkspaceMemoryOwner,
  type WorkspaceFilesystemOwner,
  ApprovalMode,
  STREAM_FIRST_RESPONSE_TIMEOUT_SETTING_KEY,
  STREAM_IDLE_TIMEOUT_SETTING_KEY,
  type Config,
} from '@vybestack/llxprt-code-core';

import { setOsKeyringDisabledBySetting } from '@vybestack/llxprt-code-storage';
import { DebugLogger } from '@vybestack/llxprt-code-telemetry';
import type {
  EphemeralSettings,
  SettingsService,
} from '@vybestack/llxprt-code-settings';
import { applyCliSetArguments } from '@vybestack/llxprt-code-providers/runtime/cliEphemeralSettings.js';
import type { ProviderManager } from '@vybestack/llxprt-code-providers';
import { ProviderFileLifecycle } from '@vybestack/llxprt-code-providers';
import {
  assembleProfileApplication,
  type AgentProfileApplication,
  assembleProviderSwitch,
  assembleAgentActivationBootstrap,
  type AgentActivationOperation,
} from '@vybestack/llxprt-code-agents';
import { createOAuthSettingsAdapter } from '../auth/oauth-settings-adapter.js';
import {
  READ_ONLY_TOOL_NAMES,
  EDIT_TOOL_NAME,
  normalizeToolNameForPolicy,
  buildNormalizedToolSet,
} from './toolGovernance.js';
import { applyProfileToRuntime } from './profileRuntimeApplication.js';
import {
  createBootstrapResult,
  resolveForegroundRuntimeId,
  type BootstrapRuntimeState,
  type BootstrapProfileArgs,
  type CliRuntimeOverrides,
} from './profileBootstrap.js';
import type { CliArgs } from './cliArgParser.js';
import type { Settings } from './settings.js';
import type { ProfileLoadResult } from './profileResolution.js';
import type { ProviderModelResult } from './providerModelResolver.js';

const logger = new DebugLogger('llxprt:config:postConfigRuntime');

// ─── DTOs ───────────────────────────────────────────────────────────────────

export interface PostConfigInput {
  readonly workspaceTrust: WorkspaceTrustControlPort;
  readonly trustCleanup?: () => Promise<void>;
  readonly filesystem: WorkspaceFilesystemOwner;
  readonly memory: WorkspaceMemoryOwner;
  readonly config: Config;
  readonly runtimeState: BootstrapRuntimeState;
  readonly bootstrapArgs: BootstrapProfileArgs;
  readonly argv: CliArgs;
  readonly settings: Settings;
  readonly profileSettingsWithTools: Settings & EphemeralSettings;
  readonly profileLoadResult: ProfileLoadResult;
  readonly providerModelResult: ProviderModelResult;
  readonly defaultDisabledTools: readonly string[];
  readonly runtimeOverrides: CliRuntimeOverrides;
  readonly approvalMode: ApprovalMode;
  readonly interactive: boolean;
}

// ─── Narrowed per-function input types ───────────────────────────────────────

/** Fields consumed by setupRuntimeContext (steps 10-11). */
type SetupRuntimeContextInput = Pick<
  PostConfigInput,
  | 'config'
  | 'runtimeState'
  | 'profileSettingsWithTools'
  | 'runtimeOverrides'
  | 'workspaceTrust'
> & { readonly sessionSettings: SessionSettingsOwner };

/** Fields consumed by reapplyCliOverrides (step 14). */
type ReapplyCliOverridesInput = Pick<
  PostConfigInput,
  'config' | 'runtimeState' | 'bootstrapArgs' | 'argv' | 'runtimeOverrides'
>;

/** Fields consumed by applyToolPolicies (step 15). */
type ApplyToolPoliciesInput = Pick<
  PostConfigInput,
  | 'config'
  | 'argv'
  | 'profileSettingsWithTools'
  | 'approvalMode'
  | 'interactive'
>;

// ─── Sub-functions ────────────────────────────────────────────────────────────

// ─── Stream timeout settings application ───────────────────────────────────

export type StreamTimeoutSettingsInput = Pick<
  Settings,
  'streamIdleTimeoutMs' | 'streamFirstResponseTimeoutMs'
>;

function applyStreamTimeoutSetting(
  config: Pick<SessionSettingsOwner, 'writeUserParameter'>,
  value: number | undefined,
  key: 'stream-idle-timeout-ms' | 'stream-first-response-timeout-ms',
): void {
  if (value !== undefined) {
    config.writeUserParameter(key, value);
  }
}

export function applyStreamIdleTimeoutSettings(
  config: Pick<SessionSettingsOwner, 'writeUserParameter'>,
  settings: StreamTimeoutSettingsInput,
): void {
  applyStreamTimeoutSetting(
    config,
    settings.streamIdleTimeoutMs,
    STREAM_IDLE_TIMEOUT_SETTING_KEY,
  );
}

export function applyStreamFirstResponseTimeoutSettings(
  config: Pick<SessionSettingsOwner, 'writeUserParameter'>,
  settings: StreamTimeoutSettingsInput,
): void {
  applyStreamTimeoutSetting(
    config,
    settings.streamFirstResponseTimeoutMs,
    STREAM_FIRST_RESPONSE_TIMEOUT_SETTING_KEY,
  );
}

interface ProfileEphemeralSettingsInput {
  readonly config: Pick<SessionSettingsOwner, 'writeUserParameter'>;
  readonly bootstrapArgs: Pick<BootstrapProfileArgs, 'profileJson'>;
  readonly argv: Pick<CliArgs, 'provider'>;
  readonly settings: StreamTimeoutSettingsInput;
  // profileSettingsWithTools carries both the public JSON settings and the
  // ephemeral tool-governance keys (e.g. 'tools.allowed') that
  // applyGlobalAndProfileEphemeralSettings forwards to applyToolPolicies.
  readonly profileSettingsWithTools: StreamTimeoutSettingsInput &
    EphemeralSettings;
  readonly profileLoadResult: Pick<ProfileLoadResult, 'profileToLoad'>;
}

export function applyGlobalAndProfileEphemeralSettings(
  input: ProfileEphemeralSettingsInput,
): void {
  const {
    config,
    bootstrapArgs,
    argv,
    settings,
    profileSettingsWithTools,
    profileLoadResult,
  } = input;

  // Global settings must apply even when --provider suppresses profile values.
  applyStreamIdleTimeoutSettings(config, settings);
  applyStreamFirstResponseTimeoutSettings(config, settings);

  const profileToLoad = profileLoadResult.profileToLoad;
  const shouldApplyProfileSettings =
    (profileToLoad !== undefined && profileToLoad !== '') ||
    bootstrapArgs.profileJson !== null;
  if (!shouldApplyProfileSettings || argv.provider !== undefined) {
    return;
  }

  const ephemeralKeys = [
    'stream-idle-timeout-ms',
    'stream-first-response-timeout-ms',
    'auth-key',
    'auth-keyfile',
    'context-limit',
    'compression-threshold',
    'base-url',
    'toolFormat',
    'api-version',
    'custom-headers',
    'socket-timeout',
    'shell-replacement',
    'authOnly',
  ];

  for (const key of ephemeralKeys) {
    const value = (profileSettingsWithTools as Record<string, unknown>)[key];
    if (value !== undefined) {
      config.writeUserParameter(key, value);
    }
  }
}

function getSettingsService(
  input: Pick<PostConfigInput, 'runtimeState' | 'runtimeOverrides'>,
): SettingsService {
  return (
    input.runtimeOverrides.settingsService ??
    (input.runtimeState.runtime.settingsService as SettingsService)
  );
}

/**
 * Reads a `disabled` flag from a hooks settings object, returning null when
 * the container is absent or does not define the property.
 */
function readDisabledFlag(
  container: { disabled?: unknown } | undefined,
): unknown {
  if (container && 'disabled' in container) {
    return container.disabled;
  }
  return null;
}

// Set disabled hooks from hooksConfig (post-migration target) with
// hooks.disabled fallback for unmigrated settings
function applyDisabledHooks(input: SetupRuntimeContextInput): void {
  const hooksConfig = input.profileSettingsWithTools.hooksConfig as
    | { disabled?: unknown }
    | undefined;
  const hooksLegacy = input.profileSettingsWithTools.hooks as
    | { disabled?: unknown }
    | undefined;
  const disabledHooks =
    readDisabledFlag(hooksConfig) ?? readDisabledFlag(hooksLegacy);
  if (Array.isArray(disabledHooks)) {
    input.config.setDisabledHooks(disabledHooks as string[]);
  }
}

/** Recompose the pre-Config runtime on the exact Config's policy bus. */
async function setupRuntimeContext(
  input: SetupRuntimeContextInput,
): Promise<void> {
  const { config, runtimeState } = input;
  const settingsService = getSettingsService(input);
  const bootstrapRuntimeId =
    runtimeState.runtime.runtimeId ?? resolveForegroundRuntimeId();
  const baseBootstrapMetadata = {
    ...(runtimeState.runtime.metadata ?? {}),
    stage: 'post-config',
  };
  applyDisabledHooks(input);

  // The early profile runtime has no Config, so its bus cannot carry the
  // resolved policy. Recompose once Config exists and adopt that final runtime.
  const { assembleCliProviderRuntime } = await import(
    '@vybestack/llxprt-code-providers/runtime/assembleCliProviderRuntime.js'
  );
  const providerContributions = input.runtimeOverrides.providerContributions;
  const finalRuntime = assembleCliProviderRuntime({
    trustPort: input.workspaceTrust,
    settingsService,
    config,
    settingsOwner: input.sessionSettings,
    runtimeId: bootstrapRuntimeId,
    metadata: baseBootstrapMetadata,
    oauthSettings: createOAuthSettingsAdapter(),
    ...(runtimeState.registration && {
      registration: runtimeState.registration,
      oauthManager: runtimeState.oauthManager,
    }),
    ...(providerContributions !== undefined ? { providerContributions } : {}),
  });
  runtimeState.runtime = finalRuntime.runtime;
  runtimeState.providerManager =
    finalRuntime.providerManager as ProviderManager;
  runtimeState.oauthManager = finalRuntime.oauthManager;
  runtimeState.runtimeMessageBus = finalRuntime.runtimeMessageBus;
  await runtimeState.policyOwner?.dispose();
  runtimeState.policyOwner = finalRuntime.policyOwner;
  if (finalRuntime.policyOwner)
    input.runtimeOverrides.onPolicyOwnerReady?.(finalRuntime.policyOwner);
  input.runtimeOverrides.onProviderManagerReady?.(finalRuntime.providerManager);
  input.runtimeOverrides.onOAuthManagerReady?.(finalRuntime.oauthManager);
  input.runtimeOverrides.onProviderFilesReady?.(
    finalRuntime.registration.providerFileLifecycle,
  );

  logger.debug(
    () => `[bootstrap] Runtime context set, runtimeId=${bootstrapRuntimeId}`,
  );
}

/**
 * Steps 12-13: Apply profile snapshot to runtime, then switch active provider.
 */
async function activateProviderAndProfile(
  input: PostConfigInput,
  profileApplication: AgentProfileApplication,
  activationOperation: AgentActivationOperation,
): Promise<string | undefined> {
  const { bootstrapArgs, argv, profileLoadResult, providerModelResult } = input;

  const profileApplicationResult = await applyProfileToRuntime(
    {
      loadedProfile: profileLoadResult.loadedProfile,
      profileToLoad: profileLoadResult.profileToLoad ?? undefined,
      bootstrapArgs,
      argv,
      finalModel: providerModelResult.model,
      finalProvider: providerModelResult.provider,
      profileWarnings: [...profileLoadResult.profileWarnings],
    },
    profileApplication,
  );

  const finalProvider = profileApplicationResult.resolvedFinalProvider;

  const runtimeContext = input.runtimeState.runtime;
  const bootstrapResult = createBootstrapResult({
    runtime: runtimeContext,
    providerManager: input.runtimeState.providerManager,
    oauthManager: input.runtimeState.oauthManager,
    bootstrapArgs,
    profileApplication: {
      providerName:
        profileApplicationResult.resolvedProviderAfterProfile ??
        finalProvider ??
        null,
      modelName:
        profileApplicationResult.resolvedModelAfterProfile ??
        providerModelResult.model,
      ...(profileApplicationResult.resolvedBaseUrlAfterProfile
        ? { baseUrl: profileApplicationResult.resolvedBaseUrlAfterProfile }
        : {}),
      warnings: [...profileApplicationResult.profileWarnings],
    },
  });

  // Store bootstrap args on config
  (
    input.config as Config & { _bootstrapArgs?: BootstrapProfileArgs }
  )._bootstrapArgs = bootstrapArgs;

  if (bootstrapResult.profile.warnings.length > 0) {
    for (const warning of bootstrapResult.profile.warnings) {
      logger.warn(() => `[bootstrap] ${warning}`);
    }
  }

  if (
    finalProvider !== undefined &&
    !profileApplicationResult.appliedFromLoadedProfile
  ) {
    await activateUnprofiledProvider(finalProvider, activationOperation);
  }

  return finalProvider;
}

/**
 * Returns true when any provider key/keyfile/base-url/set override was passed
 * on the CLI and therefore needs to be reapplied after a provider switch.
 */
function isNonEmptyString(value: string | null): boolean {
  return value !== null && value.length > 0;
}

function hasCliArgumentOverrides(args: BootstrapProfileArgs): boolean {
  const hasSetOverrides =
    args.setOverrides !== null && args.setOverrides.length > 0;
  return (
    isNonEmptyString(args.keyOverride) ||
    isNonEmptyString(args.keyfileOverride) ||
    isNonEmptyString(args.baseurlOverride) ||
    hasSetOverrides
  );
}

/**
 * Step 14: Reapply CLI model override + CLI arg overrides after provider switch.
 * The provider switch clears ephemerals, so we reapply CLI args here.
 */
async function reapplyCliOverrides(
  input: ReapplyCliOverridesInput & {
    readonly sessionSettings: SessionSettingsOwner;
  },
  finalProvider: string | undefined,
): Promise<void> {
  const { config, bootstrapArgs, argv } = input;
  const settingsService = getSettingsService(input);

  const cliModelOverride = (() => {
    if (typeof argv.model === 'string') {
      const trimmed = argv.model.trim();
      if (trimmed.length > 0) return trimmed;
    }
    if (typeof bootstrapArgs.modelOverride === 'string') {
      const trimmed = bootstrapArgs.modelOverride.trim();
      if (trimmed.length > 0) return trimmed;
    }
    return undefined;
  })();

  if (cliModelOverride) {
    if (finalProvider !== undefined) {
      settingsService.setProviderSetting(
        finalProvider,
        'model',
        cliModelOverride,
      );
      input.sessionSettings.chooseModel(cliModelOverride);
    }
    (config as Config & { _cliModelOverride?: string })._cliModelOverride =
      cliModelOverride;
    logger.debug(
      () =>
        `[bootstrap] Re-applied CLI model override '${cliModelOverride}' after provider activation`,
    );
  }

  if (hasCliArgumentOverrides(bootstrapArgs)) {
    const { applyCliArgumentOverrides } = await import(
      '@vybestack/llxprt-code-providers/runtime/settingsResolver.js'
    );
    await applyCliArgumentOverrides(
      {
        key: argv.key,
        keyfile: argv.keyfile,
        baseurl: argv.baseurl,
        set: argv.set,
      },
      bootstrapArgs,
      {
        setEphemeralSetting: (key, value) =>
          input.sessionSettings.writeUserParameter(key, value),
      },
      settingsService,
      input.runtimeState.providerManager.getActiveProvider(),
    );
  }
}

/**
 * Step 15: Apply tool governance policy (ephemeral settings for allowed/excluded tools).
 */
function applyToolPolicies(
  input: ApplyToolPoliciesInput & {
    readonly sessionSettings: SessionSettingsOwner;
  },
): void {
  const { argv, profileSettingsWithTools, approvalMode, interactive } = input;

  const explicitAllowedTools = buildNormalizedToolSet(
    argv.allowedTools && argv.allowedTools.length > 0
      ? argv.allowedTools
      : (profileSettingsWithTools.allowedTools ?? []),
  );

  const rawProfileAllowedTools = profileSettingsWithTools['tools.allowed'];
  const profileAllowedExplicit = Array.isArray(rawProfileAllowedTools);
  const profileAllowedTools = buildNormalizedToolSet(rawProfileAllowedTools);

  const applyPolicy = (allowedSet: Set<string> | undefined): void => {
    if (allowedSet === undefined) {
      input.sessionSettings.writeUserParameter('tools.allowed', undefined);
    } else {
      input.sessionSettings.writeUserParameter(
        'tools.allowed',
        Array.from(allowedSet).sort(),
      );
    }
  };

  const experimentalAcp = argv.experimentalAcp;

  if (interactive !== true && experimentalAcp !== true) {
    if (approvalMode === ApprovalMode.YOLO) {
      if (profileAllowedExplicit || explicitAllowedTools.size > 0) {
        const finalAllowed = new Set(profileAllowedTools);
        explicitAllowedTools.forEach((tool) => finalAllowed.add(tool));
        applyPolicy(finalAllowed);
      } else {
        applyPolicy(undefined);
      }
    } else {
      const baseAllowed = new Set<string>(
        READ_ONLY_TOOL_NAMES.map(normalizeToolNameForPolicy),
      );
      explicitAllowedTools.forEach((tool) => baseAllowed.add(tool));
      if (approvalMode === ApprovalMode.AUTO_EDIT) {
        baseAllowed.add(EDIT_TOOL_NAME);
      }

      const finalAllowed = profileAllowedExplicit
        ? new Set(
            [...baseAllowed].filter((tool) => profileAllowedTools.has(tool)),
          )
        : baseAllowed;

      applyPolicy(finalAllowed);
    }
  } else if (profileAllowedExplicit || explicitAllowedTools.size > 0) {
    const finalAllowed = new Set(profileAllowedTools);
    explicitAllowedTools.forEach((tool) => finalAllowed.add(tool));
    applyPolicy(finalAllowed);
  }
}

/**
 * Step 16: Apply emojifilter, profile ephemeral settings, CLI /set args, disabled hooks.
 */
function applyEphemeralSettings(
  input: PostConfigInput & { readonly sessionSettings: SessionSettingsOwner },
): void {
  const { config, argv, profileSettingsWithTools, runtimeOverrides } = input;

  const settingsService = getSettingsService(input);
  if (!runtimeOverrides.settingsService) {
    logger.warn(
      '[cli-runtime] loadCliConfig called without runtime SettingsService override; using bootstrap-scoped instance (temporary compatibility path).',
    );
  }
  if (
    profileSettingsWithTools.emojifilter !== undefined &&
    settingsService.get('emojifilter') === undefined
  ) {
    settingsService.set('emojifilter', profileSettingsWithTools.emojifilter);
  }

  // Apply stream idle timeout from settings.json and profile ephemerals.
  // Global stream idle timeout settings are always applied; profile-specific
  // ephemeral settings are skipped if --provider was explicitly specified.
  applyGlobalAndProfileEphemeralSettings({
    ...input,
    config: input.sessionSettings,
  });

  // In non-interactive mode, tool governance is enforced from approval mode,
  // so /set must not override governance-managed keys after step 15.
  // Interactive mode retains /set control for tools.allowed/tools.disabled.
  const GOVERNANCE_KEYS = new Set(['tools.allowed', 'tools.disabled']);
  const rawSetArgs = argv.set ?? [];
  const enforceGovernanceSetProtection = !input.interactive;
  const setArgsForApplication = enforceGovernanceSetProtection
    ? rawSetArgs.filter((entry) => {
        const eqIdx = entry.indexOf('=');
        if (eqIdx === -1) return true; // malformed entry — let applyCliSetArguments handle/reject it
        const key = entry.slice(0, eqIdx).trim();
        return !GOVERNANCE_KEYS.has(key);
      })
    : rawSetArgs;
  const hadGovernanceOverrides =
    enforceGovernanceSetProtection &&
    setArgsForApplication.length < rawSetArgs.length;

  const cliSetResult = applyCliSetArguments(
    {
      setEphemeralSetting: (key, value) =>
        input.sessionSettings.writeUserParameter(key, value),
    },
    setArgsForApplication,
  );

  if (Object.keys(cliSetResult.modelParams).length > 0) {
    (
      config as Config & { _cliModelParams?: Record<string, unknown> }
    )._cliModelParams = cliSetResult.modelParams;
  }

  // Reapply tool governance if /set attempted to override governance keys
  if (hadGovernanceOverrides) {
    applyToolPolicies({
      config,
      sessionSettings: input.sessionSettings,
      argv,
      profileSettingsWithTools,
      approvalMode: input.approvalMode,
      interactive: input.interactive,
    });
  }
}

/**
 * Step 17: Seed default disabled tools, store profile model params, store bootstrap args, log warnings.
 */
function finalizeMetadata(
  input: PostConfigInput & { readonly sessionSettings: SessionSettingsOwner },
): void {
  const { config, profileLoadResult, defaultDisabledTools } = input;

  // Store profile model params on config
  if (profileLoadResult.profileModelParams) {
    (
      config as Config & { _profileModelParams?: Record<string, unknown> }
    )._profileModelParams = profileLoadResult.profileModelParams;
  }

  // Seed tools.disabled with defaultDisabledTools from settings
  if (Array.isArray(defaultDisabledTools) && defaultDisabledTools.length > 0) {
    const currentDisabled = Array.isArray(
      input.sessionSettings.readNamedParameter('tools.disabled'),
    )
      ? (input.sessionSettings.readNamedParameter('tools.disabled') as string[])
      : [];
    const currentAllowed = buildNormalizedToolSet(
      input.sessionSettings.readNamedParameter('tools.allowed'),
    );
    const disabledSet = new Set(currentDisabled);
    for (const toolName of defaultDisabledTools) {
      if (!currentAllowed.has(normalizeToolNameForPolicy(toolName))) {
        disabledSet.add(toolName);
      }
    }
    input.sessionSettings.writeUserParameter(
      'tools.disabled',
      Array.from(disabledSet),
    );
  }
}

// ─── Main orchestrator ────────────────────────────────────────────────────────

/**
 * Orchestrates all post-Config side effects in the correct order.
 *
 * Steps 10-11: recompose the bootstrap handle with the exact Config and policy bus
 * Step 12: applyProfileToRuntime() — snapshot application
 * Step 13: activationOperation.preflight() — declarative provider switch (authMode 'none'; auth happens later)
 * Step 14: reapplyCliOverrides() — CLI args win after provider switch clears ephemerals
 * Step 15: applyToolGovernance() — tool policy (ephemeral settings for allowed/excluded tools)
 * Step 16: applyEphemeralSettings() — emojifilter, profile ephemerals, CLI /set args, disabled hooks
 * Step 17: finalizeMetadata() — seed default disabled tools, store model params, store bootstrap args, log warnings
 */
export async function finalizeConfig(
  original: PostConfigInput,
): Promise<Config> {
  const sessionSettings =
    original.runtimeOverrides.sessionSettingsOwner ??
    new SessionSettingsOwner(getSettingsService(original));
  const input = { ...original, sessionSettings };
  // Propagate security.disableOsKeyring into the storage package's process-wide
  // opt-out (issue #2928 R3.2) BEFORE any profile/auth application. Profile
  // auth wiring (applyProfileToRuntime → createProviderKeyStorage().getKey())
  // performs a real SecureStore read during steps 12-13 below, so this MUST run
  // first to suppress the OS keyring before that first read — otherwise a user
  // who sets security.disableOsKeyring still gets a Keychain prompt at startup.
  // The env var LLXPRT_DISABLE_OS_KEYRING=1 is independent and read directly in
  // storage, so it keeps working with zero CLI involvement.
  setOsKeyringDisabledBySetting(
    input.profileSettingsWithTools.security?.disableOsKeyring === true,
  );

  // Step 10-11: Set runtime context + re-register provider infra
  await setupRuntimeContext(input);

  // Steps 12-13: Apply profile + switch provider
  const activationOperation = assembleAgentActivationBootstrap(
    input.config,
    getSettingsService(input),
    input.runtimeState.providerManager,
    input.runtimeState.oauthManager ?? null,
    () => input.runtimeState.runtime.runtimeKind,
    undefined,
    undefined,
    input.filesystem,
    input.memory,
    sessionSettings,
    original.runtimeOverrides.sessionSettingsOwner === undefined
      ? 'transferred'
      : 'borrowed',
    input.workspaceTrust,
    input.trustCleanup,
    undefined,
    undefined,
    requireSelectedProviderFiles(
      input.runtimeState.runtime.providerFileLifecycle,
    ),
    input.runtimeState.runtimeMessageBus,
    // The CLI builds this memory solely for the activation (alongside the
    // filesystem and trust it hands over), so the activation owns its release.
    'transferred',
  );
  const switchProvider = assembleProviderSwitch(
    input.config,
    getSettingsService(input),
    input.runtimeState.providerManager,
    input.runtimeState.oauthManager ?? null,
    () => input.runtimeState.runtime.runtimeKind,
    () => activationOperation.sessionClient.refreshAuth(),
    sessionSettings,
  );
  const profileApplication = assembleProfileApplication(
    input.config,
    getSettingsService(input),
    input.runtimeState.providerManager,
    input.runtimeState.oauthManager ?? null,
    switchProvider,
    sessionSettings,
    activationOperation.workspaceDefinitions.profileReads,
  );
  let transferred = false;
  try {
    input.runtimeOverrides.onProviderSwitchReady?.(switchProvider);
    input.runtimeOverrides.onProfileApplicationReady?.(profileApplication);
    const finalProvider = await activateProviderAndProfile(
      input,
      profileApplication,
      activationOperation,
    );

    // Step 14: Reapply CLI overrides after provider switch
    await reapplyCliOverrides(input, finalProvider);

    // Step 15: Apply tool governance policy
    applyToolPolicies(input);

    // Step 16: Apply ephemeral settings
    applyEphemeralSettings(input);

    // Step 17: Finalize metadata
    finalizeMetadata(input);

    if (input.runtimeOverrides.onActivationBootstrapReady !== undefined) {
      input.runtimeOverrides.onActivationBootstrapReady(activationOperation);
      transferred = true;
    }
    return input.config;
  } finally {
    if (!transferred) await activationOperation.dispose();
  }
}

async function activateUnprofiledProvider(
  finalProvider: string,
  activationOperation: AgentActivationOperation,
): Promise<void> {
  try {
    // The preflight's authMode 'none' path swallows the provider-switch error
    // internally (safeActivateProvider does not throw) and surfaces it via
    // result.switchError. The surrounding try/catch remains necessary because
    // the 'none' path also calls applyRuntimeProviderOverrides (file I/O for
    // auth-keyfile resolution) and applyModelAndParams, which can still throw.
    // The CLI routes this declarative provider switch through the public
    // agent-bootstrap preflight (#2378) rather than the runtime activation
    // primitive directly.
    const activationResult = await activationOperation.preflight({
      provider: finalProvider,
      authMode: 'none',
    });
    if (activationResult.switchError !== undefined) {
      logger.warn(
        () =>
          `[bootstrap] Failed to switch active provider to ${finalProvider}: ${activationResult.switchError}`,
      );
    }
  } catch (error) {
    logger.warn(
      () =>
        `[bootstrap] Failed to switch active provider to ${finalProvider}: ${
          error instanceof Error ? error.message : String(error)
        }`,
    );
  }
}

function requireSelectedProviderFiles(
  value: object | undefined,
): ProviderFileLifecycle {
  if (!(value instanceof ProviderFileLifecycle))
    throw new Error(
      'CLI preflight requires the explicitly assembled provider file owner',
    );
  return value;
}
