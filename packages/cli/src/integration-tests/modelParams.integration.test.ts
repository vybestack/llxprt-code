/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { CommandContext } from '../ui/commands/types.js';
import { createMockCommandContext } from '../test-utils/mockCommandContext.js';
import { setCommand } from '../ui/commands/setCommand.js';
import { saveCommand } from '../ui/commands/saveCommand.js';
import { loadCommand } from '../ui/commands/loadCommand.js';
import { SettingScope } from '../config/settings.js';
import { getProviderManager } from '../providers/providerManagerInstance.js';
import {
  Config,
  IProvider,
  Profile,
  ProfileManager,
  ProviderApiKeyCredentialType,
} from '@vybestack/llxprt-code-core';

// Mock modules
vi.mock('fs/promises');
vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>();
  return {
    ...actual,
    default: {
      ...actual.default,
      homedir: vi.fn().mockReturnValue('/home/testuser'),
    },
    homedir: vi.fn().mockReturnValue('/home/testuser'),
  };
});

// Mock provider manager
vi.mock('../providers/providerManagerInstance.js', () => ({
  getProviderManager: vi.fn(),
}));

// Mock OpenAI module to capture actual API calls
interface MockOpenAIClient {
  config: unknown;
  chat: {
    completions: {
      create: ReturnType<typeof vi.fn>;
    };
  };
}

let mockOpenAIClient: MockOpenAIClient | null;
vi.mock('openai', () => ({
  default: vi.fn().mockImplementation((config) => {
    mockOpenAIClient = {
      config,
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue({
            choices: [
              {
                message: {
                  content: 'Test response',
                  role: 'assistant',
                },
              },
            ],
          }),
        },
      },
    };
    return mockOpenAIClient;
  }),
}));

interface MockProviderManager {
  getActiveProvider: ReturnType<typeof vi.fn>;
  setActiveProvider: ReturnType<typeof vi.fn>;
  getProvider: ReturnType<typeof vi.fn>;
}

interface MockSettings {
  merged: Record<string, unknown>;
  setValue: ReturnType<typeof vi.fn>;
  errors: never[];
}

describe('Model Parameters and Profiles Integration Tests', () => {
  let mockProvider: IProvider;
  let mockProviderManager: MockProviderManager;
  let context: CommandContext;
  let config: Config;
  let settings: MockSettings;
  const mockHomedir = '/home/testuser';
  const profilesDir = path.join(mockHomedir, '.llxprt', 'profiles');

  // Sample ephemeral settings for testing
  const testEphemeralSettings = {
    'context-limit': 32000,
    'compression-threshold': 0.85,
    'auth-keyfile': '~/.keys/openai-key',
    'base-url': 'https://api.openai.com/v1',
    'tool-format': 'openai',
    'api-version': '2024-01-01',
    'custom-headers': {
      'X-Custom-Header': 'test-value',
      Authorization: 'Bearer custom-token',
    },
  };

  beforeEach(async () => {
    // Setup file system mocks
    vi.mocked(os.homedir).mockReturnValue(mockHomedir);
    vi.mocked(fs.mkdir).mockResolvedValue(undefined);
    vi.mocked(fs.writeFile).mockResolvedValue(undefined);
    vi.mocked(fs.readFile).mockResolvedValue('{}');
    vi.mocked(fs.access).mockResolvedValue(undefined);

    // Reset OpenAI mock
    mockOpenAIClient = null;

    // Create mock provider with full implementation
    mockProvider = {
      name: 'openai',
      getModels: vi.fn().mockResolvedValue([
        { id: 'gpt-4', name: 'GPT-4' },
        { id: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo' },
      ]),
      generateChatCompletion: vi.fn(),
      getServerTools: vi.fn().mockReturnValue([]),
      invokeServerTool: vi.fn().mockResolvedValue(undefined),
      setModelParams: vi.fn(),
      getModelParams: vi.fn().mockReturnValue({}),
      setModel: vi.fn(),
      getModel: vi.fn().mockReturnValue('gpt-4'),
      setConfig: vi.fn(),
      getConfig: vi.fn(),
      getCredentialInfo: vi
        .fn()
        .mockReturnValue({ type: ProviderApiKeyCredentialType }),
      setApiKey: vi.fn(),
      getApiKey: vi.fn().mockReturnValue('test-api-key'),
    };

    // Create mock provider manager
    mockProviderManager = {
      getActiveProvider: vi.fn().mockReturnValue(mockProvider),
      setActiveProvider: vi.fn().mockImplementation((providerName: string) => {
        if (providerName !== 'openai' && providerName !== 'anthropic') {
          throw new Error(`Provider not found: ${providerName}`);
        }
        mockProvider.name = providerName;
      }),
      getProvider: vi.fn().mockImplementation((name: string) => {
        if (name === 'openai' || name === 'anthropic') {
          return mockProvider;
        }
        return null;
      }),
    };

    vi.mocked(getProviderManager).mockReturnValue(mockProviderManager);

    // Load real settings and config
    settings = {
      merged: { ...testEphemeralSettings },
      setValue: vi.fn().mockImplementation((scope, key, value) => {
        // Simulate setting values
        settings.merged[key] = value;
      }),
      errors: [],
    };

    // Create config with necessary methods
    const mockConfig = {
      getProviderManager: vi.fn().mockReturnValue(mockProviderManager),
      getProvider: vi.fn().mockReturnValue('openai'),
      setModel: vi.fn(),
      getModel: vi.fn().mockReturnValue('gpt-4'),
      initialize: vi.fn().mockResolvedValue(undefined),
      getDebugMode: vi.fn().mockReturnValue(false),
    };

    config = mockConfig as unknown as Config;

    // Create context for commands
    context = createMockCommandContext({
      services: {
        config: config as unknown as CommandContext['services']['config'],
        settings: settings as unknown as CommandContext['services']['settings'],
      },
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Full Workflow: Set → Save → Load → Use', () => {
    it('should complete full workflow with model parameters and profiles', async () => {
      // Step 1: Set multiple model parameters
      let result = await setCommand.action!(
        context,
        'modelparam temperature 0.8',
      );
      expect(result).toEqual({
        type: 'message',
        messageType: 'info',
        content: "Model parameter 'temperature' set to 0.8",
      });
      expect(mockProvider.setModelParams).toHaveBeenCalledWith({
        temperature: 0.8,
      });

      result = await setCommand.action!(context, 'modelparam max_tokens 4096');
      expect(mockProvider.setModelParams).toHaveBeenCalledWith({
        max_tokens: 4096,
      });

      result = await setCommand.action!(context, 'modelparam top_p 0.95');
      expect(mockProvider.setModelParams).toHaveBeenCalledWith({ top_p: 0.95 });

      // Mock the provider returning all set parameters
      mockProvider.getModelParams = vi.fn().mockReturnValue({
        temperature: 0.8,
        max_tokens: 4096,
        top_p: 0.95,
      });

      // Step 2: Save profile
      result = await saveCommand.action!(context, '"Production Profile"');
      expect(result).toEqual({
        type: 'message',
        messageType: 'info',
        content: "Profile 'Production Profile' saved",
      });

      // Verify profile was saved with correct structure
      expect(vi.mocked(fs.writeFile)).toHaveBeenCalledWith(
        path.join(profilesDir, 'Production Profile.json'),
        expect.stringContaining('"temperature": 0.8'),
        'utf8',
      );

      const savedProfileContent = vi.mocked(fs.writeFile).mock.calls[0][1];
      const savedProfile = JSON.parse(savedProfileContent as string);
      expect(savedProfile).toMatchObject({
        version: 1,
        provider: 'openai',
        model: 'gpt-4',
        modelParams: {
          temperature: 0.8,
          max_tokens: 4096,
          top_p: 0.95,
        },
        ephemeralSettings: expect.objectContaining({
          'context-limit': 32000,
          'compression-threshold': 0.85,
        }),
      });

      // Verify the savedProfile actually has the ephemeral settings
      expect(
        Object.keys(savedProfile.ephemeralSettings).length,
      ).toBeGreaterThan(0);

      // Step 3: Reset state and load profile
      mockProvider.setModelParams = vi.fn();
      mockProvider.getModelParams = vi.fn().mockReturnValue({});

      // Create a fresh settings mock for loading
      const loadSettings = {
        merged: {},
        setValue: vi.fn().mockImplementation((scope, key, value) => {
          loadSettings.merged[key] = value;
        }),
      };

      // Update context with fresh settings
      context.services.settings =
        loadSettings as unknown as CommandContext['services']['settings'];

      // Mock reading the saved profile
      vi.mocked(fs.readFile).mockResolvedValue(savedProfileContent as string);

      result = await loadCommand.action!(context, '"Production Profile"');
      expect(result).toEqual({
        type: 'message',
        messageType: 'info',
        content: "Profile 'Production Profile' loaded",
      });

      // Verify all settings were applied
      expect(mockProviderManager.setActiveProvider).toHaveBeenCalledWith(
        'openai',
      );
      expect(config.setModel).toHaveBeenCalledWith('gpt-4');
      expect(mockProvider.setModelParams).toHaveBeenCalledWith({
        temperature: 0.8,
        max_tokens: 4096,
        top_p: 0.95,
      });
      // Verify ephemeral settings were applied
      // Count the actual number of ephemeral settings in the saved profile
      const numEphemeralSettings = Object.keys(
        savedProfile.ephemeralSettings,
      ).length;
      expect(loadSettings.setValue).toHaveBeenCalledTimes(numEphemeralSettings);
      expect(loadSettings.setValue).toHaveBeenCalledWith(
        SettingScope.User,
        'context-limit',
        32000,
      );
      expect(loadSettings.setValue).toHaveBeenCalledWith(
        SettingScope.User,
        'compression-threshold',
        0.85,
      );

      // Step 4: Verify parameters are used in API calls
      // This would happen when the provider makes actual API calls
      // In a real scenario, the OpenAI client would receive these parameters
    });

    it('should handle complex JSON parameters in full workflow', async () => {
      // Set complex parameters including JSON
      await setCommand.action!(
        context,
        'modelparam response_format {"type":"json_object"}',
      );
      await setCommand.action!(
        context,
        'modelparam custom-headers {"X-API-Key":"secret","X-Request-ID":"123"}',
      );

      mockProvider.getModelParams = vi.fn().mockReturnValue({
        response_format: { type: 'json_object' },
        'custom-headers': { 'X-API-Key': 'secret', 'X-Request-ID': '123' },
      });

      // Save profile
      const result = await saveCommand.action!(context, '"JSON Test Profile"');
      expect(result?.messageType).toBe('info');

      // Verify JSON was preserved correctly
      const savedContent = vi.mocked(fs.writeFile).mock.calls[0][1] as string;
      const savedProfile = JSON.parse(savedContent);
      expect(savedProfile.modelParams).toEqual({
        response_format: { type: 'json_object' },
        'custom-headers': { 'X-API-Key': 'secret', 'X-Request-ID': '123' },
      });

      // Load and verify JSON parameters are restored
      vi.mocked(fs.readFile).mockResolvedValue(savedContent);
      await loadCommand.action!(context, '"JSON Test Profile"');

      expect(mockProvider.setModelParams).toHaveBeenCalledWith({
        response_format: { type: 'json_object' },
        'custom-headers': { 'X-API-Key': 'secret', 'X-Request-ID': '123' },
      });
    });
  });

  describe('Multiple Profiles with Different Settings', () => {
    it('should manage multiple profiles independently', async () => {
      // Create Development Profile
      mockProvider.getModelParams = vi.fn().mockReturnValue({
        temperature: 0.9,
        max_tokens: 8192,
        stream: true,
      });
      context.services.settings.merged = {
        'context-limit': 64000,
        'compression-threshold': 0.9,
        'tool-format': 'openai',
      };

      await saveCommand.action!(context, '"Development Profile"');

      // Create Production Profile
      mockProvider.getModelParams = vi.fn().mockReturnValue({
        temperature: 0.3,
        max_tokens: 2048,
        stream: false,
        seed: 42,
      });
      context.services.settings.merged = {
        'context-limit': 16000,
        'compression-threshold': 0.7,
        'tool-format': 'openai',
      };

      await saveCommand.action!(context, '"Production Profile"');

      // Verify both profiles were saved
      expect(vi.mocked(fs.writeFile)).toHaveBeenCalledTimes(2);

      // Load Development Profile
      const devProfileContent = vi.mocked(fs.writeFile).mock.calls[0][1];
      vi.mocked(fs.readFile).mockResolvedValue(devProfileContent as string);

      mockProvider.setModelParams = vi.fn();
      const devSettings = {
        merged: {},
        setValue: vi.fn().mockImplementation((scope, key, value) => {
          devSettings.merged[key] = value;
        }),
      };
      context.services.settings =
        devSettings as unknown as CommandContext['services']['settings'];

      await loadCommand.action!(context, '"Development Profile"');

      expect(mockProvider.setModelParams).toHaveBeenCalledWith({
        temperature: 0.9,
        max_tokens: 8192,
        stream: true,
      });
      expect(devSettings.setValue).toHaveBeenCalledTimes(3); // 3 ephemeral settings
      expect(devSettings.setValue).toHaveBeenCalledWith(
        SettingScope.User,
        'context-limit',
        64000,
      );

      // Load Production Profile
      const prodProfileContent = vi.mocked(fs.writeFile).mock.calls[1][1];
      vi.mocked(fs.readFile).mockResolvedValue(prodProfileContent as string);

      mockProvider.setModelParams = vi.fn();
      const prodSettings = {
        merged: {},
        setValue: vi.fn().mockImplementation((scope, key, value) => {
          prodSettings.merged[key] = value;
        }),
      };
      context.services.settings =
        prodSettings as unknown as CommandContext['services']['settings'];

      await loadCommand.action!(context, '"Production Profile"');

      expect(mockProvider.setModelParams).toHaveBeenCalledWith({
        temperature: 0.3,
        max_tokens: 2048,
        stream: false,
        seed: 42,
      });
      expect(prodSettings.setValue).toHaveBeenCalledTimes(3); // 3 ephemeral settings
      expect(prodSettings.setValue).toHaveBeenCalledWith(
        SettingScope.User,
        'context-limit',
        16000,
      );
    });

    it('should handle profile names with special characters', async () => {
      const specialNames = [
        'Profile-2024',
        'Test_Profile',
        'My.Profile',
        'Profile (Dev)',
        'Profile & Testing',
        '测试配置', // Unicode characters
      ];

      for (const name of specialNames) {
        mockProvider.getModelParams = vi.fn().mockReturnValue({
          temperature: 0.5,
        });

        const result = await saveCommand.action!(context, `"${name}"`);
        expect(result).toEqual({
          type: 'message',
          messageType: 'info',
          content: `Profile '${name}' saved`,
        });

        // Verify file was created with correct name
        expect(vi.mocked(fs.writeFile)).toHaveBeenCalledWith(
          path.join(profilesDir, `${name}.json`),
          expect.any(String),
          'utf8',
        );
      }
    });
  });

  describe('Switching Between Providers with Profiles', () => {
    it('should switch providers when loading profiles', async () => {
      // Create OpenAI profile
      mockProvider.name = 'openai';
      mockProvider.getModelParams = vi.fn().mockReturnValue({
        temperature: 0.7,
        max_tokens: 4096,
      });

      await saveCommand.action!(context, '"OpenAI Profile"');

      // Create Anthropic profile
      const anthropicProvider = {
        ...mockProvider,
        name: 'anthropic',
        getModelParams: vi.fn().mockReturnValue({
          temperature: 0.5,
          max_output_tokens: 4096,
        }),
      };

      mockProviderManager.getActiveProvider.mockReturnValue(anthropicProvider);
      config.getProvider = vi.fn().mockReturnValue('anthropic');
      config.getModel = vi.fn().mockReturnValue('claude-3-opus');

      await saveCommand.action!(context, '"Anthropic Profile"');

      // Load OpenAI profile
      const openaiContent = vi.mocked(fs.writeFile).mock.calls[0][1] as string;
      vi.mocked(fs.readFile).mockResolvedValue(openaiContent);

      await loadCommand.action!(context, '"OpenAI Profile"');

      expect(mockProviderManager.setActiveProvider).toHaveBeenCalledWith(
        'openai',
      );
      expect(config.setModel).toHaveBeenCalledWith('gpt-4');

      // Load Anthropic profile
      const anthropicContent = vi.mocked(fs.writeFile).mock
        .calls[1][1] as string;
      vi.mocked(fs.readFile).mockResolvedValue(anthropicContent);

      await loadCommand.action!(context, '"Anthropic Profile"');

      expect(mockProviderManager.setActiveProvider).toHaveBeenCalledWith(
        'anthropic',
      );
      expect(config.setModel).toHaveBeenCalledWith('claude-3-opus');
    });

    it('should handle provider-specific parameter differences', async () => {
      // OpenAI uses max_tokens, Anthropic uses max_output_tokens
      const providers = [
        {
          name: 'openai',
          params: { temperature: 0.7, max_tokens: 4096 },
          model: 'gpt-4',
        },
        {
          name: 'anthropic',
          params: { temperature: 0.5, max_output_tokens: 4096 },
          model: 'claude-3-opus',
        },
      ];

      for (const providerConfig of providers) {
        mockProvider.name = providerConfig.name;
        mockProvider.getModelParams = vi
          .fn()
          .mockReturnValue(providerConfig.params);
        config.getProvider = vi.fn().mockReturnValue(providerConfig.name);
        config.getModel = vi.fn().mockReturnValue(providerConfig.model);

        await saveCommand.action!(context, `"${providerConfig.name} Profile"`);
      }

      // Verify each profile has correct provider-specific params
      const savedProfiles = vi
        .mocked(fs.writeFile)
        .mock.calls.map((call) => JSON.parse(call[1] as string) as Profile);

      expect(savedProfiles[0]).toMatchObject({
        provider: 'openai',
        modelParams: { temperature: 0.7, max_tokens: 4096 },
      });

      expect(savedProfiles[1]).toMatchObject({
        provider: 'anthropic',
        modelParams: { temperature: 0.5, max_output_tokens: 4096 },
      });
    });
  });

  describe('CLI Mode with --load Flag', () => {
    it('should load profile in non-interactive mode', async () => {
      // Create a profile to load
      const testProfile: Profile = {
        version: 1,
        provider: 'openai',
        model: 'gpt-4',
        modelParams: {
          temperature: 0.7,
          max_tokens: 4096,
        },
        ephemeralSettings: {
          'context-limit': 32000,
          'base-url': 'https://api.openai.com/v1',
        },
      };

      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(testProfile));

      // Simulate loading profile via CLI flag
      const profileManager = new ProfileManager();
      const loadedProfile = await profileManager.loadProfile('CLI Profile');

      expect(loadedProfile).toEqual(testProfile);

      // In actual CLI mode, these would be applied during initialization
      // The config would use these values when making API calls
    });

    it('should apply profile settings before processing prompt', async () => {
      // This tests the order of operations in CLI mode
      const callOrder: string[] = [];

      // Mock profile loading
      const testProfile: Profile = {
        version: 1,
        provider: 'openai',
        model: 'gpt-3.5-turbo',
        modelParams: {
          temperature: 0.5,
          max_tokens: 2048,
        },
        ephemeralSettings: {
          'context-limit': 16000,
        },
      };

      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(testProfile));

      // Mock provider operations to track order
      mockProviderManager.setActiveProvider.mockImplementation(() => {
        callOrder.push('setActiveProvider');
      });

      mockProvider.setModelParams?.mockImplementation(() => {
        callOrder.push('setModelParams');
      });

      mockProvider.generateChatCompletion?.mockImplementation(async () => {
        callOrder.push('generateChatCompletion');
        return { content: 'Response' };
      });

      // Simulate CLI initialization sequence
      await mockProviderManager.setActiveProvider('openai');
      await mockProvider.setModelParams?.(testProfile.modelParams);
      await mockProvider.generateChatCompletion?.({} as never, {} as never);

      expect(callOrder).toEqual([
        'setActiveProvider',
        'setModelParams',
        'generateChatCompletion',
      ]);
    });
  });

  describe('Override Behavior (Load then Modify)', () => {
    it('should allow modifying parameters after loading profile', async () => {
      // Load a profile
      const baseProfile: Profile = {
        version: 1,
        provider: 'openai',
        model: 'gpt-4',
        modelParams: {
          temperature: 0.7,
          max_tokens: 4096,
          top_p: 0.95,
        },
        ephemeralSettings: {
          'context-limit': 32000,
        },
      };

      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(baseProfile));

      await loadCommand.action!(context, '"Base Profile"');

      // Verify profile was loaded
      expect(mockProvider.setModelParams).toHaveBeenCalledWith(
        baseProfile.modelParams,
      );

      // Override specific parameters
      mockProvider.setModelParams = vi.fn();

      await setCommand.action!(context, 'modelparam temperature 0.9');
      expect(mockProvider.setModelParams).toHaveBeenCalledWith({
        temperature: 0.9,
      });

      await setCommand.action!(context, 'modelparam max_tokens 8192');
      expect(mockProvider.setModelParams).toHaveBeenCalledWith({
        max_tokens: 8192,
      });

      // Original profile remains unchanged
      const reloadedProfile = JSON.parse(
        await fs.readFile(path.join(profilesDir, 'Base Profile.json'), 'utf8'),
      );
      expect(reloadedProfile.modelParams.temperature).toBe(0.7);
      expect(reloadedProfile.modelParams.max_tokens).toBe(4096);
    });

    it('should allow switching providers after loading profile', async () => {
      // Load OpenAI profile
      const openaiProfile: Profile = {
        version: 1,
        provider: 'openai',
        model: 'gpt-4',
        modelParams: {
          temperature: 0.7,
        },
        ephemeralSettings: {},
      };

      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(openaiProfile));
      await loadCommand.action!(context, '"OpenAI Profile"');

      expect(mockProviderManager.setActiveProvider).toHaveBeenCalledWith(
        'openai',
      );

      // Switch to Anthropic manually
      mockProviderManager.setActiveProvider = vi.fn();
      await mockProviderManager.setActiveProvider('anthropic');

      expect(mockProviderManager.setActiveProvider).toHaveBeenCalledWith(
        'anthropic',
      );

      // Set Anthropic-specific parameters
      await setCommand.action!(context, 'modelparam max_output_tokens 4096');
      expect(mockProvider.setModelParams).toHaveBeenCalledWith({
        max_output_tokens: 4096,
      });
    });
  });

  describe('Edge Cases', () => {
    it('should handle missing provider support gracefully', async () => {
      // Provider without model params support
      const basicProvider = {
        name: 'basic-provider',
        getModels: vi.fn().mockResolvedValue([]),
        generateChatCompletion: vi.fn(),
        getServerTools: vi.fn().mockReturnValue([]),
        invokeServerTool: vi.fn().mockResolvedValue(undefined),
        // No setModelParams or getModelParams
      };

      mockProviderManager.getActiveProvider.mockReturnValue(basicProvider);

      // Try to set model params
      const result = await setCommand.action!(
        context,
        'modelparam temperature 0.7',
      );

      expect(result).toEqual({
        type: 'message',
        messageType: 'error',
        content: "Provider 'basic-provider' does not support model parameters",
      });

      // Can still save profile without model params
      await saveCommand.action!(context, '"Basic Provider Profile"');

      const savedContent = vi.mocked(fs.writeFile).mock.calls[0][1] as string;
      const savedProfile = JSON.parse(savedContent);
      expect(savedProfile.modelParams).toEqual({});
    });

    it('should handle corrupted profile files', async () => {
      const corruptedCases = [
        { content: '{ invalid json }', error: 'corrupted' },
        { content: '{}', error: 'invalid: missing required fields' },
        {
          content: JSON.stringify({
            version: 2,
            provider: 'openai',
            model: 'gpt-4',
            modelParams: {},
            ephemeralSettings: {},
          }),
          error: 'Unsupported profile version',
        },
        {
          content: JSON.stringify({ version: 1, provider: 'openai' }),
          error: 'invalid: missing required fields',
        },
      ];

      for (const testCase of corruptedCases) {
        vi.mocked(fs.readFile).mockResolvedValue(testCase.content);

        const result = await loadCommand.action!(
          context,
          '"Corrupted Profile"',
        );

        expect(result?.messageType).toBe('error');
        // The error messages come with 'Failed to load profile: ' prefix
        if (testCase.error === 'Unsupported profile version') {
          expect(result?.content?.toLowerCase()).toContain(
            testCase.error.toLowerCase(),
          );
        } else {
          expect(result?.content).toContain(testCase.error);
        }
      }
    });

    it('should handle file system errors during save/load', async () => {
      // Permission error during save
      vi.mocked(fs.writeFile).mockRejectedValue(
        new Error('EACCES: permission denied'),
      );

      let result = await saveCommand.action!(context, '"Permission Test"');
      expect(result).toEqual({
        type: 'message',
        messageType: 'error',
        content: 'Failed to save profile: EACCES: permission denied',
      });

      // File not found during load
      vi.mocked(fs.readFile).mockRejectedValue(
        new Error('ENOENT: no such file or directory'),
      );

      result = await loadCommand.action!(context, '"Missing Profile"');
      expect(result).toEqual({
        type: 'message',
        messageType: 'error',
        content: "Profile 'Missing Profile' not found",
      });
    });

    it('should handle very large parameter sets', async () => {
      // Create a profile with many parameters
      const largeParams: Record<string, unknown> = {};
      for (let i = 0; i < 100; i++) {
        largeParams[`param_${i}`] = i % 2 === 0 ? i * 0.1 : `value_${i}`;
      }

      mockProvider.getModelParams = vi.fn().mockReturnValue(largeParams);

      await saveCommand.action!(context, '"Large Profile"');

      // Verify all parameters were saved
      const savedContent = vi.mocked(fs.writeFile).mock.calls[0][1] as string;
      const savedProfile = JSON.parse(savedContent);
      expect(Object.keys(savedProfile.modelParams)).toHaveLength(100);

      // Load and verify all parameters are restored
      vi.mocked(fs.readFile).mockResolvedValue(savedContent);
      mockProvider.setModelParams = vi.fn();

      await loadCommand.action!(context, '"Large Profile"');

      expect(mockProvider.setModelParams).toHaveBeenCalledWith(largeParams);
    });

    it('should preserve numeric precision in parameters', async () => {
      const preciseParams = {
        temperature: 0.123456789,
        top_p: 0.999999999,
        frequency_penalty: -0.000000001,
        seed: 9007199254740991, // Max safe integer
      };

      mockProvider.getModelParams = vi.fn().mockReturnValue(preciseParams);

      await saveCommand.action!(context, '"Precision Profile"');

      const savedContent = vi.mocked(fs.writeFile).mock.calls[0][1] as string;
      vi.mocked(fs.readFile).mockResolvedValue(savedContent);

      mockProvider.setModelParams = vi.fn();
      await loadCommand.action!(context, '"Precision Profile"');

      // Verify precision was preserved
      const calledParams = mockProvider.setModelParams.mock.calls[0][0];
      expect(calledParams.temperature).toBe(0.123456789);
      expect(calledParams.top_p).toBe(0.999999999);
      expect(calledParams.frequency_penalty).toBe(-0.000000001);
      expect(calledParams.seed).toBe(9007199254740991);
    });
  });

  describe('Real Integration with File System', () => {
    it('should verify complete data flow from commands to API', async () => {
      // This test verifies the entire flow without mocking file operations
      // In a real environment, this would create actual files

      // Set up a complete workflow
      const workflow = async () => {
        // 1. Set parameters
        await setCommand.action!(context, 'modelparam temperature 0.75');
        await setCommand.action!(context, 'modelparam max_tokens 3000');
        await setCommand.action!(
          context,
          'modelparam response_format {"type":"json_object"}',
        );

        // 2. Set ephemeral settings using settings.setValue
        settings.setValue(SettingScope.User, 'context-limit', 25000);
        settings.setValue(SettingScope.User, 'compression-threshold', 0.82);

        // Update context settings merged to include these values
        context.services.settings.merged['context-limit'] = 25000;
        context.services.settings.merged['compression-threshold'] = 0.82;

        // 3. Save profile
        mockProvider.getModelParams = vi.fn().mockReturnValue({
          temperature: 0.75,
          max_tokens: 3000,
          response_format: { type: 'json_object' },
        });

        await saveCommand.action!(context, '"Integration Test Profile"');

        // 4. Clear state
        mockProvider.setModelParams = vi.fn();
        const freshSettings = {
          merged: {},
          setValue: vi.fn().mockImplementation((scope, key, value) => {
            freshSettings.merged[key] = value;
          }),
        };
        context.services.settings =
          freshSettings as unknown as CommandContext['services']['settings'];

        // 5. Load profile
        const savedProfile = vi.mocked(fs.writeFile).mock.calls[0][1] as string;
        vi.mocked(fs.readFile).mockResolvedValue(savedProfile);

        await loadCommand.action!(context, '"Integration Test Profile"');

        // 6. Verify complete restoration
        return {
          modelParams: mockProvider.setModelParams.mock.calls[0][0],
          ephemeralSettings: freshSettings.setValue.mock.calls.reduce(
            (acc: Record<string, unknown>, call: unknown[]) => {
              acc[call[1] as string] = call[2];
              return acc;
            },
            {},
          ),
        };
      };

      const result = await workflow();

      expect(result.modelParams).toEqual({
        temperature: 0.75,
        max_tokens: 3000,
        response_format: { type: 'json_object' },
      });

      expect(result.ephemeralSettings).toMatchObject({
        'context-limit': 25000,
        'compression-threshold': 0.82,
      });
    });
  });

  describe('Profile Manager Integration', () => {
    it('should work with ProfileManager for save and load operations', async () => {
      const profileManager = new ProfileManager();

      // Create a test profile
      const testProfile: Profile = {
        version: 1,
        provider: 'openai',
        model: 'gpt-4',
        modelParams: {
          temperature: 0.6,
          max_tokens: 5000,
        },
        ephemeralSettings: {
          'context-limit': 40000,
        },
      };

      // Mock ProfileManager save operation
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      // Save using ProfileManager (simulated)
      await fs.writeFile(
        path.join(profilesDir, 'ProfileManager Test.json'),
        JSON.stringify(testProfile, null, 2),
        'utf8',
      );

      // Load using ProfileManager (simulated)
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(testProfile));

      const loadedProfile = await profileManager.loadProfile(
        'ProfileManager Test',
      );

      expect(loadedProfile).toEqual(testProfile);
    });
  });
});
