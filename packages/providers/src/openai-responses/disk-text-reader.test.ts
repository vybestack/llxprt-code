/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { existsSync, unlinkSync } from 'node:fs';
import { ResponsesDiskTextRows } from './responses-disk-text-rows.js';
import { Gpt56SourceProjection } from '../tokenizers/gpt56-source-projection.js';
import { diskResponsesBodyBytes } from './responses-disk-body.js';
import { diskTextFixture } from './__tests__/support/disk-text-fixture.js';
import { projectionRuntime } from './__tests__/support/projection-ownership-fixture.js';

async function failedBody(source: Gpt56SourceProjection): Promise<void> {
  for await (const bytes of diskResponsesBodyBytes(
    { model: 'gpt-5.6', input: [], stream: true, instructions: '' },
    source,
  ))
    void bytes;
}

describe('actual prepared disk segment reader ownership', () => {
  it('propagates source I/O failure and releases the body lease so unused preparation can remove every remaining segment', async () => {
    const disk = diskTextFixture(false, false);
    const setup = await projectionRuntime('http://127.0.0.1:1/v1', disk.root);
    const projection = await setup.provider.projectPromptEnvelope(
      setup.options(new ResponsesDiskTextRows(disk.rows)),
    );
    const source = projection.finalizedProjection;
    if (!(source instanceof Gpt56SourceProjection))
      throw new Error('Missing sealed actual projection');
    try {
      const input = source.promptSegments.find(
        (segment) => segment.promptKey === 'input',
      );
      if (input === undefined) throw new Error('Missing actual input segment');
      unlinkSync(input.source.path);
      await expect(failedBody(source)).rejects.toThrow('ENOENT');
      await projection.releaseIfUnsent?.();
      expect(
        source.promptSegments.every(
          (segment) => !existsSync(segment.source.path),
        ),
      ).toBe(true);
    } finally {
      await projection.releaseIfUnsent?.();
      disk.close();
      await setup.config.dispose();
    }
  });
});
