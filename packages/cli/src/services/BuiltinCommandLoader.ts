/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { isDevelopment } from '../utils/installationInfo.js';
import type {
  SlashCommand,
  CommandContext,
  MessageActionReturn,
} from '../ui/commands/types.js';
import { CommandKind } from '../ui/commands/types.js';
import type {
  CliUiRuntime,
  ExtensionEnablementSource,
} from '../ui/cliUiRuntime.js';
import type { ICommandLoader } from './types.js';
import { docsCommand } from '../ui/commands/docsCommand.js';

import { editorCommand } from '../ui/commands/editorCommand.js';
import { helpCommand } from '../ui/commands/helpCommand.js';
import { ideCommand } from '../ui/commands/ideCommand.js';

import { privacyCommand } from '../ui/commands/privacyCommand.js';
import { mouseCommand } from '../ui/commands/mouseCommand.js';
import { quitCommand } from '../ui/commands/quitCommand.js';
import { themeCommand } from '../ui/commands/themeCommand.js';

import { settingsCommand } from '../ui/commands/settingsCommand.js';
import { setupGithubCommand } from '../ui/commands/setupGithubCommand.js';
import { diagnosticsCommand } from '../ui/commands/diagnosticsCommand.js';
import { terminalSetupCommand } from '../ui/commands/terminalSetupCommand.js';
import { debugCommand } from '../ui/commands/debugCommands.js';
import { permissionsCommand } from '../ui/commands/permissionsCommand.js';

import { setupCommand } from '../ui/commands/setupCommand.js';
/**
 * @plan PLAN-20260214-SESSIONBROWSER.P21
 */

/**
 * Loads the core, hard-coded slash commands that are an integral part
 * of the LLxprt Code application.
 */
export interface BuiltinCommandOwners {
  readonly skillsCommand: SlashCommand;
  readonly perfCommand: SlashCommand;
  readonly statsCommand: SlashCommand;
  readonly loggingCommand: SlashCommand;
  readonly aboutCommand: SlashCommand;
  readonly clearCommand: SlashCommand;
  readonly initCommand: SlashCommand;
  readonly vimCommand: SlashCommand;
  readonly uiProfileCommand: SlashCommand | null;
  readonly extensionsCommand: SlashCommand;
  readonly subagentCommand: SlashCommand;
  readonly hooksCommand: SlashCommand;
  readonly taskCommand: SlashCommand;
  readonly todoCommand: SlashCommand;
  readonly modelCommand: SlashCommand;
  readonly toolFormatCommand: SlashCommand;
  readonly setCommand: SlashCommand;
  readonly providerCommand: SlashCommand;
  readonly toolsCommand: SlashCommand;
  readonly directoryCommand: SlashCommand;
  readonly memoryCommand: SlashCommand;
  readonly imageCommand: SlashCommand;
  readonly bugCommand: SlashCommand;
  readonly policiesCommand: SlashCommand;
  readonly keyCommand: SlashCommand;
  readonly keyfileCommand: SlashCommand;
  readonly baseurlCommand: SlashCommand;
  readonly logoutCommand: SlashCommand;
  readonly authCommand: SlashCommand;
  readonly quotaCommand: SlashCommand;
  readonly mcpCommand: SlashCommand;
  readonly profileCommand: SlashCommand;
  readonly chatCommand: SlashCommand;
  readonly continueCommand: SlashCommand;
  readonly copyCommand: SlashCommand;
  readonly compressCommand: SlashCommand;
  readonly dumpcontextCommand: SlashCommand;
  readonly restoreCommand: SlashCommand | null;
  readonly toolkeyCommand: SlashCommand;
  readonly toolkeyfileCommand: SlashCommand;
}

export class BuiltinCommandLoader implements ICommandLoader {
  private extensionEnablementManager?: ExtensionEnablementSource;

  constructor(
    private readonly owners: BuiltinCommandOwners,
    private config: CliUiRuntime | null,
  ) {
    // Access extensionEnablementManager if available on config
    if (config && 'extensionEnablementManager' in config) {
      this.extensionEnablementManager = config.extensionEnablementManager;
    }
  }

  /**
   * Discovers and returns all built-in slash commands.
   * Filters out commands from disabled extensions.
   * @param signal An AbortSignal to allow cancellation.
   * @returns A promise that resolves to an array of SlashCommand objects.
   *
   * @plan:PLAN-20250117-SUBAGENTCONFIG.P15
   * @requirement:REQ-010
   */
  async loadCommands(_signal: AbortSignal): Promise<SlashCommand[]> {
    return this.loadCommandsSync();
  }

  loadCommandsSync(): SlashCommand[] {
    const allCommands = this.registerBuiltinCommands();

    // Filter out commands from disabled extensions
    if (this.extensionEnablementManager) {
      return allCommands.filter((cmd) => {
        // Built-in commands (no extensionName) are always included
        if (!cmd.extensionName) {
          return true;
        }

        // Extension commands are filtered by enabled state
        // Note: isEnabled requires a path, but for session-based enablement
        // we use an empty string as the path since session state doesn't depend on path
        return this.extensionEnablementManager!.isEnabled(
          cmd.extensionName,
          '',
        );
      });
    }

    return allCommands;
  }

  /**
   * Gathers all raw built-in command definitions, injects dependencies where
   * needed (e.g., config) and filters out any that are not available.
   *
   * @plan:PLAN-20250117-SUBAGENTCONFIG.P15
   * @requirement:REQ-010
   */
  private registerBuiltinCommands(): SlashCommand[] {
    const allDefinitions: Array<SlashCommand | null> = [
      this.owners.aboutCommand,
      this.owners.authCommand,
      this.owners.bugCommand,
      this.owners.chatCommand,
      this.owners.clearCommand,
      this.owners.compressCommand,
      this.owners.copyCommand,
      docsCommand,
      this.owners.directoryCommand,
      editorCommand,
      this.owners.extensionsCommand,
      helpCommand,
      ideCommand(this.config),
      this.owners.imageCommand,
      this.owners.initCommand,
      this.owners.mcpCommand,
      this.owners.memoryCommand,
      privacyCommand,
      this.owners.loggingCommand,
      mouseCommand,
      ...(isDevelopment ? [this.owners.uiProfileCommand] : []),
      quitCommand,
      this.owners.restoreCommand,
      this.owners.quotaCommand,
      this.owners.statsCommand,
      themeCommand,
      this.owners.toolsCommand,
      ...this.resolveSkillsCommand(),
      settingsCommand,
      this.owners.vimCommand,
      this.owners.providerCommand,
      this.owners.modelCommand,
      this.owners.keyCommand,
      this.owners.keyfileCommand,
      this.owners.toolkeyCommand, // @plan PLAN-20260206-TOOLKEY.P09 @requirement REQ-002
      this.owners.toolkeyfileCommand, // @plan PLAN-20260206-TOOLKEY.P09 @requirement REQ-003
      this.owners.baseurlCommand,
      this.owners.toolFormatCommand,
      setupGithubCommand,
      this.owners.setCommand,
      this.owners.profileCommand,
      diagnosticsCommand,
      terminalSetupCommand,
      debugCommand,
      this.owners.logoutCommand,
      this.owners.subagentCommand,
      permissionsCommand,
      this.owners.policiesCommand,
      this.owners.dumpcontextCommand,
      this.owners.todoCommand,
      setupCommand,
      this.owners.taskCommand,
      ...(this.config?.getEnableHooksUI() === true
        ? [this.owners.hooksCommand]
        : []),
      /**
       * @plan PLAN-20260214-SESSIONBROWSER.P21
       */
      this.owners.continueCommand,
      this.owners.perfCommand,
    ];

    return allDefinitions.filter((cmd): cmd is SlashCommand => cmd !== null);
  }

  /**
   * Determine skills command based on config and admin settings.
   * Returns [] when skills support is disabled, a stub error command when
   * disabled by admin, or [skillsCommand] when enabled.
   */
  private resolveSkillsCommand(): SlashCommand[] {
    if (this.config?.isSkillsSupportEnabled() !== true) {
      return [];
    }
    if (this.config.isAdminSkillsEnabled() === false) {
      return [
        {
          name: 'skills',
          description: 'Manage skills',
          kind: CommandKind.BUILT_IN,
          autoExecute: false,
          subCommands: [],
          action: async (
            _context: CommandContext,
          ): Promise<MessageActionReturn> => ({
            type: 'message',
            messageType: 'error',
            content: 'Skills are disabled by your admin.',
          }),
        },
      ];
    }
    return [this.owners.skillsCommand];
  }
}
