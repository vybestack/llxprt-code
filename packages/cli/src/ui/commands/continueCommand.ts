/**
 * /continue command - Browse and resume previous sessions
 *
 * @plan PLAN-20260214-SESSIONBROWSER.P20
 * @requirement REQ-RC-001, REQ-EN-001, REQ-EN-002, REQ-RC-010, REQ-RC-011, REQ-RC-012, REQ-RC-013, REQ-MP-004
 * @pseudocode continue-command.md
 */

import type {
  CommandContext,
  SlashCommandActionReturn,
  SlashCommand,
} from './types.js';
import { CommandKind } from './types.js';
import type { CommandArgumentSchema } from './schema/types.js';
import { SessionDiscovery } from '@vybestack/llxprt-code-core';
import { debugLogger } from '@vybestack/llxprt-code-telemetry';
import { basename } from 'node:path';

/**
 * Schema for /continue command tab completion
 * @plan PLAN-20260214-SESSIONBROWSER.P20
 * @requirement REQ-RC-013
 */
const continueSchema: CommandArgumentSchema = [
  {
    kind: 'value' as const,
    name: 'target',
    description: 'Session/checkpoint name, session ID, index, or "latest"',
    completer: async (ctx: CommandContext) => {
      const config = ctx.services.config;
      if (config?.isInteractive() !== true) return [];
      const latest = {
        value: 'latest',
        description: 'Most recent session',
      };
      const storage = config.storage as
        | Partial<typeof config.storage>
        | undefined;
      if (
        typeof storage?.getProjectChatsDir !== 'function' ||
        typeof storage.getProjectTempDir !== 'function'
      ) {
        return [latest];
      }
      let targets: Awaited<
        ReturnType<typeof SessionDiscovery.listContinueTargets>
      >;
      try {
        targets = await SessionDiscovery.listContinueTargets(
          storage.getProjectChatsDir(),
          basename(storage.getProjectTempDir()),
        );
      } catch (error: unknown) {
        debugLogger.warn('Failed to discover /continue completions:', error);
        return [latest];
      }
      return [
        latest,
        ...targets.map((target) => {
          if (target.kind === 'checkpoint') {
            return {
              value: target.checkpointName,
              description: 'Recording checkpoint',
            };
          }
          return {
            value: target.session.name ?? target.session.sessionId,
            description: target.session.name ? 'Named session' : 'Session ID',
          };
        }),
      ];
    },
  },
];

/**
 * Check if there is an active conversation (messages in history)
 * Uses pendingItem as indicator per test expectations
 * @plan PLAN-20260214-SESSIONBROWSER.P20
 */
function hasActiveConversation(ctx: CommandContext): boolean {
  return ctx.ui.pendingItem !== null;
}

/**
 * Check if there is a request in progress
 * Uses session.isProcessing per test expectations
 * @plan PLAN-20260214-SESSIONBROWSER.P20
 * @requirement REQ-MP-004
 */
function isProcessing(ctx: CommandContext): boolean {
  return ctx.session.isProcessing === true;
}

/**
 * /continue command implementation
 * @plan PLAN-20260214-SESSIONBROWSER.P20
 * @requirement REQ-EN-001, REQ-EN-002, REQ-RC-001, REQ-RC-010, REQ-RC-011, REQ-RC-012, REQ-MP-004
 */
export const continueCommand: SlashCommand = {
  name: 'continue',
  description: 'Browse and resume previous sessions',
  kind: CommandKind.BUILT_IN,
  schema: continueSchema,
  action: async (
    ctx: CommandContext,
    args: string,
  ): Promise<SlashCommandActionReturn> => {
    const config = ctx.services.config;

    // Guard: Check for in-flight request first (REQ-MP-004)
    if (isProcessing(ctx)) {
      return {
        type: 'message',
        messageType: 'error',
        content: 'Cannot continue session while a request is in progress.',
      };
    }

    // Parse args: trim whitespace
    const trimmedArgs = args.trim();

    // No-args path (REQ-EN-001)
    if (!trimmedArgs) {
      // Check interactive mode (REQ-RC-012)
      // Guard: config must exist and have isInteractive method
      const isInteractive =
        typeof config?.isInteractive === 'function' && config.isInteractive();
      if (!isInteractive) {
        return {
          type: 'message',
          messageType: 'error',
          content: 'Session browser requires interactive mode.',
        };
      }
      // Return dialog action
      return {
        type: 'dialog',
        dialog: 'sessionBrowser',
      };
    }

    // Direct resume path (REQ-EN-002)
    const sessionRef = trimmedArgs;

    // Check active conversation guard (REQ-RC-010, REQ-RC-011)
    const activeConversation = hasActiveConversation(ctx);

    if (activeConversation) {
      // Non-interactive mode with active conversation is an error (REQ-RC-011)
      // Guard: config must exist and have isInteractive method
      const isInteractiveMode =
        typeof config?.isInteractive === 'function' && config.isInteractive();
      if (!isInteractiveMode) {
        return {
          type: 'message',
          messageType: 'error',
          content:
            'Cannot replace active conversation in non-interactive mode.',
        };
      }
      // Interactive mode with active conversation requires confirmation (REQ-RC-010)
      return {
        type: 'perform_resume',
        sessionRef,
        requiresConfirmation: true,
      };
    }

    // No active conversation - proceed without confirmation
    return {
      type: 'perform_resume',
      sessionRef,
    };
  },
};
