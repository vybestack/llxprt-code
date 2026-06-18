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

import type { IContent } from './IContent.js';
import type { TokensUpdatedEvent } from './HistoryEvents.js';

/**
 * Typed EventEmitter interface for HistoryService events.
 */
export interface HistoryServiceEventEmitter {
  on(
    event: 'tokensUpdated',
    listener: (eventData: TokensUpdatedEvent) => void,
  ): this;
  on(event: 'contentAdded', listener: (content: IContent) => void): this;
  on(event: 'compressionStarted', listener: () => void): this;
  on(
    event: 'compressionEnded',
    listener: (summary: IContent, itemsCompressed: number) => void,
  ): this;
  emit(event: 'tokensUpdated', eventData: TokensUpdatedEvent): boolean;
  emit(event: 'contentAdded', content: IContent): boolean;
  emit(event: 'compressionStarted'): boolean;
  emit(
    event: 'compressionEnded',
    summary: IContent,
    itemsCompressed: number,
  ): boolean;
  off(
    event: 'tokensUpdated',
    listener: (eventData: TokensUpdatedEvent) => void,
  ): this;
  off(event: 'contentAdded', listener: (content: IContent) => void): this;
  off(event: 'compressionStarted', listener: () => void): this;
  off(
    event: 'compressionEnded',
    listener: (summary: IContent, itemsCompressed: number) => void,
  ): this;
}

/**
 * Configuration for compression behavior
 */
export interface CompressionConfig {
  orphanTimeoutMs: number; // Time before considering a call orphaned
  orphanMessageDistance: number; // Messages before considering orphaned
  pendingGracePeriodMs: number; // Grace period for pending calls
  minMessagesForCompression: number; // Minimum messages before compression
}
