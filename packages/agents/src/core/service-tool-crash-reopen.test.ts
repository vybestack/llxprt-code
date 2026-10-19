/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { serviceToolChild } from './__tests__/support/service-tool-child.js';
import { diskToolState } from './__tests__/support/service-tool-recorders.js';
import { proveToolResume } from './__tests__/support/service-tool-resume.js';
import {
  toolId,
  toolResult,
} from './__tests__/support/service-tool-runtime.js';

describe('native tool crash front-door resume', () => {
  it('SIGKILL at the next request keeps the eager result on front-door resume without relying on an explicit test flush', async () => {
    const rig = await serviceToolChild('none', 'crash');
    try {
      const ready = await rig.wait('ready');
      const files = z.array(z.string()).length(2).parse(ready.details.files);
      rig.send('next');
      const entry = await rig.wait('transport-entry');
      await rig.wait('transport-request');
      rig.child.kill('SIGKILL');
      await rig.child.exited;
      expect(rig.child.signalCode).toBe('SIGKILL');
      for (let index = 0; index < files.length; index++) {
        const recovered = await diskToolState(files[index]);
        expect(recovered.rows).toHaveLength(3);
        expect(recovered.rows[1].owner).toBe(
          z.string().parse(ready.details.owner),
        );
        expect(recovered.rows[2]).toMatchObject({
          owner: null,
          content: {
            speaker: 'tool',
            blocks: [
              {
                type: 'tool_response',
                callId: toolId,
                toolName: 'lookup',
                result: toolResult,
              },
            ],
          },
        });
        await proveToolResume(
          rig.directory,
          index === 0 ? 'primary' : 'mirror',
          recovered.rows,
        );
      }
      const counts = z.array(z.number()).length(2);
      expect(counts.parse(entry.details.flushes)).toStrictEqual(
        counts.parse(ready.details.flushes).map((count) => count + 1),
      );
      expect(counts.parse(entry.details.seqs)).toStrictEqual(
        counts.parse(ready.details.seqs).map((seq) => seq + 1),
      );
      await writeFile(
        join(rig.directory, 'proof.json'),
        JSON.stringify({ pid: rig.child.pid, ready, entry }, null, 2),
      );
    } finally {
      await rig.close();
    }
  }, 60000);
});
