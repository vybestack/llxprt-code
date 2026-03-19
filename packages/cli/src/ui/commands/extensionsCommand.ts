/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { listExtensions } from '@vybestack/llxprt-code-core';
import type { ExtensionUpdateInfo } from '../../config/extension.js';
import type { GeminiCLIExtension } from '@vybestack/llxprt-code-core';
import { getErrorMessage } from '../../utils/errors.js';
import { MessageType, type HistoryItemExtensionsList } from '../types.js';
import {
  type CommandContext,
  type SlashCommand,
  CommandKind,
} from './types.js';

function showMessageIfNoExtensions(
  context: CommandContext,
  extensions: unknown[],
): boolean {
  if (extensions.length === 0) {
    context.ui.addItem(
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

async function listAction(context: CommandContext) {
  const extensions = context.services.config
    ? listExtensions(context.services.config)
    : [];

  if (showMessageIfNoExtensions(context, extensions)) {
    return;
  }

  const historyItem: HistoryItemExtensionsList = {
    type: MessageType.EXTENSIONS_LIST,
    extensions,
  };

  context.ui.addItem(historyItem, Date.now());
}

function updateAction(context: CommandContext, args: string): Promise<void> {
  const updateArgs = args.split(' ').filter((value) => value.length > 0);
  const all = updateArgs.length === 1 && updateArgs[0] === '--all';
  const names = all ? null : updateArgs;

  if (!all && names?.length === 0) {
    context.ui.addItem(
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

  const extensions = context.services.config
    ? listExtensions(context.services.config)
    : [];

  if (showMessageIfNoExtensions(context, extensions)) {
    return Promise.resolve();
  }

  const historyItem: HistoryItemExtensionsList = {
    type: MessageType.EXTENSIONS_LIST,
    extensions,
  };

  // eslint-disable-next-line @typescript-eslint/no-floating-promises
  updateComplete.then((updateInfos) => {
    if (updateInfos.length === 0) {
      context.ui.addItem(
        {
          type: MessageType.INFO,
          text: 'No extensions to update.',
        },
        Date.now(),
      );
    }

    context.ui.addItem(historyItem, Date.now());
    context.ui.setPendingItem(null);
  });

  try {
    context.ui.setPendingItem(historyItem);

    context.ui.dispatchExtensionStateUpdate({
      type: 'SCHEDULE_UPDATE',
      payload: {
        all,
        names,
        onComplete: (updateInfos) => {
          resolveUpdateComplete(updateInfos);
        },
      },
    });
    if (names?.length) {
      const extensions = listExtensions(context.services.config!);
      for (const name of names) {
        const extension = extensions.find(
          (extension) => extension.name === name,
        );
        if (!extension) {
          context.ui.addItem(
            {
              type: MessageType.ERROR,
              text: `Extension ${name} not found.`,
            },
            Date.now(),
          );
          continue;
        }
      }
    }
  } catch (error) {
    resolveUpdateComplete!([]);
    context.ui.addItem(
      {
        type: MessageType.ERROR,
        text: getErrorMessage(error),
      },
      Date.now(),
    );
  }
  return updateComplete.then((_) => {});
}

const listExtensionsCommand: SlashCommand = {
  name: 'list',
  description: 'List active extensions',
  kind: CommandKind.BUILT_IN,
  autoExecute: true,
  action: listAction,
};

const updateExtensionsCommand: SlashCommand = {
  name: 'update',
  description: 'Update extensions. Usage: update <extension-names>|--all',
  kind: CommandKind.BUILT_IN,
  action: updateAction,
  completion: async (context, partialArg) => {
    const extensions = context.services.config
      ? listExtensions(context.services.config)
      : [];
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

async function restartAction(
  context: CommandContext,
  args: string,
): Promise<void> {
  const extensionLoader = context.services.config?.getExtensionLoader();
  if (!extensionLoader) {
    context.ui.addItem(
      {
        type: MessageType.ERROR,
        text: "Extensions are not yet loaded, can't restart yet",
      },
      Date.now(),
    );
    return;
  }

  const extensions = extensionLoader.getExtensions();
  if (showMessageIfNoExtensions(context, extensions)) {
    return;
  }

  const restartArgs = args.split(' ').filter((value) => value.length > 0);
  const all = restartArgs.length === 1 && restartArgs[0] === '--all';
  const names = all ? null : restartArgs;
  if (!all && names?.length === 0) {
    context.ui.addItem(
      {
        type: MessageType.ERROR,
        text: 'Usage: /extensions restart <extension-names>|--all',
      },
      Date.now(),
    );
    return Promise.resolve();
  }

  let extensionsToRestart = extensionLoader
    .getExtensions()
    .filter((extension: GeminiCLIExtension) => extension.isActive);
  if (names) {
    extensionsToRestart = extensionsToRestart.filter(
      (extension: GeminiCLIExtension) => names.includes(extension.name),
    );
    if (names.length !== extensionsToRestart.length) {
      const notFound = names.filter(
        (name) =>
          !extensionsToRestart.some(
            (extension: GeminiCLIExtension) => extension.name === name,
          ),
      );
      if (notFound.length > 0) {
        context.ui.addItem(
          {
            type: MessageType.WARNING,
            text: `Extension(s) not found or not active: ${notFound.join(', ')}`,
          },
          Date.now(),
        );
      }
    }
  }
  if (extensionsToRestart.length === 0) {
    // We will have logged a different message above already.
    return;
  }

  const s = extensionsToRestart.length > 1 ? 's' : '';

  const restartingMessage = {
    type: MessageType.INFO,
    text: `Restarting ${extensionsToRestart.length} extension${s}...`,
  };
  context.ui.addItem(restartingMessage, Date.now());

  const results = await Promise.allSettled(
    extensionsToRestart.map(async (extension: GeminiCLIExtension) => {
      if (extension.isActive) {
        await extensionLoader.restartExtension(extension);
        context.ui.dispatchExtensionStateUpdate({
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
    context.ui.addItem(
      {
        type: MessageType.ERROR,
        text: `Failed to restart some extensions:\n  ${errorMessages}`,
      },
      Date.now(),
    );
  } else {
    context.ui.addItem(
      {
        type: MessageType.INFO,
        text: `${extensionsToRestart.length} extension${s} restarted successfully.`,
      },
      Date.now(),
    );
  }
}

async function completeExtensions(
  context: CommandContext,
  partialArg: string,
): Promise<string[]> {
  let extensions = context.services.config
    ? listExtensions(context.services.config)
    : [];

  // Filter by active state based on the command
  if (context.invocation?.name === 'restart') {
    extensions = extensions.filter((ext) => ext.isActive);
  }

  const extensionNames = extensions.map((ext) => ext.name);
  return extensionNames.filter((name) => name.startsWith(partialArg));
}

const restartCommand: SlashCommand = {
  name: 'restart',
  description: 'Restart extensions. Usage: restart <extension-names>|--all',
  kind: CommandKind.BUILT_IN,
  action: restartAction,
  completion: completeExtensions,
};

async function installAction(
  context: CommandContext,
  args: string,
): Promise<void> {
  const extensionLoader = context.services.config?.getExtensionLoader();

  // Check if extension reloading is enabled
  if (!extensionLoader) {
    context.ui.addItem(
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
    context.ui.addItem(
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
    context.ui.addItem(
      {
        type: MessageType.ERROR,
        text: 'Invalid characters in source path.',
      },
      Date.now(),
    );
    return;
  }

  context.ui.addItem(
    {
      type: MessageType.INFO,
      text: `Installing extension from ${source}...`,
    },
    Date.now(),
  );

  try {
    const { inferInstallMetadata, installOrUpdateExtension } = await import(
      '../../config/extension.js'
    );
    const installMetadata = await inferInstallMetadata(source);

    // Use requestConsentNonInteractive for slash commands
    const { requestConsentNonInteractive } = await import(
      '../../config/extension.js'
    );
    await installOrUpdateExtension(
      installMetadata,
      requestConsentNonInteractive,
    );

    context.ui.addItem(
      {
        type: MessageType.INFO,
        text: `Extension installed successfully.`,
      },
      Date.now(),
    );
  } catch (error) {
    context.ui.addItem(
      {
        type: MessageType.ERROR,
        text: getErrorMessage(error),
      },
      Date.now(),
    );
  }
}

async function uninstallAction(
  context: CommandContext,
  args: string,
): Promise<void> {
  const extensionLoader = context.services.config?.getExtensionLoader();

  if (!extensionLoader) {
    context.ui.addItem(
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
    context.ui.addItem(
      {
        type: MessageType.ERROR,
        text: 'Usage: /extensions uninstall <name>',
      },
      Date.now(),
    );
    return;
  }

  context.ui.addItem(
    {
      type: MessageType.INFO,
      text: `Uninstalling extension ${name}...`,
    },
    Date.now(),
  );

  try {
    const { uninstallExtension } = await import('../../config/extension.js');
    await uninstallExtension(name, false);

    context.ui.addItem(
      {
        type: MessageType.INFO,
        text: `Extension ${name} uninstalled successfully.`,
      },
      Date.now(),
    );
  } catch (error) {
    context.ui.addItem(
      {
        type: MessageType.ERROR,
        text: getErrorMessage(error),
      },
      Date.now(),
    );
  }
}

const installCommand: SlashCommand = {
  name: 'install',
  description: 'Install an extension from a git repo or local path',
  kind: CommandKind.BUILT_IN,
  autoExecute: false,
  action: installAction,
};

const uninstallCommand: SlashCommand = {
  name: 'uninstall',
  description: 'Uninstall an extension',
  kind: CommandKind.BUILT_IN,
  autoExecute: false,
  action: uninstallAction,
  completion: completeExtensions,
};

// Build subcommands list with conditional commands
const buildSubCommands = (): SlashCommand[] => {
  const commands = [listExtensionsCommand, updateExtensionsCommand];

  // Add commands that require extension reloading
  // Note: We can't check the config here, so we add them unconditionally
  // and check inside each action
  commands.push(restartCommand);
  commands.push(installCommand);
  commands.push(uninstallCommand);

  return commands;
};

export const extensionsCommand: SlashCommand = {
  name: 'extensions',
  description: 'Manage extensions',
  kind: CommandKind.BUILT_IN,
  subCommands: buildSubCommands(),
  action: (context, args) =>
    // Default to list if no subcommand is provided
    listExtensionsCommand.action!(context, args),
};
