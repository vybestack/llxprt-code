/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { createProviderCallOptions } from './providerCallOptions.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';

describe('createProviderCallOptions', () => {
  it('provides lazy streamed rows for an eager fixture without changing their identity', async () => {
    const rows: IContent[] = [{ speaker: 'human', blocks: [] }];
    const options = createProviderCallOptions({
      providerName: 'openai',
      contents: rows,
    });
    expect(Symbol.asyncIterator in options.contents).toBe(true);
    if (!(Symbol.asyncIterator in options.contents)) {
      throw new Error('Provider fixture must supply a history stream');
    }
    const iterator = options.contents[Symbol.asyncIterator]();
    const first = await iterator.next();
    expect(first.done).toBe(false);
    expect(first.value).toBe(rows[0]);
    expect((await iterator.next()).done).toBe(true);
    const repeated = options.contents[Symbol.asyncIterator]();
    expect((await repeated.next()).value).toBe(rows[0]);
    expect((await repeated.next()).done).toBe(true);
  });

  it('populates provider-specific ephemerals in the invocation snapshot', () => {
    const settings = new SettingsService();
    settings.set('global-setting', 'enabled');
    settings.setProviderSetting('openai', 'temperature', 0.42);
    settings.setProviderSetting('openai', 'max_tokens', 256);

    const options = createProviderCallOptions({
      providerName: 'openai',
      contents: [],
      settings,
    });

    expect(options.invocation).toBeDefined();
    expect(options.invocation.runtimeId).toMatch(/^openai\.runtime\./);
    expect(options.invocation.settings).toBe(settings);
    expect(options.invocation.ephemerals['global-setting']).toBe('enabled');
    expect(options.invocation.ephemerals.openai).toMatchObject({
      temperature: 0.42,
      max_tokens: 256,
    });
  });

  it('merges runtime metadata with explicit metadata overrides', () => {
    const options = createProviderCallOptions({
      providerName: 'anthropic',
      metadata: { explicit: true },
      settingsOverrides: {
        provider: { callId: 'test-call' },
      },
      runtimeMetadata: { injected: true },
      runtimeId: 'custom-runtime',
    });

    expect(options.runtime.runtimeId).toBe('custom-runtime');
    expect(options.metadata).toMatchObject({
      source: 'test-utils#createProviderCallOptions',
      explicit: true,
      injected: true,
    });
    expect(options.invocation.metadata).toMatchObject({
      explicit: true,
      injected: true,
    });
  });
});
