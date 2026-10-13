/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { SlashCommand, MessageActionReturn } from './types.js';
import { CommandKind } from './types.js';
import type {
  ToolFormatOverrideLiteral,
  ToolFormatState,
} from '@vybestack/llxprt-code-agents';

const STRUCTURED_FORMATS: readonly ToolFormatOverrideLiteral[] = Object.freeze([
  'openai',
  'anthropic',
  'deepseek',
  'qwen',
  'kimi',
  'gemma',
]);
const TEXT_FORMATS: readonly ToolFormatOverrideLiteral[] = Object.freeze([
  'hermes',
  'xml',
  'llama',
]);
const ALL_FORMATS = Object.freeze([...STRUCTURED_FORMATS, ...TEXT_FORMATS]);

function isToolFormat(value: string): value is ToolFormatOverrideLiteral {
  return ALL_FORMATS.some((format) => format === value);
}

export function createToolFormatCommand(
  readState: () => Promise<ToolFormatState>,
  setOverride: (
    format: ToolFormatOverrideLiteral | null,
  ) => Promise<ToolFormatState>,
): SlashCommand {
  return {
    name: 'toolformat',
    description:
      'override the auto-detected tool calling/format parser for tools',
    kind: CommandKind.BUILT_IN,
    action: async (
      _invocation: Readonly<{ signal: AbortSignal }>,
      args: string,
    ): Promise<MessageActionReturn | void> => {
      const formatName = args.trim();
      let state;
      try {
        state = await readState();
      } catch (error) {
        return {
          type: 'message',
          messageType: 'error',
          content: `Failed to read tool format: ${error instanceof Error ? error.message : String(error)}`,
        };
      }

      // Show current format
      if (!formatName) {
        return {
          type: 'message',
          messageType: 'info',
          content: `Current tool format: ${state.currentFormat ?? 'unknown'} (${state.isAutoDetected ? 'auto-detected' : 'manual override'})\nTo override: /toolformat <format>\nTo return to auto: /toolformat auto\nSupported formats:\n  Structured: ${STRUCTURED_FORMATS.join(', ')}\n  Text-based: ${TEXT_FORMATS.join(', ')}`,
        };
      }

      if (formatName === 'auto') {
        const updated = await setOverride(null);
        return {
          type: 'message',
          messageType: 'info',
          content: `Tool format override cleared for provider '${updated.providerName}'. Using auto-detection.`,
        };
      }

      if (!isToolFormat(formatName)) {
        return {
          type: 'message',
          messageType: 'error',
          content: `Invalid tool format '${formatName}'.\nSupported formats:\n  Structured: ${STRUCTURED_FORMATS.join(', ')}\n  Text-based: ${TEXT_FORMATS.join(', ')}`,
        };
      }

      try {
        const updated = await setOverride(formatName);
        return {
          type: 'message',
          messageType: 'info',
          content: `Tool format override set to '${formatName}' for provider '${updated.providerName}'.`,
        };
      } catch (error) {
        return {
          type: 'message',
          messageType: 'error',
          content: `Failed to set tool format override: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    },
  };
}
