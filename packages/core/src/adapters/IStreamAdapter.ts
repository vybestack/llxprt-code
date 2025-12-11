/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { type IContent } from '../services/history/IContent.js';
import { type ServerGeminiStreamEvent } from '../core/turn.js';

/**
 * Interface for adapting provider-specific streams to Gemini event format
 */
export interface IStreamAdapter {
  /**
   * Adapts a provider's stream format to Gemini's event stream format
   * @param providerStream The provider-specific stream of content
   * @returns An async iterator of Gemini events
   */
  adaptStream(
    providerStream: AsyncIterableIterator<IContent>,
  ): AsyncIterableIterator<ServerGeminiStreamEvent>;
}
