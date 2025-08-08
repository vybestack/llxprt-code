/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { OpenAIProvider } from '../openai/OpenAIProvider.js';
import { IProvider } from '../IProvider.js';

export class GroqProvider extends OpenAIProvider implements IProvider {
  name: string;
  displayName: string;
  baseUrl: string;

  constructor(config: any) {
    super(config);
    this.name = 'groq';
    this.displayName = 'Groq';
    this.baseUrl = 'https://api.groq.com/openai/v1';
  }
}
