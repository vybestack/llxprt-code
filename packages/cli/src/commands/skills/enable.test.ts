/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  vi,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  type Mock,
} from 'bun:test';
import { format } from 'node:util';
import { handleEnable, enableCommand } from './enable.js';
import {
  loadSettings,
  SettingScope,
  type LoadedSettings,
} from '../../config/settings.js';

const emitConsoleLog = vi.fn();
const debugLogger = {
  log: vi.fn((message, ...args) => {
    emitConsoleLog('log', format(message, ...args));
  }),
};

const actual = { ...(await import('@vybestack/llxprt-code-telemetry')) };
void vi.mock('@vybestack/llxprt-code-telemetry', () => {
  return {
    ...actual,
    debugLogger,
  };
});

const actualActual = { ...(await import('../../config/settings.js')) };
void vi.mock('../../config/settings.js', () => {
  return {
    ...actualActual,
    loadSettings: vi.fn(),
    isLoadableSettingScope: vi.fn((s) => s === 'User' || s === 'Workspace'),
  };
});

void vi.mock('../utils.js', () => ({
  exitCli: vi.fn(),
}));

describe('skills enable command', () => {
  const mockLoadSettings = loadSettings as Mock<typeof loadSettings>;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('handleEnable', () => {
    it('should enable a disabled skill in user scope', async () => {
      const mockSettings = {
        forScope: vi.fn().mockImplementation((scope) => {
          if (scope === SettingScope.User) {
            return {
              settings: { skills: { disabled: ['skill1'] } },
              path: '/user/settings.json',
            };
          }
          return { settings: {}, path: '/workspace/settings.json' };
        }),
        setValue: vi.fn(),
      };
      mockLoadSettings.mockReturnValue(
        mockSettings as unknown as LoadedSettings,
      );

      await handleEnable({ name: 'skill1' });

      expect(mockSettings.setValue).toHaveBeenCalledWith(
        SettingScope.User,
        'skills.disabled',
        [],
      );
      expect(emitConsoleLog).toHaveBeenCalledWith(
        'log',
        'Skill "skill1" enabled by removing it from the disabled list in user (/user/settings.json) and workspace (/workspace/settings.json) settings. Restart required to take effect.',
      );
    });

    it('should enable a skill across multiple scopes', async () => {
      const mockSettings = {
        forScope: vi.fn().mockImplementation((scope) => {
          if (scope === SettingScope.User) {
            return {
              settings: { skills: { disabled: ['skill1'] } },
              path: '/user/settings.json',
            };
          }
          if (scope === SettingScope.Workspace) {
            return {
              settings: { skills: { disabled: ['skill1'] } },
              path: '/workspace/settings.json',
            };
          }
          return { settings: {}, path: '' };
        }),
        setValue: vi.fn(),
      };
      mockLoadSettings.mockReturnValue(
        mockSettings as unknown as LoadedSettings,
      );

      await handleEnable({ name: 'skill1' });

      expect(mockSettings.setValue).toHaveBeenCalledWith(
        SettingScope.User,
        'skills.disabled',
        [],
      );
      expect(mockSettings.setValue).toHaveBeenCalledWith(
        SettingScope.Workspace,
        'skills.disabled',
        [],
      );
      expect(emitConsoleLog).toHaveBeenCalledWith(
        'log',
        'Skill "skill1" enabled by removing it from the disabled list in workspace (/workspace/settings.json) and user (/user/settings.json) settings. Restart required to take effect.',
      );
    });

    it('should log a message if the skill is already enabled', async () => {
      const mockSettings = {
        forScope: vi.fn().mockReturnValue({
          settings: { skills: { disabled: [] } },
          path: '/user/settings.json',
        }),
        setValue: vi.fn(),
      };
      mockLoadSettings.mockReturnValue(
        mockSettings as unknown as LoadedSettings,
      );

      await handleEnable({ name: 'skill1' });

      expect(mockSettings.setValue).not.toHaveBeenCalled();
      expect(emitConsoleLog).toHaveBeenCalledWith(
        'log',
        'Skill "skill1" is already enabled.',
      );
    });
  });

  describe('enableCommand', () => {
    it('should have correct command and describe', () => {
      expect(enableCommand.command).toBe('enable <name>');
      expect(enableCommand.describe).toBe('Enables a skill.');
    });
  });
});
