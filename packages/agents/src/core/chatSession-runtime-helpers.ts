import type { AgentRuntimeContext } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeContext.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { ContentGenerator } from '@vybestack/llxprt-code-core/core/contentGenerator.js';
import { ChatSession } from './chatSession.js';
import type { ProviderInvocationData } from '@vybestack/llxprt-code-core/runtime/providerRequestContext.js';
import type { ProviderRuntimeContext } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Shared helpers for ChatSession runtime test files. Extracted from the
 * original monolithic chatSession.runtime.test.ts so no file-level
 * max-lines disable is needed.
 */

import type { ConfigParameters } from '@vybestack/llxprt-code-core/config/config.js';
import type { SettingsService } from '@vybestack/llxprt-code-settings';

export function createConfigParams(
  settingsService: SettingsService,
): ConfigParameters {
  return {
    cwd: '/tmp',
    targetDir: '/tmp/project',
    debugMode: false,
    question: undefined,

    userMemory: '',
    embeddingModel: 'gemini-embedding',
    sandbox: undefined,
    sessionId: 'test-session',
    model: 'gemini-1.5-pro',
    initialSettings: settingsService.getAllGlobalSettings(),
  };
}

export function invocationData(
  runtime: ProviderRuntimeContext,
  name: string,
  settingsService: SettingsService,
): ProviderInvocationData {
  return {
    runtimeId: runtime.runtimeId,
    metadata: runtime.metadata,
    globalSettings: settingsService.getAllGlobalSettings(),
    providerSettings: settingsService.getProviderSettings(name),
  };
}

export function configureHistoryProviderSettings(
  settingsService: SettingsService,
): void {
  settingsService.set('providers.stub.base-url', 'https://stub.example.com');
  settingsService.set('providers.stub.auth-key', 'stub-api-key');
  settingsService.set('providers.stub.model', 'stub-model');
}

export function createHistoryChat(
  view: AgentRuntimeContext,
  config: Config,
): ChatSession {
  return new ChatSession(
    view,
    config,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    {} as unknown as ContentGenerator,
  );
}
