/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Config } from '@vybestack/llxprt-code-core';
import { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import { WorkspaceFilesystemOwner } from '@vybestack/llxprt-code-core/services/workspace-filesystem-owner.js';
import { createTestOAuthBinding } from '@vybestack/llxprt-code-mcp/test-support/oauth.js';
import { McpRuntimeOwner } from '../mcpRuntimeAssembly.js';

const PRIMARY = 'MCP policy handoff requires its explicit runtime owner';

/** Depth-first messages of an error and any errors nested in aggregates. */
function collectFailureMessages(failure: unknown): string[] {
  if (!(failure instanceof Error)) return [String(failure)];
  if (!(failure instanceof AggregateError)) return [failure.message];
  return [
    failure.message,
    ...failure.errors.flatMap((error: unknown) =>
      collectFailureMessages(error),
    ),
  ];
}

describe('MCP filesystem constructor rejection', () => {
  it.each([
    { borrowed: false, cleanupFails: false },
    { borrowed: false, cleanupFails: true },
    { borrowed: true, cleanupFails: false },
  ])(
    'releases owned resources and retains borrowed resources (%j)',
    async ({ borrowed, cleanupFails }) => {
      const directory = await mkdtemp(join(tmpdir(), 'mcp-rejection-'));
      const file = join(directory, 'text.txt');
      const released = join(directory, 'released.txt');
      await writeFile(file, 'before');
      const root = new WorkspaceFilesystemOwner({
        targetDir: directory,
        isTrusted: () => true,
        fileSystem: {
          ownership: 'workspace',
          service: {
            readTextFile: (input) => readFile(input, 'utf8'),
            writeTextFile: (input, text) => writeFile(input, text),
          },
          release: async () => {
            await writeFile(released, 'release completed');
            if (cleanupFails)
              throw new Error('Owned filesystem release failed');
          },
        },
      });
      const config = new Config({
        sessionId: 'same-label',
        targetDir: directory,
        cwd: directory,
        debugMode: false,
        model: 'test',
      });
      try {
        let failure: unknown;
        try {
          await McpRuntimeOwner.create(
            createTestOAuthBinding(),
            config,
            new MessageBus(),
            undefined,
            undefined,
            undefined,
            undefined,
            'caller',
            undefined,
            'runtime',
            root,
            borrowed ? 'caller' : 'runtime',
          );
        } catch (error) {
          failure = error;
        }
        // With a failing owned release, the runtime wraps the primary failure
        // and the filesystem owner's own aggregate, so both surface.
        const expectedMessages = cleanupFails
          ? [
              'MCP construction cleanup failed',
              PRIMARY,
              'Workspace filesystem cleanup failed',
              'Owned filesystem release failed',
            ]
          : [PRIMARY];
        expect(collectFailureMessages(failure)).toStrictEqual(expectedMessages);
        const readOutcome = await root.files.readTextFile(file).then(
          (text) => ({ text, closed: false }),
          (error) => ({ text: String(error), closed: true }),
        );
        expect(readOutcome.closed).toBe(!borrowed);
        if (borrowed) await root.files.writeTextFile(file, 'after');
        const physical = await readFile(file, 'utf8');
        expect(physical === 'before').toBe(!borrowed);
        const releaseOutcome = await readFile(released, 'utf8').then(
          (text) => text.includes('completed'),
          (error) => {
            if (
              !(error instanceof Error) ||
              !('code' in error) ||
              error.code !== 'ENOENT'
            )
              throw error;
            return false;
          },
        );
        expect(releaseOutcome).toBe(!borrowed);
      } finally {
        await root.dispose().catch(() => undefined);
        await config.dispose();
        await rm(directory, { recursive: true, force: true });
      }
    },
  );
});
