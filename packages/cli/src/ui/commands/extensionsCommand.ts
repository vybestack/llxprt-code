/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { writeCommandOutput } from '../hooks/command-journal-output.js';

import { listExtensions } from '@vybestack/llxprt-code-core';
import type { ExtensionUpdateInfo } from '../../config/extension.js';
import type { LlxprtExtension } from '@vybestack/llxprt-code-core';
import { getErrorMessage } from '../../utils/errors.js';
import { MessageType, type HistoryItemExtensionsList } from '../types.js';
import {
  type CommandContext,
  type SlashCommand,
  CommandKind,
} from './types.js';
import { loadSettings } from '../../config/settings.js';

async function showMessageIfNoExtensions(
  context: CommandContext,
  extensions: unknown[],
): Promise<boolean> {
  if (extensions.length === 0) {
    await writeCommandOutput(
      () => context.services.agent?.agentClient.getHistoryService() ?? null,
      context.services.agent?.session,
      context.recordingOwner,
      context.ui.addItem,
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

  // Check if extensions are disabled by admin
  if (extensions.length === 0) {
    const settings = loadSettings().merged;
    const adminDisabled = settings.admin?.extensions?.enabled === false;

    if (adminDisabled) {
      await writeCommandOutput(
        () => context.services.agent?.agentClient.getHistoryService() ?? null,
        context.services.agent?.session,
        context.recordingOwner,
        context.ui.addItem,
        {
          type: MessageType.INFO,
          text: 'Extensions are disabled by your administrator.',
        },
        Date.now(),
      );
      return;
    }
  }

  if (await showMessageIfNoExtensions(context, extensions)) {
    return;
  }

  const historyItem: HistoryItemExtensionsList = {
    type: MessageType.EXTENSIONS_LIST,
    extensions,
  };

  await writeCommandOutput(
    () => context.services.agent?.agentClient.getHistoryService() ?? null,
    context.services.agent?.session,
    context.recordingOwner,
    context.ui.addItem,
    historyItem,
  );
}

async function reportMissingExtensions(
  context: CommandContext,
  names: string[] | null,
): Promise<void> {
  if (names == null || names.length === 0) {
    return;
  }

  const extensions = listExtensions(context.services.config!);
  for (const name of names) {
    const extension = extensions.find((extension) => extension.name === name);
    if (!extension) {
      await writeCommandOutput(
        () => context.services.agent?.agentClient.getHistoryService() ?? null,
        context.services.agent?.session,
        context.recordingOwner,
        context.ui.addItem,
        {
          type: MessageType.ERROR,
          text: `Extension ${name} not found.`,
        },
        Date.now(),
      );
    }
  }
}

async function dispatchUpdateAndReport(
  context: CommandContext,
  all: boolean,
  names: string[] | null,
  historyItem: HistoryItemExtensionsList,
  resolveUpdateComplete: (updateInfo: ExtensionUpdateInfo[]) => void,
): Promise<void> {
  try {
    context.ui.setPendingItem(historyItem);

    context.ui.dispatchExtensionStateUpdate({
      type: 'SCHEDULE_UPDATE',
      payload: {
        all,
        names,
        onComplete: (updateInfos: ExtensionUpdateInfo[]) => {
          resolveUpdateComplete(updateInfos);
        },
      },
    });
    await reportMissingExtensions(context, names);
  } catch (error) {
    resolveUpdateComplete([]);
    await writeCommandOutput(
      () => context.services.agent?.agentClient.getHistoryService() ?? null,
      context.services.agent?.session,
      context.recordingOwner,
      context.ui.addItem,
      {
        type: MessageType.ERROR,
        text: getErrorMessage(error),
      },
      Date.now(),
    );
  }
}

async function handleUpdateComplete(
  context: CommandContext,
  updateInfos: ExtensionUpdateInfo[],
  historyItem: HistoryItemExtensionsList,
): Promise<void> {
  if (updateInfos.length === 0) {
    await writeCommandOutput(
      () => context.services.agent?.agentClient.getHistoryService() ?? null,
      context.services.agent?.session,
      context.recordingOwner,
      context.ui.addItem,
      {
        type: MessageType.INFO,
        text: 'No extensions to update.',
      },
      Date.now(),
    );
  }

  await writeCommandOutput(
    () => context.services.agent?.agentClient.getHistoryService() ?? null,
    context.services.agent?.session,
    context.recordingOwner,
    context.ui.addItem,
    historyItem,
  );
  context.ui.setPendingItem(null);
}

async function updateAction(
  context: CommandContext,
  args: string,
): Promise<void> {
  const updateArgs = args.split(' ').filter((value) => value.length > 0);
  const all = updateArgs.length === 1 && updateArgs[0] === '--all';
  const names = all ? null : updateArgs;

  if (!all && names?.length === 0) {
    await writeCommandOutput(
      () => context.services.agent?.agentClient.getHistoryService() ?? null,
      context.services.agent?.session,
      context.recordingOwner,
      context.ui.addItem,
      {
        type: MessageType.ERROR,
        text: 'Usage: /extensions update <extension-names>|--all',
      },
      Date.now(),
    );
    return;
  }

  let resolveUpdateComplete: (updateInfo: ExtensionUpdateInfo[]) => void;
  const updateComplete = new Promise<ExtensionUpdateInfo[]>(
    (resolve) => (resolveUpdateComplete = resolve),
  );

  const extensions = context.services.config
    ? listExtensions(context.services.config)
    : [];

  if (await showMessageIfNoExtensions(context, extensions)) {
    return;
  }

  const historyItem: HistoryItemExtensionsList = {
    type: MessageType.EXTENSIONS_LIST,
    extensions,
  };

  await dispatchUpdateAndReport(
    context,
    all,
    names,
    historyItem,
    resolveUpdateComplete!,
  );
  await handleUpdateComplete(context, await updateComplete, historyItem);
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

async function filterExtensionsToRestart(
  extensions: LlxprtExtension[],
  names: string[] | null,
  context: CommandContext,
): Promise<LlxprtExtension[]> {
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
        await writeCommandOutput(
          () => context.services.agent?.agentClient.getHistoryService() ?? null,
          context.services.agent?.session,
          context.recordingOwner,
          context.ui.addItem,
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
  context: CommandContext,
): Promise<void> {
  const s = extensionsToRestart.length > 1 ? 's' : '';

  await writeCommandOutput(
    () => context.services.agent?.agentClient.getHistoryService() ?? null,
    context.services.agent?.session,
    context.recordingOwner,
    context.ui.addItem,
    {
      type: MessageType.INFO,
      text: `Restarting ${extensionsToRestart.length} extension${s}...`,
    },
  );

  const results = await Promise.allSettled(
    extensionsToRestart.map(async (extension: LlxprtExtension) => {
      if (extension.isActive) {
        await restart(extension);
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
    await writeCommandOutput(
      () => context.services.agent?.agentClient.getHistoryService() ?? null,
      context.services.agent?.session,
      context.recordingOwner,
      context.ui.addItem,
      {
        type: MessageType.ERROR,
        text: `Failed to restart some extensions:\n  ${errorMessages}`,
      },
      Date.now(),
    );
  } else {
    await writeCommandOutput(
      () => context.services.agent?.agentClient.getHistoryService() ?? null,
      context.services.agent?.session,
      context.recordingOwner,
      context.ui.addItem,
      {
        type: MessageType.INFO,
        text: `${extensionsToRestart.length} extension${s} restarted successfully.`,
      },
      Date.now(),
    );
  }
}

async function restartAction(
  context: CommandContext,
  args: string,
): Promise<void> {
  const restart = context.services.config?.restartExtension;
  if (!restart) {
    await writeCommandOutput(
      () => context.services.agent?.agentClient.getHistoryService() ?? null,
      context.services.agent?.session,
      context.recordingOwner,
      context.ui.addItem,
      {
        type: MessageType.ERROR,
        text: "Extensions are not yet loaded, can't restart yet",
      },
      Date.now(),
    );
    return;
  }

  const extensions = context.services.config?.getExtensions() ?? [];
  if (await showMessageIfNoExtensions(context, extensions)) {
    return;
  }

  const restartArgs = args.split(' ').filter((value) => value.length > 0);
  const all = restartArgs.length === 1 && restartArgs[0] === '--all';
  const names = all ? null : restartArgs;
  if (!all && names?.length === 0) {
    await writeCommandOutput(
      () => context.services.agent?.agentClient.getHistoryService() ?? null,
      context.services.agent?.session,
      context.recordingOwner,
      context.ui.addItem,
      {
        type: MessageType.ERROR,
        text: 'Usage: /extensions restart <extension-names>|--all',
      },
      Date.now(),
    );
    return;
  }

  const extensionsToRestart = await filterExtensionsToRestart(
    extensions,
    names,
    context,
  );
  if (extensionsToRestart.length === 0) {
    return;
  }

  await performRestart(restart, extensionsToRestart, context);
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

async function validateInstallSource(
  context: CommandContext,
  args: string,
): Promise<string | undefined> {
  const source = args.trim();

  if (!source) {
    await writeCommandOutput(
      () => context.services.agent?.agentClient.getHistoryService() ?? null,
      context.services.agent?.session,
      context.recordingOwner,
      context.ui.addItem,
      {
        type: MessageType.ERROR,
        text: 'Usage: /extensions install <source>',
      },
      Date.now(),
    );
    return undefined;
  }

  // Validate source for safety (check for shell injection)
  const isUrl =
    source.startsWith('http://') ||
    source.startsWith('https://') ||
    source.startsWith('git@') ||
    source.startsWith('sso://');

  if (!isUrl && /[;&|`'"]/.test(source)) {
    await writeCommandOutput(
      () => context.services.agent?.agentClient.getHistoryService() ?? null,
      context.services.agent?.session,
      context.recordingOwner,
      context.ui.addItem,
      {
        type: MessageType.ERROR,
        text: 'Invalid characters in source path.',
      },
      Date.now(),
    );
    return undefined;
  }

  return source;
}

async function installAction(
  context: CommandContext,
  args: string,
): Promise<void> {
  const restart = context.services.config?.restartExtension;

  // Check if extension reloading is enabled
  if (!restart) {
    await writeCommandOutput(
      () => context.services.agent?.agentClient.getHistoryService() ?? null,
      context.services.agent?.session,
      context.recordingOwner,
      context.ui.addItem,
      {
        type: MessageType.ERROR,
        text: 'Extension reloading is not enabled. Use the CLI command instead.',
      },
      Date.now(),
    );
    return;
  }

  const source = await validateInstallSource(context, args);
  if (source === undefined) return;

  await writeCommandOutput(
    () => context.services.agent?.agentClient.getHistoryService() ?? null,
    context.services.agent?.session,
    context.recordingOwner,
    context.ui.addItem,
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

    await writeCommandOutput(
      () => context.services.agent?.agentClient.getHistoryService() ?? null,
      context.services.agent?.session,
      context.recordingOwner,
      context.ui.addItem,
      {
        type: MessageType.INFO,
        text: `Extension installed successfully.`,
      },
      Date.now(),
    );
  } catch (error) {
    await writeCommandOutput(
      () => context.services.agent?.agentClient.getHistoryService() ?? null,
      context.services.agent?.session,
      context.recordingOwner,
      context.ui.addItem,
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
  const restart = context.services.config?.restartExtension;

  if (!restart) {
    await writeCommandOutput(
      () => context.services.agent?.agentClient.getHistoryService() ?? null,
      context.services.agent?.session,
      context.recordingOwner,
      context.ui.addItem,
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
    await writeCommandOutput(
      () => context.services.agent?.agentClient.getHistoryService() ?? null,
      context.services.agent?.session,
      context.recordingOwner,
      context.ui.addItem,
      {
        type: MessageType.ERROR,
        text: 'Usage: /extensions uninstall <name>',
      },
      Date.now(),
    );
    return;
  }

  await writeCommandOutput(
    () => context.services.agent?.agentClient.getHistoryService() ?? null,
    context.services.agent?.session,
    context.recordingOwner,
    context.ui.addItem,
    {
      type: MessageType.INFO,
      text: `Uninstalling extension ${name}...`,
    },
    Date.now(),
  );

  try {
    const { uninstallExtension } = await import('../../config/extension.js');
    await uninstallExtension(name, false);

    await writeCommandOutput(
      () => context.services.agent?.agentClient.getHistoryService() ?? null,
      context.services.agent?.session,
      context.recordingOwner,
      context.ui.addItem,
      {
        type: MessageType.INFO,
        text: `Extension ${name} uninstalled successfully.`,
      },
      Date.now(),
    );
  } catch (error) {
    await writeCommandOutput(
      () => context.services.agent?.agentClient.getHistoryService() ?? null,
      context.services.agent?.session,
      context.recordingOwner,
      context.ui.addItem,
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
