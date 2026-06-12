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

import type { ToolFormat } from '@vybestack/llxprt-code-tools/IToolFormatter.js';
import {
  isKimiModel,
  isMistralModel,
  isDeepSeekReasonerModel,
} from '@vybestack/llxprt-code-tools/ToolIdStrategy.js';
import type { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';

/**
 * All valid ToolFormat literal values from the IToolFormatter type, plus 'auto'
 * for disabling the override and using model-based auto-detection.
 *
 * When a toolFormat override in provider settings does not match one of these
 * values, it is ignored and auto-detection is used instead.
 */
export const VALID_TOOL_FORMATS: ReadonlySet<string> = new Set<string>([
  'openai',
  'anthropic',
  'deepseek',
  'qwen',
  'kimi',
  'mistral',
  'hermes',
  'xml',
  'llama',
  'gemma',
  'auto',
]);

/**
 * Minimal interface for settings objects that can provide provider-specific
 * toolFormat overrides. Matches the subset of SettingsService used for
 * tool format resolution, allowing tests to supply lightweight stubs.
 */
export interface ToolFormatSettings {
  getProviderSettings(
    providerName: string,
  ): Record<string, unknown> | undefined;
}

/**
 * Get the tool format override from provider settings.
 *
 * Returns the explicit toolFormat override value if one is set (e.g. 'openai',
 * 'kimi'), 'auto' if set to auto-detect, or undefined if no override exists.
 * Invalid strings (not in VALID_TOOL_FORMATS) are ignored with a logged
 * warning, and the function returns undefined so auto-detection is used.
 * Only non-'auto' values should bypass auto-detection.
 */
export function getToolFormatOverride(
  providerName: string,
  settings: ToolFormatSettings,
  logger?: DebugLogger,
): ToolFormat | 'auto' | undefined {
  const providerSettings = settings.getProviderSettings(providerName);
  const toolFormatOverride = providerSettings?.toolFormat;
  if (typeof toolFormatOverride !== 'string') {
    return undefined;
  }
  if (!VALID_TOOL_FORMATS.has(toolFormatOverride)) {
    logger?.warn(
      () =>
        `Ignoring invalid toolFormat override '${toolFormatOverride}' for provider '${providerName}'. Valid values: ${[...VALID_TOOL_FORMATS].join(', ')}. Falling back to auto-detection.`,
    );
    return undefined;
  }
  return toolFormatOverride as ToolFormat | 'auto';
}

/**
 * Resolve the effective tool format for a provider, checking for explicit
 * overrides in provider settings before falling back to model-based
 * auto-detection.
 *
 * This is the OpenAI-family equivalent of AnthropicProvider.detectToolFormat().
 * The pattern:
 * 1. If provider has an explicit toolFormat override (not 'auto'), use it.
 * 2. Otherwise, auto-detect based on model name.
 */
export function resolveToolFormat(
  modelName: string,
  providerName: string,
  settings: ToolFormatSettings,
  logger?: DebugLogger,
): ToolFormat {
  const override = getToolFormatOverride(providerName, settings, logger);

  if (override !== undefined && override !== 'auto') {
    logger?.debug(
      () =>
        `Using explicit tool format override '${override}' for provider '${providerName}', model '${modelName}'`,
    );
    return override;
  }

  return detectToolFormat(modelName, logger);
}

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
  if (isDeepSeekReasonerModel(modelName)) {
    logger?.debug(
      () =>
        `Auto-detected 'deepseek' format for DeepSeek Reasoner model: ${modelName}`,
    );
    return 'deepseek';
  }

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
