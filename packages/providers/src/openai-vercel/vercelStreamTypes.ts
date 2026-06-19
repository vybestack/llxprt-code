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

import type { LanguageModelUsage } from 'ai';
import type { StripPolicy } from '../reasoning/reasoningUtils.js';
import type { CaptureBuffer } from './vercelReasoningCapture.js';

export interface ReasoningSettings {
  enabled: boolean;
  includeInResponse: boolean;
  includeInContext: boolean;
  stripFromContext: StripPolicy;
  format: 'native' | 'field';
}

export interface ModelCallParams {
  maxOutputTokens: number | undefined;
  temperature: number | undefined;
  topP: number | undefined;
  presencePenalty: number | undefined;
  frequencyPenalty: number | undefined;
  stopSequences: string | string[] | undefined;
  seed: number | undefined;
  maxRetries: number;
}

export interface StreamingState {
  textBuffer: string;
  accumulatedThinkingContent: string;
  hasEmittedThinking: boolean;
  collectedToolCalls: Array<{
    toolCallId: string;
    toolName: string;
    input: unknown;
  }>;
  totalUsage: LanguageModelUsage | undefined;
  finishReason: string | undefined;
}

export type { CaptureBuffer };
