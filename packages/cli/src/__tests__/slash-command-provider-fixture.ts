/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { Config } from '@vybestack/llxprt-code-core';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { PLACEHOLDER_MODEL } from '@vybestack/llxprt-code-agents/constants.js';
import {
  OpenAIProvider,
  ProviderManager,
} from '@vybestack/llxprt-code-providers';
import { configureProviderRuntimeFactories } from '@vybestack/llxprt-code-providers/composition.js';

export function createSlashCommandProviderFixture(sessionId: string): {
  config: Config;
  manager: ProviderManager;
  settingsService: SettingsService;
  settingsOwner: SessionSettingsOwner;
} {
  const settingsService = new SettingsService();
  const config = new Config({
    cwd: process.cwd(),
    targetDir: process.cwd(),
    debugMode: false,
    sessionId,
    model: PLACEHOLDER_MODEL,
    provider: 'openai',
  });
  const settingsOwner = new SessionSettingsOwner(settingsService);
  settingsOwner.bindTelemetry(config);
  settingsOwner.initializeProviderSelection('openai', PLACEHOLDER_MODEL);
  const manager = new ProviderManager(
    undefined,
    undefined,
    undefined,
    undefined,
    settingsService,
    config,
  );
  manager.registerProvider(new OpenAIProvider(undefined));
  manager.setActiveProvider('openai');
  configureProviderRuntimeFactories(config, manager);
  return { config, manager, settingsOwner, settingsService };
}
