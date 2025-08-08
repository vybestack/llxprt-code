/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { OpenAIProvider } from '../openai/OpenAIProvider.js';
import { IProvider } from '../IProvider.js';

export class OpenRouterProvider extends OpenAIProvider implements IProvider {
  name: string;
  displayName: string;
  baseUrl: string;

  constructor(config: any) {
    super(config);
    this.name = 'openrouter';
    this.displayName = 'OpenRouter';
    this.baseUrl = 'https://openrouter.ai/api/v1/';
  }
}
