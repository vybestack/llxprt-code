/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  Provider,
  ProviderManager as CoreProviderManager,
  ProviderMessage,
  ProviderTool,
} from '@vybestack/llxprt-code-core';
import { ProviderManager } from './ProviderManager.js';
import { IProvider } from './IProvider.js';
import { IMessage } from './IMessage.js';
import { ITool } from './ITool.js';
import { ContentGeneratorRole } from './types.js';

/**
 * Adapter that makes the CLI's ProviderManager compatible with the core's ProviderManager interface
 */
export class ProviderManagerAdapter implements CoreProviderManager {
  constructor(private cliProviderManager: ProviderManager) {}

  hasActiveProvider(): boolean {
    return this.cliProviderManager.hasActiveProvider();
  }

  getActiveProvider(): Provider | null {
    const cliProvider = this.cliProviderManager.getActiveProvider();
    if (!cliProvider) return null;

    return new ProviderAdapter(cliProvider);
  }

  getActiveProviderName(): string {
    return this.cliProviderManager.getActiveProviderName();
  }
}

/**
 * Adapter that makes the CLI's IProvider compatible with the core's Provider interface
 */
class ProviderAdapter implements Provider {
  constructor(private cliProvider: IProvider) {}

  get name(): string {
    return this.cliProvider.name;
  }

  getCurrentModel(): string {
    return this.cliProvider.getCurrentModel?.() || 'unknown';
  }

  setModel(modelId: string): void {
    this.cliProvider.setModel?.(modelId);
  }

  async *generateChatCompletion(
    messages: ProviderMessage[],
    tools?: ProviderTool[],
  ): AsyncIterableIterator<ProviderMessage> {
    // Convert core messages to CLI messages
    const cliMessages: IMessage[] = messages.map((msg) => {
      let role: ContentGeneratorRole | 'system';
      switch (msg.role) {
        case 'user':
          role = ContentGeneratorRole.USER;
          break;
        case 'assistant':
          role = ContentGeneratorRole.ASSISTANT;
          break;
        case 'tool':
          role = ContentGeneratorRole.TOOL;
          break;
        case 'system':
          role = 'system';
          break;
        default:
          throw new Error(`Unknown role: ${msg.role}`);
      }
      return {
        role,
        content: msg.content,
        tool_calls: msg.tool_calls,
        tool_call_id: msg.tool_call_id,
        parts: 'parts' in msg ? (msg as { parts?: unknown }).parts : undefined, // Preserve parts field for PDFs/images
      } as IMessage;
    });

    // Convert core tools to CLI tools
    const cliTools: ITool[] | undefined = tools?.map((tool) => ({
      type: tool.type,
      function: {
        ...tool.function,
        parameters: tool.function.parameters || {},
      },
    }));

    // Generate and convert responses
    for await (const cliMessage of this.cliProvider.generateChatCompletion(
      cliMessages,
      cliTools,
    )) {
      const message = cliMessage as IMessage;
      let coreRole: 'system' | 'user' | 'assistant' | 'tool';
      switch (message.role) {
        case ContentGeneratorRole.USER:
          coreRole = 'user';
          break;
        case ContentGeneratorRole.ASSISTANT:
          coreRole = 'assistant';
          break;
        case ContentGeneratorRole.TOOL:
          coreRole = 'tool';
          break;
        case 'system':
          coreRole = 'system';
          break;
        default:
          throw new Error(`Unknown role: ${message.role}`);
      }
      yield {
        role: coreRole,
        content: message.content || '',
        tool_calls: message.tool_calls,
        tool_call_id: message.tool_call_id,
        parts:
          'parts' in message
            ? (message as { parts?: unknown }).parts
            : undefined, // Preserve parts field for PDFs/images
      } as ProviderMessage;
    }
  }
}
