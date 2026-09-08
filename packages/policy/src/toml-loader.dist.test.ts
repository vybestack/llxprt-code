/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { loadDefaultPolicies } from '@vybestack/llxprt-code-policy';

function hasPolicySource(
  rules: Awaited<ReturnType<typeof loadDefaultPolicies>>,
  sourceName: string,
): boolean {
  return rules.some((rule) => rule.source?.includes(sourceName) ?? false);
}

describe('default policy TOML loading', () => {
  it('loads bundled default policies from the source package location', async () => {
    /**
     * @plan:PLAN-20260609-ISSUE1591.P05
     * @requirement:REQ-008.1
     */
    const rules = await loadDefaultPolicies();

    expect(rules.length).toBeGreaterThan(0);
    expect(hasPolicySource(rules, 'read-only.toml')).toBe(true);
    expect(hasPolicySource(rules, 'write.toml')).toBe(true);
  });
});
