/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Bun test preload for the CLI workspace.
 *
 * This module replicates the essential setup from test-setup.ts (which is
 * designed for Vitest) but avoids vi.mock('ink') because under Bun that
 * triggers mock.module('ink') which causes Bun to validate named exports
 * against the real Ink ESM build (which fails on re-exports like Range /
 * Selection). Instead, the Bun plugin below redirects 'ink' imports to the
 * stub at the resolution phase, so the real module is never loaded.
 */

import { JSDOM } from 'jsdom';
import { join } from 'node:path';
import React from 'react';
import { mock, afterEach } from 'bun:test';
import {
  clearActiveProviderRuntimeContext,
  DebugLogger,
} from '@vybestack/llxprt-code-core';

// ---------------------------------------------------------------------------
// JSDOM globals for React DOM components
// ---------------------------------------------------------------------------
const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  resources: 'usable',
  runScripts: 'dangerously',
  url: 'http://localhost/',
});

Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  navigator: dom.window.navigator,
  HTMLElement: dom.window.HTMLElement,
  Node: dom.window.Node,
  Event: dom.window.Event,
  CustomEvent: dom.window.CustomEvent,
  MutationObserver: dom.window.MutationObserver,
  getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
});

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
if (process.env.NO_COLOR !== undefined) {
  delete process.env.NO_COLOR;
}

// ---------------------------------------------------------------------------
// Ink / ink-testing-library redirect via Bun plugin (replaces vi.mock('ink'))
// ---------------------------------------------------------------------------
const inkStubPath = join(import.meta.dir, 'test-utils', 'ink-stub.ts');
const inkTestingLibraryStubPath = join(
  import.meta.dir,
  'test-utils',
  'ink-testing-library.ts',
);

Bun.plugin({
  name: 'cli-test-module-redirect',
  setup(build) {
    build.onResolve({ filter: /^ink$/ }, () => ({
      path: inkStubPath,
    }));
    build.onResolve({ filter: /^ink-testing-library$/ }, () => ({
      path: inkTestingLibraryStubPath,
    }));
  },
});

// ---------------------------------------------------------------------------
// Provider aliases mock (prevents "Provider not found" in fs-mocked tests)
// ---------------------------------------------------------------------------
mock.module(
  '@vybestack/llxprt-code-providers/composition/providerAliases.js',
  () => ({
    loadProviderAliasEntries: () => [
      {
        alias: 'gemini',
        config: {
          name: 'gemini',
          modelsDevProviderId: 'google',
          baseProvider: 'gemini',
          'base-url': 'https://generativelanguage.googleapis.com/v1beta',
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
          'base-url': 'https://api.openai.com/v1',
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
          'base-url': 'https://api.anthropic.com/v1',
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
          'base-url': 'https://api.kimi.com/coding/v1',
          defaultModel: 'kimi-for-coding',
          description: 'Kimi For Coding OpenAI-compatible endpoint',
          ephemeralSettings: {
            'context-limit': 262144,
            max_tokens: 32768,
            'user-agent': 'RooCode/1.0',
          },
          modelDefaults: [
            {
              pattern: 'kimi.*',
              ephemeralSettings: {
                'reasoning.effort': 'medium',
                'reasoning.enabled': true,
                'reasoning.includeInResponse': true,
                'reasoning.includeInContext': true,
                'reasoning.stripFromContext': 'none',
              },
            },
          ],
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
          'base-url': 'https://api.openai.com/v1',
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
          'base-url': 'https://chatgpt.com/backend-api/codex',
          defaultModel: 'gpt-5.2',
          description: 'OpenAI Codex (ChatGPT backend with OAuth)',
          ephemeralSettings: {
            'context-limit': 262144,
          },
        },
        filePath: '/mock/aliases/codex.config',
        source: 'builtin',
      },
      {
        alias: 'deepseek',
        config: {
          name: 'deepseek',
          modelsDevProviderId: 'deepseek',
          baseProvider: 'openai',
          'base-url': 'https://api.deepseek.com/v1',
          defaultModel: 'deepseek-chat',
          description: 'DeepSeek OpenAI-compatible endpoint',
          apiKeyEnv: 'DEEPSEEK_API_KEY',
        },
        filePath: '/mock/aliases/deepseek.config',
        source: 'builtin',
      },
    ],
    getUserAliasDir: () => '/mock/home/.llxprt/providers',
    getAliasFilePath: (alias: string) =>
      `/mock/home/.llxprt/providers/${alias}.config`,
    writeProviderAliasConfig: () => {},
  }),
);

// ---------------------------------------------------------------------------
// React shared internals initialization (React 19 fix)
// ---------------------------------------------------------------------------
type ReactSharedInternals = {
  S?: unknown;
  T?: unknown;
  H?: unknown;
};

type ReactWithSharedInternals = typeof React & {
  _DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE?: ReactSharedInternals;
  __SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED?: ReactSharedInternals;
};

type GlobalWithReactInternals = typeof globalThis & {
  React?: typeof React;
  ReactSharedInternals?: ReactSharedInternals;
};

const globalWithReact = globalThis as GlobalWithReactInternals;
globalWithReact.React = React;

const reactWithInternals = React as ReactWithSharedInternals;
const ReactInternals =
  reactWithInternals._DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE ??
  reactWithInternals.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED;
if (ReactInternals) {
  if (!Object.prototype.hasOwnProperty.call(ReactInternals, 'S')) {
    ReactInternals.S = null;
  }
  if (!Object.prototype.hasOwnProperty.call(ReactInternals, 'T')) {
    ReactInternals.T = null;
  }
  if (!Object.prototype.hasOwnProperty.call(ReactInternals, 'H')) {
    ReactInternals.H = null;
  }
  globalWithReact.ReactSharedInternals = ReactInternals;
}

// ---------------------------------------------------------------------------
// Storage isolation
// ---------------------------------------------------------------------------
await import('./test-setup-storage-isolation.js');

// ---------------------------------------------------------------------------
// Custom matchers
// ---------------------------------------------------------------------------
await import('./src/test-utils/customMatchers.js');

// ---------------------------------------------------------------------------
// afterEach cleanup (mirrors test-setup.ts)
// ---------------------------------------------------------------------------
const { __resetCleanupStateForTesting } = await import(
  './src/utils/cleanup.js'
);

const managedProcessEvents = [
  'exit',
  'SIGINT',
  'SIGTERM',
  'warning',
  'unhandledRejection',
] as const;

type ManagedProcessEvent = (typeof managedProcessEvents)[number];
type ProcessListener = (...args: unknown[]) => void;

const baselineProcessListeners = new Map<
  ManagedProcessEvent,
  ProcessListener[]
>(
  managedProcessEvents.map((eventName) => [
    eventName,
    process.listeners(eventName) as ProcessListener[],
  ]),
);

function restoreProcessListeners(eventName: ManagedProcessEvent): void {
  const baseline = baselineProcessListeners.get(eventName) ?? [];
  const current = process.listeners(eventName) as ProcessListener[];
  const baselineCounts = new Map<ProcessListener, number>();

  for (const listener of baseline) {
    baselineCounts.set(listener, (baselineCounts.get(listener) ?? 0) + 1);
  }

  for (const listener of current) {
    const remaining = baselineCounts.get(listener) ?? 0;
    if (remaining > 0) {
      baselineCounts.set(listener, remaining - 1);
      continue;
    }
    process.removeListener(eventName, listener);
  }
}

afterEach(async () => {
  for (const eventName of managedProcessEvents) {
    restoreProcessListeners(eventName);
  }
  await DebugLogger.resetForTesting();
  __resetCleanupStateForTesting();
  clearActiveProviderRuntimeContext();
});
