/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  ApprovalMode,
  DebugLogger,
  ProfileManager,
  type Config,
  type SettingsService,
} from '@vybestack/llxprt-code-core';
import { getCliRuntimeContext } from '../runtime/runtimeAccessors.js';
import { setCliRuntimeContext } from '../runtime/runtimeLifecycle.js';
import { switchActiveProvider } from '../runtime/providerSwitch.js';
import { applyCliSetArguments } from './cliEphemeralSettings.js';
import {
  READ_ONLY_TOOL_NAMES,
  EDIT_TOOL_NAME,
  normalizeToolNameForPolicy,
  buildNormalizedToolSet,
} from './toolGovernance.js';
import { applyProfileToRuntime } from './profileRuntimeApplication.js';
import {
  createBootstrapResult,
  type BootstrapRuntimeState,
  type BootstrapProfileArgs,
} from './profileBootstrap.js';
import type { CliArgs } from './cliArgParser.js';
import type { Settings } from './settings.js';
import type { ProfileLoadResult } from './profileResolution.js';
import type { ProviderModelResult } from './providerModelResolver.js';

const logger = new DebugLogger('llxprt:config:postConfigRuntime');

// ─── DTOs ───────────────────────────────────────────────────────────────────

export interface PostConfigInput {
  readonly config: Config;
  readonly runtimeState: BootstrapRuntimeState;
  readonly bootstrapArgs: BootstrapProfileArgs;
  readonly argv: CliArgs;
  readonly profileSettingsWithTools: Settings;
  readonly profileLoadResult: ProfileLoadResult;
  readonly providerModelResult: ProviderModelResult;
  readonly defaultDisabledTools: readonly string[];
  readonly runtimeOverrides: { settingsService?: SettingsService };
  readonly approvalMode: ApprovalMode;
  readonly interactive: boolean;
}

// ─── Narrowed per-function input types ───────────────────────────────────────

/** Fields consumed by setupRuntimeContext (steps 10-11). */
type SetupRuntimeContextInput = Pick<
  PostConfigInput,
  'config' | 'runtimeState' | 'profileSettingsWithTools' | 'runtimeOverrides'
>;

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

function getSettingsService(
  input: Pick<PostConfigInput, 'runtimeState' | 'runtimeOverrides'>,
): SettingsService {
  return (
    input.runtimeOverrides.settingsService ??
    input.runtimeState.runtime.settingsService
  );
}

/**
 * Step 10: Set CLI runtime context.
 * Step 11: Re-register provider infrastructure (conditional, dynamic import).
 * This is the SECOND call to registerCliProviderInfrastructure — the first
 * happened inside prepareRuntimeForProfile() (step 2).
 */
async function setupRuntimeContext(
  input: SetupRuntimeContextInput,
): Promise<void> {
  const { config, runtimeState } = input;
  const settingsService = getSettingsService(input);

  const bootstrapRuntimeId =
    runtimeState.runtime.runtimeId ?? 'cli.runtime.bootstrap';
  const baseBootstrapMetadata = {
    ...(runtimeState.runtime.metadata ?? {}),
    stage: 'post-config',
  };

  // Set disabled hooks from hooksConfig (post-migration target) with
  // hooks.disabled fallback for unmigrated settings
  const hooksConfig = input.profileSettingsWithTools.hooksConfig as
    | { disabled?: unknown }
    | undefined;
  const hooksLegacy = input.profileSettingsWithTools.hooks as
    | { disabled?: unknown }
    | undefined;
  const disabledHooks =
    (hooksConfig && 'disabled' in hooksConfig ? hooksConfig.disabled : null) ??
    (hooksLegacy && 'disabled' in hooksLegacy ? hooksLegacy.disabled : null);
  if (Array.isArray(disabledHooks)) {
    config.setDisabledHooks(disabledHooks as string[]);
  }

  const profileManager = new ProfileManager();
  setCliRuntimeContext(settingsService, config, {
    runtimeId: bootstrapRuntimeId,
    metadata: baseBootstrapMetadata,
    profileManager,
  });

  // Re-register provider infrastructure AFTER runtime context (step 11)
  const { registerCliProviderInfrastructure } = await import(
    '../runtime/runtimeSettings.js'
  );
  if (runtimeState.oauthManager) {
    registerCliProviderInfrastructure(
      runtimeState.providerManager,
      runtimeState.oauthManager,
      { messageBus: runtimeState.runtimeMessageBus },
    );
  }

  logger.debug(
    () => `[bootstrap] Runtime context set, runtimeId=${bootstrapRuntimeId}`,
  );
}

/**
 * Steps 12-13: Apply profile snapshot to runtime, then switch active provider.
 */
async function activateProviderAndProfile(
  input: PostConfigInput,
): Promise<string> {
  const { bootstrapArgs, argv, profileLoadResult, providerModelResult } = input;

  const profileApplicationResult = await applyProfileToRuntime({
    loadedProfile: profileLoadResult.loadedProfile,
    profileToLoad: profileLoadResult.profileToLoad ?? undefined,
    bootstrapArgs,
    argv,
    finalModel: providerModelResult.model,
    finalProvider: providerModelResult.provider,
    profileWarnings: [...profileLoadResult.profileWarnings],
  });

  const finalProvider = profileApplicationResult.resolvedFinalProvider;

  const runtimeContext = getCliRuntimeContext();
  const bootstrapResult = createBootstrapResult({
    runtime: runtimeContext,
    providerManager: input.runtimeState.providerManager,
    oauthManager: input.runtimeState.oauthManager,
    bootstrapArgs,
    profileApplication: {
      providerName:
        profileApplicationResult.resolvedProviderAfterProfile ?? finalProvider,
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

  try {
    await switchActiveProvider(finalProvider);
  } catch (error) {
    logger.warn(
      () =>
        `[bootstrap] Failed to switch active provider to ${finalProvider}: ${
          error instanceof Error ? error.message : String(error)
        }`,
    );
  }

  return finalProvider;
}

/**
 * Step 14: Reapply CLI model override + CLI arg overrides after provider switch.
 * switchActiveProvider clears ephemerals, so we reapply CLI args here.
 */
async function reapplyCliOverrides(
  input: ReapplyCliOverridesInput,
  finalProvider: string,
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
    settingsService.setProviderSetting(
      finalProvider,
      'model',
      cliModelOverride,
    );
    config.setModel(cliModelOverride);
    (config as Config & { _cliModelOverride?: string })._cliModelOverride =
      cliModelOverride;
    logger.debug(
      () =>
        `[bootstrap] Re-applied CLI model override '${cliModelOverride}' after provider activation`,
    );
  }

  if (
    bootstrapArgs &&
    (bootstrapArgs.keyOverride ||
      bootstrapArgs.keyfileOverride ||
      bootstrapArgs.baseurlOverride ||
      (bootstrapArgs.setOverrides && bootstrapArgs.setOverrides.length > 0))
  ) {
    const { applyCliArgumentOverrides } = await import(
      '../runtime/runtimeSettings.js'
    );
    await applyCliArgumentOverrides(
      {
        key: argv.key,
        keyfile: argv.keyfile,
        baseurl: argv.baseurl,
        set: argv.set,
      },
      bootstrapArgs,
    );
  }
}

/**
 * Step 15: Apply tool governance policy (ephemeral settings for allowed/excluded tools).
 */
function applyToolPolicies(input: ApplyToolPoliciesInput): void {
  const { config, argv, profileSettingsWithTools, approvalMode, interactive } =
    input;

  const explicitAllowedTools = buildNormalizedToolSet(
    argv.allowedTools && argv.allowedTools.length > 0
      ? argv.allowedTools
      : (profileSettingsWithTools.allowedTools ?? []),
  );

  const profileAllowedTools = buildNormalizedToolSet(
    config.getEphemeralSetting('tools.allowed'),
  );

  const applyPolicy = (allowedSet: Set<string> | undefined): void => {
    if (allowedSet === undefined) {
      config.setEphemeralSetting('tools.allowed', undefined);
    } else {
      config.setEphemeralSetting(
        'tools.allowed',
        Array.from(allowedSet).sort(),
      );
    }
  };

  const experimentalAcp = argv.experimentalAcp;

  if (!interactive && !experimentalAcp) {
    if (approvalMode === ApprovalMode.YOLO) {
      if (profileAllowedTools.size > 0 || explicitAllowedTools.size > 0) {
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

      const finalAllowed =
        profileAllowedTools.size > 0
          ? new Set(
              [...baseAllowed].filter((tool) => profileAllowedTools.has(tool)),
            )
          : baseAllowed;

      applyPolicy(finalAllowed);
    }
  } else if (profileAllowedTools.size > 0 || explicitAllowedTools.size > 0) {
    const finalAllowed = new Set(profileAllowedTools);
    explicitAllowedTools.forEach((tool) => finalAllowed.add(tool));
    applyPolicy(finalAllowed);
  }
}

/**
 * Step 16: Apply emojifilter, profile ephemeral settings, CLI /set args, disabled hooks.
 */
function applyEphemeralSettings(input: PostConfigInput): void {
  const {
    config,
    bootstrapArgs,
    argv,
    profileSettingsWithTools,
    profileLoadResult,
    runtimeOverrides,
  } = input;

  const settingsService = getSettingsService(input);
  if (!runtimeOverrides.settingsService) {
    logger.warn(
      '[cli-runtime] loadCliConfig called without runtime SettingsService override; using bootstrap-scoped instance (temporary compatibility path).',
    );
  }
  if (
    profileSettingsWithTools.emojifilter &&
    !settingsService.get('emojifilter')
  ) {
    settingsService.set('emojifilter', profileSettingsWithTools.emojifilter);
  }

  // Apply ephemeral settings from profile (--profile-load or --profile)
  // Skip ALL profile ephemeral settings if --provider was explicitly specified
  const profileToLoad = profileLoadResult.profileToLoad;
  if (
    (profileToLoad || bootstrapArgs.profileJson !== null) &&
    profileSettingsWithTools &&
    argv.provider === undefined
  ) {
    const ephemeralKeys = [
      'auth-key',
      'auth-keyfile',
      'context-limit',
      'compression-threshold',
      'base-url',
      'tool-format',
      'api-version',
      'custom-headers',
      'shell-replacement',
      'authOnly',
    ];

    for (const key of ephemeralKeys) {
      const value = (profileSettingsWithTools as Record<string, unknown>)[key];
      if (value !== undefined) {
        config.setEphemeralSetting(key, value);
      }
    }
  }

  // In non-interactive mode, tool governance is enforced from approval mode,
  // so /set must not override governance-managed keys after step 15.
  // Interactive mode retains /set control for tools.allowed/tools.disabled.
  const GOVERNANCE_KEYS = new Set([
    'tools.allowed',
    'tools.disabled',
    'disabled-tools',
  ]);
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

  const cliSetResult = applyCliSetArguments(config, setArgsForApplication);

  if (Object.keys(cliSetResult.modelParams).length > 0) {
    (
      config as Config & { _cliModelParams?: Record<string, unknown> }
    )._cliModelParams = cliSetResult.modelParams;
  }

  // Reapply tool governance if /set attempted to override governance keys
  if (hadGovernanceOverrides) {
    applyToolPolicies({
      config,
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
function finalizeMetadata(input: PostConfigInput): void {
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
      config.getEphemeralSetting('tools.disabled'),
    )
      ? (config.getEphemeralSetting('tools.disabled') as string[])
      : [];
    const currentAllowed = buildNormalizedToolSet(
      config.getEphemeralSetting('tools.allowed'),
    );
    const disabledSet = new Set(currentDisabled);
    for (const toolName of defaultDisabledTools) {
      if (!currentAllowed.has(normalizeToolNameForPolicy(toolName))) {
        disabledSet.add(toolName);
      }
    }
    config.setEphemeralSetting('tools.disabled', Array.from(disabledSet));
  }
}

// ─── Main orchestrator ────────────────────────────────────────────────────────

/**
 * Orchestrates all post-Config side effects in the correct order.
 *
 * Step 10: setCliRuntimeContext()
 * Step 11: registerCliProviderInfrastructure() — re-registration, conditional, dynamic import
 * Step 12: applyProfileToRuntime() — snapshot application
 * Step 13: switchActiveProvider()
 * Step 14: reapplyCliOverrides() — CLI args win after provider switch clears ephemerals
 * Step 15: applyToolGovernance() — tool policy (ephemeral settings for allowed/excluded tools)
 * Step 16: applyEphemeralSettings() — emojifilter, profile ephemerals, CLI /set args, disabled hooks
 * Step 17: finalizeMetadata() — seed default disabled tools, store model params, store bootstrap args, log warnings
 */
export async function finalizeConfig(input: PostConfigInput): Promise<Config> {
  // Step 10-11: Set runtime context + re-register provider infra
  await setupRuntimeContext(input);

  // Steps 12-13: Apply profile + switch provider
  const finalProvider = await activateProviderAndProfile(input);

  // Step 14: Reapply CLI overrides after provider switch
  await reapplyCliOverrides(input, finalProvider);

  // Step 15: Apply tool governance policy
  applyToolPolicies(input);

  // Step 16: Apply ephemeral settings
  applyEphemeralSettings(input);

  // Step 17: Finalize metadata
  finalizeMetadata(input);

  return input.config;
}
