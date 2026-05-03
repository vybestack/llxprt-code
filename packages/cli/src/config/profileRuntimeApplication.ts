/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { DebugLogger, type Profile } from '@vybestack/llxprt-code-core';
import {
  applyProfileSnapshot,
  type ProfileLoadResult,
} from '../runtime/profileSnapshot.js';
import type { CliArgs } from './cliArgParser.js';
import type { BootstrapProfileArgs } from './profileBootstrap.js';

const logger = new DebugLogger('llxprt:config:profileRuntimeApplication');

export interface ProfileRuntimeApplicationInput {
  readonly loadedProfile: Profile | null;
  readonly profileToLoad: string | undefined;
  readonly bootstrapArgs: BootstrapProfileArgs;
  readonly argv: CliArgs;
  readonly finalModel: string;
  readonly finalProvider: string;
  readonly profileWarnings: readonly string[];
}

export interface ProfileSnapshotResult {
  readonly providerName: string;
  readonly modelName: string;
  readonly baseUrl: string | undefined;
  readonly warnings: readonly string[];
}

export interface ProfileRuntimeApplicationResult {
  readonly appliedResult: ProfileSnapshotResult | null;
  readonly resolvedProviderAfterProfile: string | undefined;
  readonly resolvedModelAfterProfile: string | undefined;
  readonly resolvedBaseUrlAfterProfile: string | undefined;
  readonly resolvedFinalProvider: string;
  readonly profileWarnings: readonly string[];
}

interface SnapshotLocalState {
  appliedResult: ProfileSnapshotResult | null;
  resolvedProviderAfterProfile: string | undefined;
  resolvedModelAfterProfile: string | undefined;
  resolvedBaseUrlAfterProfile: string | undefined;
}

/** Maps snapshot result fields and warnings into the shared local-state object. */
function collectSnapshotResult(
  snapshotResult: ProfileLoadResult,
  mutableWarnings: string[],
): SnapshotLocalState {
  if (snapshotResult.warnings.length > 0) {
    mutableWarnings.push(...snapshotResult.warnings);
  }
  return {
    appliedResult: {
      providerName: snapshotResult.providerName,
      modelName: snapshotResult.modelName,
      baseUrl: snapshotResult.baseUrl,
      warnings: snapshotResult.warnings,
    },
    resolvedProviderAfterProfile: snapshotResult.providerName,
    resolvedModelAfterProfile: snapshotResult.modelName,
    resolvedBaseUrlAfterProfile: snapshotResult.baseUrl,
  };
}

/**
 * Applies profile to the runtime via applyProfileSnapshot or creates a
 * synthetic profile for CLI auth args. This is the sole owner of
 * profile-to-runtime side effects.
 */
export async function applyProfileToRuntime(
  input: ProfileRuntimeApplicationInput,
): Promise<ProfileRuntimeApplicationResult> {
  const {
    loadedProfile,
    profileToLoad,
    bootstrapArgs,
    argv,
    finalModel,
    finalProvider,
    profileWarnings,
  } = input;

  const mutableWarnings = [...profileWarnings];
  let appliedResult: ProfileSnapshotResult | null = null;
  let resolvedProviderAfterProfile: string | undefined;
  let resolvedModelAfterProfile: string | undefined;
  let resolvedBaseUrlAfterProfile: string | undefined;
  let resolvedFinalProvider = finalProvider;

  logger.debug(
    () =>
      `[bootstrap] profileToLoad=${profileToLoad ?? 'none'} providerArg=${argv.provider ?? 'unset'} loadedProfile=${loadedProfile ? 'yes' : 'no'}`,
  );

  const hasAnyAuthOverride =
    Boolean(bootstrapArgs.keyOverride) ||
    Boolean(bootstrapArgs.keyfileOverride) ||
    Boolean(bootstrapArgs.keyNameOverride) ||
    Boolean(bootstrapArgs.baseurlOverride);

  if (argv.provider && hasAnyAuthOverride) {
    // CRITICAL FIX for #492: synthetic profile for CLI auth args
    logger.debug(
      () => '[bootstrap] Creating synthetic profile for CLI auth args',
    );
    const syntheticProfile: Profile = {
      version: 1,
      provider: argv.provider,
      model: argv.model ?? finalModel,
      modelParams: {},
      ephemeralSettings: {},
    };

    if (bootstrapArgs.keyOverride) {
      syntheticProfile.ephemeralSettings['auth-key'] =
        bootstrapArgs.keyOverride;
    }
    if (bootstrapArgs.keyfileOverride) {
      syntheticProfile.ephemeralSettings['auth-keyfile'] =
        bootstrapArgs.keyfileOverride;
    }
    if (bootstrapArgs.keyNameOverride) {
      syntheticProfile.ephemeralSettings['auth-key-name'] =
        bootstrapArgs.keyNameOverride;
    }
    if (bootstrapArgs.baseurlOverride) {
      syntheticProfile.ephemeralSettings['base-url'] =
        bootstrapArgs.baseurlOverride;
    }

    const snapshotResult = await applyProfileSnapshot(syntheticProfile, {
      profileName: 'cli-args',
    });

    ({
      appliedResult,
      resolvedProviderAfterProfile,
      resolvedModelAfterProfile,
      resolvedBaseUrlAfterProfile,
    } = collectSnapshotResult(snapshotResult, mutableWarnings));
    if (
      resolvedProviderAfterProfile &&
      resolvedProviderAfterProfile.trim() !== ''
    ) {
      resolvedFinalProvider = resolvedProviderAfterProfile;
    }
    logger.debug(
      () =>
        `[bootstrap] Applied CLI auth -> provider=${resolvedProviderAfterProfile}, model=${resolvedModelAfterProfile}, baseUrl=${resolvedBaseUrlAfterProfile ?? 'default'}`,
    );
  } else if (
    loadedProfile &&
    (profileToLoad ?? bootstrapArgs.profileJson) != null &&
    argv.provider === undefined
  ) {
    // @plan:PLAN-20251118-ISSUE533.P13 - Apply inline or file-based profile
    const snapshotResult = await applyProfileSnapshot(loadedProfile, {
      profileName: profileToLoad ?? 'inline-profile',
    });

    ({
      appliedResult,
      resolvedProviderAfterProfile,
      resolvedModelAfterProfile,
      resolvedBaseUrlAfterProfile,
    } = collectSnapshotResult(snapshotResult, mutableWarnings));
    // @plan:PLAN-20251211issue486b - Update finalProvider after applyProfile
    if (
      resolvedProviderAfterProfile &&
      resolvedProviderAfterProfile.trim() !== ''
    ) {
      resolvedFinalProvider = resolvedProviderAfterProfile;
    }
    logger.debug(
      () =>
        `[bootstrap] Applied profile '${profileToLoad ?? 'inline'}' -> provider=${resolvedProviderAfterProfile}, model=${resolvedModelAfterProfile}, baseUrl=${resolvedBaseUrlAfterProfile ?? 'default'}`,
    );
  } else if (profileToLoad && argv.provider !== undefined) {
    logger.debug(
      () =>
        `[bootstrap] Skipping profile application for '${profileToLoad}' because --provider was specified.`,
    );
  }

  return {
    appliedResult,
    resolvedProviderAfterProfile,
    resolvedModelAfterProfile,
    resolvedBaseUrlAfterProfile,
    resolvedFinalProvider,
    profileWarnings: mutableWarnings,
  };
}
