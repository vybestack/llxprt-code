/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as path from 'node:path';
import {
  IDEConnectionStatus,
  IDE_DEFINITIONS,
  type getIdeInstaller,
  type IdeClient,
  type File,
  LLXPRT_CODE_COMPANION_EXTENSION_NAME,
} from '@vybestack/llxprt-code-core';
import {
  type SlashCommand,
  type SlashCommandActionReturn,
  CommandKind,
} from './types.js';
import type { UseHistoryManagerReturn } from '../hooks/useHistoryManager.js';

export interface IdeCommandOperations {
  readonly getConnectionStatus: IdeClient['getConnectionStatus'];
  readonly getDetectedIdeDisplayName: IdeClient['getDetectedIdeDisplayName'];
  readonly getIdeContext: IdeClient['getIdeContext'];
  readonly currentIDE: ReturnType<IdeClient['getCurrentIde']>;
  readonly connect: () => Promise<void>;
  readonly setIdeMode: (enabled: boolean) => void;
  readonly setConnected: () => Promise<void>;
  readonly setDisconnected: () => Promise<void>;
  readonly persistMode: (enabled: boolean) => void;
  readonly installCompanion: (
    announce: () => void,
  ) => Promise<
    | Awaited<
        ReturnType<NonNullable<ReturnType<typeof getIdeInstaller>>['install']>
      >
    | undefined
  >;
  readonly addItem: UseHistoryManagerReturn['addItem'];
}

function formatFileList(openFiles: File[]): string {
  const basenameCounts = new Map<string, number>();
  for (const file of openFiles) {
    const basename = path.basename(file.path);
    basenameCounts.set(basename, (basenameCounts.get(basename) ?? 0) + 1);
  }

  const fileList = openFiles
    .map((file: File) => {
      const basename = path.basename(file.path);
      const isDuplicate = (basenameCounts.get(basename) ?? 0) > 1;
      const parentDir = path.basename(path.dirname(file.path));
      const displayName = isDuplicate
        ? `${basename} (/${parentDir})`
        : basename;

      return `  - ${displayName}${file.isActive === true ? ' (active)' : ''}`;
    })
    .join('\n');

  const infoMessage = `
(Note: The file list is limited to a number of recently accessed files within your workspace and only includes local files on disk)`;

  return `\n\nOpen files:\n${fileList}\n${infoMessage}`;
}

async function getIdeStatusMessageWithFiles(
  operations: IdeCommandOperations,
): Promise<{
  messageType: 'info' | 'error';
  content: string;
}> {
  const connection = operations.getConnectionStatus();
  switch (connection.status) {
    case IDEConnectionStatus.Connected: {
      let content = `[CONNECTED] Connected to ${operations.getDetectedIdeDisplayName()}`;
      const openFiles = operations.getIdeContext()?.workspaceState?.openFiles;
      if (openFiles && openFiles.length > 0) {
        content += formatFileList(openFiles);
      }
      return {
        messageType: 'info',
        content,
      };
    }
    case IDEConnectionStatus.Connecting:
      return {
        messageType: 'info',
        content: `[CONNECTING] Connecting...`,
      };
    default: {
      let content = `[DISCONNECTED] Disconnected`;
      if (connection.details) {
        content += `: ${connection.details}`;
      }
      return {
        messageType: 'error',
        content,
      };
    }
  }
}

function buildStatusCommand(operations: IdeCommandOperations): SlashCommand {
  return {
    name: 'status',
    description: 'check status of IDE integration',
    kind: CommandKind.BUILT_IN,
    autoExecute: true,
    action: async (): Promise<SlashCommandActionReturn> => {
      const { messageType, content } =
        await getIdeStatusMessageWithFiles(operations);
      return {
        type: 'message',
        messageType,
        content,
      } as const;
    },
  };
}

async function pollForConnection(
  operations: IdeCommandOperations,
): Promise<void> {
  for (let i = 0; i < 10; i++) {
    operations.setIdeMode(true);
    await operations.connect();
    if (
      operations.getConnectionStatus().status === IDEConnectionStatus.Connected
    ) {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

function buildInstallCommand(operations: IdeCommandOperations): SlashCommand {
  return {
    name: 'install',
    description: `install required IDE companion for ${operations.getDetectedIdeDisplayName()}`,
    kind: CommandKind.BUILT_IN,
    autoExecute: true,
    action: async () => {
      const result = await operations.installCompanion(() => {
        operations.addItem(
          {
            type: 'info',
            text: 'Installing IDE companion from marketplace...',
          },
          Date.now(),
        );
      });
      if (result === undefined) {
        operations.addItem(
          {
            type: 'error',
            text: `No installer is available for ${operations.getDetectedIdeDisplayName()}. Please install the '${LLXPRT_CODE_COMPANION_EXTENSION_NAME}' extension manually from the marketplace.`,
          },
          Date.now(),
        );
        return;
      }
      operations.addItem(
        {
          type: result.success ? 'info' : 'error',
          text: result.message,
        },
        Date.now(),
      );
      if (result.success) {
        operations.persistMode(true);
        await pollForConnection(operations);

        const { messageType, content } =
          await getIdeStatusMessageWithFiles(operations);
        if (messageType === 'error') {
          operations.addItem(
            {
              type: messageType,
              text: `Failed to automatically enable IDE integration. To fix this, run the CLI in a new terminal window.`,
            },
            Date.now(),
          );
        } else {
          operations.addItem(
            {
              type: messageType,
              text: content,
            },
            Date.now(),
          );
        }
      }
    },
  };
}

function buildEnableCommand(operations: IdeCommandOperations): SlashCommand {
  return {
    name: 'enable',
    description: 'enable IDE integration',
    kind: CommandKind.BUILT_IN,
    autoExecute: true,
    action: async () => {
      operations.persistMode(true);
      operations.setIdeMode(true);
      await operations.setConnected();
    },
  };
}

function buildDisableCommand(operations: IdeCommandOperations): SlashCommand {
  return {
    name: 'disable',
    description: 'disable IDE integration',
    kind: CommandKind.BUILT_IN,
    autoExecute: true,
    action: async () => {
      operations.persistMode(false);
      operations.setIdeMode(false);
      await operations.setDisconnected();
    },
  };
}

export function createIdeCommand(
  operations: IdeCommandOperations | null,
): SlashCommand | null {
  if (operations === null) return null;
  const currentIDE = operations.currentIDE;
  if (!currentIDE) {
    return {
      name: 'ide',
      description: 'manage IDE integration',
      kind: CommandKind.BUILT_IN,
      action: (): SlashCommandActionReturn =>
        ({
          type: 'message',
          messageType: 'error',
          content: `IDE integration is not supported in your current environment. To use this feature, run LLxprt Code in one of these supported IDEs: ${Object.values(
            IDE_DEFINITIONS,
          )
            .map((ide) => ide.displayName)
            .join(', ')}`,
        }) as const,
    };
  }

  const statusCommand = buildStatusCommand(operations);
  const installCommand = buildInstallCommand(operations);
  const enableCommand = buildEnableCommand(operations);
  const disableCommand = buildDisableCommand(operations);

  const ideSlashCommand: SlashCommand = {
    name: 'ide',
    description: 'manage IDE integration',
    kind: CommandKind.BUILT_IN,
    subCommands: [],
  };

  const { status } = operations.getConnectionStatus();
  const isConnected = status === IDEConnectionStatus.Connected;

  if (isConnected) {
    ideSlashCommand.subCommands = [statusCommand, disableCommand];
  } else {
    ideSlashCommand.subCommands = [
      enableCommand,
      statusCommand,
      installCommand,
    ];
  }

  return ideSlashCommand;
}
