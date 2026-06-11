/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { loadDefaultPolicies } from '@vybestack/llxprt-code-policy';

describe('default policy TOML loading', () => {
  it('loads bundled default policies from the source package location', async () => {
    /**
     * @plan:PLAN-20260609-ISSUE1591.P05
     * @requirement:REQ-008.1
     */
    const rules = await loadDefaultPolicies();

    expect(rules.length).toBeGreaterThan(0);
    expect(
      rules.some((rule) => rule.source?.includes('read-only.toml') ?? false),
    ).toBe(true);
    expect(
      rules.some((rule) => rule.source?.includes('write.toml') ?? false),
    ).toBe(true);
  });
});
