/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';
import { CommandService } from './CommandService';
import { type SlashCommand } from '../ui/commands/types.js';

// Mock the command modules to isolate the service from the command implementations.
vi.mock('../ui/commands/memoryCommand.js', () => ({
  memoryCommand: { name: 'memory', description: 'Mock Memory' },
}));
vi.mock('../ui/commands/helpCommand.js', () => ({
  helpCommand: { name: 'help', description: 'Mock Help' },
}));
vi.mock('../ui/commands/clearCommand.js', () => ({
  clearCommand: { name: 'clear', description: 'Mock Clear' },
}));
vi.mock('../ui/commands/authCommand.js', () => ({
  authCommand: { name: 'auth', description: 'Mock Auth' },
}));
vi.mock('../ui/commands/themeCommand.js', () => ({
  themeCommand: { name: 'theme', description: 'Mock Theme' },
}));
vi.mock('../ui/commands/privacyCommand.js', () => ({
  privacyCommand: { name: 'privacy', description: 'Mock Privacy' },
}));
vi.mock('../ui/commands/aboutCommand.js', () => ({
  aboutCommand: { name: 'about', description: 'Mock About' },
}));

// Also mock the new toolformat command
vi.mock('../ui/commands/toolformatCommand.js', () => ({
  toolformatCommand: { name: 'toolformat', description: 'Mock Toolformat' },
}));

describe('CommandService', () => {
  describe('when using default production loader', () => {
    let commandService: CommandService;

    beforeEach(() => {
      commandService = new CommandService();
    });

    it('should initialize with an empty command tree', () => {
      const tree = commandService.getCommands();
      expect(tree).toBeInstanceOf(Array);
      expect(tree.length).toBe(0);
    });

    describe('loadCommands', () => {
      it('should load the built-in commands into the command tree', async () => {
        // Pre-condition check
        expect(commandService.getCommands().length).toBe(0);

        // Action
        await commandService.loadCommands();
        const tree = commandService.getCommands();

        // Post-condition assertions
        expect(tree.length).toBe(23); // <-- CHANGED FROM 22

        const commandNames = tree.map((cmd) => cmd.name);
        expect(commandNames).toContain('auth');
        expect(commandNames).toContain('memory');
        expect(commandNames).toContain('help');
        expect(commandNames).toContain('clear');
        expect(commandNames).toContain('theme');
        expect(commandNames).toContain('privacy');
        expect(commandNames).toContain('about');
        expect(commandNames).toContain('toolformat'); // new
      });

      it('should overwrite any existing commands when called again', async () => {
        // Load once
        await commandService.loadCommands();
        expect(commandService.getCommands().length).toBe(23); // <-- CHANGED FROM 22

        // Load again
        await commandService.loadCommands();
        const tree = commandService.getCommands();

        // Should not append, but overwrite
        expect(tree.length).toBe(23); // <-- CHANGED FROM 22
      });
    });

    describe('getCommandTree', () => {
      it('should return the current command tree', async () => {
        const initialTree = commandService.getCommands();
        expect(initialTree).toEqual([]);

        await commandService.loadCommands();

        const loadedTree = commandService.getCommands();
        expect(loadedTree.length).toBe(23); // <-- CHANGED FROM 22
        const commandNames = loadedTree.map((cmd) => cmd.name);
        expect(commandNames).toContain('about');
        expect(commandNames).toContain('auth');
        expect(commandNames).toContain('clear');
        expect(commandNames).toContain('help');
        expect(commandNames).toContain('memory');
        expect(commandNames).toContain('privacy');
        expect(commandNames).toContain('theme');
        expect(commandNames).toContain('toolformat'); // new
      });
    });
  });

  describe('when initialized with an injected loader function', () => {
    it('should use the provided loader instead of the built-in one', async () => {
      // Arrange: Create a set of mock commands.
      const mockCommands: SlashCommand[] = [
        { name: 'injected-test-1', description: 'injected 1' },
        { name: 'injected-test-2', description: 'injected 2' },
      ];
      const mockLoader = vi.fn().mockResolvedValue(mockCommands);
      const commandService = new CommandService(null, mockLoader);
      await commandService.loadCommands();
      const tree = commandService.getCommands();
      expect(tree).toEqual(mockCommands);
    });
  });
});