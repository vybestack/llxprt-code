/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { fromConfig } from '../fromConfig.js';
import type { LlxprtExtension } from '@vybestack/llxprt-code-core';
import { buildCliStyleConfig } from './helpers/buildCliStyleConfig.js';

async function addExtension(loader: {
  load(extension: LlxprtExtension): Promise<void>;
}): Promise<void> {
  await loader.load({
    name: 'caller-extension',
    version: '1.0.0',
    path: process.cwd(),
    isActive: true,
    contextFiles: [],
  });
}

describe('MCP extension lifetime ownership', () => {
  it('keeps caller extensions and catalog alive when an adopted Agent is disposed', async () => {
    const built = await buildCliStyleConfig('plain-text.jsonl');
    const loader = built.mcpRuntime.extensionOperations;
    await addExtension(loader);
    const catalog = built.mcpRuntime.toolSelection;

    const agent = await fromConfig({
      settingsOwner: built.settingsOwner,
      settingsService: built.settingsService,
      agentClient: built.agentClient,
      providerManager: built.providerManager,
      config: built.config,
      mcpRuntime: built.mcpRuntime,
    });
    try {
      await agent.dispose();
      expect(loader.list().map((extension) => extension.name)).toContain(
        'caller-extension',
      );
      expect(new Set([built.mcpRuntime.toolSelection, catalog]).size).toBe(1);
      expect(built.mcpRuntime.isStopped()).toBe(false);
      expect(agent.getMessageBus()).toBe(built.messageBus);
      await loader.unload(loader.list()[0]);
      expect(loader.list()).toHaveLength(0);
    } finally {
      await agent.dispose();
      await built.config.dispose();
      await built.cleanup();
    }
  }, 30000);

  for (const reverse of [false, true]) {
    it(`preserves an exact borrowed workspace after both facade orders (${reverse})`, async () => {
      const built = await buildCliStyleConfig('plain-text.jsonl');
      const options = {
        settingsService: built.settingsService,
        config: built.config,
        providerManager: built.providerManager,
        agentClient: built.agentClient,
        mcpRuntime: built.mcpRuntime,
      };
      const first = await fromConfig(options);
      const second = await fromConfig(options);
      const facades = reverse ? [second, first] : [first, second];
      const operations = built.mcpRuntime.extensionOperations;
      try {
        expect('getExtensionLoader' in built.config).toBe(false);
        for (const facade of facades) {
          await facade.dispose();
          await addExtension(operations);
          expect(operations.list()).toHaveLength(1);
          expect(built.config.getExtensions()).toHaveLength(0);
          await operations.unload(operations.list()[0]);
          expect(built.mcpRuntime.isStopped()).toBe(false);
        }
      } finally {
        await first.dispose();
        await second.dispose();
        await built.cleanup();
      }
    }, 30000);
  }
});
