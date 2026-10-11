/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { submitOAuthCode } from './oauth-submission.js';

describe('submitOAuthCode', () => {
  it('routes a code only to the active provider without exposing the provider', () => {
    const submitted: string[] = [];
    const result = submitOAuthCode(
      {
        getActiveProvider: () => 'gemini',
        submitCode: (provider, code) => {
          submitted.push(`${provider}:${code}`);
          return provider === 'gemini';
        },
      },
      'auth-code',
    );
    expect(result).toBe(true);
    expect(submitted).toStrictEqual(['gemini:auth-code']);
  });

  it('does not attempt submission when there is no active provider', () => {
    const submitted: string[] = [];
    const result = submitOAuthCode(
      {
        getActiveProvider: () => undefined,
        submitCode: (provider, code) => {
          submitted.push(`${provider}:${code}`);
          return true;
        },
      },
      'auth-code',
    );
    expect(result).toBe(false);
    expect(submitted).toStrictEqual([]);
  });

  it('returns a failed provider submission without changing the owner', () => {
    const result = submitOAuthCode(
      { getActiveProvider: () => 'codex', submitCode: () => false },
      'unused-code',
    );
    expect(result).toBe(false);
  });
});
