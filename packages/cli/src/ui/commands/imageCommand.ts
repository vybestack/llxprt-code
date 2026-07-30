/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { CommandKind, type SlashCommand } from './types.js';
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
export const imageCommand: SlashCommand = {
  name: 'image',
  description:
    'Generate or edit an image. Syntax: /image <output.png> [<input.png> ...] "<prompt>". Zero inputs generates; one-to-five inputs edits. Existing output files are NOT overwritten. Examples: /image out.png "draw a cat" | /image fixed.png original.png "fix the text"',
  kind: CommandKind.BUILT_IN,

  action: async (context, args): Promise<void> => {
    let parsed;
    try {
      parsed = parseImageCommand(args);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      const parseMessage =
        error instanceof ImageCommandParseError
          ? error.message
          : `Failed to parse /image command: ${detail}`;
      context.ui.addItem(
        {
          type: MessageType.ERROR,
          text: parseMessage,
        },
        Date.now(),
      );
      return;
    }

    const resolveRunner = context.services.config?.getRunImageOperation;
    const runner = resolveRunner !== undefined ? resolveRunner() : undefined;
    if (typeof runner !== 'function') {
      context.ui.addItem(
        {
          type: MessageType.ERROR,
          text: 'Image generation is unavailable in this runtime (no image backend configured).',
        },
        Date.now(),
      );
      return;
    }

    const verb = parsed.operation === 'generate' ? 'Generated' : 'Edited';
    // The slash-command action API has no cancellation signal. Follow the
    // established process SIGINT pattern (cf. imageModeDispatch): register a
    // one-shot SIGINT listener that aborts a controller scoped to this
    // operation's lifetime. The signal is forwarded to the common runner so
    // the backend/write honor it. The listener is ALWAYS removed (finally) so
    // no listener leaks across success/failure/cancellation.
    const controller = new AbortController();
    const onSigInt = () => controller.abort();
    process.once('SIGINT', onSigInt);
    try {
      const result = await runner({
        prompt: parsed.prompt,
        outputPath: parsed.outputPath,
        inputPaths: parsed.inputPaths,
        signal: controller.signal,
      });

      context.ui.addItem(
        {
          type: MessageType.INFO,
          text: `${verb} image.\nSaved to: ${result.absoluteOutputPath}`,
        },
        Date.now(),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      context.ui.addItem(
        {
          type: MessageType.ERROR,
          text: `Image ${parsed.operation} failed: ${message}`,
        },
        Date.now(),
      );
    } finally {
      process.removeListener('SIGINT', onSigInt);
    }
  },

  completion: async (context, partialArg): Promise<string[]> => {
    const workspaceRoot = context.services.config?.getTargetDir();
    if (workspaceRoot === undefined) {
      return [];
    }
    return completeImageCommand(partialArg, workspaceRoot);
  },
};

export { IMAGE_USAGE };
