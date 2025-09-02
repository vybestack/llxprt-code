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

/**
 * Event data emitted when token count is updated
 */
export interface TokensUpdatedEvent {
  /** The new total token count */
  totalTokens: number;

  /** Number of tokens added (positive) or removed (negative) */
  addedTokens: number;

  /** ID of the content that triggered the update, if applicable */
  contentId?: string | null;
}

/**
 * All possible history service events
 */
export interface HistoryServiceEvents {
  tokensUpdated: (event: TokensUpdatedEvent) => void;
}
