/**
 * @plan PLAN-20260608-ISSUE1588.P05
 *
 * ProfileManager — migrated from core.
 * Explicit temporary duplicate; core copy remains until P09.
 *
 * Settings-owned: uses settings-owned profile types, not core imports.
 */

import type {
  Profile,
  LoadBalancerProfile,
  StandardProfile,
  EphemeralSettings,
  ModelParams,
} from './types.js';
import { isLoadBalancerProfile } from './types.js';

import fs from 'fs/promises';
import os from 'os';
import path from 'path';

interface ProfileSettingsServiceLike {
  exportForProfile?: () => Promise<{
    defaultProvider: string;
    providers: Record<string, Record<string, unknown>>;
    tools?: { allowed?: unknown[]; disabled?: unknown[] };
  }>;
  setCurrentProfileName?: (profileName: string | null) => void;
  importFromProfile?: (profileData: unknown) => Promise<void>;
  set?: (key: string, value: unknown) => void;
}

type PersistableProfile =
  | Profile
  | {
      version: number;
      provider: string;
      model: string;
      modelParams: Record<string, unknown>;
      ephemeralSettings: Record<string, unknown>;
      type?: 'standard';
    };

function stringOrDefault(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function optionalBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

const PROMPT_CACHING_VALUES = new Set(['off', '5m', '1h', '24h']);

function optionalPromptCaching(
  value: unknown,
): EphemeralSettings['prompt-caching'] {
  return typeof value === 'string' && PROMPT_CACHING_VALUES.has(value)
    ? (value as EphemeralSettings['prompt-caching'])
    : undefined;
}

/**
 * Manages saving and loading of configuration profiles.
 * Profiles are stored in ~/.llxprt/profiles/<profileName>.json
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
  async saveProfile(
    profileName: string,
    profile: PersistableProfile,
  ): Promise<void> {
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
   * Validate that a load-balancer profile's references are valid.
   * Extracted from loadProfile to reduce method complexity.
   */
  private async validateLoadBalancerReferences(
    profileName: string,
    profile: LoadBalancerProfile,
  ): Promise<void> {
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
      const referencedProfileData = JSON.parse(referencedContent) as Profile;

      if (isLoadBalancerProfile(referencedProfileData)) {
        throw new Error(
          `LoadBalancer profile '${profileName}' cannot reference another LoadBalancer profile '${referencedProfile}'`,
        );
      }
    }
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
        await this.validateLoadBalancerReferences(profileName, profile);
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
      await fs.mkdir(this.profilesDir, { recursive: true });

      const files = await fs.readdir(this.profilesDir);

      const profileNames = files
        .filter((file) => file.endsWith('.json'))
        .map((file) => file.slice(0, -5));

      return profileNames;
    } catch {
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
      return false;
    }
  }

  /**
   * Save current settings to a profile through SettingsService
   * @param profileName The name of the profile to save
   */
  async save(
    profileName: string,
    settingsService: ProfileSettingsServiceLike,
  ): Promise<void> {
    if (typeof settingsService.exportForProfile !== 'function') {
      throw new Error('SettingsService does not support profile export');
    }
    const settingsData = await settingsService.exportForProfile();

    const defaultProvider = settingsData.defaultProvider;
    const providerSettings = settingsData.providers[defaultProvider];

    const profile: Profile = {
      version: 1,
      provider: defaultProvider,
      model: stringOrDefault(providerSettings.model, 'default'),
      modelParams: {
        temperature: optionalNumber(providerSettings.temperature),
        max_tokens: optionalNumber(providerSettings.maxTokens),
      } satisfies ModelParams,
      ephemeralSettings: {
        'base-url': optionalString(providerSettings['base-url']),
        'auth-key': optionalString(providerSettings.apiKey),
        'prompt-caching': optionalPromptCaching(
          providerSettings['prompt-caching'],
        ),
        'include-folder-structure': optionalBoolean(
          providerSettings['include-folder-structure'],
        ),
        'tool-format': optionalString(providerSettings.toolFormat),
      } satisfies EphemeralSettings,
    };

    const toolsAllowed = Array.isArray(settingsData.tools?.allowed)
      ? settingsData.tools.allowed.map((name) => String(name))
      : [];
    const toolsDisabled = Array.isArray(settingsData.tools?.disabled)
      ? settingsData.tools.disabled.map((name) => String(name))
      : [];

    profile.ephemeralSettings['tools.allowed'] = toolsAllowed;
    profile.ephemeralSettings['tools.disabled'] = toolsDisabled;
    profile.ephemeralSettings['disabled-tools'] = toolsDisabled;

    if (typeof settingsService.setCurrentProfileName === 'function') {
      settingsService.setCurrentProfileName(profileName);
    }

    await this.saveProfile(profileName, profile);
  }

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
    settingsService: ProfileSettingsServiceLike,
  ): void {
    const allowedList = Array.isArray(settingsData.tools.allowed)
      ? settingsData.tools.allowed
      : [];
    const disabledList = Array.isArray(settingsData.tools.disabled)
      ? settingsData.tools.disabled
      : [];
    if (settingsService.set) {
      settingsService.set('tools.allowed', allowedList);
      settingsService.set('tools.disabled', disabledList);
      settingsService.set('disabled-tools', disabledList);
    }
  }

  private applyReasoningSettings(
    profile: Profile,
    settingsService: ProfileSettingsServiceLike,
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
      if (reasoningSettings[key] !== undefined && settingsService.set) {
        settingsService.set(key, reasoningSettings[key]);
      }
    }
  }

  async load(
    profileName: string,
    settingsService: ProfileSettingsServiceLike,
  ): Promise<void> {
    const profile = await this.loadProfile(profileName);
    if (isLoadBalancerProfile(profile)) {
      throw new Error(
        `LoadBalancer profile '${profileName}' cannot be loaded directly into SettingsService`,
      );
    }
    await this.applyLoadedProfile(profileName, profile, settingsService);
  }

  async applyLoadedProfile(
    profileName: string,
    profile: StandardProfile,
    settingsService: ProfileSettingsServiceLike,
  ): Promise<void> {
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

/**
 * Re-export profile interfaces for backward compatibility with P03/P04 test imports.
 * These were previously stub interfaces in this file.
 */
export type { Profile as ProfileLike } from './types.js';
export type { LoadBalancerProfile as LoadBalancerProfileLike } from './types.js';
