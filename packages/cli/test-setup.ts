/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// Set NODE_ENV to test if not already set
process.env.NODE_ENV = process.env.NODE_ENV || 'test';

// Unset NO_COLOR environment variable to ensure consistent theme behavior between local and CI test runs
if (process.env.NO_COLOR !== undefined) {
  delete process.env.NO_COLOR;
}

// Setup for React DOM testing - fix for React 19 internals issue
import React from 'react';
import { vi } from 'vitest';

// Mock provider aliases globally so tests don't need real config files
// This prevents "Provider not found" errors when fs is mocked
vi.mock('./src/providers/providerAliases.js', () => ({
  loadProviderAliasEntries: () => [
    {
      alias: 'gemini',
      config: {
        name: 'gemini',
        modelsDevProviderId: 'google',
        baseProvider: 'gemini',
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
        defaultModel: 'gemini-2.5-pro',
        apiKeyEnv: 'GEMINI_API_KEY',
      },
      filePath: '/mock/aliases/gemini.config',
      source: 'builtin',
    },
    {
      alias: 'openai',
      config: {
        name: 'openai',
        modelsDevProviderId: 'openai',
        baseProvider: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        defaultModel: 'gpt-4o',
        apiKeyEnv: 'OPENAI_API_KEY',
      },
      filePath: '/mock/aliases/openai.config',
      source: 'builtin',
    },
    {
      alias: 'anthropic',
      config: {
        name: 'anthropic',
        modelsDevProviderId: 'anthropic',
        baseProvider: 'anthropic',
        baseUrl: 'https://api.anthropic.com/v1',
        defaultModel: 'claude-sonnet-4-20250514',
        apiKeyEnv: 'ANTHROPIC_API_KEY',
      },
      filePath: '/mock/aliases/anthropic.config',
      source: 'builtin',
    },
    {
      alias: 'kimi',
      config: {
        name: 'kimi',
        modelsDevProviderId: 'kimi-for-coding',
        baseProvider: 'openai',
        baseUrl: 'https://api.kimi.com/coding/v1',
        defaultModel: 'kimi-for-coding',
        description: 'Kimi For Coding OpenAI-compatible endpoint',
        ephemeralSettings: {
          'context-limit': 262144,
          max_tokens: 32768,
          'reasoning.effort': 'medium',
          'reasoning.enabled': true,
          'reasoning.includeInResponse': true,
          'reasoning.includeInContext': true,
          'reasoning.stripFromContext': 'none',
          'user-agent': 'RooCode/1.0',
        },
      },
      filePath: '/mock/aliases/kimi.config',
      source: 'builtin',
    },
    {
      alias: 'openai-responses',
      config: {
        name: 'openai-responses',
        modelsDevProviderId: 'openai',
        baseProvider: 'openai-responses',
        baseUrl: 'https://api.openai.com/v1',
        defaultModel: 'gpt-4o',
        apiKeyEnv: 'OPENAI_API_KEY',
      },
      filePath: '/mock/aliases/openai-responses.config',
      source: 'builtin',
    },
    {
      alias: 'codex',
      config: {
        name: 'codex',
        modelsDevProviderId: 'openai',
        baseProvider: 'openai-responses',
        baseUrl: 'https://chatgpt.com/backend-api/codex',
        defaultModel: 'gpt-5.2',
        description: 'OpenAI Codex (ChatGPT backend with OAuth)',
        ephemeralSettings: {
          'context-limit': 262144,
        },
      },
      filePath: '/mock/aliases/codex.config',
      source: 'builtin',
    },
  ],
  getUserAliasDir: () => '/mock/home/.llxprt/providers',
  getAliasFilePath: (alias: string) =>
    `/mock/home/.llxprt/providers/${alias}.config`,
  writeProviderAliasConfig: vi.fn(),
}));

vi.mock('ink', () => import('./test-utils/ink-stub.ts'), {
  virtual: true,
});

// The issue is that React DOM is trying to access ReactSharedInternals.S
// but ReactSharedInternals might be undefined or missing the S property.
// We need to ensure React's shared internals are properly initialized.

// First, ensure React is available globally
if (typeof globalThis !== 'undefined') {
  // @ts-expect-error - Necessary for React DOM compatibility in tests
  globalThis.React = React;
}

// Access and initialize React's shared internals
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ReactInternals = (React as any)
  .__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED;
if (ReactInternals) {
  // Ensure the S property exists (used by React DOM for transition handling)
  if (!Object.prototype.hasOwnProperty.call(ReactInternals, 'S')) {
    ReactInternals.S = null;
  }
  // Ensure other properties that might be missing
  if (!Object.prototype.hasOwnProperty.call(ReactInternals, 'T')) {
    ReactInternals.T = null;
  }
  if (!Object.prototype.hasOwnProperty.call(ReactInternals, 'H')) {
    ReactInternals.H = null;
  }

  // Make sure ReactSharedInternals is available globally as React DOM expects it
  if (typeof globalThis !== 'undefined') {
    // @ts-expect-error - ReactSharedInternals global assignment for React DOM compatibility
    globalThis.ReactSharedInternals = ReactInternals;
  }
}

import './src/test-utils/customMatchers.js';
