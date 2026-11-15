/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Storage } from '@vybestack/llxprt-code-settings';
import { runReviewScenario } from './helpers/refusal-review-harness.js';
import { runScriptedPrompt, stopReply } from './helpers/refusal-endpoint.js';

describe('refusal harness storage isolation', () => {
  it('keeps both harnesses from adding projects to the real log tmp root', async () => {
    const realLogTmp = join(Storage.getGlobalLogDir(), 'tmp');
    const readProjects = (): string[] =>
      existsSync(realLogTmp) ? readdirSync(realLogTmp).sort() : [];
    const before = readProjects();

    await runScriptedPrompt([stopReply('isolated response')]);
    await runReviewScenario({ settings: { 'refusal.retries': 0 } });

    expect(readProjects()).toStrictEqual(before);
  });
});
