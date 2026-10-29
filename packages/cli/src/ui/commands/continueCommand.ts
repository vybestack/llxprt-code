/**
 * /continue command - Browse and resume previous sessions
 *
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 * @plan PLAN-20260214-SESSIONBROWSER.P20
 * @requirement REQ-RC-001, REQ-EN-001, REQ-EN-002, REQ-RC-010, REQ-RC-011, REQ-RC-012, REQ-RC-013, REQ-MP-004
 * @pseudocode continue-command.md
 */

import type {
  SessionDiscovery,
  ValidatedSessionMediaPackage,
} from '@vybestack/llxprt-code-core';
import { debugLogger } from '@vybestack/llxprt-code-telemetry';
import type {
  CommandContext,
  SlashCommand,
  SlashCommandActionReturn,
} from './types.js';
import { CommandKind } from './types.js';
import type { CommandArgumentSchema } from './schema/types.js';
import { handleContinuePackageActionForOwner } from './continuePackageActions.js';

export interface ContinueCommandOperations {
  readonly isInteractive: () => boolean;
  readonly listContinueTargets: () => Promise<
    Awaited<ReturnType<typeof SessionDiscovery.listContinueTargets>>
  >;
  readonly exportSession: (
    sessionRef: string,
    destination: string,
  ) => Promise<void>;
  readonly validateSessionPackage: (
    packageDirectory: string,
  ) => Promise<ValidatedSessionMediaPackage>;
}

function createOwnedContinueSchema(
  operations: ContinueCommandOperations,
): CommandArgumentSchema {
  return [
    {
      kind: 'value' as const,
      name: 'target',
      description: 'Session/checkpoint name, session ID, index, or "latest"',
      completer: async () => {
        if (!operations.isInteractive()) return [];
        const latest = { value: 'latest', description: 'Most recent session' };
        try {
          const targets = await operations.listContinueTargets();
          return [
            latest,
            ...targets.map((target) =>
              target.kind === 'checkpoint'
                ? {
                    value: target.checkpointName,
                    description: 'Recording checkpoint',
                  }
                : {
                    value: target.session.name ?? target.session.sessionId,
                    description: target.session.name
                      ? 'Named session'
                      : 'Session ID',
                  },
            ),
          ];
        } catch (error: unknown) {
          debugLogger.warn('Failed to discover /continue completions:', error);
          return [latest];
        }
      },
    },
  ];
}

function hasActiveConversation(ctx: CommandContext): boolean {
  return ctx.ui.pendingItem !== null;
}

function isProcessing(ctx: CommandContext): boolean {
  return ctx.session.isProcessing === true;
}

function createOwnedContinueAction(
  operations: ContinueCommandOperations,
): SlashCommand['action'] {
  return async (ctx, args): Promise<SlashCommandActionReturn> => {
    if (isProcessing(ctx)) {
      return {
        type: 'message',
        messageType: 'error',
        content: 'Cannot continue session while a request is in progress.',
      };
    }
    const trimmedArgs = args.trim();
    const activeConversation = hasActiveConversation(ctx);
    const packageAction = await handleContinuePackageActionForOwner(
      operations,
      trimmedArgs,
      activeConversation,
    );
    if (packageAction !== undefined) return packageAction;
    if (!trimmedArgs) {
      return operations.isInteractive()
        ? { type: 'dialog', dialog: 'sessionBrowser' }
        : {
            type: 'message',
            messageType: 'error',
            content: 'Session browser requires interactive mode.',
          };
    }
    if (activeConversation) {
      return operations.isInteractive()
        ? {
            type: 'perform_resume',
            sessionRef: trimmedArgs,
            requiresConfirmation: true,
          }
        : {
            type: 'message',
            messageType: 'error',
            content:
              'Cannot replace active conversation in non-interactive mode.',
          };
    }
    return { type: 'perform_resume', sessionRef: trimmedArgs };
  };
}

export function createContinueCommand(
  operations: ContinueCommandOperations,
): SlashCommand {
  return {
    name: 'continue',
    description: 'Browse and resume previous sessions',
    kind: CommandKind.BUILT_IN,
    schema: createOwnedContinueSchema(operations),
    action: createOwnedContinueAction(operations),
  };
}
