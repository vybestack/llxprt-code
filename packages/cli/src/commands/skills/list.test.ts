/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { format } from 'node:util';
import { handleList, listCommand } from './list.js';
import { loadSettings, type LoadedSettings } from '../../config/settings.js';
import { loadCliConfig } from '../../config/config.js';
import {
  discoverSkillsForConfig,
  type SkillDefinition,
  type Config,
} from '@vybestack/llxprt-code-core';
import chalk from 'chalk';

const emitConsoleLog = vi.hoisted(() => vi.fn());
const debugLogger = vi.hoisted(() => ({
  log: vi.fn((message, ...args) => {
    emitConsoleLog('log', format(message, ...args));
  }),
  error: vi.fn((message, ...args) => {
    emitConsoleLog('error', format(message, ...args));
  }),
}));

vi.mock('@vybestack/llxprt-code-core', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@vybestack/llxprt-code-core')>();
  return {
    ...actual,
    // discoverSkillsForConfig owns the session MessageBus + Config.initialize
    // lifecycle (behaviorally tested in core/skills/skillDiscovery.test.ts).
    // Here it is stubbed as the external boundary so these tests focus on the
    // command's display/filtering behavior. The command does not emit through
    // core events; logging goes through the telemetry-package debugLogger,
    // whose owner is mocked below.
    discoverSkillsForConfig: vi.fn(),
  };
});

// list.ts logs through the telemetry-package debugLogger (its owner after
// #2378), so mock THAT package here — not core — to capture the command's
// output via the emitConsoleLog spy while core events stay real.
vi.mock('@vybestack/llxprt-code-telemetry', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@vybestack/llxprt-code-telemetry')>();
  Object.assign(actual.debugLogger, debugLogger);
  return actual;
});

vi.mock('../../config/settings.js');
vi.mock('../../config/config.js');
vi.mock('../utils.js', () => ({
  exitCli: vi.fn(),
}));

function skill(overrides: Partial<SkillDefinition>): SkillDefinition {
  return {
    name: 'skill',
    description: 'desc',
    location: '/path/to/skill',
    body: 'body',
    disabled: false,
    ...overrides,
  } as SkillDefinition;
}

describe('skills list command', () => {
  const mockLoadSettings = vi.mocked(loadSettings);
  const mockLoadCliConfig = vi.mocked(loadCliConfig);
  const mockDiscoverSkills = vi.mocked(discoverSkillsForConfig);
  const mockConfig = {} as unknown as Config;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockLoadSettings.mockReturnValue({
      merged: {},
    } as unknown as LoadedSettings);
    mockLoadCliConfig.mockResolvedValue(mockConfig);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('handleList', () => {
    it('discovers skills through the public core discovery API (no CLI-owned runtime assembly)', async () => {
      mockDiscoverSkills.mockResolvedValue([]);

      await handleList();

      expect(mockDiscoverSkills).toHaveBeenCalledTimes(1);
      expect(mockDiscoverSkills).toHaveBeenCalledWith(mockConfig);
    });

    it('should log a message if no skills are discovered', async () => {
      mockDiscoverSkills.mockResolvedValue([]);

      await handleList();

      expect(emitConsoleLog).toHaveBeenCalledWith(
        'log',
        'No skills discovered.',
      );
    });

    it('should list all discovered skills', async () => {
      mockDiscoverSkills.mockResolvedValue([
        skill({
          name: 'skill1',
          description: 'desc1',
          disabled: false,
          location: '/path/to/skill1',
          source: 'user',
        }),
        skill({
          name: 'skill2',
          description: 'desc2',
          disabled: true,
          location: '/path/to/skill2',
          source: 'project',
        }),
      ]);

      await handleList();

      expect(emitConsoleLog).toHaveBeenCalledWith(
        'log',
        chalk.bold('Discovered Skills:'),
      );
      expect(emitConsoleLog).toHaveBeenCalledWith(
        'log',
        expect.stringContaining('skill1'),
      );
      expect(emitConsoleLog).toHaveBeenCalledWith(
        'log',
        expect.stringContaining(chalk.green('[Enabled]')),
      );
      expect(emitConsoleLog).toHaveBeenCalledWith(
        'log',
        expect.stringContaining('skill2'),
      );
      expect(emitConsoleLog).toHaveBeenCalledWith(
        'log',
        expect.stringContaining(chalk.red('[Disabled]')),
      );
    });

    it('filters out built-in skills by default and includes them with showAll', async () => {
      mockDiscoverSkills.mockResolvedValue([
        skill({ name: 'user-skill', source: 'user' }),
        skill({ name: 'builtin-skill', source: 'builtin' }),
      ]);

      await handleList(false);

      const loggedDefault = emitConsoleLog.mock.calls
        .map((c) => c[1])
        .join('\n');
      expect(loggedDefault).toContain('user-skill');
      expect(loggedDefault).not.toContain('builtin-skill');

      emitConsoleLog.mockClear();
      mockDiscoverSkills.mockResolvedValue([
        skill({ name: 'user-skill', source: 'user' }),
        skill({ name: 'builtin-skill', source: 'builtin' }),
      ]);

      await handleList(true);

      const loggedAll = emitConsoleLog.mock.calls.map((c) => c[1]).join('\n');
      expect(loggedAll).toContain('user-skill');
      expect(loggedAll).toContain('builtin-skill');
    });

    it('should throw an error when listing fails', async () => {
      mockLoadCliConfig.mockRejectedValue(new Error('List failed'));

      await expect(handleList()).rejects.toThrow('List failed');
    });
  });

  describe('listCommand', () => {
    const command = listCommand;

    it('should have correct command and describe', () => {
      expect(command.command).toBe('list [--all]');
      expect(command.describe).toBe('Lists discovered skills.');
    });
  });
});
