/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* @jsxImportSource react */

import React from 'react';
import { Text } from 'ink';
import {
  SlashCommand,
  CommandContext,
  SlashCommandActionReturn,
  CommandKind,
} from './types.js';
import { Colors } from '../colors.js';
import { SubagentConfig } from '@vybestack/llxprt-code-core';
import { FunctionCallingConfigMode } from '@google/genai';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { getRuntimeBridge } from '../contexts/RuntimeContext.js';

/**
 * Parse save command arguments
 * @plan:PLAN-20250117-SUBAGENTCONFIG.P12
 * @requirement:REQ-004
 * @requirement:REQ-011
 * @pseudocode SubagentCommand.md lines 1-17
 */
function parseSaveArgs(args: string): {
  name: string;
  profile: string;
  mode: 'auto' | 'manual';
  input: string;
} | null {
  const match = args.match(
    /^(\S+)\s+(\S+)\s+(auto|manual)\s+"((?:[^"\\]|\\.)*)("|"?)/,
  );

  if (!match) {
    return null;
  }

  const [, name, profile, mode, input] = match;
  return { name, profile, mode: mode as 'auto' | 'manual', input };
}

/**
 * Handle manual mode subagent save
 * @plan:PLAN-20250117-SUBAGENTCONFIG.P12
 * @requirement:REQ-004
 * @pseudocode SubagentCommand.md lines 61-66
 */
const handleManualMode = async (
  context: CommandContext,
  name: string,
  profile: string,
  systemPrompt: string,
  options?: { existed: boolean },
): Promise<SlashCommandActionReturn> => {
  const existed = options?.existed ?? false;
  return saveSubagent(context, name, profile, systemPrompt, existed);
};

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
  existed: boolean,
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
 * @plan:PLAN-20251013-AUTOCOMPLETE.P08
 * @requirement:REQ-002
 * @requirement:REQ-003
 * @requirement:REQ-004
 * @pseudocode ArgumentSchema.md lines 91-104
 * Schema definition for subagent command completion
 */
const subagentSchema = [
  {
    kind: 'value' as const,
    name: 'name',
    description: 'Enter subagent name',
    completer: async (ctx: CommandContext, partialArg: string) => {
      const manager = ctx.services.subagentManager;
      if (!manager) {
        return [];
      }

      const names = await manager.listSubagents();
      const normalizedPartial = partialArg.toLowerCase();
      const matchingNames = names.filter((name) =>
        normalizedPartial.length === 0
          ? true
          : name.toLowerCase().startsWith(normalizedPartial),
      );

      const suggestions = await Promise.all(
        matchingNames.map(async (name) => {
          try {
            const details = await manager.loadSubagent(name);
            return {
              value: name,
              description: `Profile: ${details.profile}`,
            };
          } catch {
            return {
              value: name,
              description: 'Subagent',
            };
          }
        }),
      );

      return suggestions;
    },
  },
  {
    kind: 'value' as const,
    name: 'profile',
    description: 'Select profile configuration',
    completer: async (ctx: CommandContext, partialArg: string) => {
      const profileManager = ctx.services.profileManager;
      if (
        !profileManager ||
        typeof profileManager.listProfiles !== 'function'
      ) {
        return [];
      }

      try {
        const profiles = await profileManager.listProfiles();
        const normalizedPartial = partialArg.toLowerCase();

        const filtered = profiles.filter((name) =>
          normalizedPartial.length === 0
            ? true
            : name.toLowerCase().startsWith(normalizedPartial),
        );

        return filtered.map((name) => ({
          value: name,
          description: 'Saved profile',
        }));
      } catch (error) {
        console.warn('Error loading profiles for subagent completion:', error);
        return [];
      }
    },
  },
  {
    kind: 'literal' as const,
    value: 'auto',
    description: 'Automatic mode',
    next: [
      {
        kind: 'value' as const,
        name: 'prompt',
        description: 'Enter system prompt for automatic mode',
      },
    ],
  },
  {
    kind: 'literal' as const,
    value: 'manual',
    description: 'Manual mode',
    next: [
      {
        kind: 'value' as const,
        name: 'prompt',
        description: 'Enter system prompt for manual mode',
      },
    ],
  },
];

/**
 * /subagent save command - Auto and Manual modes
 *
 * @plan:PLAN-20250117-SUBAGENTCONFIG.P14
 * @requirement:REQ-003
 * @requirement:REQ-004
 * @requirement:REQ-014
 * @requirement:REQ-015
 * @pseudocode SubagentCommand.md lines 1-90
 */
const saveCommand: SlashCommand = {
  name: 'save',
  altNames: ['create'],
  description: 'Save a subagent configuration (auto or manual mode)',
  kind: CommandKind.BUILT_IN,
  // Schema-based completion replaces legacy completion function
  schema: subagentSchema,
  action: async (
    context: CommandContext,
    args: string,
  ): Promise<SlashCommandActionReturn> => {
    // Parse arguments: <name> <profile> <mode> "<text>"
    const parsedArgs = parseSaveArgs(args);

    if (!parsedArgs) {
      return {
        type: 'message',
        messageType: 'error',
        content: 'Usage: /subagent save <name> <profile> auto|manual "<text>"',
      };
    }

    const { name, profile, mode, input } = parsedArgs;
    const { services, overwriteConfirmed, invocation } = context;
    const subagentManager = services.subagentManager; // @plan:PLAN-20250117-SUBAGENTCONFIG.P14 @requirement:REQ-003
    if (!subagentManager) {
      return {
        type: 'message',
        messageType: 'error',
        content:
          'SubagentManager service is unavailable. Please run integration (Phase 15) before using /subagent.',
      };
    }

    // Validate profile exists (pseudocode lines 263-281 cover this)
    const profileExists =
      await subagentManager.validateProfileReference(profile);
    if (!profileExists) {
      return {
        type: 'message',
        messageType: 'error',
        content: `Profile '${profile}' not found. Use '/profile list' to see available profiles.`,
      };
    }

    // Check if exists for overwrite confirmation
    const exists = await subagentManager.subagentExists(name);

    if (exists && !overwriteConfirmed) {
      return {
        type: 'confirm_action',
        prompt: React.createElement(
          Text,
          null,
          'A subagent with the name ',
          React.createElement(Text, { color: Colors.AccentPurple }, name),
          ' already exists. Do you want to overwrite it?',
        ),
        originalInvocation: {
          raw: invocation?.raw || '',
        },
      };
    }

    let finalSystemPrompt: string;

    if (mode === 'manual') {
      // Manual mode: use input directly
      finalSystemPrompt = input;
      return handleManualMode(context, name, profile, finalSystemPrompt, {
        existed: exists,
      });
    } else {
      // Auto mode: generate using LLM
      const configService = services.config; // @plan:PLAN-20250117-SUBAGENTCONFIG.P14 @requirement:REQ-003
      if (!configService) {
        return {
          type: 'message',
          messageType: 'error',
          content:
            'Configuration service unavailable. Set up the CLI before using auto mode.',
        };
      }

      try {
        const client = configService.getGeminiClient();

        if (!client) {
          return {
            type: 'message',
            messageType: 'error',
            content:
              'Unable to access Gemini client. Run /auth login or try manual mode.',
          };
        }

        // Construct prompt
        const autoModePrompt = `Generate a detailed system prompt for a subagent with the following purpose:\n\n${input}\n\nRequirements:\n- Create a comprehensive system prompt that defines the subagent's role, capabilities, and behavior\n- Be specific and actionable\n- Use clear, professional language\n- Output ONLY the system prompt text, no explanations or metadata`;

        // Call LLM with a direct request that bypasses tool declarations and history
        let response;
        try {
          const runtimeBridge = getRuntimeBridge();
          response = await runtimeBridge.runWithScope(() =>
            client.generateDirectMessage(
              {
                message: autoModePrompt,
                config: {
                  tools: [],
                  toolConfig: {
                    functionCallingConfig: {
                      mode: FunctionCallingConfigMode.NONE,
                    },
                  },
                },
              },
              'subagent-auto-prompt',
            ),
          );
        } catch (_runtimeError) {
          response = await client.generateDirectMessage(
            {
              message: autoModePrompt,
              config: {
                tools: [],
                toolConfig: {
                  functionCallingConfig: {
                    mode: FunctionCallingConfigMode.NONE,
                  },
                },
              },
            },
            'subagent-auto-prompt',
          );
        }
        finalSystemPrompt = response.text || '';

        if (finalSystemPrompt.trim() === '') {
          return {
            type: 'message',
            messageType: 'error',
            content:
              'Error: Model returned empty response. Try manual mode or rephrase your description.',
          };
        }
      } catch (_error) {
        return {
          type: 'message',
          messageType: 'error',
          content:
            'Error: Failed to generate system prompt. Try manual mode or check your connection.',
        };
      }
      // Dispatch to shared save logic for auto mode
      return saveSubagent(context, name, profile, finalSystemPrompt, exists);
    }
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
  action: async (
    context: CommandContext,
    _args: string,
  ): Promise<SlashCommandActionReturn> => {
    const { services } = context;
    const subagentManager = services.subagentManager;
    if (!subagentManager) {
      return {
        type: 'message',
        messageType: 'error',
        content:
          'SubagentManager service is unavailable. Please run integration (Phase 15) before using /subagent.',
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
        names.map(async (n) => {
          const config = await subagentManager.loadSubagent(n);
          return { name: n, config };
        }),
      ); // @plan:PLAN-20250117-SUBAGENTCONFIG.P08 @requirement:REQ-005

      /**
       * @plan:PLAN-20250117-SUBAGENTCONFIG.P08
       * @requirement:REQ-005
       * @requirement:REQ-009
       * @pseudocode SubagentCommand.md lines 159-166
       */
      // Sort by creation date (oldest first as per pseudocode)
      details.sort(
        (itemA, itemB) =>
          new Date(itemA.config.createdAt).getTime() -
          new Date(itemB.config.createdAt).getTime(),
      ); // @plan:PLAN-20250117-SUBAGENTCONFIG.P09 @requirement:REQ-009

      // Format output
      const lines = ['List of saved subagents:\n'];
      for (const { name, config } of details) {
        const createdDate = new Date(config.createdAt).toLocaleString();
        lines.push(
          `  - ${name}     (profile: ${config.profile}, created: ${createdDate})`,
        );
      }
      lines.push(
        "\nNote: Use '/subagent show <name>' to view full configuration",
      );

      return {
        type: 'message',
        messageType: 'info',
        content: lines.join('\n'),
      };
    } catch (_error) {
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
  action: async (
    context: CommandContext,
    args: string,
  ): Promise<SlashCommandActionReturn> => {
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
        content:
          'SubagentManager service is unavailable. Please run integration (Phase 15) before using /subagent.',
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
    } catch (_error) {
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
 * @requirement:REQ-015
 * @pseudocode SubagentCommand.md lines 235-291
 */
const deleteCommand: SlashCommand = {
  name: 'delete',
  description: 'Delete a subagent configuration',
  kind: CommandKind.BUILT_IN,
  action: async (
    context: CommandContext,
    args: string,
  ): Promise<SlashCommandActionReturn> => {
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
        content:
          'SubagentManager service is unavailable. Please run integration (Phase 15) before using /subagent.',
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
        prompt: React.createElement(
          Text,
          null,
          'Are you sure you want to delete subagent ',
          React.createElement(Text, { color: Colors.AccentPurple }, name),
          '? This action cannot be undone.',
        ),
        originalInvocation: {
          raw: invocation?.raw || '',
        },
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
 * @plan:PLAN-20250117-SUBAGENTCONFIG.P11
 * @requirement:REQ-008
 * @requirement:REQ-015
 * @pseudocode SubagentCommand.md lines 166-210
 *
 * Pattern: Uses spawnSync approach from text-buffer.ts
 */
const editCommand: SlashCommand = {
  name: 'edit',
  description: 'Edit subagent configuration in system editor',
  kind: CommandKind.BUILT_IN,
  action: async (
    context: CommandContext,
    args: string,
  ): Promise<SlashCommandActionReturn> => {
    const name = args.trim();

    if (!name) {
      return {
        type: 'message',
        messageType: 'error',
        content: 'Usage: /subagent edit <name>',
      };
    }

    const { services } = context;
    const subagentManager = services.subagentManager; // @plan:PLAN-20250117-SUBAGENTCONFIG.P11 @requirement:REQ-008
    if (!subagentManager) {
      return {
        type: 'message',
        messageType: 'error',
        content:
          'SubagentManager service is unavailable. Please run integration (Phase 15) before using /subagent.',
      };
    }

    // Check if subagent exists
    const exists = await subagentManager.subagentExists(name);

    if (!exists) {
      return {
        type: 'message',
        messageType: 'error',
        content: `Error: Subagent '${name}' not found.`,
      };
    }

    // Load current config
    const config = await subagentManager.loadSubagent(name);

    // Create temp file (like text-buffer.ts does)
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'subagent-edit-'));
    const filePath = path.join(tmpDir, `${name}.json`);

    try {
      // Write current config to temp file
      fs.writeFileSync(filePath, JSON.stringify(config, null, 2), 'utf8');

      // Determine editor (like text-buffer.ts)
      const editor = process.env.VISUAL || process.env.EDITOR || 'vi';

      // Launch editor with spawnSync (BLOCKS until editor closes)
      const { status, error } = spawnSync(editor, [filePath], {
        stdio: 'inherit',
      });

      if (error) {
        throw error;
      }

      if (typeof status === 'number' && status !== 0) {
        throw new Error(`Editor exited with status ${status}`);
      }

      // Read edited content
      const editedContent = fs.readFileSync(filePath, 'utf8');

      // Parse and validate JSON
      let editedConfig: SubagentConfig;
      try {
        editedConfig = JSON.parse(editedContent);
      } catch (_error) {
        return {
          type: 'message',
          messageType: 'error',
          content: 'Error: Invalid JSON after edit. Changes not saved.',
        };
      }

      // Validate required fields
      if (
        !editedConfig.name ||
        !editedConfig.profile ||
        !editedConfig.systemPrompt
      ) {
        return {
          type: 'message',
          messageType: 'error',
          content: 'Error: Required fields missing. Changes not saved.',
        };
      }

      // Validate profile exists
      const profileValid = await subagentManager.validateProfileReference(
        editedConfig.profile,
      );
      if (!profileValid) {
        return {
          type: 'message',
          messageType: 'error',
          content: `Error: Profile '${editedConfig.profile}' not found. Changes not saved.`,
        };
      }

      // Save the edited config (updates updatedAt timestamp)
      await subagentManager.saveSubagent(
        editedConfig.name,
        editedConfig.profile,
        editedConfig.systemPrompt,
      );

      return {
        type: 'message',
        messageType: 'info',
        content: `Subagent '${name}' updated successfully.`,
      };
    } catch (error) {
      return {
        type: 'message',
        messageType: 'error',
        content:
          error instanceof Error ? error.message : 'Failed to edit subagent',
      };
    } finally {
      // Cleanup temp file and directory (like text-buffer.ts)
      try {
        fs.unlinkSync(filePath);
      } catch {
        /* ignore */
      }
      try {
        fs.rmdirSync(tmpDir);
      } catch {
        /* ignore */
      }
    }
  },
};

/**
 * /subagent parent command with schema-based completion
 *
 * @plan:PLAN-20251013-AUTOCOMPLETE.P08
 * @requirement:REQ-002
 * @requirement:REQ-003
 * @requirement:REQ-004
 * Legacy completion removed - now fully schema-driven
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
  action: async (
    _context: CommandContext,
    _args: string,
  ): Promise<SlashCommandActionReturn> => {
    // No default action, list subcommands in a message.
    const subCommandsList =
      subagentCommand.subCommands
        ?.map((cmd) => `  - ${cmd.name}: ${cmd.description}`)
        .join('\n') || 'No subcommands available.';
    return {
      type: 'message',
      messageType: 'info',
      content: `Available subagent subcommands:\n${subCommandsList}`,
    };
  },
};
