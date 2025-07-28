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
import { getProviderManager } from '../../providers/providerManagerInstance.js';
import { SettingScope } from '../../config/settings.js';

const STRUCTURED_FORMATS = ['openai', 'anthropic', 'deepseek', 'qwen', 'gemma'];
const TEXT_FORMATS = ['hermes', 'xml', 'llama'];
const ALL_FORMATS = [...STRUCTURED_FORMATS, ...TEXT_FORMATS];

export const toolformatCommand: SlashCommand = {
  name: 'toolformat',
  description:
    'override the auto-detected tool calling/format parser for tools',
  kind: CommandKind.BUILT_IN,
  action: (
    context: CommandContext,
    args: string,
  ): MessageActionReturn | void => {
    const formatName = args?.trim();
    const providerManager = getProviderManager();
    if (!providerManager.hasActiveProvider()) {
      return {
        type: 'message',
        messageType: 'error',
        content:
          'No active provider. Please select a provider before setting tool format.',
      };
    }
    const activeProvider = providerManager.getActiveProvider();
    const providerName = activeProvider.name;
    const settings = context.services.settings;

    // Show current format
    if (!formatName) {
      const currentFormat = activeProvider.getToolFormat
        ? activeProvider.getToolFormat()
        : 'unknown';
      const isAutoDetected = !(
        settings.merged.providerToolFormatOverrides &&
        settings.merged.providerToolFormatOverrides[providerName]
      );
      return {
        type: 'message',
        messageType: 'info',
        content: `Current tool format: ${currentFormat} (${isAutoDetected ? 'auto-detected' : 'manual override'})\nTo override: /toolformat <format>\nTo return to auto: /toolformat auto\nSupported formats:\n  Structured: ${STRUCTURED_FORMATS.join(', ')}\n  Text-based: ${TEXT_FORMATS.join(', ')}`,
      };
    }

    if (formatName === 'auto') {
      if (activeProvider.setToolFormatOverride) {
        activeProvider.setToolFormatOverride(null);
      }
      const currentOverrides = {
        ...(settings.merged.providerToolFormatOverrides || {}),
      };
      delete currentOverrides[providerName];
      settings.setValue(
        SettingScope.User,
        'providerToolFormatOverrides',
        currentOverrides,
      );
      return {
        type: 'message',
        messageType: 'info',
        content: `Tool format override cleared for provider '${providerName}'. Using auto-detection.`,
      };
    }

    if (!ALL_FORMATS.includes(formatName)) {
      return {
        type: 'message',
        messageType: 'error',
        content: `Invalid tool format '${formatName}'.\nSupported formats:\n  Structured: ${STRUCTURED_FORMATS.join(', ')}\n  Text-based: ${TEXT_FORMATS.join(', ')}`,
      };
    }

    // Set override
    try {
      if (activeProvider.setToolFormatOverride) {
        activeProvider.setToolFormatOverride(formatName);
      }
      const currentOverrides = {
        ...(settings.merged.providerToolFormatOverrides || {}),
      };
      currentOverrides[providerName] = formatName;
      settings.setValue(
        SettingScope.User,
        'providerToolFormatOverrides',
        currentOverrides,
      );
      return {
        type: 'message',
        messageType: 'info',
        content: `Tool format override set to '${formatName}' for provider '${providerName}'.`,
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
