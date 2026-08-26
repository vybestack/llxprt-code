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

    const runner = context.services.config?.getRunImageOperation?.();
    if (typeof runner !== 'function') {
      context.ui.addItem(
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
    // context.signal is the framework's per-invocation cancellation signal: it
    // aborts on Esc in the interactive UI and on the process abort controller
    // in non-interactive mode. Forwarding it to the common runner is what makes
    // the backend request and the output write stop.
    try {
      const result = await runner({
        prompt: parsed.prompt,
        outputPath: parsed.outputPath,
        inputPaths: parsed.inputPaths,
        signal: context.signal,
      });

      // The runner can win a race with the abort. Reporting success on top of
      // the framework's cancellation notice would contradict it.
      if (context.signal.aborted) return;

      context.ui.addItem(
        {
          type: MessageType.INFO,
          text: `${verb} image.\nSaved to: ${result.absoluteOutputPath}`,
        },
        Date.now(),
      );
    } catch (error) {
      // A rejection after cancellation is the expected shape of "the user
      // pressed Esc"; the framework already reported it in history.
      if (context.signal.aborted) return;
      const message = error instanceof Error ? error.message : String(error);
      context.ui.addItem(
        {
          type: MessageType.ERROR,
          text: `Image ${parsed.operation} failed: ${message}`,
        },
        Date.now(),
      );
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
