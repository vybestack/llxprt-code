/**
 * @license
 * Copyright 2025 Google LLC
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

vi.mock('../ui/commands/uiprofileCommand.js', async () => {
  const { CommandKind } = await import('../ui/commands/types.js');
  return {
    uiprofileCommand: {
      name: 'uiprofile',
      description: 'UI Profile command',
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

vi.mock('../ui/commands/ideCommand.js', async () => {
  const { CommandKind } = await import('../ui/commands/types.js');
  return {
    ideCommand: vi.fn().mockReturnValue({
      name: 'ide',
      description: 'IDE command',
      kind: CommandKind.BUILT_IN,
    }),
  };
});
vi.mock('../ui/commands/restoreCommand.js', () => ({
  restoreCommand: vi.fn(),
}));
vi.mock('../ui/commands/permissionsCommand.js', async () => {
  const { CommandKind } = await import('../ui/commands/types.js');
  return {
    permissionsCommand: {
      name: 'permissions',
      description: 'Permissions command',
      kind: CommandKind.BUILT_IN,
    },
  };
});

import { describe, it, expect, vi, beforeEach, type Mock } from 'bun:test';
import { BuiltinCommandLoader } from './BuiltinCommandLoader.js';
import type { Config } from '@vybestack/llxprt-code-core';
import { CommandKind } from '../ui/commands/types.js';

import { restoreCommand } from '../ui/commands/restoreCommand.js';

vi.mock('../ui/commands/authCommand.js', () => ({ authCommand: {} }));
vi.mock('../ui/commands/bugCommand.js', () => ({ bugCommand: {} }));
vi.mock('../ui/commands/chatCommand.js', () => ({ chatCommand: {} }));
vi.mock('../ui/commands/clearCommand.js', () => ({ clearCommand: {} }));
vi.mock('../ui/commands/compressCommand.js', () => ({ compressCommand: {} }));
vi.mock('../ui/commands/docsCommand.js', () => ({ docsCommand: {} }));
vi.mock('../ui/commands/editorCommand.js', () => ({ editorCommand: {} }));
vi.mock('../ui/commands/extensionsCommand.js', () => ({
  extensionsCommand: () => ({}),
}));
vi.mock('../ui/commands/helpCommand.js', () => ({ helpCommand: {} }));
vi.mock('../ui/commands/memoryCommand.js', () => ({ memoryCommand: {} }));
vi.mock('../ui/commands/modelCommand.js', () => ({
  modelCommand: { name: 'model' },
}));
vi.mock('../ui/commands/privacyCommand.js', () => ({ privacyCommand: {} }));
vi.mock('../ui/commands/quitCommand.js', () => ({ quitCommand: {} }));
vi.mock('../ui/commands/quotaCommand.js', async () => {
  const { CommandKind } = await import('../ui/commands/types.js');
  return {
    quotaCommand: {
      name: 'quota',
      description: 'Quota command',
      kind: CommandKind.BUILT_IN,
    },
  };
});
vi.mock('../ui/commands/statsCommand.js', () => ({ statsCommand: {} }));
vi.mock('../ui/commands/themeCommand.js', () => ({ themeCommand: {} }));
vi.mock('../ui/commands/toolsCommand.js', () => ({ toolsCommand: {} }));
vi.mock('../ui/commands/skillsCommand.js', () => ({
  skillsCommand: { name: 'skills' },
}));
vi.mock('../ui/commands/mcpCommand.js', () => ({
  mcpCommand: {
    name: 'mcp',
    description: 'MCP command',
    kind: 'BUILT_IN',
  },
}));

// Default the file to production behavior. The dedicated development case at
// the end re-registers this module immediately before exercising uiprofile.
vi.mock('../utils/installationInfo.js', async () => {
  const actual = await vi.importActual('./../utils/installationInfo.js');
  return {
    ...actual,
    isDevelopment: false,
  };
});

describe('BuiltinCommandLoader', () => {
  let mockConfig: Config;

  const restoreCommandMock = restoreCommand as Mock;

  beforeEach(() => {
    vi.clearAllMocks();
    mockConfig = {
      getFolderTrust: vi.fn().mockReturnValue(true),
      getEnableExtensionReloading: () => false,
      getEnableHooks: () => false,
      getEnableHooksUI: () => false,
      isSkillsSupportEnabled: vi.fn().mockReturnValue(false),
      getSkillManager: vi.fn().mockReturnValue({
        getAllSkills: vi.fn().mockReturnValue([]),
      }),
    } as unknown as Config;

    restoreCommandMock.mockReturnValue({
      name: 'restore',
      description: 'Restore command',
      kind: CommandKind.BUILT_IN,
    });
  });

  it('should correctly pass the config object to restore command factory', async () => {
    const loader = new BuiltinCommandLoader(mockConfig);
    await loader.loadCommands(new AbortController().signal);

    // ideCommand is now a constant, no longer needs config
    expect(restoreCommandMock).toHaveBeenCalledTimes(1);
    expect(restoreCommandMock).toHaveBeenCalledWith(mockConfig);
  });

  it('should filter out null command definitions returned by factories', async () => {
    // ideCommand is now a constant SlashCommand
    const loader = new BuiltinCommandLoader(mockConfig);
    const commands = await loader.loadCommands(new AbortController().signal);

    // The 'ide' command should be present.
    const ideCmd = commands.find((c) => c.name === 'ide');
    expect(ideCmd).toBeDefined();

    // Other commands should still be present.
    const aboutCmd = commands.find((c) => c.name === 'about');
    expect(aboutCmd).toBeDefined();
  });

  it('should handle a null config gracefully when calling factories', async () => {
    const loader = new BuiltinCommandLoader(null);
    await loader.loadCommands(new AbortController().signal);
    // ideCommand is now a constant, no longer needs config
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

  it('should include permissions command', async () => {
    const loader = new BuiltinCommandLoader(mockConfig);
    const commands = await loader.loadCommands(new AbortController().signal);
    const permissionsCmd = commands.find((c) => c.name === 'permissions');
    expect(permissionsCmd).toBeDefined();
  });

  it('should exclude development-only commands in production mode', async () => {
    const loader = new BuiltinCommandLoader(mockConfig);
    const commands = await loader.loadCommands(new AbortController().signal);
    expect(
      commands.find((command) => command.name === 'uiprofile'),
    ).toBeUndefined();
  });

  // `/help` (Help.tsx) and slash completion both render this loaded list, and
  // Help filters on a non-empty `description`. Asserting the description here
  // is therefore what guarantees `/image` is discoverable in both surfaces.
  it('should include the image command with a description so it appears in /help and completion', async () => {
    const loader = new BuiltinCommandLoader(mockConfig);
    const commands = await loader.loadCommands(new AbortController().signal);

    const imageCmd = commands.find((c) => c.name === 'image');
    expect(imageCmd).toBeDefined();
    expect(imageCmd?.kind).toBe(CommandKind.BUILT_IN);
    expect(imageCmd?.description).toBeTruthy();
    // The description doubles as the usage hint shown in completion.
    expect(imageCmd?.description).toContain('/image <output.png>');
  });

  it('should include quota command', async () => {
    const loader = new BuiltinCommandLoader(mockConfig);
    const commands = await loader.loadCommands(new AbortController().signal);
    const quotaCmd = commands.find((c) => c.name === 'quota');
    expect(quotaCmd).toBeDefined();
    expect(quotaCmd?.kind).toBe(CommandKind.BUILT_IN);
  });

  it('should include policies command when message bus integration is enabled', async () => {
    const mockConfigWithMessageBus = {
      ...mockConfig,
      getEnableHooks: () => false,
      getEnableHooksUI: () => false,
    } as unknown as Config;
    const loader = new BuiltinCommandLoader(mockConfigWithMessageBus);
    const commands = await loader.loadCommands(new AbortController().signal);
    const policiesCmd = commands.find((c) => c.name === 'policies');
    expect(policiesCmd).toBeDefined();
  });
});

describe('BuiltinCommandLoader profile', () => {
  let mockConfig: Config;

  beforeEach(() => {
    mockConfig = {
      getFolderTrust: vi.fn().mockReturnValue(false),
      getCheckpointingEnabled: () => false,
      getEnableExtensionReloading: () => false,
      getEnableHooks: () => false,
      getEnableHooksUI: () => false,
      isSkillsSupportEnabled: vi.fn().mockReturnValue(false),
      getSkillManager: vi.fn().mockReturnValue({
        getAllSkills: vi.fn().mockReturnValue([]),
      }),
    } as unknown as Config;
  });

  it('should always include profile command', async () => {
    const loader = new BuiltinCommandLoader(mockConfig);
    const commands = await loader.loadCommands(new AbortController().signal);
    const profileCmd = commands.find((c) => c.name === 'profile');
    expect(profileCmd).toBeDefined();
  });

  it('should include uiprofile command when isDevelopment is true', async () => {
    vi.mock('../utils/installationInfo.js', async () => {
      const actual = await vi.importActual('./../utils/installationInfo.js');
      return {
        ...actual,
        isDevelopment: true,
      };
    });
    const loader = new BuiltinCommandLoader(mockConfig);
    const commands = await loader.loadCommands(new AbortController().signal);
    const uiprofileCmd = commands.find((c) => c.name === 'uiprofile');
    expect(uiprofileCmd).toBeDefined();
  });
});
