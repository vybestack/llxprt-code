import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'bun:test';
import { useFakeResponsesReplay } from './helpers/fake-responses-replay.js';
import { openRouteBPreflight } from './helpers/route-b-preflight.js';

/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

const cleanups: Array<() => Promise<void>> = [];

describe('supplied workspace memory lifetime through public adoption', () => {
  useFakeResponsesReplay('plain-text.jsonl');
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  });

  it('disposes explicitly transferred preflight memory exactly once when the operation is abandoned', async () => {
    const route = await openRouteBPreflight({
      config: {
        sessionId: 'same-memory-label',
        folderTrust: true,
        mcpEnabled: false,
        skillsSupport: false,
        recording: { enabled: false },
        telemetry: { enabled: false },
        settings: { jitContextEnabled: false },
      },
    });
    cleanups.push(route.close);
    const { memory } = route;
    await mkdir(join(route.directory, '.git'));
    await writeFile(
      join(route.directory, 'LLXPRT.md'),
      'Initial caller instructions.',
    );
    expect((await memory.operations.refresh()).memoryContent).toContain(
      'Initial caller instructions.',
    );
    const dispose = vi.spyOn(memory, 'dispose');
    await route.prepare();
    const result = await route.preflight.preflight({
      provider: 'fake',
      model: 'fake-model',
    });
    if (!result.token) throw new Error('Missing actual preflight token');
    await route.disposePreflight();
    expect(() => memory.operations.refresh()).toThrow('disposed');
    expect(dispose).toHaveBeenCalledTimes(1);
  });
});
