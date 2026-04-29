/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import process from 'node:process';
import {
  ProfileManager,
  DebugLogger,
  debugLogger,
  type Profile,
} from '@vybestack/llxprt-code-core';
import type { Settings } from './settings.js';
import type { CliArgs } from './cliArgParser.js';
import type { BootstrapProfileArgs } from './profileBootstrap.js';

const logger = new DebugLogger('llxprt:config:profileResolution');

// ─── DTOs ───────────────────────────────────────────────────────────────────

export interface ProfilePreparationResult {
  readonly profileProvider: string | undefined;
  readonly profileModel: string | undefined;
  readonly profileModelParams: Record<string, unknown> | undefined;
  readonly profileBaseUrl: string | undefined;
  readonly profileMergedSettings: Settings;
}

export interface ProfileResolutionInput {
  readonly bootstrapArgs: {
    profileName: string | null;
    profileJson: string | null;
  };
  readonly settings: Settings;
  readonly cliProvider: string | undefined;
}

export interface ProfileResolutionResult {
  readonly profileToLoad: string | undefined;
  readonly profileExplicitlySpecified: boolean;
}

export interface ProfileLoadResult {
  readonly profileMergedSettings: Settings;
  readonly profileModel: string | undefined;
  readonly profileProvider: string | undefined;
  readonly profileModelParams: Record<string, unknown> | undefined;
  readonly profileBaseUrl: string | undefined;
  readonly loadedProfile: Profile | null;
  readonly profileWarnings: readonly string[];
  readonly profileToLoad: string | undefined;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function normaliseProfileName(
  value: string | null | undefined,
): string | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function getOptionalEphemeralSettings(
  profile: Profile,
): Profile['ephemeralSettings'] | undefined {
  return (profile as { ephemeralSettings?: Profile['ephemeralSettings'] })
    .ephemeralSettings;
}

/**
 * Extracts profile values from a loaded Profile object, respecting --provider override.
 */
export function prepareProfileForApplication(
  profile: Profile,
  profileSource: string,
  argv: Pick<CliArgs, 'provider'>,
  baseSettings: Settings,
): ProfilePreparationResult {
  // When --provider overrides, ignore profile's provider/model selection
  // but preserve profileModelParams — they apply regardless of provider source
  const profileProvider =
    argv.provider !== undefined ? undefined : profile.provider;
  const profileModel = argv.provider !== undefined ? undefined : profile.model;
  const profileModelParams = profile.modelParams;
  const ephemeralSettings = getOptionalEphemeralSettings(profile);
  const profileBaseUrl =
    typeof ephemeralSettings?.['base-url'] === 'string'
      ? ephemeralSettings['base-url']
      : undefined;

  const loadSummary = `Loaded ${profileSource === 'inline' ? 'inline profile from --profile' : `profile ${profileSource}`}: provider=${profile.provider}, model=${profile.model}, hasEphemeralSettings=${!!ephemeralSettings}`;
  logger.debug(() => loadSummary);

  let profileMergedSettings = baseSettings;
  if (argv.provider === undefined && ephemeralSettings) {
    profileMergedSettings = {
      ...baseSettings,
      ...ephemeralSettings,
    } as Settings;
    logger.debug(
      () =>
        `Merged ephemeral settings from ${profileSource === 'inline' ? 'inline profile' : `profile '${profileSource}'`}`,
    );
  } else if (argv.provider !== undefined) {
    logger.debug(
      () =>
        `Skipping profile ephemeral settings because --provider was explicitly specified`,
    );
  }

  return {
    profileProvider,
    profileModel,
    profileModelParams,
    profileBaseUrl,
    profileMergedSettings,
  };
}

/**
 * Resolves which profile name to load (if any) from bootstrap args, env vars,
 * or default profile settings.
 */
export function resolveProfileToLoad(
  input: ProfileResolutionInput,
): ProfileResolutionResult {
  const { bootstrapArgs, settings, cliProvider } = input;

  // When an inline profile (--profile) is provided, skip all file-based profiles
  if (bootstrapArgs.profileJson != null) {
    return { profileToLoad: undefined, profileExplicitlySpecified: false };
  }

  const profileToLoad =
    normaliseProfileName(bootstrapArgs.profileName) ??
    normaliseProfileName(process.env.LLXPRT_PROFILE) ??
    (cliProvider === undefined
      ? normaliseProfileName(
          typeof settings.defaultProfile === 'string'
            ? settings.defaultProfile
            : undefined,
        )
      : undefined);

  const profileExplicitlySpecified =
    bootstrapArgs.profileName != null &&
    normaliseProfileName(bootstrapArgs.profileName) != null;

  return { profileToLoad, profileExplicitlySpecified };
}

// ─── Sub-functions ────────────────────────────────────────────────────────────

function applyInlineProfile(
  profileJson: string,
  argv: CliArgs,
  settings: Settings,
): Omit<ProfileLoadResult, 'profileToLoad' | 'profileWarnings'> {
  const profile = JSON.parse(profileJson) as Profile;
  const prepared = prepareProfileForApplication(
    profile,
    'inline',
    argv,
    settings,
  );
  return {
    profileMergedSettings: prepared.profileMergedSettings,
    profileModel: prepared.profileModel,
    profileProvider: prepared.profileProvider,
    profileModelParams: prepared.profileModelParams,
    profileBaseUrl: prepared.profileBaseUrl,
    loadedProfile: profile,
  };
}

async function applyFileProfile(
  profileToLoad: string,
  profileExplicitlySpecified: boolean,
  argv: CliArgs,
  settings: Settings,
  profileWarnings: string[],
): Promise<Omit<
  ProfileLoadResult,
  'profileToLoad' | 'profileWarnings'
> | null> {
  try {
    const profileManager = new ProfileManager();
    const profile = await profileManager.loadProfile(profileToLoad);
    const prepared = prepareProfileForApplication(
      profile,
      profileToLoad,
      argv,
      settings,
    );

    const tempDebugMode =
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- intentional falsy coalescing: boolean flag should fall through when false
      argv.debug ||
      [process.env.DEBUG, process.env.DEBUG_MODE].some(
        (v) => v === 'true' || v === '1',
      ) ||
      false;

    if (tempDebugMode) {
      debugLogger.debug(
        `Loaded profile '${profileToLoad}': provider=${profile.provider}, model=${profile.model}`,
      );
      if (prepared.profileProvider && prepared.profileModel) {
        debugLogger.debug(
          `Applied profile '${profileToLoad}' with provider: ${prepared.profileProvider}, model: ${prepared.profileModel}`,
        );
      }
    }

    return {
      profileMergedSettings: prepared.profileMergedSettings,
      profileModel: prepared.profileModel,
      profileProvider: prepared.profileProvider,
      profileModelParams: prepared.profileModelParams,
      profileBaseUrl: prepared.profileBaseUrl,
      loadedProfile: profile,
    };
  } catch (error) {
    const failureSummary = `Failed to load profile '${profileToLoad}': ${error instanceof Error ? error.message : String(error)}`;
    logger.error(() => {
      if (error instanceof Error && error.stack) {
        return `${failureSummary}\n${error.stack}`;
      }
      return failureSummary;
    });
    debugLogger.error(failureSummary);

    if (profileExplicitlySpecified) {
      throw error;
    }

    profileWarnings.push(failureSummary);
    return null;
  }
}

/**
 * Loads and prepares a profile from the given resolution inputs.
 * Handles both inline (--profile) and file-based (--profile-load) profiles.
 */
export async function loadAndPrepareProfile(input: {
  bootstrapArgs: BootstrapProfileArgs;
  settings: Settings;
  argv: CliArgs;
  profileToLoad: string | undefined;
  profileExplicitlySpecified: boolean;
}): Promise<ProfileLoadResult> {
  const {
    bootstrapArgs,
    settings,
    argv,
    profileToLoad,
    profileExplicitlySpecified,
  } = input;

  let profileMergedSettings = settings;
  let profileModel: string | undefined;
  let profileProvider: string | undefined;
  let profileModelParams: Record<string, unknown> | undefined;
  let profileBaseUrl: string | undefined;
  let loadedProfile: Profile | null = null;
  const profileWarnings: string[] = [];

  // Handle inline profile from --profile flag
  if (bootstrapArgs.profileJson != null) {
    try {
      const result = applyInlineProfile(
        bootstrapArgs.profileJson,
        argv,
        settings,
      );
      ({
        profileMergedSettings,
        profileModel,
        profileProvider,
        profileModelParams,
        profileBaseUrl,
        loadedProfile,
      } = result);
    } catch (err) {
      throw new Error(
        `Failed to parse inline profile: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // Handle file-based profile from --profile-load
  if (profileToLoad) {
    const result = await applyFileProfile(
      profileToLoad,
      profileExplicitlySpecified,
      argv,
      settings,
      profileWarnings,
    );
    if (result) {
      ({
        profileMergedSettings,
        profileModel,
        profileProvider,
        profileModelParams,
        profileBaseUrl,
        loadedProfile,
      } = result);
    }
  }

  return {
    profileMergedSettings,
    profileModel,
    profileProvider,
    profileModelParams,
    profileBaseUrl,
    loadedProfile,
    profileWarnings,
    profileToLoad,
  };
}
