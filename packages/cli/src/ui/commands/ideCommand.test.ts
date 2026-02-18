/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  MockInstance,
  vi,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from 'vitest';
import { ideCommand } from './ideCommand.js';
import { type CommandContext } from './types.js';
import { type Config, IDE_DEFINITIONS } from '@vybestack/llxprt-code-core';
import * as core from '@vybestack/llxprt-code-core';

vi.mock('child_process');
vi.mock('glob');
vi.mock('@vybestack/llxprt-code-core', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    getIdeInstaller: vi.fn(),
  };
});

describe('ideCommand', () => {
  let mockContext: CommandContext;
  let mockConfig: Config;
  let platformSpy: MockInstance;

  beforeEach(() => {
    mockContext = {
      ui: {
        addItem: vi.fn(),
      },
      services: {
        settings: {
          setValue: vi.fn(),
        },
      },
    } as unknown as CommandContext;

    mockConfig = {
      getIdeMode: vi.fn(),
      getIdeClient: vi.fn(),
      setIdeMode: vi.fn(),
      setIdeClientDisconnected: vi.fn(),
    } as unknown as Config;

    platformSpy = vi.spyOn(process, 'platform', 'get');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should return null if config is not provided', () => {
    const command = ideCommand(null);
    expect(command).toBeNull();
  });

  it('should return the ide command', () => {
    vi.mocked(mockConfig.getIdeMode).mockReturnValue(true);
    vi.mocked(mockConfig.getIdeClient).mockReturnValue({
      getCurrentIde: () => IDE_DEFINITIONS.vscode,
      getDetectedIdeDisplayName: () => 'VS Code',
      getConnectionStatus: () => ({
        status: core.IDEConnectionStatus.Disconnected,
      }),
    } as ReturnType<Config['getIdeClient']>);
    const command = ideCommand(mockConfig);
    expect(command).not.toBeNull();
    expect(command?.name).toBe('ide');
    expect(command?.subCommands).toHaveLength(3);
    expect(command?.subCommands?.[0].name).toBe('enable');
    expect(command?.subCommands?.[1].name).toBe('status');
    expect(command?.subCommands?.[2].name).toBe('install');
  });

  it('should set autoExecute: true on all subcommands when disconnected', () => {
    vi.mocked(mockConfig.getIdeMode).mockReturnValue(true);
    vi.mocked(mockConfig.getIdeClient).mockReturnValue({
      getCurrentIde: () => IDE_DEFINITIONS.vscode,
      getDetectedIdeDisplayName: () => 'VS Code',
      getConnectionStatus: () => ({
        status: core.IDEConnectionStatus.Disconnected,
      }),
    } as ReturnType<Config['getIdeClient']>);
    const command = ideCommand(mockConfig);
    for (const sub of command?.subCommands ?? []) {
      expect(sub.autoExecute).toBe(true);
    }
  });

  it('should set autoExecute: true on all subcommands when connected', () => {
    vi.mocked(mockConfig.getIdeMode).mockReturnValue(true);
    vi.mocked(mockConfig.getIdeClient).mockReturnValue({
      getCurrentIde: () => IDE_DEFINITIONS.vscode,
      getDetectedIdeDisplayName: () => 'VS Code',
      getConnectionStatus: () => ({
        status: core.IDEConnectionStatus.Connected,
      }),
    } as ReturnType<Config['getIdeClient']>);
    const command = ideCommand(mockConfig);
    for (const sub of command?.subCommands ?? []) {
      expect(sub.autoExecute).toBe(true);
    }
  });

  it('should show disable command when connected', () => {
    vi.mocked(mockConfig.getIdeMode).mockReturnValue(true);
    vi.mocked(mockConfig.getIdeClient).mockReturnValue({
      getCurrentIde: () => IDE_DEFINITIONS.vscode,
      getDetectedIdeDisplayName: () => 'VS Code',
      getConnectionStatus: () => ({
        status: core.IDEConnectionStatus.Connected,
      }),
    } as ReturnType<Config['getIdeClient']>);
    const command = ideCommand(mockConfig);
    expect(command).not.toBeNull();
    const subCommandNames = command?.subCommands?.map((cmd) => cmd.name);
    expect(subCommandNames).toContain('disable');
    expect(subCommandNames).not.toContain('enable');
  });

  describe('status subcommand', () => {
    const mockGetConnectionStatus = vi.fn();
    beforeEach(() => {
      vi.mocked(mockConfig.getIdeClient).mockReturnValue({
        getConnectionStatus: mockGetConnectionStatus,
        getCurrentIde: () => IDE_DEFINITIONS.vscode,
        getDetectedIdeDisplayName: () => 'VS Code',
      } as unknown as ReturnType<Config['getIdeClient']>);
    });

    it('should show connected status', async () => {
      mockGetConnectionStatus.mockReturnValue({
        status: core.IDEConnectionStatus.Connected,
      });
      const command = ideCommand(mockConfig);
      const result = await command!.subCommands!.find(
        (c) => c.name === 'status',
      )!.action!(mockContext, '');
      expect(mockGetConnectionStatus).toHaveBeenCalled();
      expect(result).toEqual({
        type: 'message',
        messageType: 'info',
        content: '[CONNECTED] Connected to VS Code',
      });
    });

    it('should show connecting status', async () => {
      mockGetConnectionStatus.mockReturnValue({
        status: core.IDEConnectionStatus.Connecting,
      });
      const command = ideCommand(mockConfig);
      const result = await command!.subCommands!.find(
        (c) => c.name === 'status',
      )!.action!(mockContext, '');
      expect(mockGetConnectionStatus).toHaveBeenCalled();
      expect(result).toEqual({
        type: 'message',
        messageType: 'info',
        content: `[CONNECTING] Connecting...`,
      });
    });
    it('should show disconnected status', async () => {
      mockGetConnectionStatus.mockReturnValue({
        status: core.IDEConnectionStatus.Disconnected,
      });
      const command = ideCommand(mockConfig);
      const result = await command!.subCommands!.find(
        (c) => c.name === 'status',
      )!.action!(mockContext, '');
      expect(mockGetConnectionStatus).toHaveBeenCalled();
      expect(result).toEqual({
        type: 'message',
        messageType: 'error',
        content: `[DISCONNECTED] Disconnected`,
      });
    });

    it('should show disconnected status with details', async () => {
      const details = 'Something went wrong';
      mockGetConnectionStatus.mockReturnValue({
        status: core.IDEConnectionStatus.Disconnected,
        details,
      });
      const command = ideCommand(mockConfig);
      const result = await command!.subCommands!.find(
        (c) => c.name === 'status',
      )!.action!(mockContext, '');
      expect(mockGetConnectionStatus).toHaveBeenCalled();
      expect(result).toEqual({
        type: 'message',
        messageType: 'error',
        content: `[DISCONNECTED] Disconnected: ${details}`,
      });
    });
  });

  describe('install subcommand', () => {
    const mockInstall = vi.fn();
    beforeEach(() => {
      vi.mocked(mockConfig.getIdeMode).mockReturnValue(true);
      vi.mocked(mockConfig.getIdeClient).mockReturnValue({
        getCurrentIde: () => IDE_DEFINITIONS.vscode,
        getConnectionStatus: () => ({
          status: core.IDEConnectionStatus.Disconnected,
        }),
        getDetectedIdeDisplayName: () => 'VS Code',
        connect: vi.fn(),
      } as unknown as ReturnType<Config['getIdeClient']>);
      vi.mocked(core.getIdeInstaller).mockReturnValue({
        install: mockInstall,
        isInstalled: vi.fn(),
      });
      platformSpy.mockReturnValue('linux');
    });

    it('should install the extension', async () => {
      mockInstall.mockResolvedValue({
        success: true,
        message: 'Successfully installed.',
      });

      const command = ideCommand(mockConfig);
      await command!.subCommands!.find((c) => c.name === 'install')!.action!(
        mockContext,
        '',
      );

      expect(core.getIdeInstaller).toHaveBeenCalledWith(IDE_DEFINITIONS.vscode);
      expect(mockInstall).toHaveBeenCalled();
      expect(mockContext.ui.addItem).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'info',
          text: `Installing IDE companion from marketplace...`,
        }),
        expect.any(Number),
      );
      expect(mockContext.ui.addItem).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'info',
          text: 'Successfully installed.',
        }),
        expect.any(Number),
      );
    }, 10000);

    it('should show an error if installation fails', async () => {
      mockInstall.mockResolvedValue({
        success: false,
        message: 'Installation failed.',
      });

      const command = ideCommand(mockConfig);
      await command!.subCommands!.find((c) => c.name === 'install')!.action!(
        mockContext,
        '',
      );

      expect(core.getIdeInstaller).toHaveBeenCalledWith(IDE_DEFINITIONS.vscode);
      expect(mockInstall).toHaveBeenCalled();
      expect(mockContext.ui.addItem).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'info',
          text: `Installing IDE companion from marketplace...`,
        }),
        expect.any(Number),
      );
      expect(mockContext.ui.addItem).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'error',
          text: 'Installation failed.',
        }),
        expect.any(Number),
      );
    });
  });
});
