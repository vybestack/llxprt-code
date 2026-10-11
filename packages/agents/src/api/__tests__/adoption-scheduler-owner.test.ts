/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { fromConfig } from '../index.js';
import { buildFactoryLessConfig } from './helpers/buildCliStyleConfig.js';
import { drain, countType } from './helpers/agentHarness.js';

describe('adopted Agent scheduler ownership', () => {
  it('executes a real tool with Agent-owned scheduler defaults for a factoryless Config', async () => {
    const built = await buildFactoryLessConfig('tool-call-then-answer.jsonl');
    const agent = await fromConfig({
      settingsOwner: built.settingsOwner,
      settingsService: built.settingsService,
      agentClient: built.agentClient,
      providerManager: built.providerManager,
      runtimeFactoryBindings: built.runtimeFactoryBindings,
      config: built.config,
    });
    try {
      const events = await drain(agent.stream('read package metadata'));
      expect(countType(events, 'tool-result')).toBeGreaterThan(0);
      expect(countType(events, 'done')).toBe(1);
      expect(agent.tools.list().some((tool) => tool.name === 'read_file')).toBe(
        true,
      );
    } finally {
      await agent.dispose();
      await built.cleanup();
    }
  });

  it('retains and disposes only the injected scheduler handles created for this adopted Agent', async () => {
    const built = await buildFactoryLessConfig('tool-call-then-answer.jsonl');
    let activeHandles = 0;
    let createdHandles = 0;
    const agent = await fromConfig({
      settingsOwner: built.settingsOwner,
      settingsService: built.settingsService,
      agentClient: built.agentClient,
      providerManager: built.providerManager,
      runtimeFactoryBindings: built.runtimeFactoryBindings,
      config: built.config,
      toolSchedulerFactory: () => {
        activeHandles += 1;
        createdHandles += 1;
        return {
          dispose: () => {
            activeHandles -= 1;
          },
        };
      },
    });
    try {
      const events = await drain(agent.stream('read package metadata'));
      expect(countType(events, 'tool-result')).toBeGreaterThan(0);
      expect(createdHandles).toBeGreaterThan(0);
      expect(activeHandles).toBe(createdHandles);
      await agent.dispose();
      expect(activeHandles).toBe(0);
    } finally {
      await agent.dispose();
      await built.cleanup();
    }
  });
});
