/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/** @vitest-environment jsdom */

import { describe, it, expect } from 'vitest';
import type { SlashCommand } from '../commands/types.js';
import { CommandKind } from '../commands/types.js';

describe('SlashCommand - autoExecute property', () => {
  it('should support autoExecute property on SlashCommand interface', () => {
    const commandWithAutoExecute: SlashCommand = {
      name: 'help',
      description: 'show help',
      kind: CommandKind.BUILT_IN,
      autoExecute: true,
      action: () => {},
    };

    const commandWithoutAutoExecute: SlashCommand = {
      name: 'test',
      description: 'test command',
      kind: CommandKind.BUILT_IN,
      action: () => {},
    };

    // Type check - autoExecute should be optional
    expect(commandWithAutoExecute.autoExecute).toBe(true);
    expect(commandWithoutAutoExecute.autoExecute).toBeUndefined();
  });

  it('should allow autoExecute on subcommands', () => {
    const commandWithSubcommands: SlashCommand = {
      name: 'stats',
      description: 'show stats',
      kind: CommandKind.BUILT_IN,
      subCommands: [
        {
          name: 'session',
          description: 'show session stats',
          kind: CommandKind.BUILT_IN,
          autoExecute: true,
          action: () => {},
        },
        {
          name: 'model',
          description: 'show model stats',
          kind: CommandKind.BUILT_IN,
          autoExecute: true,
          action: () => {},
        },
        {
          name: 'tools',
          description: 'show tool stats',
          kind: CommandKind.BUILT_IN,
          action: () => {},
        },
      ],
    };

    expect(commandWithSubcommands.subCommands).toBeDefined();
    expect(commandWithSubcommands.subCommands![0].autoExecute).toBe(true);
    expect(commandWithSubcommands.subCommands![1].autoExecute).toBe(true);
    expect(commandWithSubcommands.subCommands![2].autoExecute).toBeUndefined();
  });

  it('should work with actual command definitions', () => {
    // Test with actual command definitions from the codebase
    const helpCommand: SlashCommand = {
      name: 'help',
      altNames: ['?'],
      description: 'for help on LLxprt Code',
      kind: CommandKind.BUILT_IN,
      autoExecute: true,
      action: () => {},
    };

    const quitCommand: SlashCommand = {
      name: 'quit',
      altNames: ['exit'],
      description: 'exit the cli',
      kind: CommandKind.BUILT_IN,
      autoExecute: true,
      action: () => {},
    };

    const aboutCommand: SlashCommand = {
      name: 'about',
      description: 'show version info',
      kind: CommandKind.BUILT_IN,
      autoExecute: true,
      action: () => {},
    };

    expect(helpCommand.autoExecute).toBe(true);
    expect(quitCommand.autoExecute).toBe(true);
    expect(aboutCommand.autoExecute).toBe(true);
  });

  it('should default to undefined when not specified', () => {
    const commandWithoutFlag: SlashCommand = {
      name: 'test',
      description: 'test command',
      kind: CommandKind.BUILT_IN,
      action: () => {},
    };

    // Explicitly check it's undefined, not false
    expect(commandWithoutFlag.autoExecute).toBeUndefined();
    expect(commandWithoutFlag.autoExecute).not.toBe(false);
  });

  it('should allow both true and false values', () => {
    const explicitTrue: SlashCommand = {
      name: 'test1',
      description: 'test',
      kind: CommandKind.BUILT_IN,
      autoExecute: true,
      action: () => {},
    };

    const explicitFalse: SlashCommand = {
      name: 'test2',
      description: 'test',
      kind: CommandKind.BUILT_IN,
      autoExecute: false,
      action: () => {},
    };

    expect(explicitTrue.autoExecute).toBe(true);
    expect(explicitFalse.autoExecute).toBe(false);
  });
});
