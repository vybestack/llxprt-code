/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it } from 'bun:test';
import { restoreEnv, setEnv } from './env-test-helpers.js';
import {
  assertProviderConfig,
  buildChildEnv,
  buildExtraArgs,
  getCommandAndArgs,
  getProfileName,
} from './cli-args.js';

describe('cli-args helpers', () => {
  afterEach(() => {
    restoreEnv();
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
    setEnv('LLXPRT_DEFAULT_PROVIDER', '');
    setEnv('LLXPRT_DEFAULT_MODEL', 'model');
    setEnv('OPENAI_API_KEY', 'key');

    expect(() => assertProviderConfig(undefined)).toThrow(
      'LLXPRT_DEFAULT_PROVIDER environment variable is required but not set',
    );
  });

  it('accepts a key file as authentication when no API key is present', () => {
    setEnv('LLXPRT_DEFAULT_PROVIDER', 'openai');
    setEnv('LLXPRT_DEFAULT_MODEL', 'model');
    setEnv('OPENAI_API_KEY', '');
    setEnv('LLXPRT_TEST_PROFILE_KEYFILE', '/tmp/keyfile');

    expect(() => assertProviderConfig(undefined)).not.toThrow();
  });

  it('adds provider, model, base URL, and key args for real provider runs', () => {
    setEnv('LLXPRT_DEFAULT_PROVIDER', 'openai');
    setEnv('LLXPRT_DEFAULT_MODEL', 'gpt-test');
    setEnv('OPENAI_BASE_URL', 'https://example.test/v1');
    setEnv('OPENAI_API_KEY', 'secret');

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
    setEnv('TERM_PROGRAM', 'vscode');
    setEnv('TERM_PROGRAM_VERSION', '1.0.0');
    setEnv('KEEP_ME', 'yes');

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
    setEnv('INTEGRATION_TEST_USE_INSTALLED_LLXPRT', 'true');
    setEnv('LLXPRT_TEST_PROFILE', ' profile-name ');

    expect(
      getCommandAndArgs('/packages/cli/bin/llxprt.cjs', ['--flag']),
    ).toStrictEqual({
      command: 'llxprt',
      initialArgs: ['--flag'],
    });
    expect(getProfileName()).toBe('profile-name');
  });
});
