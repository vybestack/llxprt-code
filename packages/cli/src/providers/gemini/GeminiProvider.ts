/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { IProvider, IModel, IMessage, ITool } from '../IProvider.js';

/**
 * Represents the default Gemini provider.
 * This provider is implicitly active when no other provider is explicitly set.
 */
export class GeminiProvider implements IProvider {
  readonly name: string = 'gemini';

  async getModels(): Promise<IModel[]> {
    // In a real scenario, this would fetch available Gemini models.
    // For now, we can return a placeholder or a default model.
    return [
      {
        id: 'gemini-2.5-pro',
        name: 'Gemini 2.5 Pro',
        provider: this.name,
        supportedToolFormats: [], // Assuming no specific tool formats for now
      },
    ];
  }

  async *generateChatCompletion(
    _messages: IMessage[],
    _tools?: ITool[],
    _toolFormat?: string,
  ): AsyncIterableIterator<unknown> {
    yield undefined; // Satisfy the generator requirement
    throw new Error('Method not implemented for GeminiProvider.');
  }
}
