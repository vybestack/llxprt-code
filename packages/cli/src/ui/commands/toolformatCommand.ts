/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  SlashCommand,
  CommandContext,
  MessageActionReturn,
} from './types.js';
import { CommandKind } from './types.js';
import { getRuntimeApi } from '../contexts/RuntimeContext.js';
import type { ToolFormatOverrideLiteral } from '../../runtime/runtimeSettings.js';

const STRUCTURED_FORMATS = [
  'openai',
  'anthropic',
  'deepseek',
  'qwen',
  'kimi',
  'gemma',
];
const TEXT_FORMATS = ['hermes', 'xml', 'llama'];
const ALL_FORMATS = [...STRUCTURED_FORMATS, ...TEXT_FORMATS];

export const toolformatCommand: SlashCommand = {
  name: 'toolformat',
  description:
    'override the auto-detected tool calling/format parser for tools',
  kind: CommandKind.BUILT_IN,
  action: async (
    _context: CommandContext,
    args: string,
  ): Promise<MessageActionReturn | void> => {
    const formatName = args?.trim();
    let state;
    try {
      const runtime = getRuntimeApi();
      state = await runtime.getActiveToolFormatState();
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
      const runtime = getRuntimeApi();
      const updated = await runtime.setActiveToolFormatOverride(null);
      return {
        type: 'message',
        messageType: 'info',
        content: `Tool format override cleared for provider '${updated.providerName}'. Using auto-detection.`,
      };
    }

    if (!ALL_FORMATS.includes(formatName)) {
      return {
        type: 'message',
        messageType: 'error',
        content: `Invalid tool format '${formatName}'.\nSupported formats:\n  Structured: ${STRUCTURED_FORMATS.join(', ')}\n  Text-based: ${TEXT_FORMATS.join(', ')}`,
      };
    }

    try {
      const normalized = formatName as ToolFormatOverrideLiteral;
      const runtime = getRuntimeApi();
      const updated = await runtime.setActiveToolFormatOverride(normalized);
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
