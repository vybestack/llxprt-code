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

import type { ToolFormat } from '../../tools/IToolFormatter.js';
import { isKimiModel, isMistralModel } from '../../tools/ToolIdStrategy.js';
import type { DebugLogger } from '../../debug/index.js';

/**
 * Auto-detect the tool format based on model name.
 *
 * Returns the appropriate ToolFormat for the given model so that tool IDs
 * and invocation payloads match what the model endpoint expects.
 */
export function detectToolFormat(
  modelName: string,
  logger?: DebugLogger,
): ToolFormat {
  if (isKimiModel(modelName)) {
    logger?.debug(
      () => `Auto-detected 'kimi' format for K2 model: ${modelName}`,
    );
    return 'kimi';
  }

  if (isMistralModel(modelName)) {
    logger?.debug(
      () => `Auto-detected 'mistral' format for Mistral model: ${modelName}`,
    );
    return 'mistral';
  }

  const lowerModelName = modelName.toLowerCase();

  if (lowerModelName.includes('glm-4')) {
    logger?.debug(
      () => `Auto-detected 'qwen' format for GLM-4.x model: ${modelName}`,
    );
    return 'qwen';
  }

  if (lowerModelName.includes('qwen')) {
    logger?.debug(
      () => `Auto-detected 'qwen' format for Qwen model: ${modelName}`,
    );
    return 'qwen';
  }

  logger?.debug(() => `Using default 'openai' format for model: ${modelName}`);
  return 'openai';
}
