import { WorkspaceLspOwner } from '@vybestack/llxprt-code-core/lsp/workspace-lsp-owner.js';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { beforeAll, afterAll, describe, expect, it } from 'bun:test';
import { initializePromptSystem } from '@vybestack/llxprt-code-core/core/prompts.js';
import { fileURLToPath } from 'node:url';

import { buildAgent } from './helpers/agentHarness.js';

/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

const fixture = fileURLToPath(
  new URL('../../../../lsp/test/fixtures/fake-lsp-server.ts', import.meta.url),
);

describe('public Agent workspace LSP lifetime', () => {
  let promptDirectory: string;
  const previousPrompts = process.env.LLXPRT_PROMPTS_DIR;
  beforeAll(async () => {
    promptDirectory = await mkdtemp(join(tmpdir(), 'engine-prompts-'));
    process.env.LLXPRT_PROMPTS_DIR = promptDirectory;
    await initializePromptSystem();
  });
  afterAll(async () => {
    if (previousPrompts === undefined) delete process.env.LLXPRT_PROMPTS_DIR;
    else process.env.LLXPRT_PROMPTS_DIR = previousPrompts;
    await rm(promptDirectory, { recursive: true, force: true });
  });

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

  it('keeps caller workspace LSP usable after the borrowing Agent is disposed', async () => {
    const directory = await realpath(
      await mkdtemp(join(tmpdir(), 'agent-lsp-borrowed-')),
    );
    const file = join(directory, 'input.ts');
    await writeFile(file, 'const input = TYPE_ERROR;\n');
    const root = new WorkspaceLspOwner(
      {
        servers: [
          { id: 'ts', command: process.execPath, args: [fixture] },
          { id: 'eslint', command: process.execPath, args: [fixture] },
        ],
      },
      directory,
      () => true,
    );
    const borrowing = await buildAgent('plain-text.jsonl', {
      workingDir: directory,
      lspOwner: root,
      lspOwnership: 'caller',
    });
    try {
      await borrowing.agent.dispose();
      expect(
        (await root.diagnostics.waitForDiagnostics(file, 5000)).some(
          (diagnostic) => diagnostic.line === 1,
        ),
      ).toBe(true);
      expect((await root.inspection.read()).alive).toBe(true);
      await root.dispose();
      await expect(
        root.diagnostics.waitForDiagnostics(file, 5000),
      ).rejects.toThrow('stopped');
    } finally {
      await borrowing.cleanup();
      await root.dispose();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
