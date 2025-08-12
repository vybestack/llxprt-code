/**
 * Centralized SettingsService singleton instance
 */

import * as path from 'path';
import * as os from 'os';
import { SettingsService } from './SettingsService.js';
import { FileSystemSettingsRepository } from './FileSystemSettingsRepository.js';

let settingsServiceInstance: SettingsService | null = null;

/**
 * Get or create the global SettingsService singleton instance
 */
export function getSettingsService(): SettingsService {
  if (!settingsServiceInstance) {
    const settingsPath = path.join(
      os.homedir(),
      '.llxprt',
      'centralized-settings.json',
    );
    const repository = new FileSystemSettingsRepository(settingsPath);
    settingsServiceInstance = new SettingsService(repository);
  }

  return settingsServiceInstance;
}

/**
 * Reset the settings service instance (for testing)
 */
export function resetSettingsService(): void {
  settingsServiceInstance = null;
}
