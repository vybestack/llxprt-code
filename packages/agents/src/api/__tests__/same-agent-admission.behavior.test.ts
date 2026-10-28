/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { runSameAgentAdmission } from './same-agent-admission.driver.js';
import { usePromptFixture } from './helpers/prompt-fixture.js';

describe('Same-agent admission (#2616, #3633 S2)', () => {
  usePromptFixture();

  it('keeps all rebuilds excluded and turn/tool inputs captured until the safe boundary', async () => {
    expect(await runSameAgentAdmission()).toStrictEqual([
      'capture-a',
      'capture-a',
      'after-safe-boundary',
    ]);
  }, 30_000);
});
