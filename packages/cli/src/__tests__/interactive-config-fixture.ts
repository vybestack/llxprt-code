/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { Config } from '@vybestack/llxprt-code-core';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import {
  ProviderManager,
  type IProvider,
} from '@vybestack/llxprt-code-providers';
import { configureProviderTokenizer } from '@vybestack/llxprt-code-providers/composition.js';
export function createInteractiveConfigFactory(configs: Config[]) {
  return function makeInteractiveConfig(
    directory: string,
    sessionId: string,
  ): { config: Config; manager: ProviderManager } {
    const config = new Config({
      sessionId,
      targetDir: directory,
      cwd: directory,
      model: 'cli-interactive-model',
      provider: 'fake',
      interactive: true,
      debugMode: false,
    });
    const manager = new ProviderManager(
      undefined,
      undefined,
      undefined,
      undefined,
      new SettingsService(),
      config,
    );
    const provider: IProvider = {
      name: 'fake',
      getDefaultModel: () => 'cli-interactive-model',
      getModels: async () => [],
      async *generateChatCompletion() {
        yield { speaker: 'ai', blocks: [{ type: 'text', text: 'ready' }] };
      },
    };
    manager.registerProvider(provider);
    manager.setActiveProvider('fake');
    configureProviderTokenizer(manager);
    configs.push(config);
    return { config, manager };
  };
}
