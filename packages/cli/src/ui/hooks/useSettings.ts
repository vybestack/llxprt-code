/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// Mock hook for welcoming demonstration - real implementation would connect to settings system

interface UserSettings {
  providerApiKeys: Record<string, string>;
  providerBaseUrls: Record<string, string>;
  providerModels: Record<string, string>;
  defaultProvider?: string;
}

interface UseSettingsResult {
  userSettings: UserSettings | null;
  saveUserSettings: (settings: Partial<UserSettings>) => Promise<void>;
  isLoading: boolean;
  error: Error | null;
}

/**
 * Mock hook for settings management
 */
export const useSettings = (): UseSettingsResult => {
  // In a real implementation, this would load from the actual settings system
  // For now, return empty settings to trigger the welcome screen
  const mockSettings: UserSettings = {
    providerApiKeys: {},
    providerBaseUrls: {},
    providerModels: {},
    defaultProvider: undefined,
  };

  return {
    userSettings: mockSettings,
    saveUserSettings: async () => {
      // Mock implementation - would save to actual settings storage
    },
    isLoading: false,
    error: null,
  };
};
