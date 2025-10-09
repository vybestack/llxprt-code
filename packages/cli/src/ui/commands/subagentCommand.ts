/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  SlashCommand,
  CommandContext,
  SlashCommandActionReturn,
  CommandKind,
} from './types.js';
import { SubagentConfig } from '@vybestack/llxprt-code-core';

/**
 * Parse save command arguments
 * @plan:PLAN-20250117-SUBAGENTCONFIG.P08
 * @requirement:REQ-004
 * @requirement:REQ-011
 * @pseudocode SubagentCommand.md lines 1-17
 */
function parseSaveArgs(args: string): { name: string; profile: string; mode: 'auto' | 'manual'; input: string } | null {
  const match = args.match(/^(\S+)\s+(\S+)\s+(auto|manual)\s+"((?:[^"\\]|\\.)*)(\"?)?/);

  if (!match) {
    return null;
  }
  
  const [, name, profile, mode, input] = match;
  return { name, profile, mode: mode as 'auto' | 'manual', input };
}

/**
 * Handle manual mode subagent save
 * @plan:PLAN-20250117-SUBAGENTCONFIG.P08
 * @requirement:REQ-004
 * @pseudocode SubagentCommand.md lines 61-66
 */
async function handleManualMode(
  context: CommandContext,
  name: string,
  profile: string,
  systemPrompt: string,
  options?: { existed: boolean }
): Promise<SlashCommandActionReturn> {
  const existed = options?.existed ?? false;
  return saveSubagent(context, name, profile, systemPrompt, existed);
}

/**
 * Shared save subagent logic
 * @plan:PLAN-20250117-SUBAGENTCONFIG.P08
 * @requirement:REQ-002
 * @requirement:REQ-004
 * @requirement:REQ-014
 * @pseudocode SubagentCommand.md lines 67-93
 */
async function saveSubagent(
  context: CommandContext,
  name: string,
  profile: string,
  systemPrompt: string,
  existed: boolean
): Promise<SlashCommandActionReturn> {
  const manager = context.services.subagentManager;
  if (!manager) {
    return {
      type: 'message',
      messageType: 'error',
      content: 'Service not available. Run system integration (Phase 15).',
    };
  }

  try {
    await manager.saveSubagent(name, profile, systemPrompt);

    const status = existed ? 'updated' : 'created';
    return {
      type: 'message',
      messageType: 'info',
      content: `Subagent '${name}' ${status} successfully with profile '${profile}'.`,
    };
  } catch (error) {
    return {
      type: 'message',
      messageType: 'error',
      content:
        error instanceof Error
          ? `Failed to save subagent: ${error.message}`
          : 'Failed to save subagent due to an unknown error.',
    };
  }
}

/**
 * /subagent save command - Manual mode only (auto mode in Phase 12)
 *
 * @plan:PLAN-20250117-SUBAGENTCONFIG.P08
 * @requirement:REQ-004
 * @requirement:REQ-014
 * @pseudocode SubagentCommand.md lines 1-134
 */
const saveCommand: SlashCommand = {
  name: 'save',
  description: 'Save a subagent configuration',
  kind: CommandKind.BUILT_IN,
  action: async (context: CommandContext, args: string): Promise<SlashCommandActionReturn> => {
    const { services, overwriteConfirmed, invocation } = context;
    const subagentManager = services.subagentManager;
    if (!subagentManager) {
      return {
        type: 'message',
        messageType: 'error',
        content: 'SubagentManager service is unavailable. Please run integration (Phase 15) before using /subagent.',
      };
    }

    // 1. Parse arguments using helper function (Pseudocode lines 1-17)
    const parsedArgs = parseSaveArgs(args);

    if (!parsedArgs) {
      return {
        type: 'message',
        messageType: 'error',
        content: 'Usage: /subagent save <name> <profile> auto|manual "<system_prompt>"',
      };
    }

    const { name, profile, mode, input: systemPrompt } = parsedArgs;

    /**
     * @plan:PLAN-20250117-SUBAGENTCONFIG.P08
     * @requirement:REQ-004
     * @pseudocode SubagentCommand.md lines 74-78
     */
    // Validate profile exists (pseudocode lines 263-281 cover this)
    const profileExists = await subagentManager.validateProfileReference(profile);
    if (!profileExists) {
      return {
        type: 'message',
        messageType: 'error',
        content: `Profile '${profile}' not found. Use '/profile list' to see available profiles.`,
      };
    }

    /**
     * @plan:PLAN-20250117-SUBAGENTCONFIG.P08
     * @requirement:REQ-004
     * @requirement:REQ-014
     * @pseudocode SubagentCommand.md lines 110-127
     */
    // Check if exists for overwrite confirmation
    const exists = await subagentManager.subagentExists(name);

    if (exists && !overwriteConfirmed) {
      return {
        type: 'confirm_action',
        prompt: `A subagent named '${name}' already exists. Do you want to overwrite it?`,
        originalInvocation: {
          raw: invocation?.raw || '',
        }
      };
    }

    /**
     * @plan:PLAN-20250117-SUBAGENTCONFIG.P08
     * @requirement:REQ-004
     * @pseudocode SubagentCommand.md lines 128-134
     */
    // Dispatch to correct mode handler (auto mode will be implemented in Phase 12)
    if (mode === 'auto') {
      return {
        type: 'message',
        messageType: 'error',
        content: 'Auto mode will be implemented in Phase 12. Please use manual mode for now.',
      };
    }

    /**
     * @plan:PLAN-20250117-SUBAGENTCONFIG.P08
     * @requirement:REQ-004
     * @requirement:REQ-014
     * @pseudocode SubagentCommand.md lines 61-66
     */
    return handleManualMode(context, name, profile, systemPrompt, { existed: exists });
  },
};

/**
 * /subagent list command
 * 
 * @plan:PLAN-20250117-SUBAGENTCONFIG.P08
 * @requirement:REQ-005
 * @pseudocode SubagentCommand.md lines 135-182
 */
const listCommand: SlashCommand = {
  name: 'list',
  description: 'List all saved subagents',
  kind: CommandKind.BUILT_IN,
  action: async (context: CommandContext, args: string): Promise<SlashCommandActionReturn> => {
    const { services } = context;
    const subagentManager = services.subagentManager;
    if (!subagentManager) {
      return {
        type: 'message',
        messageType: 'error',
        content: 'SubagentManager service is unavailable. Please run integration (Phase 15) before using /subagent.',
      };
    }
    
    try {
      const names = await subagentManager.listSubagents();
      
      if (names.length === 0) {
        return {
          type: 'message',
          messageType: 'info',
          content: "No subagents found. Use '/subagent save' to create one.",
        };
      }
      
      // Load each subagent for details
      const details = await Promise.all(
        names.map(async (name) => {
          const config = await subagentManager.loadSubagent(name);
          return { name, config };
        })
      );
      
      /**
       * @plan:PLAN-20250117-SUBAGENTCONFIG.P08
       * @requirement:REQ-005
       * @pseudocode SubagentCommand.md lines 159-166
       */
      // Sort by creation date (oldest first as per pseudocode)
      details.sort((a, b) => 
        new Date(a.config.createdAt).getTime() - new Date(b.config.createdAt).getTime()
      );
      
      // Format output
      const lines = ['List of saved subagents:\n'];
      for (const { name, config } of details) {
        const createdDate = new Date(config.createdAt).toLocaleString();
        lines.push(`  - ${name}     (profile: ${config.profile}, created: ${createdDate})`);
      }
      lines.push("\nNote: Use '/subagent show <name>' to view full configuration");
      
      return {
        type: 'message',
        messageType: 'info',
        content: lines.join('\n'),
      };
    } catch (error) {
      return {
        type: 'message',
        messageType: 'error',
        content: 'Failed to list subagents',
      };
    }
  },
};

/**
 * /subagent show command
 * 
 * @plan:PLAN-20250117-SUBAGENTCONFIG.P08
 * @requirement:REQ-006
 * @pseudocode SubagentCommand.md lines 183-234
 */
const showCommand: SlashCommand = {
  name: 'show',
  description: 'Show detailed subagent configuration',
  kind: CommandKind.BUILT_IN,
  action: async (context: CommandContext, args: string): Promise<SlashCommandActionReturn> => {
    const name = args.trim();
    
    if (!name) {
      return {
        type: 'message',
        messageType: 'error',
        content: 'Usage: /subagent show <name>',
      };
    }
    
    const { services } = context;
    const subagentManager = services.subagentManager;
    if (!subagentManager) {
      return {
        type: 'message',
        messageType: 'error',
        content: 'SubagentManager service is unavailable. Please run integration (Phase 15) before using /subagent.',
      };
    }
    
    try {
      const config: SubagentConfig = await subagentManager.loadSubagent(name);
      
      const createdDate = new Date(config.createdAt).toLocaleString();
      const updatedDate = new Date(config.updatedAt).toLocaleString();
      
      const separator = '-'.repeat(60);
      const output = [
        `Subagent: ${config.name}`,
        `Profile: ${config.profile}`,
        `Created: ${createdDate}`,
        `Updated: ${updatedDate}`,
        '',
        'System Prompt:',
        separator,
        config.systemPrompt,
        separator,
      ].join('\n');
      
      return {
        type: 'message',
        messageType: 'info',
        content: output,
      };
    } catch (error) {
      return {
        type: 'message',
        messageType: 'error',
        content: `Error: Subagent '${name}' not found. Use /subagent list to see available subagents.`,
      };
    }
  },
};

/**
 * /subagent delete command
 * 
 * @plan:PLAN-20250117-SUBAGENTCONFIG.P08
 * @requirement:REQ-007
 * @pseudocode SubagentCommand.md lines 235-291
 */
const deleteCommand: SlashCommand = {
  name: 'delete',
  description: 'Delete a subagent configuration',
  kind: CommandKind.BUILT_IN,
  action: async (context: CommandContext, args: string): Promise<SlashCommandActionReturn> => {
    const name = args.trim();
    
    if (!name) {
      return {
        type: 'message',
        messageType: 'error',
        content: 'Usage: /subagent delete <name>',
      };
    }
    
    const { services, overwriteConfirmed, invocation } = context;
    const subagentManager = services.subagentManager;
    if (!subagentManager) {
      return {
        type: 'message',
        messageType: 'error',
        content: 'SubagentManager service is unavailable. Please run integration (Phase 15) before using /subagent.',
      };
    }
    
    /**
     * @plan:PLAN-20250117-SUBAGENTCONFIG.P08
     * @requirement:REQ-007
     * @pseudocode SubagentCommand.md lines 258-264
     */
    // Check if subagent exists
    const exists = await subagentManager.subagentExists(name);
    
    if (!exists) {
      return {
        type: 'message',
        messageType: 'error',
        content: `Subagent '${name}' not found.`,
      };
    }
    
    /**
     * @plan:PLAN-20250117-SUBAGENTCONFIG.P08
     * @requirement:REQ-007
     * @pseudocode SubagentCommand.md lines 265-274
     */
    // Prompt for confirmation if not already given
    if (!overwriteConfirmed) {
      return {
        type: 'confirm_action',
        prompt: `Are you sure you want to delete subagent '${name}'? This action cannot be undone.`,
        originalInvocation: {
          raw: invocation?.raw || '',
        }
      };
    }
    
    /**
     * @plan:PLAN-20250117-SUBAGENTCONFIG.P08
     * @requirement:REQ-007
     * @pseudocode SubagentCommand.md lines 276-283
     */
    try {
      await subagentManager.deleteSubagent(name);

      return {
        type: 'message',
        messageType: 'info',
        content: `Successfully deleted subagent '${name}'.`,
      };
    } catch (error) {
      return {
        type: 'message',
        messageType: 'error',
        content:
          error instanceof Error
            ? `Failed to delete subagent: ${error.message}`
            : 'Failed to delete subagent due to an unknown error.',
      };
    }
  },
};

/**
 * /subagent edit command
 * 
 * @plan:PLAN-20250117-SUBAGENTCONFIG.P09
 * @requirement:REQ-008
 */
const editCommand: SlashCommand = {
  name: 'edit',
  description: 'Edit subagent configuration in system editor',
  kind: CommandKind.BUILT_IN,
  action: async (context: CommandContext, args: string): Promise<SlashCommandActionReturn> => {
    // STUB: To be implemented in Phase 11
    return {
      type: 'message',
      messageType: 'info',
      content: 'Edit command will be implemented in Phase 11',
    };
  },
};

/**
 * /subagent parent command with autocomplete
 * 
 * @plan:PLAN-20250117-SUBAGENTCONFIG.P09
 * @requirement:REQ-001
 * @requirement:REQ-009
 * @requirement:REQ-011
 */
export const subagentCommand: SlashCommand = {
  name: 'subagent',
  description: 'Manage subagent configurations.',
  kind: CommandKind.BUILT_IN,
  subCommands: [
    saveCommand,
    listCommand,
    showCommand,
    deleteCommand,
    editCommand,
  ],
  /**
   * Multi-level autocomplete
   * STUB: Returns empty array, implementation in Phase 11
   */
  completion: async (
    context: CommandContext,
    partialArg: string
  ): Promise<string[]> => {
    if (!context.services.subagentManager) { // @plan:PLAN-20250117-SUBAGENTCONFIG.P09 @requirement:REQ-009
      return [];
    }

    // STUB: Return empty array
    return [];
  },
  action: async (context: CommandContext, args: string): Promise<SlashCommandActionReturn> => {
    // No default action, list subcommands in a message.
    const subCommandsList = subagentCommand.subCommands?.map(cmd => `  - ${cmd.name}: ${cmd.description}`).join('\n') || 'No subcommands available.';
    return {
      type: 'message',
      messageType: 'info',
      content: `Available subagent subcommands:\n${subCommandsList}`,
    };
  },
};
