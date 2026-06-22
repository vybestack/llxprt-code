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

import { type IModel } from '../IModel.js';

const NON_CHAT_MODEL_PATTERN =
  /embedding|whisper|audio|tts|image|vision|dall[- ]?e|moderation/i;

/**
 * Returns the static fallback model list for the OpenAI Vercel provider.
 */
export function getFallbackModels(providerName: string): IModel[] {
  const models: IModel[] = [
    {
      id: 'gpt-3.5-turbo',
      name: 'GPT-3.5 Turbo',
      provider: providerName,
      supportedToolFormats: ['openai'],
      contextWindow: 16385,
    },
    {
      id: 'gpt-4',
      name: 'GPT-4',
      provider: providerName,
      supportedToolFormats: ['openai'],
      contextWindow: 8192,
    },
    {
      id: 'gpt-4-turbo',
      name: 'GPT-4 Turbo',
      provider: providerName,
      supportedToolFormats: ['openai'],
      contextWindow: 128000,
    },
    {
      id: 'gpt-4o',
      name: 'GPT-4o',
      provider: providerName,
      supportedToolFormats: ['openai'],
      contextWindow: 128000,
    },
    {
      id: 'gpt-4o-mini',
      name: 'GPT-4o Mini',
      provider: providerName,
      supportedToolFormats: ['openai'],
      contextWindow: 128000,
    },
    {
      id: 'o1-mini',
      name: 'o1-mini',
      provider: providerName,
      supportedToolFormats: ['openai'],
      contextWindow: 128000,
    },
    {
      id: 'o1-preview',
      name: 'o1-preview',
      provider: providerName,
      supportedToolFormats: ['openai'],
      contextWindow: 128000,
    },
  ];

  return models.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Extracts a numeric context window from a model object that may use
 * different casing conventions.
 */
function extractContextWindow(
  model: Record<string, unknown>,
): number | undefined {
  const contextWindow =
    (model as { context_window?: number }).context_window ??
    (model as { contextWindow?: number }).contextWindow;
  return typeof contextWindow === 'number' ? contextWindow : undefined;
}

/**
 * Filters a raw models API response into chat-capable IModel entries,
 * excluding embeddings/audio/image/vision models.
 */
export function filterChatModels(
  data: { data?: Array<{ id: string } & Record<string, unknown>> },
  providerName: string,
): IModel[] {
  const models: IModel[] = [];
  for (const model of data.data ?? []) {
    if (NON_CHAT_MODEL_PATTERN.test(model.id)) {
      continue;
    }
    const contextWindow = extractContextWindow(model);
    models.push({
      id: model.id,
      name: (model as { name?: string }).name ?? model.id,
      provider: providerName,
      supportedToolFormats: ['openai'],
      ...(contextWindow !== undefined ? { contextWindow } : undefined),
    });
  }
  return models;
}

/**
 * Sorts models alphabetically by name, or returns the fallback list if empty.
 */
export function sortModelsOrFallback(
  models: IModel[],
  providerName: string,
): IModel[] {
  return models.length > 0
    ? models.sort((a, b) => a.name.localeCompare(b.name))
    : getFallbackModels(providerName);
}
