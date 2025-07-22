/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { IMessage } from '../index.js';
import { ServerGeminiStreamEvent } from '@vybestack/llxprt-code-core';

/**
 * Interface for adapting provider-specific streams to Gemini event format
 */
export interface IStreamAdapter {
  /**
   * Adapts a provider's stream format to Gemini's event stream format
   * @param providerStream The provider-specific stream of messages
   * @returns An async iterator of Gemini events
   */
  adaptStream(
    providerStream: AsyncIterableIterator<IMessage>,
  ): AsyncIterableIterator<ServerGeminiStreamEvent>;
}
