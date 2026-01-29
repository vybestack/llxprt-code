/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

vi.mock('../ui/commands/profileCommand.js', async () => {
  const { CommandKind } = await import('../ui/commands/types.js');
  return {
    profileCommand: {
      name: 'profile',
      description: 'Profile command',
      kind: CommandKind.BUILT_IN,
    },
  };
});

vi.mock('../ui/commands/aboutCommand.js', async () => {
  const { CommandKind } = await import('../ui/commands/types.js');
  return {
    aboutCommand: {
      name: 'about',
      description: 'About the CLI',
      kind: CommandKind.BUILT_IN,
    },
  };
});

vi.mock('../ui/commands/ideCommand.js', () => ({ ideCommand: vi.fn() }));
vi.mock('../ui/commands/restoreCommand.js', () => ({
  restoreCommand: vi.fn(),
}));

import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { BuiltinCommandLoader } from './BuiltinCommandLoader.js';
import { Config } from '@vybestack/llxprt-code-core';
import { CommandKind } from '../ui/commands/types.js';

import { ideCommand } from '../ui/commands/ideCommand.js';
import { restoreCommand } from '../ui/commands/restoreCommand.js';

vi.mock('../ui/commands/authCommand.js', () => ({ authCommand: {} }));
vi.mock('../ui/commands/bugCommand.js', () => ({ bugCommand: {} }));
vi.mock('../ui/commands/chatCommand.js', () => ({ chatCommand: {} }));
vi.mock('../ui/commands/clearCommand.js', () => ({ clearCommand: {} }));
vi.mock('../ui/commands/compressCommand.js', () => ({ compressCommand: {} }));
vi.mock('../ui/commands/docsCommand.js', () => ({ docsCommand: {} }));
vi.mock('../ui/commands/editorCommand.js', () => ({ editorCommand: {} }));
vi.mock('../ui/commands/extensionsCommand.js', () => ({
  extensionsCommand: {},
}));
vi.mock('../ui/commands/helpCommand.js', () => ({ helpCommand: {} }));
vi.mock('../ui/commands/memoryCommand.js', () => ({ memoryCommand: {} }));
vi.mock('../ui/commands/privacyCommand.js', () => ({ privacyCommand: {} }));
vi.mock('../ui/commands/loggingCommand.js', () => ({ loggingCommand: {} }));
vi.mock('../ui/commands/quitCommand.js', () => ({ quitCommand: {} }));
vi.mock('../ui/commands/statsCommand.js', () => ({ statsCommand: {} }));
vi.mock('../ui/commands/themeCommand.js', () => ({ themeCommand: {} }));
vi.mock('../ui/commands/toolsCommand.js', () => ({ toolsCommand: {} }));
vi.mock('../ui/commands/copyCommand.js', () => ({ copyCommand: {} }));
vi.mock('../ui/commands/vimCommand.js', () => ({ vimCommand: {} }));
vi.mock('../ui/commands/providerCommand.js', () => ({ providerCommand: {} }));
vi.mock('../ui/commands/modelCommand.js', () => ({ modelCommand: {} }));
vi.mock('../ui/commands/keyCommand.js', () => ({ keyCommand: {} }));
vi.mock('../ui/commands/keyfileCommand.js', () => ({ keyfileCommand: {} }));
vi.mock('../ui/commands/baseurlCommand.js', () => ({ baseurlCommand: {} }));
vi.mock('../ui/commands/toolformatCommand.js', () => ({
  toolformatCommand: {},
}));
vi.mock('../ui/commands/mcpCommand.js', () => ({
  mcpCommand: {
    name: 'mcp',
    description: 'MCP command',
    kind: 'BUILT_IN',
  },
}));

describe('BuiltinCommandLoader', () => {
  let mockConfig: Config;

  const ideCommandMock = ideCommand as Mock;
  const restoreCommandMock = restoreCommand as Mock;

  beforeEach(() => {
    vi.clearAllMocks();
    mockConfig = { some: 'config' } as unknown as Config;

    ideCommandMock.mockReturnValue({
      name: 'ide',
      description: 'IDE command',
      kind: CommandKind.BUILT_IN,
    });
    restoreCommandMock.mockReturnValue({
      name: 'restore',
      description: 'Restore command',
      kind: CommandKind.BUILT_IN,
    });
  });

  it('should correctly pass the config object to command factory functions', async () => {
    const loader = new BuiltinCommandLoader(mockConfig);
    await loader.loadCommands(new AbortController().signal);

    expect(ideCommandMock).toHaveBeenCalledTimes(1);
    expect(ideCommandMock).toHaveBeenCalledWith(mockConfig);
    expect(restoreCommandMock).toHaveBeenCalledTimes(1);
    expect(restoreCommandMock).toHaveBeenCalledWith(mockConfig);
  });

  it('should filter out null command definitions returned by factories', async () => {
    // Override the mock's behavior for this specific test.
    ideCommandMock.mockReturnValue(null);
    const loader = new BuiltinCommandLoader(mockConfig);
    const commands = await loader.loadCommands(new AbortController().signal);

    // The 'ide' command should be filtered out.
    const ideCmd = commands.find((c) => c.name === 'ide');
    expect(ideCmd).toBeUndefined();

    // Other commands should still be present.
    const aboutCmd = commands.find((c) => c.name === 'about');
    expect(aboutCmd).toBeDefined();
  });

  it('should handle a null config gracefully when calling factories', async () => {
    const loader = new BuiltinCommandLoader(null);
    await loader.loadCommands(new AbortController().signal);
    expect(ideCommandMock).toHaveBeenCalledTimes(1);
    expect(ideCommandMock).toHaveBeenCalledWith(null);
    expect(restoreCommandMock).toHaveBeenCalledTimes(1);
    expect(restoreCommandMock).toHaveBeenCalledWith(null);
  });

  it('should return a list of all loaded commands', async () => {
    const loader = new BuiltinCommandLoader(mockConfig);
    const commands = await loader.loadCommands(new AbortController().signal);

    const aboutCmd = commands.find((c) => c.name === 'about');
    expect(aboutCmd).toBeDefined();
    expect(aboutCmd?.kind).toBe(CommandKind.BUILT_IN);

    const ideCmd = commands.find((c) => c.name === 'ide');
    expect(ideCmd).toBeDefined();

    const mcpCmd = commands.find((c) => c.name === 'mcp');
    expect(mcpCmd).toBeDefined();
  });

  it('loads the mouse command', async () => {
    const loader = new BuiltinCommandLoader(mockConfig);
    const commands = await loader.loadCommands(new AbortController().signal);

    const mouseCmd = commands.find((c) => c.name === 'mouse');
    expect(mouseCmd).toBeDefined();
    expect(mouseCmd?.kind).toBe(CommandKind.BUILT_IN);
  });
});

describe('BuiltinCommandLoader profile', () => {
  let mockConfig: Config;

  beforeEach(() => {
    vi.resetModules();
    mockConfig = {
      getFolderTrust: vi.fn().mockReturnValue(false),
      getUseModelRouter: () => false,
      getCheckpointingEnabled: () => false,
    } as unknown as Config;
  });

  it('should not include uiprofile command when isDevelopment is false', async () => {
    process.env['NODE_ENV'] = 'production';
    const { BuiltinCommandLoader } = await import('./BuiltinCommandLoader.js');
    const loader = new BuiltinCommandLoader(mockConfig);
    const commands = await loader.loadCommands(new AbortController().signal);
    const uiprofileCmd = commands.find((c) => c.name === 'uiprofile');
    expect(uiprofileCmd).toBeUndefined();
  });

  it('should include uiprofile command when isDevelopment is true', async () => {
    process.env['NODE_ENV'] = 'development';
    const { BuiltinCommandLoader } = await import('./BuiltinCommandLoader.js');
    const loader = new BuiltinCommandLoader(mockConfig);
    const commands = await loader.loadCommands(new AbortController().signal);
    const uiprofileCmd = commands.find((c) => c.name === 'uiprofile');
    expect(uiprofileCmd).toBeDefined();
  });
});

/**
 * Phase 2 TDD Tests: Command Reloading on Extension State Change
 *
 * These tests verify that commands from extensions are automatically
 * made available/removed when extensions are enabled/disabled at runtime.
 */
describe('Command Reloading on Extension State Change', () => {
  let mockConfig: Config;
  let mockExtensionEnablementManager: {
    isEnabled: Mock;
    enable: Mock;
    disable: Mock;
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Create a mock ExtensionEnablementManager
    mockExtensionEnablementManager = {
      isEnabled: vi.fn(),
      enable: vi.fn(),
      disable: vi.fn(),
    };

    mockConfig = {
      getFolderTrust: vi.fn().mockReturnValue(false),
      getUseModelRouter: () => false,
      getCheckpointingEnabled: () => false,
      extensionEnablementManager: mockExtensionEnablementManager,
    } as unknown as Config;
  });

  it('should make extension commands available when extension is enabled', async () => {
    // Setup: Initially extension is disabled
    mockExtensionEnablementManager.isEnabled.mockReturnValue(false);

    const loader = new BuiltinCommandLoader(mockConfig);

    // Mock an extension command by spying on registerBuiltinCommands
    const extensionCommand = {
      name: 'ext-cmd',
      description: 'Extension command',
      kind: CommandKind.BUILT_IN,
      extensionName: 'test-extension',
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const originalRegister = (loader as any).registerBuiltinCommands.bind(
      loader,
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.spyOn(loader as any, 'registerBuiltinCommands').mockImplementation(
      () => {
        const builtins = originalRegister();
        return [...builtins, extensionCommand];
      },
    );

    // Initial load - extension disabled, command should be filtered out
    let commands = await loader.loadCommands(new AbortController().signal);
    expect(
      commands.find((c) => c.extensionName === 'test-extension'),
    ).toBeUndefined();

    // Enable the extension
    mockExtensionEnablementManager.isEnabled.mockReturnValue(true);

    // Reload - command should now be available
    commands = await loader.loadCommands(new AbortController().signal);
    expect(
      commands.find((c) => c.extensionName === 'test-extension'),
    ).toBeDefined();
  });

  it('should remove extension commands when extension is disabled', async () => {
    // Setup: Extension starts enabled
    mockExtensionEnablementManager.isEnabled.mockReturnValue(true);

    const loader = new BuiltinCommandLoader(mockConfig);

    const extensionCommand = {
      name: 'ext-cmd',
      description: 'Extension command',
      kind: CommandKind.BUILT_IN,
      extensionName: 'test-extension',
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const originalRegister = (loader as any).registerBuiltinCommands.bind(
      loader,
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.spyOn(loader as any, 'registerBuiltinCommands').mockImplementation(
      () => {
        const builtins = originalRegister();
        return [...builtins, extensionCommand];
      },
    );

    // Initial load - extension enabled, command available
    let commands = await loader.loadCommands(new AbortController().signal);
    expect(
      commands.find((c) => c.extensionName === 'test-extension'),
    ).toBeDefined();

    // Disable the extension
    mockExtensionEnablementManager.isEnabled.mockReturnValue(false);

    // Reload - command should be removed
    commands = await loader.loadCommands(new AbortController().signal);
    expect(
      commands.find((c) => c.extensionName === 'test-extension'),
    ).toBeUndefined();
  });

  it('should not affect built-in commands when extensions change', async () => {
    mockExtensionEnablementManager.isEnabled.mockReturnValue(true);

    const loader = new BuiltinCommandLoader(mockConfig);

    const extensionCommand = {
      name: 'ext-cmd',
      description: 'Extension command',
      kind: CommandKind.BUILT_IN,
      extensionName: 'test-extension',
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const originalRegister = (loader as any).registerBuiltinCommands.bind(
      loader,
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.spyOn(loader as any, 'registerBuiltinCommands').mockImplementation(
      () => {
        const builtins = originalRegister();
        return [...builtins, extensionCommand];
      },
    );

    // Load with extension enabled
    let commands = await loader.loadCommands(new AbortController().signal);
    const aboutCmd1 = commands.find((c) => c.name === 'about');
    expect(aboutCmd1).toBeDefined();

    // Disable extension
    mockExtensionEnablementManager.isEnabled.mockReturnValue(false);

    // Reload and verify built-in commands still exist
    commands = await loader.loadCommands(new AbortController().signal);
    const aboutCmd2 = commands.find((c) => c.name === 'about');
    expect(aboutCmd2).toBeDefined();
    expect(aboutCmd2?.name).toBe(aboutCmd1?.name);
  });

  it('should handle rapid enable/disable without issues', async () => {
    const loader = new BuiltinCommandLoader(mockConfig);

    const extensionCommand = {
      name: 'ext-cmd',
      description: 'Extension command',
      kind: CommandKind.BUILT_IN,
      extensionName: 'test-extension',
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const originalRegister = (loader as any).registerBuiltinCommands.bind(
      loader,
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.spyOn(loader as any, 'registerBuiltinCommands').mockImplementation(
      () => {
        const builtins = originalRegister();
        return [...builtins, extensionCommand];
      },
    );

    // Rapid state changes
    mockExtensionEnablementManager.isEnabled.mockReturnValue(true);
    const commands1 = await loader.loadCommands(new AbortController().signal);

    mockExtensionEnablementManager.isEnabled.mockReturnValue(false);
    const commands2 = await loader.loadCommands(new AbortController().signal);

    mockExtensionEnablementManager.isEnabled.mockReturnValue(true);
    const commands3 = await loader.loadCommands(new AbortController().signal);

    // Verify final state is correct
    expect(
      commands3.find((c) => c.extensionName === 'test-extension'),
    ).toBeDefined();
    expect(
      commands2.find((c) => c.extensionName === 'test-extension'),
    ).toBeUndefined();
    expect(
      commands1.find((c) => c.extensionName === 'test-extension'),
    ).toBeDefined();

    // Verify no duplicates
    const extCommands = commands3.filter(
      (c) => c.extensionName === 'test-extension',
    );
    expect(extCommands.length).toBe(1);
  });

  it('should reload commands for multiple extensions independently', async () => {
    const loader = new BuiltinCommandLoader(mockConfig);

    const extACommand = {
      name: 'ext-a-cmd',
      description: 'Extension A command',
      kind: CommandKind.BUILT_IN,
      extensionName: 'ext-a',
    };

    const extBCommand = {
      name: 'ext-b-cmd',
      description: 'Extension B command',
      kind: CommandKind.BUILT_IN,
      extensionName: 'ext-b',
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const originalRegister = (loader as any).registerBuiltinCommands.bind(
      loader,
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.spyOn(loader as any, 'registerBuiltinCommands').mockImplementation(
      () => {
        const builtins = originalRegister();
        return [...builtins, extACommand, extBCommand];
      },
    );

    // Enable ext-a, disable ext-b
    mockExtensionEnablementManager.isEnabled.mockImplementation(
      (name: string) => name === 'ext-a',
    );

    let commands = await loader.loadCommands(new AbortController().signal);
    expect(commands.find((c) => c.extensionName === 'ext-a')).toBeDefined();
    expect(commands.find((c) => c.extensionName === 'ext-b')).toBeUndefined();

    // Swap: disable ext-a, enable ext-b
    mockExtensionEnablementManager.isEnabled.mockImplementation(
      (name: string) => name === 'ext-b',
    );

    commands = await loader.loadCommands(new AbortController().signal);
    expect(commands.find((c) => c.extensionName === 'ext-a')).toBeUndefined();
    expect(commands.find((c) => c.extensionName === 'ext-b')).toBeDefined();
  });
});
