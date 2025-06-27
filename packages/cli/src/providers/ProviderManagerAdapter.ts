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
} from '@google/gemini-cli-core';
import { ProviderManager } from './ProviderManager.js';
import { IProvider } from './IProvider.js';
import { IMessage } from './IMessage.js';
import { ITool } from './ITool.js';

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
    const cliMessages: IMessage[] = messages.map((msg) => ({
      role: msg.role,
      content: msg.content,
      tool_calls: msg.tool_calls,
    }));

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
      yield {
        role: message.role as 'system' | 'user' | 'assistant',
        content: message.content || '',
        tool_calls: message.tool_calls,
      };
    }
  }
}
