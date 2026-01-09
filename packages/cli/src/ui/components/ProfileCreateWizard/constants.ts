/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ProviderOption, AdvancedParams } from './types.js';

export const PROVIDER_OPTIONS: ProviderOption[] = [
  {
    value: 'anthropic',
    label: 'Anthropic',
    needsBaseUrl: false,
    supportsOAuth: true,
    knownModels: [
      'claude-sonnet-4-5-20250929',
      'claude-haiku-4-5-20251001',
      'claude-opus-4-5-20251101',
    ],
  },
  {
    value: 'gemini',
    label: 'Google Gemini',
    needsBaseUrl: false,
    supportsOAuth: true,
    knownModels: [
      'gemini-2.5-flash',
      'gemini-2.5-flash-lite',
      'gemini-2.5-pro',
    ],
  },
  {
    value: 'openai',
    label: 'OpenAI',
    needsBaseUrl: false,
    supportsOAuth: false,
    knownModels: ['gpt-5', 'gpt-5-mini', 'gpt-5-nano', 'gpt-5-thinking'],
  },
  {
    value: 'openai-responses',
    label: 'OpenAI Responses API',
    needsBaseUrl: true,
    defaultBaseUrl: 'https://api.openai.com/v1',
    supportsOAuth: false,
    knownModels: ['o3-mini', 'o1', 'o1-mini', 'o1-preview'],
  },
  {
    value: 'openaivercel',
    label: 'OpenAI (Vercel AI SDK)',
    needsBaseUrl: true,
    defaultBaseUrl: 'https://api.openai.com/v1',
    supportsOAuth: false,
  },
  {
    value: 'qwen',
    label: 'Qwen',
    needsBaseUrl: false,
    supportsOAuth: true,
    knownModels: ['qwen3-coder-pro', 'qwen3-coder'],
  },
  {
    value: 'deepseek',
    label: 'DeepSeek',
    needsBaseUrl: false,
    supportsOAuth: false,
  },
  {
    value: 'cerebras',
    label: 'Cerebras',
    needsBaseUrl: false,
    supportsOAuth: false,
    knownModels: ['qwen-3-coder-480b', 'zai-glm-4.7', 'llama-3.3-70b'],
  },
  {
    value: 'codex',
    label: 'Codex',
    needsBaseUrl: true,
    defaultBaseUrl: 'https://chatgpt.com/backend-api/codex',
    supportsOAuth: true,
  },
  {
    value: 'kimi',
    label: 'Kimi',
    needsBaseUrl: true,
    defaultBaseUrl: 'https://api.kimi.com/coding/v1',
    supportsOAuth: false,
  },
  {
    value: 'mistral',
    label: 'Mistral',
    needsBaseUrl: true,
    defaultBaseUrl: 'https://api.mistral.ai/v1',
    supportsOAuth: false,
  },
  {
    value: 'xAI',
    label: 'xAI',
    needsBaseUrl: true,
    defaultBaseUrl: 'https://api.x.ai/v1/',
    supportsOAuth: false,
  },
  {
    value: 'Synthetic',
    label: 'Synthetic',
    needsBaseUrl: true,
    defaultBaseUrl: 'https://api.synthetic.new/openai/v1',
    supportsOAuth: false,
  },
  {
    value: 'qwenvercel',
    label: 'Qwen Vercel',
    needsBaseUrl: true,
    defaultBaseUrl: 'https://portal.qwen.ai/v1',
    supportsOAuth: true,
  },
  {
    value: 'Fireworks',
    label: 'Fireworks',
    needsBaseUrl: true,
    defaultBaseUrl: 'https://api.fireworks.ai/inference/v1/',
    supportsOAuth: false,
  },
  {
    value: 'OpenRouter',
    label: 'OpenRouter',
    needsBaseUrl: true,
    defaultBaseUrl: 'https://openrouter.ai/api/v1/',
    supportsOAuth: false,
  },
  {
    value: 'Cerebras Code',
    label: 'Cerebras Code',
    needsBaseUrl: true,
    defaultBaseUrl: 'https://api.cerebras.ai/v1/',
    supportsOAuth: false,
  },
  {
    value: 'Chutes.ai',
    label: 'Chutes.ai',
    needsBaseUrl: true,
    defaultBaseUrl: 'https://llm.chutes.ai/v1/',
    supportsOAuth: false,
  },
  {
    value: 'LM Studio',
    label: 'LM Studio (local)',
    needsBaseUrl: true,
    defaultBaseUrl: 'http://localhost:1234/v1',
    supportsOAuth: false,
  },
  {
    value: 'llama.cpp',
    label: 'Llama.cpp (local)',
    needsBaseUrl: true,
    defaultBaseUrl: 'http://localhost:8080/v1',
    supportsOAuth: false,
  },
  {
    value: 'custom',
    label: 'Custom OpenAI-compatible endpoint',
    needsBaseUrl: true,
    supportsOAuth: false,
  },
];

export const PARAMETER_DEFAULTS: Record<string, AdvancedParams> = {
  anthropic: {
    temperature: 0.7,
    maxTokens: 4096,
    contextLimit: 200000,
  },
  openai: {
    temperature: 0.7,
    maxTokens: 4096,
    contextLimit: 200000,
  },
  'openai-responses': {
    temperature: 0.7,
    maxTokens: 4096,
    contextLimit: 200000,
  },
  openaivercel: {
    temperature: 0.7,
    maxTokens: 4096,
    contextLimit: 200000,
  },
  gemini: {
    temperature: 0.7,
    maxTokens: 4096,
    contextLimit: 200000,
  },
  cerebras: {
    temperature: 1.0,
    maxTokens: 10000,
    contextLimit: 121000,
  },
  qwen: {
    temperature: 0.7,
    maxTokens: 4096,
    contextLimit: 200000,
  },
  deepseek: {
    temperature: 0.7,
    maxTokens: 4096,
    contextLimit: 200000,
  },
  codex: {
    temperature: 0.7,
    maxTokens: 4096,
    contextLimit: 262144,
  },
  kimi: {
    temperature: 0.7,
    maxTokens: 32768,
    contextLimit: 262144,
  },
  mistral: {
    temperature: 0.7,
    maxTokens: 4096,
    contextLimit: 200000,
  },
  xAI: {
    temperature: 0.7,
    maxTokens: 4096,
    contextLimit: 200000,
  },
  Synthetic: {
    temperature: 0.7,
    maxTokens: 4096,
    contextLimit: 200000,
  },
  qwenvercel: {
    temperature: 0.7,
    maxTokens: 50000,
    contextLimit: 200000,
  },
  Fireworks: {
    temperature: 0.7,
    maxTokens: 4096,
    contextLimit: 200000,
  },
  OpenRouter: {
    temperature: 0.7,
    maxTokens: 4096,
    contextLimit: 200000,
  },
  'Cerebras Code': {
    temperature: 0.7,
    maxTokens: 4096,
    contextLimit: 200000,
  },
  'Chutes.ai': {
    temperature: 0.7,
    maxTokens: 4096,
    contextLimit: 200000,
  },
  'LM Studio': {
    temperature: 0.7,
    maxTokens: 2048,
    contextLimit: 32000,
  },
  'llama.cpp': {
    temperature: 0.7,
    maxTokens: 2048,
    contextLimit: 32000,
  },
  default: {
    temperature: 0.7,
    maxTokens: 4096,
    contextLimit: 200000,
  },
};

export const CONNECTION_TEST_TIMEOUT_MS = 30000;
