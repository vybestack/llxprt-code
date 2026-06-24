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
import {
  isPlainObject,
  parseLoadBalancerProfile,
  parseProfile,
  parsePromptCaching,
} from '../settings/validation.js';

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

function referencedProfileIsLoadBalancer(profile: unknown): boolean {
  return isPlainObject(profile) && profile.type === 'loadbalancer';
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((name) => String(name)) : [];
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
      profilesDir !== undefined && profilesDir !== ''
        ? profilesDir
        : path.join(os.homedir(), '.llxprt', 'profiles');
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

  async saveLoadBalancerProfile(name: string, profile: unknown): Promise<void> {
    const loadBalancerProfile = parseLoadBalancerProfile(name, profile);

    const availableProfiles = await this.listProfiles();

    for (const referencedProfile of loadBalancerProfile.profiles) {
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
      const referencedProfileData: unknown = JSON.parse(referencedContent);

      if (referencedProfileIsLoadBalancer(referencedProfileData)) {
        throw new Error(
          `LoadBalancer profile '${name}' cannot reference another LoadBalancer profile '${referencedProfile}'`,
        );
      }
    }

    await fs.mkdir(this.profilesDir, { recursive: true });

    const filePath = path.join(this.profilesDir, `${name}.json`);

    await fs.writeFile(
      filePath,
      JSON.stringify(loadBalancerProfile, null, 2),
      'utf8',
    );
  }

  /**
   * Validate that a load-balancer profile's references are valid.
   * Extracted from loadProfile to reduce method complexity.
   */
  private async validateLoadBalancerReferences(
    profileName: string,
    profile: LoadBalancerProfile,
  ): Promise<void> {
    const loadBalancerProfile = parseLoadBalancerProfile(profileName, profile);

    const availableProfiles = await this.listProfiles();

    for (const referencedProfile of loadBalancerProfile.profiles) {
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
      const referencedProfileData: unknown = JSON.parse(referencedContent);

      if (referencedProfileIsLoadBalancer(referencedProfileData)) {
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

      const parsed: unknown = JSON.parse(content);
      const profile =
        isPlainObject(parsed) && parsed.type === 'loadbalancer'
          ? parseLoadBalancerProfile(profileName, parsed)
          : parseProfile(parsed);

      if (isLoadBalancerProfile(profile)) {
        await this.validateLoadBalancerReferences(profileName, profile);
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
        'auth-key': optionalString(providerSettings['auth-key']),
        'auth-keyfile': optionalString(providerSettings['auth-keyfile']),
        'prompt-caching': parsePromptCaching(
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
    tools: { allowed: string[]; disabled: string[] };
  } {
    const allowedValue = profile.ephemeralSettings['tools.allowed'];
    const allowedTools = stringArray(allowedValue);

    const disabledValue = profile.ephemeralSettings['tools.disabled'];
    const legacyDisabled = profile.ephemeralSettings['disabled-tools'];
    let disabledTools: string[];
    if (Array.isArray(disabledValue)) {
      disabledTools = stringArray(disabledValue);
    } else if (Array.isArray(legacyDisabled)) {
      disabledTools = stringArray(legacyDisabled);
    } else {
      disabledTools = [];
    }

    return {
      defaultProvider: profile.provider,
      providers: {
        [profile.provider]: {
          enabled: true,
          model: profile.model,
          temperature: profile.modelParams.temperature,
          maxTokens: profile.modelParams.max_tokens,
          'base-url': profile.ephemeralSettings['base-url'],
          'auth-key': profile.ephemeralSettings['auth-key'],
          'auth-keyfile': profile.ephemeralSettings['auth-keyfile'],
          'prompt-caching': profile.ephemeralSettings['prompt-caching'],
          'include-folder-structure':
            profile.ephemeralSettings['include-folder-structure'],
          toolFormat: profile.ephemeralSettings['tool-format'],
        },
      },
      tools: {
        allowed: allowedTools,
        disabled: disabledTools,
      },
    };
  }

  private applyToolSettings(
    settingsData: {
      tools: { allowed: string[]; disabled: string[] };
    },
    settingsService: ProfileSettingsServiceLike,
  ): void {
    if (settingsService.set) {
      settingsService.set('tools.allowed', settingsData.tools.allowed);
      settingsService.set('tools.disabled', settingsData.tools.disabled);
      settingsService.set('disabled-tools', settingsData.tools.disabled);
    }
  }

  private applyReasoningSettings(
    profile: Profile,
    settingsService: ProfileSettingsServiceLike,
  ): void {
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
      if (profile.ephemeralSettings[key] !== undefined && settingsService.set) {
        settingsService.set(key, profile.ephemeralSettings[key]);
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
