/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  listExtensions,
  LlxprtExtension,
} from '@vybestack/llxprt-code-core';
import type { ExtensionUpdateInfo } from '../../config/extension.js';
import { getErrorMessage } from '../../utils/errors.js';
import {
  type HistoryItemWithoutId,
  MessageType,
  type HistoryItemExtensionsList,
} from '../types.js';
import { type SlashCommand, CommandKind } from './types.js';
import type { UseHistoryManagerReturn } from '../hooks/useHistoryManager.js';
import type { ExtensionUpdateAction } from '../state/extensions.js';

export interface ExtensionCommandOperations {
  readonly list: () => ReturnType<typeof listExtensions>;
  readonly isAdminDisabled: () => boolean;
  readonly restart: ((extension: LlxprtExtension) => Promise<void>) | undefined;
  readonly install: (source: string) => Promise<void>;
  readonly uninstall: (name: string) => Promise<void>;
  readonly addItem: UseHistoryManagerReturn['addItem'];
  readonly setPendingItem: (item: HistoryItemWithoutId | null) => void;
  readonly dispatchUpdate: (action: ExtensionUpdateAction) => void;
}

function showMessageIfNoExtensions(
  operations: ExtensionCommandOperations,
  extensions: unknown[],
): boolean {
  if (extensions.length === 0) {
    operations.addItem(
      {
        type: MessageType.INFO,
        text: 'No extensions installed. Run `/extensions explore` to check out the gallery.',
      },
      Date.now(),
    );
    return true;
  }
  return false;
}

async function listAction(operations: ExtensionCommandOperations) {
  const extensions = operations.list();

  // Check if extensions are disabled by admin
  if (extensions.length === 0) {
    const adminDisabled = operations.isAdminDisabled();

    if (adminDisabled) {
      operations.addItem(
        {
          type: MessageType.INFO,
          text: 'Extensions are disabled by your administrator.',
        },
        Date.now(),
      );
      return;
    }
  }

  if (showMessageIfNoExtensions(operations, extensions)) {
    return;
  }

  const historyItem: HistoryItemExtensionsList = {
    type: MessageType.EXTENSIONS_LIST,
    extensions,
  };

  operations.addItem(historyItem);
}

function reportMissingExtensions(
  operations: ExtensionCommandOperations,
  names: string[] | null,
): void {
  if (names == null || names.length === 0) {
    return;
  }

  const extensions = operations.list();
  for (const name of names) {
    const extension = extensions.find((extension) => extension.name === name);
    if (!extension) {
      operations.addItem(
        {
          type: MessageType.ERROR,
          text: `Extension ${name} not found.`,
        },
        Date.now(),
      );
    }
  }
}

function dispatchUpdateAndReport(
  operations: ExtensionCommandOperations,
  all: boolean,
  names: string[] | null,
  historyItem: HistoryItemExtensionsList,
  resolveUpdateComplete: (updateInfo: ExtensionUpdateInfo[]) => void,
): void {
  try {
    operations.setPendingItem(historyItem);

    operations.dispatchUpdate({
      type: 'SCHEDULE_UPDATE',
      payload: {
        all,
        names,
        onComplete: (updateInfos: ExtensionUpdateInfo[]) => {
          resolveUpdateComplete(updateInfos);
        },
      },
    });
    reportMissingExtensions(operations, names);
  } catch (error) {
    resolveUpdateComplete([]);
    operations.addItem(
      {
        type: MessageType.ERROR,
        text: getErrorMessage(error),
      },
      Date.now(),
    );
  }
}

function handleUpdateComplete(
  operations: ExtensionCommandOperations,
  updateInfos: ExtensionUpdateInfo[],
  historyItem: HistoryItemExtensionsList,
): void {
  if (updateInfos.length === 0) {
    operations.addItem(
      {
        type: MessageType.INFO,
        text: 'No extensions to update.',
      },
      Date.now(),
    );
  }

  operations.addItem(historyItem);
  operations.setPendingItem(null);
}

function updateAction(
  operations: ExtensionCommandOperations,
  args: string,
): Promise<void> {
  const updateArgs = args.split(' ').filter((value) => value.length > 0);
  const all = updateArgs.length === 1 && updateArgs[0] === '--all';
  const names = all ? null : updateArgs;

  if (!all && names?.length === 0) {
    operations.addItem(
      {
        type: MessageType.ERROR,
        text: 'Usage: /extensions update <extension-names>|--all',
      },
      Date.now(),
    );
    return Promise.resolve();
  }

  let resolveUpdateComplete: (updateInfo: ExtensionUpdateInfo[]) => void;
  const updateComplete = new Promise<ExtensionUpdateInfo[]>(
    (resolve) => (resolveUpdateComplete = resolve),
  );

  const extensions = operations.list();

  if (showMessageIfNoExtensions(operations, extensions)) {
    return Promise.resolve();
  }

  const historyItem: HistoryItemExtensionsList = {
    type: MessageType.EXTENSIONS_LIST,
    extensions,
  };

  void updateComplete.then((updateInfos) =>
    handleUpdateComplete(operations, updateInfos, historyItem),
  );

  dispatchUpdateAndReport(
    operations,
    all,
    names,
    historyItem,
    resolveUpdateComplete!,
  );
  return updateComplete.then((_) => {});
}

function createListCommand(
  operations: ExtensionCommandOperations,
): SlashCommand {
  return {
    name: 'list',
    description: 'List active extensions',
    kind: CommandKind.BUILT_IN,
    autoExecute: true,
    action: () => listAction(operations),
  };
}

function createUpdateCommand(
  operations: ExtensionCommandOperations,
): SlashCommand {
  return {
    name: 'update',
    description: 'Update extensions. Usage: update <extension-names>|--all',
    kind: CommandKind.BUILT_IN,
    action: (_invocation, args) => updateAction(operations, args),
    completion: async (_invocation, partialArg) => {
      const extensions = operations.list();
      const extensionNames = extensions.map((ext) => ext.name);
      const suggestions = extensionNames.filter((name) =>
        name.startsWith(partialArg),
      );

      if ('--all'.startsWith(partialArg) || 'all'.startsWith(partialArg)) {
        suggestions.unshift('--all');
      }

      return suggestions;
    },
  };
}

function filterExtensionsToRestart(
  extensions: LlxprtExtension[],
  names: string[] | null,
  operations: ExtensionCommandOperations,
): LlxprtExtension[] {
  let extensionsToRestart = extensions.filter(
    (extension: LlxprtExtension) => extension.isActive,
  );
  if (names) {
    extensionsToRestart = extensionsToRestart.filter(
      (extension: LlxprtExtension) => names.includes(extension.name),
    );
    if (names.length !== extensionsToRestart.length) {
      const notFound = names.filter(
        (name) =>
          !extensionsToRestart.some(
            (extension: LlxprtExtension) => extension.name === name,
          ),
      );
      if (notFound.length > 0) {
        operations.addItem(
          {
            type: MessageType.WARNING,
            text: `Extension(s) not found or not active: ${notFound.join(', ')}`,
          },
          Date.now(),
        );
      }
    }
  }
  return extensionsToRestart;
}

async function performRestart(
  restart: (extension: LlxprtExtension) => Promise<void>,
  extensionsToRestart: LlxprtExtension[],
  operations: ExtensionCommandOperations,
): Promise<void> {
  const s = extensionsToRestart.length > 1 ? 's' : '';

  operations.addItem({
    type: MessageType.INFO,
    text: `Restarting ${extensionsToRestart.length} extension${s}...`,
  });

  const results = await Promise.allSettled(
    extensionsToRestart.map(async (extension: LlxprtExtension) => {
      if (extension.isActive) {
        await restart(extension);
        operations.dispatchUpdate({
          type: 'RESTARTED',
          payload: {
            name: extension.name,
          },
        });
      }
    }),
  );

  const failureMessages = results
    .map((result, index) =>
      result.status === 'rejected'
        ? `${extensionsToRestart[index].name}: ${getErrorMessage(result.reason)}`
        : null,
    )
    .filter((message): message is string => message !== null);

  if (failureMessages.length > 0) {
    const errorMessages = failureMessages.join('\n  ');
    operations.addItem(
      {
        type: MessageType.ERROR,
        text: `Failed to restart some extensions:\n  ${errorMessages}`,
      },
      Date.now(),
    );
  } else {
    operations.addItem(
      {
        type: MessageType.INFO,
        text: `${extensionsToRestart.length} extension${s} restarted successfully.`,
      },
      Date.now(),
    );
  }
}

async function restartAction(
  operations: ExtensionCommandOperations,
  args: string,
): Promise<void> {
  const restart = operations.restart;
  if (!restart) {
    operations.addItem(
      {
        type: MessageType.ERROR,
        text: "Extensions are not yet loaded, can't restart yet",
      },
      Date.now(),
    );
    return;
  }

  const extensions = operations.list();
  if (showMessageIfNoExtensions(operations, extensions)) {
    return;
  }

  const restartArgs = args.split(' ').filter((value) => value.length > 0);
  const all = restartArgs.length === 1 && restartArgs[0] === '--all';
  const names = all ? null : restartArgs;
  if (!all && names?.length === 0) {
    operations.addItem(
      {
        type: MessageType.ERROR,
        text: 'Usage: /extensions restart <extension-names>|--all',
      },
      Date.now(),
    );
    return;
  }

  const extensionsToRestart = filterExtensionsToRestart(
    extensions,
    names,
    operations,
  );
  if (extensionsToRestart.length === 0) {
    return;
  }

  await performRestart(restart, extensionsToRestart, operations);
}

async function completeExtensions(
  operations: ExtensionCommandOperations,
  partialArg: string,
  activeOnly: boolean,
): Promise<string[]> {
  let extensions = operations.list();

  // Filter by active state based on the command
  if (activeOnly) {
    extensions = extensions.filter((ext) => ext.isActive);
  }

  const extensionNames = extensions.map((ext) => ext.name);
  return extensionNames.filter((name) => name.startsWith(partialArg));
}

function createRestartCommand(
  operations: ExtensionCommandOperations,
): SlashCommand {
  return {
    name: 'restart',
    description: 'Restart extensions. Usage: restart <extension-names>|--all',
    kind: CommandKind.BUILT_IN,
    action: (_invocation, args) => restartAction(operations, args),
    completion: (_invocation, partialArg) =>
      completeExtensions(operations, partialArg, true),
  };
}

async function installAction(
  operations: ExtensionCommandOperations,
  args: string,
): Promise<void> {
  const restart = operations.restart;

  // Check if extension reloading is enabled
  if (!restart) {
    operations.addItem(
      {
        type: MessageType.ERROR,
        text: 'Extension reloading is not enabled. Use the CLI command instead.',
      },
      Date.now(),
    );
    return;
  }

  const source = args.trim();

  if (!source) {
    operations.addItem(
      {
        type: MessageType.ERROR,
        text: 'Usage: /extensions install <source>',
      },
      Date.now(),
    );
    return;
  }

  // Validate source for safety (check for shell injection)
  const isUrl =
    source.startsWith('http://') ||
    source.startsWith('https://') ||
    source.startsWith('git@') ||
    source.startsWith('sso://');

  if (!isUrl && /[;&|`'"]/.test(source)) {
    operations.addItem(
      {
        type: MessageType.ERROR,
        text: 'Invalid characters in source path.',
      },
      Date.now(),
    );
    return;
  }

  operations.addItem(
    {
      type: MessageType.INFO,
      text: `Installing extension from ${source}...`,
    },
    Date.now(),
  );

  try {
    await operations.install(source);

    operations.addItem(
      {
        type: MessageType.INFO,
        text: `Extension installed successfully.`,
      },
      Date.now(),
    );
  } catch (error) {
    operations.addItem(
      {
        type: MessageType.ERROR,
        text: getErrorMessage(error),
      },
      Date.now(),
    );
  }
}

async function uninstallAction(
  operations: ExtensionCommandOperations,
  args: string,
): Promise<void> {
  const restart = operations.restart;

  if (!restart) {
    operations.addItem(
      {
        type: MessageType.ERROR,
        text: 'Extension reloading is not enabled. Use the CLI command instead.',
      },
      Date.now(),
    );
    return;
  }

  const name = args.trim();

  if (!name) {
    operations.addItem(
      {
        type: MessageType.ERROR,
        text: 'Usage: /extensions uninstall <name>',
      },
      Date.now(),
    );
    return;
  }

  operations.addItem(
    {
      type: MessageType.INFO,
      text: `Uninstalling extension ${name}...`,
    },
    Date.now(),
  );

  try {
    await operations.uninstall(name);

    operations.addItem(
      {
        type: MessageType.INFO,
        text: `Extension ${name} uninstalled successfully.`,
      },
      Date.now(),
    );
  } catch (error) {
    operations.addItem(
      {
        type: MessageType.ERROR,
        text: getErrorMessage(error),
      },
      Date.now(),
    );
  }
}

function createInstallCommand(
  operations: ExtensionCommandOperations,
): SlashCommand {
  return {
    name: 'install',
    description: 'Install an extension from a git repo or local path',
    kind: CommandKind.BUILT_IN,
    autoExecute: false,
    action: (_invocation, args) => installAction(operations, args),
  };
}

function createUninstallCommand(
  operations: ExtensionCommandOperations,
): SlashCommand {
  return {
    name: 'uninstall',
    description: 'Uninstall an extension',
    kind: CommandKind.BUILT_IN,
    autoExecute: false,
    action: (_invocation, args) => uninstallAction(operations, args),
    completion: (_invocation, partialArg) =>
      completeExtensions(operations, partialArg, false),
  };
}

export function createExtensionsCommand(
  operations: ExtensionCommandOperations,
): SlashCommand {
  return {
    name: 'extensions',
    description: 'Manage extensions',
    kind: CommandKind.BUILT_IN,
    subCommands: [
      createListCommand(operations),
      createUpdateCommand(operations),
      createRestartCommand(operations),
      createInstallCommand(operations),
      createUninstallCommand(operations),
    ],
    action: () => listAction(operations),
  };
}
