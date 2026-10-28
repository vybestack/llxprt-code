/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { SessionMediaOwner } from '@vybestack/llxprt-code-core/storage/session-media-owner.js';
import { useOwnedCredentials } from '../api/__tests__/helpers/owned-credential-fixture.js';
import { ProviderManager } from '@vybestack/llxprt-code-providers';
import {
  configureProviderTokenizer,
  createRuntimeContentGeneratorFactory,
} from '@vybestack/llxprt-code-providers/composition.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { loadAgentRuntime } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeLoader.js';
import { createAgentRuntimeState } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeState.js';
import { createSessionSettingsFixture } from '../api/__tests__/helpers/session-settings-fixture.js';
import { fixtureToolSelection } from './__tests__/subagentOrchestrator-test-helpers.js';
import { createSubagentProviderRuntime } from './subagentRuntimeSetup.js';
import { buildSubagentRuntimeLoaderOptions } from './subagent-runtime-loader.js';

async function closeLoaderFixture(
  directory: string,
  closers: ReadonlyArray<() => void | Promise<void>>,
): Promise<void> {
  const results = await Promise.allSettled(
    closers.map((close) => Promise.resolve().then(close)),
  );
  await rm(directory, { recursive: true, force: true });
  const failures = results.flatMap((result) =>
    result.status === 'rejected' ? [result.reason] : [],
  );
  if (failures.length > 0)
    throw new AggregateError(failures, 'Child loader fixture cleanup failed');
}

describe('explicit child runtime loader inputs', () => {
  const credentials = useOwnedCredentials();
  it('loads independent history while capturing live child invocation and policy settings', async () => {
    const settings = new SettingsService();
    settings.set('activeProvider', 'openai');
    settings.set('context-limit', 8192);
    const directory = await mkdtemp(join(tmpdir(), 'explicit-child-loader-'));
    const config = new Config({
      sessionId: 'explicit-child',
      model: 'child-model',
      targetDir: directory,
      cwd: directory,
      debugMode: false,
      initialSettings: settings.getAllGlobalSettings(),
    });
    const mediaOwner = new SessionMediaOwner(
      config.projectTempDir,
      config.getMediaStoreQuotaByteLimit(),
    );
    const { settingsOwner } = createSessionSettingsFixture(config, settings);
    const runtime = createSubagentProviderRuntime('explicit-child', 'research');
    const manager = new ProviderManager(
      undefined,
      undefined,
      undefined,
      undefined,
      settings,
      config,
      runtime,
      credentials().authority,
      settingsOwner,
    );
    const tokenizerFactory = configureProviderTokenizer(manager);
    const contentGeneratorFactory = createRuntimeContentGeneratorFactory();
    const state = createAgentRuntimeState({
      runtimeId: 'explicit-child',
      sessionId: 'child-session',
      provider: 'openai',
      model: 'child-model',
    });
    const signal = new AbortController().signal;
    const tools = fixtureToolSelection();
    const snapshot = { tools: { disabled: ['shell'] } };
    const options = buildSubagentRuntimeLoaderOptions(
      config,
      settingsOwner,
      mediaOwner.store,
      manager,
      tokenizerFactory,
      contentGeneratorFactory,
      tools,
      state,
      snapshot,
      runtime,
      { model: state.model },
      signal,
    );
    try {
      const first = await loadAgentRuntime(options);
      const second = await loadAgentRuntime(options);
      first.history.add({
        speaker: 'human',
        blocks: [{ type: 'text', text: 'Only the first child history' }],
      });
      expect(first.history.getCurated()).toHaveLength(1);
      expect(second.history.getCurated()).toHaveLength(0);
      expect(first.runtimeContext.state.sessionId).toBe('child-session');
      expect(first.toolRegistry).toBe(tools);
      expect(first.settingsSnapshot).toBe(snapshot);
      expect(first.telemetryRoot).toBe(settingsOwner.telemetry);
      expect(options.profile.readRuntimeSettings?.().contextLimit).toBe(8192);
      settings.set('context-limit', 4096);
      settings.set('tools.disabled', ['shell']);
      expect(options.profile.readRuntimeSettings?.().contextLimit).toBe(4096);
      expect(options.profile.readToolGovernance().disabled).toContain('shell');
      settings.setProviderSetting(
        'openai',
        'base-url',
        'https://child.example',
      );
      const invocation = options.profile.prepareProviderInvocation('openai');
      expect(invocation.runtimeId).toBe(state.runtimeId);
      expect(invocation.sessionId).toBe(state.sessionId);
      expect(invocation.getEphemeral<string>('base-url')).toBe(
        'https://child.example',
      );
      const signalled = options.profile.prepareProviderInvocation(
        'openai',
        undefined,
        signal,
      );
      expect(signalled.signal).toBe(signal);
      await settingsOwner.dispose();
      expect(() => options.profile.readRuntimeSettings?.()).toThrow('closed');
      expect(second.history.getCurated()).toHaveLength(0);
      first.history.dispose();
      second.history.dispose();
    } finally {
      await closeLoaderFixture(directory, [
        () => manager.dispose(),
        () => settingsOwner.dispose(),
        () => config.dispose(),
        () => mediaOwner.dispose(),
      ]);
    }
  });
});
