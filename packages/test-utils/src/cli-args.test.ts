/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  assertProviderConfig,
  buildChildEnv,
  buildExtraArgs,
  getCommandAndArgs,
  getProfileName,
} from './cli-args.js';

describe('cli-args helpers', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('uses fake provider args when fake responses are configured', () => {
    expect(buildExtraArgs('/tmp/fake-responses.json', true)).toStrictEqual([
      '--yolo',
      '--ide-mode',
      'disable',
      '--provider',
      'fake',
      '--model',
      'fake-model',
    ]);
  });

  it('requires non-empty provider configuration without fake responses', () => {
    vi.stubEnv('LLXPRT_DEFAULT_PROVIDER', '');
    vi.stubEnv('LLXPRT_DEFAULT_MODEL', 'model');
    vi.stubEnv('OPENAI_API_KEY', 'key');

    expect(() => assertProviderConfig(undefined)).toThrow(
      'LLXPRT_DEFAULT_PROVIDER environment variable is required but not set',
    );
  });

  it('accepts a key file as authentication when no API key is present', () => {
    vi.stubEnv('LLXPRT_DEFAULT_PROVIDER', 'openai');
    vi.stubEnv('LLXPRT_DEFAULT_MODEL', 'model');
    vi.stubEnv('OPENAI_API_KEY', '');
    vi.stubEnv('LLXPRT_TEST_PROFILE_KEYFILE', '/tmp/keyfile');

    expect(() => assertProviderConfig(undefined)).not.toThrow();
  });

  it('adds provider, model, base URL, and key args for real provider runs', () => {
    vi.stubEnv('LLXPRT_DEFAULT_PROVIDER', 'openai');
    vi.stubEnv('LLXPRT_DEFAULT_MODEL', 'gpt-test');
    vi.stubEnv('OPENAI_BASE_URL', 'https://example.test/v1');
    vi.stubEnv('OPENAI_API_KEY', 'secret');

    expect(buildExtraArgs(undefined, false)).toStrictEqual([
      '--ide-mode',
      'disable',
      '--provider',
      'openai',
      '--model',
      'gpt-test',
      '--baseurl',
      'https://example.test/v1',
      '--key',
      'secret',
    ]);
  });

  it('builds child env without IDE detection variables and with fake response path', () => {
    vi.stubEnv('TERM_PROGRAM', 'vscode');
    vi.stubEnv('TERM_PROGRAM_VERSION', '1.0.0');
    vi.stubEnv('KEEP_ME', 'yes');

    const childEnv = buildChildEnv('/tmp/test-dir', '/tmp/fake.json');

    expect(childEnv['TERM_PROGRAM']).toBeUndefined();
    expect(childEnv['TERM_PROGRAM_VERSION']).toBeUndefined();
    expect(childEnv['KEEP_ME']).toBe('yes');
    expect(childEnv['NO_BROWSER']).toBe('true');
    expect(childEnv['LLXPRT_FAKE_RESPONSES']).toBe('/tmp/fake.json');
    expect(childEnv['LLXPRT_CODE_WELCOME_CONFIG_PATH']).toBe(
      '/tmp/test-dir/welcomeConfig.json',
    );
  });

  it('resolves installed binary and profile names from environment', () => {
    vi.stubEnv('INTEGRATION_TEST_USE_INSTALLED_LLXPRT', 'true');
    vi.stubEnv('LLXPRT_TEST_PROFILE', ' profile-name ');

    expect(
      getCommandAndArgs('/packages/cli/dist/index.js', ['--flag']),
    ).toStrictEqual({
      command: 'llxprt',
      initialArgs: ['--flag'],
    });
    expect(getProfileName()).toBe('profile-name');
  });
});
