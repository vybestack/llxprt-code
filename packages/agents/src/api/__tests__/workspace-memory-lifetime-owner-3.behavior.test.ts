import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'bun:test';
import { AgentProfilePreflight } from '../profile-preflight.js';
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

  it('retains the explicit preflight memory transfer through physical refresh and facade retirement', async () => {
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
    const file = join(route.directory, 'LLXPRT.md');
    await writeFile(file, 'Initial caller instructions.');
    expect((await memory.operations.refresh()).memoryContent).toContain(
      'Initial caller instructions.',
    );
    await route.prepare();
    const intent = { provider: 'fake', model: 'fake-model' };
    const result = await route.preflight.preflight(intent);
    expect(result.authFailed).toBe(false);
    if (!result.token) throw new Error('Missing actual preflight token');
    const facade = await AgentProfilePreflight.createForegroundAgent(
      route.preflight,
      result.token,
      intent,
      {},
    );
    cleanups.push(() => facade.dispose());
    await writeFile(file, 'Transferred preflight instructions.');
    await facade.memory.refresh();
    expect(facade.memory.getMemory()).toContain(
      'Transferred preflight instructions.',
    );
    await facade.dispose();
    expect(() => memory.operations.refresh()).toThrow('disposed');
    expect(() => memory.operations.snapshot()).toThrow('disposed');
  });
});
