/**
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { type IModel } from '../IModel.js';

/**
 * Commonly available OpenAI models, used when the models endpoint cannot be
 * reached. Held as id/name pairs rather than full IModel records because the
 * provider name is only known at call time: subclasses of OpenAIProvider
 * (for example Chutes.ai) reuse this list under their own name.
 */
const FALLBACK_MODEL_SPECS: ReadonlyArray<{
  readonly id: string;
  readonly name: string;
}> = [
  { id: 'gpt-5.6', name: 'GPT-5.6' },
  { id: 'gpt-5.6-sol', name: 'GPT-5.6 Sol' },
  { id: 'gpt-5.6-terra', name: 'GPT-5.6 Terra' },
  { id: 'gpt-5.6-luna', name: 'GPT-5.6 Luna' },
  { id: 'gpt-5.5', name: 'GPT-5.5' },
  { id: 'gpt-5.4', name: 'GPT-5.4' },
  { id: 'gpt-4.2-turbo-preview', name: 'GPT-4.2 Turbo Preview' },
  { id: 'gpt-4.2-turbo', name: 'GPT-4.2 Turbo' },
];

export function getOpenAIFallbackModels(providerName: string): IModel[] {
  return FALLBACK_MODEL_SPECS.map(({ id, name }) => ({
    id,
    name,
    provider: providerName,
    supportedToolFormats: ['openai'],
  }));
}
