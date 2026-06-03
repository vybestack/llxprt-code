/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-disable complexity, sonarjs/cognitive-complexity -- Phase 5: legacy core boundary retained while larger decomposition continues. */

import type { Profile, LoadBalancerProfile } from '../types/modelParams.js';
import { isLoadBalancerProfile } from '../types/modelParams.js';
import type { SettingsService } from '../settings/SettingsService.js';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

/**
 * Manages saving and loading of configuration profiles.
 * Profiles are stored in ~/.llxprt/profiles/<profileName>.json
 *
 * @plan:PLAN-20250117-SUBAGENTCONFIG.P04
 * @requirement:REQ-018
 */
export class ProfileManager {
  private profilesDir: string;

  /**
   * @param profilesDir Optional custom directory for testing. If not provided, uses ~/.llxprt/profiles.
   */
  constructor(profilesDir?: string) {
    this.profilesDir =
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- intentional falsy coalescing: empty string should use default path
      profilesDir || path.join(os.homedir(), '.llxprt', 'profiles');
  }

  /**
   * Save the current configuration to a profile.
   * @param profileName The name of the profile to save
   * @param profile The profile configuration to save
   */
  async saveProfile(profileName: string, profile: Profile): Promise<void> {
    await fs.mkdir(this.profilesDir, { recursive: true });

    const filePath = path.join(this.profilesDir, `${profileName}.json`);

    await fs.writeFile(filePath, JSON.stringify(profile, null, 2), 'utf8');
  }

  async saveLoadBalancerProfile(
    name: string,
    profile: LoadBalancerProfile,
  ): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- BN4-C-P01: preserve defensive runtime boundary guard despite current static types.
    if (profile.version !== 1) {
      throw new Error('unsupported profile version');
    }

    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- BN4-C-P01: preserve defensive runtime boundary guard despite current static types.
    if (profile.profiles == null || profile.profiles.length === 0) {
      throw new Error(
        `LoadBalancer profile '${name}' must reference at least one profile`,
      );
    }

    const availableProfiles = await this.listProfiles();

    for (const referencedProfile of profile.profiles) {
      if (!availableProfiles.includes(referencedProfile)) {
        throw new Error(
          `LoadBalancer profile '${name}' references non-existent profile '${referencedProfile}'`,
        );
      }

      const referencedProfilePath = path.join(
        this.profilesDir,
        `${referencedProfile}.json`,
      );
      const referencedContent = await fs.readFile(
        referencedProfilePath,
        'utf8',
      );
      const referencedProfileData = JSON.parse(referencedContent) as Profile;

      if (isLoadBalancerProfile(referencedProfileData)) {
        throw new Error(
          `LoadBalancer profile '${name}' cannot reference another LoadBalancer profile '${referencedProfile}'`,
        );
      }
    }

    await fs.mkdir(this.profilesDir, { recursive: true });

    const filePath = path.join(this.profilesDir, `${name}.json`);

    await fs.writeFile(filePath, JSON.stringify(profile, null, 2), 'utf8');
  }

  /**
   * Load a profile configuration.
   * @param profileName The name of the profile to load
   * @returns The loaded profile configuration
   */
  async loadProfile(profileName: string): Promise<Profile> {
    const filePath = path.join(this.profilesDir, `${profileName}.json`);

    try {
      const content = await fs.readFile(filePath, 'utf8');

      const profile = JSON.parse(content) as Profile;

      if (isLoadBalancerProfile(profile)) {
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- BN4-C-P01: preserve defensive runtime boundary guard despite current static types.
        if (profile.version !== 1) {
          throw new Error('unsupported profile version');
        }

        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- BN4-C-P01: preserve defensive runtime boundary guard despite current static types.
        if (profile.profiles == null || profile.profiles.length === 0) {
          throw new Error(
            `LoadBalancer profile '${profileName}' must reference at least one profile`,
          );
        }

        const availableProfiles = await this.listProfiles();

        for (const referencedProfile of profile.profiles) {
          // eslint-disable-next-line sonarjs/nested-control-flow -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
          if (!availableProfiles.includes(referencedProfile)) {
            throw new Error(
              `LoadBalancer profile '${profileName}' references non-existent profile '${referencedProfile}'`,
            );
          }

          const referencedProfilePath = path.join(
            this.profilesDir,
            `${referencedProfile}.json`,
          );
          const referencedContent = await fs.readFile(
            referencedProfilePath,
            'utf8',
          );
          const referencedProfileData = JSON.parse(
            referencedContent,
          ) as Profile;

          // eslint-disable-next-line sonarjs/nested-control-flow -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
          if (isLoadBalancerProfile(referencedProfileData)) {
            throw new Error(
              `LoadBalancer profile '${profileName}' cannot reference another LoadBalancer profile '${referencedProfile}'`,
            );
          }
        }

        return profile;
      }

      const profileRecord = profile as unknown as Record<string, unknown>;
      const profileVersion = profileRecord.version;
      const profileProvider = profileRecord.provider;
      const profileModel = profileRecord.model;

      if (
        // eslint-disable-next-line sonarjs/expression-complexity -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
        profileVersion == null ||
        profileVersion === 0 ||
        (typeof profileVersion === 'number' && Number.isNaN(profileVersion)) ||
        profileVersion === false ||
        typeof profileProvider !== 'string' ||
        profileProvider === '' ||
        typeof profileModel !== 'string' ||
        profileModel === '' ||
        profileRecord.modelParams == null ||
        profileRecord.ephemeralSettings == null
      ) {
        throw new Error('missing required fields');
      }

      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- BN4-C-P01: preserve defensive runtime boundary guard despite current static types.
      if (profile.version !== 1) {
        throw new Error('unsupported profile version');
      }

      return profile;
    } catch (error) {
      if (error instanceof Error && error.message.includes('ENOENT')) {
        throw new Error(`Profile '${profileName}' not found`);
      }
      if (error instanceof SyntaxError) {
        throw new Error(`Profile '${profileName}' is corrupted`);
      }
      if (
        error instanceof Error &&
        error.message === 'missing required fields'
      ) {
        throw new Error(
          `Profile '${profileName}' is invalid: missing required fields`,
        );
      }
      throw error;
    }
  }

  /**
   * List all available profile names.
   * @returns Array of profile names (without .json extension)
   */
  async listProfiles(): Promise<string[]> {
    try {
      // Ensure profiles directory exists
      await fs.mkdir(this.profilesDir, { recursive: true });

      // Read all files in the profiles directory
      const files = await fs.readdir(this.profilesDir);

      // Filter for .json files and remove extension
      const profileNames = files
        .filter((file) => file.endsWith('.json'))
        .map((file) => file.slice(0, -5)); // Remove .json extension

      return profileNames;
    } catch {
      // Directory doesn't exist or error; return empty array.
      return [];
    }
  }

  /**
   * Delete a profile.
   * @param profileName The name of the profile to delete
   */
  async deleteProfile(profileName: string): Promise<void> {
    const filePath = path.join(this.profilesDir, `${profileName}.json`);

    try {
      await fs.unlink(filePath);
    } catch (error) {
      if (error instanceof Error && error.message.includes('ENOENT')) {
        throw new Error(`Profile '${profileName}' not found`);
      }
      throw error;
    }
  }

  /**
   * Check if a profile exists.
   * @param profileName The name of the profile to check
   * @returns True if the profile exists
   */
  async profileExists(profileName: string): Promise<boolean> {
    const filePath = path.join(this.profilesDir, `${profileName}.json`);
    try {
      await fs.access(filePath);
      return true;
    } catch {
      // Profile doesn't exist.
      return false;
    }
  }

  /**
   * Save current settings to a profile through SettingsService
   * @param profileName The name of the profile to save
   */
  /**
   * @plan:PLAN-20250218-STATELESSPROVIDER.P07
   * @requirement:REQ-SP-005
   * Persist profile data through the injected SettingsService instead of the
   * legacy singleton accessor.
   * @pseudocode:cli-runtime.md lines 9-11
   */
  async save(
    profileName: string,
    settingsService: SettingsService,
  ): Promise<void> {
    // Use SettingsService to export current settings

    if (typeof settingsService.exportForProfile !== 'function') {
      throw new Error('SettingsService does not support profile export');
    }
    const settingsData = await settingsService.exportForProfile();

    // Convert SettingsService format to Profile format
    // We need to extract provider/model from the default provider settings
    const defaultProvider = settingsData.defaultProvider;
    const providerSettings = settingsData.providers[defaultProvider];

    const profile: Profile = {
      version: 1,
      provider: defaultProvider,
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- BN4-C-P01: preserve defensive runtime boundary guard despite current static types.
      model: providerSettings?.model ?? 'default',
      modelParams: {
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- BN4-C-P01: preserve defensive runtime boundary guard despite current static types.
        temperature: providerSettings?.temperature,
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- BN4-C-P01: preserve defensive runtime boundary guard despite current static types.
        max_tokens: providerSettings?.maxTokens,
      },
      ephemeralSettings: {
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- BN4-C-P01: preserve defensive runtime boundary guard despite current static types.
        'base-url': providerSettings?.['base-url'],
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- BN4-C-P01: preserve defensive runtime boundary guard despite current static types.
        'auth-key': providerSettings?.apiKey,
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- BN4-C-P01: preserve defensive runtime boundary guard despite current static types.
        'prompt-caching': providerSettings?.['prompt-caching'],
        'include-folder-structure':
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- BN4-C-P01: preserve defensive runtime boundary guard despite current static types.
          providerSettings?.['include-folder-structure'],
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- BN4-C-P01: preserve defensive runtime boundary guard despite current static types.
        'tool-format': providerSettings?.toolFormat,
      },
    };

    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- BN4-C-P01: preserve defensive runtime boundary guard despite current static types.
    const toolsAllowed = Array.isArray(settingsData.tools?.allowed)
      ? [...settingsData.tools.allowed]
      : [];
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- BN4-C-P01: preserve defensive runtime boundary guard despite current static types.
    const toolsDisabled = Array.isArray(settingsData.tools?.disabled)
      ? [...settingsData.tools.disabled]
      : [];

    profile.ephemeralSettings['tools.allowed'] = toolsAllowed;
    profile.ephemeralSettings['tools.disabled'] = toolsDisabled;
    profile.ephemeralSettings['disabled-tools'] = toolsDisabled;

    // Update current profile name in SettingsService

    if (typeof settingsService.setCurrentProfileName === 'function') {
      settingsService.setCurrentProfileName(profileName);
    }

    // Save to file using existing method for consistency
    await this.saveProfile(profileName, profile);
  }

  /**
   * Load a profile and apply through SettingsService
   * @param profileName The name of the profile to load
   */
  /**
   * @plan:PLAN-20250218-STATELESSPROVIDER.P07
   * @requirement:REQ-SP-005
   * Apply profiles via the injected SettingsService rather than the singleton.
   * @pseudocode:cli-runtime.md lines 9-11
   */
  private convertProfileToSettingsData(profile: Profile): {
    defaultProvider: string;
    providers: Record<string, unknown>;
    tools: { allowed: unknown[]; disabled: unknown[] };
  } {
    return {
      defaultProvider: profile.provider,
      providers: {
        [profile.provider]: {
          enabled: true,
          model: profile.model,
          temperature: profile.modelParams.temperature,
          maxTokens: profile.modelParams.max_tokens,
          'base-url': profile.ephemeralSettings['base-url'],
          apiKey: profile.ephemeralSettings['auth-key'],
          'prompt-caching': profile.ephemeralSettings['prompt-caching'],
          'include-folder-structure':
            profile.ephemeralSettings['include-folder-structure'],
          toolFormat: profile.ephemeralSettings['tool-format'],
        },
      },
      tools: {
        allowed: Array.isArray(profile.ephemeralSettings['tools.allowed'])
          ? [...profile.ephemeralSettings['tools.allowed']]
          : [],
        disabled: Array.isArray(profile.ephemeralSettings['tools.disabled'])
          ? [...profile.ephemeralSettings['tools.disabled']]
          : // eslint-disable-next-line sonarjs/no-nested-conditional -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
            Array.isArray(profile.ephemeralSettings['disabled-tools'])
            ? [...profile.ephemeralSettings['disabled-tools']]
            : [],
      },
    };
  }

  private applyToolSettings(
    settingsData: {
      tools: { allowed: unknown[]; disabled: unknown[] };
    },
    settingsService: SettingsService,
  ): void {
    const allowedList = Array.isArray(settingsData.tools.allowed)
      ? settingsData.tools.allowed
      : [];
    const disabledList = Array.isArray(settingsData.tools.disabled)
      ? settingsData.tools.disabled
      : [];
    settingsService.set('tools.allowed', allowedList);
    settingsService.set('tools.disabled', disabledList);
    settingsService.set('disabled-tools', disabledList);
  }

  private applyReasoningSettings(
    profile: Profile,
    settingsService: SettingsService,
  ): void {
    const reasoningSettings = profile.ephemeralSettings as unknown as Record<
      string,
      unknown
    >;

    const reasoningKeys = [
      'reasoning.enabled',
      'reasoning.includeInContext',
      'reasoning.includeInResponse',
      'reasoning.format',
      'reasoning.stripFromContext',
      'reasoning.effort',
      'reasoning.maxTokens',
    ] as const;

    for (const key of reasoningKeys) {
      if (reasoningSettings[key] !== undefined) {
        settingsService.set(key, reasoningSettings[key]);
      }
    }
  }

  async load(
    profileName: string,
    settingsService: SettingsService,
  ): Promise<void> {
    const profile = await this.loadProfile(profileName);

    const settingsData = this.convertProfileToSettingsData(profile);

    if (typeof settingsService.setCurrentProfileName === 'function') {
      settingsService.setCurrentProfileName(profileName);
    }

    if (typeof settingsService.importFromProfile !== 'function') {
      throw new Error('SettingsService does not support profile import');
    }
    await settingsService.importFromProfile(settingsData);

    this.applyToolSettings(settingsData, settingsService);
    this.applyReasoningSettings(profile, settingsService);
  }
}
