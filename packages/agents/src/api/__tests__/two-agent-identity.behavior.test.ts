/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { runTwoAgentIdentity } from './two-agent-identity.driver.js';
import { usePromptFixture } from './helpers/prompt-fixture.js';

describe('Two-agent identity (#2616, #3633 S1, #2300)', () => {
  usePromptFixture();

  it('isolates equal-label roots through requests, profiles, auth, effects and disposal', async () => {
    const result = await runTwoAgentIdentity();
    expect(result.requestsA).toHaveLength(2);
    expect(result.requestsB).toHaveLength(3);
  }, 30_000);
});
