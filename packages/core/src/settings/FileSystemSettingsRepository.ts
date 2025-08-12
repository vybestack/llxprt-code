/**
 * File system-based settings repository
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { ISettingsRepository, GlobalSettings } from './types.js';

/**
 * File system implementation of settings repository
 */
export class FileSystemSettingsRepository implements ISettingsRepository {
  private settingsPath: string;
  private watchCallback?: (settings: GlobalSettings) => void;

  constructor(settingsPath: string) {
    this.settingsPath = settingsPath;
  }

  async load(): Promise<GlobalSettings> {
    try {
      // Ensure directory exists
      await fs.mkdir(path.dirname(this.settingsPath), { recursive: true });

      // Try to read existing settings file
      const data = await fs.readFile(this.settingsPath, 'utf-8');
      const parsed = JSON.parse(data);

      // Validate basic structure
      if (typeof parsed === 'object' && parsed !== null) {
        return parsed as GlobalSettings;
      }

      // Invalid settings structure - fail fast
      throw new Error('Invalid settings file structure');
    } catch (error) {
      // If file doesn't exist, return empty (not an error for first run)
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return { providers: {} };
      }
      // Any other error (parse error, permissions, etc) - fail fast
      throw new Error(`Failed to load settings: ${(error as Error).message}`);
    }
  }

  async save(settings: GlobalSettings): Promise<void> {
    try {
      // Ensure directory exists
      await fs.mkdir(path.dirname(this.settingsPath), { recursive: true });

      // Write settings to file
      const data = JSON.stringify(settings, null, 2);
      await fs.writeFile(this.settingsPath, data, 'utf-8');

      // Notify watchers
      if (this.watchCallback) {
        this.watchCallback(settings);
      }
    } catch (error) {
      throw new Error(`Failed to save settings: ${(error as Error).message}`);
    }
  }

  watch(callback: (settings: GlobalSettings) => void): () => void {
    this.watchCallback = callback;

    // Return unsubscribe function
    return () => {
      this.watchCallback = undefined;
    };
  }
}
