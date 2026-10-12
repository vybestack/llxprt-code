/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, describe, expect, it } from 'bun:test';
import { installTestWorkspaceFilesystem } from '@vybestack/llxprt-code-test-utils/core/config.js';
import {
  fromConfig,
  SessionProviderReads,
} from '@vybestack/llxprt-code-agents';
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
      expect(() => Reflect.construct(SessionProviderReads, [])).toThrow(
        'Provider reads require an explicit session owner',
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
          agentA.settings,
          agentA.toolFormat,
          agentA.providerReads,
        ),
        agentA.sessionClient.fetch,
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
          agentB.settings,
          agentB.toolFormat,
          agentB.providerReads,
        ),
        agentB.sessionClient.fetch,
      );
      expect(agentA.providerReads.readActiveProviderName()).toBe(
        firstApi.getActiveProviderName(),
      );
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
      agentA.settings.setEphemeralSetting('context-limit', 4096);
      agentB.settings.setEphemeralSetting('context-limit', 8192);
      agentA.settings.setSessionSetting('dumpcontext', 'on');
      agentB.settings.setSessionSetting('dumpcontext', 'error');
      agentA.settings.clearSessionSetting('dumpcontext');
      expect(agentA.settings.getSessionSetting('dumpcontext')).toBeUndefined();
      expect(agentB.settings.getSessionSetting('dumpcontext')).toBe('error');
      expect(firstApi.getEphemeralSetting('context-limit')).toBe(4096);
      expect(secondApi.getEphemeralSetting('context-limit')).toBe(8192);
      await agentA.toolFormat.setOverride('kimi');
      await agentB.toolFormat.setOverride('openai');
      expect((await firstApi.getActiveToolFormatState()).override).toBe('kimi');
      expect((await secondApi.getActiveToolFormatState()).override).toBe(
        'openai',
      );
      await firstApi.setActiveToolFormatOverride(null);
      expect((await agentA.toolFormat.getState()).isAutoDetected).toBe(true);
      expect((await agentB.toolFormat.getState()).override).toBe('openai');
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
