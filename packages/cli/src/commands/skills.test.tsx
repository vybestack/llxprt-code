/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi } from 'bun:test';
import type { ArgumentsCamelCase, Argv } from 'yargs';
import { skillsCommand } from './skills.js';

type SkillsBuilder = (yargs: Argv) => Argv | PromiseLike<Argv>;

function getSkillsBuilder(): SkillsBuilder {
  const builder = skillsCommand.builder;
  if (typeof builder !== 'function') {
    throw new Error('skills command builder must be a function');
  }
  return builder;
}

void vi.mock('./skills/list.js', () => ({ listCommand: { command: 'list' } }));
void vi.mock('./skills/enable.js', () => ({
  enableCommand: { command: 'enable <name>' },
}));
void vi.mock('./skills/disable.js', () => ({
  disableCommand: { command: 'disable <name>' },
}));
void vi.mock('./skills/install.js', () => ({
  installCommand: { command: 'install <source> [--scope] [--path]' },
}));
void vi.mock('./skills/uninstall.js', () => ({
  uninstallCommand: { command: 'uninstall <name> [--scope]' },
}));

void vi.mock('../session/outputListeners.js', () => ({
  initializeOutputListenersAndFlush: vi.fn(),
}));

describe('skillsCommand', () => {
  it('should have correct command and aliases', () => {
    expect(skillsCommand.command).toBe('skills <command>');
    expect(skillsCommand.aliases).toStrictEqual(['skill']);
    expect(skillsCommand.describe).toBe('Manage skills.');
  });

  it('should register all subcommands in builder', () => {
    const mockYargs = {
      middleware: vi.fn().mockReturnThis(),
      command: vi.fn().mockReturnThis(),
      demandCommand: vi.fn().mockReturnThis(),
      version: vi.fn().mockReturnThis(),
    } as unknown as Argv;

    getSkillsBuilder()(mockYargs);

    expect(mockYargs.middleware).toHaveBeenCalled();
    expect(mockYargs.command).toHaveBeenCalledWith({ command: 'list' });
    expect(mockYargs.command).toHaveBeenCalledWith({
      command: 'enable <name>',
    });
    expect(mockYargs.command).toHaveBeenCalledWith({
      command: 'disable <name>',
    });
    expect(mockYargs.command).toHaveBeenCalledWith({
      command: 'install <source> [--scope] [--path]',
    });
    expect(mockYargs.command).toHaveBeenCalledWith({
      command: 'uninstall <name> [--scope]',
    });
    expect(mockYargs.demandCommand).toHaveBeenCalledWith(1, expect.any(String));
    expect(mockYargs.version).toHaveBeenCalledWith(false);
  });

  it('should have a handler that does nothing', () => {
    expect(skillsCommand.handler({} as ArgumentsCamelCase)).toBeUndefined();
  });
});
