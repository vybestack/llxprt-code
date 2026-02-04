/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { parseZedAuthMethodId } from './zedIntegration.js';

describe('zedIntegration auth method validation', () => {
  it('accepts known auth methods', () => {
    expect(parseZedAuthMethodId('oauth-personal')).toBe('oauth-personal');
    expect(parseZedAuthMethodId('gemini-api-key')).toBe('gemini-api-key');
    expect(parseZedAuthMethodId('vertex-ai')).toBe('vertex-ai');
  });

  it('rejects unknown auth methods', () => {
    expect(() => parseZedAuthMethodId('unknown-method')).toThrow(
      /Invalid enum value/,
    );
  });
});
