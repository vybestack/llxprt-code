/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkspaceMcpCatalogOwner } from './workspace-mcp-catalog-owner.js';

describe('workspace MCP catalog admission', () => {
  it('joins an admitted physical read failure instead of treating every closing error as cancellation', async () => {
    const directory = await mkdtemp(
      join(tmpdir(), 'catalog-owner-read-error-'),
    );
    let enter!: () => void;
    const entered = new Promise<void>((resolve) => {
      enter = resolve;
    });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const owner = new WorkspaceMcpCatalogOwner(
      () => true,
      async (_server, uri) => {
        await writeFile(join(directory, 'entered'), uri);
        enter();
        await gate;
        const text = await readFile(
          join(directory, 'missing-quantity'),
          'utf8',
        );
        return { contents: [{ uri, text }] };
      },
    );
    const outcome = owner.resourceSelection
      .readResource('physical', 'fixture:///quantity')
      .then(
        () => undefined,
        (error: unknown) => error,
      );
    try {
      await entered;
      const closing = owner.dispose();
      const disposed = closing.then(
        () => undefined,
        (error: unknown) => error,
      );
      release();
      expect(await readFile(join(directory, 'entered'), 'utf8')).toBe(
        'fixture:///quantity',
      );
      const failure = await outcome;
      expect(failure).toBeInstanceOf(Error);
      const cleanup = await disposed;
      expect(cleanup).toBeInstanceOf(AggregateError);
      if (!(cleanup instanceof AggregateError))
        throw new Error('Expected joined read failure');
      expect(cleanup.errors).toContain(failure);
    } finally {
      release();
      await outcome;
      await owner.dispose().catch(() => undefined);
      await rm(directory, { recursive: true, force: true });
    }
  });
});
