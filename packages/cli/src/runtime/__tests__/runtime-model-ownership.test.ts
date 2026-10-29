/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { beforeAll, afterAll, describe, expect, it, afterEach } from 'bun:test';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { initializePromptSystem } from '@vybestack/llxprt-code-core/core/prompts.js';
import { installTestWorkspaceFilesystem } from '@vybestack/llxprt-code-test-utils/core/config.js';
import { ProviderReadFixture } from '../../../../agents/src/api/__tests__/helpers/provider-read-fixture.js';
import { useOwnedCredentials } from '../../../../agents/src/api/__tests__/helpers/owned-credential-fixture.js';
import { useFakeResponsesReplay } from '../../../../agents/src/api/__tests__/helpers/fake-responses-replay.js';
import { openRouteAAgent } from '../../../../agents/src/api/__tests__/helpers/route-a-agent.js';
import { runCleanupSteps } from '../../../../agents/src/core/subagent-cleanup.js';
import { createRuntimeApi } from '../../__tests__/runtime-context-fixture.js';
import { createRuntimeOwnerFeatures } from '../../__tests__/runtime-owner-features-fixture.js';
import { createSessionModelCommand } from '../session-model-command.js';

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
  let promptDirectory: string;
  const previousPrompts = process.env.LLXPRT_PROMPTS_DIR;
  beforeAll(async () => {
    promptDirectory = await mkdtemp(join(tmpdir(), 'engine-prompts-'));
    process.env.LLXPRT_PROMPTS_DIR = promptDirectory;
    await initializePromptSystem();
  });
  afterAll(async () => {
    if (previousPrompts === undefined) delete process.env.LLXPRT_PROMPTS_DIR;
    else process.env.LLXPRT_PROMPTS_DIR = previousPrompts;
    await rm(promptDirectory, { recursive: true, force: true });
  });

  useFakeResponsesReplay('multi-turn-text.jsonl');
  const firstCredentials = useOwnedCredentials();
  const secondCredentials = useOwnedCredentials();

  const openRoot = (authority: ReturnType<typeof firstCredentials>) =>
    openRouteAAgent({
      authority: authority.authority,
      config: { interactive: true, includeDirectories: [process.cwd()] },
      intent: {
        sessionId: 'shared-isolation-label',
        activation: { provider: 'fake', model: 'fake-model' },
      },
    });

  afterEach(() => {
    filesystem = undefined;
  });
  it('keeps retained model and credential operations bound to their Agent owners', async () => {
    const first = await openRoot(firstCredentials());
    const second = await openRoot(secondCredentials());
    const firstFeatureSettings = new SessionSettingsOwner(first.settings);
    const secondFeatureSettings = new SessionSettingsOwner(second.settings);
    const agentA = first.agent;
    const agentB = second.agent;
    try {
      expect(() => Reflect.construct(ProviderReadFixture, [])).toThrow(
        'Provider reads require an explicit session owner',
      );
      const firstApi = createRuntimeApi(
        agentA,
        createRuntimeOwnerFeatures(
          agentA.providerReads.inspection,
          fixturePaths().directories,
          createSessionModelCommand(agentA),
          firstFeatureSettings,
          agentA.workspace,
          agentA.modelParameters,
          agentA.settings,
          agentA.toolFormat,
          agentA.providerReads,
          agentA.auth.keys,
          () => agentA.providerReads.readOpenAIInfo(),
        ),
        agentA.sessionClient.fetch,
      );
      const secondApi = createRuntimeApi(
        agentB,
        createRuntimeOwnerFeatures(
          agentB.providerReads.inspection,
          fixturePaths().directories,
          createSessionModelCommand(agentB),
          secondFeatureSettings,
          agentB.workspace,
          agentB.modelParameters,
          agentB.settings,
          agentB.toolFormat,
          agentB.providerReads,
          agentB.auth.keys,
          () => agentB.providerReads.readOpenAIInfo(),
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
      second.settings.set('activeProvider', 'second-owner');
      expect(secondApi.getActiveProviderName()).toBe('second-owner');
      expect(firstApi.getActiveProviderName()).toBe(agentA.getProvider());
      expect(agentB.getProvider()).toBe('fake');
      second.settings.set('activeProvider', agentB.getProvider());
      await Promise.all([
        firstApi.setActiveModel('first-selected'),
        secondApi.setActiveModel('second-selected'),
      ]);
      firstApi.setActiveModelParam('temperature', 0.2);
      secondApi.setActiveModelParam('temperature', 0.8);
      expect(agentA.getModelParams().temperature).toBe(0.2);
      expect(agentB.getModelParams().temperature).toBe(0.8);
      const credentialResults = await Promise.all([
        firstApi.updateActiveProviderApiKey('first-key'),
        secondApi.updateActiveProviderApiKey('second-key'),
      ]);
      expect(credentialResults.map((result) => result.message)).toStrictEqual([
        "API key updated for provider 'fake'",
        "API key updated for provider 'fake'",
      ]);
      expect([agentA.auth.status(), agentB.auth.status()]).toStrictEqual([
        'authenticated',
        'authenticated',
      ]);
      expect(agentA.getModel()).toBe('first-selected');
      expect(agentB.getModel()).toBe('second-selected');
      expect(firstApi.getActiveModelParams().temperature).toBe(0.2);
      expect(secondApi.getActiveModelParams().temperature).toBe(0.8);
      expect(first.settings.get('auth-key')).toBe('first-key');
      expect(second.settings.get('auth-key')).toBe('second-key');
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
        first.settings.get('auth-key'),
        second.settings.get('auth-key'),
      ]).toStrictEqual([undefined, 'second-key']);
      expect([agentA.auth.status(), agentB.auth.status()]).toStrictEqual([
        'unauthenticated',
        'authenticated',
      ]);
      await agentA.dispose();
      await expect(
        firstApi.updateActiveProviderApiKey('retired-owner-key'),
      ).rejects.toThrow('Session settings owner is closed');
      await secondApi.updateActiveProviderApiKey('rotated-second-key');
      expect(second.settings.get('auth-key')).toBe('rotated-second-key');
    } finally {
      await runCleanupSteps([
        () => agentA.dispose(),
        () => agentB.dispose(),
        () => firstFeatureSettings.dispose(),
        () => secondFeatureSettings.dispose(),
        () => first.close(),
        () => second.close(),
      ]);
    }
  }, 30000);
});
