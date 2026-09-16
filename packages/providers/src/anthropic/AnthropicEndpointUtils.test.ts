/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import {
  isAnthropicOAuthBaseURL,
  isZaiAnthropicEndpoint,
} from './AnthropicEndpointUtils.js';

describe('isZaiAnthropicEndpoint (#3693)', () => {
  it.each([
    ['https://api.z.ai/api/anthropic', true],
    ['https://z.ai/api/anthropic', true],
    ['https://open.bigmodel.cn/api/anthropic', true],
    ['https://bigmodel.cn/api/anthropic', true],
    ['https://API.Z.AI/api/anthropic', true],
    ['https://api.anthropic.com', false],
    ['https://anthropic.com', false],
    ['https://api.openai.com/v1', false],
    ['https://z.ai.example.com/api', false],
    ['https://notz.ai.example.com/api', false],
    ['https://evilbigmodel.cn.attacker.com', false],
  ])('classifies %s as zai=%s', (baseURL, expected) => {
    expect(isZaiAnthropicEndpoint(baseURL)).toBe(expected);
  });

  it('returns false for undefined and empty base URLs (default is native Anthropic)', () => {
    expect(isZaiAnthropicEndpoint(undefined)).toBe(false);
    expect(isZaiAnthropicEndpoint('')).toBe(false);
    expect(isZaiAnthropicEndpoint('   ')).toBe(false);
  });

  it('returns false for malformed URLs without throwing', () => {
    expect(isZaiAnthropicEndpoint('not a url')).toBe(false);
    expect(isZaiAnthropicEndpoint('http://')).toBe(false);
  });

  it('agrees with the OAuth test on native and third-party endpoints', () => {
    // Native endpoint: OAuth-eligible (native) and not zai.
    expect(isAnthropicOAuthBaseURL('https://api.anthropic.com')).toBe(true);
    expect(isZaiAnthropicEndpoint('https://api.anthropic.com')).toBe(false);
    // zai endpoint: not OAuth-eligible and zai.
    expect(isAnthropicOAuthBaseURL('https://api.z.ai/api/anthropic')).toBe(
      false,
    );
    expect(isZaiAnthropicEndpoint('https://api.z.ai/api/anthropic')).toBe(true);
  });
});
