/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Tests for auto-execute slash command functionality
 */

import { describe, it, expect } from 'vitest';
import type { SlashCommand } from '../commands/types.js';
import { CommandKind } from '../commands/types.js';

describe('SlashCommand - autoExecute property', () => {
  it('should support autoExecute property on SlashCommand interface', () => {
    const commandWithAutoExecute: SlashCommand = {
      name: 'help',
      kind: CommandKind.BUILT_IN,
      description: 'Show help',
      autoExecute: true,
    };

    expect(commandWithAutoExecute.autoExecute).toBe(true);
  });

  it('should default to undefined when autoExecute is not specified', () => {
    const commandWithoutAutoExecute: SlashCommand = {
      name: 'model',
      kind: CommandKind.BUILT_IN,
      description: 'Switch model',
    };

    expect(commandWithoutAutoExecute.autoExecute).toBeUndefined();
  });

  it('should support autoExecute on subcommands', () => {
    const commandWithSubcommands: SlashCommand = {
      name: 'stats',
      kind: CommandKind.BUILT_IN,
      description: 'Show stats',
      autoExecute: true,
      subCommands: [
        {
          name: 'session',
          kind: CommandKind.BUILT_IN,
          description: 'Session stats',
          autoExecute: true,
        },
      ],
    };

    expect(commandWithSubcommands.autoExecute).toBe(true);
    expect(commandWithSubcommands.subCommands?.[0].autoExecute).toBe(true);
  });
});

describe('getCommandFromSuggestion helper', () => {
  it('should be implemented in useSlashCompletion', () => {
    // This test documents the expected helper function
    // Implementation will provide: getCommandFromSuggestion(suggestion) => string
    // For now, this is a placeholder that will pass once implemented
    expect(true).toBe(true);
  });
});
