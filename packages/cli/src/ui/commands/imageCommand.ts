/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  CommandKind,
  type CommandContext,
  type SlashCommand,
} from './types.js';
import type { UseHistoryManagerReturn } from '../hooks/useHistoryManager.js';
import { MessageType } from '../types.js';
import {
  parseImageCommand,
  IMAGE_USAGE,
  ImageCommandParseError,
} from './imageCommandTokenizer.js';
import { completeImageCommand } from './imageCommandCompletion.js';

/**
 * `/image` slash command.
 *
 * Grammar: `/image <output-path> [<input-path> ...] "<prompt>"`
 *
 * Parses the command line with the shared quote-aware tokenizer, builds a
 * normalized image request, and delegates execution to the image operation
 * service via the CLI runtime's image backend resolver. Displays the exact
 * saved path prominently.
 *
 * The command itself only owns parsing + invocation orchestration; all
 * validation, transport, and persistence live in the shared service layers.
 */
export interface ImageCommandOperations {
  readonly workspaceRoot: string | undefined;
  readonly runImageOperation:
    | ((request: {
        prompt: string;
        outputPath: string;
        inputPaths: readonly string[];
        signal: AbortSignal;
      }) => Promise<{ absoluteOutputPath: string }>)
    | undefined;
  readonly addItem: UseHistoryManagerReturn['addItem'];
}

export function createImageCommand(
  operations: ImageCommandOperations,
): SlashCommand {
  return {
    name: 'image',
    description:
      'Generate or edit an image. Syntax: /image <output.png> [<input.png> ...] "<prompt>". Zero inputs generates; one-to-five inputs edits. Existing output files are NOT overwritten. Examples: /image out.png "draw a cat" | /image fixed.png original.png "fix the text"',
    kind: CommandKind.BUILT_IN,
    action: async (
      invocation: Pick<CommandContext, 'signal'>,
      args: string,
    ): Promise<void> => {
      let parsed;
      try {
        parsed = parseImageCommand(args);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        const parseMessage =
          error instanceof ImageCommandParseError
            ? error.message
            : `Failed to parse /image command: ${detail}`;
        operations.addItem(
          { type: MessageType.ERROR, text: parseMessage },
          Date.now(),
        );
        return;
      }

      const runner = operations.runImageOperation;
      if (typeof runner !== 'function') {
        operations.addItem(
          {
            type: MessageType.ERROR,
            text:
              'Image generation is unavailable in this runtime. Image generation ' +
              'uses your Codex account and works from any provider, so this ' +
              'usually means Codex OAuth is not set up. Run "/auth codex enable" ' +
              'and sign in, then try again.',
          },
          Date.now(),
        );
        return;
      }

      const verb = parsed.operation === 'generate' ? 'Generated' : 'Edited';
      try {
        const result = await runner({
          prompt: parsed.prompt,
          outputPath: parsed.outputPath,
          inputPaths: parsed.inputPaths,
          signal: invocation.signal,
        });
        if (invocation.signal.aborted) return;
        operations.addItem(
          {
            type: MessageType.INFO,
            text: `${verb} image.\nSaved to: ${result.absoluteOutputPath}`,
          },
          Date.now(),
        );
      } catch (error) {
        if (invocation.signal.aborted) return;
        const message = error instanceof Error ? error.message : String(error);
        operations.addItem(
          {
            type: MessageType.ERROR,
            text: `Image ${parsed.operation} failed: ${message}`,
          },
          Date.now(),
        );
      }
    },
    completion: async (_invocation, partialArg): Promise<string[]> => {
      if (operations.workspaceRoot === undefined) return [];
      return completeImageCommand(partialArg, operations.workspaceRoot);
    },
  };
}
export { IMAGE_USAGE };
