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
 * Note: /models endpoint is behind Cloudflare bot protection, so we must use fallback
 * Models based on codex-rs/core/tests/suite/list_models.rs
 * @plan PLAN-20251214-ISSUE160.P06
 */

import { type IModel } from '../IModel.js';

export const CODEX_MODELS: IModel[] = [
  {
    id: 'gpt-5.3-codex',
    name: 'gpt-5.3-codex',
    provider: 'codex',
    supportedToolFormats: ['openai'],
  },
  {
    id: 'gpt-5.2-codex',
    name: 'gpt-5.2-codex',
    provider: 'codex',
    supportedToolFormats: ['openai'],
  },
  {
    id: 'gpt-5.1-codex-max',
    name: 'gpt-5.1-codex-max',
    provider: 'codex',
    supportedToolFormats: ['openai'],
  },
  {
    id: 'gpt-5.1-codex',
    name: 'gpt-5.1-codex',
    provider: 'codex',
    supportedToolFormats: ['openai'],
  },
  {
    id: 'gpt-5.1-codex-mini',
    name: 'gpt-5.1-codex-mini',
    provider: 'codex',
    supportedToolFormats: ['openai'],
  },
  {
    id: 'gpt-5.2',
    name: 'gpt-5.2',
    provider: 'codex',
    supportedToolFormats: ['openai'],
  },
  {
    id: 'gpt-5.1',
    name: 'gpt-5.1',
    provider: 'codex',
    supportedToolFormats: ['openai'],
  },
] as const;
