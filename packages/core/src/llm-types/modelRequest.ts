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
 * Neutral model generation request and settings types.
 *
 * @plan PLAN-20260702-LLMTYPES.P04
 * @requirement REQ-006
 * @pseudocode lines 60-64
 */

import type { IContent } from '../services/history/IContent.js';
import type { ToolDeclaration, ToolChoice } from './toolDeclaration.js';

/**
 * @plan PLAN-20260702-LLMTYPES.P04
 * @requirement REQ-006.3
 * @pseudocode line 60
 */
export interface ReasoningConfig {
  budgetTokens?: number;
  effort?: 'low' | 'medium' | 'high';
  includeInOutput?: boolean;
}

/**
 * @plan PLAN-20260702-LLMTYPES.P04
 * @requirement REQ-006.1
 * @pseudocode lines 61-62
 */
export interface ModelGenerationSettings {
  temperature?: number;
  maxOutputTokens?: number;
  systemInstruction?: string;
  reasoning?: ReasoningConfig;
  toolChoice?: ToolChoice;
}

/**
 * @plan PLAN-20260702-LLMTYPES.P04
 * @requirement REQ-006.2
 * @pseudocode lines 63-64
 */
export interface ModelGenerationRequest {
  contents: IContent[];
  tools?: ToolDeclaration[];
  settings?: ModelGenerationSettings;
}
