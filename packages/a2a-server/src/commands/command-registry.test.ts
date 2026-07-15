/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'bun:test';
import { CommandRegistry, commandRegistry } from './command-registry.js';
import type { Command } from './types.js';

describe('CommandRegistry', () => {
  const mockListExtensionsCommandInstance: Command = {
    name: 'extensions list',
    description: 'Lists all installed extensions.',
    execute: vi.fn(),
  };
  const mockExtensionsCommandInstance: Command = {
    name: 'extensions',
    description: 'Manage extensions.',
    execute: vi.fn(),
    subCommands: [mockListExtensionsCommandInstance],
  };
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should register ExtensionsCommand on initialization', async () => {
    const commandRegistry = new CommandRegistry([
      mockExtensionsCommandInstance,
    ]);
    const command = commandRegistry.get('extensions');
    expect(command).toBe(mockExtensionsCommandInstance);
  });

  it('should register sub commands on initialization', async () => {
    const commandRegistry = new CommandRegistry([
      mockExtensionsCommandInstance,
    ]);
    const command = commandRegistry.get('extensions list');
    expect(command).toBe(mockListExtensionsCommandInstance);
  });

  it('get() should return undefined for a non-existent command', async () => {
    const commandRegistry = new CommandRegistry([
      mockExtensionsCommandInstance,
    ]);
    const command = commandRegistry.get('non-existent');
    expect(command).toBeUndefined();
  });

  it('register() should register a new command', async () => {
    const commandRegistry = new CommandRegistry([
      mockExtensionsCommandInstance,
    ]);
    const mockCommand: Command = {
      name: 'test-command',
      description: '',
      execute: vi.fn(),
    };
    commandRegistry.register(mockCommand);
    const command = commandRegistry.get('test-command');
    expect(command).toBe(mockCommand);
  });

  it('register() should register a nested command', async () => {
    const commandRegistry = new CommandRegistry([
      mockExtensionsCommandInstance,
    ]);
    const mockSubSubCommand: Command = {
      name: 'test-command-sub-sub',
      description: '',
      execute: vi.fn(),
    };
    const mockSubCommand: Command = {
      name: 'test-command-sub',
      description: '',
      execute: vi.fn(),
      subCommands: [mockSubSubCommand],
    };
    const mockCommand: Command = {
      name: 'test-command',
      description: '',
      execute: vi.fn(),
      subCommands: [mockSubCommand],
    };
    commandRegistry.register(mockCommand);

    const command = commandRegistry.get('test-command');
    const subCommand = commandRegistry.get('test-command-sub');
    const subSubCommand = commandRegistry.get('test-command-sub-sub');

    expect(command).toBe(mockCommand);
    expect(subCommand).toBe(mockSubCommand);
    expect(subSubCommand).toBe(mockSubSubCommand);
  });

  it('register() should not enter an infinite loop with a cyclic command', async () => {
    const warn = vi.fn();
    const commandRegistry = new CommandRegistry(
      [mockExtensionsCommandInstance],
      warn,
    );
    const mockCommand: Command = {
      name: 'cyclic-command',
      description: '',
      subCommands: [],
      execute: vi.fn(),
    };

    mockCommand.subCommands?.push(mockCommand); // Create cycle

    commandRegistry.register(mockCommand);

    expect(commandRegistry.get('cyclic-command')).toBe(mockCommand);
    expect(warn).toHaveBeenCalledWith(
      'Command cyclic-command already registered. Skipping.',
    );
    // If the test finishes, it means we didn't get into an infinite loop.
  });
});

describe('CommandRegistry default commands', () => {
  it('registers real top-level commands when constructed with no arguments', () => {
    const registry = new CommandRegistry();
    const extensions = registry.get('extensions');
    const restore = registry.get('restore');
    const init = registry.get('init');

    expect(extensions).toBeDefined();
    expect(extensions?.name).toBe('extensions');
    expect(extensions?.topLevel).toBe(true);

    expect(restore).toBeDefined();
    expect(restore?.name).toBe('restore');
    expect(restore?.topLevel).toBe(true);

    expect(init).toBeDefined();
    expect(init?.name).toBe('init');
  });

  it('recursively registers real subcommands from the default top-level commands', () => {
    const registry = new CommandRegistry();

    const extensionsList = registry.get('extensions list');
    expect(extensionsList).toBeDefined();
    expect(extensionsList?.name).toBe('extensions list');

    const restoreList = registry.get('restore list');
    expect(restoreList).toBeDefined();
    expect(restoreList?.name).toBe('restore list');
  });
});

describe('exported commandRegistry singleton', () => {
  it('exposes the real top-level commands', () => {
    expect(commandRegistry.get('extensions')?.name).toBe('extensions');
    expect(commandRegistry.get('restore')?.name).toBe('restore');
    expect(commandRegistry.get('init')?.name).toBe('init');
  });

  it('exposes the real recursively registered subcommands', () => {
    expect(commandRegistry.get('extensions list')?.name).toBe(
      'extensions list',
    );
    expect(commandRegistry.get('restore list')?.name).toBe('restore list');
  });
});
