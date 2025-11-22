/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Config } from '@vybestack/llxprt-code-core';
import {
  dynamicSettingsRegistry,
  generateDynamicToolSettings,
} from './dynamicSettings.js';
import type { SettingDefinition } from '../config/settingsSchema.js';

// Mock console methods to avoid noise in tests
const originalConsoleError = console.error;
const originalConsoleWarn = console.warn;
const originalConsoleDebug = console.debug;

describe('DynamicSettingsRegistry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    console.error = vi.fn();
    console.warn = vi.fn();
    console.debug = vi.fn();
    // Reset registry for each test
    dynamicSettingsRegistry.reset();
  });

  afterEach(() => {
    console.error = originalConsoleError;
    console.warn = originalConsoleWarn;
    console.debug = originalConsoleDebug;
  });

  describe('register', () => {
    it('should register settings successfully', () => {
      const settings: Record<string, SettingDefinition> = {
        'test.setting': {
          type: 'boolean',
          label: 'Test Setting',
          category: 'Test',
          requiresRestart: true,
          default: true,
          description: 'A test setting',
          showInDialog: true,
        },
      };

      expect(() => dynamicSettingsRegistry.register(settings)).not.toThrow();
      expect(dynamicSettingsRegistry.has('test.setting')).toBe(true);
    });

    it('should throw error on duplicate registration', () => {
      const settings: Record<string, SettingDefinition> = {
        'test.setting': {
          type: 'boolean',
          label: 'Test Setting',
          category: 'Test',
          requiresRestart: true,
          default: true,
          description: 'A test setting',
          showInDialog: true,
        },
      };

      dynamicSettingsRegistry.register(settings);

      expect(() => dynamicSettingsRegistry.register(settings)).toThrow(
        'DynamicSettingsRegistry: Already initialized. Use reset() if needed.',
      );
    });

    it('should validate settings structure', () => {
      const invalidSettings = {
        'invalid.setting': {
          // Missing required fields
          type: 'boolean',
          // label is missing
        } as SettingDefinition,
      };

      expect(() => dynamicSettingsRegistry.register(invalidSettings)).toThrow(
        "Setting definition for key 'invalid.setting' must have a valid label",
      );
    });

    it('should throw error for non-object settings', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(() => dynamicSettingsRegistry.register(null as any)).toThrow(
        'Settings must be a valid object',
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(() => dynamicSettingsRegistry.register(undefined as any)).toThrow(
        'Settings must be a valid object',
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(() => dynamicSettingsRegistry.register('string' as any)).toThrow(
        'Settings must be a valid object',
      );
    });
  });

  describe('get', () => {
    beforeEach(() => {
      const settings: Record<string, SettingDefinition> = {
        'test.boolean': {
          type: 'boolean',
          label: 'Boolean Setting',
          category: 'Test',
          requiresRestart: false,
          default: true,
          description: 'A boolean setting',
          showInDialog: true,
        },
        'test.string': {
          type: 'string',
          label: 'String Setting',
          category: 'Test',
          requiresRestart: true,
          default: 'default',
          description: 'A string setting',
          showInDialog: true,
        },
      };

      dynamicSettingsRegistry.register(settings);
    });

    it('should retrieve registered settings', () => {
      const booleanSetting = dynamicSettingsRegistry.get('test.boolean');
      expect(booleanSetting).toBeDefined();
      expect(booleanSetting?.type).toBe('boolean');
      expect(booleanSetting?.label).toBe('Boolean Setting');
    });

    it('should return undefined for non-existent keys', () => {
      const nonExistent = dynamicSettingsRegistry.get('non.existent');
      expect(nonExistent).toBeUndefined();
    });
  });

  describe('has', () => {
    beforeEach(() => {
      const settings: Record<string, SettingDefinition> = {
        'test.setting': {
          type: 'boolean',
          label: 'Test Setting',
          category: 'Test',
          requiresRestart: true,
          default: true,
          description: 'A test setting',
          showInDialog: true,
        },
      };

      dynamicSettingsRegistry.register(settings);
    });

    it('should return true for existing keys', () => {
      expect(dynamicSettingsRegistry.has('test.setting')).toBe(true);
    });

    it('should return false for non-existent keys', () => {
      expect(dynamicSettingsRegistry.has('non.existent')).toBe(false);
    });
  });

  describe('requiresRestart', () => {
    beforeEach(() => {
      const settings: Record<string, SettingDefinition> = {
        'restart.required': {
          type: 'boolean',
          label: 'Restart Required',
          category: 'Test',
          requiresRestart: true,
          default: true,
          description: 'Requires restart',
          showInDialog: true,
        },
        'restart.notRequired': {
          type: 'boolean',
          label: 'No Restart Required',
          category: 'Test',
          requiresRestart: false,
          default: true,
          description: 'Does not require restart',
          showInDialog: true,
        },
      };

      dynamicSettingsRegistry.register(settings);
    });

    it('should return true for settings that require restart', () => {
      expect(dynamicSettingsRegistry.requiresRestart('restart.required')).toBe(
        true,
      );
    });

    it('should return false for settings that do not require restart', () => {
      expect(
        dynamicSettingsRegistry.requiresRestart('restart.notRequired'),
      ).toBe(false);
    });

    it('should return false for non-existent settings', () => {
      expect(dynamicSettingsRegistry.requiresRestart('non.existent')).toBe(
        false,
      );
    });
  });

  describe('reset', () => {
    it('should reset the registry to initial state', () => {
      const settings: Record<string, SettingDefinition> = {
        'test.setting': {
          type: 'boolean',
          label: 'Test Setting',
          category: 'Test',
          requiresRestart: true,
          default: true,
          description: 'A test setting',
          showInDialog: true,
        },
      };

      dynamicSettingsRegistry.register(settings);
      expect(dynamicSettingsRegistry.has('test.setting')).toBe(true);

      dynamicSettingsRegistry.reset();
      expect(dynamicSettingsRegistry.has('test.setting')).toBe(false);

      // Should be able to register again after reset
      expect(() => dynamicSettingsRegistry.register(settings)).not.toThrow();
    });
  });
});

describe('generateDynamicToolSettings', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockConfig: any;

  const mockRegisteredTools = [
    {
      toolClass: 'ReadFileTool',
      toolName: 'ReadFile',
      displayName: 'Read File',
      isRegistered: true,
      args: [],
    },
    {
      toolClass: 'WriteFileTool',
      toolName: 'WriteFile',
      displayName: 'Write File',
      isRegistered: true,
      args: [],
    },
    {
      toolClass: 'ShellTool',
      toolName: 'Shell',
      displayName: 'Shell Command',
      isRegistered: true,
      args: [],
    },
  ];

  const mockUnregisteredTools = [
    {
      toolClass: 'TaskTool',
      toolName: 'Task',
      displayName: 'Task',
      isRegistered: false,
      reason: 'requires profile manager and subagent manager',
      args: [],
    },
    {
      toolClass: 'ListSubagentsTool',
      toolName: 'ListSubagents',
      displayName: 'List Subagents',
      isRegistered: false,
      reason: 'requires subagent manager',
      args: [],
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    console.error = vi.fn();
    console.debug = vi.fn();

    mockConfig = {
      getToolRegistryInfo: vi.fn(() => ({
        registered: mockRegisteredTools,
        unregistered: mockUnregisteredTools,
      })),
    };
  });

  afterEach(() => {
    console.error = originalConsoleError;
    console.debug = originalConsoleDebug;
  });

  it('should generate settings for registered tools', () => {
    const toolSettings = generateDynamicToolSettings(mockConfig);

    expect(toolSettings).toHaveProperty('ReadFile');
    expect(toolSettings).toHaveProperty('WriteFile');
    expect(toolSettings).toHaveProperty('ShellCommand');

    const readFileSetting = toolSettings.ReadFile;
    expect(readFileSetting.type).toBe('boolean');
    expect(readFileSetting.label).toBe('Read File');
    expect(readFileSetting.category).toBe('Advanced');
    expect(readFileSetting.requiresRestart).toBe(true);
    expect(readFileSetting.default).toBe(true);
    expect(readFileSetting.showInDialog).toBe(true);
  });

  it('should generate settings for unregistered tools', () => {
    const toolSettings = generateDynamicToolSettings(mockConfig);

    expect(toolSettings).toHaveProperty('Task');
    expect(toolSettings).toHaveProperty('ListSubagents');

    const taskSetting = toolSettings.Task;
    expect(taskSetting.type).toBe('boolean');
    expect(taskSetting.label).toBe('Task');
    expect(taskSetting.category).toBe('Advanced');
    expect(taskSetting.requiresRestart).toBe(true);
    expect(taskSetting.default).toBe(false); // Unregistered tools default to false
    expect(taskSetting.showInDialog).toBe(true);
    expect(taskSetting.description).toContain(
      'unavailable: requires profile manager and subagent manager',
    );
  });

  it('should handle tools with spaces in names correctly', () => {
    const toolSettings = generateDynamicToolSettings(mockConfig);

    // Spaces should be removed from setting keys
    expect(toolSettings).toHaveProperty('ShellCommand');
    expect(toolSettings.ShellCommand.label).toBe('Shell Command');
  });

  it('should return empty object when config is undefined', () => {
    const toolSettings = generateDynamicToolSettings(undefined);
    expect(toolSettings).toEqual({});
  });

  it('should handle empty tool registry', () => {
    mockConfig.getToolRegistryInfo.mockReturnValue({
      registered: [],
      unregistered: [],
    });

    const toolSettings = generateDynamicToolSettings(mockConfig);
    expect(toolSettings).toEqual({});
  });

  it('should handle only unregistered tools', () => {
    mockConfig.getToolRegistryInfo.mockReturnValue({
      registered: [],
      unregistered: mockUnregisteredTools,
    });

    const toolSettings = generateDynamicToolSettings(mockConfig);
    expect(Object.keys(toolSettings)).toHaveLength(2);
    expect(toolSettings).toHaveProperty('Task');
    expect(toolSettings).toHaveProperty('ListSubagents');
  });

  it('should handle tool registry errors gracefully', () => {
    const errorConfig = {
      getToolRegistryInfo: vi.fn(() => {
        throw new Error('Tool registry error');
      }),
    } as unknown as Config;

    const toolSettings = generateDynamicToolSettings(errorConfig);
    expect(toolSettings).toEqual({});
    expect(console.error).toHaveBeenCalledWith(
      '[generateDynamicToolSettings] Error:',
      expect.any(Error),
    );
  });

  it('should log debug information for registered tools', () => {
    generateDynamicToolSettings(mockConfig);

    expect(console.debug).toHaveBeenCalledWith(
      '[generateDynamicToolSettings] Processing 3 registered and 2 unregistered tools',
    );
    expect(console.debug).toHaveBeenCalledWith(
      '[generateDynamicToolSettings]   ✅ REGISTERED: Read File',
    );
    expect(console.debug).toHaveBeenCalledWith(
      '[generateDynamicToolSettings]   ✅ REGISTERED: Write File',
    );
    expect(console.debug).toHaveBeenCalledWith(
      '[generateDynamicToolSettings]   ✅ REGISTERED: Shell Command',
    );
  });

  it('should log debug information for unregistered tools', () => {
    generateDynamicToolSettings(mockConfig);

    expect(console.debug).toHaveBeenCalledWith(
      '[generateDynamicToolSettings]   🚫 UNREGISTERED: Task - requires profile manager and subagent manager',
    );
    expect(console.debug).toHaveBeenCalledWith(
      '[generateDynamicToolSettings]   🚫 UNREGISTERED: List Subagents - requires subagent manager',
    );
  });

  it('should log final tool settings count', () => {
    generateDynamicToolSettings(mockConfig);

    expect(console.debug).toHaveBeenCalledWith(
      '[generateDynamicToolSettings] Final toolSettings count: 5',
    );
  });
});
