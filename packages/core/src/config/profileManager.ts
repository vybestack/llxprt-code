/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Profile } from '../types/modelParams.js';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

/**
 * Manages saving and loading of configuration profiles.
 * Profiles are stored in ~/.llxprt/profiles/<profileName>.json
 */
export class ProfileManager {
  private profilesDir: string;

  constructor() {
    this.profilesDir = path.join(os.homedir(), '.llxprt', 'profiles');
  }

  /**
   * Save the current configuration to a profile.
   * @param profileName The name of the profile to save
   * @param profile The profile configuration to save
   */
  async saveProfile(profileName: string, profile: Profile): Promise<void> {
    // Ensure profiles directory exists
    await fs.mkdir(this.profilesDir, { recursive: true });

    // Construct the file path
    const filePath = path.join(this.profilesDir, `${profileName}.json`);

    // Write the profile to file with nice formatting
    await fs.writeFile(filePath, JSON.stringify(profile, null, 2), 'utf8');
  }

  /**
   * Load a profile configuration.
   * @param profileName The name of the profile to load
   * @returns The loaded profile configuration
   */
  async loadProfile(profileName: string): Promise<Profile> {
    // Construct the file path
    const filePath = path.join(this.profilesDir, `${profileName}.json`);

    try {
      // Read the profile file
      const content = await fs.readFile(filePath, 'utf8');

      // Parse JSON
      const profile = JSON.parse(content) as Profile;

      // Validate required fields
      if (
        !profile.version ||
        !profile.provider ||
        !profile.model ||
        !profile.modelParams ||
        !profile.ephemeralSettings
      ) {
        throw new Error('missing required fields');
      }

      // Check version
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
    } catch (_error) {
      // If directory doesn't exist or other error, return empty array
      return [];
    }
  }

  /**
   * Delete a profile.
   * @param _profileName The name of the profile to delete
   */
  async deleteProfile(_profileName: string): Promise<void> {
    // TODO: Implement delete functionality
    // 1. Check if profile exists
    // 2. Delete the file
    throw new Error('NotYetImplemented');
  }

  /**
   * Check if a profile exists.
   * @param _profileName The name of the profile to check
   * @returns True if the profile exists
   */
  async profileExists(_profileName: string): Promise<boolean> {
    // TODO: Implement existence check
    // 1. Check if <profilesDir>/<profileName>.json exists
    throw new Error('NotYetImplemented');
  }
}
