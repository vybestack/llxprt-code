/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { SessionSettingsOwner } from '../session/session-settings-owner.js';
import { createAgentRuntimeContext } from './createAgentRuntimeContext.js';
import { createAgentRuntimeState } from './AgentRuntimeState.js';

function runtime(settings: SettingsService) {
  const owner = new SessionSettingsOwner(settings);
  return createAgentRuntimeContext({
    state: createAgentRuntimeState({
      sessionId: 'policy-validation',
      runtimeId: 'policy-validation',
      provider: 'openai',
      model: 'policy-model',
    }),
    settings: { compressionThreshold: 0.75 },
    readRuntimeSettings: () => owner.readRuntimePolicy(),
    provider: {
      getActiveProvider: () => ({
        name: 'openai',
        getModels: async () => [],
        generateChatCompletion: () => {
          throw new Error('Policy validation must not generate requests');
        },
      }),
      setActiveProvider: () => {
        throw new Error('Policy validation must not select a provider');
      },
    },
    telemetry: {
      logApiRequest: () => {},
      logApiResponse: () => {},
      logApiError: () => {},
    },
    tools: { listToolNames: () => [], getToolMetadata: () => undefined },
    prepareProviderInvocation: (name, parameters, signal) =>
      owner.prepareProviderInvocation(
        'policy-validation',
        name,
        parameters,
        signal,
      ),
    providerRuntime: {
      runtimeId: 'policy-validation',
    },
  });
}

describe('session runtime policy normalization', () => {
  it('ignores malformed verification values while keeping live boolean updates', () => {
    const settings = new SettingsService();
    const context = runtime(settings);
    const verification = ['true', null, 1, true, false].map((value) => {
      settings.set('compressionVerification', value);
      return context.ephemerals.compressionVerification();
    });
    expect(verification).toStrictEqual([false, false, false, true, false]);
  });

  it('uses the declared compression threshold when external numeric policy is malformed', () => {
    const settings = new SettingsService();
    const context = runtime(settings);
    const thresholds = ['invalid', null, true, Number.NaN].map((value) => {
      settings.set('compression-threshold', value);
      return context.ephemerals.compressionThreshold();
    });
    expect(thresholds).toStrictEqual([0.75, 0.75, 0.75, 0.75]);
  });

  it('normalizes string context limits and clamps live compression thresholds', () => {
    const settings = new SettingsService();
    const context = runtime(settings);
    settings.set('context-limit', '8192.9');
    settings.set('compression-threshold', 1.5);
    expect([
      context.ephemerals.contextLimit(),
      context.ephemerals.compressionThreshold(),
    ]).toStrictEqual([8192, 1]);
  });
  it('ignores malformed external preserve policies and uses established runtime defaults', () => {
    const settings = new SettingsService();
    const context = runtime(settings);
    const thresholds = [Infinity, NaN, 'invalid', null].map((value) => {
      settings.set('compression-preserve-threshold', value);
      settings.set('compression-top-preserve-threshold', value);
      return [
        context.ephemerals.preserveThreshold(),
        context.ephemerals.topPreserveThreshold(),
      ];
    });
    expect(thresholds).toStrictEqual([
      [0.4, 0.2],
      [0.4, 0.2],
      [0.4, 0.2],
      [0.4, 0.2],
    ]);
  });

  it('reads both preserve thresholds and tool format from the exact live store', () => {
    const settings = new SettingsService();
    const peer = runtime(new SettingsService());
    const context = runtime(settings);
    settings.set('compression-preserve-threshold', 0.3);
    settings.set('compression-top-preserve-threshold', 0.1);
    settings.set('toolFormat', 'xml');
    expect([
      context.ephemerals.preserveThreshold(),
      context.ephemerals.topPreserveThreshold(),
      context.ephemerals.toolFormatOverride(),
    ]).toStrictEqual([0.3, 0.1, 'xml']);
    settings.set('compression-preserve-threshold', 0.6);
    settings.set('compression-top-preserve-threshold', 0.25);
    settings.set('toolFormat', 'json');
    expect([
      context.ephemerals.preserveThreshold(),
      context.ephemerals.topPreserveThreshold(),
      context.ephemerals.toolFormatOverride(),
      peer.ephemerals.preserveThreshold(),
      peer.ephemerals.topPreserveThreshold(),
      peer.ephemerals.toolFormatOverride(),
    ]).toStrictEqual([0.6, 0.25, 'json', 0.4, 0.2, undefined]);
  });
});
