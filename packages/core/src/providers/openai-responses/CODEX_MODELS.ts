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
 * Hardcoded Codex models for fallback when API fetch fails
 * @plan PLAN-20251213-ISSUE160.P04
 * Default model: gpt-5.2
 */

import { type IModel } from '../IModel.js';

export const CODEX_MODELS: IModel[] = [
  {
    id: 'gpt-5.2',
    name: 'GPT-5.2',
    provider: 'codex',
    supportedToolFormats: ['openai'],
  },
  {
    id: 'gpt-5.1-codex-max',
    name: 'GPT-5.1 Codex Max',
    provider: 'codex',
    supportedToolFormats: ['openai'],
  },
  {
    id: 'gpt-5.1-preview',
    name: 'GPT-5.1 Preview',
    provider: 'codex',
    supportedToolFormats: ['openai'],
  },
] as const;
