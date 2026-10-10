/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, describe, expect, it } from 'bun:test';
import { installTestWorkspaceFilesystem } from '@vybestack/llxprt-code-test-utils/core/config.js';
import { fromConfig } from '@vybestack/llxprt-code-agents';
import { listProviders } from '@vybestack/llxprt-code-providers/runtime.js';
import { readActiveProviderName } from '@vybestack/llxprt-code-providers/runtime/providerReadOperations.js';
import { createRuntimeApi } from '../../ui/contexts/RuntimeContext.js';
import { createRuntimeOwnerFeatures } from '../createRuntimeOwnerFeatures.js';
import { createSessionModelCommand } from '../session-model-command.js';
import { buildCliStyleConfig } from '../../../../agents/src/api/__tests__/helpers/buildCliStyleConfig.js';

const makeFilesystem = installTestWorkspaceFilesystem();
let filesystem: ReturnType<typeof makeFilesystem> | undefined;
function fixturePaths() {
  filesystem ??= makeFilesystem({
    targetDir: process.cwd(),
    isTrusted: () => true,
  });
  return filesystem.paths;
}

describe('CLI retained session model commands', () => {
  afterEach(() => {
    filesystem = undefined;
  });
  it('keeps retained model and credential operations bound to their Agent owners', async () => {
    const first = await buildCliStyleConfig('multi-turn-text.jsonl');
    const second = await buildCliStyleConfig('multi-turn-text.jsonl');
    const agentA = await fromConfig({
      settingsService: first.settingsService,
      settingsOwner: first.settingsOwner,
      providerManager: first.providerManager,
      config: first.config,
      messageBus: first.messageBus,
      mcpRuntime: first.mcpRuntime,
      sessionId: 'shared-isolation-label',
    });
    const agentB = await fromConfig({
      settingsService: second.settingsService,
      settingsOwner: second.settingsOwner,
      providerManager: second.providerManager,
      config: second.config,
      messageBus: second.messageBus,
      mcpRuntime: second.mcpRuntime,
      sessionId: 'shared-isolation-label',
    });
    try {
      expect(() => Reflect.apply(listProviders, undefined, [])).toThrow(
        'Provider listing requires an explicit owner',
      );
      expect(first.providerManager).not.toBe(second.providerManager);
      const firstApi = createRuntimeApi(
        agentA,
        createRuntimeOwnerFeatures(
          first.config,
          agentA.providerManager,
          fixturePaths().directories,
          createSessionModelCommand(agentA),
          first.settingsOwner,
          first.settingsService,
          agentA.workspace,
        ),
      );
      const secondApi = createRuntimeApi(
        agentB,
        createRuntimeOwnerFeatures(
          second.config,
          agentB.providerManager,
          fixturePaths().directories,
          createSessionModelCommand(agentB),
          second.settingsOwner,
          second.settingsService,
          agentB.workspace,
        ),
      );
      expect(
        readActiveProviderName(first.settingsService, first.providerManager),
      ).toBe(firstApi.getActiveProviderName());
      expect([
        firstApi.getActiveProviderName(),
        secondApi.getActiveProviderName(),
      ]).toStrictEqual([agentA.getProvider(), agentB.getProvider()]);
      second.settingsService.set('activeProvider', 'second-owner');
      expect(secondApi.getActiveProviderName()).toBe('second-owner');
      expect(firstApi.getActiveProviderName()).toBe(agentA.getProvider());
      expect(agentB.getProvider()).toBe('fake');
      second.settingsService.set('activeProvider', agentB.getProvider());
      await Promise.all([
        firstApi.setActiveModel('first-selected'),
        secondApi.setActiveModel('second-selected'),
      ]);
      firstApi.setActiveModelParam('temperature', 0.2);
      secondApi.setActiveModelParam('temperature', 0.8);
      await Promise.all([
        firstApi.updateActiveProviderApiKey('first-key'),
        secondApi.updateActiveProviderApiKey('second-key'),
      ]);
      expect(agentA.getModel()).toBe('first-selected');
      expect(agentB.getModel()).toBe('second-selected');
      expect(firstApi.getActiveModelParams().temperature).toBe(0.2);
      expect(secondApi.getActiveModelParams().temperature).toBe(0.8);
      expect(first.settingsOwner.readNamedParameter('auth-key')).toBe(
        'first-key',
      );
      expect(second.settingsOwner.readNamedParameter('auth-key')).toBe(
        'second-key',
      );
      firstApi.clearActiveModelParam('temperature');
      await firstApi.updateActiveProviderApiKey(null);
      expect(firstApi.getActiveModelParams()).not.toHaveProperty('temperature');
      expect(secondApi.getActiveModelParams()).toStrictEqual({
        temperature: 0.8,
      });
      expect([
        first.settingsOwner.readNamedParameter('auth-key'),
        second.settingsOwner.readNamedParameter('auth-key'),
      ]).toStrictEqual([undefined, 'second-key']);
    } finally {
      await agentA.dispose();
      await agentB.dispose();
      await first.config.dispose();
      await second.config.dispose();
      await first.cleanup();
      await second.cleanup();
    }
  }, 30000);
});
