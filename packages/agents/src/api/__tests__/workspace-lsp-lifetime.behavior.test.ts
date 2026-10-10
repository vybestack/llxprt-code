/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fromConfig } from '../fromConfig.js';
import { buildCliStyleConfig } from './helpers/buildCliStyleConfig.js';

import { describe, expect, it } from 'bun:test';
import { fileURLToPath } from 'node:url';
import { buildAgent } from './helpers/agentHarness.js';

const fixture = fileURLToPath(
  new URL('../../../../lsp/test/fixtures/fake-lsp-server.ts', import.meta.url),
);

describe('public Agent workspace LSP lifetime', () => {
  it('starts the real LSP root and leaves an independent same-label Agent alive on disposal', async () => {
    const configuration = {
      sessionId: 'same-lsp-label',
      lsp: {
        servers: [{ id: 'ts', command: process.execPath, args: [fixture] }],
      },
    };
    const first = await buildAgent('plain-text.jsonl', configuration);
    const second = await buildAgent('plain-text.jsonl', configuration);
    try {
      expect((await first.agent.lsp.status()).disabled).toBe(false);
      await first.agent.dispose();
      expect((await second.agent.lsp.status()).disabled).toBe(false);
      expect((await first.agent.lsp.status()).disabled).toBe(true);
    } finally {
      await first.cleanup();
      await second.cleanup();
    }
  });
  it('rejects caller LSP lifetime without a supplied workspace root', async () => {
    await expect(
      buildAgent('plain-text.jsonl', { lspOwnership: 'caller', lsp: true }),
    ).rejects.toThrow('Caller-owned LSP requires an explicit workspace root');
  });

  for (const reverse of [false, true]) {
    it(`keeps caller workspace LSP usable after both borrowed facade disposal orders (${reverse})`, async () => {
      const directory = await mkdtemp(join(tmpdir(), 'agent-lsp-borrowed-'));
      const file = join(directory, 'input.ts');
      await writeFile(file, 'const input = TYPE_ERROR;\n');
      const built = await buildCliStyleConfig('plain-text.jsonl', {
        workingDir: directory,
        lsp: {
          servers: [
            { id: 'ts', command: process.execPath, args: [fixture] },
            { id: 'eslint', command: process.execPath, args: [fixture] },
          ],
        },
      });
      const options = {
        settingsService: built.settingsService,
        config: built.config,
        providerManager: built.providerManager,
        agentClient: built.agentClient,
        mcpRuntime: built.mcpRuntime,
      };
      const first = await fromConfig(options);
      const second = await fromConfig(options);
      const root = built.mcpRuntime.workspaceLsp;
      try {
        for (const facade of reverse ? [second, first] : [first, second]) {
          await facade.dispose();
          expect(
            (await root.diagnostics.waitForDiagnostics(file, 5000)).some(
              (diagnostic) => diagnostic.line === 1,
            ),
          ).toBe(true);
          expect((await root.inspection.read()).alive).toBe(true);
        }
        await root.dispose();
        await expect(
          root.diagnostics.waitForDiagnostics(file, 5000),
        ).rejects.toThrow('stopped');
      } finally {
        await first.dispose();
        await second.dispose();
        await built.cleanup();
        await rm(directory, { recursive: true, force: true });
      }
    });
  }
});
