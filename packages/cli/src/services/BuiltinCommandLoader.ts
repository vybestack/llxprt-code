/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { isDevelopment } from '../utils/installationInfo.js';
import type { SlashCommand } from '../ui/commands/types.js';
import type { Config } from '@vybestack/llxprt-code-core';
import type { ICommandLoader } from './types.js';
import type { ExtensionEnablementManager } from '../config/extensions/extensionEnablement.js';
import { aboutCommand } from '../ui/commands/aboutCommand.js';
import { authCommand } from '../ui/commands/authCommand.js';
import { bugCommand } from '../ui/commands/bugCommand.js';
import { chatCommand } from '../ui/commands/chatCommand.js';
import { clearCommand } from '../ui/commands/clearCommand.js';
import { compressCommand } from '../ui/commands/compressCommand.js';
import { copyCommand } from '../ui/commands/copyCommand.js';
import { docsCommand } from '../ui/commands/docsCommand.js';
import { directoryCommand } from '../ui/commands/directoryCommand.js';
import { editorCommand } from '../ui/commands/editorCommand.js';
import { extensionsCommand } from '../ui/commands/extensionsCommand.js';
import { helpCommand } from '../ui/commands/helpCommand.js';
import { ideCommand } from '../ui/commands/ideCommand.js';
import { initCommand } from '../ui/commands/initCommand.js';
import { mcpCommand } from '../ui/commands/mcpCommand.js';
import { memoryCommand } from '../ui/commands/memoryCommand.js';
import { privacyCommand } from '../ui/commands/privacyCommand.js';
import { loggingCommand } from '../ui/commands/loggingCommand.js';
import { uiprofileCommand } from '../ui/commands/uiprofileCommand.js';
import { mouseCommand } from '../ui/commands/mouseCommand.js';
import { quitCommand } from '../ui/commands/quitCommand.js';
import { restoreCommand } from '../ui/commands/restoreCommand.js';
import { statsCommand } from '../ui/commands/statsCommand.js';
import { themeCommand } from '../ui/commands/themeCommand.js';
import { toolsCommand } from '../ui/commands/toolsCommand.js';
import { settingsCommand } from '../ui/commands/settingsCommand.js';
import { vimCommand } from '../ui/commands/vimCommand.js';
import { providerCommand } from '../ui/commands/providerCommand.js';
import { modelCommand } from '../ui/commands/modelCommand.js';
import { keyCommand } from '../ui/commands/keyCommand.js';
import { keyfileCommand } from '../ui/commands/keyfileCommand.js';
import { baseurlCommand } from '../ui/commands/baseurlCommand.js';
import { toolformatCommand } from '../ui/commands/toolformatCommand.js';
import { setupGithubCommand } from '../ui/commands/setupGithubCommand.js';
import { setCommand } from '../ui/commands/setCommand.js';
import { profileCommand } from '../ui/commands/profileCommand.js';
import { diagnosticsCommand } from '../ui/commands/diagnosticsCommand.js';
import { terminalSetupCommand } from '../ui/commands/terminalSetupCommand.js';
import { debugCommand } from '../ui/commands/debugCommands.js';
import { logoutCommand } from '../ui/commands/logoutCommand.js';
import { subagentCommand } from '../ui/commands/subagentCommand.js';
import { permissionsCommand } from '../ui/commands/permissionsCommand.js';
import { policiesCommand } from '../ui/commands/policiesCommand.js';
import { dumpcontextCommand } from '../ui/commands/dumpcontextCommand.js';
import { todoCommand } from '../ui/commands/todoCommand.js';
import { setupCommand } from '../ui/commands/setupCommand.js';

/**
 * Loads the core, hard-coded slash commands that are an integral part
 * of the Gemini CLI application.
 */
export class BuiltinCommandLoader implements ICommandLoader {
  private extensionEnablementManager?: ExtensionEnablementManager;

  constructor(private config: Config | null) {
    // Access extensionEnablementManager if available on config
    if (config && 'extensionEnablementManager' in config) {
      this.extensionEnablementManager = (
        config as Config & {
          extensionEnablementManager?: ExtensionEnablementManager;
        }
      ).extensionEnablementManager;
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
      aboutCommand,
      authCommand,
      bugCommand,
      chatCommand,
      clearCommand,
      compressCommand,
      copyCommand,
      docsCommand,
      directoryCommand,
      editorCommand,
      extensionsCommand,
      helpCommand,
      ideCommand(this.config),
      initCommand,
      mcpCommand,
      memoryCommand,
      privacyCommand,
      loggingCommand,
      mouseCommand,
      ...(isDevelopment ? [uiprofileCommand] : []),
      quitCommand,
      restoreCommand(this.config),
      statsCommand,
      themeCommand,
      toolsCommand,
      settingsCommand,
      vimCommand,
      providerCommand,
      modelCommand,
      keyCommand,
      keyfileCommand,
      baseurlCommand,
      toolformatCommand,
      setupGithubCommand,
      setCommand,
      profileCommand,
      diagnosticsCommand,
      terminalSetupCommand,
      debugCommand,
      logoutCommand,
      subagentCommand,
      permissionsCommand,
      policiesCommand,
      dumpcontextCommand,
      todoCommand,
      setupCommand,
    ];

    return allDefinitions.filter((cmd): cmd is SlashCommand => cmd !== null);
  }
}
