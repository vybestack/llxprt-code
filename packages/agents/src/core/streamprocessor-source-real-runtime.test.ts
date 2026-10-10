/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { ProviderManager } from '@vybestack/llxprt-code-providers';
import { configureProviderRuntimeFactories } from '@vybestack/llxprt-code-providers/composition/index.js';
import { diskTextRow } from '@vybestack/llxprt-code-providers/openai-responses/__tests__/support/disk-text-fixture.js';
import { projectionEndpoint } from '@vybestack/llxprt-code-providers/openai-responses/__tests__/support/projection-ownership-fixture.js';
import { sourceRootSetup } from './__tests__/support/prompt-envelope-source-test-helpers.js';
import {
  ObservedHistory,
  ObservedResponsesProvider,
  assembleProcessorFixture,
  sourcePending,
} from './__tests__/support/streamprocessor-source-fixture.js';

const root = sourceRootSetup();

/**
 * Builds the runtime exactly as the CLI does: the tokenizer factory comes from
 * configureProviderRuntimeFactories, not from a hand-wired test factory.
 */
function realRuntimeFixture(root: string, baseURL: string, model: string) {
  const settings = new SettingsService();
  settings.setProviderSetting('openai-responses', 'model', model);
  settings.setProviderSetting('openai-responses', 'base-url', baseURL);
  settings.setProviderSetting('openai-responses', 'auth-key', 'test-key');
  settings.set('prompt-caching', 'off');
  settings.set('retries', 1);
  settings.set('retrywait', 0);
  settings.set('context-limit', 4_000_000);
  const config = new Config({
    cwd: root,
    targetDir: root,
    sessionId: randomUUID(),
    model,
    debugMode: false,
    settingsService: settings,
    telemetry: { enabled: false },
  });
  configureProviderRuntimeFactories(
    config,
    new ProviderManager({ settingsService: settings, config }),
  );
  const provider = new ObservedResponsesProvider('test-key', baseURL);
  const history = new ObservedHistory();
  for (let index = 0; index < 8; index++)
    history.add(diskTextRow(index, false));
  const factory = config.getTokenizerFactory();
  if (factory === undefined)
    throw new Error('Missing runtime tokenizer factory');
  return assembleProcessorFixture(
    config,
    settings,
    factory,
    provider,
    history,
    baseURL,
    model,
  );
}

async function drain(stream: AsyncIterable<unknown>): Promise<void> {
  for await (const _chunk of stream) {
    /* Complete the actual history lifecycle. */
  }
}

describe('default source send route under the CLI runtime wiring', () => {
  it.each([
    ['a GPT-6 tier model outside the pinned o200k family', 'gpt-6-luna'],
    ['an unregistered model identity', 'acme-unregistered-model-1'],
  ])(
    'estimates and sends for %s',
    async (_label, model) => {
      const http = projectionEndpoint(false);
      http.readBody.release();
      http.respond.release();
      const setup = realRuntimeFixture(
        root(),
        `http://127.0.0.1:${http.server.port}/v1`,
        model,
      );
      try {
        await setup.history.waitForTokenUpdates();
        await drain(
          await setup.processor.makeApiCallAndProcessStream(
            { message: 'Answer', config: {} },
            `real-runtime-${model}`,
            sourcePending,
          ),
        );
        expect(http.bodies).toHaveLength(1);
        expect(http.bodies[0].bytes).toBeGreaterThan(0);
        expect(setup.history.owners.every((owner) => owner.closed)).toBe(true);
      } finally {
        setup.history.dispose();
        await http.server.stop(true);
        await setup.config.dispose();
      }
    },
    60000,
  );
});
