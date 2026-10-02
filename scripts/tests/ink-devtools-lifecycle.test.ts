/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execute = promisify(execFile);

describe('Ink development inspector lifecycle', () => {
  it('bounds dormant state, resynchronizes connections and preserves Static output', async () => {
    const fixture = fileURLToPath(
      new URL('./fixtures/ink-devtools-lifecycle.ts', import.meta.url),
    );
    const result = await execute(process.execPath, [fixture], {
      timeout: 60_000,
    });
    expect(JSON.parse(result.stdout)).toEqual({
      startQueue: 0,
      dormantQueue: 0,
      disconnectedQueue: 0,
      connectedNodes: 5,
      appends: 1220,
      unmountedNodes: 0,
    });
  }, 65_000);
});
