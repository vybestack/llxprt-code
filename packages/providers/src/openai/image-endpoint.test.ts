/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import {
  isLocalImageEndpoint,
  validateCodexImageProfileBaseUrl,
} from './imageEndpoint.js';
import {
  createCodexImageBackendResolver,
  validateImageProfileAuth,
} from './codexImageBackendResolver.js';
import type { ImageProfile } from '@vybestack/llxprt-code-settings';

const profile: ImageProfile = {
  version: 1,
  type: 'image',
  backend: 'openai-images',
  model: 'image',
  baseUrl: 'https://images.example/v1',
  auth: { type: 'api-key', apiKey: 'secret' },
};
describe('image endpoint policy', () => {
  it.each(['http', 'https'])('recognizes %s loopback endpoints', (scheme) => {
    for (const host of [
      'localhost',
      'localhost.',
      'images.localhost',
      'images.localhost.',
      '127.0.0.2',
      '[::1]',
    ])
      expect(isLocalImageEndpoint(`${scheme}://${host}`)).toBe(true);
  });
  it.each([
    'invalid',
    '',
    'ftp://localhost',
    'https://localhost.example',
    'https://127.evil.example',
  ])('returns false for %j', (url) => {
    expect(isLocalImageEndpoint(url)).toBe(false);
  });
  it('accepts a trailing slash on the Codex endpoint', () => {
    expect(() =>
      validateCodexImageProfileBaseUrl(
        'https://chatgpt.com/backend-api/codex/',
      ),
    ).not.toThrow();
  });
  it('preserves malformed URL causes', () => {
    let caught: unknown;
    try {
      validateCodexImageProfileBaseUrl('invalid');
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({ cause: expect.any(TypeError) });
  });
  it.each([
    'http://images.example',
    'https://user:password@images.example',
    'invalid',
  ])('rejects unsafe profile URL %s', (baseUrl) => {
    expect(() =>
      validateImageProfileAuth({ ...profile, baseUrl }, 'unsafe'),
    ).toThrow("Image profile 'unsafe' has an invalid base URL");
  });
  it.each(['', '   '])('rejects blank Codex base URL %j', (baseUrl) => {
    expect(() =>
      validateImageProfileAuth(
        {
          ...profile,
          backend: 'codex',
          auth: { type: 'oauth', provider: 'codex' },
          baseUrl,
        },
        'blank',
      ),
    ).toThrow("Image profile 'blank'");
  });
  it('allows custom HTTPS hosts', () => {
    expect(() => validateImageProfileAuth(profile)).not.toThrow();
  });
  it('reports the declared auth mode', () => {
    expect(() =>
      validateImageProfileAuth({ ...profile, auth: { type: 'none' } }),
    ).toThrow("auth mode 'none'");
  });
  it('rejects missing credential resolver before constructing the transport', () => {
    const resolve = createCodexImageBackendResolver({
      oauthManager: undefined,
      getActiveProvider: () => undefined,
      getActiveImageProfile: () => profile,
      getActiveImageProfileName: () => 'missing-resolver',
    });
    expect(resolve).toThrow("Image profile 'missing-resolver'");
  });
});
