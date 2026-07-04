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
 * Neutral count-tokens and embed-content types.
 *
 * @plan PLAN-20260702-LLMTYPES.P03
 * @requirement REQ-008.1, REQ-008.2
 * @pseudocode lines 100-103
 */

import type { IContent } from '../services/history/IContent.js';

/**
 * @plan PLAN-20260702-LLMTYPES.P03
 * @requirement REQ-008.1
 * @pseudocode line 100
 */
export interface CountTokensRequest {
  contents: IContent[];
}

/**
 * @plan PLAN-20260702-LLMTYPES.P03
 * @requirement REQ-008.1
 * @pseudocode line 101
 */
export interface CountTokensResult {
  totalTokens: number;
}

/**
 * @plan PLAN-20260702-LLMTYPES.P03
 * @requirement REQ-008.2
 * @pseudocode line 102
 */
export interface EmbedContentRequest {
  texts: string[];
}

/**
 * @plan PLAN-20260702-LLMTYPES.P03
 * @requirement REQ-008.2
 * @pseudocode line 103
 */
export interface EmbedContentResult {
  embeddings: number[][];
}
