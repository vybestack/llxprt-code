/**
 * Copyright 2025 Vybestack LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { IProvider } from '../IProvider.js';
import { IModel } from '../IModel.js';
import { ITool } from '../ITool.js';
import { IMessage } from '../IMessage.js';
import { ContentGeneratorRole } from '../types.js';
import OpenAI from 'openai';

export class OpenAIProvider implements IProvider {
  name: string = 'openai';
  private openai: OpenAI;
  private currentModel: string = 'gpt-4.1';
  private apiKey: string;
  private baseURL?: string;

  constructor(apiKey: string, baseURL?: string) {
    if (!apiKey || apiKey.trim() === '') {
      throw new Error('OpenAI API key is required');
    }

    this.apiKey = apiKey;
    this.baseURL = baseURL;
    this.openai = new OpenAI({
      apiKey,
      baseURL,
      // Allow browser environment for tests
      dangerouslyAllowBrowser: process.env.NODE_ENV === 'test',
    });
  }

  async getModels(): Promise<IModel[]> {
    try {
      const response = await this.openai.models.list();
      const models: IModel[] = [];

      for await (const model of response) {
        // Filter out non-chat models (embeddings, audio, image, moderation, DALL·E, etc.)
        if (
          !/embedding|whisper|audio|tts|image|vision|dall[- ]?e|moderation/i.test(
            model.id,
          )
        ) {
          models.push({
            id: model.id,
            name: model.id,
            provider: 'openai',
            supportedToolFormats: ['openai'],
          });
        }
      }

      return models;
    } catch (error) {
      console.error('Error fetching models from OpenAI:', error);
      // Return a hardcoded list as fallback
      return [
        {
          id: 'gpt-4o',
          name: 'gpt-4o',
          provider: 'openai',
          supportedToolFormats: ['openai'],
        },
        {
          id: 'gpt-4o-mini',
          name: 'gpt-4o-mini',
          provider: 'openai',
          supportedToolFormats: ['openai'],
        },
        {
          id: 'gpt-4-turbo',
          name: 'gpt-4-turbo',
          provider: 'openai',
          supportedToolFormats: ['openai'],
        },
        {
          id: 'gpt-3.5-turbo',
          name: 'gpt-3.5-turbo',
          provider: 'openai',
          supportedToolFormats: ['openai'],
        },
      ];
    }
  }

  async *generateChatCompletion(
    messages: IMessage[],
    tools?: ITool[],
    _toolFormat?: string,
  ): AsyncIterableIterator<IMessage> {
    console.debug('[OpenAIProvider] generateChatCompletion called');
    console.debug('[OpenAIProvider] Model:', this.currentModel);
    console.debug(
      '[OpenAIProvider] Messages:',
      JSON.stringify(messages, null, 2),
    );
    console.debug('[OpenAIProvider] Tools provided:', tools ? tools.length : 0);
    if (tools && tools.length > 0) {
      console.debug(
        '[OpenAIProvider] Tool details:',
        JSON.stringify(tools, null, 2),
      );
      // Validate tool format
      for (const tool of tools) {
        if (!tool.function?.name) {
          console.warn('[OpenAIProvider] Tool missing function.name:', tool);
        }
        if (!tool.function?.parameters) {
          console.warn(
            '[OpenAIProvider] Tool missing function.parameters:',
            tool,
          );
        }
      }
    }

    // Validate tool messages have required tool_call_id
    const toolMessages = messages.filter((msg) => msg.role === 'tool');
    const missingIds = toolMessages.filter((msg) => !msg.tool_call_id);

    if (missingIds.length > 0) {
      console.error(
        '[OpenAIProvider] FATAL: Tool messages missing tool_call_id:',
        missingIds,
      );
      throw new Error(
        `OpenAI API requires tool_call_id for all tool messages. Found ${missingIds.length} tool message(s) without IDs.`,
      );
    }

    if (toolMessages.length > 0) {
      console.log(
        `[OpenAIProvider] Processing ${toolMessages.length} tool call(s)`,
      );
    }

    const stream = await this.openai.chat.completions.create({
      model: this.currentModel,
      messages:
        messages as OpenAI.Chat.Completions.ChatCompletionMessageParam[],
      stream: true,
      stream_options: { include_usage: true },
      tools: tools
        ? (tools as OpenAI.Chat.Completions.ChatCompletionTool[])
        : undefined,
      tool_choice: tools && tools.length > 0 ? 'auto' : undefined,
    });

    let fullContent = '';
    const accumulatedToolCalls: NonNullable<IMessage['tool_calls']> = [];
    let usageData: { prompt_tokens: number; completion_tokens: number; total_tokens: number } | undefined;

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta;

      if (delta?.content) {
        fullContent += delta.content;
        yield { role: ContentGeneratorRole.ASSISTANT, content: delta.content };
      }

      if (delta?.tool_calls) {
        console.log(
          '[OpenAIProvider] 🎯 TOOL CALL RECEIVED! Chunk:',
          JSON.stringify(delta.tool_calls),
        );
        for (const toolCall of delta.tool_calls) {
          if (toolCall.index !== undefined) {
            if (!accumulatedToolCalls[toolCall.index]) {
              accumulatedToolCalls[toolCall.index] = {
                id: toolCall.id || '',
                type: 'function',
                function: { name: '', arguments: '' },
              };
            }
            const tc = accumulatedToolCalls[toolCall.index];
            if (toolCall.id) tc.id = toolCall.id;
            if (toolCall.function?.name)
              tc.function.name = toolCall.function.name;
            if (toolCall.function?.arguments)
              tc.function.arguments += toolCall.function.arguments;
          }
        }
      }

      // Check for usage data in the chunk
      if (chunk.usage) {
        console.log('[OpenAIProvider] 📊 USAGE DATA RECEIVED:', JSON.stringify(chunk.usage, null, 2));
        usageData = {
          prompt_tokens: chunk.usage.prompt_tokens,
          completion_tokens: chunk.usage.completion_tokens,
          total_tokens: chunk.usage.total_tokens,
        };
      }
    }

    // Yield final message with tool calls and/or usage information
    if (accumulatedToolCalls.length > 0) {
      console.log(
        '[OpenAIProvider] 🎯 YIELDING TOOL CALLS:',
        accumulatedToolCalls.length,
      );
      yield {
        role: ContentGeneratorRole.ASSISTANT,
        content: fullContent || '',
        tool_calls: accumulatedToolCalls,
        usage: usageData,
      };
    } else if (usageData) {
      // Always emit usage data so downstream consumers can update stats
      yield {
        role: ContentGeneratorRole.ASSISTANT,
        content: '',
        usage: usageData,
      };
    }
  }

  setModel(modelId: string): void {
    this.currentModel = modelId;
  }

  getCurrentModel(): string {
    return this.currentModel;
  }

  setApiKey(apiKey: string): void {
    if (!apiKey || apiKey.trim() === '') {
      throw new Error('OpenAI API key is required');
    }
    
    this.apiKey = apiKey;
    // Create a new OpenAI client with the updated API key
    this.openai = new OpenAI({
      apiKey,
      baseURL: this.baseURL,
      dangerouslyAllowBrowser: process.env.NODE_ENV === 'test',
    });
  }

  setBaseUrl(baseUrl?: string): void {
    // If no baseUrl is provided, clear to default (undefined)
    this.baseURL = baseUrl && baseUrl.trim() !== '' ? baseUrl : undefined;
    // Create a new OpenAI client with the updated (or cleared) base URL
    this.openai = new OpenAI({
      apiKey: this.apiKey,
      baseURL: this.baseURL,
      dangerouslyAllowBrowser: process.env.NODE_ENV === 'test',
    });
  }
}
