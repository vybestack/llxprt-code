/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-disable complexity, eslint-comments/disable-enable-pair -- Phase 5: legacy CLI boundary retained while larger decomposition continues. */

import { DebugLogger, type Profile } from '@vybestack/llxprt-code-core';
import { applyProfileSnapshot } from '../runtime/profileSnapshot.js';
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

/** Builds a synthetic Profile from CLI auth overrides (e.g. --key, --baseurl). */
function buildSyntheticProfile(
  argv: CliArgs,
  finalModel: string,
  bootstrapArgs: BootstrapProfileArgs,
): Profile {
  const syntheticProfile: Profile = {
    version: 1,
    provider: argv.provider!,
    model: argv.model ?? finalModel,
    modelParams: {},
    ephemeralSettings: {},
  };

  if (bootstrapArgs.keyOverride) {
    syntheticProfile.ephemeralSettings['auth-key'] = bootstrapArgs.keyOverride;
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

  return syntheticProfile;
}

/** Applies a profile snapshot and collects the result into a flat return. */
async function applyProfileSnapshotAndCollect(
  profile: Profile,
  profileName: string,
  mutableWarnings: string[],
  finalProvider: string,
): Promise<SnapshotLocalState & { resolvedFinalProvider: string }> {
  const snapshotResult = await applyProfileSnapshot(profile, {
    profileName,
  });
  if (snapshotResult.warnings.length > 0) {
    mutableWarnings.push(...snapshotResult.warnings);
  }
  const base: SnapshotLocalState = {
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
  const resolvedFinalProvider =
    base.resolvedProviderAfterProfile &&
    base.resolvedProviderAfterProfile.trim() !== ''
      ? base.resolvedProviderAfterProfile
      : finalProvider;
  return { ...base, resolvedFinalProvider };
}

/** Resolves the correct profile branch and applies it, returning full state. */
async function resolveAndApplyProfile(
  input: ProfileRuntimeApplicationInput,
  mutableWarnings: string[],
): Promise<SnapshotLocalState & { resolvedFinalProvider: string }> {
  const {
    loadedProfile,
    profileToLoad,
    bootstrapArgs,
    argv,
    finalModel,
    finalProvider,
  } = input;
  const hasAnyAuthOverride =
    Boolean(bootstrapArgs.keyOverride) ||
    Boolean(bootstrapArgs.keyfileOverride) ||
    Boolean(bootstrapArgs.keyNameOverride) ||
    Boolean(bootstrapArgs.baseurlOverride);

  if (argv.provider && hasAnyAuthOverride) {
    return applyProfileSnapshotAndCollect(
      buildSyntheticProfile(argv, finalModel, bootstrapArgs),
      'cli-args',
      mutableWarnings,
      finalProvider,
    );
  }

  if (
    loadedProfile &&
    (profileToLoad ?? bootstrapArgs.profileJson) != null &&
    argv.provider === undefined
  ) {
    return applyProfileSnapshotAndCollect(
      loadedProfile,
      profileToLoad ?? 'inline-profile',
      mutableWarnings,
      finalProvider,
    );
  }

  return {
    appliedResult: null,
    resolvedProviderAfterProfile: undefined,
    resolvedModelAfterProfile: undefined,
    resolvedBaseUrlAfterProfile: undefined,
    resolvedFinalProvider: finalProvider,
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
  const { profileWarnings } = input;
  const mutableWarnings = [...profileWarnings];

  logger.debug(
    () =>
      `[bootstrap] profileToLoad=${input.profileToLoad ?? 'none'} providerArg=${input.argv.provider ?? 'unset'} loadedProfile=${input.loadedProfile ? 'yes' : 'no'}`,
  );

  const result = await resolveAndApplyProfile(input, mutableWarnings);

  return {
    appliedResult: result.appliedResult,
    resolvedProviderAfterProfile: result.resolvedProviderAfterProfile,
    resolvedModelAfterProfile: result.resolvedModelAfterProfile,
    resolvedBaseUrlAfterProfile: result.resolvedBaseUrlAfterProfile,
    resolvedFinalProvider: result.resolvedFinalProvider,
    profileWarnings: mutableWarnings,
  };
}
