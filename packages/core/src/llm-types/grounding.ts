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
 * Neutral grounding and citation types.
 *
 * @plan PLAN-20260702-LLMTYPES.P03
 * @requirement REQ-008.3, REQ-008.4
 * @pseudocode lines 95-98
 */

/**
 * @plan PLAN-20260702-LLMTYPES.P03
 * @requirement REQ-008.3
 * @pseudocode line 95
 */
export interface GroundingSource {
  title?: string;
  url?: string;
  snippet?: string;
}

/**
 * @plan PLAN-20260702-LLMTYPES.P03
 * @requirement REQ-008.3
 * @pseudocode line 96
 */
export interface GroundingSegment {
  startIndex?: number;
  endIndex?: number;
  text?: string;
  sourceIndices?: number[];
}

/**
 * @plan PLAN-20260702-LLMTYPES.P03
 * @requirement REQ-008.3
 * @pseudocode line 97
 */
export interface GroundingInfo {
  sources: GroundingSource[];
  segments?: GroundingSegment[];
}

/**
 * @plan PLAN-20260702-LLMTYPES.P03
 * @requirement REQ-008.4
 * @pseudocode line 98
 */
export interface UrlAccessInfo {
  url: string;
  status: string;
}
