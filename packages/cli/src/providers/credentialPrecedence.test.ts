/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import {
  resolveCredentialPrecedence,
  CredentialInputs,
} from './credentialPrecedence.js';

describe('resolveCredentialPrecedence', () => {
  it('prefers CLI inline key over profile values', () => {
    const inputs: CredentialInputs = {
      cliKey: 'cli-key',
      profileKey: 'profile-key',
      profileKeyfile: '/tmp/profile.key',
    };

    const result = resolveCredentialPrecedence(inputs);

    expect(result.inlineKey).toBe('cli-key');
    expect(result.inlineSource).toBe('cli');
    expect(result.keyfilePath).toBeUndefined();
    expect(result.keyfileSource).toBeUndefined();
  });

  it('prefers CLI keyfile when no CLI inline key is provided', () => {
    const inputs: CredentialInputs = {
      cliKeyfile: '/tmp/cli.key',
      profileKey: 'profile-key',
    };

    const result = resolveCredentialPrecedence(inputs);

    expect(result.keyfilePath).toBe('/tmp/cli.key');
    expect(result.keyfileSource).toBe('cli');
    expect(result.inlineKey).toBeUndefined();
  });

  it('falls back to profile credentials when CLI options are absent', () => {
    const inputs: CredentialInputs = {
      profileKeyfile: '/tmp/profile.key',
      profileBaseUrl: 'https://profile.example.com',
    };

    const result = resolveCredentialPrecedence(inputs);

    expect(result.keyfilePath).toBe('/tmp/profile.key');
    expect(result.keyfileSource).toBe('profile');
    expect(result['base-url']).toBe('https://profile.example.com');
    expect(result.baseUrlSource).toBe('profile');
  });

  it('prefers CLI base URL over profile values', () => {
    const inputs: CredentialInputs = {
      cliBaseUrl: 'https://cli.example.com',
      profileBaseUrl: 'https://profile.example.com',
    };

    const result = resolveCredentialPrecedence(inputs);

    expect(result['base-url']).toBe('https://cli.example.com');
    expect(result.baseUrlSource).toBe('cli');
  });
});
