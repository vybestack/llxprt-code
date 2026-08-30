/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import OpenAI from 'openai';
import { createProviderCallOptions } from '@vybestack/llxprt-code-core/test-utils/providerCallOptions.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { declaredMediaTransportCapabilities } from '../providerMediaTransportCapabilities.js';
import { resolveKimiProviderFileRequestPolicy } from './kimiProviderFilePolicy.js';

function workspaceOptions(
  targetDirectory: string,
  runtimeId = 'kimi-policy-runtime',
) {
  const settings = new SettingsService();
  settings.set('provider-files', 'workspace');
  return createProviderCallOptions({
    providerName: 'kimi',
    settings,
    runtimeId,
    configOverrides: { getTargetDir: () => targetDirectory },
    resolved: {
      model: 'kimi-k3',
      baseURL: 'https://api.kimi.test/v1',
      authToken: 'test-key',
    },
  });
}

function kimiClient(apiKey = 'test-key'): OpenAI {
  return new OpenAI({
    apiKey,
    baseURL: 'https://api.kimi.test/v1',
  });
}

describe('Kimi provider Files request policy', () => {
  it('requires non-empty credentials when Files is explicitly enabled', () => {
    const client = new OpenAI({
      apiKey: '   ',
      baseURL: 'https://api.kimi.test/v1',
    });

    const resolve = () =>
      resolveKimiProviderFileRequestPolicy(
        workspaceOptions('/workspace/a'),
        'kimi',
        { fileUpload: true },
        declaredMediaTransportCapabilities('kimi'),
        client,
      );

    expect(resolve).toThrow('non-empty credential');
  });

  it('requires a non-empty target directory for workspace Files mode', () => {
    const client = new OpenAI({
      apiKey: 'test-key',
      baseURL: 'https://api.kimi.test/v1',
    });

    const resolve = () =>
      resolveKimiProviderFileRequestPolicy(
        workspaceOptions('   '),
        'kimi',
        { fileUpload: true },
        declaredMediaTransportCapabilities('kimi'),
        client,
      );

    expect(resolve).toThrow('non-empty target directory');
  });

  it('uses a stable non-reversible workspace scope without persisting the local path', () => {
    const first = resolveKimiProviderFileRequestPolicy(
      workspaceOptions('/Users/alice/private/customer-project'),
      'kimi',
      { fileUpload: true },
      declaredMediaTransportCapabilities('kimi'),
      kimiClient(),
    );
    const second = resolveKimiProviderFileRequestPolicy(
      workspaceOptions(
        '/Users/alice/private/customer-project',
        'other-runtime',
      ),
      'kimi',
      { fileUpload: true },
      declaredMediaTransportCapabilities('kimi'),
      kimiClient(),
    );

    expect(first?.scopeId).toBe(second?.scopeId);
    expect(first?.scopeId).not.toContain('/Users/alice');
    expect(first?.scopeId).toMatch(/^workspace:[a-f0-9]{64}$/);
  });

  it('isolates workspace scopes when the directory or credential changes', () => {
    const first = resolveKimiProviderFileRequestPolicy(
      workspaceOptions('/workspace/a'),
      'kimi',
      { fileUpload: true },
      declaredMediaTransportCapabilities('kimi'),
      kimiClient('credential-a'),
    );
    const moved = resolveKimiProviderFileRequestPolicy(
      workspaceOptions('/workspace/b'),
      'kimi',
      { fileUpload: true },
      declaredMediaTransportCapabilities('kimi'),
      kimiClient('credential-a'),
    );
    const otherCredential = resolveKimiProviderFileRequestPolicy(
      workspaceOptions('/workspace/a'),
      'kimi',
      { fileUpload: true },
      declaredMediaTransportCapabilities('kimi'),
      kimiClient('credential-b'),
    );

    expect(first?.scopeId).not.toBe(moved?.scopeId);
    expect(first?.scopeId).not.toBe(otherCredential?.scopeId);
  });
});
